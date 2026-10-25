import type { ActionPlan } from '../../shared/contracts.ts';
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

/** Finite Korean guard, evaluated per clause so a plan cannot excuse an adjacent past claim. */
export function hasUnsupportedClaim(text: string): boolean {
  if (/\b(?:card|knowledge|memory)-[\w-]+|PRIVATE_|SERVER_ONLY|UNRELEASED/i.test(text)) return true;
  return text.split(/[.!?。！？;,\n]|하지만|그러나|그리고/).some(clause => {
    // Only explicit non-factual forms; a future word elsewhere is not an exemption.
    const remainder = clause.trim().replace(/(?:출발|도착|수락|완료|실행|착수|소모|접촉|전달|전송)(?:했|됐|한다|한|하였|했다|되었다|했습니다)?(?:다면|라면|는지|할지|라고\s*가정)/g, '');
    const secretAssertion = /(?:비밀|비공개|몰래).*(?:입니다|알고 있|확인했|사실)/.test(remainder)
      && !/(?:계획|예정|가정|검토)(?:입니다|\s*중입니다)|(?:할|될)\s*(?:수|것)|한다면/.test(remainder);
    return secretAssertion || /(?:출발|도착|수락|완료|실행|착수|소모|전달|전송|접촉)(?:했|하였|됐|되었|한 상태|\s*중입니다)|완료(?:입니다|됨|함|$)|맺었|보냈|끝냈|마쳤|군량\s*\d+\s*(?:소모|사용)/.test(remainder);
  });
}

export function toReading(proposal: Proposal): Interpretation {
  if (proposal.intent === 'command') {
    return { intent: 'command', action: proposal.proposedActions[0]!.kind as ActionPlan['kind'], actions: structuredClone(proposal.proposedActions) as ActionPlan[], restrictions: [...proposal.proposedActions[0]!.restrictions], unresolved: [...proposal.unresolvedQuestions],
      reply: '[AI 해석] 명령 초안을 작성했습니다. 아직 실행하지 않았습니다. 조건을 읽고 확인해 주세요.' };
  }
  // Do not present model-authored completion claims as game results.
  const answer = proposal.intent === 'ambiguous' ? proposal.unresolvedQuestions.join(' ') : proposal.dialogue;
  const dialogue = hasUnsupportedClaim(answer)
    ? '모델 답변에 실행 주장이 있어 표시하지 않았습니다. 엔진은 아무것도 실행하지 않았습니다.'
    : answer;
  return { intent: proposal.intent, reason: 'AI 해석 · 실행 없음', reply: `[AI 해석 · 실행 없음] ${dialogue}` };
}
