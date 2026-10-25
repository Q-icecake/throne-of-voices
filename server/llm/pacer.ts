import { ProviderError, abortError } from './types.ts';

export interface RateLimits { rpmLimit: number; tpmLimit: number; maxWaitMs: number }
export interface PacerClock { now(): number; sleep(ms: number, signal: AbortSignal): Promise<void> }
const clock: PacerClock = {
  now: () => performance.now(),
  sleep: (ms, signal) => new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortError(signal)); return; }
    const abort = () => { clearTimeout(timer); reject(abortError(signal)); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  }),
};
export function rateLimits(env: NodeJS.ProcessEnv): RateLimits {
  const number = (name: string, fallback: number, min: number, max: number) => {
    const value = env[name] === undefined ? fallback : Number(env[name]);
    if (!Number.isSafeInteger(value) || value < min || value > max || env[name]?.trim() === '') throw new ProviderError('request');
    return value;
  };
  return { rpmLimit: number('LLM_RPM_LIMIT', 12, 1, 10000), tpmLimit: number('LLM_TPM_LIMIT', 200000, 0, 100000000),
    maxWaitMs: number('LLM_PACER_MAX_WAIT_MS', 8000, 0, 8000) };
}
/** Process-local rolling window. A reservation callback and admission are atomic;
 * failed budget reservations, refusals and cancellations consume no minute quota.
 * Token accounting reserves UTF-8 request bytes + output allowance, conservatively.
 * No prompts, credentials or persistent counters are kept here. */
export class RequestPacer {
  #limits: RateLimits;
  #clock: PacerClock;
  #entries: { at: number; tokens: number }[] = [];
  constructor(limits = rateLimits({}), time: PacerClock = clock) {
    this.#limits = { ...limits }; this.#clock = time; this.setRpm(limits.rpmLimit);
    if (!Number.isSafeInteger(limits.tpmLimit) || limits.tpmLimit < 0 || limits.tpmLimit > 100000000 ||
      !(limits.maxWaitMs === Infinity || Number.isSafeInteger(limits.maxWaitMs) && limits.maxWaitMs >= 0 && limits.maxWaitMs <= 8000)) throw new ProviderError('request');
  }
  setRpm(rpm: number) {
    if (!Number.isSafeInteger(rpm) || rpm < 1 || rpm > 10000) throw new ProviderError('request');
    this.#limits.rpmLimit = rpm;
  }
  #prune() { this.#entries = this.#entries.filter(entry => entry.at > this.#clock.now() - 60000); }
  snapshot() {
    this.#prune();
    return { minuteCalls: this.#entries.length, minuteTokens: this.#entries.reduce((n, e) => n + e.tokens, 0),
      rpmLimit: this.#limits.rpmLimit, tpmLimit: this.#limits.tpmLimit };
  }
  async acquire(tokens: number, signal: AbortSignal, reserve: () => void): Promise<void> {
    const started = this.#clock.now();
    let waited = false;
    if (!Number.isSafeInteger(tokens) || tokens < 0) throw new ProviderError('request');
    if (this.#limits.tpmLimit && tokens > this.#limits.tpmLimit) throw new ProviderError('pacing');
    for (;;) {
      if (signal.aborted) throw abortError(signal);
      if (waited && this.#clock.now() - started > this.#limits.maxWaitMs) throw new ProviderError('pacing');
      const usage = this.snapshot();
      let calls = usage.minuteCalls, used = usage.minuteTokens, wait = 0;
      for (const entry of this.#entries) {
        if (calls < usage.rpmLimit && (!usage.tpmLimit || used + tokens <= usage.tpmLimit)) break;
        calls--; used -= entry.tokens; wait = entry.at + 60000 - this.#clock.now();
      }
      if (wait <= 0) {
        reserve();
        this.#entries.push({ at: this.#clock.now(), tokens });
        return;
      }
      if (this.#clock.now() - started + wait > this.#limits.maxWaitMs) throw new ProviderError('pacing');
      waited = true;
      await this.#clock.sleep(wait, signal);
      // Recheck after waking: simultaneous waiters cannot overbook the window.
    }
  }
}

/** Sequential calls, empty initial window, assumed latency; TPM may add waits. */
export function estimatePacedDuration(calls: number, rpm: number, latencyMs = 2300): number {
  if (!Number.isSafeInteger(calls) || calls < 0 || !Number.isSafeInteger(rpm) || rpm < 1 || !Number.isFinite(latencyMs) || latencyMs < 0) throw new Error('INVALID_ESTIMATE');
  const starts: number[] = []; let end = 0;
  for (let i = 0; i < calls; i++) { starts.push(Math.max(end, i >= rpm ? starts[i - rpm]! + 60000 : 0)); end = starts[i]! + latencyMs; }
  return end;
}
