import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { GameEngine } from '../../server/engine.ts';
import { characterInput } from '../../server/characters.ts';
import { PAUSE_REASONS } from '../../shared/contracts.ts';
import type { CharacterId } from '../../shared/contracts.ts';
import { ScriptedProvider } from '../../tests/fixtures/scripted-provider.ts';

interface Step { atActiveMs: number; input: { kind: string; text: string }; expected: string; eventIds: string[]; documentIds: string[] }
interface Scenario { id: string; title: string; steps: Step[]; expectedEventOrder: string[]; forbidden: string[]; boundaryIds: string[] }
export const source = JSON.parse(readFileSync(new URL('../../content/opening/test-scenarios.json', import.meta.url), 'utf8')) as { scenarios: Scenario[]; boundaryChecks: { id: string }[] };
// Pin human prose to the reviewed adapter. If UI instructions or expectations
// change, revise the corresponding adapter before updating this static manifest.
const contracts = JSON.parse(readFileSync(new URL('./adapter-contracts.json', import.meta.url), 'utf8')) as Record<string, { steps: string[]; forbidden: string[] }>;
export const make = () => new GameEngine(undefined, undefined, undefined, 15000, undefined, { mode: 'manual' });
type Game = ReturnType<typeof make>;
export function until(g: Game, target: number) {
  while (g.view().clock.activeMs < target) {
    assert.equal(g.view().clock.pauseReasons.length, 0, 'unexpected held clock');
    g.dispatch({ type: 'advance-clock', milliseconds: Math.min(60000, target - g.view().clock.activeMs) });
  }
}
const has = (g: Game, id: string) => g.view().opening!.notices.some(n => n.eventId === id);
const noEvents = (g: Game, ...ids: string[]) => ids.forEach(id => assert.ok(!has(g, id), `forbidden event ${id}`));
const noContact = (g: Game) => assert.ok(!g.view().tasks.some(t => t.action === 'sound-out'));
const noTasks = (g: Game) => assert.equal(g.view().tasks.length, 0);
const unique = (items: unknown[]) => assert.equal(new Set(items).size, items.length);
const observe = (g: Game) => {
  const doc = g.view().knowledge.documents.filter(d => d.taskId).at(-1); assert.ok(doc);
  g.dispatch({ type: 'observe-document', documentId: doc.id }); assert.ok(has(g, 'T14'));
};
const originalDocs = JSON.parse(readFileSync(new URL('../../content/opening/documents.json', import.meta.url), 'utf8')).documents as { id: string; observedAt: { activeMs: number | null } }[];
export function boundaries(g: Game) {
  const world = g.internalSnapshot().world;
  // PB01/PB03: production per-person Provider projections, not fabricated views.
  for (const payload of [g.publicSnapshot(), ...world.characters.map(c => characterInput(world, c.id, '현재 상황?', [c.id]))])
    for (const word of ['SERVER_ONLY', 'PRIVATE_', '987654', 'enemyTroops', 'initialHolders', 'requiredKnowledgeIds']) assert.ok(!JSON.stringify(payload).includes(word), word);
  for (const c of world.characters) for (const d of characterInput(world, c.id, '현재 상황?', [c.id]).knowledge.documents) {
    assert.ok(world.documents.find(doc => doc.id === d.id)!.readers.includes(c.id)); // PB02
    assert.ok(!world.tasks.find(t => t.id === d.taskId)?.plan.conditions.includes('secret')); // PB03
  }
  assert.equal(world.resources.grain, 1000 - world.tasks.reduce((sum, t) => sum + t.grainSpent, 0)); // PB04
  unique(world.tasks.map(t => t.id)); unique(world.documents.map(d => d.id)); unique(world.audience.requested);
  for (const n of g.view().opening!.notices.filter(n => n.eventId === 'T13'))
    assert.ok(g.logs().some(l => l.id === n.sourceEventId && ['task-delivered', 'task-progress', 'task-completed', 'command-recall'].includes(l.kind)));
  for (const d of g.view().knowledge.documents) { // PB05: preserve source observation time.
    const fixture = originalDocs.find(item => item.id === d.id); if (fixture) assert.equal(d.observedAtMs, fixture.observedAt.activeMs);
  }
  unique(g.view().opening!.notices.map(n => n.id)); // PB06
}

