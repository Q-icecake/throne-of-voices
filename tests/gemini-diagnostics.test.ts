import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RuntimeSettings } from '../server/llm/runtime-settings.ts';
import { GeminiProvider } from '../server/llm/gemini.ts';
import { GeminiDiagnostics } from '../server/llm/gemini-response.ts';
import { geminiConfig } from '../server/llm/config.ts';
import { CallBudget } from '../server/llm/budget.ts';
import { SecretGuard } from '../server/llm/secrets.ts';
import { ProviderError } from '../server/llm/types.ts';
import { GameEngine } from '../server/engine.ts';
import { createGameServer } from '../server/http.ts';
import { listenForFetch } from '../scripts/test-server.ts';

const key = 'synthetic-D8q3N7v4M2r9Z5w6';
const prompt = 'PRIVATE_PROMPT_031';
const config = { model: 'gemini-3.5-flash-lite', timeoutMs: 500, retries: 0, dailyLimit: 30, sessionLimit: 30 };
const input = { text: '현재 상황은?', knowledge: new GameEngine().view().knowledge, context: [], actions: [] };
const proposal = { intent: 'question', dialogue: '보고를 확인해 주십시오.', proposedActions: [], unresolvedQuestions: [], referencedKnowledgeIds: [] };
const envelope = (parts: unknown[], finishReason = 'STOP') => ({ candidates: [{ finishReason, content: { parts } }],
  usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 0, thoughtsTokenCount: 256 } });
function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'throne-031-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { budgetFile: join(dir, 'usage.json'), diagnosticsFile: join(dir, 'diagnostics.jsonl') };
}
const scenarios = [
  ['MAX_TOKENS empty', 200, envelope([], 'MAX_TOKENS'), 'truncated'],
  ['MAX_TOKENS partial', 200, envelope([{ text: '{' }], 'MAX_TOKENS'), 'truncated'],
  ['thinking only', 200, envelope([{ thought: true, text: 'OK' }]), 'empty'],
  ['empty STOP', 200, envelope([]), 'empty'],
  ['400 schema/thinking', 400, { error: { status: 'INVALID_ARGUMENT', message: prompt, details: [{ reason: 'INVALID_ARGUMENT' }] } }, 'request'],
  ['404 model', 404, { error: { status: 'NOT_FOUND' } }, 'model'],
  ['500 internal', 500, { error: { status: 'INTERNAL' } }, 'google_server'],
  ['503 unavailable', 503, { error: { status: 'UNAVAILABLE' } }, 'google_server'],
  ['malformed parts', 200, { candidates: [{ finishReason: 'STOP', content: { parts: {} } }] }, 'parse'],
] as const;

for (const [name, status, body, expected] of scenarios) test(`031 HTTP connection ${name}: one reservation, safe diagnostic`, async t => {
  const paths = fixture(t); let calls = 0; const requests: unknown[] = [], consoleLines: string[] = [];
  t.mock.method(console, 'info', (line: string) => { consoleLines.push(line); });
  const api = createGameServer(undefined, 5173, { env: {}, ...paths, transport: async (_url, init) => {
    calls++; requests.push(JSON.parse(String(init?.body))); return Response.json(body, { status });
  } });
  await listenForFetch(api);
  t.after(async () => { api.closeAllConnections(); await new Promise<void>(resolve => api.close(() => resolve())); });
  const base = `http://127.0.0.1:${(api.address() as { port: number }).port}`;
  const localFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    assert.ok(String(url).startsWith(base + '/'), 'all nonlocal transports forbidden'); return localFetch(url, init);
  });
  const post = async (path: string, value: unknown) => {
    const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    assert.equal(response.status, 200); return response.json();
  };
  await post('/api/llm/settings', { model: config.model, key, limit: 1 });
  const result = await post('/api/llm/test', {});
  assert.equal(result.result, expected); assert.equal(result.status.testResult, expected);
  assert.equal(calls, 1); assert.equal(JSON.parse(readFileSync(paths.budgetFile, 'utf8')).calls, 1);
  assert.deepEqual((requests[0] as { generationConfig: unknown }).generationConfig,
    { maxOutputTokens: 256, temperature: 0, thinkingConfig: { thinkingLevel: 'minimal' } });
  assert.equal((await post('/api/llm/test', {})).result, 'session_limit'); assert.equal(calls, 1);
  const lines = readFileSync(paths.diagnosticsFile, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1); assert.deepEqual(lines, consoleLines);
  const diagnostic = JSON.parse(lines[0]!);
  assert.equal(diagnostic.httpStatus, status);
  assert.deepEqual(Object.keys(diagnostic).sort(), ['httpStatus', 'googleStatus', 'googleReason', 'finishReason', 'inputTokens', 'outputTokens', 'thinkingTokens'].sort());
  if (status === 200 && expected !== 'parse') {
    assert.equal(diagnostic.inputTokens, 12); assert.equal(diagnostic.outputTokens, 0); assert.equal(diagnostic.thinkingTokens, 256);
  }
  if (status === 400) { assert.equal(diagnostic.googleStatus, 'INVALID_ARGUMENT'); assert.equal(diagnostic.googleReason, 'INVALID_ARGUMENT'); }
  const published = JSON.stringify({ lines, consoleLines, result }); new SecretGuard(key).assertSafe(published);
  assert.ok(!published.includes(prompt)); assert.ok(!published.includes('Reply with exactly OK.'));
});

