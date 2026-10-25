# M6 기능·시각 검증 매트릭스

기준: 2026-10-25, `aaee040` 이후 M6 작업 트리. 최신 실행의 기계 판정 원본은 `artifacts/m6/verification.json` 및 명령별 로그다. 아래 T01~T15는 **PROTOTYPE_SPEC 10장의 기능 시험 번호**이며 콘텐츠 사건 T01~T14와 다르다. 자동 검증은 고정 Mock/ScriptedProvider/가짜 fetch에 대한 결과다. 라이브 미검증은 미검증으로 유지한다.

## 명세와 사용자 요구

| 항목 | 실제 자동 근거: 파일 · 테스트/스크립트 이름 | 마지막 실행 결과 | 상태·한계 |
|---|---|---|---|
| T01 항복 질문 | `tests/command.test.ts` · `M1-F05 questions, hypotheticals and unsupported orders...`; `verify-guide.ts` | 통과: 질문, 실행 0 | 자동 검증됨(패턴); 라이브 미검증 |
| T02 정비만·공격 금지 | `tests/command.test.ts` · `M1-F04 "do not strike first"...`; `r1-fixes.test.ts` · `R1 all actions in the same clause...` | 통과: 조건·보고·정책 보존 | 자동 검증됨(지원 표현) |
| T03 비밀 접촉·참전 금지 | `tests/compound.test.ts` · `M3 secret contact and no-war-promise persist...`; `playthrough.ts` S03 | 통과: ACL·조건·메시지 | 자동 검증됨 |
| T04 확정 전 수정 | `tests/command.test.ts` · `M1-F03 revised or cancelled drafts...`; `compound.test.ts` · `M3 revise/cancel, current actor conflicts...`; `verify-m3.ts` revision | 통과: 이전 버전 실행 거절 | 부분: 지원 수행자 범위 외 교체는 거절·명료화, 범용 배치 없음 |
| T05 중복 확인 | `tests/command.test.ts` · `M1-F02 confirming the same draft version twice...`; S07 | 통과: 작업/군량 1회, 내부 스냅샷 재현 | 자동 검증됨 |
| T06 주유 먼저 | `tests/characters.test.ts` · `M4 T06 requested order is overridable...`; S02; `verify-m5.ts` | 통과: 장조 생략·요청 취소 | 자동 검증됨 |
| T07 조기 유비 접촉 | `tests/compound.test.ts` · `M3 early independent combinations...`; S03 | 통과: 활성 10초 등록·25초 출발, 접견 선행 없음 | 자동 검증됨 |
| T08 숨은 정보 질문 | `tests/characters.test.ts` · `M4 T08 future, hidden forces...`; `r2a-fixes.test.ts` · `R2a actual talk provider excludes...`; S01~12 PB01/PB03 | 통과: 공개·Provider 경계 | 자동 검증됨(검사한 경로); 의미상 모든 누출·라이브 미검증 |
| T09 미지원 정치·암살 | `tests/command.test.ts` · `M1-F05...`; `r1-fixes.test.ts` · `R1 unknown request remains explicit...`; `verify-guide.ts` | 통과: 이유·원문 유지, 실행 없음 | 자동 검증됨 |
| T10 실패·지연 | `tests/llm.test.ts` · `M2 provider failures and timeout...`, `M2 the default 15-second deadline...`; `m6-quality.test.ts` · `M6 delayed command/talk...`; `verify-llm-ui.ts` | 통과: 타임아웃·오래된 응답·입력 보존 | 부분: 실제 LLM 지연 라이브 미검증, ASR 미구현 |
| T11 답한 뒤 재촉 | `tests/opening.test.ts` · `M5 answered request cancels T11...`; S06·S10 | 통과: answered 보존·연장 경계 정확 | 자동 검증됨 |
| T12 공유·참석자 지식 | `tests/characters.test.ts` · `M4 viewing is not sharing...`, `M4 meetings cannot propagate...`; S08; `verify-m4.ts` | 통과: 열람/공유 구분·허용 상한·혼합 회의 | 자동 검증됨 |
| T13 원거리 전달·회신 | `tests/compound.test.ts` · `M3 example has three actions...`; S03; `verify-m3.ts` | 통과: 준비/이동/수신/회신 구분 | 자동 검증됨(고정 회신) |
| T14 부분 유효 복합 명령 | `tests/compound.test.ts` · `M3 partial support requires explicit scope...`; `verify-r1.ts` partial | 통과: 제외 범위·부분 확인 | 자동 검증됨(지원 어휘); 라이브 미검증 |
| T15 공유 취소·임무 철회 | `tests/r2a-fixes.test.ts` · `R2a HTTP document unshare is unsupported...`; `compound.test.ts` · `M3 recall preserves past spend...` | 통과: 미지원 명시·과거 소모/정보 유지 | 부분: 공유 취소·출발 후 실제 회수는 미구현 |
| 자유 명령 정확성 | `tests/llm.test.ts` · `M2 unfamiliar Korean order...`; `verify-guide.ts` 10문장 | 통과: 주입 제안 검증·Mock 예시 분류 | 부분: 일반 한국어·실제 LLM 품질 **라이브 미검증** |
| 미지원 처리 | `tests/r1-fixes.test.ts` · `R1 unknown request remains explicit...`; `verify-guide.ts` | 통과: 미지원 3예시·복합 제외 범위 | 자동 검증됨(표현 범위) |
| 조건 누락 방지 | `tests/r1-fixes.test.ts` · `R1 schema-valid extra or omitted actions rejected...`; `llm.test.ts` · `M2 punctuation does not swallow...` | 통과: 부정·비밀·조건 대조 | 부분: 보수적 패턴, 의미상 전 언어 보장 없음 |
| 중복 실행 방지 | `tests/command-http.test.ts` · `submit → confirm twice over HTTP...`; `m6-quality.test.ts` · R2b 2건 | 통과: 작업/소모/큐/미결 요약 유일 | 자동 검증됨 |
| 정보 비공개 | `tests/client-boundary.test.ts` · Vite·production bundle; `r1-fixes.test.ts` · `R1 later provider input excludes...`; `r2a-fixes.test.ts` | 통과: 브라우저 번들·HTTP·Provider | 자동 검증됨(검사한 투영); 라이브 의미 누출 미검증 |
| 사건 순서 변경 | `tests/opening.test.ts` · ordered receipts, busy audience; S01~12 expectedEventOrder | 통과: 독립 요청·동시각 순서·취소 | 자동 검증됨 |
| 조기 명령 | S03·S04; `tests/compound.test.ts` · `M3 early independent combinations...` | 통과: 첫 2분·노숙/회의 생략 | 자동 검증됨 |
| NPC 대화 기억 | `tests/characters.test.ts` · `M4 all memory facts and summaries reference extant events...`; `r2a-fixes.test.ts` · latest task memory | 통과: 근거 사건·완료/철회·권한 | 부분: 작성된 답변·지식 기억 검증, 자연스러운 장기 대화는 사람/라이브 필요 |
| 시간 진행 | `tests/m6-quality.test.ts` · mode transitions·delayed responses; `opening.test.ts` · every pause reason; S11; `verify-m5.ts` | 통과: 준비/중첩 보류·리셋·모드 전환·자동 급보 | 자동 검증됨; 실제 장기 운영 부하는 미검증 |
| 결과 보고의 인과 | `tests/opening.test.ts` · `M5 reaction causality...`; `command.test.ts` · `M1-F07...`; S01~12 PB04 | 통과: sourceEventId·taskId·시각·소모·실제 열람 | 자동 검증됨; 플레이어가 인과를 이해하는지는 사람 필요 |

