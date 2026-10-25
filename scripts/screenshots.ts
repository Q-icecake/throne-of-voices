import { mkdir, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import { createGameServer } from '../server/http.ts';

/**
 * Drives the real app in the installed Edge/Chrome (no browser download), captures each scene
 * at two desktop sizes and measures layout rules from VISUAL_DIRECTION §11.
 * Usage: node scripts/screenshots.ts [S0,S1,S4,S5a,S5b,S2] [--out artifacts/m1]
 * Starts its own API + Vite on separate ports (3101/5273) so a running dev server is never touched.
 */
const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outDir = new URL(`../${outIndex >= 0 ? args[outIndex + 1] : 'artifacts/m1'}/`, import.meta.url);
const wanted = (args.find((arg, index) => !arg.startsWith('--') && (outIndex < 0 || index !== outIndex + 1)) ?? 'S0,S1,S4,S5a,S5b,S2').split(',');
const SIZES = [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }];
const ORDER = '주유에게 수군을 정비하라고 전해. 먼저 공격하지는 마.';

async function launch(): Promise<Browser> {
  for (const channel of ['msedge', 'chrome'] as const) {
    try { return await chromium.launch({ channel }); } catch { /* try next */ }
  }
  throw new Error('Edge 또는 Chrome을 찾지 못했습니다.');
}

interface Metrics {
  scene: string; size: string; pageScroll: boolean; hudCoverage: number;
  blockedControls: string[]; offscreenControls: string[]; bodyFontPx: number | null;
}

async function measure(page: Page, scene: string, size: string): Promise<Metrics> {
  return await page.evaluate(([sceneName, sizeName]) => {
    const vw = innerWidth, vh = innerHeight;
    const doc = document.scrollingElement!;
    const visible = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
    const persistent = ['.hud-status', '.hud-tools', '.speech'].map(sel => document.querySelector(sel)).filter((el): el is Element => !!el && visible(el));
    const area = persistent.reduce((sum, el) => { const r = el.getBoundingClientRect(); return sum + r.width * r.height; }, 0);
    const controls = [...document.querySelectorAll('button')].filter(visible).filter(el => !el.closest('.dev-drawer') && !el.closest('[hidden]'));
    const blocked: string[] = [], offscreen: string[] = [];
    for (const el of controls) {
      const r = el.getBoundingClientRect();
      const label = el.textContent?.trim() || el.id || el.getAttribute('aria-label') || 'button';
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (cx < 0 || cy < 0 || cx > vw || cy > vh) { offscreen.push(label); continue; }
      // Partially scrolled-away items inside a scrolling panel are fine; check only fully visible ones.
      const scroller = el.closest('.panel-body');
      if (scroller) { const s = scroller.getBoundingClientRect(); if (r.top < s.top || r.bottom > s.bottom) continue; }
      const top = document.elementFromPoint(cx, cy);
      if (top !== el && !el.contains(top)) blocked.push(label);
    }
    const body = document.querySelector('.paper-body');
    return {
      scene: sceneName!, size: sizeName!,
      pageScroll: doc.scrollHeight > vh + 1 || doc.scrollWidth > vw + 1,
      hudCoverage: Math.round((area / (vw * vh)) * 1000) / 10,
      blockedControls: blocked, offscreenControls: offscreen,
      bodyFontPx: body ? parseFloat(getComputedStyle(body).fontSize) : null,
    };
  }, [scene, size]);
}

async function reset(page: Page) {
  await page.evaluate(async () => { await fetch('/api/test/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); });
  await page.reload();
  await page.waitForSelector('#connection:has-text("서버 연결됨")');
}

async function settle(page: Page) { await page.waitForTimeout(450); }

const SCENES: Record<string, (page: Page) => Promise<void>> = {
  S0: async () => {},
  S1: async page => { await page.click('#tool-documents'); await settle(page); },
  S4: async page => { await page.click('#tool-map'); await settle(page); },
  S2: async page => { await page.click('#hotspot-zhang-hong'); await page.fill('#speech-input', '수군의 상태는 어떤가?'); await settle(page); },
  S5a: async page => {
    await page.fill('#speech-input', ORDER);
    await page.click('#speech-submit');
    await page.waitForSelector('.draft-card');
    await settle(page);
  },
  S5b: async page => {
    await page.fill('#speech-input', ORDER);
    await page.click('#speech-submit');
    await page.waitForSelector('.draft-card');
    await page.click('.draft-card .btn-primary');
    await page.waitForSelector('.task-card');
    // Pass time through the real dev drawer controls, then close it again.
    await page.click('#tool-dev');
    await page.click('#advance-30');
    await page.waitForSelector('#advance-30:not([disabled])');
    await page.click('#advance-30');
    await page.waitForSelector('#advance-30:not([disabled])');
    await page.click('#dev-close');
    await page.waitForSelector('.step.current:has-text("완료")');
    await settle(page);
  },
};

const API_PORT = 3101, WEB_PORT = 5273;
const base = `http://127.0.0.1:${WEB_PORT}`;
const api = createGameServer(undefined, WEB_PORT);
api.listen(API_PORT, '127.0.0.1');
await once(api, 'listening');
const vite: ViteDevServer = await createServer({
  logLevel: 'error',
  server: { port: WEB_PORT, strictPort: true, proxy: { '/api': `http://127.0.0.1:${API_PORT}` } },
});
await vite.listen();
const browser = await launch();
const results: Metrics[] = [];
try {
  await mkdir(outDir, { recursive: true });
  for (const size of SIZES) {
    const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
    await page.goto(base);
    for (const scene of wanted) {
      const step = SCENES[scene];
      if (!step) throw new Error(`Unknown scene ${scene}`);
      await reset(page);
      await step(page);
      const name = `${scene.toLowerCase()}-${size.width}x${size.height}.png`;
      await page.screenshot({ path: fileURLToPath(new URL(name, outDir)) });
      results.push(await measure(page, scene, `${size.width}x${size.height}`));
    }
    await page.close();
  }
} finally {
  await browser.close();
  await vite.close();
  api.closeAllConnections();
  await new Promise<void>(resolve => api.close(() => resolve()));
}
await writeFile(new URL('metrics.json', outDir), JSON.stringify(results, null, 2) + '\n');
let failed = false;
for (const m of results) {
  const problems = [
    m.pageScroll && '페이지 스크롤 발생',
    m.scene === 'S0' && m.hudCoverage > 25 && `상시 UI ${m.hudCoverage}% > 25%`,
    m.blockedControls.length && `가려진 버튼: ${m.blockedControls.join(', ')}`,
    m.offscreenControls.length && `화면 밖 버튼: ${m.offscreenControls.join(', ')}`,
    m.bodyFontPx !== null && m.bodyFontPx < 16 && `문서 본문 ${m.bodyFontPx}px < 16px`,
  ].filter(Boolean);
  if (problems.length) failed = true;
  console.log(`${m.scene.padEnd(4)} ${m.size.padEnd(10)} UI ${String(m.hudCoverage).padStart(5)}%  ${problems.length ? '✖ ' + problems.join(' / ') : '✔'}`);
}
console.log(`스크린샷: ${fileURLToPath(outDir)}`);
process.exitCode = failed ? 1 : 0;
