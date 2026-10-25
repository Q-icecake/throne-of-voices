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

export async function main(args = process.argv.slice(2)): Promise<number> {
  if (!args.length) { console.log('평가 미실행 · 외부 호출 0회. --mock 또는 --scripted tests/fixtures/eval-scripted-good.json 사용. --live는 키·모델·양수 호출 상한 설정 후 별도 실행.'); return 0; }
  let mode: 'mock' | 'scripted' | 'live' | undefined, script: string | undefined;
  let split: 'dev' | 'final' = 'dev';
  const limits: Limits = { maxCalls: Infinity };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['--mock', '--scripted', '--live'].includes(arg!)) {
      if (mode) throw new Error('CLI_MODES');
      mode = arg!.slice(2) as 'mock' | 'scripted' | 'live';
      if (mode === 'scripted') { script = args[++i]; if (!script || script.startsWith('--')) throw new Error('CLI_SCRIPT'); }
    } else if (arg === '--split') {
      const value = args[++i]; if (value !== 'dev' && value !== 'final') throw new Error('CLI_SPLIT'); split = value;
    } else {
      const keys = { '--max-calls': 'maxCalls', '--max-tokens': 'maxTokens', '--budget-usd': 'budgetUsd', '--input-price': 'inputPrice', '--output-price': 'outputPrice' } as const;
      const key = keys[arg as keyof typeof keys]; if (!key) throw new Error('CLI_OPTION');
      const value = Number(args[++i]); if (!Number.isFinite(value) || value <= 0 || (['maxCalls', 'maxTokens'].includes(key) && !Number.isSafeInteger(value))) throw new Error('CLI_LIMIT');
      limits[key] = value;
    }
  }
  if (!mode) throw new Error('CLI_MODE');
  if (limits.budgetUsd !== undefined && (limits.inputPrice === undefined || limits.outputPrice === undefined)) throw new Error('CLI_PRICES');
  let source: Source | undefined;
  if (mode === 'mock') source = mockSource();
  if (mode === 'scripted') source = scriptedSource(JSON.parse(await readFile(resolve(script!), 'utf8')), split);
  if (mode === 'live') source = liveSource(limits.maxCalls, process.env, limits);
  if (!source) { console.log(liveConfigurationHelp(process.env.LLM_PROVIDER)); return 2; }
  const fixtures = await loadCases(split);
  const result = await evaluate(fixtures, source, limits);
  const version = await promptVersion();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = resolve('artifacts/eval', `${stamp}-${mode}-${process.pid}`);
  await mkdir(dir, { recursive: true });
  const report = { version: 2, createdAt: new Date().toISOString(), mode, split, model: source.model, promptVersion: version,
    limits: { ...limits, maxCalls: Number.isFinite(limits.maxCalls) ? limits.maxCalls : null }, totalCases: fixtures.length,
    fixtureHash: createHash('sha256').update(JSON.stringify(fixtures)).digest('hex'), ...result };
  const sheet = humanSheet(fixtures, result.rows, source.secretGuard);
  const columns = Object.keys(sheet[0] ?? { id: null, tone_1_5: null, naturalness_1_5: null, grounding_1_5: null, clarification_1_5: null, safety_1_5: null, notes: null });
  const t = result.totals, n = result.rows.length;
  const rate = (x: number) => n ? `${(100 * x / n).toFixed(1)}%` : 'N/A';
  const summary = `# Eval ${mode} / ${split}\n\nModel: ${source.model}\nPrompt: ${version}\n\nCases: ${n}/${fixtures.length}; skipped: ${result.skipped.length}; stop: ${result.stopped ?? 'none'}\nRaw pass: ${t.rawPass}/${n} (${rate(t.rawPass)}); validated pass: ${t.validatedPass}/${n} (${rate(t.validatedPass)})\nRaw safety violations: ${t.rawSafetyCases} (${rate(t.rawSafetyCases)}); validated: ${t.validatedSafetyCases} (${rate(t.validatedSafetyCases)})\nRejected: ${result.rows.filter(r => r.validator === 'rejected').length}; corrected: ${result.rows.filter(r => r.validator === 'corrected').length}; errors: ${t.errors}\nExternal attempts: ${t.attempts}; retries: ${t.retries}; reservations: ${t.reservations}\nAttempt latency p50/p95: ${t.p50Ms ?? 'N/A'}/${t.p95Ms ?? 'N/A'} ms\nKnown input/output tokens: ${t.inputTokensKnown}/${t.outputTokensKnown}; missing usage attempts: ${t.missingUsageAttempts}\nFailed attempts: ${t.failedAttempts}; their known input/output tokens: ${t.failedInputTokensKnown}/${t.failedOutputTokensKnown}\n\nRejection is not a correctness pass. Unknown usage is not zero. Offline scores are harness evidence, not live model quality. See results.json for separate confusion matrices, fields, and case errors. Human review remains required.\n`;
  // Check all exports before the first write, including metadata and human rows.
  source.secretGuard?.assertSafe({ report, sheet, summary });
  await writeFile(`${dir}/results.json`, JSON.stringify(report, null, 2) + '\n');
  await writeFile(`${dir}/summary.md`, summary);
  await writeFile(`${dir}/human-review.json`, JSON.stringify(sheet, null, 2) + '\n');
  await writeFile(`${dir}/human-review.csv`, '\ufeff' + [columns.map(csvCell).join(','), ...sheet.map(row => columns.map(k => csvCell(row[k as keyof typeof row])).join(','))].join('\r\n') + '\r\n');
  console.log(summary + `\nArtifacts: ${dir}`);
  if (result.stopped || result.rows.some(r => r.sample.error)) return 2;
  return t.rawPass === n && t.validatedPass === n ? 0 : 1;
}
