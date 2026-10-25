import { readFileSync } from 'node:fs';
import type { ProviderConfig } from './config.ts';
import type { CallBudget } from './budget.ts';
import type { ProviderInput } from './types.ts';
import { ProviderError } from './types.ts';
import { OUTPUT_SCHEMA } from './validator.ts';
import { RemoteProvider } from './remote.ts';
import type { DecodedOutput, ModelRawObserver } from './remote.ts';
import { SecretGuard } from './secrets.ts';

export interface OpenAICompatibleConfig extends ProviderConfig { baseUrl: string }
interface ChatEnvelope {
  choices?: { finish_reason?: string; message?: { content?: string; refusal?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}
const systemPrompt = readFileSync(new URL('./system.ko.txt', import.meta.url), 'utf8');
// Chat Completions supports compatible servers with explicit response_format JSON Schema.
// https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat
// Omit uniqueItems on the wire for broader strict-schema compatibility; enforce it locally.
const wireSchema = JSON.parse(JSON.stringify(OUTPUT_SCHEMA, (key, value: unknown) => key === 'uniqueItems' ? undefined : value));
export class OpenAICompatibleProvider extends RemoteProvider {
  #endpoint: string;
  #model: string;
  constructor(config: OpenAICompatibleConfig, transport: typeof fetch = globalThis.fetch, budget?: CallBudget,
    key = process.env.OPENAI_COMPAT_API_KEY ?? '', onModelRaw?: ModelRawObserver) {
    super(config, key, transport, budget, onModelRaw);
    let url: URL;
    try { url = new URL(config.baseUrl); } catch { throw new ProviderError('auth'); }
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) ||
      url.username || url.password || url.search || url.hash || new SecretGuard(key).reflects(config.baseUrl)) throw new ProviderError('auth');
    this.#endpoint = `${url.href.replace(/\/$/, '')}/chat/completions`; this.#model = config.model;
  }
  protected request(input: ProviderInput, signal: AbortSignal, key: string): [string, RequestInit] {
    const { diagnosticKind: _localKind, ...payload } = input;
    return [this.#endpoint, { method: 'POST', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: this.#model, messages: [{ role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify(payload) }], response_format: {
          type: 'json_schema', json_schema: { name: 'interpretation', strict: true, schema: wireSchema },
        } }),
    }];
  }
  protected decode(value: unknown): DecodedOutput {
    const envelope = value as ChatEnvelope | null;
    const choice = envelope?.choices?.[0];
    return { text: typeof choice?.message?.content === 'string' ? choice.message.content : '',
      complete: choice?.finish_reason === 'stop' && !choice.message?.refusal,
      inputTokens: envelope?.usage?.prompt_tokens, outputTokens: envelope?.usage?.completion_tokens };
  }
}
