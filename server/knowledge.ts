import type { CharacterId, CommandDraftView, KnowledgeView, PersonRef, PlayerView, TaskView } from '../shared/contracts.ts';
import { NAVAL_DRILL_LABEL, restriction } from './rules.ts';
import type { WorldState } from './world.ts';

// Allowlist fields explicitly. Spreading WorldState or an internal document leaks future fields.
export function knowledgeFor(world: WorldState, viewer: KnowledgeView['viewer']): KnowledgeView {
  return {
    viewer,
    documents: world.documents.filter(doc => doc.readers.includes(viewer)).map(doc => ({
      id: doc.id, title: doc.title, claim: doc.claim, source: doc.source,
      observedAtMs: doc.observedAtMs, arrivedAtMs: doc.arrivedAtMs,
      evidence: doc.evidence, region: doc.region, provenance: doc.provenance,
      ...(doc.taskId ? { taskId: doc.taskId } : {}),
    })),
  };
}

function person(world: WorldState, id: CharacterId): PersonRef {
  return { id, name: world.characters.find(character => character.id === id)?.name ?? id };
}

function draftView(world: WorldState, draft: WorldState['drafts'][number]): CommandDraftView {
  return {
    id: draft.id, version: draft.version, status: draft.status, text: draft.text,
    action: draft.action, actionLabel: NAVAL_DRILL_LABEL, target: '강동 수군',
    assignee: person(world, draft.assignee), messenger: person(world, draft.messenger),
    restrictions: draft.restrictions.map(restriction), estimate: { ...draft.estimate },
    unresolved: [...draft.unresolved],
    ...(draft.statusNote ? { statusNote: draft.statusNote } : {}),
    ...(draft.taskId ? { taskId: draft.taskId } : {}),
  };
}

function taskView(world: WorldState, task: WorldState['tasks'][number]): TaskView {
  return {
    id: task.id, draftId: task.draftId, draftVersion: task.draftVersion,
    action: task.action, actionLabel: NAVAL_DRILL_LABEL, assignee: person(world, task.assignee),
    restrictions: task.restrictions.map(restriction), stage: task.stage,
    registeredAtMs: task.registeredAtMs,
    ...(task.deliveredAtMs !== undefined ? { deliveredAtMs: task.deliveredAtMs } : {}),
    ...(task.completedAtMs !== undefined ? { completedAtMs: task.completedAtMs } : {}),
    grainSpent: task.grainSpent, reportIds: [...task.reportIds],
  };
}

export function playerView(world: WorldState): PlayerView {
  return {
    schemaVersion: 1, scenario: world.scenario, sessionId: world.sessionId,
    revision: world.revision, mode: 'mock', clock: structuredClone(world.clock),
    player: { name: world.player.name, locationLabel: world.player.locationLabel },
    characters: world.characters.map(({ id, name, role }) => ({ id, name, role })),
    knowledge: knowledgeFor(world, 'player'),
    ledger: {
      recordedAtMs: world.ledger.recordedAtMs, source: world.ledger.source,
      navalReadiness: world.ledger.navalReadiness, grain: world.ledger.grain,
      engagementPolicy: world.ledger.engagementPolicy,
    },
    drafts: world.drafts.map(draft => draftView(world, draft)),
    tasks: world.tasks.map(task => taskView(world, task)),
  };
}