// UI operations are explicit adapters. Natural-language commands/dialogue use
// the unchanged JSON input through the real engine; they are not parsed here.
function adapters(g: Game, s: Scenario): (() => void | Promise<void>)[] {
  let ref: { type: 'confirm'; draftId: string; version: number };
  const submit = (i: number, count = 1) => () => {
    const before = g.internalSnapshot().world, text = s.steps[i]!.input.text;
    const r = g.command({ type: 'submit', text });
    assert.equal(r.outcome.kind, 'draft'); if (r.outcome.kind !== 'draft') throw new Error('draft required');
    ref = { type: 'confirm', draftId: r.outcome.draftId, version: r.outcome.version };
    const draft = g.view().drafts.at(-1)!;
    assert.equal(draft.actions.length, count); assert.deepEqual(g.internalSnapshot().world.tasks, before.tasks);
    assert.equal(g.internalSnapshot().world.resources.grain, before.resources.grain);
    for (const [pattern, condition] of [[/먼저 공격/, 'no-first-strike'], [/비밀/, 'secret'], [/참전.*약속/, 'no-war-promise']] as const)
      if (pattern.test(text)) assert.ok(JSON.stringify(draft).includes(condition));
  };
  const confirm = () => { assert.equal(g.command(ref).outcome.kind, 'confirmed'); };
  const invite = (...participants: CharacterId[]) => { g.audience({ type: 'invite', participants }); assert.deepEqual(g.view().audience.participants, participants); };
  const talk = (i: number, characterId: CharacterId) => async () => { const r = await g.talk({ characterId, text: s.steps[i]!.input.text }); assert.ok(r.turns.length >= 2); noTasks(g); };
  const init = () => { assert.deepEqual(g.view().knowledge.documents.map(d => d.id), ['D-supply', 'D-courier']); noTasks(g); };
  const idle = () => {};
  const complete = () => { observe(g); assert.ok(g.view().tasks.every(t => t.stage === 'completed')); };
  const map: Record<string, (() => void | Promise<void>)[]> = {
    S01: [init, () => assert.deepEqual(g.view().audience.requested, ['zhang-zhao', 'zhou-yu']), () => {
      invite('zhang-zhao'); g.audience({ type: 'dismiss', characterId: 'zhang-zhao' }); invite('zhou-yu');
    }, () => invite('zhang-zhao', 'zhou-yu'), () => { invite('lu-su'); noTasks(g); }, submit(5, 3), () => { confirm(); assert.equal(g.view().tasks.length, 3); }, () => { complete(); assert.equal(g.view().ledger.grain, 880); }],
    S02: [init, () => { invite('zhou-yu'); assert.ok(!g.view().knowledge.documents.some(d => d.id === 'D-zhouyu')); }, talk(2, 'zhou-yu'), () => {
      g.audience({ type: 'dismiss', characterId: 'zhou-yu' }); assert.equal(g.internalSnapshot().opening!.statuses.T07, 'cancelled');
    }, submit(4), confirm, complete],
    S03: [init, submit(1), () => { confirm(); assert.equal(g.view().tasks[0]!.stage, 'delivering'); }, () => assert.equal(g.view().tasks[0]!.stage, 'preparing'), () => {
      assert.equal(g.view().tasks[0]!.stage, 'travelling'); observe(g);
    }, () => assert.equal(g.view().tasks[0]!.stage, 'completed'), () => noEvents(g, 'T09', 'T10')],
    S04: [init, idle, submit(2), confirm, complete, () => { noContact(g); assert.ok(!g.view().audience.met.includes('lu-su')); }],
    S05: [init, idle, () => noEvents(g, 'T09', 'T10'), idle, () => { noTasks(g); assert.equal(g.view().ledger.grain, 1000); }],
    S06: [init, idle, submit(2), () => {
      confirm(); until(g, 80000); complete(); assert.equal(g.internalSnapshot().world.diplomacy.requests[0]!.status, 'answered');
    }, () => assert.equal(g.internalSnapshot().opening!.statuses.T11, 'cancelled'), () => {
      assert.ok(!g.view().opening!.notices.find(n => n.eventId === 'T12')?.text.includes('조조'));
    }],
    S07: [init, idle, submit(2), () => { confirm(); const twice = g.command(ref); assert.ok(twice.outcome.kind === 'confirmed' && twice.outcome.duplicate); assert.equal(g.view().tasks.length, 1); }, complete, () => {
      const before = g.internalSnapshot(); g.reset(); const replay = adapters(g, s);
      for (let i = 0; i < 5; i++) { until(g, s.steps[i]!.atActiveMs); replay[i]!(); }
      assert.deepEqual(g.internalSnapshot(), before);
    }],
    S08: [init, idle, () => { g.dispatch({ type: 'observe-document', documentId: 'D-jingzhou' }); }, async () => {
      invite('lu-su'); assert.ok(!g.internalSnapshot().world.documents.find(d => d.id === 'D-jingzhou')!.readers.includes('lu-su'));
      await g.talk({ characterId: 'lu-su', text: '형주 급보는?' });
      assert.ok(!characterInput(g.internalSnapshot().world, 'lu-su', '급보?', ['lu-su']).knowledge.documents.some(d => d.id === 'D-jingzhou'));
    }, () => { g.audience({ type: 'share', characterId: 'lu-su', documentId: 'D-jingzhou' }); assert.ok(g.internalSnapshot().world.documents.find(d => d.id === 'D-jingzhou')!.readers.includes('lu-su')); }, talk(5, 'lu-su'), () => {
      g.audience({ type: 'share', characterId: 'lu-su', documentId: 'D-zhangzhao' }); assert.ok(!g.internalSnapshot().world.documents.find(d => d.id === 'D-zhangzhao')!.readers.includes('lu-su'));
    }],
    S09: [init, idle, () => { g.audience({ type: 'defer', characterId: 'zhang-zhao' }); assert.deepEqual(g.view().audience.requested, ['zhou-yu', 'zhang-zhao']); }, () => noTasks(g), () => invite('zhou-yu')],
    S10: [init, idle, submit(2), () => { confirm(); until(g, 80000); complete(); assert.equal(g.internalSnapshot().world.diplomacy.requests[0]!.heldUntilMs, 370000); }, () => noEvents(g, 'T11'), () => noEvents(g, 'T11'), () => assert.equal(g.view().opening!.notices.find(n => n.eventId === 'T11')!.atMs, 370000), idle],
    S11: [init, () => {
      for (const reason of PAUSE_REASONS) { const elapsed = g.view().clock.elapsedMs; g.dispatch({ type: 'set-pause', reason, paused: true }); g.dispatch({ type: 'advance-clock', milliseconds: 60000 }); assert.equal(g.view().clock.activeMs, 24999); assert.equal(g.view().clock.elapsedMs, elapsed + 60000); g.dispatch({ type: 'set-pause', reason, paused: false }); }
    }, idle, idle, talk(4, 'zhang-hong'), idle, talk(6, 'zhang-hong')],
    S12: [init, idle, submit(2), () => { noTasks(g); g.command({ type: 'cancel', draftId: ref.draftId, version: ref.version }); assert.equal(g.view().drafts[0]!.status, 'cancelled'); }, () => { noTasks(g); assert.equal(g.view().ledger.grain, 1000); }],
  };
  assert.ok(map[s.id], `Missing scenario adapter ${s.id}`); return map[s.id]!;
}

