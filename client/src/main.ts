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

const stage = byId('stage');
const speechInput = byId<HTMLTextAreaElement>('speech-input');
const probeInput = byId<HTMLTextAreaElement>('probe-input');
const errorBox = byId('error');
const panel = byId('panel');
const panelBody = byId('panel-body');
const devDrawer = byId('dev-drawer');
const replyLine = byId('reply');
const devControls = ['advance', 'advance-30', 'pause', 'reset', 'probe-submit', 'snapshot', 'logs'];
const pauseLabels = { manual: '수동', typing: '작성 중', provider: 'AI 대기', confirmation: '확인 대기', background: '백그라운드' };
const PANEL_TITLES = { document: '문서', map: '강동 상황도', record: '처리 기록', command: '명령' } as const;

let state: PlayerView | undefined;
let focus: FocusState = INITIAL_FOCUS;
let logs: PublicLogRecord[] = [];
let busy = false;
let composing = false;
const seenDocuments = new Set<string>();

mountSlot(byId('layer-back'), 'court.background');
mountSlot(byId('layer-mid'), 'court.figures');
mountSlot(byId('layer-front'), 'court.foreground');

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`로컬 서버 오류 (${response.status}). 서버 실행 상태를 확인하고 다시 시도하세요. 입력은 보존되었습니다.`);
  return await response.json() as T;
}

// ---------- focus (UI only, never calls the server) ----------

function setFocus(event: FocusEvent): void {
  focus = reduceFocus(focus, event);
  renderFocus();
}

function renderFocus(): void {
  stage.dataset.scene = sceneId(focus);
  stage.dataset.panel = focus.panel;
  for (const [id, name] of [['tool-documents', 'document'], ['tool-map', 'map'], ['tool-command', 'command'], ['tool-record', 'record']] as const) {
    byId(id).setAttribute('aria-pressed', String(focus.panel === name));
  }
  byId('tool-dev').setAttribute('aria-pressed', String(focus.devOpen));
  devDrawer.hidden = !focus.devOpen;
  renderPanel();
}

const panelActions = (): PanelActions => ({
  busy,
  openDocument: id => setFocus({ type: 'open', panel: 'document', documentId: id }),
  confirm: draft => void run(async () => { await command({ type: 'confirm', draftId: draft.id, version: draft.version }); }),
  cancel: draft => void run(async () => { await command({ type: 'cancel', draftId: draft.id, version: draft.version }); }),
  revise: (draft: CommandDraftView, text: string) => void run(async () => { await command({ type: 'revise', draftId: draft.id, version: draft.version, text }); }),
});

function renderPanel(): void {
  if (focus.panel === 'none' || !state) { panel.hidden = true; return; }
  panel.hidden = false;
  panel.dataset.kind = focus.panel;
  byId('panel-title').textContent = PANEL_TITLES[focus.panel];
  const scroll = panelBody.scrollTop;
  const sameView = panelBody.dataset.view === `${focus.panel}:${focus.documentId ?? ''}`;
  let content: HTMLElement;
  switch (focus.panel) {
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
    if (next) { next.value = area.value; next.closest<HTMLElement>('.revise')!.hidden = false; }
  }
  panelBody.dataset.view = `${focus.panel}:${focus.documentId ?? ''}`;
  if (sameView) panelBody.scrollTop = scroll;
  if (focus.panel === 'document') {
    const docs = documentList(state);
    seenDocuments.add((docs.find(doc => doc.id === focus.documentId) ?? docs[0]!).id);
    renderBadges();
  }
}

// ---------- world state rendering ----------

function renderBadges(): void {
  if (!state) return;
  const unread = state.knowledge.documents.filter(doc => !seenDocuments.has(doc.id)).length;
  const docBadge = byId('badge-documents');
  docBadge.hidden = unread === 0;
  docBadge.textContent = String(unread);
  const pending = state.drafts.filter(draft => draft.status === 'awaiting-confirmation').length;
  const commandBadge = byId('badge-command');
  commandBadge.hidden = pending === 0;
  commandBadge.textContent = String(pending);
}

