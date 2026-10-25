import { AsyncLocalStorage } from 'node:async_hooks';
import type { ProviderErrorCode } from './types.ts';
const context = new AsyncLocalStorage<{ code?: ProviderErrorCode }>();
/** Per-request capture survives the engine's legacy error mapping; concurrent requests stay isolated. */
export function recordFailure(code: ProviderErrorCode): void { const current = context.getStore(); if (current) current.code = code; }
export async function captureFailure<T>(work: () => Promise<T>): Promise<{ result: T; code?: ProviderErrorCode }> {
  const current: { code?: ProviderErrorCode } = {};
  return context.run(current, async () => ({ result: await work(), code: current.code }));
}
