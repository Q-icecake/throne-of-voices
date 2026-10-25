# Throne of Voices — 첫 15분 프로토타입 (M6)

208년 적벽 전야의 손권이 되어 한국어로 질문하고 명령하는 로컬 역사 전략 게임 시험판이다. 명령 초안 → 확인 → 전달·진행 → 보고 → 인물 반응을 연결한다. 역사 자료·대사·수치는 시험용 재구성이며 사람의 사료 대조가 필요하다. 자동 검증 통과는 역사 정확성이나 사람의 재미를 입증하지 않는다.

## 실행

Windows PowerShell, Node.js 24 이상, pnpm 11.25.0이 필요하다. 이미 `node_modules`가 있으면 설치를 반복할 필요가 없다.

```powershell
.\run.ps1 install
.\run.ps1 dev
```

화면은 <http://127.0.0.1:5173>, API는 <http://127.0.0.1:3001>이다. 종료는 Ctrl+C. 서버 코드를 바꾸면 재시작한다. `run.ps1`은 현재 PATH의 Node를 사용하고 없으면 이 PC의 Codex 런타임 경로를 확인한다. 표준 Node 환경에서는 `node scripts/dev.ts`도 같은 실행 방법이다. 3001/5173 포트는 비어 있어야 한다. PowerShell 실행 정책이 로컬 스크립트를 차단하면 시스템 정책을 바꾸지 말고 Node 명령을 사용한다.

이번 검증은 설치된 Node 26 및 Microsoft Edge로 실행했다. 설치 명령은 이번 단계에서 재실행하지 않았으며 새 의존성은 추가하지 않았다. `.\run.ps1 dev`는 실제로 띄워 화면·API·프록시·Mock 상태를 확인한다(`artifacts/m6/launch.json`). 기존 3001 포트 서비스가 실행 중이어서 검증은 별도 포트를 사용했다. 다른 프로세스를 종료하지 않는다.

기본 포트가 사용 중이면 다음처럼 같은 진입점의 포트를 지정할 수 있다. 지정 포트는 서로 달라야 하며 사용 중이면 실행을 실패시킨다.

```powershell
$env:THRONE_API_PORT = '3201'
$env:THRONE_WEB_PORT = '5373'
.\run.ps1 dev
```

원래 기본값으로 돌아가려면 이 두 환경변수를 현재 셸에서 제거한다. 검증 스크립트는 비어 있는 임시 포트를 자식 프로세스에만 지정한다.

## 키 없이 가능한 것

기본은 **Mock**이다. 키·계정·외부 연결 없이 네 인물 접견, 두세 명 회의, 명시적 문서 공유, 지도, 수군 정비, 조조 회신/보류, 비밀 유비 타진, 최대 세 행동 복합 초안, 수정·취소·확인, 작업 보고와 오프닝 사건을 실행할 수 있다. Mock은 정해진 한국어 패턴만 인식한다. 낯선 문장이 이해된다고 보장하지 않으며 일부 일반 질문은 고정된 인물 답변으로 처리된다.

화면에 `Mock · AI 미연결, Mock 사용 중`을 표시한다. 시험의 ScriptedProvider는 `AI 시험 응답 재생 · 외부 연결 없음`으로 표시하며 실제 모델의 한국어 능력을 측정하지 않는다. 자세한 방법과 문장 10개는 [플레이 가이드](docs/PLAY_GUIDE.md)에 있다.

활성 25초에 첫 급보가 오며 문서를 자동으로 열지 않는다. 입력·Provider 대기·미확인 초안·수동 보류·백그라운드 동안 활성 시계는 멈춘다. 장조를 건너뛰거나 처음부터 유비 접촉을 명령해도 된다. 15분 뒤에도 강제 종료·패배 없이 계속 플레이한다. 서버 재시작은 새 세션이며 저장/불러오기는 없다.

## 테스트와 검증

```powershell
.\run.ps1 test
.\run.ps1 typecheck
.\run.ps1 build
.\run.ps1 verify
# 동일한 전체 품질 검증 진입점
node scripts/verify-all.ts
```

`verify-all`은 키를 자식 환경에서 제거하고 Mock을 고정해 순차 실행한다. 타입 검사, 전체 테스트, Vite 빌드, 콘텐츠 변조 시험, JSON 12개 시나리오, 12 × 960초 가짜 활성 시계 soak, Edge의 두 해상도 전체 장면·기존 UI 회귀, 이전 단계와의 나란히 비교, 실행 smoke를 포함한다. 실패도 기록하며 하나라도 실패하면 종료 코드 1이다. 3101~3110 및 5273~5280의 일부 로컬 포트를 사용하므로 다른 검증 스크립트를 동시에 실행하지 않는다. M5 검증은 실제 자동 시계로 급보·작업 완료를 기다려 몇 분 걸린다.

