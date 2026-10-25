import { mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProviderConfig } from './config.ts';
import { ProviderError } from './types.ts';

/** Daily reservation survives restarts; session never resets with the world. Lock contention fails closed. */
export class CallBudget {
  #session = 0;
  #file: string;
  #config: ProviderConfig;
  #now: () => Date;
  constructor(config: ProviderConfig, file = fileURLToPath(new URL('../../artifacts/llm-usage.json', import.meta.url)), now = () => new Date()) {
    this.#config = { ...config }; this.#file = file; this.#now = now;
  }
  reserve(): void {
    if (![this.#config.sessionLimit, this.#config.dailyLimit].every(value => Number.isSafeInteger(value) && value >= 0)) throw new ProviderError('budget');
    if (this.#session >= this.#config.sessionLimit || this.#config.dailyLimit <= 0) throw new ProviderError('budget');
    let lock: number;
    try {
      mkdirSync(dirname(this.#file), { recursive: true });
      lock = openSync(this.#file + '.lock', 'wx');
    } catch { throw new ProviderError('budget'); }
    try { this.#reserveDaily(); }
    finally {
      try { closeSync(lock); unlinkSync(this.#file + '.lock'); } catch { throw new ProviderError('budget'); }
    }
  }
  #reserveDaily(): void {
    const day = this.#now().toISOString().slice(0, 10);
    let used = 0;
    try {
      const saved = JSON.parse(readFileSync(this.#file, 'utf8')) as { day: string; calls: number };
      if (typeof saved.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(saved.day) || !Number.isSafeInteger(saved.calls) || saved.calls < 0) throw new Error();
      if (saved.day === day) used = saved.calls;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new ProviderError('budget');
    }
    if (used >= this.#config.dailyLimit) throw new ProviderError('budget');
    try {
      writeFileSync(this.#file + '.tmp', JSON.stringify({ day, calls: used + 1 }));
      renameSync(this.#file + '.tmp', this.#file);
    } catch { throw new ProviderError('budget'); }
    this.#session++;
  }
}

