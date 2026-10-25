import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Agent, ProxyAgent } from 'undici';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OllamaClient, OllamaProvider, OllamaQueue, ollamaBaseUrl, ollamaConfig } from '../server/llm/ollama.ts';
import { GeminiDiagnostics } from '../server/llm/gemini-response.ts';
import { configuredProvider } from '../server/llm/config.ts';
import { ProviderError } from '../server/llm/types.ts';
import { RequestPacer } from '../server/llm/pacer.ts';
import { CallBudget } from '../server/llm/budget.ts';
import { RuntimeSettings } from '../server/llm/runtime-settings.ts';
import { createGameServer } from '../server/http.ts';
import { listenForFetch } from '../scripts/test-server.ts';
import { main as evaluate, inputFor, parseOptions } from '../scripts/eval/run.ts';
import { loadCases } from '../scripts/eval/fixtures.ts';
import { compare } from '../scripts/eval/compare.ts';
import { liveSource } from '../scripts/eval/provider-bridge.ts';

const input = { text: '항복하면 어떻게 돼?', knowledge: { viewer: 'player' as const, documents: [] }, context: [], actions: [] };
const proposal = { intent: 'question', dialogue: '판단을 도와드리겠습니다.', proposedActions: [], unresolvedQuestions: [], referencedKnowledgeIds: [],
  usage: { inputTokens: 0, outputTokens: 0, externalCalls: 0, costUsd: null } };
const envelope = (content = JSON.stringify(proposal), extra = {}) => ({ message: { role: 'assistant', content }, done: true, done_reason: 'stop', prompt_eval_count: 31, eval_count: 17, ...extra });
const code = (expected: string) => (error: unknown) => error instanceof ProviderError && error.neutralCode === expected;
async function temporary(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'throne-ollama-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir;
}
async function fixture(t: TestContext, transport: typeof fetch, timeoutMs = 1000, queue?: OllamaQueue) {
  const dir = await temporary(t), file = join(dir, 'diagnostics.jsonl');
  const provider = new OllamaProvider(new OllamaClient({ model: 'qwen3:4b', timeoutMs }, transport, queue, new GeminiDiagnostics(file)));
  return { provider, file };
}

