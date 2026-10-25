import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { createGameServer } from '../server/http.ts';
import type { PlayerView } from '../shared/contracts.ts';

// Installed Edge, isolated local fixtures. No dependency or server/contract changes.
const output = process.argv.includes('--stage2') ? 'artifacts/m1-stage2' : 'artifacts/m1-integrated';
const api = createGameServer(undefined, 5274);
api.listen(3102, '127.0.0.1');
await once(api, 'listening');
const vite = await createServer({ logLevel: 'error', server: { port: 5274, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3102' } } });
await vite.listen();
const checks: { size: string; check: string; passed: true }[] = [];
const browser = await chromium.launch({ channel: 'msedge', headless: !process.argv.includes('--headed') });
try {
  await mkdir(output, { recursive: true });
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
    const page = await browser.newPage({ viewport });
    const size = `${viewport.width}x${viewport.height}`;
    const pass = (check: string) => { checks.push({ size, check, passed: true }); console.log(`${size}: ${check}`); };
    const state = async (): Promise<PlayerView> => await page.evaluate(async () => (await fetch('/api/state')).json());
    const reset = async () => {
      await page.request.post('http://127.0.0.1:5274/api/test/reset', { data: {} });
      await page.goto('http://127.0.0.1:5274');
      await page.waitForSelector('#connection:has-text("서버 연결됨")');
    };
    await reset();
    await page.waitForSelector('.character-art.has-image');
    assert.equal(await page.locator('.layer.has-image').count(), 2);
    assert.equal(await page.locator('.guard').count(), 2);
    assert.equal(await page.locator('.ruler').count(), 1);
    pass('three imported images loaded; ruler and both guards retained');

    // Fail only image requests, not Vite's SVG module wrappers.
    await page.route('**/*', route => route.request().resourceType() === 'image' ? route.abort('failed') : route.continue());
    await reset();
    // Vite inlines small SVGs as data URLs. Redirect those images to a failed
    // request too, exercising the real Image error handler rather than a mock event.
    await page.locator('.slot-image').evaluateAll(images => images.forEach(image => { (image as HTMLImageElement).src = '/missing-review-art.svg'; }));
    await page.waitForFunction(() => !document.querySelector('.slot-image'));
    assert.equal(await page.locator('.figure-zhang-hong').isVisible(), true);
    assert.equal(await page.locator('#layer-back > .scene-svg').isVisible(), true);
    await page.locator('#hotspot-zhang-hong').click();
    await page.locator('#speech-input').fill('그림이 없어도 입력 유지');
    await page.locator('#tool-documents').click();
    assert.match(await page.locator('.paper-body').innerText(), /수군 준비도/);
    assert.equal(await page.locator('#speech-input').inputValue(), '그림이 없어도 입력 유지');
    await page.screenshot({ path: `${output}/asset-failure-${size}.png`, animations: 'disabled' });
    pass('M1-U08: failed art keeps fallback, character interaction, input and document access');
    await page.unroute('**/*');
    await reset();

    const initial = await state();
    const order = '주유에게 수군을 정비하라고 전해. 먼저 공격하지는 마.';
    await page.locator('#speech-input').fill(order);
    await page.locator('#speech-submit').click();
    await page.waitForSelector('.draft-card');
    const draftState = await state();
    assert.equal(draftState.tasks.length, 0);
    assert.equal(draftState.ledger.grain, initial.ledger.grain);
    assert.match(await page.locator('.restrictions').innerText(), /먼저 공격하지 않음/);
    await page.locator('#panel-close').click();
    await page.locator('#tool-command').click();
    assert.equal(await page.locator('.draft-card').count(), 1);
    assert.match(await page.locator('.draft-quote').innerText(), /먼저 공격/);
    pass('draft closure preserves pending command; no cost/task before confirmation');
    await page.locator('.draft-card .btn-primary').click({ clickCount: 2 });
    await page.waitForSelector('.task-card');
    assert.equal((await state()).tasks.length, 1);
    await page.locator('#tool-dev').click();
    for (let i = 0; i < 2; i++) {
      await page.locator('#advance-30').click();
      await page.waitForSelector('#advance-30:not([disabled])');
    }
    await page.locator('#dev-close').click();
    await page.waitForSelector('.step.current:has-text("완료")');
    const completed = await state();
    assert.equal(completed.tasks.length, 1);
    assert.equal(completed.ledger.grain, initial.ledger.grain - 100);
    assert.equal(completed.ledger.navalReadiness, initial.ledger.navalReadiness + 15);
    assert.equal(completed.tasks[0]!.reportIds.length, 2);
    await page.locator('.task-reports .link').last().click();
    await page.waitForSelector('.paper');
    assert.match(await page.locator('.paper-meta').innerText(), /관련 작업/);
    assert.match(await page.locator('.paper-body').innerText(), /선제공격 금지|먼저 공격하지 않음/);
    await page.screenshot({ path: `${output}/report-${size}.png`, animations: 'disabled' });
    await page.locator('.paper-meta dd').last().scrollIntoViewIfNeeded();
    assert.ok(await page.locator('.paper-meta dd').last().evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const panel = document.querySelector('.panel-body')!.getBoundingClientRect();
      return bounds.top >= panel.top && bounds.bottom <= panel.bottom;
    }));
    pass('Edge UI: submit → double confirmation → 60 seconds → completed report; one task, grain -100, readiness +15');

    await page.locator('#tool-map').click();
    await page.locator('#map-navy').focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('.paper');
    assert.match(await page.locator('.paper-meta').innerText(), /관련 작업/);
    await page.locator('#tool-map').click();
    await page.locator('#map-jiangdong').focus();
    await page.keyboard.press('Space');
    await page.waitForSelector('.paper');
    assert.match(await page.locator('.paper-meta').innerText(), /출처/);
    pass('both map markers open public documents by keyboard; navy opens latest report');
    await page.close();
  }
  await writeFile(`${output}/browser-checks.json`, JSON.stringify({ browser: 'installed Microsoft Edge', headed: process.argv.includes('--headed'), version: browser.version(), checks }, null, 2) + '\n');
} finally {
  await browser.close();
  await vite.close();
  api.closeAllConnections();
  await new Promise<void>(resolve => api.close(() => resolve()));
}
