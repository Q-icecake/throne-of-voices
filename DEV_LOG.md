# Development Log

## 2026-10-25 — 017 R3 최종 리뷰 수정

- R3-01: Provider 질문/논의 및 오프라인 대사 풀의 행동·완료·진행 서술을 어간/활용으로 검사하고, 현재 대화방에 보이는 보고의 작업 ID + 실제 엔진 진행 사건으로 만든 고정 사실 문장과 정확히 대조한다. 근거 없는 답변은 인물별 고정 문구로 대체하며 `dialogue-filtered` 로그에는 거절 원문을 남기지 않는다. 사용자 전언/대화/모델 근거 ID는 증명이 아니다. 기록 인용은 원문과 별도로 대조한다. 일반 한국어 의미 판별은 불가능하며 라이브 AI의 보조 장치라는 한계를 `docs/KNOWN_LIMITS.md`에 명시했다.
- R3-02: `select-document`를 도구 버튼의 기존 토글과 분리했다. 닫기→재열기→같은 문서 반복 선택은 열린 상태와 선택을 유지한다. 실제 제목 `형주 방면 전령의 급보`를 사용했다(리뷰의 `형주 급보`는 약칭). R3-03: 추적 문서 3개의 개인 절대 경로를 루트 표기로 바꾸고, 스크린샷 스크립트의 출력도 상대 경로로 변경했다. 추적 파일 110개 경로 검사에서 잔여 0개.
- 신규 Node 시험 63개: 허위 사실 24문장 × 질문/논의 × talk/command, 정상·조건·가정 31문장 × talk/command, 실제 완료 근거·잘못된 인물/인접 주장·비밀 경계·4인 대사 풀·문서 선택·개인 경로. 기존 164개 시험 수정·삭제·약화 없음. 최초 실패 증거 `artifacts/r3-fixes/unit-before.log` 보존(초기 추가 근거 시험의 빈 dialogue fixture 오류는 수정). 기존 무지 응답을 과도하게 차단한 중간 실패도 구현에서 고쳤다.
- Edge 1920×1080·1366×768: `node scripts/verify-r3.ts --baseline`은 `3d15bde`의 UI 두 모듈을 읽기 전용으로 불러와 동일 문서 재선택 실패 2/2 재현, 정상 실행은 문서/허위 답변 검사 4/4 통과. 초회 하네스의 급보 생성 시각·약칭 선택자 오류는 실제 25초 사건과 정식 제목으로 바로잡았다. `node scripts/screenshots.ts S1,document-urgent --out artifacts/r3-fixes/scenes` 4/4 통과. 변경 화면과 전후 증거는 `artifacts/r3-fixes/`; 기존 전체 검증의 스크린샷은 기존 `artifacts/m6/` 출력 유지. 문서/대사 화면을 직접 확인했다.
- 최종 `node scripts/verify-all.ts` **17/17 통과, 종료 0**. 전체 시험 **227/227**(기존 164 + 신규 63), 타입 검사·Vite 빌드·콘텐츠 변조 18건·JSON 플레이 12/12·가짜 활성 시계 soak 12/12·가이드 10/10·장면 42/42·visual 16/16·R1 6/6·M3 10/10·M4 20/20·LLM UI 12/12·실제 자동 시계 M5 18/18·R3 4/4·비교 68쌍·실제 실행기 검사 통과. 결과 `artifacts/r3-fixes/verification.json`, `verify-all.log`. 새 의존성·외부 API 호출 없음.
- 중간 통합 실패 16/17은 `verify-all-failed.log`, `verification-failed.json`에 보존했다. 기존 visual의 `scrollIntoViewIfNeeded`가 상태 갱신으로 분리된 노드를 잡는 오류였다. 현재 노드를 단일 DOM 작업에서 중앙으로 스크롤하고 기존 전체 가시성 단언을 유지하도록 동기화한 뒤 독립 visual 16/16 및 전체 17/17을 재실행해 통과했다. 경계에 붙이는 중간 스크롤 방식의 가시성 실패도 보존하고 중앙 정렬로 고쳤다.
- 제출: 사용자 요청에 따라 변경 15개 파일만 `git add`를 시도했으나 Git worktree 메타데이터의 `index.lock: Permission denied`, 종료 128로 실패했다(`artifacts/r3-fixes/git-submission.log`). 커밋은 생성되지 않았으며 HEAD `3d15bde`, 브랜치 `integrate/visual-assets`에 변경을 남겼다. 권한 팝업·전역 설정 변경·우회·push 없음. 쓰기 권한 있는 환경에서 검토 후 `Fix R3 dialogue grounding, document selection, and path hygiene`로 커밋할 수 있다. 실제 모델 한국어 품질·실제 IME·다른 브라우저·사람의 재미는 미검증이다.

