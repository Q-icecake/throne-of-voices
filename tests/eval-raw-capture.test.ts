import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { configuredProvider } from '../server/llm/config.ts';
import { CallBudget } from '../server/llm/budget.ts';
import { liveSource } from '../scripts/eval/provider-bridge.ts';
import { captureModelRaw, MODEL_RAW_MAX_BYTES } from '../scripts/eval/capture.ts';
import { loadCases } from '../scripts/eval/fixtures.ts';
import { evaluate, inputFor, main, parseOptions, selectCases } from '../scripts/eval/run.ts';
import { validateProposal } from '../server/llm/validator.ts';

const cases = await loadCases('dev');
const gold = JSON.parse(readFileSync(new URL('./fixtures/eval-scripted-good.json', import.meta.url), 'utf8'));
const key = 'Q8h3Z6s9D4t7R2x5-eval036';
function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'throne-eval-036-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const logs: unknown[] = []; t.mock.method(console, 'info', (v: unknown) => logs.push(v));
  return { dir, logs, budgetFile: join(dir, 'usage.json') };
}
const settings = (provider: string): NodeJS.ProcessEnv => ({ LLM_PROVIDER: provider,
  GEMINI_API_KEY: key, GEMINI_MODEL_ID: 'eval-model', OPENAI_COMPAT_API_KEY: key,
  OPENAI_COMPAT_MODEL_ID: 'eval-model', OPENAI_COMPAT_BASE_URL: 'https://test.invalid/v1',
  LLM_DAILY_CALL_LIMIT: '30', LLM_SESSION_CALL_LIMIT: '30' });
const envelope = (provider: string, raw: unknown) => Response.json(provider === 'gemini' ? {
  candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(raw) }] } }],
  usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3 },
} : { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(raw) } }],
  usage: { prompt_tokens: 12, completion_tokens: 3 } });

