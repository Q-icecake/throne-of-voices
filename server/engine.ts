import type {
  ActionPlan, ActionResponse, CommandOutcome, CommandRequest, CommandResponse, LogKind, PublicLogRecord, PublicSnapshot,
  RejectionCode, TestAction,
} from '../shared/contracts.ts';
import { FakeClock } from './clock.ts';
import { knowledgeFor, playerView } from './knowledge.ts';
import { MockCommandInterpreter } from './mock-interpreter.ts';
import type { CommandInterpreter, Interpretation } from './mock-interpreter.ts';
import type { InterpretationProvider, ProviderInput } from './llm/types.ts';
import { ProviderError } from './llm/types.ts';
import { interpret, toReading } from './llm/pipeline.ts';
import { actionVocabulary, validateProposal } from './llm/validator.ts';
import { MockLLMProvider } from './provider.ts';
import type { LLMProvider } from './provider.ts';
import { ACTION_RULES, DIPLOMACY_RULES, deadlineDuration, ENGAGEMENT_POLICY_LABELS, NAVAL_DRILL, RESTRICTION_LABELS } from './rules.ts';
import { createInitialWorld } from './world.ts';
import type { DraftRecord, EventCause, EventRecord, TaskRecord, WorldState } from './world.ts';

const pad = (value: number) => String(value).padStart(4, '0');
const INTENT_LABELS = { question: '질문', hypothetical: '가정·검토', discussion: '논의', ambiguous: '확인 질문', unsupported: '미지원' } as const;

const REJECTION_REPLIES: Record<RejectionCode, string> = {
  DRAFT_NOT_FOUND: '해당 초안을 찾을 수 없습니다. 상태를 다시 읽어 주세요.',
  DRAFT_VERSION_OUTDATED: '초안이 그 사이 수정되었습니다. 최신 내용을 확인한 뒤 다시 확인해 주세요.',
  DRAFT_CANCELLED: '취소된 초안은 실행할 수 없습니다.',
  DRAFT_REJECTED: '이미 반려된 초안입니다. 새로 지시해 주세요.',
  DRAFT_ALREADY_CONFIRMED: '이미 확정된 초안은 수정하거나 취소할 수 없습니다.',
  REVISION_NOT_COMMAND: '수정한 문장이 지원하는 지시로 인식되지 않았습니다. 기존 초안은 그대로 남아 있습니다.',
  TASK_CONFLICT: '담당자에게 이미 진행 중인 작업이 있어 이 초안을 실행할 수 없습니다. 작업이 끝난 뒤 새로 지시해 주세요.',
  GRAIN_SHORT: '진행 중인 작업에 필요한 군량을 제외하면 이 초안에 쓸 군량이 부족합니다.',
  ASSIGNEE_BUSY: '담당자가 지금 명을 받을 수 없는 상태입니다.',
  PARTIAL_CONFIRMATION_REQUIRED: '미해결 부분을 제외하고 표시된 행동만 실행할지 확인해 주세요.',
  DEADLINE_PASSED: '기한 안에 완료할 수 없습니다. 새 기한으로 작성해 주세요.',
  TASK_NOT_FOUND: '작업을 찾을 수 없습니다.',
};

export class GameEngine<P extends InterpretationProvider | undefined = undefined> {
  #clock = new FakeClock();
  #world: WorldState = createInitialWorld(this.#clock.snapshot());
  #events: EventRecord[] = [];
  #provider: LLMProvider;
  #interpreter: CommandInterpreter;
  #interpretationProvider: P | undefined;
  #requestVersion = 0;
  #context: ProviderInput['context'] = [];
  #timeoutMs: number;
  #connectionStatus: string;

