import './offline-runtime.ts';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer as portProbe } from 'node:net';
import { chromium } from 'playwright-core';
import type { Page } from 'playwright-core';
import { createServer } from 'vite';
import { createGameServer } from '../server/http.ts';
import { listenForFetch } from './test-server.ts';
import { main as evaluate } from './eval/run.ts';
import { main as compare } from './eval/compare.ts';

const output = 'artifacts/ollama'; await mkdir(output, { recursive: true });
const temp = await mkdtemp(join(tmpdir(), 'throne-ollama-ui-'));
const usageFile = join(temp, 'usage.json');
const probe = portProbe(), webPort = await listenForFetch(probe); await new Promise<void>(resolve => probe.close(() => resolve()));
let calls = 0, tags = 0, failed = false;
const proposal = { intent: 'question', dialogue: '판단을 도와드리겠습니다.', proposedActions: [], unresolvedQuestions: [], referencedKnowledgeIds: [],
  usage: { inputTokens: 0, outputTokens: 0, externalCalls: 0, costUsd: null } };
const api = createGameServer(undefined, webPort, { env: {}, budgetFile: usageFile, readSystemProxy: () => { throw new Error('NO_REGISTRY'); }, transport: async (url, init) => {
  assert.match(String(url), /^http:\/\/127\.0\.0\.1:11434\/api\/(tags|chat)$/);
  assert.ok((init as RequestInit & { dispatcher: unknown }).dispatcher);
  if (String(url).endsWith('/tags')) { tags++; return Response.json({ models: [{ name: 'qwen3:4b' }, { name: 'org/larger:8b' }] }); }
  calls++; if (failed) throw new TypeError('synthetic-private-message', { cause: { code: 'ECONNREFUSED' } });
  const body = JSON.parse(String(init?.body)), test = body.options.num_predict === 256;
  return Response.json({ message: { role: 'assistant', content: JSON.stringify(test ? { ok: true } : proposal), thinking: 'synthetic-private-thought' }, done: true, done_reason: 'stop', prompt_eval_count: 23, eval_count: 11 });
} });
const apiPort = await listenForFetch(api), base = `http://127.0.0.1:${webPort}`;
const vite = await createServer({ logLevel: 'error', server: { port: webPort, strictPort: true, proxy: { '/api': `http://127.0.0.1:${apiPort}` } } }); await vite.listen();
const browser = await chromium.launch({ channel: 'msedge' }), evidence: unknown[] = [];
async function capture(page: Page, scene: string, size: string) {
  const layout = await page.evaluate(() => {
    const section = document.querySelector<HTMLElement>('[data-start-page="settings"]')!, card = section.getBoundingClientRect();
    const elements = [...section.querySelectorAll<HTMLElement>('button, input, select, p, label, h1, h2')].filter(el => el.getClientRects().length);
    return { cardFits: card.top >= 0 && card.bottom <= innerHeight,
      pageScroll: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
      minFont: Math.min(...elements.map(el => parseFloat(getComputedStyle(el).fontSize))),
      contentFits: elements.every(el => { const r = el.getBoundingClientRect(); return r.top >= card.top && r.bottom <= card.bottom && r.left >= card.left && r.right <= card.right; }),
      controls: elements.filter(el => el.matches('button, input, select')).map(el => {
        const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { id: el.id, unblocked: el === hit || el.contains(hit), visible: r.top >= 0 && r.bottom <= innerHeight };
      }) };
  });
  await page.screenshot({ path: `${output}/${scene}-${size}.png` });
  assert.equal(layout.cardFits, true, JSON.stringify(layout)); assert.equal(layout.pageScroll, false);
  assert.equal(layout.contentFits, true, JSON.stringify(layout)); assert.ok(layout.minFont >= 16);
  assert.ok(layout.controls.every(control => control.unblocked && control.visible), JSON.stringify(layout));
  assert.ok(!(await page.content()).includes('synthetic-private-'));
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  evidence.push({ scene, size, ...layout });
}
try {
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
    const size = `${viewport.width}x${viewport.height}`, page = await browser.newPage({ viewport });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => { errors.push('Unexpected dialog'); void dialog.dismiss(); });
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    failed = false;
    // Begin each viewport on Gemini; this is configuration only, never a Gemini call.
    await page.request.post(base + '/api/llm/settings', { data: { model: 'offline-model', key: '', limit: 0 } });
    await page.goto(base); await page.locator('#start-mock:not([disabled])').waitFor(); await page.click('#open-settings');
    await capture(page, 'gemini-settings', size);
    const before = calls + tags;
    await page.selectOption('#ai-provider', 'ollama'); assert.equal(calls + tags, before);
    assert.equal(await page.locator('#ai-key').isVisible(), false); assert.equal(await page.locator('#ai-network').isVisible(), false);
    assert.equal(await page.inputValue('#ollama-base'), 'http://127.0.0.1:11434');
    await page.click('#load-models'); await page.locator('#load-models:not([disabled])').waitFor();
    assert.equal(tags + calls, before + 1); await page.selectOption('#ollama-models', 'qwen3:4b');
    assert.equal(await page.inputValue('#ai-model'), 'qwen3:4b'); assert.equal(await page.locator('#start-ai').isEnabled(), true);
    await page.click('#save-settings'); await page.locator('#save-settings:not([disabled])').waitFor();
    const check = async () => { const first = calls; await page.click('#test-connection'); await page.locator('#test-connection:not([disabled])').waitFor(); assert.equal(calls, first + 1); };
    await check(); assert.equal(await page.locator('#test-result').innerText(), '정상'); await capture(page, 'ollama-settings', size);
    failed = true; await check(); assert.match(await page.locator('#test-result').innerText(), /Ollama 미실행/); await capture(page, 'ollama-refused', size);
    failed = false; await check();
    const status = await (await page.request.get(base + '/api/llm/status')).json(); assert.equal(status.keyConfigured, false); assert.equal(status.minuteCalls, 0); assert.equal(status.sessionCalls, 0);
    await page.click('#start-ai'); await page.locator('#connection:has-text("서버 연결됨")').waitFor();
    assert.equal((await (await page.request.get(base + '/api/state')).json()).mode, 'ai');
    const command = await page.request.post(base + '/api/command', { data: { type: 'submit', text: '항복하면 어떻게 돼?' } });
    assert.equal(command.status(), 200); assert.equal((await command.json()).outcome.kind, 'answer');
    await page.reload(); await page.locator('#start-mock:not([disabled])').waitFor();
    await page.click('#start-mock'); await page.locator('#connection:has-text("서버 연결됨")').waitFor();
    assert.equal((await (await page.request.get(base + '/api/state')).json()).mode, 'mock');
    assert.deepEqual(errors, []); await page.close();
  }
  await assert.rejects(readFile(usageFile), { code: 'ENOENT' });
  const diagnostics = await readFile(join(temp, 'llm-diagnostics.jsonl'), 'utf8'); assert.ok(!diagnostics.includes('synthetic-private-'));
  await writeFile(`${output}/screenshots.json`, JSON.stringify({ externalCalls: 0, realOllamaCalls: 0, fakeChatCalls: calls, fakeTagCalls: tags, evidence }, null, 2) + '\n');
  // Persist reviewable comparison evidence using the same 80 fixtures and fake native envelopes.
  const good = JSON.parse(await readFile('tests/fixtures/eval-scripted-good.json', 'utf8'));
  const directories: string[] = [];
  for (const [index, model] of ['qwen3:4b', 'org/larger:8b'].entries()) {
    let at = 0;
    const root = `${output}/fake-eval-${index}`;
    await mkdir(root, { recursive: true });
    const fixtures = await import('./eval/fixtures.ts').then(m => m.loadCases('dev'));
    const exit = await evaluate(['--provider', 'ollama', '--split', 'dev'], { env: { OLLAMA_MODEL_ID: model }, outputRoot: root, log: () => {}, live: {
      transport: async () => Response.json({ message: { role: 'assistant', content: JSON.stringify(good.responses[fixtures[at++]!.id]) }, done: true, done_reason: 'stop', prompt_eval_count: 31, eval_count: 17 }),
    } });
    assert.equal(exit, 0); assert.equal(at, 80);
    const entries = (await readdir(root)).sort(); directories.push(join(root, entries.at(-1)!));
  }
  await compare([...directories, '--out', `${output}/comparison.md`]);
  await writeFile(`${output}/offline-runs.json`, JSON.stringify({ realOllamaCalls: 0, externalCalls: 0, cases: 80, directories }, null, 2) + '\n');
  console.log('PASS Ollama: 2 resolutions, Gemini/Ollama settings, model tags, keyless AI, one-shot test, refusal, Mock, fake dev80 x2 and comparison');
} finally { await browser.close(); await vite.close(); api.closeAllConnections(); await new Promise<void>(resolve => api.close(() => resolve())); await rm(temp, { recursive: true, force: true }); }
