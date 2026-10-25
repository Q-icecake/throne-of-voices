import type {
  ActionPlan, CharacterId, ClockState, CommandEstimate, CommandRequest, DraftStatus, EngagementPolicy, LedgerView,
  LogKind, PublicDocument, RestrictionId, TaskStage, TestAction,
} from '../shared/contracts.ts';
import { createMinds } from './characters.ts';
import type { CharacterMind } from './characters.ts';
import type { TalkTurn } from '../shared/contracts.ts';

export interface DraftRecord {
  actions: ActionPlan[];
  taskIds: string[];
  createdAtMs: number;
  id: string;
  version: number;
  status: DraftStatus;
  text: string;
  action: ActionPlan['kind'];
  assignee: CharacterId;
  messenger: CharacterId;
  restrictions: RestrictionId[];
  estimate: CommandEstimate;
  unresolved: string[];
  statusNote?: string;
  taskId?: string;
  /** Version that was confirmed; later confirms of it are idempotent. */
  confirmedVersion?: number;
}

export interface TaskRecord {
  plan: ActionPlan;
  dependencyId?: string;
  deadlineAtMs?: number;
  startedAtMs?: number;
  departedAtMs?: number;
  receivedAtMs?: number;
  recall?: { status: "stopped" | "unsupported"; requestedAtMs: number };
  id: string;
  draftId: string;
  draftVersion: number;
  action: ActionPlan['kind'];
  assignee: CharacterId;
  restrictions: RestrictionId[];
  stage: TaskStage;
  registeredAtMs: number;
  deliveredAtMs?: number;
  completedAtMs?: number;
  /** Event that spent the grain. Present at most once: guards against double spending. */
  grainSpentEventId?: string;
  grainSpent: number;
  readinessAppliedEventId?: string;
  reportIds: string[];
}

export interface WorldState {
  minds: Record<CharacterId, CharacterMind>;
  audience: { participants: CharacterId[]; met: CharacterId[]; requested: CharacterId[] };
  conversation: TalkTurn[];
  schemaVersion: 1;
  scenario: 'm1-fixture-v1';
  sessionId: string;
  revision: number;
  clock: ClockState;
  player: { name: string; locationLabel: string };
  characters: {
    id: CharacterId; name: string; role: string; location: string; available: boolean;
    privatePerspective: string;
  }[];
  resources: { grain: number; treasury: number };
  diplomacy: { requests: { id: string; status: 'pending' | 'held' | 'answered'; heldUntilMs?: number; message?: string }[]; messages: { taskId: string; text: string; recipients: ('player' | CharacterId | 'liu-bei' | 'cao-cao')[]; atMs: number }[] };
  navy: { readiness: number; engagementPolicy: EngagementPolicy };
  documents: (PublicDocument & { readers: ('player' | CharacterId)[] })[];
  /** What the player's ledger last recorded. Updated only when a report is filed. */
  ledger: LedgerView;
  drafts: DraftRecord[];
  tasks: TaskRecord[];
  counters: { draft: number; task: number; report: number };
  hidden: { marker: string; enemyTroops: number; enemyIntent: string };
}

export type EventCause =
  | TestAction
  | CommandRequest
  | { type: 'task-progress'; taskId: string; stage: TaskStage };

export interface EventRecord {
  id: string;
  atActiveMs: number;
  kind: LogKind;
  summary: string;
  cause: EventCause | null;
  fromRevision: number;
  toRevision: number;
}

/** Fixed synthetic fixture, not researched historical data. Never served as an asset. */
export function createInitialWorld(clock: ClockState): WorldState {
  return {
    minds: createMinds(),
    audience: { participants: ['zhang-hong'], met: [], requested: ['zhang-zhao', 'zhou-yu', 'lu-su'] },
    conversation: [],
    schemaVersion: 1,
    scenario: 'm1-fixture-v1',
    sessionId: 'm0-local-session',
    revision: 0,
    clock,
    player: { name: '손권', locationLabel: '강동 · 정무청 (시험용)' },
    characters: [
      { id: 'zhang-hong', name: '장굉', role: '보좌', location: 'office', available: true, privatePerspective: 'PRIVATE_ADVISER_FIXTURE' },
      { id: 'zhang-zhao', name: '장조', role: '내정', location: 'residence', available: true, privatePerspective: 'PRIVATE_CIVIL_FIXTURE' },
      { id: 'zhou-yu', name: '주유', role: '군사', location: 'naval-base', available: true, privatePerspective: 'PRIVATE_NAVAL_FIXTURE' },
      { id: 'lu-su', name: '노숙', role: '외교', location: 'residence', available: true, privatePerspective: 'PRIVATE_DIPLOMATIC_FIXTURE' },
    ],
    resources: { grain: 1000, treasury: 500 },
    diplomacy: { requests: [{ id: 'cao-cao-envoy', status: 'pending' }], messages: [] },
    navy: { readiness: 20, engagementPolicy: 'hold' },
    documents: [
      {
        id: 'm0-public-note', title: '시험용 집무 기록',
        claim: '정무청 화면과 보고 전달 경로를 점검하기 위한 문서입니다. M3에서는 답변 보류·유비 타진·수군 정비를 처리하며, 역사 사건은 아직 진행하지 않습니다.',
        source: '시험 자료', observedAtMs: 0, arrivedAtMs: 0,
        evidence: '실행 환경 점검용', region: '강동', provenance: 'test-reconstruction',
        readers: ['player', 'zhang-hong'],
      },
      {
        id: 'm0-private-note', title: 'PRIVATE_REPORT_FIXTURE', claim: 'UNRELEASED_NAVAL_REPORT',
        source: '서버 내부 시험 자료', observedAtMs: 0, arrivedAtMs: 0,
        evidence: '비공개 경계 점검용', region: '강동', provenance: 'test-reconstruction',
        readers: ['zhou-yu'],
      },
    ],
    ledger: { recordedAtMs: 0, source: '시험용 장부 (초기값)', navalReadiness: 20, grain: 1000, engagementPolicy: 'hold' },
    drafts: [],
    tasks: [],
    counters: { draft: 0, task: 0, report: 0 },
    hidden: { marker: 'SERVER_ONLY_M0_SENTINEL', enemyTroops: 987654, enemyIntent: 'PRIVATE_ENEMY_INTENT' },
  };
}
