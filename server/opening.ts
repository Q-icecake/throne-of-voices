import { readFileSync } from 'node:fs';
import type { CharacterId } from '../shared/contracts.ts';
import type { WorldState } from './world.ts';

type Reader = 'player' | CharacterId;
interface ContentDocument {
  id: string; title: string; body: string; source: { author: string; note: string };
  observedAt: { activeMs: number | null; label: string }; readers: Reader[];
  evidence: { claim: string; uncertainty: string; confirmedScope: string; meaning: string }; regions: string[];
}
interface ContentEvent { id: string; title: string; trigger: { activeMs: number | null }; documentIds: string[] }
interface ContentKnowledge { id: string; initialHolders: Reader[]; eligibleReaders: Reader[]; sourceDocumentIds: string[] }
interface ContentLine { id: string; characterId: CharacterId; tag: string; text: string; requiredKnowledgeIds: string[]; documentIds: string[] }
const read = (file: string) => JSON.parse(readFileSync(new URL(`../content/opening/${file}.json`, import.meta.url), 'utf8'));
const documents: ContentDocument[] = read('documents').documents;
export const OPENING_EVENTS: ContentEvent[] = read('events').events;
const knowledge: ContentKnowledge[] = read('knowledge').knowledge;
const lines: ContentLine[] = read('npc-lines').lines;
// Fail at boot on missing references; the full editorial schema is checked by content/validate.mjs.
for (const event of OPENING_EVENTS) for (const id of event.documentIds) {
  if (!documents.some(d => d.id === id)) throw new Error('INVALID_OPENING_DOCUMENT_REF');
}
for (const line of lines) if (!line.requiredKnowledgeIds.every(id => knowledge.some(k => k.id === id))) throw new Error('INVALID_OPENING_KNOWLEDGE_REF');

export interface OpeningNotice { id: string; eventId: string; atMs: number; text: string; documentId?: string; sourceEventId?: string }
export class Opening {
  ready: boolean;
  mode: 'manual' | 'auto';
  reading = false;
  statuses: Record<string, 'fired' | 'cancelled'> = {};
  notices: OpeningNotice[] = [];
  receipts: { documentId: string; reader: Reader; atMs: number }[] = [];
  lastInputMs = 0;
  discussed = false;
  help = false;
  diplomaticHelp = false;
  planned = false;
  declinedHelp = false;
  observed = false;
  #projected = new Set<string>();
  #lineIndexes = new Map<string, number>();
  constructor(mode: 'manual' | 'auto', ready = true) { this.mode = mode; this.ready = ready; }

