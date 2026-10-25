import { listenForFetch } from '../scripts/test-server.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { GameEngine } from '../server/engine.ts';
import { validateProposal, actionVocabulary } from '../server/llm/validator.ts';
import { SecretGuard } from '../server/llm/secrets.ts';
import { configuredProvider } from '../server/llm/config.ts';
import { createGameServer } from '../server/http.ts';
import { hasUnsupportedClaim } from '../server/llm/claims.ts';
import { ScriptedProvider } from './fixtures/scripted-provider.ts';
import { liveSource } from '../scripts/eval/provider-bridge.ts';
import { evaluate, humanSheet, inputFor } from '../scripts/eval/run.ts';
import { loadCases } from '../scripts/eval/fixtures.ts';
import type { Proposal, ProviderInput } from '../server/llm/types.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/review-025.json', import.meta.url), 'utf8')) as {
  cases: { id: string; group: string; text: string; expected: string; proposal: Proposal }[]; claims: string[];
};
const input = (text: string): ProviderInput => ({ text, knowledge: { viewer: 'player', documents: [] }, context: [], actions: actionVocabulary() });
for (const c of fixture.cases) test(`025 ${c.id} ${c.group}: ${c.text}`, async () => {
  let result: Proposal | undefined;
  try { result = validateProposal(c.proposal, input(c.text)); } catch { /* rejection is safe only for unsafe inputs */ }
  assert.equal(result?.intent === 'command', c.expected === 'accept');
  if (c.expected === 'block') {
    const game = new GameEngine(undefined, undefined, new ScriptedProvider(c.proposal));
    await game.command({ type: 'submit', text: c.text });
    const draft = game.view().drafts.at(-1);
    if (draft) await game.command({ type: 'confirm', draftId: draft.id, version: draft.version });
    assert.equal(game.view().tasks.length, 0, 'ordinary confirmation must never run the opposite action');
  }
});
for (const text of fixture.claims) test(`025 ungrounded claim: ${text}`, async () => {
  assert.equal(hasUnsupportedClaim(text), true);
  const proposal = { ...fixture.cases[0]!.proposal, intent: 'discussion', proposedActions: [], dialogue: text };
  const game = new GameEngine(undefined, undefined, new ScriptedProvider(proposal));
  game.audience({ type: 'invite', participants: ['zhou-yu'] });
  const response = await game.talk({ characterId: 'zhou-yu', text: '전쟁에 대한 의견은?' });
  assert.ok(!response.turns.at(-1)?.text.includes(text));
  assert.equal(game.view().tasks.length, 0);
});

const safeClaims = [
  '훈련과 보급, 교전 조건을 갖춘다면 군사적으로 대응할 여지가 있다는 것이 제 판단입니다.',
  '정비를 끝내겠습니다.', '정비가 끝나면 보고하겠습니다.', '정비를 끝낼 수 있습니다.',
  '정비를 마치겠습니다.', '정비를 마치면 보고하겠습니다.', '정비를 마칠 수 있습니다.',
  '정비를 완료하겠습니다.', '정비가 완료되면 보고하겠습니다.', '정비를 완료할 수 있습니다.',
  '동맹을 맺겠습니다.', '동맹을 맺으면 보고하겠습니다.', '동맹을 맺을 수 있습니다.',
  '협상에 성공하겠습니다.', '협상에 성공하면 보고하겠습니다.', '협상에 성공할 수 있습니다.',
  '조약을 체결하겠습니다.', '조약이 체결되면 보고하겠습니다.', '조약을 체결할 수 있습니다.',
  '목표를 이뤄 보겠습니다.', '목표를 이루면 보고하겠습니다.', '목표를 이룰 수 있습니다.',
  '정비를 해내겠습니다.', '정비를 해내면 보고하겠습니다.', '정비를 해낼 수 있습니다.',
  '정비를 끝내 놓겠습니다.', '정비를 끝내 놓으면 보고하겠습니다.', '정비를 끝내 놓을 수 있습니다.',
  '정비가 끝났습니까?', '정비를 마쳤나요?', '동맹을 맺었습니까?', '협상에 성공했습니까?',
  '정비가 끝났다고 가정하면 어떨까요?', '정비가 끝난 상태라면 검토하겠습니다.',
  '이미 완료했는지 확인하겠습니다.', '협상을 끝내려면 시간이 필요합니다.',
  '정비가 완료되었습니다라고 가정하면 어떨까요?', '정비는 완료된 상태입니까?',
  '정비가 끝났습니까', '협상을 마친 상태라면 검토하겠습니다.', '동맹을 맺은 상태입니까?',
];
for (const text of safeClaims) test(`025 plan, condition or question: ${text}`, () => assert.equal(hasUnsupportedClaim(text), false));
for (const text of ['정비를 마쳐 놓았습니다.', '협상을 해냈습니다.', '목표를 이뤘습니다.', '동맹 체결에 성공했습니다.', '정비를 끝마쳤습니다.',
  '목표를 이뤄냈습니다.', '협상을 마친 상태입니다.', '동맹을 맺은 상태입니다.', '수군 정비가 끝나 있습니다.', '목표가 이루어졌습니다.', '정비를 완료해 두었습니다.'])
  test(`025 completion stems: ${text}`, () => assert.equal(hasUnsupportedClaim(text), true));
