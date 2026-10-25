import type { ActionPlan } from '../shared/contracts.ts';

// Deliberately small offline grammar. Unknown clauses stay visible, never become fake successes.
export const FIRST_STRIKE = /(?:먼저\s*|선제\s*)?(?:공격|치)[은는을]?\s*(?:하)?지\s*[는도은]?\s*(?:마[가-힣]*|말[가-힣]*|않[가-힣]*)|(?:먼저\s*|선제\s*)?공격[은는을]?\s*(?:금지[가-힣]*|없이|말고)/g;
export const WAR_PROMISE = /(?:참전[은을]?\s*(?:은\s*)?)?약속(?:하)?지\s*(?:는\s*)?(?:마[가-힣]*|말[가-힣]*|않[가-힣]*)|(?:참전[은을]?\s*)?약속[은을]?\s*(?:금지[가-힣]*|없이|말고)/g;
export const HOLD = /(?:확답|답변|답장|답|회신)[은는을]?\s*(?:하)?지\s*(?:는\s*)?(?:마[가-힣]*|말[가-힣]*|않[가-힣]*)|확답[은을]?\s*(?:말고|없이|금지[가-힣]*)|(?:답변|답장|답|회신)[을은는]?\s*(?:잠시\s*)?(?:미루|미뤄|보류)[가-힣]*(?:\s*(?:두어라|둬라|두라고))?|시간[을은]?\s*벌[가-힣]*/g;

