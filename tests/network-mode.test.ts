import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { Agent, ProxyAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import type { Dispatcher } from 'undici';
import { NetworkRouter, NetworkSelection, normalizeProxy, readWindowsProxy } from '../server/llm/network-routing.ts';
import { RuntimeSettings } from '../server/llm/runtime-settings.ts';
import { networkAdvice } from '../shared/network.ts';
import type { NetworkMode } from '../shared/contracts.ts';
import { GameEngine } from '../server/engine.ts';
import { createGameServer } from '../server/http.ts';
import { listenForFetch } from '../scripts/test-server.ts';

const key = 'synthetic-034-Q7m2V8r4H6s9D3x5';
const manual = 'http://private-user:private-pass@127.0.0.1:18931';
const envAddress = 'http://env-private.invalid:18932';
const systemAddress = '127.0.0.1:18933';
const noSystem = () => ({ enabled: false, server: '', pac: false });
const system = () => ({ enabled: true, server: systemAddress, pac: false });
const good = (text = 'OK') => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }] });
const input = { text: '보고', knowledge: new GameEngine().view().knowledge, context: [], actions: [] };
function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'throne-network-034-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const output: string[] = []; t.mock.method(console, 'info', (line: string) => output.push(line));
  return { budgetFile: join(dir, 'usage.json'), diagnosticsFile: join(dir, 'diagnostics.jsonl'), output };
}

for (const mode of ['auto', 'proxy', 'direct'] as const) for (const source of ['none', 'system', 'env', 'manual'] as const)
  test(`034 ${mode}/${source}: priority, safe metadata, no network during selection`, () => {
    let reads = 0;
    const router = new NetworkRouter(source === 'env' || source === 'manual' ? { HTTPS_PROXY: envAddress } : {},
      () => { reads++; return source === 'none' ? noSystem() : system(); });
    router.configure(mode, source === 'manual' ? manual : '');
    const route = mode === 'direct' || source === 'none' ? 'direct' : `${source === 'env' ? 'env' : source}-proxy`;
    assert.deepEqual(router.select().metadata(), { networkMode: mode, route });
    assert.equal(reads, mode === 'direct' || source === 'manual' || source === 'env' ? 0 : 1);
    const published = JSON.stringify([router, router.select(), router.status()]);
    for (const value of [manual, 'private-user', 'private-pass', '127.0.0.1', '18931', 'env-private.invalid']) assert.ok(!published.includes(value));
  });

for (const variable of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) test(`034 environment fallback: ${variable}`, () => {
  const router = new NetworkRouter({ [variable]: envAddress }, () => { throw new Error('must not read system'); });
  assert.equal(router.select().route, 'env-proxy');
});

for (const [server, expected] of [['127.0.0.1:1', 'system-proxy'], ['http=a.invalid:1;https=b.invalid:2;socks=c.invalid:3', 'system-proxy'],
  ['socks=c.invalid:3', 'direct'], ['', 'direct']] as const) test(`034 Windows protocol map: ${server}`, () => {
  const router = new NetworkRouter({}, () => ({ enabled: true, server, pac: false }));
  assert.equal(router.select().route, expected);
});

test('034 Windows registry reader: exact values, readonly arguments, missing/disabled/PAC/non-Windows', () => {
  const calls: string[] = [];
  const reader = (name: string) => { calls.push(name); return `    ${name}    ${name === 'ProxyEnable' ? 'REG_DWORD    0x1' : `REG_SZ    ${name === 'ProxyServer' ? systemAddress : 'http://pac-private.invalid/pac'}`}\r\n`; };
  assert.deepEqual(readWindowsProxy('win32', reader), { enabled: true, server: systemAddress, pac: true });
  assert.deepEqual(calls, ['ProxyEnable', 'ProxyServer', 'AutoConfigURL']);
  assert.deepEqual(readWindowsProxy('linux', () => { throw new Error('do not read'); }), noSystem());
  assert.deepEqual(readWindowsProxy('win32', () => { throw new Error('PRIVATE_REGISTRY_ERROR'); }), noSystem());
  assert.equal(readWindowsProxy('win32', name => name === 'ProxyEnable' ? 'ProxyEnable REG_DWORD 0x0' : '').enabled, false);
  const pac = new NetworkRouter({}, () => ({ enabled: false, server: systemAddress, pac: true })).status();
  assert.equal(pac.route, 'direct'); assert.equal(pac.pacUnsupported, true);
  assert.ok(!JSON.stringify(pac).includes(systemAddress));
});

