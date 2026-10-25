import type { LLMRequest, LLMResult } from '../shared/contracts.ts';

export interface LLMProvider {
  readonly mode: 'mock';
  respond(request: LLMRequest): LLMResult;
}

/** Deliberately fixed output. No SDK, credentials, network, or world reference. */
export class MockLLMProvider implements LLMProvider {
  readonly mode = 'mock' as const;

  respond(_request: LLMRequest): LLMResult {
    return {
      provider: 'mock', intent: 'unsupported',
      dialogue: '[시험용 Mock] 입력 경로를 확인했습니다. M0에서는 문장을 해석하거나 명령을 실행하지 않습니다.',
      proposedActions: [], unresolvedQuestions: [], referencedKnowledgeIds: [],
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, externalCalls: 0 },
    };
  }
}
