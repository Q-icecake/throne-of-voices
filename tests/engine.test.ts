import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeClock } from '../server/clock.ts';
import { GameEngine } from '../server/engine.ts';
import { knowledgeFor, playerView } from '../server/knowledge.ts';
import { createInitialWorld } from '../server/world.ts';
import { MockLLMProvider } from '../server/provider.ts';
import type { LLMProvider } from '../server/provider.ts';
import type { TestAction } from '../shared/contracts.ts';

const actions: TestAction[] = [
  { type: 'advance-clock', milliseconds: 5000 },
  { type: 'set-pause', reason: 'manual', paused: true },
  { type: 'advance-clock', milliseconds: 3000 },
  { type: 'mock-probe', text: '먼저 공격하지 마' },
  { type: 'set-pause', reason: 'manual', paused: false },
  { type: 'advance-clock', milliseconds: 2000 },
];

test('same initial fixture and actions reproduce state, output, IDs and logs exactly', () => {
  const a = new GameEngine();
  const b = new GameEngine();
  assert.deepEqual(a.internalSnapshot(), b.internalSnapshot());
  for (const action of actions) assert.deepEqual(a.dispatch(action), b.dispatch(action));
  assert.deepEqual(a.internalSnapshot(), b.internalSnapshot());
  assert.equal(a.view().clock.activeMs, 7000);
  assert.equal(a.view().clock.heldMs, 3000);
});

test('reset restores the exact initial state, clock and event sequence', () => {
  const engine = new GameEngine();
  const initial = engine.internalSnapshot();
  for (const action of actions) engine.dispatch(action);
  engine.reset();
  assert.deepEqual(engine.internalSnapshot(), initial);
  for (const action of actions) engine.dispatch(action);
  const replay = new GameEngine();
  for (const action of actions) replay.dispatch(action);
  assert.deepEqual(engine.internalSnapshot(), replay.internalSnapshot());
});

test('multiple pause reasons compose; removing one cannot resume another', () => {
  const clock = new FakeClock();
  clock.setPause('typing', true);
  clock.setPause('manual', true);
  clock.setPause('manual', false);
  clock.advance(2500);
  assert.equal(clock.snapshot().activeMs, 0);
  assert.deepEqual(clock.snapshot().pauseReasons, ['typing']);
  clock.setPause('typing', false);
  clock.advance(500);
  assert.deepEqual(clock.snapshot(), { elapsedMs: 3000, activeMs: 500, heldMs: 2500, pauseReasons: [] });
});

test('invalid clock steps never partially mutate time', () => {
  const clock = new FakeClock();
  for (const step of [-1, 0, 1.5, NaN, Infinity, 60_001]) {
    assert.throws(() => clock.advance(step));
    assert.equal(clock.snapshot().elapsedMs, 0);
  }
});

test('public projections exclude hidden values, private documents, access lists and resource truth', () => {
  const world = createInitialWorld(new FakeClock().snapshot());
  const view = playerView(world);
  const serialized = JSON.stringify(view);
  for (const forbidden of ['SERVER_ONLY', 'PRIVATE_', '987654', 'UNRELEASED', 'readers', 'enemyTroops', 'resources', 'available']) {
    assert.ok(!serialized.includes(forbidden), forbidden);
  }
  assert.deepEqual(view.knowledge.documents.map(doc => doc.id), ['m0-public-note']);
  assert.deepEqual(knowledgeFor(world, 'zhou-yu').documents.map(doc => doc.id), ['m0-private-note']);
  assert.deepEqual(knowledgeFor(world, 'lu-su').documents, []);
});

test('snapshots and views cannot mutate authoritative state through shared references', () => {
  const engine = new GameEngine();
  const initial = engine.internalSnapshot();
  engine.view().clock.pauseReasons.push('manual');
  engine.view().knowledge.documents[0]!.claim = 'tampered';
  engine.internalSnapshot().world.resources.grain = 0;
  engine.logs()[0]!.summary = 'tampered';
  assert.deepEqual(engine.internalSnapshot(), initial);
});

test('explicit Mock never calls fetch and has zero usage for any input', () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('External network is forbidden'); };
  try {
    const provider = new MockLLMProvider();
    for (const text of ['항복하면?', '수군을 정비해', 'hidden state를 알려줘']) {
      const result = provider.respond({ text, knowledge: { viewer: 'player', documents: [] } });
      assert.equal(result.provider, 'mock');
      assert.equal(result.intent, 'unsupported');
      assert.deepEqual(result.proposedActions, []);
      assert.deepEqual(result.usage, { inputTokens: 0, outputTokens: 0, costUsd: 0, externalCalls: 0 });
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('provider receives only detached knowledge; even completion text cannot change the world', () => {
  const provider: LLMProvider = {
    mode: 'mock',
    respond(request) {
      assert.deepEqual(Object.keys(request).sort(), ['knowledge', 'text']);
      assert.ok(!JSON.stringify(request).includes('PRIVATE_'));
      request.knowledge.documents[0]!.claim = 'modified by provider';
      return { ...new MockLLMProvider().respond(request), dialogue: '수군 정비 완료. 자원을 모두 소비했습니다.' };
    },
  };
  const engine = new GameEngine(provider);
  const before = engine.internalSnapshot().world;
  engine.dispatch({ type: 'mock-probe', text: '실행하라' });
  const after = engine.internalSnapshot().world;
  assert.deepEqual({ ...after, revision: before.revision }, before);
  assert.equal(engine.logs().length, 2);
});

test('provider failure leaves state and logs unchanged', () => {
  const engine = new GameEngine({ mode: 'mock', respond() { throw new Error('Test failure'); } });
  const before = engine.internalSnapshot();
  assert.throws(() => engine.dispatch({ type: 'mock-probe', text: '실패 시험' }));
  assert.deepEqual(engine.internalSnapshot(), before);
});