결과는 `artifacts/m6/verification.json`, 명령별 `.log`, `playthrough.json`, `soak.json`, `scenes/metrics.json`, PNG 및 `comparison/`에 남는다. `artifacts/`는 Git 제외된 로컬 증거다. [QA 매트릭스](docs/QA_MATRIX.md)는 실제 마지막 결과와 자동 검증의 한계를 기록한다.

개별 실행:

```powershell
node --test tests/*.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build
node content/validate.mjs --self-test
node scripts/playthrough.ts
node scripts/soak.ts
node scripts/screenshots.ts all --out artifacts/m6/scenes
node scripts/verify-visual.ts --out artifacts/m6/visual
```

Edge 설치가 없거나 로컬 서버/브라우저 실행이 차단되면 해당 검증은 실패다. 브라우저 다운로드나 외부 API로 대체하지 않는다. 시나리오의 조작 설명은 명시적 어댑터로 실행하고 문장 자체는 엔진에 전달한다. JSON 단계·금지 문구의 변경은 `scripts/quality/adapter-contracts.json`의 검토된 매핑과 일치해야 하며 새 시나리오·단계·기대 사건·금지 항목을 조용히 건너뛰지 않는다.

## 구조

| 경로 | 책임 |
|---|---|
| `client/` | Vite HTML/CSS/SVG 화면, 입력·접견·문서·지도·명령·기록 |
| `shared/contracts.ts` | 공개 응답과 입력 계약 |
| `server/engine.ts`, `world.ts`, `clock.ts` | 상태의 유일한 기준, 확인·실행·시간·보고 |
| `server/opening.ts`, `content/opening/` | 오프닝의 시각·전제·취소·수신·작성된 대사 |
| `server/characters.ts` | 인물별 지식·기억·회의 경계 |
| `server/llm/` | 교체 가능한 Provider, 구조 검사, Gemini 어댑터·호출 한도 |
| `tests/`, `scripts/` | 오프라인 회귀·자동 플레이·Edge 검증 |
| `docs/`, `OPENING_SCENARIO.md` | 실행 계약·가이드·검증·한계 |

LLM은 행동을 제안할 뿐이다. 엔진이 원문 조건·담당·자원·중복·권한을 검사하며 확인 전 실행하지 않는다. 숨은 병력·내면·비공개 지식은 브라우저와 Provider에 보내지 않는다. 열람·수신·공유는 각각 다른 기록이다.

## 라이브 AI (이번 단계에서는 실행하지 않음)

실제 Gemini 호출은 코드가 있으나 **라이브 미검증**이다. 키가 없는 지금은 `eval-llm.ts`도 실행하지 않는다. 추후 사용자가 외부 호출을 승인하고 계정의 무료/유료 여부·모델 접근·한도를 확인한 환경에서만 서버 환경변수로 `LLM_PROVIDER=gemini`, `GEMINI_API_KEY`, `GEMINI_MODEL_ID`, `LLM_TIMEOUT_MS`(최대 15000), `LLM_RETRIES`(기본 0), `LLM_DAILY_CALL_LIMIT`, `LLM_SESSION_CALL_LIMIT`를 설정한다. 두 호출 한도의 기본 0은 호출 차단이다. 키는 파일·브라우저·명령 로그에 넣지 않는다.

승인된 환경에서 `tests/fixtures/llm-eval.json`의 30문장을 먼저 검토한 뒤 `node scripts/eval-llm.ts --live`를 실행한다. 결과 `artifacts/m2/live-eval.json`의 의도·행동·제한·지연과 원문의 조건을 사람이 대조한다. 현재 평가기의 성공 판정은 조건 배열 전부를 자동 대조하지 않으므로 이 결과만으로 일반 의미 보존을 승인하면 안 된다. 실패 시 추가 호출을 중단하며 유료/다른 모델로 자동 전환하지 않는다. 재시도도 한도에 포함한다. 상세 설정과 일일 사용량 잠금은 [Provider 설명](server/llm/README.md)을 따른다.

전투·음성·범용 정치 명령·저장 기능은 없다. 전체 구현 범위, 임시 아트와 라이브/사람 미검증 항목은 [알려진 한계](docs/KNOWN_LIMITS.md), 단계 기록은 [DEV_LOG](DEV_LOG.md)에 있다.
