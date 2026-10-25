import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../server/engine.ts';
import { knowledgeFor } from '../server/knowledge.ts';
import { parseCompound } from '../server/compound.ts';
import { ScriptedProvider } from './fixtures/scripted-provider.ts';
import type { ActionPlan, CommandOutcome } from '../shared/contracts.ts';
import type { Proposal } from '../server/llm/types.ts';

const plans: Record<string, ActionPlan> = {
  contact: { kind: 'sound-out', target: 'liu-bei', assignee: 'lu-su', conditions: [], restrictions: [], deadline: null },
  navy: { kind: 'naval-drill', target: 'jiangdong-navy', assignee: 'zhou-yu', conditions: [], restrictions: [], deadline: null },
  hold: { kind: 'hold-reply', target: 'cao-cao-envoy', assignee: 'zhang-hong', conditions: [], restrictions: ['no-firm-answer'], deadline: null },
};
const proposal = (actions: ActionPlan[], intent: Proposal['intent'] = 'command'): Proposal => ({ intent, dialogue: '지시를 확인해 주세요.',
  proposedActions: actions, unresolvedQuestions: [], referencedKnowledgeIds: [], usage: { inputTokens: 0, outputTokens: 0, externalCalls: 0, costUsd: 0 } });
const draft = (outcome: CommandOutcome) => {
  assert.equal(outcome.kind, 'draft', JSON.stringify(outcome));
  return outcome as Extract<CommandOutcome, { kind: 'draft' }>;
};

