import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { RuntimeSettings } from '../server/llm/runtime-settings.ts';
import { GeminiProvider } from '../server/llm/gemini.ts';
import { GeminiDiagnostics } from '../server/llm/gemini-response.ts';
import { CallBudget } from '../server/llm/budget.ts';
import { SecretGuard } from '../server/llm/secrets.ts';
import { ProviderError } from '../server/llm/types.ts';
import { GameEngine } from '../server/engine.ts';
import type { LlmDiagnostic } from '../shared/contracts.ts';

const key = 'synthetic-033-Z8m4N7v2S6h9Q3b5+/=';
const config = { model: 'offline-model', timeoutMs: 200, retries: 0, dailyLimit: 30, sessionLimit: 30 };
const input = { text: '보고', knowledge: new GameEngine().view().knowledge, context: [], actions: [] };
function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'throne-network-033-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const output: string[] = []; t.mock.method(console, 'info', (line: string) => output.push(line));
  return { budgetFile: join(dir, 'usage.json'), diagnosticsFile: join(dir, 'diagnostics.jsonl'), output };
}
const scenarios = [
  ...['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_SOCKET'].map(code => [code, 'network']),
  ...['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'].map(code => [code, 'timeout']),
  ...['CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'ERR_TLS_CERT_ALTNAME_INVALID', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_SSL_WRONG_VERSION_NUMBER', 'CERT_FUTURE_UNKNOWN'].map(code => [code, 'tls']),
] as const;
for (const route of ['connection', 'game']) for (const [code, result] of scenarios) test(`033 ${route}: ${code} classified without HTTP or secret reflection`, async t => {
  const paths = fixture(t);
  const transport: typeof fetch = async () => { throw new TypeError(`fetch failed https://secret.invalid/?key=${key} Authorization: PRIVATE_HEADER`,
    { cause: Object.assign(new Error('PRIVATE_CAUSE'), { code }) }); };
  if (route === 'connection') {
    const runtime = new RuntimeSettings({ ...paths, env: {}, transport }); runtime.configure(config.model, key, 30);
    assert.equal(await runtime.test(), result);
    assert.deepEqual(runtime.status().lastDiagnostic, JSON.parse(paths.output[0]!));
    assert.equal(runtime.status().sessionCalls, 1);
  } else {
    const provider = new GeminiProvider(config, transport, new CallBudget(config, paths.budgetFile), key, new GeminiDiagnostics(paths.diagnosticsFile));
    await assert.rejects(provider.interpret(input, new AbortController().signal), error => error instanceof ProviderError && error.neutralCode === result);
    assert.match(provider.status, new RegExp(`\\[${result}\\]`));
    assert.equal(provider.lastUsage?.externalCalls, 1);
  }
  assert.equal(paths.output.length, 1);
  const file = readFileSync(paths.diagnosticsFile, 'utf8'); assert.equal(file, paths.output[0] + '\n');
  const row: LlmDiagnostic = JSON.parse(file);
  assert.equal(row.source, 'test'); assert.equal(row.httpStatus, null); assert.equal(row.resultCode, result);
  assert.deepEqual(row.networkError, { name: 'TypeError', code: code === 'CERT_FUTURE_UNKNOWN' ? null : code });
  assert.equal(row.retries, 0); assert.equal(row.dailyCalls, 1);
  new SecretGuard(key).assertSafe(file);
  for (const privateText of ['secret.invalid', 'https://', 'Authorization', 'PRIVATE_HEADER', 'PRIVATE_CAUSE', 'fetch failed']) assert.ok(!file.includes(privateText));
});

for (const name of ['AbortError', 'TimeoutError']) test(`033 transport ${name} is a connection timeout`, async t => {
  const paths = fixture(t), runtime = new RuntimeSettings({ ...paths, env: {}, transport: async () => { throw new DOMException('PRIVATE_MESSAGE', name); } });
  runtime.configure(config.model, key, 30); assert.equal(await runtime.test(), 'timeout');
  assert.deepEqual(runtime.status().lastDiagnostic?.networkError, { name, code: null });
});

test('033 nested AggregateError is bounded and retains only a recognized code', async t => {
  const paths = fixture(t), cyclic = new Error(key, { cause: null }); cyclic.cause = cyclic;
  const runtime = new RuntimeSettings({ ...paths, env: {}, transport: async () => {
    throw new TypeError(key, { cause: new AggregateError([cyclic, Object.assign(new Error(key), { code: 'ECONNREFUSED' })]) });
  } });
  runtime.configure(config.model, key, 30); assert.equal(await runtime.test(), 'network');
  assert.equal(runtime.status().lastDiagnostic?.networkError?.code, 'ECONNREFUSED');
});

for (const secret of [key, encodeURIComponent(key), Buffer.from(key).toString('base64'), key.slice(-12), 'https://private.invalid/?key=hidden', 'Authorization: hidden'])
  test('033 unknown network names/codes never export arbitrary strings', async t => {
    const paths = fixture(t), runtime = new RuntimeSettings({ ...paths, env: {}, transport: async () => { throw { name: secret, code: secret, message: secret, cause: { code: secret } }; } });
    runtime.configure(config.model, key, 30); assert.equal(await runtime.test(), 'network');
    assert.deepEqual(runtime.status().lastDiagnostic?.networkError, { name: null, code: null });
    assert.ok(!readFileSync(paths.diagnosticsFile, 'utf8').includes(secret));
  });

