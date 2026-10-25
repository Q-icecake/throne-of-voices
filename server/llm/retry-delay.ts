import type { SecretGuard } from './secrets.ts';

const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
/** Return only a bounded number; never expose arbitrary headers or error text. */
export function retryDelay(header: string | null, value: unknown, guard: Pick<SecretGuard, 'reflects'>, now = Date.now()): number | undefined {
  const delays: number[] = [];
  const add = (n: number) => { if (Number.isFinite(n) && n >= 0 && n <= 86400) delays.push(Math.ceil(n)); };
  if (header && !guard.reflects(header)) {
    if (/^\d+(?:\.\d+)?$/.test(header.trim())) add(Number(header));
    else if (/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(header)) add(Math.max(0, (Date.parse(header) - now) / 1000));
  }
  if (!guard.reflects(JSON.stringify(value) ?? '')) {
    const error = record(record(value).error);
    for (const detail of Array.isArray(error.details) ? error.details : []) {
      const item = record(detail);
      if (item['@type'] !== 'type.googleapis.com/google.rpc.RetryInfo') continue;
      if (typeof item.retryDelay === 'string' && /^\d+(?:\.\d+)?s$/.test(item.retryDelay)) add(Number(item.retryDelay.slice(0, -1)));
      const duration = record(item.retryDelay), seconds = duration.seconds, nanos = duration.nanos ?? 0;
      if ((typeof seconds === 'number' && Number.isInteger(seconds) || typeof seconds === 'string' && /^\d+$/.test(seconds)) &&
        typeof nanos === 'number' && Number.isInteger(nanos) && nanos >= 0 && nanos < 1e9) add(Number(seconds) + nanos / 1e9);
    }
    if (typeof error.message === 'string') {
      const match = /\bPlease retry in (\d+(?:\.\d+)?)s\b/i.exec(error.message);
      if (match) add(Number(match[1]));
    }
  }
  const result = delays.length ? Math.max(...delays) : undefined;
  return result !== undefined && !guard.reflects(String(result)) ? result : undefined;
}
