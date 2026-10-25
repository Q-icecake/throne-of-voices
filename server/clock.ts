import { PAUSE_REASONS } from '../shared/contracts.ts';
import type { ClockState, PauseReason } from '../shared/contracts.ts';

/** Explicit, integer milliseconds. Neither wall time nor rendering advances simulation. */
export class FakeClock {
  #elapsedMs = 0;
  #activeMs = 0;
  #reasons = new Set<PauseReason>();

  advance(milliseconds: number): void {
    if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0 || milliseconds > 60_000) {
      throw new Error('INVALID_CLOCK_STEP');
    }
    if (!Number.isSafeInteger(this.#elapsedMs + milliseconds)) throw new Error('CLOCK_OVERFLOW');
    this.#elapsedMs += milliseconds;
    if (this.#reasons.size === 0) this.#activeMs += milliseconds;
  }

  setPause(reason: PauseReason, paused: boolean): void {
    if (!PAUSE_REASONS.includes(reason) || typeof paused !== 'boolean') throw new Error('INVALID_PAUSE');
    if (paused) this.#reasons.add(reason);
    else this.#reasons.delete(reason);
  }

  snapshot(): ClockState {
    return {
      elapsedMs: this.#elapsedMs,
      activeMs: this.#activeMs,
      heldMs: this.#elapsedMs - this.#activeMs,
      pauseReasons: PAUSE_REASONS.filter(reason => this.#reasons.has(reason)),
    };
  }
}
