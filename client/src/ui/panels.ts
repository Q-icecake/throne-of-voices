import type { CommandDraftView, PlayerView, PublicDocument, PublicLogRecord, TaskView } from '../../../shared/contracts.ts';
import { h, seconds } from './dom.ts';
import MAP_SVG from '../assets/jiangdong-map.svg?raw';

export interface PanelActions {
  openDocument(id: string): void;
  confirm(draft: CommandDraftView): void;
  cancel(draft: CommandDraftView): void;
  revise(draft: CommandDraftView, text: string): void;
  recall(task: TaskView): void;
  busy: boolean;
}

export const LEDGER_DOC_ID = 'ledger';
const POLICY_LABELS = { hold: '대기 (별도 지시 없음)', 'no-first-strike': '선제공격 금지' } as const;
const STAGES: { id: TaskView['stage'] | 'registered'; label: string }[] = [
  { id: 'registered', label: '등록' }, { id: 'delivering', label: '전달 중' },
  { id: 'in-progress', label: '정비 중' }, { id: 'completed', label: '완료' },
];

/** The ledger is shown as a document so players read recorded values with their record time. */
function ledgerDocument(state: PlayerView): PublicDocument {
  const l = state.ledger;
  return {
    id: LEDGER_DOC_ID, title: '수군·군량 장부', source: l.source,
    claim: `수군 준비도 ${l.navalReadiness} · 군량 ${l.grain} · 교전 방침 ${POLICY_LABELS[l.engagementPolicy]}. 장부에 기록된 값이며, 기록 이후의 변화는 다음 보고가 와야 반영됩니다.`,
    observedAtMs: l.recordedAtMs, arrivedAtMs: l.recordedAtMs, evidence: '장부 기록 (시험용 수치)',
    region: '강동 수군', provenance: 'test-reconstruction',
  };
}

export function documentList(state: PlayerView): PublicDocument[] {
  return [ledgerDocument(state), ...[...state.knowledge.documents].reverse()];
}

export function documentPanel(state: PlayerView, selectedId: string | null, actions: PanelActions): HTMLElement {
  const docs = documentList(state);
  const selected = docs.find(doc => doc.id === selectedId) ?? docs[0]!;
  const list = h('ul', { class: 'doc-list', 'aria-label': '받은 문서' }, ...docs.map(doc => h('li', {},
    h('button', { type: 'button', class: 'doc-item', 'aria-current': String(doc.id === selected.id), onclick: () => actions.openDocument(doc.id) },
      h('span', { class: 'doc-item-title' }, doc.title),
      h('span', { class: 'doc-item-meta' }, `${doc.source} · ${seconds(doc.arrivedAtMs)}`)))));
  const task = selected.taskId ? state.tasks.find(item => item.id === selected.taskId) : undefined;
  const meta: [string, string][] = [
    ['출처', selected.source], ['관측 / 도착', `${seconds(selected.observedAtMs)} / ${seconds(selected.arrivedAtMs)} (시험 시계)`],
    ['근거', selected.evidence], ['관련 지역', selected.region], ['성격', '역사 검토 전 시험용 재구성'],
    ...(task ? [['관련 작업', `${task.id} · ${task.actionLabel}`] as [string, string]] : []),
  ];
  const paper = h('article', { class: 'paper', 'aria-labelledby': 'paper-title', 'data-document': selected.id },
    h('h3', { id: 'paper-title', class: 'paper-title' }, selected.title),
    h('p', { class: 'paper-body' }, selected.claim),
    h('dl', { class: 'paper-meta' }, ...meta.flatMap(([label, value]) => [h('dt', {}, label), h('dd', {}, value)])),
    h('span', { class: 'stamp' }, '시험 자료'));
  return h('div', { class: 'doc-panel' }, list, paper);
}

