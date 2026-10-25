import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PAUSE_REASONS } from '../shared/contracts.ts';
import type { CommandRequest, PauseReason, TestAction } from '../shared/contracts.ts';
import { GameEngine } from './engine.ts';

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function json(response: ServerResponse, status: number, payload: unknown): void {
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

export function createGameServer(engine = new GameEngine()) {
  const server = createServer(async (request, response) => {
    try {
      // Loopback binding plus Host/Origin checks keep this local test harness local.
      const host = request.headers.host ?? '';
      if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new HttpError(403, 'LOCAL_HOST_REQUIRED');
      const origin = request.headers.origin;
      if (origin && origin !== `http://${host}` && origin !== 'http://127.0.0.1:5173' && origin !== 'http://localhost:5173') {
        throw new HttpError(403, 'ORIGIN_REJECTED');
      }
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      if (request.method === 'GET') {
        switch (path) {
          case '/api/health': return json(response, 200, { milestone: 'M1', mode: 'mock', clock: 'manual-fake', externalCalls: 0 });
          case '/api/state': return json(response, 200, engine.view());
          case '/api/test/snapshot': return json(response, 200, engine.publicSnapshot());
          case '/api/test/logs': return json(response, 200, engine.logs());
        }
      }
      if (request.method === 'POST' && path === '/api/test/reset') {
        const body = await readObject(request);
        if (!exactKeys(body, [])) throw new HttpError(400, 'EMPTY_OBJECT_REQUIRED');
        engine.reset();
        return json(response, 200, { state: engine.view() });
      }
      if (request.method === 'POST' && path === '/api/test/action') {
        const action = parseAction(await readObject(request));
        return json(response, 200, engine.dispatch(action));
      }
      if (request.method === 'POST' && path === '/api/command') {
        const command = parseCommand(await readObject(request));
        return json(response, 200, engine.command(command));
      }
      json(response, 404, { error: 'NOT_FOUND' });
    } catch (error) {
      // Never serialize exceptions, environment variables, request bodies, or internal snapshots.
      json(response, error instanceof HttpError ? error.status : 500, {
        error: error instanceof HttpError ? error.message : 'INTERNAL_ERROR',
      });
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  return server;
}
