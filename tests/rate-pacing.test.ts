import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RequestPacer, rateLimits, estimatePacedDuration } from '../server/llm/pacer.ts';
import type { PacerClock } from '../server/llm/pacer.ts';
import { retryDelay } from '../server/llm/retry-delay.ts';
import { ProviderError, providerMessage } from '../server/llm/types.ts';
import { SecretGuard } from '../server/llm/secrets.ts';
import { RuntimeSettings } from '../server/llm/runtime-settings.ts';
import { configuredProvider } from '../server/llm/config.ts';
import { CallBudget } from '../server/llm/budget.ts';
import { GeminiProvider } from '../server/llm/gemini.ts';
import { GameEngine } from '../server/engine.ts';
import { liveSource } from '../scripts/eval/provider-bridge.ts';
import { loadCases } from '../scripts/eval/fixtures.ts';
import { inputFor, parseOptions, main } from '../scripts/eval/run.ts';
import { createGameServer } from '../server/http.ts';
import { listenForFetch } from '../scripts/test-server.ts';

const signal = () => new AbortController().signal;
const key = 'synthetic-037-V8r3K6s2P9m4';
const guard = new SecretGuard(key);
const config = { model: 'offline-model', timeoutMs: 100, retries: 0, dailyLimit: 30, sessionLimit: 30 };
const input = { text: '질문', knowledge: { viewer: 'player' as const, documents: [] }, context: [], actions: [] };
const good = () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'OK' }] } }] });
const pacingError = (e: unknown) => e instanceof ProviderError && e.neutralCode === 'pacing';
function fakeClock() {
  let now = 0; const waits: number[] = [];
  const clock: PacerClock = { now: () => now, sleep: async ms => { waits.push(ms); now += ms; } };
  return { clock, waits, advance: (ms: number) => { now += ms; } };
}
function setup(t: { after(fn: () => void): void; mock: { method: Function } }) {
  const dir = mkdtempSync(join(tmpdir(), 'throne-pacing-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  t.mock.method(console, 'info', () => {});
  return { budgetFile: join(dir, 'usage.json'), diagnosticsFile: join(dir, 'diagnostics.jsonl'), dir };
}

test('037 settings default to 12 RPM, 200K TPM and 8s; invalid settings fail closed with Mock available', () => {
  assert.deepEqual(rateLimits({}), { rpmLimit: 12, tpmLimit: 200000, maxWaitMs: 8000 });
  assert.equal(rateLimits({ LLM_TPM_LIMIT: '0' }).tpmLimit, 0);
  for (const env of [{ LLM_RPM_LIMIT: '0' }, { LLM_RPM_LIMIT: '1.5' }, { LLM_RPM_LIMIT: '' }, { LLM_TPM_LIMIT: '-1' }, { LLM_PACER_MAX_WAIT_MS: '8001' }]) {
    assert.throws(() => rateLimits(env));
    assert.equal(configuredProvider({ ...env, LLM_PROVIDER: 'gemini', GEMINI_API_KEY: key, GEMINI_MODEL_ID: config.model }).provider, undefined);
    assert.equal(new RuntimeSettings({ env }).provider(), undefined);
  }
});

test('037 sliding RPM window expires each entry at exactly 60s; rejection consumes nothing', async () => {
  const time = fakeClock(), pacer = new RequestPacer({ rpmLimit: 2, tpmLimit: 0, maxWaitMs: 0 }, time.clock);
  let reservations = 0; const reserve = () => { reservations++; };
  await pacer.acquire(1, signal(), reserve); time.advance(1000); await pacer.acquire(1, signal(), reserve);
  time.advance(58999); await assert.rejects(pacer.acquire(1, signal(), reserve), pacingError);
  assert.equal(reservations, 2); assert.equal(pacer.snapshot().minuteCalls, 2);
  time.advance(1); await pacer.acquire(1, signal(), reserve);
  assert.equal(reservations, 3); assert.equal(pacer.snapshot().minuteCalls, 2);
  time.advance(1000); assert.equal(pacer.snapshot().minuteCalls, 1);
});

test('037 game waits up to 8s and CLI waits entire windows; TPM is independent of RPM', async () => {
  for (const maxWaitMs of [8000, Infinity]) {
    const time = fakeClock(), pacer = new RequestPacer({ rpmLimit: 20, tpmLimit: 100, maxWaitMs }, time.clock);
    await pacer.acquire(80, signal(), () => {});
    if (maxWaitMs === 8000) {
      await assert.rejects(pacer.acquire(21, signal(), () => assert.fail()), pacingError);
      time.advance(52000);
    }
    await pacer.acquire(21, signal(), () => {});
    assert.deepEqual(time.waits, [maxWaitMs === 8000 ? 8000 : 60000]);
    assert.equal(pacer.snapshot().minuteTokens, 21);
    await assert.rejects(pacer.acquire(101, signal(), () => assert.fail()), pacingError);
  }
});

test('037 concurrent waiters recheck admission; budget failure and aborted signals reserve nothing', async () => {
  const time = fakeClock(), pacer = new RequestPacer({ rpmLimit: 1, tpmLimit: 0, maxWaitMs: Infinity }, time.clock);
  const at: number[] = [];
  await Promise.all(Array.from({ length: 5 }, () => pacer.acquire(1, signal(), () => at.push(time.clock.now()))));
  assert.deepEqual(at, [0, 60000, 120000, 180000, 240000]);
  time.advance(60000);
  await assert.rejects(pacer.acquire(1, signal(), () => { throw new ProviderError('budget'); }));
  assert.equal(pacer.snapshot().minuteCalls, 0);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(pacer.acquire(1, controller.signal, () => assert.fail()), /PROVIDER_TIMEOUT/);
  assert.equal(pacer.snapshot().minuteCalls, 0);
});

test('037 cancellation while sleeping never reaches budget or transport', async () => {
  const pacer = new RequestPacer({ rpmLimit: 1, tpmLimit: 0, maxWaitMs: Infinity });
  await pacer.acquire(1, signal(), () => {});
  const controller = new AbortController(), pending = pacer.acquire(1, controller.signal, () => assert.fail());
  controller.abort(); await assert.rejects(pending, /PROVIDER_TIMEOUT/);
  assert.equal(pacer.snapshot().minuteCalls, 1);
});

test('037 an overslept game wait refuses even after the window becomes available', async () => {
  let now = 0;
  const pacer = new RequestPacer({ rpmLimit: 1, tpmLimit: 0, maxWaitMs: 8000 }, {
    now: () => now, sleep: async ms => { now += ms + 1; },
  });
  await pacer.acquire(0, signal(), () => {}); now = 52000;
  await assert.rejects(pacer.acquire(0, signal(), () => assert.fail()), pacingError);
  assert.equal(pacer.snapshot().minuteCalls, 0);
});

test('037 compatible provider shares configured pacing and bounds its output reservation', async t => {
  const f = setup(t), time = fakeClock(); let calls = 0;
  const pacer = new RequestPacer({ rpmLimit: 1, tpmLimit: 200000, maxWaitMs: 0 }, time.clock);
  const env = { LLM_PROVIDER: 'openai-compatible', OPENAI_COMPAT_API_KEY: key, OPENAI_COMPAT_MODEL_ID: config.model,
    OPENAI_COMPAT_BASE_URL: 'https://offline.invalid/v1', LLM_DAILY_CALL_LIMIT: '30', LLM_SESSION_CALL_LIMIT: '30' };
  const transport: typeof fetch = async (_url, init) => {
    calls++; assert.equal(JSON.parse(String(init?.body)).max_tokens, 2048); return new Response('{}', { status: 429 });
  };
  const provider = configuredProvider(env, transport, { pacer, budget: new CallBudget(config, f.budgetFile) }).provider!;
  await assert.rejects(provider.interpret(input, signal()), (e: unknown) => e instanceof ProviderError && e.neutralCode === 'rate_limited');
  const before = readFileSync(f.budgetFile, 'utf8');
  await assert.rejects(provider.interpret(input, signal()), pacingError);
  assert.equal(calls, 1); assert.equal(readFileSync(f.budgetFile, 'utf8'), before);
});

test('037 a malformed Google 429 body retains valid header delay and never retries', async t => {
  const f = setup(t); let calls = 0;
  const runtime = new RuntimeSettings({ ...f, env: {}, transport: async () => {
    calls++; return new Response('not JSON', { status: 429, headers: { 'retry-after': '2.1' } });
  } });
  runtime.configure(config.model, key, 30); assert.equal(await runtime.test(), 'rate_limited');
  assert.equal(calls, 1); assert.equal(runtime.status().retryAfterSeconds, 3);
  assert.equal(runtime.status().lastDiagnostic?.retryAfterSeconds, 3);
  runtime.clear(); assert.equal(runtime.status().retryAfterSeconds, undefined);
});

test('037 settings, new adapters and local daily reset share the minute window', async t => {
  const f = setup(t), time = fakeClock(); let calls = 0;
  const pacer = new RequestPacer({ rpmLimit: 1, tpmLimit: 200000, maxWaitMs: 8000 }, time.clock);
  const runtime = new RuntimeSettings({ ...f, env: {}, pacer, transport: async () => { calls++; return good(); } });
  runtime.configure(config.model, key, 30); assert.equal(await runtime.test(), 'ok');
  const before = readFileSync(f.budgetFile, 'utf8'), diagnostics = readFileSync(f.diagnosticsFile, 'utf8');
  runtime.select('ai');
  for (let i = 0; i < 2; i++) {
    const provider = runtime.provider()!;
    await assert.rejects(provider.interpret(input, signal()), pacingError);
    assert.equal(provider.lastUsage?.reservations, 0); assert.equal(provider.lastUsage?.externalCalls, 0);
  }
  assert.equal(readFileSync(f.budgetFile, 'utf8'), before); assert.equal(readFileSync(f.diagnosticsFile, 'utf8'), diagnostics);
  runtime.resetUsage(); runtime.clear(); runtime.configure('another-model', key, 30);
  assert.equal(await runtime.test(), 'pacing'); assert.equal(runtime.status().minuteCalls, 1);
  assert.equal(runtime.status().dailyCalls, 0); assert.equal(calls, 1);
  time.advance(60000); assert.equal(runtime.status().minuteCalls, 0);
  assert.equal(await runtime.test(), 'ok'); assert.equal(calls, 2);
});

test('037 oversized TPM request refuses before any daily file or diagnostic write', async t => {
  const f = setup(t), budget = new CallBudget(config, f.budgetFile);
  const provider = new GeminiProvider({ ...config, tpmLimit: 1 }, async () => assert.fail(), budget, key);
  await assert.rejects(provider.interpret(input, signal()), pacingError);
  assert.equal(existsSync(f.budgetFile), false); assert.equal(provider.lastUsage?.reservations, 0);
});

test('037 actual pacer wait holds the active game clock and releases on failure with input intact', async t => {
  const f = setup(t); let now = 0, resume!: () => void;
  const pacer = new RequestPacer({ rpmLimit: 1, tpmLimit: 200000, maxWaitMs: 8000 }, {
    now: () => now, sleep: ms => new Promise(resolve => { resume = () => { now += ms; resolve(); }; }),
  });
  await pacer.acquire(1, signal(), () => {}); now = 52000;
  let calls = 0;
  const provider = new GeminiProvider(config, async () => { calls++; return new Response('{}', { status: 429, headers: { 'retry-after': '7' } }); },
    new CallBudget(config, f.budgetFile), key, undefined, undefined, undefined, pacer);
  const game = new GameEngine(undefined, undefined, provider, 15000, undefined, { mode: 'auto' });
  game.tick(1000); const text = '항복하면 어떻게 돼?', pending = game.command({ type: 'submit', text });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(resume); game.tick(61000);
  assert.equal(game.view().clock.activeMs, 0); assert.ok(game.view().clock.pauseReasons.includes('provider'));
  assert.equal(calls, 0); assert.equal(existsSync(f.budgetFile), false);
  resume(); const result = await pending;
  assert.equal(result.outcome.kind, 'error'); assert.ok(JSON.stringify(result).includes(text));
  assert.ok(!game.view().clock.pauseReasons.includes('provider')); game.tick(86000); assert.equal(game.view().clock.activeMs, 25000);
  assert.equal(calls, 1); assert.equal(provider.lastUsage?.externalCalls, 1);
});

const retryBody = (retryDelay: unknown) => ({ error: { details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay }] } });
test('037 429 delay parses numeric/date headers, protobuf durations and documented message; rounds up', () => {
  const now = Date.parse('2026-10-25T00:00:00Z');
  assert.equal(retryDelay('2.2', undefined, guard), 3);
  assert.equal(retryDelay('Sun, 25 Oct 2026 00:00:09 GMT', undefined, guard, now), 9);
  assert.equal(retryDelay('Sun, 25 Oct 2026 00:00:00 GMT', undefined, guard, now + 1000), 0);
  assert.equal(retryDelay(null, retryBody('4.1s'), guard), 5);
  assert.equal(retryDelay(null, retryBody({ seconds: '5', nanos: 1 }), guard), 6);
  assert.equal(retryDelay('2', retryBody('7s'), guard), 7);
  assert.equal(retryDelay(null, { error: { message: 'Please retry in 8.2s.' } }, guard), 9);
  for (const value of ['-1', 'NaN', 'Infinity', '90000', 'tomorrow', key]) assert.equal(retryDelay(value, undefined, guard), undefined);
  for (const value of ['-1s', '999999s', {}, { seconds: '2', nanos: 1e9 }]) assert.equal(retryDelay(null, retryBody(value), guard), undefined);
  assert.equal(retryDelay(null, { ...retryBody('5s'), private: key }, guard), undefined);
});