## 2026-10-25 — J09 / 015 M6 품질·검증·가이드

- R2b를 신규 실패 시험 2건으로 먼저 재현(`artifacts/m6/r2b-before.txt`)한 뒤 수정했다. 미요청·미접견 인물의 연기는 요청을 만들지 않고 안내만 한다. 현재 접견의 연기는 퇴실·재접견 대기로 기존 M4 동작을 유지한다. T05/T07 큐 추가는 멱등이며 두 인물·반복 연기·요청 전 거절·배지·T12 요약의 유일성을 검사한다. EOF 빈 줄도 제거했다.
- JSON 자동 플레이를 12시나리오·77단계·42금지 항목과 기대 사건/문서·PB01~06에 대응시켰다. 새/누락 시나리오·단계·기대 사건·금지/기대 문구 변조는 실패한다. 어댑터는 UI 조작을 명시적으로 수행하며 원문 명령/대화는 실제 엔진에 전달한다. S06의 “회답하면 T12 전체 취소” 설명은 남은 접견을 무시한 오류여서 조조 사안만 제외하도록 고쳤다. 이전 156개 시험은 수정·삭제·완화하지 않았다.
- 안정성: 동일 엔진 12회 리셋·4경로 × 960초 가짜 활성 시계(총 11,520초), 650초 이후 문서/큐/알림 안정·감사 로그의 입력당 1건 증가·15분 뒤 접견을 검증했다. 준비/모드 전환 원점·지연 command/talk와 새 Provider 보류·HTTP 재시작/리셋 회귀를 추가했다. 실제 장기 벽시간 메모리/CPU 부하 시험은 아니다.
- 전체 실행 `node scripts/verify-all.ts` **16/16 명령 통과**(2026-10-25 05:35Z). 전체 테스트 **164/164**, 타입 검사·Vite 빌드·콘텐츠 변조 18건·플레이 12/12·soak 12/12·가이드 실제 Mock 예문 10/10 통과. `run.ps1 test/typecheck/build`도 실제 실행 통과했다. 키를 검증 자식 환경에서 제거하고 Mock 고정, 실제 외부 LLM 호출 0회·eval-llm 미실행·새 의존성 없음.
- Edge headless 두 해상도(1920×1080·1366×768): 21장면 **42/42**, 기존 visual **16/16**, R1 **6/6**, M3 **10/10**, M4 **20/20**, 오프라인 AI UI **12/12**, 실제 자동 시계 M5 **18/18**. 페이지 스크롤/접근 불가 버튼 0, 본문 최소 16px, CSS 대비 최소 6.60:1, 좌석 오차 0px. 패널 내부 스크롤과 의도한 장면 소품 가림은 별도 기록한다. 반투명 UI의 배경 범위를 보수적으로 계산하도록 최종 장면/비교/타입 검사를 별도 재실행했다.
- 이전 m1-fixes/m3/m4/m5 **68쌍·8개 대조 이미지**와 대표 원본을 눈으로 확인했다. M5 공통 장면의 가림 면적 변화 0%p, 초기 단계 대비 최대 +1.4%p는 기존 단계의 UI 확장이다. 새 레이아웃 붕괴/가려진 조작은 보이지 않았다. 기존 궁정의 깊이·명패·좌석을 유지하지만 인물은 비슷한 임시 SVG여서 표현의 질은 사람 검토 필요(자동 판정 불가). 손권·호위·시각 방향 재작업 없음.
- 실행 도구: `verify-all.ts`, `run.ps1 verify`, 가이드 예문 검사, 비교/시작 smoke를 추가했다. 3001 포트에 기존 서비스가 있어 `dev.ts`의 선택 환경변수 `THRONE_API_PORT/THRONE_WEB_PORT`로 독립 포트에서 같은 `run.ps1 dev`의 화면/API/프록시/정직한 Mock 표시를 검증했다. 기존 서비스는 보존했으며 smoke는 stdin EOF로 자신의 서버만 정상 종료한다. 초기 통합 실행의 하네스 DOM 갱신/포트 실패(13/15)는 `verification-first-run.json`·`intermediate-*.log`에 남겼고 최종 통과로 혼동하지 않는다.
- 문서: README 현재 상태로 교체, `docs/QA_MATRIX.md`, `PLAY_GUIDE.md`(10문장·사람 시험 3경로·질문), `KNOWN_LIMITS.md`, 기존 PLAYTHROUGH/Provider/오프닝 계약 갱신. 실제 LLM·한국어 전반 이해·실제 IME·다른 브라우저·역사 사료 대조·사람의 15분 긴장/재미는 미검증이며 자동 성공과 분리했다. 라이브 평가기의 조건 배열 자동 대조 한계도 명시했다.
- 제출: HEAD `aaee040`, `integrate/visual-assets`. Git 메타데이터가 쓰기 범위 밖 원본 `.git/worktrees/throne-integrate`에 있고 `_common.md`/HANDOFF는 리드 커밋을 요구한다. add/commit/push·권한 우회·전역 설정 변경·선택/확인 팝업 없이 작업 트리에 보존한다. 검토용 전체 `artifacts/m6/changes.patch`와 SHA-256 목록/역적용 읽기 검사 결과를 준비해 리드에게 전달한다. **커밋 생성은 환경상 미완료**이며 다음 단계는 리드 커밋과 R3 독립 리뷰다.

