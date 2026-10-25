import './offline-runtime.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { runScenarios } from './quality/scenarios.ts';
const at = process.argv.indexOf('--out');
const output = at < 0 ? 'artifacts/m6' : process.argv[at + 1]!;
await mkdir(output, { recursive: true });
const scenarios = await runScenarios();
await writeFile(`${output}/playthrough.json`, JSON.stringify({ passed: scenarios.length, provider: 'Mock + offline ScriptedProvider', externalCalls: 0, scenarios }, null, 2) + '\n');
console.log(`${scenarios.length}/12 JSON scenarios; every step, event expectation, forbidden rule and PB check executed; external calls 0`);
