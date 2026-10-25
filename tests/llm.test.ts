import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../server/engine.ts';
import { MockCommandInterpreter } from '../server/mock-interpreter.ts';
import { ScriptedProvider } from './fixtures/scripted-provider.ts';
import type { Proposal, ProviderInput } from '../server/llm/types.ts';
import type { CommandOutcome } from '../shared/contracts.ts';
import { interpret } from '../server/llm/pipeline.ts';
import { actionVocabulary } from '../server/llm/validator.ts';

const originalFetch = globalThis.fetch;
let networkCalls = 0;
before(() => { globalThis.fetch = async () => { networkCalls++; throw new Error('NETWORK_FORBIDDEN'); }; });
after(() => { globalThis.fetch = originalFetch; assert.equal(networkCalls, 0, 'offline pipeline must never call fetch'); });
const ORDER = '공근더러 우리 배와 뱃사람들의 채비를 갖추도록 일러라.';
export function proposal(intent: Proposal['intent'] = 'command'): Proposal {
  return { intent, dialogue: '지시를 확인해 주십시오.', proposedActions: intent === 'command' ? [{ kind: 'naval-drill', target: 'jiangdong-navy',
    assignee: 'zhou-yu', conditions: [], restrictions: [], deadline: null }] : [],
    unresolvedQuestions: [], referencedKnowledgeIds: [], usage: { inputTokens: 0, outputTokens: 0, costUsd: null, externalCalls: 0 } };
}
const draft = (outcome: CommandOutcome) => {
  assert.equal(outcome.kind, 'draft');
  return outcome as Extract<CommandOutcome, { kind: 'draft' }>;
};
const material = (engine: GameEngine<ScriptedProvider>) => {
  const { navy, resources, ledger, tasks } = engine.internalSnapshot().world;
  return { navy, resources, ledger, tasks };
};

test('M2 questions, discussion, ambiguity and unsupported orders never execute; original input is recorded', async () => {
  const provider = new ScriptedProvider(proposal('question'), proposal('discussion'), proposal('ambiguous'), proposal('unsupported'));
  const engine = new GameEngine(undefined, undefined, provider);
  const before = material(engine);
  for (const intent of ['question', 'discussion', 'ambiguous', 'unsupported']) {
    const result = await engine.command({ type: 'submit', text: `입력 ${intent}` });
    assert.equal(result.outcome.kind, 'answer');
    assert.ok(result.outcome.kind === 'answer' && result.outcome.intent === intent);
    assert.match(result.outcome.reply, /[가-힣]/);
  }
  assert.deepEqual(material(engine), before);
  assert.equal(engine.view().drafts.length, 0);
  assert.match(engine.logs().at(-1)!.summary, /미지원/);
});

test('M2 unfamiliar Korean order goes through provider, draft and engine confirmation only', async () => {
  assert.equal(new MockCommandInterpreter().interpret(ORDER).intent, 'unsupported');
  const engine = new GameEngine(undefined, undefined, new ScriptedProvider(proposal()));
  const before = material(engine);
  const ref = draft((await engine.command({ type: 'submit', text: ORDER })).outcome);
  assert.deepEqual(material(engine), before);
  assert.equal(engine.view().drafts[0]!.text, ORDER);
  const result = await engine.command({ type: 'confirm', draftId: ref.draftId, version: ref.version });
  assert.equal(result.state.tasks.length, 1);
  await engine.command({ type: 'confirm', draftId: ref.draftId, version: ref.version });
  engine.dispatch({ type: 'advance-clock', milliseconds: 60000 });
  assert.equal(engine.view().ledger.grain, 900);
  assert.equal(engine.view().ledger.navalReadiness, 35);
  assert.equal(engine.view().tasks.length, 1);
});

test('M2 restrictions survive task and reports; omitted or unrelated negation requires clarification', async () => {
  const restricted = proposal(); restricted.proposedActions[0]!.restrictions = ['no-first-strike'];
  const engine = new GameEngine(undefined, undefined, new ScriptedProvider(restricted, proposal(), restricted));
  const ref = draft((await engine.command({ type: 'submit', text: '수군을 정비해. 먼저 공격하지는 마.' })).outcome);
  await engine.command({ type: 'confirm', draftId: ref.draftId, version: 1 });
  engine.dispatch({ type: 'advance-clock', milliseconds: 60000 });
  assert.equal(engine.view().ledger.engagementPolicy, 'no-first-strike');
  for (const doc of engine.view().knowledge.documents.filter(doc => doc.taskId)) assert.match(doc.claim, /먼저 공격하지 않음|선제공격 금지/);
  for (const text of ['수군을 정비해. 공격하지 마.', '수군을 정비해. 군량을 쓰지 마.']) {
    const result = await engine.command({ type: 'submit', text });
    assert.ok(result.outcome.kind === 'answer' && result.outcome.intent === 'ambiguous');
  }
  assert.equal(engine.view().drafts.length, 1);
});