for (const address of ['socks5://127.0.0.1:7890', 'file:///private', 'http://', 'http://proxy.invalid/path', 'proxy.invalid?key=secret', 'proxy.invalid#secret', 'a\r\nb', 'a'.repeat(2049)])
  test(`034 reject unsafe proxy syntax ${address.slice(0, 24).replace(/[\r\n]/g, '')}`, () => { assert.throws(() => normalizeProxy(address)); });
test('034 normalize bare host/IPv6 and preserve credentials privately', () => {
  assert.equal(normalizeProxy('127.0.0.1:7890'), 'http://127.0.0.1:7890/');
  assert.equal(normalizeProxy('[::1]:7890'), 'http://[::1]:7890/');
  assert.equal(normalizeProxy(manual), manual + '/');
});

for (const mode of ['auto', 'proxy', 'direct'] as const) for (const kind of ['connection', 'command'] as const)
  for (const result of ['ok', 'network', 'http'] as const) test(`034 ${mode}/${kind}/${result}: one attempt, correct route, no values in logs/status/storage`, async t => {
    const paths = fixture(t); let calls = 0;
    const transport: typeof fetch = async (_url, init) => {
      calls++;
      const dispatcher = (init as RequestInit & { dispatcher: Dispatcher }).dispatcher;
      assert.ok(mode === 'direct' ? dispatcher instanceof Agent : dispatcher instanceof ProxyAgent);
      if (result === 'network') throw new TypeError(`PRIVATE_ERROR ${manual} ${key}`, { cause: { code: 'ECONNREFUSED', address: '127.0.0.1', port: 18933 } });
      if (result === 'http') return Response.json({ error: { message: manual + key } }, { status: 503 });
      return good(kind === 'connection' ? 'OK' : JSON.stringify({ intent: 'question', dialogue: '보고', proposedActions: [], unresolvedQuestions: [], referencedKnowledgeIds: [] }));
    };
    const runtime = new RuntimeSettings({ ...paths, env: {}, readSystemProxy: system, transport });
    runtime.configure('offline-model', key, 30, mode);
    assert.equal(calls, 0);
    if (kind === 'connection') assert.equal(await runtime.test(), result === 'http' ? 'google_server' : result);
    else {
      runtime.select('ai'); const provider = runtime.provider()!;
      if (result === 'ok') await provider.interpret(input, new AbortController().signal);
      else await assert.rejects(provider.interpret(input, new AbortController().signal));
      assert.equal(provider.lastUsage?.externalCalls, 1); assert.equal(provider.lastUsage?.reservations, 1);
    }
    assert.equal(calls, 1); assert.equal(runtime.status().sessionCalls, 1);
    const status = runtime.status(), diagnostic = status.lastDiagnostic!;
    assert.equal(diagnostic.networkMode, mode); assert.equal(diagnostic.route, mode === 'direct' ? 'direct' : 'system-proxy');
    assert.equal(paths.output.length, 1); assert.equal(readFileSync(paths.budgetFile, 'utf8').includes('"calls":1'), true);
    if (result === 'network') {
      assert.equal(diagnostic.networkError?.proxyRefused, mode === 'direct' ? undefined : true);
      assert.match(networkAdvice(diagnostic.route, diagnostic.networkError), mode === 'direct' ? /연결 실패/ : /프록시 포트 연결 거부/);
    } else assert.equal(diagnostic.networkError, null);
    const published = JSON.stringify(status) + paths.output.join('') + readFileSync(paths.budgetFile, 'utf8') + readFileSync(paths.diagnosticsFile, 'utf8');
    for (const secret of [key, manual, '18933', '127.0.0.1', 'PRIVATE_ERROR']) assert.ok(!published.includes(secret));
  });

