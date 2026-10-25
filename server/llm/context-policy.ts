import type { KnowledgeView } from '../../shared/contracts.ts';
import type { WorldState } from '../world.ts';
import { knowledgeFor } from '../knowledge.ts';
import { visibility } from '../compound.ts';

export interface EvidenceScope { taskId?: string; documentId?: string; providerExcluded?: boolean }

/** Read permission is not permission to automatically transmit to an external provider. */
export function mayTransmit(world: WorldState, scope: EvidenceScope = {}, text = ''): boolean {
  const taskId = scope.taskId ?? world.documents.find(d => d.id === scope.documentId)?.taskId;
  return !scope.providerExcluded && !world.tasks.some(t => t.id === taskId && t.plan.conditions.includes('secret'))
    && !['secret', 'ambiguous'].includes(visibility(text) ?? '');
}

export function providerKnowledge(world: WorldState, viewer: KnowledgeView['viewer']): KnowledgeView {
  const knowledge = knowledgeFor(world, viewer);
  knowledge.documents = knowledge.documents.filter(d => mayTransmit(world, d));
  return knowledge;
}

/** Bounds are UTF-16 JSON characters, not a tokenizer or a billing estimate.
 * Permission filtering MUST run first. Keep newest whole items, skip oversized items,
 * then restore source order. Never cut a factual sentence into a different assertion. */
export function boundedItems<T>(items: T[], count: number, chars: number): T[] {
  const kept: T[] = [];
  let used = 2;
  for (const item of [...items].reverse()) {
    const size = JSON.stringify(item).length + (kept.length ? 1 : 0);
    if (kept.length < count && used + size <= chars) { kept.push(item); used += size; }
  }
  return kept.reverse();
}
export interface NpcSettings {
  meeting: boolean; memories: number; memoryChars: number; summaryChars: number;
  documents: number; documentChars: number; cards: number; cardChars: number; contextChars: number;
}
export function npcSettings(env: NodeJS.ProcessEnv = process.env): NpcSettings {
  const limit = (key: string, fallback: number) => {
    const value = Number(env[key] ?? fallback);
    return Number.isSafeInteger(value) && value >= 0 && value <= fallback * 4 ? value : fallback;
  };
  return { meeting: env.NPC_MEETING_AI === '1', memories: limit('NPC_MEMORY_ITEMS', 12), memoryChars: limit('NPC_MEMORY_CHARS', 2400),
    summaryChars: limit('NPC_SUMMARY_CHARS', 800), documents: limit('NPC_DOCUMENT_ITEMS', 6), documentChars: limit('NPC_DOCUMENT_CHARS', 6000),
    cards: limit('NPC_CARD_ITEMS', 4), cardChars: limit('NPC_CARD_CHARS', 1200), contextChars: limit('NPC_CONTEXT_CHARS', 2400) };
}
