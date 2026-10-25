import { createServer as createPortProbe } from 'node:net';
import type { AddressInfo } from 'node:net';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { createGameServer } from '../server/http.ts';
import { GameEngine } from '../server/engine.ts';

const outIndex = process.argv.indexOf('--out');
const output = outIndex >= 0 ? process.argv[outIndex + 1]! : 'artifacts/r1-fixes';
const repro = process.argv.includes('--repro');
// Allocate isolated ports: another worktree's verification must not be stopped.
const probe = createPortProbe(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const webPort = (probe.address() as AddressInfo).port;
await new Promise<void>(resolve => probe.close(() => resolve()));
const base = `http://127.0.0.1:${webPort}`;
const api = createGameServer(new GameEngine(), webPort);
api.listen(0, '127.0.0.1'); await once(api, 'listening');
const apiPort = (api.address() as AddressInfo).port;
const vite = await createServer({ logLevel: 'error', server: { port: webPort, strictPort: true, proxy: { '/api': `http://127.0.0.1:${apiPort}` } } });
await vite.listen();
let browser;
const checks: { size: string; check: string; passed: boolean; error?: string }[] = [];
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  await mkdir(output, { recursive: true });
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
    const page = await browser.newPage({ viewport });
    const size = `${viewport.width}x${viewport.height}`;
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    for (const [check, text] of [
      ['single', '주유는 수군을 비밀리에 1분 이내 정비해. 먼저 공격하지 마.'],
      ['compound', '조조에게 답변을 보류해. 노숙은 유비에게 비공개로 연락해. 주유는 수군을 정비하되 먼저 공격하지 마.'],
      ['partial', '수군을 정비하고 세금을 걷어.'],
    ]) {
      try {
        await page.request.post(`${base}/api/test/reset`, { data: {} });
        await page.goto(base);
        await page.locator('#speech-input').fill(text!); await page.locator('#speech-submit').click();
        await page.waitForSelector('.draft-card');
        await page.screenshot({ path: `${output}/${repro ? 'repro-' : ''}${check}-${size}.png`, animations: 'disabled' });
        if (check === 'single') {
          const details = await page.locator('.draft-content').innerText();
          assert.match(details, /공개 범위[^\n]*비밀/);
          assert.match(details, /기한[^\n]*1분 이내/);
          assert.match(details, /먼저 공격하지 않음/);
        }
        if (check === 'partial') {
          assert.match(await page.locator('.draft-card').innerText(), /미지원[^]*세금을 걷어/);
          assert.match(await page.locator('.partial-scope').innerText(), /세금을 걷어/);
        }
        const visible = async () => assert.ok(await page.locator('.draft-card').evaluate(card => {
          const body = card.closest('.panel-body')!.getBoundingClientRect();
          const scroll = card.querySelector('.draft-content')!.getBoundingClientRect();
          const first = card.querySelector('.action-row') ?? card.querySelector('.draft-rows');
          const targets = [...card.querySelectorAll('.draft-actions button'), ...(first ? [first] : [])];
          return targets.length === 4 && targets.every(el => {
            const r = el.getBoundingClientRect();
            return r.top >= Math.max(body.top, el === first ? scroll.top : body.top) && r.bottom <= body.bottom &&
              (el !== first || r.bottom <= scroll.bottom) && r.left >= body.left && r.right <= body.right &&
              el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
          });
        }), 'first action and confirm/revise/cancel controls must be visible together');
        await visible();
        if (check === 'compound') {
          // Source/editor details scroll; the action summary must remain in place.
          const details = page.locator(repro ? '.draft-content' : '.draft-details');
          await details.evaluate(el => { el.scrollTop = el.scrollHeight; });
          await page.screenshot({ path: `${output}/${repro ? 'repro-' : ''}compound-scrolled-${size}.png`, animations: 'disabled' });
          await visible();
          if (!repro) {
            await page.getByRole('button', { name: '수정', exact: true }).click();
            await page.locator('.draft-details').evaluate(el => { el.scrollTop = el.scrollHeight; });
            assert.ok(await page.locator('.draft-details').evaluate(el => el.scrollTop > 0), 'exercise actual detail scrolling');
            await visible();
            await page.screenshot({ path: `${output}/compound-edit-scrolled-${size}.png`, animations: 'disabled' });
          }
        }
        checks.push({ size, check: check!, passed: true });
      } catch (error) { checks.push({ size, check: check!, passed: false, error: String(error) }); }
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  await writeFile(`${output}/${repro ? 'repro-' : ''}r1-browser-checks.json`, JSON.stringify({ browser: 'installed Microsoft Edge', version: browser.version(), checks }, null, 2));
  for (const check of checks) console.log(JSON.stringify(check));
  process.exitCode = checks.every(c => c.passed) ? 0 : 1;
} finally {
  await browser?.close(); await vite.close(); api.closeAllConnections();
  await new Promise<void>(resolve => api.close(() => resolve()));
}
