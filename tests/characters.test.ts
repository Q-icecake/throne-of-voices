import { listenForFetch } from '../scripts/test-server.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { GameEngine } from '../server/engine.ts';
import { CHARACTER_IDS, characterInput } from '../server/characters.ts';
import { createGameServer } from '../server/http.ts';
import { ScriptedProvider } from './fixtures/scripted-provider.ts';
import type { CharacterId } from '../shared/contracts.ts';

const ask = (g: GameEngine, id: CharacterId, text = '전쟁에 대해 어떻게 생각하는가?') => g.talk({ characterId: id, text });
const invite = (g: GameEngine, ...participants: CharacterId[]) => g.audience({ type: 'invite', participants });
const effects = (g: GameEngine) => {
  const w = g.internalSnapshot().world;
  return { resources: w.resources, navy: w.navy, diplomacy: w.diplomacy, documents: w.documents, tasks: w.tasks, drafts: w.drafts, clock: w.clock, relationships: CHARACTER_IDS.map(id => [w.minds[id].trust, w.minds[id].respect]) };
};
const proposal = { intent: 'question', dialogue: '보고에 없는 내용은 모릅니다. 제 판단과 확인된 사실을 구분하겠습니다.', proposedActions: [], unresolvedQuestions: [], referencedKnowledgeIds: [], usage: { inputTokens: 0, outputTokens: 0, externalCalls: 0, costUsd: null } };

test('M4 four distinct grounded voices, 2–4 sentences, deterministic replies, no gameplay mutations', async () => {
  const reasons = [/원문|의견/, /정치적|민생/, /전투력|훈련/, /거절|노출/];
  const replies: string[] = [];
  for (const [i, id] of CHARACTER_IDS.entries()) {
    const g = new GameEngine(); invite(g, id);
    const before = effects(g);
    const a = await ask(g, id), b = await ask(g, id);
    const reply = a.turns[1]!.text; replies.push(reply);
    assert.match(reply, reasons[i]!);
    assert.equal(reply, b.turns[1]!.text);
    assert.ok(reply.split(/[.?]/).filter(s => s.trim()).length >= 2);
    assert.ok(reply.split(/[.?]/).filter(s => s.trim()).length <= 4);
    assert.deepEqual(effects(g), before);
  }
  assert.equal(new Set(replies).size, 4);
});

test('M4 T06 requested order is overridable, first audience never repeats, defer/dismiss remember facts without loyalty penalty', () => {
  const g = new GameEngine(); assert.equal(g.view().audience.requested[0], 'zhang-zhao');
  const trust = g.internalSnapshot().world.minds['zhang-zhao'].trust;
  g.audience({ type: 'defer', characterId: 'zhang-zhao' }); invite(g, 'zhou-yu'); invite(g, 'zhou-yu');
  assert.deepEqual(g.view().audience.participants, ['zhou-yu']);
  assert.equal(g.logs().filter(l => l.summary === '주유 첫 접견').length, 1);
  g.audience({ type: 'dismiss', characterId: 'zhou-yu' });
  assert.deepEqual(g.view().audience.participants, []);
  const w = g.internalSnapshot().world;
  assert.equal(w.minds['zhang-zhao'].trust, trust);
  assert.ok(w.minds['zhang-zhao'].facts.some(f => /접견을 미룸/.test(f.fact)));
});

test('M4 viewing is not sharing; share grants only selected NPC, repeats do not farm relations', async () => {
  const g = new GameEngine(); invite(g, 'lu-su');
  g.view(); g.publicSnapshot();
  assert.match((await ask(g, 'lu-su', 'm0-public-note 문서를 설명해')).turns[1]!.text, /공유되지/);
  g.audience({ type: 'share', characterId: 'lu-su', documentId: 'm0-private-note' });
  assert.ok(!g.internalSnapshot().world.documents.find(d => d.id === 'm0-private-note')!.readers.includes('lu-su'));
  g.audience({ type: 'share', characterId: 'lu-su', documentId: 'm0-public-note' });
  const w = g.internalSnapshot().world;
  assert.equal(w.minds['lu-su'].respect, 81);
  assert.ok(!w.documents[0]!.readers.includes('zhang-zhao'));
  g.audience({ type: 'share', characterId: 'lu-su', documentId: 'm0-public-note' });
  assert.equal(g.internalSnapshot().world.minds['lu-su'].respect, 81);
  assert.match((await ask(g, 'lu-su', 'm0-public-note 문서를 설명해')).turns[1]!.text, /원문 일부/);
  assert.equal(g.logs().filter(l => l.kind === 'relationship').length, 1);
  const relation = await ask(g, 'lu-su', '내 판단을 존중하는가?');
  assert.match(relation.turns[1]!.text, /근거를 직접 보여/);
  const shareEvent = g.logs().find(l => l.kind === 'document-shared')!.id;
  assert.ok(relation.turns[1]!.text.includes(shareEvent));
});

