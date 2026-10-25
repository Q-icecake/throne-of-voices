import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { Agent, ProxyAgent } from 'undici';
import { liveSource } from '../scripts/eval/provider-bridge.ts';
import { evaluate, inputFor, main, parseOptions, renderSummary, selectCases } from '../scripts/eval/run.ts';
import { loadCases } from '../scripts/eval/fixtures.ts';
import { scriptedSource } from '../scripts/eval/sources.ts';
import { listenForFetch } from '../scripts/test-server.ts';

const key = 'synthetic035-Q8h3Z6s9D4t7R2x5';
const manual = 'http://eval-user:eval-password@manual-private.invalid:18121';
const envProxy = 'http://environment-private.invalid:18122';
const systemProxy = 'system-private.invalid:18123';
const noSystem = () => ({ enabled: false, server: '', pac: false });
const cases = await loadCases('dev');
const replay = JSON.parse(readFileSync(new URL('./fixtures/eval-scripted-good.json', import.meta.url), 'utf8'));
const settings = (): NodeJS.ProcessEnv => ({ LLM_PROVIDER: 'gemini', GEMINI_API_KEY: key,
  GEMINI_MODEL_ID: 'eval-model', LLM_RETRIES: '100', LLM_DAILY_CALL_LIMIT: '30', LLM_SESSION_CALL_LIMIT: '30' });
const success = (id = cases[0]!.id) => Response.json({ candidates: [{ finishReason: 'STOP', content: {
  parts: [{ text: JSON.stringify(replay.responses[id]) }] } }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3 } });
function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'throne-eval-035-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const logs: string[] = []; t.mock.method(console, 'info', (value: string) => logs.push(value));
  return { dir, budgetFile: join(dir, 'usage.json'), logs };
}

for (const mode of ['auto', 'proxy', 'direct'] as const) for (const origin of ['none', 'system', 'env', 'manual'] as const)
  test(`035 eval routing ${mode}/${origin}: priority, one attempt, safe output`, async t => {
    const f = setup(t); let calls = 0, reads = 0;
    const env = settings();
    if (origin === 'env' || origin === 'manual') env.HTTPS_PROXY = envProxy;
    const source = liveSource(2, env, {}, { budgetFile: f.budgetFile, networkMode: mode,
      proxy: origin === 'manual' ? manual : undefined,
      readSystemProxy: () => { reads++; return origin === 'none' ? noSystem() : { enabled: true, server: systemProxy, pac: false }; },
      transport: async (_url, init) => {
        calls++;
        const dispatcher = (init as RequestInit & { dispatcher: unknown }).dispatcher;
        assert.ok(dispatcher instanceof (mode === 'direct' || origin === 'none' ? Agent : ProxyAgent));
        assert.ok(!String(init?.body).includes(key));
        assert.ok(!String(init?.body).includes('private.invalid'));
        return success();
      } });
    assert.ok(source); assert.equal(calls, 0); assert.equal(reads, 0);
    const result = await source.sample(cases[0]!, inputFor(cases[0]!));
    assert.equal(calls, mode === 'proxy' && origin === 'none' ? 0 : 1);
    assert.equal(result.attempts.length, calls); assert.equal(result.reservations, 1);
    assert.equal(result.network?.route, mode === 'direct' || origin === 'none' ? 'direct' : `${origin}-proxy`);
    assert.equal(reads, mode === 'direct' || origin === 'manual' || origin === 'env' ? 0 : 1);
    const exports = JSON.stringify([result, source, f.logs]) + readFileSync(join(f.dir, 'llm-diagnostics.jsonl'), 'utf8');
    for (const secret of [key, manual, envProxy, systemProxy, 'eval-user', 'eval-password', 'private.invalid']) assert.ok(!exports.includes(secret));
  });

