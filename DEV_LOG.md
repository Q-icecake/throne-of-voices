# Development Log

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