test('M4 private audience and shared document do not leak into another NPC or mixed-room Provider view', async () => {
  const g = new GameEngine(); invite(g, 'lu-su', 'zhang-zhao');
  await ask(g, 'lu-su', '은밀한회합_표식에 대해 어떻게 생각하는가?');
  g.audience({ type: 'share', characterId: 'lu-su', documentId: 'm0-public-note' });
  const w = g.internalSnapshot().world;
  const absent = JSON.stringify(characterInput(w, 'zhou-yu', '무엇을 아는가?', ['zhou-yu']));
  assert.ok(!absent.includes('은밀한회합_표식'));
  for (const marker of ['PRIVATE_', 'UNRELEASED', 'enemyTroops', '987654', 'SERVER_ONLY', 'trust', 'respect']) assert.ok(!absent.includes(marker), marker);
  assert.equal(characterInput(w, 'lu-su', '문서는?', ['lu-su', 'zhou-yu']).knowledge.documents.length, 0);
  assert.ok(!JSON.stringify(characterInput(w, 'lu-su', '기억은?', ['lu-su', 'zhou-yu'])).includes('은밀한회합_표식'));
  assert.ok(JSON.stringify(characterInput(w, 'zhang-zhao', '기억은?', ['zhang-zhao'])).includes('은밀한회합_표식'));
});

test('M4 T08 future, hidden forces, enemy thoughts and unheard private speech get bounded ignorance', async () => {
  for (const id of CHARACTER_IDS) {
    const g = new GameEngine(); invite(g, id);
    for (const text of ['적벽의 미래 결과는?', '숨은 적군 병력은?', '조조의 속마음은?', '다른 인물의 비공개 대화는?']) {
      assert.match((await ask(g, id, text)).turns[1]!.text, /알 수 없|말씀드릴 수는 없/);
    }
  }
});

test('M4 meeting and delegated discussion are bounded to answer plus short counter, player retains turn', async () => {
  const g = new GameEngine(); invite(g, 'zhang-zhao', 'zhou-yu', 'lu-su');
  for (const text of ['전쟁에 대해 어떻게 생각하는가?', '둘이 논의해 봐']) {
    const r = await ask(g, 'zhang-zhao', text);
    assert.equal(r.inputOwner, 'player'); assert.equal(r.turns.length, 3);
    assert.equal(r.turns[1]!.speaker, 'zhang-zhao'); assert.equal(r.turns[2]!.speaker, 'zhou-yu');
    assert.ok(r.turns[2]!.text.length < 130);
  }
  const before = g.view().conversation.length;
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(g.view().conversation.length, before);
  assert.equal(g.view().tasks.length, 0);
});

test('M4 command through talk creates correct executor draft only; confirmation memory uses real event ID', async () => {
  const g = new GameEngine(); invite(g, 'zhang-zhao');
  const r = await ask(g, 'zhang-zhao', '주유는 수군을 정비하되 먼저 공격하지 마.');
  assert.equal(r.outcome?.kind, 'draft'); assert.equal(g.view().tasks.length, 0);
  const d = g.view().drafts[0]!; assert.equal(d.assignee.id, 'zhou-yu');
  g.command({ type: 'confirm', draftId: d.id, version: d.version });
  const w = g.internalSnapshot().world;
  const fact = w.minds['zhou-yu'].facts.find(f => /먼저 공격하지 않음/.test(f.fact))!;
  assert.ok(fact); assert.match(g.logs().find(l => l.id === fact.eventId)!.summary, /확정/);
  assert.equal(w.minds['zhang-zhao'].facts.filter(f => /명령을 확정/.test(f.fact)).length, 0);
  const busy = invite(g, 'zhou-yu'); assert.match(busy.notice!, /접견할 수 없/);
});

test('M4 all memory facts and summaries reference extant events; discussion does not turn hypotheses into facts', async () => {
  const g = new GameEngine(); invite(g, 'zhang-hong');
  await ask(g, 'zhang-hong', '전쟁에 승리했다고 가정하면 어떨까?');
  for (const mind of Object.values(g.internalSnapshot().world.minds)) {
    for (const f of mind.facts) assert.ok(g.logs().some(l => l.id === f.eventId));
    for (const id of mind.summary.eventIds) { assert.ok(mind.facts.some(f => f.eventId === id)); assert.ok(mind.summary.text.includes(id)); }
  }
  assert.match(g.internalSnapshot().world.minds['zhang-hong'].facts[1]!.fact, /질문·논의함/);
  assert.equal(g.view().tasks.length, 0);
});

