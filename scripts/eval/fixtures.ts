import { readFile } from 'node:fs/promises';
import type { EvalCase } from './types.ts';
import { actionVocabulary } from '../../server/llm/validator.ts';

export async function loadCases(split: 'dev' | 'final'): Promise<EvalCase[]> {
  const value: unknown = JSON.parse(await readFile(new URL(`../../tests/fixtures/eval-${split}.json`, import.meta.url), 'utf8'));
  validateCases(value);
  if (value.some(c => c.split !== split)) throw new Error('FIXTURE_SPLIT');
  return value;
}
export function validateCases(value: unknown): asserts value is EvalCase[] {
  if (!Array.isArray(value) || !value.length) throw new Error('FIXTURE_SCHEMA');
  const ids = new Set(), texts = new Set();
  const vocabulary = actionVocabulary();
  for (const c of value) {
    const strings = (v: unknown) => Array.isArray(v) && v.every(x => typeof x === 'string');
    if (!c || typeof c.id !== 'string' || !c.id || ids.has(c.id) || typeof c.text !== 'string' || !c.text.trim() || texts.has(`${c.suite}:${c.npc?.character}:${c.text}`) ||
      !['command', 'npc'].includes(c.suite) || !['dev', 'final'].includes(c.split) || !c.family ||
      !strings(c.tags) || !c.tags.includes(c.split) || !c.tags.includes(c.intent) || !strings(c.mustNotDo) || typeof c.clarify !== 'boolean' ||
      !['command', 'question', 'discussion', 'ambiguous', 'unsupported'].includes(c.intent) || !Array.isArray(c.actions) || c.actions.length > 3 ||
      (c.intent !== 'command' && c.actions.length) || (c.intent === 'command' && !c.actions.length)) throw new Error('FIXTURE_SCHEMA');
    ids.add(c.id); texts.add(`${c.suite}:${c.npc?.character}:${c.text}`);
    for (const a of c.actions) {
      const v = vocabulary.find(v => v.kind === a.kind);
      if (!v || !v.targets.includes(a.target) || !v.assignees.includes(a.assignee) || !strings(a.conditions) || !strings(a.restrictions) ||
        a.restrictions.some((r: string) => !v.restrictions.includes(r as never)) || !(a.deadline === null || typeof a.deadline === 'string')) throw new Error('FIXTURE_ACTION');
    }
    if (c.suite === 'npc' && (!c.npc || !['zhang-hong', 'zhang-zhao', 'zhou-yu', 'lu-su'].includes(c.npc.character) ||
      !strings(c.npc.audience) || !c.npc.audience.includes(c.npc.character) || typeof c.npc.shared !== 'boolean' || !c.npc.pair ||
      !strings(c.npc.allowedKnowledgeIds) || !strings(c.npc.forbiddenMarkers) || !strings(c.npc.facts) || !c.npc.tone)) throw new Error('FIXTURE_NPC');
  }
}
