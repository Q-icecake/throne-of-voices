import type { CharacterId, KnowledgeView } from '../shared/contracts.ts';
import type { WorldState } from './world.ts';
import { knowledgeFor } from './knowledge.ts';
import type { ProviderInput } from './llm/types.ts';
import { actionVocabulary } from './llm/validator.ts';

export const CHARACTER_IDS: CharacterId[] = ['zhang-hong', 'zhang-zhao', 'zhou-yu', 'lu-su'];
export const HOME_LOCATIONS: Record<CharacterId, string> = { 'zhang-hong': 'office', 'zhang-zhao': 'residence', 'zhou-yu': 'naval-base', 'lu-su': 'residence' };
export interface MemoryFact { eventId: string; fact: string; witnesses: CharacterId[] }
export interface CharacterMind {
  identity: string; stance: string; expertise: string; concerns: string;
  cards: { id: string; claim: string }[];
  trust: number; respect: number; facts: MemoryFact[];
  summary: { text: string; eventIds: string[] };
}
const profiles = {
  'zhang-hong': ['충실한 보좌', '원문과 의견을 구분하고 결정은 주군에게 맡긴다', '문서 정리와 명령 전달', '모호한 지시와 근거 없는 확정', '문서의 주장과 실제 확인은 다르며, 지시는 확인된 초안을 거쳐 전달한다.'],
  'zhang-zhao': ['강동 내정 담당', '강동 기반을 보전할 타협의 여지를 검토한다', '정치와 내정', '전쟁 뒤 민생과 정치적 손실', '전쟁의 승산뿐 아니라 패전 뒤 강동의 기반과 정치적 자율성도 따져야 한다.'],
  'zhou-yu': ['수군 지휘 담당', '조건을 갖춘 군사 대응의 가능성을 검토한다', '수군 훈련과 전투 준비', '병력 수를 전투력과 혼동하는 판단', '병력 수만으로 전투력을 판단할 수 없으며, 훈련과 보급 및 교전 조건을 살펴야 한다.'],
  'lu-su': ['외교 연락 담당', '유비와 접촉해 선택지를 늘릴 수 있다', '교섭과 연락', '접촉 거절과 노출 및 성급한 약속', '유비 측의 의사는 접촉 전에는 알 수 없으며, 접촉 자체가 동맹이나 참전 약속은 아니다.'],
} as const;

export function createMinds(): Record<CharacterId, CharacterMind> {
  return Object.fromEntries(CHARACTER_IDS.map(id => {
    const [identity, stance, expertise, concerns, claim] = profiles[id];
    return [id, { identity, stance, expertise, concerns, cards: [{ id: `card-${id}`, claim }], trust: 80, respect: 80, facts: [], summary: { text: '', eventIds: [] } }];
  })) as unknown as Record<CharacterId, CharacterMind>;
}

export function remember(world: WorldState, ids: CharacterId[], eventId: string, fact: string): void {
  for (const id of ids) {
    const mind = world.minds[id];
    mind.facts.push({ eventId, fact, witnesses: [...ids] });
    const recent = mind.facts.slice(-6);
    mind.summary = { text: recent.map(f => `[${f.eventId}] ${f.fact}`).join(' / '), eventIds: recent.map(f => f.eventId) };
  }
}

/** Detached allowlist: never pass WorldState, other minds, hidden truth or unshared private facts. */
export function characterInput(world: WorldState, id: CharacterId, text: string, audience: CharacterId[]): ProviderInput {
  const mind = world.minds[id];
  const visibleToRoom = (readers: ('player' | CharacterId)[]) => readers.includes('player') && audience.every(p => readers.includes(p));
  const allowed = new Set(world.documents.filter(d => visibleToRoom(d.readers)).map(d => d.id));
  const knowledge: KnowledgeView = knowledgeFor(world, id);
  knowledge.documents = knowledge.documents.filter(d => allowed.has(d.id));
  const facts = mind.facts.filter(f => audience.every(p => f.witnesses.includes(p)));
  return {
    text, knowledge, actions: actionVocabulary(),
    character: { id, identity: mind.identity, stance: mind.stance, expertise: mind.expertise, concerns: mind.concerns,
      relationship: mind.trust >= 70 ? '주군을 신뢰하며 판단은 주군에게 맡긴다' : '근거를 더 확인하며 신중하게 보좌한다',
      cards: structuredClone(mind.cards), memories: structuredClone(facts),
      memorySummary: { text: facts.slice(-6).map(f => `[${f.eventId}] ${f.fact}`).join(' / '), eventIds: facts.slice(-6).map(f => f.eventId) } },
    context: world.conversation.filter(t => t.participants.includes(id) && audience.every(p => t.participants.includes(p)))
      .slice(-6).map(t => ({ role: t.speaker === 'player' ? 'player' : 'assistant', text: t.text })),
  };
}

export const unknowable = (text: string) => /미래|훗날|결말|적벽.*(?:결과|승리|누가|이기)|숨은|숨겨|정확한.*병력|적군.*(?:몇|숫자)|속마음|속내|비공개.*(?:대화|회의|발언)|둘만.*(?:말|대화)/.test(text);

