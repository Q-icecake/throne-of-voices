import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { GameEngine } from '../../server/engine.ts';
import { characterInput } from '../../server/characters.ts';
import { actionVocabulary, validateProposal } from '../../server/llm/validator.ts';
import type { ProviderInput } from '../../server/llm/types.ts';
import { loadCases } from './fixtures.ts';
import { mockSource, scriptedSource } from './sources.ts';
import { errorCode, liveSource } from './provider-bridge.ts';
import type { LiveRuntime } from './provider-bridge.ts';
import type { NetworkMode } from '../../shared/contracts.ts';
import { confusion, decode, score } from './score.ts';
import type { EvalCase, Sample, Score, Source } from './types.ts';
import type { SecretGuard } from '../../server/llm/secrets.ts';

export interface Row {
  id: string; suite: string; tags: string[]; expectedIntent: string;
  raw?: unknown; validated?: unknown; rawScore: Score; validatedScore: Score;
  validator: 'unchanged' | 'corrected' | 'rejected' | 'not-run';
  error?: string; sample: Sample; latencyMs: number;
}
export interface Limits { maxCalls: number; maxTokens?: number; budgetUsd?: number; inputPrice?: number; outputPrice?: number }
export function inputFor(fixture: EvalCase): ProviderInput {
  const game = new GameEngine();
  if (!fixture.npc) return { text: fixture.text, knowledge: game.view().knowledge, context: [], actions: actionVocabulary() };
  const npc = fixture.npc;
  game.audience({ type: 'invite', participants: npc.audience });
  // Controlled test reconstruction: the opening already shares this note with Zhang Hong.
  // Reset readers on a detached snapshot so every character has the same before/after pair.
  const world = game.internalSnapshot().world;
  const note = world.documents.find(d => d.id === 'm0-public-note')!;
  note.readers = npc.shared ? ['player', npc.character] : ['player'];
  const input = characterInput(world, npc.character, fixture.text, npc.audience);
  const actual = [...input.knowledge.documents.map(d => d.id), ...input.character!.cards.map(c => c.id)].sort();
  if (JSON.stringify(actual) !== JSON.stringify([...npc.allowedKnowledgeIds].sort())) throw new Error('FIXTURE_KNOWLEDGE_MISMATCH');
  return input;
}
export function totals(rows: Row[]) {
  const attempts = rows.flatMap(r => r.sample.attempts);
  const latencies = attempts.map(a => a.latencyMs).sort((a, b) => a - b);
  const percentile = (p: number) => latencies.length ? latencies[Math.max(0, Math.ceil(latencies.length * p) - 1)]! : null;
  const tokenSum = (key: 'inputTokens' | 'outputTokens') => attempts.reduce((sum, a) => sum + (a[key] ?? 0), 0);
  const distribution = (values: string[]) => values.reduce<Record<string, number>>((counts, code) => {
    counts[code] = (counts[code] ?? 0) + 1; return counts;
  }, {});
  // Exact-match case accuracy on command cases. Missing/malformed output is never a pass.
  const accuracy = (stage: 'rawScore' | 'validatedScore') => {
    const commands = rows.filter(row => row.suite === 'command');
    const valid = (row: Row) => row[stage].intent !== 'invalid' && !row[stage].issues.includes('schema');
    const aligned = (row: Row) => valid(row) && !row[stage].issues.some(issue =>
      /^actions\.(?:schema|extra|missing|forbidden)$|^actions\.\d+\.(?:missing|schema)$/.test(issue));
    return {
      denominator: commands.length,
      intent: commands.filter(row => valid(row) && row[stage].intent === row.expectedIntent).length,
      actions: commands.filter(row => aligned(row) && !row[stage].issues.some(issue =>
        /^actions\.\d+\.(?:kind|target|assignee)$/.test(issue))).length,
      conditions: commands.filter(row => aligned(row) && !row[stage].issues.some(issue =>
        /^actions\.\d+\.(?:kind|target|assignee|conditions|restrictions|deadline)$/.test(issue))).length,
    };
  };
  return {
    cases: rows.length, attempts: attempts.length, retries: rows.reduce((sum, r) => sum + Math.max(0, r.sample.attempts.length - 1), 0),
    reservations: rows.reduce((sum, r) => sum + r.sample.reservations, 0),
    inputTokensKnown: tokenSum('inputTokens'), outputTokensKnown: tokenSum('outputTokens'),
    missingUsageAttempts: attempts.filter(a => a.inputTokens === null || a.outputTokens === null).length,
    failedAttempts: attempts.filter(a => a.error).length,
    failedInputTokensKnown: attempts.filter(a => a.error).reduce((s, a) => s + (a.inputTokens ?? 0), 0),
    failedOutputTokensKnown: attempts.filter(a => a.error).reduce((s, a) => s + (a.outputTokens ?? 0), 0),
    p50Ms: percentile(.5), p95Ms: percentile(.95),
    rawPass: rows.filter(r => r.rawScore.pass).length, validatedPass: rows.filter(r => r.validatedScore.pass).length,
    rawSafetyCases: rows.filter(r => r.rawScore.safetyViolations.length).length,
    validatedSafetyCases: rows.filter(r => r.validatedScore.safetyViolations.length).length,
    errors: rows.filter(r => r.error).length,
    errorCodes: distribution(rows.flatMap(r => r.error ? [r.error] : [])),
    attemptErrorCodes: distribution(attempts.flatMap(a => a.error ? [a.error] : [])),
    routes: distribution(rows.flatMap(r => r.sample.network ? [r.sample.network.route] : [])),
    rawAccuracy: accuracy('rawScore'), validatedAccuracy: accuracy('validatedScore'),
    rawConfusion: confusion(rows.map(r => ({ expected: r.expectedIntent, actual: r.rawScore.intent }))),
    validatedConfusion: confusion(rows.map(r => ({ expected: r.expectedIntent, actual: r.validatedScore.intent }))),
  };
}
export async function evaluate(fixtures: EvalCase[], source: Source, limits: Limits) {
  const rows: Row[] = [];
  let stopped: string | undefined;
  for (const fixture of fixtures) {
    const used = totals(rows);
    if (used.attempts >= limits.maxCalls) { stopped = 'CALL_LIMIT'; break; }
    if ((limits.maxTokens !== undefined || limits.budgetUsd !== undefined) && used.missingUsageAttempts) { stopped = 'USAGE_UNKNOWN'; break; }
    if (limits.maxTokens !== undefined && used.inputTokensKnown + used.outputTokensKnown >= limits.maxTokens) { stopped = 'TOKEN_BUDGET'; break; }
    if (limits.budgetUsd !== undefined && (used.inputTokensKnown * limits.inputPrice! + used.outputTokensKnown * limits.outputPrice!) / 1e6 >= limits.budgetUsd) { stopped = 'COST_BUDGET'; break; }
    const start = performance.now();
    let sample: Sample = { attempts: [], reservations: 0 }, input: ProviderInput | undefined;
    try {
      input = inputFor(fixture); sample = await source.sample(fixture, input);
      source.secretGuard?.assertSafe(sample.raw);
    } catch (e) {
      sample.raw = undefined;
      sample.error = e instanceof Error && e.message === 'FIXTURE_KNOWLEDGE_MISMATCH' ? e.message : errorCode(e);
    }
    const row: Row = { id: fixture.id, suite: fixture.suite, tags: fixture.tags, expectedIntent: fixture.intent,
      raw: decode(sample.raw), rawScore: score(fixture, sample.raw), validatedScore: score(fixture, undefined),
      validator: 'not-run', error: sample.error, sample, latencyMs: 0 };
    if (!sample.error && input) {
      try {
        row.validated = validateProposal(sample.raw, input);
        row.validatedScore = score(fixture, row.validated);
        row.validator = JSON.stringify(row.raw) === JSON.stringify(row.validated) ? 'unchanged' : 'corrected';
      } catch (e) { row.validator = 'rejected'; row.error = errorCode(e); }
    }
    row.latencyMs = Math.round((performance.now() - start) * 100) / 100;
    source.secretGuard?.assertSafe(row);
    rows.push(row);
    if (sample.error && ['CALL_LIMIT', 'TOKEN_BUDGET', 'COST_BUDGET', 'USAGE_UNKNOWN'].includes(sample.error)) { stopped = sample.error; break; }
  }
  return { rows, stopped, skipped: fixtures.slice(rows.length).map(c => c.id), totals: totals(rows) };
}

