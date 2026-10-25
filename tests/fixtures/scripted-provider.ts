import type { InterpretationProvider, ProviderInput } from '../../server/llm/types.ts';

type Step = unknown | ((input: ProviderInput, signal: AbortSignal) => unknown | Promise<unknown>);
/** Offline fixture only. Never imported by the production server or browser. */
export class ScriptedProvider implements InterpretationProvider {
  readonly source = 'AI' as const;
  readonly status = 'AI 시험 응답 재생 · 외부 연결 없음';
  readonly inputs: ProviderInput[] = [];
  #steps: Step[];
  constructor(...steps: Step[]) { this.#steps = steps; }
  async interpret(input: ProviderInput, signal: AbortSignal): Promise<unknown> {
    this.inputs.push(structuredClone(input));
    if (!this.#steps.length) throw new Error('No scripted response');
    const step = this.#steps.shift();
    if (step instanceof Error) throw step;
    return typeof step === 'function' ? step(input, signal) : structuredClone(step);
  }
}