test('035 auto reselects system route per case and reports unsupported PAC without probing', async t => {
  const f = setup(t); let reads = 0, calls = 0;
  const source = liveSource(3, settings(), {}, { budgetFile: f.budgetFile,
    readSystemProxy: () => ({ enabled: ++reads === 1, server: `http=unused-private.invalid:1; https=${systemProxy}; `, pac: true }),
    transport: async () => { calls++; return success(); } })!;
  const first = await source.sample(cases[0]!, inputFor(cases[0]!));
  assert.equal(first.network?.route, 'system-proxy'); assert.equal(first.error, undefined);
  const second = await source.sample(cases[0]!, inputFor(cases[0]!));
  assert.equal(second.network?.route, 'direct'); assert.equal(second.network?.pacUnsupported, true);
  assert.equal(calls, 2); assert.equal(reads, 2);
});

for (const failure of ['http500', 'http429', 'network', 'malformed', 'invalid-proxy'] as const)
  test(`035 ${failure}: no retries or fallback and strict reservation cap`, async t => {
    const f = setup(t); let calls = 0;
    const source = liveSource(1, { ...settings(), HTTPS_PROXY: failure === 'invalid-proxy' ? 'socks5://private.invalid:1' : envProxy }, {}, {
      budgetFile: f.budgetFile, transport: async () => {
        calls++;
        if (failure === 'network') throw new Error(`${key} ${envProxy}`);
        return new Response('{}', { status: failure === 'http500' ? 500 : failure === 'http429' ? 429 : 200 });
      } })!;
    const result = await source.sample(cases[0]!, inputFor(cases[0]!));
    assert.ok(result.error); assert.equal(result.reservations, 1);
    assert.equal(calls, failure === 'invalid-proxy' ? 0 : 1);
    const next = await source.sample(cases[0]!, inputFor(cases[0]!));
    assert.equal(next.error, 'CALL_LIMIT'); assert.equal(next.reservations, 0); assert.equal(next.network, undefined);
    assert.equal(JSON.parse(readFileSync(f.budgetFile, 'utf8')).calls, 1);
    assert.ok(!JSON.stringify([result, next, f.logs]).includes(key));
  });

test('035 CLI options default to dev/auto; limit is positive integer and dev-only', () => {
  const options = parseOptions(['--live', '--max-calls', '20', '--limit', '20']);
  assert.equal(options.split, 'dev'); assert.equal(options.networkMode, 'auto'); assert.equal(options.limit, 20);
  assert.equal(parseOptions(['--mock', '--split', 'final']).split, 'final');
  for (const args of [['--limit', '0'], ['--limit', '-1'], ['--limit', '1.5'], ['--limit'], ['--network', 'vpn'],
    ['--proxy'], ['--split', 'final', '--limit', '1'], ['--max-calls', 'Infinity']])
    assert.throws(() => parseOptions(['--live', ...args]));
  for (const n of [1, 20, 80, 100]) assert.deepEqual(selectCases(cases, n).map(c => c.id), cases.slice(0, n).map(c => c.id));
});

test('035 full CLI prints plan before transport, limits 20 deterministic cases, exports scores and masked route', async t => {
  const f = setup(t); const output: string[] = []; let calls = 0;
  const status = await main(['--live', '--split', 'dev', '--limit', '20', '--max-calls', '20', '--network', 'proxy', '--proxy', manual], {
    env: { ...settings(), GEMINI_MAX_OUTPUT_TOKENS: '4096', GEMINI_THINKING_MODE: 'default' },
    log: value => output.push(value), outputRoot: join(f.dir, 'reports'), live: { budgetFile: f.budgetFile,
      transport: async (_url, init) => {
        assert.equal(output.length, 1); assert.match(output[0]!, /예정 호출 수 20/); assert.match(output[0]!, /4096/);
        const body = JSON.parse(String(init?.body)); assert.equal(body.generationConfig.maxOutputTokens, 4096);
        return success(cases[calls++]!.id);
      } },
  });
  assert.equal(status, 0); assert.equal(calls, 20);
  const reportDir = join(f.dir, 'reports', readdirSync(join(f.dir, 'reports'))[0]!);
  const report = JSON.parse(readFileSync(join(reportDir, 'results.json'), 'utf8'));
  assert.deepEqual(report.rows.map((row: { id: string }) => row.id), cases.slice(0, 20).map(c => c.id));
  assert.equal(report.availableCases, 80); assert.equal(report.totalCases, 20); assert.equal(report.skipped.length, 0);
  assert.equal(report.totals.retries, 0); assert.equal(report.totals.inputTokensKnown, 240);
  assert.equal(report.totals.outputTokensKnown, 60); assert.deepEqual(report.totals.routes, { 'manual-proxy': 20 });
  assert.equal(report.totals.rawAccuracy.intent, 20); assert.equal(report.totals.validatedAccuracy.conditions, 20);
  const summary = readFileSync(join(reportDir, 'summary.md'), 'utf8');
  for (const text of ['intent 20/20', 'actions 20/20', 'conditions 20/20', 'safety violations', 'p50/p95', 'total: 300',
    'Case error codes:', 'Attempt error codes:', 'manual-proxy: 20', `| ${cases[0]!.id} | command | PASS | PASS |`]) assert.ok(summary.includes(text), text);
  assert.equal(JSON.parse(readFileSync(join(reportDir, 'human-review.json'), 'utf8')).length, 20);
  const exported = output.join('\n') + f.logs.join('\n') + readdirSync(reportDir).map(name => readFileSync(join(reportDir, name), 'utf8')).join('\n');
  for (const secret of [key, manual, 'manual-private.invalid', 'eval-user', 'eval-password']) assert.ok(!exported.includes(secret));
});

