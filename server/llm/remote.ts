import type { ProviderConfig } from './config.ts';
import { CallBudget } from './budget.ts';
import type { InterpretationProvider, ProviderInput, ProviderUsage, AttemptUsage } from './types.ts';
import { ProviderError, PROVIDER_MESSAGES, abortError, providerMessage } from './types.ts';
import { withDeadline } from './pipeline.ts';
import { validateProposal } from './validator.ts';
import { SecretGuard } from './secrets.ts';

export interface DecodedOutput { text: string; inputTokens: unknown; outputTokens: unknown; complete: boolean }
export const tokenCount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 10000000 ? value : null;

/** Shared deadlines, reservation, telemetry and sanitization. REST formats belong to adapters. */
export abstract class RemoteProvider implements InterpretationProvider {
  readonly source = 'AI' as const;
  #key: string;
  #settings: ProviderConfig;
  #transport: typeof fetch;
  #budget: CallBudget;
  #guard: SecretGuard;
  #usage?: ProviderUsage;
  #failureMessage?: string;
  get lastUsage(): ProviderUsage | undefined { return this.#usage && structuredClone(this.#usage); }
  get status(): string {
    if (!this.#key) return 'AI 미연결, Mock 사용 중';
    if (this.#usage?.errorCode) return `[${this.#usage.errorCode}] ${this.#failureMessage ?? PROVIDER_MESSAGES[this.#usage.errorCode]} Mock으로 전환하지 않았습니다.`;
    return 'AI 연결 설정됨 · 라이브 미검증';
  }
  constructor(settings: ProviderConfig, key: string, transport: typeof fetch, budget = new CallBudget(settings)) {
    if (!settings.model || ![settings.timeoutMs, settings.retries, settings.dailyLimit, settings.sessionLimit]
      .every(value => Number.isSafeInteger(value) && value >= 0) || settings.timeoutMs < 1 || settings.timeoutMs > 15000 ||
      settings.retries > 100 || settings.dailyLimit > 10000 || settings.sessionLimit > 10000) throw new ProviderError('auth');
    this.#key = key; this.#settings = { ...settings }; this.#transport = transport; this.#budget = budget;
    this.#guard = new SecretGuard(key);
    if (/[\r\n]/.test(key) || (key && this.#guard.reflects(settings.model))) throw new ProviderError('auth');
  }
  protected abstract request(input: ProviderInput, signal: AbortSignal, key: string): [string, RequestInit];
  protected abstract decode(envelope: unknown): DecodedOutput;
  async interpret(input: ProviderInput, signal: AbortSignal): Promise<unknown> {
    const started = performance.now();
    const attempts: (AttemptUsage & { started: number; finished?: boolean })[] = [];
    let reservations = 0, error: ProviderError | undefined;
    try {
      if (!this.#key) throw new ProviderError('auth');
      return await withDeadline(async bounded => {
        for (let index = 0; index <= this.#settings.retries; index++) {
          bounded.throwIfAborted();
          this.#budget.reserve(); reservations++;
          const attempt = { inputTokens: null, outputTokens: null, latencyMs: 0, errorCode: null,
            started: performance.now() } as typeof attempts[number];
          attempts.push(attempt);
          try {
            // Current input.text is transmitted verbatim. Past-context filtering does not redact it.
            const [url, init] = this.request(input, bounded, this.#key);
            const response = await this.#transport(url, init);
            bounded.throwIfAborted();
            if (!response.ok) {
              // Never read error text/headers: upstream can reflect credentials in either.
              void response.body?.cancel().catch(() => {});
              if (response.status === 429) throw new ProviderError('rate_limited');
              if (response.status === 401 || response.status === 403) throw new ProviderError('auth');
              throw new ProviderError(response.status >= 500 ? 'server' : 'schema');
            }
            const envelope = await this.#read(response, bounded);
            bounded.throwIfAborted();
            let decoded: DecodedOutput;
            try { decoded = this.decode(envelope); } catch { throw new ProviderError('schema'); }
            attempt.inputTokens = tokenCount(decoded.inputTokens); attempt.outputTokens = tokenCount(decoded.outputTokens);
            if (!decoded.complete || this.#guard.reflects(decoded.text)) throw new ProviderError('schema');
            const raw: unknown = JSON.parse(decoded.text);
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ProviderError('schema');
            const sum = (key: 'inputTokens' | 'outputTokens') => attempts.reduce((n, item) => n + (item[key] ?? 0), 0);
            return validateProposal({ ...raw, usage: { inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'),
              externalCalls: attempts.length, costUsd: null } }, input);
          } catch (caught) {
            const safe = bounded.aborted ? abortError(bounded) :
              caught instanceof ProviderError ? caught : new ProviderError(caught instanceof SyntaxError ? 'schema' : 'server');
            attempt.errorCode = safe.neutralCode;
            if (safe.neutralCode !== 'server' || index >= this.#settings.retries) throw safe;
          } finally { attempt.latencyMs = Math.round(performance.now() - attempt.started); attempt.finished = true; }
        }
        throw new ProviderError('server');
      }, this.#settings.timeoutMs, signal);
    } catch (caught) {
      error = signal.aborted ? abortError(signal) : caught instanceof ProviderError ? caught : new ProviderError('server');
      this.#failureMessage = providerMessage(error);
      throw error;
    } finally {
      const attemptUsage = attempts.map(item => ({ inputTokens: item.inputTokens, outputTokens: item.outputTokens,
        latencyMs: item.finished ? item.latencyMs : Math.round(performance.now() - item.started),
        errorCode: item.finished ? item.errorCode : error?.neutralCode ?? null }));
      const total = (key: 'inputTokens' | 'outputTokens') => !attemptUsage.length || attemptUsage.some(item => item[key] === null) ? null :
        attemptUsage.reduce((n, item) => n + item[key]!, 0);
      this.#usage = { inputTokens: total('inputTokens'), outputTokens: total('outputTokens'), latencyMs: Math.round(performance.now() - started),
        attempts: attempts.length, retries: Math.max(0, attempts.length - 1), reservations, externalCalls: attempts.length,
        costUsd: null, errorCode: error?.neutralCode ?? null, attemptUsage };
      if (error) error.usage = structuredClone(this.#usage);
    }
  }
  async #read(response: Response, signal: AbortSignal): Promise<unknown> {
    const reader = response.body?.getReader();
    if (!reader) throw new ProviderError('schema');
    const abort = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', abort, { once: true });
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        signal.throwIfAborted();
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 65536) throw new ProviderError('schema');
        chunks.push(value);
      }
      signal.throwIfAborted();
      const text = Buffer.concat(chunks).toString('utf8');
      if (this.#guard.reflects(text)) throw new ProviderError('schema');
      return JSON.parse(text);
    } finally { signal.removeEventListener('abort', abort); void reader.cancel().catch(() => {}); }
  }
}
