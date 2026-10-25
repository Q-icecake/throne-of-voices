import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { GameEngine } from '../server/engine.ts';
import { ScriptedProvider } from '../tests/fixtures/scripted-provider.ts';
import { PAUSE_REASONS } from '../shared/contracts.ts';

// UI operations in the design JSON are mapped explicitly, never parsed as commands.
// Command text itself is passed unchanged to the existing Mock interpreter.
const source = JSON.parse(readFileSync(new URL('../content/opening/test-scenarios.json', import.meta.url), 'utf8')) as {
  scenarios: { id: string; title: string; steps: { input: { kind: string; text: string } }[] }[];
};
const make = () => new GameEngine(undefined, undefined, undefined, 15000, undefined, { mode: 'manual' });
type Game = ReturnType<typeof make>;
function until(g: Game, target: number) {
  while (g.view().clock.activeMs < target) {
    assert.equal(g.view().clock.pauseReasons.length, 0, 'unexpected held clock');
    g.dispatch({ type: 'advance-clock', milliseconds: Math.min(60000, target - g.view().clock.activeMs) });
  }
}
function submit(g: Game, text: string, confirm = true, duplicate = false) {
  const r = g.command({ type: 'submit', text });
  assert.equal(r.outcome.kind, 'draft', text);
  if (r.outcome.kind !== 'draft') throw new Error('expected draft');
  const ref = { type: 'confirm' as const, draftId: r.outcome.draftId, version: r.outcome.version };
  if (confirm) { assert.equal(g.command(ref).outcome.kind, 'confirmed'); if (duplicate) { const twice = g.command(ref); assert.ok(twice.outcome.kind === 'confirmed' && twice.outcome.duplicate); } }
  return ref;
}
function observe(g: Game) {
  const doc = g.view().knowledge.documents.filter(d => d.taskId).at(-1);
  assert.ok(doc); g.dispatch({ type: 'observe-document', documentId: doc.id });
}
const has = (g: Game, id: string) => g.view().opening!.notices.some(n => n.eventId === id);
const commandText = (id: string) => source.scenarios.find(s => s.id === id)!.steps.find(s => s.input.kind !== '조작' && /수군|연락|회신|시간을 벌어/.test(s.input.text))!.input.text;
const results: unknown[] = [];
for (const scenario of source.scenarios) {
  const g = make();
  switch (scenario.id) {
    case 'S01': {
      until(g, 65000); g.audience({ type: 'invite', participants: ['zhang-zhao'] }); g.audience({ type: 'dismiss', characterId: 'zhang-zhao' });
      g.audience({ type: 'invite', participants: ['zhou-yu'] }); until(g, 75000);
      g.audience({ type: 'invite', participants: ['zhang-zhao','zhou-yu'] }); assert.ok(has(g, 'T08'));
      until(g, 80000); g.audience({ type: 'invite', participants: ['lu-su'] }); until(g, 90000);
      submit(g, commandText('S01')); until(g, 150000); observe(g);
      assert.equal(g.view().tasks.length, 3); assert.equal(g.view().ledger.grain, 880); assert.ok(has(g, 'T14')); break;
    }
    case 'S02':
      until(g, 5000); g.audience({ type: 'invite', participants: ['zhou-yu'] });
      until(g, 10000); await g.talk({ characterId: 'zhou-yu', text: '무엇을 준비해야 하나?' });
      g.audience({ type: 'dismiss', characterId: 'zhou-yu' }); until(g, 70000);
      submit(g, commandText('S02')); until(g, 110000); observe(g);
      assert.equal(g.internalSnapshot().opening!.statuses.T07, 'cancelled'); assert.ok(has(g, 'T14')); break;
    case 'S03':
      until(g, 10000); submit(g, commandText('S03')); until(g, 15000); assert.equal(g.view().tasks[0]!.stage, 'preparing');
      until(g, 25000); assert.equal(g.view().tasks[0]!.stage, 'travelling'); observe(g);
      until(g, 240000); assert.ok(!has(g, 'T10')); assert.ok(has(g, 'T14')); break;
    case 'S04':
      until(g, 80000); submit(g, commandText('S04')); until(g, 120000); observe(g); until(g, 240000);
      assert.ok(!g.view().audience.met.includes('lu-su')); assert.ok(!has(g, 'T08')); assert.ok(!g.view().tasks.some(t => t.action === 'sound-out')); assert.ok(has(g, 'T14')); break;
    case 'S05':
      until(g, 960000); assert.ok(has(g, 'T11')); assert.ok(has(g, 'T12')); assert.equal(g.view().tasks.length, 0); assert.ok(!has(g, 'T14')); break;
    case 'S06':
      until(g, 70000); submit(g, commandText('S06')); until(g, 80000); observe(g); until(g, 480000);
      assert.equal(g.internalSnapshot().world.diplomacy.requests[0]!.status, 'answered'); assert.ok(!has(g, 'T11')); assert.equal(g.internalSnapshot().opening!.statuses.T11, 'cancelled'); break;
    case 'S07': {
      const replay = (game: Game) => { until(game, 80000); submit(game, commandText('S07'), true, true); until(game, 120000); observe(game); return game.publicSnapshot(); };
      const first = replay(g); g.reset(); const second = replay(g); assert.deepEqual(first, second); assert.equal(g.view().ledger.grain, 900); break;
    }
    case 'S08':
      until(g, 70000); g.dispatch({ type: 'observe-document', documentId: 'D-jingzhou' });
      g.audience({ type: 'invite', participants: ['lu-su'] });
      assert.ok(!g.internalSnapshot().world.documents.find(d => d.id === 'D-jingzhou')!.readers.includes('lu-su'));
      g.audience({ type: 'share', characterId: 'lu-su', documentId: 'D-jingzhou' });
      await g.talk({ characterId: 'lu-su', text: '이 급보에서 확실히 알 수 있는 것은 무엇인가?' });
      g.audience({ type: 'share', characterId: 'lu-su', documentId: 'D-zhangzhao' });
      assert.ok(!g.internalSnapshot().world.documents.find(d => d.id === 'D-zhangzhao')!.readers.includes('lu-su')); break;
    case 'S09':
      until(g, 70000); g.audience({ type: 'defer', characterId: 'zhang-zhao' });
      assert.deepEqual(g.view().audience.requested, ['zhou-yu','zhang-zhao']); until(g, 310000);
      assert.equal(g.view().opening!.notices.filter(n => n.eventId === 'T05').length, 1);
      g.audience({ type: 'invite', participants: ['zhou-yu'] }); assert.deepEqual(g.view().audience.participants, ['zhou-yu']); break;
    case 'S10':
      until(g, 70000); submit(g, commandText('S10')); until(g, 80000); observe(g); until(g, 369999); assert.ok(!has(g, 'T11'));
      until(g, 370000); assert.ok(has(g, 'T11')); until(g, 480000); assert.equal(g.view().opening!.notices.filter(n => n.eventId === 'T11').length, 1); break;
    case 'S11':
      until(g, 24999);
      for (const reason of PAUSE_REASONS) { g.dispatch({ type: 'set-pause', reason, paused: true }); g.dispatch({ type: 'advance-clock', milliseconds: 60000 }); assert.equal(g.view().clock.activeMs, 24999); g.dispatch({ type: 'set-pause', reason, paused: false }); }
      until(g, 70000); await g.talk({ characterId: 'zhang-hong', text: '판단할 자료가 부족한데 무엇부터 살펴볼까?' });
      until(g, 130000); assert.ok(has(g, 'T09')); until(g, 180000);
      await g.talk({ characterId: 'zhang-hong', text: '다른 외교 의견을 들을 사람은 누구인가?' }); assert.ok(has(g, 'T10')); break;
    case 'S12': {
      until(g, 70000); const ref = submit(g, commandText('S12'), false); assert.equal(g.view().tasks.length, 0);
      g.command({ type: 'cancel', draftId: ref.draftId, version: ref.version }); until(g, 240000);
      assert.equal(g.view().tasks.length, 0); assert.equal(g.view().ledger.grain, 1000); assert.ok(!has(g, 'T13')); break;
    }
    default: throw new Error(`Missing adapter: ${scenario.id}`);
  }
  const snapshot = g.publicSnapshot();
  for (const word of ['SERVER_ONLY','PRIVATE_','987654','enemyTroops','initialHolders','requiredKnowledgeIds']) assert.ok(!JSON.stringify(snapshot).includes(word));
  const logs = g.logs().filter(l => l.kind === 'opening-event');
  assert.ok(logs.every((l,i) => i === 0 || l.atActiveMs >= logs[i-1]!.atActiveMs));
  results.push({ id: scenario.id, title: scenario.title, passed: true, activeMs: g.view().clock.activeMs, eventLog: logs, notices: g.view().opening!.notices });
  console.log(`${scenario.id}: PASS ${scenario.title}`);
}
// ScriptedProvider verifies a general dialogue through the same M4 async path; no external calls.
const provider = new ScriptedProvider({ intent: 'question', dialogue: '확인된 자료를 살펴보겠습니다.', proposedActions: [], unresolvedQuestions: [], referencedKnowledgeIds: [], usage: { inputTokens: 0, outputTokens: 0, externalCalls: 0, costUsd: 0 } });
const scripted = new GameEngine(undefined, undefined, provider, 15000, undefined, { mode: 'manual' });
const answer = await scripted.talk({ characterId: 'zhang-hong', text: '무엇부터 살펴볼까?' });
assert.equal(answer.source, 'AI'); assert.equal(scripted.view().tasks.length, 0);
await mkdir('artifacts/m5', { recursive: true });
await writeFile('artifacts/m5/playthrough.json', JSON.stringify({ passed: results.length, provider: 'Mock + offline ScriptedProvider', externalCalls: 0, scenarios: results }, null, 2));
console.log(`${results.length}/12 scenarios passed; ScriptedProvider dialogue passed; external calls 0`);
