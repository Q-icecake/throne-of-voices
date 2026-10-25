import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../server/engine.ts';
import { Opening } from '../server/opening.ts';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createGameServer } from '../server/http.ts';
import { ScriptedProvider } from './fixtures/scripted-provider.ts';
import { runSoak } from '../scripts/quality/soak.ts';
import { runScenarios, source } from '../scripts/quality/scenarios.ts';

const make = () => new GameEngine(undefined, undefined, undefined, 15000, undefined, { mode: 'manual' });
const advance = (g: ReturnType<typeof make>, ms: number) => {
  while (ms > 0) { const step = Math.min(ms, 60000); g.dispatch({ type: 'advance-clock', milliseconds: step }); ms -= step; }
};

test('M6 R2b defer before request cannot create requests; both scheduled queues and pressure stay unique', () => {
  for (const person of ['zhang-zhao', 'zhou-yu'] as const) {
    const g = make();
    g.audience({ type: 'decline', characterId: person });
    assert.deepEqual(g.view().audience.requested, [], 'pre-request decline only removes a current request');
    for (let i = 0; i < 3; i++) g.audience({ type: 'defer', characterId: person });
    assert.deepEqual(g.view().audience.requested, [], 'an absent request cannot be deferred');
    advance(g, 65000);
    assert.deepEqual(g.view().audience.requested, ['zhang-zhao', 'zhou-yu']);
    for (let i = 0; i < 3; i++) g.audience({ type: 'defer', characterId: person });
    assert.equal(g.view().audience.requested.length, 2);
    advance(g, 415000);
    const summary = g.view().opening!.notices.find(n => n.eventId === 'T12')!.text;
    assert.equal(summary.split('장조 접견 요청').length - 1, 1);
    assert.equal(summary.split('주유 접견 요청').length - 1, 1);
    g.audience({ type: 'decline', characterId: person }); advance(g, 480000);
    assert.ok(!g.view().audience.requested.includes(person));
  }
});

test('M6 R2b opening request delivery is idempotent even with an existing queue entry', () => {
  const world = make().internalSnapshot().world;
  const opening = new Opening('manual'); opening.initialize(world);
  world.audience.requested = ['zhang-zhao', 'zhou-yu'];
  for (const at of [25000, 35000, 45000, 65000]) { world.clock.activeMs = at; opening.evaluate(world, () => {}); }
  assert.deepEqual(world.audience.requested, ['zhang-zhao', 'zhou-yu']);
  assert.equal(opening.statuses.T05, 'fired'); assert.equal(opening.statuses.T07, 'fired');
});

test('M6 15-minute active soak: 12 reset cycles, four variants, stable idle collections, still playable', () => {
  assert.equal(runSoak().length, 12);
});

test('M6 JSON scenario contract executes every step and rejects unknown scenarios, steps, events and forbidden rules', async () => {
  assert.equal((await runScenarios()).length, 12);
  for (const mutation of ['scenario', 'step', 'event', 'forbidden', 'forbidden-text', 'expected-text'] as const) {
    const changed = structuredClone(source);
    if (mutation === 'scenario') changed.scenarios.push({ ...changed.scenarios[0]!, id: 'S99' });
    if (mutation === 'step') changed.scenarios[0]!.steps.push(changed.scenarios[0]!.steps[0]!);
    if (mutation === 'event') changed.scenarios[0]!.steps[0]!.eventIds.push('T99');
    if (mutation === 'forbidden') changed.scenarios[0]!.forbidden.push('unknown prohibition');
    if (mutation === 'forbidden-text') changed.scenarios[0]!.forbidden[0] = 'changed prohibition';
    if (mutation === 'expected-text') changed.scenarios[0]!.steps[0]!.expected = 'unmapped expectation';
    await assert.rejects(runScenarios(changed));
  }
});

