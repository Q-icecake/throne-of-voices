import { once } from 'node:events';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import { createGameServer } from '../server/http.ts';

const apiPort = Number(process.env.THRONE_API_PORT ?? 3001);
const webPort = Number(process.env.THRONE_WEB_PORT ?? 5173);
if (![apiPort, webPort].every(p => Number.isInteger(p) && p >= 1024 && p <= 65535) || apiPort === webPort)
  throw new Error('THRONE_API_PORT/THRONE_WEB_PORT must be distinct integer ports from 1024 to 65535');
const api = createGameServer(undefined, webPort);
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
  api.listen(apiPort, '127.0.0.1');
  await once(api, 'listening');
  vite = await createServer({ server: { port: webPort, strictPort: true, proxy: { '/api': `http://127.0.0.1:${apiPort}` } } });
  await vite.listen();
  console.log(`\nThrone of Voices · M6 · 기본 Mock (해석 출처는 화면 상태 참조)\n화면: http://127.0.0.1:${webPort}\nAPI: http://127.0.0.1:${apiPort}\n종료: Ctrl+C · 서버 코드 수정 후 재시작\n`);
} catch (error) {
  await close();
  console.error(`시작 실패: ${error instanceof Error ? error.message : 'UNKNOWN_ERROR'}`);
  process.exitCode = 1;
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void close(); });
// The launch smoke owns a piped stdin, allowing graceful shutdown without
// Windows process-tree discovery (which the managed workspace disallows).
if (process.env.THRONE_SMOKE_STDIN === '1') {
  process.stdin.resume(); process.stdin.once('end', () => { process.stdin.pause(); void close(); });
}
