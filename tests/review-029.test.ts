import { listenForFetch } from '../scripts/test-server.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GameEngine } from '../server/engine.ts';
import { createGameServer } from '../server/http.ts';
import { GeminiProvider } from '../server/llm/gemini.ts';
import { OpenAICompatibleProvider } from '../server/llm/openai-compatible.ts';
import { CallBudget } from '../server/llm/budget.ts';
import { actionVocabulary, validateProposal } from '../server/llm/validator.ts';
import { hasUnsupportedClaim } from '../server/llm/claims.ts';
import { SecretGuard } from '../server/llm/secrets.ts';
import { RuntimeSettings } from '../server/llm/runtime-settings.ts';
import { ScriptedProvider } from './fixtures/scripted-provider.ts';
import { liveSource } from '../scripts/eval/provider-bridge.ts';
import { evaluate, humanSheet, inputFor } from '../scripts/eval/run.ts';
import { loadCases } from '../scripts/eval/fixtures.ts';
import type { Proposal, ProviderInput } from '../server/llm/types.ts';
import type { ActionPlan } from '../shared/contracts.ts';

// Independently authored review evidence, not the evaluation holdout.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/review-029.json', import.meta.url), 'utf8')) as {
  commands: { id: string; group: string; text: string; actions: ActionPlan[]; expected: 'accept' | 'block' }[];
  claims: { id: string; expected: 'allow' | 'block'; text: string }[];
  encodings: { variant: string; value: string }[]; ordinary: string[];
};
const input = (text: string): ProviderInput => ({ text, knowledge: { viewer: 'player', documents: [] }, context: [], actions: actionVocabulary() });
const base: Proposal = { intent: 'command', dialogue: '원문의 범위를 확인해 주십시오.', proposedActions: [], unresolvedQuestions: [],
  referencedKnowledgeIds: [], usage: { inputTokens: 0, outputTokens: 0, externalCalls: 0, costUsd: null } };

for (const c of fixture.commands) test(`029 ${c.id} ${c.group}`, async () => {
  const proposal = { ...base, proposedActions: c.actions };
  const result = validateProposal(proposal, input(c.text));
  const game = new GameEngine(undefined, undefined, new ScriptedProvider(proposal));
  await game.command({ type: 'submit', text: c.text });
  const draft = game.view().drafts.at(-1);
  if (draft) await game.command({ type: 'confirm', draftId: draft.id, version: draft.version });
  if (c.expected === 'block') {
    assert.equal(result.intent, 'ambiguous');
    assert.equal(game.view().tasks.length, 0, 'never execute a postponed/cancelled action');
  } else {
    assert.equal(result.intent, 'command');
    assert.deepEqual(result.unresolvedQuestions, []);
    assert.equal(game.view().tasks.length, c.actions.length);
  }
});
for (const c of fixture.claims) test(`029 ${c.id} ${c.expected} completion`, async () => {
  const dialogue = `${c.text} 주군의 판단을 기다리겠습니다.`;
  assert.equal(hasUnsupportedClaim(dialogue), c.expected === 'block');
  const game = new GameEngine(undefined, undefined, new ScriptedProvider({ ...base, intent: 'discussion', dialogue }));
  game.audience({ type: 'invite', participants: ['zhou-yu'] });
  const response = await game.talk({ characterId: 'zhou-yu', text: '현재 상황에 대한 견해는?' });
  assert.equal(response.turns.at(-1)?.text.includes(c.text), c.expected === 'allow');
  assert.equal(game.view().tasks.length, 0);
});
test('029 negation belongs to its predicate, not an independent completed action', () => {
  for (const text of ['정비는 아직 끝나지 않았습니다. 동맹은 맺었습니다.',
    '정비는 끝나지 않았지만 동맹은 맺었습니다.', '정비는 끝나지 않았고 동맹은 맺었습니다.',
    '동맹은 맺었습니다만 정비는 아직 끝나지 않았습니다.']) assert.equal(hasUnsupportedClaim(text), true, text);
  const fact = '수군 훈련은 완수했습니다.';
  assert.equal(hasUnsupportedClaim(fact, { facts: [fact] }), false);
  assert.equal(hasUnsupportedClaim(`${fact} 동맹을 맺어놨습니다.`, { facts: [fact] }), true);
});

