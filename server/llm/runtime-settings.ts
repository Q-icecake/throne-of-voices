import { GeminiProvider } from './gemini.ts';
import { CallBudget } from './budget.ts';
import type { ProviderConfig } from './config.ts';
import { geminiGenerationSettings } from './config.ts';
import { CONNECTION_MAX_TOKENS, decodeGemini, GeminiDiagnostics, readGeminiResponse, thinkingConfig } from './gemini-response.ts';
import { SecretGuard } from './secrets.ts';
import { ProviderError } from './types.ts';
import { withDeadline } from './pipeline.ts';
import type { ConnectionTestResult, LlmStatus, NetworkMode } from '../../shared/contracts.ts';
import { dirname, join } from 'node:path';
import type { DiagnosticAttempt } from './gemini-response.ts';
import { fetchWithDiagnostics, proxyDetected } from './network.ts';
import { NetworkRouter } from './network-routing.ts';
import type { SystemProxyReader } from './network-routing.ts';

export interface RuntimeOptions { env?: NodeJS.ProcessEnv; transport?: typeof fetch; budgetFile?: string; timeoutMs?: number; diagnosticsFile?: string; readSystemProxy?: SystemProxyReader }
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
  #budget: CallBudget;
  #diagnostics: GeminiDiagnostics;
  #generation: ReturnType<typeof geminiGenerationSettings>;
  #proxyDetected: boolean;
  #network: NetworkRouter;
  constructor(options: RuntimeOptions = {}) {
    const env = options.env ?? process.env;
    this.#network = new NetworkRouter(env, options.readSystemProxy);
    this.#proxyDetected = proxyDetected(env);
    this.#generation = geminiGenerationSettings(env);
    this.#diagnostics = new GeminiDiagnostics(options.diagnosticsFile ?? (options.budgetFile ? join(dirname(options.budgetFile), 'llm-diagnostics.jsonl') : undefined));
    this.#key = env.GEMINI_API_KEY ?? '';
    this.#source = this.#key ? 'env' : 'none';
    this.#guards.push(new SecretGuard(this.#key));
    const model = env.GEMINI_MODEL_ID ?? '';
    this.#model = /^[a-zA-Z0-9._-]{1,200}$/.test(model) && !this.reflects(model) ? model : '';
    this.#transport = options.transport ?? globalThis.fetch;
    this.#timeout = options.timeoutMs ?? 15000;
    this.#budget = new CallBudget({ model: 'runtime', timeoutMs: 15000, retries: 0, dailyLimit: 30, sessionLimit: 30 }, options.budgetFile);
  }
  status(): LlmStatus { return { ...this.#network.status(), networkError: this.#diagnostics.latest({ reflects: text => this.reflects(text) })?.networkError ?? null,
    keyConfigured: !!this.#key, keySource: this.#source, model: this.#model, proxyDetected: this.#proxyDetected,
    lastDiagnostic: this.#diagnostics.latest({ reflects: text => this.reflects(text) }),
    ...this.#budget.snapshot(), limit: this.#limit, testResult: this.#result, mode: this.#mode }; }
  resetUsage() { this.#invalidate(); return this.#budget.resetToday(); }
  reflects(text: string) { return this.#guards.some(guard => guard.reflects(text)); }
  assertSafe(value: unknown) { for (const guard of this.#guards) guard.assertSafe(value); }
  #invalidate() { this.#version++; this.#pending?.abort(); this.#pending = undefined; this.#result = 'untested'; }
  configure(model: string, key: string, limit: number, networkMode?: NetworkMode, proxyAddress = '', clearProxy = false) {
    const guard = new SecretGuard(key);
    if (this.reflects(model) || guard.reflects(model)) throw new ProviderError('schema');
    // Validate before invalidating or mutating the current working configuration.
    if (networkMode) this.#network.configure(networkMode, proxyAddress);
    if (clearProxy) this.#network.clearManual();
    this.#invalidate();
    if (key) { this.#guards.push(guard); this.#key = key; this.#source = 'screen'; }
    this.#model = model; this.#limit = limit; this.#budget.setLimits(limit, limit); this.#mode = 'mock';
  }
  clear() { this.#invalidate(); this.#key = ''; this.#source = 'none'; this.#network.clearManual(); this.#mode = 'mock'; }
  select(mode: 'mock' | 'ai') {
    if (mode === 'ai' && (!this.#key || !this.#model)) throw new ProviderError('auth');
    if (mode === 'ai' && !this.#generation) throw new ProviderError('request');
    this.#version++; this.#pending?.abort(); this.#pending = undefined; this.#mode = mode;
  }
  provider() {
    if (this.#mode !== 'ai') return undefined;
    if (!this.#generation) throw new ProviderError('request');
    const config: ProviderConfig = { ...this.#generation, model: this.#model, timeoutMs: this.#timeout, retries: 0, dailyLimit: this.#limit, sessionLimit: this.#limit };
    return new GeminiProvider(config, this.#transport, this.#budget, this.#key, this.#diagnostics, this.#network);
  }
  async test(): Promise<ConnectionTestResult> {
    // A second click invalidates the first, but never refunds its reservation.
    this.#pending?.abort();
    const version = ++this.#version, controller = new AbortController(); this.#pending = controller;
    const key = this.#key, model = this.#model;
    let result: ConnectionTestResult;
    let diagnostic: DiagnosticAttempt | undefined;
    try {
      if (!key || !model) throw new ProviderError('auth');
      if (!this.#generation) throw new ProviderError('request');
      this.#budget.reserve();
      const selection = this.#network.select();
      diagnostic = this.#diagnostics.begin({ ...selection.metadata(), model, callKind: 'connection_test', retries: 0, ...this.#budget.snapshot() }, { reflects: text => this.reflects(text) });
      result = await withDeadline(async signal => {
        const response = await fetchWithDiagnostics(this.#transport, 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
          method: 'POST', redirect: 'error', signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with exactly OK.' }] }],
            generationConfig: { maxOutputTokens: CONNECTION_MAX_TOKENS, temperature: 0, ...thinkingConfig(model, this.#generation?.thinkingMode) } }),
        }, diagnostic, selection);
        signal.throwIfAborted();
        const value = await readGeminiResponse(response, signal, { reflects: text => this.reflects(text) }, diagnostic);
        const decoded = decodeGemini(value);
        if (decoded.errorCode) throw new ProviderError(decoded.errorCode);
        return decoded.complete && decoded.text.trim() === 'OK' ? 'ok' : 'schema';
      }, this.#timeout, controller.signal);
    } catch (error) {
      result = error instanceof ProviderError ? error.neutralCode === 'aborted' ? 'stale' : error.budgetDetail ? error.budgetDetail.scope === 'daily' ? 'daily_limit' : 'session_limit' : error.neutralCode : error instanceof SyntaxError ? 'schema' : 'server';
    }
    diagnostic?.finish(result);
    if (version !== this.#version) return 'stale';
    this.#pending = undefined; this.#result = result; return result;
  }
}