function forbidden(g: Game): Record<string, (() => void)[]> {
  const noAlliance = () => assert.ok(!g.internalSnapshot().world.diplomacy.messages.some(m => /동맹.*(?:확정|수락)|참전.*약속합니다/.test(m.text)));
  const one = (id: string) => assert.ok(g.view().opening!.notices.filter(n => n.eventId === id).length <= 1);
  const noSpend = () => assert.equal(g.internalSnapshot().world.resources.grain, 1000);
  return {
    S01: [() => noEvents(g, 'T09', 'T10'), () => boundaries(g), noAlliance],
    S02: [() => noEvents(g, 'T07'), () => assert.ok(g.view().audience.met.includes('zhou-yu')), () => noContact(g)],
    S03: [() => assert.equal(g.internalSnapshot().world.tasks[0]!.departedAtMs, 25000), () => assert.equal(g.view().tasks[0]!.registeredAtMs, 10000), () => { noEvents(g, 'T10'); assert.ok(!g.view().audience.met.includes('lu-su')); }, () => boundaries(g)],
    S04: [() => noEvents(g, 'T08', 'T10'), () => noContact(g), () => assert.equal(g.view().clock.activeMs, 240000)],
    S05: [() => noEvents(g, 'T08', 'T09', 'T10'), () => noEvents(g, 'T13', 'T14'), () => { noSpend(); noContact(g); assert.equal(g.view().clock.activeMs, 900000); }, () => one('T11')],
    S06: [() => noEvents(g, 'T11'), () => assert.equal(g.internalSnapshot().world.diplomacy.requests[0]!.status, 'answered'), () => assert.ok(!g.view().opening!.notices.find(n => n.eventId === 'T12')?.text.includes('조조')), noAlliance],
    S07: [() => { assert.equal(g.view().tasks.length, 1); assert.equal(g.view().ledger.grain, 900); }, () => boundaries(g), () => boundaries(g)],
    S08: [() => assert.equal(g.logs().filter(l => l.kind === 'document-shared').length, 1), () => assert.ok(!g.internalSnapshot().world.documents.find(d => d.id === 'D-zhangzhao')!.readers.includes('lu-su')), () => noTasks(g)],
    S09: [() => { one('T05'); one('T07'); }, () => noTasks(g), () => assert.ok(g.view().audience.met.includes('zhou-yu')), () => assert.ok(!g.view().audience.met.includes('zhang-zhao'))],
    S10: [() => assert.equal(g.view().opening!.notices.find(n => n.eventId === 'T11')!.atMs, 370000), () => assert.equal(g.internalSnapshot().world.diplomacy.requests[0]!.status, 'held'), () => one('T11')],
    S11: [() => assert.equal(g.view().opening!.notices.find(n => n.eventId === 'T02')!.atMs, 25000), () => { noTasks(g); assert.deepEqual(g.view().audience.participants, ['zhang-hong']); }, () => { one('T09'); one('T10'); }, () => boundaries(g)],
    S12: [() => noEvents(g, 'T13', 'T14'), () => noContact(g), noSpend, () => noTasks(g)],
  };
}