## 2026-10-25 — J08 / 009 M5 오프닝 연결

- `OPENING_SCENARIO.md`를 먼저 작성하고 `content/opening/`의 사건 14·문서 6·지식 12·대사 68을 읽는 서버 엔진을 연결했다. 자연어 전제는 실행하지 않으며 상태·수신 기록·접견 가능 여부·현재 기한으로 판정한다. 콘텐츠 원본과 역사 항목의 ‘사람의 사료 대조 필요’ 표시는 변경하지 않았다.
- 정상 서버는 화면/이미지/글꼴 준비 뒤 자동 시계(서버 monotonic wall time)를 사용한다. 기존 생성자 fixture는 수동으로 유지하고 개시 시험은 여섯 번째 인수로 켠다. 작성·Provider 대기·초안 확인·수동 보류·백그라운드 보호, 모드 전환, +5/+30초·가장 가까운 사건/작업 경계까지만 전진을 구현했다. 큰 전진도 임계값에서 나누며 0 기준 자동 시계·준비 전 수동 전진도 검사했다.
- T02 급보는 활성 25000ms. 장조 별도 수신(35000ms)과 작성·전달, 주유의 독립된 옛 보고, 1회 접견 요청·연기/거절/직접 호출, 조건부 도움, answered 시 T11 취소·보류 기한 연장, 실제 미결 항목만 T12로 연결한다. T13은 기존 작업 사건/보고의 투영이며 비용·작업을 재실행하지 않는다. T14는 시작 이후 보고의 실제 열람 지표이며 정답·승패·15분 종료가 아니다.
- 공개 문서는 관측 미상(null/설명)·실제 도착·출처·근거 범위·재구성 표시를 보존한다. 별도 명령 처리 기록을 추가하고 비밀 작업 연결로 Provider 자동 전송을 차단했다. 문서 허용 상한·인물/태그/전체 필요 지식·회의 참석자별 권한을 검사하며 미래 데이터와 대기열을 공개하지 않는다. 지도는 받은 보고 지역과 옛 기록을 유지한다.
- 알림·배지는 문장/초점/선택/스크롤/패널을 빼앗지 않는다. 문서 읽기는 시간 자체를 멈추지 않고 도움만 억제한다. 검증 중 발견한 자동 갱신의 그림 실패 회복 방해, 1366 지도 설명 넘침, 지도 제목 위 알림 겹침을 수정했다. 넓은 지도에서는 배지와 읽기 보조용 상태 알림으로 전달한다. 스크린샷은 전환 완료 뒤 캡처하도록 했다.
- 자동 검증: 전체 `node --test tests/*.test.ts` **156/156**(기존 140 유지 + 신규 16), `node scripts/playthrough.ts` **12/12 + ScriptedProvider 대화**, 타입 검사·Vite 빌드 통과. `node content/validate.mjs --self-test`는 문서/지식/대사/사건/시나리오 및 변조 18건 검출 통과. 실제 외부 API 호출 0회, 의존성 추가 없음. 사건 ID·취소·원인·중복 소모·같은 입력/시계 재현·각 보류 사유·공개 경계를 검사했다.
- 브라우저: 설치된 Edge headless 1920×1080·1366×768. M5 자동 급보/작성 보호/접견/압박/복합 지시→자동 완료→열람 **18/18**, 지도 제목/배지 추가 **2/2**. 기존 `screenshots.ts` **12/12**, `verify-visual.ts` **16/16**, M4 **20/20**, M3 **10/10**, AI UI **12/12**, R1 **6/6**. 급보와 작업 후속은 실제 자동 시계를 기다렸으며 압박 구간만 명시적 전진 도구를 사용했다. 증거 `artifacts/m5/`, 가이드 `docs/PLAYTHROUGH.md`, 인계 `.codex-runs/m5-opening-report.md`.
- 미검증: 실제 사람이 느끼는 15분 긴장·재미, 사료 정확성·한국어 자연스러움/전반 의미 이해·실제 LLM 품질·IME·다른 브라우저. 유한 도움/계획 표현 판정은 일반 언어 이해를 보증하지 않는다. 자동 통과를 이 품질이나 최종 병합 승인으로 쓰지 않는다.
- 제출 차단: 시작 HEAD `ecd12a3`, `integrate/visual-assets`. `.git`은 쓰기 허용 범위 밖 원본 저장소의 `.git/worktrees/throne-integrate`를 가리키고 현재 정책은 권한 확장 불가다. `_common.md`/HANDOFF의 리드 커밋 절차에 따라 add/commit/push는 실행하지 않았다. 읽기 명령에만 `-c safe.directory=...`를 사용했으며 전역 설정·원본·main·다른 브랜치·원격 변경/확인 팝업은 없다. 리드가 이 작업 트리 변경을 검토 후 커밋해야 한다. 다음 단계는 R2/M6 별도 검토다.

