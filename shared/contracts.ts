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
  observedAtMs: number | null;
  observedAtLabel?: string;
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

// ---- M3 command vocabulary; legacy single-action fields remain compatible. ----

export type CommandActionKind = 'naval-drill' | 'hold-reply' | 'sound-out';
export type RestrictionId = 'no-first-strike' | 'no-war-promise' | 'no-firm-answer';
export interface ActionPlan {
  kind: CommandActionKind;
  target: string;
  assignee: CharacterId;
  restrictions: RestrictionId[];
  conditions: string[];
  deadline: string | null;
}
export interface ActionView {
  action: CommandActionKind; actionLabel: string; target: string; assignee: PersonRef;
  restrictions: Restriction[]; conditions: string[]; deadline: string | null; estimate: CommandEstimate;
}
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
  actions: ActionView[];
  taskIds: string[];
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

export type TaskStage = 'delivering' | 'in-progress' | 'completed' | 'preparing' | 'travelling' | 'awaiting-reply' | 'waiting' | 'stopped';

export interface TaskView {
  conditions: string[];
  deadlineAtMs?: number;
  recall?: { status: 'stopped' | 'unsupported'; requestedAtMs: number };
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
  opening?: { clockMode: 'manual' | 'auto'; ready: boolean; notices: { id: string; eventId: string; atMs: number; text: string; documentId?: string; sourceEventId?: string }[]; observed: boolean };
  audience: { participants: CharacterId[]; met: CharacterId[]; requested: CharacterId[] };
  conversation: TalkTurn[];
  schemaVersion: 1;
  scenario: 'm1-fixture-v1';
  sessionId: string;
  revision: number;
  mode: 'mock' | 'ai';
  interpretation?: { source: 'Mock' | 'AI'; status: string };
  clock: ClockState;
  player: { name: string; locationLabel: string };
  characters: { id: CharacterId; name: string; role: string; audienceStatus: 'ready' | 'busy' }[];
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
  | { type: 'set-clock-mode'; mode: 'manual' | 'auto' }
  | { type: 'advance-next' }
  | { type: 'opening-ready' }
  | { type: 'set-reading'; reading: boolean }
  | { type: 'observe-document'; documentId: string }
  | { type: 'advance-clock'; milliseconds: number }
  | { type: 'set-pause'; reason: PauseReason; paused: boolean }
  | { type: 'mock-probe'; text: string };

export type CommandRequest =
  | { type: 'submit'; text: string }
  | { type: 'revise'; draftId: string; version: number; text: string }
  | { type: 'cancel'; draftId: string; version: number }
  | { type: 'confirm'; draftId: string; version: number; acceptPartial?: boolean }
  | { type: 'recall'; taskId: string };

export type CommandIntent = 'command' | 'question' | 'hypothetical' | 'discussion' | 'ambiguous' | 'unsupported';

export type RejectionCode =
  | 'DRAFT_NOT_FOUND' | 'DRAFT_VERSION_OUTDATED' | 'DRAFT_CANCELLED' | 'DRAFT_REJECTED'
  | 'DRAFT_ALREADY_CONFIRMED' | 'REVISION_NOT_COMMAND'
  | 'TASK_CONFLICT' | 'GRAIN_SHORT' | 'ASSIGNEE_BUSY' | 'PARTIAL_CONFIRMATION_REQUIRED' | 'DEADLINE_PASSED' | 'TASK_NOT_FOUND';

export type CommandOutcome =
  | { kind: 'error'; code: 'PROVIDER_ERROR' | 'PROVIDER_TIMEOUT' | 'CALL_LIMIT' | 'INVALID_PROPOSAL' | 'STALE_RESPONSE'; reply: string; input: string }
  | { kind: 'draft'; draftId: string; version: number; reply: string }
  | { kind: 'answer'; intent: Exclude<CommandIntent, 'command'>; reply: string; reason: string }
  | { kind: 'confirmed'; draftId: string; taskId: string; taskIds: string[]; duplicate: boolean; reply: string }
  | { kind: 'recalled'; taskId: string; reply: string }
  | { kind: 'cancelled'; draftId: string; reply: string }
  | { kind: 'rejected'; code: RejectionCode; reply: string };

export type LogKind =
  | 'llm-usage-reset' | 'dialogue-filtered'
  | 'opening-event' | 'audience' | 'talk' | 'document-shared' | 'relationship'
  | 'reset' | TestAction['type']
  | 'command-submit' | 'command-revise' | 'command-cancel' | 'command-confirm' | 'command-rejected'
  | 'task-delivered' | 'task-completed' | 'task-progress' | 'command-recall';

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

export interface TalkTurn { eventId: string; speaker: CharacterId | 'player'; text: string; participants: CharacterId[] }
export type AudienceRequest =
  | { type: 'invite'; participants: CharacterId[] }
  | { type: 'dismiss' | 'defer' | 'decline'; characterId: CharacterId }
  | { type: 'share'; characterId: CharacterId; documentId: string };
export interface TalkRequest { characterId: CharacterId; text: string }
export interface TalkResponse {
  /** Optional v0.2 metadata; legacy clients can ignore it. No prompt content. */
  speakers?: { id: CharacterId; source: 'AI' | 'offline'; fallback?: boolean }[];
  failureCode?: 'timeout' | 'rate_limited' | 'auth' | 'schema' | 'server' | 'budget' | 'aborted' |
    'truncated' | 'empty' | 'request' | 'model' | 'google_server' | 'parse' | 'network' | 'tls';
  usage?: { inputChars: number; inputBytes: number; inputTokens: number | null; outputTokens: number | null; externalCalls: number | null };

