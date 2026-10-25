// Wire contracts only. Never import a server module or fixture into the browser.
export type CharacterId = 'zhang-hong' | 'zhang-zhao' | 'zhou-yu' | 'lu-su';
export type PauseReason = 'manual' | 'typing' | 'provider' | 'confirmation' | 'background';
export const PAUSE_REASONS: readonly PauseReason[] = ['manual', 'typing', 'provider', 'confirmation', 'background'];

export interface ClockState {
  elapsedMs: number;
  activeMs: number;
  heldMs: number;
  pauseReasons: PauseReason[];
}

export interface PublicDocument {
  id: string;
  title: string;
  claim: string;
  source: string;
  observedAtMs: number;
  arrivedAtMs: number;
  evidence: string;
  region: string;
  provenance: 'test-reconstruction';
}

export interface KnowledgeView {
  viewer: 'player' | CharacterId;
  documents: PublicDocument[];
}

export interface PlayerView {
  schemaVersion: 1;
  scenario: 'm0-fixture-v1';
  sessionId: string;
  revision: number;
  mode: 'mock';
  clock: ClockState;
  player: { name: string; locationLabel: string };
  characters: { id: CharacterId; name: string; role: string }[];
  knowledge: KnowledgeView;
}

export interface LLMRequest {
  text: string;
  knowledge: KnowledgeView;
}

// No executable action vocabulary is introduced in M0.
export interface LLMResult {
  provider: 'mock';
  intent: 'unsupported';
  dialogue: string;
  proposedActions: never[];
  unresolvedQuestions: string[];
  referencedKnowledgeIds: string[];
  usage: { inputTokens: 0; outputTokens: 0; costUsd: 0; externalCalls: 0 };
}

export type TestAction =
  | { type: 'advance-clock'; milliseconds: number }
  | { type: 'set-pause'; reason: PauseReason; paused: boolean }
  | { type: 'mock-probe'; text: string };

export interface PublicLogRecord {
  id: string;
  atActiveMs: number;
  kind: 'reset' | TestAction['type'];
  summary: string;
}

export interface PublicSnapshot {
  visibility: 'player';
  state: PlayerView;
  logs: PublicLogRecord[];
}

export interface ActionResponse {
  state: PlayerView;
  result?: LLMResult;
}
