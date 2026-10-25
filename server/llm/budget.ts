import { mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ProviderConfig } from './config.ts';
import { ProviderError } from './types.ts';
import { defaultUsageFile } from './usage-file.ts';

/** Daily reservations survive restarts; settings/world resets never reset the session. */
export class CallBudget {
  #session = 0;
  #file: string;
  #config: ProviderConfig;
  #now: () => Date;
  constructor(config: ProviderConfig, file = defaultUsageFile(), now = () => new Date()) {
    this.#config = { ...config }; this.#file = file; this.#now = now;
  }
  setLimits(dailyLimit: number, sessionLimit: number): void {
    this.#config = { ...this.#config, dailyLimit, sessionLimit };
  }
  snapshot() {
    let dailyCalls: number;
    try { dailyCalls = this.#read(this.#day()); } catch { dailyCalls = -1; }
    return { dailyCalls, dailyLimit: this.#config.dailyLimit, sessionCalls: this.#session, sessionLimit: this.#config.sessionLimit };
  }
  reserve(): void {
    if (![this.#config.sessionLimit, this.#config.dailyLimit].every(value => Number.isSafeInteger(value) && value >= 0)) throw new ProviderError('budget');
    if (this.#session >= this.#config.sessionLimit) throw new ProviderError('budget', { scope: 'session', calls: this.#session, limit: this.#config.sessionLimit });
    this.#locked(() => {
      const day = this.#day(), used = this.#read(day);
      if (used >= this.#config.dailyLimit) throw new ProviderError('budget', { scope: 'daily', calls: used, limit: this.#config.dailyLimit });
      this.#write(day, used + 1); this.#session++;
    });
  }
  /** Explicit user action only. Session reservations and configured limits remain intact. */
  resetToday() {
    return this.#locked(() => {
      const day = this.#day(), previousCalls = this.#read(day);
      this.#write(day, 0);
      return { day, previousCalls };
    });
  }
  #day() { return this.#now().toISOString().slice(0, 10); }
  #locked<T>(work: () => T): T {
    let lock: number;
    try { mkdirSync(dirname(this.#file), { recursive: true }); lock = openSync(this.#file + '.lock', 'wx'); }
    catch { throw new ProviderError('budget'); }
    try { return work(); }
    finally {
      try { closeSync(lock); unlinkSync(this.#file + '.lock'); } catch { throw new ProviderError('budget'); }
    }
  }
  #read(day: string): number {
    try {
      const saved = JSON.parse(readFileSync(this.#file, 'utf8')) as { day: string; calls: number };
      if (typeof saved.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(saved.day) || !Number.isSafeInteger(saved.calls) || saved.calls < 0) throw new Error();
      return saved.day === day ? saved.calls : 0;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
      throw new ProviderError('budget');
    }
  }
  #write(day: string, calls: number): void {
    try {
      writeFileSync(this.#file + '.tmp', JSON.stringify({ day, calls }));
      renameSync(this.#file + '.tmp', this.#file);
    } catch { throw new ProviderError('budget'); }
  }
}
