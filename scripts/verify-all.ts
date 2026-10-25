import './offline-runtime.ts';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PLAY_USAGE_FILE } from '../server/llm/usage-file.ts';
import { dirname, join } from 'node:path';

function playCounterHash(): string {
  try { return createHash('sha256').update(readFileSync(PLAY_USAGE_FILE)).digest('hex'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'absent'; throw error; }
}
const counterBefore = playCounterHash();
const counterChecks: { name: string; before: string; after: string; unchanged: boolean }[] = [];
const diagnosticFile = join(dirname(PLAY_USAGE_FILE), 'llm-diagnostics.jsonl');
function diagnosticHash() {
  try { return createHash('sha256').update(readFileSync(diagnosticFile)).digest('hex'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'absent'; throw error; }
}
const diagnosticBefore = diagnosticHash();
const diagnosticChecks: { name: string; before: string; after: string; unchanged: boolean }[] = [];

const output = 'artifacts/m6';
await mkdir(output, { recursive: true });
const env: NodeJS.ProcessEnv = { ...process.env, LLM_PROVIDER: 'mock' };
for (const key of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY']) delete env[key];
const jobs: [string, string[]][] = [
  ['typecheck', ['node_modules/typescript/bin/tsc', '--noEmit']],
  ['tests', ['--test', 'tests/*.test.ts']],
  ['build', ['node_modules/vite/bin/vite.js', 'build']],
  ['start-screen', ['scripts/verify-start-screen.ts']],
  ['network-mode', ['scripts/verify-network-mode.ts']],
  ['content', ['content/validate.mjs', '--self-test']],
  ['playthrough', ['scripts/playthrough.ts']],
  ['soak', ['scripts/soak.ts']],
  ['guide', ['scripts/verify-guide.ts']],
  ['scenes', ['scripts/screenshots.ts', 'all', '--out', `${output}/scenes`]],
  ...['visual', 'r1', 'm3', 'm4', 'llm-ui', 'm5'].map(name => [name, [`scripts/verify-${name}.ts`, '--out', `${output}/${name}`]] as [string, string[]]),
  ['r3', ['scripts/verify-r3.ts']],
  ['npc-status', ['scripts/verify-npc-status.ts']],
  ['comparison', ['scripts/compare-visual.ts']],
  ['launch', ['scripts/verify-launch.ts']],
];
const results: { name: string; command: string; exitCode: number | null; passed: boolean; durationMs: number; error?: string }[] = [];
for (const [name, args] of jobs) {
  console.log(`START ${name}`);
  const started = performance.now(), chunks: Buffer[] = [];
  const before = playCounterHash();
  const logBefore = diagnosticHash();
  const child = spawn(process.execPath, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (data: Buffer) => { chunks.push(data); process.stdout.write(data); });
  child.stderr.on('data', (data: Buffer) => { chunks.push(data); process.stderr.write(data); });
  let error: string | undefined;
  const timeout = setTimeout(() => { error = 'verification exceeded 5 minutes'; child.kill(); }, 300000);
  const exitCode = await new Promise<number | null>(resolve => {
    child.once('error', e => { error = e.message; resolve(null); }); child.once('close', resolve);
  });
  clearTimeout(timeout);
  const after = playCounterHash();
  const logAfter = diagnosticHash();
  diagnosticChecks.push({ name, before: logBefore, after: logAfter, unchanged: logBefore === logAfter && logAfter === diagnosticBefore });
  counterChecks.push({ name, before, after, unchanged: before === after && after === counterBefore });
  if (before !== after || after !== counterBefore) error = 'real play usage counter changed';
  if (logBefore !== logAfter || logAfter !== diagnosticBefore) error = 'real diagnostic file changed';
  await writeFile(`${output}/${name}.log`, Buffer.concat(chunks));
  results.push({ name, command: `node ${args.join(' ')}`, exitCode, passed: exitCode === 0 && !error, durationMs: Math.round(performance.now() - started), ...(error ? { error } : {}) });
  await writeFile(`${output}/verification.json`, JSON.stringify({ completedAt: new Date().toISOString(), provider: 'forced Mock; keys removed from child environment', externalCalls: 0, results }, null, 2) + '\n');
  console.log(`END ${name}: ${results.at(-1)!.passed ? 'PASS' : 'FAIL'}`);
}
await mkdir('artifacts/usage-counter', { recursive: true });
await writeFile('artifacts/usage-counter/hash-verification.json', JSON.stringify({ file: PLAY_USAGE_FILE, before: counterBefore,
  after: playCounterHash(), unchanged: counterChecks.every(check => check.unchanged), checks: counterChecks }, null, 2) + '\n');
console.log(`${results.filter(r => r.passed).length}/${results.length} verification commands passed; ${output}/verification.json`);
await mkdir('artifacts/diagnostic-log', { recursive: true });
await writeFile('artifacts/diagnostic-log/hash-verification.json', JSON.stringify({ file: diagnosticFile, before: diagnosticBefore,
  after: diagnosticHash(), unchanged: diagnosticChecks.every(check => check.unchanged), checks: diagnosticChecks }, null, 2) + '\n');
process.exitCode = results.every(r => r.passed) ? 0 : 1;
