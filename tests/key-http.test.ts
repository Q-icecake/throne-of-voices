import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameServer } from '../server/http.ts';
import { SecretGuard } from '../server/llm/secrets.ts';

const key = 'http-fake-H7j2L9p4S6v8B3m5';
test('start HTTP strict local settings, secret-free boundaries, clear and mock start', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'throne-key-http-'));
  let calls = 0;
  const server = createGameServer(undefined, 5173, { env: {}, budgetFile: join(dir, 'usage.json'), transport: async () => { calls++; return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'OK' }] } }] }); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const guard = new SecretGuard(key);
  const post = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const text = await response.text(); guard.assertSafe(text); return { status: response.status, data: JSON.parse(text) };
  };
  const settings = { model: 'offline-model', key, limit: 30 };
  assert.equal((await post('/api/llm/settings', settings, { Origin: 'https://evil.example' })).status, 403);
  const badHost = await new Promise<number | undefined>(resolve => {
    const request = httpRequest(base + '/api/llm/status', { headers: { Host: 'evil.example:1234' } }, response => { response.resume(); resolve(response.statusCode); }); request.end();
  });
  assert.equal(badHost, 403);
  for (const body of [{ ...settings, extra: true }, { ...settings, model: 'x'.repeat(201) }, { ...settings, model: '../model' }, { ...settings, key: 'x'.repeat(513) }, { ...settings, key: 'line\nbreak' }, { ...settings, limit: -1 }, { ...settings, limit: 1.5 }, { ...settings, limit: 10001 }, { ...settings, limit: '30' }, { model: 'offline-model', limit: 30 }, { ...settings, model: key }]) {
    assert.equal((await post('/api/llm/settings', body)).status, 400);
  }
  assert.equal((await post('/api/llm/settings', settings)).data.keySource, 'screen'); assert.equal(calls, 0);
  assert.equal((await post('/api/llm/test', {})).data.result, 'ok'); assert.equal(calls, 1);
  for (const path of ['/api/llm/status', '/api/state', '/api/health', '/api/test/logs', '/api/test/snapshot']) {
    const response = await fetch(base + path); assert.equal(response.status, 200); guard.assertSafe(await response.text());
  }
  for (const path of ['/api/llm/test', '/api/llm/clear']) assert.equal((await post(path, { unexpected: true })).status, 400);
  assert.equal((await post('/api/llm/start', { mode: 'openai-compatible' })).status, 400);
  assert.equal((await post('/api/llm/start', { mode: 'ai' })).status, 200); assert.equal(calls, 1);
  assert.equal((await post('/api/llm/clear', {})).data.keyConfigured, false);
  assert.equal((await post('/api/llm/test', {})).data.result, 'auth'); assert.equal(calls, 1);
  assert.equal((await post('/api/llm/start', { mode: 'ai' })).status, 400);
  assert.equal((await post('/api/llm/start', { mode: 'mock' })).status, 200);
  const command = await post('/api/command', { type: 'submit', text: '항복하면 어떻게 돼?' });
  assert.equal(command.data.state.mode, 'mock'); assert.equal(command.data.outcome.kind, 'answer'); assert.equal(calls, 1);
});
test('start switching mode discards an in-flight AI command and keeps the new world clean', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'throne-late-'));
  let entered!: () => void, release!: (response: Response) => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const server = createGameServer(undefined, 5173, { env: {}, budgetFile: join(dir, 'usage.json'), transport: async () => { entered(); return await new Promise<Response>(resolve => { release = resolve; }); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async (path: string, body: unknown) => (await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  await post('/api/llm/settings', { model: 'offline-model', key, limit: 30 }); await post('/api/llm/start', { mode: 'ai' });
  const pending = post('/api/command', { type: 'submit', text: '항복하면 어떻게 돼?' }); await ready;
  await post('/api/llm/clear', {});
  release(Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ intent: 'question', dialogue: '보고를 살펴보겠습니다.', proposedActions: [], unresolvedQuestions: [], referencedKnowledgeIds: [] }) }] } }] }));
  const result = await pending; assert.equal(result.outcome.code, 'STALE_RESPONSE'); assert.equal(result.state.mode, 'mock');
  const snapshot = await (await fetch(base + '/api/test/snapshot')).text(); new SecretGuard(key).assertSafe(snapshot); assert.ok(!snapshot.includes('보고를 살펴보겠습니다.'));
});