function conditionLabel(value: string): string {
  if (value === 'secret') return '비밀';
  if (value === 'public') return '공개';
  if (value.startsWith('after:')) return `${Number(value.slice(6)) + 1}번 행동 완료 후`;
  if (value.startsWith('message:')) return `회신: ${value.slice(8)}`;
  return value;
}
function stageLabel(stage: TaskView['stage']): string {
  return { delivering: '명 전달 중', 'in-progress': '수행 중', completed: '완료', preparing: '출발 준비', travelling: '사절 전달 중', 'awaiting-reply': '회신 대기', waiting: '선행 작업 대기', stopped: '중단' }[stage];
}

function draftCard(draft: CommandDraftView, actions: PanelActions): HTMLElement {
  const rows: [string, string][] = [
    ['행동', draft.actionLabel], ['대상', draft.target], ['담당', draft.assignee.name], ['전달', `${draft.messenger.name} (전령)`],
    ['예상 비용', `군량 ${draft.estimate.grain} · 정비 착수 시 1회`],
    ['예상 소요', `전달 ${seconds(draft.estimate.deliveryMs)} + 정비 ${seconds(draft.estimate.workMs)} (시험 시계)`],
    ['예상 효과', `수군 준비도 +${draft.estimate.readinessGain} (시험 규칙)`],
  ];
  const restrictions = draft.restrictions.length
    ? h('ul', { class: 'restrictions' }, ...draft.restrictions.map(item => h('li', {}, item.label)))
    : h('p', { class: 'muted' }, '제한 조건 없음');
  const editor = h('div', { class: 'revise', hidden: true },
    h('label', { for: `revise-${draft.id}` }, '지시를 고쳐 말하기'),
    h('textarea', { id: `revise-${draft.id}`, rows: '2', maxlength: '2000' }));
  const textarea = editor.querySelector('textarea')!;
  textarea.value = draft.text;
  const reviseButton = h('button', { type: 'button', class: 'btn', 'data-revise-submit': '', disabled: actions.busy, onclick: () => {
    if (editor.hidden) { editor.hidden = false; reviseButton.textContent = '수정 반영'; textarea.focus(); return; }
    if (textarea.value.trim()) actions.revise(draft, textarea.value);
  } }, '수정');
  return h('article', { class: `draft-card ${draft.actions.length > 1 || draft.action !== 'naval-drill' || draft.unresolved.length ? 'compound' : ''}`, 'data-draft': draft.id },
    h('header', { class: 'draft-head' },
      h('h3', {}, `명령 초안 · ${draft.id}`), h('span', { class: 'version' }, `버전 ${draft.version}`)),
    h('div', { class: 'draft-content' }, h('blockquote', { class: 'draft-quote' }, draft.text),
    draft.actions.length > 1 || draft.action !== 'naval-drill' ? h('div', { class: 'action-list' }, ...draft.actions.map((a, i) => h('section', { class: 'action-row' },
      h('h4', {}, `${i + 1}. ${a.actionLabel} · ${a.assignee.name}`),
      h('ul', { class: 'restrictions' }, ...[...a.restrictions.map(r => r.label), ...a.conditions.map(conditionLabel), ...(a.deadline ? [a.deadline] : [])].map(c => h('li', {}, c))),
      h('p', { class: 'muted' }, `군량 ${a.estimate.grain} · 전달 ${seconds(a.estimate.deliveryMs)} + 수행 ${seconds(a.estimate.workMs)}`)))) : h('div', {},
    h('dl', { class: 'draft-rows' }, ...rows.flatMap(([label, value]) => [h('dt', {}, label), h('dd', {}, value)])),
    h('div', { class: 'draft-restrictions' }, h('h4', {}, '제한'), restrictions)),
    draft.unresolved.length ? h('div', {}, h('h4', {}, '미해결'), h('ul', {}, ...draft.unresolved.map(item => h('li', {}, item)))) : null,
    editor),
    h('div', { class: 'draft-actions' },
      h('button', { type: 'button', class: 'btn btn-primary', disabled: actions.busy, onclick: () => actions.confirm(draft) }, draft.unresolved.length ? '표시된 행동만 확인 · 미해결 제외' : '확인 · 전령 보내기'),
      reviseButton,
      h('button', { type: 'button', class: 'btn btn-quiet', disabled: actions.busy, onclick: () => actions.cancel(draft) }, '초안 취소')),
    h('p', { class: 'muted' }, '이 창을 닫아도 초안은 그대로 남습니다. 확인 전에는 아무것도 실행되지 않습니다.'));
}

