import type { ActionPlan } from '../../shared/contracts.ts';
import type { Interpretation } from '../mock-interpreter.ts';
import type { Proposal, InterpretationProvider, ProviderInput } from './types.ts';
import { ProviderError } from './types.ts';
import { validateProposal } from './validator.ts';
import { hasUnsupportedClaim } from './claims.ts';
export { hasUnsupportedClaim } from './claims.ts';

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

export function toReading(proposal: Proposal, guard = (text: string) => hasUnsupportedClaim(text)
  ? '확인된 기록이 없어 말씀드릴 수 없습니다.' : text): Interpretation {
  if (proposal.intent === 'command') {
    return { intent: 'command', action: proposal.proposedActions[0]!.kind as ActionPlan['kind'], actions: structuredClone(proposal.proposedActions) as ActionPlan[], restrictions: [...proposal.proposedActions[0]!.restrictions], unresolved: [...proposal.unresolvedQuestions],
      reply: '[AI 해석] 명령 초안을 작성했습니다. 아직 실행하지 않았습니다. 조건을 읽고 확인해 주세요.' };
  }
  // Do not present model-authored completion claims as game results.
  const answer = proposal.intent === 'ambiguous' ? proposal.unresolvedQuestions.join(' ') : proposal.dialogue;
  const dialogue = guard(answer);
  return { intent: proposal.intent, reason: 'AI 해석 · 실행 없음', reply: `[AI 해석 · 실행 없음] ${dialogue}` };
}