  initialize(world: WorldState): void {
    world.audience.requested = [];
    world.documents = world.documents.filter(d => d.id === 'm0-private-note');
    this.deliver(world, 'D-zhouyu', ['zhou-yu'], 0);
  }
  deliver(world: WorldState, id: string, readers: Reader[], at: number): void {
    const data = documents.find(d => d.id === id)!;
    let doc = world.documents.find(d => d.id === id);
    if (!doc) {
      doc = { id, title: data.title, claim: data.body, source: `${data.source.author} · ${data.source.note}`,
        observedAtMs: data.observedAt.activeMs, observedAtLabel: data.observedAt.label,
        arrivedAtMs: at, evidence: Object.values(data.evidence).join(' · '), region: data.regions.join(' · '),
        provenance: 'test-reconstruction', readers: [] };
      world.documents.push(doc);
    }
    for (const reader of readers) if (data.readers.includes(reader) && !doc.readers.includes(reader)) {
      doc.readers.push(reader); this.receipts.push({ documentId: id, reader, atMs: at });
    }
    if (readers.includes('player')) doc.arrivedAtMs = at;
  }
  mayShare(documentId: string, reader: Reader): boolean {
    return !documents.some(d => d.id === documentId) || documents.find(d => d.id === documentId)!.readers.includes(reader);
  }
  line(world: WorldState, person: CharacterId, tag: string): string | undefined {
    if (!world.audience.participants.includes(person)) return;
    const has = (id: string) => {
      const item = knowledge.find(k => k.id === id)!;
      if (!item.eligibleReaders.includes(person)) return false;
      if (!item.sourceDocumentIds.length) return item.initialHolders.includes(person);
      return item.sourceDocumentIds.every(docId => world.documents.some(d => d.id === docId && d.readers.includes(person)
        && d.readers.includes('player') && world.audience.participants.every(p => d.readers.includes(p))));
    };
    const pool = lines.filter(l => l.characterId === person && l.tag === tag && l.requiredKnowledgeIds.every(has)
      && l.documentIds.every(id => world.documents.some(d => d.id === id && d.readers.includes('player') && world.audience.participants.every(p => d.readers.includes(p)))));
    if (!pool.length) return;
    const key = `${person}:${tag}`, index = this.#lineIndexes.get(key) ?? 0;
    this.#lineIndexes.set(key, index + 1);
    return pool[index % pool.length]!.text;
  }
  input(text: string, now: number): void {
    this.lastInputMs = now;
    if (/도움|모르겠|막혔|어떻게 해야|다른.*(?:의견|외교|방안)/.test(text)) this.help = true;
    if (/다른.*(?:의견|외교|방안)|외교.*도움/.test(text)) this.diplomaticHelp = true;
    if (/도움.*(?:필요 없|싫)|힌트.*(?:말|필요 없)/.test(text)) this.declinedHelp = true;
    if (/계획|방안|생각/.test(text) && /유비|접촉|수군|교섭/.test(text) && !/[?？]|어떨|어때/.test(text)) this.planned = true;
  }
  #done(id: string): boolean { return !!this.statuses[id]; }
  #cancel(id: string, reason: string, emit: (id: string, text: string) => void): void {
    this.statuses[id] = 'cancelled'; emit(id, `취소 · ${reason}`);
  }
  #fire(world: WorldState, id: string, text: string, emit: (id: string, text: string) => void, documentId?: string, sourceEventId?: string): void {
    this.statuses[id] = 'fired';
    emit(id, text);
    this.notices.push({ id: `${id}:${sourceEventId ?? 'session'}`, eventId: id, atMs: world.clock.activeMs, text,
      ...(documentId ? { documentId } : {}), ...(sourceEventId ? { sourceEventId } : {}) });
  }
  pending(world: WorldState): string[] {
    return [
      ...world.diplomacy.requests.filter(r => r.status !== 'answered').map(() => '조조 측 회답'),
      ...world.audience.requested.map(id => `${world.characters.find(c => c.id === id)!.name} 접견 요청`),
      ...world.drafts.filter(d => d.status === 'awaiting-confirmation').map(d => `${d.id} 확인`),
    ];
  }
  evaluate(world: WorldState, emit: (id: string, text: string) => void): void {
    if (!this.ready) return;
    const now = world.clock.activeMs;
    const contacted = world.audience.met.includes('lu-su') || world.audience.participants.includes('lu-su')
      || world.drafts.some(d => !['cancelled', 'rejected'].includes(d.status) && d.actions.some(a => a.kind === 'sound-out')) || this.planned;
    if (now >= 35000 && this.statuses.T02 === 'fired' && !this.receipts.some(r => r.documentId === 'D-jingzhou' && r.reader === 'zhang-zhao'))
      this.deliver(world, 'D-jingzhou', ['zhang-zhao'], now);
    for (const event of OPENING_EVENTS) {
      const id = event.id;
      if (this.#done(id) || event.trigger.activeMs === null) continue;
      if ((id === 'T05' || id === 'T07')) {
        const person = id === 'T05' ? 'zhang-zhao' : 'zhou-yu';
        if (world.audience.met.includes(person) || world.audience.participants.includes(person)) { this.#cancel(id, '이미 접견', emit); continue; }
      }
      if (id === 'T09' && (this.planned || this.declinedHelp || world.drafts.some(d => ['awaiting-confirmation', 'confirmed'].includes(d.status)))) { this.#cancel(id, '계획·지시 또는 안내 거절', emit); continue; }
      if (id === 'T10' && contacted) { this.#cancel(id, '노숙 접견 또는 독자 계획·접촉 지시', emit); continue; }
      const request = world.diplomacy.requests.find(r => r.id === 'cao-cao-envoy');
      if (id === 'T11' && (!request || request.status === 'answered')) { this.#cancel(id, '회답 완료 또는 요청 없음', emit); continue; }
      if (now < event.trigger.activeMs) continue;
      let text = event.title;
      switch (id) {
        case 'T01': this.deliver(world, 'D-supply', ['player', 'zhang-hong'], now); this.deliver(world, 'D-courier', ['player', 'zhang-hong'], now); break;
        case 'T02': this.deliver(world, 'D-jingzhou', ['player', 'zhang-hong'], now); text = '형주 방면 전령의 급보가 도착했습니다. 병력과 위치는 아직 불확실합니다.'; break;
        case 'T03': this.deliver(world, 'D-cao-letter', ['player', 'zhang-hong'], now); break;
        case 'T04':
          if (!this.receipts.some(r => r.documentId === 'D-jingzhou' && r.reader === 'zhang-zhao')) continue;
          this.deliver(world, 'D-zhangzhao', ['player', 'zhang-hong', 'zhang-zhao'], now); break;
        case 'T05': case 'T07': {
          if (this.statuses[id === 'T05' ? 'T04' : 'T06'] !== 'fired') continue;
          const person = id === 'T05' ? 'zhang-zhao' : 'zhou-yu';
          if (!world.characters.find(c => c.id === person)!.available || world.tasks.some(t => t.assignee === person && !['completed', 'stopped'].includes(t.stage))) continue;
          world.audience.requested.push(person); break;
        }
        case 'T06': this.deliver(world, 'D-zhouyu', ['player', 'zhang-hong'], now); break;
        case 'T09': case 'T10':
          if (this.reading || world.clock.pauseReasons.length || !this.discussed || !world.audience.participants.includes('zhang-hong')) continue;
          if (id === 'T09' ? !(this.help || now - this.lastInputMs >= 60000) : !this.diplomaticHelp) continue;
          text = this.line(world, 'zhang-hong', id === 'T09' ? 'weak-hint' : 'lusu-hint') ?? '';
          if (!text) continue; break;
        case 'T11': if (this.statuses.T03 !== 'fired' || now < (request!.heldUntilMs ?? 0)) continue; text = '조조 측 사신이 아직 남은 회답을 재촉합니다.'; break;
        case 'T12': {
          const pending = this.pending(world);
          if (!pending.length) { this.#cancel(id, '미결 사안 없음', emit); continue; }
          text = `남은 사안: ${pending.join(' · ')}`; break;
        }
        default: continue;
      }
      this.#fire(world, id, text, emit, event.documentIds[0]);
    }
  }
  nextAt(world: WorldState): number {
    const now = world.clock.activeMs;
    if (!this.ready) return Infinity;
    const times = OPENING_EVENTS.filter(e => !this.#done(e.id) && e.trigger.activeMs !== null
      && (!['T09', 'T10'].includes(e.id) || (this.discussed && !this.reading && world.audience.participants.includes('zhang-hong') && (e.id !== 'T10' || this.diplomaticHelp)))
      && (!['T05', 'T07'].includes(e.id) || !world.tasks.some(t => t.assignee === (e.id === 'T05' ? 'zhang-zhao' : 'zhou-yu') && !['completed', 'stopped'].includes(t.stage)))).map(e => {
      let at = e.trigger.activeMs!;
      if (e.id === 'T11') at = Math.max(at, world.diplomacy.requests.find(r => r.id === 'cao-cao-envoy')?.heldUntilMs ?? 0);
      if (e.id === 'T09' && !this.help) at = Math.max(at, this.lastInputMs + 60000);
      return at;
    });
    if (!this.receipts.some(r => r.documentId === 'D-jingzhou' && r.reader === 'zhang-zhao')) times.push(35000);
    return Math.min(...times.filter(at => at > now));
  }
  project(world: WorldState, sourceEventId: string, summary: string, emit: (id: string, text: string) => void): void {
    if (this.#projected.has(sourceEventId)) return;
    this.#projected.add(sourceEventId);
    this.#fire(world, 'T13', summary, emit, world.documents.at(-1)?.id, sourceEventId);
  }
  observe(world: WorldState, documentId: string, emit: (id: string, text: string) => void): void {
    const doc = world.documents.find(d => d.id === documentId && d.readers.includes('player'));
    const task = world.tasks.find(t => t.id === doc?.taskId);
    if (!doc || !task || task.deliveredAtMs === undefined || doc.observedAtMs === null || doc.observedAtMs <= task.deliveredAtMs || this.#done('T14')) return;
    this.observed = true;
    this.#fire(world, 'T14', '첫 전략적 지시의 실행 이후 후속 보고를 확인했습니다. 계속 플레이할 수 있습니다.', emit, doc.id);
  }
  meeting(world: WorldState, source: string, emit: (id: string, text: string) => void): void {
    this.#fire(world, 'T08', '요청한 공동 회의가 열렸습니다.', emit, undefined, source);
  }
}

