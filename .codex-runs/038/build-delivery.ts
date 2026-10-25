import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// Original worktree metadata is read-only and outside this task's writable root.
// Every mutation below targets an explicit, workspace-local independent Git directory.
const root = resolve('.'), output = resolve('artifacts/ollama');
const localGit = resolve(output, 'submission.git');
const options = { encoding: 'utf8' as const, windowsHide: true, maxBuffer: 128 * 1024 * 1024,
  stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'] };
const original = (...args: string[]) => execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`,
  '-c', 'core.safecrlf=false', ...args], options);
const base = original('rev-parse', 'HEAD').trim();
if (base !== '2d20969d114bf1e55d95091e4aadb4fcda254c26') throw new Error('Unexpected source HEAD');
const verification = JSON.parse(readFileSync('artifacts/m6/verification.json', 'utf8'));
if (verification.results.length !== 21 || verification.results.some((r: { passed: boolean }) => !r.passed)) throw new Error('verify-all incomplete');
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const counter = JSON.parse(readFileSync('artifacts/usage-counter/hash-verification.json', 'utf8'));
const diagnostics = JSON.parse(readFileSync('artifacts/diagnostic-log/hash-verification.json', 'utf8'));
if (!counter.unchanged || !diagnostics.unchanged) throw new Error('Real usage/diagnostic preservation failed');
const log = readFileSync('artifacts/m6/tests.log');
const tests = log.toString(log[0] === 0xff && log[1] === 0xfe ? 'utf16le' : 'utf8');
if (!tests.includes('pass 1138') || !tests.includes('fail 0')) throw new Error('Full tests incomplete');
mkdirSync(output, { recursive: true });
execFileSync('git', ['init', '--bare', localGit], options);
const local = (...args: string[]) => execFileSync('git', [`--git-dir=${localGit}`, `--work-tree=${root}`,
  '-c', 'core.safecrlf=false', ...args], options);
const pack = execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, 'pack-objects', '--stdout', '--revs'],
  { input: base + '\n', windowsHide: true, maxBuffer: 128 * 1024 * 1024 });
execFileSync('git', [`--git-dir=${localGit}`, 'index-pack', '--stdin'], { input: pack, windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
const paths = [...new Set([...original('diff', '--name-only').trim().split(/\r?\n/).filter(Boolean),
  ...original('ls-files', '--others', '--exclude-standard').trim().split(/\r?\n/).filter(Boolean),
  '.codex-runs/038/report.md', '.codex-runs/038/build-delivery.ts'])];
if (paths.some(path => /^(?:artifacts|node_modules|dist)\//.test(path))) throw new Error('Unexpected delivery file');
local('read-tree', base); local('add', '--force', '--', ...paths);
const tree = local('write-tree').trim();
const message = `${output}/commit-message.txt`;
writeFileSync(message, 'feat: add local Ollama provider and model comparison\n\nUse loopback-only direct native chat with schema output, reasoning isolation, serial requests, bounded local deadlines, keyless settings and server-side tags. Keep Google quotas unchanged. Extend the evaluation CLI and compare original/validated accuracy, safety and latency across models. Validate with fake transport, dev80 replay and both Edge resolutions; no real Ollama calls.\n');
const commit = local('-c', 'user.name=Codex', '-c', 'user.email=codex@local.invalid', 'commit-tree', tree, '-p', base, '-F', message).trim();
const ref = 'refs/heads/review/038-v02-ollama';
local('update-ref', ref, commit); local('symbolic-ref', 'HEAD', ref); local('diff', '--check', base, commit);
const bundle = `${output}/038-v02-ollama.bundle`, patch = `${output}/038-v02-ollama.patch`;
local('bundle', 'create', bundle, ref); local('bundle', 'verify', bundle);
writeFileSync(patch, local('diff', '--binary', base, commit));
const checkGit = mkdtempSync(join(output, 'bundle-check-'));
execFileSync('git', ['init', '--bare', checkGit], options);
const check = (...args: string[]) => execFileSync('git', [`--git-dir=${checkGit}`, ...args], options);
check('fetch', bundle, `${ref}:${ref}`); check('fsck', '--full', '--no-dangling');
check('read-tree', base); check('apply', '--cached', patch);
if (check('write-tree').trim() !== tree) throw new Error('Patch tree mismatch');
if (original('rev-parse', 'HEAD').trim() !== base) throw new Error('Original HEAD changed');
for (const [from, to] of [['artifacts/m6/verification.json', 'verification-final.json'],
  ['artifacts/usage-counter/hash-verification.json', 'usage-hash-final.json'],
  ['artifacts/diagnostic-log/hash-verification.json', 'diagnostic-hash-final.json']]) copyFileSync(from!, `${output}/${to}`);
writeFileSync(`${output}/submission.json`, JSON.stringify({ base, commit, tree, ref, originalBranchUpdated: false,
  reason: 'Original Git metadata is outside writable scope; verified standalone commit, bundle and patch are inside the authorized workspace.',
  bundleVerified: true, emptyRepositoryImportVerified: true, patchTreeVerified: true, externalModelCalls: 0, realOllamaCalls: 0,
  realUsageUnchanged: counter.unchanged, realDiagnosticsUnchanged: diagnostics.unchanged,
  files: [...paths, bundle, patch].map(path => ({ path: path.startsWith(root) ? path.slice(root.length + 1).replaceAll('\\', '/') : path, sha256: hash(path) })) }, null, 2) + '\n');
console.log(JSON.stringify({ base, commit, ref, bundle, originalBranchUpdated: false, files: paths.length }, null, 2));