## 안정성과 설계 데이터

`tests/m6-quality.test.ts`는 R2b 요청 전 연기·거절, 두 인물 큐 유일성·T12 중복, 기존 큐와 T05/T07 멱등, 모드 전환 직후 벽시계 원점, 리셋 전후 늦은 command/talk와 새 Provider 보류, HTTP 재시작의 새 세션을 검사한다. 기존 156개 시험은 수정·삭제·완화하지 않았다. 추가 8개를 포함한 전체 결과는 164/164다.

`scripts/quality/soak.ts`는 4가지 결정 경로를 12회 같은 엔진에서 리셋해 각 960초 활성 시간을 진행한다(총 11,520초). 650초 이후 문서·큐·알림 수가 유지되고 1초 전진 250번에는 의도한 감사 로그만 250개 증가하는지, 사건/문서/작업/요청 중복이 없는지 확인한다. 900초 이후에도 접견을 실행한다. 이는 실제 벽시간 3시간 부하 시험이 아니다.

`scripts/quality/scenarios.ts`는 S01~S12 **77단계·42금지 항목**, 기대 사건/문서와 PB01~06을 실행/단언한다. 조작 문장은 명시적 UI/엔진 어댑터로, 명령·대화 원문은 실제 Mock/대화 경로로 보낸다. 정적인 `adapter-contracts.json`은 사람용 조작/기대 문구 변경의 검토 누락을 막는다. 추가/삭제 시나리오, 미실행 단계, 없는 사건, 미매핑 금지 문구, 바뀐 기대 문구를 변조 시험으로 검출한다. 어댑터 기반 실행은 문장을 이해하는 AI 성능 평가가 아니다.

