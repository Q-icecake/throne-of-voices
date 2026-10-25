import './style.css';
import './panels.css';
import type {
  ActionResponse, CommandDraftView, CommandOutcome, CommandRequest, CommandResponse, PlayerView, PublicLogRecord,
  PublicSnapshot, TestAction,
} from '../../shared/contracts.ts';
import { MOCK_SAMPLE_SENTENCES } from '../../shared/mock-samples.ts';
import { mountSlot } from './scene/assets.ts';
import { byId, h, seconds } from './ui/dom.ts';
import { INITIAL_FOCUS, reduceFocus, sceneId } from './ui/focus.ts';
import type { FocusEvent, FocusState } from './ui/focus.ts';
import { commandPanel, documentList, documentPanel, mapPanel, recordPanel } from './ui/panels.ts';
import type { PanelActions } from './ui/panels.ts';
import { audiencePanel } from './ui/panels.ts';
import type { AudienceRequest, CharacterId, TalkResponse } from '../../shared/contracts.ts';
import zhaoArt from './assets/zhang-zhao.svg';
import yuArt from './assets/zhou-yu.svg';
import suArt from './assets/lu-su.svg';
import hongArt from './assets/zhang-hong.svg';

const stage = byId('stage');
const speechInput = byId<HTMLTextAreaElement>('speech-input');
const probeInput = byId<HTMLTextAreaElement>('probe-input');
const errorBox = byId('error');
const panel = byId('panel');
const panelBody = byId('panel-body');
const devDrawer = byId('dev-drawer');
const replyLine = byId('reply');
// AI replies can wrap or scroll. Reserve their actual height so panels never hide them.
new ResizeObserver(entries => {
  const height = entries[0]?.target.getBoundingClientRect().height ?? 0;
  stage.style.setProperty('--speech-clearance', `${Math.ceil(height) + 28}px`);
}).observe(byId('speech'));
const devControls = ['clock-mode', 'advance-next', 'advance', 'advance-30', 'pause', 'reset', 'probe-submit', 'snapshot', 'logs'];
const pauseLabels = { manual: '수동', typing: '작성 중', provider: 'AI 대기', confirmation: '확인 대기', background: '백그라운드' };
const PANEL_TITLES = { document: '문서', map: '강동 상황도', record: '처리 기록', command: '명령', audience: '접견 · 회의' } as const;

let state: PlayerView | undefined;
let focus: FocusState = INITIAL_FOCUS;
let logs: PublicLogRecord[] = [];
let busy = false;
let composing = false;
let audienceMode = false;
let addressee: CharacterId = 'zhang-hong';
const art = { 'zhang-hong': hongArt, 'zhang-zhao': zhaoArt, 'zhou-yu': yuArt, 'lu-su': suArt };
const seenDocuments = new Set<string>();

mountSlot(byId('layer-back'), 'court.background');
mountSlot(byId('layer-mid'), 'court.figures');
mountSlot(byId('layer-front'), 'court.foreground');

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(path === '/api/command' || path === '/api/talk' ? 20000 : 5000),
  });
  if (!response.ok) throw new Error(`로컬 서버 오류 (${response.status}). 서버 실행 상태를 확인하고 다시 시도하세요. 입력은 보존되었습니다.`);
  return await response.json() as T;
}

// ---------- local focus; reading/observation is separately acknowledged by the server ----------

function setFocus(event: FocusEvent): void {
  focus = reduceFocus(focus, event);
  renderFocus();
  void syncActivity();
  if (focus.panel === 'document' && focus.documentId) void observeDocument(focus.documentId);
}

function renderFocus(): void {
  stage.dataset.scene = sceneId(focus);
  stage.dataset.panel = focus.panel;
  for (const [id, name] of [['tool-audience', 'audience'], ['tool-documents', 'document'], ['tool-map', 'map'], ['tool-command', 'command'], ['tool-record', 'record']] as const) {
    byId(id).setAttribute('aria-pressed', String(focus.panel === name));
  }
  byId('tool-dev').setAttribute('aria-pressed', String(focus.devOpen));
  devDrawer.hidden = !focus.devOpen;
  renderPanel();
}