test('033 recognized network fields still pass the credential guard', async t => {
  const paths = fixture(t), runtime = new RuntimeSettings({ ...paths, env: {}, transport: async () => { throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }); } });
  runtime.configure(config.model, 'ENOTFOUND', 30); assert.equal(await runtime.test(), 'network');
  assert.deepEqual(runtime.status().lastDiagnostic?.networkError, { name: 'TypeError', code: null });
  assert.ok(!readFileSync(paths.diagnosticsFile, 'utf8').includes('ENOTFOUND'));
});

test('033 ignored deadline and cancellation log once, while HTTP body timeout remains an HTTP failure', async t => {
  const paths = fixture(t);
  const runtime = new RuntimeSettings({ ...paths, env: {}, timeoutMs: 15, transport: async () => new Promise<Response>(() => {}) });
  runtime.configure(config.model, key, 30); assert.equal(await runtime.test(), 'timeout');
  assert.deepEqual(runtime.status().lastDiagnostic?.networkError, { name: 'TimeoutError', code: null });
  const pending = runtime.test(); await new Promise(r => setTimeout(r, 2)); runtime.clear(); assert.equal(await pending, 'stale');
  assert.equal(runtime.status().lastDiagnostic?.networkError?.name, 'AbortError');
  const body = new RuntimeSettings({ ...paths, env: {}, timeoutMs: 15, transport: async () => new Response(new ReadableStream()) });
  body.configure(config.model, key, 30); assert.equal(await body.test(), 'timeout');
  assert.equal(body.status().lastDiagnostic?.httpStatus, 200); assert.equal(body.status().lastDiagnostic?.networkError, null);
  assert.equal(paths.output.length, 3);
});

for (const variable of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NO_PROXY', 'none']) test(`033 proxy presence only: ${variable}`, t => {
  const paths = fixture(t), value = 'http://PRIVATE_USER:PRIVATE_PASSWORD@private.invalid:1234';
  const runtime = new RuntimeSettings({ ...paths, env: variable === 'none' ? {} : { [variable]: value } });
  assert.equal(runtime.status().proxyDetected, !['NO_PROXY', 'none'].includes(variable));
  const published = JSON.stringify(runtime.status());
  for (const part of [value, 'PRIVATE_USER', 'PRIVATE_PASSWORD', 'private.invalid']) assert.ok(!published.includes(part));
  assert.equal(paths.output.length, 0);
});

test('033 new source marker preserves legacy lines verbatim', t => {
  const paths = fixture(t), legacy = '{"httpStatus":503,"oldSynthetic":true}\n';
  writeFileSync(paths.diagnosticsFile, legacy);
  const sink = new GeminiDiagnostics(paths.diagnosticsFile, 'live'); sink.write(200, {}, new SecretGuard(key));
  const file = readFileSync(paths.diagnosticsFile, 'utf8'); assert.ok(file.startsWith(legacy));
  assert.equal(JSON.parse(file.trim().split('\n')[1]!).source, 'live');
});

test('033 native Node proxy flag routes HTTP and HTTPS to a local-only fake proxy and respects NO_PROXY', async t => {
  let http = 0, connects = 0;
  const proxy = createServer((req, res) => { assert.equal(req.url, 'http://proxy-check.invalid/'); http++; res.end('local-proxy'); });
  proxy.on('connect', (req, socket) => { assert.equal(req.url, 'proxy-check.invalid:443'); connects++; socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n'); });
  const direct = createServer((_req, res) => res.end('direct'));
  proxy.listen(0, '127.0.0.1'); direct.listen(0, '127.0.0.1'); await Promise.all([once(proxy, 'listening'), once(direct, 'listening')]);
  t.after(() => { proxy.closeAllConnections(); proxy.close(); direct.closeAllConnections(); direct.close(); });
  const proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  const directUrl = `http://127.0.0.1:${(direct.address() as AddressInfo).port}`;
  const child = spawn(process.execPath, ['--use-env-proxy', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    assert.equal(await (await fetch('http://proxy-check.invalid/', {signal: AbortSignal.timeout(3000)})).text(), 'local-proxy');
    await assert.rejects(fetch('https://proxy-check.invalid/', {signal: AbortSignal.timeout(3000)}));
    assert.equal(await (await fetch(${JSON.stringify(directUrl)}, {signal: AbortSignal.timeout(3000)})).text(), 'direct');
  `], { windowsHide: true, env: { HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, NO_PROXY: '127.0.0.1' }, stdio: 'pipe' });
  const chunks: Buffer[] = []; child.stderr.on('data', data => chunks.push(data));
  assert.equal((await once(child, 'close'))[0], 0, Buffer.concat(chunks).toString());
  assert.equal(http, 1); assert.ok(connects >= 1);
});
