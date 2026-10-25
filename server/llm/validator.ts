import { FIRST_STRIKE as STRIKE, WAR_PROMISE, HOLD, parseCompound } from '../compound.ts';
import { readFileSync } from 'node:fs';
import type { ActionVocabulary, Proposal, ProviderInput } from './types.ts';
import { ProviderError } from './types.ts';

export const OUTPUT_SCHEMA = JSON.parse(readFileSync(new URL('./output.schema.json', import.meta.url), 'utf8')) as Schema;
const registry = JSON.parse(readFileSync(new URL('./actions.json', import.meta.url), 'utf8')) as ActionVocabulary[];
export const actionVocabulary = (): ActionVocabulary[] => structuredClone(registry);

interface Schema {
  type: string | string[]; enum?: unknown[]; properties?: Record<string, Schema>; required?: string[];
  additionalProperties?: boolean; items?: Schema; maxItems?: number; uniqueItems?: boolean;
  minLength?: number; maxLength?: number; minimum?: number; maximum?: number;
}
const invalid = (): never => { throw new ProviderError('INVALID_PROPOSAL'); };
// Deliberately supports exactly the keywords in our versioned schema; no coercion or defaults.
function matches(value: unknown, schema: Schema): void {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (!types.includes(type) && !(type === 'number' && types.includes('integer') && Number.isSafeInteger(value))) invalid();
  if (schema.enum && !schema.enum.includes(value)) invalid();
  if (typeof value === 'string' && (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity))) invalid();
  if (typeof value === 'number' && (!Number.isFinite(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) invalid();
  if (Array.isArray(value)) {
    if (value.length > (schema.maxItems ?? Infinity) || (schema.uniqueItems && new Set(value).size !== value.length)) invalid();
    for (const item of value) matches(item, schema.items!);
  } else if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    if (schema.required?.some(key => !Object.hasOwn(object, key))) invalid();
    for (const [key, item] of Object.entries(object)) {
      const child = schema.properties && Object.hasOwn(schema.properties, key) ? schema.properties[key] : undefined;
      if (!child) { if (schema.additionalProperties === false) invalid(); }
      else matches(item, child);
    }
  }
}

const NEGATION = /지\s*(?:는\s*)?(?:마|말|않)|금지|(?<![가-힣])안(?:\s+|(?=하|해|쓰|쓸|보내|움직|공격))|말고|없이|못하게/;
const CONDITIONAL = /경우|만약|때까지|기한|내일|오늘까지|이후에|전까지|\d+\s*(시간|일|분)\s*(내|후)|[가-힣]+(?:으면|라면|다면|되면|오면|하면|거든)|정비하지/;