  constructor(provider: LLMProvider = new MockLLMProvider(), interpreter: CommandInterpreter = new MockCommandInterpreter(),
    interpretationProvider?: P, timeoutMs = 15000, status = 'AI 미연결, Mock 사용 중') {
    this.#provider = provider;
    this.#interpreter = interpreter;
    this.#interpretationProvider = interpretationProvider;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 15000) throw new Error('INVALID_TIMEOUT');
    this.#timeoutMs = timeoutMs;
    this.#connectionStatus = interpretationProvider?.status ?? status;
    this.reset();
  }

  reset(): void {
    this.#requestVersion++;
    this.#context = [];
    this.#clock = new FakeClock();
    this.#world = createInitialWorld(this.#clock.snapshot());
    this.#events = [{ id: 'event-0000', atActiveMs: 0, kind: 'reset', summary: '고정 초기 상태로 시작', cause: null, fromRevision: 0, toRevision: 0 }];
  }

  view() { return { ...playerView(this.#world), mode: this.#interpretationProvider ? 'ai' as const : 'mock' as const,
    interpretation: { source: this.#interpretationProvider ? 'AI' as const : 'Mock' as const, status: this.#connectionStatus } }; }

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

  command(request: CommandRequest): P extends undefined ? CommandResponse : Promise<CommandResponse> {
    const version = ++this.#requestVersion;
    if (this.#interpretationProvider) {
      return this.#commandAI(structuredClone(request), version) as P extends undefined ? CommandResponse : Promise<CommandResponse>;
    }
    const outcome = this.#handleCommand(request);
    return { state: this.view(), outcome } as P extends undefined ? CommandResponse : Promise<CommandResponse>;
  }

  async #commandAI(request: CommandRequest, version: number): Promise<CommandResponse> {
    if (request.type !== 'submit' && request.type !== 'revise') return { outcome: this.#handleCommand(request), state: this.view() };
    if (typeof request.text !== 'string' || !request.text.trim() || request.text.length > 2000) throw new Error('INVALID_TEXT');
    if (request.type === 'revise') {
      const blocked = this.#editBlock(this.#world.drafts.find(draft => draft.id === request.draftId), request.version);
      if (blocked) return { outcome: this.#reject(blocked, request), state: this.view() };
    }
    const stale = (): CommandResponse => ({ state: this.view(), outcome: { kind: 'error', code: 'STALE_RESPONSE', input: request.text,
      reply: '이전 해석 응답을 무시했습니다. 최신 초안은 보존되었습니다. 필요하면 입력을 다시 보내 주세요.' } });
    try {
      const input: ProviderInput = { text: request.text, knowledge: knowledgeFor(this.#world, 'player'),
        context: structuredClone(this.#context), actions: actionVocabulary() };
      if (request.type === 'revise') input.context.push({ role: 'player', text: this.#world.drafts.find(draft => draft.id === request.draftId)!.text });
      const proposal = await interpret(this.#interpretationProvider!, input, this.#timeoutMs);
      if (version !== this.#requestVersion) return stale();
      const reading = toReading(proposal);
      const outcome = request.type === 'submit' ? this.#submit(request, reading) : this.#revise(request, reading);
      this.#context.push({ role: 'player', text: request.text }, { role: 'assistant', text: outcome.reply });
      this.#context = this.#context.slice(-6);
      this.#connectionStatus = this.#interpretationProvider!.status;
      return { state: this.view(), outcome };
    } catch (error) {
      if (version !== this.#requestVersion) return stale();
      const code = error instanceof ProviderError ? error.code : 'PROVIDER_ERROR';
      const messages = { PROVIDER_TIMEOUT: 'AI 응답 시간이 초과되었습니다.', CALL_LIMIT: 'AI 호출 상한에 도달했습니다. 추가 호출을 차단했습니다.',
        INVALID_PROPOSAL: 'AI 제안의 형식이나 허용 범위가 맞지 않습니다.', PROVIDER_ERROR: 'AI 연결에 실패했습니다.' };
      this.#connectionStatus = messages[code];
      return { state: this.view(), outcome: { kind: 'error', code, input: request.text,
        reply: `${messages[code]} 입력과 초안은 보존되었습니다. 문장을 고쳐 쓰거나 다시 시도해 주세요. Mock으로 전환하지 않았습니다.` } };
    }
  }

  #readMock(text: string): Interpretation {
    const reading = this.#interpreter.interpret(text);
    if (reading.intent !== 'command') return reading;
    if (this.#plans(reading).length > 3) return { intent: 'ambiguous', reason: '최대 3행동', reply: '[Mock] 한 초안은 최대 3행동입니다. 명령을 나누어 확인해 주세요.' };
    const proposal = validateProposal({ intent: 'command', dialogue: reading.reply,
      proposedActions: this.#plans(reading), unresolvedQuestions: reading.unresolved,
      referencedKnowledgeIds: [], usage: { inputTokens: 0, outputTokens: 0, externalCalls: 0, costUsd: 0 } },
    { text, knowledge: knowledgeFor(this.#world, 'player'), context: [], actions: actionVocabulary() });
    return proposal.intent === 'command' ? { ...reading, actions: proposal.proposedActions as ActionPlan[], unresolved: proposal.unresolvedQuestions } : { intent: 'ambiguous', reply: `[Mock] ${proposal.dialogue}`, reason: '조건 확인 필요 · 실행 없음' };
  }

  #plans(reading: Extract<Interpretation, { intent: 'command' }>): ActionPlan[] {
    return structuredClone(reading.actions ?? [{ kind: reading.action, target: 'jiangdong-navy', assignee: 'zhou-yu',
      restrictions: reading.restrictions, conditions: [], deadline: null }]);
  }

  #handleCommand(request: CommandRequest): CommandOutcome {
    switch (request.type) {
      case 'submit': return this.#submit(request);
      case 'revise': return this.#revise(request);
      case 'cancel': return this.#cancel(request);
      case 'confirm': return this.#confirm(request);
      case 'recall': return this.#recall(request);
      default: throw new Error('UNKNOWN_COMMAND');
    }
  }

  #submit(request: Extract<CommandRequest, { type: 'submit' }>, interpreted?: Interpretation): CommandOutcome {
    if (typeof request.text !== 'string' || !request.text.trim() || request.text.length > 2000) throw new Error('INVALID_TEXT');
    // Interpret before touching the world, so an interpreter failure changes nothing.
    const reading = interpreted ?? this.#readMock(request.text);
    const quoted = this.#quote(request.text);
    if (reading.intent !== 'command') {
      this.#record('command-submit', `입력 「${quoted}」 · ${INTENT_LABELS[reading.intent]} · 실행 없음 · ${reading.reason}`, structuredClone(request));
      return { kind: 'answer', intent: reading.intent, reply: reading.reply, reason: reading.reason };
    }
    const plans = this.#plans(reading);
    const draft: DraftRecord = {
      actions: plans, taskIds: [], createdAtMs: this.#world.clock.activeMs,
      id: `draft-${pad(++this.#world.counters.draft)}`, version: 1, status: 'awaiting-confirmation',
      text: request.text, action: plans[0]!.kind, assignee: plans[0]!.assignee, messenger: 'zhang-hong',
      restrictions: [...reading.restrictions], estimate: { ...ACTION_RULES[plans[0]!.kind] }, unresolved: [...reading.unresolved],
    };
    this.#world.drafts.push(draft);
    this.#record('command-submit', `입력 「${quoted}」 · ${draft.id} v1 초안 작성 · 확인 대기 · 자원 변화 없음`, structuredClone(request));
    return { kind: 'draft', draftId: draft.id, version: 1, reply: reading.reply };
  }

  #revise(request: Extract<CommandRequest, { type: 'revise' }>, interpreted?: Interpretation): CommandOutcome {
    const draft = this.#world.drafts.find(item => item.id === request.draftId);
    const blocked = this.#editBlock(draft, request.version);
    if (blocked) return this.#reject(blocked, request);
    const reading = interpreted ?? this.#readMock(request.text);
    if (reading.intent === 'ambiguous') return { kind: 'answer', intent: 'ambiguous', reply: reading.reply, reason: reading.reason };
    if (reading.intent !== 'command') return this.#reject('REVISION_NOT_COMMAND', request);
    const target = draft!;
    target.version++;
    target.text = request.text;
    target.actions = this.#plans(reading);
    target.action = target.actions[0]!.kind;
    target.assignee = target.actions[0]!.assignee;
    target.estimate = { ...ACTION_RULES[target.action] };
    target.createdAtMs = this.#world.clock.activeMs;
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
      return { kind: 'confirmed', draftId: draft.id, taskId: draft.taskId, taskIds: [...draft.taskIds], duplicate: true,
        reply: '이미 확정된 지시입니다. 새 작업을 만들지 않았습니다.' };
    }
    const blocked = this.#editBlock(draft, request.version);
    if (blocked) return this.#reject(blocked, request);
    if (draft.unresolved.length && !request.acceptPartial) return this.#reject('PARTIAL_CONFIRMATION_REQUIRED', request);
    // Re-check against the current world, not the world at drafting time.
    const recheck = this.#recheck(draft);
    if (recheck) {
      draft.status = 'rejected';
      draft.statusNote = REJECTION_REPLIES[recheck];
      return this.#reject(recheck, request);
    }
    const tasks: TaskRecord[] = [];
    for (const plan of draft.actions) {
      const dependency = plan.conditions.find(c => c.startsWith('after:'));
      const duration = deadlineDuration(plan.deadline);
      const task: TaskRecord = {
        id: `task-${pad(++this.#world.counters.task)}`, draftId: draft.id, draftVersion: draft.version,
        action: plan.kind, assignee: plan.assignee, restrictions: [...plan.restrictions], plan: structuredClone(plan),
        stage: dependency ? 'waiting' : 'delivering', registeredAtMs: this.#world.clock.activeMs,
        grainSpent: 0, reportIds: [],
        ...(dependency ? { dependencyId: tasks[Number(dependency.slice(6))]!.id } : {}),
        ...(duration !== undefined ? { deadlineAtMs: draft.createdAtMs + duration } : {}),
      };
      tasks.push(task);
    }
    this.#world.tasks.push(...tasks);
    draft.status = 'confirmed';
    draft.confirmedVersion = draft.version;
    draft.taskIds = tasks.map(t => t.id);
    draft.taskId = tasks[0]!.id;
    this.#record('command-confirm', `${draft.id} v${draft.version} 확정 · ${draft.taskIds.join(', ')} 등록 · 소모는 착수 시점`, structuredClone(request));
    return { kind: 'confirmed', draftId: draft.id, taskId: draft.taskId, taskIds: [...draft.taskIds], duplicate: false,
      reply: `확정했습니다. ${tasks.length}개 작업을 등록했습니다. 전달과 결과는 시간이 지나야 보고됩니다.` };
  }

  #recall(request: Extract<CommandRequest, { type: 'recall' }>): CommandOutcome {
    const task = this.#world.tasks.find(t => t.id === request.taskId);
    if (!task) return this.#reject('TASK_NOT_FOUND', request);
    if (!task.recall) {
      const stoppable = ['waiting', 'delivering', 'preparing'].includes(task.stage);
      task.recall = { status: stoppable ? 'stopped' : 'unsupported', requestedAtMs: this.#world.clock.activeMs };
      if (stoppable) task.stage = 'stopped';
      this.#fileReport(task, this.#world.clock.activeMs, '회수 요청 기록', '장굉',
        stoppable ? '전달·출발 전 작업을 중단했습니다. 이미 사용한 군량과 전달한 정보는 보존합니다.' : '회수 요청을 기록했습니다. 출발·수행 이후 회수는 미지원입니다. 기존 작업은 계속되며 소모·전언·공개를 되돌리지 않습니다.');
      this.#record('command-recall', `${task.id} 회수 요청 · ${task.recall.status}`, structuredClone(request));
    }
    return { kind: 'recalled', taskId: task.id, reply: task.recall.status === 'stopped' ? '출발 전 작업을 중단했습니다. 이미 발생한 소모·공개는 유지됩니다.' : '회수 요청 기록. 출발·수행 이후 회수는 미지원이며 작업은 계속됩니다.' };
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
    const active = this.#world.tasks.filter(t => !['completed', 'stopped'].includes(t.stage));
    const ends: number[] = [];
    for (const plan of draft.actions) {
      if (active.some(t => t.assignee === plan.assignee)) return 'TASK_CONFLICT';
      if (!this.#world.characters.find(c => c.id === plan.assignee)?.available) return 'ASSIGNEE_BUSY';
      const rule = ACTION_RULES[plan.kind];
      const dep = plan.conditions.find(c => c.startsWith('after:'));
      const end = (dep ? ends[Number(dep.slice(6))]! : this.#world.clock.activeMs) + rule.deliveryMs + rule.workMs;
      ends.push(end);
      const duration = deadlineDuration(plan.deadline);
      if (duration !== undefined && end > draft.createdAtMs + duration) return 'DEADLINE_PASSED';
    }
    const reserved = active.filter(t => !t.grainSpentEventId).reduce((n,t) => n + ACTION_RULES[t.action].grain, 0);
    if (this.#world.resources.grain < reserved + draft.actions.reduce((n,a) => n + ACTION_RULES[a.kind].grain, 0)) return 'GRAIN_SHORT';
    return undefined;
  }

  #reject(code: RejectionCode, request: CommandRequest): CommandOutcome {
    const target = 'draftId' in request ? `${request.draftId} v${request.version} ` : '';
    this.#record('command-rejected', `${target}${request.type} 반려 · ${code} · 실행 없음`, structuredClone(request));
    return { kind: 'rejected', code, reply: REJECTION_REPLIES[code] };
  }

  #progressTasks(): void {
    const now = this.#world.clock.activeMs;
    for (;;) {
      for (const task of this.#world.tasks.filter(t => t.stage === 'waiting')) {
        const dependency = this.#world.tasks.find(t => t.id === task.dependencyId)!;
        if (dependency.stage === 'stopped') {
          task.stage = 'stopped';
          this.#fileReport(task, now, '선행 작업 중단', '장굉', '선행 작업이 중단되어 후속 작업도 착수하지 않았습니다.');
        } else if (dependency.stage === 'completed') {
          task.stage = 'delivering'; task.startedAtMs = dependency.completedAtMs!;
        }
      }
      const next = this.#world.tasks.map(task => {
        const rule = ACTION_RULES[task.action];
        const at = task.stage === 'delivering' ? (task.startedAtMs ?? task.registeredAtMs) + rule.deliveryMs
          : task.stage === 'in-progress' ? task.deliveredAtMs! + rule.workMs
          : task.stage === 'preparing' ? task.deliveredAtMs! + DIPLOMACY_RULES.prepareMs
          : task.stage === 'travelling' ? task.departedAtMs! + DIPLOMACY_RULES.travelMs
          : task.stage === 'awaiting-reply' ? task.receivedAtMs! + DIPLOMACY_RULES.replyMs : Infinity;
        return { task, at };
      }).filter(e => e.at <= now).sort((a,b) => a.at - b.at || a.task.id.localeCompare(b.task.id))[0];
      if (!next) break;
      const { task, at } = next;
      if (task.action === 'naval-drill') {
        if (task.stage === 'delivering') this.#deliver(task, at); else this.#complete(task, at);
      } else this.#diplomaticStep(task, at);
    }
  }

  #message(task: TaskRecord): string {
    const explicit = task.plan.conditions.find(c => c.startsWith('message:'))?.slice(8);
    return [explicit ?? (task.action === 'hold-reply' ? '당장 확답하지 않고 답변을 보류합니다.' : '유비 측 의중과 협력 조건을 타진합니다.'),
      task.plan.conditions.includes('secret') ? '비밀 접촉. 수신자 외 공개 금지.' : '공개 범위로 전달.',
      ...task.restrictions.map(r => RESTRICTION_LABELS[r])].join(' ');
  }

  #diplomaticStep(task: TaskRecord, at: number): void {
    const rule = ACTION_RULES[task.action];
    let title: string, claim: string;
    if (task.stage === 'delivering') {
      task.deliveredAtMs = at;
      if (!task.grainSpentEventId) {
        this.#world.resources.grain -= rule.grain;
        task.grainSpent = rule.grain; task.grainSpentEventId = this.#nextEventId();
      }
      task.stage = task.action === 'sound-out' ? 'preparing' : 'in-progress';
      title = '명 전달·출발 준비 보고';
      claim = `${task.action === 'sound-out' ? '노숙에게 명을 전했습니다. 사절 출발 준비 중이며 유비의 수락을 뜻하지 않습니다.' : '장굉이 조조 사신에게 전달할 답변을 준비합니다.'} 군량 ${rule.grain} 사용. ${this.#message(task)}`;
    } else if (task.stage === 'preparing') {
      task.departedAtMs = at; task.stage = 'travelling';
      title = '사절 출발 보고'; claim = `노숙의 사절이 출발했습니다. 아직 상대에게 전달되지 않았습니다. ${this.#message(task)}`;
    } else if (task.stage === 'travelling') {
      task.receivedAtMs = at; task.stage = 'awaiting-reply';
      this.#world.diplomacy.messages.push({ taskId: task.id, text: this.#message(task), atMs: at,
        recipients: task.plan.conditions.includes('secret') ? ['player', 'lu-su', 'liu-bei'] : ['player', 'zhang-hong', 'zhang-zhao', 'zhou-yu', 'lu-su', 'liu-bei'] });
      title = '전언 수신·회신 대기'; claim = `유비 측에 전언을 전달했습니다. 회신을 기다립니다. ${this.#message(task)}`;
    } else {
      task.stage = 'completed'; task.completedAtMs = at;
      if (task.action === 'hold-reply') {
        const request = this.#world.diplomacy.requests.find(r => r.id === 'cao-cao-envoy')!;
        const held = task.restrictions.includes('no-firm-answer');
        request.status = held ? 'held' : 'answered';
        if (held) request.heldUntilMs = task.deadlineAtMs ?? at + DIPLOMACY_RULES.holdMs;
        else delete request.heldUntilMs;
        request.message = this.#message(task);
        this.#world.diplomacy.messages.push({ taskId: task.id, text: request.message, atMs: at, recipients: ['player', 'zhang-hong', 'cao-cao'] });
        title = held ? '조조 사신 답변 보류 보고' : '조조 사신 회신 전달 보고';
        claim = `${request.message} ${held ? `보류 기한: 시험 시계 ${request.heldUntilMs}ms.` : ''} 항복이나 조약은 성립하지 않았습니다.`;
      } else { title = '유비 측 회신 도착'; claim = `${DIPLOMACY_RULES.response} 전달 범위: ${this.#message(task)}`; }
    }
    this.#fileReport(task, at, title, task.action === 'sound-out' ? '노숙 (사절 경유)' : '장굉', claim);
    this.#record(task.stage === 'completed' ? 'task-completed' : 'task-progress', `${task.id} · ${title}`,
      { type: 'task-progress', taskId: task.id, stage: task.stage }, at);
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
      evidence: '담당자 보고 · 고정 시험 규칙에 따른 처리', region: task.action === 'naval-drill' ? '강동 수군' : '외교',
      provenance: 'test-reconstruction', taskId: task.id, readers: task.plan.conditions.includes('secret') ? ['player', 'zhang-hong', task.assignee] : ['player', 'zhang-hong', 'zhang-zhao', 'zhou-yu', 'lu-su'],
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
