import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../server/engine.ts';
import { CHARACTER_IDS, characterInput, remember } from '../server/characters.ts';
import { boundedItems, npcSettings } from '../server/llm/context-policy.ts';
import { ProviderError, PROVIDER_MESSAGES } from '../server/llm/types.ts';
import type { Proposal, ProviderErrorCode, ProviderInput } from '../server/llm/types.ts';
import type { CharacterId } from '../shared/contracts.ts';
import { ScriptedProvider } from './fixtures/scripted-provider.ts';

const good = (dialogue = '근거를 먼저 살펴야 합니다. 제 의견과 사실을 구분하겠습니다.'): Proposal => ({
  intent: 'discussion', dialogue, proposedActions: [], unresolvedQuestions: [], referencedKnowledgeIds: [],
  usage: { inputTokens: 0, outputTokens: 0, externalCalls: 0, costUsd: null },
});
const speech = (id: CharacterId, text = good().dialogue, refs: string[] = [`card-${id}`]) => ({ id, text, referencedKnowledgeIds: refs });
const pair = (first: unknown = speech('zhang-zhao'), second: unknown = speech('zhou-yu')) => good(JSON.stringify({ speeches: [first, second] }));
const settings = () => ({ ...npcSettings({}), meeting: true });
const room = (provider: ScriptedProvider, timeout = 15000) => {
  const engine = new GameEngine(undefined, undefined, provider, timeout, provider.status, { mode: 'manual' }, settings());
  engine.audience({ type: 'invite', participants: ['zhang-zhao', 'zhou-yu', 'lu-su'] });
  return engine;
};
const ask = (engine: GameEngine<ScriptedProvider>) => engine.talk({ characterId: 'zhang-zhao', text: '전쟁에 대한 의견은?' });

test('NPC bounds keep newest whole items deterministically, skip oversize, preserve order', () => {
  const items = ['old', 'x'.repeat(100), 'middle', 'new'];
  assert.deepEqual(boundedItems(items, 2, 30), ['middle', 'new']);
  assert.deepEqual(boundedItems(items, 0, 0), []);
  assert.deepEqual(boundedItems(items, 2, 30), boundedItems(items, 2, 30));
  assert.equal(npcSettings({ NPC_MEMORY_CHARS: '-1' }).memoryChars, 2400);
  assert.equal(npcSettings({ NPC_MEETING_AI: 'true' }).meeting, false);
});

test('NPC caps include duplicated recent-six summary, document metadata, cards and context', () => {
  const engine = new GameEngine();
  const world = engine.internalSnapshot().world;
  for (let index = 0; index < 100; index++) {
    remember(world, ['zhang-hong'], `event-${index}`, `근거 ${index} ${'가'.repeat(70)}`);
    world.documents.push({ ...world.documents[0]!, id: `doc-${index}`, claim: '가'.repeat(150), readers: ['player', 'zhang-hong'] });
    world.minds['zhang-hong'].cards.push({ id: `card-${index}`, claim: '나'.repeat(50) });
    world.conversation.push({ eventId: `event-${index}`, speaker: 'player', text: '다'.repeat(200), participants: ['zhang-hong'] });
  }
  const limits = npcSettings({});
  const input = characterInput(world, 'zhang-hong', '견해는?', ['zhang-hong'], false, limits);
  const mind = input.character!;
  for (const [items, count, chars] of [[mind.memories, 12, 2400], [mind.cards, 4, 1200], [input.knowledge.documents, 6, 6000], [input.context, 6, 2400]] as const) {
    assert.ok(items.length <= count);
    assert.ok(JSON.stringify(items).length <= chars);
  }
  assert.ok(JSON.stringify(mind.memorySummary).length <= 800);
  assert.ok(mind.memorySummary.eventIds.every(id => mind.memories.some(memory => memory.eventId === id)));
  assert.ok(mind.memories.at(-1)!.fact.includes('99'));
  const zero = { ...limits, memories: 0, documents: 0, cards: 0, contextChars: 0, summaryChars: 0 };
  const empty = characterInput(world, 'zhang-hong', '견해는?', ['zhang-hong'], false, zero);
  assert.deepEqual(empty.character!.memories, []);
  assert.deepEqual(empty.knowledge.documents, []);
  assert.deepEqual(empty.context, []);
  for (const summaryChars of [40, 120, 180, 320]) {
    const bounded = characterInput(world, 'zhang-hong', '견해는?', ['zhang-hong'], false, { ...limits, summaryChars });
    assert.ok(JSON.stringify(bounded.character!.memorySummary).length <= summaryChars);
  }
});

