import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GeminiDiagnostics, DIAGNOSTIC_MAX_BYTES } from '../server/llm/gemini-response.ts';
import { RuntimeSettings } from '../server/llm/runtime-settings.ts';
import { GeminiProvider } from '../server/llm/gemini.ts';
import { CallBudget } from '../server/llm/budget.ts';
import { SecretGuard } from '../server/llm/secrets.ts';
import { GameEngine } from '../server/engine.ts';
import { characterInput, meetingInput } from '../server/characters.ts';
import type { LlmDiagnostic } from '../shared/contracts.ts';

const key = 'synthetic-032-H6d9K3w4M7s2V8r5+/=';
const config = { model: 'offline-model', timeoutMs: 300, retries: 0, dailyLimit: 30, sessionLimit: 30 };
const privateText = 'PRIVATE_PLAYER_032';
const input = { text: privateText, knowledge: new GameEngine().view().knowledge, context: [{ role: 'player' as const, text: 'PRIVATE_CONTEXT_032' }], actions: [] };
const proposal = { intent: 'question', dialogue: '보고 PRIVATE_RESPONSE_032', proposedActions: [], unresolvedQuestions: [], referencedKnowledgeIds: [] };
const envelope = (text: string, finishReason = 'STOP') => ({ candidates: [{ finishReason, content: { parts: text ? [{ text }] : [] } }],
  usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4, thoughtsTokenCount: 32 } });
function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'throne-diag-032-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  t.mock.method(console, 'info', () => {});
  return { budgetFile: join(dir, 'usage.json'), diagnosticsFile: join(dir, 'diagnostics.jsonl') };
}
const lines = (file: string): LlmDiagnostic[] => readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));

for (const [httpStatus, body, resultCode, message] of [
  [200, envelope('', 'MAX_TOKENS'), 'truncated', null],
  [400, { error: { status: 'INVALID_ARGUMENT', message: `Invalid JSON payload received. Unknown name "${privateText}". Cannot find field. PRIVATE_PROMPT_032`, details: [{ reason: 'INVALID_ARGUMENT' }] } }, 'request', 'Invalid JSON payload received. Unknown name Cannot find field'],
  [404, { error: { status: 'NOT_FOUND', message: 'Requested entity was not found.' } }, 'model', 'Requested entity was not found.'],
  [503, { error: { status: 'UNAVAILABLE', message: 'The model is overloaded.' } }, 'google_server', 'The model is overloaded.'],
  [200, envelope('OK'), 'ok', null],
] as const) test(`032 connection ${httpStatus}/${resultCode}: complete line and latest safe summary`, async t => {
  const paths = fixture(t);
  const runtime = new RuntimeSettings({ ...paths, env: {}, transport: async () => Response.json(body, { status: httpStatus }) });
  assert.equal(runtime.status().lastDiagnostic, null);
  runtime.configure(config.model, key, 30);
  assert.equal(await runtime.test(), resultCode);
  const saved = lines(paths.diagnosticsFile); assert.equal(saved.length, 1);
  assert.deepEqual(saved[0], runtime.status().lastDiagnostic);
  assert.deepEqual(saved[0], { source: 'test', networkMode: 'auto', route: 'direct', networkError: null, timestamp: saved[0]!.timestamp, provider: 'gemini', callKind: 'connection_test', model: config.model,
    httpStatus, resultCode, googleStatus: httpStatus === 400 ? 'INVALID_ARGUMENT' : httpStatus === 404 ? 'NOT_FOUND' : httpStatus === 503 ? 'UNAVAILABLE' : null,
    googleReason: httpStatus === 400 ? 'INVALID_ARGUMENT' : null, googleMessage: message,
    finishReason: httpStatus === 200 ? resultCode === 'ok' ? 'STOP' : 'MAX_TOKENS' : null,
    inputTokens: httpStatus === 200 ? 12 : null, outputTokens: httpStatus === 200 ? 4 : null, thinkingTokens: httpStatus === 200 ? 32 : null,
    latencyMs: saved[0]!.latencyMs, retries: 0, dailyCalls: 1, sessionCalls: 1 });
  assert.ok(saved[0]!.latencyMs >= 0); assert.ok(Number.isFinite(Date.parse(saved[0]!.timestamp)));
  const exported = JSON.stringify(runtime.status()); new SecretGuard(key).assertSafe(exported);
  for (const text of [privateText, 'PRIVATE_PROMPT_032', 'Reply with exactly OK.']) assert.ok(!exported.includes(text));
});