function taskCard(task: TaskView, state: PlayerView, actions: PanelActions): HTMLElement {
  const reached = (stage: string) => {
    if (stage === 'registered') return true;
    if (stage === 'delivering') return true;
    if (stage === 'in-progress') return task.stage !== 'delivering';
    return task.stage === 'completed';
  };
  const current = task.stage;
  const reports = task.reportIds.map(id => state.knowledge.documents.find(doc => doc.id === id)).filter(Boolean) as PublicDocument[];
  return h('article', { class: 'task-card', 'data-task': task.id },
    h('header', { class: 'draft-head' }, h('h3', {}, `${task.actionLabel} · ${task.id}`), h('span', { class: 'version' }, `${task.draftId} v${task.draftVersion}`)),
    task.action !== 'naval-drill' || task.stage === 'stopped' || task.stage === 'waiting' ? h('p', { class: 'task-stage' }, stageLabel(task.stage)) : h('ol', { class: 'stages' }, ...STAGES.map(stage => h('li', {
      class: `step ${reached(stage.id) ? 'reached' : ''} ${stage.id === current ? 'current' : ''}`,
      ...(stage.id === current ? { 'aria-current': 'step' } : {}),
    }, stage.label))),
    h('dl', { class: 'draft-rows' },
      h('dt', {}, '담당'), h('dd', {}, task.assignee.name),
      h('dt', {}, '제한'), h('dd', {}, task.restrictions.map(item => item.label).join(', ') || '없음'),
      h('dt', {}, '조건'), h('dd', {}, task.conditions.map(conditionLabel).join(' · ') || '별도 지정 없음'),
      h('dt', {}, '기한'), h('dd', {}, task.deadlineAtMs !== undefined ? seconds(task.deadlineAtMs) : '없음'),
      h('dt', {}, '등록'), h('dd', {}, seconds(task.registeredAtMs)),
      h('dt', {}, '전달'), h('dd', {}, task.deliveredAtMs !== undefined ? seconds(task.deliveredAtMs) : '아직'),
      h('dt', {}, '완료'), h('dd', {}, task.completedAtMs !== undefined ? seconds(task.completedAtMs) : '아직'),
      h('dt', {}, '사용한 군량'), h('dd', {}, task.grainSpent ? String(task.grainSpent) : '아직 없음')),
    task.recall ? h('p', { class: 'muted' }, task.recall.status === 'stopped' ? '회수: 중단됨 (기존 소모·공개 유지)' : '회수 요청 기록 · 출발 이후 회수 미지원') : task.stage !== 'completed' && task.stage !== 'stopped' ? h('button', { type: 'button', class: 'btn', disabled: actions.busy, onclick: () => actions.recall(task) }, '회수 요청') : null,
    reports.length ? h('div', { class: 'task-reports' }, h('h4', {}, '관련 보고'),
      ...reports.map(report => h('button', { type: 'button', class: 'link', onclick: () => actions.openDocument(report.id) }, `${report.title} · ${seconds(report.arrivedAtMs)}`))) : null,
    h('p', { class: 'muted' }, task.stage === 'completed'
      ? '등록된 작업을 완료했습니다. 교전·동맹·조약의 자동 성립은 없습니다.'
      : '시간이 흘러야 진행됩니다. 시험 도구의 시계 버튼으로 시간을 보낼 수 있습니다.'));
}

