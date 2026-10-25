import { createGameServer } from './http.ts';

const server = createGameServer();
server.once('error', error => { console.error(`서버 시작 실패: ${error.message}`); process.exitCode = 1; });
server.listen(3001, '127.0.0.1', () => console.log('M0 Mock API: http://127.0.0.1:3001'));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => server.close());
