import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Node 내장 모듈만 사용한다. 역사·자연스러움·실제 서버 권한을 증명하지 않는다.
const root = dirname(fileURLToPath(import.meta.url));
const names = ['documents', 'knowledge', 'npc-lines', 'events', 'test-scenarios'];
const people = ['player', 'zhang-hong', 'zhang-zhao', 'zhou-yu', 'lu-su'];
const commonTags = ['first-audience', 'dispatch-question', 'information-request', 'opposing-view', 'risk-explanation', 'clarify-order', 'after-document', 'audience-deferred'];
const historical = readFileSync(join(root, 'opening/historical-notes.md'), 'utf8');
const notes = new Set([...historical.matchAll(/^\| ([ABC]\d{2}) \|/gm)].map(m => m[1]));
const eventMarkdown = readFileSync(join(root, 'opening/events.md'), 'utf8');
const scenarioMarkdown = readFileSync(join(root, 'opening/test-scenarios.md'), 'utf8');

function validate(data) {
  const errors = [];
  const check = (ok, label) => { if (!ok) errors.push(label); };
  const str = x => typeof x === 'string' && x.trim().length > 0;
  const list = (x, label, min = 0) => { check(Array.isArray(x) && x.length >= min, label); return Array.isArray(x) ? x : []; };
  const strings = (x, label, min = 0) => { const a = list(x, label, min); check(a.every(str), `${label}: 문자열`); return a; };
  const obj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const fields = (x, required, label) => { check(obj(x), `${label}: 객체`); for (const f of required) check(obj(x) && Object.hasOwn(x, f), `${label}.${f}: 필수 필드`); };
  const textFields = (x, fs, label) => { fields(x, fs, label); for (const f of fs) check(str(x?.[f]), `${label}.${f}: 문자열`); };
  const refs = (x, ids, label, min = 0) => { const a = strings(x, label, min); for (const id of a) check(ids.has(id), `${label}: 참조 없음 ${id}`); check(new Set(a).size === a.length, `${label}: 중복 참조`); return a; };
  const integer = x => Number.isSafeInteger(x) && x >= 0;
  for (const name of names) {
    fields(data[name], ['version', 'status'], name);
    check(data[name]?.version === 1 && str(data[name]?.status), `${name}: 버전·상태`);
  }
  const docs = list(data.documents?.documents, 'documents', 6);
  const knowledge = list(data.knowledge?.knowledge, 'knowledge', 1);
  const lines = list(data['npc-lines']?.lines, 'lines', 1);
  const events = list(data.events?.events, 'events', 1);
  const scenarios = list(data['test-scenarios']?.scenarios, 'scenarios', 9);
  const boundaries = list(data['test-scenarios']?.boundaryChecks, 'boundaryChecks', 1);
  const globalIds = new Set();
  const index = (items, prefix) => {
    const ids = new Set();
    for (const x of items) {
      check(obj(x) && str(x.id) && x.id.startsWith(prefix), `${prefix}: ID 형식`);
      check(!globalIds.has(x?.id), `중복 ID: ${x?.id}`);
      globalIds.add(x?.id); ids.add(x?.id);
    }
    return ids;
  };
  const dids = index(docs, 'D-'), kids = index(knowledge, 'K-');
  index(lines, 'L-');
  const eids = index(events, 'T'), sids = index(scenarios, 'S'), bids = index(boundaries, 'PB');
  const personIds = new Set(people), tags = new Set(lines.map(l => l.tag));
  const documents = new Map(docs.map(d => [d.id, d]));
  const knowledgeMap = new Map(knowledge.map(k => [k.id, k]));
  for (const id of ['D-jingzhou', 'D-cao-letter', 'D-zhangzhao', 'D-zhouyu', 'D-supply', 'D-courier']) check(dids.has(id), `필수 문서 ${id}`);
  for (let n = 1; n <= 14; n++) check(eids.has(`T${String(n).padStart(2, '0')}`), `필수 사건 T${n}`);
  for (let n = 1; n <= 12; n++) check(sids.has(`S${String(n).padStart(2, '0')}`), `필수 시나리오 S${n}`);
  for (const d of docs) {
    fields(d, ['source', 'observedAt', 'proposedArrivalActiveMs', 'readers', 'evidence', 'regions', 'historicalNoteIds'], d.id);
    textFields(d, ['title', 'body', 'classification'], d.id);
    const length = [...(d.body ?? '')].length;
    check(length >= 120 && length <= 300, `${d.id}: 본문 120~300자 (${length})`);
    textFields(d.source, ['author', 'note'], `${d.id}.source`);
    check(d.source?.sourceUnverified === true, `${d.id}: 출처 미확인 표시`);
    fields(d.observedAt, ['label', 'activeMs'], `${d.id}.observedAt`);
    check(str(d.observedAt?.label), `${d.id}: 관측 시점 설명`);
    check(d.observedAt?.activeMs === null || integer(d.observedAt?.activeMs), `${d.id}: 관측 시각`);
    check(integer(d.proposedArrivalActiveMs), `${d.id}: 도착 시각`);
    check(d.observedAt?.activeMs === null || d.observedAt?.activeMs <= d.proposedArrivalActiveMs, `${d.id}: 관측·도착 순서`);
    refs(d.readers, personIds, `${d.id}.readers`, 1);
    textFields(d.evidence, ['claim', 'uncertainty', 'confirmedScope', 'meaning'], `${d.id}.evidence`);
    check(d.evidence?.meaning?.includes('정답 확률이 아님'), `${d.id}: 근거 수준 범례`);
    strings(d.regions, `${d.id}.regions`, 1);
    refs(d.historicalNoteIds, notes, `${d.id}.historicalNoteIds`, 1);
    check(d.classification === '게임 재구성', `${d.id}: 창작 문서 분류`);
  }
  for (const k of knowledge) {
    textFields(k, ['summary', 'acquisition', 'classification'], k.id);
    const holders = refs(k.initialHolders, personIds, `${k.id}.initialHolders`);
    const allowed = refs(k.eligibleReaders, personIds, `${k.id}.eligibleReaders`, 1);
    check(holders.every(h => allowed.includes(h)), `${k.id}: 초기 보유자 권한`);
    for (const did of refs(k.sourceDocumentIds, dids, `${k.id}.sourceDocumentIds`)) {
      check(allowed.every(p => documents.get(did)?.readers?.includes(p)), `${k.id}: 원문보다 넓은 지식 권한`);
    }
    refs(k.historicalNoteIds, notes, `${k.id}.historicalNoteIds`, 1);
    check(k.sourceUnverified === true && k.classification === '게임 재구성', `${k.id}: 출처·재구성 표시`);
  }
  const grouped = new Map();
  for (const l of lines) {
    textFields(l, ['characterId', 'tag', 'text', 'classification', 'availability', 'effects'], l.id);
    check(people.slice(1).includes(l.characterId), `${l.id}: 인물`);
    const count = (l.text ?? '').split(/[.!?。！？]+/u).filter(s => s.trim()).length;
    check(count >= 2 && count <= 4 && /[.!?。！？]$/.test(l.text), `${l.id}: 대사 2~4문장 (${count})`);
    const required = refs(l.requiredKnowledgeIds, kids, `${l.id}.requiredKnowledgeIds`, 1);
    for (const kid of required) check(knowledgeMap.get(kid)?.eligibleReaders?.includes(l.characterId), `${l.id}: 인물이 취득할 수 없는 지식 ${kid}`);
    for (const did of refs(l.documentIds, dids, `${l.id}.documentIds`)) {
      check(documents.get(did)?.readers?.includes(l.characterId), `${l.id}: 원문 열람 권한`);
      check(required.some(kid => knowledgeMap.get(kid)?.sourceDocumentIds?.includes(did)), `${l.id}: 문서에 대한 지식 조건 누락`);
    }
    refs(l.historicalNoteIds, notes, `${l.id}.historicalNoteIds`, 1);
    check(l.sourceUnverified === true && l.classification === '게임 재구성', `${l.id}: 출처·재구성 표시`);
    const key = `${l.characterId}/${l.tag}`;
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  }
  for (const p of people.slice(1)) for (const t of [...commonTags, ...(p === 'zhang-hong' ? ['weak-hint', 'lusu-hint'] : [])]) check(grouped.has(`${p}/${t}`), `${p}/${t}: 필수 상황 누락`);
  for (const [key, count] of grouped) check(count >= 2 && count <= 3, `${key}: 변형 2~3개 (${count})`);
  for (const e of events) {
    textFields(e, ['title', 'onceScope', 'freedom', 'classification'], e.id);
    fields(e.trigger, ['clock', 'kind', 'activeMs', 'note'], `${e.id}.trigger`);
    check(e.trigger?.clock === '활성 시간' && str(e.trigger?.kind) && str(e.trigger?.note), `${e.id}: 활성 시계·트리거 설명`);
    check(e.trigger?.activeMs === null || integer(e.trigger?.activeMs), `${e.id}: 발생 시각`);
    strings(e.prerequisites, `${e.id}.prerequisites`, 1);
    strings(e.cancelOrReplace, `${e.id}.cancelOrReplace`, 1);
    refs(e.documentIds, dids, `${e.id}.documentIds`);
    refs(e.dialogueTags, tags, `${e.id}.dialogueTags`);
    refs(e.knowledgeIds, kids, `${e.id}.knowledgeIds`);
    check(eventMarkdown.includes(`| ${e.id} |`), `${e.id}: Markdown 사건 목록 누락`);
  }
  for (const b of boundaries) textFields(b, ['check'], b.id);
  for (const s of scenarios) {
    textFields(s, ['title', 'status', 'setup', 'orderMeaning'], s.id);
    refs(s.expectedEventOrder, eids, `${s.id}.expectedEventOrder`, 1);
    strings(s.forbidden, `${s.id}.forbidden`, 1);
    refs(s.boundaryIds, bids, `${s.id}.boundaryIds`, 1);
    check(scenarioMarkdown.includes(`| ${s.id} |`), `${s.id}: Markdown 시험 목록 누락`);
    let time = -1;
    const covered = new Set();
    for (const [i, step] of list(s.steps, `${s.id}.steps`, 1).entries()) {
      const label = `${s.id}.steps[${i}]`;
      check(integer(step.atActiveMs) && step.atActiveMs >= time, `${label}: 단계 시각`); time = step.atActiveMs;
      textFields(step.input, ['kind', 'text'], `${label}.input`);
      check(['문장', '조작'].includes(step.input?.kind), `${label}: 입력 종류`);
      textFields(step.provider, ['mock', 'scripted', 'note', 'evidence'], `${label}.provider`);
      if (step.input?.kind === '문장') {
        check(['명령 지원', '질문 분류만', 'Provider 필요'].includes(step.provider?.mock), `${label}: Mock 지원 표시`);
        check(step.provider?.scripted === 'Provider 필요' && step.provider?.note?.includes('주입된 응답'), `${label}: Scripted 한계 표시`);
      } else check(step.provider?.mock === '해당 없음' && step.provider?.scripted === '해당 없음', `${label}: 조작은 언어 인식 아님`);
      check(str(step.expected), `${label}: 기대 결과`);
      for (const id of refs(step.eventIds, eids, `${label}.eventIds`)) covered.add(id);
      refs(step.documentIds, dids, `${label}.documentIds`);
      refs(step.dialogueTags, tags, `${label}.dialogueTags`);
    }
    for (const id of s.expectedEventOrder ?? []) check(covered.has(id), `${s.id}: 단계에서 확인하지 않는 사건 ${id}`);
  }
  for (const row of historical.split('\n').filter(s => /^\| A\d{2} \|/.test(s))) {
    check(row.includes('사람의 사료 대조 필요') && row.includes('출처 미확인: 예'), 'A 분류의 사료 미검증 표시 누락');
  }
  // 플레이어에게 실제로 제시할 내용만 검사한다. 금지 사례를 적은 설계 문서는 대상이 아니다.
  const forbidden = [
    ['충성도 수치', /충성(?:도|심)?[^.!?\n]{0,16}(?:\d+(?:\.\d+)?\s*(?:%|점|퍼센트)?|백\s*퍼센트)/u],
    ['정확한 적 병력', /(?:조조(?:군|의\s*군사)?|적군|적의?\s*병력)[^.!?\n]{0,45}(?:\d[\d,]*(?:\s*[만천백])?|[일이삼사오육칠팔구십백천]+만|[십백천][일이삼사오육칠팔구십백천]*)\s*(?:명|만|병|기)/u],
    ['타인 내면 단정', /(?:속마음은|속으로는|내심|마음속으로|속셈은)[^.!?\n]{0,45}(?:이다|한다|했다|있다|있습니다|합니다|않습니다|숨긴다|숨깁니다|노린다|노립니다)/u],
    ['미래 결과 단정', /(?:반드시\s*(?:승리|패배)|적벽에서\s*(?:이긴다|승리한다|패한다)|이미\s*동맹이\s*성립)/u],
  ];
  const prose = [
    ...docs.map(d => [d.id, `${d.title} ${d.body} ${d.source?.author} ${Object.values(d.evidence ?? {}).join(' ')} ${(d.regions ?? []).join(' ')}`]),
    ...lines.map(l => [l.id, l.text]), ...knowledge.map(k => [k.id, k.summary]),
  ];
  for (const [id, text] of prose) for (const [label, pattern] of forbidden) check(!pattern.test(text), `${id}: 금지 표현 후보 (${label})`);
  return errors;
}

