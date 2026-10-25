import type { CharacterId } from '../../shared/contracts.ts';
import type { Intent, Proposal, ProviderInput } from '../../server/llm/types.ts';
import type { SecretGuard } from '../../server/llm/secrets.ts';
import type { NetworkMode, NetworkRoute } from '../../shared/contracts.ts';

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
export interface EvalNetwork { networkMode: NetworkMode; route: NetworkRoute; pacUnsupported: boolean }
export type CaptureStatus = 'captured' | 'not-received' | 'oversize' | 'blocked';
export interface Sample {
  /** Legacy name: adapter output, already guarded. Never the model original. */
  raw?: unknown;
  modelRaw?: unknown; modelRawStatus?: CaptureStatus; neutralError?: string;
  error?: string; attempts: Attempt[]; reservations: number; network?: EvalNetwork;
}
export interface Source {
  model: string; timeoutMs: number;
  /** Private credential guard shared with evaluation/export boundaries. */
  secretGuard?: SecretGuard;
  counterPolicy?: 'shared-play-daily' | 'isolated-test';
  networkPolicy?: NetworkMode | 'provider-managed';
  maxOutputTokens?: number;
  sample(fixture: EvalCase, input: ProviderInput): Promise<Sample>;
}
export interface Score { pass: boolean; issues: string[]; safetyViolations: string[]; intent: string }
