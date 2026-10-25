# Throne of Voices — 인수인계 문서

작성: 2026-10-26 (통합 시점 main = 병합된 `v0.2/real-ai` 기준). 이 문서가 **가장 먼저 읽는 문서**다. 세부는 아래 링크를 따른다.

| 알고 싶은 것 | 문서 |
| --- | --- |
| 지금 상태·할 일 | 이 문서 |
| 구조(코드 지도) | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| 다른 PC로 옮기기 | [docs/USB_PORTABILITY.md](docs/USB_PORTABILITY.md) |
| Gemini·Ollama·VPN 설정 | [docs/LLM_SETUP.md](docs/LLM_SETUP.md) |
| 평가(eval) 명령과 결과 읽기 | [docs/EVAL.md](docs/EVAL.md) |
| 알려진 한계 | [docs/KNOWN_LIMITS.md](docs/KNOWN_LIMITS.md) |
| 플레이 방법 | [docs/PLAY_GUIDE.md](docs/PLAY_GUIDE.md) |
| 기획·범위 | `PROTOTYPE_SPEC.md`, `DEVELOPMENT_PLAN.md`, `VISUAL_DIRECTION.md`, `OPENING_SCENARIO.md` |
| 작업 일지 | `DEV_LOG.md` (오래된 순서대로 쌓인 기록, 상세 근거) |

## 1. 이 프로젝트는 무엇인가

208년 적벽 전야, 손권이 되어 한국어 문장으로 신하(장굉·장조·주유·노숙)에게 지시하는 **첫 15분 프로토타입**. 브라우저 화면(궁정 장면 + 명령창) + 로컬 Node 서버. 규칙 엔진이 상태를 결정하고, LLM은 "명령을 해석해 행동을 제안"하거나 "NPC 대사를 쓰는" 역할만 한다. LLM이 게임 상태를 직접 바꾸지 못한다(서버 validator와 엔진이 막는다).

## 2. 현재 상태 (한 줄 요약)

- **Mock 모드(키 없이)**: 첫 15분 전체가 완성되어 동작한다.
- **실제 AI 연결(Gemini / OpenAI 호환 / Ollama)**: 코드·설정 화면·진단·속도 제한·VPN 경로 모두 구현됨. **실제 모델 품질은 아직 충분히 검증되지 않았다**(아래 5절).
- 자동 검증: 타입체크 통과, `node --test` **1138/1138 통과**(통합 직후 이 PC에서 측정).

### v0.1 → v0.2 구성 (main에 모두 들어 있음)

| 단계 | 내용 |
| --- | --- |
| M0–M1 | 실행·테스트 기반, 궁정 장면 S0, HUD, 명령 흐름(수군 정비 등) |
| 통합(integrate) | Codex 작업본의 SVG 아트를 Claude 작업본 화면에 이식 |
| M2–M6 | 교체 가능한 LLM 공급자, 복합 명령, 4인 대화·지식 경계·문서 공유·회의, 오프닝 사건·시간, QA·소크 |
| v0.2 V1–V15 | 공급자 중립 설정, 평가 장치(명령 120+NPC 40), 절 단위 validator, NPC 입력 격리, 첫 화면+Gemini 설정, 진단 로그, 분당 제한(RPM/TPM), VPN/프록시 연결 방식, Ollama 로컬 공급자 |

## 3. 바로 실행하기

필요: **Windows + PowerShell, Node.js 24 이상**(개발은 26.12), 인터넷(최초 설치 한 번). pnpm은 없어도 된다.

```powershell
.\run.ps1 install     # node_modules 설치 (pnpm 11.25.0 고정, 없으면 npx로 자동 사용)
.\run.ps1 dev         # 화면 http://127.0.0.1:5173 , API http://127.0.0.1:3001
```

기본은 **Mock**이라 키·네트워크가 필요 없다. 첫 화면에서 `Mock으로 시작`을 누르면 된다. 종료는 Ctrl+C.

| 명령 | 용도 |
| --- | --- |
| `.\run.ps1 test` | 단위·통합 테스트 전체 (약 30초) |
| `.\run.ps1 typecheck` | `tsc --noEmit` |
| `.\run.ps1 build` | 타입체크 + Vite 빌드(`dist/`) |
| `.\run.ps1 verify` | `scripts/verify-all.ts` — 브라우저 화면 검증 포함 전체(Edge 필요, 오래 걸림) |

포트 충돌 시: `$env:THRONE_API_PORT='3201'; $env:THRONE_WEB_PORT='5373'` 후 `.\run.ps1 dev`.

## 4. AI 연결하는 법 (키는 절대 파일에 넣지 않는다)

### Gemini

권장: 첫 화면 → `AI 연결 설정` → 모델 ID와 키 입력 → 설정 적용 → `연결 시험` 한 번 → `AI로 시작`. 키는 **서버 메모리에만** 있고 서버를 끄면 사라진다(매번 다시 입력).
환경변수로 줄 때(현재 PowerShell 창에서만 유효):

```powershell
$env:LLM_PROVIDER = 'gemini'
$k = Read-Host 'API 키' -AsSecureString
$env:GEMINI_API_KEY = [System.Net.NetworkCredential]::new('', $k).Password
$env:GEMINI_MODEL_ID = '직접 확인한 모델 ID'
.\run.ps1 dev
```

VPN을 쓰는 경우: 설정 화면의 연결 방식 `자동(권장)`, 안 되면 `VPN·프록시 사용`/`직접 연결` ([LLM_SETUP.md](docs/LLM_SETUP.md)의 034절).

### Ollama(로컬, 키 없음)

