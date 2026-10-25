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
const FIRST_STRIKE = /(?:먼저\s*|선제\s*)?(?:공격|치)[은는]?\s*(?:하)?지\s*[는도은]?\s*(?:마[가-힣]*|말[가-힣]*|않[가-힣]*)|(?:선제)?공격\s*금지/g;
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
  const ids = new Set(input.knowledge.documents.map(doc => doc.id));
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
  if (proposal.intent !== 'command') return proposal;
  if (proposal.proposedActions.length !== 1) return clarify('현재는 수군 정비 한 가지씩만 확인할 수 있습니다. 어떤 지시를 먼저 검토할까요?');
  if (proposal.unresolvedQuestions.length) return clarify(proposal.unresolvedQuestions[0]!);
  const action = proposal.proposedActions[0]!;
  const negative = NEGATION.test(input.text);
  const knownNegative = input.text.match(FIRST_STRIKE);
  if ((negative && !action.restrictions.length) ||
    (knownNegative && !action.restrictions.includes('no-first-strike')) ||
    NEGATION.test(input.text.replace(FIRST_STRIKE, '')) || CONDITIONAL.test(input.text.replace(FIRST_STRIKE, '')) ||
    action.conditions.length || action.deadline !== null) {
    return clarify('금지·조건 또는 기한을 안전하게 반영하지 못했습니다. 지켜야 할 조건을 구체적으로 알려 주시겠습니까?');
  }
  if (/(장조|노숙|장굉)(에게|더러|를\s*시켜)/.test(input.text)) return clarify('현재 정비 수행자는 주유입니다. 수행자를 다시 지정해 주시겠습니까?');
  if (/(조조|유비|적군|북방)(의\s*|군\s*)?(수군|함대|병선)|조조군/.test(input.text)) return clarify('현재 정비 대상은 강동 수군입니다. 대상을 다시 지정해 주시겠습니까?');
  return proposal;
}
