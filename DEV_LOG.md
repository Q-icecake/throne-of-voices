# Development Log

## 2026-10-25 — J06 / 006 M3 복합 명령

- 구현: 최대 3행동 초안, `hold-reply`/`sound-out`/기존 `naval-drill`, 원문 조건 보존, 미해결 부분의 명시적 부분 실행 확인, 최신 담당자·예약 군량·기한 재검사, 작업별 소모 ID, 중복 확인/회수 방지. 기존 계약 필드와 56개 테스트는 수정·삭제하지 않았다. 새 의존성 없음.
- 상태: 조조 요청 보류/회신·보류 기한·전언, 노숙 명 전달/출발 준비/이동/수신·회신 대기/고정 회신, 비밀 보고·전언 수신자 범위, 참전 약속 금지, 수군 교전 방침. 선행 작업 완료 후 시작과 중단 전파, 확인 후 회수 요청 기록을 추가했다. 출발·수행 후 회수는 미지원이며 이미 사용한 군량·공개·전언은 보존한다.
- 화면: 기존 S5 안에서 행동별 담당·조건 칩·비용/시간·미해결, 다중 작업·회수 요청·보고 연결을 표시한다. 복합 초안의 세부 내용만 내부 스크롤하므로 두 해상도에서 확인/수정/취소 버튼을 유지한다.
- 해석 결정: 006 예문에는 참전 약속 금지가 없으므로 확답 보류·비밀·선제공격 금지만 반영. 명시한 변형에서만 참전 약속 금지를 시험했다. 명시적인 1~999분 기한 및 바로 앞 행동 완료 후 관계만 지원한다. `scout`는 선택 범위에서 제외하고 미지원으로 기록했다. 상세: `docs/COMMANDS.md`.
- 자동 검증 통과: `node --test tests/*.test.ts` **66/66** (기존 56 + M3 10); `node node_modules/typescript/bin/tsc --noEmit`; `node node_modules/vite/bin/vite.js build`; `git -c safe.directory=C:/Users/q_ice/dispatch-work/throne-integrate diff --check`.
- 브라우저 통과: `node scripts/screenshots.ts --out artifacts/m3/scenes` **12/12**, `node scripts/verify-visual.ts --out artifacts/m3/visual` **16/16**, `node scripts/verify-m3.ts` **10/10**. 설치된 Edge headless, 1920×1080·1366×768. 실제 입력→수정→중복 확인→30초 회신 대기→60초 회신 열람에서 작업 3개, 군량 880, 준비도 35. 부분 범위 표시·취소·회수 경로와 스크롤 전후 버튼의 화면 내 위치·hit test도 검사했다.
- 증거: `artifacts/m3/compound-{draft,awaiting,reply}-{1920x1080,1366x768}.png`, `compound-checks.json`, `scenes/metrics.json`, `visual/browser-checks.json`, `tests.txt`. 대표 1366 초안·1920 회신 이미지를 직접 확인했다. artifacts는 기존 Git 제외 정책 유지.
- 수정 중 발견·해결: 단독 수군 명령의 기한 전달 누락, 명시 수행자와 기본 수행자 불일치, 선후관계가 있는 Provider 제안 순서 변경. 새 회귀 검사와 기존 M2 낯선 표현·전달자 표현 검사를 모두 유지했다.
- 미검증/제외: 실제 LLM 호출 **0회**, 한국어 전반 이해·실제 API 품질·실제 IME·다른 브라우저·15분 재미는 미검증. 인물 대화·범용 사건 스케줄러·자동 급보·기한 만료 후속 사건은 M4/M5 인계. Mock/ScriptedProvider의 성공을 일반 언어 이해 성능으로 보고하지 않는다.
- Git: 소유권 불일치는 읽기 명령에 한정한 `-c safe.directory=...`로 처리했으며 전역 설정은 변경하지 않았다. `_common.md`의 명시적 add/commit 금지 및 쓰기 범위 밖 worktree 메타데이터 제약을 따라 **add/commit/push 미실행**. 변경은 이 worktree에 남겨 리드가 제출·커밋한다. 원본·main·다른 브랜치·원격 변경 없음.
- 변경 파일: `shared/contracts.ts`, `server/{compound,mock-interpreter,engine,world,rules,knowledge,http}.ts`, `server/llm/{actions.json,validator.ts,pipeline.ts,system.ko.txt}`, `client/src/{main.ts,panels.css,ui/panels.ts}`, `tests/compound.test.ts`, `scripts/verify-m3.ts`, `docs/COMMANDS.md`, 이 로그.

