/**
 * A conservative Korean morphology heuristic, NOT a semantic truth verifier.
 * Live AI can still evade these stems or trigger false positives. Recognized
 * assertions require exact, scoped engine evidence; similar words are not proof.
 */
const action = '(?:완료|체결|출발|도착|성사|합의|수락|마무리|실행|착수|소모|사용|전달|전송|접촉|협상|정비|파견|발송|확정|진행|처리|승낙|종결|타결|성립)';
const past = '(?:했|하였|하셨|되었|됐|되셨|되어|돼|(?:한|된)\\s*(?:상태|것|바|사실)|이루어졌|이뤄졌|지었|지으셨|중(?:입니다|이다)|하고\\s*있|되고\\s*있)';
const assertion = new RegExp(`${action}(?:[을를이가은는]\\s*)?\\s*(?:${past}|(?:하|되)기?를?\\s*완료)|(?:떠났|떠나셨|보냈|보내셨|끝냈|끝내셨|마쳤|마치셨|맺었|맺으셨|맺어졌)|완료(?:입니다|됨|함|$)|군량\\s*\\d+\\s*(?:소모|사용)`, 'g');
const normalize = (text: string) => text.trim().replace(/\s+/g, ' ').replace(/[.!?。！？]+$/, '');
const clauses = (text: string) => text.split(/[.!?。！？;,\n]|하지만|그러나|그리고/).map(normalize).filter(Boolean);

export interface ClaimEvidence {
  /** Canonical statements generated from task lifecycle records, never model text. */
  facts?: readonly string[];
  /** Scoped records may be quoted as records, not silently promoted to world truth. */
  quotations?: readonly string[];
}

export function hasUnsupportedClaim(text: string, evidence: ClaimEvidence = {}): boolean {
  if (/\b(?:card|knowledge|memory)-[\w-]+|PRIVATE_|SERVER_ONLY|UNRELEASED/i.test(text)) return true;
  const facts = new Set((evidence.facts ?? []).map(normalize));
  // Only the exact contents of an explicitly attributed engine-record quotation.
  const unquoted = text.replace(/(?:원문 일부는 “([^”]+)”|기록에는 「([^」]+)」라고 남아 있습니다)/g, (whole, excerpt: string | undefined, record: string | undefined) => {
    const quoted = excerpt ?? record!;
    return evidence.quotations?.some(item => record ? item === quoted : item.split(/[.!?]/)[0]!.slice(0, 140) === quoted) ? '기록 인용' : whole;
  });
  return clauses(unquoted).some(clause => {
    if (facts.has(clause)) return false;
    const secretAssertion = /(?:비밀|비공개|몰래).*(?:입니다|알고 있|확인했|사실(?!처럼))/.test(clause)
      && !/(?:계획|예정|가정|검토)(?:입니다|\s*중입니다)|(?:할|될)\s*(?:수|것)|한다면/.test(clause);
    if (secretAssertion) return true;
    for (const match of clause.matchAll(assertion)) {
      const tail = clause.slice(match.index! + match[0].length);
      // Exempt only the matched predicate's conditional/question/assumption suffix.
      // A plan elsewhere in the sentence never excuses a completed assertion.
      if (/^(?:습니다|다|었다|었다고|다고|다고는|습니다라고)?\s*(?:다면|더라면|으면|어야|야|는지|을지|을\s*(?:경우|때|수)|라고\s*가정|고\s*가정|는\s*가정)/.test(tail)) continue;
      return true;
    }
    return false;
  });
}