for (const kind of ['command', 'npc', 'meeting'] as const) test(`032 ${kind}: game metadata, schema outcome and no request/response text`, async t => {
  const paths = fixture(t), sink = new GeminiDiagnostics(paths.diagnosticsFile);
  const engine = new GameEngine();
  // Use the actual character/meeting input builders to verify routing metadata.
  const world = engine.internalSnapshot().world;
  const npc = characterInput(world, 'zhou-yu', privateText, ['zhou-yu', 'lu-su']);
  const sent = kind === 'command' ? input : kind === 'npc' ? npc : meetingInput([npc, characterInput(world, 'lu-su', privateText, ['zhou-yu', 'lu-su'])]);
  const provider = new GeminiProvider(config, async (_url, init) => {
    assert.ok(!String(init?.body).includes('diagnosticKind'));
    return Response.json(envelope(JSON.stringify(proposal)));
  }, new CallBudget(config, paths.budgetFile), key, sink);
  await provider.interpret(sent, new AbortController().signal);
  const saved = lines(paths.diagnosticsFile); assert.equal(saved.length, 1);
  assert.equal(saved[0]!.callKind, kind); assert.equal(saved[0]!.resultCode, 'ok');
  assert.equal(saved[0]!.thinkingTokens, 32); assert.equal(saved[0]!.model, config.model);
  const exported = JSON.stringify(saved); new SecretGuard(key).assertSafe(exported);
  for (const text of [privateText, input.context[0]!.text, proposal.dialogue]) assert.ok(!exported.includes(text));
});

test('032 retries are separate physical calls with reservation snapshots and final validation codes', async t => {
  const paths = fixture(t); let calls = 0;
  const provider = new GeminiProvider({ ...config, retries: 1 }, async () => ++calls === 1
    ? Response.json({ error: { status: 'UNAVAILABLE' } }, { status: 503 })
    : Response.json(envelope(JSON.stringify({ ...proposal, intent: 'invalid' }))),
  new CallBudget(config, paths.budgetFile), key, new GeminiDiagnostics(paths.diagnosticsFile));
  await assert.rejects(provider.interpret(input, new AbortController().signal));
  assert.deepEqual(lines(paths.diagnosticsFile).map(d => [d.httpStatus, d.resultCode, d.retries, d.dailyCalls, d.sessionCalls]),
    [[503, 'google_server', 0, 1, 1], [200, 'schema', 1, 2, 2]]);
});

for (const route of ['connection', 'game'] as const) test(`032 ${route} timeout: late ignored transport logs exactly once`, async t => {
  const paths = fixture(t); let release!: (response: Response) => void;
  const transport = async () => new Promise<Response>(resolve => { release = resolve; });
  if (route === 'connection') {
    const runtime = new RuntimeSettings({ ...paths, env: {}, transport, timeoutMs: 20 }); runtime.configure(config.model, key, 30);
    assert.equal(await runtime.test(), 'timeout');
  } else {
    const provider = new GeminiProvider({ ...config, timeoutMs: 20 }, transport, new CallBudget(config, paths.budgetFile), key, new GeminiDiagnostics(paths.diagnosticsFile));
    await assert.rejects(provider.interpret(input, new AbortController().signal));
  }
  assert.equal(lines(paths.diagnosticsFile)[0]!.resultCode, 'timeout');
  assert.equal(lines(paths.diagnosticsFile)[0]!.httpStatus, null);
  release(Response.json(envelope('OK'))); await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(lines(paths.diagnosticsFile).length, 1);
});

test('032 message guard before truncation, encoded credentials and bounded message clauses', t => {
  const paths = fixture(t), sink = new GeminiDiagnostics(paths.diagnosticsFile), guard = new SecretGuard(key);
  for (const secret of [key, encodeURIComponent(key), Buffer.from(key).toString('base64'), Buffer.from(key).toString('hex'), key.slice(-12)]) {
    sink.write(400, { error: { message: 'Invalid JSON payload received. '.repeat(20) + secret } }, guard);
    assert.equal(sink.latest(guard)!.googleMessage, null);
  }
  sink.write(400, { error: { message: 'Invalid JSON payload received. '.repeat(20) } }, guard);
  assert.equal(sink.latest(guard)!.googleMessage!.length, 240);
  guard.assertSafe(readFileSync(paths.diagnosticsFile, 'utf8'));
  assert.equal(sink.latest(new SecretGuard('Invalid JSON payload received')), null);
});

test('032 rolling rotation retains latest 500 rows across sink restarts and bounds legacy file size', t => {
  const paths = fixture(t), guard = new SecretGuard(key);
  let sink = new GeminiDiagnostics(paths.diagnosticsFile);
  for (let i = 0; i < 503; i++) {
    if (i === 250) sink = new GeminiDiagnostics(paths.diagnosticsFile);
    sink.begin({ model: config.model, callKind: 'command', retries: 0, dailyCalls: i, sessionCalls: i }, guard).finish('ok');
  }
  const saved = lines(paths.diagnosticsFile); assert.equal(saved.length, 500);
  assert.equal(saved[0]!.dailyCalls, 3); assert.equal(saved.at(-1)!.dailyCalls, 502);
  assert.ok(statSync(paths.diagnosticsFile).size <= DIAGNOSTIC_MAX_BYTES);
  writeFileSync(paths.diagnosticsFile, 'x'.repeat(DIAGNOSTIC_MAX_BYTES + 1));
  sink.write(200, envelope('OK'), guard);
  assert.equal(lines(paths.diagnosticsFile).length, 1); assert.ok(statSync(paths.diagnosticsFile).size <= DIAGNOSTIC_MAX_BYTES);
});
