import { readFileSync } from 'node:fs';
import { Agent } from 'undici';
import type { InterpretationProvider, ProviderInput, ProviderUsage, ProviderErrorCode } from './types.ts';
import { ProviderError, abortError } from './types.ts';
import { withDeadline } from './pipeline.ts';
import { OUTPUT_SCHEMA, validateProposal } from './validator.ts';
import { GeminiDiagnostics } from './gemini-response.ts';
import type { DiagnosticAttempt } from './gemini-response.ts';
import { networkFailure } from './network.ts';
import { SecretGuard } from './secrets.ts';
import { tokenCount } from './remote.ts';
import type { ModelRawObserver } from './remote.ts';

export const OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
export const validOllamaModel = (model: string) => /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(model);
export function ollamaBaseUrl(value = OLLAMA_BASE_URL): string {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
    // Pin localhost to a literal loopback address; never resolve a configurable hostname.
    if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
    return url.origin;
  } catch { throw new ProviderError('request'); }
}
export function ollamaConfig(env: NodeJS.ProcessEnv) {
  const model = env.OLLAMA_MODEL_ID ?? '';
  const timeoutMs = Number(env.OLLAMA_TIMEOUT_MS ?? 60000);
  if (!validOllamaModel(model) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) return undefined;
  try { return { model, timeoutMs, baseUrl: ollamaBaseUrl(env.OLLAMA_BASE_URL) }; } catch { return undefined; }
}

/** Shared by settings/test/tags and regenerated game adapters. No Google quota state. */
export class OllamaQueue {
  #tail: Promise<void> = Promise.resolve();
  async run<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    const before = this.#tail;
    let release!: () => void;
    this.#tail = new Promise<void>(resolve => { release = resolve; });
    let rejectAbort!: (reason: unknown) => void;
    const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const cancel = () => { rejectAbort(abortError(signal)); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      await Promise.race([before, aborted]); signal.throwIfAborted();
      return await work();
    } finally {
      signal.removeEventListener('abort', cancel);
      // Even a cancelled waiter cannot allow its successor to jump an active request.
      void before.then(release);
    }
  }
}
const systemPrompt = readFileSync(new URL('./system.ko.txt', import.meta.url), 'utf8');
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function decodeOllama(value: unknown) {
  const envelope = object(value), message = object(envelope.message);
  let text = typeof message.content === 'string' ? message.content : '';
  // Separate thinking is deliberately ignored. Strip only complete leading think blocks;
  // incomplete/unbalanced reasoning is rejected, never salvaged by searching for JSON.
  text = text.trim();
  while (text.startsWith('<think>')) {
    const end = text.indexOf('</think>');
    if (end < 0) return { text: '', errorCode: 'truncated' as const };
    text = text.slice(end + 8).trim();
  }
  const errorCode: ProviderErrorCode | undefined = envelope.done_reason === 'length' || envelope.done === false ? 'truncated' :
    envelope.done !== true || message.role !== 'assistant' || /<\/?think>/.test(text) ? 'parse' : !text ? 'empty' : undefined;
  return { text, errorCode };
}

