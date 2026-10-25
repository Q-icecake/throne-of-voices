import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { inspect } from 'node:util';
import { configuredProvider, geminiConfig } from '../server/llm/config.ts';
import type { ProviderConfig } from '../server/llm/config.ts';
import { CallBudget } from '../server/llm/budget.ts';
import { GeminiProvider } from '../server/llm/gemini.ts';
import { OpenAICompatibleProvider } from '../server/llm/openai-compatible.ts';
import { ProviderError } from '../server/llm/types.ts';
import type { ProviderErrorCode, InterpretationProvider, Proposal } from '../server/llm/types.ts';
import { actionVocabulary } from '../server/llm/validator.ts';
import { GameEngine } from '../server/engine.ts';
import { createGameServer } from '../server/http.ts';
import { interpret, withDeadline } from '../server/llm/pipeline.ts';
import { captureFailure } from '../server/llm/failure-context.ts';

// Synthetic credentials only; every adapter gets an injected transport, with real fetch disabled.
const key = 'sk-Synthetic-8zQ4vN7pR2xK9mT6';
const settings: ProviderConfig = { model: 'offline-model', timeoutMs: 200, retries: 0, dailyLimit: 20, sessionLimit: 20 };
const input = { text: '수군 상태는?', knowledge: new GameEngine().view().knowledge, context: [], actions: actionVocabulary() };
const proposal: Proposal = { intent: 'question', dialogue: '받은 보고를 확인해 주십시오.', proposedActions: [],
  unresolvedQuestions: [], referencedKnowledgeIds: [], usage: { inputTokens: 0, outputTokens: 0, externalCalls: 0, costUsd: null } };
type Kind = 'gemini' | 'openai-compatible';
function envelope(kind: Kind, output: unknown = proposal, finish?: string, usage = true): Response {
  const text = typeof output === 'string' ? output : JSON.stringify(output);
  return Response.json(kind === 'gemini' ? { candidates: [{ finishReason: finish ?? 'STOP', content: { parts: [{ text }] } }],
    ...(usage ? { usageMetadata: { promptTokenCount: 123, candidatesTokenCount: 45 } } : {}) } :
    { choices: [{ finish_reason: finish ?? 'stop', message: { content: text } }], ...(usage ? { usage: { prompt_tokens: 123, completion_tokens: 45 } } : {}) });
}
function make(kind: Kind, transport: typeof fetch, file: string, config = settings, credential = key) {
  const budget = new CallBudget(config, file);
  return kind === 'gemini' ? new GeminiProvider(config, transport, budget, credential) :
    new OpenAICompatibleProvider({ ...config, baseUrl: 'https://offline.invalid/v1/' }, transport, budget, credential);
}
async function failure(provider: InterpretationProvider, code: ProviderErrorCode, signal = new AbortController().signal) {
  await assert.rejects(provider.interpret(input, signal), error => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.neutralCode, code);
    assert.equal(error.usage?.errorCode, code);
    assert.doesNotMatch(inspect(error), /Synthetic|8zQ4vN7p/);
    return true;
  });
  assert.equal(provider.lastUsage?.errorCode, code);
}

