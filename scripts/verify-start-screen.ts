import './offline-runtime.ts';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { createServer as portProbe } from 'node:net';
import { chromium } from 'playwright-core';
import type { Page } from 'playwright-core';
import { createServer } from 'vite';
import { createGameServer } from '../server/http.ts';
import { SecretGuard } from '../server/llm/secrets.ts';
import { listenForFetch } from './test-server.ts';

const output = 'artifacts/start-screen'; await mkdir(output, { recursive: true });
const usageOutput = 'artifacts/usage-counter'; await mkdir(usageOutput, { recursive: true });
const diagnosticOutput = 'artifacts/diagnostic-log'; await mkdir(diagnosticOutput, { recursive: true });
const temp = await mkdtemp(join(tmpdir(), 'throne-start-visual-'));
const fakeKey = 'browser-synthetic-Q7v2B9m4L6r8S3x5', guard = new SecretGuard(fakeKey);
const probe = portProbe(); await listenForFetch(probe);
const webPort = (probe.address() as AddressInfo).port; await new Promise<void>(resolve => probe.close(() => resolve()));
const networkCases = [
  ['ENOTFOUND', 'Google 서버에 연결하지 못함(네트워크·DNS·방화벽·프록시 확인)'],
  ['ECONNREFUSED', 'Google 서버에 연결하지 못함(네트워크·DNS·방화벽·프록시 확인)'],
  ['ECONNRESET', 'Google 서버에 연결하지 못함(네트워크·DNS·방화벽·프록시 확인)'],
  ['UND_ERR_SOCKET', 'Google 서버에 연결하지 못함(네트워크·DNS·방화벽·프록시 확인)'],
  ['ETIMEDOUT', '연결 시간 초과'], ['UND_ERR_CONNECT_TIMEOUT', '연결 시간 초과'],
  ['CERT_HAS_EXPIRED', 'TLS/인증서 문제'], ['ERR_TLS_CERT_ALTNAME_INVALID', 'TLS/인증서 문제'],
  ['AbortError', '연결 시간 초과'], ['TimeoutError', '연결 시간 초과'],
] as const;
let calls = 0, reply: number | 'timeout' | 'schema' | 'truncated' | 'thinking' | typeof networkCases[number][0] = 200;
let proxyEnv: NodeJS.ProcessEnv = {};
const privateMarker = 'PRIVATE_PLAYER_PROMPT_032';
const usageMetadata = { promptTokenCount: 12, candidatesTokenCount: 4, thoughtsTokenCount: 32 };
function freshApi() { return createGameServer(undefined, webPort, { env: proxyEnv, budgetFile: join(temp, 'usage.json'), timeoutMs: 80, transport: async (_url, init) => {
  calls++; assert.equal(new Headers(init?.headers).get('x-goog-api-key'), fakeKey);
  if (reply === 'timeout') return await new Promise<Response>(() => {});
  if (reply === 'schema') return new Response('invalid');
  if (reply === 'truncated') return Response.json({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }], usageMetadata });
  if (reply === 'thinking') return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'OK' }] } }] });
  if (reply === 'AbortError' || reply === 'TimeoutError') throw new DOMException('PRIVATE_NETWORK ' + fakeKey, reply);
  if (typeof reply === 'string') throw new TypeError('https://private.invalid/?key=' + fakeKey + ' Authorization: PRIVATE_NETWORK', { cause: { code: reply } });
  return reply === 200 ? Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'OK' }] } }], usageMetadata })
    : Response.json({ error: { message: reply === 400 ? `Invalid JSON payload received. Unknown name "${privateMarker}". Cannot find field.` : fakeKey } }, { status: reply });
} }); }
let api = freshApi();
await listenForFetch(api);
let apiPort = (api.address() as AddressInfo).port;
const base = `http://127.0.0.1:${webPort}`;
const startVite = () => createServer({ logLevel: 'error', server: { port: webPort, strictPort: true, proxy: { '/api': `http://127.0.0.1:${apiPort}` } } });
let vite = await startVite(); await vite.listen();
const browser = await chromium.launch({ channel: 'msedge' });
const evidence: unknown[] = [];
async function measure(page: Page, scene: string, size: string) {
  const result = await page.evaluate(() => {
    const section = document.querySelector<HTMLElement>('[data-start-page]:not([hidden])')!;
    const elements = [...section.querySelectorAll<HTMLElement>('button, input, p, li, label, h1, h2')];
    const rect = section.getBoundingClientRect();
    return { pageScroll: document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth,
      cardFits: rect.top >= 0 && rect.bottom <= innerHeight,
      minFont: Math.min(...elements.map(el => parseFloat(getComputedStyle(el).fontSize))),
      controls: [...section.querySelectorAll<HTMLElement>('button, input')].map(el => {
        const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { id: el.id || el.textContent, fits: r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, unblocked: el === hit || el.contains(hit) };
      }),
      contentFits: elements.every(el => { const r = el.getBoundingClientRect(); return r.top >= rect.top && r.bottom <= rect.bottom && r.left >= rect.left && r.right <= rect.right; }),
    };
  });
  await page.screenshot({ path: `${output}/${scene}-${size}.png` });
  console.log(scene, size, JSON.stringify(result));
  assert.equal(result.pageScroll, false); assert.equal(result.cardFits, true); assert.equal(result.contentFits, true); assert.ok(result.minFont >= 16);
  assert.ok(result.controls.every(c => c.fits && c.unblocked), JSON.stringify(result.controls));
  evidence.push({ scene, size, ...result });
  await page.screenshot({ path: `${output}/${scene}-${size}.png` });
}
const geometry = (page: Page) => page.evaluate(() => ['#scene', '#speech', '.hud-status', '.hud-tools', '#hotspot-zhang-hong', '#hotspot-documents', '#hotspot-map'].map(selector => {
  const rect = document.querySelector(selector)!.getBoundingClientRect(); return { selector, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}));
try {
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
    // Synthetic pollution only: never seed or reset the real play counter.
    await writeFile(join(temp, 'usage.json'), JSON.stringify({ day: new Date().toISOString().slice(0, 10), calls: 541 }));
    // A new server session per viewport: clear-key deliberately preserves the
    // user's model setting and is not a simulation of a first application run.
    if (evidence.length) {
      proxyEnv = { HTTPS_PROXY: 'http://PRIVATE_PROXY:PRIVATE_PASSWORD@proxy.invalid:1234' };
      await vite.close();
      api.closeAllConnections(); await new Promise<void>(resolve => api.close(() => resolve()));
      api = freshApi(); await listenForFetch(api); apiPort = (api.address() as AddressInfo).port;
      vite = await startVite(); await vite.listen();
    }
    const size = `${viewport.width}x${viewport.height}`, page = await browser.newPage({ viewport });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => assert.ok(new URL(request.url()).origin === base, 'no external browser request'));
    // Read/check API bodies before the browser receives them. Reading response events
    // after a navigation races Chromium discarding the old document's body.
    await page.route('**/api/**', async route => {
      try {
        const response = await route.fetch({ maxRedirects: 0 }); guard.assertSafe(await response.text());
        await route.fulfill({ response });
      } catch (error) {
        if (!page.isClosed()) errors.push(error instanceof Error ? error.message : 'API interception failed');
        await route.abort().catch(() => {});
      }
    });
    await page.request.post(base + '/api/llm/clear', { data: {} });
    await page.goto(base); await page.locator('#start-mock:not([disabled])').waitFor();
    assert.equal(await page.locator('#stage').isVisible(), false);
    assert.equal((await (await page.request.get(base + '/api/state')).json()).opening.ready, false);
    await measure(page, 'home', size);
    await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement?.id), 'start-mock');
    await page.keyboard.press('Tab'); await page.keyboard.press('Enter'); await page.locator('#ai-model').waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'settings-title');
    assert.equal(await page.locator('#ai-model').inputValue(), '');
    assert.equal((await (await page.request.get(base + '/api/llm/status')).json()).model, '');
    assert.equal(await page.locator('#start-ai').isDisabled(), true);
    evidence.push({ size, firstRunModel: '', firstRunKeyConfigured: false });
    await measure(page, 'settings', size);
    assert.match(await page.locator('#last-diagnostic').innerText(), proxyEnv.HTTPS_PROXY ? /프록시 환경변수 감지됨/ : /프록시 환경변수 없음/);
    assert.match(await page.locator('#local-usage').innerText(), /541\/30.*0\/30/);
    await page.screenshot({ path: `${usageOutput}/settings-${size}.png` });
    assert.equal(await page.locator('#ai-key').getAttribute('type'), 'password'); assert.equal(await page.locator('#ai-key').getAttribute('autocomplete'), 'off');
    await page.fill('#ai-model', 'offline-model'); await page.fill('#ai-key', fakeKey);
    await page.keyboard.press('Escape'); await page.click('#open-settings');
    assert.equal(await page.locator('#ai-key').inputValue(), ''); assert.equal(await page.locator('#start-ai').isDisabled(), true);
    await page.locator('#ai-model').fill('offline-model'); await page.locator('#ai-key').fill(fakeKey);
    await page.locator('#ai-limit').fill('0'); await page.click('#save-settings'); await page.locator('#save-settings:not([disabled])').waitFor();
    assert.equal(await page.locator('#ai-key').inputValue(), '');
    const before = calls; await page.click('#test-connection'); await page.locator('#test-result').filter({ hasText: '로컬 세션 상한' }).waitFor(); assert.equal(calls, before);
    await page.locator('#ai-limit').fill('30');
    await page.click('#test-connection'); await page.locator('#test-result').filter({ hasText: '로컬 일일 상한(UTC) 도달: 오늘 541/30' }).waitFor(); assert.equal(calls, before);
    await measure(page, 'daily-limit', size);
    assert.match(await page.locator('#reset-usage-note').innerText(), /Google 쪽 실제 사용량은 바뀌지 않습니다/);
    page.on('dialog', () => assert.fail('reset uses visible inline confirmation text, never a popup'));
    await page.click('#reset-usage'); await page.locator('#reset-usage:not([disabled])').waitFor();
    assert.equal(calls, before); assert.match(await page.locator('#local-usage').innerText(), /0\/30.*0\/30/);
    const resetLogs = await (await page.request.get(base + '/api/test/logs')).json();
    assert.equal(resetLogs.filter((event: { kind: string }) => event.kind === 'llm-usage-reset').length, 1);
    await page.screenshot({ path: `${usageOutput}/reset-${size}.png` });
    assert.match(await page.locator('.start-field-note').allTextContents().then(values => values.join(' ')), /사고·출력 합계 최대 256토큰/);
    for (const [response, label] of [[200, '정상'], [401, '키 오류'], [404, '모델 없음(404)'], [429, 'Google 한도 초과(429)'], ['timeout', '연결 시간 초과'], ['schema', '응답 파싱 실패'],
      [400, '요청 형식 거부(400)·모델 설정 불일치'], [500, 'Google 서버 오류(5xx)'], [503, 'Google 서버 오류(5xx)'],
      ['truncated', '응답이 잘림(출력 한도·사고 토큰)'], ['thinking', '응답 없음(사고만 반환 또는 빈 응답)'], ...networkCases] as const) {
      reply = response; const beforeCall = calls;
      await page.click('#test-connection'); await page.locator('#test-connection:not([disabled])').waitFor();
      assert.equal(await page.locator('#test-result').textContent(), label); assert.equal(calls, beforeCall + 1);
      guard.assertSafe(await page.content()); guard.assertSafe(await page.evaluate(() => JSON.stringify(localStorage)));
      const status = await (await page.request.get(base + '/api/llm/status')).json();
      const diagnostic = status.lastDiagnostic;
      const summary = await page.locator('#last-diagnostic').innerText();
      assert.equal(diagnostic.model, 'offline-model'); assert.equal(diagnostic.callKind, 'connection_test');
      assert.equal(diagnostic.retries, 0); assert.equal(diagnostic.resultCode, status.testResult);
      assert.match(summary, new RegExp(diagnostic.resultCode)); assert.ok(summary.includes(`${diagnostic.latencyMs}ms`));
      assert.ok(summary.includes('offline-model')); assert.ok(summary.includes(diagnostic.finishReason ?? '—'));
      const network = networkCases.some(([code]) => code === response);
      assert.equal(diagnostic.httpStatus, typeof response === 'number' ? response : response === 'timeout' || network ? null : 200);
      assert.equal(diagnostic.source, 'test');
      if (network) {
        assert.ok(summary.includes(diagnostic.networkError.code ?? diagnostic.networkError.name));
        await measure(page, `network-${response}`, size);
      }
      assert.match(await page.locator('#diagnostic-location').innerText(), /<프로젝트>\\artifacts\\llm-diagnostics\.jsonl의 마지막 줄/);
      const log = await readFile(join(temp, 'llm-diagnostics.jsonl'), 'utf8');
      assert.deepEqual(JSON.parse(log.trim().split('\n').at(-1)!), diagnostic);
      const published = log + JSON.stringify(status) + await page.content(); guard.assertSafe(published);
      assert.ok(!published.includes(privateMarker)); assert.ok(!published.includes('Reply with exactly OK.'));
      for (const secret of ['private.invalid', 'PRIVATE_NETWORK', 'Authorization:', 'PRIVATE_PROXY', 'PRIVATE_PASSWORD', 'proxy.invalid']) assert.ok(!published.includes(secret));
      if (response === 400) assert.ok(summary.includes('Invalid JSON payload received.'));
      if (response === 200 || response === 'truncated') assert.ok(summary.includes('12/4/32'));
      evidence.push({ size, injected: response, displayed: label, calls: 1 });
      if ([400, 404, 500, 'schema', 'truncated', 'thinking'].includes(response)) await measure(page, `error-${response}`, size);
      if ([200, 400, 404, 500, 'truncated'].includes(response)) await page.screenshot({ path: `${diagnosticOutput}/settings-${response}-${size}.png` });
    }
    const longModel = 'offline-model-' + 'x'.repeat(186);
    await page.fill('#ai-model', longModel); reply = 400;
    await page.click('#test-connection'); await page.locator('#test-connection:not([disabled])').waitFor();
    assert.equal(await page.locator('#last-diagnostic').getAttribute('title'), longModel);
    assert.equal((await (await page.request.get(base + '/api/llm/status')).json()).lastDiagnostic.model, longModel);
    await measure(page, 'long-diagnostic', size);
    await page.screenshot({ path: `${diagnosticOutput}/settings-long-${size}.png` });
    await page.click('#clear-key'); await page.locator('#clear-key:not([disabled])').waitFor(); assert.equal(await page.locator('#start-ai').isDisabled(), true);
    const beforeClearTest = calls; await page.click('#test-connection'); await page.locator('#test-connection:not([disabled])').waitFor(); assert.equal(calls, beforeClearTest);
    await page.keyboard.press('Escape'); await page.click('#open-guide'); await measure(page, 'guide', size);
    await page.keyboard.press('Escape'); await page.click('#start-mock'); await page.waitForSelector('#connection:has-text("서버 연결됨")');
    const mockGeometry = await geometry(page); await page.screenshot({ path: `${output}/mock-court-${size}.png` });
    await page.goto(base + '/?start=court'); await page.waitForSelector('#connection:has-text("서버 연결됨")'); assert.deepEqual(await geometry(page), mockGeometry);
    await page.goto(base); await page.locator('#start-mock:not([disabled])').waitFor(); await page.click('#open-settings');
    await page.fill('#ai-model', 'offline-model'); await page.fill('#ai-key', fakeKey); await page.click('#save-settings'); await page.locator('#save-settings:not([disabled])').waitFor();
    assert.match(await page.locator('#untested-note').textContent() ?? '', /시험하지 않았습니다/);
    const beforeAi = calls; await page.click('#start-ai'); await page.waitForSelector('#connection:has-text("서버 연결됨")');
    assert.equal(calls, beforeAi); assert.equal((await (await page.request.get(base + '/api/state')).json()).mode, 'ai');
    for (const path of ['/api/test/logs', '/api/test/snapshot', '/api/llm/status']) guard.assertSafe(await (await page.request.get(base + path)).text());
    assert.deepEqual(errors, []); await page.close();
    evidence.push({ size, keyboard: true, noAutomaticCalls: true, clearBlocks: true, courtGeometryUnchanged: true, secretChecks: true });
  }
  for (const file of await readdir('dist/assets')) guard.assertSafe(await readFile(join('dist/assets', file), 'utf8'));
  guard.assertSafe(await readFile(join(temp, 'usage.json'), 'utf8'));
  await writeFile(`${output}/verification.json`, JSON.stringify({ externalCalls: 0, fakeTransportCalls: calls, evidence }, null, 2) + '\n');
  await writeFile(`${usageOutput}/screenshots.json`, JSON.stringify({ externalCalls: 0, fakeTransportCalls: calls, evidence }, null, 2) + '\n');
  await writeFile(`${diagnosticOutput}/screenshots.json`, JSON.stringify({ externalCalls: 0, fakeTransportCalls: calls, evidence }, null, 2) + '\n');
  console.log(`PASS start-screen: both sizes, 3 screens, keyboard, secret boundaries, 21 response scenarios, proxy presence, zero limit, clear, AI/Mock start, unchanged court; ${output}`);
} finally {
  await browser.close(); await vite.close(); api.closeAllConnections(); await new Promise<void>(resolve => api.close(() => resolve())); await rm(temp, { recursive: true, force: true });
}
