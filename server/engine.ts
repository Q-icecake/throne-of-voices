import type {
  ActionResponse, CommandOutcome, CommandRequest, CommandResponse, LogKind, PublicLogRecord, PublicSnapshot,
  RejectionCode, TestAction,
} from '../shared/contracts.ts';
import { FakeClock } from './clock.ts';
import { knowledgeFor, playerView } from './knowledge.ts';
import { MockCommandInterpreter } from './mock-interpreter.ts';
import type { CommandInterpreter } from './mock-interpreter.ts';
import { MockLLMProvider } from './provider.ts';
import type { LLMProvider } from './provider.ts';
import { ENGAGEMENT_POLICY_LABELS, NAVAL_DRILL, RESTRICTION_LABELS } from './rules.ts';
import { createInitialWorld } from './world.ts';
import type { DraftRecord, EventCause, EventRecord, TaskRecord, WorldState } from './world.ts';

const pad = (value: number) => String(value).padStart(4, '0');
const INTENT_LABELS = { question: '질문', hypothetical: '가정·검토', unsupported: '미지원' } as const;

const REJECTION_REPLIES: Record<RejectionCode, string> = {
  DRAFT_NOT_FOUND: '해당 초안을 찾을 수 없습니다. 상태를 다시 읽어 주세요.',
  DRAFT_VERSION_OUTDATED: '초안이 그 사이 수정되었습니다. 최신 내용을 확인한 뒤 다시 확인해 주세요.',
  DRAFT_CANCELLED: '취소된 초안은 실행할 수 없습니다.',
  DRAFT_REJECTED: '이미 반려된 초안입니다. 새로 지시해 주세요.',
  DRAFT_ALREADY_CONFIRMED: '이미 확정된 초안은 수정하거나 취소할 수 없습니다.',
  REVISION_NOT_COMMAND: '수정한 문장이 수군 정비 지시로 인식되지 않았습니다. 기존 초안은 그대로 남아 있습니다.',
  TASK_CONFLICT: '이미 진행 중인 수군 정비가 있어 이 초안을 실행할 수 없습니다. 진행 중인 작업이 끝난 뒤 새로 지시해 주세요.',
  GRAIN_SHORT: '장부상 군량이 부족해 수군 정비를 시작할 수 없습니다.',
  ASSIGNEE_BUSY: '주유가 지금 명을 받을 수 없는 상태입니다.',
};

export class GameEngine {
  #clock = new FakeClock();
  #world: WorldState = createInitialWorld(this.#clock.snapshot());
  #events: EventRecord[] = [];
  #provider: LLMProvider;
  #interpreter: CommandInterpreter;

  constructor(provider: LLMProvider = new MockLLMProvider(), interpreter: CommandInterpreter = new MockCommandInterpreter()) {
    this.#provider = provider;
    this.#interpreter = interpreter;
    this.reset();
  }

  reset(): void {
    this.#clock = new FakeClock();
    this.#world = createInitialWorld(this.#clock.snapshot());
    this.#events = [{ id: 'event-0000', atActiveMs: 0, kind: 'reset', summary: '고정 초기 상태로 시작', cause: null, fromRevision: 0, toRevision: 0 }];
  }