const panelActions = (): PanelActions => ({
  share: (characterId, documentId) => void run(() => audience({ type: 'share', characterId, documentId })),
  busy,
  recall: task => void run(async () => { await command({ type: 'recall', taskId: task.id }); }),
  openDocument: id => setFocus({ type: 'select-document', documentId: id }),
  confirm: draft => void run(async () => { await command({ type: 'confirm', draftId: draft.id, version: draft.version, ...(draft.unresolved.length ? { acceptPartial: true } : {}) }); }),
  cancel: draft => void run(async () => { await command({ type: 'cancel', draftId: draft.id, version: draft.version }); }),
  revise: (draft: CommandDraftView, text: string) => void run(async () => { await command({ type: 'revise', draftId: draft.id, version: draft.version, text }); }),
});

function renderPanel(): void {
  if (focus.panel === 'none' || !state) { panel.hidden = true; return; }
  panel.hidden = false;
  panel.dataset.kind = focus.panel;
  byId('panel-title').textContent = PANEL_TITLES[focus.panel];
  const scroll = panelBody.scrollTop;
  const pending = focus.panel === 'command' ? state.drafts.filter(draft => draft.status === 'awaiting-confirmation').map(draft => `${draft.id}:${draft.version}`).join(',') : '';
  const viewKey = `${focus.panel}:${focus.documentId ?? ''}:${pending}`;
  const sameView = panelBody.dataset.view === viewKey;
  let content: HTMLElement;
  switch (focus.panel) {
    case 'audience': content = audiencePanel(state, busy, request => void run(() => audience(request))); break;
    case 'document': content = documentPanel(state, focus.documentId, panelActions()); break;
    case 'map': content = mapPanel(state, panelActions()); break;
    case 'command': content = commandPanel(state, panelActions()); break;
    case 'record': content = recordPanel(logs); break;
  }
  // Keep an in-progress revision text if the panel re-renders under it.
  const editing = [...panelBody.querySelectorAll<HTMLTextAreaElement>('.revise textarea')].filter(area => !area.closest('[hidden]'));
  panelBody.replaceChildren(content);
  for (const area of editing) {
    const next = panelBody.querySelector<HTMLTextAreaElement>(`#${area.id}`);
    if (next) {
      next.value = area.value;
      next.closest<HTMLElement>('.revise')!.hidden = false;
      const button = next.closest('.draft-card')?.querySelector('[data-revise-submit]');
      if (button) button.textContent = '수정 반영';
    }
  }
  panelBody.dataset.view = viewKey;
  panelBody.scrollTop = sameView ? scroll : 0;
  if (focus.panel === 'document') {
    const docs = documentList(state);
    seenDocuments.add((docs.find(doc => doc.id === focus.documentId) ?? docs[0]!).id);
    renderBadges();
  }
}

// ---------- world state rendering ----------

function renderBadges(view = state): void {
  if (!view) return;
  const unread = view.knowledge.documents.filter(doc => !seenDocuments.has(doc.id)).length;
  const docBadge = byId('badge-documents');
  docBadge.hidden = unread === 0;
  docBadge.textContent = String(unread);
  const audienceBadge = byId('badge-audience');
  audienceBadge.hidden = view.audience.requested.length === 0; audienceBadge.textContent = String(view.audience.requested.length);
  const pending = view.drafts.filter(draft => draft.status === 'awaiting-confirmation').length;
  const commandBadge = byId('badge-command');
  commandBadge.hidden = pending === 0;
  commandBadge.textContent = String(pending);
}