test('035 max-calls smaller than limit records skipped IDs, HTTP error distribution and exit 2', async t => {
  const f = setup(t); let calls = 0;
  const status = await main(['--live', '--limit', '3', '--max-calls', '1'], { env: settings(), outputRoot: join(f.dir, 'out'),
    log: () => {}, live: { budgetFile: f.budgetFile, transport: async () => { calls++; return new Response('{}', { status: 500 }); } } });
  assert.equal(status, 2); assert.equal(calls, 1);
  const dir = join(f.dir, 'out', readdirSync(join(f.dir, 'out'))[0]!);
  const result = JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8'));
  assert.deepEqual(result.skipped, cases.slice(1, 3).map(c => c.id));
  assert.deepEqual(result.totals.errorCodes, { PROVIDER_ERROR: 1 });
  assert.deepEqual(result.totals.attemptErrorCodes, { HTTP_500: 1 });
  assert.equal(result.totals.rawAccuracy.actions, 0); assert.equal(result.totals.rawAccuracy.conditions, 0);
  assert.match(readFileSync(join(dir, 'summary.md'), 'utf8'), /SKIPPED/);
});

for (const reflected of [key, manual, systemProxy]) test('035 reflected secret/address never reaches sample or human files', async t => {
  const f = setup(t);
  const raw = { ...replay.responses[cases[0]!.id], dialogue: reflected };
  const source = liveSource(1, settings(), {}, { budgetFile: f.budgetFile, proxy: reflected === manual ? manual : undefined,
    readSystemProxy: () => ({ enabled: true, server: systemProxy, pac: false }),
    transport: async () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(raw) }] } }] }) })!;
  const result = await evaluate(cases.slice(0, 1), source, { maxCalls: 1 });
  assert.equal(result.rows[0]!.sample.raw, undefined); assert.equal(result.rows[0]!.rawScore.pass, false);
  assert.ok(!JSON.stringify(result).includes(reflected));
  assert.throws(() => source.secretGuard!.assertSafe({ dialogue: reflected }));
});

test('035 independent command accuracy distinguishes condition loss from correct action identity', async () => {
  const fixture = cases.find(c => c.actions.some(a => a.restrictions.length))!;
  const responses = structuredClone(replay);
  responses.responses[fixture.id].proposedActions.find((a: { restrictions: string[] }) => a.restrictions.length).restrictions = [];
  const result = await evaluate([fixture], scriptedSource(responses, 'dev'), { maxCalls: Infinity });
  assert.deepEqual(result.totals.rawAccuracy, { denominator: 1, intent: 1, actions: 1, conditions: 0 });
  assert.ok(result.totals.rawSafetyCases > 0);
  assert.match(renderSummary('scripted', 'dev', 'test', 'v', [fixture], result), /FAIL/);
});

