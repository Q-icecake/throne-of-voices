import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { GameEngine } from '../server/engine.ts';
import { createGameServer } from '../server/http.ts';
import { OpenAICompatibleProvider } from '../server/llm/openai-compatible.ts';
import { CallBudget } from '../server/llm/budget.ts';
import { npcSettings } from '../server/llm/context-policy.ts';
import { ProviderError } from '../server/llm/types.ts';
import type { ProviderInput, ProviderErrorCode } from '../server/llm/types.ts';

const output = 'artifacts/npc-status';
await mkdir(output, { recursive: true });
let fault: ProviderErrorCode | 'good' | 'partial' | 'order' = 'good';
const captured: ProviderInput[] = [];
const config = { model: 'offline-fixture', baseUrl: 'http://127.0.0.1:9/v1', timeoutMs: 150, retries: 0, dailyLimit: 10000, sessionLimit: 10000 };
class FixtureBudget extends CallBudget {
  override reserve() { if (fault === 'budget') throw new ProviderError('budget'); }
}
const transport: typeof fetch = async (_url, init) => {
  const body = JSON.parse(String(init!.body));
  const input: ProviderInput = JSON.parse(body.messages[1].content);
  captured.push(input);
  if (fault === 'timeout') return new Promise((_resolve, reject) => {
    init!.signal!.addEventListener('abort', () => reject(new ProviderError('timeout')), { once: true });
  });
  const status = { rate_limited: 429, auth: 401, server: 503 }[fault as string];
  if (status) return new Response(null, { status });
  if (fault === 'schema') return Response.json({ choices: [] });
  const text = '근거를 먼저 살펴야 합니다. 제 의견과 사실을 구분하겠습니다.';
  const protocol = input.context.find(turn => turn.text.includes('npc-meeting-v1'));
  const projections = protocol ? JSON.parse(protocol.text).projections as ProviderInput[] : undefined;
  const dialogue = projections ? JSON.stringify({ speeches: projections.map((projection, index) => ({
    id: projection.character!.id, text,
    referencedKnowledgeIds: fault === 'partial' && index === 1 ? ['card-lu-su'] : [`card-${projection.character!.id}`],
  })) }) : text;
  return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
    intent: fault === 'order' ? 'command' : 'discussion', dialogue,
    proposedActions: fault === 'order' ? [{ kind: 'naval-drill', target: 'jiangdong-navy', assignee: 'zhou-yu', conditions: [], restrictions: [], deadline: null }] : [],
    unresolvedQuestions: [], referencedKnowledgeIds: [],
  }) } }], usage: { prompt_tokens: 123, completion_tokens: 45 } });
};
// Explicit synthetic credential and in-memory reservation: no process keys or external transport.
const provider = new OpenAICompatibleProvider(config, transport, new FixtureBudget(config), 'synthetic-P9qR7sT3uV6wX2yZ');
const engine = new GameEngine(undefined, undefined, provider, 200, provider.status, { mode: 'manual' }, { ...npcSettings({}), meeting: true });
const api = createGameServer(engine, 5286);
const vite = await createServer({ logLevel: 'error', server: { port: 5286, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3116' } } });
const checks: { size: string; mode: string; code: string; passed: true }[] = [];
let browser;
try {
  api.listen(3116, '127.0.0.1'); await once(api, 'listening');
  await vite.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
    const size = `${viewport.width}x${viewport.height}`;
    const page = await browser.newPage({ viewport });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      assert.ok(route.request().url().startsWith('http://127.0.0.1:5286/'), 'external browser requests forbidden');
      return route.continue();
    });
    for (const mode of ['solo', 'meeting']) {
      fault = 'good'; engine.reset();
      engine.audience({ type: 'invite', participants: mode === 'solo' ? ['zhang-hong'] : ['zhang-hong', 'zhou-yu', 'zhang-zhao'] });
      fault = 'order';
      const draft = await engine.command({ type: 'submit', text: '주유는 수군을 정비해.' });
      assert.equal(draft.outcome.kind, 'draft');
      fault = 'good';
      await page.goto('http://127.0.0.1:5286');
      await page.waitForSelector('#connection:has-text("서버 연결됨")');
      await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('#refresh')!.disabled);
      await page.locator('#hotspot-zhang-hong').click();
      await page.locator('#tool-command').click();
      await page.waitForTimeout(500); // existing camera transition must settle before comparing geometry
      const geometry = () => page.evaluate(() => ['.layer-back', '.layer-mid', '#speech-input', '.hud-tools'].map(selector => {
        const rect = document.querySelector(selector)!.getBoundingClientRect();
        return { selector, x: rect.x, width: rect.width, height: rect.height };
      }));
      const original = await geometry();
      for (const code of ['timeout', 'rate_limited', 'auth', 'schema', 'server', 'budget', ...(mode === 'meeting' ? ['partial'] : [])] as const) {
        fault = code as typeof fault;
        const text = '전쟁에 대한 의견은?';
        const drafts = structuredClone(engine.view().drafts);
        const calls = captured.length;
        await page.locator('#speech-input').fill(text);
        await page.locator('#speech-submit').click();
        await page.waitForSelector('#error:not([hidden])');
        await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('#speech-submit')!.disabled);
        const expected = code === 'partial' ? 'schema' : code;
        assert.match(await page.locator('#interpretation-status').innerText(), new RegExp(`\\[${expected}\\]`));
        assert.match(await page.locator('#error').innerText(), new RegExp(`\\[${expected}\\]`));
        assert.equal(await page.locator('#speech-input').inputValue(), text);
        assert.deepEqual(engine.view().drafts, drafts);
        assert.equal(engine.view().drafts.length, 1, 'pending draft survives NPC errors');
        assert.equal(captured.length - calls, code === 'budget' ? 0 : 1, 'at most one transport attempt');
        assert.ok(!engine.view().clock.pauseReasons.includes('provider'));
        if (mode === 'meeting') assert.match(await page.locator('#reply').innerText(), /주유: \[작성 대사\]/, 'identify the replaced speaker in the existing reply text');
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        assert.deepEqual(await geometry(), original, 'art, input and toolbar dimensions remain unchanged');
        const readable = await page.evaluate(() => {
          const panel = document.querySelector('#panel')!.getBoundingClientRect();
          const speech = document.querySelector('#speech')!.getBoundingClientRect();
          if (panel.bottom > speech.top) return false;
          const selectors = ['#interpretation-status', '#error', '#speech-input', '#speech-submit'];
          return selectors.every(selector => {
            const el = document.querySelector<HTMLElement>(selector)!;
            const rect = el.getBoundingClientRect();
            const center = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
            return rect.x >= 0 && rect.y >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight &&
              (center === el || el.contains(center)) && el.scrollWidth <= el.clientWidth + 1 &&
              Number.parseFloat(getComputedStyle(el).fontSize) >= (selector === '#interpretation-status' ? 12 : 14);
          });
        });
        assert.ok(readable, `${size} ${mode} ${code}: chip/error/input must be readable and unobscured`);
        await page.screenshot({ path: `${output}/${mode}-${code}-${size}.png`, animations: 'disabled' });
        await page.locator('#speech-input').fill('');
        await page.waitForFunction(async () => {
          const state = await (await fetch('/api/state')).json();
          return !state.clock.pauseReasons.includes('typing') && !state.clock.pauseReasons.includes('provider');
        });
        checks.push({ size, mode, code, passed: true });
      }
      fault = 'good';
      await page.locator('#speech-input').fill('현재 의견은?');
      await page.locator('#speech-submit').click();
      await page.waitForFunction(() => document.querySelector<HTMLTextAreaElement>('#speech-input')!.value === '');
      assert.ok(await page.locator('#error').isHidden());
      assert.ok(!(await page.locator('#interpretation-status').innerText()).includes('[schema]'));
      const usage = engine.npcUsage().at(-1)!;
      assert.equal(usage.inputTokens, 123); assert.equal(usage.outputTokens, 45); assert.equal(usage.externalCalls, 1);
      checks.push({ size, mode, code: 'retry-success-and-usage', passed: true });
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  await writeFile(`${output}/browser-checks.json`, JSON.stringify({ browser: 'installed Microsoft Edge', version: browser.version(), externalCalls: 0, fakeTransportAttempts: captured.length, checks, usage: engine.npcUsage() }, null, 2) + '\n');
  console.log(`PASS NPC status ${checks.length}/${checks.length}; two viewports, fake transport, external calls 0`);
} finally {
  await browser?.close(); await vite.close(); api.closeAllConnections();
  if (api.listening) await new Promise<void>(resolve => api.close(() => resolve()));
}
