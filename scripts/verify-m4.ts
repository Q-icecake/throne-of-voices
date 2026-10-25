import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { createGameServer } from '../server/http.ts';
import { GameEngine } from '../server/engine.ts';
import type { PlayerView } from '../shared/contracts.ts';

const output = 'artifacts/m4';
const api = createGameServer(new GameEngine(), 5280);
api.listen(3110, '127.0.0.1'); await once(api, 'listening');
const vite = await createServer({ logLevel: 'error', server: { port: 5280, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3110' } } });
await vite.listen();
let browser;
const checks: { size: string; check: string }[] = [];
try {
  browser = await chromium.launch({ channel: 'msedge' });
  await mkdir(output, { recursive: true });
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
    const page = await browser.newPage({ viewport });
    const size = `${viewport.width}x${viewport.height}`;
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    const pass = (check: string) => { checks.push({ size, check }); console.log(`${size}: ${check}`); };
    const state = async (): Promise<PlayerView> => (await page.request.get('http://127.0.0.1:5280/api/state')).json();
    const settle = async () => { await page.waitForSelector('#speech-submit:not([disabled]), #speech-input:placeholder-shown'); await page.waitForTimeout(400); };
    const send = async (text: string) => {
      await page.fill('#speech-input', text); await page.click('#speech-submit');
      await page.waitForFunction(() => (document.querySelector('#speech-input') as HTMLTextAreaElement).value === '');
      await settle();
    };
    const layout = async () => assert.ok(await page.evaluate(() => {
      const root = document.scrollingElement!;
      if (root.scrollWidth > innerWidth + 1 || root.scrollHeight > innerHeight + 1) return false;
      return ['#speech-input', '#speech-submit', '#tool-audience', '#panel-close'].every(sel => {
        const e = document.querySelector<HTMLElement>(sel)!;
        if (e.closest('[hidden]')) return true;
        const r = e.getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && e.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
      });
    }), 'input and controls must be visible and unobstructed');
    await page.request.post('http://127.0.0.1:5280/api/test/reset', { data: {} });
    await page.goto('http://127.0.0.1:5280'); await page.waitForSelector('#connection:has-text("서버 연결됨")');
    for (const [id, name, reason] of [['zhang-hong', '장굉', '원문'], ['zhang-zhao', '장조', '정치적'], ['zhou-yu', '주유', '전투력'], ['lu-su', '노숙', '노출']]) {
      await page.click('#tool-audience'); await page.click(`[data-invite="${id}"]`);
      await page.waitForSelector('#panel[hidden]', { state: 'attached' });
      assert.equal((await state()).audience.participants[0], id);
      await send('전쟁에 대해 어떻게 생각하는가?');
      assert.match(await page.locator('#reply').innerText(), new RegExp(reason!));
      assert.match(await page.locator('#zhang-hong-tag').innerText(), new RegExp(name!));
      assert.equal(await page.locator('#stage').getAttribute('data-scene'), 'S2');
      const draft = `${name}에게 쓰던 문장을 보존한다`;
      await page.fill('#speech-input', draft);
      await page.click('#tool-documents'); await layout();
      assert.equal(await page.locator('#speech-input').inputValue(), draft);
      await page.click('#panel-close');
      await page.click('#tool-map'); await layout();
      assert.equal(await page.locator('#speech-input').inputValue(), draft);
      await page.click('#panel-close'); await settle();
      await layout();
      await page.screenshot({ path: `${output}/audience-${id}-${size}.png`, animations: 'disabled' });
      await page.fill('#speech-input', '');
      pass(`${name}: grounded reply, S2, input survives document/map, controls visible`);
    }
    await send('m0-public-note 문서를 설명해');
    assert.match(await page.locator('#reply').innerText(), /공유되지/);
    await page.click('#tool-documents');
    await page.locator('.doc-item').filter({ hasText: '시험용 집무 기록' }).click();
    await page.locator('[data-share="lu-su"]').click(); await page.waitForSelector('#reply:has-text("보여 주었습니다")');
    await page.click('#panel-close'); await send('m0-public-note 문서를 설명해');
    assert.match(await page.locator('#reply').innerText(), /원문 일부/);
    pass('document read and explicit share have different knowledge outcomes');

    await page.click('#tool-audience');
    await page.getByLabel('노숙 회의 참석').uncheck();
    await page.getByLabel('장조 회의 참석').check(); await page.getByLabel('주유 회의 참석').check();
    await page.click('#start-meeting'); await page.waitForSelector('#panel[hidden]', { state: 'attached' });
    await send('둘이 논의해 봐');
    const meeting = await state();
    assert.deepEqual(meeting.audience.participants, ['zhang-zhao', 'zhou-yu']);
    assert.equal(meeting.conversation.slice(-3).filter(t => t.speaker !== 'player').length, 2);
    assert.match(await page.locator('#reply').innerText(), /장조:.*\n주유:/s);
    assert.equal(await page.locator('#stage').getAttribute('data-scene'), 'S3');
    assert.equal(await page.locator('.meeting-figure').count(), 1);
    await page.fill('#speech-input', '다음 판단은 내가 한다'); await layout();
    assert.equal(await page.locator('#speech-submit').isEnabled(), true);
    await page.screenshot({ path: `${output}/meeting-${size}.png`, animations: 'disabled' });
    await page.waitForTimeout(700); assert.equal((await state()).conversation.length, meeting.conversation.length);
    pass('two-person S3, bounded answer/counter, player input restored, no automatic debate');
    await page.click('#tool-record');
    await page.waitForSelector('#panel[data-kind="record"]:not([hidden])');
    assert.match(await page.locator('#panel-body').innerText(), /장굉:|원문/);
    assert.match(await page.locator('#panel-body').innerText(), /노숙:|노출/);
    assert.equal(await page.locator('#speech-input').inputValue(), '다음 판단은 내가 한다');
    await layout(); await page.click('#panel-close');
    pass('full conversation available in record panel, input retained');
    await page.click('#tool-audience'); await page.click('[data-dismiss="zhou-yu"]');
    await page.waitForSelector('[data-dismiss="zhou-yu"]', { state: 'detached' });
    assert.deepEqual((await state()).audience.participants, ['zhang-zhao']);
    await page.click('[data-defer="zhang-zhao"]'); await page.waitForSelector('#reply:has-text("미룸")');
    assert.equal((await state()).audience.participants.length, 0);
    assert.equal(await page.locator('.character-art').isVisible(), false);
    await page.click('#panel-close');
    await page.fill('#speech-input', '접견 없이 보낸 문장도 보존한다'); await page.click('#speech-submit');
    await page.waitForSelector('#reply:has-text("먼저 해당 인물을")');
    assert.equal(await page.locator('#speech-input').inputValue(), '접견 없이 보낸 문장도 보존한다');
    await page.click('#tool-audience');
    await page.click('[data-invite="zhou-yu"]'); await page.waitForSelector('#panel[hidden]', { state: 'attached' });
    await send('주유는 수군을 정비하되 먼저 공격하지 마.');
    assert.equal((await state()).tasks.length, 0);
    await page.locator('.draft-actions .btn-primary').click(); await page.waitForSelector('.task-card');
    await page.click('#tool-audience');
    assert.equal(await page.locator('[data-invite="zhou-yu"]').isDisabled(), true);
    assert.match(await page.locator('.audience-person').filter({ hasText: '주유' }).innerText(), /임무 중/);
    pass('dismiss/defer, command confirmation, busy audience visibly disabled');
    assert.deepEqual(errors, []); await page.close();
  }
  await writeFile(`${output}/character-browser-checks.json`, JSON.stringify({ browser: 'installed Edge', externalCalls: 0, checks }, null, 2));
} finally { await browser?.close(); await vite.close(); await new Promise<void>(resolve => api.close(() => resolve())); }
