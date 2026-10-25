import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PAUSE_REASONS } from '../shared/contracts.ts';
import type { CommandOutcome, CommandRequest, PauseReason, TestAction } from '../shared/contracts.ts';
import { GameEngine } from './engine.ts';
import { configuredProvider } from './llm/config.ts';
import { RuntimeSettings } from './llm/runtime-settings.ts';
import type { RuntimeOptions } from './llm/runtime-settings.ts';
import type { InterpretationProvider } from './llm/types.ts';
import type { ProviderErrorCode } from './llm/types.ts';
import { PROVIDER_MESSAGES } from './llm/types.ts';
import { captureFailure } from './llm/failure-context.ts';
import { CHARACTER_IDS } from './characters.ts';
import type { AudienceRequest, CharacterId } from '../shared/contracts.ts';

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(payload));
}

async function readObject(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
    throw new HttpError(415, 'JSON_REQUIRED');
  }
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > 16_384) throw new HttpError(413, 'BODY_TOO_LARGE');
    chunks.push(Buffer.from(chunk));
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'INVALID_JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'OBJECT_REQUIRED');
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

export function parseAction(value: Record<string, unknown>): TestAction {
  if ((value.type === 'advance-next' || value.type === 'opening-ready') && exactKeys(value, ['type'])) return { type: value.type };
  if (value.type === 'set-clock-mode' && exactKeys(value, ['type', 'mode']) && (value.mode === 'auto' || value.mode === 'manual')) return { type: value.type, mode: value.mode };
  if (value.type === 'set-reading' && exactKeys(value, ['type', 'reading']) && typeof value.reading === 'boolean') return { type: value.type, reading: value.reading };
  if (value.type === 'observe-document' && exactKeys(value, ['type', 'documentId']) && typeof value.documentId === 'string' && value.documentId.length <= 100) return { type: value.type, documentId: value.documentId };
  if (value.type === 'advance-clock' && exactKeys(value, ['type', 'milliseconds']) &&
    typeof value.milliseconds === 'number' && Number.isSafeInteger(value.milliseconds) && value.milliseconds > 0 && value.milliseconds <= 60_000) {
    return { type: value.type, milliseconds: value.milliseconds };
  }
  if (value.type === 'set-pause' && exactKeys(value, ['type', 'reason', 'paused']) &&
    PAUSE_REASONS.includes(value.reason as PauseReason) && typeof value.paused === 'boolean') {
    return { type: value.type, reason: value.reason as PauseReason, paused: value.paused };
  }
  if (value.type === 'mock-probe' && exactKeys(value, ['type', 'text']) &&
    typeof value.text === 'string' && value.text.trim().length > 0 && value.text.length <= 2000) {
    return { type: value.type, text: value.text };
  }
  throw new HttpError(400, 'INVALID_ACTION');
}

const validText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 2000;
const validDraftRef = (value: Record<string, unknown>) =>
  typeof value.draftId === 'string' && /^draft-\d{4}$/.test(value.draftId) &&
  typeof value.version === 'number' && Number.isSafeInteger(value.version) && value.version >= 1;

export function parseCommand(value: Record<string, unknown>): CommandRequest {
  if (value.type === 'recall' && exactKeys(value, ['type', 'taskId']) && typeof value.taskId === 'string' && /^task-\d{4,}$/.test(value.taskId)) return { type: 'recall', taskId: value.taskId };
  if (value.type === 'confirm' && exactKeys(value, ['type', 'draftId', 'version', 'acceptPartial']) && validDraftRef(value) && typeof value.acceptPartial === 'boolean')
    return { type: 'confirm', draftId: value.draftId as string, version: value.version as number, acceptPartial: value.acceptPartial };
  if (value.type === 'submit' && exactKeys(value, ['type', 'text']) && validText(value.text)) {
    return { type: 'submit', text: value.text };
  }
  if (value.type === 'revise' && exactKeys(value, ['type', 'draftId', 'version', 'text']) && validDraftRef(value) && validText(value.text)) {
    return { type: 'revise', draftId: value.draftId as string, version: value.version as number, text: value.text };
  }
  if ((value.type === 'cancel' || value.type === 'confirm') && exactKeys(value, ['type', 'draftId', 'version']) && validDraftRef(value)) {
    return { type: value.type, draftId: value.draftId as string, version: value.version as number };
  }
  throw new HttpError(400, 'INVALID_COMMAND');
}

