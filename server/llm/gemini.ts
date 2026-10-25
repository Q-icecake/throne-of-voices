import { readFileSync } from 'node:fs';
import type { ProviderConfig } from './config.ts';
import type { CallBudget } from './budget.ts';
import type { ProviderInput } from './types.ts';
import { OUTPUT_SCHEMA } from './validator.ts';
import { RemoteProvider } from './remote.ts';
import type { DecodedOutput } from './remote.ts';
// Keep the evaluation worktree's old import paths valid while configuration moves out.
export { geminiConfig, configuredProvider } from './config.ts';
export { CallBudget } from './budget.ts';
export type GeminiConfig = ProviderConfig;
const systemPrompt = readFileSync(new URL('./system.ko.txt', import.meta.url), 'utf8');
interface GeminiEnvelope {
  candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}
export class GeminiProvider extends RemoteProvider {
  #model: string;
  constructor(config: GeminiConfig, transport: typeof fetch = globalThis.fetch, budget?: CallBudget,
    key = process.env.GEMINI_API_KEY ?? '') {
    super(config, key, transport, budget); this.#model = config.model;
  }
  protected request(input: ProviderInput, signal: AbortSignal, key: string): [string, RequestInit] {
    return ['https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(this.#model) + ':generateContent', {
      method: 'POST', redirect: 'error', signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify(input) }] }],
        generationConfig: { responseMimeType: 'application/json', responseJsonSchema: OUTPUT_SCHEMA } }),
    }];
  }
  protected decode(value: unknown): DecodedOutput {
    const envelope = value as GeminiEnvelope | null;
    const candidate = envelope?.candidates?.[0];
    return { text: candidate?.content?.parts?.map(part => part.text ?? '').join('') ?? '',
      complete: candidate?.finishReason === 'STOP', inputTokens: envelope?.usageMetadata?.promptTokenCount,
      outputTokens: envelope?.usageMetadata?.candidatesTokenCount };
  }
}