for (const target of CHARACTER_IDS) test(`NPC current secret input stays in its room; solo/two/three capture: ${target}`, async () => {
  const inputs: ProviderInput[] = [];
  const provider = new ScriptedProvider(...Array.from({ length: 8 }, () => (input: ProviderInput) => { inputs.push(input); return good(); }));
  const engine = new GameEngine(undefined, undefined, provider);
  engine.audience({ type: 'invite', participants: ['lu-su'] });
  const secret = '비밀리에 전할 암호_현재입력_한정은 어떻게 생각하는가?';
  await engine.talk({ characterId: 'lu-su', text: secret });
  assert.equal(inputs[0]!.text, secret, 'player current disclosure is verbatim');
  const others = CHARACTER_IDS.filter(id => id !== target);
  for (const audience of [[target], [target, others[0]!], [target, others[0]!, others[1]!]]) {
    engine.audience({ type: 'invite', participants: audience });
    await engine.talk({ characterId: target, text: '현재 의견은?' });
    assert.ok(!JSON.stringify(inputs.at(-1)).includes('암호_현재입력_한정'));
  }
});

test('NPC completed secret task/report and absent private discussion never enter meeting projections', async () => {
  const provider = new ScriptedProvider(good(), pair());
  const engine = room(provider);
  engine.audience({ type: 'invite', participants: ['lu-su'] });
  await engine.talk({ characterId: 'lu-su', text: '별도_단독대화_표식은?' });
  const world = engine.internalSnapshot().world;
  // Projection proof: permissions must be applied before every cap.
  world.documents.push({ ...world.documents[0]!, id: 'report-secret', taskId: 'secret-task', claim: 'SECRET_REPORT_MARKER', readers: ['player', 'lu-su'] });
  remember(world, ['lu-su'], 'private-event', 'SECRET_MEMORY_MARKER', { providerExcluded: true });
  const projection = characterInput(world, 'lu-su', '의견은?', ['lu-su', 'zhang-zhao', 'zhou-yu']);
  assert.ok(!JSON.stringify(projection).includes('SECRET_'));
  engine.audience({ type: 'invite', participants: ['zhang-zhao', 'zhou-yu'] });
  await ask(engine);
  assert.ok(!JSON.stringify(provider.inputs.at(-1)).includes('별도_단독대화_표식'));
});

test('NPC opt-in meeting uses one call, two independently scoped voices, usage and player turn', async () => {
  const provider = new ScriptedProvider(pair());
  const engine = room(provider);
  const response = await ask(engine);
  assert.equal(provider.inputs.length, 1);
  assert.equal(response.source, 'AI');
  assert.equal(response.turns.length, 3);
  assert.equal(response.inputOwner, 'player');
  assert.deepEqual(response.speakers, [{ id: 'zhang-zhao', source: 'AI' }, { id: 'zhou-yu', source: 'AI' }]);
  const protocol = JSON.parse(provider.inputs[0]!.context.at(-1)!.text);
  assert.deepEqual(protocol.projections.map((p: ProviderInput) => p.character!.id), ['zhang-zhao', 'zhou-yu']);
  assert.equal(response.usage!.inputChars, JSON.stringify(provider.inputs[0]).length);
  assert.equal(response.usage!.inputBytes, Buffer.byteLength(JSON.stringify(provider.inputs[0])));
  assert.equal(response.usage!.inputTokens, null, 'unknown tokens are not fabricated');
  assert.deepEqual(engine.npcUsage(), [response.usage]);
  assert.ok(!engine.view().clock.pauseReasons.includes('provider'));
  assert.equal(engine.view().tasks.length, 0);
});

