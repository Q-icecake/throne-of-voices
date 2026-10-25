import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../server/engine.ts';
import { MockCommandInterpreter } from '../server/mock-interpreter.ts';
import { NAVAL_DRILL } from '../server/rules.ts';
import { MOCK_SAMPLE_SENTENCES } from '../shared/mock-samples.ts';
import type { CommandOutcome } from '../shared/contracts.ts';

const ORDER = '주유에게 수군을 정비하라고 전해. 먼저 공격하지는 마.';

function world(engine: GameEngine) { return engine.internalSnapshot().world; }
function draftOf(outcome: CommandOutcome) {
  assert.equal(outcome.kind, 'draft', JSON.stringify(outcome));
  return outcome as Extract<CommandOutcome, { kind: 'draft' }>;
}
function advance(engine: GameEngine, ms: number) {
  while (ms > 0) { const step = Math.min(ms, 60_000); engine.dispatch({ type: 'advance-clock', milliseconds: step }); ms -= step; }
}
function confirmOrder(engine: GameEngine, text = ORDER) {
  const draft = draftOf(engine.command({ type: 'submit', text }).outcome);
  const confirmed = engine.command({ type: 'confirm', draftId: draft.draftId, version: draft.version }).outcome;
  assert.equal(confirmed.kind, 'confirmed', JSON.stringify(confirmed));
  return { draft, confirmed: confirmed as Extract<CommandOutcome, { kind: 'confirmed' }> };
}
const material = (engine: GameEngine) => {
  const { resources, navy, tasks, ledger } = world(engine);
  return { resources, navy, tasks, ledger };
};