const key = 'sk-Review-4Q8vL2nR7pS9xT5zA1bC6!'; // Synthetic only.
const guard = new SecretGuard(key);
const evalCase = (await loadCases('dev')).find(c => c.suite === 'npc')!;
for (const provider of ['gemini', 'openai-compatible'] as const) for (const { variant, value } of fixture.encodings) {
  test(`029 ${provider} ${variant} all output boundaries`, async t => {
    assert.equal(guard.reflects(`식별 문자열 ${value}.`), true);
    const dir = mkdtempSync(join(tmpdir(), 'throne-029-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
    const proposal = { ...base, intent: 'discussion', dialogue: `식별 문자열 ${value}. 주군의 판단을 기다리겠습니다.` };
    const requests: { url: string; body: string; auth: string | null }[] = [];
    const transport: typeof fetch = async (url, init) => {
      requests.push({ url: String(url), body: String(init?.body), auth: new Headers(init?.headers).get(provider === 'gemini' ? 'x-goog-api-key' : 'authorization') });
      return Response.json(provider === 'gemini' ? {
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(proposal) }] } }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3 },
      } : { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(proposal) } }], usage: { prompt_tokens: 12, completion_tokens: 3 } });
    };
    const env = { LLM_PROVIDER: provider, GEMINI_API_KEY: key, OPENAI_COMPAT_API_KEY: key,
      GEMINI_MODEL_ID: 'offline-review', OPENAI_COMPAT_MODEL_ID: 'offline-review', OPENAI_COMPAT_BASE_URL: 'https://offline.invalid/v1',
      LLM_DAILY_CALL_LIMIT: '10000', LLM_SESSION_CALL_LIMIT: '10000' };
    const source = liveSource(4, env, {}, { transport, budgetFile: join(dir, 'usage.json') })!;
    const sample = await source.sample(evalCase, inputFor(evalCase));
    assert.ok(sample.error); guard.assertSafe(sample);
    const result = await evaluate([evalCase], { ...source, async sample() { return { raw: proposal, attempts: [], reservations: 0 }; } }, { maxCalls: 4 });
    assert.ok(result.rows[0]!.error); guard.assertSafe(result); guard.assertSafe(humanSheet([evalCase], result.rows));
    const poisoned = structuredClone(result.rows); poisoned[0]!.sample.raw = proposal;
    assert.throws(() => humanSheet([evalCase], poisoned, guard), /INVALID_PROPOSAL/);
    // Isolate the HTTP budget too: parallel files must not contend on the
    // application's shared usage lock and skip the transport under test.
    const config = { model: 'offline-review', timeoutMs: 15000, retries: 0, dailyLimit: 10000, sessionLimit: 10000 };
    const budget = new CallBudget(config, join(dir, 'http-usage.json'));
    const httpProvider = provider === 'gemini' ? new GeminiProvider(config, transport, budget, key) :
      new OpenAICompatibleProvider({ ...config, baseUrl: 'https://offline.invalid/v1' }, transport, budget, key);
    const game = new GameEngine(undefined, undefined, httpProvider);
    game.audience({ type: 'invite', participants: ['zhou-yu'] });
    const api = createGameServer(game); await listenForFetch(api);
    try {
      const response = await fetch(`http://127.0.0.1:${(api.address() as { port: number }).port}/api/talk`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ characterId: 'zhou-yu', text: '현재 상황에 대한 견해는?' }),
      });
      assert.equal(response.status, 200);
      for (const output of [await response.text(), game.logs(), game.publicSnapshot(),
        readFileSync(join(dir, 'usage.json'), 'utf8'), readFileSync(join(dir, 'http-usage.json'), 'utf8')]) guard.assertSafe(output);
    } finally { api.closeAllConnections(); await new Promise<void>(resolve => api.close(() => resolve())); }
    // Check outside the transport: adapter error handling must not swallow a
    // failed assertion and turn it into the expected reflection rejection.
    assert.equal(requests.length, 2);
    for (const request of requests) {
      assert.equal(request.auth, provider === 'gemini' ? key : `Bearer ${key}`);
      guard.assertSafe(request.url); guard.assertSafe(request.body);
    }
  });
}
const ordinary = [...fixture.ordinary, 'Review 결과를 검토하겠습니다.', '수군 점검은 아직 끝나지 않았습니다.',
  'aGVsbG8gd29ybGQ=', 'aG Vs bG 8g d2 9y bG Q=', '68:65:6c:6c:6f', '48 65 6C 6C 6F',
  'https://example.invalid/path?q=hello-world', '2026-10-25 12:34:56', '{"inputTokens":12,"outputTokens":3}', 'YWJjZGVmZ2hpamtsbW5vcA'];
for (const [i, text] of ordinary.entries()) test(`029 ordinary secret guard ${i + 1}`, () => assert.equal(guard.reflects(text), false));
test('029 first startup has no model default or network call', () => {
  const runtime = new RuntimeSettings({ env: {}, transport: async () => { assert.fail('startup must not call transport'); } });
  assert.equal(runtime.status().model, ''); assert.equal(runtime.status().keyConfigured, false); assert.equal(runtime.status().mode, 'mock');
});
