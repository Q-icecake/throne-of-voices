import { main } from './eval/run.ts';

try { process.exitCode = await main(); }
catch { console.error('평가 설정/fixture 오류 · 원문 비공개. docs/EVAL.md 사용법을 확인하세요.'); process.exitCode = 2; }
