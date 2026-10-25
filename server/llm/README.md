# Provider (M2 기반, M3~M6 통합)

`types.ts`는 공급자 공통 계약이다. 서버의 `GameEngine`은 기본적으로 기존 동기 Mock을 유지한다.
세 번째 생성자 인수로 `InterpretationProvider`를 넣으면 `command()`는 Promise를 반환한다.
HTTP 경로는 두 방식 모두 await한다. M0 `mock-probe`는 별도 시험 기능으로 유지한다.
프롬프트 `system.ko.txt`, 어휘 레지스트리 `actions.json`, 출력 `output.schema.json`은 코드와 분리한다.
스키마 검사 후 어휘·지식 ID·부정/조건 대조를 한다. 현재 최대 3행동의 수군 정비·회신/보류·유비 타진 실행을 지원한다.
복합 지시·미구현 조건·기한은 추측으로 버리지 않고 확인 질문으로 돌린다. 지원 조건·기한은 docs/COMMANDS.md를 따른다.
부정 대조는 보수적 규칙이며 모든 한국어 표현의 의미 보존을 보장하지 않는다. 라이브 품질 평가는 미검증이다.

## 서버 설정

V11 화면 설정의 `network-routing.ts`는 자동/프록시/직접 모드와 Google 요청별 dispatcher를 관리한다. 시작 시 `--use-env-proxy`만으로는 런타임 전환과 Windows 시스템 프록시 선택이 부족하므로 `undici` 8.5.0을 고정 **운영 의존성**으로 추가했다. ProxyAgent와 명시적 직접 Agent만 쓰며 전역 dispatcher는 바꾸지 않는다. Windows 읽기는 주입 가능하고 읽기 전용이며 PAC를 실행하지 않는다. 주소는 private 메모리 필드, 공개 상태/진단은 `networkMode`/`route` 종류와 안전한 `networkError`만 갖는다. 화면 및 configuredProvider의 Gemini는 재시도 0; 명시적으로 직접 생성하는 레거시 Provider/평가기의 재시도 계약은 유지한다. [설정 문서](../../docs/LLM_SETUP.md)의 034 절을 따른다.

| 환경변수 | 의미 / 기본값 |
| --- | --- |
| `LLM_PROVIDER` | `mock` (기본), `gemini`, `openai-compatible` |
| `GEMINI_API_KEY` | 서버 환경변수에서만 읽음. 없으면 명시적 Mock 상태 |
| `GEMINI_MODEL_ID` | 승인 후 확인한 모델 ID, 기본값 없음 |
| `OPENAI_COMPAT_API_KEY` / `OPENAI_COMPAT_MODEL_ID` / `OPENAI_COMPAT_BASE_URL` | 호환 서버의 키·모델·API 기본 주소, 기본값 없음 |
| `LLM_TIMEOUT_MS` | 전체 해석 제한, 기본 15000ms, 1~15000 |
| `LLM_RETRIES` | 추가 시도 횟수, 기본 0 |
| `LLM_DAILY_CALL_LIMIT` | UTC 일일 호출 상한, 기본 0 (차단) |
| `LLM_SESSION_CALL_LIMIT` | Provider 인스턴스/서버 세션 호출 상한, 기본 0 (차단) |

타임아웃은 재시도를 포함한 전체 요청에 적용된다. 429는 재시도하지 않는다.
실패·재시도도 한도에 포함하며, 호출 직전에 예약한다. 일일 예약은 `artifacts/llm-usage.json`에 저장한다.
서버 재시작·게임 리셋은 일일 한도를 초기화하지 않는다. 잠금 경합·손상·쓰기 실패는 안전하게 차단한다.
비정상 종료로 `.lock`이 남으면 실행 프로세스가 없는지 운영자가 확인한 뒤 잠금만 복구한다. 일일 기록은 지우지 않는다.
모델·공급자·결제 티어를 자동 전환하지 않는다. 상한은 실제 계정의 무료/유료 여부를 판별하지 않으므로 라이브 전 계정 확인과 승인이 필요하다.
무키 상태, 설정 오류의 Mock 선택은 화면에 표시하며, 요청 도중 오류는 AI 오류로 남기고 입력/초안을 보존한다.

v0.2 설정 팩터리는 `config.ts`, 공통 예산은 `budget.ts`에 있다. 기존 `gemini.ts` export는 평가기 호환을 위해 유지한다.
Chat Completions JSON Schema 호환 어댑터는 `openai-compatible.ts`이며, 두 어댑터는 `remote.ts`의 제한시간·재시도·계측·반사 방지를 공유한다.
중립 오류는 `ProviderError.neutralCode`와 HTTP `outcome.providerCode`에서 읽는다. 기존 `code`는 대문자 호환 별칭이다.
중립 `ProviderUsage`는 `provider.lastUsage`와 실패 예외의 `usage`에 있으며, 실패·미상 토큰은 null이다. 기존 Proposal usage의 숫자 필드와 구분한다.
PowerShell 키 입력·영구 설정/해제·전송 정책·사용자 라이브 점검 절차는 [LLM_SETUP](../../docs/LLM_SETUP.md)을 따른다.

## 오프라인과 라이브 평가

- 자동 테스트는 `tests/fixtures/scripted-provider.ts`와 가짜 fetch만 사용한다. 실제 네트워크를 쓰지 않는다.
- `node scripts/eval-llm.ts`: 키가 없으면 실행하지 않는다. 스크립트 자체도 무키일 때 즉시 종료, 호출 0회.
- 키·모델 접근·계정 무료 한도 확인과 라이브 승인이 끝난 환경에서 위 설정을 지정하고 `node scripts/eval-llm.ts --live` 실행.
- 30문장의 기대 의도·행동·제한 및 조건을 `tests/fixtures/llm-eval.json`에서 검토한다. 결과는 `artifacts/m2/live-eval.json`.
- 의도/행동/제한 일치와 지연·사용량을 기록한다. 미지원 조건은 확인 질문 여부를 검사하며 한국어 자연스러움/답변 근거는 별도 수동 검토한다.
- 모델 접근·무료 한도·한국어 품질·실제 지연은 모두 라이브 미검증이다. 비용은 알 수 없어 `costUsd: null`로 표시한다.

REST 형식 참고: [Google Generate Content structured output](https://ai.google.dev/gemini-api/docs/generate-content/structured-output?hl=en).
`fetch`, `x-goog-api-key` 헤더, `generationConfig.responseMimeType/responseJsonSchema`를 사용한다. 새 SDK 의존성 없음.

M6 주의: eval-llm.ts의 자동 성공 판정은 조건 배열 전체를 비교하지 않는다. 승인된 환경에서도 secret/기한/선후 조건과 원문을 사람이 대조해야 한다.