export async function runScenarios(input = source) {
  assert.equal(new Set(input.scenarios.map(s => s.id)).size, input.scenarios.length);
  assert.deepEqual(input.boundaryChecks.map(b => b.id).sort(), ['PB01', 'PB02', 'PB03', 'PB04', 'PB05', 'PB06']);
  const results = [];
  for (const s of input.scenarios) {
    const g = make(), steps = adapters(g, s), evidence = [];
    assert.equal(steps.length, s.steps.length, `${s.id}: unexecuted JSON step`);
    for (const [i, step] of s.steps.entries()) {
      assert.equal(createHash('sha256').update(JSON.stringify({ input: step.input, expected: step.expected })).digest('hex'), contracts[s.id]!.steps[i], `${s.id}:${i} changed prose requires adapter review`);
      until(g, step.atActiveMs); await steps[i]!(); boundaries(g);
      for (const id of step.eventIds) assert.ok(has(g, id), `${s.id}:${i} missing ${id}`);
      for (const id of step.documentIds) assert.ok(g.view().knowledge.documents.some(d => d.id === id), `${s.id}:${i} missing ${id}`);
      evidence.push({ index: i, input: step.input, expected: step.expected, eventIds: step.eventIds, activeMs: g.view().clock.activeMs, passed: true });
    }
    const firstEvents = [...new Set(g.view().opening!.notices.map(n => n.eventId))].filter(id => s.expectedEventOrder.includes(id));
    assert.deepEqual(firstEvents, s.expectedEventOrder, `${s.id}: JSON expected event order`);
    const checks = forbidden(g)[s.id]!;
    assert.deepEqual(s.forbidden, contracts[s.id]!.forbidden, `${s.id}: unmapped forbidden text`);
    assert.equal(checks.length, s.forbidden.length, `${s.id}: unmapped forbidden rule`); checks.forEach(fn => fn());
    for (const id of s.boundaryIds) assert.ok(input.boundaryChecks.some(b => b.id === id), `unknown ${id}`);
    results.push({ id: s.id, title: s.title, passed: true, steps: evidence, forbidden: s.forbidden, boundaryIds: s.boundaryIds, notices: g.view().opening!.notices });
    console.log(`${s.id}: PASS ${steps.length} steps / ${checks.length} forbidden rules`);
  }
  assert.deepEqual(input.scenarios.map(s => s.id).sort(), Array.from({ length: 12 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`));
  const provider = new ScriptedProvider({ intent: 'question', dialogue: '확인된 자료를 살펴보겠습니다.', proposedActions: [], unresolvedQuestions: [], referencedKnowledgeIds: [], usage: { inputTokens: 0, outputTokens: 0, externalCalls: 0, costUsd: 0 } });
  const scripted = new GameEngine(undefined, undefined, provider, 15000, undefined, { mode: 'manual' });
  assert.equal((await scripted.talk({ characterId: 'zhang-hong', text: '무엇부터 살펴볼까?' })).source, 'AI'); assert.equal(scripted.view().tasks.length, 0);
  return results;
}