function render(next: PlayerView): void {
  if (!state) for (const doc of next.knowledge.documents) seenDocuments.add(doc.id);
  state = next;
  renderAudience();
  stage.dataset.interpretation = next.mode;
  const interpretation = next.interpretation ?? { source: 'Mock', status: 'AI 미연결, Mock 사용 중' };
  byId('interpretation-status').textContent = `${interpretation.source} · ${interpretation.status}`;
  byId('interpretation-status').title = interpretation.status;
  byId('active-time').textContent = seconds(next.clock.activeMs);
  byId('held-time').textContent = seconds(next.clock.heldMs);
  byId('revision').textContent = String(next.revision);
  byId('pause-status').textContent = next.clock.pauseReasons.length
    ? `보류 사유: ${next.clock.pauseReasons.map(reason => pauseLabels[reason]).join(', ')}`
    : `보류 사유 없음 · ${next.opening?.clockMode === 'auto' ? '자동으로 시간이 흐릅니다.' : '수동 시험 시계'}`;
  byId('clock-mode').textContent = next.opening?.clockMode === 'auto' ? '자동 시계 → 수동 전환' : '수동 시계 → 자동 전환';
  const paused = next.clock.pauseReasons.includes('manual');
  byId('pause').textContent = paused ? '수동 보류 해제' : '수동 보류';
  byId('pause').setAttribute('aria-pressed', String(paused));
  byId('pause-chip').hidden = next.clock.pauseReasons.length === 0;
  byId('connection').textContent = `서버 연결됨 · 시험 시계 ${seconds(next.clock.activeMs)}`;
  byId('snapshot-preview').textContent = JSON.stringify(next, null, 2);
  renderBadges();
  renderPanel();
  renderOpeningNotice(next);
}

function renderOpeningNotice(next: PlayerView): void {
  const notice = next.opening?.notices.filter(n => n.eventId !== 'T01').at(-1);
  const noticeBox = byId('opening-notice');
  noticeBox.hidden = !notice;
  if (notice && noticeBox.dataset.notice !== notice.id) { noticeBox.textContent = notice.text; noticeBox.dataset.notice = notice.id; }
}

function renderAudience(): void {
  if (!state) return;
  const empty = state.audience.participants.length === 0;
  stage.dataset.audienceEmpty = String(empty);
  document.querySelector<HTMLElement>('.character-art')!.hidden = empty;
  byId('zhang-hong-tag').hidden = empty;
  byId('hotspot-zhang-hong').hidden = empty;
  if (!state.audience.participants.includes(addressee)) addressee = state.audience.participants[0] ?? 'zhang-hong';
  const person = state.characters.find(c => c.id === addressee)!;
  document.querySelector('.speech-to')!.textContent = empty ? '접견 필요' : `${person.name}에게`;
  byId('speech').setAttribute('aria-label', `${person.name}에게 말하기`);
  speechInput.placeholder = `${person.name}에게 말하거나 지시하세요. (Enter 줄바꿈 · 전하기 버튼으로 전송)`;
  const mainImage = document.querySelector<HTMLImageElement>('.character-art .slot-image');
  if (mainImage && mainImage.dataset.character !== addressee) {
    mainImage.dataset.character = addressee;
    if (!mainImage.src.endsWith(art[addressee])) mainImage.src = art[addressee];
  }
  byId('zhang-hong-tag').textContent = `${person.name} · ${person.role}`;
  byId('hotspot-zhang-hong').setAttribute('aria-label', `${person.name}에게 말하기`);
  document.querySelectorAll('.meeting-figure').forEach(el => el.remove());
  state.audience.participants.filter(id => id !== addressee).forEach((id, index) => {
    const other = state!.characters.find(c => c.id === id)!;
    const figure = h('button', { type: 'button', class: 'meeting-figure', 'aria-label': `${other.name}에게 발언 요청`,
      onclick: () => { addressee = id; renderAudience(); speechInput.focus(); } },
      h('img', { src: art[id], alt: '', class: 'meeting-art' }), h('span', {}, other.name));
    figure.style.left = `${58 + index * 12}%`;
    byId('layer-mid').append(figure);
  });
  if (audienceMode) {
    focus = reduceFocus(focus, { type: 'address', speaker: state.audience.participants.length ? addressee : null, meeting: state.audience.participants.length > 1 });
    stage.dataset.scene = sceneId(focus);
  }
}

async function audience(request: AudienceRequest): Promise<void> {
  const response = await api<TalkResponse>('/api/audience', request);
  audienceMode = true;
  render(response.state);
  showReply(response.notice ?? '접견 상태를 갱신했습니다.', '접견');
  if (request.type === 'invite' && response.state.audience.participants.join() === request.participants.join()) setFocus({ type: 'close' });
}

