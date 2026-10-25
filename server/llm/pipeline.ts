import type { Interpretation } from '../mock-interpreter.ts';
import type { Proposal, InterpretationProvider, ProviderInput } from './types.ts';
import { ProviderError } from './types.ts';
import { validateProposal } from './validator.ts';

/** Also races providers that ignore AbortSignal; late work can never reach the engine. */
export async function withDeadline<T>(work: (signal: AbortSignal) => Promise<T>, timeoutMs: number, parent?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  parent?.addEventListener('abort', abort, { once: true });
  if (parent?.aborted) controller.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: () => void = () => {};
  try {
    return await Promise.race([
      Promise.resolve().then(() => { controller.signal.throwIfAborted(); return work(controller.signal); }),
      new Promise<never>((_, reject) => {
        onAbort = () => reject(new ProviderError('PROVIDER_TIMEOUT'));
        controller.signal.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(abort, timeoutMs);
        if (controller.signal.aborted) onAbort();
      }),
    ]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', onAbort);
    controller.abort();
  }
}

export async function interpret(provider: InterpretationProvider, input: ProviderInput, timeoutMs: number): Promise<Proposal> {
  const original = structuredClone(input);
  const raw = await withDeadline(signal => provider.interpret(structuredClone(input), signal), timeoutMs);
  return validateProposal(raw, original);
}

export function toReading(proposal: Proposal): Interpretation {
  if (proposal.intent === 'command') {
    return { intent: 'command', action: 'naval-drill', restrictions: [...proposal.proposedActions[0]!.restrictions], unresolved: [],
      reply: '[AI 해석] 수군 정비 초안을 작성했습니다. 아직 실행하지 않았습니다. 조건을 읽고 확인해 주세요.' };
  }
  // Do not present model-authored completion claims as game results.
  const answer = proposal.intent === 'ambiguous' ? proposal.unresolvedQuestions.join(' ') : proposal.dialogue;
  const dialogue = /완료|실행했|소모했|착수했|끝냈/.test(answer)
    ? '모델 답변에 실행 주장이 있어 표시하지 않았습니다. 엔진은 아무것도 실행하지 않았습니다.'
    : answer;
  return { intent: proposal.intent, reason: 'AI 해석 · 실행 없음', reply: `[AI 해석 · 실행 없음] ${dialogue}` };
}