/** Authored Korean pools, fixed selection (no random draws). They assert only scoped evidence. */
export function offlineReply(input: ProviderInput, rebuttal = false): string {
  const id = input.character!.id;
  const text = input.text;
  if (unknowable(text)) return '그 일은 제가 확인한 정보로 알 수 없습니다. 미래의 결과나 남의 속마음, 듣지 못한 비공개 발언을 사실처럼 말씀드릴 수는 없습니다.';
  if (/신뢰|존중|믿는|믿나|내 판단/.test(text)) {
    const shared = input.character!.memories.filter(f => /문서를 보여줌/.test(f.fact)).at(-1);
    return shared ? `판단의 근거를 직접 보여 주신 일은 ${shared.eventId}에 기억하고 있습니다. 주군의 판단을 존중하되 제 전문 분야의 우려는 숨기지 않겠습니다.` : '주군을 신뢰하며 성실하게 보좌하겠습니다. 다만 그 신뢰가 근거 없는 확신을 뜻하지는 않으므로 우려는 솔직히 말씀드리겠습니다.';
  }
  if (/기억|아까|지난|이전|미뤘|연기했/.test(text)) {
    const fact = input.character!.memories.filter(f => /명령을 확정|문서를 보여|접견을 미룸/.test(f.fact)).at(-1) ?? input.character!.memories.at(-1);
    return fact ? `제가 함께한 기록에는 「${fact.fact}」라고 남아 있습니다. 근거는 ${fact.eventId}이며, 그 밖의 일을 추측해 덧붙이지 않겠습니다.` : '제가 함께한 이전 기록은 아직 없습니다. 다른 자리의 대화는 알지 못합니다.';
  }
  if (/문서|보고|서신|장부/.test(text)) {
    const requestedId = text.match(/(?:m\d-|report-)[\w-]+/)?.[0];
    const doc = requestedId ? input.knowledge.documents.find(d => d.id === requestedId) : input.knowledge.documents.find(d => text.includes(d.title)) ?? input.knowledge.documents.at(-1);
    if (!doc) return '그 문서는 아직 제게 공유되지 않았습니다. 내용을 보여 주시면 출처와 관측 시점을 구분해서 검토하겠습니다.';
    const excerpt = doc.claim.split(/[.!?]/)[0]!.slice(0, 140);
    return `제가 볼 수 있는 「${doc.title}」의 원문 일부는 “${excerpt}”입니다. 이는 ${doc.source}의 기록이며, 현재의 모든 사실을 확정하는 뜻은 아닙니다.`;
  }
  if (/도움|막혔|어찌할지/.test(text) && id === 'zhang-hong') return '어느 근거가 부족한지부터 살피시면 좋겠습니다. 문서를 보시거나 담당자의 견해를 들으실 수 있으며, 결정은 주군께 맡기겠습니다.';
  const replies: Record<CharacterId, string> = {
    'zhang-hong': '원문에서 확인한 내용과 제 의견은 나누어 말씀드리겠습니다. 제 생각에는 서로 다른 근거를 먼저 대조하는 것이 좋겠습니다. 누구에게 무엇을 맡기실지 모호하다면 다시 여쭙고, 결정은 주군께 맡기겠습니다.',
    'zhang-zhao': '타협을 검토하는 까닭은 강동의 사람과 기반을 보전하기 위해서입니다. 싸울 수 있다는 판단만으로 전쟁 뒤의 정치적 손실까지 감당할 수 있는 것은 아닙니다. 패전한다면 강동의 자율성과 민생을 어떻게 지키시겠습니까?',
    'zhou-yu': '병력 수와 실제 전투력은 구분해야 합니다. 훈련과 보급, 교전 조건을 갖춘다면 군사적으로 대응할 여지가 있다는 것이 제 판단입니다. 준비가 확인되기 전에 승리를 장담하거나 먼저 공격하자는 뜻은 아닙니다.',
    'lu-su': '유비 측에 접촉하면 서로의 조건을 확인하고 선택지를 넓힐 수 있습니다. 다만 거절당하거나 연락이 노출될 위험이 있고, 성급한 약속은 우리 판단을 묶을 수 있습니다. 접촉과 참전 약속을 구분하여 결정하셔야 합니다.',
  };
  const counters: Record<CharacterId, string> = {
    'zhang-hong': '두 견해가 의존하는 근거를 나누어 보겠습니다. 어느 쪽을 택할지는 주군께서 말씀해 주십시오.',
    'zhang-zhao': '그 가능성을 부정하지는 않습니다. 다만 일이 어긋났을 때 강동이 치를 정치적 대가도 함께 따져야 합니다.',
    'zhou-yu': '그 위험은 인정합니다. 다만 병력의 숫자만으로 대응 가능성까지 닫지 말고 준비 조건을 검토해야 합니다.',
    'lu-su': '그 우려는 남아 있습니다. 접촉으로 조건을 묻는 일과 약속을 확정하는 일은 구분할 수 있습니다.',
  };
  return rebuttal ? counters[id] : replies[id];
}