async function talk(text: string): Promise<CommandOutcome> {
  const response = await api<TalkResponse>('/api/talk', { characterId: addressee, text });
  render(response.state);
  await refreshLogs();
  const spoken = response.turns.filter(t => t.speaker !== 'player');
  showReply(response.notice ?? response.outcome?.reply ?? spoken.map(t => `${state!.characters.find(c => c.id === t.speaker)!.name}: ${t.text}`).join('\n'), `${{ offline: '오프라인', AI: 'AI', mixed: 'AI + 작성 대사' }[response.source]} 대화 · 주군의 차례`);
  if (response.outcome?.kind === 'draft' && focus.panel !== 'command') setFocus({ type: 'open', panel: 'command' });
  return response.outcome ?? { kind: 'answer', intent: response.notice ? 'ambiguous' : 'discussion', reply: response.notice ?? '', reason: '실행 없음' };
}

function showReply(text: string, speaker = '장굉'): void {
  replyLine.replaceChildren(h('span', { class: 'speaker' }, speaker), text);
  replyLine.hidden = false;
}

// ---------- requests ----------

async function run(work: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  errorBox.hidden = true;
  for (const id of [...devControls, 'refresh', 'speech-submit']) byId<HTMLButtonElement>(id).disabled = true;
  renderPanel();
  try { await work(); }
  catch (error) {
    errorBox.textContent = error instanceof Error ? error.message : '연결 실패. 입력은 보존되었습니다.';
    errorBox.hidden = false;
    byId('connection').textContent = '요청 실패 · 상태 다시 읽기 또는 재시도';
  } finally {
    busy = false;
    for (const id of devControls) byId<HTMLButtonElement>(id).disabled = !state;
    byId<HTMLButtonElement>('refresh').disabled = false;
    updateSpeechButton();
    renderPanel();
    void syncActivity();
  }
}

async function refreshLogs(): Promise<void> {
  if (focus.panel === 'record') logs = await api<PublicLogRecord[]>('/api/test/logs');
}

async function dispatch(action: TestAction): Promise<void> {
  const response = await api<ActionResponse>('/api/test/action', action);
  if (response.result) byId('mock-result').textContent = response.result.dialogue;
  await refreshLogs();
  render(response.state);
}

function describe(outcome: CommandOutcome): string {
  return outcome.reply;
}

async function command(request: CommandRequest): Promise<CommandOutcome> {
  if (state?.mode === 'ai' && (request.type === 'submit' || request.type === 'revise')) {
    showReply('AI 해석을 기다리는 중입니다 (최대 15초). 입력은 계속 고쳐 쓸 수 있습니다.', '해석 상태');
  }
  const response = await api<CommandResponse>('/api/command', request);
  await refreshLogs();
  render(response.state);
  const { outcome } = response;
  showReply(describe(outcome), outcome.kind === 'rejected' || outcome.kind === 'cancelled' || outcome.kind === 'error' ? '처리 결과' : state?.mode === 'ai' ? 'AI 해석' : '장굉');
  if (outcome.kind === 'error') {
    replyLine.hidden = true;
    errorBox.textContent = outcome.reply;
    errorBox.hidden = false;
  }
  if (outcome.kind === 'draft' && focus.panel !== 'command') setFocus({ type: 'open', panel: 'command' });
  return outcome;
}

// ---------- wiring ----------

function updateSpeechButton(): void {
  byId<HTMLButtonElement>('speech-submit').disabled = busy || !state || !speechInput.value.trim();
}

function autosize(): void {
  speechInput.style.height = 'auto';
  speechInput.style.height = `${Math.min(speechInput.scrollHeight, 120)}px`;
}

speechInput.addEventListener('input', () => { updateSpeechButton(); autosize(); void syncActivity(); });
speechInput.addEventListener('compositionstart', () => { composing = true; void syncActivity(); });
speechInput.addEventListener('compositionend', () => { composing = false; void syncActivity(); });
speechInput.addEventListener('focus', () => setFocus({ type: 'address', speaker: addressee }));
speechInput.addEventListener('blur', () => { if (!audienceMode && !speechInput.value.trim()) setFocus({ type: 'address', speaker: null }); });
byId('speech-form').addEventListener('submit', event => {
  event.preventDefault();
  if (composing || !speechInput.value.trim()) return;
  const text = speechInput.value;
  void run(async () => {
    const outcome = audienceMode || state?.mode === 'mock' ? await talk(text) : await command({ type: 'submit', text });
    // Clear only after the server accepted the input; failures keep the text.
    if (outcome.kind !== 'error' && !(outcome.kind === 'answer' && outcome.intent === 'ambiguous') && speechInput.value === text) { speechInput.value = ''; autosize(); void syncActivity(); }
  });
});

