import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ProviderConfig } from './config.ts';
import type { CallBudget } from './budget.ts';
import type { ProviderInput } from './types.ts';
import { OUTPUT_SCHEMA } from './validator.ts';
import { RemoteProvider } from './remote.ts';
import type { DecodedOutput, ModelRawObserver } from './remote.ts';
import { decodeGemini, GeminiDiagnostics, readGeminiResponse, thinkingConfig, GAME_MAX_TOKENS } from './gemini-response.ts';
import type { SecretGuard } from './secrets.ts';
import { ProviderError } from './types.ts';
import type { DiagnosticAttempt } from './gemini-response.ts';
import { NetworkRouter } from './network-routing.ts';
import type { NetworkSelection } from './network-routing.ts';
// Keep the evaluation worktree's old import paths valid while configuration moves out.
export { geminiConfig, configuredProvider } from './config.ts';
export { CallBudget } from './budget.ts';
export type GeminiConfig = ProviderConfig;
const systemPrompt = readFileSync(new URL('./system.ko.txt', import.meta.url), 'utf8');
export class GeminiProvider extends RemoteProvider {
  #model: string;
  #generation: object;
  #diagnostics: GeminiDiagnostics;
  #network?: NetworkRouter;
  protected override parseErrorCode = 'parse' as const;
  constructor(config: GeminiConfig, transport: typeof fetch = globalThis.fetch, budget?: CallBudget,
    key = process.env.GEMINI_API_KEY ?? '', diagnostics = new GeminiDiagnostics(budget ? join(dirname(budget.storageFile), 'llm-diagnostics.jsonl') : undefined), network?: NetworkRouter, onModelRaw?: ModelRawObserver) {
    super(config, key, transport, budget, onModelRaw); this.#model = config.model; this.#diagnostics = diagnostics;
    this.#network = network;
    const maxOutputTokens = config.maxOutputTokens ?? GAME_MAX_TOKENS;
    if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 256 || maxOutputTokens > 32768 ||
      (config.thinkingMode !== undefined && !['low', 'default'].includes(config.thinkingMode))) throw new ProviderError('auth');
    this.#generation = { maxOutputTokens, ...thinkingConfig(config.model, config.thinkingMode) };
  }
  protected request(input: ProviderInput, signal: AbortSignal, key: string): [string, RequestInit] {
    const { diagnosticKind: _localKind, ...payload } = input;
    return ['https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(this.#model) + ':generateContent', {
      method: 'POST', redirect: 'error', signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify(payload) }] }],
        generationConfig: { ...this.#generation, responseMimeType: 'application/json', responseJsonSchema: OUTPUT_SCHEMA } }),
    }];
  }
  protected decode(value: unknown): DecodedOutput {
    return decodeGemini(value);
  }
  protected override networkSelection() { return this.#network?.select(); }
  protected override beginDiagnostic(input: ProviderInput, retries: number, budget: ReturnType<CallBudget['snapshot']>, guard: SecretGuard, selection?: NetworkSelection) {
    return this.#diagnostics.begin({ ...selection?.metadata(), model: this.#model, callKind: input.diagnosticKind ?? (input.character ? 'npc' : 'command'),
      retries, dailyCalls: budget.dailyCalls, sessionCalls: budget.sessionCalls }, guard);
  }
  protected override readResponse(response: Response, signal: AbortSignal, guard: SecretGuard, diagnostic?: DiagnosticAttempt) {
    return readGeminiResponse(response, signal, guard, diagnostic);
  }
}
