import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RuntimeSettings } from '../server/llm/runtime-settings.ts';
import { SecretGuard } from '../server/llm/secrets.ts';
import type { ConnectionTestResult } from '../shared/contracts.ts';

const fakeKey = 'synthetic-Z7x9P4m2N6q8R3t5';
const good = () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'OK' }] } }] });
async function fixture(t: TestContext, transport: typeof fetch, timeoutMs = 35) {
  const dir = await mkdtemp(join(tmpdir(), 'throne-start-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const budgetFile = join(dir, 'usage.json');
  const runtime = new RuntimeSettings({ env: {}, transport, budgetFile, timeoutMs });
  runtime.configure('offline-model', fakeKey, 30);
  return { runtime, budgetFile };
}

for (const [code, expected] of [[200, 'ok'], [401, 'auth'], [403, 'auth'], [404, 'model'], [429, 'rate_limited'], [400, 'schema'], [500, 'server'], [503, 'server']] as const) {
  test(`start connection test classifies ${code} as ${expected}, never leaks upstream errors`, async t => {
    let calls = 0;
    const { runtime, budgetFile } = await fixture(t, async (url, init) => {
      calls++; assert.match(String(url), /\/offline-model:generateContent$/);
      assert.equal(new Headers(init?.headers).get('x-goog-api-key'), fakeKey);
      assert.equal(init?.redirect, 'error');
      const body = JSON.parse(String(init?.body));
      assert.equal(body.generationConfig.maxOutputTokens, 8);
      assert.equal(body.contents[0].parts[0].text, 'Reply with exactly OK.');
      new SecretGuard(fakeKey).assertSafe(body);
      return code === 200 ? good() : new Response(fakeKey, { status: code });
    });
    assert.equal(await runtime.test(), expected); assert.equal(calls, 1);
    assert.equal(runtime.status().testResult, expected);
    new SecretGuard(fakeKey).assertSafe(runtime.status());
    const usage = await readFile(budgetFile, 'utf8'); new SecretGuard(fakeKey).assertSafe(usage);
    assert.equal(JSON.parse(usage).calls, 1);
  });
}
for (const [name, transport, expected] of [
  ['timeout ignoring abort', async () => new Promise<Response>(() => {}), 'timeout'],
  ['thrown credential', async () => { throw new Error(fakeKey); }, 'server'],
  ['invalid JSON', async () => new Response('{'), 'schema'],
  ['truncated', async () => Response.json({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'OK' }] } }] }), 'schema'],
  ['oversized', async () => new Response('x'.repeat(65537)), 'schema'],
  ['empty', async () => Response.json({}), 'schema'],
  ['reflected credential', async () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: fakeKey }] } }] }), 'schema'],
] as [string, typeof fetch, ConnectionTestResult][]) {
  test(`start connection test rejects ${name}`, async t => {
    const { runtime } = await fixture(t, transport); assert.equal(await runtime.test(), expected);
    new SecretGuard(fakeKey).assertSafe(runtime.status());
  });
}
test('start limit zero calls nothing; tests, failures, play and mode/settings changes share budget', async t => {
  let calls = 0;
  const { runtime } = await fixture(t, async () => { calls++; return good(); });
  runtime.configure('offline-model', '', 0);
  assert.equal(await runtime.test(), 'session_limit'); assert.equal(calls, 0);
  runtime.configure('offline-model', '', 1);
  assert.equal(await runtime.test(), 'ok'); assert.equal(calls, 1);
  runtime.select('mock'); runtime.select('ai');
  const provider = runtime.provider()!;
  await assert.rejects(() => provider.interpret({ text: '질문', knowledge: { viewer: 'player', documents: [] }, context: [], actions: [] }, new AbortController().signal));
  assert.equal(calls, 1);
  runtime.clear(); runtime.configure('another-model', fakeKey, 1);
  assert.equal(await runtime.test(), 'session_limit'); assert.equal(calls, 1);
});
test('start env source, screen precedence, clear suppression and fresh session memory', async t => {
  const envKey = 'env-S8r5V9k2W6a3D7n4';
  const runtime = new RuntimeSettings({ env: { GEMINI_API_KEY: envKey, GEMINI_MODEL_ID: 'offline-model' }, transport: async () => { throw new Error('NO_CALL'); } });
  assert.equal(runtime.status().keySource, 'env');
  runtime.configure('offline-model', fakeKey, 30); assert.equal(runtime.status().keySource, 'screen');
  runtime.configure('offline-model', '', 30); assert.equal(runtime.status().keySource, 'screen');
  runtime.clear(); assert.equal(runtime.status().keyConfigured, false); assert.equal(runtime.status().keySource, 'none');
  assert.equal(await runtime.test(), 'auth'); assert.throws(() => runtime.select('ai'));
  for (const key of [fakeKey, envKey]) assert.throws(() => runtime.assertSafe(key));
  assert.equal(new RuntimeSettings({ env: {} }).status().keyConfigured, false);
  const { runtime: another } = await fixture(t, async () => good());
  assert.throws(() => another.configure(Buffer.from(fakeKey).toString('hex'), '', 30));
});
test('start settings change ignores late connection response and cannot confirm the new key', async t => {
  let release!: (response: Response) => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const { runtime } = await fixture(t, async () => { entered(); return await new Promise<Response>(resolve => { release = resolve; }); });
  const pending = runtime.test(); await waiting; runtime.clear(); release(good());
  assert.equal(await pending, 'stale'); assert.equal(runtime.status().testResult, 'untested');
});
