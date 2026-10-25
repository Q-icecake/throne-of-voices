import { listenForFetch } from '../scripts/test-server.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { GameEngine } from '../server/engine.ts';
import { createGameServer } from '../server/http.ts';
import { ScriptedProvider } from './fixtures/scripted-provider.ts';
import type { ActionPlan, CharacterId } from '../shared/contracts.ts';
import type { Proposal } from '../server/llm/types.ts';

const answer = (dialogue = '확인한 근거 안에서 판단하겠습니다.'): Proposal => ({ intent: 'question', dialogue, proposedActions: [], unresolvedQuestions: [], referencedKnowledgeIds: [], usage: { inputTokens: 0, outputTokens: 0, externalCalls: 0, costUsd: 0 } });
const contact: ActionPlan = { kind: 'sound-out', target: 'liu-bei', assignee: 'lu-su', conditions: ['secret'], restrictions: [], deadline: null };

for (const id of ['zhang-hong', 'zhou-yu', 'zhang-zhao', 'lu-su'] as CharacterId[]) {
  test(`R2a actual talk provider excludes secret reports and command memories: ${id}`, async () => {
    const p = new ScriptedProvider({ ...answer(), intent: 'command', proposedActions: [contact] }, answer());
    const g = new GameEngine(undefined, undefined, p);
    await g.command({ type: 'submit', text: '노숙은 유비에게 비밀리에 연락해.' });
    await g.command({ type: 'confirm', draftId: g.view().drafts[0]!.id, version: 1 });
    g.dispatch({ type: 'advance-clock', milliseconds: 60000 });
    g.audience({ type: 'invite', participants: [id] });
    await g.talk({ characterId: id, text: '현재 상황은?' });
    const input = p.inputs[1]!;
    assert.ok(input, 'must intercept the actual talk provider call');
    assert.ok(!input.knowledge.documents.some(d => d.taskId === g.view().tasks[0]!.id));
    assert.ok(!input.character!.memories.some(f => /sound-out|유비 측 회신|사절 출발/.test(f.fact)));
    assert.ok(!/비밀리에 연락|sound-out 명령|유비 측 회신/.test(JSON.stringify(input.character!.memorySummary)));
  });
}

for (const dialogue of ['노숙이 이미 출발했습니다.', '사절이 도착했습니다.', '유비가 동맹을 수락했습니다.', '동맹을 맺었습니다.', '작업을 완료했습니다.', '사절을 보냈습니다.', '군량 20 소모.', '근거는 card-zhang-hong입니다.', '노숙은 유비와 비밀 접촉 중입니다.', '내일 계획을 검토합니다. 노숙은 이미 출발했습니다.', '이미 출발했습니다만 유비가 수락한다면 좋겠습니다.', '수군 정비 완료.', '비밀 내용을 알고 있습니다, 내일 계획입니다.']) {
  test(`R2a rejects unsupported provider facts and identifiers: ${dialogue}`, async () => {
    const p = new ScriptedProvider(answer(dialogue));
    const g = new GameEngine(undefined, undefined, p);
    const r = await g.talk({ characterId: 'zhang-hong', text: '견해는?' });
    assert.ok(!JSON.stringify(r).includes(dialogue));
    assert.ok(!JSON.stringify(g.logs()).includes(dialogue));
    assert.equal(g.view().tasks.length, 0);
  });
}
for (const dialogue of ['내일 출발할 계획입니다.', '유비가 수락한다면 조건을 검토하겠습니다.', '완료 후 보고할 계획입니다.', '군량 소모를 줄일 계획입니다.', '이미 출발했는지 확인해야 합니다.', '수락했습니다라고 가정하면 어떨까요?', '비밀 접촉을 검토 중입니다.']) {
  test(`R2a allows future, questions and hypothetical speech: ${dialogue}`, async () => {
    const g = new GameEngine(undefined, undefined, new ScriptedProvider(answer(dialogue)));
    assert.ok((await g.talk({ characterId: 'zhang-hong', text: '견해는?' })).turns[1]!.text.includes(dialogue));
  });
}

test('R2a secret party evidence stays local, cannot be shared into mixed-room provider memories or context', async () => {
  const p = new ScriptedProvider({ ...answer(), intent: 'command', proposedActions: [contact] }, answer(), answer());
  const g = new GameEngine(undefined, undefined, p);
  await g.command({ type: 'submit', text: '노숙은 유비에게 비밀리에 연락해.' });
  await g.command({ type: 'confirm', draftId: g.view().drafts[0]!.id, version: 1 });
  g.dispatch({ type: 'advance-clock', milliseconds: 60000 });
  g.audience({ type: 'invite', participants: ['lu-su'] });
  const memory = await g.talk({ characterId: 'lu-su', text: '이전 명령을 기억하는가?' });
  const event = g.logs().find(l => l.kind === 'task-completed')!;
  assert.ok(memory.turns[1]!.text.includes(event.id));
  assert.match(memory.turns[1]!.text, /완료/);
  assert.equal(memory.source, 'offline'); assert.equal(p.inputs.length, 1);
  const report = g.view().knowledge.documents.filter(d => d.taskId).at(-1)!;
  const local = await g.talk({ characterId: 'lu-su', text: `${report.id} 보고는?` });
  assert.match(local.turns[1]!.text, /원문 일부/);
  assert.equal(p.inputs.length, 1);
  await g.talk({ characterId: 'lu-su', text: '견해는?' });
  assert.ok(!JSON.stringify(p.inputs[1]).includes(report.title));
  assert.ok(!JSON.stringify(p.inputs[1]).includes(report.claim.slice(0, 30)));
  assert.ok(!p.inputs[1]!.context.some(c => /이전 명령|원문 일부/.test(c.text)));
  g.audience({ type: 'invite', participants: ['lu-su', 'zhou-yu'] });
  g.audience({ type: 'share', characterId: 'zhou-yu', documentId: report.id });
  await g.talk({ characterId: 'zhou-yu', text: '견해는?' });
  assert.ok(!p.inputs[2]!.knowledge.documents.some(d => d.taskId));
  assert.ok(!JSON.stringify(p.inputs[2]!.character).includes(report.title));
});