  source: 'offline' | 'AI' | 'mixed';
  state: PlayerView;
  turns: TalkTurn[];
  inputOwner: 'player';
  outcome?: CommandOutcome;
  notice?: string;
}
/** Public start-screen settings. Credentials are never part of this contract. */
export type ConnectionTestResult = 'daily_limit' | 'session_limit' | 'untested' | 'ok' | 'auth' | 'model' | 'rate_limited' | 'timeout' | 'schema' | 'server' | 'budget' | 'stale' |
  'truncated' | 'empty' | 'request' | 'google_server' | 'parse' | 'network' | 'tls';
export interface LlmStatus {
  networkMode: NetworkMode;
  route: NetworkRoute;
  networkError?: NetworkError | null;
  pacUnsupported?: boolean;
  manualProxyConfigured?: boolean;
  proxyDetected: boolean;
  lastDiagnostic?: LlmDiagnostic | null;
  dailyCalls: number;
  dailyLimit: number;
  sessionCalls: number;
  sessionLimit: number;
  keyConfigured: boolean;
  keySource: 'screen' | 'env' | 'none';
  model: string;
  limit: number;
  testResult: ConnectionTestResult;
  mode: 'mock' | 'ai';
}
/** Only sanitized metadata; never request/response text or credentials. */
export interface LlmDiagnostic {
  networkMode: NetworkMode;
  route: NetworkRoute;
  source: 'live' | 'test';
  networkError: NetworkError | null;
  timestamp: string;
  callKind: 'connection_test' | 'command' | 'npc' | 'meeting';
  provider: 'gemini';
  model: string | null;
  httpStatus: number | null;
  googleStatus: string | null;
  googleReason: string | null;
  googleMessage: string | null;
  finishReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  thinkingTokens: number | null;
  latencyMs: number;
  retries: number;
  resultCode: string;
  dailyCalls: number;
  sessionCalls: number;
}
export type NetworkMode = 'auto' | 'proxy' | 'direct';
export type NetworkRoute = 'direct' | 'env-proxy' | 'system-proxy' | 'manual-proxy';
export interface NetworkError { name: string | null; code: string | null; proxyRefused?: boolean }
