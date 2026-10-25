import type { ActionResponse, PublicLogRecord, PublicSnapshot, TestAction } from '../shared/contracts.ts';
import { FakeClock } from './clock.ts';
import { knowledgeFor, playerView } from './knowledge.ts';
import { MockLLMProvider } from './provider.ts';
import type { LLMProvider } from './provider.ts';
import { createInitialWorld } from './world.ts';
import type { EventRecord, WorldState } from './world.ts';

export class GameEngine {
  #clock = new FakeClock();
  #world: WorldState = createInitialWorld(this.#clock.snapshot());
  #events: EventRecord[] = [];
  #provider: LLMProvider;

  constructor(provider: LLMProvider = new MockLLMProvider()) {
    this.#provider = provider;
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
    const previous = this.#world.revision;
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
    this.#world.revision++;
    this.#events.push({
      id: `event-${String(this.#world.revision).padStart(4, '0')}`,
      atActiveMs: this.#world.clock.activeMs,
      kind: action.type, summary, cause: structuredClone(action),
      fromRevision: previous, toRevision: this.#world.revision,
    });
    return { state: this.view(), ...(result ? { result } : {}) };
  }
}