test('M2 revise and cancel preserve version semantics, and ambiguous revision keeps draft unchanged', async () => {
  const restricted = proposal(); restricted.proposedActions[0]!.restrictions = ['no-first-strike'];
  const provider = new ScriptedProvider(proposal(), restricted, proposal('ambiguous'));
  const engine = new GameEngine(undefined, undefined, provider);
  const ref = draft((await engine.command({ type: 'submit', text: ORDER })).outcome);
  const revised = draft((await engine.command({ type: 'revise', draftId: ref.draftId, version: 1, text: '수군 정비. 먼저 공격하지 마.' })).outcome);
  assert.equal(revised.version, 2);
  const saved = engine.view().drafts;
  await engine.command({ type: 'revise', draftId: ref.draftId, version: 2, text: '그렇게 해.' });
  assert.deepEqual(engine.view().drafts, saved);
  assert.equal((await engine.command({ type: 'confirm', draftId: ref.draftId, version: 1 })).outcome.kind, 'rejected');
  await engine.command({ type: 'cancel', draftId: ref.draftId, version: 2 });
  assert.equal((await engine.command({ type: 'confirm', draftId: ref.draftId, version: 2 })).outcome.kind, 'rejected');
  assert.equal(engine.view().tasks.length, 0);
});

test('M2 stale replies cannot overwrite revision, cancel, confirmation, newer submit or reset', async () => {
  for (const operation of ['revise', 'cancel', 'confirm', 'submit', 'reset'] as const) {
    let release!: (value: unknown) => void;
    const delayed = new Promise(resolve => { release = resolve; });
    const provider = new ScriptedProvider(proposal(), () => delayed, proposal());
    const engine = new GameEngine(undefined, undefined, provider);
    const ref = draft((await engine.command({ type: 'submit', text: ORDER })).outcome);
    const pending = engine.command({ type: 'revise', draftId: ref.draftId, version: 1, text: '늦은 수정' });
    await new Promise(resolve => setImmediate(resolve));
    if (operation === 'reset') engine.reset();
    else if (operation === 'submit') await engine.command({ type: operation, text: '새 지시' });
    else if (operation === 'revise') await engine.command({ type: operation, draftId: ref.draftId, version: 1, text: '최신 수정' });
    else await engine.command({ type: operation, draftId: ref.draftId, version: 1 });
    const snapshot = engine.internalSnapshot();
    release(proposal());
    const stale = await pending;
    assert.ok(stale.outcome.kind === 'error' && stale.outcome.code === 'STALE_RESPONSE', operation);
    assert.deepEqual(engine.internalSnapshot(), snapshot, operation);
  }
});

test('M2 strict schema, vocabulary, length, references and actor/target checks reject without mutation', async () => {
  const cases: unknown[] = ['not JSON', null, { ...proposal(), extra: true }, { ...proposal(), dialogue: 'a'.repeat(2001) },
    { ...proposal(), proposedActions: Array(4).fill(proposal().proposedActions[0]) },
    { ...proposal(), referencedKnowledgeIds: ['PRIVATE_ENEMY_INTENT'] },
    { ...proposal(), usage: { inputTokens: -1, outputTokens: 0, costUsd: null, externalCalls: 0 } }];
  for (const [key, value] of [['kind', 'attack'], ['target', 'unknown'], ['assignee', 'lu-su'], ['restrictions', ['unknown']], ['deadline', 42]]) {
    cases.push({ ...proposal(), proposedActions: [{ ...proposal().proposedActions[0], [key as string]: value }] });
  }
  for (const bad of cases) {
    const engine = new GameEngine(undefined, undefined, new ScriptedProvider(bad));
    const before = engine.internalSnapshot();
    const result = await engine.command({ type: 'submit', text: ORDER });
    assert.ok(result.outcome.kind === 'error' && result.outcome.code === 'INVALID_PROPOSAL', JSON.stringify(bad));
    assert.deepEqual(engine.internalSnapshot(), before);
  }
});

test('M2 multiple actions and unenforceable conditions/deadlines ask rather than silently truncate', async () => {
  for (const change of [ { proposedActions: Array(3).fill(proposal().proposedActions[0]) },
    { proposedActions: [{ ...proposal().proposedActions[0], deadline: '내일' }] },
    { proposedActions: [{ ...proposal().proposedActions[0], conditions: ['비가 오면'] }] } ]) {
    const engine = new GameEngine(undefined, undefined, new ScriptedProvider({ ...proposal(), ...change }));
    const result = await engine.command({ type: 'submit', text: ORDER });
    assert.ok(result.outcome.kind === 'answer' && result.outcome.intent === 'ambiguous');
    assert.equal(engine.view().drafts.length, 0);
  }
});

