import type { NetworkError } from '../../shared/contracts.ts';
import type { DiagnosticAttempt } from './gemini-response.ts';
import type { SecretGuard } from './secrets.ts';
import { ProviderError, abortError } from './types.ts';

const names = new Set(['Error', 'TypeError', 'SystemError', 'AggregateError', 'AbortError', 'TimeoutError']);
const timeouts = new Set(['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);
const tls = new Set(['CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'CERT_REVOKED', 'CERT_UNTRUSTED',
  'CERT_SIGNATURE_FAILURE', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'ERR_TLS_CERT_SIGNATURE_ALGORITHM_UNSUPPORTED', 'ERR_SSL_WRONG_VERSION_NUMBER',
  'ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE', 'EPROTO']);
const codes = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH',
  'EPIPE', 'UND_ERR_SOCKET', ...timeouts, ...tls]);
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};

/** Never retain arbitrary messages, stacks, URLs, headers, or unknown error strings. */
export function networkFailure(error: unknown) {
  const outer = record(error);
  const walk = (value: unknown, depth: number): string | null => {
    if (depth > 4) return null;
    const item = record(value);
    if (typeof item.code === 'string' && codes.has(item.code)) return item.code;
    if (typeof item.code === 'string' && /^(?:CERT_|ERR_TLS_|ERR_SSL_)/.test(item.code)) return 'TLS_UNKNOWN';
    const cause = walk(item.cause, depth + 1);
    if (cause) return cause;
    for (const child of Array.isArray(item.errors) ? item.errors.slice(0, 4) : []) {
      const code = walk(child, depth + 1); if (code) return code;
    }
    return null;
  };
  const code = walk(error, 0), name = typeof outer.name === 'string' && names.has(outer.name) ? outer.name : null;
  return { error: { name, code: code === 'TLS_UNKNOWN' ? null : code } satisfies NetworkError,
    result: code && (tls.has(code) || code === 'TLS_UNKNOWN') ? 'tls' as const : (code && timeouts.has(code)) || name === 'TimeoutError' || name === 'AbortError'
      ? 'timeout' as const : 'network' as const };
}

export function safeNetworkError(error: NetworkError, guard: Pick<SecretGuard, 'reflects'>): NetworkError {
  return { name: error.name && names.has(error.name) && !guard.reflects(error.name) ? error.name : null,
    code: error.code && codes.has(error.code) && !guard.reflects(error.code) ? error.code : null };
}

/** Classification is limited to the transport call: HTTP/parse/internal failures keep their own codes. */
export async function fetchWithDiagnostics(transport: typeof fetch, url: string, init: RequestInit, diagnostic?: DiagnosticAttempt) {
  try { return await transport(url, init); }
  catch (error) {
    if (error instanceof ProviderError) throw error;
    const failure = networkFailure(error);
    diagnostic?.network(failure.error);
    if (init.signal?.aborted) throw abortError(init.signal);
    throw new ProviderError(failure.result);
  }
}

/** Presence only; credentials embedded in proxy URLs never leave the environment. */
export function proxyDetected(env: NodeJS.ProcessEnv): boolean {
  return ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy'].some(name => !!env[name]);
}