for (const url of ['https://example.com', 'http://192.168.1.2:11434', 'http://0.0.0.0:11434', 'http://127.0.0.1.evil.test',
  'http://user:pass@127.0.0.1:11434', 'file:///tmp/x', 'http://127.0.0.1/path', 'http://[::ffff:192.168.1.1]', 'http://127.0.0.1/?target=remote']) {
  test(`Ollama rejects unsafe endpoint ${url}`, () => { assert.throws(() => ollamaBaseUrl(url), code('request')); });
}
test('Ollama settings require a model and accept only bounded local timeouts', () => {
  assert.equal(ollamaBaseUrl('http://localhost:11434'), 'http://127.0.0.1:11434');
  assert.equal(ollamaBaseUrl('http://[::1]:11434'), 'http://[::1]:11434');
  assert.equal(ollamaConfig({ OLLAMA_MODEL_ID: 'qwen3:4b' })?.timeoutMs, 60000);
  assert.equal(ollamaConfig({ OLLAMA_MODEL_ID: 'org/model:tag', OLLAMA_TIMEOUT_MS: '120000' })?.timeoutMs, 120000);
  for (const env of [{}, { OLLAMA_TIMEOUT_MS: '120001' }, { OLLAMA_TIMEOUT_MS: '0' }, { OLLAMA_TIMEOUT_MS: 'NaN' }, { OLLAMA_BASE_URL: 'https://remote.invalid' }])
    assert.equal(ollamaConfig({ OLLAMA_MODEL_ID: 'qwen3:4b', ...env, ...(Object.keys(env).length ? {} : { OLLAMA_MODEL_ID: '' }) }), undefined);
});
test('Ollama factory has no key, quota or Google pacing dependency and sends native schema directly', async t => {
  const dir = await temporary(t); let calls = 0;
  class ForbiddenPacer extends RequestPacer { override async acquire(): Promise<void> { throw new Error('GOOGLE_PACER_USED'); } }
  class ForbiddenBudget extends CallBudget { override reserve(): void { throw new Error('GOOGLE_BUDGET_USED'); } }
  const selected = configuredProvider({ LLM_PROVIDER: 'ollama', OLLAMA_MODEL_ID: 'qwen3:4b', LLM_RPM_LIMIT: 'invalid', LLM_DAILY_CALL_LIMIT: '0' }, async (url, init) => {
    calls++; assert.equal(url, 'http://127.0.0.1:11434/api/chat');
    assert.equal(init?.redirect, 'error'); const dispatcher = (init as RequestInit & { dispatcher: unknown }).dispatcher;
    assert.ok(dispatcher instanceof Agent); assert.ok(!(dispatcher instanceof ProxyAgent));
    const headers = new Headers(init?.headers); assert.equal(headers.get('Authorization'), null); assert.equal(headers.get('x-goog-api-key'), null);
    const body = JSON.parse(String(init?.body)); assert.equal(body.model, 'qwen3:4b'); assert.equal(body.stream, false); assert.equal(body.think, false);
    assert.equal(body.format.type, 'object'); assert.equal(body.options.num_predict, 2048); assert.match(body.messages[1].content, /\/no_think$/);
    return Response.json(envelope());
  }, { pacer: new ForbiddenPacer(), budget: new ForbiddenBudget({ model: 'x', timeoutMs: 1000, retries: 0, dailyLimit: 0, sessionLimit: 0 }, join(dir, 'never.json')) });
  assert.equal(selected.timeoutMs, 60000); assert.ok(selected.provider);
  assert.equal((await selected.provider.interpret(input, new AbortController().signal) as typeof proposal).intent, 'question');
  assert.equal(calls, 1); assert.equal(selected.provider.lastUsage?.reservations, 0);
  assert.equal(selected.provider.lastUsage?.inputTokens, 31); assert.equal(selected.provider.lastUsage?.outputTokens, 17);
  await assert.rejects(readFile(join(dir, 'never.json')), { code: 'ENOENT' });
});
test('Ollama diagnostics capture provider/model/native tokens, never thinking or prompt text', async t => {
  const { provider, file } = await fixture(t, async () => Response.json(envelope(JSON.stringify(proposal), { message: { role: 'assistant', content: JSON.stringify(proposal), thinking: 'PRIVATE_THOUGHT_038' } })));
  await provider.interpret(input, new AbortController().signal);
  const text = await readFile(file, 'utf8'), row = JSON.parse(text);
  assert.equal(row.provider, 'ollama'); assert.equal(row.model, 'qwen3:4b'); assert.equal(row.route, 'direct'); assert.equal(row.networkMode, 'direct');
  assert.equal(row.inputTokens, 31); assert.equal(row.outputTokens, 17); assert.equal(row.thinkingTokens, null); assert.equal(row.resultCode, 'ok');
  assert.ok(!text.includes('PRIVATE_THOUGHT_038')); assert.ok(!text.includes(input.text)); assert.equal(row.dailyCalls, 0);
});
for (const content of [`<think>private reasoning {}</think>\n${JSON.stringify(proposal)}`, `<think>one</think><think>two</think>${JSON.stringify(proposal)}`]) {
  test('Ollama excludes complete leading reasoning blocks', async t => {
    const { provider } = await fixture(t, async () => Response.json(envelope(content)));
    assert.equal((await provider.interpret(input, new AbortController().signal) as typeof proposal).intent, 'question');
  });
}
for (const [name, transport, expected] of [
  ['incomplete think', async () => Response.json(envelope('<think>still thinking')), 'truncated'],
  ['cut JSON', async () => Response.json(envelope('{"intent":')), 'parse'],
  ['output cap', async () => Response.json(envelope('{', { done_reason: 'length' })), 'truncated'],
  ['incomplete envelope', async () => Response.json(envelope('{}', { done: false })), 'truncated'],
  ['empty content', async () => Response.json(envelope('')), 'empty'],
  ['wrong role', async () => Response.json(envelope('{}', { message: { role: 'user', content: '{}' } })), 'parse'],
  ['schema invalid', async () => Response.json(envelope('{"intent":"invented"}')), 'schema'],
  ['refused', async () => { throw new TypeError('PRIVATE_ERROR', { cause: { code: 'ECONNREFUSED' } }); }, 'network'],
  ['timeout', async () => new Promise<Response>(() => {}), 'timeout'],
  ['bad HTTP 400', async () => new Response('PRIVATE_ERROR', { status: 400 }), 'request'],
  ['missing model', async () => new Response('PRIVATE_ERROR', { status: 404 }), 'model'],
  ['HTTP 500', async () => new Response('PRIVATE_ERROR', { status: 500 }), 'server'],
  ['oversized', async () => new Response('x'.repeat(65537)), 'parse'],
] as [string, typeof fetch, string][]) {
  test(`Ollama classifies ${name}, single attempt and sanitized diagnostics`, async t => {
    let calls = 0; const { provider, file } = await fixture(t, async (...args) => { calls++; return transport(...args); }, name === 'timeout' ? 25 : 1000);
    await assert.rejects(provider.interpret(input, new AbortController().signal), code(expected)); assert.equal(calls, 1);
    assert.equal(provider.lastUsage?.externalCalls, 1); assert.equal(provider.lastUsage?.retries, 0);
    const text = await readFile(file, 'utf8'); assert.ok(!text.includes('PRIVATE_ERROR'));
    const row = JSON.parse(text); assert.equal(row.resultCode, expected);
    if (name === 'refused') assert.equal(row.networkError.code, 'ECONNREFUSED');
  });
}
test('Ollama queue serializes regenerated providers and cancelled waiters cannot skip the active request', async t => {
  const queue = new OllamaQueue(); let active = 0, max = 0, calls = 0;
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const transport: typeof fetch = async () => { calls++; active++; max = Math.max(max, active); entered(); await gate; active--; return Response.json(envelope()); };
  const a = (await fixture(t, transport, 1000, queue)).provider, b = (await fixture(t, transport, 1000, queue)).provider;
  const first = a.interpret(input, new AbortController().signal); await started;
  const controller = new AbortController(); const second = b.interpret(input, controller.signal); controller.abort();
  await assert.rejects(second, code('aborted'));
  const third = b.interpret(input, new AbortController().signal); assert.equal(calls, 1); release();
  await Promise.all([first, third]); assert.equal(max, 1); assert.equal(calls, 2);
});
test('Ollama runtime works with key absent, blocked Google limits and invalid Google settings; no counter change', async t => {
  const dir = await temporary(t), file = join(dir, 'usage.json'); await writeFile(file, 'corrupt-google-counter');
  let calls = 0, registryReads = 0;
  const runtime = new RuntimeSettings({ env: { LLM_RPM_LIMIT: 'invalid', GEMINI_THINKING_MODE: 'invalid', HTTPS_PROXY: 'http://remote.invalid:7777' },
    budgetFile: file, readSystemProxy: () => { registryReads++; throw new Error('NO_REGISTRY'); }, transport: async () => { calls++; return Response.json(envelope('{"ok":true}')); } });
  runtime.configureOllama('qwen3:4b', 'http://127.0.0.1:11434', 60000); runtime.select('ai');
  assert.ok(runtime.provider()); assert.equal(runtime.timeoutMs, 60000); assert.equal(await runtime.test(), 'ok'); assert.equal(calls, 1);
  assert.equal(runtime.status().keyConfigured, false); assert.equal(runtime.status().route, 'direct');
  assert.equal(runtime.pacer.snapshot().minuteCalls, 0); assert.equal(await readFile(file, 'utf8'), 'corrupt-google-counter');
  assert.equal(registryReads, 0);
});
test('Ollama changing settings cancels a pending test; late replies do not change status or duplicate diagnostics', async t => {
  const dir = await temporary(t); let reply!: (response: Response) => void, enter!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const runtime = new RuntimeSettings({ env: {}, budgetFile: join(dir, 'usage.json'), transport: async () => {
    enter(); return new Promise<Response>(resolve => { reply = resolve; });
  } });
  runtime.configureOllama('qwen3:4b', 'http://127.0.0.1:11434', 1000);
  const pending = runtime.test(); await entered;
  runtime.configureOllama('org/larger:8b', 'http://127.0.0.1:11434', 1000);
  assert.equal(await pending, 'stale');
  reply(Response.json(envelope('{"ok":true}')));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(runtime.status().model, 'org/larger:8b'); assert.equal(runtime.status().testResult, 'untested');
  const rows = (await readFile(join(dir, 'llm-diagnostics.jsonl'), 'utf8')).trim().split('\n');
  assert.equal(rows.length, 1); assert.equal(JSON.parse(rows[0]!).resultCode, 'aborted');
});
test('Ollama local API validates addresses before tags and starts AI without key, preserving Mock', async t => {
  const dir = await temporary(t); let calls = 0;
  const server = createGameServer(undefined, 5173, { env: {}, budgetFile: join(dir, 'usage.json'), transport: async (url) => {
    calls++; assert.match(String(url), /^http:\/\/127\.0\.0\.1:11434\/api\/(tags|chat)$/);
    return String(url).endsWith('/tags') ? Response.json({ models: [{ name: 'qwen3:4b' }, { name: 'org/model:tag' }] }) : Response.json(envelope('{"ok":true}'));
  } });
  const port = await listenForFetch(server); t.after(() => { server.closeAllConnections(); return new Promise<void>(resolve => server.close(() => resolve())); });
  const base = `http://127.0.0.1:${port}`, post = (path: string, data: unknown) => fetch(base + '/api/llm/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  assert.equal((await post('models', { baseUrl: 'http://remote.invalid' })).status, 400); assert.equal(calls, 0);
  assert.deepEqual(await (await post('models', { baseUrl: 'http://127.0.0.1:11434' })).json(), { models: ['qwen3:4b', 'org/model:tag'] });
  for (const body of [{ provider: 'ollama', model: 'qwen3:4b', baseUrl: 'http://remote.invalid', timeoutMs: 60000 },
    { provider: 'ollama', model: 'qwen3:4b', baseUrl: 'http://127.0.0.1:11434', timeoutMs: 120001 }]) assert.equal((await post('settings', body)).status, 400);
  const settings = await post('settings', { provider: 'ollama', model: 'qwen3:4b', baseUrl: 'http://127.0.0.1:11434', timeoutMs: 120000 }); assert.equal(settings.status, 200);
  assert.equal((await post('start', { mode: 'ai' })).status, 200);
  assert.equal((await (await fetch(base + '/api/state')).json()).mode, 'ai');
  assert.equal((await (await post('test', {})).json()).result, 'ok'); assert.equal(calls, 2);
  assert.equal((await post('start', { mode: 'mock' })).status, 200);
  assert.equal((await (await fetch(base + '/api/state')).json()).mode, 'mock'); assert.equal(calls, 2);
});
test('Ollama CLI runs all 80 dev fixtures without key, quota, or RPM; compares model originals and validated results', async t => {
  const dir = await temporary(t), good = JSON.parse(await readFile('tests/fixtures/eval-scripted-good.json', 'utf8'));
  const cases = await loadCases('dev'); const transportFor = () => {
    let at = 0;
    return { transport: (async () => Response.json(envelope(JSON.stringify(good.responses[cases[at++]!.id])))) as typeof fetch, count: () => at };
  };
  for (const model of ['qwen3:4b', 'org/larger:8b']) {
    const fake = transportFor();
    const exit = await evaluate(['--provider', 'ollama', '--split', 'dev'], { env: { OLLAMA_MODEL_ID: model }, outputRoot: join(dir, model.startsWith('qwen') ? 'a' : 'b'), log: () => {}, live: { transport: fake.transport, budgetFile: join(dir, 'never.json') } });
    assert.equal(exit, 0); assert.equal(fake.count(), 80);
  }
  const dirs = await Promise.all(['a', 'b'].map(async name => join(dir, name, (await readdir(join(dir, name)))[0]!)));
  const a = JSON.parse(await readFile(join(dirs[0]!, 'results.json'), 'utf8'));
  assert.equal(a.provider, 'ollama'); assert.equal(a.totalCases, 80); assert.equal(a.totals.modelRawPass, 80);
  assert.equal(a.totals.reservations, 0); assert.equal(a.counterPolicy, 'unlimited-local'); assert.equal(a.pacing, null);
  assert.equal(a.totals.inputTokensKnown, 80 * 31); assert.equal(a.totals.outputTokensKnown, 80 * 17); assert.equal(a.networkPolicy, 'direct');
  const table = await compare(dirs); for (const text of ['qwen3:4b', 'org/larger:8b', 'modelRaw', 'validated', 'p50', 'p95', '60/60']) assert.ok(table.includes(text));
  await assert.rejects(readFile(join(dir, 'never.json')), { code: 'ENOENT' });
  await assert.rejects(compare([dirs[0]!]), /COMPARE_TWO/);
  const b = JSON.parse(await readFile(join(dirs[1]!, 'results.json'), 'utf8')); b.fixtureHash = 'different'; await writeFile(join(dirs[1]!, 'results.json'), JSON.stringify(b));
  await assert.rejects(compare(dirs), /DIFFERENT_FIXTURES/);
});
test('Ollama environment selection and explicit call cap stay usable; CLI rejects proxy path', async () => {
  assert.equal(parseOptions(['--provider', 'ollama']).mode, 'live');
  const source = liveSource(1, { LLM_PROVIDER: 'ollama', OLLAMA_MODEL_ID: 'qwen3:4b' }, {}, { transport: async () => Response.json(envelope()) })!;
  assert.ok(source); const f = (await loadCases('dev'))[0]!;
  await source.sample(f, inputFor(f)); assert.equal((await source.sample(f, inputFor(f))).attempts.length, 0);
  assert.throws(() => liveSource(1, { LLM_PROVIDER: 'ollama', OLLAMA_MODEL_ID: 'qwen3:4b' }, {}, { networkMode: 'proxy' }), /NETWORK_GOOGLE_ONLY/);
});