for (const index of [0, 1]) for (const fault of ['ref', 'claim', 'long', 'tone', 'missing', 'duplicate'] as const) {
  test(`NPC meeting replaces only bad speaker ${index}: ${fault}`, async () => {
    const entries: unknown[] = [speech('zhang-zhao'), speech('zhou-yu')];
    const bad = entries[index] as ReturnType<typeof speech>;
    if (fault === 'ref') bad.referencedKnowledgeIds = [`card-${index ? 'zhang-zhao' : 'zhou-yu'}`];
    if (fault === 'claim') bad.text = '유비와 동맹을 체결하였습니다. 이미 협상을 끝냈습니다.';
    if (fault === 'long') bad.text = '가'.repeat(601);
    if (fault === 'tone') bad.text = '닥쳐. 바보.';
    if (fault === 'missing') entries.splice(index, 1);
    if (fault === 'duplicate') entries[1 - index] = structuredClone(bad);
    const provider = new ScriptedProvider(good(JSON.stringify({ speeches: entries })));
    const engine = room(provider);
    const response = await ask(engine);
    assert.equal(provider.inputs.length, 1);
    assert.equal(response.failureCode, 'schema');
    assert.equal(response.speakers![index]!.fallback, true);
    if (fault !== 'duplicate') {
      assert.equal(response.speakers![1 - index]!.source, 'AI');
      assert.equal(response.turns[2 - index]!.text, good().dialogue);
      assert.equal(response.source, 'mixed');
    }
    assert.match(response.state.interpretation!.status, /작성 대사로 응답함/);
    assert.ok(engine.logs().some(log => /작성 대사로 응답함/.test(log.summary)));
    assert.ok(!JSON.stringify(response).includes('동맹을 체결하였습니다'));
    assert.equal(response.inputOwner, 'player');
    assert.ok(!response.state.clock.pauseReasons.includes('provider'));
  });
}

for (const code of Object.keys(PROVIDER_MESSAGES) as ProviderErrorCode[]) for (const meeting of [false, true]) {
  test(`NPC ${meeting ? 'meeting fallback' : 'talk error'} preserves neutral ${code} and releases provider hold`, async () => {
    const provider = new ScriptedProvider(new ProviderError(code));
    const engine = new GameEngine(undefined, undefined, provider, 15000, provider.status, { mode: 'manual' }, { ...settings(), meeting });
    engine.audience({ type: 'invite', participants: ['zhang-zhao', 'zhou-yu'] });
    const response = await ask(engine);
    assert.equal(response.failureCode, code);
    assert.match(response.state.interpretation!.status, new RegExp(`\\[${code}\\]`));
    assert.equal(response.inputOwner, 'player');
    assert.ok(!response.state.clock.pauseReasons.includes('provider'));
    assert.equal(engine.view().drafts.length, 0);
    if (meeting) {
      assert.equal(response.turns.length, 3);
      assert.ok(response.speakers!.every(speaker => speaker.fallback));
      assert.match(response.notice!, /작성 대사로 응답함/);
    } else {
      assert.equal(response.outcome?.kind, 'error');
      assert.equal(response.turns.length, 0);
    }
  });
}

for (const action of ['dismiss', 'share', 'reset', 'switch'] as const) for (const rejects of [false, true]) {
  test(`NPC late ${rejects ? 'failure' : 'success'} after ${action} cannot overwrite world/status/turn`, async () => {
    let finish!: (value: unknown) => void;
    const provider = new ScriptedProvider(() => new Promise((resolve, reject) => { finish = value => rejects ? reject(value) : resolve(value); }));
    const engine = room(provider);
    const pending = ask(engine);
    await new Promise(resolve => setTimeout(resolve, 0));
    if (action === 'dismiss') engine.audience({ type: 'dismiss', characterId: 'zhou-yu' });
    if (action === 'share') engine.audience({ type: 'share', characterId: 'zhang-zhao', documentId: 'm0-public-note' });
    if (action === 'reset') engine.reset();
    if (action === 'switch') engine.audience({ type: 'invite', participants: ['lu-su'] });
    const before = engine.internalSnapshot();
    const status = engine.view().interpretation;
    finish(rejects ? new ProviderError('auth') : pair());
    const response = await pending;
    assert.equal(response.outcome?.kind, 'error');
    if (response.outcome?.kind === 'error') assert.equal(response.outcome.code, 'STALE_RESPONSE');
    assert.deepEqual(response.turns, []);
    assert.deepEqual(engine.view().interpretation, status);
    const after = engine.internalSnapshot();
    // finally removes only its own transient provider hold.
    before.world.clock.pauseReasons = before.world.clock.pauseReasons.filter(reason => reason !== 'provider');
    assert.deepEqual(after, before);
  });
}

test('NPC actual deadline ignores an uncooperative provider', async () => {
  let finish!: (value: unknown) => void;
  const provider = new ScriptedProvider(() => new Promise(resolve => { finish = resolve; }));
  const engine = room(provider, 5);
  const result = await ask(engine);
  assert.equal(result.failureCode, 'timeout');
  const before = engine.publicSnapshot();
  finish(pair());
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(engine.publicSnapshot(), before);
  assert.ok(!engine.view().clock.pauseReasons.includes('provider'));
});