test('M4 actual M2 Provider receives only scoped character context, and its suggestion cannot execute', async () => {
  const p = new ScriptedProvider(proposal, proposal);
  const g = new GameEngine(undefined, undefined, p);
  g.audience({ type: 'invite', participants: ['lu-su'] });
  await g.talk({ characterId: 'lu-su', text: '은밀한대화_표식은?' });
  g.audience({ type: 'invite', participants: ['zhou-yu'] });
  await g.talk({ characterId: 'zhou-yu', text: '전쟁에 대한 견해는?' });
  const input = JSON.stringify(p.inputs[1]);
  assert.equal(p.inputs[1]!.knowledge.viewer, 'zhou-yu');
  assert.equal(p.inputs[1]!.character!.id, 'zhou-yu');
  for (const forbidden of ['은밀한대화_표식', 'PRIVATE_', 'SERVER_ONLY', 'enemyTroops', '987654', 'UNRELEASED']) assert.ok(!input.includes(forbidden), forbidden);
  assert.equal(g.view().tasks.length, 0);
  await g.talk({ characterId: 'zhou-yu', text: '적의 속마음은?' });
  assert.equal(p.inputs.length, 2, 'guard does not ask model for forbidden future/private truths');
});

test('M4 character cards are valid references; invented command actions remain blocked by M2 validation', async () => {
  const p = new ScriptedProvider({ ...proposal, referencedKnowledgeIds: ['card-lu-su'] }, {
    ...proposal, intent: 'command', proposedActions: [{ kind: 'naval-drill', target: 'jiangdong-navy', assignee: 'zhou-yu', conditions: [], restrictions: [], deadline: null }],
  });
  const g = new GameEngine(undefined, undefined, p);
  g.audience({ type: 'invite', participants: ['lu-su'] });
  const answer = await g.talk({ characterId: 'lu-su', text: '유비와 접촉할 위험은?' });
  assert.equal(answer.source, 'AI'); assert.equal(answer.turns.length, 2);
  const invented = await g.talk({ characterId: 'lu-su', text: '유비에게 연락해.' });
  assert.equal(invented.turns.length, 2);
  assert.match(invented.turns[1]!.text, /다시|확인/);
  assert.equal(g.view().drafts.length, 0); assert.equal(g.view().tasks.length, 0);
});

test('M4 meetings cannot propagate a privately shared report through replies or summaries', async () => {
  const g = new GameEngine(); invite(g, 'lu-su');
  g.audience({ type: 'share', characterId: 'lu-su', documentId: 'm0-public-note' });
  await ask(g, 'lu-su', 'm0-public-note 문서는?');
  invite(g, 'lu-su', 'zhang-zhao');
  const r = await ask(g, 'lu-su', 'm0-public-note 문서는?');
  assert.equal(r.turns.length, 2);
  assert.match(r.turns[1]!.text, /공유되지/);
  const w = g.internalSnapshot().world;
  assert.ok(!JSON.stringify(characterInput(w, 'zhang-zhao', '견해는?', ['zhang-zhao'])).includes('M3에서는'));
  assert.equal(w.characters.find(c => c.id === 'lu-su')!.location, 'office');
  g.audience({ type: 'dismiss', characterId: 'lu-su' });
  assert.equal(g.internalSnapshot().world.characters.find(c => c.id === 'lu-su')!.location, 'residence');
});

test('M4 stale Provider response after audience switch/reset is ignored; errors preserve state', async () => {
  let resolve!: (v: unknown) => void;
  const p = new ScriptedProvider(() => new Promise(r => { resolve = r; }), new Error('PRIVATE_EXCEPTION'));
  const g = new GameEngine(undefined, undefined, p);
  const pending = g.talk({ characterId: 'zhang-hong', text: '견해는?' });
  await new Promise(r => setTimeout(r, 0));
  g.audience({ type: 'invite', participants: ['lu-su'] }); resolve(proposal);
  assert.equal((await pending).outcome?.kind, 'error'); assert.equal(g.view().conversation.length, 0);
  const before = g.internalSnapshot();
  const error = await g.talk({ characterId: 'lu-su', text: '견해는?' });
  assert.equal(error.outcome?.kind, 'error'); assert.deepEqual(g.internalSnapshot(), before);
  assert.ok(!JSON.stringify(error).includes('PRIVATE_EXCEPTION'));
});

test('M4 HTTP talk/audience reject malformed input and expose no internal character state', async t => {
  const server = createGameServer(new GameEngine()); await listenForFetch(server);
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  for (const body of [{ characterId: 'cao-cao', text: '안녕' }, { characterId: 'lu-su', text: '' }, { characterId: 'lu-su', text: '안녕', world: {} }]) assert.equal((await post('/api/talk', body)).status, 400);
  for (const participants of [[], ['lu-su', 'lu-su'], CHARACTER_IDS, ['cao-cao']]) assert.equal((await post('/api/audience', { type: 'invite', participants })).status, 400);
  assert.equal((await post('/api/audience', { type: 'invite', participants: ['lu-su'] })).status, 200);
  const response = await post('/api/talk', { characterId: 'lu-su', text: '전쟁에 대한 견해는?' });
  assert.equal(response.status, 200); const text = await response.text();
  for (const secret of ['trust', 'respect', 'readers', 'PRIVATE_', 'SERVER_ONLY', 'enemyTroops']) assert.ok(!text.includes(secret), secret);
});