for (const provider of ['gemini', 'openai-compatible']) {
  test(`036 ${provider}: preserve original before adapter correction and usage replacement`, async t => {
    const f = setup(t), fixture = cases[0]!;
    const raw = structuredClone(gold.responses[fixture.id]);
    raw.proposedActions[0].restrictions = ['no-first-strike']; // invented restriction, rejected internally
    raw.usage.inputTokens = 999;
    const source = liveSource(1, settings(provider), {}, { budgetFile: f.budgetFile,
      transport: async () => envelope(provider, raw) })!;
    const result = await evaluate([fixture], source, { maxCalls: 1 });
    const row = result.rows[0]!;
    assert.deepEqual(row.modelRaw, raw);
    assert.equal(row.modelRawStatus, 'captured');
    assert.equal(row.modelRawScore.intent, 'command');
    assert.ok(row.modelRawScore.issues.includes('actions.0.restrictions'));
    assert.equal((row.adapterOutput as { intent: string }).intent, 'ambiguous');
    assert.equal(row.adapterScore.intent, 'ambiguous'); assert.equal(row.validatedScore.intent, 'ambiguous');
    assert.equal((row.adapterOutput as { usage: { inputTokens: number } }).usage.inputTokens, 12);
    assert.ok(!JSON.stringify(result).includes(key));
    assert.ok(!JSON.stringify(f.logs).includes(raw.dialogue));
  });

  test(`036 ${provider}: schema-rejected four-action JSON is still captured exactly`, async t => {
    const f = setup(t), fixture = cases[0]!, raw = structuredClone(gold.responses[fixture.id]);
    raw.proposedActions = Array.from({ length: 4 }, () => structuredClone(raw.proposedActions[0]));
    const source = liveSource(1, settings(provider), {}, { budgetFile: f.budgetFile,
      transport: async () => envelope(provider, raw) })!;
    const { rows } = await evaluate([fixture], source, { maxCalls: 1 });
    assert.deepEqual(rows[0]!.modelRaw, raw); assert.equal(rows[0]!.adapterOutput, undefined);
    assert.equal(rows[0]!.sample.neutralError, 'schema');
    assert.ok(rows[0]!.modelRawScore.issues.includes('schema'));
    assert.equal(rows[0]!.validator, 'not-run');
  });

  test(`036 ${provider}: parseable non-object JSON is captured before schema rejection`, async t => {
    const f = setup(t), raw = [gold.responses[cases[0]!.id]];
    const source = liveSource(1, settings(provider), {}, { budgetFile: f.budgetFile,
      transport: async () => envelope(provider, raw) })!;
    const { rows } = await evaluate(cases.slice(0, 1), source, { maxCalls: 1 });
    assert.deepEqual(rows[0]!.modelRaw, raw); assert.equal(rows[0]!.modelRawStatus, 'captured');
    assert.equal(rows[0]!.sample.neutralError, 'schema'); assert.equal(rows[0]!.modelRawScore.pass, false);
  });

  test(`036 ${provider}: missing model usage fails original grade despite adapter repair`, async t => {
    const f = setup(t), fixture = cases[0]!, raw = structuredClone(gold.responses[fixture.id]);
    delete raw.usage;
    const source = liveSource(1, settings(provider), {}, { budgetFile: f.budgetFile,
      transport: async () => envelope(provider, raw) })!;
    const { rows } = await evaluate([fixture], source, { maxCalls: 1 });
    assert.deepEqual(rows[0]!.modelRaw, raw); assert.ok(rows[0]!.modelRawScore.issues.includes('schema'));
    assert.equal(rows[0]!.adapterScore.pass, true); assert.equal(rows[0]!.validatedScore.pass, true);
  });

  test(`036 ${provider}: HTTP 429 is unavailable original with rate-limit cause, next IDs skipped`, async t => {
    const f = setup(t); let calls = 0;
    const source = liveSource(3, settings(provider), {}, { budgetFile: f.budgetFile,
      transport: async () => { calls++; return new Response('{}', { status: 429 }); } })!;
    const result = await evaluate(cases.slice(0, 3), source, { maxCalls: 3 });
    assert.equal(calls, 1); assert.equal(result.rows[0]!.modelRaw, undefined);
    assert.equal(result.rows[0]!.modelRawStatus, 'not-received');
    assert.equal(result.rows[0]!.sample.neutralError, 'rate_limited');
    assert.equal(result.rows[0]!.error, 'CALL_LIMIT'); assert.equal(result.skipped.length, 2);
  });

  test(`036 ${provider}: key reflection cannot be captured even in schema-invalid fields`, async t => {
    const f = setup(t), fixture = cases[0]!;
    const raw = { ...gold.responses[fixture.id], unknown: key };
    const source = liveSource(1, settings(provider), {}, { budgetFile: f.budgetFile,
      transport: async () => envelope(provider, raw) })!;
    const result = await evaluate([fixture], source, { maxCalls: 1 });
    assert.equal(result.rows[0]!.modelRaw, undefined); assert.equal(result.rows[0]!.adapterOutput, undefined);
    assert.ok(!JSON.stringify([result, f.logs]).includes(key));
  });

  test(`036 ${provider}: capture resets after schema rejection and next successful case`, async t => {
    const f = setup(t); let calls = 0;
    const source = liveSource(3, settings(provider), {}, { budgetFile: f.budgetFile, transport: async () => {
      const index = calls++;
      return index === 0 ? envelope(provider, { intent: 'command', invalidField: '원문 형식 오류' }) :
        index === 1 ? new Response('{}', { status: 500 }) : envelope(provider, gold.responses[cases[index]!.id]);
    } })!;
    const result = await evaluate(cases.slice(0, 3), source, { maxCalls: 3 });
    assert.equal(calls, 3); assert.equal(result.rows[0]!.modelRawStatus, 'captured');
    assert.equal(result.rows[1]!.modelRaw, undefined); assert.equal(result.rows[1]!.modelRawStatus, 'not-received');
    assert.deepEqual(result.rows[2]!.modelRaw, gold.responses[cases[2]!.id]);
  });

  test(`036 ${provider}: normal game factory does not retain or expose original`, async t => {
    const f = setup(t), env = settings(provider), config = { model: 'eval-model', timeoutMs: 15000, retries: 0, dailyLimit: 3, sessionLimit: 3 };
    const selected = configuredProvider(env, async () => envelope(provider, gold.responses[cases[0]!.id]),
      { budget: new CallBudget(config, f.budgetFile) });
    const result = await selected.provider!.interpret(inputFor(cases[0]!), AbortSignal.timeout(15000));
    assert.ok(result); assert.ok(!Object.hasOwn(result as object, 'modelRaw'));
    assert.ok(!Object.hasOwn(selected.provider!, 'modelRaw'));
    assert.ok(!JSON.stringify(f.logs).includes('proposedActions'));
    assert.deepEqual(readdirSync(f.dir).sort(), provider === 'gemini' ? ['llm-diagnostics.jsonl', 'usage.json'] : ['usage.json']);
  });

  for (const scenario of ['oversize', 'prompt-field', 'prompt-text', 'header'] as const)
    test(`036 ${provider}: ${scenario} never enters report originals or adapter aliases`, async t => {
      const f = setup(t), raw = structuredClone(gold.responses[cases[0]!.id]);
      const marker = 'PRIVATE_CAPTURE_EXCLUDED';
      if (scenario === 'oversize') raw.dialogue = marker + '한'.repeat(6000);
      if (scenario === 'prompt-field') raw.prompt = marker;
      if (scenario === 'prompt-text') raw.dialogue = readFileSync('server/llm/system.ko.txt', 'utf8').trim();
      if (scenario === 'header') raw.headers = { Authorization: marker };
      const exit = await main(['--live', '--ids', cases[0]!.id, '--max-calls', '1'], { env: settings(provider),
        outputRoot: join(f.dir, 'reports'), log: () => {},
        live: { budgetFile: f.budgetFile, transport: async () => envelope(provider, raw) } });
      assert.equal(exit, 2);
      const dir = join(f.dir, 'reports', readdirSync(join(f.dir, 'reports'))[0]!);
      const result = JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8'));
      assert.equal(result.rows[0].modelRawStatus, scenario === 'oversize' ? 'oversize' : 'blocked');
      assert.equal(result.rows[0].modelRaw, undefined); assert.equal(result.rows[0].adapterOutput, undefined);
      const exports = readdirSync(dir).map(p => readFileSync(join(dir, p), 'utf8')).join('');
      assert.ok(!exports.includes(marker)); assert.ok(!exports.includes(key));
      assert.ok(!exports.includes(JSON.stringify(raw.dialogue).slice(1, -1)));
    });
}

