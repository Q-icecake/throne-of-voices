import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { createGameServer } from '../server/http.ts';
import { GameEngine } from '../server/engine.ts';
import { ScriptedProvider } from '../tests/fixtures/scripted-provider.ts';

const output = 'artifacts/r3-fixes';
const baseline = process.argv.includes('--baseline');
await mkdir(output, { recursive: true });
const provider = new ScriptedProvider(...Array.from({ length: 2 }, () => ({
  intent: 'question' as const, dialogue: '유비와 동맹을 체결하였습니다.', proposedActions: [], unresolvedQuestions: [],
  referencedKnowledgeIds: [], usage: { inputTokens: 0, outputTokens: 0, externalCalls: 0, costUsd: 0 },
})));
const api = createGameServer(new GameEngine(undefined, undefined, provider, 15000, provider.status, { mode: 'manual', ready: true }), 5281);
api.listen(3111, '127.0.0.1'); await once(api, 'listening');
const vite = await createServer({ logLevel: 'error', plugins: baseline ? [{
  name: 'r3-original-ui-reproduction', enforce: 'pre',
  load(id) {
    const file = ['client/src/main.ts', 'client/src/ui/focus.ts'].find(file => id.replaceAll('\\', '/').endsWith(`/${file}`));
    // Read-only baseline reproduction, without modifying the worktree or existing assertions.
    if (file) return execFileSync('git', ['-c', `safe.directory=${process.cwd().replaceAll('\\', '/')}`, 'show', `3d15bde:${file}`], { encoding: 'utf8', windowsHide: true });
  },
}] : [], server: { port: 5281, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3111' } } });
let browser;
const checks: { size: string; check: string; passed: boolean; error?: string }[] = [];
try {
  await vite.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
    const page = await browser.newPage({ viewport });
    const size = `${viewport.width}x${viewport.height}`;
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.request.post('http://127.0.0.1:5281/api/test/reset', { data: {} });
    await page.goto('http://127.0.0.1:5281');
    await page.waitForSelector('#connection:has-text("서버 연결됨")');
    const advanced = await page.request.post('http://127.0.0.1:5281/api/test/action', { data: { type: 'advance-clock', milliseconds: 25000 } });
    assert.ok(advanced.ok());
    await page.reload();
    await page.waitForSelector('#connection:has-text("서버 연결됨")');
    for (const check of ['document-selection', 'unsupported-provider-fact']) {
      if (baseline && check !== 'document-selection') continue;
      try {
        if (check === 'document-selection') {
          await page.locator('#tool-documents').click();
          const item = page.locator('.doc-item').filter({ hasText: '형주 방면 전령의 급보' });
          await item.click();
          const docId = await page.locator('.paper').getAttribute('data-document');
          await page.locator('#panel-close').click();
          await page.locator('#tool-documents').click();
          await item.click();
          await page.screenshot({ path: `${output}/${baseline ? 'before-' : ''}document-selected-${size}.png`, animations: 'disabled' });
          assert.ok(await page.locator('.doc-panel').isVisible(), 'reselecting selected document must keep panel open');
          assert.equal(await page.locator('.paper').getAttribute('data-document'), docId);
          await item.click();
          assert.ok(await page.locator('.doc-panel').isVisible(), 'repeated selection remains idempotent');
          await page.locator('#tool-documents').click();
          assert.ok(!(await page.locator('.doc-panel').isVisible()), 'toolbar still toggles closed');
          await page.locator('#tool-documents').click();
          assert.equal(await page.locator('.paper').getAttribute('data-document'), docId);
          await page.locator('#panel-close').click();
        } else {
          await page.locator('#speech-input').fill('현재 외교 상황은?');
          await page.locator('#speech-submit').click();
          await page.waitForFunction(() => document.querySelector('.reply')?.textContent?.includes('확인된 기록'));
          assert.ok(!(await page.locator('body').innerText()).includes('유비와 동맹을 체결하였습니다.'));
          const snapshot = await (await page.request.get('http://127.0.0.1:5281/api/state')).json();
          assert.equal(snapshot.tasks.length, 0);
          assert.equal(snapshot.ledger.grain, 1000);
          await page.screenshot({ path: `${output}/provider-filtered-${size}.png`, animations: 'disabled' });
        }
        assert.deepEqual(errors, []);
        checks.push({ size, check, passed: true });
      } catch (error) { checks.push({ size, check, passed: false, error: error instanceof Error ? error.message : String(error) }); }
    }
    await page.close();
  }
  await writeFile(`${output}/${baseline ? 'before-' : ''}browser-checks.json`, JSON.stringify({ browser: 'installed Microsoft Edge', version: browser.version(), checks }, null, 2) + '\n');
  checks.forEach(check => console.log(JSON.stringify(check)));
  process.exitCode = checks.every(check => check.passed) ? 0 : 1;
} finally {
  await browser?.close(); await vite.close(); api.closeAllConnections();
  await new Promise<void>(resolve => api.close(() => resolve()));
}