/** `webPort` is the local Vite port whose pages may call the API (default: the dev server). */
export function createGameServer(engine?: GameEngine | GameEngine<InterpretationProvider | undefined>, webPort = 5173, runtimeOptions: RuntimeOptions = {}) {
  const runtime = new RuntimeSettings(runtimeOptions);
  if (!engine) {
    const config = configuredProvider();
    engine = new GameEngine(undefined, undefined, config.provider, config.timeoutMs, config.status, { mode: 'auto', ready: false });
  }
  let game = engine;
  let generation = 0;
  const replaceGame = () => {
    game.reset(); // Existing engine request versions invalidate pending command/talk results.
    generation++;
    game = new GameEngine(undefined, undefined, runtime.provider(), 15000, undefined, { mode: 'auto', ready: false });
    failureCode = undefined;
  };
  let failureCode: ProviderErrorCode | undefined;
  const providerResult = async <T extends { outcome?: CommandOutcome }>(work: () => T | Promise<T>) => {
    const started = generation;
    const { result, code } = await captureFailure(async () => await work());
    if (started !== generation) return { state: game.view(), outcome: { kind: 'error', code: 'STALE_RESPONSE', reply: '설정이 바뀌어 이전 응답을 무시했습니다.' } };
    if (result.outcome?.kind === 'error' && result.outcome.code !== 'STALE_RESPONSE') {
      failureCode = code ?? 'schema';
      // Keep legacy outcome.code for existing clients/eval. providerCode is the neutral wire contract.
      return { ...result, outcome: { ...result.outcome, providerCode: failureCode,
        reply: `[${failureCode}] ${PROVIDER_MESSAGES[failureCode]} 입력과 초안은 보존되었습니다. Mock으로 전환하지 않았습니다.` } };
    }
    if (result.outcome?.kind !== 'error') failureCode = undefined;
    return result;
  };
  const json = (response: ServerResponse, status: number, payload: unknown): void => {
    // Include historical screen keys after clear, so late responses/exports fail closed too.
    try { runtime.assertSafe(payload); } catch { sendJson(response, 500, { error: 'RESPONSE_REDACTED' }); return; }
    // Overlay the existing chip on command/talk responses and subsequent health/state polls.
    if (failureCode && payload && typeof payload === 'object') {
      const copy = structuredClone(payload) as Record<string, unknown>;
      const state = (copy.state ?? copy) as { interpretation?: { source: string; status: string } };
      if (state.interpretation?.source === 'AI') state.interpretation.status = `[${failureCode}] ${PROVIDER_MESSAGES[failureCode]}`;
      sendJson(response, status, copy);
    } else sendJson(response, status, payload);
  };
  const allowedOrigins = [`http://127.0.0.1:${webPort}`, `http://localhost:${webPort}`];
  const server = createServer(async (request, response) => {
    try {
      // Loopback binding plus Host/Origin checks keep this local test harness local.
      const host = request.headers.host ?? '';
      if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new HttpError(403, 'LOCAL_HOST_REQUIRED');
      const origin = request.headers.origin;
      if (origin && origin !== `http://${host}` && !allowedOrigins.includes(origin)) {
        throw new HttpError(403, 'ORIGIN_REJECTED');
      }
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      if (request.method === 'GET' && path === '/api/llm/status') return json(response, 200, runtime.status());
      if (request.method === 'POST' && path.startsWith('/api/llm/')) {
        const body = await readObject(request);
        switch (path) {
          case '/api/llm/settings': {
            if (!exactKeys(body, ['model', 'key', 'limit']) || typeof body.model !== 'string' || !/^[a-zA-Z0-9._-]{1,200}$/.test(body.model) ||
              typeof body.key !== 'string' || body.key.length > 512 || /[\s\x00-\x1f\x7f]/.test(body.key) ||
              typeof body.limit !== 'number' || !Number.isSafeInteger(body.limit) || body.limit < 0 || body.limit > 10000) throw new HttpError(400, 'INVALID_SETTINGS');
            try { runtime.configure(body.model, body.key, body.limit); } catch { throw new HttpError(400, 'INVALID_SETTINGS'); }
            replaceGame(); return json(response, 200, runtime.status());
          }
          case '/api/llm/test':
            if (!exactKeys(body, [])) throw new HttpError(400, 'EMPTY_OBJECT_REQUIRED');
            return json(response, 200, { result: await runtime.test(), status: runtime.status() });
          case '/api/llm/clear':
            if (!exactKeys(body, [])) throw new HttpError(400, 'EMPTY_OBJECT_REQUIRED');
            runtime.clear(); replaceGame(); return json(response, 200, runtime.status());
          case '/api/llm/start':
            if (!exactKeys(body, ['mode']) || (body.mode !== 'mock' && body.mode !== 'ai')) throw new HttpError(400, 'INVALID_MODE');
            try { runtime.select(body.mode); } catch { throw new HttpError(400, 'AI_NOT_CONFIGURED'); }
            replaceGame(); return json(response, 200, runtime.status());
        }
        throw new HttpError(404, 'NOT_FOUND');
      }
      if (request.method === 'GET') {
        switch (path) {
          case '/api/health': return json(response, 200, { milestone: 'M5', mode: game.view().mode, clock: game.view().opening?.clockMode ?? 'manual-fake', interpretation: game.view().interpretation });
          case '/api/state': return json(response, 200, game.view());
          case '/api/test/snapshot': return json(response, 200, game.publicSnapshot());
          case '/api/test/logs': return json(response, 200, game.logs());
        }
      }
      if (request.method === 'POST' && path === '/api/test/reset') {
        const body = await readObject(request);
        if (!exactKeys(body, [])) throw new HttpError(400, 'EMPTY_OBJECT_REQUIRED');
        game.reset();
        failureCode = undefined;
        return json(response, 200, { state: game.view() });
      }
      if (request.method === 'POST' && path === '/api/test/action') {
        const action = parseAction(await readObject(request));
        return json(response, 200, game.dispatch(action));
      }
      if (request.method === 'POST' && path === '/api/command') {
        const command = parseCommand(await readObject(request));
        return json(response, 200, await providerResult(() => game.command(command)));
      }
      if (request.method === 'POST' && path === '/api/talk') {
        const body = await readObject(request);
        if (!exactKeys(body, ['characterId', 'text']) || !CHARACTER_IDS.includes(body.characterId as CharacterId) || !validText(body.text)) throw new HttpError(400, 'INVALID_TALK');
        const text = body.text;
        return json(response, 200, await providerResult(() => game.talk({ characterId: body.characterId as CharacterId, text })));
      }
      if (request.method === 'POST' && path === '/api/audience') {
        const body = await readObject(request);
        const id = CHARACTER_IDS.includes(body.characterId as CharacterId);
        const valid = body.type === 'invite' ? exactKeys(body, ['type', 'participants']) && Array.isArray(body.participants) && body.participants.length >= 1 && body.participants.length <= 3 && new Set(body.participants).size === body.participants.length && body.participants.every(p => CHARACTER_IDS.includes(p as CharacterId)) :
          body.type === 'share' ? exactKeys(body, ['type', 'characterId', 'documentId']) && id && typeof body.documentId === 'string' && body.documentId.length <= 100 :
          (body.type === 'dismiss' || body.type === 'defer' || body.type === 'decline') && exactKeys(body, ['type', 'characterId']) && id;
        if (!valid) throw new HttpError(400, 'INVALID_AUDIENCE');
        return json(response, 200, game.audience(body as unknown as AudienceRequest));
      }
      json(response, 404, { error: 'NOT_FOUND' });
    } catch (error) {
      // Never serialize exceptions, environment variables, request bodies, or internal snapshots.
      json(response, error instanceof HttpError ? error.status : 500, {
        error: error instanceof HttpError ? error.message : 'INTERNAL_ERROR',
      });
    }
  });
  const timer = setInterval(() => game.tick(Math.floor(performance.now())), 100);
  timer.unref();
  server.once('close', () => clearInterval(timer));
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  return server;
}
