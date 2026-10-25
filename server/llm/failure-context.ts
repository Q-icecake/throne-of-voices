import { AsyncLocalStorage } from 'node:async_hooks';
import type { ProviderErrorCode } from './types.ts';
const context = new AsyncLocalStorage<{ code?: ProviderErrorCode; detail?: string }>();
/** Per-request capture survives the engine's legacy error mapping; concurrent requests stay isolated. */
export function recordFailure(code: ProviderErrorCode, detail?: string): void { const current = context.getStore(); if (current) { if (current.code !== code) current.detail = undefined; current.code = code; if (detail) current.detail = detail; } }
export async function captureFailure<T>(work: () => Promise<T>): Promise<{ result: T; code?: ProviderErrorCode; detail?: string }> {
  const current: { code?: ProviderErrorCode; detail?: string } = {};
  return context.run(current, async () => ({ result: await work(), code: current.code, detail: current.detail }));
}