  view() { return playerView(this.#world); }

  logs(): PublicLogRecord[] {
    return this.#events.map(({ id, atActiveMs, kind, summary }) => ({ id, atActiveMs, kind, summary }));
  }

  publicSnapshot(): PublicSnapshot {
    return { visibility: 'player', state: this.view(), logs: this.logs() };
  }

  // Local tests/CLI only; deliberately has no HTTP route.
  internalSnapshot() {
    return structuredClone({ visibility: 'server-only' as const, world: this.#world, events: this.#events });
  }

  dispatch(action: TestAction): ActionResponse {
    let result: ActionResponse['result'];
    let summary: string;
    switch (action.type) {
      case 'advance-clock':
        this.#clock.advance(action.milliseconds);
        summary = `시험 시계 ${action.milliseconds}ms 전진`;
        break;
      case 'set-pause':
        this.#clock.setPause(action.reason, action.paused);
        summary = `보류 사유 ${action.reason}: ${action.paused ? '설정' : '해제'}`;
        break;
      case 'mock-probe':
        if (typeof action.text !== 'string' || !action.text.trim() || action.text.length > 2000) throw new Error('INVALID_TEXT');
        // The provider sees only a detached knowledge projection. Its text is never executed.
        result = this.#provider.respond({ text: action.text, knowledge: knowledgeFor(this.#world, 'player') });
        summary = 'Mock 입력 경로 점검 · 게임 명령 실행 없음';
        break;
      default:
        throw new Error('UNKNOWN_ACTION');
    }
    this.#world.clock = this.#clock.snapshot();
    // Tasks progress only when active time passes; their events carry the exact threshold time.
    if (action.type === 'advance-clock') this.#progressTasks();
    this.#record(action.type, summary, structuredClone(action));
    return { state: this.view(), ...(result ? { result } : {}) };
  }

  command(request: CommandRequest): CommandResponse {
    const outcome = this.#handleCommand(request);
    return { state: this.view(), outcome };
  }

  #handleCommand(request: CommandRequest): CommandOutcome {
    switch (request.type) {
      case 'submit': return this.#submit(request);
      case 'revise': return this.#revise(request);
      case 'cancel': return this.#cancel(request);
      case 'confirm': return this.#confirm(request);
      default: throw new Error('UNKNOWN_COMMAND');
    }
  }

  #submit(request: Extract<CommandRequest, { type: 'submit' }>): CommandOutcome {
    if (typeof request.text !== 'string' || !request.text.trim() || request.text.length > 2000) throw new Error('INVALID_TEXT');
    // Interpret before touching the world, so an interpreter failure changes nothing.
    const reading = this.#interpreter.interpret(request.text);
    const quoted = this.#quote(request.text);
    if (reading.intent !== 'command') {
      this.#record('command-submit', `입력 「${quoted}」 · ${INTENT_LABELS[reading.intent]} · 실행 없음 · ${reading.reason}`, structuredClone(request));
      return { kind: 'answer', intent: reading.intent, reply: reading.reply, reason: reading.reason };
    }
    const draft: DraftRecord = {
      id: `draft-${pad(++this.#world.counters.draft)}`, version: 1, status: 'awaiting-confirmation',
      text: request.text, action: reading.action, assignee: 'zhou-yu', messenger: 'zhang-hong',
      restrictions: [...reading.restrictions], estimate: { ...NAVAL_DRILL }, unresolved: [...reading.unresolved],
    };
    this.#world.drafts.push(draft);
    this.#record('command-submit', `입력 「${quoted}」 · ${draft.id} v1 초안 작성 · 확인 대기 · 자원 변화 없음`, structuredClone(request));
    return { kind: 'draft', draftId: draft.id, version: 1, reply: reading.reply };
  }

  #revise(request: Extract<CommandRequest, { type: 'revise' }>): CommandOutcome {
    const draft = this.#world.drafts.find(item => item.id === request.draftId);
    const blocked = this.#editBlock(draft, request.version);
    if (blocked) return this.#reject(blocked, request);
    const reading = this.#interpreter.interpret(request.text);
    if (reading.intent !== 'command') return this.#reject('REVISION_NOT_COMMAND', request);
    const target = draft!;
    target.version++;
    target.text = request.text;
    target.restrictions = [...reading.restrictions];
    target.unresolved = [...reading.unresolved];
    this.#record('command-revise', `${target.id} v${target.version}로 수정 · 이전 버전은 실행 불가`, structuredClone(request));
    return { kind: 'draft', draftId: target.id, version: target.version, reply: reading.reply };
  }

  #cancel(request: Extract<CommandRequest, { type: 'cancel' }>): CommandOutcome {
    const draft = this.#world.drafts.find(item => item.id === request.draftId);
    const blocked = this.#editBlock(draft, request.version);
    if (blocked) return this.#reject(blocked, request);
    draft!.status = 'cancelled';
    this.#record('command-cancel', `${draft!.id} v${draft!.version} 초안 취소 · 실행 없음`, structuredClone(request));
    return { kind: 'cancelled', draftId: draft!.id, reply: '초안을 취소했습니다. 아무것도 실행하지 않았습니다.' };
  }

