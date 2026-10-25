import './offline-runtime.ts';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer as portProbe } from 'node:net';
import { chromium } from 'playwright-core';
import type { Page } from 'playwright-core';
import { createServer } from 'vite';
import { RequestPacer } from '../server/llm/pacer.ts';
import { createGameServer } from '../server/http.ts';
import { listenForFetch } from './test-server.ts';
import type { NetworkRoute } from '../shared/contracts.ts';

const output = 'artifacts/network-mode'; await mkdir(output, { recursive: true });
const temp = await mkdtemp(join(tmpdir(), 'throne-network-mode-ui-'));
const key = 'synthetic-browser-034-V8h3M6s2Q9x7';
const address = 'http://ui-private:ui-password@127.0.0.1:18937';
const secrets = [key, 'ui-private', 'ui-password', '18937', 'env-proxy-private.invalid', 'system-private.invalid'];
const probe = portProbe(), webPort = await listenForFetch(probe); await new Promise<void>(resolve => probe.close(() => resolve()));
let env: NodeJS.ProcessEnv = {}, system = { enabled: false, server: '', pac: false }, refusal = false, calls = 0;
let pacingNow = 0;
const api = createGameServer(undefined, webPort, { env, pacer: new RequestPacer(undefined, { now: () => pacingNow, sleep: async ms => { pacingNow += ms; } }), readSystemProxy: () => system, budgetFile: join(temp, 'usage.json'), transport: async () => {
  calls++; pacingNow += 60000;
  if (refusal) throw new TypeError(address, { cause: { code: 'ECONNREFUSED', address: '127.0.0.1', port: 18937 } });
  return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'OK' }] } }] });
} });
const apiPort = await listenForFetch(api), base = `http://127.0.0.1:${webPort}`;
const vite = await createServer({ logLevel: 'error', server: { port: webPort, strictPort: true, proxy: { '/api': `http://127.0.0.1:${apiPort}` } } }); await vite.listen();
const browser = await chromium.launch({ channel: 'msedge' }), evidence: unknown[] = [];
async function capture(page: Page, scene: string, size: string) {
  const result = await page.evaluate(() => {
    const section = document.querySelector<HTMLElement>('[data-start-page="settings"]')!, card = section.getBoundingClientRect();
    const elements = [...section.querySelectorAll<HTMLElement>('button, input, select, p, label, h1, h2')].filter(el => el.getClientRects().length);
    return { cardFits: card.top >= 0 && card.bottom <= innerHeight,
      pageScroll: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
      minFont: Math.min(...elements.map(el => parseFloat(getComputedStyle(el).fontSize))),
      contentFits: elements.every(el => { const r = el.getBoundingClientRect(); return r.top >= card.top && r.bottom <= card.bottom && r.left >= card.left && r.right <= card.right; }),
      controls: elements.filter(el => el.matches('button, input, select')).map(el => {
        const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { id: el.id, unblocked: el === hit || el.contains(hit), visible: r.top >= 0 && r.bottom <= innerHeight };
      }) };
  });
  await page.screenshot({ path: `${output}/${scene}-${size}.png` });
  assert.equal(result.cardFits, true, JSON.stringify(result)); assert.equal(result.pageScroll, false);
  assert.equal(result.contentFits, true, JSON.stringify(result)); assert.ok(result.minFont >= 16);
  assert.ok(result.controls.every(control => control.unblocked && control.visible), JSON.stringify(result));
  const published = await page.content() + await page.evaluate(() => JSON.stringify([localStorage, sessionStorage])) +
    await (await page.request.get(base + '/api/llm/status')).text() + await readFile(join(temp, 'llm-diagnostics.jsonl'), 'utf8').catch(() => '');
  for (const value of secrets) assert.ok(!published.includes(value), `secret boundary ${scene}`);
  evidence.push({ scene, size, ...result, secretsAbsent: true });
}
try {
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
    const size = `${viewport.width}x${viewport.height}`, page = await browser.newPage({ viewport });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => { errors.push('Unexpected dialog'); void dialog.dismiss(); });
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    await page.request.post(base + '/api/llm/clear', { data: {} });
    system = { enabled: false, server: '', pac: false }; delete env.HTTPS_PROXY; refusal = false;
    await page.goto(base); await page.locator('#start-mock:not([disabled])').waitFor(); await page.click('#open-settings');
    await page.fill('#ai-model', 'offline-model'); await page.fill('#ai-key', key);
    const save = async () => { await page.click('#save-settings'); await page.locator('#save-settings:not([disabled])').waitFor(); };
    const check = async (route: NetworkRoute) => {
      const before = calls; await page.click('#test-connection'); await page.locator('#test-connection:not([disabled])').waitFor();
      assert.equal(calls, before + 1); const status = await (await page.request.get(base + '/api/llm/status')).json();
      assert.equal(status.route, route); assert.equal(status.lastDiagnostic.route, route); return status;
    };
    await page.selectOption('#ai-network', 'auto'); await save(); await check('direct'); await capture(page, 'auto-direct', size);
    env.HTTPS_PROXY = 'http://env-proxy-private.invalid:18938'; await check('env-proxy'); await capture(page, 'auto-env', size); delete env.HTTPS_PROXY;
    system = { enabled: true, server: 'system-private.invalid:18939', pac: false };
    await check('system-proxy'); await capture(page, 'auto-system', size);
    await page.selectOption('#ai-network', 'proxy'); assert.equal(await page.locator('#ai-proxy').getAttribute('type'), 'password');
    await page.fill('#ai-proxy', address); await save(); assert.equal(await page.inputValue('#ai-proxy'), '');
    refusal = true; const failed = await check('manual-proxy'); assert.equal(failed.networkError.proxyRefused, true);
    assert.match(await page.locator('#untested-note').innerText(), /프록시 포트 연결 거부/);
    await capture(page, 'proxy-refused', size);
    refusal = false; await page.selectOption('#ai-network', 'direct'); await save(); await check('direct'); await capture(page, 'direct', size);
    await page.selectOption('#ai-network', 'auto'); await save(); await check('manual-proxy'); await capture(page, 'auto-manual', size);
    await page.reload(); await page.locator('#start-mock:not([disabled])').waitFor(); await page.click('#open-settings');
    assert.equal(await page.inputValue('#ai-proxy'), ''); assert.equal(await page.inputValue('#ai-key'), '');
    assert.equal(await page.inputValue('#ai-network'), 'auto');
    await page.selectOption('#ai-network', 'proxy'); await page.check('#clear-proxy'); await save();
    await check('system-proxy'); assert.equal((await (await page.request.get(base + '/api/llm/status')).json()).manualProxyConfigured, false);
    system = { enabled: false, server: '', pac: true }; await page.selectOption('#ai-network', 'auto'); await save(); await check('direct');
    assert.match(await page.locator('#last-diagnostic').innerText(), /PAC 자동 구성 미지원/); await capture(page, 'pac-unsupported', size);
    await page.selectOption('#ai-network', 'proxy'); await page.fill('#ai-proxy', address); await page.keyboard.press('Escape');
    await page.click('#open-settings'); assert.equal(await page.inputValue('#ai-proxy'), '');
    await page.click('#settings-mock'); await page.locator('#connection:has-text("서버 연결됨")').waitFor();
    assert.equal((await (await page.request.get(base + '/api/state')).json()).mode, 'mock');
    assert.deepEqual(errors, []); await page.close();
  }
  for (const file of await readdir('dist/assets')) {
    const text = await readFile(join('dist/assets', file), 'utf8'); for (const value of secrets) assert.ok(!text.includes(value));
  }
  await writeFile(`${output}/screenshots.json`, JSON.stringify({ externalCalls: 0, fakeTransportCalls: calls, evidence }, null, 2) + '\n');
  console.log(`PASS network-mode: both resolutions, all four routes, modes, refusal, PAC, masking/storage, manual retry, Mock; ${calls} fake calls`);
} finally { await browser.close(); await vite.close(); api.closeAllConnections(); await new Promise<void>(resolve => api.close(() => resolve())); await rm(temp, { recursive: true, force: true }); }
