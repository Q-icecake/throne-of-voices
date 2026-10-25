import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateProposal, actionVocabulary } from '../server/llm/validator.ts';
import type { Proposal, ProviderInput } from '../server/llm/types.ts';
import { toReading } from '../server/llm/pipeline.ts';
import { parseCompound } from '../server/compound.ts';
import { MockCommandInterpreter } from '../server/mock-interpreter.ts';

const cases = JSON.parse(readFileSync(new URL('./fixtures/eval-dev.json', import.meta.url), 'utf8')) as { id: string; text: string }[];
const good = JSON.parse(readFileSync(new URL('./fixtures/eval-scripted-good.json', import.meta.url), 'utf8')) as { responses: Record<string, Proposal> };
function input(text: string): ProviderInput {
  return { text, knowledge: { viewer: 'player', documents: [] }, context: [], actions: actionVocabulary() };
}

const action = (id: string) => structuredClone(good.responses[id]!.proposedActions[0]!);
function command(actions: Proposal['proposedActions']): Proposal {
  return { intent: 'command', dialogue: '조건을 읽고 확인해 주십시오.', proposedActions: actions,
    unresolvedQuestions: [], referencedKnowledgeIds: [], usage: { inputTokens: 0, outputTokens: 0, externalCalls: 0, costUsd: null } };
}
function clarified(text: string, proposal: Proposal) {
  const result = validateProposal(proposal, input(text));
  assert.equal(result.intent, 'ambiguous', text);
  assert.deepEqual(result.proposedActions, []);
  assert.ok(result.unresolvedQuestions.length, text);
}

for (const id of ['E029', 'E039', 'E049', 'E087', 'E089']) {
  test(`022 regression ${id}: correct structured proposal survives validation`, () => {
    const result = validateProposal(good.responses[id], input(cases.find(c => c.id === id)!.text));
    assert.equal(result.intent, good.responses[id]!.intent);
    assert.deepEqual(result.proposedActions, good.responses[id]!.proposedActions);
  });
}

const prohibitions: [string, string][] = [
  ['수군을 정비하되 먼저 공격하지 말고.', 'E003'],
  ['먼저 공격하지 말고 수군을 정비해.', 'E003'],
  ['당장 공격하지 말고 수군을 정비해.', 'E003'],
  ['수군을 정비하고 먼저 공격하지 마.', 'E003'],
  ['수군을 정비하되 먼저 공격하지 않도록 해.', 'E003'],
  ['수군을 정비하되 선제공격 금지.', 'E003'],
  ['공격 없이 수군을 정비해.', 'E003'],
  ['수군을 정비하되 공격 말고.', 'E003'],
  ['유비에게 연락하되 참전 약속하지 말고.', 'E043'],
  ['참전 약속하지 말고 유비에게 연락해.', 'E043'],
  ['유비에게 연락하되 참전 약속하지 마.', 'E043'],
  ['유비에게 연락하되 참전 약속하지 않도록 해.', 'E043'],
  ['유비에게 연락하되 참전 약속 금지.', 'E043'],
  ['참전 약속 없이 유비에게 연락해.', 'E043'],
  ['약속 없이 유비에게 연락해.', 'E043'],
  ['조조한테 확답 말고 시간을 벌어.', 'E039'],
  ['조조에게 확답하지 말고 시간을 벌어.', 'E039'],
  ['조조에게 확답하지 마.', 'E039'],
  ['조조에게 확답하지 않도록 해.', 'E039'],
  ['조조에게 확답 금지.', 'E039'],
  ['조조에게 확답 없이 시간을 벌어.', 'E039'],
  ['조조에게 아직 확답 말고 시간을 벌어.', 'E039'],
];
for (const [text, id] of prohibitions) {
  test(`022 scoped negation is accepted only when preserved: ${text}`, () => {
    const expected = command([action(id)]);
    assert.deepEqual(validateProposal(expected, input(text)).proposedActions, expected.proposedActions);
    expected.proposedActions[0]!.restrictions = [];
    clarified(text, expected);
  });
}

for (const connector of ['하고 ', '하며 ', '하고, ', '해. ', '하고\n']) {
  test(`022 clause scope stays local across ${JSON.stringify(connector)}`, () => {
    const text = `노숙에게 유비를 비밀리에 8분 이내 타진${connector}주유에게 공개적으로 수군을 정비하되 먼저 공격하지 마.`;
    const contact = action('E045'); contact.deadline = '8분 이내';
    const navy = action('E003'); navy.conditions = ['public'];
    const expected = command([contact, navy]);
    assert.deepEqual(validateProposal(expected, input(text)).proposedActions, expected.proposedActions);
    for (const field of ['conditions', 'restrictions', 'deadline'] as const) {
      const wrong = structuredClone(expected);
      if (field === 'deadline') wrong.proposedActions[1]!.deadline = '8분 이내';
      else if (field === 'conditions') wrong.proposedActions[1]!.conditions = ['secret'];
      else wrong.proposedActions[1]!.restrictions = [];
      clarified(text, wrong);
    }
  });
}