  #confirm(request: Extract<CommandRequest, { type: 'confirm' }>): CommandOutcome {
    const draft = this.#world.drafts.find(item => item.id === request.draftId);
    if (!draft) return this.#reject('DRAFT_NOT_FOUND', request);
    // Idempotent: confirming the same draft version again returns the existing task untouched.
    if (draft.status === 'confirmed' && draft.confirmedVersion === request.version && draft.taskId) {
      return { kind: 'confirmed', draftId: draft.id, taskId: draft.taskId, duplicate: true,
        reply: '이미 확정된 지시입니다. 새 작업을 만들지 않았습니다.' };
    }
    const blocked = this.#editBlock(draft, request.version);
    if (blocked) return this.#reject(blocked, request);
    // Re-check against the current world, not the world at drafting time.
    const recheck = this.#recheck(draft);
    if (recheck) {
      draft.status = 'rejected';
      draft.statusNote = REJECTION_REPLIES[recheck];
      return this.#reject(recheck, request);
    }
    const task: TaskRecord = {
      id: `task-${pad(++this.#world.counters.task)}`, draftId: draft.id, draftVersion: draft.version,
      action: draft.action, assignee: draft.assignee, restrictions: [...draft.restrictions],
      stage: 'delivering', registeredAtMs: this.#world.clock.activeMs, grainSpent: 0, reportIds: [],
    };
    this.#world.tasks.push(task);
    draft.status = 'confirmed';
    draft.confirmedVersion = draft.version;
    draft.taskId = task.id;
    this.#record('command-confirm', `${draft.id} v${draft.version} 확정 · ${task.id} 등록 · 전령 출발 (자원 소모는 착수 시점)`, structuredClone(request));
    return { kind: 'confirmed', draftId: draft.id, taskId: task.id, duplicate: false,
      reply: '확정했습니다. 장굉이 주유에게 전령을 보냈습니다. 명이 전달되면 정비가 시작됩니다.' };
  }

  #editBlock(draft: DraftRecord | undefined, version: number): RejectionCode | undefined {
    if (!draft) return 'DRAFT_NOT_FOUND';
    if (draft.status === 'confirmed') return 'DRAFT_ALREADY_CONFIRMED';
    if (draft.status === 'cancelled') return 'DRAFT_CANCELLED';
    if (draft.status === 'rejected') return 'DRAFT_REJECTED';
    if (draft.version !== version) return 'DRAFT_VERSION_OUTDATED';
    return undefined;
  }

  #recheck(draft: DraftRecord): RejectionCode | undefined {
    if (this.#world.tasks.some(task => task.action === draft.action && task.stage !== 'completed')) return 'TASK_CONFLICT';
    if (!this.#world.characters.find(character => character.id === draft.assignee)?.available) return 'ASSIGNEE_BUSY';
    if (this.#world.resources.grain < draft.estimate.grain) return 'GRAIN_SHORT';
    return undefined;
  }

  #reject(code: RejectionCode, request: CommandRequest): CommandOutcome {
    const target = 'draftId' in request ? `${request.draftId} v${request.version} ` : '';
    this.#record('command-rejected', `${target}${request.type} 반려 · ${code} · 실행 없음`, structuredClone(request));
    return { kind: 'rejected', code, reply: REJECTION_REPLIES[code] };
  }

  #progressTasks(): void {
    const now = this.#world.clock.activeMs;
    for (const task of this.#world.tasks) {
      if (task.stage === 'delivering' && now >= task.registeredAtMs + NAVAL_DRILL.deliveryMs) {
        this.#deliver(task, task.registeredAtMs + NAVAL_DRILL.deliveryMs);
      }
      if (task.stage === 'in-progress' && task.deliveredAtMs !== undefined && now >= task.deliveredAtMs + NAVAL_DRILL.workMs) {
        this.#complete(task, task.deliveredAtMs + NAVAL_DRILL.workMs);
      }
    }
  }

  #deliver(task: TaskRecord, at: number): void {
    const eventId = this.#nextEventId();
    const before = this.#world.resources.grain;
    if (task.grainSpentEventId === undefined) {
      this.#world.resources.grain -= NAVAL_DRILL.grain;
      task.grainSpent = NAVAL_DRILL.grain;
      task.grainSpentEventId = eventId;
    }
    const noFirstStrike = task.restrictions.includes('no-first-strike');
    if (noFirstStrike) this.#world.navy.engagementPolicy = 'no-first-strike';
    task.stage = 'in-progress';
    task.deliveredAtMs = at;
    const conditions = noFirstStrike
      ? `지시 조건 「${RESTRICTION_LABELS['no-first-strike']}」을 함께 전했고, 수군 교전 방침을 선제공격 금지로 기록했습니다.`
      : '교전 방침에 대한 별도 지시는 없었습니다.';
    this.#fileReport(task, at, '수군 정비 착수 보고', '장굉 (전령 경유)',
      `주유가 수군 정비 명을 받고 정비에 착수했습니다. 장부에 군량 ${NAVAL_DRILL.grain} 사용을 기록했습니다 (${before} → ${this.#world.resources.grain}). ${conditions} 이 작업은 정비만 포함하며 교전은 포함하지 않습니다.`);
    this.#record('task-delivered', `${task.id} 명 전달 · 정비 착수 · 군량 ${NAVAL_DRILL.grain} 소모 (1회)`,
      { type: 'task-progress', taskId: task.id, stage: 'in-progress' }, at);
  }

  #complete(task: TaskRecord, at: number): void {
    const eventId = this.#nextEventId();
    const before = this.#world.navy.readiness;
    if (task.readinessAppliedEventId === undefined) {
      this.#world.navy.readiness += NAVAL_DRILL.readinessGain;
      task.readinessAppliedEventId = eventId;
    }
    task.stage = 'completed';
    task.completedAtMs = at;
    this.#fileReport(task, at, '수군 정비 완료 보고', '주유 (수군 진영)',
      `수군 정비를 마쳤습니다. 장부상 수군 준비도 ${before} → ${this.#world.navy.readiness}. 교전 방침: ${ENGAGEMENT_POLICY_LABELS[this.#world.navy.engagementPolicy]}. 이 작업에서 교전은 일어나지 않았습니다 (시제품에는 전투 처리가 없습니다).`);
    this.#record('task-completed', `${task.id} 정비 완료 · 준비도 ${before} → ${this.#world.navy.readiness}`,
      { type: 'task-progress', taskId: task.id, stage: 'completed' }, at);
  }

  #fileReport(task: TaskRecord, at: number, title: string, source: string, claim: string): void {
    const id = `report-${pad(++this.#world.counters.report)}`;
    this.#world.documents.push({
      id, title, claim, source, observedAtMs: at, arrivedAtMs: at,
      evidence: '담당자 보고 · M1 시험 규칙에 따른 처리', region: '강동 수군',
      provenance: 'test-reconstruction', taskId: task.id, readers: ['player', 'zhang-hong'],
    });
    task.reportIds.push(id);
    this.#world.ledger = {
      recordedAtMs: at, source: `장부 · ${id}`, navalReadiness: this.#world.navy.readiness,
      grain: this.#world.resources.grain, engagementPolicy: this.#world.navy.engagementPolicy,
    };
  }

  #nextEventId(): string { return `event-${pad(this.#world.revision + 1)}`; }

  #quote(text: string): string {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > 60 ? `${flat.slice(0, 60)}…` : flat;
  }

  #record(kind: LogKind, summary: string, cause: EventCause | null, atActiveMs = this.#world.clock.activeMs): void {
    const previous = this.#world.revision;
    this.#world.revision++;
    this.#events.push({
      id: `event-${pad(this.#world.revision)}`, atActiveMs, kind, summary, cause,
      fromRevision: previous, toRevision: this.#world.revision,
    });
  }
}