test('037 429 delay reaches settings, sanitized JSONL and game message without retries', async t => {
  const f = setup(t); let calls = 0;
  const runtime = new RuntimeSettings({ ...f, env: {}, transport: async () => { calls++; return Response.json(retryBody('6.5s'), { status: 429, headers: { 'retry-after': '3' } }); } });
  runtime.configure(config.model, key, 30);
  assert.equal(await runtime.test(), 'rate_limited'); assert.equal(calls, 1);
  assert.equal(runtime.status().retryAfterSeconds, 7); assert.equal(runtime.status().lastDiagnostic?.retryAfterSeconds, 7);
  const log = JSON.parse(readFileSync(f.diagnosticsFile, 'utf8').trim()); assert.equal(log.retryAfterSeconds, 7); guard.assertSafe(log);
  runtime.select('ai'); await assert.rejects(runtime.provider()!.interpret(input, signal()), (e: unknown) => {
    assert.ok(e instanceof ProviderError); assert.match(providerMessage(e), /Google 분당 한도\(429\): 7초/); return true;
  });
  assert.equal(calls, 2); assert.equal(runtime.status().dailyCalls, 2);
});

test('037 CLI duration respects rolling RPM, default/override and invalid options', () => {
  assert.equal(estimatePacedDuration(0, 12), 0); assert.equal(estimatePacedDuration(12, 12, 0), 0);
  assert.equal(estimatePacedDuration(13, 12, 0), 60000); assert.equal(estimatePacedDuration(25, 12, 0), 120000);
  assert.equal(estimatePacedDuration(18, 12), 73800); assert.equal(estimatePacedDuration(3, 1, 1000), 121000);
  assert.equal(parseOptions(['--live', '--rpm', '5']).rpm, 5);
  for (const rpm of ['0', '-1', '1.5', 'Infinity', '', '10001']) assert.throws(() => parseOptions(['--live', '--rpm', rpm]));
});

