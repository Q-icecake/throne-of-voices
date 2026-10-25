import './style.css';
import type { ActionResponse, PlayerView, PublicSnapshot, TestAction } from '../../shared/contracts.ts';

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing element: ${id}`);
  return result as T;
}
const input = element<HTMLTextAreaElement>('probe-input');
const errorBox = element('error');
const controls = ['advance', 'pause', 'reset', 'probe-submit', 'snapshot', 'logs'];
const pauseLabels = { manual: '수동', typing: '작성 중', provider: 'AI 대기', confirmation: '확인 대기', background: '백그라운드' };
let state: PlayerView | undefined;
let busy = false;
let composing = false;

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`로컬 서버 오류 (${response.status}). 서버 실행 상태를 확인하고 다시 시도하세요.`);
  return await response.json() as T;
}

function render(next: PlayerView): void {
  state = next;
  element('active-time').textContent = `${(next.clock.activeMs / 1000).toFixed(1)}초`;
  element('held-time').textContent = `${(next.clock.heldMs / 1000).toFixed(1)}초`;
  element('revision').textContent = String(next.revision);
  element('pause-status').textContent = next.clock.pauseReasons.length ? `보류 사유: ${next.clock.pauseReasons.map(reason => pauseLabels[reason]).join(', ')}` : '보류 사유 없음 · 버튼을 누를 때만 시간이 흐릅니다.';
  const paused = next.clock.pauseReasons.includes('manual');
  element('pause').textContent = paused ? '수동 보류 해제' : '수동 보류';
  element('pause').setAttribute('aria-pressed', String(paused));
  element('connection').textContent = '로컬 서버 연결됨 · Mock Provider · 외부 API 호출 0회';
  element('snapshot-preview').textContent = JSON.stringify(next, null, 2);
  const characters = next.characters.map(character => {
    const card = document.createElement('div');
    card.className = 'character';
    card.textContent = character.name;
    const role = document.createElement('span');
    role.textContent = character.role;
    card.append(role);
    return card;
  });
  element('characters').replaceChildren(...characters);
  const doc = next.knowledge.documents[0];
  element('document-heading').textContent = doc?.title ?? '전달된 문서 없음';
  element('document-body').textContent = doc?.claim ?? '';
  const metadata = doc ? [
    ['출처', doc.source], ['관측 / 도착', `${doc.observedAtMs / 1000}초 / ${doc.arrivedAtMs / 1000}초`],
    ['근거', doc.evidence], ['관련 지역', doc.region], ['성격', '역사 검토 전 시험용 재구성'],
  ] : [];
  element('document-metadata').replaceChildren(...metadata.flatMap(([label, value]) => {
    const dt = document.createElement('dt'); dt.textContent = label ?? '';
    const dd = document.createElement('dd'); dd.textContent = value ?? '';
    return [dt, dd];
  }));
}

async function run(work: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  errorBox.hidden = true;
  for (const id of [...controls, 'refresh']) element<HTMLButtonElement>(id).disabled = true;
  try { await work(); }
  catch (error) {
    errorBox.textContent = error instanceof Error ? error.message : '연결 실패. 입력은 보존되었습니다.';
    errorBox.hidden = false;
    element('connection').textContent = '요청 실패 · 입력을 보존했습니다. 상태를 다시 읽거나 재시도하세요.';
  } finally {
    busy = false;
    for (const id of controls) element<HTMLButtonElement>(id).disabled = !state;
    element<HTMLButtonElement>('refresh').disabled = false;
  }
}

async function dispatch(action: TestAction): Promise<void> {
  const response = await api<ActionResponse>('/api/test/action', action);
  render(response.state);
  if (response.result) element('mock-result').textContent = response.result.dialogue;
}

element('advance').addEventListener('click', () => { void run(() => dispatch({ type: 'advance-clock', milliseconds: 5000 })); });
element('pause').addEventListener('click', () => { void run(() => dispatch({ type: 'set-pause', reason: 'manual', paused: !state?.clock.pauseReasons.includes('manual') })); });
element('reset').addEventListener('click', () => { void run(async () => {
  const response = await api<ActionResponse>('/api/test/reset', {});
  render(response.state);
  input.value = '';
  element('mock-result').textContent = '초기 상태로 돌아왔습니다. 아직 Mock 요청을 보내지 않았습니다.';
}); });
element('refresh').addEventListener('click', () => { void run(async () => render(await api<PlayerView>('/api/state'))); });
input.addEventListener('compositionstart', () => { composing = true; });
input.addEventListener('compositionend', () => { composing = false; });
element('probe-form').addEventListener('submit', event => {
  event.preventDefault();
  if (composing || !input.value.trim()) return;
  void run(() => dispatch({ type: 'mock-probe', text: input.value }));
});

function saveJson(filename: string, data: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
element('snapshot').addEventListener('click', () => { void run(async () => {
  const snapshot = await api<PublicSnapshot>('/api/test/snapshot');
  element('snapshot-preview').textContent = JSON.stringify(snapshot, null, 2);
  saveJson('m0-player-snapshot.json', snapshot);
}); });
element('logs').addEventListener('click', () => { void run(async () => saveJson('m0-player-logs.json', await api('/api/test/logs'))); });
void run(async () => render(await api<PlayerView>('/api/state')));