export class OllamaClient {
  readonly baseUrl: string;
  readonly model: string;
  readonly timeoutMs: number;
  #transport: typeof fetch;
  #queue: OllamaQueue;
  #diagnostics: GeminiDiagnostics;
  #guard: Pick<SecretGuard, 'reflects'>;
  constructor(config: { baseUrl?: string; model: string; timeoutMs: number }, transport: typeof fetch = globalThis.fetch,
    queue = new OllamaQueue(), diagnostics = new GeminiDiagnostics(), guard: Pick<SecretGuard, 'reflects'> = new SecretGuard('')) {
    this.baseUrl = ollamaBaseUrl(config.baseUrl); this.model = config.model; this.timeoutMs = config.timeoutMs;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 120000) throw new ProviderError('request');
    this.#transport = transport; this.#queue = queue; this.#diagnostics = diagnostics; this.#guard = guard;
  }
  async #read(response: Response, signal: AbortSignal, diagnostic?: DiagnosticAttempt): Promise<unknown> {
    diagnostic?.observe(response.status, undefined);
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new ProviderError(response.status === 404 ? 'model' : response.status === 400 ? 'request' : 'server');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new ProviderError('parse');
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      const chunks: Uint8Array[] = []; let size = 0;
      for (;;) {
        signal.throwIfAborted(); const chunk = await reader.read(); signal.throwIfAborted();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 65536) throw new ProviderError('parse');
        chunks.push(chunk.value);
      }
      const text = Buffer.concat(chunks).toString('utf8');
      if (this.#guard.reflects(text)) throw new ProviderError('schema');
      let value: unknown;
      try { value = JSON.parse(text); } catch { throw new ProviderError('parse'); }
      diagnostic?.observe(response.status, value); return value;
    } finally { signal.removeEventListener('abort', cancel); cancel(); }
  }
  async request<T>(path: '/api/chat' | '/api/tags', signal: AbortSignal, body: unknown,
    callKind: 'connection_test' | 'command' | 'npc' | 'meeting' | undefined, consume: (value: unknown) => T, onAttempt?: () => void): Promise<T> {
    let diagnostic: DiagnosticAttempt | undefined, code = 'ok';
    const dispatcher = new Agent({ autoSelectFamily: false, allowH2: false });
    try {
      return await withDeadline(bounded => this.#queue.run(bounded, async () => {
        if (callKind) diagnostic = this.#diagnostics.begin({ provider: 'ollama', model: this.model, networkMode: 'direct', route: 'direct',
          callKind, retries: 0, dailyCalls: 0, sessionCalls: 0 }, this.#guard);
        let response: Response;
        try {
          onAttempt?.();
          response = await this.#transport(this.baseUrl + path, { method: body === undefined ? 'GET' : 'POST', redirect: 'error',
            signal: bounded, dispatcher, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) } as RequestInit);
        } catch (error) {
          if (error instanceof ProviderError) throw error;
          const failure = networkFailure(error); diagnostic?.network(failure.error);
          throw bounded.aborted ? abortError(bounded) : new ProviderError(failure.result);
        }
        bounded.throwIfAborted(); const value = await this.#read(response, bounded, diagnostic); bounded.throwIfAborted(); return consume(value);
      }), this.timeoutMs, signal);
    } catch (error) {
      const safe = error instanceof ProviderError ? error : signal.aborted ? abortError(signal) : new ProviderError('parse');
      code = safe.neutralCode; throw safe;
    } finally {
      diagnostic?.finish(code);
      // Destroy sockets on cancellation; never leave a local request running in the background.
      void dispatcher.destroy().catch(() => {});
    }
  }
  chatBody(input?: ProviderInput) {
    if (!validOllamaModel(this.model)) throw new ProviderError('model');
    const { diagnosticKind: _kind, ...payload } = input ?? {};
    // Native /api/chat has an explicit `format` JSON-schema contract and non-streaming
    // `message.content`, `done`, `prompt_eval_count`, `eval_count` response fields.
    // Reference contract: https://docs.ollama.com/api/chat and /capabilities/structured-outputs.
    // Use it instead of depending on the separate OpenAI response_format translation.
    // Installed-version support is NOT probed here: rejection remains a single request error.
    // `think:false` + qwen3 /no_think disable reasoning where supported; decoder still guards it.
    return { model: this.model, stream: false, think: false, format: input ? OUTPUT_SCHEMA : { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
      messages: [{ role: 'system', content: input ? systemPrompt : 'Return exactly {"ok":true}.' },
        { role: 'user', content: (input ? JSON.stringify(payload) : 'Connection test.') + (/^qwen3(?:[:/-]|$)/i.test(this.model) ? '\n/no_think' : '') }],
      options: { temperature: 0, num_predict: input ? 2048 : 256 } };
  }
  async tags(signal = new AbortController().signal) {
    return this.request('/api/tags', signal, undefined, undefined, value => {
      const models = object(value).models;
      if (!Array.isArray(models) || models.length > 500) throw new ProviderError('parse');
      const names = models.map(item => object(item).name);
      if (!names.every(name => typeof name === 'string' && validOllamaModel(name))) throw new ProviderError('parse');
      return [...new Set(names as string[])];
    });
  }
  async test(signal = new AbortController().signal) {
    return this.request('/api/chat', signal, this.chatBody(), 'connection_test', value => {
      const decoded = decodeOllama(value); if (decoded.errorCode) throw new ProviderError(decoded.errorCode);
      let result: unknown; try { result = JSON.parse(decoded.text); } catch { throw new ProviderError('parse'); }
      if (JSON.stringify(result) !== '{"ok":true}') throw new ProviderError('schema');
      return 'ok' as const;
    });
  }
}
export class OllamaProvider implements InterpretationProvider {
  readonly source = 'AI' as const;
  readonly status = 'AI 로컬 Ollama · 모델 제안 검증';
  #client: OllamaClient;
  #observer?: ModelRawObserver;
  #usage?: ProviderUsage;
  get lastUsage() { return this.#usage && structuredClone(this.#usage); }
  constructor(client: OllamaClient, observer?: ModelRawObserver) { this.#client = client; this.#observer = observer; }
  async interpret(input: ProviderInput, signal: AbortSignal) {
    const started = performance.now(); let inputTokens: number | null = null, outputTokens: number | null = null;
    let error: ProviderError | undefined, attempts = 0;
    try {
      return await this.#client.request('/api/chat', signal, this.#client.chatBody(input), input.diagnosticKind ?? (input.character ? 'npc' : 'command'), value => {
        attempts = 1; const envelope = object(value); inputTokens = tokenCount(envelope.prompt_eval_count); outputTokens = tokenCount(envelope.eval_count);
        const decoded = decodeOllama(value); if (decoded.errorCode) throw new ProviderError(decoded.errorCode);
        let raw: unknown; try { raw = JSON.parse(decoded.text); } catch { throw new ProviderError('parse'); }
        this.#observer?.(raw);
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ProviderError('schema');
        return validateProposal({ ...raw, usage: { inputTokens: inputTokens ?? 0, outputTokens: outputTokens ?? 0, externalCalls: 1, costUsd: null } }, input);
      }, () => { attempts = 1; });
    } catch (caught) { error = caught instanceof ProviderError ? caught : new ProviderError('server'); throw error; }
    finally {
      const latencyMs = Math.round(performance.now() - started);
      this.#usage = { inputTokens, outputTokens, latencyMs, errorCode: error?.neutralCode ?? null,
        attempts, externalCalls: attempts, reservations: 0, retries: 0, costUsd: null,
        attemptUsage: attempts ? [{ inputTokens, outputTokens, latencyMs, errorCode: error?.neutralCode ?? null }] : [] };
      if (error) error.usage = this.lastUsage;
    }
  }
}