const csvCell = (value: unknown) => '"' + String(value ?? '').replace(/^[=+@-]/, "'$&").replaceAll('"', '""') + '"';
export function humanSheet(fixtures: EvalCase[], rows: Row[], guard?: SecretGuard) {
  const sheet = rows.map(row => {
    const fixture = fixtures.find(c => c.id === row.id)!;
    return { id: row.id, suite: row.suite, text: fixture.text, toneGuide: fixture.npc?.tone ?? '',
      expectedIntent: fixture.intent, expectedActions: JSON.stringify(fixture.actions),
      allowedKnowledgeIds: JSON.stringify(fixture.npc?.allowedKnowledgeIds ?? []), engineFacts: JSON.stringify(fixture.npc?.facts ?? []),
      raw: JSON.stringify(row.sample.raw) ?? '', validated: JSON.stringify(row.validated) ?? '',
      tone_1_5: null, naturalness_1_5: null, grounding_1_5: null, clarification_1_5: null, safety_1_5: null, notes: '' };
  });
  guard?.assertSafe(sheet);
  return sheet;
}
export function liveConfigurationHelp(provider: string | undefined): string {
  const settings = provider === 'gemini' ? 'LLM_PROVIDER=gemini, GEMINI_API_KEY, GEMINI_MODEL_ID' :
    provider === 'openai-compatible' ? 'LLM_PROVIDER=openai-compatible, OPENAI_COMPAT_API_KEY, OPENAI_COMPAT_MODEL_ID, OPENAI_COMPAT_BASE_URL' :
    'LLM_PROVIDER를 gemini 또는 openai-compatible로 선택하고 해당 공급자의 키·모델·endpoint';
  return `라이브 차단 · 외부 호출 0회. ${settings}, 양수 LLM_DAILY_CALL_LIMIT/LLM_SESSION_CALL_LIMIT 및 --max-calls 필요. docs/EVAL.md 참고.`;
}
export async function promptVersion() {
  const hash = createHash('sha256');
  for (const name of ['system.ko.txt', 'output.schema.json', 'actions.json']) hash.update(await readFile(new URL(`../../server/llm/${name}`, import.meta.url)));
  return `eval-v2:${hash.digest('hex')}`;
}