test('Mock interpreter classifies its documented sample sentences and never calls the network', () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('External network is forbidden'); };
  try {
    const interpreter = new MockCommandInterpreter();
    for (const sample of MOCK_SAMPLE_SENTENCES) assert.equal(interpreter.interpret(sample.text).intent, sample.intent, sample.text);
    const order = interpreter.interpret(ORDER);
    assert.ok(order.intent === 'command' && order.restrictions.includes('no-first-strike'));
    const plain = interpreter.interpret('수군을 정비하게 하라.');
    assert.ok(plain.intent === 'command' && plain.restrictions.length === 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('M1-F01 a draft that is never confirmed changes no task, readiness or grain, even as time passes', () => {
  const engine = new GameEngine();
  const before = material(engine);
  draftOf(engine.command({ type: 'submit', text: ORDER }).outcome);
  advance(engine, 120_000);
  assert.deepEqual(material(engine), before);
  assert.equal(engine.view().drafts[0]!.status, 'awaiting-confirmation');
});

test('M1-F02 confirming the same draft version twice yields one task and one grain spend', () => {
  const engine = new GameEngine();
  const { draft, confirmed } = confirmOrder(engine);
  const revision = world(engine).revision;
  const again = engine.command({ type: 'confirm', draftId: draft.draftId, version: draft.version }).outcome;
  assert.deepEqual(again, { ...confirmed, duplicate: true, reply: (again as typeof confirmed).reply });
  assert.equal(world(engine).revision, revision, 'duplicate confirm must not mutate state');
  advance(engine, 60_000);
  engine.command({ type: 'confirm', draftId: draft.draftId, version: draft.version });
  assert.equal(world(engine).tasks.length, 1);
  assert.equal(world(engine).resources.grain, 1000 - NAVAL_DRILL.grain);
});

test('M1-F03 revised or cancelled drafts cannot execute their earlier version', () => {
  const engine = new GameEngine();
  const draft = draftOf(engine.command({ type: 'submit', text: ORDER }).outcome);
  const revised = draftOf(engine.command({ type: 'revise', draftId: draft.draftId, version: 1, text: '수군을 정비하게 하라.' }).outcome);
  assert.equal(revised.version, 2);
  assert.deepEqual(engine.view().drafts[0]!.restrictions, []);
  const stale = engine.command({ type: 'confirm', draftId: draft.draftId, version: 1 }).outcome;
  assert.deepEqual(stale.kind === 'rejected' && stale.code, 'DRAFT_VERSION_OUTDATED');
  assert.equal(world(engine).tasks.length, 0);
  // A revision the Mock cannot read as a drill leaves the current version intact.
  const notCommand = engine.command({ type: 'revise', draftId: draft.draftId, version: 2, text: '정비하면 어떨까?' }).outcome;
  assert.deepEqual(notCommand.kind === 'rejected' && notCommand.code, 'REVISION_NOT_COMMAND');
  assert.equal(engine.view().drafts[0]!.version, 2);

  assert.equal(engine.command({ type: 'cancel', draftId: draft.draftId, version: 2 }).outcome.kind, 'cancelled');
  const afterCancel = engine.command({ type: 'confirm', draftId: draft.draftId, version: 2 }).outcome;
  assert.deepEqual(afterCancel.kind === 'rejected' && afterCancel.code, 'DRAFT_CANCELLED');
  advance(engine, 60_000);
  assert.equal(world(engine).tasks.length, 0);
  assert.equal(world(engine).resources.grain, 1000);
});

test('M1-F04 "do not strike first" survives into draft, task, policy and every report; no combat occurs', () => {
  const engine = new GameEngine();
  const { confirmed } = confirmOrder(engine);
  const view = engine.view();
  assert.deepEqual(view.drafts[0]!.restrictions.map(item => item.id), ['no-first-strike']);
  assert.deepEqual(view.tasks[0]!.restrictions.map(item => item.id), ['no-first-strike']);
  advance(engine, NAVAL_DRILL.deliveryMs + NAVAL_DRILL.workMs);
  const after = engine.view();
  assert.equal(world(engine).navy.engagementPolicy, 'no-first-strike');
  assert.equal(after.ledger.engagementPolicy, 'no-first-strike');
  const reports = after.knowledge.documents.filter(doc => doc.taskId === confirmed.taskId);
  assert.equal(reports.length, 2);
  for (const report of reports) {
    assert.match(report.claim, /먼저 공격하지 않음|선제공격 금지/);
    assert.match(report.claim, /교전은 (포함하지 않습니다|일어나지 않았습니다)/);
  }
  // Without the restriction, policy is left as it was.
  const plain = new GameEngine();
  confirmOrder(plain, '수군을 정비하게 하라.');
  advance(plain, NAVAL_DRILL.deliveryMs + NAVAL_DRILL.workMs);
  assert.equal(world(plain).navy.engagementPolicy, 'hold');
});

test('M1-F05 questions, hypotheticals and unsupported orders execute nothing but keep the original text and reason', () => {
  const engine = new GameEngine();
  const before = material(engine);
  for (const text of ['항복하면 어떻게 돼?', '수군을 정비하면 어떨까', '주유에게 조조군을 공격하라고 해.', '토지를 재분배하라']) {
    const outcome = engine.command({ type: 'submit', text }).outcome;
    assert.equal(outcome.kind, 'answer', text);
    assert.ok(outcome.kind === 'answer' && outcome.reason.length > 0);
  }
  assert.deepEqual(material(engine), before);
  assert.equal(world(engine).drafts.length, 0);
  const logs = engine.logs().filter(log => log.kind === 'command-submit');
  assert.equal(logs.length, 4);
  assert.ok(logs.some(log => log.summary.includes('토지를 재분배하라') && log.summary.includes('미지원')));
  assert.ok(logs.some(log => log.summary.includes('공격하라고') && log.summary.includes('미지원')));
});

test('M1-F06 confirming a stale second draft is re-checked against current state and refused with a reason', () => {
  const engine = new GameEngine();
  const first = draftOf(engine.command({ type: 'submit', text: ORDER }).outcome);
  const second = draftOf(engine.command({ type: 'submit', text: '수군을 정비하게 하라.' }).outcome);
  assert.equal(engine.command({ type: 'confirm', draftId: first.draftId, version: 1 }).outcome.kind, 'confirmed');
  const conflict = engine.command({ type: 'confirm', draftId: second.draftId, version: 1 }).outcome;
  assert.deepEqual(conflict.kind === 'rejected' && conflict.code, 'TASK_CONFLICT');
  assert.ok(conflict.reply.length > 0);
  const secondView = engine.view().drafts.find(draft => draft.id === second.draftId)!;
  assert.equal(secondView.status, 'rejected');
  assert.ok(secondView.statusNote);
  assert.equal(world(engine).tasks.length, 1);
  // Once the first drill completes, a fresh order is accepted again.
  advance(engine, NAVAL_DRILL.deliveryMs + NAVAL_DRILL.workMs);
  confirmOrder(engine);
  assert.equal(world(engine).tasks.length, 2);
});

test('M1-F07 the fake clock drives delivery, a single spend, completion and matching reports', () => {
  const engine = new GameEngine();
  engine.dispatch({ type: 'advance-clock', milliseconds: 5000 });
  const { confirmed } = confirmOrder(engine);
  const task = () => world(engine).tasks[0]!;
  assert.equal(task().registeredAtMs, 5000);
  assert.equal(world(engine).resources.grain, 1000, 'no spend at confirmation');

  advance(engine, NAVAL_DRILL.deliveryMs - 1);
  assert.equal(task().stage, 'delivering');
  assert.equal(world(engine).resources.grain, 1000);

  advance(engine, 1);
  assert.equal(task().stage, 'in-progress');
  assert.equal(task().deliveredAtMs, 5000 + NAVAL_DRILL.deliveryMs);
  assert.equal(world(engine).resources.grain, 900);
  assert.equal(world(engine).navy.readiness, 20);

  advance(engine, NAVAL_DRILL.workMs);
  assert.equal(task().stage, 'completed');
  assert.equal(world(engine).navy.readiness, 20 + NAVAL_DRILL.readinessGain);
  advance(engine, 60_000);
  assert.equal(world(engine).resources.grain, 900, 'spent exactly once');
  assert.equal(world(engine).navy.readiness, 35, 'applied exactly once');

  const view = engine.view();
  assert.deepEqual(view.tasks[0]!.reportIds, ['report-0001', 'report-0002']);
  assert.deepEqual(view.ledger, { recordedAtMs: 5000 + NAVAL_DRILL.deliveryMs + NAVAL_DRILL.workMs, source: '장부 · report-0002',
    navalReadiness: 35, grain: 900, engagementPolicy: 'no-first-strike' });
  const [started, done] = view.knowledge.documents.filter(doc => doc.taskId === confirmed.taskId);
  assert.match(started!.claim, /1000 → 900/);
  assert.match(done!.claim, /20 → 35/);

  // One large step crossing both thresholds processes them in order at their exact times.
  const jump = new GameEngine();
  confirmOrder(jump);
  jump.dispatch({ type: 'advance-clock', milliseconds: 60_000 });
  const jumped = jump.internalSnapshot();
  assert.equal(jumped.world.tasks[0]!.stage, 'completed');
  assert.deepEqual(jumped.events.filter(event => event.kind.startsWith('task-')).map(event => event.atActiveMs),
    [NAVAL_DRILL.deliveryMs, NAVAL_DRILL.deliveryMs + NAVAL_DRILL.workMs]);
  // Paused time does not progress the task.
  const paused = new GameEngine();
  confirmOrder(paused);
  paused.dispatch({ type: 'set-pause', reason: 'manual', paused: true });
  advance(paused, 120_000);
  assert.equal(world(paused).tasks[0]!.stage, 'delivering');
});

test('M1-F08 reset then the same inputs and clock reproduce the exact internal snapshot', () => {
  const script = (engine: GameEngine) => {
    engine.command({ type: 'submit', text: '항복하면 어떻게 돼?' });
    const draft = draftOf(engine.command({ type: 'submit', text: ORDER }).outcome);
    engine.dispatch({ type: 'advance-clock', milliseconds: 3000 });
    engine.command({ type: 'confirm', draftId: draft.draftId, version: 1 });
    engine.command({ type: 'confirm', draftId: draft.draftId, version: 1 });
    advance(engine, 45_000);
  };
  const a = new GameEngine();
  const initial = a.internalSnapshot();
  script(a);
  const firstRun = a.internalSnapshot();
  a.reset();
  assert.deepEqual(a.internalSnapshot(), initial);
  script(a);
  assert.deepEqual(a.internalSnapshot(), firstRun);
  const b = new GameEngine();
  script(b);
  assert.deepEqual(b.internalSnapshot(), firstRun);
});

test('M1-U07 player views of the full command flow carry no hidden state', () => {
  const engine = new GameEngine();
  confirmOrder(engine);
  advance(engine, 60_000);
  const serialized = JSON.stringify(engine.publicSnapshot());
  for (const forbidden of ['SERVER_ONLY', 'PRIVATE_', '987654', 'UNRELEASED', 'readers', 'enemyTroops', 'resources',
    'available', 'cause', 'grainSpentEventId', 'confirmedVersion', 'counters', 'privatePerspective']) {
    assert.ok(!serialized.includes(forbidden), forbidden);
  }
});

test('interpreter failure during submit leaves state and logs unchanged', () => {
  const engine = new GameEngine(undefined, { mode: 'mock', interpret() { throw new Error('Test failure'); } });
  const before = engine.internalSnapshot();
  assert.throws(() => engine.command({ type: 'submit', text: ORDER }));
  assert.deepEqual(engine.internalSnapshot(), before);
});
