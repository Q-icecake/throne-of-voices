import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CallBudget, GeminiProvider, configuredProvider, geminiConfig } from '../server/llm/gemini.ts';
import type { GeminiConfig } from '../server/llm/gemini.ts';
import { interpret } from '../server/llm/pipeline.ts';
import { actionVocabulary, validateProposal } from '../server/llm/validator.ts';
import { GameEngine } from '../server/engine.ts';
import { execFileSync } from 'node:child_process';

const config: GeminiConfig = { model: 'test-model-not-live', timeoutMs: 100, retries: 0, dailyLimit: 4, sessionLimit: 4 };
const input = { text: '수군 정비', knowledge: new GameEngine().view().knowledge, context: [], actions: actionVocabulary() };
const output = { intent: 'command', dialogue: '수군 정비 초안을 검토해 주십시오.', proposedActions: [
  { kind: 'naval-drill', target: 'jiangdong-navy', assignee: 'zhou-yu', conditions: [], restrictions: [], deadline: null }],
  unresolvedQuestions: [], referencedKnowledgeIds: [], usage: { inputTokens: 0, outputTokens: 0, externalCalls: 0, costUsd: null } };
function response(text = JSON.stringify(output)) {
  return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }],
    usageMetadata: { promptTokenCount: 123, candidatesTokenCount: 45 } });
}
function budget(settings = config) {
  const file = join(mkdtempSync(join(tmpdir(), 'throne-m2-budget-')), 'usage.json');
  return { file, value: new CallBudget(settings, file) };
}

test('Gemini no-key selection is explicit Mock, no fetch, and evaluation exits immediately', async t => {
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('network forbidden'); });
  const savedKey = process.env.GEMINI_API_KEY;
  const savedProvider = process.env.LLM_PROVIDER;
  delete process.env.GEMINI_API_KEY;
  process.env.LLM_PROVIDER = 'gemini';
  t.after(() => {
    if (savedKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = savedKey;
    if (savedProvider === undefined) delete process.env.LLM_PROVIDER; else process.env.LLM_PROVIDER = savedProvider;
  });
  assert.deepEqual(configuredProvider(), { status: 'AI 미연결, Mock 사용 중', timeoutMs: 15000 });
  const provider = new GeminiProvider(config);
  assert.match(provider.status, /Mock/);
  await assert.rejects(provider.interpret(input, new AbortController().signal), /PROVIDER_ERROR/);
  const result = execFileSync(process.execPath, ['scripts/eval-llm.ts'], { encoding: 'utf8' });
  assert.match(result, /외부 호출 0회/);
});

test('Gemini environment config has no default model or nonzero call allowance', () => {
  assert.equal(geminiConfig({}), undefined);
  assert.deepEqual(geminiConfig({ GEMINI_MODEL_ID: 'configured-model' }), {
    model: 'configured-model', timeoutMs: 15000, retries: 0, dailyLimit: 0, sessionLimit: 0,
    rpmLimit: 12, tpmLimit: 200000, maxWaitMs: 8000,
  });
  for (const env of [{ LLM_TIMEOUT_MS: '15001' }, { LLM_TIMEOUT_MS: '0' }, { LLM_RETRIES: '-1' },
    { LLM_DAILY_CALL_LIMIT: 'NaN' }, { LLM_SESSION_CALL_LIMIT: '1.5' }, { GEMINI_MODEL_ID: '../bad?key=x' }]) {
    assert.equal(geminiConfig({ GEMINI_MODEL_ID: 'model', ...env }), undefined);
  }
});

