import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { GameEngine } from '../server/engine.ts';
import { GeminiProvider, geminiConfig } from '../server/llm/gemini.ts';
import { interpret } from '../server/llm/pipeline.ts';
import { actionVocabulary } from '../server/llm/validator.ts';
import type { Intent } from '../server/llm/types.ts';

// Explicitly separate from offline CI. Never print credentials, requests or raw upstream data.
if (!process.env.GEMINI_API_KEY) {
  console.log('라이브 평가 미실행: GEMINI_API_KEY 없음. 외부 호출 0회.');
} else if (!process.argv.includes('--live')) {
  console.log('라이브 평가 미실행: 승인된 환경에서 --live 옵션으로 실행하세요. 외부 호출 0회.');
} else {
  const config = geminiConfig();
  if (!config || config.dailyLimit === 0 || config.sessionLimit === 0) {
    console.log('라이브 평가 차단: 모델·타임아웃·호출 상한 설정을 확인하세요. 외부 호출 0회.');
    process.exitCode = 1;
  } else {
    const fixtures = JSON.parse(await readFile(new URL('../tests/fixtures/llm-eval.json', import.meta.url), 'utf8')) as
      { id: string; text: string; intent: Intent; actions: string[]; restrictions: string[]; conditions?: string[] }[];
    const provider = new GeminiProvider(config);
    const knowledge = new GameEngine().view().knowledge;
    const rows: Record<string, unknown>[] = [];
    for (const fixture of fixtures) {
      const start = performance.now();
      try {
        const result = await interpret(provider, { text: fixture.text, knowledge, context: [], actions: actionVocabulary() }, config.timeoutMs);
        const actual = { intent: result.intent, actions: result.proposedActions.map(action => action.kind),
          restrictions: result.proposedActions.flatMap(action => action.restrictions).sort() };
        const pass = actual.intent === fixture.intent && JSON.stringify(actual.actions) === JSON.stringify(fixture.actions) &&
          JSON.stringify(actual.restrictions) === JSON.stringify([...fixture.restrictions].sort());
        rows.push({ id: fixture.id, pass, actual, expected: { intent: fixture.intent, actions: fixture.actions,
          restrictions: fixture.restrictions, conditions: fixture.conditions ?? [] }, latencyMs: Math.round(performance.now() - start), usage: result.usage });
        console.log(`${fixture.id}: ${pass ? '통과' : '불일치'}`);
      } catch {
        rows.push({ id: fixture.id, pass: false, error: '평가 호출 실패 · 원문 오류 비공개', latencyMs: Math.round(performance.now() - start) });
        console.log(`${fixture.id}: 호출 실패, 추가 호출 중단`);
        break;
      }
    }
    await mkdir(new URL('../artifacts/m2/', import.meta.url), { recursive: true });
    await writeFile(new URL('../artifacts/m2/live-eval.json', import.meta.url), JSON.stringify(rows, null, 2) + '\n');
    process.exitCode = rows.length === fixtures.length && rows.every(row => row.pass) ? 0 : 1;
    console.log('결과: artifacts/m2/live-eval.json. 한국어 자연스러움·출처 적합성은 별도 사람이 검토해야 합니다.');
  }
}