test('provider selection defaults, explicit invalid/missing setup and old exports remain safe without network', async t => {
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('external network forbidden'); });
  assert.deepEqual(configuredProvider({}), { status: 'AI 미연결, Mock 사용 중', timeoutMs: 15000 });
  for (const env of [{ LLM_PROVIDER: 'mock' }, { LLM_PROVIDER: 'gemini' }, { LLM_PROVIDER: 'openai-compatible' }, { LLM_PROVIDER: 'invalid' }]) {
    assert.equal(configuredProvider(env).provider, undefined);
    assert.match(configuredProvider(env).status, /Mock/);
  }
  const base = { LLM_PROVIDER: 'openai-compatible', OPENAI_COMPAT_API_KEY: key,
    OPENAI_COMPAT_MODEL_ID: 'owner/model', OPENAI_COMPAT_BASE_URL: 'https://offline.invalid/v1' };
  for (const field of ['OPENAI_COMPAT_MODEL_ID', 'OPENAI_COMPAT_BASE_URL']) assert.equal(configuredProvider({ ...base, [field]: '' }).provider, undefined);
  for (const url of ['http://remote.invalid/v1', 'https://user:pass@offline.invalid', 'https://offline.invalid/?key=x', 'file:///tmp', 'bad']) {
    assert.equal(configuredProvider({ ...base, OPENAI_COMPAT_BASE_URL: url }).provider, undefined);
  }
  for (const invalid of [{ LLM_RETRIES: '101' }, { LLM_DAILY_CALL_LIMIT: '10001' }, { LLM_SESSION_CALL_LIMIT: '-1' }, { LLM_TIMEOUT_MS: '0' }]) {
    assert.equal(configuredProvider({ ...base, ...invalid }).provider, undefined);
  }
  assert.ok(configuredProvider(base).provider instanceof OpenAICompatibleProvider);
  assert.ok(configuredProvider({ ...base, OPENAI_COMPAT_BASE_URL: 'http://localhost:1234/v1' }).provider);
  assert.ok(configuredProvider({ LLM_PROVIDER: 'gemini', GEMINI_API_KEY: key, GEMINI_MODEL_ID: 'offline-model' }).provider instanceof GeminiProvider);
  const old = await import('../server/llm/gemini.ts');
  assert.equal(old.geminiConfig, geminiConfig); assert.equal(old.configuredProvider, configuredProvider); assert.equal(old.CallBudget, CallBudget);
});

