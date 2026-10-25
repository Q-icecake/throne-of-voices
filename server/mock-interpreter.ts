import { FIRST_STRIKE, parseCompound } from './compound.ts';
import type { ActionPlan, CommandIntent, RestrictionId } from '../shared/contracts.ts';

/**
 * Explicit offline Mock interpreter (M1 naval samples plus M3 compound fixtures). It recognises a handful of fixed test patterns only; it is not
 * a Korean language model and must never be reported as one. No SDK, network, or world access.
 * Anything it cannot place is returned as unsupported with the reason, never coerced into a drill.
 */
export type Interpretation =
  | { intent: 'command'; action: ActionPlan['kind']; actions?: ActionPlan[]; restrictions: RestrictionId[]; unresolved: string[]; reply: string }
  | { intent: Exclude<CommandIntent, 'command'>; reason: string; reply: string };

export interface CommandInterpreter {
  readonly mode: 'mock';
  interpret(text: string): Interpretation;
}

const ATTACK_REQUEST = /공격(해|하라|하게|하시오|하도록|을\s*개시)|진격|습격|쳐들어|들이쳐|출격/;
const HYPOTHETICAL = /(하면|한다면|하는\s*게|하는\s*것은?)\s*(어떨까|어때|어떻습|좋을까|나을까)|척(하|을)/;
const QUESTION = /[?？]\s*$|(어떻게|무엇|뭐야|뭔가|왜|얼마나|어디|누가|있나|있는가|되나|될까|인가)\s*[?？.]?\s*$/;
const NAVAL = /수군|함대|전선|水軍/;
const DRILL = /정비|훈련|조련|점검|준비/;
const OTHER_ASSIGNEE = /(장조|노숙|장굉)(에게|더러|를\s*시켜|이\s*맡|가\s*맡)/;

export class MockCommandInterpreter implements CommandInterpreter {
  readonly mode = 'mock' as const;

  interpret(raw: string): Interpretation {
    const text = raw.trim();
    if (HYPOTHETICAL.test(text)) {
      return { intent: 'hypothetical', reason: '가정·검토로 판단했습니다. 실행하지 않습니다.',
        reply: '[Mock] 가정으로 들었습니다. 논의는 실제 AI 연결(M2) 이후에 가능하며, 지금은 아무것도 실행하지 않습니다.' };
    }
    if (QUESTION.test(text)) {
      return { intent: 'question', reason: '질문으로 판단했습니다. 실행하지 않습니다.',
        reply: '[Mock] 질문으로 들었습니다. 답변은 실제 AI 연결(M2) 이후에 가능하며, 지금은 아무것도 실행하지 않습니다.' };
    }
    if (/논의하자|논의해\s*봐|견해를|생각을|어떻게\s*생각|설명해|비교해/.test(text) && !/정비하라|연락해|보내라|명령/.test(text)) {
      return { intent: 'discussion', reason: '견해를 묻는 논의 · 실행 없음', reply: '[Mock] 논의로 들었습니다. 행동을 실행하지 않습니다.' };
    }
    if (/조조.*(?:답|시간|회신)|유비.*(?:연락|접촉|타진|알아|의중|조건)|정찰|암살|재분배|개혁|그 사람|다른 사람/.test(text)) {
      const { actions, unresolved } = parseCompound(text);
      if (actions.length) return { intent: 'command', action: actions[0]!.kind, actions,
        restrictions: actions[0]!.restrictions, unresolved, reply: '[Mock] 이해한 행동과 미해결 부분을 초안에서 확인해 주세요. 아직 실행하지 않았습니다.' };
    }
    const naval = NAVAL.test(text) && DRILL.test(text);
    const noFirstStrike = Boolean(text.match(FIRST_STRIKE));
    // Strip the negated clause before looking for a real attack request.
    const attack = ATTACK_REQUEST.test(text.replace(FIRST_STRIKE, ''));
    if (attack) {
      return { intent: 'unsupported', reason: '공격·교전 명령은 이 시제품에 구현되어 있지 않습니다.',
        reply: '[Mock] 공격 지시는 아직 처리할 수 없습니다. 정비로 바꿔 실행하지 않았습니다. 원문은 기록에 남겼습니다.' };
    }
    if (naval && OTHER_ASSIGNEE.test(text)) {
      return { intent: 'unsupported', reason: 'M1에서는 수군 정비 담당자를 주유로만 지정할 수 있습니다.',
        reply: '[Mock] M1에서는 주유 외의 담당자를 지정할 수 없습니다. 실행하지 않았습니다.' };
    }
    if (naval) {
      const parsed = parseCompound(text);
      const restrictions: RestrictionId[] = noFirstStrike ? ['no-first-strike'] : [];
      return {
        intent: 'command', action: 'naval-drill', actions: parsed.actions, restrictions, unresolved: parsed.unresolved,
        reply: noFirstStrike
          ? '[Mock] 주유 장군께 수군 정비를 전하되, 먼저 공격하지 말라는 조건을 붙이겠습니다. 확인하시면 전령을 보내겠습니다.'
          : '[Mock] 주유 장군께 수군 정비를 전하겠습니다. 교전 방침에 대한 지시는 없습니다. 확인하시면 전령을 보내겠습니다.',
      };
    }
    return { intent: 'unsupported', reason: 'M1 Mock은 수군 정비 지시와 기본적인 질문·가정만 구분합니다.',
      reply: '[Mock] 이 지시는 아직 처리할 수 없습니다. 원문은 기록에 남겼고 아무것도 실행하지 않았습니다.' };
  }
}

