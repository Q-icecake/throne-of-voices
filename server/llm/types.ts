import type { KnowledgeView, RestrictionId } from '../../shared/contracts.ts';

export type Intent = 'question' | 'discussion' | 'command' | 'ambiguous' | 'unsupported';
export interface ActionVocabulary {
  kind: string;
  description: string;
  targets: string[];
  assignees: string[];
  restrictions: RestrictionId[];
}
export interface ProviderInput {
  /** Server-only telemetry hint, excluded from the Gemini request body. */
  diagnosticKind?: 'meeting';
  character?: {
    id: import('../../shared/contracts.ts').CharacterId;
    identity: string; stance: string; expertise: string; concerns: string;
    relationship: string;
    cards: { id: string; claim: string }[];
    memories: { eventId: string; fact: string; witnesses: import('../../shared/contracts.ts').CharacterId[] }[];
    memorySummary: { text: string; eventIds: string[] };
  };
  text: string;
  knowledge: KnowledgeView;
  context: { role: 'player' | 'assistant'; text: string }[];
  actions: ActionVocabulary[];
}
export interface Proposal {
  intent: Intent;
  dialogue: string;
  proposedActions: {
    kind: string; target: string; assignee: string;
    conditions: string[]; restrictions: RestrictionId[]; deadline: string | null;
  }[];
  unresolvedQuestions: string[];
  referencedKnowledgeIds: string[];
  usage: { inputTokens: number; outputTokens: number; externalCalls: number; costUsd: number | null };
}
export interface InterpretationProvider {
  readonly source: 'AI';
  readonly status: string;
  interpret(input: ProviderInput, signal: AbortSignal): Promise<unknown>;
  /** Neutral telemetry is authoritative; null tokens mean unknown, including failed attempts. */
  readonly lastUsage?: ProviderUsage;
}
export type ProviderErrorCode = 'timeout' | 'rate_limited' | 'auth' | 'schema' | 'server' | 'budget' | 'aborted' |
  'truncated' | 'empty' | 'request' | 'model' | 'google_server' | 'parse';
export interface AttemptUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  errorCode: ProviderErrorCode | null;
}
export interface ProviderUsage extends AttemptUsage {
  attempts: number;
  retries: number;
  reservations: number;
  externalCalls: number;
  costUsd: null;
  attemptUsage: AttemptUsage[];
}
export const PROVIDER_MESSAGES: Record<ProviderErrorCode, string> = {
  timeout: 'AI 응답 시간이 초과되었습니다.', rate_limited: 'AI 공급자 한도 초과(429). 추가 호출을 중단했습니다.',
  auth: 'AI 인증 또는 연결 설정을 확인해 주세요.', schema: 'AI 제안의 형식이나 허용 범위가 맞지 않습니다.',
  server: 'AI 연결에 실패했습니다.', budget: '로컬 카운터를 확인할 수 없거나 호출 상한에 도달했습니다. 추가 호출을 차단했습니다.',
  aborted: 'AI 요청이 취소되었습니다.',
  truncated: '응답이 잘림(출력 한도·사고 토큰). 모델 설정을 확인하고 다시 시도해 주세요.',
  empty: '응답 없음(사고만 반환 또는 빈 응답). 모델 설정을 확인해 주세요.',
  request: '요청 형식 거부(400)·모델 설정 불일치. 설정을 확인한 뒤 다시 눌러 주세요.',
  model: '모델 없음(404). 모델 ID와 접근 권한을 확인해 주세요.',
  google_server: 'Google 서버 오류(5xx). 잠시 후 다시 시도해 주세요.',
  parse: '응답 파싱 실패. 응답 형식과 모델 설정을 확인해 주세요.',
};
const legacy = { timeout: 'PROVIDER_TIMEOUT', rate_limited: 'CALL_LIMIT', auth: 'PROVIDER_ERROR', schema: 'INVALID_PROPOSAL',
  server: 'PROVIDER_ERROR', budget: 'CALL_LIMIT', aborted: 'PROVIDER_TIMEOUT',
  truncated: 'INVALID_PROPOSAL', empty: 'INVALID_PROPOSAL', request: 'PROVIDER_ERROR', model: 'PROVIDER_ERROR',
  google_server: 'PROVIDER_ERROR', parse: 'INVALID_PROPOSAL' } as const;
const neutral = { PROVIDER_ERROR: 'server', PROVIDER_TIMEOUT: 'timeout', CALL_LIMIT: 'budget', INVALID_PROPOSAL: 'schema' } as const;
export class ProviderError extends Error {
  readonly code: 'PROVIDER_ERROR' | 'PROVIDER_TIMEOUT' | 'CALL_LIMIT' | 'INVALID_PROPOSAL';
  readonly neutralCode: ProviderErrorCode;
  usage?: ProviderUsage;
  readonly budgetDetail?: { scope: 'daily' | 'session'; calls: number; limit: number };
  constructor(code: ProviderError['code'] | ProviderErrorCode, budgetDetail?: ProviderError['budgetDetail']) {
    const mapped = code in legacy ? legacy[code as ProviderErrorCode] : code as ProviderError['code'];
    super(mapped); this.code = mapped;
    this.neutralCode = code in legacy ? code as ProviderErrorCode : neutral[mapped];
    this.budgetDetail = budgetDetail;
  }
}
export function providerMessage(error: ProviderError): string {
  const detail = error.budgetDetail;
  if (error.neutralCode === 'budget' && detail) return detail.scope === 'daily'
    ? `로컬 일일 상한(UTC) 도달: 오늘 ${detail.calls}/${detail.limit}`
    : `로컬 세션 상한 도달: 이번 서버 세션 ${detail.calls}/${detail.limit}`;
  return PROVIDER_MESSAGES[error.neutralCode];
}
/** Propagate nested deadline reasons without relabeling a timeout as caller cancellation. */
export function abortError(signal: AbortSignal): ProviderError {
  return new ProviderError(signal.reason instanceof ProviderError && signal.reason.neutralCode === 'timeout' ? 'timeout' : 'aborted');
}
