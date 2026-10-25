import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { defaultUsageFile } from './usage-file.ts';
import { ProviderError } from './types.ts';
import type { ProviderErrorCode } from './types.ts';
import { SecretGuard } from './secrets.ts';

export const CONNECTION_MAX_TOKENS = 256;
export const GAME_MAX_TOKENS = 2048;
export type ThinkingMode = 'low' | 'default';
/** Prefix policy; unknown families receive no speculative parameters. */
export function thinkingConfig(model: string, mode: ThinkingMode = 'low') {
  if (mode === 'default') return {};
  if (/^gemini-3(?:\.\d+)?-flash(?:-|$)/.test(model)) return { thinkingConfig: { thinkingLevel: 'minimal' } };
  if (/^gemini-3(?:\.\d+)?-pro(?:-|$)/.test(model)) return { thinkingConfig: { thinkingLevel: 'low' } };
  if (/^gemini-2\.5-flash(?:-|$)/.test(model)) return { thinkingConfig: { thinkingBudget: 0 } };
  if (/^gemini-2\.5-pro(?:-|$)/.test(model)) return { thinkingConfig: { thinkingBudget: 128 } };
  return {};
}

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 10000000 ? value : null;
const statuses = new Set(['INVALID_ARGUMENT', 'NOT_FOUND', 'INTERNAL', 'UNAVAILABLE', 'RESOURCE_EXHAUSTED',
  'UNAUTHENTICATED', 'PERMISSION_DENIED', 'FAILED_PRECONDITION', 'DEADLINE_EXCEEDED', 'UNKNOWN']);
const reasons = new Set(['API_KEY_INVALID', 'API_KEY_EXPIRED', 'API_KEY_SERVICE_BLOCKED', 'API_KEY_HTTP_REFERRER_BLOCKED',
  'API_KEY_IP_ADDRESS_BLOCKED', 'SERVICE_DISABLED', 'BILLING_DISABLED', 'RATE_LIMIT_EXCEEDED', 'QUOTA_EXCEEDED',
  'MODEL_NOT_FOUND', 'INVALID_ARGUMENT']);
const finishes = new Set(['STOP', 'MAX_TOKENS', 'SAFETY', 'RECITATION', 'OTHER', 'BLOCKLIST', 'PROHIBITED_CONTENT',
  'SPII', 'MALFORMED_FUNCTION_CALL', 'UNEXPECTED_TOOL_CALL', 'FINISH_REASON_UNSPECIFIED']);
export interface GeminiDiagnostic {
  httpStatus: number; googleStatus: string | null; googleReason: string | null; finishReason: string | null;
  inputTokens: number | null; outputTokens: number | null; thinkingTokens: number | null;
}
export class GeminiDiagnostics {
  #file: string;
  constructor(file = join(dirname(defaultUsageFile()), 'llm-diagnostics.jsonl')) { this.#file = file; }
  write(httpStatus: number, value: unknown, guard: Pick<SecretGuard, 'reflects'>) {
    const envelope = record(value), error = record(envelope.error), usage = record(envelope.usageMetadata);
    const candidate = record(Array.isArray(envelope.candidates) ? envelope.candidates[0] : null);
    const safeEnum = (item: unknown, allowed: Set<string>) =>
      typeof item === 'string' && allowed.has(item) && !guard.reflects(item) ? item : null;
    const details = Array.isArray(error.details) ? error.details : [];
    const diagnostic: GeminiDiagnostic = { httpStatus, googleStatus: safeEnum(error.status, statuses),
      googleReason: details.map(item => safeEnum(record(item).reason, reasons)).find(Boolean) ?? null,
      finishReason: safeEnum(candidate.finishReason, finishes), inputTokens: count(usage.promptTokenCount),
      outputTokens: count(usage.candidatesTokenCount), thinkingTokens: count(usage.thoughtsTokenCount) };
    // Only fixed keys, allowlisted enums and bounded numbers cross this boundary.
    // Also guard numeric fields against a short/numeric credential reflection.
    const line = JSON.stringify(diagnostic);
    if (guard.reflects(line)) return;
    try { console.info(line); } catch { /* Diagnostic sinks cannot change request outcomes. */ }
    try { mkdirSync(dirname(this.#file), { recursive: true }); appendFileSync(this.#file, line + '\n'); }
    catch { /* Never print filesystem errors: a path may contain private information. */ }
  }
}

export function googleHttpError(status: number): ProviderErrorCode {
  return status === 400 ? 'request' : status === 404 ? 'model' : status === 401 || status === 403 ? 'auth' :
    status === 429 ? 'rate_limited' : status >= 500 ? 'google_server' : 'schema';
}
/** Bounded body parsing for both HTTP errors and successes, under the caller's deadline. */
export async function readGeminiResponse(response: Response, signal: AbortSignal,
  guard: Pick<SecretGuard, 'reflects'>, diagnostics: GeminiDiagnostics): Promise<unknown> {
  let envelope: unknown;
  const reader = response.body?.getReader();
  const cancel = () => { void reader?.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    try {
      if (!reader) throw new ProviderError('parse');
      const chunks: Uint8Array[] = []; let length = 0;
      for (;;) {
        signal.throwIfAborted();
        const chunk = await reader.read(); signal.throwIfAborted();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > 65536) throw new ProviderError('parse');
        chunks.push(chunk.value);
      }
      const text = Buffer.concat(chunks).toString('utf8');
      envelope = JSON.parse(text);
      if (response.ok && guard.reflects(text)) throw new ProviderError('schema');
    } catch (error) {
      if (signal.aborted) throw error;
      if (response.ok) throw error instanceof ProviderError ? error : new ProviderError('parse');
      // Malformed/reflected error text never overrides the known HTTP status.
    }
    if (!response.ok) throw new ProviderError(googleHttpError(response.status));
    return envelope;
  } finally {
    signal.removeEventListener('abort', cancel); cancel();
    diagnostics.write(response.status, envelope, guard);
  }
}

export function decodeGemini(value: unknown) {
  const envelope = record(value), usage = record(envelope.usageMetadata);
  const candidate = record(Array.isArray(envelope.candidates) ? envelope.candidates[0] : null);
  const parts = record(candidate.content).parts;
  const validParts = Array.isArray(parts) && parts.every(part => {
    const item = record(part);
    return part !== null && typeof part === 'object' && !Array.isArray(part) &&
      (item.text === undefined || typeof item.text === 'string') &&
      (item.thought === undefined || typeof item.thought === 'boolean');
  });
  const text = validParts ? parts.filter(part => record(part).thought !== true).map(part => record(part).text ?? '').join('') : '';
  const errorCode: ProviderErrorCode | undefined = candidate.finishReason === 'MAX_TOKENS' ? 'truncated' :
    !validParts || typeof candidate.finishReason !== 'string' ? 'parse' : !text.trim() ? 'empty' : undefined;
  return { text, complete: candidate.finishReason === 'STOP', errorCode,
    inputTokens: usage.promptTokenCount, outputTokens: usage.candidatesTokenCount };
}
