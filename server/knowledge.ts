import type { KnowledgeView, PlayerView } from '../shared/contracts.ts';
import type { WorldState } from './world.ts';

// Allowlist fields explicitly. Spreading WorldState or an internal document leaks future fields.
export function knowledgeFor(world: WorldState, viewer: KnowledgeView['viewer']): KnowledgeView {
  return {
    viewer,
    documents: world.documents.filter(doc => doc.readers.includes(viewer)).map(doc => ({
      id: doc.id, title: doc.title, claim: doc.claim, source: doc.source,
      observedAtMs: doc.observedAtMs, arrivedAtMs: doc.arrivedAtMs,
      evidence: doc.evidence, region: doc.region, provenance: doc.provenance,
    })),
  };
}

export function playerView(world: WorldState): PlayerView {
  return {
    schemaVersion: 1, scenario: world.scenario, sessionId: world.sessionId,
    revision: world.revision, mode: 'mock', clock: structuredClone(world.clock),
    player: { name: world.player.name, locationLabel: world.player.locationLabel },
    characters: world.characters.map(({ id, name, role }) => ({ id, name, role })),
    knowledge: knowledgeFor(world, 'player'),
  };
}
