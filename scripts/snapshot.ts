import { mkdir, writeFile } from 'node:fs/promises';
import { GameEngine } from '../server/engine.ts';
import type { TestAction } from '../shared/contracts.ts';

// Independent reproducible fixture run. This does not inspect or reset the live browser session.
const actions: TestAction[] = [
  { type: 'advance-clock', milliseconds: 5000 },
  { type: 'set-pause', reason: 'manual', paused: true },
  { type: 'advance-clock', milliseconds: 5000 },
  { type: 'mock-probe', text: '수군을 정비하되 먼저 공격하지 마' },
  { type: 'set-pause', reason: 'manual', paused: false },
  { type: 'advance-clock', milliseconds: 5000 },
];
const engine = new GameEngine();
for (const action of actions) engine.dispatch(action);
const output = new URL('../artifacts/', import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(new URL('m0-internal-snapshot.json', output), JSON.stringify(engine.internalSnapshot(), null, 2) + '\n');
await writeFile(new URL('m0-public-snapshot.json', output), JSON.stringify(engine.publicSnapshot(), null, 2) + '\n');
await writeFile(new URL('m0-replay.json', output), JSON.stringify({ scenario: 'm0-fixture-v1', actions }, null, 2) + '\n');
console.log('artifacts/m0-{internal-snapshot,public-snapshot,replay}.json 생성 완료. 내부 파일은 서버 시험 전용입니다.');
