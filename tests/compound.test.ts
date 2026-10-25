import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../server/engine.ts';
import { knowledgeFor } from '../server/knowledge.ts';
import { ScriptedProvider } from './fixtures/scripted-provider.ts';
import { parseCommand } from '../server/http.ts';
import type { CommandOutcome } from '../shared/contracts.ts';

export const ORDER = '조조에게는 당장 확답하지 말고 시간을 벌어. 노숙은 유비에게 비밀리에 연락하고, 주유는 수군을 준비시키되 먼저 공격하지는 마.';
const withPromise = ORDER.replace('비밀리에 연락하고,', '비밀리에 연락하고 참전은 약속하지 말고,');
function draft(outcome: CommandOutcome) {
  assert.equal(outcome.kind, 'draft', JSON.stringify(outcome));
  return outcome as Extract<CommandOutcome, { kind: 'draft' }>;
}
function confirm(engine: GameEngine, text = ORDER, acceptPartial = false) {
  const d = draft(engine.command({ type: 'submit', text }).outcome);
  const r = engine.command({ type: 'confirm', draftId: d.draftId, version: d.version, acceptPartial });
  assert.equal(r.outcome.kind, 'confirmed', JSON.stringify(r.outcome));
  return d;
}
function advance(engine: GameEngine, ms: number) {
  while (ms > 0) { const step = Math.min(ms, 60000); engine.dispatch({ type: 'advance-clock', milliseconds: step }); ms -= step; }
}
const material = (e: GameEngine) => {
  const { diplomacy, resources, navy, tasks, ledger, documents } = e.internalSnapshot().world;
  return { diplomacy, resources, navy, tasks, ledger, documents };
};

test('M3 example has three actions, only source restrictions, no pre-confirm effects and idempotent execution', () => {
  const e = new GameEngine(), before = material(e);
  const d = draft(e.command({ type: 'submit', text: ORDER }).outcome);
  const actions = e.view().drafts[0]!.actions;
  assert.deepEqual(actions.map(a => a.action), ['hold-reply', 'sound-out', 'naval-drill']);
  assert.deepEqual(actions.map(a => a.restrictions.map(r => r.id)), [['no-firm-answer'], [], ['no-first-strike']]);
  assert.deepEqual(actions[1]!.conditions, ['secret']);
  advance(e, 120000);
  assert.deepEqual(material(e), before);
  const request = { type: 'confirm' as const, draftId: d.draftId, version: 1 };
  e.command(request);
  const snapshot = e.internalSnapshot();
  assert.equal(e.command(request).outcome.kind, 'confirmed');
  assert.deepEqual(e.internalSnapshot(), snapshot);
  assert.equal(e.view().tasks.length, 3);
  advance(e, 5000);
  assert.equal(e.view().tasks[1]!.stage, 'preparing');
  advance(e, 10000);
  assert.equal(e.view().tasks[1]!.stage, 'travelling');
  assert.equal(e.internalSnapshot().world.diplomacy.requests[0]!.status, 'held');
  advance(e, 15000);
  assert.equal(e.view().tasks[1]!.stage, 'awaiting-reply');
  assert.ok(!e.view().knowledge.documents.some(d => d.title === '유비 측 회신 도착'));
  advance(e, 30000);
  assert.ok(e.view().tasks.every(t => t.stage === 'completed'));
  assert.equal(e.view().ledger.grain, 880);
  assert.equal(e.view().ledger.navalReadiness, 35);
  assert.equal(e.view().ledger.engagementPolicy, 'no-first-strike');
  assert.equal(e.view().tasks[1]!.reportIds.length, 4);
  assert.match(e.view().knowledge.documents.at(-1)!.claim, /수락·동맹·참전 확약은 아직 없습니다/);
  const spent = e.internalSnapshot().world.tasks.map(t => t.grainSpentEventId);
  assert.equal(new Set(spent).size, 3);
  advance(e, 60000); e.command(request);
  assert.equal(e.view().ledger.grain, 880);
});

test('M3 ScriptedProvider uses the M2 pipeline, preserving all three proposals and limits', async () => {
  const proposedActions = [
    { kind: 'hold-reply', target: 'cao-cao-envoy', assignee: 'zhang-hong', conditions: [], restrictions: ['no-firm-answer'], deadline: null },
    { kind: 'sound-out', target: 'liu-bei', assignee: 'lu-su', conditions: ['secret'], restrictions: [], deadline: null },
    { kind: 'naval-drill', target: 'jiangdong-navy', assignee: 'zhou-yu', conditions: [], restrictions: ['no-first-strike'], deadline: null },
  ];
  const proposal = { intent: 'command', dialogue: '완료했다고 주장해도 실행되지 않습니다.', proposedActions,
    unresolvedQuestions: [], referencedKnowledgeIds: [], usage: { inputTokens: 0, outputTokens: 0, externalCalls: 0, costUsd: 0 } };
  const e = new GameEngine(undefined, undefined, new ScriptedProvider(proposal));
  const d = draft((await e.command({ type: 'submit', text: ORDER })).outcome);
  assert.equal(e.view().tasks.length, 0);
  assert.equal(e.view().drafts[0]!.actions.length, 3);
  assert.equal((await e.command({ type: 'confirm', draftId: d.draftId, version: 1 })).state.tasks.length, 3);
  const bad = structuredClone(proposal); bad.proposedActions[1]!.restrictions = ['no-war-promise'];
  const invented = new GameEngine(undefined, undefined, new ScriptedProvider(bad));
  assert.equal((await invented.command({ type: 'submit', text: ORDER })).outcome.kind, 'answer');
  assert.equal(invented.view().drafts.length, 0);
  const reordered = structuredClone(proposal);
  [reordered.proposedActions[0], reordered.proposedActions[1]] = [reordered.proposedActions[1]!, reordered.proposedActions[0]!];
  reordered.proposedActions[2]!.conditions = ['after:1'];
  const wrongDependency = new GameEngine(undefined, undefined, new ScriptedProvider(reordered));
  assert.equal((await wrongDependency.command({ type: 'submit', text: ORDER.replace('주유는 수군', '주유는 그 뒤 수군') })).outcome.kind, 'answer');
  assert.equal(wrongDependency.view().drafts.length, 0);
});