S06의 옛 기대 문구 “T12도 취소”는 잘못이었다. 회답 완료는 조조 사안만 없애며 접견 요청이 남아 있으면 요약은 계속된다. `content/opening/test-scenarios.json`의 이 설명만 실제 계약과 일치하게 수정했다. 제품 사건을 지우거나 시험을 완화하지 않았다.

## 시각·조작 범위와 판정

설치된 Microsoft Edge headless, 1920×1080·1366×768. `screenshots.ts all`은 궁정, 장굉/장조/주유/노숙, 2/3인 회의, 급보/건의문/보고/장부, 지도, 단독/복합 초안, 진행·완료 보고, 급보 직후·요청 배지·압박 등 21장면 × 2해상도를 캡처한다. 본문은 실제로 스크롤해 읽는 위치에서 캡처한다. `verify-visual`/M3/M4/AI/R1/M5는 실제 버튼의 결과·키보드 지도·초점·입력 보존·스크롤 후 조작·실패 자산 대체를 추가 확인한다. 모든 가능한 버튼 상태를 전수 탐색했다는 뜻은 아니다.

수치 결과는 `scenes/metrics.json`에 페이지 스크롤, 가려진/화면 밖 버튼, 본문 크기, 상시 HUD/패널/합집합 가림 면적, 좌석 오차, CSS 대비를 저장한다. 패널에 의도적으로 가려진 장면 소품과 패널 내부 스크롤로 접근하는 항목은 별도로 구분하며 “접근 불가능 버튼”으로 숨겨 세지 않는다. CSS 대비는 불투명/반투명 배경과 종이 그라데이션의 색상 범위를 계산한다. 실제 글꼴 안티앨리어싱·문장 독해력을 자동 판정하지 않는다.

`comparison/`은 이전 m1-fixes/m3/m4/m5와 같은 장면을 나란히 배치한 PNG/HTML 및 이전/현재 가림 면적 차이를 저장한다. 시각 회귀의 최종 눈 검사와 최신 수치는 마지막 실행 후 아래 실행 기록에 적는다. 공간감·인물 표현의 질·재미는 자동 판정 불가이며 사람 플레이테스트는 아직 하지 않았다.

## 마지막 실행 기록