test('M6 mode transitions discard old wall origin and reset restores readiness and pauses', () => {
  const g = new GameEngine(undefined, undefined, undefined, 15000, undefined, { mode: 'auto', ready: false });
  g.tick(0); g.tick(900000); assert.equal(g.view().clock.activeMs, 0);
  g.dispatch({ type: 'opening-ready' }); g.tick(900000); g.tick(924999);
  g.dispatch({ type: 'set-clock-mode', mode: 'manual' }); g.tick(9999999);
  assert.equal(g.view().clock.activeMs, 24999);
  g.dispatch({ type: 'set-clock-mode', mode: 'auto' }); g.tick(10000000); assert.equal(g.view().clock.activeMs, 24999);
  g.tick(10000001); assert.equal(g.view().clock.activeMs, 25000);
  g.dispatch({ type: 'set-pause', reason: 'manual', paused: true }); g.reset();
  assert.equal(g.view().clock.activeMs, 0); assert.deepEqual(g.view().clock.pauseReasons, []);
  g.tick(20000000); g.tick(21000000); assert.equal(g.view().clock.activeMs, 0);
});

for (const operation of ['command', 'talk'] as const) test(`M6 delayed ${operation} after reset and new pending request cannot release the new provider hold`, async () => {
  let oldRelease!: (value: unknown) => void, newRelease!: (value: unknown) => void;
  const answer = { intent: 'question', dialogue: '확인된 자료를 보겠습니다.', proposedActions: [], unresolvedQuestions: [], referencedKnowledgeIds: [], usage: { inputTokens: 0, outputTokens: 0, externalCalls: 0, costUsd: 0 } };
  const provider = new ScriptedProvider(() => new Promise(r => { oldRelease = r; }), () => new Promise(r => { newRelease = r; }));
  const g = new GameEngine(undefined, undefined, provider, 15000, undefined, { mode: 'auto' });
  const send = () => operation === 'command' ? g.command({ type: 'submit', text: '항복하면 어떻게 돼?' }) : g.talk({ characterId: 'zhang-hong', text: '견해는?' });
  const old = send(); await new Promise(r => setImmediate(r)); g.reset();
  const current = send(); await new Promise(r => setImmediate(r));
  oldRelease(answer); await old;
  assert.ok(g.view().clock.pauseReasons.includes('provider')); assert.equal(g.view().conversation.length, 0);
  g.tick(0); g.tick(60000); assert.equal(g.view().clock.activeMs, 0);
  newRelease(answer); await current; assert.ok(!g.view().clock.pauseReasons.includes('provider'));
  assert.equal(g.view().tasks.length, 0); g.tick(85000); assert.equal(g.view().clock.activeMs, 25000);
});

test('M6 HTTP server restart creates a fresh in-memory opening; reset clears tasks, requests and observed state', async () => {
  for (let cycle = 0; cycle < 2; cycle++) {
    const server = createGameServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = async (path: string, body: unknown) => { const r = await fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); assert.equal(r.status, 200); return r.json(); };
    try {
      const initial = await (await fetch(url + '/api/state')).json();
      assert.equal(initial.clock.activeMs, 0); assert.deepEqual(initial.audience.requested, []); assert.match(initial.interpretation.status, /Mock/i);
      await post('/api/test/action', { type: 'set-clock-mode', mode: 'manual' });
      await post('/api/test/action', { type: 'opening-ready' });
      await post('/api/test/action', { type: 'advance-clock', milliseconds: 60000 });
      await post('/api/test/action', { type: 'advance-clock', milliseconds: 5000 });
      const deferred = await post('/api/audience', { type: 'defer', characterId: 'zhang-zhao' });
      assert.deepEqual(deferred.state.audience.requested, ['zhou-yu', 'zhang-zhao']);
      await post('/api/test/reset', {});
      const reset = await (await fetch(url + '/api/state')).json();
      assert.equal(reset.clock.activeMs, 0); assert.deepEqual(reset.tasks, []); assert.deepEqual(reset.audience.requested, []); assert.equal(reset.opening.observed, false);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  }
});
