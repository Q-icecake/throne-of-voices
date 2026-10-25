import { once } from 'node:events';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import { createGameServer } from '../server/http.ts';

const api = createGameServer();
let vite: ViteDevServer | undefined;
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await vite?.close();
  api.closeAllConnections();
  if (api.listening) await new Promise<void>(resolve => api.close(() => resolve()));
}

try {
  api.listen(3001, '127.0.0.1');
  await once(api, 'listening');
  vite = await createServer();
  await vite.listen();
  console.log('\nThrone of Voices · M0 · MOCK ONLY\n화면: http://127.0.0.1:5173\nAPI: http://127.0.0.1:3001\n종료: Ctrl+C · 서버 코드 수정 후 재시작\n');
} catch (error) {
  await close();
  console.error(`시작 실패: ${error instanceof Error ? error.message : 'UNKNOWN_ERROR'}`);
  process.exitCode = 1;
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void close(); });
