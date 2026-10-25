import type { ActionPlan } from '../shared/contracts.ts';

// Deliberately small offline grammar. Unknown clauses stay visible, never become fake successes.
export const FIRST_STRIKE = /(?:먼저\s*|선제\s*)?(?:공격|치)[은는]?\s*(?:하)?지\s*[는도은]?\s*(?:마[가-힣]*|말[가-힣]*|않[가-힣]*)|(?:선제)?공격\s*금지[가-힣]*/g;
export const WAR_PROMISE = /참전[은을]?\s*(?:은\s*)?약속(?:하)?지\s*(?:는\s*)?(?:마[가-힣]*|말[가-힣]*|않[가-힣]*)|참전\s*약속\s*(?:금지|없이)/g;
export const HOLD = /확답(?:하)?지\s*(?:는\s*)?(?:마[가-힣]*|말[가-힣]*|않[가-힣]*)|(?:답변|답|회신)[을은]?\s*(?:잠시\s*)?(?:미루|보류)[가-힣]*|시간[을은]?\s*벌[가-힣]*/g;
// Match private wording first: 비공개 contains 공개. Negated/mixed scopes are never guessed.
export function visibility(text: string): 'secret' | 'public' | 'ambiguous' | undefined {
  const secret = /비공개|비밀|몰래|은밀히/.test(text);
  const publicText = text.replace(/비공개/g, '');
  const open = /공개/.test(publicText);
  if ((secret && open) || /(?:비공개|비밀|공개)(?:(?:적으로|적|리에|로)?[는은가를]?\s*(?:(?:하지|하지는|하지도)\s*)?(?:아니|않|말|마(?:[.\s]|$)|금지)|인지|\s*여부)/.test(text)) return 'ambiguous';
  return secret ? 'secret' : open ? 'public' : undefined;
}

export function parseCompound(text: string, providerVocabulary = false): { actions: ActionPlan[]; unresolved: string[] } {
  const actions: ActionPlan[] = [], unresolved: string[] = [];
  // Split explicit actors, not commas: restrictions commonly follow a comma.
  const clauses = text.split(/(?=(?:조조에게|노숙(?:은|에게|더러)|주유(?:는|에게|더러)))/).filter(t => t.trim());
  for (const clause of clauses) {
    const kinds: { kind: ActionPlan['kind']; at: number }[] = [];
    if (/조조/.test(clause) && (clause.match(HOLD) || /회신|답변|답장/.test(clause))) kinds.push({ kind: 'hold-reply', at: clause.indexOf('조조') });
    if (/유비/.test(clause) && /연락|접촉|타진|알아|의중|조건/.test(clause)) kinds.push({ kind: 'sound-out', at: clause.indexOf('유비') });
    const navy = clause.match(providerVocabulary ? /수군|함대|전선|水軍|뱃사람|병선|수병|배들|우리\s*배/ : /수군|함대|전선|水軍/);
    if (navy && (providerVocabulary ? /정비|훈련|조련|점검|준비|채비|갖추|손보|정돈|다듬/ : /정비|훈련|조련|점검|준비/).test(clause)) kinds.push({ kind: 'naval-drill', at: navy.index! });
    if (!kinds.length) { if (clause.replace(/[\s,.，。]/g, '')) unresolved.push(`미지원·모호: ${clause.trim()}`); continue; }
    const scope = visibility(clause);
    if (scope === 'ambiguous') unresolved.push(`공개 범위 확인 필요: ${clause.trim()}`);
    for (const { kind } of kinds.sort((a, b) => a.at - b.at)) {
      const restrictions: ActionPlan['restrictions'] = [];
      if (kind === 'naval-drill' && clause.match(FIRST_STRIKE)) restrictions.push('no-first-strike');
      if (kind === 'sound-out' && clause.match(WAR_PROMISE)) restrictions.push('no-war-promise');
      if (kind === 'hold-reply' && clause.match(HOLD)) restrictions.push('no-firm-answer');
      const conditions: string[] = [];
      if (scope && scope !== 'ambiguous') conditions.push(scope);
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
      actions.push({ kind, target: kind === 'naval-drill' ? 'jiangdong-navy' : kind === 'hold-reply' ? 'cao-cao-envoy' : 'liu-bei',
        assignee: kind === 'naval-drill' ? 'zhou-yu' : kind === 'hold-reply' ? 'zhang-hong' : 'lu-su', restrictions, conditions,
        deadline: deadline ? `${deadline}분 이내` : null });
    }
    // Account for the whole source, not a blacklist of unsupported policy verbs.
    // Unknown residue is retained verbatim; partial execution needs explicit acceptance.
    const remainder = clause.replace(FIRST_STRIKE, '').replace(WAR_PROMISE, '').replace(HOLD, '')
      .replace(/[「“"]([^」”"]+)[」”"]/g, '')
      .replace(/\d+\s*분\s*(?:이내|내에)/g, '').replace(/그\s*뒤|그\s*후|다음에|완료\s*후/g, '')
      .split(/[\s,.，。]+/).filter(token => token && !/^(?:(?:주유|노숙|장굉|공근|조조|유비|수군|함대|전선|水軍|답변|답장|회신|의중|조건|배|뱃사람|병선|수병|장군)(?:에게는|에게|더러|께|가|은|는|을|를|의|와|과|들의|들을|들이)?|(?:정비|훈련|조련|점검|준비|연락|접촉|타진|알아|보류|미루|회신|채비|갖추|손보|정돈|가다듬|다듬)[가-힣]*|(?:비공개|비밀|공개)[가-힣]*|몰래|은밀히|우리|강동|당장|잠시|그리고|또|하고|하라|하되|해|전해|전하라|일러라|라고|고|말고|시키되|하도록|명의?|초안을?|시작할|올려라|지시한다|맡겨라|맡게|맡기도록|담당하도록|태세를|싶다|그|지시의|만들어라)$/.test(token)).join(' ');
    if (remainder) unresolved.push(`미지원·모호 부분 (실행 제외): ${remainder}`);
  }
  return { actions, unresolved };
}
