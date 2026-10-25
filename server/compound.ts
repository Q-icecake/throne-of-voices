import type { ActionPlan } from '../shared/contracts.ts';

// Deliberately small offline grammar. Unknown clauses stay visible, never become fake successes.
export const FIRST_STRIKE = /(?:먼저\s*|선제\s*)?(?:공격|치)[은는]?\s*(?:하)?지\s*[는도은]?\s*(?:마[가-힣]*|말[가-힣]*|않[가-힣]*)|(?:선제)?공격\s*금지/g;
export const WAR_PROMISE = /참전[은을]?\s*(?:은\s*)?약속(?:하)?지\s*(?:는\s*)?(?:마[가-힣]*|말[가-힣]*|않[가-힣]*)|참전\s*약속\s*(?:금지|없이)/g;
export const HOLD = /확답(?:하)?지\s*(?:는\s*)?(?:마[가-힣]*|말[가-힣]*|않[가-힣]*)|(?:답변|답|회신)[을은]?\s*(?:잠시\s*)?(?:미루|보류)|시간[을은]?\s*벌/g;
export function parseCompound(text: string): { actions: ActionPlan[]; unresolved: string[] } {
  const actions: ActionPlan[] = [], unresolved: string[] = [];
  // Split explicit actors, not commas: restrictions commonly follow a comma.
  const clauses = text.split(/(?=(?:조조에게|노숙(?:은|에게|더러)|주유(?:는|에게|더러)))/).filter(t => t.trim());
  for (const clause of clauses) {
    let kind: ActionPlan['kind'] | undefined;
    if (/조조/.test(clause) && (HOLD.test(clause) || /회신|답변|답장/.test(clause))) kind = 'hold-reply';
    HOLD.lastIndex = 0;
    if (/유비/.test(clause) && /연락|접촉|타진|알아|의중|조건/.test(clause)) kind = 'sound-out';
    if (/수군|함대|전선|水軍/.test(clause) && /정비|훈련|조련|점검|준비/.test(clause)) kind = 'naval-drill';
    if (!kind) { if (clause.replace(/[\s,.，。]/g, '')) unresolved.push(`미지원·모호: ${clause.trim()}`); continue; }
    const restrictions: ActionPlan['restrictions'] = [];
    if (kind === 'naval-drill' && clause.match(FIRST_STRIKE)) restrictions.push('no-first-strike');
    if (kind === 'sound-out' && clause.match(WAR_PROMISE)) restrictions.push('no-war-promise');
    if (kind === 'hold-reply' && clause.match(HOLD)) restrictions.push('no-firm-answer');
    const conditions: string[] = [];
    if (/비밀/.test(clause)) conditions.push('secret');
    else if (/공개/.test(clause)) conditions.push('public');
    if (/그\s*뒤|그\s*후|다음에|완료\s*후/.test(clause)) {
      if (actions.length) conditions.push(`after:${actions.length - 1}`);
      else unresolved.push('선행 작업을 지정해야 합니다.');
    }
    const deadline = clause.match(/(\d+)\s*분\s*(?:이내|내에)/)?.[1];
    if (kind === 'hold-reply' && !restrictions.includes('no-firm-answer')) {
      const message = clause.match(/[「“"]([^」”"]+)[」”"]/)?.[1];
      if (!message) { unresolved.push('회신할 문구를 따옴표로 지정해야 합니다.'); continue; }
      conditions.push(`message:${message}`);
    }
    const remainder = clause.replace(FIRST_STRIKE, '').replace(WAR_PROMISE, '').replace(HOLD, '');
    if (/정찰|암살|개혁|재분배|공격하|공격해|그 사람|다른 사람/.test(remainder)) {
      unresolved.push(`미지원·모호 부분 (실행 제외): ${remainder.trim()}`);
    }
    actions.push({ kind, target: kind === 'naval-drill' ? 'jiangdong-navy' : kind === 'hold-reply' ? 'cao-cao-envoy' : 'liu-bei',
      assignee: kind === 'naval-drill' ? 'zhou-yu' : kind === 'hold-reply' ? 'zhang-hong' : 'lu-su', restrictions, conditions,
      deadline: deadline ? `${deadline}분 이내` : null });
  }
  return { actions, unresolved };
}
