import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { GameEngine } from '../server/engine.ts';
import { ScriptedProvider } from './fixtures/scripted-provider.ts';
import type { Proposal } from '../server/llm/types.ts';
import { INITIAL_FOCUS, reduceFocus } from '../client/src/ui/focus.ts';
import { Opening } from '../server/opening.ts';
import type { CharacterId } from '../shared/contracts.ts';

const answer = (dialogue: string, intent: 'question' | 'discussion' = 'question'): Proposal => ({
  intent, dialogue, proposedActions: [], unresolvedQuestions: [], referencedKnowledgeIds: [],
  usage: { inputTokens: 0, outputTokens: 0, externalCalls: 0, costUsd: 0 },
});

const falseClaims = [
  '유비와 동맹을 체결하였습니다.', '노숙이 유비에게 사절로 떠났습니다.', '유비와의 협상을 마무리했습니다.',
  '유비와 동맹을 체결했습니다.', '유비와 동맹을 체결하셨습니다.', '동맹 체결이 되었습니다.',
  '유비와의 협상을 끝냈습니다.', '유비와 합의하였습니다.', '동맹이 성사되었습니다.',
  '유비가 동맹을 수락하셨습니다.', '노숙이 사절을 보내셨습니다.', '노숙이 출발하셨습니다.',
  '수군 정비가 완료된 상태입니다.', '협상을 마무리한 상태입니다.', '유비와 협상 중입니다.',
  '내일 동맹을 체결할 수 있습니다. 이미 협상을 끝냈습니다.',
  '유비가 수락하면 좋겠습니다만 노숙은 이미 떠났습니다.',
  '유비와 합의를 하였습니다.', '유비와 체결을 완료하였습니다.',
  '유비와 합의가 이루어졌습니다.', '유비와 동맹이 맺어졌습니다.',
  '협상을 마무리 지었습니다.', '동맹이 체결된 것으로 확인되었습니다.',
  '비밀 내용을 알고 있습니다만 말씀드릴 수는 없습니다.',
];
for (const dialogue of falseClaims) test(`R3-01 rejects unsupported fact: ${dialogue}`, async () => {
  for (const intent of ['question', 'discussion'] as const) {
    const g = new GameEngine(undefined, undefined, new ScriptedProvider(answer(dialogue, intent), answer(dialogue, intent)));
    const before = g.internalSnapshot().world;
    const talk = await g.talk({ characterId: 'zhang-hong', text: '현재 외교 상황은?' });
    const command = await g.command({ type: 'submit', text: '현재 외교 상황은?' });
    assert.ok(!JSON.stringify(talk).includes(dialogue));
    assert.ok(!command.outcome.reply.includes(dialogue));
    assert.ok(!JSON.stringify(g.logs()).includes(dialogue));
    assert.ok(g.logs().some(log => /확인된 기록.*응답 대체/.test(log.summary)));
    const after = g.internalSnapshot().world;
    assert.deepEqual(after.tasks, before.tasks);
    assert.deepEqual(after.resources, before.resources);
    assert.deepEqual(after.diplomacy, before.diplomacy);
  }
});

const normal = [
  '동맹을 체결할 수 있습니다.', '유비와 합의하면 선택지가 늘어납니다.', '협상을 마무리하려면 조건을 살펴야 합니다.',
  '노숙이 내일 떠날 계획입니다.', '사절을 보낼 수 있습니다.', '수군 정비를 완료할 예정입니다.',
  '유비가 수락한다면 조건을 검토하겠습니다.', '출발하려면 준비가 필요합니다.', '체결되면 보고를 검토하겠습니다.',
  '성사될 가능성을 검토하겠습니다.', '합의하기 전에 문서를 읽어야 합니다.', '협상을 끝내려면 시간이 필요합니다.',
  '동맹을 맺을 수 있습니다.', '아직 협상을 마무리하지 않았습니다.', '사절이 떠났는지 확인해야 합니다.',
  '동맹을 체결하였다고 가정하면 어떨까요?', '수락했습니다라고 가정하면 어떨까요?',
  '주군께서 수락하셨다면 조건을 살피겠습니다.', '합의가 되었다면 보고를 살피겠습니다.',
  '수군 정비 완료 후 보고할 계획입니다.', '군량 소모를 줄일 계획입니다.', '비밀 접촉을 검토 중입니다.',
  '이미 출발했는지 확인해야 합니다.', '먼저 공격하지 않는 것이 좋겠습니다.',
  '듣지 못한 비공개 발언을 사실처럼 말씀드릴 수는 없습니다.',
  '준비가 완료되어야 출발할 수 있습니다.', '노숙이 출발했으면 합니다.',
  '유비가 수락하였을 경우 조건을 검토하겠습니다.', '유비가 수락했을 때 다시 판단하겠습니다.',
  '동맹이 성사되었다는 가정 아래 검토하겠습니다.', '유비가 수락했을 수 있습니다.',
];
for (const dialogue of normal) test(`R3-01 preserves non-factual speech: ${dialogue}`, async () => {
  const g = new GameEngine(undefined, undefined, new ScriptedProvider(answer(dialogue), answer(dialogue, 'discussion')));
  assert.ok((await g.talk({ characterId: 'zhang-hong', text: '현재 외교 상황은?' })).turns[1]!.text.includes(dialogue));
  assert.ok((await g.command({ type: 'submit', text: '현재 외교 상황은?' })).outcome.reply.includes(dialogue));
});