test('Gemini fake transport: structured JSON, header-only key, actual metadata, retries/caps and safe failures', async t => {
  const saved = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'SYNTHETIC_TEST_KEY_NOT_REAL';
  t.after(() => { if (saved === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = saved; });
  // All adapters below inject transports. An accidental default transport must fail this suite.
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('external network forbidden'); });

  await t.test('request shape and usage from fake envelope', async () => {
    let calls = 0;
    const transport: typeof fetch = async (url, init) => {
      calls++;
      assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/test-model-not-live:generateContent');
      assert.equal(new Headers(init!.headers).get('x-goog-api-key'), 'SYNTHETIC_TEST_KEY_NOT_REAL');
      assert.equal(init!.redirect, 'error');
      assert.ok(!String(init!.body).includes('SYNTHETIC_TEST_KEY_NOT_REAL'));
      const body = JSON.parse(String(init!.body));
      assert.equal(body.generationConfig.responseMimeType, 'application/json');
      assert.equal(body.generationConfig.responseJsonSchema.additionalProperties, false);
      assert.match(body.systemInstruction.parts[0].text, /한국어/);
      assert.deepEqual(JSON.parse(body.contents[0].parts[0].text), input);
      return response();
    };
    const provider = new GeminiProvider(config, transport, budget().value);
    const result = await interpret(provider, input, 100);
    assert.deepEqual(result.usage, { inputTokens: 123, outputTokens: 45, externalCalls: 1, costUsd: null });
    assert.equal(calls, 1);
    assert.ok(!JSON.stringify(result).includes('SYNTHETIC_TEST_KEY_NOT_REAL'));
  });

  await t.test('5xx retries consume limits, 429 does not retry', async () => {
    let calls = 0;
    const settings = { ...config, retries: 2 };
    const provider = new GeminiProvider(settings, async () => ++calls === 1 ? new Response('', { status: 503 }) : response(), budget(settings).value);
    const result = await interpret(provider, input, 100);
    assert.equal(result.usage.externalCalls, 2);
    calls = 0;
    const limited = new GeminiProvider(settings, async () => { calls++; return new Response('SECRET', { status: 429 }); }, budget(settings).value);
    await assert.rejects(limited.interpret(input, new AbortController().signal), /CALL_LIMIT/);
    assert.equal(calls, 1);
  });

  await t.test('daily and session caps reserve before fetch, including failed retries', async () => {
    const settings = { ...config, retries: 3, sessionLimit: 1 };
    let calls = 0;
    const b = budget(settings);
    const provider = new GeminiProvider(settings, async () => { calls++; throw new Error('PRIVATE_HEADER'); }, b.value);
    await assert.rejects(provider.interpret(input, new AbortController().signal), /CALL_LIMIT/);
    assert.equal(calls, 1);
    assert.equal(JSON.parse(readFileSync(b.file, 'utf8')).calls, 1);
    const daily = { ...config, dailyLimit: 1 };
    const restarted = new GeminiProvider(daily, async () => { assert.fail('must not fetch after restart'); }, new CallBudget(daily, b.file));
    await assert.rejects(restarted.interpret(input, new AbortController().signal), /CALL_LIMIT/);
  });

  await t.test('safe errors for invalid JSON, echoed key, authentication failure and hanging fetch', async () => {
    const cases: [typeof fetch, string][] = [
      [async () => response('bad JSON'), 'INVALID_PROPOSAL'],
      [async () => response(JSON.stringify({ ...output, dialogue: '키 SYNTHETIC_TEST_KEY_NOT_REAL' })), 'INVALID_PROPOSAL'],
      [async () => new Response('PRIVATE_AUTH_HEADER', { status: 401 }), 'PROVIDER_ERROR'],
      [async () => { throw new Error('PRIVATE_AUTH_HEADER'); }, 'PROVIDER_ERROR'],
      [async () => new Promise(() => {}), 'PROVIDER_TIMEOUT'],
    ];
    for (const [transport, code] of cases) {
      const settings = { ...config, timeoutMs: 10 };
      const provider = new GeminiProvider(settings, transport, budget(settings).value);
      await assert.rejects(provider.interpret(input, new AbortController().signal), error => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, code);
        return true;
      });
    }
  });
});

test('budget rolls UTC date but not session, and corrupt/locked files fail closed', () => {
  const settings = { ...config, dailyLimit: 1, sessionLimit: 2 };
  const b = budget(settings);
  let now = new Date('2026-10-25T23:59:00Z');
  const quota = new CallBudget(settings, b.file, () => now);
  quota.reserve();
  assert.throws(() => quota.reserve(), /CALL_LIMIT/);
  now = new Date('2026-10-26T00:01:00Z');
  quota.reserve();
  now = new Date('2026-10-27T00:01:00Z');
  assert.throws(() => quota.reserve(), /CALL_LIMIT/);
  writeFileSync(b.file, 'corrupt');
  assert.throws(() => new CallBudget(config, b.file).reserve(), /CALL_LIMIT/);
  writeFileSync(b.file + '.lock', '');
  assert.throws(() => new CallBudget(config, b.file).reserve(), /CALL_LIMIT/);
});

test('evaluation fixture is bounded, unique, and supported conditions survive server validation', () => {
  const fixtures = JSON.parse(readFileSync(new URL('./fixtures/llm-eval.json', import.meta.url), 'utf8')) as
    { id: string; text: string; intent: string; restrictions: string[] }[];
  assert.ok(fixtures.length >= 20 && fixtures.length <= 40);
  assert.equal(new Set(fixtures.map(item => item.id)).size, fixtures.length);
  for (const fixture of fixtures.filter(item => item.intent === 'command')) {
    const result = validateProposal({ ...output, proposedActions: [{ ...output.proposedActions[0], restrictions: fixture.restrictions }] }, { ...input, text: fixture.text });
    assert.equal(result.intent, 'command', fixture.text);
  }
});