// content 아래의 추가 JSON도 빠짐없이 파싱한다. 원격·패키지·엔진을 읽지 않는다.
function readAllJson(dir, result = new Map()) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) readAllJson(path, result);
    else if (entry.name.endsWith('.json')) result.set(path, JSON.parse(readFileSync(path, 'utf8')));
  }
  return result;
}
try {
  const all = readAllJson(root);
  const data = Object.fromEntries(names.map(n => [n, all.get(join(root, 'opening', `${n}.json`))]));
  const errors = validate(data);
  if (errors.length) throw new Error(errors.join('\n'));
  if (process.argv.includes('--self-test')) {
    const mutations = [
      ['필수 필드', d => delete d.documents.documents[0].body, 'body'],
      ['중복 ID', d => d.documents.documents[1].id = d.documents.documents[0].id, '중복 ID'],
      ['없는 지식', d => d['npc-lines'].lines[0].requiredKnowledgeIds = ['K-missing'], '참조 없음'],
      ['없는 문서', d => d['npc-lines'].lines[0].documentIds = ['D-missing'], '참조 없음'],
      ['문서 지식 누락', d => d['npc-lines'].lines[0].documentIds = ['D-jingzhou'], '지식 조건 누락'],
      ['타인 권한', d => d['npc-lines'].lines[0].requiredKnowledgeIds = ['K-lusu-contact'], '취득할 수 없는 지식'],
      ['짧은 본문', d => d.documents.documents[0].body = '짧다.', '120~300자'],
      ['문장 수', d => d['npc-lines'].lines[0].text = '한 문장입니다.', '2~4문장'],
      ['충성도', d => d['npc-lines'].lines[0].text = '장조의 충성도는 90점입니다. 확실합니다.', '충성도 수치'],
      ['적 병력 숫자', d => d['npc-lines'].lines[0].text = '조조군은 정확히 100000명입니다. 확실합니다.', '정확한 적 병력'],
      ['적 병력 한글', d => d['npc-lines'].lines[0].text = '조조의 군사는 이십만 명입니다. 확실합니다.', '정확한 적 병력'],
      ['내면', d => d['npc-lines'].lines[0].text = '장조는 내심 반역을 노립니다. 확실합니다.', '타인 내면 단정'],
      ['미래', d => d['npc-lines'].lines[0].text = '적벽에서 반드시 승리합니다. 확실합니다.', '미래 결과 단정'],
      ['사건 참조', d => d['test-scenarios'].scenarios[0].expectedEventOrder.push('T99'), '참조 없음'],
      ['지식 권한 확대', d => d.knowledge.knowledge.find(k => k.id === 'K-zhangzhao-note').eligibleReaders.push('lu-su'), '원문보다 넓은 지식 권한'],
      ['변형 누락', d => d['npc-lines'].lines.splice(0, 1), '변형 2~3개'],
      ['Provider 표시', d => d['test-scenarios'].scenarios[0].steps.find(s => s.input.kind === '문장').provider.scripted = '지원', 'Scripted 한계'],
    ];
    for (const [label, mutate, expected] of mutations) {
      const changed = structuredClone(data); mutate(changed);
      assert(validate(changed).some(e => e.includes(expected)), `${label}: 변조 검출 실패`);
    }
    assert.throws(() => JSON.parse('{"broken":'), SyntaxError);
    console.log(`검증기 자체 시험 통과: 변조 ${mutations.length}개 + 잘못된 JSON 1개`);
  }
  console.log(`콘텐츠 검증 통과: JSON ${all.size}개, 문서 ${data.documents.documents.length}개, 지식 ${data.knowledge.knowledge.length}개, 대사 ${data['npc-lines'].lines.length}개, 사건 ${data.events.events.length}개, 시나리오 ${data['test-scenarios'].scenarios.length}개`);
  console.log('검사: 필수 필드·ID·문서/지식/태그 참조·취득 가능 권한·본문/문장 길이·금지 표현 패턴');
  console.log('미검증: 역사 정확성·한국어 자연스러움·의미상 모든 누출·M4/M5 런타임·실제 플레이');
} catch (error) {
  console.error(`콘텐츠 검증 실패\n${error.message}`);
  process.exitCode = 1;
}
