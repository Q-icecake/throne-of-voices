import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createGameServer } from '../server/http.ts';
import { GameEngine } from '../server/engine.ts';
import type { AddressInfo } from 'node:net';

test('HTTP boundary: lifecycle, validation, disclosure and safe failure', async t => {
  const engine = new GameEngine();
  const server = createGameServer(engine);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const post = (path: string, body: unknown, headers = {}) => fetch(url + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });

  await t.test('API works without a key and returns only allowlisted public projections', async () => {
    for (const path of ['/api/health', '/api/state', '/api/test/snapshot', '/api/test/logs']) {
      const response = await fetch(url + path);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const text = await response.text();
      for (const forbidden of ['SERVER_ONLY', 'PRIVATE_', '987654', 'UNRELEASED', 'enemyTroops', 'privatePerspective', 'cause']) {
        assert.ok(!text.includes(forbidden), `${path}: ${forbidden}`);
      }
    }
    for (const path of ['/api/test/internal-snapshot', '/server/world.ts', '/.env', '/artifacts/m0-internal-snapshot.json']) {
      assert.equal((await fetch(url + path)).status, 404);
    }
  });

  await t.test('valid actions update only the server clock; reset restores exact fixture', async () => {
    const initial = engine.internalSnapshot();
    assert.equal((await post('/api/test/action', { type: 'advance-clock', milliseconds: 5000 })).status, 200);
    assert.equal(engine.view().clock.activeMs, 5000);
    const before = engine.internalSnapshot().world;
    const probe = await post('/api/test/action', { type: 'mock-probe', text: '공격하지 마' });
    assert.equal(probe.status, 200);
    assert.equal((await probe.json()).result.provider, 'mock');
    assert.deepEqual({ ...engine.internalSnapshot().world, revision: before.revision }, before);
    assert.equal((await post('/api/test/reset', {})).status, 200);
    assert.deepEqual(engine.internalSnapshot(), initial);
  });

  await t.test('malformed and unsupported requests cannot overwrite the world', async () => {
    const before = engine.internalSnapshot();
    for (const body of [null, [], {}, { type: 'advance-clock', milliseconds: -1 },
      { type: 'advance-clock', milliseconds: 3.5 }, { type: 'advance-clock', milliseconds: 60_001 },
      { type: 'set-pause', reason: 'unknown', paused: true }, { type: 'set-pause', reason: 'manual', paused: 'true' },
      { type: 'mock-probe', text: ' ' }, { type: 'mock-probe', text: 'a'.repeat(2001) },
      { type: 'advance-clock', milliseconds: 5000, resources: { grain: 0 } },
      { type: 'execute-command', text: '수군을 정비해' }]) {
      assert.equal((await post('/api/test/action', body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await post('/api/test/reset', { world: {} })).status, 400);
    assert.equal((await post('/api/test/action', { type: 'mock-probe', text: 'a'.repeat(20_000) })).status, 413);
    assert.equal((await fetch(url + '/api/test/action', { method: 'POST', body: '{}' })).status, 415);
    assert.equal((await fetch(url + '/api/test/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
    assert.deepEqual(engine.internalSnapshot(), before);
  });

  await t.test('foreign origins and hosts are denied before mutation', async () => {
    const before = engine.internalSnapshot();
    assert.equal((await post('/api/test/reset', {}, { Origin: 'https://untrusted.example' })).status, 403);
    assert.equal((await post('/api/test/reset', {}, { Origin: 'null' })).status, 403);
    // fetch/Undici may rewrite Host; use a raw HTTP request to exercise the actual boundary.
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(url + '/api/state', { headers: { Host: 'untrusted.example' } }, response => {
        response.resume();
        response.once('end', () => resolve(response.statusCode));
      });
      request.once('error', reject);
      request.end();
    });
    assert.equal(status, 403);
    assert.deepEqual(engine.internalSnapshot(), before);
  });
});

test('HTTP provider failure exposes neither exception details nor partial state changes', async t => {
  const engine = new GameEngine({ mode: 'mock', respond() { throw new Error('PRIVATE_KEY_SENTINEL'); } });
  const server = createGameServer(engine);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const before = engine.internalSnapshot();
  const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/test/action`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'mock-probe', text: '실패' }),
  });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'INTERNAL_ERROR' });
  assert.deepEqual(engine.internalSnapshot(), before);
});