for (const [model, thinking] of [
  ['gemini-3.5-flash-lite', { thinkingLevel: 'minimal' }], ['gemini-3-flash-preview', { thinkingLevel: 'minimal' }],
  ['gemini-3.1-pro-preview', { thinkingLevel: 'low' }], ['gemini-3-pro-preview', { thinkingLevel: 'low' }],
  ['gemini-2.5-flash', { thinkingBudget: 0 }], ['gemini-2.5-flash-lite', { thinkingBudget: 0 }],
  ['gemini-2.5-pro', { thinkingBudget: 128 }], ['gemini-30-flash', undefined], ['unrecognized-model', undefined],
] as const) test(`031 ${model}: test and game send the family-specific lowest thinking setting`, async t => {
  const paths = fixture(t), requests: { generationConfig: Record<string, unknown> }[] = [];
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('no external transport'); });
  const runtime = new RuntimeSettings({ ...paths, env: {}, transport: async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return Response.json(envelope([{ thought: true, text: '가짜 사고' },
      { text: requests.length === 1 ? 'OK' : JSON.stringify(proposal) }]));
  } });
  runtime.configure(model, key, 30); assert.equal(await runtime.test(), 'ok'); runtime.select('ai');
  const provider = runtime.provider()!;
  const result = await provider.interpret(input, new AbortController().signal) as typeof proposal;
  assert.equal(result.dialogue, proposal.dialogue); assert.equal(requests.length, 2);
  for (const request of requests) assert.deepEqual(request.generationConfig.thinkingConfig, thinking);
  assert.equal(requests[0]!.generationConfig.maxOutputTokens, 256);
  assert.equal(requests[0]!.generationConfig.responseMimeType, undefined);
  assert.equal(requests[0]!.generationConfig.responseJsonSchema, undefined);
  assert.equal(requests[1]!.generationConfig.maxOutputTokens, 2048);
  assert.equal(requests[1]!.generationConfig.responseMimeType, 'application/json');
  assert.ok(requests[1]!.generationConfig.responseJsonSchema);
});

for (const mode of ['command', 'npc'] as const) test(`031 ${mode}: truncated empty game response preserves state and input`, async t => {
  const paths = fixture(t); let calls = 0;
  const provider = new GeminiProvider({ ...config, retries: 3 }, async () => {
    calls++; return Response.json(envelope([], 'MAX_TOKENS'));
  }, new CallBudget(config, paths.budgetFile), key, new GeminiDiagnostics(paths.diagnosticsFile));
  const engine = new GameEngine(undefined, undefined, provider);
  engine.audience({ type: 'invite', participants: ['zhou-yu'] });
  const before = engine.publicSnapshot();
  const result = mode === 'command' ? await engine.command({ type: 'submit', text: input.text }) :
    await engine.talk({ characterId: 'zhou-yu', text: input.text });
  assert.equal(result.outcome?.kind, 'error'); assert.match(result.outcome?.reply ?? '', /응답이 잘림.*사고 토큰/);
  assert.equal(result.outcome?.input, input.text); assert.equal(calls, 1);
  const after = engine.publicSnapshot();
  assert.match(after.state.interpretation?.status ?? '', /\[truncated\]/);
  assert.deepEqual(after, { ...before, state: { ...before.state, interpretation: after.state.interpretation } });
  assert.equal(provider.lastUsage?.errorCode, 'truncated'); assert.equal(provider.lastUsage?.retries, 0);
  assert.match(readFileSync(paths.diagnosticsFile, 'utf8'), /"thinkingTokens":256/);
});