## 2026-10-25 — J07b / 013 R2a 리뷰 수정

- 수정 전 신규 27개 회귀 시험에서 **16 실패 / 11 통과**로 지적 3건을 재현했다(`artifacts/r2a-fixes/before.txt`). 기존 106개 테스트는 수정·삭제·약화하지 않았다.
- 공통 Provider 전송 정책으로 비밀 보고·명령/작업/공유 기억·요약·과거 문맥을 제외한다. 비밀 임무 당사자의 문서/기억 질문만 실제 엔진 근거로 로컬 응답하며 그 대화도 이후 외부 문맥에서 제외한다. 열람 권한과 자동 전송 권한을 분리했다.
- 공통 모델 출력 필터에 출발·도착·수락·동맹·전달·완료·소모·비밀 단정과 내부 카드 ID를 추가했다. 미래·가정·질문·계획은 허용하며 절별로 판단한다. 유한 한국어 패턴이라는 한계는 문서화했다.
- 연기는 요청을 맨 뒤로 이동하며 UI에 순위를 표시한다. 모두 연기해도 현 순서로 호출 가능하고 직접 초대 시 요청을 제거한다. 작업 진행/완료/회수 기억은 실제 후속 사건 ID를 참조한다. 문서 공유 취소는 미지원임을 두 문서에 명시했다.
- 최종 검증: `node --test tests/*.test.ts` **140/140**(기존 106 + 신규 34), `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/vite/bin/vite.js build`, Git diff 공백 검사 통과. 퇴실·공유·리셋 뒤 지연 응답, 2000자/본문 길이, 내부 필드 비노출, 공유 취소 거부, 완료·회수 기억을 포함한다.
- Edge headless 1920×1080·1366×768: `scripts/screenshots.ts` **12/12**, `scripts/verify-visual.ts` **16/16**, `scripts/verify-m4.ts` **20/20**, `scripts/verify-m3.ts` **10/10**, `scripts/verify-llm-ui.ts` **12/12**, `scripts/verify-r1.ts` **6/6**. 모두 `node … --out artifacts/r2a-fixes/<하위폴더>`로 실행했다. 3인 배치·명패·세 발언자 전환과 T06 실제 호출 순서 포함.
- 증거/보고: `artifacts/r2a-fixes/` (수정 전/후 로그, JSON, 두 해상도 스크린샷, `REPORT.md`). 브라우저 그림은 임시 기존 SVG이며 새 자산·의존성·계약 필드 변경·M5 기능은 없다. 실제 외부 API 호출 0회; 실제 LLM 품질·일반 한국어 완전성·IME·다른 브라우저·15분 재미는 미검증이다.
- 제출 제한: HEAD `f18921d`, `integrate/visual-assets`의 변경 보존. 사용자 요청은 제출까지 포함하지만 `.git`이 쓰기 금지된 원본 저장소 메타데이터를 가리키고 현재 승인 정책으로 권한을 확장할 수 없다. `_common.md`도 리드 커밋 인계를 지정한다. add/commit/push 및 전역 설정 변경·확인 팝업 없이 인계한다. 다음 단계: 리드가 변경 검토 후 이 브랜치에 커밋; M5는 별도 작업이다.

