// V1 integration seam: provider selection and settings belong to the neutral factory.
import { configuredProvider, geminiConfig, providerConfig } from '../../server/llm/config.ts';
import { CallBudget } from '../../server/llm/budget.ts';
import { isolatedUsageFile, PLAY_USAGE_FILE } from '../../server/llm/usage-file.ts';
import { ProviderError } from '../../server/llm/types.ts';
import { SecretGuard } from '../../server/llm/secrets.ts';
import { NetworkRouter, readWindowsProxy } from '../../server/llm/network-routing.ts';
import type { SystemProxyReader } from '../../server/llm/network-routing.ts';
import { GAME_MAX_TOKENS } from '../../server/llm/gemini-response.ts';
import type { NetworkMode } from '../../shared/contracts.ts';
import type { Attempt, EvalNetwork, Source } from './types.ts';

export interface LiveRuntime {
  transport?: typeof fetch; budgetFile?: string; networkMode?: NetworkMode; proxy?: string;
  readSystemProxy?: SystemProxyReader;
}

/** Addresses never enter prompts or metadata; reject accidental reflection at export boundaries too. */
class EvalSecrets extends SecretGuard {
  #addresses = new Set<string>();
  addAddress(value: string | undefined) {
    if (!value) return;
    this.#addresses.add(value);
    for (const part of value.split(';')) {
      const entry = part.trim();
      const address = (/^(?:https?|socks)=/i.test(entry) ? entry.slice(entry.indexOf('=') + 1) : entry).trim();
      if (!address) continue;
      this.#addresses.add(address);
      try {
        const url = new URL(address.includes('://') ? address : `http://${address}`);
        this.#addresses.add(url.host);
        if (url.username) this.#addresses.add(url.username);
        if (url.password) this.#addresses.add(url.password);
      } catch { /* Invalid values are still protected verbatim. */ }
    }
  }
  override reflects(text: string): boolean {
    return super.reflects(text) || [...this.#addresses].some(address =>
      [address, encodeURIComponent(address), Buffer.from(address).toString('base64')].some(value => text.includes(value)));
  }
}

export const errorCode = (error: unknown): string => error instanceof ProviderError ? error.code : 'PROVIDER_ERROR';
const token = (v: unknown): number | null => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;

/** Bounded numeric usage only, including failed responses. Never log upstream text. */
export function observedTransport(transport: typeof fetch, attempts: Attempt[], limit: number, guard = () => {},
  format: 'gemini' | 'openai-compatible' = 'gemini'): typeof fetch {
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
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown };
              usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
            } | null;
            record.inputTokens = token(format === 'gemini' ? body?.usageMetadata?.promptTokenCount : body?.usage?.prompt_tokens);
            record.outputTokens = token(format === 'gemini' ? body?.usageMetadata?.candidatesTokenCount : body?.usage?.completion_tokens);
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
  runtime: LiveRuntime = {}): Source | undefined {
  const format = env.LLM_PROVIDER;
  if ((format !== 'gemini' && format !== 'openai-compatible') || !Number.isSafeInteger(maxCalls) || maxCalls <= 0) return undefined;
  // The CLI is one attempt per case, regardless of inherited retry settings.
  const settings = { ...env, LLM_RETRIES: '0' };
  const config = format === 'gemini' ? geminiConfig(settings) : providerConfig(settings, env.OPENAI_COMPAT_MODEL_ID ?? '');
  if (!config || config.dailyLimit <= 0 || config.sessionLimit <= 0) return undefined;
  if (format !== 'gemini' && (runtime.proxy || runtime.networkMode && runtime.networkMode !== 'auto'))
    throw new Error('NETWORK_GOOGLE_ONLY');
  const isolated = !!(runtime.transport || process.env.NODE_TEST_CONTEXT || env.LLM_DIAGNOSTIC_SOURCE === 'test');
  const secretGuard = new EvalSecrets((format === 'gemini' ? env.GEMINI_API_KEY : env.OPENAI_COMPAT_API_KEY) ?? '');
  for (const address of [runtime.proxy, env.HTTPS_PROXY, env.https_proxy, env.HTTP_PROXY, env.http_proxy, env.OPENAI_COMPAT_BASE_URL])
    secretGuard.addAddress(address);
  const readSystem = runtime.readSystemProxy ?? (isolated ? () => ({ enabled: false, server: '', pac: false }) : readWindowsProxy);
  let network: EvalNetwork | undefined;
  class EvalRouter extends NetworkRouter {
    override select() {
      const selection = super.select();
      network = { ...selection.metadata(), pacUnsupported: selection.pacUnsupported };
      return selection;
    }
  }
  const router = new EvalRouter(env, () => { const value = readSystem(); secretGuard.addAddress(value.server); return value; });
  router.configure(runtime.networkMode ?? 'auto', runtime.proxy);
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
  const transport = observedTransport(runtime.transport ?? globalThis.fetch, attempts, maxCalls, guard, format);
  const budgetFile = runtime.budgetFile ?? (isolated ? isolatedUsageFile() : env.LLM_USAGE_FILE || PLAY_USAGE_FILE);
  const selected = configuredProvider(settings, transport, { budget: new ObservedBudget(config, budgetFile), network: router });
  if (!selected.provider) return undefined;
  const provider = selected.provider;
  return {
    secretGuard,
    counterPolicy: isolated || runtime.budgetFile ? 'isolated-test' : 'shared-play-daily',
    networkPolicy: format === 'gemini' ? runtime.networkMode ?? 'auto' : 'provider-managed',
    maxOutputTokens: format === 'gemini' ? config.maxOutputTokens ?? GAME_MAX_TOKENS : undefined,
    model: `${format}/${config.model}`, timeoutMs: selected.timeoutMs,
    async sample(_fixture, input) {
      const first = attempts.length, reserved = reservations;
      network = undefined;
      let raw: unknown, error: string | undefined;
      try { raw = await provider.interpret(input, AbortSignal.timeout(config.timeoutMs)); secretGuard.assertSafe(raw); }
      catch (e) { raw = undefined; error = budgetStop ?? errorCode(e); }
      const observed = attempts.slice(first);
      if (error && observed.length && !observed.at(-1)!.error) observed.at(-1)!.error = error;
      return { raw, error, attempts: structuredClone(observed), reservations: reservations - reserved, network };
    },
  };
}
