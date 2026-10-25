import { mkdir, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import { createGameServer } from '../server/http.ts';

/**
 * Drives the real app in the installed Edge (no browser download), captures each scene
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
  // Stage review requires the installed Edge; preserve its real launch error on failure.
  return await chromium.launch({ channel: 'msedge' });
}

interface Metrics {
  scene: string; size: string; pageScroll: boolean; hudCoverage: number;
  panelCoverage: number; screenCoverage: number; panelOccludedControls: string[]; checkedSceneControls: string[];
  rulerSeatOffsetPx: number;
  blockedControls: string[]; offscreenControls: string[]; bodyFontPx: number | null; minReadingFontPx: number;
}

async function measure(page: Page, scene: string, size: string): Promise<Metrics> {
  return await page.evaluate(([sceneName, sizeName]) => {
    const vw = innerWidth, vh = innerHeight;
    const doc = document.scrollingElement!;
    const visible = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
    const persistent = ['.hud-status', '.hud-tools', '.speech'].map(sel => document.querySelector(sel)).filter((el): el is Element => !!el && visible(el));
    const panels = [...document.querySelectorAll('.panel:not([hidden]), .dev-drawer:not([hidden])')].filter(visible);
    // Viewport-clipped rectangle union: overlaps count once, shadows do not count.
    const coverage = (elements: Element[]) => {
      const rects = elements.map(el => el.getBoundingClientRect()).map(r => ({
        left: Math.max(0, r.left), right: Math.min(vw, r.right), top: Math.max(0, r.top), bottom: Math.min(vh, r.bottom),
      })).filter(r => r.right > r.left && r.bottom > r.top);
      const xs = [...new Set(rects.flatMap(r => [r.left, r.right]))].sort((a, b) => a - b);
      let area = 0;
      for (let i = 1; i < xs.length; i++) {
        const left = xs[i - 1]!, right = xs[i]!;
        const spans = rects.filter(r => r.left < right && r.right > left).sort((a, b) => a.top - b.top);
        let bottom = 0;
        for (const span of spans) {
          area += (right - left) * Math.max(0, span.bottom - Math.max(bottom, span.top));
          bottom = Math.max(bottom, span.bottom);
        }
      }
      return Math.round(area / (vw * vh) * 1000) / 10;
    };
    const controls = [...document.querySelectorAll('button, [role="button"]')].filter(visible)
      .filter(el => !el.closest('.dev-drawer') && !el.closest('[hidden]'));
    const blocked: string[] = [], offscreen: string[] = [];
    const panelOccluded: string[] = [], checkedScene: string[] = [];
    for (const el of controls) {
      const r = el.getBoundingClientRect();
      const label = el.textContent?.trim() || el.id || el.getAttribute('aria-label') || 'button';
      let cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (cx < 0 || cy < 0 || cx > vw || cy > vh) { offscreen.push(label); continue; }
      // Partially scrolled-away items inside a scrolling panel are fine; check only fully visible ones.
      const scroller = el.closest('.panel-body');
      if (scroller) { const s = scroller.getBoundingClientRect(); if (r.top < s.top || r.bottom > s.bottom) continue; }
      if (el.closest('.scene')) {
        // Subtract only actual panel rectangles. A partially exposed prop still
        // gets a hit test in its largest exposed area; unrelated overlays fail.
        let exposed = [{ left: Math.max(0, r.left), right: Math.min(vw, r.right), top: Math.max(0, r.top), bottom: Math.min(vh, r.bottom) }];
        for (const panel of panels) {
          const p = panel.getBoundingClientRect();
          exposed = exposed.flatMap(e => {
            const l = Math.max(e.left, p.left), rr = Math.min(e.right, p.right);
            const t = Math.max(e.top, p.top), b = Math.min(e.bottom, p.bottom);
            if (rr <= l || b <= t) return [e];
            return [
              { ...e, bottom: t }, { ...e, top: b },
              { left: e.left, right: l, top: t, bottom: b },
              { left: rr, right: e.right, top: t, bottom: b },
            ].filter(part => part.right > part.left && part.bottom > part.top);
          });
        }
        if (!exposed.length) { panelOccluded.push(el.id || label); continue; }
        exposed.sort((a, b) => (b.right - b.left) * (b.bottom - b.top) - (a.right - a.left) * (a.bottom - a.top));
        const target = exposed[0]!;
        cx = (target.left + target.right) / 2; cy = (target.top + target.bottom) / 2;
        checkedScene.push(el.id || label);
      }
      const top = document.elementFromPoint(cx, cy);
      if (top !== el && !el.contains(top)) blocked.push(label);
    }
    const body = document.querySelector('.paper-body');
    const reading = [...document.querySelectorAll('#speech-input, .reply, .paper-body, .draft-quote, .draft-rows, .restrictions li, .revise textarea, .map-legend, .record-list, .panel-body p.muted')]
      .filter(el => visible(el) && !el.closest('[hidden]'));
    const back = document.querySelector('.layer-back')!.getBoundingClientRect();
    const ruler = document.querySelector<SVGGraphicsElement>('.ruler')!;
    const seated = new DOMPoint(960, 600).matrixTransform(ruler.getScreenCTM()!);
    const imported = document.querySelector('.layer-back.has-image');
    const seatX = back.left + back.width * (imported ? 1068 : 960) / 1920;
    const seatY = back.top + back.height * (imported ? 548 : 600) / 1080;
    return {
      scene: sceneName!, size: sizeName!,
      pageScroll: doc.scrollHeight > vh + 1 || doc.scrollWidth > vw + 1,
      hudCoverage: coverage(persistent), panelCoverage: coverage(panels), screenCoverage: coverage([...persistent, ...panels]),
      panelOccludedControls: panelOccluded, checkedSceneControls: checkedScene,
      rulerSeatOffsetPx: Math.round(Math.hypot(seated.x - seatX, seated.y - seatY) * 100) / 100,
      blockedControls: blocked, offscreenControls: offscreen,
      bodyFontPx: body ? parseFloat(getComputedStyle(body).fontSize) : null,
      minReadingFontPx: Math.min(...reading.map(el => parseFloat(getComputedStyle(el).fontSize))),
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
      await page.evaluate(() => document.fonts.ready);
      await settle(page);
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
    m.rulerSeatOffsetPx > 1 && `손권/좌석 어긋남: ${m.rulerSeatOffsetPx}px`,
    m.bodyFontPx !== null && m.bodyFontPx < 16 && `문서 본문 ${m.bodyFontPx}px < 16px`,
    m.minReadingFontPx < 16 && `읽기/입력 본문 ${m.minReadingFontPx}px < 16px`,
  ].filter(Boolean);
  if (problems.length) failed = true;
  console.log(`${m.scene.padEnd(4)} ${m.size.padEnd(10)} HUD ${m.hudCoverage}% / panel ${m.panelCoverage}% / screen ${m.screenCoverage}%  ${problems.length ? '✖ ' + problems.join(' / ') : '✔'}`);
}
console.log(`스크린샷: ${fileURLToPath(outDir)}`);
process.exitCode = failed ? 1 : 0;