export function validateProposal(raw: unknown, input: ProviderInput): Proposal {
  let value = raw;
  if (typeof raw === 'string') {
    if (raw.length > 16000) invalid();
    try { value = JSON.parse(raw); } catch { invalid(); }
  }
  matches(value, OUTPUT_SCHEMA);
  const proposal = structuredClone(value) as Proposal;
  if (!/[가-힣]/.test(proposal.dialogue) || proposal.unresolvedQuestions.some(q => !/[가-힣]/.test(q))) invalid();
  const ids = new Set([...input.knowledge.documents.map(doc => doc.id), ...(input.character?.cards.map(card => card.id) ?? [])]);
  if (proposal.referencedKnowledgeIds.some(id => !ids.has(id))) invalid();
  for (const action of proposal.proposedActions) {
    const vocabulary = registry.find(entry => entry.kind === action.kind);
    if (!vocabulary || !vocabulary.targets.includes(action.target) || !vocabulary.assignees.includes(action.assignee) ||
      action.restrictions.some(id => !vocabulary.restrictions.includes(id))) invalid();
  }
  if (proposal.intent !== 'command' && proposal.proposedActions.length) invalid();
  const clarify = (question: string): Proposal => ({ ...proposal, intent: 'ambiguous', proposedActions: [],
    dialogue: question, unresolvedQuestions: [question] });
  if (proposal.intent === 'ambiguous' && !proposal.unresolvedQuestions.length) return clarify('어떤 대상에게 무엇을 지시할지 알려 주시겠습니까?');
  const parsed = parseCompound(input.text, true);
  if (proposal.intent !== 'command') {
    if (parsed.actions.length && !/[?？]|어떨|어때|한다면|하면|하는\s*(?:게|것)/.test(input.text))
      return clarify('원문의 행동과 제안 의도가 다릅니다. 실행할 행동을 다시 확인해 주세요.');
    return proposal;
  }
  if (/[?？]|어떨|어때|좋을까|나을까|척(?:하|을)/.test(input.text))
    return clarify('질문·가정과 실행 명령을 구분해야 합니다. 실제로 지시할 행동인지 확인해 주세요.');
  // Explicit assignments cannot be silently replaced by the vocabulary's default actor.
  if (/(장조|노숙|장굉)(?:은|는|에게|더러)[^.,]*수군|(?:주유|장조|장굉)(?:은|는|에게|더러)[^.,]*유비|(?:주유|노숙|장조)(?:은|는|에게|더러)[^.,]*조조/.test(input.text.replace(/장굉은\s*(?=주유에게)/g, '')))
    return clarify('지정한 담당자는 이 행동을 수행할 수 없습니다. 담당자를 다시 지정해 주세요.');
  if (!proposal.proposedActions.length || proposal.proposedActions.length > 3 ||
    new Set(proposal.proposedActions.map(a => a.kind)).size !== proposal.proposedActions.length)
    return clarify('한 초안은 서로 다른 행동 최대 세 개입니다. 나누어 확인해 주세요.');
  if (parsed.unresolved.some(q => q.startsWith('공개 범위 확인 필요:')))
    return clarify('공개·비밀 표현이 혼재하거나 부정되어 있습니다. 행동별 공개 범위를 다시 지정해 주세요.');
  const missing = parsed.actions.filter(a => !proposal.proposedActions.some(p => p.kind === a.kind));
  if (missing.length) {
    const labels = { 'naval-drill': '수군 정비', 'sound-out': '유비 타진', 'hold-reply': '조조 답변 보류·회신' };
    return clarify(`원문의 행동 일부가 빠졌습니다: ${missing.map(a => labels[a.kind]).join(', ')}. 실행 범위를 다시 지정해 주세요.`);
  }
  if (proposal.proposedActions.some(a => a.conditions.some(c => c.startsWith('after:'))) &&
    JSON.stringify(proposal.proposedActions.map(a => a.kind)) !== JSON.stringify(parsed.actions.map(a => a.kind)))
    return clarify('선후관계가 있는 행동 순서가 원문과 다릅니다. 다시 지정해 주세요.');
  const stripKnown = (text: string) => text.replace(STRIKE, '').replace(WAR_PROMISE, '').replace(HOLD, '')
    .replace(/\d+\s*분\s*(?:이내|내에)/g, '').replace(/그\s*뒤|그\s*후|다음에|완료\s*후/g, '');
  // Fail closed for unknown prohibitions/conditional logic, including omitted model conditions.
  if (NEGATION.test(stripKnown(input.text)) || CONDITIONAL.test(stripKnown(input.text)))
    return clarify('금지·조건 또는 기한을 안전하게 반영하지 못했습니다. 조건을 구체적으로 알려 주세요.');
  for (const [index, action] of proposal.proposedActions.entries()) {
    const source = parsed.actions.find(a => a.kind === action.kind);
    if (action.conditions.some(c => !['secret', 'public', 'after:0', 'after:1'].includes(c) && !c.startsWith('message:')) ||
      (action.conditions.includes('secret') && action.conditions.includes('public')) ||
      action.conditions.some(c => c.startsWith('after:') && Number(c.slice(6)) >= index) ||
      (action.deadline !== null && !/^[1-9]\d{0,2}분 이내$/.test(action.deadline)))
      return clarify('지원하지 않는 조건·기한 또는 선행 관계입니다. 다시 지정해 주세요.');
    if (!source || JSON.stringify([...source.restrictions].sort()) !== JSON.stringify([...action.restrictions].sort()) ||
      JSON.stringify([...source.conditions].sort()) !== JSON.stringify([...action.conditions].sort()) || source.deadline !== action.deadline)
      return clarify('원문의 담당·대상·금지·공개 범위·기한을 보존하지 못했습니다. 다시 지정해 주세요.');
  }
  proposal.unresolvedQuestions = [...new Set([...proposal.unresolvedQuestions, ...parsed.unresolved])];
  if (/(장조|노숙|장굉)(에게|더러|를\s*시켜)[^.,]*수군/.test(input.text)) return clarify('현재 정비 수행자는 주유입니다. 수행자를 다시 지정해 주시겠습니까?');
  if (/(조조|유비|적군|북방)(의\s*|군\s*)?(수군|함대|병선)|조조군/.test(input.text)) return clarify('현재 정비 대상은 강동 수군입니다. 대상을 다시 지정해 주시겠습니까?');
  return proposal;
}