byId('hotspot-zhang-hong').addEventListener('click', () => { audienceMode = true; renderAudience(); speechInput.focus(); });
byId('tool-audience').addEventListener('click', () => setFocus({ type: 'open', panel: 'audience' }));
byId('hotspot-documents').addEventListener('click', () => setFocus({ type: 'open', panel: 'document' }));
byId('hotspot-map').addEventListener('click', () => setFocus({ type: 'open', panel: 'map' }));
byId('tool-documents').addEventListener('click', () => setFocus({ type: 'open', panel: 'document' }));
byId('tool-map').addEventListener('click', () => setFocus({ type: 'open', panel: 'map' }));
byId('tool-command').addEventListener('click', () => setFocus({ type: 'open', panel: 'command' }));
byId('tool-record').addEventListener('click', () => void run(async () => {
  logs = await api<PublicLogRecord[]>('/api/test/logs');
  setFocus({ type: 'open', panel: 'record' });
}));
byId('tool-dev').addEventListener('click', () => setFocus({ type: 'toggle-dev' }));
byId('dev-close').addEventListener('click', () => setFocus({ type: 'toggle-dev' }));
byId('panel-close').addEventListener('click', () => setFocus({ type: 'close' }));
document.addEventListener('keydown', event => {
  // Escape only closes; it never confirms or cancels a draft.
  if (event.key !== 'Escape' || event.isComposing) return;
  if (focus.panel !== 'none') setFocus({ type: 'close' });
  else if (focus.devOpen) setFocus({ type: 'toggle-dev' });
});

byId('clock-mode').addEventListener('click', () => void run(() => dispatch({ type: 'set-clock-mode', mode: state?.opening?.clockMode === 'auto' ? 'manual' : 'auto' })));
byId('advance-next').addEventListener('click', () => void run(() => dispatch({ type: 'advance-next' })));
byId('advance').addEventListener('click', () => { void run(() => dispatch({ type: 'advance-clock', milliseconds: 5000 })); });
byId('advance-30').addEventListener('click', () => { void run(() => dispatch({ type: 'advance-clock', milliseconds: 30_000 })); });
byId('pause').addEventListener('click', () => { void run(() => dispatch({ type: 'set-pause', reason: 'manual', paused: !state?.clock.pauseReasons.includes('manual') })); });
byId('reset').addEventListener('click', () => { void run(async () => {
  const response = await api<ActionResponse>('/api/test/reset', {});
  seenDocuments.clear();
  audienceMode = false; addressee = 'zhang-hong'; focus = INITIAL_FOCUS;
  state = undefined;
  render(response.state);
  activitySent = '';
  await syncActivity();
  await api('/api/test/action', { type: 'opening-ready' });
  replyLine.hidden = true;
  byId('mock-result').textContent = '초기 상태로 돌아왔습니다.';
  await refreshLogs();
}); });
byId('refresh').addEventListener('click', () => { void run(async () => { await refreshLogs(); render(await api<PlayerView>('/api/state')); }); });
probeInput.addEventListener('compositionstart', () => { composing = true; void syncActivity(); });
probeInput.addEventListener('compositionend', () => { composing = false; void syncActivity(); });
byId('probe-form').addEventListener('submit', event => {
  event.preventDefault();
  if (composing || !probeInput.value.trim()) return;
  void run(() => dispatch({ type: 'mock-probe', text: probeInput.value }));
});