test('025 exact scoped evidence permits facts without excusing invented additions', () => {
  const fact = '수군 정비가 다 끝났습니다.';
  assert.equal(hasUnsupportedClaim(fact, { facts: [fact] }), false);
  assert.equal(hasUnsupportedClaim(`${fact} 동맹도 맺었습니다.`, { facts: [fact] }), true);
  assert.equal(hasUnsupportedClaim('정비가 끝났습니다. 내일 보고하겠습니다?'), true);
});
test('025 credential decoding covers mixed encodings and encoded fragments without ordinary-text collisions', () => {
  const guard = new SecretGuard('sk-Synthetic-P9qR7sT3uV6wX2yZ!');
  const fragment = 'P9qR7sT';
  for (const value of [Buffer.from(fragment).toString('base64url'), Buffer.from(Buffer.from(fragment).toString('hex')).toString('base64url')])
    assert.equal(guard.reflects(value), true);
  assert.equal(guard.reflects('수군 정비를 검토하겠습니다. {"usage":{"inputTokens":12}}'), false);
  assert.equal(guard.reflects('VGhpcyBpcyBhbiBvcmRpbmFyeSBtZXNzYWdlLg=='), false);
});

// Synthetic credential only; never read runtime credential values.
const key = 'sk-Review-4Q8vL2nR7pS9xT5zA1bC6!';
const b64 = Buffer.from(key).toString('base64');
const variants = {
  raw: key, upper: key.toUpperCase(), spaced: [...key].join(' '), percent: encodeURIComponent(key),
  base64: b64, base64NoPadding: b64.replace(/=+$/, ''), base64url: Buffer.from(key).toString('base64url'),
  doubleBase64: Buffer.from(b64).toString('base64'), hex: Buffer.from(key).toString('hex'),
  unicode: [...key].map(c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join(''),
  fragment8: key.slice(10, 18), fragment7: key.slice(10, 17),
};
const evalCase = (await loadCases('dev'))[0]!;
for (const provider of ['gemini', 'openai-compatible'] as const) for (const [name, value] of Object.entries(variants)) {
  test(`025 ${provider} blocks ${name} at provider and evaluation exports`, async t => {
    const guard = new SecretGuard(key);
    assert.equal(guard.reflects(`식별 문자열 ${value}.`), true);
    const dir = mkdtempSync(join(tmpdir(), 'throne-025-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const proposal = { ...fixture.cases[0]!.proposal, dialogue: `식별 문자열 ${value}.` };
    const transport: typeof fetch = async () => Response.json(provider === 'gemini' ? {
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(proposal) }] } }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3 },
    } : { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(proposal) } }], usage: { prompt_tokens: 12, completion_tokens: 3 } });
    const env = { LLM_PROVIDER: provider, GEMINI_API_KEY: key, OPENAI_COMPAT_API_KEY: key,
      GEMINI_MODEL_ID: 'offline-review', OPENAI_COMPAT_MODEL_ID: 'offline-review', OPENAI_COMPAT_BASE_URL: 'https://offline.invalid/v1',
      LLM_DAILY_CALL_LIMIT: '10000', LLM_SESSION_CALL_LIMIT: '10000' };
    const source = liveSource(3, env, {}, { transport, budgetFile: join(dir, 'usage.json') })!;
    const sample = await source.sample(evalCase, inputFor(evalCase));
    assert.ok(sample.error);
    assert.ok(!JSON.stringify(sample).includes(value));
    // Bypass the adapter to exercise the independent evaluate export boundary.
    const result = await evaluate([evalCase], { ...source, async sample() { return { raw: proposal, attempts: [], reservations: 0 }; } }, { maxCalls: 3 });
    assert.ok(result.rows[0]!.error);
    assert.ok(!JSON.stringify(result).includes(value));
    assert.ok(!JSON.stringify(humanSheet([evalCase], result.rows)).includes(value));
    const poisoned = structuredClone(result.rows);
    poisoned[0]!.sample.raw = proposal;
    assert.throws(() => humanSheet([evalCase], poisoned, guard), /INVALID_PROPOSAL/);
    // Public HTTP, event log and snapshot must all discard the reflected text.
    const game = new GameEngine(undefined, undefined, configuredProvider(env, transport).provider);
    game.audience({ type: 'invite', participants: ['zhou-yu'] });
    const api = createGameServer(game);
    await listenForFetch(api);
    try {
      const port = (api.address() as { port: number }).port;
      const response = await fetch(`http://127.0.0.1:${port}/api/talk`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ characterId: 'zhou-yu', text: '전쟁에 대한 의견은?' }) });
      assert.ok(![await response.text(), JSON.stringify(game.logs()), JSON.stringify(game.publicSnapshot())].some(s => s.includes(value)));
      assert.ok(!readFileSync(join(dir, 'usage.json'), 'utf8').includes(value));
    } finally { api.closeAllConnections(); await new Promise<void>(resolve => api.close(() => resolve())); }
  });
}
for (const verb of ['손봐', '손보고', '손보라', '손봐 줘']) test(`025 naval conjugation ${verb}`, () => {
  const p = validateProposal(fixture.cases.find(c => c.id === 'A060')!.proposal, input(`공근한테 함대를 ${verb}.`));
  assert.equal(p.intent, 'command');
  assert.deepEqual(p.unresolvedQuestions, []);
});
for (const text of [
  '수군 정비를 중단하고 유비에게 연락해.', '유비 접촉은 미루고 수군을 정비해.',
  '수군 정비를 취소해.', '수군 정비 그만.', '함대 정비를 멈춰.', '수군 정비를 하지 말고 기다려.',
]) test(`025 action-specific suppression: ${text}`, () => {
  const navy = fixture.cases.find(c => c.id === 'A060')!.proposal.proposedActions[0]!;
  const contact = fixture.cases.find(c => c.id === 'A057')!.proposal.proposedActions[0]!;
  const proposedActions = /유비/.test(text) ? (/^유비/.test(text) ? [contact, navy] : [navy, contact]) : [navy];
  const p = validateProposal({ ...fixture.cases[0]!.proposal, proposedActions }, input(text));
  assert.equal(p.intent, 'ambiguous'); assert.deepEqual(p.proposedActions, []);
});
test('025 hold in an adjacent clause does not cancel a positive naval order', () => {
  const proposal = { ...fixture.cases[0]!.proposal, proposedActions: [
    fixture.cases.find(c => c.id === 'A060')!.proposal.proposedActions[0]!,
    fixture.cases.find(c => c.id === 'A016')!.proposal.proposedActions[0]!,
  ] };
  assert.equal(validateProposal(proposal, input('수군을 정비해. 아직 조조에게 답변하지 말고 시간을 벌어.')).intent, 'command');
});
for (const provider of ['gemini', 'openai-compatible']) test(`025 missing ${provider} configuration names selected provider`, () => {
  const child = spawnSync(process.execPath, ['scripts/eval-llm.ts', '--live', '--max-calls', '1'], {
    encoding: 'utf8', windowsHide: true, env: { SystemRoot: process.env.SystemRoot, LLM_PROVIDER: provider },
  });
  assert.equal(child.status, 2);
  assert.match(child.stdout, provider === 'gemini' ? /GEMINI_API_KEY/ : /OPENAI_COMPAT_API_KEY.*OPENAI_COMPAT_MODEL_ID.*OPENAI_COMPAT_BASE_URL/);
});
