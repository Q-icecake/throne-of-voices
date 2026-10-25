import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const output = 'artifacts/m6';
await mkdir(output, { recursive: true });
const env: NodeJS.ProcessEnv = { ...process.env, LLM_PROVIDER: 'mock' };
for (const key of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY']) delete env[key];
const jobs: [string, string[]][] = [
  ['typecheck', ['node_modules/typescript/bin/tsc', '--noEmit']],
  ['tests', ['--test', 'tests/*.test.ts']],
  ['build', ['node_modules/vite/bin/vite.js', 'build']],
  ['content', ['content/validate.mjs', '--self-test']],
  ['playthrough', ['scripts/playthrough.ts']],
  ['soak', ['scripts/soak.ts']],
  ['guide', ['scripts/verify-guide.ts']],
  ['scenes', ['scripts/screenshots.ts', 'all', '--out', `${output}/scenes`]],
  ...['visual', 'r1', 'm3', 'm4', 'llm-ui', 'm5'].map(name => [name, [`scripts/verify-${name}.ts`, '--out', `${output}/${name}`]] as [string, string[]]),
  ['r3', ['scripts/verify-r3.ts']],
  ['comparison', ['scripts/compare-visual.ts']],
  ['launch', ['scripts/verify-launch.ts']],
];
const results: { name: string; command: string; exitCode: number | null; passed: boolean; durationMs: number; error?: string }[] = [];
for (const [name, args] of jobs) {
  console.log(`START ${name}`);
  const started = performance.now(), chunks: Buffer[] = [];
  const child = spawn(process.execPath, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (data: Buffer) => { chunks.push(data); process.stdout.write(data); });
  child.stderr.on('data', (data: Buffer) => { chunks.push(data); process.stderr.write(data); });
  let error: string | undefined;
  const timeout = setTimeout(() => { error = 'verification exceeded 5 minutes'; child.kill(); }, 300000);
  const exitCode = await new Promise<number | null>(resolve => {
    child.once('error', e => { error = e.message; resolve(null); }); child.once('close', resolve);
  });
  clearTimeout(timeout);
  await writeFile(`${output}/${name}.log`, Buffer.concat(chunks));
  results.push({ name, command: `node ${args.join(' ')}`, exitCode, passed: exitCode === 0 && !error, durationMs: Math.round(performance.now() - started), ...(error ? { error } : {}) });
  await writeFile(`${output}/verification.json`, JSON.stringify({ completedAt: new Date().toISOString(), provider: 'forced Mock; keys removed from child environment', externalCalls: 0, results }, null, 2) + '\n');
  console.log(`END ${name}: ${results.at(-1)!.passed ? 'PASS' : 'FAIL'}`);
}
console.log(`${results.filter(r => r.passed).length}/${results.length} verification commands passed; ${output}/verification.json`);
process.exitCode = results.every(r => r.passed) ? 0 : 1;
