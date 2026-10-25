import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

type Accuracy = { denominator: number; intent: number; actions: number; conditions: number };
interface Report {
  version: number; provider?: string; model: string; split: string; promptVersion: string; fixtureHash: string;
  totalCases: number; rows: { id: string }[]; skipped: string[];
  totals: { cases: number; modelRawAccuracy: Accuracy; validatedAccuracy: Accuracy;
    modelRawSafetyCases: number; validatedSafetyCases: number; modelRawAvailable: number; errors: number;
    p50Ms: number | null; p95Ms: number | null };
}
function report(value: unknown): Report {
  const r = value as Report | null;
  if (!r || r.version !== 3 || ![r.model, r.split, r.promptVersion, r.fixtureHash].every(v => typeof v === 'string' && v.length > 0) ||
    !Array.isArray(r.rows) || !r.rows.every(row => typeof row.id === 'string') || !Array.isArray(r.skipped) || !r.totals ||
    !Number.isSafeInteger(r.totalCases) || r.totalCases < r.rows.length) throw new Error('COMPARE_REPORT');
  const t = r.totals;
  const count = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
  if (![t.cases, t.modelRawSafetyCases, t.validatedSafetyCases, t.modelRawAvailable, t.errors].every(count) || t.cases !== r.rows.length ||
    ![t.p50Ms, t.p95Ms].every(v => v === null || typeof v === 'number' && Number.isFinite(v) && v >= 0)) throw new Error('COMPARE_TOTALS');
  for (const a of [t.modelRawAccuracy, t.validatedAccuracy]) {
    if (!a || ![a.denominator, a.intent, a.actions, a.conditions].every(count) ||
      [a.intent, a.actions, a.conditions].some(n => n > a.denominator)) throw new Error('COMPARE_ACCURACY');
  }
  return r;
}
export async function compare(directories: string[]): Promise<string> {
  if (directories.length < 2) throw new Error('COMPARE_TWO_DIRECTORIES');
  const reports = await Promise.all(directories.map(async dir => report(JSON.parse(await readFile(join(resolve(dir), 'results.json'), 'utf8')))));
  const first = reports[0]!;
  if (reports.some(r => r.fixtureHash !== first.fixtureHash || r.promptVersion !== first.promptVersion || r.split !== first.split || r.totalCases !== first.totalCases))
    throw new Error('COMPARE_DIFFERENT_FIXTURES_OR_PROMPT');
  const cell = (value: string) => value.replace(/[|\r\n]/g, ' ');
  const rate = (n: number, d: number) => d ? `${n}/${d} (${(100 * n / d).toFixed(1)}%)` : 'N/A';
  const lines: string[] = [];
  for (const r of reports) {
    for (const stage of ['modelRaw', 'validated'] as const) {
      const t = r.totals, a = stage === 'modelRaw' ? t.modelRawAccuracy : t.validatedAccuracy;
      lines.push(`| ${cell(r.provider ?? r.model.split('/')[0]!)} | ${cell(r.model)} | ${stage} | ${r.rows.length}/${r.totalCases} | ${rate(a.intent, a.denominator)} | ${rate(a.actions, a.denominator)} | ${rate(a.conditions, a.denominator)} | ${stage === 'modelRaw' ? t.modelRawSafetyCases : t.validatedSafetyCases}/${t.cases} | ${t.errors} | ${t.p50Ms ?? 'N/A'} | ${t.p95Ms ?? 'N/A'} |`);
    }
  }
  return `# 모델 비교 / ${cell(first.split)}\n\n동일 fixture·prompt 해시 확인. 조건 정확도는 행동·금지·기한을 포함하는 명령 단위 완전 일치입니다.\n안전 위반은 위반 사례 수, 지연은 요청 시도 기준(ms)입니다. 미수신 원본은 통과로 세지 않습니다.\n\n| 공급자 | 모델 | 단계 | 실행/선택 | 의도 | 행동 | 조건 | 안전 위반 | 오류 | p50 ms | p95 ms |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n${lines.join('\n')}\n\n${reports.some(r => r.rows.length !== r.totalCases || r.skipped.length) ? '주의: 부분 실행이 포함되어 있습니다. 실행 분모가 다른 정확도는 직접 비교하지 마세요.\n' : ''}오프라인 모의 결과는 실제 모델 품질·속도·GPU 가속을 입증하지 않습니다.\n`;
}
export async function main(args = process.argv.slice(2)) {
  const at = args.indexOf('--out');
  const output = at >= 0 ? args[at + 1] : undefined;
  if (at >= 0 && (!output || at !== args.length - 2)) throw new Error('COMPARE_OUTPUT');
  const text = await compare(at >= 0 ? args.slice(0, at) : args);
  if (output) await writeFile(resolve(output), text);
  console.log(text); return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.exitCode = await main(); }
  catch { console.error('비교 실패: v3 결과 폴더 2개 이상, 동일 fixture/prompt/split을 확인하세요.'); process.exitCode = 2; }
}