test('036 truncated and invalid JSON keep precise neutral causes without inventing originals', async t => {
  const f = setup(t); let calls = 0;
  const source = liveSource(2, settings('gemini'), {}, { budgetFile: f.budgetFile, transport: async () =>
    Response.json({ candidates: [{ finishReason: calls++ === 0 ? 'MAX_TOKENS' : 'STOP', content: { parts: [{ text: '{invalid' }] } }] }) })!;
  const result = await evaluate(cases.slice(0, 2), source, { maxCalls: 2 });
  assert.deepEqual(result.rows.map(r => r.sample.neutralError), ['truncated', 'parse']);
  assert.ok(result.rows.every(r => r.modelRawStatus === 'not-received' && r.modelRaw === undefined));
});

test('036 capture size is UTF-8 bounded; no truncation, prompt/header fields withheld whole', () => {
  assert.deepEqual(captureModelRaw(undefined), { modelRawStatus: 'not-received' });
  assert.equal(captureModelRaw({ dialogue: '한'.repeat(MODEL_RAW_MAX_BYTES / 3) }).modelRawStatus, 'oversize');
  for (const raw of [{ prompt: 'system content' }, { headers: { Authorization: 'value' } },
    { nested: [{ api_key: 'value' }] }, { dialogue: readFileSync('server/llm/system.ko.txt', 'utf8').trim() }]) {
    assert.deepEqual(captureModelRaw(raw), { modelRawStatus: 'blocked' });
  }
});