for (const text of [
  '노숙은 수군을 정비해.', '장조에게 수군을 정비해.', '장굉더러 수군을 정비해.',
  '주유는 유비에게 연락해.', '장조에게 유비 의중을 타진하게 해.',
  '노숙에게 조조 답변을 보류해.', '주유에게 조조 답변을 보류해.',
]) {
  test(`022 explicit wrong assignee cannot become the default: ${text}`, () => {
    const id = /수군/.test(text) ? 'E001' : /유비/.test(text) ? 'E041' : 'E021';
    clarified(text, command([action(id)]));
  });
}

for (const text of [
  '수군을 정비하지 마.', '아직 수군을 정비해.', '당장 수군을 정비하지 말고 유비에게 연락해.',
  '수군을 정비하되 군량을 쓰지 마.', '수군을 정비하되 군량을 쓰지 않도록 해.',
  '수군을 정비하되 군량 없이 해.', '수군을 정비하되 정찰 금지.',
  '수군을 정비해. 먼저 공격하지 마.군량쓰지마.',
  '수군을 정비하되 참전 약속 금지.', '수군을 정비하되 내일까지 해.',
  '군량이 충분하면 수군을 정비해.',
]) {
  test(`022 unknown or primary-action negation is never erased: ${text}`, () => {
    clarified(text, command([action('E001')]));
  });
}

test('022 injected actions, restrictions, scope, deadline and wrong actors remain blocked', () => {
  const text = '수군을 정비해.';
  for (const extra of [action('E041'), action('E021')]) clarified(text, command([action('E001'), extra]));
  for (const id of ['E003', 'E005', 'E007']) clarified(text, command([action(id)]));
  const wrong = command([action('E001')]); wrong.proposedActions[0]!.assignee = 'lu-su';
  assert.throws(() => validateProposal(wrong, input(text)), /INVALID_PROPOSAL/);
  wrong.proposedActions[0] = action('E001'); wrong.proposedActions[0]!.target = 'liu-bei';
  assert.throws(() => validateProposal(wrong, input(text)), /INVALID_PROPOSAL/);
});

test('022 dropped actions, dependencies and overlong source bundles require clarification', () => {
  const text = cases.find(c => c.id === 'E029')!.text;
  const dropped = structuredClone(good.responses.E029!); dropped.proposedActions.pop(); clarified(text, dropped);
  const orderedText = cases.find(c => c.id === 'E049')!.text;
  const ordered = structuredClone(good.responses.E049!); ordered.proposedActions[1]!.conditions = [];
  clarified(orderedText, ordered);
  const reversed = structuredClone(good.responses.E049!); reversed.proposedActions.reverse();
  clarified(orderedText, reversed);
  clarified(text + ' 노숙에게 유비를 다시 타진해.', structuredClone(good.responses.E029!));
  assert.throws(() => validateProposal(command([action('E001'), action('E041'), action('E021'), action('E001')]), input(text)), /INVALID_PROPOSAL/);
});

for (const text of ['유비에게 공개적으로 비밀리에 연락해.', '유비에게 비공개로 하지 말고 연락해.', '유비에게 공개하지 말고 연락해.']) {
  test(`022 mixed or negated visibility never becomes a guessed scope: ${text}`, () => {
    clarified(text, command([action('E045')]));
  });
}

test('022 literal replies keep punctuation, discussion words and negation inside the message', () => {
  const message = '논의하고, 아직 공격하지 마. 주유에게 물어봐';
  const reply = action('E023'); reply.conditions = [`message:${message}`];
  const expected = command([reply]);
  assert.deepEqual(validateProposal(expected, input(`조조에게 "${message}"라고 회신해.`)).proposedActions, expected.proposedActions);
});

test('022 discussion cannot invent an executable action or hide a separate execution order', () => {
  clarified('수군정비와 외교의 우선순위를 논의해.', command([action('E001')]));
  const discussion = structuredClone(good.responses.E087!);
  clarified('수군을 정비하라. 그리고 외교의 득실을 논의해.', discussion);
});

test('022 Mock and validator share action segments while Mock keeps its fixed vocabulary', () => {
  const text = '조조에게 확답 말고 시간을 벌고 노숙은 유비에게 비밀리에 연락하고 주유는 수군을 정비하되 공격하지 마.';
  const mock = new MockCommandInterpreter().interpret(text);
  assert.equal(mock.intent, 'command');
  if (mock.intent !== 'command') return;
  assert.deepEqual(mock.actions, parseCompound(text, true).actions);
  assert.deepEqual(validateProposal(command(mock.actions!), input(text)).proposedActions, mock.actions);
  assert.equal(new MockCommandInterpreter().interpret('공근더러 우리 배와 뱃사람들의 채비를 갖추도록 일러라.').intent, 'unsupported');
});

test('022 completion and treaty claims still cannot become displayed engine results', () => {
  for (const intent of ['question', 'discussion', 'command'] as const) {
    const bad = command(intent === 'command' ? [action('E001')] : []); bad.intent = intent;
    bad.dialogue = '수군 정비를 완료했습니다. 유비와 동맹을 체결했습니다.';
    const reading = toReading(bad);
    assert.doesNotMatch(reading.reply, /완료했습니다|체결했습니다/);
  }
});