```powershell
ollama pull qwen3:4b          # 또는 qwen3:8b, exaone3.5:7.8b
$env:LLM_PROVIDER = 'ollama'; $env:OLLAMA_MODEL_ID = 'qwen3:4b'
.\run.ps1 dev                 # 또는 첫 화면 설정에서 Ollama 선택 → 모델 목록 불러오기
```

기준 PC: Ollama 0.40.8, RAM 16GB, GPU RX 6600 XT(GPU 가속 여부는 미확인). 주소는 loopback만 허용된다.

### 키·비밀 규칙

- API 키는 환경변수 또는 화면 입력으로만 준다. `.env`, 문서, 커밋, 채팅에 쓰지 않는다(`.gitignore`에 `.env*` 제외됨).
- 통합 시점에 작업 트리와 **전체 git 히스토리**를 키 패턴(AIza…, sk-…, ghp_…)으로 검색했고 발견된 것이 없다.
- 실행 중 생성되는 `artifacts/llm-usage.json`, `artifacts/llm-diagnostics.jsonl`에는 키가 들어가지 않지만 git 추적 대상이 아니다(`artifacts/`는 gitignore).

## 5. 평가(eval)와 결과의 의미

```powershell
node scripts/eval-llm.ts                                   # 안내만, 호출 0회
node scripts/eval-llm.ts --mock                            # Mock 채점
node scripts/eval-llm.ts --live --split dev --limit 20 --max-calls 20   # Gemini 실호출(사용량 차감)
node scripts/eval-llm.ts --provider ollama --split dev     # Ollama 80건 전체
node scripts/eval/compare.ts <결과폴더1> <결과폴더2> --out artifacts/ollama-comparison.md
```

결과는 `artifacts/eval/<UTC시각>-<모드>-<pid>/`(summary.md, results.json, human-review.csv). 개발(dev) 세트 80건(명령 60+NPC 20)만 쓰고 **final 세트는 아직 한 번도 채점하지 않았다**(튜닝 오염 방지).

알려진 결과(기록 기준):
- Mock: 원응답 47/80 → 검증 후 51/80 (Mock은 언어 모델이 아님).
- 정답 scripted replay: 80/80 (validator 수정 후).
- Gemini 첫 라이브 실행: 18회 시도, 통과 11/18, HTTP 429로 중단. 원인 분석은 EVAL.md 036절.
- **Ollama 모델 비교(qwen3:4b / qwen3:8b / exaone3.5:7.8b)는 통합 시점에 진행 중이었고, 결과는 이 문서에 포함되지 않았다.** `eval-llm --provider ollama --split dev`가 이 PC에서 돌고 있었다. 끝나면 결과 폴더를 `compare.ts`로 비교한다.

## 6. 남은 문제 / 다음 단계

우선순위 제안:

1. **Ollama/Gemini 실제 품질 비교를 끝내고 기본 모델을 결정**한다(위 5절). 실패 사례는 `human-review.csv`로 사람이 본다.
2. 라이브 평가에서 드러난 validator 과잉 거부/모델 오류를 구분해 고친다(EVAL.md 036·다음 라이브 실행 권고).
3. 사람 검증: 15분 플레이의 재미·긴장, 실제 IME, 다른 브라우저, 역사 문서의 사료 대조 ([KNOWN_LIMITS.md](docs/KNOWN_LIMITS.md), `docs/QA_MATRIX.md`).
4. 아트: 현재 SVG는 임시 자산이다. 인물 표현·복식·공간감의 사람 평가 필요.
5. 미구현: 전투·캠페인, 저장/불러오기, 음성 입력, 배포 가능한 서비스화.
6. 정리 후보: 일부 Mock 오류 문구에 초기 단계명이 남음, 오래된 `START_HERE.md`/`CODEX_M1_PROMPT.txt`(M1 시작 시점 문서, 역사 기록용).

## 7. 알아 둘 함정

- `run.ps1`은 PowerShell 5.1에서 한글이 깨지지 않도록 UTF-8 BOM으로 저장되어 있다. BOM을 지우지 않는다.
- Windows 터미널에서 한글 문서가 깨져 보이면 터미널 코드페이지 문제이며 파일은 UTF-8이다(`chcp 65001` 또는 에디터로 열기).
- 서버·CLI 평가는 각자 분당 제한을 따로 센다. 동시에 돌리면 Google 한도에 닿을 수 있다.
- 일일 로컬 카운터는 UTC 기준이며 Google 쪽 집계와 다르다. 카운터 초기화는 설정 화면의 버튼으로만 한다.
- 코드와 문서의 많은 문장이 "라이브 미검증"이다. 이는 실제 모델로 확인하지 않았다는 뜻이며 실패를 뜻하지 않는다.

## 8. git 상태와 복구

- 브랜치는 `main` 하나로 정리됨. 통합 직전의 모든 브랜치 끝점을 태그로 남겼다: `backup/main-before-consolidation`, `backup/integrate-visual-assets`, `backup/content-m5-materials`, `backup/v0.2-eval`, `backup/v0.2-validator`, `backup/v0.2-npc`, `backup/v0.2-start-screen`, `backup/v0.2-real-ai`, `backup/ollama-bundle-4fc4b63`.
- `backup/ollama-bundle-4fc4b63`은 Codex가 원본 git에 쓰지 못해 번들 파일로만 남았던 커밋이다. 코드는 main(V15)과 동일하고 `.codex-runs/038/` 보고서만 더 있다.
- 되돌리기: `git reset --hard backup/main-before-consolidation` (통합 이전 상태).
- 원격(remote)은 설정하지 않았고 push하지 않았다.
- 과거 작업 폴더(`C:\Users\q_ice\dispatch-work\throne-*`)는 git worktree였고 지금 main에 모두 포함되어 있어 더는 필요 없다. 정리 방법은 [docs/USB_PORTABILITY.md](docs/USB_PORTABILITY.md) 끝에 있다.
