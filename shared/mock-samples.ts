import type { CommandIntent } from './contracts.ts';

/** Fixed sentences the M1 Mock interpreter is tested against. Shown in the dev drawer. */
export const MOCK_SAMPLE_SENTENCES: readonly { text: string; intent: CommandIntent }[] = [
  { text: '주유에게 수군을 정비하라고 전해. 먼저 공격하지는 마.', intent: 'command' },
  { text: '수군을 정비하게 하라.', intent: 'command' },
  { text: '항복하면 어떻게 돼?', intent: 'question' },
  { text: '수군을 정비하면 어떨까', intent: 'hypothetical' },
  { text: '주유에게 조조군을 공격하라고 해.', intent: 'unsupported' },
];
