import { listenForFetch } from './test-server.ts';
import { createServer as createPortProbe } from 'node:net';
import type { AddressInfo } from 'node:net';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { createGameServer } from '../server/http.ts';
import { GameEngine } from '../server/engine.ts';
import type { PlayerView } from '../shared/contracts.ts';

const outIndex = process.argv.indexOf('--out');
const output = outIndex >= 0 ? process.argv[outIndex + 1]! : 'artifacts/m3';
const order = '조조에게는 당장 확답하지 말고 시간을 벌어. 노숙은 유비에게 비밀리에 연락하고, 주유는 수군을 준비시키되 먼저 공격하지는 마.';
// Explicit offline engine, independent ports, installed Edge. No provider/network credentials.
// Allocate isolated ports: another worktree's verification must not be stopped.
const probe = createPortProbe(); await listenForFetch(probe);
const webPort = (probe.address() as AddressInfo).port;
await new Promise<void>(resolve => probe.close(() => resolve()));
const base = `http://127.0.0.1:${webPort}`;
const api = createGameServer(new GameEngine(), webPort);
await listenForFetch(api);
const apiPort = (api.address() as AddressInfo).port;
const vite = await createServer({ logLevel: 'error', server: { port: webPort, strictPort: true, proxy: { '/api': `http://127.0.0.1:${apiPort}` } } });
await vite.listen();
let browser;
const checks: { size: string; check: string }[] = [];
try {
  browser = await chromium.launch({ channel: 'msedge' });
  await mkdir(output, { recursive: true });
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
    const page = await browser.newPage({ viewport });
    const size = `${viewport.width}x${viewport.height}`;
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    const pass = (check: string) => { checks.push({ size, check }); console.log(`${size}: ${check}`); };
    const state = async (): Promise<PlayerView> => (await page.request.get(`${base}/api/state`)).json();
    await page.request.post(`${base}/api/test/reset`, { data: {} });
    await page.goto(`${base}/?start=court`);
    await page.locator('#speech-input').fill(order); await page.locator('#speech-submit').click();
    await page.waitForSelector('.action-row');
    assert.equal(await page.locator('.action-row').count(), 3);
    assert.equal((await state()).tasks.length, 0);
    const checkButtons = async () => assert.ok(await page.locator('.draft-card').evaluate(card => {
      const body = card.closest('.panel-body')!.getBoundingClientRect();
      return [...card.querySelectorAll('.draft-actions button')].every(el => {
        const r = el.getBoundingClientRect();
        return r.top >= body.top && r.bottom <= body.bottom && r.left >= body.left && r.right <= body.right &&
          el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
      });
    }), 'all confirmation controls must be visible and unobstructed');
    await checkButtons();
    await page.locator('.draft-details').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await checkButtons();
    await page.screenshot({ path: `${output}/compound-draft-${size}.png`, animations: 'disabled' });
    pass('three rows, source conditions, no pre-confirm task; buttons remain visible after detail scrolling');
    await page.getByRole('button', { name: '수정', exact: true }).click();
    await checkButtons();
    await page.locator('.revise textarea').fill(order);
    await page.getByRole('button', { name: '수정 반영', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.draft-head .version')?.textContent === '버전 2');
    await checkButtons();
    await page.locator('.draft-actions .btn-primary').click({ clickCount: 2 });
    await page.waitForFunction(() => document.querySelectorAll('.task-card').length === 3);
    assert.equal((await state()).tasks.length, 3);
    pass('revision and double confirmation create exactly three tasks');
    await page.locator('#tool-dev').click();
    await page.locator('#advance-30').click(); await page.waitForSelector('#advance-30:not([disabled])');
    assert.equal((await state()).tasks.find(t => t.action === 'sound-out')!.stage, 'awaiting-reply');
    await page.locator('#dev-close').click();
    await page.locator('[data-task="task-0002"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/compound-awaiting-${size}.png`, animations: 'disabled' });
    pass('clock advances to envoy reply waiting, without invented acceptance');
    await page.locator('#tool-dev').click();
    await page.locator('#advance-30').click(); await page.waitForSelector('#advance-30:not([disabled])');
    await page.locator('#dev-close').click();
    const done = await state();
    assert.ok(done.tasks.every(t => t.stage === 'completed'));
    assert.equal(done.ledger.grain, 880); assert.equal(done.ledger.navalReadiness, 35);
    await page.getByRole('button', { name: /유비 측 회신 도착/ }).click();
    await page.waitForSelector('.paper');
    assert.match(await page.locator('.paper-body').innerText(), /수락·동맹·참전 확약은 아직 없습니다/);
    assert.match(await page.locator('.paper-meta').innerText(), /task-0002/);
    await page.screenshot({ path: `${output}/compound-reply-${size}.png`, animations: 'disabled' });
    pass('delayed scenario reply opened; task reference, grain and readiness verified');
    // User-visible partial scope, cancellation and post-confirm recall are real UI paths too.
    await page.locator('#speech-input').fill('주유는 수군을 정비하고 정찰도 보내.');
    await page.locator('#speech-submit').click(); await page.waitForSelector('.draft-card');
    assert.match(await page.locator('.draft-card').innerText(), /미지원/);
    await checkButtons();
    await page.getByRole('button', { name: '초안 취소', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.draft-card'));
    await page.locator('#speech-input').fill('노숙은 유비에게 비밀리에 연락해.');
    await page.locator('#speech-submit').click(); await page.waitForSelector('.draft-card');
    await page.locator('.draft-actions .btn-primary').click();
    await page.getByRole('button', { name: '회수 요청', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.task-card')?.textContent?.includes('회수: 중단됨'));
    pass('partial scope displayed, draft cancelled, confirmed envoy recalled before departure');
    assert.deepEqual(errors, []);
    await page.close();
  }
  await writeFile(`${output}/compound-checks.json`, JSON.stringify({ browser: 'installed Edge', externalCalls: 0, checks }, null, 2));
} finally { await browser?.close(); await vite.close(); await new Promise<void>(resolve => api.close(() => resolve())); }