## 2026-10-25 — J07 / 008 M4 네 인물 대화

- 구현: 장굉·장조·주유·노숙의 서버 인물 카드/입장/전문성/우려/관계/사건 ID 기억, `POST /api/talk`, 접견·회의·연기·퇴실·명시적 문서 공유. 질문/논의는 자원·작업·외교를 바꾸지 않으며 명령은 기존 M2/M3 해석·검증·초안·확인 경로를 재사용한다. 첫 접견 중복 방지와 요청 순서 변경을 지원한다.
- 지식 경계: 자기 카드와 허용된 문서/대화/기억만 분리해 Provider에 전달한다. 회의는 현재 참석자 전원에게 허용된 자료만 사용한다. 비참석자 기억, 공유 전 문서, 미래·숨은 병력·적의 속마음 보호를 검사했다. 문서 열람은 공유가 아니다. 전체 WorldState와 관계 수치는 Provider/브라우저에 노출하지 않는다.
- 기억/관계: 사실 기록 및 요약이 실제 사건 ID를 참조한다. 질문·가정은 질문으로 기록하고, 명령 기억은 확정 ID와 금지 조건/미완료 상태를 보존한다. 새 문서 공유에만 작은 존중 변화와 이유를 남기며, 연기·퇴실로 신뢰를 떨어뜨리지 않는다. 회의는 한 답변과 짧은 반론 후 입력권을 반환한다. 자동 토론/힌트/재촉 없음.
- 화면: 기존 S2/S3와 기록 패널 사용, 4명 선택과 두세 명 회의, 문서별 보여 주기, 임무 중 접견 불가 사유, 입력 보존, 퇴실 인물 숨김. 새 SVG 3개는 장굉 원본의 색·관·소품 변형인 임시 표현이다. 최종 아트 아님. 새 의존성 없음.
- 수정 중 발견·해결: 내부 `available` 공개가 기존 경계 테스트를 깨뜨려 파생 `audienceStatus`만 공개하도록 수정했다. 1366 회의 명패 가림을 수정했고, 명령 패널 열린 상태에서 새 초안을 만들면 패널이 닫히던 회귀를 M3 브라우저 검사로 발견해 고쳤다. 접견 부재 시에도 제출한 문장을 보존한다. 브라우저 스크립트의 숨김/비동기 패널 대기 오류를 고쳐 실제 결과까지 기다리도록 했다.
- 자동 검증: `node --test tests/*.test.ts` **106/106** (기존 93개 유지, 신규 13개), `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/vite/bin/vite.js build`, `git -c safe.directory=<프로젝트 루트> diff --check` 통과. 기존 테스트 삭제·약화 없음.
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
- 최종 통과: `node --test tests/*.test.ts` **93/93** (기존 66개 테스트 수정·삭제·약화 없음, 신규 27개), `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/vite/bin/vite.js build`, `git -c safe.directory=<프로젝트 루트> diff --check`.
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
- 자동 검증 통과: `node --test tests/*.test.ts` **66/66** (기존 56 + M3 10); `node node_modules/typescript/bin/tsc --noEmit`; `node node_modules/vite/bin/vite.js build`; `git -c safe.directory=<프로젝트 루트> diff --check`.
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
- 통과: `node node_modules/typescript/bin/tsc --noEmit`; `node --test tests/*.test.ts` **56/56**; `node node_modules/vite/bin/vite.js build`; `git -c safe.directory=<프로젝트 루트> diff --check`.
- 통과: `node scripts/screenshots.ts --out artifacts/m2` **12/12**; `node scripts/verify-visual.ts --out artifacts/m2` **16/16**; `node scripts/verify-llm-ui.ts` **12/12**. 설치된 Edge headless, 1920×1080/1366×768. 최초 Mock HUD 4.5%/8.9%. 대표 Mock·AI 오류/타임아웃/긴 답변 캡처 직접 확인. `artifacts/m2/`에 PNG 22장, metrics/browser-checks/llm-browser-checks JSON, tests/build 로그.
- 무키 확인: `node scripts/eval-llm.ts` → 키 없음으로 즉시 종료, 실제 LLM 외부 호출 **0회**. 어댑터 전송·제한·타임아웃은 합성 키/가짜 fetch로만 시험. 키 값·원문 헤더를 로그/응답/브라우저로 내보내지 않는다.
- 차단/미검증: API 키 없음. Gemini 모델 접근·계정 무료 한도·한국어 품질·실제 지연 모두 **코드 작성됨, 라이브 미검증**. 부정/조건 검사는 보수적 패턴이며 한국어 전반의 의미 정확도를 보장하지 않는다. 실제 IME·다른 브라우저·장시간 재미는 미검증.
- 라이브 후속 절차: 계정 무료/유료 여부·모델 접근과 사용자 승인을 확인한 환경에서 서버 키, `GEMINI_MODEL_ID`, `LLM_TIMEOUT_MS`, `LLM_RETRIES`, `LLM_DAILY_CALL_LIMIT`, `LLM_SESSION_CALL_LIMIT` 설정 후 `node scripts/eval-llm.ts --live`. 결과 `artifacts/m2/live-eval.json`; 한국어 품질/출처는 별도 수동 검토. 상세 설정/한도 복구는 `server/llm/README.md`.
- 인계: 시작 HEAD `b73edec`, 브랜치 `integrate/visual-assets`, 원본·main·remote 변경 없음. Git 소유권 차이는 명령별 safe.directory만 사용. `_common.md`의 add/commit 금지와 쓰기 범위 밖 worktree Git 메타데이터 때문에 **커밋 미실행**, 작업 트리에 변경을 남겼다. 리드가 검토·커밋해야 한다. 구현: `server/llm/*`, `server/{engine,http,index}.ts`, `shared/contracts.ts`, `client/index.html`, `client/src/{main.ts,style.css,ui/panels.ts}`, `scripts/{dev,eval-llm,verify-llm-ui}.ts`, `tests/{llm,llm-http,gemini}.test.ts`, `tests/fixtures/*`, 이 로그.

