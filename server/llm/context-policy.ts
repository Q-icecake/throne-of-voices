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
