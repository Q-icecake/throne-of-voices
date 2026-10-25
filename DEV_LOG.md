# Development Log

## 2026-10-25 — J07 / 008 M4 네 인물 대화

- 구현: 장굉·장조·주유·노숙의 서버 인물 카드/입장/전문성/우려/관계/사건 ID 기억, `POST /api/talk`, 접견·회의·연기·퇴실·명시적 문서 공유. 질문/논의는 자원·작업·외교를 바꾸지 않으며 명령은 기존 M2/M3 해석·검증·초안·확인 경로를 재사용한다. 첫 접견 중복 방지와 요청 순서 변경을 지원한다.
- 지식 경계: 자기 카드와 허용된 문서/대화/기억만 분리해 Provider에 전달한다. 회의는 현재 참석자 전원에게 허용된 자료만 사용한다. 비참석자 기억, 공유 전 문서, 미래·숨은 병력·적의 속마음 보호를 검사했다. 문서 열람은 공유가 아니다. 전체 WorldState와 관계 수치는 Provider/브라우저에 노출하지 않는다.
- 기억/관계: 사실 기록 및 요약이 실제 사건 ID를 참조한다. 질문·가정은 질문으로 기록하고, 명령 기억은 확정 ID와 금지 조건/미완료 상태를 보존한다. 새 문서 공유에만 작은 존중 변화와 이유를 남기며, 연기·퇴실로 신뢰를 떨어뜨리지 않는다. 회의는 한 답변과 짧은 반론 후 입력권을 반환한다. 자동 토론/힌트/재촉 없음.
- 화면: 기존 S2/S3와 기록 패널 사용, 4명 선택과 두세 명 회의, 문서별 보여 주기, 임무 중 접견 불가 사유, 입력 보존, 퇴실 인물 숨김. 새 SVG 3개는 장굉 원본의 색·관·소품 변형인 임시 표현이다. 최종 아트 아님. 새 의존성 없음.
- 수정 중 발견·해결: 내부 `available` 공개가 기존 경계 테스트를 깨뜨려 파생 `audienceStatus`만 공개하도록 수정했다. 1366 회의 명패 가림을 수정했고, 명령 패널 열린 상태에서 새 초안을 만들면 패널이 닫히던 회귀를 M3 브라우저 검사로 발견해 고쳤다. 접견 부재 시에도 제출한 문장을 보존한다. 브라우저 스크립트의 숨김/비동기 패널 대기 오류를 고쳐 실제 결과까지 기다리도록 했다.
- 자동 검증: `node --test tests/*.test.ts` **106/106** (기존 93개 유지, 신규 13개), `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/vite/bin/vite.js build`, `git -c safe.directory=C:/Users/q_ice/dispatch-work/throne-integrate diff --check` 통과. 기존 테스트 삭제·약화 없음.
- 설치된 Edge headless 1920×1080·1366×768: `node scripts/verify-m4.ts` **16/16**, `node scripts/screenshots.ts --out artifacts/m4/scenes` **12/12**, `node scripts/verify-visual.ts --out artifacts/m4/visual` **16/16**, `node scripts/verify-m3.ts --out artifacts/m4/m3` **10/10**, `node scripts/verify-llm-ui.ts --out artifacts/m4/llm` **12/12**, `node scripts/verify-r1.ts --out artifacts/m4/r1` **6/6**. R1 스크립트에 출력 경로 옵션만 추가했다.
- 증거: `artifacts/m4/`의 tests/typecheck/build/diff-check 로그, verification-exit-codes.json, character-browser-checks.json 및 하위 회귀 JSON. `audience-{zhang-hong,zhang-zhao,zhou-yu,lu-su}-{1920x1080,1366x768}.png`, `meeting-{1920x1080,1366x768}.png` 10장을 직접 확인했다. 문서·지도·기록 전환 후 입력, 두 발언 후 입력권 반환, 지연 자동 대화 없음, 원문 기록, 공유 전/후, 미확인 명령의 무소모, 임무 중 버튼 사유를 실제 UI로 검사했다.
- 문서: `docs/CHARACTERS.md`와 `client/src/assets/ASSETS.md`. 서버 변경 `server/{characters,world,knowledge,engine,http,mock-interpreter}.ts`, `server/llm/{types,validator}.ts`, `system.ko.txt`; 계약 `shared/contracts.ts`; 화면 `client/index.html`, `client/src/{main,style,ui/focus,ui/panels}` 및 SVG; 검사 `tests/characters.test.ts`, `scripts/{verify-m4,verify-r1}.ts`.
- 결정/가정: 기본 요청 목록은 고정 시험 설정, 접견 이동은 즉시 처리한다. 자동 요청·이동 이벤트는 M5에 넘긴다. 캐릭터의 개인 문서라도 플레이어/회의 참석자가 모르면 자동 낭독하지 않는다. UI 계산 장부는 공유 원본 문서가 아니므로 실제 보고 문서를 공유한다. 오프라인 선택은 난수를 쓰지 않는 고정 대사 풀이다.
- 미검증: **작성된 대사 풀 기준 오프라인 구현, LLM 대사는 라이브 미검증**. 실제 외부 호출 0회. 일반 한국어 이해, 대사 자연스러움, 모델 사전학습 미래정보 억제, 실제 IME, 다른 브라우저, 15분 재미는 미검증이다. 자동 시험 통과를 이 품질의 증명으로 쓰지 않는다.
- 제출: 시작 HEAD `f187315`, 브랜치 `integrate/visual-assets`에 변경 보존. `_common.md`/HANDOFF는 Git add/commit을 시도하지 말고 리드가 커밋하도록 명시하며, `.git`은 쓰기 범위 밖 원본 저장소의 worktree 메타데이터를 가리킨다. add/commit/push 미실행. 소유권 차이는 읽기 명령별 safe.directory만 사용했다. 전역 설정 변경·사용자 확인 팝업 없음. 인계 보고 `.codex-runs/m4-characters-report.md`; 다음 단계는 리드 커밋 및 M5 사건 연결이다.

