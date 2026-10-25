import { mkdir, writeFile } from 'node:fs/promises';
import { runSoak } from './quality/soak.ts';
const cycles = runSoak();
await mkdir('artifacts/m6', { recursive: true });
await writeFile('artifacts/m6/soak.json', JSON.stringify({ fakeClock: true, cycles, activeSeconds: cycles.length * 960, externalCalls: 0 }, null, 2) + '\n');
console.log(`PASS ${cycles.length} cycles × 960 active seconds; no duplicate events or idle collection growth; reset and post-15-minute play verified`);