const STATUS_LABELS = { 'awaiting-confirmation': '확인 대기', confirmed: '확정', cancelled: '취소', rejected: '반려' } as const;

export function commandPanel(state: PlayerView, actions: PanelActions): HTMLElement {
  const awaiting = state.drafts.filter(draft => draft.status === 'awaiting-confirmation');
  const closed = state.drafts.filter(draft => draft.status === 'cancelled' || draft.status === 'rejected');
  const tasks = [...state.tasks].reverse();
  return h('div', { class: 'command-panel' },
    awaiting.length ? h('section', {}, ...awaiting.map(draft => draftCard(draft, actions))) : null,
    tasks.length ? h('section', {}, h('h3', { class: 'section-label' }, '진행 중인 일과 지난 일'), ...tasks.map(task => taskCard(task, state, actions))) : null,
    closed.length ? h('details', { class: 'closed-drafts' }, h('summary', {}, `취소·반려된 초안 ${closed.length}건`),
      h('ul', {}, ...closed.map(draft => h('li', {}, `${draft.id} v${draft.version} · ${STATUS_LABELS[draft.status]} · 「${draft.text}」${draft.statusNote ? ` — ${draft.statusNote}` : ''}`)))) : null,
    !awaiting.length && !tasks.length && !closed.length
      ? h('p', { class: 'muted' }, '아직 내린 명령이 없습니다. 아래 입력란에서 장굉에게 지시하면 초안이 이곳에 나타납니다.') : null);
}

export function recordPanel(logs: PublicLogRecord[]): HTMLElement {
  return h('ol', { class: 'record-list', reversed: true }, ...[...logs].reverse().map(log => h('li', {},
    h('span', { class: 'record-time' }, seconds(log.atActiveMs)),
    h('span', { class: 'record-id' }, log.id),
    h('span', { class: 'record-summary' }, log.summary))));
}

export function mapPanel(state: PlayerView, actions: PanelActions): HTMLElement {
  const wrapper = h('div', { class: 'map-panel' });
  wrapper.innerHTML = MAP_SVG; // static markup, no user text
  const regions = [
    { id: 'map-jiangdong', label: '강동', docs: state.knowledge.documents.filter(doc => doc.region === '강동') },
    { id: 'map-navy', label: '강동 수군', docs: state.knowledge.documents.filter(doc => doc.region === '강동 수군') },
  ];
  const legend = h('ul', { class: 'map-legend' }, ...regions.map(region => h('li', {},
    h('strong', {}, region.label), ' · ',
    region.docs.length
      ? h('span', {}, ...region.docs.map((doc, index) => h('span', {}, index ? ', ' : '', h('button', { type: 'button', class: 'link', onclick: () => actions.openDocument(doc.id) }, doc.title))))
      : region.id === 'map-navy'
        ? h('button', { type: 'button', class: 'link', onclick: () => actions.openDocument(LEDGER_DOC_ID) }, '수군·군량 장부')
        : h('span', { class: 'muted' }, '받은 보고 없음'))));
  for (const region of regions) {
    const marker = wrapper.querySelector<SVGGElement>(`#${region.id}`);
    const first = region.docs.at(-1)?.id ?? (region.id === 'map-navy' ? LEDGER_DOC_ID : null);
    if (marker && first) {
      marker.setAttribute('tabindex', '0');
      marker.setAttribute('role', 'button');
      marker.setAttribute('aria-label', `${region.label} 관련 자료 열기`);
      marker.addEventListener('click', () => actions.openDocument(first));
      marker.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); actions.openDocument(first); } });
    }
  }
  wrapper.append(legend, h('p', { class: 'muted' }, '시험용 개념도입니다. 축척·지리 정확성이 없으며 관측된 병력은 표시하지 않습니다. 받은 보고가 있는 곳만 표시합니다.'));
  return wrapper;
}