## 2026-10-25 — J04 / 004 M1 보완

- 범위: 독립 리뷰 1~5번. 손권과 좌석의 카메라를 공유하고, 지도 패널을 1000:300 콘텐츠 높이에 맞췄다. 1366 명령 카드의 간격을 줄여 확인·수정·취소와 보존 안내를 함께 표시한다. 장굉의 왼쪽 전경 위치를 유지하며 CSS 대비·그림자와 이름표 간격만 조정했다.
- 검증 강화: 실제 패널 사각형을 제외한 노출 영역에서 장면 버튼을 검사한다. HUD/패널/합집합 화면 점유율을 분리 기록한다. 공개 문서 ID·본문·작업 ID·완료 시각을 비교하고 두 번째 작업의 최신 완료 보고까지 확인한다.
- 첫 실행에서 이전 전경 이동이 문서 버튼을 화면 밖으로 밀어내는 문제와 1366 지도 설명의 미세 스크롤을 발견했다. 전경 확대를 1.03으로 제한하고 지도 설명 기본 여백을 제거한 뒤 재검증했다. 기존 테스트는 삭제·완화하지 않았다.
- 실제 통과: `node node_modules/typescript/bin/tsc --noEmit`; `node --test tests/*.test.ts` 32/32; `node node_modules/vite/bin/vite.js build`; `node scripts/screenshots.ts --out artifacts/m1-fixes` 12/12; `node scripts/verify-visual.ts --out artifacts/m1-fixes` 16개 검사 묶음; `git -c safe.directory=<프로젝트 루트> diff --check`.
- Edge 155.0.4283.62 headless, 1920×1080·1366×768. 입력→확인 2회→60초 진행→보고에서 작업 1건·군량 -100·준비도 +15. 수군 표식은 report-0002/task-0001 이후 report-0004/task-0002를 연다. 전체 패널과 접견에서 좌석 기준 오차 <0.01px. 실패 이미지 대체 표시도 통과.
- 스크린샷 12장과 실패 자산/보고 캡처 4장, `metrics.json`, `browser-checks.json`, `build.log`: `artifacts/m1-fixes/`. 새 12장 모두 시각 확인. 이전 `artifacts/m1-integrated/`와 비교해 1920 지도 하단 빈 공간이 제거되고 1366 명령 보존 안내가 노출됨을 확인했다.
- 측정: S0 상시 HUD 4.2%/8.4%; S4 패널 27.6%/54.6%, HUD 포함 화면 가림 31.9%/62.8% (1920/1366 순). 합집합 면적은 뷰포트 밖과 중복을 제외하며 투명도·그림자는 가중하지 않는다. S1/S5의 장굉·두 소품을 모두 검사하며, 완전히 가려진 1366 S4 장굉만 제외한다.
- 미검증: 실제 IME, 다른 브라우저, 장시간 성능·재미. 1366 문서의 긴 본문/메타데이터는 기존 내부 스크롤을 유지한다. 서버·계약·의존성·SVG 원본·인물 그림체 변경 없음.
- 인계: 시작 HEAD f4ae213, integrate/visual-assets. Git 소유권 차이는 명령별 safe.directory로 처리했으며 전역 설정은 변경하지 않았다. Git 메타데이터가 쓰기 허용 범위 밖인 원본 저장소에 있어 커밋은 차단됨. `_common.md`에 따라 add/commit/push를 시도하지 않았다. 리드가 아래 구현 5개 파일과 이 로그를 검토·커밋해야 한다. 산출물은 기존 .gitignore상 제외된다.
- 구현 파일: `client/src/style.css`, `client/src/panels.css`, `client/src/ui/panels.ts`, `scripts/screenshots.ts`, `scripts/verify-visual.ts`. 상세 인계 보고: `.codex-runs/m1-fixes-report.md`.