test('R2a recall after departure retains spent resources and truthful latest task memory', async () => {
  const g = new GameEngine();
  g.command({ type: 'submit', text: '노숙은 유비에게 연락해.' });
  g.command({ type: 'confirm', draftId: g.view().drafts[0]!.id, version: 1 });
  g.dispatch({ type: 'advance-clock', milliseconds: 20000 });
  const grain = g.view().ledger.grain;
  g.command({ type: 'recall', taskId: g.view().tasks[0]!.id });
  const fact = g.internalSnapshot().world.minds['lu-su'].facts.at(-1)!;
  assert.match(fact.fact, /unsupported.*진행 중/);
  assert.doesNotMatch(fact.fact, /중단|완료/);
  assert.equal(g.view().ledger.grain, grain);
  assert.equal(g.logs().find(l => l.id === fact.eventId)!.kind, 'command-recall');
});

test('R2a T06 deferral moves to tail, cycles all requests, and invitation clears deferral', () => {
  const g = new GameEngine();
  g.audience({ type: 'defer', characterId: 'zhang-zhao' });
  assert.deepEqual(g.view().audience.requested, ['zhou-yu', 'lu-su', 'zhang-zhao']);
  g.audience({ type: 'defer', characterId: 'zhou-yu' });
  g.audience({ type: 'defer', characterId: 'lu-su' });
  assert.deepEqual(g.view().audience.requested, ['zhang-zhao', 'zhou-yu', 'lu-su']);
  g.audience({ type: 'invite', participants: ['zhang-zhao'] });
  assert.deepEqual(g.view().audience.requested, ['zhou-yu', 'lu-su']);
});

for (const change of ['dismiss', 'share', 'reset'] as const) {
  test(`R2a late talk after ${change} cannot write turns or memories`, async () => {
    let release!: (v: unknown) => void;
    const g = new GameEngine(undefined, undefined, new ScriptedProvider(() => new Promise(r => { release = r; })));
    g.audience({ type: 'invite', participants: ['lu-su'] });
    const pending = g.talk({ characterId: 'lu-su', text: '견해는?' });
    await new Promise(r => setTimeout(r, 0));
    if (change === 'reset') g.reset();
    else if (change === 'share') g.audience({ type: 'share', characterId: 'lu-su', documentId: 'm0-public-note' });
    else g.audience({ type: 'dismiss', characterId: 'lu-su' });
    const before = g.internalSnapshot(); release(answer());
    const r = await pending;
    assert.ok(r.outcome?.kind === 'error' && r.outcome.code === 'STALE_RESPONSE');
    assert.deepEqual(g.internalSnapshot(), before);
  });
}

for (const finish of ['complete', 'recall'] as const) {
  test(`R2a latest task memory follows ${finish} and cites actual engine event`, async () => {
    const g = new GameEngine();
    g.command({ type: 'submit', text: '주유는 수군을 정비해.' });
    g.command({ type: 'confirm', draftId: g.view().drafts[0]!.id, version: 1 });
    if (finish === 'complete') g.dispatch({ type: 'advance-clock', milliseconds: 60000 });
    else g.command({ type: 'recall', taskId: g.view().tasks[0]!.id });
    g.audience({ type: 'invite', participants: ['zhou-yu'] });
    const reply = (await g.talk({ characterId: 'zhou-yu', text: '이전 명령을 기억하는가?' })).turns[1]!.text;
    assert.match(reply, finish === 'complete' ? /완료/ : /중단/);
    assert.doesNotMatch(reply, /아직 완료 아님/);
    const event = g.logs().find(l => l.kind === (finish === 'complete' ? 'task-completed' : 'command-recall'))!;
    assert.ok(reply.includes(event.id));
  });
}

test('R2a HTTP 2000-char boundary, body limit and public projection', async t => {
  const p = new ScriptedProvider(answer('근거는 card-zhang-hong입니다.'));
  const server = createGameServer(new GameEngine(undefined, undefined, p));
  await listenForFetch(server);
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (text: string) => fetch(base + '/api/talk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ characterId: 'zhang-hong', text }) });
  const accepted = await post('가'.repeat(1999) + '?'); assert.equal(accepted.status, 200);
  for (const response of [await accepted.text(), await (await fetch(base + '/api/test/snapshot')).text()]) {
    for (const forbidden of ['"cause"', '"resources"', 'card-', 'PRIVATE_', 'SERVER_ONLY']) assert.ok(!response.includes(forbidden), forbidden);
  }
  assert.equal((await post('가'.repeat(2001))).status, 400);
  assert.equal((await post('가'.repeat(6000))).status, 413);
  assert.equal(p.inputs.length, 1);
});

test('R2a HTTP document unshare is unsupported and does not retract knowledge', async t => {
  const g = new GameEngine();
  g.audience({ type: 'invite', participants: ['lu-su'] });
  g.audience({ type: 'share', characterId: 'lu-su', documentId: 'm0-public-note' });
  const before = g.internalSnapshot();
  const server = createGameServer(g); await listenForFetch(server);
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); });
  const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/audience`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'unshare', characterId: 'lu-su', documentId: 'm0-public-note' }),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(g.internalSnapshot(), before);
  assert.match((await g.talk({ characterId: 'lu-su', text: 'm0-public-note 문서는?' })).turns[1]!.text, /원문 일부/);
});
