import { readFileSync } from 'node:fs';
import type { SecretGuard } from '../../server/llm/secrets.ts';
import type { Sample } from './types.ts';

export const MODEL_RAW_MAX_BYTES = 16384;
const systemPrompt = readFileSync(new URL('../../server/llm/system.ko.txt', import.meta.url), 'utf8').trim();
const sensitiveField = /^(?:.*prompt.*|headers?|authorization|api[-_]?key|systemInstruction|contents|messages)$/i;

/** Only the decoded model JSON enters here, never the HTTP envelope/request.
 * Withhold unsafe/oversized objects whole; a truncated object is not an original. */
export function captureModelRaw(raw: unknown, guard?: SecretGuard): Pick<Sample, 'modelRaw' | 'modelRawStatus'> {
  if (raw === undefined) return { modelRawStatus: 'not-received' };
  const text = JSON.stringify(raw);
  if (Buffer.byteLength(text, 'utf8') > MODEL_RAW_MAX_BYTES) return { modelRawStatus: 'oversize' };
  const sensitive = (value: unknown): boolean => !!value && typeof value === 'object' &&
    Object.entries(value).some(([key, child]) => sensitiveField.test(key) || sensitive(child));
  try { guard?.assertSafe(raw); } catch { return { modelRawStatus: 'blocked' }; }
  if (sensitive(raw) || text.includes(JSON.stringify(systemPrompt).slice(1, -1))) return { modelRawStatus: 'blocked' };
  return { modelRaw: structuredClone(raw), modelRawStatus: 'captured' };
}