for (const [name, value] of [['plain', key], ['base64', Buffer.from(key).toString('base64')], ['hex', Buffer.from(key).toString('hex')],
  ['partial', key.slice(-12)], ['prompt', prompt]] as const) test(`031 diagnostics suppress ${name} in all upstream fields and headers`, async t => {
  const paths = fixture(t), lines: string[] = [];
  t.mock.method(console, 'info', (line: string) => { lines.push(line); });
  const runtime = new RuntimeSettings({ ...paths, env: {}, transport: async () => Response.json({
    error: { status: value, message: value, details: [{ reason: value, metadata: { prompt: value } }] },
    candidates: [{ finishReason: value, content: { parts: [{ text: value }] } }],
    usageMetadata: { promptTokenCount: value, candidatesTokenCount: -1, thoughtsTokenCount: Infinity },
  }, { status: 400, headers: { 'X-Reflected': value } }) });
  runtime.configure(config.model, key, 1); assert.equal(await runtime.test(), 'request');
  const file = readFileSync(paths.diagnosticsFile, 'utf8');
  assert.equal(file, lines.join('\n') + '\n'); new SecretGuard(key).assertSafe(file); assert.ok(!file.includes(value));
  assert.deepEqual(JSON.parse(file), { httpStatus: 400, googleStatus: null, googleReason: null, finishReason: null,
    inputTokens: null, outputTokens: null, thinkingTokens: null });
});

test('031 diagnostics guard also rejects an allowlisted value equal to the credential', t => {
  const paths = fixture(t), lines: string[] = []; t.mock.method(console, 'info', (line: string) => { lines.push(line); });
  new GeminiDiagnostics(paths.diagnosticsFile).write(400, { error: { status: 'INVALID_ARGUMENT', details: [{ reason: 'INVALID_ARGUMENT' }] } }, new SecretGuard('INVALID_ARGUMENT'));
  const file = readFileSync(paths.diagnosticsFile, 'utf8'); assert.ok(!file.includes('INVALID_ARGUMENT')); assert.equal(lines.length, 1);
});

test('031 malformed JSON/body deadline and diagnostic sink failure remain safe and bounded', async t => {
  const paths = fixture(t);
  writeFileSync(paths.diagnosticsFile, 'not-a-directory');
  for (const [response, code] of [[() => new Response('{'), 'parse'], [() => new Response('x'.repeat(65537)), 'parse'],
    [() => new Response(new ReadableStream({ start() {} })), 'timeout']] as const) {
    let calls = 0;
    const runtime = new RuntimeSettings({ env: {}, budgetFile: paths.budgetFile, diagnosticsFile: join(paths.diagnosticsFile, 'blocked.jsonl'), timeoutMs: 100,
      transport: async () => { calls++; return response(); } });
    runtime.configure(config.model, key, 30); assert.equal(await runtime.test(), code); assert.equal(calls, 1);
  }
});

test('031 configurable thinking/default and game token limit reach runtime and CLI; invalid config is rejected', async t => {
  const paths = fixture(t), requests: { generationConfig: Record<string, unknown> }[] = [];
  const env = { GEMINI_MODEL_ID: config.model, GEMINI_THINKING_MODE: 'default', GEMINI_MAX_OUTPUT_TOKENS: '4096' };
  assert.equal(geminiConfig(env)?.maxOutputTokens, 4096); assert.equal(geminiConfig(env)?.thinkingMode, 'default');
  const runtime = new RuntimeSettings({ ...paths, env, transport: async (_url, init) => {
    requests.push(JSON.parse(String(init?.body))); return Response.json(envelope([{ text: requests.length === 1 ? 'OK' : JSON.stringify(proposal) }]));
  } });
  runtime.configure(config.model, key, 30); assert.equal(await runtime.test(), 'ok'); runtime.select('ai');
  await runtime.provider()!.interpret(input, new AbortController().signal);
  assert.equal(requests[0]!.generationConfig.maxOutputTokens, 256); assert.equal(requests[1]!.generationConfig.maxOutputTokens, 4096);
  for (const request of requests) assert.equal(request.generationConfig.thinkingConfig, undefined);
  for (const invalid of [{ GEMINI_MAX_OUTPUT_TOKENS: '8' }, { GEMINI_MAX_OUTPUT_TOKENS: '32769' }, { GEMINI_THINKING_MODE: 'unsupported' }]) {
    assert.equal(geminiConfig({ ...env, ...invalid }), undefined);
    const bad = new RuntimeSettings({ env: { ...env, ...invalid }, ...paths, transport: async () => { assert.fail('invalid config must not call'); } });
    bad.configure(config.model, key, 30); assert.equal(await bad.test(), 'request');
  }
});

test('031 game 400 never retries or removes thinking; malformed proposal JSON is parse failure', async t => {
  const paths = fixture(t);
  for (const [response, expected] of [[() => Response.json({ error: { status: 'INVALID_ARGUMENT' } }, { status: 400 }), 'request'],
    [() => Response.json(envelope([{ text: '{' }])), 'parse']] as const) {
    let calls = 0;
    const provider = new GeminiProvider({ ...config, retries: 3 }, async () => { calls++; return response(); },
      new CallBudget(config, paths.budgetFile), key, new GeminiDiagnostics(paths.diagnosticsFile));
    await assert.rejects(provider.interpret(input, new AbortController().signal), error => error instanceof ProviderError && error.neutralCode === expected);
    assert.equal(calls, 1); assert.equal(provider.lastUsage?.reservations, 1);
  }
});
