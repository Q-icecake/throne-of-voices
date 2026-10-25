import './offline-runtime.ts';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const output = 'artifacts/m6/comparison'; await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const comparisons: { stage: string; size: string; old: string; current: string; sameScenario: boolean; note: string }[] = [];
const geometry: unknown[] = [];
try {
  for (const stage of ['m1-fixes', 'm3', 'm4', 'm5']) for (const size of ['1920x1080', '1366x768']) {
    const pairs: [string, string, boolean][] = [];
    for (const scene of ['s0', 's1', 's2', 's4', 's5a', 's5b']) {
      pairs.push([`artifacts/${stage}/${stage === 'm1-fixes' ? '' : 'scenes/'}${scene}-${size}.png`, `artifacts/m6/scenes/${scene}-${size}.png`, true]);
    }
    if (stage === 'm3') pairs.push([`artifacts/m3/compound-draft-${size}.png`, `artifacts/m6/scenes/compound-${size}.png`, true]);
    if (stage === 'm4') {
      for (const id of ['zhang-zhao', 'zhou-yu', 'lu-su']) pairs.push([`artifacts/m4/audience-${id}-${size}.png`, `artifacts/m6/m4/audience-${id}-${size}.png`, true]);
      pairs.push([`artifacts/m4/meeting-${size}.png`, `artifacts/m6/m4/meeting-${size}.png`, true]);
    }
    if (stage === 'm5') for (const name of ['after-dispatch', 'audience-requests', 'pressure', 'compound-draft', 'follow-up'])
      pairs.push([`artifacts/m5/browser/${name}-${size}.png`, `artifacts/m6/m5/${name}-${size}.png`, true]);
    for (const [old, current, sameScenario] of pairs) {
      assert.ok(existsSync(old), `missing baseline ${old}`); assert.ok(existsSync(current), `missing current ${current}`);
      comparisons.push({ stage, size, old, current, sameScenario, note: 'side-by-side visual inspection required; text/time may differ, no automatic art-quality verdict' });
    }
    const htmlPath = `${output}/${stage}-${size}.html`;
    const image = (path: string) => relative(dirname(resolve(htmlPath)), resolve(path)).replaceAll('\\', '/');
    await writeFile(htmlPath, `<!doctype html><meta charset="utf-8"><title>${stage} vs M6 ${size}</title><style>body{margin:0;background:#eee;color:#111;font:16px sans-serif}h1{font-size:20px;margin:12px}section{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:8px;border-top:2px solid #777}figure{margin:0}img{width:100%;display:block}figcaption{height:26px;font-size:13px}</style><h1>${stage} (left) / M6 (right) · ${size} · human visual review</h1>` + pairs.map(([old, current]) => `<section><figure><figcaption>${old}</figcaption><img src="${image(old)}"></figure><figure><figcaption>${current}</figcaption><img src="${image(current)}"></figure></section>`).join(''));
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(resolve(htmlPath)).href);
    await page.locator('img').evaluateAll(images => Promise.all(images.map(img => (img as HTMLImageElement).decode())));
    await page.screenshot({ path: `${output}/${stage}-${size}.png`, fullPage: true }); await page.close();
    const oldMetrics = JSON.parse(await readFile(`artifacts/${stage}/${stage === 'm1-fixes' ? '' : 'scenes/'}metrics.json`, 'utf8')) as { scene: string; size: string; screenCoverage: number; minReadingFontPx: number }[];
    const currentMetrics = JSON.parse(await readFile('artifacts/m6/scenes/metrics.json', 'utf8')) as typeof oldMetrics;
    for (const old of oldMetrics.filter(m => m.size === size)) {
      const current = currentMetrics.find(m => m.size === size && m.scene === old.scene); assert.ok(current);
      geometry.push({ stage, size, scene: old.scene, previousCoverage: old.screenCoverage, currentCoverage: current.screenCoverage, deltaPercentagePoints: Math.round((current.screenCoverage - old.screenCoverage) * 10) / 10, previousMinFont: old.minReadingFontPx, currentMinFont: current.minReadingFontPx });
    }
  }
  await writeFile(`${output}/comparisons.json`, JSON.stringify({ comparisons, geometry, judgment: 'manual inspection recorded in docs/QA_MATRIX.md; geometry and screenshots do not measure fun or art quality' }, null, 2) + '\n');
  console.log(`PASS ${comparisons.length} side-by-side pairs, 8 contact sheets; prior/current geometry recorded`);
} finally { await browser.close(); }
