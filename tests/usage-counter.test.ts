import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { CallBudget } from '../server/llm/budget.ts';
import { defaultUsageFile, PLAY_USAGE_FILE } from '../server/llm/usage-file.ts';
import { ProviderError, providerMessage } from '../server/llm/types.ts';
import { RuntimeSettings } from '../server/llm/runtime-settings.ts';
import { createGameServer } from '../server/http.ts';
import { listenForFetch } from '../scripts/test-server.ts';
import { liveSource } from '../scripts/eval/provider-bridge.ts';
import { loadCases } from '../scripts/eval/fixtures.ts';
import { GeminiProvider } from '../server/llm/gemini.ts';

const input = { text: '질문', knowledge: { viewer: 'player' as const, documents: [] }, context: [], actions: [] };

const config = { model: 'offline-model', timeoutMs: 100, retries: 0, dailyLimit: 30, sessionLimit: 30 };
const good = () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'OK' }] } }] });
function fixture(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(join(tmpdir(), 'throne-counter-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'usage.json');
}
test('direct node test defaults to an isolated counter, never the play file', () => {
  assert.notEqual(defaultUsageFile(), PLAY_USAGE_FILE);
  assert.equal(defaultUsageFile(), defaultUsageFile());
});
test('LLM_USAGE_FILE overrides the production default without changing the play file', t => {
  const file = fixture(t);
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { CallBudget } from './server/llm/budget.ts';
    new CallBudget(${JSON.stringify(config)}).reserve();
  `], { encoding: 'utf8', windowsHide: true, env: { SystemRoot: process.env.SystemRoot, LLM_USAGE_FILE: file } });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).calls, 1);
});
test('status preserves polluted bytes; explicit daily reset leaves session and both limits intact', t => {
  const file = fixture(t), day = new Date().toISOString().slice(0, 10);
  const original = JSON.stringify({ day, calls: 541 }); writeFileSync(file, original);
  const budget = new CallBudget(config, file);
  assert.deepEqual(budget.snapshot(), { dailyCalls: 541, dailyLimit: 30, sessionCalls: 0, sessionLimit: 30 });
  assert.equal(readFileSync(file, 'utf8'), original);
  assert.throws(() => budget.reserve(), (e: unknown) => e instanceof ProviderError && providerMessage(e) === '로컬 일일 상한(UTC) 도달: 오늘 541/30');
  assert.deepEqual(budget.resetToday(), { day, previousCalls: 541 });
  budget.reserve(); budget.resetToday();
  assert.deepEqual(budget.snapshot(), { dailyCalls: 0, dailyLimit: 30, sessionCalls: 1, sessionLimit: 30 });
  assert.equal(new CallBudget(config, file).snapshot().sessionCalls, 0);
});
test('UTC rollover is read-only on status and never resets session reservations', t => {
  const file = fixture(t); let now = new Date('2026-10-25T23:59:59Z');
  const budget = new CallBudget({ ...config, sessionLimit: 1 }, file, () => now);
  assert.equal(budget.snapshot().dailyCalls, 0); assert.equal(existsSync(file), false);
  budget.reserve(); const before = readFileSync(file, 'utf8');
  now = new Date('2026-10-26T00:00:00Z');
  assert.equal(budget.snapshot().dailyCalls, 0); assert.equal(readFileSync(file, 'utf8'), before);
  assert.throws(() => budget.reserve(), (e: unknown) => e instanceof ProviderError && e.budgetDetail?.scope === 'session');
  const restarted = new CallBudget(config, file, () => now); restarted.reserve();
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { day: '2026-10-26', calls: 1 });
});
test('corrupt and locked counters fail closed; reset cannot silently erase corruption', t => {
  const file = fixture(t), budget = new CallBudget(config, file);
  writeFileSync(file, '{broken'); assert.equal(budget.snapshot().dailyCalls, -1);
  assert.throws(() => budget.reserve(), /CALL_LIMIT/); assert.throws(() => budget.resetToday(), /CALL_LIMIT/);
  assert.equal(readFileSync(file, 'utf8'), '{broken');
  writeFileSync(file, JSON.stringify({ day: '2026-10-25', calls: 2 })); writeFileSync(file + '.lock', '');
  assert.throws(() => budget.reserve(), /CALL_LIMIT/); assert.throws(() => budget.resetToday(), /CALL_LIMIT/);
});
test('connection success, failure and 429 each reserve exactly once; settings and reset do not refund session', async t => {
  const file = fixture(t); let calls = 0, code = 200;
  const runtime = new RuntimeSettings({ env: {}, budgetFile: file, transport: async () => { calls++; return code === 200 ? good() : new Response('', { status: code }); } });
  runtime.configure('offline-model', 'synthetic-Q7v9K3w2N6r4', 3);
  for (const [http, result] of [[200, 'ok'], [503, 'server'], [429, 'rate_limited']] as const) {
    code = http; assert.equal(await runtime.test(), result);
    assert.equal(runtime.status().dailyCalls, calls); assert.equal(runtime.status().sessionCalls, calls);
  }
  runtime.resetUsage(); runtime.configure('offline-model', '', 3);
  assert.equal(await runtime.test(), 'session_limit'); assert.equal(calls, 3);
  assert.equal(runtime.status().dailyCalls, 0); assert.equal(runtime.status().sessionLimit, 3);
});
test('daily exhaustion is distinct from session exhaustion and never sends a request', async t => {
  const file = fixture(t); writeFileSync(file, JSON.stringify({ day: new Date().toISOString().slice(0, 10), calls: 541 }));
  const runtime = new RuntimeSettings({ env: {}, budgetFile: file, transport: async () => { assert.fail('blocked'); } });
  runtime.configure('offline-model', 'synthetic-Q7v9K3w2N6r4', 30);
  assert.equal(await runtime.test(), 'daily_limit'); assert.equal(runtime.status().sessionCalls, 0);
});
test('provider retries reserve once per attempt; result telemetry does not reserve again', async t => {
  const file = fixture(t), settings = { ...config, retries: 1 };
  const budget = new CallBudget(settings, file); let calls = 0;
  const provider = new GeminiProvider(settings, async () => { calls++; return new Response('', { status: calls === 1 ? 503 : 429 }); }, budget, 'synthetic-Q7v9K3w2N6r4');
  await assert.rejects(() => provider.interpret(input, new AbortController().signal));
  assert.equal(calls, 2); assert.equal(budget.snapshot().dailyCalls, 2); assert.equal(budget.snapshot().sessionCalls, 2);
  assert.equal(provider.lastUsage?.reservations, 2); assert.equal(provider.lastUsage?.externalCalls, 2);
});
test('evaluation without budgetFile gets a fresh isolated file for each run', async () => {
  const testFile = defaultUsageFile(), before = existsSync(testFile) ? readFileSync(testFile, 'utf8') : null;
  const env = { LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'synthetic-Q7v9K3w2N6r4', GEMINI_MODEL_ID: 'offline-model', LLM_DAILY_CALL_LIMIT: '1', LLM_SESSION_CALL_LIMIT: '1' };
  const fixture = (await loadCases('dev'))[0]!; let calls = 0;
  for (let index = 0; index < 2; index++) {
    const source = liveSource(1, env, {}, { transport: async () => { calls++; return new Response('', { status: 429 }); } })!;
    assert.equal((await source.sample(fixture, input)).reservations, 1);
    assert.equal((await source.sample(fixture, input)).reservations, 0);
  }
  assert.equal(calls, 2);
  assert.equal(existsSync(testFile) ? readFileSync(testFile, 'utf8') : null, before);
});
test('explicit reset invalidates an in-flight connection test without refunding its session reservation', async t => {
  const file = fixture(t); let release!: (response: Response) => void, entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const runtime = new RuntimeSettings({ env: {}, budgetFile: file, transport: async () => { entered(); return new Promise<Response>(resolve => { release = resolve; }); } });
  runtime.configure('offline-model', 'synthetic-Q7v9K3w2N6r4', 30);
  const pending = runtime.test(); await ready;
  assert.equal(runtime.status().sessionCalls, 1); runtime.resetUsage(); release(good());
  assert.equal(await pending, 'stale'); assert.equal(runtime.status().testResult, 'untested');
  assert.equal(runtime.status().dailyCalls, 0); assert.equal(runtime.status().sessionCalls, 1);
});
for (const [scenario, savedCalls, limit, message, sent] of [
  ['daily', 541, 30, /로컬 일일 상한\(UTC\) 도달: 오늘 541\/30/, 0],
  ['session', 0, 0, /로컬 세션 상한 도달: 이번 서버 세션 0\/0/, 0],
  ['provider', 0, 30, /공급자 한도 초과\(429\)/, 1],
] as const) test(`HTTP game errors preserve ${scenario} limit detail through legacy engine mapping`, async t => {
  const file = fixture(t); writeFileSync(file, JSON.stringify({ day: new Date().toISOString().slice(0, 10), calls: savedCalls }));
  let calls = 0;
  const api = createGameServer(undefined, 5173, { env: {}, budgetFile: file, transport: async () => { calls++; return new Response('', { status: 429 }); } });
  const port = await listenForFetch(api);
  t.after(async () => { api.closeAllConnections(); await new Promise<void>(resolve => api.close(() => resolve())); });
  const base = `http://127.0.0.1:${port}`;
  const post = async (path: string, body: unknown) => (await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  await post('/api/llm/settings', { model: 'offline-model', key: 'synthetic-Q7v9K3w2N6r4', limit });
  await post('/api/llm/start', { mode: 'ai' });
  const result = await post('/api/command', { type: 'submit', text: '항복하면 어떻게 돼?' });
  assert.match(result.outcome.reply, message); assert.match(result.state.interpretation.status, message);
  assert.equal(result.outcome.providerCode, scenario === 'provider' ? 'rate_limited' : 'budget');
  const status = await (await fetch(base + '/api/llm/status')).json();
  assert.equal(calls, sent); assert.equal(status.sessionCalls, sent); assert.equal(status.dailyCalls, savedCalls + sent);
});
test('HTTP reset requires explicit local JSON intent and survives game/settings reset in event logs', async t => {
  const file = fixture(t), day = new Date().toISOString().slice(0, 10);
  writeFileSync(file, JSON.stringify({ day, calls: 541 }));
  const api = createGameServer(undefined, 5173, { env: {}, budgetFile: file, transport: async () => { assert.fail('no external call'); } });
  const port = await listenForFetch(api);
  t.after(async () => { api.closeAllConnections(); await new Promise<void>(resolve => api.close(() => resolve())); });
  const base = `http://127.0.0.1:${port}`;
  const post = (body: unknown, origin = base, contentType = 'application/json') => fetch(base + '/api/llm/reset-usage', { method: 'POST', headers: { 'Content-Type': contentType, Origin: origin }, body: JSON.stringify(body) });
  for (const body of [{}, { confirm: false }, { confirm: true, extra: 1 }]) assert.equal((await post(body)).status, 400);
  assert.equal((await post({ confirm: true }, 'https://evil.invalid')).status, 403);
  assert.equal((await post({ confirm: true }, base, 'text/plain')).status, 415);
  const before = await (await fetch(base + '/api/llm/status')).json(); assert.equal(before.dailyCalls, 541);
  const response = await post({ confirm: true }); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const after = await response.json(); assert.equal(after.dailyCalls, 0); assert.equal(after.dailyLimit, 30); assert.equal(after.sessionLimit, 30);
  await fetch(base + '/api/llm/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'mock' }) });
  const logs = await (await fetch(base + '/api/test/logs')).json();
  const events = logs.filter((event: { kind: string }) => event.kind === 'llm-usage-reset');
  assert.equal(events.length, 1); assert.match(events[0].summary, /541 → 0/);
  const snapshot = await (await fetch(base + '/api/test/snapshot')).json(); assert.deepEqual(snapshot.logs, logs);
});
