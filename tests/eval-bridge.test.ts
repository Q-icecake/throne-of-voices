import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { liveSource } from '../scripts/eval/provider-bridge.ts';
import { loadCases } from '../scripts/eval/fixtures.ts';
import { inputFor } from '../scripts/eval/run.ts';

const fixture = (await loadCases('dev'))[0]!;
const replay = JSON.parse(readFileSync(new URL('./fixtures/eval-scripted-good.json', import.meta.url), 'utf8'));
const settings = (provider: string): NodeJS.ProcessEnv => ({
  LLM_PROVIDER: provider, GEMINI_API_KEY: 'fake-test-only', GEMINI_MODEL_ID: 'eval-model',
  OPENAI_COMPAT_API_KEY: 'fake-test-only', OPENAI_COMPAT_MODEL_ID: 'eval-model',
  OPENAI_COMPAT_BASE_URL: 'https://test.invalid/v1',
  LLM_RETRIES: '1', LLM_DAILY_CALL_LIMIT: '10', LLM_SESSION_CALL_LIMIT: '10',
});

for (const provider of ['gemini', 'openai-compatible'] as const) {
  test(`eval factory ${provider}: retries and every budget stop preserve failed usage and reservations`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'throne-eval-bridge-'));
    const original = globalThis.fetch;
    let external = 0;
    globalThis.fetch = async () => { external++; throw new Error('external transport forbidden'); };
    try {
      for (const scenario of ['retry', 'call', 'tokens', 'cost', 'unknown', 'daily', 'session'] as const) {
        let calls = 0;
        const env = settings(provider);
        if (scenario === 'daily') env.LLM_DAILY_CALL_LIMIT = '1';
        if (scenario === 'session') env.LLM_SESSION_CALL_LIMIT = '1';
        const transport: typeof fetch = async (url, init) => {
          calls++;
          assert.match(String(url), provider === 'gemini' ? /generativelanguage\.googleapis\.com/ : /^https:\/\/test\.invalid\/v1\/chat\/completions$/);
          const headers = new Headers(init?.headers);
          assert.equal(headers.get(provider === 'gemini' ? 'x-goog-api-key' : 'Authorization'), provider === 'gemini' ? 'fake-test-only' : 'Bearer fake-test-only');
          const body = scenario === 'unknown' ? {} : provider === 'gemini' ?
            { usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3 } } : { usage: { prompt_tokens: 12, completion_tokens: 3 } };
          return new Response(JSON.stringify(body), { status: 500 });
        };
        const limits = scenario === 'tokens' ? { maxTokens: 15 } : scenario === 'cost' ?
          { budgetUsd: .015, inputPrice: 1000, outputPrice: 1000 } : scenario === 'unknown' ? { maxTokens: 100 } : {};
        const budgetFile = join(dir, `${scenario}.json`);
        const source = liveSource(scenario === 'call' ? 1 : 3, env, limits, { transport, budgetFile });
        assert.ok(source);
        assert.equal(source.model, `${provider}/eval-model`);
        const result = await source.sample(fixture, inputFor(fixture));
        assert.equal(calls, scenario === 'retry' ? 2 : 1, scenario);
        assert.equal(result.reservations, calls, scenario);
        assert.equal(result.attempts.length, calls, scenario);
        assert.equal(JSON.parse(readFileSync(budgetFile, 'utf8')).calls, calls, scenario);
        for (const attempt of result.attempts) {
          assert.equal(attempt.inputTokens, scenario === 'unknown' ? null : 12);
          assert.equal(attempt.outputTokens, scenario === 'unknown' ? null : 3);
          assert.equal(attempt.error, 'HTTP_500');
        }
        assert.equal(result.error, ({ retry: 'PROVIDER_ERROR', call: 'CALL_LIMIT', tokens: 'TOKEN_BUDGET',
          cost: 'COST_BUDGET', unknown: 'USAGE_UNKNOWN', daily: 'CALL_LIMIT', session: 'CALL_LIMIT' })[scenario]);
        assert.ok(!JSON.stringify(result).includes('fake-test-only'));
      }
      assert.equal(external, 0);
    } finally { globalThis.fetch = original; rmSync(dir, { recursive: true, force: true }); }
  });

  test(`eval factory ${provider}: successful proposal and configuration rejection use explicit environment`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'throne-eval-success-'));
    let calls = 0;
    const transport: typeof fetch = async () => {
      calls++;
      const text = JSON.stringify(replay.responses[fixture.id]);
      return new Response(JSON.stringify(provider === 'gemini' ? {
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }],
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3 },
      } : { choices: [{ finish_reason: 'stop', message: { content: text } }], usage: { prompt_tokens: 12, completion_tokens: 3 } }));
    };
    try {
      const env = settings(provider), runtime = { transport, budgetFile: join(dir, 'budget.json') };
      const key = provider === 'gemini' ? 'GEMINI_API_KEY' : 'OPENAI_COMPAT_API_KEY';
      const model = provider === 'gemini' ? 'GEMINI_MODEL_ID' : 'OPENAI_COMPAT_MODEL_ID';
      for (const invalid of [{ ...env, [key]: '' }, { ...env, [model]: 'test-only' },
        { ...env, LLM_PROVIDER: 'mock' }, { ...env, LLM_DAILY_CALL_LIMIT: '0' }]) {
        assert.equal(liveSource(2, invalid, {}, runtime), undefined);
      }
      if (provider === 'openai-compatible') assert.equal(liveSource(2, { ...env, OPENAI_COMPAT_BASE_URL: 'http://test.invalid' }, {}, runtime), undefined);
      assert.equal(calls, 0);
      const source = liveSource(2, env, {}, runtime);
      assert.ok(source);
      const result = await source.sample(fixture, inputFor(fixture));
      assert.equal(result.error, undefined);
      assert.ok(result.raw);
      assert.equal(result.reservations, 1);
      assert.equal(calls, 1);
      assert.equal(result.attempts[0]!.inputTokens, 12);
      assert.equal(result.attempts[0]!.outputTokens, 3);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