test('034 dynamic system proxy is read at each call; no fallback/retry on failure; manual survives direct and clears explicitly', async t => {
  const paths = fixture(t); let enabled = true, calls = 0;
  const runtime = new RuntimeSettings({ ...paths, env: {}, readSystemProxy: () => ({ ...system(), enabled }), transport: async () => { calls++; throw new Error('offline'); } });
  runtime.configure('offline-model', key, 30);
  await runtime.test(); assert.equal(runtime.status().lastDiagnostic?.route, 'system-proxy');
  enabled = false; await runtime.test(); assert.equal(runtime.status().lastDiagnostic?.route, 'direct'); assert.equal(calls, 2);
  runtime.configure('offline-model', '', 30, 'proxy', manual); assert.equal(runtime.status().route, 'manual-proxy');
  runtime.configure('offline-model', '', 30, 'direct'); assert.equal(runtime.status().route, 'direct');
  runtime.configure('offline-model', '', 30, 'auto'); assert.equal(runtime.status().route, 'manual-proxy');
  runtime.configure('offline-model', '', 30, 'auto', '', true); assert.equal(runtime.status().route, 'direct');
  assert.equal(runtime.status().manualProxyConfigured, false);
});

test('034 missing explicit proxy and invalid detected proxy fail safely without a transport call', async t => {
  const paths = fixture(t); let calls = 0;
  for (const [env, mode, code] of [[{}, 'proxy', 'PROXY_NOT_CONFIGURED'], [{ HTTPS_PROXY: 'socks://private.invalid' }, 'auto', 'PROXY_CONFIG_INVALID']] as const) {
    const runtime = new RuntimeSettings({ ...paths, env, readSystemProxy: noSystem, transport: async () => { calls++; return good(); } });
    runtime.configure('offline-model', key, 30, mode);
    assert.equal(await runtime.test(), 'network'); assert.equal(runtime.status().networkError?.code, code);
  }
  assert.equal(calls, 0);
});

test('034 refusal must match the selected proxy endpoint, not just an ECONNREFUSED code', () => {
  const selection = new NetworkSelection('auto', 'system-proxy', systemAddress);
  assert.equal(selection.proxyRefused({ code: 'ECONNREFUSED' }), false);
  assert.equal(selection.proxyRefused({ code: 'ECONNREFUSED', address: '127.0.0.1', port: 443 }), false);
  assert.equal(selection.proxyRefused({ code: 'ECONNREFUSED', address: 'other.invalid', port: 18933 }), false);
  assert.equal(selection.proxyRefused({ cause: { code: 'ECONNREFUSED', address: '127.0.0.1', port: 18933 } }), true);
});

