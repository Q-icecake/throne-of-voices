import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { loadCases } from '../scripts/eval/fixtures.ts';
import { evaluate, humanSheet, promptVersion } from '../scripts/eval/run.ts';
import { mockSource, scriptedSource } from '../scripts/eval/sources.ts';
import { observedTransport, liveSource } from '../scripts/eval/provider-bridge.ts';
import type { Attempt, Sample, Source } from '../scripts/eval/types.ts';

const cases = (await loadCases('dev')).slice(0, 3);
const replay = JSON.parse(await readFile(new URL('./fixtures/eval-scripted-good.json', import.meta.url), 'utf8'));
const sample = (index: number, attempts: Attempt[] = []): Sample => ({ raw: replay.responses[cases[index]!.id], attempts, reservations: attempts.length });
const usage = (inputTokens: number | null, outputTokens: number | null, latencyMs = 10): Attempt => ({ inputTokens, outputTokens, latencyMs });
const sequence = (...steps: (Sample | Error)[]): Source => ({ model: 'test-only', timeoutMs: 20, async sample() {
  const step = steps.shift(); if (!step) throw new Error('exhausted'); if (step instanceof Error) throw step; return step;
} });

test('eval continues after case errors, preserves retry/failure usage and p50/p95', async () => {
  const failed = { ...usage(12, 3, 10), error: 'HTTP_500' };
  const result = await evaluate(cases, sequence(
    { error: 'PROVIDER_ERROR', attempts: [failed, { ...usage(null, null, 20), error: 'PROVIDER_ERROR' }], reservations: 2 },
    sample(1, [usage(20, 4, 30)]), sample(2, [usage(30, 6, 40)])), { maxCalls: 8 });
  assert.equal(result.rows.length, 3); assert.equal(result.totals.attempts, 4); assert.equal(result.totals.retries, 1);
  assert.equal(result.totals.failedInputTokensKnown, 12); assert.equal(result.totals.failedOutputTokensKnown, 3);
  assert.equal(result.totals.missingUsageAttempts, 1); assert.equal(result.totals.inputTokensKnown, 62);
  assert.equal(result.totals.p50Ms, 20); assert.equal(result.totals.p95Ms, 40);
});
test('eval catches provider exception and still evaluates next case', async () => {
  const result = await evaluate(cases, sequence(new Error('sensitive upstream error'), sample(1), sample(2)), { maxCalls: 3 });
  assert.equal(result.rows.length, 3); assert.equal(result.rows[0]!.error, 'PROVIDER_ERROR');
  assert.ok(!JSON.stringify(result).includes('sensitive'));
});
for (const [name, limits, first, reason] of [
  ['calls', { maxCalls: 1 }, usage(1, 1), 'CALL_LIMIT'],
  ['tokens', { maxCalls: 10, maxTokens: 10 }, usage(8, 2), 'TOKEN_BUDGET'],
  ['cost', { maxCalls: 10, budgetUsd: .01, inputPrice: 1000, outputPrice: 1000 }, usage(8, 2), 'COST_BUDGET'],
  ['unknown usage', { maxCalls: 10, maxTokens: 100 }, usage(null, null), 'USAGE_UNKNOWN'],
] as const) {
  test(`eval safely stops on ${name}`, async () => {
    const result = await evaluate(cases, sequence(sample(0, [first])), limits);
    assert.equal(result.stopped, reason); assert.equal(result.rows.length, 1); assert.equal(result.skipped.length, 2);
  });
}
test('eval provider CALL_LIMIT stops immediately and records error', async () => {
  const result = await evaluate(cases, sequence({ error: 'CALL_LIMIT', attempts: [], reservations: 0 }), { maxCalls: 5 });
  assert.equal(result.stopped, 'CALL_LIMIT'); assert.equal(result.rows.length, 1); assert.equal(result.totals.attempts, 0);
});
test('eval offline adapter uses existing mock and no external calls', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network forbidden'); };
  try {
    const result = await evaluate(cases, mockSource(), { maxCalls: Infinity });
    assert.equal(result.totals.attempts, 0); assert.equal(result.rows.length, cases.length);
  } finally { globalThis.fetch = original; }
});
test('eval scripted missing ID is a case error; mismatched split is rejected', async () => {
  const source = scriptedSource({ version: 1, split: 'dev', responses: {} }, 'dev');
  const result = await evaluate(cases, source, { maxCalls: Infinity });
  assert.equal(result.totals.errors, 3);
  assert.throws(() => scriptedSource({ version: 1, split: 'final', responses: {} }, 'dev'));
});
test('eval human review exports separate raw/validated and blank 1–5 columns', async () => {
  const result = await evaluate(cases, scriptedSource(replay, 'dev'), { maxCalls: Infinity });
  const sheet = humanSheet(cases, result.rows);
  assert.equal(sheet.length, 3); assert.equal(sheet[0]!.tone_1_5, null);
  assert.ok(sheet[0]!.raw); assert.ok(sheet[0]!.validated);
  assert.match(await promptVersion(), /^eval-v2:[a-f0-9]{64}$/);
});
test('eval transport records numeric usage on failed HTTP, leaves original body readable', async () => {
  const attempts: Attempt[] = [];
  const body = { usageMetadata: { promptTokenCount: 17, candidatesTokenCount: 4 }, error: 'private upstream text' };
  const fake: typeof fetch = async () => new Response(JSON.stringify(body), { status: 500 });
  const transport = observedTransport(fake, attempts, 1);
  const result = await transport('https://test.invalid');
  assert.deepEqual(await result.json(), body);
  assert.equal(attempts[0]!.inputTokens, 17); assert.equal(attempts[0]!.outputTokens, 4);
  assert.equal(attempts[0]!.error, 'HTTP_500');
  assert.ok(!JSON.stringify(attempts).includes('private'));
  await assert.rejects(() => transport('https://test.invalid'), /CALL_LIMIT/);
  assert.equal(attempts.length, 1);
});
test('eval transport accounts for network errors and malformed/missing usage', async () => {
  const attempts: Attempt[] = [];
  const fake: typeof fetch = async () => { throw new Error('private failure'); };
  await assert.rejects(() => observedTransport(fake, attempts, 2)('https://test.invalid'));
  assert.equal(attempts[0]!.inputTokens, null); assert.equal(attempts[0]!.error, 'PROVIDER_ERROR');
  const malformed: typeof fetch = async () => new Response(JSON.stringify({ usageMetadata: { promptTokenCount: -1, candidatesTokenCount: '2' } }));
  await observedTransport(malformed, attempts, 2)('https://test.invalid');
  assert.equal(attempts[1]!.inputTokens, null); assert.equal(attempts[1]!.outputTokens, null);
});
test('eval transport guard prevents retry before fetch starts', async () => {
  let calls = 0;
  const fake: typeof fetch = async () => { calls++; return new Response('{}'); };
  await assert.rejects(() => observedTransport(fake, [], 3, () => { throw new Error('budget'); })('https://test.invalid'), /budget/);
  assert.equal(calls, 0);
});
test('eval live gate rejects missing key/model/provider/positive bounds without constructing transport', () => {
  for (const env of [{}, { LLM_PROVIDER: 'mock' }, { LLM_PROVIDER: 'unknown' }, { LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'fake-test-only' },
    { LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'fake-test-only', GEMINI_MODEL_ID: 'test', LLM_DAILY_CALL_LIMIT: '0', LLM_SESSION_CALL_LIMIT: '1' }])
    assert.equal(liveSource(2, env), undefined);
  assert.equal(liveSource(0, {}), undefined); assert.equal(liveSource(Infinity, {}), undefined);
});
test('eval CLI no mode and absent-key live execute zero calls; invalid flags fail closed', () => {
  const env = { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, LLM_PROVIDER: 'mock' };
  const run = (...args: string[]) => spawnSync(process.execPath, ['scripts/eval-llm.ts', ...args], { encoding: 'utf8', env });
  const noMode = run(); assert.equal(noMode.status, 0); assert.match(noMode.stdout, /0회/);
  const live = run('--live', '--max-calls', '2'); assert.equal(live.status, 2); assert.match(live.stdout, /0회/);
  for (const args of [['--mock', '--live'], ['--mock', '--max-calls', '0'], ['--mock', '--split', 'oops'], ['--scripted'], ['--unknown']])
    assert.equal(run(...args).status, 2);
});
test('eval actual provider bridge accounts for zero retries, failed tokens, and next-case budget stops using fake transport only', () => {
  const code = `
    import assert from 'node:assert/strict';
    import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { liveSource } from './scripts/eval/provider-bridge.ts';
    import { loadCases } from './scripts/eval/fixtures.ts';
    import { inputFor } from './scripts/eval/run.ts';
    const dir=mkdtempSync(join(tmpdir(),'throne-eval-test-'));
    const fixture=(await loadCases('dev'))[0];
    for(const scenario of ['retry','call','tokens','cost','unknown']) {
      let calls=0;
      const transport=async()=>{
        calls++;
        return new Response(JSON.stringify(scenario==='unknown'?{}:{usageMetadata:{promptTokenCount:12,candidatesTokenCount:3}}),{status:500});
      };
      const limits=scenario==='tokens'?{maxTokens:15}:scenario==='cost'?{budgetUsd:.015,inputPrice:1000,outputPrice:1000}:scenario==='unknown'?{maxTokens:100}:{};
      const source=liveSource(scenario==='call'?1:3,process.env,limits,{transport,budgetFile:join(dir,scenario+'.json')});
      assert.ok(source);
      const result=await source.sample(fixture,inputFor(fixture));
      assert.equal(calls,1);
      assert.equal(result.attempts.length,calls);
      assert.equal(result.reservations,calls);
      assert.equal(result.attempts[0].inputTokens,scenario==='unknown'?null:12);
      assert.equal(result.error,'PROVIDER_ERROR');
      const next=await source.sample(fixture,inputFor(fixture));
      assert.equal(calls,scenario==='retry'?2:1);
      assert.equal(next.reservations,scenario==='retry'?1:0);
      assert.equal(next.attempts.length,next.reservations);
      assert.equal(next.error,({retry:'PROVIDER_ERROR',call:'CALL_LIMIT',tokens:'TOKEN_BUDGET',cost:'COST_BUDGET',unknown:'USAGE_UNKNOWN'})[scenario]);
    }
    // Child has no NODE_TEST_CONTEXT or LLM_USAGE_FILE: explicit budget must also isolate diagnostics.
    const diagnostics=readFileSync(join(dir,'llm-diagnostics.jsonl'),'utf8').trim().split('\\n').map(line=>JSON.parse(line));
    assert.equal(diagnostics.length,6);
    assert.ok(diagnostics.every(row=>row.model==='eval-model' && row.httpStatus===500));
    assert.ok(diagnostics.every(row=>row.source==='test'));
    rmSync(dir,{recursive:true,force:true});
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    encoding: 'utf8', env: { SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
      // Keep the synthetic model distinct from the fake key's protected fragments.
      LLM_DIAGNOSTIC_SOURCE: 'test', LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'fake-test-only', GEMINI_MODEL_ID: 'eval-model', LLM_RETRIES: '1', LLM_DAILY_CALL_LIMIT: '10', LLM_SESSION_CALL_LIMIT: '10' },
  });
  assert.equal(child.status, 0, child.stderr);
});