## 2026-10-25 — J05 / 005 M2 Provider

- 완료: 교체 가능한 `InterpretationProvider`, 한국어 프롬프트·행동 레지스트리·JSON Schema, 서버 검증/해석 파이프라인, Gemini fetch 어댑터, ScriptedProvider 오프라인 시험, 30문장 라이브 평가 초안. 새 의존성 없음.
- 기본 동기 Mock 및 M0 probe는 보존하고, 세 번째 GameEngine 생성자 인수의 Provider가 있을 때만 command를 비동기로 처리한다. HTTP는 두 경로를 await한다. 기존 테스트 32개를 수정·삭제하지 않았다.
- 규칙: 구조·길이·허용 행동/대상/수행자/지식 ID 검사, 원문 부정·조건 대조, 최대 3행동. M2에서 복합 행동·미구현 조건/기한은 확인 질문으로 반환하며 M3 범위를 구현하지 않는다. 요청 버전으로 수정·취소·확정·새 입력·리셋 뒤 도착한 응답을 무시한다.
- Gemini: 키는 서버 환경변수만 읽고 모델 ID는 설정 필수. 타임아웃 기본 15000ms, 재시도 기본 0, 일/세션 한도 기본 0(차단). 실패/재시도도 한도에 포함. UTC 일일 예약은 `artifacts/llm-usage.json`에 잠금/원자 교체로 보존한다. 비정상 종료 잠금은 운영자 복구 전 차단한다. 과금/모델/Mock 자동 전환 없음.
- 화면: Mock/AI와 연결 상태, 한국어 오류·타이핑/재시도 안내, 입력·수정문 보존. 긴 AI 답변은 내부 스크롤하고 패널은 답변 영역을 피한다. 화면 시험에서 발견한 되묻기 문제(완료 대사가 확인 질문을 가림), 오류 대사 중복/패널 겹침, 수정 버튼 라벨 복원을 고쳤다. 부정 검사의 `초안` 오탐 및 문장부호 뒤 조건 누락도 회귀 시험으로 고정했다.
- 통과: `node node_modules/typescript/bin/tsc --noEmit`; `node --test tests/*.test.ts` **56/56**; `node node_modules/vite/bin/vite.js build`; `git -c safe.directory=C:/Users/q_ice/dispatch-work/throne-integrate diff --check`.
- 통과: `node scripts/screenshots.ts --out artifacts/m2` **12/12**; `node scripts/verify-visual.ts --out artifacts/m2` **16/16**; `node scripts/verify-llm-ui.ts` **12/12**. 설치된 Edge headless, 1920×1080/1366×768. 최초 Mock HUD 4.5%/8.9%. 대표 Mock·AI 오류/타임아웃/긴 답변 캡처 직접 확인. `artifacts/m2/`에 PNG 22장, metrics/browser-checks/llm-browser-checks JSON, tests/build 로그.
- 무키 확인: `node scripts/eval-llm.ts` → 키 없음으로 즉시 종료, 실제 LLM 외부 호출 **0회**. 어댑터 전송·제한·타임아웃은 합성 키/가짜 fetch로만 시험. 키 값·원문 헤더를 로그/응답/브라우저로 내보내지 않는다.
- 차단/미검증: API 키 없음. Gemini 모델 접근·계정 무료 한도·한국어 품질·실제 지연 모두 **코드 작성됨, 라이브 미검증**. 부정/조건 검사는 보수적 패턴이며 한국어 전반의 의미 정확도를 보장하지 않는다. 실제 IME·다른 브라우저·장시간 재미는 미검증.
- 라이브 후속 절차: 계정 무료/유료 여부·모델 접근과 사용자 승인을 확인한 환경에서 서버 키, `GEMINI_MODEL_ID`, `LLM_TIMEOUT_MS`, `LLM_RETRIES`, `LLM_DAILY_CALL_LIMIT`, `LLM_SESSION_CALL_LIMIT` 설정 후 `node scripts/eval-llm.ts --live`. 결과 `artifacts/m2/live-eval.json`; 한국어 품질/출처는 별도 수동 검토. 상세 설정/한도 복구는 `server/llm/README.md`.
- 인계: 시작 HEAD `b73edec`, 브랜치 `integrate/visual-assets`, 원본·main·remote 변경 없음. Git 소유권 차이는 명령별 safe.directory만 사용. `_common.md`의 add/commit 금지와 쓰기 범위 밖 worktree Git 메타데이터 때문에 **커밋 미실행**, 작업 트리에 변경을 남겼다. 리드가 검토·커밋해야 한다. 구현: `server/llm/*`, `server/{engine,http,index}.ts`, `shared/contracts.ts`, `client/index.html`, `client/src/{main.ts,style.css,ui/panels.ts}`, `scripts/{dev,eval-llm,verify-llm-ui}.ts`, `tests/{llm,llm-http,gemini}.test.ts`, `tests/fixtures/*`, 이 로그.

