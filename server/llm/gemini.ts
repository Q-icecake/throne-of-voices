import { mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { InterpretationProvider, ProviderInput } from './types.ts';
import { ProviderError } from './types.ts';
import { OUTPUT_SCHEMA } from './validator.ts';
import { withDeadline } from './pipeline.ts';

export interface GeminiConfig {
  model: string;
  timeoutMs: number;
  retries: number;
  dailyLimit: number;
  sessionLimit: number;
}

export function geminiConfig(env: NodeJS.ProcessEnv = process.env): GeminiConfig | undefined {
  const integer = (key: string, fallback?: number): number => {
    const value = env[key] === undefined ? fallback : Number(env[key]);
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : NaN;
  };
  const config = { model: env.GEMINI_MODEL_ID ?? '', timeoutMs: integer('LLM_TIMEOUT_MS', 15000),
    retries: integer('LLM_RETRIES', 0), dailyLimit: integer('LLM_DAILY_CALL_LIMIT', 0), sessionLimit: integer('LLM_SESSION_CALL_LIMIT', 0) };
  if (!/^[a-zA-Z0-9._-]+$/.test(config.model) || Object.values(config).some(v => typeof v === 'number' && !Number.isFinite(v)) ||
    config.timeoutMs <= 0 || config.timeoutMs > 15000) return undefined;
  return config;
}

/** Daily reservation survives restarts; session never resets with the world. Lock contention fails closed. */
export class CallBudget {
  #session = 0;
  #file: string;
  #config: GeminiConfig;
  #now: () => Date;
  constructor(config: GeminiConfig, file = fileURLToPath(new URL('../../artifacts/llm-usage.json', import.meta.url)), now = () => new Date()) {
    this.#config = config; this.#file = file; this.#now = now;
  }
  reserve(): void {
    if (this.#session >= this.#config.sessionLimit || this.#config.dailyLimit <= 0) throw new ProviderError('CALL_LIMIT');
    let lock: number;
    try {
      mkdirSync(dirname(this.#file), { recursive: true });
      lock = openSync(this.#file + '.lock', 'wx');
    } catch { throw new ProviderError('CALL_LIMIT'); }
    try { this.#reserveDaily(); }
    finally { closeSync(lock); unlinkSync(this.#file + '.lock'); }
  }
  #reserveDaily(): void {
    const day = this.#now().toISOString().slice(0, 10);
    let used = 0;
    try {
      const saved = JSON.parse(readFileSync(this.#file, 'utf8')) as { day: string; calls: number };
      if (typeof saved.day !== 'string' || !Number.isSafeInteger(saved.calls) || saved.calls < 0) throw new Error();
      if (saved.day === day) used = saved.calls;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new ProviderError('CALL_LIMIT');
    }
    if (used >= this.#config.dailyLimit) throw new ProviderError('CALL_LIMIT');
    try {
      writeFileSync(this.#file + '.tmp', JSON.stringify({ day, calls: used + 1 }));
      renameSync(this.#file + '.tmp', this.#file);
    } catch { throw new ProviderError('CALL_LIMIT'); }
    this.#session++;
  }
}

const systemPrompt = readFileSync(new URL('./system.ko.txt', import.meta.url), 'utf8');
export class GeminiProvider implements InterpretationProvider {
  readonly source = 'AI' as const;
  #key: string;
  #config: GeminiConfig;
  #fetch: typeof fetch;
  #budget: CallBudget;
  get status(): string { return this.#key ? 'AI 연결 설정됨 · 라이브 미검증' : 'AI 미연결, Mock 사용 중'; }
  constructor(config: GeminiConfig, transport: typeof fetch = globalThis.fetch, budget = new CallBudget(config)) {
    this.#key = process.env.GEMINI_API_KEY ?? '';
    this.#config = { ...config }; this.#fetch = transport; this.#budget = budget;
  }
  async interpret(input: ProviderInput, signal: AbortSignal): Promise<unknown> {
    if (!this.#key) throw new ProviderError('PROVIDER_ERROR');
    return withDeadline(async bounded => {
      let calls = 0;
      for (let attempt = 0; attempt <= this.#config.retries; attempt++) {
        bounded.throwIfAborted();
        this.#budget.reserve();
        calls++;
        try {
          const response = await this.#fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.#config.model}:generateContent`, {
            method: 'POST', redirect: 'error', signal: bounded,
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.#key },
            body: JSON.stringify({ systemInstruction: { parts: [{ text: systemPrompt }] },
              contents: [{ role: 'user', parts: [{ text: JSON.stringify(input) }] }],
              generationConfig: { responseMimeType: 'application/json', responseJsonSchema: OUTPUT_SCHEMA } }),
          });
          // A quota response stops immediately. Never switch model, billing tier or provider.
          if (!response.ok) {
            await response.body?.cancel();
            if (response.status === 429) throw new ProviderError('CALL_LIMIT');
            if (response.status >= 500 && attempt < this.#config.retries) continue;
            throw new ProviderError('PROVIDER_ERROR');
          }
          // Bound the envelope before parsing; never log upstream errors/headers/body.
          const reader = response.body?.getReader();
          if (!reader) throw new ProviderError('INVALID_PROPOSAL');
          const chunks: Uint8Array[] = [];
          let length = 0;
          try {
            for (;;) {
              const { value, done } = await reader.read();
              if (done) break;
              length += value.byteLength;
              if (length > 65536) throw new ProviderError('INVALID_PROPOSAL');
              chunks.push(value);
            }
          } finally { await reader.cancel().catch(() => {}); }
          const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const candidate = envelope.candidates?.[0];
          if (candidate?.finishReason !== 'STOP') throw new ProviderError('INVALID_PROPOSAL');
          const text = candidate.content?.parts?.map((part: { text?: string }) => part.text ?? '').join('');
          if (typeof text !== 'string' || text.includes(this.#key)) throw new ProviderError('INVALID_PROPOSAL');
          const result = JSON.parse(text);
          return { ...result, usage: { inputTokens: envelope.usageMetadata?.promptTokenCount ?? 0,
            outputTokens: envelope.usageMetadata?.candidatesTokenCount ?? 0, externalCalls: calls, costUsd: null } };
        } catch (error) {
          if (bounded.aborted) throw new ProviderError('PROVIDER_TIMEOUT');
          if (error instanceof ProviderError) throw error;
          if (error instanceof SyntaxError) throw new ProviderError('INVALID_PROPOSAL');
          if (attempt >= this.#config.retries) throw new ProviderError('PROVIDER_ERROR');
        }
      }
      throw new ProviderError('PROVIDER_ERROR');
    }, this.#config.timeoutMs, signal);
  }
}

export function configuredProvider(): { provider?: InterpretationProvider; status: string; timeoutMs: number } {
  if (!process.env.LLM_PROVIDER || process.env.LLM_PROVIDER === 'mock') return { status: 'AI 미연결, Mock 사용 중', timeoutMs: 15000 };
  if (process.env.LLM_PROVIDER !== 'gemini') return { status: 'AI 설정 오류, Mock 사용 중', timeoutMs: 15000 };
  if (!process.env.GEMINI_API_KEY) return { status: 'AI 미연결, Mock 사용 중', timeoutMs: 15000 };
  const config = geminiConfig();
  if (!config) return { status: 'AI 설정 오류, Mock 사용 중', timeoutMs: 15000 };
  const provider = new GeminiProvider(config);
  return { provider, status: provider.status, timeoutMs: config.timeoutMs };
}