test('M2 punctuation does not swallow another negation, and omitted conditional clauses are clarified', async () => {
  const restricted = proposal(); restricted.proposedActions[0]!.restrictions = ['no-first-strike'];
  for (const text of ['수군 정비. 먼저 공격하지 마.군량쓰지마.', '군량이 충분하면 수군을 정비하라.', '노숙에게 수군을 정비시키라.', '조조군의 수군을 정비하라.']) {
    const engine = new GameEngine(undefined, undefined, new ScriptedProvider(restricted));
    const result = await engine.command({ type: 'submit', text });
    assert.ok(result.outcome.kind === 'answer' && result.outcome.intent === 'ambiguous', text);
    assert.equal(engine.view().drafts.length, 0);
  }
});

test('M2 provider failures and timeout preserve full world, drafts and input; no silent Mock fallback', async () => {
  for (const step of [new Error('SYNTHETIC_PRIVATE_SECRET'), () => new Promise(() => {})]) {
    const engine = new GameEngine(undefined, undefined, new ScriptedProvider(proposal(), step), 15);
    const ref = draft((await engine.command({ type: 'submit', text: ORDER })).outcome);
    const before = engine.internalSnapshot();
    const result = await engine.command({ type: 'revise', draftId: ref.draftId, version: 1, text: '수정할 원문' });
    assert.equal(result.outcome.kind, 'error');
    assert.ok(result.outcome.kind === 'error' && result.outcome.input === '수정할 원문');
    assert.deepEqual(engine.internalSnapshot(), before);
    assert.equal(result.state.interpretation?.source, 'AI');
    assert.ok(!JSON.stringify(result).includes('SYNTHETIC_PRIVATE_SECRET'));
  }
});

test('M2 model completion claims never execute or appear as engine results', async () => {
  for (const intent of ['question', 'command'] as const) {
    const engine = new GameEngine(undefined, undefined, new ScriptedProvider({ ...proposal(intent), dialogue: '정비 완료. 군량을 소모했습니다.' }));
    const before = material(engine);
    const result = await engine.command({ type: 'submit', text: ORDER });
    assert.deepEqual(material(engine), before);
    assert.ok(!result.outcome.reply.includes('정비 완료'));
  }
});

test('M2 ambiguity uses the missing-information question even when dialogue contains a completion claim', async () => {
  const engine = new GameEngine(undefined, undefined, new ScriptedProvider({ ...proposal('ambiguous'),
    dialogue: '정비 완료', unresolvedQuestions: ['대상을 다시 알려 주시겠습니까?'] }));
  const result = await engine.command({ type: 'submit', text: '그렇게 해.' });
  assert.match(result.outcome.reply, /대상을 다시/);
  assert.equal(engine.view().drafts.length, 0);
});

test('M2 provider gets detached public knowledge, bounded context and vocabulary, never hidden state', async () => {
  const provider = new ScriptedProvider((input: ProviderInput) => {
    input.knowledge.documents[0]!.claim = 'provider mutation'; return proposal('question');
  }, proposal());
  const engine = new GameEngine(undefined, undefined, provider);
  const documents = engine.view().knowledge.documents;
  await engine.command({ type: 'submit', text: '상태는 어떤가?' });
  await engine.command({ type: 'submit', text: ORDER });
  assert.deepEqual(engine.view().knowledge.documents, documents);
  assert.equal(provider.inputs[1]!.context.length, 2);
  assert.equal(provider.inputs[0]!.actions[0]!.kind, 'naval-drill');
  for (const forbidden of ['SERVER_ONLY', 'PRIVATE_', '987654', 'UNRELEASED', 'readers', 'enemyTroops', 'resources', 'available', 'privatePerspective']) {
    assert.ok(!JSON.stringify(provider.inputs).includes(forbidden), forbidden);
  }
});

test('M2 the default 15-second deadline rejects at 15000ms, and late completion stays ignored', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let release!: (value: unknown) => void;
  const provider = new ScriptedProvider(() => new Promise(resolve => { release = resolve; }));
  const engine = new GameEngine(undefined, undefined, provider);
  const before = engine.internalSnapshot();
  let finished = false;
  const pending = engine.command({ type: 'submit', text: ORDER }).then(result => { finished = true; return result; });
  await Promise.resolve();
  t.mock.timers.tick(14999);
  await Promise.resolve();
  assert.equal(finished, false);
  t.mock.timers.tick(1);
  const result = await pending;
  assert.ok(result.outcome.kind === 'error' && result.outcome.code === 'PROVIDER_TIMEOUT');
  release(proposal());
  await Promise.resolve();
  assert.deepEqual(engine.internalSnapshot(), before);
});

test('M2 original input remains authoritative even if provider mutates its knowledge and action vocabulary', async () => {
  const provider = new ScriptedProvider((input: ProviderInput) => {
    input.knowledge.documents.push({ ...input.knowledge.documents[0]!, id: 'invented-id' });
    input.actions[0]!.targets.push('enemy-fleet');
    return { ...proposal('question'), referencedKnowledgeIds: ['invented-id'] };
  });
  await assert.rejects(interpret(provider, { text: ORDER, knowledge: new GameEngine().view().knowledge,
    context: [], actions: actionVocabulary() }, 100), /INVALID_PROPOSAL/);
});
