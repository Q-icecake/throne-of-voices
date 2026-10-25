import type { CharacterId } from '../../shared/contracts.ts';
import type { Intent, Proposal, ProviderInput } from '../../server/llm/types.ts';

export type Action = Proposal['proposedActions'][number];
export interface EvalCase {
  id: string; suite: 'command' | 'npc'; split: 'dev' | 'final'; family: string;
  text: string; tags: string[]; intent: Intent; actions: Action[];
  mustNotDo: string[]; clarify: boolean;
  npc?: {
    character: CharacterId; audience: CharacterId[]; pair: string;
    shared: boolean; allowedKnowledgeIds: string[]; forbiddenMarkers: string[];
    facts: string[]; tone: string;
  };
}
export interface Attempt {
  latencyMs: number; inputTokens: number | null; outputTokens: number | null;
  error?: string; status?: number;
}
export interface Sample { raw?: unknown; error?: string; attempts: Attempt[]; reservations: number }
export interface Source {
  model: string; timeoutMs: number;
  sample(fixture: EvalCase, input: ProviderInput): Promise<Sample>;
}
export interface Score { pass: boolean; issues: string[]; safetyViolations: string[]; intent: string }