test('M3 secret contact and no-war-promise persist in messages and knowledge ACLs', () => {
  const e = new GameEngine(); confirm(e, withPromise); advance(e, 60000);
  const w = e.internalSnapshot().world;
  const task = w.tasks.find(t => t.action === 'sound-out')!;
  assert.deepEqual(task.restrictions, ['no-war-promise']);
  const message = w.diplomacy.messages.find(m => m.taskId === task.id)!;
  assert.match(message.text, /참전 약속 금지/);
  assert.ok(!message.recipients.includes('zhou-yu'));
  for (const viewer of ['zhou-yu', 'zhang-zhao'] as const) {
    const view = knowledgeFor(w, viewer);
    assert.ok(!view.documents.some(d => d.taskId === task.id));
    assert.ok(!JSON.stringify(view).includes('유비'));
  }
  assert.equal(knowledgeFor(w, 'lu-su').documents.filter(d => d.taskId === task.id).length, 4);
  for (const doc of w.documents.filter(d => d.taskId === task.id)) assert.match(doc.claim, /참전 약속 금지/);
  const pub = new GameEngine(); confirm(pub, '노숙은 유비에게 공개적으로 연락해.'); advance(pub, 60000);
  assert.ok(knowledgeFor(pub.internalSnapshot().world, 'zhou-yu').documents.some(d => d.taskId));
});

test('M3 partial support requires explicit scope confirmation; mixed unknowns never silently disappear', () => {
  for (const text of ['주유는 수군을 정비하고 정찰도 보내.', '주유는 수군을 정비해. 그 사람을 보내.', '조조에게 답변을 보류하고 토지를 재분배해.']) {
    const e = new GameEngine(); const d = draft(e.command({ type: 'submit', text }).outcome);
    assert.ok(e.view().drafts[0]!.unresolved.length);
    const request = { type: 'confirm' as const, draftId: d.draftId, version: 1 };
    const rejected = e.command(request).outcome;
    assert.ok(rejected.kind === 'rejected' && rejected.code === 'PARTIAL_CONFIRMATION_REQUIRED');
    assert.equal(e.view().tasks.length, 0);
    assert.equal(e.command({ ...request, acceptPartial: true }).state.tasks.length, 1);
  }
});

test('M3 early independent combinations, literal reply, and no automatic treaties', () => {
  for (const text of ['수군을 정비해.', '조조에게 답변을 잠시 미루어라.', '노숙은 유비에게 비밀리에 연락해.', '조조에게 답변을 보류해. 주유는 수군을 준비해.']) {
    const e = new GameEngine(); confirm(e, text); advance(e, 60000);
    assert.ok(e.view().tasks.every(t => t.stage === 'completed'));
  }
  const e = new GameEngine(); confirm(e, '조조에게 "논의 후 답하겠다"라고 회신해.'); advance(e, 10000);
  const request = e.internalSnapshot().world.diplomacy.requests[0]!;
  assert.equal(request.status, 'answered'); assert.match(request.message!, /논의 후 답하겠다/);
  assert.match(e.view().knowledge.documents.at(-1)!.claim, /조약은 성립하지 않았습니다/);
});