test('036 export boundary clears oversized originals from an injected source that claims captured', async () => {
  const marker = 'OVERSIZED_MUST_NOT_EXPORT';
  const result = await evaluate(cases.slice(0, 1), { model: 'offline/check', timeoutMs: 15000,
    async sample() { return { modelRaw: { dialogue: marker + '한'.repeat(6000) }, modelRawStatus: 'captured',
      raw: gold.responses[cases[0]!.id], attempts: [], reservations: 0 }; } }, { maxCalls: 1 });
  assert.equal(result.rows[0]!.modelRawStatus, 'oversize'); assert.equal(result.rows[0]!.modelRaw, undefined);
  assert.equal(result.rows[0]!.sample.modelRaw, undefined); assert.ok(!JSON.stringify(result).includes(marker));
});

test('036 --ids is dev-only, rejects duplicates/unknown IDs, keeps fixture order and selection separate from skipped', async t => {
  const f = setup(t);
  const ids = ['E035', 'E001', 'E039'];
  assert.deepEqual(selectCases(cases, undefined, ids).map(c => c.id), ['E001', 'E035', 'E039']);
  assert.deepEqual(parseOptions(['--mock', '--ids', ids.join(',')]).ids, ids);
  for (const args of [['--ids'], ['--ids', 'E001,E001'], ['--ids', 'E999', '--split', 'final'],
    ['--ids', 'E001', '--limit', '2'], ['--ids', 'E001,'], ['--ids', 'E001', '--ids', 'E003']])
    assert.throws(() => parseOptions(['--mock', ...args]));
  let calls = 0;
  await assert.rejects(() => main(['--live', '--ids', 'E999', '--max-calls', '1'], { env: settings('gemini'),
    outputRoot: f.dir, live: { transport: async () => { calls++; return envelope('gemini', {}); } } }));
  assert.equal(calls, 0);
  const exit = await main(['--scripted', 'tests/fixtures/eval-scripted-good.json', '--ids', ids.join(',')], {
    env: {}, outputRoot: join(f.dir, 'reports'), log: () => {} });
  assert.equal(exit, 0);
  const dir = join(f.dir, 'reports', readdirSync(join(f.dir, 'reports'))[0]!);
  const result = JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8'));
  assert.equal(result.version, 3); assert.equal(result.totalCases, 3); assert.equal(result.availableCases, 80);
  assert.deepEqual(result.skipped, []); assert.equal(result.totals.modelRawPass, 3);
  assert.equal(result.totals.attempts, 0); assert.equal(result.totals.reservations, 0);
  assert.ok(result.rows.every((r: { modelRaw: unknown }) => r.modelRaw));
  const sheet = JSON.parse(readFileSync(join(dir, 'human-review.json'), 'utf8'));
  assert.ok(sheet.every((r: { modelRaw: string; adapterOutput: string; validated: string }) => r.modelRaw && r.adapterOutput && r.validated));
  const exports = readdirSync(dir).map(p => readFileSync(join(dir, p), 'utf8')).join('');
  for (const forbidden of [key, 'systemInstruction', 'x-goog-api-key', 'Authorization', readFileSync('server/llm/system.ko.txt', 'utf8').trim()])
    assert.ok(!exports.includes(forbidden));
});

for (const id of ['E001', 'E009', 'E023', 'E027', 'E029', 'E033', 'E035']) {
  test(`036 ${id}: exact gold passes; changing any safety field still rejects`, () => {
    const fixture = cases.find(c => c.id === id)!, raw = gold.responses[id], input = inputFor(fixture);
    const valid = validateProposal(raw, input);
    assert.equal(valid.intent, 'command'); assert.deepEqual(valid.proposedActions, fixture.actions);
    for (const mutate of [
      (a: Record<string, unknown>) => { a.assignee = 'zhang-zhao'; },
      (a: Record<string, unknown>) => { a.conditions = ['public', 'secret']; },
      (a: Record<string, unknown>) => { a.conditions = ['after:1']; },
      (a: Record<string, unknown>) => { a.deadline = '14분 이내'; },
    ]) {
      const wrong = structuredClone(raw); mutate(wrong.proposedActions[0]);
      try { assert.notEqual(validateProposal(wrong, input).intent, 'command'); }
      catch (error) { assert.match(String(error), /INVALID_PROPOSAL/); }
    }
  });
}
