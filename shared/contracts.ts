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
  /** Set only on reports generated from a task. */
  taskId?: string;
}

export interface KnowledgeView {
  viewer: 'player' | CharacterId;
  documents: PublicDocument[];
}

// ---- M1 command vocabulary. Only one executable action exists in M1. ----

export type CommandActionKind = 'naval-drill';
export type RestrictionId = 'no-first-strike';
export type EngagementPolicy = 'hold' | 'no-first-strike';

export interface Restriction { id: RestrictionId; label: string }
export interface PersonRef { id: CharacterId; name: string }

export interface CommandEstimate {
  grain: number;
  deliveryMs: number;
  workMs: number;
  readinessGain: number;
}

export type DraftStatus = 'awaiting-confirmation' | 'confirmed' | 'cancelled' | 'rejected';

export interface CommandDraftView {
  id: string;
  version: number;
  status: DraftStatus;
  text: string;
  action: CommandActionKind;
  actionLabel: string;
  target: string;
  assignee: PersonRef;
  messenger: PersonRef;
  restrictions: Restriction[];
  estimate: CommandEstimate;
  unresolved: string[];
  statusNote?: string;
  taskId?: string;
}

export type TaskStage = 'delivering' | 'in-progress' | 'completed';

export interface TaskView {
  id: string;
  draftId: string;
  draftVersion: number;
  action: CommandActionKind;
  actionLabel: string;
  assignee: PersonRef;
  restrictions: Restriction[];
  stage: TaskStage;
  registeredAtMs: number;
  deliveredAtMs?: number;
  completedAtMs?: number;
  grainSpent: number;
  reportIds: string[];
}

/** Recorded ledger entry, not live truth: values are as of `recordedAtMs`. */
export interface LedgerView {
  recordedAtMs: number;
  source: string;
  navalReadiness: number;
  grain: number;
  engagementPolicy: EngagementPolicy;
}

export interface PlayerView {
  schemaVersion: 1;
  scenario: 'm1-fixture-v1';
  sessionId: string;
  revision: number;
  mode: 'mock';
  clock: ClockState;
  player: { name: string; locationLabel: string };
  characters: { id: CharacterId; name: string; role: string }[];
  knowledge: KnowledgeView;
  ledger: LedgerView;
  drafts: CommandDraftView[];
  tasks: TaskView[];
}

export interface LLMRequest {
  text: string;
  knowledge: KnowledgeView;
}

// The M0 probe provider never proposes actions. M1 commands use a separate Mock interpreter.
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

export type CommandRequest =
  | { type: 'submit'; text: string }
  | { type: 'revise'; draftId: string; version: number; text: string }
  | { type: 'cancel'; draftId: string; version: number }
  | { type: 'confirm'; draftId: string; version: number };

export type CommandIntent = 'command' | 'question' | 'hypothetical' | 'unsupported';

export type RejectionCode =
  | 'DRAFT_NOT_FOUND' | 'DRAFT_VERSION_OUTDATED' | 'DRAFT_CANCELLED' | 'DRAFT_REJECTED'
  | 'DRAFT_ALREADY_CONFIRMED' | 'REVISION_NOT_COMMAND'
  | 'TASK_CONFLICT' | 'GRAIN_SHORT' | 'ASSIGNEE_BUSY';

export type CommandOutcome =
  | { kind: 'draft'; draftId: string; version: number; reply: string }
  | { kind: 'answer'; intent: Exclude<CommandIntent, 'command'>; reply: string; reason: string }
  | { kind: 'confirmed'; draftId: string; taskId: string; duplicate: boolean; reply: string }
  | { kind: 'cancelled'; draftId: string; reply: string }
  | { kind: 'rejected'; code: RejectionCode; reply: string };

export type LogKind =
  | 'reset' | TestAction['type']
  | 'command-submit' | 'command-revise' | 'command-cancel' | 'command-confirm' | 'command-rejected'
  | 'task-delivered' | 'task-completed';

export interface PublicLogRecord {
  id: string;
  atActiveMs: number;
  kind: LogKind;
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

export interface CommandResponse {
  state: PlayerView;
  outcome: CommandOutcome;
}
