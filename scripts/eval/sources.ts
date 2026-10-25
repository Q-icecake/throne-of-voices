import { MockCommandInterpreter } from '../../server/mock-interpreter.ts';
import { offlineReply } from '../../server/characters.ts';
import type { Source } from './types.ts';

export const mockSource = (): Source => ({
  model: 'offline/mock-existing', timeoutMs: 15000,
  async sample(fixture, input) {
    const mock = new MockCommandInterpreter().interpret(input.text);
    const npc = fixture.suite === 'npc';
    return { raw: {
      intent: npc ? 'question' : mock.intent === 'hypothetical' ? 'discussion' : mock.intent,
      dialogue: npc ? offlineReply(input) : mock.reply,
      proposedActions: !npc && mock.intent === 'command' ? mock.actions ?? [] : [],
      unresolvedQuestions: !npc && mock.intent === 'command' ? mock.unresolved : [],
      referencedKnowledgeIds: [], usage: { inputTokens: 0, outputTokens: 0, externalCalls: 0, costUsd: null },
    }, attempts: [], reservations: 0 };
  },
});

export function scriptedSource(file: unknown, split: 'dev' | 'final'): Source {
  if (!file || typeof file !== 'object' || !('version' in file) || file.version !== 1 || !('split' in file) || file.split !== split ||
    !('responses' in file) || !file.responses || typeof file.responses !== 'object' || Array.isArray(file.responses)) throw new Error('SCRIPTED_SCHEMA');
  const responses = file.responses as Record<string, unknown>;
  return { model: 'offline/scripted-v1', timeoutMs: 15000,
    async sample(fixture) {
      if (!Object.hasOwn(responses, fixture.id)) return { error: 'SCRIPTED_MISSING', attempts: [], reservations: 0 };
      return { raw: structuredClone(responses[fixture.id]), attempts: [], reservations: 0 };
    },
  };
}
