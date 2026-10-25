import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GameEngine } from '../server/engine.ts';
import { Opening } from '../server/opening.ts';
import { PAUSE_REASONS } from '../shared/contracts.ts';
import { characterInput } from '../server/characters.ts';
import { ScriptedProvider } from './fixtures/scripted-provider.ts';

const make = () => new GameEngine(undefined, undefined, undefined, 15000, undefined, { mode: 'manual' });
const advance = (g: ReturnType<typeof make>, ms: number) => { while (ms > 0) { const step = Math.min(ms, 60000); g.dispatch({ type: 'advance-clock', milliseconds: step }); ms -= step; } };
const ids = (g: ReturnType<typeof make>) => g.logs().filter(l => l.kind === 'opening-event').map(l => l.summary.split(' · ')[0]);
function order(g: ReturnType<typeof make>, text = '주유에게 수군을 정비하라고 전해. 먼저 공격하지는 마.') {
  const r = g.command({ type: 'submit', text }); assert.equal(r.outcome.kind, 'draft');
  if (r.outcome.kind !== 'draft') throw new Error('draft required');
  return { type: 'confirm' as const, draftId: r.outcome.draftId, version: r.outcome.version };
}

test('M5 ordered content receipts, independent audiences and once-only delivery', () => {
  const g = make();
  assert.deepEqual(g.view().knowledge.documents.map(d => d.id), ['D-supply', 'D-courier']);
  assert.deepEqual(g.view().audience.requested, []);
  advance(g, 24999); assert.ok(!ids(g).includes('T02'));
  advance(g, 1); const news = g.view().knowledge.documents.find(d => d.id === 'D-jingzhou')!;
  assert.equal(news.observedAtMs, null); assert.equal(news.arrivedAtMs, 25000);
  assert.ok(!g.internalSnapshot().world.documents.find(d => d.id === 'D-jingzhou')!.readers.includes('zhang-zhao'));
  advance(g, 10000);
  assert.ok(g.internalSnapshot().world.documents.find(d => d.id === 'D-jingzhou')!.readers.includes('zhang-zhao'));
  advance(g, 30000);
  assert.deepEqual(g.view().audience.requested, ['zhang-zhao', 'zhou-yu']);
  assert.deepEqual(ids(g), ['T01','T02','T03','T04','T05','T06','T07']);
  const times = g.logs().filter(l => l.kind === 'opening-event').map(l => l.atActiveMs);
  assert.deepEqual(times, [0,25000,40000,45000,50000,60000,65000]);
  advance(g, 60000); assert.equal(ids(g).filter(id => id === 'T02').length, 1);
});

test('M5 every pause reason holds event time; release crosses boundary exactly', () => {
  for (const reason of PAUSE_REASONS) {
    const g = make(); advance(g, 24999);
    g.dispatch({ type: 'set-pause', reason, paused: true }); advance(g, 60000);
    assert.equal(g.view().clock.activeMs, 24999, reason); assert.ok(!ids(g).includes('T02'));
    g.dispatch({ type: 'set-pause', reason, paused: false }); advance(g, 1);
    assert.equal(g.view().clock.activeMs, 25000); assert.ok(ids(g).includes('T02'));
  }
});

test('M5 auto wall time starts after ready, supports manual mode and overlapping holds', () => {
  const g = new GameEngine(undefined, undefined, undefined, 15000, undefined, { mode: 'auto', ready: false });
  g.tick(1000); g.tick(61000); assert.equal(g.view().clock.activeMs, 0);
  g.dispatch({ type: 'opening-ready' }); g.tick(62000); g.tick(86999); assert.equal(g.view().clock.activeMs, 24999);
  g.dispatch({ type: 'set-pause', reason: 'typing', paused: true }); g.tick(146999);
  g.dispatch({ type: 'set-pause', reason: 'background', paused: true });
  g.dispatch({ type: 'set-pause', reason: 'typing', paused: false }); g.tick(206999); assert.equal(g.view().clock.activeMs, 24999);
  g.dispatch({ type: 'set-pause', reason: 'background', paused: false }); g.tick(207000); assert.ok(ids(g).includes('T02'));
  g.dispatch({ type: 'set-clock-mode', mode: 'manual' }); g.tick(208000); g.tick(268000); assert.equal(g.view().clock.activeMs, 25000);
});

test('M5 automatic driver accepts a zero origin and readiness also guards manual advances', () => {
  const g = new GameEngine(undefined, undefined, undefined, 15000, undefined, { mode: 'auto', ready: false });
  g.dispatch({ type: 'advance-clock', milliseconds: 25000 }); assert.equal(g.view().clock.activeMs, 0);
  g.dispatch({ type: 'opening-ready' }); g.tick(0); g.tick(25000);
  assert.equal(g.view().clock.activeMs, 25000); assert.ok(ids(g).includes('T02'));
});