## 2026-10-25 — J04 / 004 M1 보완

- 범위: 독립 리뷰 1~5번. 손권과 좌석의 카메라를 공유하고, 지도 패널을 1000:300 콘텐츠 높이에 맞췄다. 1366 명령 카드의 간격을 줄여 확인·수정·취소와 보존 안내를 함께 표시한다. 장굉의 왼쪽 전경 위치를 유지하며 CSS 대비·그림자와 이름표 간격만 조정했다.
- 검증 강화: 실제 패널 사각형을 제외한 노출 영역에서 장면 버튼을 검사한다. HUD/패널/합집합 화면 점유율을 분리 기록한다. 공개 문서 ID·본문·작업 ID·완료 시각을 비교하고 두 번째 작업의 최신 완료 보고까지 확인한다.
- 첫 실행에서 이전 전경 이동이 문서 버튼을 화면 밖으로 밀어내는 문제와 1366 지도 설명의 미세 스크롤을 발견했다. 전경 확대를 1.03으로 제한하고 지도 설명 기본 여백을 제거한 뒤 재검증했다. 기존 테스트는 삭제·완화하지 않았다.
- 실제 통과: `node node_modules/typescript/bin/tsc --noEmit`; `node --test tests/*.test.ts` 32/32; `node node_modules/vite/bin/vite.js build`; `node scripts/screenshots.ts --out artifacts/m1-fixes` 12/12; `node scripts/verify-visual.ts --out artifacts/m1-fixes` 16개 검사 묶음; `git -c safe.directory=C:/Users/q_ice/dispatch-work/throne-integrate diff --check`.
- Edge 155.0.4283.62 headless, 1920×1080·1366×768. 입력→확인 2회→60초 진행→보고에서 작업 1건·군량 -100·준비도 +15. 수군 표식은 report-0002/task-0001 이후 report-0004/task-0002를 연다. 전체 패널과 접견에서 좌석 기준 오차 <0.01px. 실패 이미지 대체 표시도 통과.
- 스크린샷 12장과 실패 자산/보고 캡처 4장, `metrics.json`, `browser-checks.json`, `build.log`: `artifacts/m1-fixes/`. 새 12장 모두 시각 확인. 이전 `artifacts/m1-integrated/`와 비교해 1920 지도 하단 빈 공간이 제거되고 1366 명령 보존 안내가 노출됨을 확인했다.
- 측정: S0 상시 HUD 4.2%/8.4%; S4 패널 27.6%/54.6%, HUD 포함 화면 가림 31.9%/62.8% (1920/1366 순). 합집합 면적은 뷰포트 밖과 중복을 제외하며 투명도·그림자는 가중하지 않는다. S1/S5의 장굉·두 소품을 모두 검사하며, 완전히 가려진 1366 S4 장굉만 제외한다.
- 미검증: 실제 IME, 다른 브라우저, 장시간 성능·재미. 1366 문서의 긴 본문/메타데이터는 기존 내부 스크롤을 유지한다. 서버·계약·의존성·SVG 원본·인물 그림체 변경 없음.
- 인계: 시작 HEAD f4ae213, integrate/visual-assets. Git 소유권 차이는 명령별 safe.directory로 처리했으며 전역 설정은 변경하지 않았다. Git 메타데이터가 쓰기 허용 범위 밖인 원본 저장소에 있어 커밋은 차단됨. `_common.md`에 따라 add/commit/push를 시도하지 않았다. 리드가 아래 구현 5개 파일과 이 로그를 검토·커밋해야 한다. 산출물은 기존 .gitignore상 제외된다.
- 구현 파일: `client/src/style.css`, `client/src/panels.css`, `client/src/ui/panels.ts`, `scripts/screenshots.ts`, `scripts/verify-visual.ts`. 상세 인계 보고: `.codex-runs/m1-fixes-report.md`.