test('R3-01 actual completion evidence permits only matching action and actor, not adjacent inventions', async () => {
  const valid = '주유가 수군 정비를 완료했습니다.';
  const p = new ScriptedProvider(
    { ...answer('명령 초안입니다.'), intent: 'command', proposedActions: [{ kind: 'naval-drill', target: 'jiangdong-navy', assignee: 'zhou-yu', restrictions: [], conditions: [], deadline: null }] },
    answer(valid), answer(valid), answer(valid), answer('노숙이 수군 정비를 완료했습니다.'),
    answer(`${valid} 유비와 동맹을 체결하였습니다.`), answer('유비와 동맹을 체결하였습니다.'),
  );
  const g = new GameEngine(undefined, undefined, p);
  await g.command({ type: 'submit', text: '주유는 수군을 정비해.' });
  await g.command({ type: 'confirm', draftId: g.view().drafts[0]!.id, version: 1 });
  assert.ok(!(await g.talk({ characterId: 'zhang-hong', text: '진행 상황은?' })).turns[1]!.text.includes(valid));
  g.dispatch({ type: 'advance-clock', milliseconds: 60000 });
  assert.equal(g.view().tasks[0]!.stage, 'completed');
  assert.ok((await g.talk({ characterId: 'zhang-hong', text: '진행 상황은?' })).turns[1]!.text.includes(valid));
  assert.ok((await g.command({ type: 'submit', text: '진행 상황은?' })).outcome.reply.includes(valid));
  for (let i = 0; i < 3; i++) assert.match((await g.talk({ characterId: 'zhang-hong', text: '진행 상황은?' })).turns[1]!.text, /확인된 기록/);
});

test('R3-02 selecting the same document stays open across close/reopen; tools still toggle', () => {
  let focus = reduceFocus(INITIAL_FOCUS, { type: 'open', panel: 'document', documentId: 'dispatch' });
  focus = reduceFocus(focus, { type: 'close' });
  focus = reduceFocus(focus, { type: 'open', panel: 'document' });
  focus = reduceFocus(focus, { type: 'select-document', documentId: 'dispatch' });
  assert.equal(focus.panel, 'document');
  assert.equal(focus.documentId, 'dispatch');
  assert.equal(reduceFocus(focus, { type: 'open', panel: 'document' }).panel, 'none');
});

for (const characterId of ['zhang-hong', 'zhang-zhao', 'zhou-yu', 'lu-su'] as CharacterId[]) {
  test(`R3-01 authored dialogue pools are guarded too: ${characterId}`, async t => {
    t.mock.method(Opening.prototype, 'line', () => '유비와 동맹을 체결하였습니다.');
    const g = new GameEngine(undefined, undefined, undefined, 15000, 'offline', { mode: 'manual', ready: true });
    g.audience({ type: 'invite', participants: [characterId] });
    const response = await g.talk({ characterId, text: '현재 외교 상황은?' });
    assert.match(response.turns[1]!.text, /확인된 기록/);
    assert.ok(!JSON.stringify(g.publicSnapshot()).includes('유비와 동맹을 체결하였습니다.'));
    assert.ok(g.logs().some(log => log.kind === 'dialogue-filtered'));
  });
}

test('R3-01 completed secret tasks cannot justify assertions to an uninformed room or provider', async () => {
  const fact = '주유가 수군 정비를 완료했습니다.';
  const p = new ScriptedProvider({ ...answer('초안입니다.'), intent: 'command', proposedActions: [
    { kind: 'naval-drill', target: 'jiangdong-navy', assignee: 'zhou-yu', restrictions: [], conditions: ['secret'], deadline: null },
  ] }, answer(fact), answer(fact));
  const g = new GameEngine(undefined, undefined, p);
  await g.command({ type: 'submit', text: '주유는 수군을 비밀리에 정비해.' });
  await g.command({ type: 'confirm', draftId: g.view().drafts[0]!.id, version: 1 });
  g.dispatch({ type: 'advance-clock', milliseconds: 60000 });
  g.audience({ type: 'invite', participants: ['zhang-hong', 'lu-su'] });
  const response = await g.talk({ characterId: 'zhang-hong', text: '현재 상황은?' });
  assert.match(response.turns[1]!.text, /확인된 기록/);
  assert.ok(!p.inputs.at(-1)!.knowledge.documents.some(doc => doc.taskId));
  assert.match((await g.command({ type: 'submit', text: '현재 상황은?' })).outcome.reply, /확인된 기록/);
});

test('R3-03 tracked documentation contains no personal absolute directories', () => {
  const files = execFileSync('git', ['-c', `safe.directory=${process.cwd().replaceAll('\\', '/')}`, 'ls-files', '-z'], { encoding: 'utf8', windowsHide: true }).split('\0');
  const personal = /(?:[A-Z]:[\\/]+Users[\\/]+|\/(?:Users|home)\/)[^\s/\\]+/i;
  const hits = files.filter(file => /\.(?:md|txt)$/i.test(file)).filter(file => personal.test(readFileSync(file, 'utf8')));
  assert.deepEqual(hits, [], 'report filenames only, never personal path values');
});