for (const kind of ['gemini', 'openai-compatible'] as const) {
  test(`${kind}: offline adapter contract`, async t => {
    t.mock.method(globalThis, 'fetch', async () => { assert.fail('external network forbidden'); });
    const dir = mkdtempSync(join(tmpdir(), 'throne-provider-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    let serial = 0;
    const fresh = () => join(dir, `${serial++}.json`);

    await t.test('request, raw current input policy, trusted usage and detached telemetry', async () => {
      const p = make(kind, async (url, init) => {
        assert.equal(init?.redirect, 'error'); assert.equal(init?.method, 'POST');
        assert.equal(new Headers(init?.headers).get(kind === 'gemini' ? 'x-goog-api-key' : 'Authorization'), kind === 'gemini' ? key : `Bearer ${key}`);
        assert.ok(!String(url).includes(key)); assert.ok(!String(init?.body).includes(key));
        const body = JSON.parse(String(init?.body));
        if (kind === 'openai-compatible') {
          assert.equal(url, 'https://offline.invalid/v1/chat/completions'); assert.equal(body.model, settings.model);
          assert.equal(body.response_format.type, 'json_schema'); assert.equal(body.response_format.json_schema.strict, true);
          assert.equal(body.response_format.json_schema.schema.additionalProperties, false);
          assert.deepEqual(JSON.parse(body.messages[1].content), input);
        } else assert.deepEqual(JSON.parse(body.contents[0].parts[0].text), input);
        return envelope(kind, { ...proposal, usage: { inputTokens: 999999, outputTokens: 99999, externalCalls: 9999, costUsd: 1 } });
      }, fresh());
      const output = await interpret(p, input, 500);
      assert.deepEqual(output.usage, { inputTokens: 123, outputTokens: 45, externalCalls: 1, costUsd: null });
      assert.equal(p.lastUsage?.attempts, 1); assert.equal(p.lastUsage?.reservations, 1); assert.equal(p.lastUsage?.errorCode, null);
      const copy = p.lastUsage!; copy.attemptUsage[0]!.inputTokens = 999;
      assert.equal(p.lastUsage?.attemptUsage[0]?.inputTokens, 123);
      assert.doesNotMatch(inspect(p), /Synthetic|offline\.invalid|#key/);
    });

    const cases: [string, typeof fetch, ProviderErrorCode][] = [
      ['schema violation', async () => envelope(kind, { ...proposal, intent: 'not-an-intent' }), 'schema'],
      ['invalid JSON', async () => envelope(kind, '{'), 'schema'],
      ['truncation', async () => envelope(kind, proposal, kind === 'gemini' ? 'MAX_TOKENS' : 'length'), 'schema'],
      ['empty envelope', async () => Response.json({}), 'schema'],
      ['null envelope', async () => Response.json(null), 'schema'],
      ['local uniqueItems enforcement', async () => envelope(kind, { ...proposal, unresolvedQuestions: ['어떤 보고입니까?', '어떤 보고입니까?'] }), 'schema'],
      ['refusal or safety stop', async () => kind === 'gemini' ? envelope(kind, proposal, 'SAFETY') : Response.json({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(proposal), refusal: '거절' } }],
      }), 'schema'],
      ['malformed envelope types', async () => Response.json(kind === 'gemini' ? { candidates: [{ content: { parts: {} } }] } :
        { choices: [{ finish_reason: 'stop', message: { content: 42 } }] }), 'schema'],
      ['HTTP 400', async () => new Response(key, { status: 400 }), 'schema'],
      ['HTTP 401', async () => new Response(key, { status: 401 }), 'auth'],
      ['HTTP 403', async () => new Response(key, { status: 403 }), 'auth'],
      ['HTTP 503', async () => new Response(key, { status: 503 }), 'server'],
      ['HTTP 429', async () => new Response(key, { status: 429 }), 'rate_limited'],
      ['transport exception', async () => { throw new Error(key); }, 'server'],
      ['oversized envelope', async () => new Response('x'.repeat(65537)), 'schema'],
    ];
    for (const [name, transport, code] of cases) await t.test(name, async () => {
      const p = make(kind, transport, fresh());
      await failure(p, code); assert.equal(p.lastUsage?.externalCalls, 1);
      if (name === 'schema violation' || name === 'truncation' || name === 'invalid JSON') assert.equal(p.lastUsage?.outputTokens, 45);
      else if (name === 'local uniqueItems enforcement' || (name === 'refusal or safety stop' && kind === 'gemini')) assert.equal(p.lastUsage?.outputTokens, 45);
      else assert.equal(p.lastUsage?.outputTokens, null);
    });

    const variants = [key, key.toUpperCase(), encodeURIComponent(key), Buffer.from(key).toString('base64'),
      Buffer.from(key).toString('hex'), key.slice(-12), [...key].join(' '), [...key].map(c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).join('')];
    for (const [i, secret] of variants.entries()) await t.test(`credential reflection variant ${i + 1}`, async () => {
      await failure(make(kind, async () => envelope(kind, { ...proposal, dialogue: `보고 ${secret}` }), fresh()), 'schema');
    });

    await t.test('unknown metadata stays null in neutral telemetry', async () => {
      const p = make(kind, async () => envelope(kind, proposal, undefined, false), fresh());
      await p.interpret(input, new AbortController().signal);
      assert.equal(p.lastUsage?.inputTokens, null); assert.equal(p.lastUsage?.outputTokens, null);
    });
    await t.test('failed retry reservations are counted and unknown tokens are not zero', async () => {
      let calls = 0; const file = fresh();
      const p = make(kind, async () => ++calls === 1 ? new Response(key, { status: 503 }) : envelope(kind), file, { ...settings, retries: 2 });
      const output = await interpret(p, input, 500);
      assert.equal(output.usage.externalCalls, 2);
      assert.equal(p.lastUsage?.attempts, 2); assert.equal(p.lastUsage?.retries, 1); assert.equal(p.lastUsage?.reservations, 2);
      assert.equal(p.lastUsage?.inputTokens, null); assert.equal(p.lastUsage?.attemptUsage[1]?.inputTokens, 123);
      assert.equal(p.lastUsage?.attemptUsage[0]?.errorCode, 'server'); assert.equal(p.lastUsage?.errorCode, null);
      assert.equal(JSON.parse(readFileSync(file, 'utf8')).calls, 2);
    });
    await t.test('429 and auth never retry', async () => {
      for (const status of [429, 401, 403, 400]) {
        let calls = 0; const p = make(kind, async () => { calls++; return new Response(key, { status }); }, fresh(), { ...settings, retries: 3 });
        await failure(p, status === 429 ? 'rate_limited' : status === 400 ? 'schema' : 'auth'); assert.equal(calls, 1);
      }
    });
    await t.test('zero budget blocks before transport and AI source remains explicit', async () => {
      const file = fresh(); const p = make(kind, async () => { assert.fail('budget must prevent fetch'); }, file, { ...settings, dailyLimit: 0 });
      await failure(p, 'budget'); assert.equal(p.lastUsage?.attempts, 0); assert.equal(p.lastUsage?.reservations, 0);
      assert.equal(p.source, 'AI'); assert.match(p.status, /budget.*상한/); assert.equal(existsSync(file), false);
    });
    await t.test('retry cannot bypass cap; daily budget survives new provider', async () => {
      const file = fresh(); let calls = 0;
      const config = { ...settings, retries: 3, dailyLimit: 1 };
      const p = make(kind, async () => { calls++; return new Response('', { status: 503 }); }, file, config);
      await failure(p, 'budget'); assert.equal(calls, 1);
      await failure(make(kind, async () => { assert.fail('daily reservation must survive restart'); }, file, config), 'budget');
    });
    await t.test('timeout settles even when transport ignores abort', async () => {
      const p = make(kind, async () => new Promise(() => {}), fresh(), { ...settings, timeoutMs: 10, retries: 3 });
      await failure(p, 'timeout'); assert.equal(p.lastUsage?.externalCalls, 1);
    });
    await t.test('outer pipeline deadline stays timeout in nested provider telemetry', async () => {
      const p = make(kind, async () => new Promise(() => {}), fresh());
      await assert.rejects(interpret(p, input, 10), error => {
        assert.ok(error instanceof ProviderError); assert.equal(error.neutralCode, 'timeout');
        assert.equal(error.usage?.errorCode, 'timeout'); assert.equal(error.usage?.externalCalls, 1);
        return true;
      });
      await new Promise(resolve => setTimeout(resolve, 0));
      assert.equal(p.lastUsage?.errorCode, 'timeout');
    });
    await t.test('already aborted request consumes no reservation', async () => {
      const controller = new AbortController(); controller.abort(); const file = fresh();
      const p = make(kind, async () => { assert.fail('aborted fetch'); }, file);
      await failure(p, 'aborted', controller.signal); assert.equal(p.lastUsage?.attempts, 0); assert.equal(existsSync(file), false);
    });
    await t.test('in-flight cancellation is distinct from timeout', async () => {
      const controller = new AbortController();
      const p = make(kind, async () => { queueMicrotask(() => controller.abort()); return new Promise(() => {}); }, fresh());
      await failure(p, 'aborted', controller.signal); assert.equal(p.lastUsage?.externalCalls, 1);
    });
    await t.test('hanging body is cancelled on deadline', async () => {
      let cancelled = false;
      const p = make(kind, async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })), fresh(), { ...settings, timeoutMs: 10 });
      await failure(p, 'timeout'); assert.equal(cancelled, true);
    });
    await t.test('late completion cannot overwrite finalized failure usage or state', async () => {
      let finish!: (value: Response) => void;
      const p = make(kind, async () => new Promise(resolve => { finish = resolve; }), fresh(), { ...settings, timeoutMs: 10 });
      await failure(p, 'timeout'); const before = p.lastUsage;
      finish(envelope(kind)); await new Promise(resolve => setTimeout(resolve, 5));
      assert.deepEqual(p.lastUsage, before);
    });
  });
}