const QUOTED = /[「“"]([^」”"]+)[」”"]/g;
const withoutQuotes = (text: string) => text.replace(QUOTED, '');
type Kind = ActionPlan['kind'];
function actionKinds(text: string, providerVocabulary: boolean): { kind: Kind; at: number }[] {
  const source = withoutQuotes(text), kinds: { kind: Kind; at: number }[] = [];
  if (/조조/.test(source) && (source.match(HOLD) || /회신|답변|답장/.test(source))) kinds.push({ kind: 'hold-reply', at: source.indexOf('조조') });
  if (/유비/.test(source) && /연락|접촉|타진|알아|의중|조건/.test(source)) kinds.push({ kind: 'sound-out', at: source.indexOf('유비') });
  const navy = source.match(providerVocabulary ? /수군|함대|전선|水軍|뱃사람|병선|수병|배들|우리\s*배/ : /수군|함대|전선|水軍/);
  if (navy && (providerVocabulary ? /정비|훈련|조련|점검|준비|채비|갖추|손보|손봐|정돈|다듬/ : /정비|훈련|조련|점검|준비/).test(source)) kinds.push({ kind: 'naval-drill', at: navy.index! });
  return kinds.sort((a, b) => a.at - b.at);
}

/** Shared finite grammar: split outside literal replies, then bind modifier-only fragments
 * to an adjacent compatible action. No modifier is copied across action boundaries. */
export function splitActionClauses(text: string, providerVocabulary = false): string[] {
  const literals: string[] = [];
  const masked = text.replace(QUOTED, literal => { literals.push(literal); return `\u0001${literals.length - 1}\u0001`; });
  const pieces = masked.split(/[.,，。;；\n]+|(?<!라고)(?<=[가-힣]고)\s+|(?<=[가-힣]되)\s+|(?<=하며)\s+|(?=(?:주유|공근|노숙|장굉|장조)(?:에게는|에게|더러|한테|께|은|는|를\s*시켜))/)
    .map(part => part.replace(/\u0001(\d+)\u0001/g, (_, index: string) => literals[Number(index)]!).trim()).filter(Boolean);
  const fragments: string[] = [];
  for (const piece of pieces) {
    const prior = fragments.at(-1);
    const before = prior ? actionKinds(prior, providerVocabulary) : [];
    const after = actionKinds(piece, providerVocabulary);
    // A target before a negation and its verb after it still form one action
    // (유비에게 공개하지 말고 연락해). Likewise, coordinated descriptions of
    // the same work are one action, while repeated orders remain separate.
    const sameWork = before.length === 1 && after.length === 1 && before[0]!.kind === after[0]!.kind &&
      /(?:고|되|하며)$/.test(prior!) && !/다시|또|반복|그\s*뒤|그\s*후|다음에|완료\s*후|(?:주유|공근|노숙|장굉|장조)(?:에게|더러|한테|께|은|는)/.test(piece);
    if (prior && ((!before.length && !after.length) || sameWork)) fragments[fragments.length - 1] += ` ${piece}`;
    else fragments.push(piece);
  }
  const kinds = fragments.map(part => actionKinds(part, providerVocabulary).map(a => a.kind));
  const grouped = fragments.map((part, index) => kinds[index]!.length ? [part] : []);
  for (let index = 0; index < fragments.length; index++) {
    if (kinds[index]!.length) continue;
    const part = fragments[index]!;
    const previous = kinds.findLastIndex((k, i) => i < index && k.length > 0);
    const next = kinds.findIndex((k, i) => i > index && k.length > 0);
    const restrictionKinds: Kind[] = [];
    if (part.match(FIRST_STRIKE)) restrictionKinds.push('naval-drill');
    if (part.match(WAR_PROMISE)) restrictionKinds.push('sound-out');
    if (part.match(HOLD)) restrictionKinds.push('hold-reply');
    const compatible = (at: number) => at >= 0 && (!restrictionKinds.length || restrictionKinds.every(k => kinds[at]!.includes(k)));
    const destination = compatible(previous) ? previous : compatible(next) ? next : -1;
    if (destination < 0) grouped[index]!.push(part);
    else if (destination < index) grouped[destination]!.push(part);
    else grouped[destination]!.unshift(part);
  }
  return grouped.filter(parts => parts.length).map(parts => parts.join(' '));
}

/** Remove only modifiers representable on this action, leaving other negations visible. */
export function stripActionQualifiers(text: string, kinds: readonly Kind[]): string {
  let remainder = withoutQuotes(text);
  if (kinds.includes('naval-drill')) remainder = remainder.replace(FIRST_STRIKE, '');
  if (kinds.includes('sound-out')) remainder = remainder.replace(WAR_PROMISE, '');
  if (kinds.includes('hold-reply')) {
    if (remainder.match(HOLD)) remainder = remainder.replace(/아직[은도]?/g, '');
    remainder = remainder.replace(HOLD, '');
  }
  return remainder.replace(/\d+\s*분\s*(?:이내|내에)/g, '').replace(/그\s*뒤|그\s*후|다음에|완료\s*후/g, '');
}
// Match private wording first: 비공개 contains 공개. Negated/mixed scopes are never guessed.
export function visibility(text: string): 'secret' | 'public' | 'ambiguous' | undefined {
  const secret = /비공개|비밀|몰래|은밀히/.test(text);
  const publicText = text.replace(/비공개/g, '');
  const open = /공개/.test(publicText);
  if ((secret && open) || /(?:비공개|비밀|공개)(?:(?:적으로|적|리에|로)?[는은가를]?\s*(?:(?:하지|하지는|하지도)\s*)?(?:아니|않|말|마(?:[.\s]|$)|금지)|인지|\s*여부)/.test(text)) return 'ambiguous';
  return secret ? 'secret' : open ? 'public' : undefined;
}

export function parseCompound(text: string, providerVocabulary = false): { actions: ActionPlan[]; unresolved: string[]; segments: { text: string; actions: ActionPlan[] }[] } {
  const actions: ActionPlan[] = [], unresolved: string[] = [];
  const segments: { text: string; actions: ActionPlan[] }[] = [];
  const clauses = splitActionClauses(text, providerVocabulary);
  for (const clause of clauses) {
    const kinds = actionKinds(clause, providerVocabulary);
    const segment = { text: clause, actions: [] as ActionPlan[] };
    segments.push(segment);
    if (!kinds.length) { if (clause.replace(/[\s,.，。]/g, '')) unresolved.push(`미지원·모호: ${clause.trim()}`); continue; }
    const source = withoutQuotes(clause);
    const scope = visibility(source);
    if (scope === 'ambiguous') unresolved.push(`공개 범위 확인 필요: ${clause.trim()}`);
    for (const { kind } of kinds.sort((a, b) => a.at - b.at)) {
      const restrictions: ActionPlan['restrictions'] = [];
      if (kind === 'naval-drill' && source.match(FIRST_STRIKE)) restrictions.push('no-first-strike');
      if (kind === 'sound-out' && source.match(WAR_PROMISE)) restrictions.push('no-war-promise');
      if (kind === 'hold-reply' && source.match(HOLD)) restrictions.push('no-firm-answer');
      const conditions: string[] = [];
      if (scope && scope !== 'ambiguous') conditions.push(scope);
      if (/그\s*뒤|그\s*후|다음에|완료\s*후/.test(source)) {
        if (actions.length) conditions.push(`after:${actions.length - 1}`);
        else unresolved.push('선행 작업을 지정해야 합니다.');
      }
      const deadline = source.match(/(\d+)\s*분\s*(?:이내|내에)/)?.[1];
      if (kind === 'hold-reply' && !restrictions.includes('no-firm-answer')) {
        const message = clause.match(/[「“"]([^」”"]+)[」”"]/)?.[1];
        if (!message) { unresolved.push('회신할 문구를 따옴표로 지정해야 합니다.'); continue; }
        conditions.push(`message:${message}`);
      }
      const action: ActionPlan = { kind, target: kind === 'naval-drill' ? 'jiangdong-navy' : kind === 'hold-reply' ? 'cao-cao-envoy' : 'liu-bei',
        assignee: kind === 'naval-drill' ? 'zhou-yu' : kind === 'hold-reply' ? 'zhang-hong' : 'lu-su', restrictions, conditions,
        deadline: deadline ? `${deadline}분 이내` : null };
      actions.push(action); segment.actions.push(action);
    }
    // Account for the whole source, not a blacklist of unsupported policy verbs.
    // Unknown residue is retained verbatim; partial execution needs explicit acceptance.
    const remainder = stripActionQualifiers(clause, kinds.map(a => a.kind))
      // Delegation and the target's side add no new action or qualifier.
      .replace(/(?<![가-힣])맡아(?=\s|$)/g, '')
      .replace(/(?<![가-힣])측[을의]?(?=\s|$)/g, '')
      .split(/[\s,.，。]+/).filter(token => token && !/^(?:(?:주유|노숙|장굉|공근|조조|유비|수군|함대|전선|水軍|답변|답장|회신|의중|조건|배|뱃사람|병선|수병|장군)(?:에게는|에게|더러|한테|께|가|은|는|을|를|의|와|과|들의|들을|들이)?|(?:정비|훈련|조련|점검|준비|연락|접촉|타진|알아|보류|미루|회신|채비|갖추|손보|손봐|정돈|가다듬|다듬)[가-힣]*|(?:비공개|비밀|공개)[가-힣]*|몰래|은밀히|우리|강동|당장|잠시|그리고|또|하고|하라|하되|해|전해|전하라|일러라|라고|고|말고|시키되|하도록|명의?|초안을?|시작할|올려라|달라|줘|주어라|주라|지시한다|맡겨라|맡게|맡기도록|담당하도록|태세를|싶다|그|지시의|만들어라)$/.test(token)).join(' ');
    if (remainder) unresolved.push(`미지원·모호 부분 (실행 제외): ${remainder}`);
  }
  return { actions, unresolved, segments };
}