for (const word of ['비공개로', '비밀로', '비밀리에', '몰래', '은밀히']) {
  test(`R1 secret variant ${word} preserves report and message ACLs`, () => {
    const e = new GameEngine();
    const d = draft(e.command({ type: 'submit', text: `노숙은 유비에게 ${word} 연락해.` }).outcome);
    assert.deepEqual(e.view().drafts[0]!.actions[0]!.conditions, ['secret']);
    e.command({ type: 'confirm', draftId: d.draftId, version: 1 });
    e.dispatch({ type: 'advance-clock', milliseconds: 60000 });
    const w = e.internalSnapshot().world, task = w.tasks[0]!;
    assert.deepEqual(w.diplomacy.messages[0]!.recipients, ['player', 'lu-su', 'liu-bei']);
    for (const doc of w.documents.filter(d => d.taskId === task.id)) assert.deepEqual(doc.readers, ['player', 'zhang-hong', 'lu-su']);
    for (const viewer of ['zhou-yu', 'zhang-zhao'] as const) assert.ok(!knowledgeFor(w, viewer).documents.some(d => d.taskId === task.id));
  });
}
for (const phrase of ['공개적으로 비밀리에', '공개하지 말고', '공개적으로는 하지 말고', '비공개가 아니라 공개적으로', '공개인지 비밀인지 알아서']) {
  test(`R1 uncertain visibility asks before drafting: ${phrase}`, () => {
    const e = new GameEngine();
    const result = e.command({ type: 'submit', text: `노숙은 유비에게 ${phrase} 연락해.` });
    assert.ok(result.outcome.kind === 'answer' && result.outcome.intent === 'ambiguous');
    assert.match(result.outcome.reply, /공개|비밀/);
    assert.equal(e.view().drafts.length, 0);
  });
}
test('R1 public wording remains public; provider cannot override secret interpretation', async () => {
  for (const word of ['공개로', '공개적으로']) assert.deepEqual(parseCompound(`노숙은 유비에게 ${word} 연락해.`).actions[0]!.conditions, ['public']);
  const e = new GameEngine(undefined, undefined, new ScriptedProvider(proposal([{ ...plans.contact!, conditions: ['public'] }])));
  assert.equal((await e.command({ type: 'submit', text: '노숙은 유비에게 비공개로 연락해.' })).outcome.kind, 'answer');
  assert.equal(e.view().drafts.length, 0);
});
for (const [text, actions] of [
  ['노숙은 유비에게 연락해.', [plans.contact!, plans.navy!]],
  ['수군을 정비해.', [plans.navy!, plans.contact!]],
  ['수군을 정비해.', [plans.navy!, plans.hold!]],
  ['조조에게 답변을 보류하고 유비에게 연락해.', [plans.contact!]],
  ['조조에게 답변을 보류하고 유비에게 연락해.', [plans.hold!]],
  ['수군을 정비하고 유비에게 연락해.', [plans.contact!]],
  ['안녕.', [plans.navy!]],
] as [string, ActionPlan[]][]) {
  test(`R1 schema-valid extra or omitted actions rejected: ${text} / ${actions.map(a => a.kind)}`, async () => {
    const e = new GameEngine(undefined, undefined, new ScriptedProvider(proposal(actions)));
    const before = e.internalSnapshot().world.resources;
    const result = await e.command({ type: 'submit', text });
    assert.ok(result.outcome.kind === 'answer' && result.outcome.intent === 'ambiguous', JSON.stringify(result.outcome));
    assert.equal(e.view().drafts.length, 0);
    assert.equal(e.view().tasks.length, 0);
    assert.deepEqual(e.internalSnapshot().world.resources, before);
  });
}
test('R1 schema-valid wrong intent cannot hide explicit command actions', async () => {
  for (const intent of ['question', 'discussion', 'unsupported'] as const) {
    const e = new GameEngine(undefined, undefined, new ScriptedProvider(proposal([], intent)));
    const result = await e.command({ type: 'submit', text: '조조에게 답변을 보류하고 유비에게 연락해.' });
    assert.ok(result.outcome.kind === 'answer' && result.outcome.intent === 'ambiguous');
    assert.match(result.outcome.reply, /행동|의도/);
  }
});
test('R1 provider cannot turn a question or hypothetical into a command', async () => {
  for (const text of ['수군을 정비하면 어떨까?', '수군 정비 상태는 어떤가?', '지금 수군을 정비하는 게 좋을까']) {
    const e = new GameEngine(undefined, undefined, new ScriptedProvider(proposal([plans.navy!])));
    const result = await e.command({ type: 'submit', text });
    assert.ok(result.outcome.kind === 'answer' && result.outcome.intent === 'ambiguous');
    assert.equal(e.view().drafts.length, 0);
  }
});
test('R1 all actions in the same clause survive in textual order and execute once', () => {
  const e = new GameEngine();
  const d = draft(e.command({ type: 'submit', text: '조조에게 답변을 보류하고 유비에게 연락하고 수군을 정비해.' }).outcome);
  assert.deepEqual(e.view().drafts[0]!.actions.map(a => a.action), ['hold-reply', 'sound-out', 'naval-drill']);
  assert.deepEqual(e.view().drafts[0]!.unresolved, []);
  e.command({ type: 'confirm', draftId: d.draftId, version: 1 });
  e.dispatch({ type: 'advance-clock', milliseconds: 60000 });
  assert.equal(e.view().tasks.length, 3);
  assert.equal(e.view().ledger.grain, 880);
});
for (const request of ['세금을 걷어', '병사를 모아', '다리를 지어', '창고를 수리해']) {
  test(`R1 unknown request remains explicit in partial confirmation: ${request}`, () => {
    const e = new GameEngine();
    const d = draft(e.command({ type: 'submit', text: `수군을 정비하고 ${request}.` }).outcome);
    assert.ok(e.view().drafts[0]!.unresolved.join(' ').includes(request));
    const result = e.command({ type: 'confirm', draftId: d.draftId, version: 1 });
    assert.ok(result.outcome.kind === 'rejected' && result.outcome.code === 'PARTIAL_CONFIRMATION_REQUIRED');
    assert.ok(result.outcome.reply.includes(request));
    assert.equal(e.view().tasks.length, 0);
    e.command({ type: 'confirm', draftId: d.draftId, version: 1, acceptPartial: true });
    assert.deepEqual(e.view().tasks.map(t => t.action), ['naval-drill']);
  });
}
test('R1 later provider input excludes secret task reports, history and other viewers knowledge', async () => {
  const secret = { ...plans.contact!, conditions: ['secret'] };
  const provider = new ScriptedProvider(proposal([secret]), proposal([], 'question'));
  const e = new GameEngine(undefined, undefined, provider);
  const text = '노숙은 유비에게 비밀리에 연락해.';
  const d = draft((await e.command({ type: 'submit', text })).outcome);
  await e.command({ type: 'confirm', draftId: d.draftId, version: 1 });
  e.dispatch({ type: 'advance-clock', milliseconds: 60000 });
  await e.command({ type: 'submit', text: '현재 상황은?' });
  const input = provider.inputs[1]!;
  assert.ok(!input.knowledge.documents.some(doc => doc.taskId === e.view().tasks[0]!.id));
  assert.ok(!JSON.stringify(input).includes(text));
  for (const forbidden of ['readers', 'recipients', 'PRIVATE_', 'SERVER_ONLY', 'privatePerspective', 'enemyTroops']) assert.ok(!JSON.stringify(input).includes(forbidden));
  assert.equal(input.knowledge.viewer, 'player');
  const serialized = JSON.stringify(e.publicSnapshot());
  for (const forbidden of ['readers', 'recipients', 'PRIVATE_', 'SERVER_ONLY', 'grainSpentEventId']) assert.ok(!serialized.includes(forbidden));
});
test('R1 revising a secret draft does not reattach its old private text to provider context', async () => {
  const text = '노숙은 유비에게 비공개로 연락해.';
  const provider = new ScriptedProvider(proposal([{ ...plans.contact!, conditions: ['secret'] }]), proposal([plans.navy!]));
  const e = new GameEngine(undefined, undefined, provider);
  const d = draft((await e.command({ type: 'submit', text })).outcome);
  await e.command({ type: 'revise', draftId: d.draftId, version: 1, text: '수군을 정비해.' });
  assert.ok(!JSON.stringify(provider.inputs[1]).includes(text));
  assert.equal(e.view().drafts[0]!.version, 2);
  assert.deepEqual(e.view().drafts[0]!.actions.map(a => a.action), ['naval-drill']);
});
