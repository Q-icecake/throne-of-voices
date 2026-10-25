import './offline-runtime.ts';
import { listenForFetch } from './test-server.ts';
import assert from 'node:assert/strict';
import { createServer as createPortProbe } from 'node:net';
import type { AddressInfo } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { GameEngine } from '../server/engine.ts';
import { createGameServer } from '../server/http.ts';
import { ScriptedProvider } from '../tests/fixtures/scripted-provider.ts';
import type { Proposal } from '../server/llm/types.ts';
import { ProviderError } from '../server/llm/types.ts';

const outIndex = process.argv.indexOf('--out');
const output = outIndex >= 0 ? process.argv[outIndex + 1]! : 'artifacts/m2';
const order: Proposal = { intent: 'command', dialogue: '모델이 완료했다고 해도 실행되지 않습니다.', proposedActions: [
  { kind: 'naval-drill', target: 'jiangdong-navy', assignee: 'zhou-yu', conditions: [], restrictions: [], deadline: null }],
  unresolvedQuestions: [], referencedKnowledgeIds: [], usage: { inputTokens: 0, outputTokens: 0, externalCalls: 0, costUsd: null } };
const perViewport = () => [
  new Error('OFFLINE_PRIVATE_ERROR'), order,
  { ...order, intent: 'ambiguous', proposedActions: [], unresolvedQuestions: ['대상을 다시 알려 주시겠습니까?'] },
  () => new Promise(() => {}), order,
  { ...order, intent: 'question', proposedActions: [], dialogue: '장부에 기록된 정보만으로 판단해야 합니다. '.repeat(40) },
  new ProviderError('truncated'), new ProviderError('request'), new ProviderError('pacing'),
  Object.assign(new ProviderError('rate_limited'), { retryAfterSeconds: 8 }),
  order,
];
const provider = new ScriptedProvider(...perViewport(), ...perViewport());
const engine = new GameEngine(undefined, undefined, provider, 100);
const probe = createPortProbe(); await listenForFetch(probe);
const webPort = (probe.address() as AddressInfo).port;
await new Promise<void>(resolve => probe.close(() => resolve()));
const base = `http://127.0.0.1:${webPort}`;
const api = createGameServer(engine, webPort);
await listenForFetch(api);
const apiPort = (api.address() as AddressInfo).port;
const vite = await createServer({ logLevel: 'error', server: { port: webPort, strictPort: true, proxy: { '/api': `http://127.0.0.1:${apiPort}` } } });
const checks: { size: string; check: string }[] = [];
let browser;
try {
  await vite.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  await mkdir(output, { recursive: true });
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
    engine.reset();
    const size = `${viewport.width}x${viewport.height}`;
    const page = await browser.newPage({ viewport });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const readable = async () => {
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      assert.ok(await page.evaluate(() => {
        const speech = document.querySelector('#speech')!.getBoundingClientRect();
        const panel = document.querySelector<HTMLElement>('#panel')!;
        return speech.top >= 0 && speech.bottom <= innerHeight && (panel.hidden || panel.getBoundingClientRect().bottom <= speech.top);
      }), 'AI speech/error and command panel must not overlap or leave the viewport');
    };
    await page.route('**/*', route => {
      if (!route.request().url().startsWith(`${base}/`)) throw new Error('External browser request forbidden');
      return route.continue();
    });
    await page.goto(`${base}/?start=court`);
    await page.waitForSelector('#connection:has-text("서버 연결됨")');
    assert.match(await page.locator('#interpretation-status').innerText(), /AI.*시험 응답/);
    const text = '공근더러 우리 배와 뱃사람들의 채비를 갖추도록 일러라.';
    await page.fill('#speech-input', text);
    await page.click('#speech-submit');
    await page.waitForSelector('#error:not([hidden])');
    assert.equal(await page.inputValue('#speech-input'), text);
    assert.match(await page.locator('#error').innerText(), /보존/);
    assert.equal(engine.view().drafts.length, 0);
    assert.equal(await page.locator('#reply').isHidden(), true);
    await readable();
    await page.screenshot({ path: `${output}/ai-error-${size}.png` });
    checks.push({ size, check: 'AI error keeps input, source and world; retry remains enabled' });
    await page.click('#speech-submit');
    await page.waitForSelector('.draft-card');
    assert.equal(await page.inputValue('#speech-input'), '');
    assert.equal(engine.view().tasks.length, 0);
    assert.ok(!(await page.locator('#reply').innerText()).includes('모델이 완료'));
    checks.push({ size, check: 'retry creates only a draft; completion claim is not rendered' });
    await page.getByRole('button', { name: '수정', exact: true }).click();
    const editor = page.locator('.revise textarea');
    await editor.fill('그 사람에게 맡겨.');
    await page.getByRole('button', { name: '수정 반영', exact: true }).click();
    await page.waitForSelector('#reply:has-text("대상을 다시")');
    assert.equal(await editor.inputValue(), '그 사람에게 맡겨.');
    assert.equal(engine.view().drafts[0]!.version, 1);
    await readable();
    checks.push({ size, check: 'ambiguous revision asks only missing information and preserves draft/editor' });
    // Re-render restores an open revision editor; submit it again to exercise a timeout.
    await page.getByRole('button', { name: '수정 반영', exact: true }).click();
    await page.waitForSelector('#error:has-text("응답 시간이 초과")');
    assert.equal(await editor.inputValue(), '그 사람에게 맡겨.');
    assert.equal(engine.view().drafts[0]!.version, 1);
    await readable();
    await page.screenshot({ path: `${output}/ai-timeout-${size}.png` });
    checks.push({ size, check: 'timeout keeps revision text and version; no Mock fallback' });
    await editor.fill('수군을 정비하라.');
    await page.getByRole('button', { name: '수정 반영', exact: true }).click();
    await page.waitForSelector('.version:has-text("버전 2")');
    await page.getByRole('button', { name: '초안 취소', exact: true }).click();
    await page.waitForSelector('.closed-drafts');
    assert.equal(engine.view().tasks.length, 0);
    assert.equal(engine.view().drafts[0]!.status, 'cancelled');
    checks.push({ size, check: 'revision retry and cancellation remain usable' });
    await page.fill('#speech-input', '보고 내용을 설명해 줘.');
    await page.click('#speech-submit');
    await page.waitForSelector('#reply:has-text("장부에 기록된")');
    await readable();
    assert.ok(await page.locator('#reply').evaluate(el => el.scrollHeight > el.clientHeight));
    await page.screenshot({ path: `${output}/ai-long-answer-${size}.png` });
    checks.push({ size, check: 'long AI answer scrolls within its own region and never overlaps command panel' });
    for (const [code, label] of [['truncated', '응답이 잘림'], ['request', '요청 형식 거부(400)'], ['pacing', '분당 호출 한도에 가까워'], ['rate_limited', 'Google 분당 한도(429): 8초']] as const) {
      const before = JSON.stringify({ tasks: engine.view().tasks, drafts: engine.view().drafts });
      await page.fill('#speech-input', text); await page.click('#speech-submit');
      await page.locator('#error:not([hidden])').filter({ hasText: label }).waitFor();
      assert.equal(await page.inputValue('#speech-input'), text);
      assert.equal(JSON.stringify({ tasks: engine.view().tasks, drafts: engine.view().drafts }), before);
      await readable(); await page.screenshot({ path: `${output}/ai-${code}-${size}.png` });
      checks.push({ size, check: `${code}: readable game error, preserved input and world` });
    }
    await page.click('#speech-submit'); await page.waitForSelector('.draft-card');
    assert.match(await page.locator('#interpretation-status').innerText(), /AI.*시험 응답/);
    assert.equal(await page.inputValue('#speech-input'), '');
    checks.push({ size, check: 'manual retry after classified errors restores AI success status' });
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally {
  await browser?.close(); await vite.close();
  api.closeAllConnections();
  if (api.listening) await new Promise<void>(resolve => api.close(() => resolve()));
}
await writeFile(`${output}/llm-browser-checks.json`, JSON.stringify(checks, null, 2) + '\n');
console.log(`M2 AI 화면 검사 ${checks.length}/${checks.length} 통과 (ScriptedProvider, 외부 호출 0회)`);
