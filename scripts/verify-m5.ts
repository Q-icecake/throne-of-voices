import { listenForFetch } from './test-server.ts';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer as createPortProbe } from 'node:net';
import type { AddressInfo } from 'node:net';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { createGameServer } from '../server/http.ts';
import type { PlayerView } from '../shared/contracts.ts';

const outIndex = process.argv.indexOf('--out');
const output = outIndex < 0 ? 'artifacts/m5/browser' : process.argv[outIndex + 1]!;
await mkdir(output, { recursive: true });
const probe = createPortProbe(); await listenForFetch(probe);
const webPort = (probe.address() as AddressInfo).port;
await new Promise<void>(resolve => probe.close(() => resolve()));
const base = `http://127.0.0.1:${webPort}`;
const server = createGameServer(undefined, webPort); await listenForFetch(server);
const apiPort = (server.address() as AddressInfo).port;
const vite = await createServer({ logLevel: 'error', server: { port: webPort, strictPort: true, proxy: { '/api': `http://127.0.0.1:${apiPort}` } } }); await vite.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const checks: unknown[] = [];
try {
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
    const size = `${viewport.width}x${viewport.height}`, page = await browser.newPage({ viewport });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const post = async (body: unknown) => { const response = await page.request.post(`${base}/api/test/action`, { data: body }); assert.ok(response.ok()); return response.json(); };
    const state = async (): Promise<PlayerView> => (await page.request.get(`${base}/api/state`)).json();
    const waitState = async (predicate: (s: PlayerView) => boolean, timeout = 10000) => { const start = performance.now(); while (!predicate(await state())) { if (performance.now() - start > timeout) throw new Error('Timed out waiting for server state'); await new Promise(resolve => setTimeout(resolve, 100)); } };
    const shot = async (name: string) => { await page.waitForTimeout(300); await page.screenshot({ path: `${output}/${name}-${size}.png`, animations: 'disabled' }); };
    const pass = (name: string, evidence?: unknown) => { checks.push({ size, name, passed: true, evidence }); console.log(`${size}: PASS ${name}`); };
    await page.request.post(`${base}/api/test/reset`, { data: {} }); await page.goto(`${base}/?start=court`);
    await page.waitForSelector('#connection:has-text("서버 연결됨")');
    assert.equal((await state()).opening!.clockMode, 'auto');
    assert.equal(await page.locator('#stage').getAttribute('data-panel'), 'none');
    assert.equal(await page.locator('[role="dialog"]').count(), 0); pass('fresh auto court without instruction modal');
    try {
    // Real wall-time progression, no fake advance before the first urgent report.
    await waitState(s => s.clock.activeMs >= 22000, 30000);
    await shot('before-dispatch');
    await page.fill('#speech-input', '아직 작성 중인 문장');
    await waitState(s => s.clock.pauseReasons.includes('typing'));
    const heldAt = (await state()).clock.activeMs;
    await page.waitForTimeout(3400);
    const held = await state(); assert.equal(held.clock.activeMs, heldAt); assert.ok(!held.knowledge.documents.some(d => d.id === 'D-jingzhou'));
    assert.equal(await page.inputValue('#speech-input'), '아직 작성 중인 문장');
    assert.ok(await page.locator('#speech-input').evaluate(el => el === document.activeElement)); pass('typing holds active time and preserves sentence/focus', { heldAt });
    await page.fill('#speech-input', '');
    await page.waitForSelector('#opening-notice:has-text("형주")', { timeout: 12000 });
    const urgent = (await state()).knowledge.documents.find(d => d.id === 'D-jingzhou')!;
    assert.ok(urgent.arrivedAtMs >= 20000 && urgent.arrivedAtMs <= 30000); assert.equal(urgent.observedAtMs, null);
    assert.equal(await page.locator('#stage').getAttribute('data-panel'), 'none');
    assert.ok(await page.locator('#speech-input').evaluate(el => el === document.activeElement));
    await shot('after-dispatch'); pass('automatic urgent report at 20–30 active seconds; no forced panel', urgent.arrivedAtMs);
    // Keep a second sentence across asynchronous reception and UI refresh.
    await page.fill('#speech-input', '보고를 보아도 이 문장은 보존');
    await waitState(s => s.clock.pauseReasons.includes('typing'));
    await post({ type: 'set-pause', reason: 'typing', paused: false });
    await post({ type: 'advance-clock', milliseconds: 40000 });
    await page.waitForSelector('#badge-audience:has-text("2")');
    assert.equal(await page.inputValue('#speech-input'), '보고를 보아도 이 문장은 보존');
    assert.ok(await page.locator('#speech-input').evaluate(el => el === document.activeElement));
    await page.click('#tool-audience'); await page.waitForSelector('[data-defer="zhang-zhao"]');
    await page.locator('[data-defer="zhang-zhao"]').focus();
    await post({ type: 'set-reading', reading: true }); await page.waitForTimeout(600);
    assert.ok(await page.locator('[data-defer="zhang-zhao"]').evaluate(el => el === document.activeElement));
    await shot('audience-requests'); pass('audience request badge; incoming events preserve text and focus');
    await page.click('[data-defer="zhang-zhao"]'); await page.waitForSelector('[data-defer="zhang-zhao"]:not([disabled])');
    assert.deepEqual((await state()).audience.requested, ['zhou-yu','zhang-zhao']);
    await page.click('[data-invite="zhou-yu"]'); await page.waitForSelector('#stage[data-panel="none"]');
    assert.deepEqual((await state()).audience.participants, ['zhou-yu']); pass('defer and directly receive Zhou Yu first');
    await page.fill('#speech-input', ''); await waitState(s => !s.clock.pauseReasons.includes('typing'));
    await page.click('#tool-dev'); await page.click('#clock-mode'); await page.waitForSelector('#clock-mode:not([disabled])');
    assert.equal((await state()).opening!.clockMode, 'manual');
    // Pressure requires several explicit bounded advances, never finishes unrelated tasks.
    for (let i = 0; i < 14; i++) { await page.click('#advance-30'); await page.waitForSelector('#advance-30:not([disabled])'); }
    await page.click('#dev-close'); await page.waitForSelector('#opening-notice:has-text("남은 사안")');
    await shot('pressure'); assert.equal((await state()).tasks.length, 0); pass('unresolved pressure accumulates without automatic loss');
    const order = '조조에게는 당장 확답하지 말고 시간을 벌어. 노숙은 유비에게 비밀리에 연락하고, 주유는 수군을 준비시키되 먼저 공격하지는 마.';
    // Invoke an available audience rather than commanding a busy participant.
    await page.click('#tool-audience'); await page.click('[data-invite="zhang-hong"]');
    await page.fill('#speech-input', order); await page.click('#speech-submit'); await page.waitForSelector('.draft-card');
    assert.equal((await state()).tasks.length, 0); assert.ok((await state()).clock.pauseReasons.includes('confirmation'));
    await shot('compound-draft');
    await page.locator('.draft-actions .btn-primary').click(); await page.waitForSelector('.task-card');
    assert.equal((await state()).tasks.length, 3);
    await page.click('#tool-dev'); await page.click('#clock-mode'); await page.waitForSelector('#clock-mode:not([disabled])');
    assert.equal((await state()).opening!.clockMode, 'auto'); await page.click('#dev-close');
    // Execution and the follow-up really run under the automatic server clock.
    await waitState(s => s.tasks.length === 3 && s.tasks.every(t => t.stage === 'completed'), 70000);
    const done = await state(); assert.equal(done.ledger.grain, 880); assert.equal(done.ledger.navalReadiness, 35);
    const report = done.knowledge.documents.filter(d => d.taskId).at(-1)!;
    await page.waitForSelector(`.task-reports button:has-text("${report.title}")`);
    await page.locator('.task-reports button').filter({ hasText: report.title }).first().click();
    await page.waitForSelector(`[data-document="${report.id}"]`);
    await waitState(s => s.opening!.observed);
    await shot('follow-up'); pass('compound order → automatic execution → actual report observed', { grain: done.ledger.grain, readiness: done.ledger.navalReadiness, reportId: report.id });
    await page.click('#tool-map'); await page.waitForSelector('#map-jingzhou');
    assert.equal(await page.locator('#map-jingzhou').getAttribute('role'), 'button');
    assert.ok((await state()).knowledge.documents.some(d => d.id === 'D-zhouyu' && d.observedAtMs === 0));
    assert.equal(await page.locator('#opening-notice').evaluate(el => getComputedStyle(el).clipPath), 'inset(50%)');
    assert.ok(await page.locator('#panel-title').evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width/2, r.y + r.height/2)); }));
    await shot('reported-map'); pass('map reports retain old observations and distinguish reported position');
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight), false);
    assert.deepEqual(errors, []); pass('no page errors or document scrolling');
    } catch (error) { await shot('failure'); await writeFile(`${output}/failure-${size}.json`, JSON.stringify({ errors, state: await state(), notice: await page.locator('#opening-notice').evaluate(el => el.outerHTML) }, null, 2)); throw error; }
    await page.close();
  }
} finally {
  await writeFile(`${output}/checks.json`, JSON.stringify(checks, null, 2));
  await browser.close(); await vite.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
}
console.log(`${checks.length} browser checks passed`);