test('034 local fake proxy CONNECT is one physical attempt; never reaches Google', async t => {
  const paths = fixture(t); let connects = 0;
  const proxy = createServer();
  proxy.on('connect', (req, socket) => { connects++; assert.equal(req.url, 'generativelanguage.googleapis.com:443'); socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n'); });
  const port = await listenForFetch(proxy);
  t.after(() => { proxy.closeAllConnections(); proxy.close(); });
  const runtime = new RuntimeSettings({ ...paths, env: {}, readSystemProxy: noSystem, timeoutMs: 2000 });
  runtime.configure('offline-model', key, 30, 'proxy', `127.0.0.1:${port}`);
  assert.equal(await runtime.test(), 'network'); assert.equal(connects, 1);
  assert.equal(runtime.status().lastDiagnostic?.route, 'manual-proxy');
});

test('034 real refused loopback proxy records endpoint-specific refusal without leaking its port', async t => {
  const paths = fixture(t), probe = createServer(), port = await listenForFetch(probe);
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const runtime = new RuntimeSettings({ ...paths, env: {}, timeoutMs: 2000 });
  runtime.configure('offline-model', key, 30, 'proxy', `127.0.0.1:${port}`);
  assert.equal(await runtime.test(), 'network'); assert.equal(runtime.status().networkError?.proxyRefused, true);
  assert.ok(!JSON.stringify(runtime.status()).includes(String(port)));
  assert.equal(runtime.status().sessionCalls, 1);
});

test('034 actual dispatchers: local proxy success, direct bypasses global proxy, unrelated requests stay untouched', async t => {
  let connects = 0, requests = 0, directCalls = 0;
  const sockets = new Set<import('node:net').Socket>();
  const proxy = createServer();
  proxy.on('connect', (req, socket) => {
    connects++; sockets.add(socket as import('node:net').Socket); socket.on('close', () => sockets.delete(socket as import('node:net').Socket));
    assert.equal(req.url, 'generativelanguage.googleapis.com:80'); socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    socket.once('data', () => { requests++; socket.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK'); });
  });
  const direct = createServer((_req, res) => { directCalls++; res.end('local'); });
  const proxyPort = await listenForFetch(proxy), directPort = await listenForFetch(direct);
  const previous = getGlobalDispatcher(), globalProxy = new ProxyAgent(`http://127.0.0.1:${proxyPort}`);
  t.after(async () => { setGlobalDispatcher(previous); await globalProxy.close(); for (const socket of sockets) socket.destroy(); proxy.closeAllConnections(); proxy.close(); direct.closeAllConnections(); direct.close(); });
  const selection = new NetworkSelection('proxy', 'manual-proxy', `127.0.0.1:${proxyPort}`);
  assert.equal(await (await selection.fetch(fetch, 'http://generativelanguage.googleapis.com/', { signal: AbortSignal.timeout(2000) })).text(), 'OK');
  assert.equal(connects, 1); assert.equal(requests, 1);
  setGlobalDispatcher(globalProxy);
  const bypass = new NetworkSelection('direct', 'direct');
  const rewrite: typeof fetch = (_url, init) => fetch(`http://127.0.0.1:${directPort}`, init);
  assert.equal(await (await bypass.fetch(rewrite, 'http://generativelanguage.googleapis.com/', { signal: AbortSignal.timeout(2000) })).text(), 'local');
  assert.equal(directCalls, 1); assert.equal(connects, 1);
  await selection.fetch(async (_url, init) => { assert.equal(Object.hasOwn(init ?? {}, 'dispatcher'), false); return good(); }, `http://127.0.0.1:${directPort}`, {});
});

test('034 HTTP settings, validation, error advice, reload and clearing keep addresses private', async t => {
  const paths = fixture(t); let calls = 0;
  const api = createGameServer(new GameEngine(), 5173, { ...paths, env: {}, readSystemProxy: noSystem,
    transport: async () => { calls++; throw Object.assign(new Error(manual), { code: 'ECONNREFUSED', address: '127.0.0.1', port: 18931 }); } });
  const port = await listenForFetch(api); t.after(() => { api.closeAllConnections(); api.close(); });
  const base = `http://127.0.0.1:${port}`;
  const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const config = { model: 'offline-model', key, limit: 30, networkMode: 'proxy' as NetworkMode, proxyAddress: manual, clearProxy: false };
  assert.equal((await post('/api/llm/settings', config)).status, 200);
  for (const value of [{ ...config, networkMode: 'bad' }, { ...config, proxyAddress: 'file:///bad' }, { ...config, clearProxy: 'yes' }, { ...config, extra: 1 }])
    assert.equal((await post('/api/llm/settings', value)).status, 400);
  assert.equal((await (await post('/api/llm/test', {})).json()).status.networkError.proxyRefused, true); assert.equal(calls, 1);
  await post('/api/llm/start', { mode: 'ai' });
  const result = await (await post('/api/command', { type: 'submit', text: '보고' })).json();
  assert.match(result.outcome.reply, /프록시 포트 연결 거부/); assert.equal(calls, 2);
  const exported = await (await fetch(base + '/api/llm/status')).text() + await (await fetch(base + '/api/test/logs')).text() + JSON.stringify(result);
  for (const value of [key, 'private-user', 'private-pass', '127.0.0.1', '18931']) assert.ok(!exported.includes(value));
  await post('/api/llm/clear', {});
  assert.equal((await (await fetch(base + '/api/llm/status')).json()).manualProxyConfigured, false);
});