const INTENT_LABELS = { command: '명령', question: '질문', hypothetical: '가정', discussion: '논의', ambiguous: '확인 질문', unsupported: '미지원' } as const;
byId('samples').replaceChildren(...MOCK_SAMPLE_SENTENCES.map(sample => h('li', {},
  h('button', { type: 'button', onclick: () => { speechInput.value = sample.text; autosize(); updateSpeechButton(); speechInput.focus(); } }, sample.text),
  h('small', {}, INTENT_LABELS[sample.intent]))));

function saveJson(filename: string, data: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
byId('snapshot').addEventListener('click', () => { void run(async () => {
  const snapshot = await api<PublicSnapshot>('/api/test/snapshot');
  byId('snapshot-preview').textContent = JSON.stringify(snapshot, null, 2);
  saveJson('m1-player-snapshot.json', snapshot);
}); });
byId('logs').addEventListener('click', () => { void run(async () => saveJson('m1-player-logs.json', await api('/api/test/logs'))); });

renderFocus();
void run(async () => {
  render(await api<PlayerView>('/api/state'));
  await syncActivity();
  await document.fonts.ready;
  await Promise.all([...document.images].map(image => image.complete ? Promise.resolve() : new Promise<void>(resolve => { image.addEventListener('load', () => resolve(), { once: true }); image.addEventListener('error', () => resolve(), { once: true }); })));
  const ready = await api<ActionResponse>('/api/test/action', { type: 'opening-ready' });
  render(ready.state);
});

// Activity requests are serialized so rapid input/visibility changes cannot reorder pauses.
let activitySent = '';
let activityQueue = Promise.resolve();
function syncActivity(): Promise<void> {
  if (!state?.opening) return Promise.resolve();
  const typing = composing || !!speechInput.value.trim() || [...panelBody.querySelectorAll<HTMLTextAreaElement>('.revise textarea')].some(a => !a.closest('[hidden]') && document.activeElement === a);
  const background = document.hidden, reading = focus.panel === 'document';
  const key = `${typing}:${background}:${reading}`;
  if (key === activitySent) return activityQueue;
  activitySent = key;
  activityQueue = activityQueue.then(async () => {
    await api('/api/test/action', { type: 'set-pause', reason: 'typing', paused: typing });
    await api('/api/test/action', { type: 'set-pause', reason: 'background', paused: background });
    await api('/api/test/action', { type: 'set-reading', reading });
  }).catch(() => { activitySent = ''; });
  return activityQueue;
}
async function observeDocument(documentId: string): Promise<void> {
  if (!state?.opening) return;
  try { await api('/api/test/action', { type: 'observe-document', documentId }); } catch { /* next explicit read may retry */ }
}
document.addEventListener('visibilitychange', () => void syncActivity());
panelBody.addEventListener('input', () => void syncActivity());
panelBody.addEventListener('focusin', () => void syncActivity());
panelBody.addEventListener('focusout', () => queueMicrotask(() => void syncActivity()));
// Polls do not rebuild editable controls or steal selection, focus, scroll, or a panel.
setInterval(async () => {
  if (!state?.opening || busy || document.hidden) return;
  try {
    const next = await api<PlayerView>('/api/state');
    if (busy || next.revision < state.revision) return;
    const selection = window.getSelection();
    const editing = panelBody.contains(document.activeElement) || (!!selection?.anchorNode && !selection.isCollapsed && panelBody.contains(selection.anchorNode));
    if (!editing && next.revision !== state.revision) { await refreshLogs(); render(next); }
    else {
      state = { ...state, clock: next.clock, opening: next.opening };
      renderBadges(next);
      renderOpeningNotice(next);
      byId('active-time').textContent = seconds(next.clock.activeMs);
      byId('held-time').textContent = seconds(next.clock.heldMs);
      byId('pause-chip').hidden = next.clock.pauseReasons.length === 0;
      byId('connection').textContent = `서버 연결됨 · 시험 시계 ${seconds(next.clock.activeMs)}`;
      byId('pause-status').textContent = next.clock.pauseReasons.length ? `보류 사유: ${next.clock.pauseReasons.map(reason => pauseLabels[reason]).join(', ')}` : `보류 사유 없음 · ${next.opening?.clockMode === 'auto' ? '자동 시계' : '수동 시험 시계'}`;
    }
  } catch { /* explicit operations retain the existing error UI */ }
}, 400);
