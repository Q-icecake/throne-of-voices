import type { InterpretationProvider } from './types.ts';
import { GeminiProvider } from './gemini.ts';
import { OpenAICompatibleProvider } from './openai-compatible.ts';
import type { ThinkingMode } from './gemini-response.ts';

export interface ProviderConfig {
  model: string;
  timeoutMs: number;
  retries: number;
  dailyLimit: number;
  sessionLimit: number;
  maxOutputTokens?: number;
  thinkingMode?: ThinkingMode;
}
export function providerConfig(env: NodeJS.ProcessEnv, model: string): ProviderConfig | undefined {
  const integer = (key: string, fallback: number): number => {
    const value = env[key] === undefined ? fallback : Number(env[key]);
    return Number.isSafeInteger(value) && value >= 0 ? value : NaN;
  };
  const config = { model, timeoutMs: integer('LLM_TIMEOUT_MS', 15000), retries: integer('LLM_RETRIES', 0),
    dailyLimit: integer('LLM_DAILY_CALL_LIMIT', 0), sessionLimit: integer('LLM_SESSION_CALL_LIMIT', 0) };
  if (!model || /[\s\x00-\x1f\x7f]/.test(model) || model.length > 200 ||
    Object.values(config).some(v => typeof v === 'number' && !Number.isFinite(v)) ||
    config.timeoutMs <= 0 || config.timeoutMs > 15000 || config.retries > 100 ||
    config.dailyLimit > 10000 || config.sessionLimit > 10000) return undefined;
  return config;
}
/** Compatibility for the existing evaluation entry point; new callers use configuredProvider. */
export function geminiConfig(env: NodeJS.ProcessEnv = process.env): ProviderConfig | undefined {
  const model = env.GEMINI_MODEL_ID ?? '';
  const config = /^[a-zA-Z0-9._-]+$/.test(model) ? providerConfig(env, model) : undefined;
  if (!config) return undefined;
  const generation = geminiGenerationSettings(env);
  return generation ? { ...config, ...generation } : undefined;
}
export function geminiGenerationSettings(env: NodeJS.ProcessEnv): Pick<ProviderConfig, 'maxOutputTokens' | 'thinkingMode'> | undefined {
  const result: Pick<ProviderConfig, 'maxOutputTokens' | 'thinkingMode'> = {};
  if (env.GEMINI_MAX_OUTPUT_TOKENS !== undefined) {
    const value = Number(env.GEMINI_MAX_OUTPUT_TOKENS);
    if (!Number.isSafeInteger(value) || value < 256 || value > 32768) return undefined;
    result.maxOutputTokens = value;
  }
  if (env.GEMINI_THINKING_MODE !== undefined) {
    if (env.GEMINI_THINKING_MODE !== 'low' && env.GEMINI_THINKING_MODE !== 'default') return undefined;
    result.thinkingMode = env.GEMINI_THINKING_MODE;
  }
  return result;
}
export interface ProviderSelection { provider?: InterpretationProvider; status: string; timeoutMs: number }
export function configuredProvider(env: NodeJS.ProcessEnv = process.env, transport: typeof fetch = globalThis.fetch): ProviderSelection {
  const mock = (status: string): ProviderSelection => ({ status, timeoutMs: 15000 });
  if (!env.LLM_PROVIDER || env.LLM_PROVIDER === 'mock') return mock('AI 미연결, Mock 사용 중');
  if (!['gemini', 'openai-compatible'].includes(env.LLM_PROVIDER)) return mock('AI 설정 오류, Mock 사용 중');
  const gemini = env.LLM_PROVIDER === 'gemini';
  const key = (gemini ? env.GEMINI_API_KEY : env.OPENAI_COMPAT_API_KEY) ?? '';
  if (!key) return mock('AI 미연결, Mock 사용 중');
  const config = gemini ? geminiConfig(env) : providerConfig(env, env.OPENAI_COMPAT_MODEL_ID ?? '');
  if (!config) return mock('AI 설정 오류, Mock 사용 중');
  try {
    const provider = gemini ? new GeminiProvider(config, transport, undefined, key) :
      new OpenAICompatibleProvider({ ...config, baseUrl: env.OPENAI_COMPAT_BASE_URL ?? '' }, transport, undefined, key);
    return { provider, status: provider.status, timeoutMs: config.timeoutMs };
  } catch { return mock('AI 설정 오류, Mock 사용 중'); }
}