test('035 real eval entry shares game daily budget across processes; fake runtime remains isolated', t => {
  const f = setup(t);
  const code = `
    import assert from 'node:assert/strict';
    import { readFileSync, existsSync } from 'node:fs';
    import { CallBudget } from './server/llm/budget.ts';
    import { liveSource } from './scripts/eval/provider-bridge.ts';
    import { loadCases } from './scripts/eval/fixtures.ts';
    import { inputFor } from './scripts/eval/run.ts';
    const config={model:'eval-model',timeoutMs:15000,retries:0,dailyLimit:3,sessionLimit:3};
    const game=new CallBudget(config); game.reserve();
    let calls=0;
    globalThis.fetch=async()=>{calls++; return new Response('{}',{status:500});};
    const fixture=(await loadCases('dev'))[0];
    const source=liveSource(5,process.env,{}, {readSystemProxy:()=>({enabled:false,server:'',pac:false})});
    assert.equal(source.counterPolicy,'shared-play-daily');
    for(let n=0;n<2;n++) { const result=await source.sample(fixture,inputFor(fixture)); assert.equal(result.reservations,1); }
    assert.equal(game.snapshot().dailyCalls,3); assert.equal(game.snapshot().sessionCalls,1);
    const blocked=await source.sample(fixture,inputFor(fixture));
    assert.equal(blocked.error,'CALL_LIMIT'); assert.equal(blocked.reservations,0); assert.equal(calls,2);
    const restart=liveSource(1,process.env,{}, {readSystemProxy:()=>({enabled:false,server:'',pac:false})});
    assert.equal((await restart.sample(fixture,inputFor(fixture))).reservations,0);
    const isolated=liveSource(1,process.env,{}, {transport:globalThis.fetch});
    assert.equal(isolated.counterPolicy,'isolated-test');
    assert.equal((await isolated.sample(fixture,inputFor(fixture))).reservations,1);
    assert.equal(game.snapshot().dailyCalls,3);
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8',
    env: { ...settings(), SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
      LLM_USAGE_FILE: f.budgetFile, LLM_DAILY_CALL_LIMIT: '3', LLM_SESSION_CALL_LIMIT: '3' } });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(readFileSync(f.budgetFile, 'utf8')).calls, 3);
  const restarted = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { liveSource } from './scripts/eval/provider-bridge.ts';
    import { loadCases } from './scripts/eval/fixtures.ts';
    import { inputFor } from './scripts/eval/run.ts';
    let calls=0; globalThis.fetch=async()=>{calls++; throw new Error('must not transmit');};
    const source=liveSource(1,process.env);
    const fixture=(await loadCases('dev'))[0];
    const blocked=await source.sample(fixture,inputFor(fixture));
    assert.equal(blocked.error,'CALL_LIMIT'); assert.equal(blocked.reservations,0); assert.equal(calls,0);
  `], { encoding: 'utf8', env: { ...settings(), SystemRoot: process.env.SystemRoot,
    LLM_USAGE_FILE: f.budgetFile, LLM_DAILY_CALL_LIMIT: '3' } });
  assert.equal(restarted.status, 0, restarted.stderr);
});

test('035 eval actually uses local fake CONNECT proxy once with no upstream connection', async t => {
  const f = setup(t); let connects = 0;
  const proxy = createServer();
  proxy.on('connect', (req, socket) => { connects++; assert.equal(req.url, 'generativelanguage.googleapis.com:443');
    socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n'); });
  const port = await listenForFetch(proxy);
  t.after(() => { proxy.closeAllConnections(); proxy.close(); });
  const source = liveSource(1, { ...settings(), LLM_TIMEOUT_MS: '2000' }, {}, { budgetFile: f.budgetFile,
    transport: fetch, readSystemProxy: () => ({ enabled: true, server: `127.0.0.1:${port}`, pac: false }) })!;
  const result = await source.sample(cases[0]!, inputFor(cases[0]!));
  assert.ok(result.error); assert.equal(connects, 1); assert.equal(result.attempts.length, 1);
  assert.equal(result.network?.route, 'system-proxy'); assert.equal(result.reservations, 1);
});