test('037 eval waits outside transport timeout and stops after 429, one daily charge per attempt', async t => {
  const f = setup(t), time = fakeClock(), cases = await loadCases('dev'); let calls = 0;
  const source = liveSource(3, { LLM_PROVIDER: 'gemini', GEMINI_MODEL_ID: config.model, GEMINI_API_KEY: key,
    LLM_DAILY_CALL_LIMIT: '30', LLM_SESSION_CALL_LIMIT: '30', LLM_TIMEOUT_MS: '100' }, {}, {
    budgetFile: f.budgetFile, rpm: 1, pacerClock: time.clock, transport: async () => { calls++; return new Response('{}', { status: 429 }); },
  })!;
  for (let i = 0; i < 3; i++) {
    const sample = await source.sample(cases[0]!, inputFor(cases[0]!));
    assert.equal(sample.neutralError, 'rate_limited'); assert.equal(sample.reservations, 1); assert.equal(sample.attempts.length, 1);
  }
  assert.deepEqual(time.waits, [60000, 60000]); assert.equal(calls, 3);
  assert.equal(JSON.parse(readFileSync(f.budgetFile, 'utf8')).calls, 3);
  const logs: string[] = []; let requests = 0;
  const exit = await main(['--live', '--limit', '3', '--max-calls', '3', '--rpm', '1'], { env: {
    LLM_PROVIDER: 'gemini', GEMINI_MODEL_ID: config.model, GEMINI_API_KEY: key, LLM_DAILY_CALL_LIMIT: '30', LLM_SESSION_CALL_LIMIT: '30',
  }, log: v => logs.push(v), outputRoot: join(f.dir, 'reports'), live: { pacerClock: time.clock, transport: async () => {
    assert.match(logs.join(' '), /예상 소요 123초/); requests++; return new Response('{}', { status: 429 });
  } } });
  assert.equal(exit, 2); assert.equal(requests, 1);
});