test('M3 revise/cancel, current actor conflicts, reserved grain and stale deadlines recheck atomically', () => {
  const e = new GameEngine(); const d = draft(e.command({ type: 'submit', text: ORDER }).outcome);
  e.command({ type: 'revise', draftId: d.draftId, version: 1, text: '조조에게 답변을 보류해.' });
  assert.equal(e.view().drafts[0]!.actions.length, 1);
  assert.equal(e.command({ type: 'confirm', draftId: d.draftId, version: 1 }).outcome.kind, 'rejected');
  e.command({ type: 'cancel', draftId: d.draftId, version: 2 });
  assert.equal(e.command({ type: 'confirm', draftId: d.draftId, version: 2 }).outcome.kind, 'rejected');
  const stale = draft(e.command({ type: 'submit', text: ORDER }).outcome);
  confirm(e, '노숙은 유비에게 연락해.');
  const conflict = e.command({ type: 'confirm', draftId: stale.draftId, version: 1 }).outcome;
  assert.ok(conflict.kind === 'rejected' && conflict.code === 'TASK_CONFLICT');
  assert.equal(e.view().tasks.length, 1);
  const poor = new GameEngine();
  for (let i = 0; i < 9; i++) { confirm(poor, '수군을 정비해.'); advance(poor, 40000); }
  const insufficient = draft(poor.command({ type: 'submit', text: ORDER }).outcome);
  const rejected = poor.command({ type: 'confirm', draftId: insufficient.draftId, version: 1 }).outcome;
  assert.ok(rejected.kind === 'rejected' && rejected.code === 'GRAIN_SHORT');
  confirm(poor, '수군을 정비해.');
  const reserved = draft(poor.command({ type: 'submit', text: '노숙은 유비에게 연락해.' }).outcome);
  const reserveRejected = poor.command({ type: 'confirm', draftId: reserved.draftId, version: 1 }).outcome;
  assert.ok(reserveRejected.kind === 'rejected' && reserveRejected.code === 'GRAIN_SHORT');
  const timed = new GameEngine();
  const td = draft(timed.command({ type: 'submit', text: '주유는 수군을 1분 이내 정비해.' }).outcome);
  advance(timed, 30000);
  const late = timed.command({ type: 'confirm', draftId: td.draftId, version: 1 }).outcome;
  assert.ok(late.kind === 'rejected' && late.code === 'DEADLINE_PASSED');
});

test('M3 ordering waits for prerequisite completion, and stopped prerequisites stop dependent work', () => {
  const text = '조조에게 답변을 보류해. 주유는 그 뒤 수군을 정비해.';
  const e = new GameEngine(); confirm(e, text);
  assert.equal(e.view().tasks[1]!.stage, 'waiting'); advance(e, 19000);
  assert.equal(e.view().tasks[1]!.stage, 'delivering'); advance(e, 31000);
  assert.equal(e.view().tasks[1]!.completedAtMs, 50000);
  const stopped = new GameEngine(); confirm(stopped, text);
  stopped.command({ type: 'recall', taskId: stopped.view().tasks[0]!.id }); advance(stopped, 60000);
  assert.ok(stopped.view().tasks.every(t => t.stage === 'stopped'));
  assert.equal(stopped.view().ledger.grain, 1000);
});

test('M3 recall preserves past spend, disclosures and departed missions; requests are idempotent', () => {
  for (const time of [0, 5000, 30000]) {
    const e = new GameEngine(); confirm(e, '노숙은 유비에게 공개적으로 연락해.'); if (time) advance(e, time);
    const before = e.internalSnapshot().world; const id = e.view().tasks[0]!.id;
    e.command({ type: 'recall', taskId: id });
    const once = e.internalSnapshot(); e.command({ type: 'recall', taskId: id });
    assert.deepEqual(e.internalSnapshot(), once);
    assert.deepEqual(once.world.resources, before.resources);
    assert.deepEqual(once.world.diplomacy, before.diplomacy);
    for (const doc of before.documents) assert.ok(once.world.documents.some(d => d.id === doc.id));
    advance(e, 60000);
    assert.equal(e.view().tasks[0]!.stage, time < 15000 ? 'stopped' : 'completed');
    assert.equal(e.view().tasks[0]!.recall?.status, time < 15000 ? 'stopped' : 'unsupported');
  }
});

test('M3 reproducible snapshots, public forbidden strings, strict partial/recall requests', () => {
  const run = () => { const e = new GameEngine(); confirm(e, withPromise); advance(e, 60000); return e; };
  assert.deepEqual(run().internalSnapshot(), run().internalSnapshot());
  const serialized = JSON.stringify(run().publicSnapshot());
  for (const forbidden of ['cause', 'resources', 'readers', 'PRIVATE_', 'SERVER_ONLY', 'confirmedVersion', 'grainSpentEventId']) assert.ok(!serialized.includes(forbidden), forbidden);
  assert.deepEqual(parseCommand({ type: 'recall', taskId: 'task-0001' }), { type: 'recall', taskId: 'task-0001' });
  assert.throws(() => parseCommand({ type: 'confirm', draftId: 'draft-0001', version: 1, acceptPartial: 'yes' }));
  assert.throws(() => parseCommand({ type: 'recall', taskId: 'bad', resources: {} }));
});

test('M3 explicit wrong actors, unknown conditions and overlong bundles never execute', () => {
  for (const text of ['노숙은 수군을 정비해.', '주유는 유비에게 연락해.', '장조에게 유비의 조건을 타진하게 해.',
    '노숙은 유비에게 비밀리에 연락하되 군량을 쓰지 마.', '노숙은 유비에게 연락해. 주유는 수군을 정비해. 조조에게 답변을 보류해. 노숙은 유비에게 연락해.']) {
    const e = new GameEngine(); const result = e.command({ type: 'submit', text });
    assert.equal(result.outcome.kind, 'answer', text);
    assert.equal(e.view().drafts.length, 0, text);
    assert.equal(e.view().tasks.length, 0, text);
  }
});
