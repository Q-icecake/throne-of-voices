import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { GameEngine } from '../server/engine.ts';
import { createGameServer } from '../server/http.ts';
import type { CommandResponse } from '../shared/contracts.ts';

test('HTTP command route: strict validation, idempotent confirm, no disclosure', async t => {
  const engine = new GameEngine();
  const server = createGameServer(engine);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(url + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });

  await t.test('malformed command bodies are rejected before any mutation', async () => {
    const before = engine.internalSnapshot();
    for (const body of [{}, { type: 'submit' }, { type: 'submit', text: ' ' }, { type: 'submit', text: 'a'.repeat(2001) },
      { type: 'submit', text: '수군 정비', extra: 1 }, { type: 'confirm', draftId: 'draft-0001' },
      { type: 'confirm', draftId: 'task-0001', version: 1 }, { type: 'confirm', draftId: 'draft-0001', version: 0 },
      { type: 'confirm', draftId: 'draft-0001', version: 1.5 }, { type: 'revise', draftId: 'draft-0001', version: 1 },
      { type: 'execute', text: '수군을 정비해' }, { type: 'confirm', draftId: 'draft-0001', version: 1, resources: { grain: 0 } }]) {
      assert.equal((await post('/api/command', body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await post('/api/command', { type: 'submit', text: '수군' }, { Origin: 'https://untrusted.example' })).status, 403);
    assert.deepEqual(engine.internalSnapshot(), before);
  });

  await t.test('submit → confirm twice over HTTP creates one task; clock drives the report', async () => {
    const submitted = await (await post('/api/command', { type: 'submit', text: '주유에게 수군을 정비하라고 전해. 먼저 공격하지는 마.' })).json() as CommandResponse;
    assert.equal(submitted.outcome.kind, 'draft');
    const ref = { type: 'confirm', draftId: submitted.state.drafts[0]!.id, version: 1 };
    const [a, b] = await Promise.all([post('/api/command', ref), post('/api/command', ref)]);
    const outcomes = [(await a.json() as CommandResponse).outcome, (await b.json() as CommandResponse).outcome];
    assert.deepEqual(outcomes.map(o => o.kind), ['confirmed', 'confirmed']);
    assert.deepEqual(outcomes.map(o => o.kind === 'confirmed' && o.duplicate).sort(), [false, true]);
    assert.equal(engine.internalSnapshot().world.tasks.length, 1);
    assert.equal((await post('/api/test/action', { type: 'advance-clock', milliseconds: 40_000 })).status, 200);
    const state = await (await fetch(url + '/api/state')).json() as CommandResponse['state'];
    assert.equal(state.tasks[0]!.stage, 'completed');
    assert.equal(state.ledger.grain, 900);
    assert.equal(state.knowledge.documents.filter(doc => doc.taskId).length, 2);
    for (const path of ['/api/state', '/api/test/snapshot', '/api/test/logs']) {
      const text = await (await fetch(url + path)).text();
      for (const forbidden of ['SERVER_ONLY', 'PRIVATE_', '987654', 'UNRELEASED', 'enemyTroops', 'privatePerspective', 'cause', 'resources']) {
        assert.ok(!text.includes(forbidden), `${path}: ${forbidden}`);
      }
    }
  });

  await t.test('interpreter failure over HTTP exposes nothing and changes nothing', async () => {
    const failing = new GameEngine(undefined, { mode: 'mock', interpret() { throw new Error('PRIVATE_KEY_SENTINEL'); } });
    const failingServer = createGameServer(failing);
    failingServer.listen(0, '127.0.0.1');
    await once(failingServer, 'listening');
    try {
      const before = failing.internalSnapshot();
      const response = await fetch(`http://127.0.0.1:${(failingServer.address() as AddressInfo).port}/api/command`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'submit', text: '수군 정비' }),
      });
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: 'INTERNAL_ERROR' });
      assert.deepEqual(failing.internalSnapshot(), before);
    } finally {
      failingServer.closeAllConnections();
      await new Promise<void>(resolve => failingServer.close(() => resolve()));
    }
  });
});
