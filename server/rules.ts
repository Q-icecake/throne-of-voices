import type { CommandEstimate, EngagementPolicy, Restriction, RestrictionId } from '../shared/contracts.ts';

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
};

export const ENGAGEMENT_POLICY_LABELS: Record<EngagementPolicy, string> = {
  hold: '대기 (별도 지시 없음)',
  'no-first-strike': '선제공격 금지',
};

export function restriction(id: RestrictionId): Restriction {
  return { id, label: RESTRICTION_LABELS[id] };
}
