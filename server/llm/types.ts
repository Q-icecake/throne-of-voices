import type { KnowledgeView, RestrictionId } from '../../shared/contracts.ts';

export type Intent = 'question' | 'discussion' | 'command' | 'ambiguous' | 'unsupported';
export interface ActionVocabulary {
  kind: string;
  description: string;
  targets: string[];
  assignees: string[];
  restrictions: RestrictionId[];
}
export interface ProviderInput {
  character?: {
    id: import('../../shared/contracts.ts').CharacterId;
    identity: string; stance: string; expertise: string; concerns: string;
    relationship: string;
    cards: { id: string; claim: string }[];
    memories: { eventId: string; fact: string; witnesses: import('../../shared/contracts.ts').CharacterId[] }[];
    memorySummary: { text: string; eventIds: string[] };
  };
  text: string;
  knowledge: KnowledgeView;
  context: { role: 'player' | 'assistant'; text: string }[];
  actions: ActionVocabulary[];
}
export interface Proposal {
  intent: Intent;
  dialogue: string;
  proposedActions: {
    kind: string; target: string; assignee: string;
    conditions: string[]; restrictions: RestrictionId[]; deadline: string | null;
  }[];
  unresolvedQuestions: string[];
  referencedKnowledgeIds: string[];
  usage: { inputTokens: number; outputTokens: number; externalCalls: number; costUsd: number | null };
}
export interface InterpretationProvider {
  readonly source: 'AI';
  readonly status: string;
  interpret(input: ProviderInput, signal: AbortSignal): Promise<unknown>;
}
export class ProviderError extends Error {
  readonly code: 'PROVIDER_ERROR' | 'PROVIDER_TIMEOUT' | 'CALL_LIMIT' | 'INVALID_PROPOSAL';
  constructor(code: ProviderError['code']) { super(code); this.code = code; }
}