test('M5 next event stops at delivery rather than completing all tasks', () => {
  const g = make(); const confirm = order(g); g.command(confirm);
  g.dispatch({ type: 'advance-next' }); assert.equal(g.view().clock.activeMs, 10000);
  assert.equal(g.view().tasks[0]!.stage, 'in-progress'); assert.equal(g.view().ledger.grain, 900);
  g.dispatch({ type: 'advance-next' }); assert.equal(g.view().clock.activeMs, 25000);
  assert.equal(g.view().tasks[0]!.stage, 'in-progress');
});

test('M5 accepted draft holds time server-side; cancel/confirm resumes; draft has no effects', () => {
  const g = make(); const confirm = order(g); advance(g, 60000);
  assert.equal(g.view().clock.activeMs, 0); assert.equal(g.view().tasks.length, 0);
  g.command({ type: 'cancel', draftId: confirm.draftId, version: confirm.version }); advance(g, 25000);
  assert.equal(g.view().clock.activeMs, 25000); assert.equal(g.view().ledger.grain, 1000);
});

test('M5 answered request cancels T11; late letter does not reopen it', () => {
  const g = make(); g.command(order(g, '조조에게 "논의 후 답하겠다"라고 회신해.')); advance(g, 10000);
  assert.equal(g.internalSnapshot().world.diplomacy.requests[0]!.status, 'answered');
  advance(g, 470000); assert.equal(g.internalSnapshot().opening!.statuses.T11, 'cancelled');
  assert.ok(!g.view().opening!.notices.some(n => n.eventId === 'T11'));
  assert.equal(g.internalSnapshot().world.diplomacy.requests[0]!.status, 'answered');
});

test('M5 hold extension moves T11 and emits exactly once at the current deadline', () => {
  const g = make(); advance(g, 70000);
  g.command(order(g, '조조에게는 당장 확답하지 말고 5분 이내 시간을 벌어.')); advance(g, 10000);
  assert.equal(g.internalSnapshot().world.diplomacy.requests[0]!.heldUntilMs, 370000);
  advance(g, 289999); assert.ok(!g.view().opening!.notices.some(n => n.eventId === 'T11'));
  advance(g, 1); assert.equal(g.view().opening!.notices.find(n => n.eventId === 'T11')!.atMs, 370000);
  advance(g, 600000); assert.equal(g.view().opening!.notices.filter(n => n.eventId === 'T11').length, 1);
});

test('M5 player first calls cancel stale requests; defer/decline never spawn repeated requests', () => {
  const g = make(); g.audience({ type: 'invite', participants: ['zhou-yu'] }); advance(g, 65000);
  assert.equal(g.internalSnapshot().opening!.statuses.T07, 'cancelled');
  assert.deepEqual(g.view().audience.requested, ['zhang-zhao']);
  g.audience({ type: 'defer', characterId: 'zhang-zhao' }); g.audience({ type: 'decline', characterId: 'zhang-zhao' });
  advance(g, 900000); assert.deepEqual(g.view().audience.requested, []);
});

test('M5 busy audience waits but dispatched report arrives with original observation', () => {
  const g = make(); advance(g, 55000); g.command(order(g)); advance(g, 10000);
  assert.equal(g.view().knowledge.documents.find(d => d.id === 'D-zhouyu')!.observedAtMs, 0);
  assert.ok(!g.view().audience.requested.includes('zhou-yu')); advance(g, 30000);
  assert.ok(g.view().audience.requested.includes('zhou-yu'));
});

test('M5 no decision remains playable beyond 15 minutes with only unresolved pressure', () => {
  const g = make(); advance(g, 960000);
  assert.equal(g.view().tasks.length, 0); assert.equal(g.view().clock.activeMs, 960000);
  assert.ok(g.view().opening!.notices.some(n => n.eventId === 'T11'));
  assert.ok(g.view().opening!.notices.some(n => n.eventId === 'T12'));
  assert.ok(!ids(g).includes('T13')); assert.ok(!ids(g).includes('T14'));
  assert.ok(!ids(g).includes('T09')); assert.ok(!ids(g).includes('T10'));
});

test('M5 help requires discussion; reading suppresses hint; early independent plan cancels lusu discovery', async () => {
  const g = make(); advance(g, 65000);
  await g.talk({ characterId: 'zhang-hong', text: '무엇을 살펴보면 좋을까?' });
  g.dispatch({ type: 'set-reading', reading: true }); advance(g, 65000); assert.ok(!ids(g).includes('T09'));
  g.dispatch({ type: 'set-reading', reading: false }); assert.ok(ids(g).includes('T09'));
  await g.talk({ characterId: 'zhang-hong', text: '다른 외교 의견을 들을 사람은 누구인가?' });
  advance(g, 50000); assert.ok(ids(g).includes('T10')); assert.ok(!g.view().audience.met.includes('lu-su'));
  const early = make(); early.command(order(early, '노숙은 유비에게 비밀리에 연락해. 참전은 약속하지 말고.')); advance(early, 240000);
  assert.equal(early.internalSnapshot().opening!.statuses.T10, 'cancelled');
});

