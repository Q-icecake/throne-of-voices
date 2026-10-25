// V1 integration seam: only this file imports the current provider implementation.
// Replace createCurrentProvider with the forthcoming LLM_PROVIDER factory adapter.
import { GeminiProvider, geminiConfig, CallBudget } from '../../server/llm/gemini.ts';
import { ProviderError } from '../../server/llm/types.ts';
import type { Attempt, Source } from './types.ts';

export const errorCode = (error: unknown): string => error instanceof ProviderError ? error.code : 'PROVIDER_ERROR';
const token = (v: unknown): number | null => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;

/** Bounded numeric usage only, including failed responses. Never log upstream text. */
export function observedTransport(transport: typeof fetch, attempts: Attempt[], limit: number, guard = () => {}): typeof fetch {
  return async (url, init) => {
    guard();
    if (attempts.length >= limit) throw new ProviderError('CALL_LIMIT');
    const start = performance.now();
    const record: Attempt = { latencyMs: 0, inputTokens: null, outputTokens: null };
    attempts.push(record);
    try {
      const response = await transport(url, init);
      record.status = response.status;
      if (!response.ok) record.error = response.status === 429 ? 'CALL_LIMIT' : `HTTP_${response.status}`;
      const reader = response.clone().body?.getReader();
      if (reader) {
        let size = 0;
        const chunks: Uint8Array[] = [];
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 65536) break;
            chunks.push(value);
          }
          if (size <= 65536) {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown } };
            record.inputTokens = token(body.usageMetadata?.promptTokenCount);
            record.outputTokens = token(body.usageMetadata?.candidatesTokenCount);
          }
        } catch { /* Missing usage stays null, never silently becomes zero. */ }
        finally { void reader.cancel().catch(() => {}); }
      }
      return response;
    } catch (error) {
      record.error = init?.signal?.aborted ? 'PROVIDER_TIMEOUT' : errorCode(error);
      throw error;
    } finally { record.latencyMs = Math.round((performance.now() - start) * 100) / 100; }
  };
}

export function liveSource(maxCalls: number, env: NodeJS.ProcessEnv = process.env,
  limits: { maxTokens?: number; budgetUsd?: number; inputPrice?: number; outputPrice?: number } = {},
  runtime: { transport?: typeof fetch; budgetFile?: string } = {}): Source | undefined {
  if (env.LLM_PROVIDER !== 'gemini' || !env.GEMINI_API_KEY || !Number.isSafeInteger(maxCalls) || maxCalls <= 0) return undefined;
  const config = geminiConfig(env);
  if (!config || config.dailyLimit <= 0 || config.sessionLimit <= 0) return undefined;
  const attempts: Attempt[] = [];
  let reservations = 0;
  let budgetStop: string | undefined;
  const guard = () => {
    const input = attempts.reduce((sum, a) => sum + (a.inputTokens ?? 0), 0);
    const output = attempts.reduce((sum, a) => sum + (a.outputTokens ?? 0), 0);
    if ((limits.maxTokens !== undefined || limits.budgetUsd !== undefined) && attempts.some(a => a.inputTokens === null || a.outputTokens === null)) budgetStop = 'USAGE_UNKNOWN';
    else if (limits.maxTokens !== undefined && input + output >= limits.maxTokens) budgetStop = 'TOKEN_BUDGET';
    else if (limits.budgetUsd !== undefined && (input * limits.inputPrice! + output * limits.outputPrice!) / 1e6 >= limits.budgetUsd) budgetStop = 'COST_BUDGET';
    if (budgetStop) throw new ProviderError('CALL_LIMIT');
  };
  class ObservedBudget extends CallBudget {
    override reserve(): void {
      guard();
      if (reservations >= maxCalls) throw new ProviderError('CALL_LIMIT');
      super.reserve(); reservations++;
    }
  }
  const provider = createCurrentProvider(config, observedTransport(runtime.transport ?? globalThis.fetch, attempts, maxCalls, guard), new ObservedBudget(config, runtime.budgetFile));
  return {
    model: `gemini/${config.model}`, timeoutMs: config.timeoutMs,
    async sample(_fixture, input) {
      const first = attempts.length, reserved = reservations;
      let raw: unknown, error: string | undefined;
      try { raw = await provider.interpret(input, AbortSignal.timeout(config.timeoutMs)); }
      catch (e) { error = budgetStop ?? errorCode(e); }
      const observed = attempts.slice(first);
      if (error && observed.length && !observed.at(-1)!.error) observed.at(-1)!.error = error;
      return { raw, error, attempts: structuredClone(observed), reservations: reservations - reserved };
    },
  };
}
const createCurrentProvider = (...args: ConstructorParameters<typeof GeminiProvider>) => new GeminiProvider(...args);