test('deadline classifies caller cancellation separately, and request captures are concurrent-safe', async () => {
  const a = new AbortController(); a.abort();
  await assert.rejects(withDeadline(async () => new Promise(() => {}), 50, a.signal), (e: unknown) => e instanceof ProviderError && e.neutralCode === 'aborted');
  const outcomes = await Promise.all(['auth', 'rate_limited'].map(code => captureFailure(async () => {
    try { await interpret({ source: 'AI', status: 'test', interpret: async () => { await Promise.resolve(); throw new ProviderError(code as ProviderErrorCode); } }, input, 100); } catch { /* engine compatibility */ }
    return code;
  })));
  assert.deepEqual(outcomes.map(item => item.code), ['auth', 'rate_limited']);
});

test('HTTP neutral errors, chip polling, budget Korean guidance and all output paths exclude credentials', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'throne-provider-http-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const messages: unknown[] = [];
  t.mock.method(console, 'log', (...values: unknown[]) => { messages.push(values); });
  t.mock.method(console, 'error', (...values: unknown[]) => { messages.push(values); });
  const localFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    assert.match(String(url), /^http:\/\/127\.0\.0\.1:\d+\/api\//); return localFetch(url, init);
  });
  const p = make('openai-compatible', async () => new Response(key, { status: 429, headers: { 'x-reflected-key': key } }), join(dir, 'usage.json'), { ...settings, sessionLimit: 1 });
  const engine = new GameEngine(undefined, undefined, p, 500);
  const server = createGameServer(engine); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/`;
  const outputs: unknown[] = [];
  const before = engine.internalSnapshot();
  for (const code of ['rate_limited', 'budget']) {
    const response = await (await fetch(base + 'command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'submit', text: input.text }) })).json();
    outputs.push(response);
    assert.equal(response.outcome.providerCode, code); assert.equal(response.outcome.code, 'CALL_LIMIT');
    assert.equal(response.outcome.input, input.text); assert.match(response.outcome.reply, /Mock으로 전환하지 않았습니다/);
    assert.equal(response.state.interpretation.source, 'AI'); assert.ok(response.state.interpretation.status.startsWith(`[${code}]`));
    const state = await (await fetch(base + 'state')).json(); assert.ok(state.interpretation.status.startsWith(`[${code}]`)); outputs.push(state);
    assert.deepEqual(engine.internalSnapshot(), before);
  }
  for (const path of ['health', 'state', 'test/snapshot', 'test/logs']) outputs.push(await (await fetch(base + path)).json());
  outputs.push(engine.publicSnapshot(), engine.logs(), p.lastUsage, inspect(p), messages, readFileSync(join(dir, 'usage.json'), 'utf8'));
  const all = JSON.stringify(outputs); assert.ok(!all.includes(key)); assert.doesNotMatch(all, /Synthetic|8zQ4vN7p/);
});

for (const kind of ['gemini', 'openai-compatible'] as const) test(`${kind}: HTTP command/talk use neutral codes, recover and preserve reset budgets`, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'throne-provider-wire-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const localFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    assert.match(String(url), /^http:\/\/127\.0\.0\.1:\d+\/api\//); return localFetch(url, init);
  });
  let next: () => Promise<Response> = async () => envelope(kind);
  const file = join(dir, 'usage.json');
  const p = make(kind, async () => next(), file, { ...settings, timeoutMs: 20, sessionLimit: 7 });
  const engine = new GameEngine(undefined, undefined, p, 500);
  engine.audience({ type: 'invite', participants: ['zhou-yu'] });
  const server = createGameServer(engine); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/`;
  const post = async (path: string, data: unknown) => (await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })).json();
  const output: unknown[] = [];
  const errors: [ProviderErrorCode, () => Promise<Response>][] = [
    ['auth', async () => new Response(key, { status: 401 })],
    ['schema', async () => envelope(kind, { ...proposal, dialogue: `보고 ${key.slice(-12)}` })],
    ['server', async () => { throw new Error(key); }],
    ['timeout', async () => new Promise(() => {})],
    ['rate_limited', async () => new Response(key, { status: 429 })],
    ['aborted', async () => { throw new ProviderError('aborted'); }],
  ];
  for (const [i, [code, transport]] of errors.entries()) {
    next = transport;
    const before = engine.internalSnapshot();
    const result = await post(i % 2 ? 'command' : 'talk', i % 2 ? { type: 'submit', text: input.text } : { characterId: 'zhou-yu', text: input.text });
    assert.equal(result.outcome.providerCode, code); assert.equal(result.state.interpretation.source, 'AI');
    assert.ok(result.state.interpretation.status.startsWith(`[${code}]`));
    assert.deepEqual(engine.internalSnapshot(), before);
    output.push(result, p.lastUsage, await (await fetch(base + 'health')).json());
  }
  next = async () => envelope(kind);
  const recovered = await post('command', { type: 'submit', text: input.text });
  assert.equal(recovered.outcome.kind, 'answer'); assert.match(recovered.state.interpretation.status, /라이브 미검증/);
  await post('test/reset', {});
  const capped = await post('command', { type: 'submit', text: input.text });
  assert.equal(capped.outcome.providerCode, 'budget'); assert.equal(capped.state.interpretation.source, 'AI');
  output.push(capped, engine.logs(), engine.publicSnapshot(), readFileSync(file, 'utf8'));
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).calls, 7);
  assert.doesNotMatch(JSON.stringify(output), /Synthetic|8zQ4vN7p|xK9mT6/);
});