export function parseOptions(args: string[]) {
  let mode: 'mock' | 'scripted' | 'live' | undefined, script: string | undefined;
  let split: 'dev' | 'final' = 'dev';
  let limit: number | undefined, networkMode: NetworkMode = 'auto', proxy: string | undefined;
  const limits: Limits = { maxCalls: Infinity };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['--mock', '--scripted', '--live'].includes(arg!)) {
      if (mode) throw new Error('CLI_MODES');
      mode = arg!.slice(2) as 'mock' | 'scripted' | 'live';
      if (mode === 'scripted') { script = args[++i]; if (!script || script.startsWith('--')) throw new Error('CLI_SCRIPT'); }
    } else if (arg === '--split') {
      const value = args[++i]; if (value !== 'dev' && value !== 'final') throw new Error('CLI_SPLIT'); split = value;
    } else if (arg === '--limit') {
      limit = Number(args[++i]); if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('CLI_LIMIT');
    } else if (arg === '--network') {
      const value = args[++i]; if (value !== 'auto' && value !== 'proxy' && value !== 'direct') throw new Error('CLI_NETWORK'); networkMode = value;
    } else if (arg === '--proxy') {
      proxy = args[++i]; if (!proxy || proxy.startsWith('--')) throw new Error('CLI_PROXY');
    } else {
      const keys = { '--max-calls': 'maxCalls', '--max-tokens': 'maxTokens', '--budget-usd': 'budgetUsd', '--input-price': 'inputPrice', '--output-price': 'outputPrice' } as const;
      const key = keys[arg as keyof typeof keys]; if (!key) throw new Error('CLI_OPTION');
      const value = Number(args[++i]); if (!Number.isFinite(value) || value <= 0 || (['maxCalls', 'maxTokens'].includes(key) && !Number.isSafeInteger(value))) throw new Error('CLI_LIMIT');
      limits[key] = value;
    }
  }
  if (!mode) throw new Error('CLI_MODE');
  if (limit !== undefined && split !== 'dev') throw new Error('CLI_LIMIT_DEV_ONLY');
  if (limits.budgetUsd !== undefined && (limits.inputPrice === undefined || limits.outputPrice === undefined)) throw new Error('CLI_PRICES');
  return { mode, script, split, limit, limits, networkMode, proxy };
}