function render(next: PlayerView): void {
  if (!state) for (const doc of next.knowledge.documents) seenDocuments.add(doc.id);
  state = next;
  byId('active-time').textContent = seconds(next.clock.activeMs);
  byId('held-time').textContent = seconds(next.clock.heldMs);
  byId('revision').textContent = String(next.revision);
  byId('pause-status').textContent = next.clock.pauseReasons.length
    ? `보류 사유: ${next.clock.pauseReasons.map(reason => pauseLabels[reason]).join(', ')}`
    : '보류 사유 없음 · 시계 버튼을 누를 때만 시간이 흐릅니다.';
  const paused = next.clock.pauseReasons.includes('manual');
  byId('pause').textContent = paused ? '수동 보류 해제' : '수동 보류';
  byId('pause').setAttribute('aria-pressed', String(paused));
  byId('pause-chip').hidden = next.clock.pauseReasons.length === 0;
  byId('connection').textContent = `서버 연결됨 · 시험 시계 ${seconds(next.clock.activeMs)}`;
  byId('snapshot-preview').textContent = JSON.stringify(next, null, 2);
  renderBadges();
  renderPanel();
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
  const response = await api<CommandResponse>('/api/command', request);
  await refreshLogs();
  render(response.state);
  const { outcome } = response;
  showReply(describe(outcome), outcome.kind === 'rejected' || outcome.kind === 'cancelled' ? '처리 결과' : '장굉');
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

speechInput.addEventListener('input', () => { updateSpeechButton(); autosize(); });
speechInput.addEventListener('compositionstart', () => { composing = true; });
speechInput.addEventListener('compositionend', () => { composing = false; });
speechInput.addEventListener('focus', () => setFocus({ type: 'address', speaker: 'zhang-hong' }));
speechInput.addEventListener('blur', () => { if (!speechInput.value.trim()) setFocus({ type: 'address', speaker: null }); });
byId('speech-form').addEventListener('submit', event => {
  event.preventDefault();
  if (composing || !speechInput.value.trim()) return;
  const text = speechInput.value;
  void run(async () => {
    await command({ type: 'submit', text });
    // Clear only after the server accepted the input; failures keep the text.
    if (speechInput.value === text) { speechInput.value = ''; autosize(); }
  });
});

byId('hotspot-zhang-hong').addEventListener('click', () => { speechInput.focus(); });
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

byId('advance').addEventListener('click', () => { void run(() => dispatch({ type: 'advance-clock', milliseconds: 5000 })); });
byId('advance-30').addEventListener('click', () => { void run(() => dispatch({ type: 'advance-clock', milliseconds: 30_000 })); });
byId('pause').addEventListener('click', () => { void run(() => dispatch({ type: 'set-pause', reason: 'manual', paused: !state?.clock.pauseReasons.includes('manual') })); });
byId('reset').addEventListener('click', () => { void run(async () => {
  const response = await api<ActionResponse>('/api/test/reset', {});
  seenDocuments.clear();
  state = undefined;
  render(response.state);
  replyLine.hidden = true;
  byId('mock-result').textContent = '초기 상태로 돌아왔습니다.';
  await refreshLogs();
}); });
byId('refresh').addEventListener('click', () => { void run(async () => { await refreshLogs(); render(await api<PlayerView>('/api/state')); }); });
probeInput.addEventListener('compositionstart', () => { composing = true; });
probeInput.addEventListener('compositionend', () => { composing = false; });
byId('probe-form').addEventListener('submit', event => {
  event.preventDefault();
  if (composing || !probeInput.value.trim()) return;
  void run(() => dispatch({ type: 'mock-probe', text: probeInput.value }));
});

const INTENT_LABELS = { command: '명령', question: '질문', hypothetical: '가정', unsupported: '미지원' } as const;
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
void run(async () => render(await api<PlayerView>('/api/state')));