최신 통합 실행: **2026-10-25 05:35Z, `node scripts/verify-all.ts` 16/16 명령 통과, 종료 0**. 본문 대비 계산에서 UI 뒤의 SVG 배경을 검정/흰색 양 끝으로 제한하는 최종 보강 뒤 장면·비교·타입 검사도 별도 재실행했다. 원본은 `verification.json`, `verify-all.log`, `scenes-final.log`, `comparison-final.log`, `typecheck-final.log`다.

| 실제 명령/항목 | 최종 결과 |
|---|---|
| `node node_modules/typescript/bin/tsc --noEmit` | 통과 |
| `node --test tests/*.test.ts` | 164/164 통과, 실패/건너뜀 0 |
| `node node_modules/vite/bin/vite.js build` | 통과 |
| `node content/validate.mjs --self-test` | 콘텐츠 통과, 변조 17+잘못된 JSON 1건 검출 |
| `node scripts/playthrough.ts` | 12/12, 77단계·42금지 항목, 외부 호출 0 |
| `node scripts/soak.ts` | 12/12 × 활성 960초 |
| `node scripts/verify-guide.ts` | 실제 가이드 10문장 분류·확정 전 실행 없음 |
| `node scripts/screenshots.ts all --out artifacts/m6/scenes` | 42/42 |
| `node scripts/verify-{visual,r1,m3,m4,llm-ui,m5}.ts --out artifacts/m6/<이름>` | 각각 16/16, 6/6, 10/10, 20/20, 12/12, 18/18 |
| `node scripts/compare-visual.ts` | 68쌍·8개 나란히 이미지, 공통 장면 수치 저장 |
| `node scripts/verify-launch.ts` | 실제 `run.ps1 dev`, 독립 포트의 페이지/API/프록시 200·Mock·정상 종료 |
| `.\run.ps1 test`, `typecheck`, `build` | 각각 종료 0 (`run-*.log`) |
| `git diff --check` | 통과; Git 메타데이터 쓰기는 수행하지 않음 |

두 해상도 모든 장면에서 페이지 스크롤 0, 접근 불가/화면 밖 버튼 0, 읽기 본문 최소 16px, CSS 대비 최소 **6.60:1**, 좌석 오차 0px다. 상시 HUD/입력/답변의 합집합은 4.7~16.6%, 열린 패널 포함 화면 가림은 최대 63.7%(1366 지도, 패널 자체 54.6%)다. 기본 궁정은 1920에서 4.7%, 1366에서 9.3%다. 문서 본문은 17px다.

8개 대조 이미지와 원본 급보/3인 회의/복합 초안/완료 보고를 눈으로 보았다. M5와 공통 12개 장면의 화면 가림 면적 차이는 **0%p**, M1/M3/M4 대비 변화 범위는 각각 +0.4~1.4%p/+0.1~0.9%p/0~0.5%p다. 이전 단계에서 추가된 배지·출처·조건 표시 차이는 있으나 새 레이아웃 붕괴나 새로 가려진 조작은 확인하지 않았다. 1366 문서 스크롤은 유지되며 새 캡처는 실제 본문을 보여 준다.

눈으로 본 공간감은 기존 궁정의 깊이·좌석·넓은 중앙 공간을 유지한다. 인물은 비슷한 임시 SVG 실루엣을 공유해 색과 명패에 많이 의존한다. 표현의 질은 추가 사람 평가가 필요하며 **자동 판정 불가**다. 실제 사람의 재미를 검증한 결과가 아니다.

초기 통합 실행은 하네스의 DOM 갱신/기존 3001 포트 충돌로 13/15였다. 수정 후 결과와 구분해 `verification-first-run.json`, `intermediate-scenes.log`, `intermediate-launch.log`에 보존했다. 실제 LLM 호출 0회·키 없는 `eval-llm.ts` 미실행. 설치 명령·실제 IME·다른 브라우저·역사 대조·사람의 15분 재미는 미검증이다. Git 커밋은 쓰기 범위 밖 worktree 메타데이터 제약과 리드 커밋 절차로 생성하지 못했으며 제품 검증 통과와 별개다.
