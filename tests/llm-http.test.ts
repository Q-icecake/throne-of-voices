import { listenForFetch } from '../scripts/test-server.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { GameEngine } from '../server/engine.ts';
import { createGameServer } from '../server/http.ts';
import { ScriptedProvider } from './fixtures/scripted-provider.ts';
import type { CommandResponse } from '../shared/contracts.ts';

test('M2 HTTP awaits provider and preserves Korean errors/input without exception disclosure', async t => {
  const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    assert.match(String(input), /^http:\/\/127\.0\.0\.1:\d+\/api\//, 'only local test API is allowed');
    return originalFetch(input, init);
  });
  const provider = new ScriptedProvider({ intent: 'question', dialogue: '받은 보고를 확인해 주십시오.', proposedActions: [],
    unresolvedQuestions: [], referencedKnowledgeIds: [], usage: { inputTokens: 0, outputTokens: 0, externalCalls: 0, costUsd: null } },
  new Error('PRIVATE_PROVIDER_HEADER'), () => new Promise(() => {}));
  const engine = new GameEngine(undefined, undefined, provider, 20);
  const server = createGameServer(engine);
  await listenForFetch(server);
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/command`;
  const post = async () => {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'submit', text: '수군 상태는?' }) });
    assert.equal(response.status, 200);
    return await response.json() as CommandResponse;
  };
  assert.equal((await post()).outcome.kind, 'answer');
  const before = engine.internalSnapshot();
  for (const code of ['PROVIDER_ERROR', 'PROVIDER_TIMEOUT']) {
    const response = await post();
    assert.ok(response.outcome.kind === 'error' && response.outcome.code === code && response.outcome.input === '수군 상태는?');
    assert.ok(!JSON.stringify(response).includes('PRIVATE_PROVIDER_HEADER'));
    assert.equal(response.state.interpretation?.source, 'AI');
    assert.deepEqual(engine.internalSnapshot(), before);
  }
});