export function selectCases(fixtures: EvalCase[], limit?: number): EvalCase[] {
  return limit === undefined ? fixtures : fixtures.slice(0, limit);
}

export function renderSummary(mode: string, split: string, model: string, version: string, fixtures: EvalCase[],
  result: Awaited<ReturnType<typeof evaluate>>, policy = 'offline') {
  const t = result.totals, n = result.rows.length;
  const rate = (x: number, d = n) => d ? `${x}/${d} (${(100 * x / d).toFixed(1)}%)` : 'N/A';
  const accuracy = (a: typeof t.rawAccuracy) =>
    `intent ${rate(a.intent, a.denominator)}; actions ${rate(a.actions, a.denominator)}; conditions ${rate(a.conditions, a.denominator)}`;
  const distribution = (values: Record<string, number>) => Object.entries(values).map(([code, count]) => `${code}: ${count}`).join(', ') || 'none';
  const cases = fixtures.map(fixture => {
    const row = result.rows.find(r => r.id === fixture.id);
    return row ? `| ${row.id} | ${row.suite} | ${row.rawScore.pass ? 'PASS' : 'FAIL'} | ${row.validatedScore.pass ? 'PASS' : 'FAIL'} | ${row.sample.network?.route ?? 'N/A'} | ${row.error ?? '-'} | ${row.rawScore.issues.join(', ') || '-'} | ${row.validatedScore.issues.join(', ') || '-'} |` :
      `| ${fixture.id} | ${fixture.suite} | SKIPPED | SKIPPED | N/A | ${result.stopped ?? '-'} | - | - |`;
  });
  return `# Eval ${mode} / ${split}\n\nModel: ${model}\nPrompt: ${version}\n\nCases: ${n}/${fixtures.length}; skipped: ${result.skipped.length}; stop: ${result.stopped ?? 'none'}
Raw pass: ${rate(t.rawPass)}; validated pass: ${rate(t.validatedPass)}
Command accuracy (exact case match; conditions include restrictions/deadlines and action identity):
Raw: ${accuracy(t.rawAccuracy)}
Validated: ${accuracy(t.validatedAccuracy)}
Raw safety violations: ${rate(t.rawSafetyCases)}; validated: ${rate(t.validatedSafetyCases)}
Rejected: ${result.rows.filter(r => r.validator === 'rejected').length}; corrected: ${result.rows.filter(r => r.validator === 'corrected').length}; errors: ${t.errors}
External attempts: ${t.attempts}; retries: ${t.retries}; reservations: ${t.reservations}
Attempt latency p50/p95: ${t.p50Ms ?? 'N/A'}/${t.p95Ms ?? 'N/A'} ms
Known input/output tokens: ${t.inputTokensKnown}/${t.outputTokensKnown}; total: ${t.inputTokensKnown + t.outputTokensKnown}; missing usage attempts: ${t.missingUsageAttempts}
Failed attempts: ${t.failedAttempts}; their known input/output tokens: ${t.failedInputTokensKnown}/${t.failedOutputTokensKnown}
Case error codes: ${distribution(t.errorCodes)}
Attempt error codes: ${distribution(t.attemptErrorCodes)}
Network routes (selected cases): ${distribution(t.routes)}
PAC unsupported cases: ${result.rows.filter(r => r.sample.network?.pacUnsupported).length}
Daily counter policy: ${policy}

| Case | Suite | Raw | Validated | Route | Error | Raw issues | Validated issues |
| --- | --- | --- | --- | --- | --- | --- | --- |
${cases.join('\n')}

Rejection is not a correctness pass. Unknown usage is not zero. Offline scores are harness evidence, not live model quality. See results.json for separate confusion matrices, fields, and case errors. Human review remains required.\n`;
}