test('NPC older finally cannot release a newer pending request hold', async () => {
  const resolvers: ((value: unknown) => void)[] = [];
  const step = () => new Promise(resolve => resolvers.push(resolve));
  const provider = new ScriptedProvider(step, step);
  const engine = room(provider);
  const older = ask(engine);
  await new Promise(resolve => setTimeout(resolve, 0));
  const newer = ask(engine);
  await new Promise(resolve => setTimeout(resolve, 0));
  resolvers[0]!(pair());
  assert.equal((await older).outcome?.kind, 'error');
  assert.ok(engine.view().clock.pauseReasons.includes('provider'));
  resolvers[1]!(pair());
  assert.equal((await newer).source, 'AI');
  assert.ok(!engine.view().clock.pauseReasons.includes('provider'));
});

test('NPC secret completed task excluded for every person in solo/two/three actual provider captures', async () => {
  const order: Proposal = { ...good(), intent: 'command', proposedActions: [
    { kind: 'naval-drill', target: 'jiangdong-navy', assignee: 'zhou-yu', conditions: ['secret'], restrictions: [], deadline: null },
  ] };
  const provider = new ScriptedProvider(order, ...Array.from({ length: 12 }, () => good()));
  const engine = new GameEngine(undefined, undefined, provider);
  await engine.command({ type: 'submit', text: '주유는 수군을 비밀리에 정비해.' });
  const draft = engine.view().drafts[0]!;
  await engine.command({ type: 'confirm', draftId: draft.id, version: draft.version });
  engine.dispatch({ type: 'advance-clock', milliseconds: 60000 });
  assert.equal(engine.view().tasks[0]!.stage, 'completed');
  const secretTask = engine.view().tasks[0]!.id;
  for (const id of CHARACTER_IDS) {
    const others = CHARACTER_IDS.filter(other => other !== id);
    for (const audience of [[id], [id, others[0]!], [id, others[0]!, others[1]!]]) {
      engine.audience({ type: 'invite', participants: audience });
      await engine.talk({ characterId: id, text: '현재 의견은?' });
      const input = provider.inputs.at(-1)!;
      assert.ok(!input.knowledge.documents.some(doc => doc.taskId === secretTask));
      assert.ok(!JSON.stringify(input).includes('비밀리에 정비'));
      assert.ok(!input.character!.memories.some(memory => /수군 정비.*완료/.test(memory.fact)));
    }
  }
  assert.equal(provider.inputs.length, 13);
});

test('NPC meeting stays default-off and unknown/private questions never call provider', async () => {
  const provider = new ScriptedProvider(good());
  const engine = new GameEngine(undefined, undefined, provider);
  engine.audience({ type: 'invite', participants: ['zhang-zhao', 'zhou-yu'] });
  const response = await ask(engine);
  assert.equal(response.source, 'mixed');
  assert.ok(!provider.inputs[0]!.context.some(turn => turn.text.includes('npc-meeting-v1')));
  await engine.talk({ characterId: 'zhang-zhao', text: '적벽의 미래 결과는?' });
  assert.equal(provider.inputs.length, 1);
});

test('NPC meeting option preserves command draft and clarification paths without executing', async () => {
  const order: Proposal = { ...good(), intent: 'command', proposedActions: [
    { kind: 'naval-drill', target: 'jiangdong-navy', assignee: 'zhou-yu', conditions: [], restrictions: [], deadline: null },
  ] };
  const clarify: Proposal = { ...good('어떤 행동을 지시할지 알려 주시겠습니까?'), intent: 'ambiguous', unresolvedQuestions: ['어떤 행동을 지시할지 알려 주시겠습니까?'] };
  const provider = new ScriptedProvider(order, clarify);
  const engine = room(provider);
  const response = await engine.talk({ characterId: 'zhang-zhao', text: '주유는 수군을 정비해.' });
  assert.equal(response.outcome?.kind, 'draft');
  assert.equal(engine.view().tasks.length, 0);
  assert.ok(!provider.inputs[0]!.context.some(turn => turn.text.includes('npc-meeting-v1')));
  const question = await ask(engine);
  assert.ok(question.turns[1]!.text.includes(clarify.unresolvedQuestions[0]!));
  assert.equal(question.failureCode, undefined);
});
