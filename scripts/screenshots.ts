import { listenForFetch } from './test-server.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer as createPortProbe } from 'node:net';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { relative } from 'node:path';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import assert from 'node:assert/strict';
import { createGameServer } from '../server/http.ts';

/**
 * Drives the real app in the installed Edge (no browser download), captures each scene
 * at two desktop sizes and measures layout rules from VISUAL_DIRECTION §11.
 * Usage: node scripts/screenshots.ts [S0,S1,S4,S5a,S5b,S2] [--out artifacts/m1]
 * Starts its own API + Vite on isolated dynamic ports, leaving other worktrees alone.
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
  minTextContrast: number; contrastSamples: { selector: string; ratio: number }[];
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
      // Partially scrolled-away items inside a scrolling panel are fine; check only fully visible ones.
      const scroller = el.closest('.panel-body');
      if (scroller) { const s = scroller.getBoundingClientRect(); if (r.top < s.top || r.bottom > s.bottom) continue; }
      if (cx < 0 || cy < 0 || cx > vw || cy > vh) { offscreen.push(label); continue; }
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
    // CSS text contrast over both black/white underlays bounds translucent panel
    // backgrounds. This is not OCR, anti-aliasing or a Korean comprehension test.
    const rgba = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
    const luminance = (rgb: number[]) => rgb.slice(0, 3).reduce((sum, c, i) => {
      const n = c / 255; return sum + (n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4) * [0.2126, .7152, .0722][i]!;
    }, 0);
    const contrastSamples = ['#speech-input', '.reply', '.paper-body', '.draft-quote', '.audience-panel > p', '.map-legend'].flatMap(selector => {
      const el = document.querySelector(selector); if (!el || !visible(el) || el.closest('[hidden]')) return [];
      const fg = rgba(getComputedStyle(el).color), ancestors: Element[] = [];
      for (let a: Element | null = el; a; a = a.parentElement) {
        ancestors.unshift(a);
        // The SVG scene is a sibling behind these overlays. Stop here so a
        // solid html/stage background cannot erase the unknown scene underlay.
        if (a.matches('.speech, .panel, .dev-drawer')) break;
      }
      const ratios = [0, 255].map(underlay => {
        let bg = [underlay, underlay, underlay];
        for (const a of ancestors) {
          const style = getComputedStyle(a), c = rgba(style.backgroundColor), alpha = c[3] ?? 1;
          bg = bg.map((v, i) => (c[i] ?? 0) * alpha + v * (1 - alpha));
          if (style.backgroundImage.includes('gradient')) {
            const stops = (style.backgroundImage.match(/rgba?\([^)]+\)/g) ?? []).map(rgba);
            const opaque = stops.filter(s => (s[3] ?? 1) === 1);
            // Bound all opaque gradient stops plus every translucent texture stop.
            const candidates = opaque.flatMap(base => [base, ...stops.filter(s => (s[3] ?? 1) < 1).map(s => base.slice(0, 3).map((v, i) => s[i]! * s[3]! + v * (1 - s[3]!)))]);
            const contrast = (rgb: number[]) => { const f = luminance(fg), b = luminance(rgb); return (Math.max(f, b) + .05) / (Math.min(f, b) + .05); };
            candidates.sort((a, b) => contrast(a) - contrast(b)); if (candidates.length) bg = candidates[0]!.slice(0, 3);
          }
        }
        const a = luminance(fg), b = luminance(bg); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      });
      return [{ selector, ratio: Math.round(Math.min(...ratios) * 100) / 100 }];
    });
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
      contrastSamples, minTextContrast: Math.min(...contrastSamples.map(s => s.ratio)),
    };
  }, [scene, size]);
}

async function reset(page: Page) {
  await page.evaluate(async () => { await fetch('/api/test/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); });
  await action(page, { type: 'set-clock-mode', mode: 'manual' });
  await page.reload();
  await page.waitForSelector('#connection:has-text("서버 연결됨")');
}

async function settle(page: Page) { await page.waitForTimeout(450); }

async function action(page: Page, body: unknown) {
  const response = await page.request.post(`${base}/api/test/action`, { data: body }); assert.ok(response.ok());
}
async function advance(page: Page, ms: number) {
  while (ms > 0) { const step = Math.min(ms, 60000); await action(page, { type: 'advance-clock', milliseconds: step }); ms -= step; }
  await page.waitForTimeout(650);
}
async function audience(page: Page, ids: string[]) {
  await page.click('#tool-audience');
  if (ids.length === 1) await page.click(`[data-invite="${ids[0]}"]`);
  else {
    for (const checkbox of await page.locator('.audience-choices input').all()) await checkbox.uncheck();
    for (const id of ids) await page.locator(`.audience-choices input[value="${id}"]`).check();
    await page.click('#start-meeting');
  }
  await page.waitForSelector('#panel[hidden]', { state: 'attached' });
}
async function documentScene(page: Page, id: string) {
  await advance(page, 65000); await page.click('#tool-documents');
  const state = await (await page.request.get(`${base}/api/state`)).json();
  const title = state.knowledge.documents.find((d: { id: string }) => d.id === id)?.title ?? '수군·군량 장부';
  await page.locator('.doc-item').filter({ hasText: title }).click();
  await page.waitForSelector(`[data-document="${id}"]`);
  await page.locator('.paper-body').evaluate(el => el.scrollIntoView({ block: 'center' }));
}

const SCENES: Record<string, (page: Page) => Promise<void>> = {
  S0: async () => {},
  S1: async page => { await page.click('#tool-documents'); await page.locator('.paper-body').evaluate(el => el.scrollIntoView({ block: 'center' })); await settle(page); },
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
  'audience-zhang-zhao': page => audience(page, ['zhang-zhao']),
  'audience-zhou-yu': page => audience(page, ['zhou-yu']),
  'audience-lu-su': page => audience(page, ['lu-su']),
  'meeting-two': page => audience(page, ['zhang-zhao', 'zhou-yu']),
  'meeting-three': page => audience(page, ['zhang-zhao', 'zhou-yu', 'lu-su']),
  urgent: page => advance(page, 25000),
  badge: async page => {
    await page.click('#tool-audience'); await page.click('[data-defer="zhang-zhao"]');
    await page.waitForSelector('#reply:has-text("요청이 없어")');
    await page.click('#panel-close'); await advance(page, 65000);
    await page.waitForSelector('#badge-audience:has-text("2")'); await page.click('#tool-audience');
  },
  pressure: page => advance(page, 480000),
  'document-urgent': page => documentScene(page, 'D-jingzhou'),
  'document-petition': page => documentScene(page, 'D-zhangzhao'),
  'document-report': page => documentScene(page, 'D-zhouyu'),
  'document-ledger': page => documentScene(page, 'ledger'),
  compound: async page => {
    await page.fill('#speech-input', '조조에게는 당장 확답하지 말고 시간을 벌어. 노숙은 유비에게 비밀리에 연락하고, 주유는 수군을 준비시키되 먼저 공격하지는 마.');
    await page.click('#speech-submit'); await page.waitForSelector('.draft-card');
  },
  progress: async page => { await SCENES.S5a!(page); await page.click('.draft-actions .btn-primary'); await page.waitForSelector('.task-card'); await advance(page, 10000); },
  report: async page => { await SCENES.S5b!(page); await page.locator('.task-reports button').last().click(); await page.waitForSelector('.paper'); await page.locator('.paper-body').evaluate(el => el.scrollIntoView({ block: 'center' })); },
};
if (wanted[0] === 'all') wanted.splice(0, wanted.length, ...Object.keys(SCENES));

const probe = createPortProbe(); await listenForFetch(probe);
const WEB_PORT = (probe.address() as AddressInfo).port;
await new Promise<void>(resolve => probe.close(() => resolve()));
const base = `http://127.0.0.1:${WEB_PORT}`;
const api = createGameServer(undefined, WEB_PORT);
await listenForFetch(api);
const API_PORT = (api.address() as AddressInfo).port;
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
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${base}/?start=court`);
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
      assert.deepEqual(errors, [], `${scene}: browser errors`);
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
    m.minTextContrast < 4.5 && `본문 대비 ${m.minTextContrast} < 4.5`,
  ].filter(Boolean);
  if (problems.length) failed = true;
  console.log(`${m.scene.padEnd(4)} ${m.size.padEnd(10)} HUD ${m.hudCoverage}% / panel ${m.panelCoverage}% / screen ${m.screenCoverage}%  ${problems.length ? '✖ ' + problems.join(' / ') : '✔'}`);
}
console.log(`스크린샷: ${relative(process.cwd(), fileURLToPath(outDir)).replaceAll('\\', '/')}`);
process.exitCode = failed ? 1 : 0;