## 2026-10-25 — J06b / 010 R1 지적 수정

- 범위: R1 네 건을 실패 테스트로 재현한 뒤 수정했다. 최초 신규 서버 검사 25개 중 19개 실패·6개 기존 통과, 화면 6개 중 5개 실패·1개 통과. `비공개` 오판, 원문 없는 수군 추가, 같은 절 행동 덮어쓰기/세금 요청 소실, 단독 조건 누락 및 1366 스크롤 문제 모두 재현. 별도 잘못된 의도 검사도 실패 후 수정했다. 증거: `artifacts/r1-fixes/repro-*`.
- 해석: 비공개·비밀·몰래·은밀히 우선 판정, 공개/비밀 혼재·부정은 확인 질문. 검증기가 원문을 다시 파싱해 행동 추가/누락·조건을 대조하며 수군 기본값을 제거했다. 기존 M2 배/병선/채비/손보기 문장은 명시 근거로 인정한다. 같은 절의 서로 다른 행동을 순서대로 수집하고 미인식 잔여 요청을 부분 실행 확인 문구에 명시한다. 기존 공개 기본 동작은 유지하고 표시한다.
- 경계: 비밀 작업의 보고/전언 ACL 회귀 검사, 후속 Provider 입력의 비밀 보고·대화 이력·수정 전 원문 자동 첨부 차단. 현재 직접 제출한 원문은 해석 입력이며, 플레이어가 열람할 수 있는 보고는 UI에 유지한다. 공개 응답 금지 문자열과 기존 서버 계약 필드 유지.
- UI: 단독/복합의 공개 범위·기한·제한 표시 통일, 행동 요약과 원문/상세/편집 스크롤 영역 분리. 새 초안/다른 문서가 이전 스크롤 위치를 물려받지 않게 수정. 두 해상도에서 첫 행동과 확인/수정/취소 버튼 및 실제 편집 스크롤을 검사했다. 중간 검증의 13px 본문 및 이전 패널 스크롤 회귀를 수정하고 재통과했다.
- 최종 통과: `node --test tests/*.test.ts` **93/93** (기존 66개 테스트 수정·삭제·약화 없음, 신규 27개), `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/vite/bin/vite.js build`, `git -c safe.directory=C:/Users/q_ice/dispatch-work/throne-integrate diff --check`.
- Edge headless 1920×1080·1366×768 통과: `node scripts/screenshots.ts --out artifacts/r1-fixes` **12/12**, `node scripts/verify-visual.ts --out artifacts/r1-fixes` **16/16**, `node scripts/verify-m3.ts --out artifacts/r1-fixes` **10/10**, `node scripts/verify-llm-ui.ts --out artifacts/r1-fixes` **12/12**, `node scripts/verify-r1.ts` **6/6**. 기존 브라우저 스크립트는 출력 경로 옵션과 새 상세 스크롤 대상만 변경하고 검사는 유지했다.
- 증거: `artifacts/r1-fixes/`의 tests/typecheck/build 로그, metrics/browser-checks/compound-checks/llm-browser-checks/r1-browser-checks JSON, 단독·복합·편집 스크롤·보고 PNG. 1366 단독 및 복합 편집 스크롤, 1920 복합/보고 이미지를 직접 확인했다. artifacts는 기존 Git 제외 정책 유지.
- 변경: `server/{compound,engine}.ts`, `server/llm/validator.ts`, `client/src/{main.ts,panels.css,ui/panels.ts}`, `tests/r1-fixes.test.ts`, `scripts/{verify-r1,verify-m3,verify-llm-ui}.ts`, `docs/COMMANDS.md`, 이 로그. 새 의존성/기능/M4 작업 없음.
- 미검증: 실제 외부 API 호출 0회. 일반 한국어 의미 이해·실제 LLM 품질·실제 IME·다른 브라우저·15분 재미는 미검증. 유한 패턴은 낯선 표현을 과도하게 미해결로 남길 수 있다.
- 제출 제한: 브랜치 `integrate/visual-assets`에 변경 보존. Git 메타데이터는 쓰기 범위 밖 원본 저장소의 `.git/worktrees/throne-integrate`에 있으며, `_common.md`는 add/commit을 시도하지 말고 리드가 커밋하도록 지시한다. add/commit/push 미실행. 소유권 불일치는 읽기 명령별 safe.directory만 사용; 전역 설정 변경·사용자 확인 팝업 없음. 다음 단계는 리드의 변경 검토·커밋 및 R1 재검토.

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
