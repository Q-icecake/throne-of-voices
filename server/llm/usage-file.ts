import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLAY_USAGE_FILE = fileURLToPath(new URL('../../artifacts/llm-usage.json', import.meta.url));
export function isolatedUsageFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throne-usage-'));
  process.once('exit', () => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'usage.json');
}
let testFile: string | undefined;
/** Direct `node --test` runs stay isolated even without a wrapper or env override. */
export function defaultUsageFile(): string {
  if (process.env.NODE_TEST_CONTEXT) return testFile ??= isolatedUsageFile();
  return process.env.LLM_USAGE_FILE || PLAY_USAGE_FILE;
}