export async function main(args = process.argv.slice(2), runtime: {
  env?: NodeJS.ProcessEnv; live?: LiveRuntime; outputRoot?: string; log?: (value: string) => void;
} = {}): Promise<number> {
  const log = runtime.log ?? console.log, env = runtime.env ?? process.env;
  if (!args.length) { log('평가 미실행 · 외부 호출 0회. --mock 또는 --scripted tests/fixtures/eval-scripted-good.json 사용. --live는 키·모델·양수 호출 상한 설정 후 별도 실행.'); return 0; }
  const { mode, script, split, limit, limits, networkMode, proxy } = parseOptions(args);
  let source: Source | undefined;
  if (mode === 'mock') source = mockSource();
  if (mode === 'scripted') source = scriptedSource(JSON.parse(await readFile(resolve(script!), 'utf8')), split);
  if (mode === 'live') source = liveSource(limits.maxCalls, env, limits, { ...runtime.live, networkMode, proxy });
  if (!source) { log(liveConfigurationHelp(env.LLM_PROVIDER)); return 2; }
  const allFixtures = await loadCases(split), fixtures = selectCases(allFixtures, limit);
  const plannedCalls = mode === 'live' ? Math.min(fixtures.length, limits.maxCalls) : 0;
  log(`예정 호출 수 ${plannedCalls} (상한; 사례 ${fixtures.length}); 최대 토큰: 누적 관측 ${limits.maxTokens ?? '미설정'}, 요청별 출력 ${source.maxOutputTokens ?? '공급자 설정'}; 재시도 0; 네트워크 ${source.networkPolicy ?? 'offline'}; 일일 카운터 ${source.counterPolicy ?? 'offline'}.`);
  // No confirmation prompt: invoking --live is the user's explicit execution choice.
  const result = await evaluate(fixtures, source, limits);
  const version = await promptVersion();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = resolve(runtime.outputRoot ?? 'artifacts/eval', `${stamp}-${mode}-${process.pid}`);
  await mkdir(dir, { recursive: true });
  const report = { version: 2, createdAt: new Date().toISOString(), mode, split, model: source.model, promptVersion: version,
    limits: { ...limits, maxCalls: Number.isFinite(limits.maxCalls) ? limits.maxCalls : null, limit: limit ?? null }, totalCases: fixtures.length,
    availableCases: allFixtures.length, plannedCalls, networkPolicy: source.networkPolicy ?? 'offline',
    counterPolicy: source.counterPolicy ?? 'offline', maxOutputTokens: source.maxOutputTokens ?? null,
    fixtureHash: createHash('sha256').update(JSON.stringify(fixtures)).digest('hex'), ...result };
  const sheet = humanSheet(fixtures, result.rows, source.secretGuard);
  const columns = Object.keys(sheet[0] ?? { id: null, tone_1_5: null, naturalness_1_5: null, grounding_1_5: null, clarification_1_5: null, safety_1_5: null, notes: null });
  const t = result.totals, n = result.rows.length;
  const summary = renderSummary(mode, split, source.model, version, fixtures, result, source.counterPolicy);
  // Check all exports before the first write, including metadata and human rows.
  source.secretGuard?.assertSafe({ report, sheet, summary });
  await writeFile(`${dir}/results.json`, JSON.stringify(report, null, 2) + '\n');
  await writeFile(`${dir}/summary.md`, summary);
  await writeFile(`${dir}/human-review.json`, JSON.stringify(sheet, null, 2) + '\n');
  await writeFile(`${dir}/human-review.csv`, '\ufeff' + [columns.map(csvCell).join(','), ...sheet.map(row => columns.map(k => csvCell(row[k as keyof typeof row])).join(','))].join('\r\n') + '\r\n');
  log(summary + `\nArtifacts: ${dir}`);
  if (result.stopped || result.rows.some(r => r.sample.error)) return 2;
  return t.rawPass === n && t.validatedPass === n ? 0 : 1;
}