test('037 settings HTTP validates RPM, reports window usage and preserves counters on pacing refusal', async t => {
  const f = setup(t); let calls = 0;
  const server = createGameServer(undefined, 5173, { ...f, env: {}, transport: async () => { calls++; return good(); } });
  const port = await listenForFetch(server), base = `http://127.0.0.1:${port}`;
  t.after(() => { server.closeAllConnections(); server.close(); });
  const post = (path: string, value: unknown) => fetch(base + '/api/llm/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  const initial = await (await fetch(base + '/api/llm/status')).json(); assert.equal(initial.rpmLimit, 12); assert.equal(initial.minuteCalls, 0);
  for (const rpm of [0, -1, 1.5, '2', 10001]) assert.equal((await post('settings', { model: config.model, key, limit: 30, rpm })).status, 400);
  assert.equal((await post('settings', { model: config.model, key, limit: 30, rpm: 1 })).status, 200);
  assert.equal((await (await post('test', {})).json()).result, 'ok');
  const before = readFileSync(f.budgetFile, 'utf8'), log = readFileSync(f.diagnosticsFile, 'utf8');
  const refused = await (await post('test', {})).json(); assert.equal(refused.result, 'pacing');
  assert.equal(refused.status.minuteCalls, 1); assert.equal(refused.status.dailyCalls, 1); assert.equal(calls, 1);
  assert.equal(readFileSync(f.budgetFile, 'utf8'), before); assert.equal(readFileSync(f.diagnosticsFile, 'utf8'), log);
});
