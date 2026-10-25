import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MockCommandInterpreter } from '../server/mock-interpreter.ts';
import { GameEngine } from '../server/engine.ts';
// 현재 worktree의 오프라인 파서만 점검한다. M4/M5 자동 플레이 시험이 아니다.
const scenarios = JSON.parse(readFileSync(new URL('./opening/test-scenarios.json', import.meta.url), 'utf8')).scenarios;
globalThis.fetch = async () => { throw new Error('NETWORK_FORBIDDEN'); };
const seen = new Set();
let commands = 0, questions = 0, unsupported = 0;
for (const s of scenarios) for (const step of s.steps) if (step.input.kind === '문장' && !seen.has(step.input.text)) {
  seen.add(step.input.text);
  const got = new MockCommandInterpreter().interpret(step.input.text);
  if (step.provider.mock === '명령 지원') {
    assert.equal(got.intent, 'command', step.input.text);
    assert.deepEqual(got.unresolved, [], step.input.text);
    commands++;
  } else if (step.provider.mock === '질문 분류만') { assert.equal(got.intent, 'question', step.input.text); questions++; }
  else { assert.equal(got.intent, 'unsupported', step.input.text); unsupported++; }
  console.log(`${s.id}: ${step.provider.mock} → ${got.intent}`);
}
for (const id of ['S06', 'S10']) {
  const s = scenarios.find(s => s.id === id), e = new GameEngine();
  e.dispatch({ type: 'advance-clock', milliseconds: 60000 });
  e.dispatch({ type: 'advance-clock', milliseconds: 10000 });
  const out = (await e.command({ type: 'submit', text: s.steps.find(x => x.input.kind === '문장').input.text })).outcome;
  assert.equal(out.kind, 'draft');
  await e.command({ type: 'confirm', draftId: out.draftId, version: out.version });
  e.dispatch({ type: 'advance-clock', milliseconds: 10000 });
  const request = e.internalSnapshot().world.diplomacy.requests[0];
  if (id === 'S06') assert.equal(request.status, 'answered');
  else { assert.equal(request.status, 'held'); assert.equal(request.heldUntilMs, 370000); }
  console.log(id, JSON.stringify(request));
}
console.log(`문장 표시 검증 통과: ${seen.size}개 (명령 ${commands}, 질문 분류만 ${questions}, 미지원 ${unsupported}); S06·S10 요청 상태 확인`);