test('M5 knowledge is acquired through receipt/share, all line requirements and room ACL checked', () => {
  const g = make(); advance(g, 65000); g.audience({ type: 'invite', participants: ['lu-su'] });
  let world = g.internalSnapshot().world;
  assert.ok(!characterInput(world, 'lu-su', '급보?', ['lu-su']).knowledge.documents.some(d => d.id === 'D-jingzhou'));
  const data = new Opening('manual'); assert.equal(data.line(world, 'lu-su', 'dispatch-question'), undefined);
  g.audience({ type: 'share', characterId: 'lu-su', documentId: 'D-jingzhou' }); world = g.internalSnapshot().world;
  assert.ok(characterInput(world, 'lu-su', '급보?', ['lu-su']).knowledge.documents.some(d => d.id === 'D-jingzhou'));
  g.audience({ type: 'share', characterId: 'lu-su', documentId: 'D-zhangzhao' });
  assert.ok(!g.internalSnapshot().world.documents.find(d => d.id === 'D-zhangzhao')!.readers.includes('lu-su'));
  for (const word of ['SERVER_ONLY', 'PRIVATE_', 'enemyTroops', 'initialHolders', 'eligibleReaders', 'requiredKnowledgeIds', 'prerequisites', 'statuses', '987654']) assert.ok(!JSON.stringify(g.publicSnapshot()).includes(word), word);
});

test('M5 reaction causality, observation gate and deterministic replay', () => {
  const run = () => {
    const g = make(); const ref = order(g); g.command(ref); g.command(ref); advance(g, 40000);
    assert.equal(g.view().tasks.length, 1); assert.equal(g.view().ledger.grain, 900); assert.equal(g.view().opening!.observed, false);
    const reactions = g.view().opening!.notices.filter(n => n.eventId === 'T13'); assert.equal(reactions.length, 2);
    for (const reaction of reactions) assert.ok(g.logs().some(l => l.id === reaction.sourceEventId && ['task-delivered','task-completed'].includes(l.kind)));
    g.dispatch({ type: 'observe-document', documentId: g.view().tasks[0]!.reportIds[0]! }); assert.equal(g.view().opening!.observed, false);
    g.dispatch({ type: 'observe-document', documentId: g.view().tasks[0]!.reportIds[1]! }); assert.equal(g.view().opening!.observed, true);
    g.dispatch({ type: 'observe-document', documentId: g.view().tasks[0]!.reportIds[1]! }); assert.equal(ids(g).filter(id => id === 'T14').length, 1);
    assert.ok(!g.view().opening!.notices.some(n => /노숙.*출발/.test(n.text)));
    return g.publicSnapshot();
  };
  assert.deepEqual(run(), run());
});

test('M5 provider waits hold automatic time and release on failure', async () => {
  let finish!: (v: unknown) => void;
  const p = new ScriptedProvider(() => new Promise(resolve => { finish = resolve; }));
  const g = new GameEngine(undefined, undefined, p, 15000, undefined, { mode: 'auto' });
  g.tick(1000); const pending = g.command({ type: 'submit', text: '항복하면 어떻게 돼?' });
  g.tick(61000); assert.equal(g.view().clock.activeMs, 0); assert.ok(g.view().clock.pauseReasons.includes('provider'));
  await new Promise(resolve => setImmediate(resolve));
  finish({ invalid: true }); await pending;
  assert.ok(!g.view().clock.pauseReasons.includes('provider')); g.tick(86000); assert.equal(g.view().clock.activeMs, 25000);
});

test('M5 command record is reconstructed and scoped to secret task for Provider exclusion', () => {
  const g = make(); g.command(order(g, '노숙은 유비에게 비밀리에 연락해. 참전은 약속하지 말고.'));
  const doc = g.view().knowledge.documents.find(d => d.id.startsWith('command-record-'))!;
  assert.ok(doc); assert.equal(doc.provenance, 'test-reconstruction'); assert.equal(doc.observedAtMs, 0);
  assert.ok(doc.claim.includes('아직 전달·완료를 뜻하지 않습니다'));
  assert.ok(doc.claim.includes('유비 측 의중·조건 타진'));
  assert.ok(!doc.claim.includes('sound-out'));
  const input = characterInput(g.internalSnapshot().world, 'zhang-hong', '보고?', ['zhang-hong']);
  assert.ok(!input.knowledge.documents.some(d => d.id === doc.id));
});
