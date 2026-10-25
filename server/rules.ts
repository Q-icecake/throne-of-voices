import type { CommandActionKind, CommandEstimate, EngagementPolicy, Restriction, RestrictionId } from '../shared/contracts.ts';

/**
 * M1 test rules for the single naval-drill action. Placeholder values to be tuned in playtests,
 * not historical figures. Timing is measured in active (unpaused) fake-clock milliseconds.
 *
 * Grain is spent exactly once, when the order is delivered and work begins.
 * Readiness rises exactly once, when the work completes.
 */
export const NAVAL_DRILL: Readonly<CommandEstimate> = Object.freeze({
  grain: 100,
  deliveryMs: 10_000,
  workMs: 30_000,
  readinessGain: 15,
});

export const NAVAL_DRILL_LABEL = '수군 정비';

export const RESTRICTION_LABELS: Record<RestrictionId, string> = {
  'no-first-strike': '먼저 공격하지 않음',
  'no-war-promise': '참전 약속 금지',
  'no-firm-answer': '확답 보류',
};

export const ENGAGEMENT_POLICY_LABELS: Record<EngagementPolicy, string> = {
  hold: '대기 (별도 지시 없음)',
  'no-first-strike': '선제공격 금지',
};

export function restriction(id: RestrictionId): Restriction {
  return { id, label: RESTRICTION_LABELS[id] };
}

// Synthetic scenario data, measured in active clock time; no historical claim.
export const ACTION_RULES: Record<CommandActionKind, Readonly<CommandEstimate>> = {
  'naval-drill': NAVAL_DRILL,
  'hold-reply': { grain: 0, deliveryMs: 5000, workMs: 5000, readinessGain: 0 },
  'sound-out': { grain: 20, deliveryMs: 5000, workMs: 55000, readinessGain: 0 },
};
export const ACTION_LABELS = { 'naval-drill': NAVAL_DRILL_LABEL, 'hold-reply': '조조 사신 답변 보류·회신', 'sound-out': '유비 측 의중·조건 타진' };
export const DIPLOMACY_RULES = { prepareMs: 10000, travelMs: 15000, replyMs: 30000, holdMs: 120000,
  response: '유비 측이 협력 조건에 관한 추가 논의를 요청했습니다. 수락·동맹·참전 확약은 아직 없습니다 (고정 시험 반응).' } as const;
export const deadlineDuration = (value: string | null): number | undefined => value ? Number(value.match(/^(\d+)분 이내$/)?.[1]) * 60000 : undefined;
