import './start-screen.css';
import background from './assets/court-background.svg';
import type { ConnectionTestResult, LlmStatus } from '../../shared/contracts.ts';

export const TEST_LABELS: Record<ConnectionTestResult, string> = {
  untested: '시험 전', ok: '정상', auth: '키 오류', model: '모델 없음', rate_limited: '한도 초과',
  timeout: '시간 초과', schema: '응답 형식 오류', server: '서버 오류', budget: '한도 초과 · 로컬 호출 상한', stale: '설정 변경 · 이전 시험 무시',
};

/** Court initialization (including its opening clock) begins only after explicit start. */
export async function enterStartScreen(): Promise<void> {
  const stage = document.getElementById('stage')!;
  if (new URLSearchParams(location.search).get('start') === 'court') { stage.hidden = false; return; }
  const root = document.createElement('main'); root.id = 'start-screen'; root.className = 'start-screen';
  root.style.setProperty('--start-background', `url("${background}")`);
  root.innerHTML = `
    <section class="start-card start-home" data-start-page="home" aria-labelledby="start-title">
      <p class="start-eyebrow">건안 13년 · 강동</p>
      <h1 id="start-title" tabindex="-1">Throne of Voices <span>· 적벽 전야</span></h1>
      <p class="start-intro">사람을 만나고, 기록을 읽고, 당신의 말로 강동의 다음 결정을 내리세요.</p>
      <div class="start-home-actions"><button id="start-mock" class="start-primary">Mock으로 시작</button><button id="open-settings">AI 연결 설정</button><button id="open-guide">플레이 안내</button></div>
      <p class="start-status" id="home-ai-status" role="status">AI 미연결 · Mock</p>
      <p class="start-footnote">역사·대사·수치는 시험용 재구성입니다. Mock은 키와 네트워크가 필요 없습니다.</p>
    </section>
    <section class="start-card" data-start-page="settings" aria-labelledby="settings-title" hidden>
      <header class="start-head"><div><p class="start-eyebrow">선택 사항 · Gemini</p><h1 id="settings-title" tabindex="-1">AI 연결 설정</h1></div><button data-home>첫 화면</button></header>
      <div class="start-settings-grid">
        <div class="start-instructions">
          <h2>① 키를 준비하세요</h2>
          <p>Google AI Studio에서 API 키를 만드세요. 주소: <span class="start-address">https://aistudio.google.com/apikey</span><br>주소는 안내용 텍스트이며 앱이 이 주소를 요청하지 않습니다.</p>
          <p><strong>결제를 연결하지 않은 프로젝트를 권장합니다.</strong> 결제 연결 시 무료 한도 내 사용도 과금될 수 있습니다. 앱 호출 상한은 계정의 과금 제한이 아닙니다.</p>
          <p>무료 티어 입력은 제품 개선에 쓰일 수 있습니다. <strong>개인정보·다른 사람의 정보를 입력하지 마세요.</strong></p>
          <p>모델 ID는 본인의 콘솔에서 확인한 값을 입력하세요. 앱은 사용 가능한 모델이나 무료 제공을 보장하지 않습니다.</p>
          <p>키는 로컬 서버 메모리에만 보관합니다. 서버를 끄면 사라지며 켤 때마다 다시 입력합니다. 브라우저·디스크에 저장하지 않습니다.</p>
        </div>
        <div>
          <h2>② 연결 정보</h2>
          <form id="ai-settings-form" autocomplete="off">
            <label for="ai-model">모델 ID</label><input id="ai-model" name="model" maxlength="200" required autocomplete="off" spellcheck="false" placeholder="콘솔에서 확인한 모델 ID">
            <label for="ai-key">API 키</label><input id="ai-key" name="key" type="password" maxlength="512" autocomplete="off" spellcheck="false" placeholder="새 키 입력 (저장된 키는 표시하지 않음)">
            <p id="key-source" class="start-field-note">키 미설정</p>
            <label for="ai-limit">호출 상한 (UTC 일일 / 서버 세션 각각)</label><input id="ai-limit" name="limit" type="number" min="0" max="10000" step="1" value="30" required>
            <p class="start-field-note">기본 각 30회 · 0이면 차단 · 시험·실패도 차감</p>
            <button id="save-settings" type="submit">설정 적용</button>
          </form>
          <h2>③ 연결 시험</h2>
          <p class="start-field-note">누를 때만 고정 문장으로 1회 요청 · 출력 최대 8토큰</p>
          <button id="test-connection">연결 시험</button><p id="test-result" role="status" aria-live="polite">시험 전</p>
        </div>
      </div>
      <footer class="start-settings-footer"><div><p id="untested-note">시험하지 않았습니다. 설정만으로 연결 성공을 보장하지 않습니다. 확인 후 AI로 시작할 수 있습니다.</p><div class="start-actions"><button id="start-ai" class="start-primary" disabled>AI로 시작</button><button id="settings-mock">Mock으로 시작</button><button id="clear-key">키 지우기</button></div></div></footer>
    </section>
    <section class="start-card start-guide" data-start-page="guide" aria-labelledby="guide-title" hidden>
      <header class="start-head"><div><p class="start-eyebrow">손권의 자리에서</p><h1 id="guide-title" tabindex="-1">플레이 안내</h1></div><button data-home>첫 화면</button></header>
      <div class="start-guide-grid"><div><h2>사람과 기록으로 결정하세요</h2><p>아래 입력란에서 장굉에게 질문하거나 지시하세요. Enter는 줄바꿈, ‘전하기’는 제출입니다.</p><p>오른쪽 ‘접견’에서 인물을 부르고 2~3명과 회의하세요. ‘문서’에서 보고를 읽고, ‘지도’에서 상황을 살펴보세요. 문서는 읽기만 하면 공유되지 않습니다. 접견 중 ‘보여 주기’로 전달하세요.</p><p>명령은 먼저 초안이 됩니다. 담당·대상·비밀·금지 조건·기한을 확인한 뒤 실행하세요. 수정·취소할 수 있으며, 명령 전달과 완료 보고는 다릅니다.</p><h2>시간과 시험 도구</h2><p>활성 25초부터 급보가 도착합니다. 입력·AI 대기·미확인 초안·백그라운드에서는 시간이 멈춥니다.</p><p>오른쪽 아래 ‘시험 도구’에서 수동 보류, +5초 / +30초, ‘다음 사건’, 리셋을 사용할 수 있습니다. 다음 사건은 가장 가까운 경계까지만 진행합니다.</p><p><strong>15분이 지나도 끝나지 않고, 아무 결정도 하지 않아도 자동 패배하지 않습니다.</strong> 서버 재시작 시 플레이는 저장되지 않습니다.</p></div>
      <div><h2>써 볼 문장</h2><ul class="start-examples"><li>항복하면 어떻게 돼?</li><li>주유에게 수군을 정비하라고 전해. 먼저 공격하지는 마.</li><li>공격하지 말고 수군만 정비해</li><li>노숙은 유비에게 비밀리에 연락해. 참전은 약속하지 말고.</li><li>조조에게는 당장 확답하지 말고 5분 이내 시간을 벌어.</li><li>조조에게 &quot;논의 후 답하겠다&quot;라고 회신해.</li></ul><p>Mock은 정해진 표현을 처리하는 시험 모드입니다. 자유 문장 이해를 보장하지 않습니다. 정찰·징세 등 미지원 행동은 실행되지 않습니다. 회의 호출은 접견 화면을 사용하세요.</p><button id="guide-mock" class="start-primary">Mock으로 시작</button></div></div>
    </section><p id="start-error" class="start-error" role="alert" hidden></p>`;
  document.body.append(root);
  const el = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  let status: LlmStatus = { keyConfigured: false, keySource: 'none', model: '', limit: 30, testResult: 'untested', mode: 'mock' };
  let dirty = false, busy = false;
  const model = el<HTMLInputElement>('ai-model'), key = el<HTMLInputElement>('ai-key'), limit = el<HTMLInputElement>('ai-limit');
  async function request<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(`/api/llm/${path}`, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(path === 'test' ? 18000 : 5000) });
    if (!response.ok) throw new Error('로컬 설정 요청에 실패했습니다. 입력 형식과 서버 실행 상태를 확인하세요.');
    return await response.json() as T;
  }
  function render() {
    el('home-ai-status').textContent = !status.keyConfigured ? 'AI 미연결 · Mock' : status.testResult === 'ok' ? 'AI 연결 확인됨' : status.testResult === 'untested' ? 'AI 설정됨 · 시험 전' : `AI 연결 오류 · ${TEST_LABELS[status.testResult]}`;
    el('key-source').textContent = status.keySource === 'env' ? '환경변수 키 사용 중' : status.keySource === 'screen' ? '화면 입력 키 사용 중 · 서버 메모리' : '키 미설정';
    el('test-result').textContent = TEST_LABELS[status.testResult];
    el('untested-note').textContent = status.testResult === 'ok' ? '연결 시험이 정상입니다. 이후 호출에도 한도가 적용됩니다.' : status.testResult === 'untested' ? '시험하지 않았습니다. 설정만으로 연결 성공을 보장하지 않습니다. 확인 후 AI로 시작할 수 있습니다.' : `최근 시험: ${TEST_LABELS[status.testResult]}. 설정을 확인한 후 진행하세요.`;
    for (const control of root.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input')) control.disabled = busy;
    el<HTMLButtonElement>('start-ai').disabled = busy || !(model.value.trim() && (key.value || status.keyConfigured));
  }
  function show(page: string) {
    for (const section of root.querySelectorAll<HTMLElement>('[data-start-page]')) section.hidden = section.dataset.startPage !== page;
    el('start-error').hidden = true;
    render();
    root.querySelector<HTMLElement>(`[data-start-page="${page}"] h1`)!.focus();
  }
  async function run(work: () => Promise<void>) {
    if (busy) return;
    const focused = document.activeElement as HTMLElement | null;
    busy = true; render(); el('start-error').hidden = true;
    try { await work(); } catch { el('start-error').textContent = '로컬 요청에 실패했습니다. 입력 형식과 서버 실행 상태를 확인하고 다시 시도하세요.'; el('start-error').hidden = false; }
    finally {
      busy = false;
      if (root.isConnected) {
        render();
        if (document.activeElement === document.body && focused?.isConnected && focused.getClientRects().length) focused.focus();
      }
    }
  }
  async function save() {
    if (!el<HTMLFormElement>('ai-settings-form').reportValidity()) throw new Error('INVALID_SETTINGS');
    const payload = { model: model.value.trim(), key: key.value, limit: Number(limit.value) };
    // fetch serializes synchronously; immediately remove the credential from the DOM and payload.
    const pending = request<LlmStatus>('settings', payload); key.value = ''; payload.key = '';
    status = await pending; dirty = false;
  }
  for (const input of [model, key, limit]) input.addEventListener('input', () => { dirty = true; status.testResult = 'untested'; render(); });
  el('open-settings').onclick = () => show('settings'); el('open-guide').onclick = () => show('guide');
  root.querySelectorAll<HTMLButtonElement>('[data-home]').forEach(button => { button.onclick = () => { key.value = ''; show('home'); }; });
  const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) { key.value = ''; show('home'); } };
  document.addEventListener('keydown', escape);
  el<HTMLFormElement>('ai-settings-form').onsubmit = event => { event.preventDefault(); void run(save); };
  el('test-connection').onclick = () => void run(async () => { if (dirty) await save(); el('test-result').textContent = '연결 시험 중…'; const result = await request<{ status: LlmStatus }>('test', {}); status = result.status; });
  el('clear-key').onclick = () => void run(async () => { key.value = ''; status = await request<LlmStatus>('clear', {}); dirty = false; model.value = status.model; limit.value = String(status.limit); });
  return await new Promise<void>(resolve => {
    const start = (mode: 'mock' | 'ai') => void run(async () => {
      if (mode === 'ai' && dirty) await save();
      await request('start', { mode }); key.value = ''; document.removeEventListener('keydown', escape); root.remove(); stage.hidden = false; resolve();
    });
    for (const id of ['start-mock', 'settings-mock', 'guide-mock']) el(id).onclick = () => start('mock');
    el('start-ai').onclick = () => start('ai');
    void run(async () => { status = await request<LlmStatus>('status'); model.value = status.model; limit.value = String(status.limit); });
    el('start-title').focus();
  });
}
