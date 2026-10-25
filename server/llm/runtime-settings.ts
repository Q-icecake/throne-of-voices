import { GeminiProvider } from './gemini.ts';
import { CallBudget } from './budget.ts';
import type { ProviderConfig } from './config.ts';
import { SecretGuard } from './secrets.ts';
import { ProviderError } from './types.ts';
import { withDeadline } from './pipeline.ts';
import type { ConnectionTestResult, LlmStatus } from '../../shared/contracts.ts';

/** One session counter shared by tests and play, across all settings/mode changes. */
class RuntimeBudget extends CallBudget {
  #used = 0;
  #limit = 30;
  #file?: string;
  constructor(file?: string) { super({ model: 'runtime', timeoutMs: 15000, retries: 0, dailyLimit: 30, sessionLimit: 30 }, file); this.#file = file; }
  setLimit(limit: number) { this.#limit = limit; }
  override reserve() {
    if (this.#used >= this.#limit) throw new ProviderError('budget');
    new CallBudget({ model: 'runtime', timeoutMs: 15000, retries: 0, dailyLimit: this.#limit, sessionLimit: this.#limit }, this.#file).reserve();
    this.#used++;
  }
}

export interface RuntimeOptions { env?: NodeJS.ProcessEnv; transport?: typeof fetch; budgetFile?: string; timeoutMs?: number }
export class RuntimeSettings {
  #key: string;
  #source: LlmStatus['keySource'];
  #model: string;
  #limit = 30;
  #result: ConnectionTestResult = 'untested';
  #mode: LlmStatus['mode'] = 'mock';
  #guards: SecretGuard[] = [];
  #version = 0;
  #pending?: AbortController;
  #transport: typeof fetch;
  #timeout: number;
  #budget: RuntimeBudget;
  constructor(options: RuntimeOptions = {}) {
    const env = options.env ?? process.env;
    this.#key = env.GEMINI_API_KEY ?? '';
    this.#source = this.#key ? 'env' : 'none';
    this.#guards.push(new SecretGuard(this.#key));
    const model = env.GEMINI_MODEL_ID ?? '';
    this.#model = /^[a-zA-Z0-9._-]{1,200}$/.test(model) && !this.reflects(model) ? model : '';
    this.#transport = options.transport ?? globalThis.fetch;
    this.#timeout = options.timeoutMs ?? 15000;
    this.#budget = new RuntimeBudget(options.budgetFile);
  }
  status(): LlmStatus { return { keyConfigured: !!this.#key, keySource: this.#source, model: this.#model,
    limit: this.#limit, testResult: this.#result, mode: this.#mode }; }
  reflects(text: string) { return this.#guards.some(guard => guard.reflects(text)); }
  assertSafe(value: unknown) { for (const guard of this.#guards) guard.assertSafe(value); }
  #invalidate() { this.#version++; this.#pending?.abort(); this.#pending = undefined; this.#result = 'untested'; }
  configure(model: string, key: string, limit: number) {
    const guard = new SecretGuard(key);
    if (this.reflects(model) || guard.reflects(model)) throw new ProviderError('schema');
    this.#invalidate();
    if (key) { this.#guards.push(guard); this.#key = key; this.#source = 'screen'; }
    this.#model = model; this.#limit = limit; this.#budget.setLimit(limit); this.#mode = 'mock';
  }
  clear() { this.#invalidate(); this.#key = ''; this.#source = 'none'; this.#mode = 'mock'; }
  select(mode: 'mock' | 'ai') {
    if (mode === 'ai' && (!this.#key || !this.#model)) throw new ProviderError('auth');
    this.#version++; this.#pending?.abort(); this.#pending = undefined; this.#mode = mode;
  }
  provider() {
    if (this.#mode !== 'ai') return undefined;
    const config: ProviderConfig = { model: this.#model, timeoutMs: this.#timeout, retries: 0, dailyLimit: this.#limit, sessionLimit: this.#limit };
    return new GeminiProvider(config, this.#transport, this.#budget, this.#key);
  }
  async test(): Promise<ConnectionTestResult> {
    // A second click invalidates the first, but never refunds its reservation.
    this.#pending?.abort();
    const version = ++this.#version, controller = new AbortController(); this.#pending = controller;
    const key = this.#key, model = this.#model;
    let result: ConnectionTestResult;
    try {
      if (!key || !model) throw new ProviderError('auth');
      this.#budget.reserve();
      result = await withDeadline(async signal => {
        const response = await this.#transport('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
          method: 'POST', redirect: 'error', signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with exactly OK.' }] }], generationConfig: { maxOutputTokens: 8, temperature: 0 } }),
        });
        signal.throwIfAborted();
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          return response.status === 401 || response.status === 403 ? 'auth' : response.status === 404 ? 'model' : response.status === 429 ? 'rate_limited' : response.status >= 500 ? 'server' : 'schema';
        }
        const reader = response.body?.getReader();
        if (!reader) return 'schema';
        const cancel = () => { void reader.cancel().catch(() => {}); };
        signal.addEventListener('abort', cancel, { once: true });
        try {
          let text = '', bytes = 0;
          const decoder = new TextDecoder();
          for (;;) {
            const chunk = await reader.read(); signal.throwIfAborted();
            if (chunk.done) break;
            bytes += chunk.value.byteLength; if (bytes > 65536) return 'schema';
            text += decoder.decode(chunk.value, { stream: true });
          }
          text += decoder.decode(); this.assertSafe(text);
          const value = JSON.parse(text);
          const candidate = value?.candidates?.[0];
          return candidate?.finishReason === 'STOP' && candidate?.content?.parts?.length === 1 && candidate.content.parts[0]?.text?.trim() === 'OK' ? 'ok' : 'schema';
        } finally { signal.removeEventListener('abort', cancel); cancel(); }
      }, this.#timeout, controller.signal);
    } catch (error) {
      result = error instanceof ProviderError ? error.neutralCode === 'aborted' ? 'stale' : error.neutralCode : error instanceof SyntaxError ? 'schema' : 'server';
    }
    if (version !== this.#version) return 'stale';
    this.#pending = undefined; this.#result = result; return result;
  }
}
