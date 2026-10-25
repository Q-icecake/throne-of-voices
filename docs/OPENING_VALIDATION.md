# P1-m5-content 검증 기록

검증일: 2026-10-25. 환경: Windows PowerShell, Node v26.12.1. 기준 `f187315`, 브랜치 `content/m5-materials`. 시작 작업 트리는 깨끗했다. 실행 엔진·계약·기존 시험·패키지 변경 없음. 외부 API·인터넷 접근 없음.

## 통과

| 실행 명령 | 실제 결과 |
|---|---|
| `node content/validate.mjs` | 종료 0. JSON 5개 파싱, 문서 6개·지식 12개·대사 68개·사건 14개·시나리오 12개 검사 통과 |
| `node content/validate.mjs --self-test` | 종료 0. 필수 필드·중복 ID·없는 참조·지식 권한·길이·금지 표현·Provider 표시 변조 17건 + 잘못된 JSON 1건 검출 |
| `node content/verify-commands.mjs` | 종료 0. 중복 문장 제거 후 11개: 명령 6·질문 분류만 4·미지원 1의 표시가 현재 Mock과 일치. 명령의 미해결 목록 없음. S06 회신 완료 후 answered, S10 heldUntilMs=370000 확인 |

정적 검사 범위: 필수 필드와 기본 타입, ID 중복·참조, 문서/지식/인물의 허용 범위, 문서에 대한 대사 지식 조건, 인물별 필수 태그와 변형 수, 120~300자 본문, 2~4문장 대사, 사건·시나리오의 참조 및 Markdown 목록, 공개 문장에 대한 금지 표현 패턴. 문서 길이는 194·193·189·212·207·195자다.

검증기 자체 시험은 메모리 복제본만 변조하므로 콘텐츠 파일을 바꾸지 않는다. 명령 점검은 현재 worktree의 파서·엔진을 읽기만 하며 네트워크 호출을 차단한다. 이 점검은 M4/M5 전체 시나리오 실행을 대신하지 않는다.

## 실패·차단 — 통과로 취급하지 않음

| 실행 명령 | 실제 결과 |
|---|---|
| `node node_modules/typescript/bin/tsc --noEmit` | 종료 1. `MODULE_NOT_FOUND`: 이 worktree의 `node_modules/typescript/bin/tsc` 없음. 타입 검사 미완료 |
| `node --test tests/*.test.ts` | 종료 1. **91 통과, 1 실패, 합계 92**. `tests/client-boundary.test.ts` 로딩 중 `ERR_MODULE_NOT_FOUND: Cannot find package 'vite'` 발생 |
| `node node_modules/vite/bin/vite.js build` | 종료 1. `MODULE_NOT_FOUND`: 이 worktree의 `node_modules/vite/bin/vite.js` 없음. 빌드 미완료 |

현재 worktree에 `node_modules`가 없다. 허용된 쓰기 범위는 `content/`와 새 `docs/OPENING_*.md`뿐이고 인터넷도 금지되어 있으므로 의존성을 설치하거나 다른 작업 트리의 의존성을 연결하지 않았다. 기존 93/93 기록을 이번 결과로 재사용하지 않는다. 로딩 실패 때문에 파일 내부 시험 수가 집계되지 않아 현재 합계 92이며, ‘기존 테스트 한 개를 삭제했다’는 뜻이 아니다. 리드는 의존성이 준비된 통합 작업 트리에서 타입 검사·전체 테스트·빌드를 다시 실행해야 한다.

Git 상태 확인 첫 시도는 `detected dubious ownership`으로 실패했다. 이후 읽기 명령에만 `git -c safe.directory=<프로젝트 루트> ...`를 써서 브랜치·기준·변경 범위를 확인했다. 전역 Git 설정은 변경하지 않았다.

## 미검증·해당 없음

- 역사 정확성·사료 근거와 한국어 자연스러움은 미검증. 모든 A 항목의 사람 대조 표시와 다섯 위험 묶음의 체크리스트를 유지했다.
- M4/M5 런타임, 12개 시나리오의 실제 자동 플레이, NPC 지식의 실행 중 차단, 브라우저 입력·초점·일시정지 연결, 재미·교육 적합성은 미검증.
- 화면·아트 변경 없음. 스크린샷과 시각 검증은 해당 없음이며 실행하지 않았다.
- 커밋·스테이징·push는 미실행. `011-m5-content.md`와 `_common.md`는 Git 메타데이터 쓰기를 금지하고 리드 커밋을 명시한다. 현재 메타데이터는 작업 폴더 밖 원본 저장소의 worktree 경로이며 읽기 전용이다. 변경은 작업 트리에 남긴다.

## 인계할 사항

M4 확정 계약에 맞춘 ID·문서 필드·미상 시각 매핑, 실제 수신/공유 지식 기록, 취소 가능한 활성 시각 스케줄러, T11의 answered/held 조건, T13의 원인 연결·중복 방지, 시나리오 하네스와 ScriptedProvider fixture가 다음 구현의 책임이다. `docs/OPENING_CONTENT.md` 및 `content/opening/events.md`를 먼저 읽는다. 이 결과만으로 M5 구현 완료·전체 검증 통과·병합 가능 상태라고 보고하지 않는다.
