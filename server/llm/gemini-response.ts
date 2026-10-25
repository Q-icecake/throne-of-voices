import { mkdirSync, readFileSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { defaultUsageFile } from './usage-file.ts';
import { ProviderError } from './types.ts';
import type { ProviderErrorCode } from './types.ts';
import { SecretGuard } from './secrets.ts';
import type { LlmDiagnostic } from '../../shared/contracts.ts';

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
export type GeminiDiagnostic = LlmDiagnostic;
export interface DiagnosticAttempt {
  observe(httpStatus: number, value: unknown): void;
  finish(resultCode: string): void;
}
type DiagnosticContext = Pick<LlmDiagnostic, 'callKind' | 'model' | 'retries' | 'dailyCalls' | 'sessionCalls'>;
export const DIAGNOSTIC_MAX_LINES = 500;
export const DIAGNOSTIC_MAX_BYTES = 1024 * 1024;
/** Free-form upstream messages can echo arbitrary prompts. Export only recognized
 * diagnostic clauses; never quoted values, field contents or appended prose. */
function safeMessage(value: unknown, guard: Pick<SecretGuard, 'reflects'>): string | null {
  if (typeof value !== 'string' || guard.reflects(value)) return null;
  const clauses = value.match(/API key not valid\.?|API key expired\.?|Request contains an invalid argument\.?|Invalid JSON payload received\.?|Unknown name|Cannot find field|Invalid value at|Please use a valid role|System instructions are not enabled|Thinking is not supported|Unsupported thinking configuration|Model not found\.?|Requested entity was not found\.?|Resource has been exhausted\.?|Quota exceeded\.?|The model is overloaded\.?|The service is currently unavailable\.?|Internal error encountered\.?/gi);
  return clauses?.join(' ').slice(0, 240) || null;
}
export class GeminiDiagnostics {
  #file: string;
  #last: LlmDiagnostic | null = null;
  constructor(file = join(dirname(defaultUsageFile()), 'llm-diagnostics.jsonl')) { this.#file = file; }
  latest(guard: Pick<SecretGuard, 'reflects'>): LlmDiagnostic | null {
    return this.#last && !guard.reflects(JSON.stringify(this.#last)) ? structuredClone(this.#last) : null;
  }
  begin(context: DiagnosticContext, guard: Pick<SecretGuard, 'reflects'>): DiagnosticAttempt {
    const started = performance.now(), timestamp = new Date().toISOString();
    let httpStatus: number | null = null, value: unknown, done = false;
    return {
      observe: (status, envelope) => { if (!done) { httpStatus = status; value = envelope; } },
      finish: resultCode => {
        if (done) return; done = true;
        this.write(httpStatus, value, guard, { ...context, timestamp, resultCode, latencyMs: Math.round(performance.now() - started) });
        value = undefined;
      },
    };
  }
  write(httpStatus: number | null, value: unknown, guard: Pick<SecretGuard, 'reflects'>,
    context?: DiagnosticContext & Pick<LlmDiagnostic, 'timestamp' | 'resultCode' | 'latencyMs'>) {
    const envelope = record(value), error = record(envelope.error), usage = record(envelope.usageMetadata);
    const candidate = record(Array.isArray(envelope.candidates) ? envelope.candidates[0] : null);
    const safeEnum = (item: unknown, allowed: Set<string>) =>
      typeof item === 'string' && allowed.has(item) && !guard.reflects(item) ? item : null;
    const details = Array.isArray(error.details) ? error.details : [];
    const diagnostic: GeminiDiagnostic = { timestamp: context?.timestamp ?? new Date().toISOString(),
      callKind: context?.callKind ?? 'connection_test', provider: 'gemini',
      model: context?.model && /^[a-zA-Z0-9._-]{1,200}$/.test(context.model) && !guard.reflects(context.model) ? context.model : null,
      latencyMs: context?.latencyMs ?? 0, retries: context?.retries ?? 0,
      resultCode: context?.resultCode ?? (httpStatus && httpStatus >= 400 ? googleHttpError(httpStatus) : 'ok'),
      dailyCalls: context?.dailyCalls ?? 0, sessionCalls: context?.sessionCalls ?? 0,
      httpStatus, googleStatus: safeEnum(error.status, statuses), googleMessage: safeMessage(error.message, guard),
      googleReason: details.map(item => safeEnum(record(item).reason, reasons)).find(Boolean) ?? null,
      finishReason: safeEnum(candidate.finishReason, finishes), inputTokens: count(usage.promptTokenCount),
      outputTokens: count(usage.candidatesTokenCount), thinkingTokens: count(usage.thoughtsTokenCount) };
    // Only fixed fields, sanitized metadata and recognized message clauses cross this boundary.
    // Also guard numeric fields against a short/numeric credential reflection.
    const line = JSON.stringify(diagnostic);
    if (guard.reflects(line)) return;
    this.#last = diagnostic;
    try { console.info(line); } catch { /* Diagnostic sinks cannot change request outcomes. */ }
    try {
      mkdirSync(dirname(this.#file), { recursive: true });
      let previous = '';
      try {
        // Do not read an oversized legacy file; replace it with the newest row.
        if (statSync(this.#file).size <= DIAGNOSTIC_MAX_BYTES) previous = readFileSync(this.#file, 'utf8');
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const lines = [...previous.split('\n').filter(Boolean), line];
      let bytes = Buffer.byteLength(lines.join('\n') + '\n');
      while (lines.length > DIAGNOSTIC_MAX_LINES || bytes > DIAGNOSTIC_MAX_BYTES) bytes -= Buffer.byteLength(lines.shift()! + '\n');
      // Atomic replacement is a rolling rotation: keep only the latest bounded window,
      // with no unbounded archive. Read the shared path on every write (multiple adapters).
      writeFileSync(this.#file + '.tmp', lines.join('\n') + '\n');
      renameSync(this.#file + '.tmp', this.#file);
    }
    catch { /* Never print filesystem errors: a path may contain private information. */ }
  }
}

export function googleHttpError(status: number): ProviderErrorCode {
  return status === 400 ? 'request' : status === 404 ? 'model' : status === 401 || status === 403 ? 'auth' :
    status === 429 ? 'rate_limited' : status >= 500 ? 'google_server' : 'schema';
}
/** Bounded body parsing for both HTTP errors and successes, under the caller's deadline. */
export async function readGeminiResponse(response: Response, signal: AbortSignal,
  guard: Pick<SecretGuard, 'reflects'>, diagnostic?: DiagnosticAttempt): Promise<unknown> {
  let envelope: unknown;
  diagnostic?.observe(response.status, undefined);
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
    diagnostic?.observe(response.status, envelope);
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
