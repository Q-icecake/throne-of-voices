# LLM 연결 설정 (v0.2)

## 연결 시험 오류와 사고 토큰 (031)

Gemini의 `maxOutputTokens`는 **사고 + 보이는 출력의 합계**다. 사고 중 한도에 닿으면 `MAX_TOKENS`와 빈 텍스트가 올 수 있다. 연결 시험은 기존 8에서 **256토큰**으로 올렸으며 고정 문장만 전송한다(JSON MIME/스키마 없음). 명령 해석·NPC 대화는 JSON 스키마를 유지하고 합계 기본 **2048토큰**을 사용한다. 이는 성공 보장이 아니라 비용·출력 상한이며 큰 응답은 여전히 잘릴 수 있다.

기본 `GEMINI_THINKING_MODE=low`는 모델 ID 접두사에 따라 Gemini 3.x Flash/Flash-Lite에 `thinkingLevel: minimal`, 3.x Pro에 `low`, 2.5 Flash/Flash-Lite에 `thinkingBudget: 0`, 2.5 Pro에 `128`을 보낸다. 알 수 없는 접두사에는 thinking 설정을 보내지 않는다. `minimal`은 완전한 사고 끄기를 보장하지 않는다. 모델별 실제 지원·접근성은 라이브 미검증이다. [Google thinking 문서](https://ai.google.dev/gemini-api/docs/generate-content/thinking), [Gemini 3 지원 수준](https://ai.google.dev/gemini-api/docs/generate-content/gemini-3)을 기준으로 한 접두사 정책이다.

필요하면 서버 환경 설정 `GEMINI_THINKING_MODE=default`로 thinking 필드를 생략할 수 있다. `GEMINI_MAX_OUTPUT_TOKENS`는 게임 상한만 바꾸며 허용 256~32768, 기본 2048이다. 연결 시험은 항상 256이다. 두 설정은 서버를 다시 시작해야 적용되며 잘못된 값은 호출 전에 차단한다. **400 거부 시 같은 클릭 안에서 설정을 바꿔 재시도하지 않는다.** 게임 경로도 400/404/잘림/파싱 오류는 재시도하지 않으며 화면 경로는 모든 오류에서 자동 재시도 0회다.

| 화면 문구 | 의미와 대처 |
| --- | --- |
| 응답이 잘림(출력 한도·사고 토큰) | `MAX_TOKENS`. 게임 상한/사고 설정을 조정하거나 요청을 줄이고 다시 시도한다. |
| 응답 없음(사고만 반환 또는 빈 응답) | 보이는 텍스트가 없다. 모델·사고 설정을 확인한다. thought 부분은 답변으로 쓰지 않는다. |
| 요청 형식 거부(400)·모델 설정 불일치 | 모델이 thinking/스키마 등 요청을 거부했다. 지원 설정·모델 ID를 확인하고 필요하면 thinking을 `default`로 바꿔 재시작한 뒤 직접 다시 누른다. |
| 모델 없음(404) | 모델 ID·접근 권한을 확인한다. |
| Google 서버 오류(5xx) | 공급자 HTTP 오류. 잠시 후 직접 재시도한다. |
| 응답 파싱 실패 | JSON/응답 구조가 잘못됐거나 본문 크기 제한을 넘었다. 모델·형식 지원을 확인한다. |
| 응답 형식 오류 | JSON 제안의 스키마/허용 범위 불일치 또는 키 반사 방어로 차단했다. |
| 연결·내부 오류 | HTTP 응답 전 전송 예외 등. 로컬 연결 상태를 확인한다. Google 5xx와 구별한다. |

서버 콘솔과 `artifacts/llm-diagnostics.jsonl`에는 HTTP 상태, 허용 목록의 Google status/reason·finishReason, 입력/출력/사고 토큰 숫자만 기록한다. 미제공·알 수 없는 값은 `null`이다. 키 반사 guard를 적용하며 키·헤더·프롬프트·응답 원문·오류 message는 기록하지 않는다. 파일 쓰기 실패는 요청 결과를 바꾸지 않는다. 이 파일은 로컬 진단용이며 브라우저 API로 내보내지 않는다. 카운터 경로를 바꾸면 진단 기본 경로도 같은 폴더로 이동하며 테스트·검증은 임시 폴더에 격리한다.

다시 시험: 업데이트한 서버를 재시작 → `AI 연결 설정`에서 모델·키·남은 일일/세션 상한 확인 → `연결 시험` **한 번** 클릭 → 구체 결과 확인. 이미 오늘/세션 1/1이면 다시 누르기 전에 사용자가 상한을 결정해야 하며, 업데이트는 실제 카운터를 초기화하지 않는다. 이번 검증은 가짜 transport만 사용했고 실제 모델 요청은 0회다.

## 로컬 호출 사용량과 초기화 (030)

`AI 연결 설정`에 **오늘(UTC) 로컬 호출 수/일일 상한**과 **이번 서버 세션 호출 수/세션 상한**을 표시한다. 이는 Google 실제 요청 통계나 할당량이 아니라 앱의 로컬 안전장치다. `로컬 일일 상한(UTC) 도달`, `로컬 세션 상한 도달`, `Google 한도 초과(429)`는 별개다. 파일을 읽을 수 없으면 `확인 불가`로 표시하고 호출을 차단한다.

오염된 541 같은 기존 값은 업데이트·상태 조회·설정 저장으로 지우지 않는다. 확인 후 설정 화면의 **오늘 로컬 카운터 초기화**를 직접 누른다. 버튼 옆 확인 문구는 **Google 쪽 실제 사용량은 바뀌지 않습니다**이며 팝업은 없다. 당일 파일 값만 0으로 바꾸고 서버 세션 사용량과 두 상한은 유지한다. 초기화 전 수치와 UTC 날짜를 서버 세션 사건 로그(`/api/test/logs`, snapshot)에 남기며 게임/설정 리셋에도 보존한다. 서버 종료 후 로그는 유지되지 않는다. 잠금·손상·쓰기 실패는 초기화를 거부한다.

매 시도 직전에 일일·세션을 각각 1회 예약한다. 성공·실패·전송 후 취소도 1회이며 재시도는 매번 추가 1회다. 연결 시험은 재시도가 없어 최대 1회, 인증 설정 부족이나 상한 도달로 전송 전 차단되면 0회다. 결과/usage 기록은 다시 차감하지 않는다. 화면 설정 경로는 서버 수명 동안 같은 예산을 공유하고, CLI Provider는 인스턴스 수명 동안 세션을 유지한다. 일일은 UTC 날짜가 바뀌면 새 날짜의 첫 예약부터 다시 센다. 조회만으로 파일을 변경하지 않는다.

실제 플레이 기본 파일은 `artifacts/llm-usage.json`이며 `LLM_USAGE_FILE`로 다른 파일을 지정할 수 있다. `node --test tests/*.test.ts`는 Node 테스트 컨텍스트에서 프로세스별 임시 파일을 자동 선택하고, 기존 시험별 `budgetFile`도 유지한다. 검증·스크린샷·playthrough/soak는 `scripts/offline-runtime.ts`로 임시 경로·Mock을 지정한다. 평가는 호출 원천마다 임시 파일을 쓰며 별도 `budgetFile` 주입도 지원한다. 임시 파일은 정상 종료 시 정리된다. 테스트/평가 횟수가 플레이 일일 카운터를 올리지 않는다. `node scripts/verify-all.ts`는 각 작업 전후 실제 기본 파일의 SHA-256을 비교하고 변경되면 실패한다. 증거는 `artifacts/usage-counter/hash-verification.json`이다.

## 첫 화면에서 Gemini 설정 (027)

일반 진입은 첫 화면이다. `Mock으로 시작`은 계속 키 없이 동작한다. `AI 연결 설정`에서 콘솔로 확인한 Gemini 모델 ID·키·호출 상한을 입력한다. **결제를 연결하지 않은 프로젝트를 권장한다. 결제 연결 시 무료 한도 내 사용도 과금될 수 있다.** 무료 티어 입력은 제품 개선에 쓰일 수 있으므로 개인정보·다른 사람의 정보를 입력하지 않는다. 앱은 모델의 가용성·가격·무료 제공을 보장하지 않는다. Google AI Studio 주소는 안내용 텍스트로만 표시한다.

화면 키는 로컬 서버 메모리에만 보관하고 전송 직후 입력칸을 비운다. 서버를 끄면 사라지며 매번 다시 입력한다. 환경변수 키가 있으면 값 없이 `환경변수 키 사용 중`만 표시한다. 화면 입력 키가 우선하며, 빈 키 입력은 현재 키를 유지한다. `키 지우기` 후 현재 서버는 환경변수 키로 되돌아가지 않는다(환경변수 자체는 바꾸지 않으므로 재시작하면 다시 읽는다). 브라우저·디스크·레지스트리에 키를 쓰지 않는다.

화면 상한은 UTC 일일·서버 세션 각 기본 30회이며 0이면 차단한다. `연결 시험` 버튼을 눌렀을 때만 고정 문장으로 1회 요청하고 시험·실패도 게임과 같은 상한에서 차감한다. 설정·모드 변경은 사용량을 초기화하지 않는다. 설정 적용·AI 시작만으로 외부 요청을 보내지 않는다. 시험 전 AI 시작에는 `시험하지 않았습니다` 문구를 표시한다. 상세 API·보안·검증은 [START_SCREEN.md](START_SCREEN.md)를 따른다.

아래 환경변수 어댑터의 기본 차단값(0회)과 OpenAI 호환 설정은 기존 CLI/평가/시험 경로에 계속 적용된다. 화면은 Gemini만 제공하며 화면을 통한 시작에는 위의 런타임 상한을 사용한다. 아래 영구 환경변수 예시는 사용자가 직접 선택하는 기존 방식으로, 새 화면은 이 작업을 수행하지 않는다.

기본 `LLM_PROVIDER=mock`은 키·네트워크·결제 없이 기존 게임을 실행한다. 실제 공급자를 선택해도 모델은 행동을 제안할 뿐이며, 엔진의 검증과 사용자의 초안 확인 뒤에만 실행된다. 이번 구현은 가짜 transport로 검증했다. 모델 접근성·한국어 품질·가격·토큰·실제 지연·무료 한도·호환 서버의 JSON Schema 지원은 **라이브 미검증**이다. 실제 키나 현재 환경값은 이 문서에 기록하지 않는다.

## 설정 계약

| 변수 | 의미 / 기본값 |
| --- | --- |
| `LLM_PROVIDER` | `mock` (기본), `gemini`, `openai-compatible` |
| `GEMINI_API_KEY` / `GEMINI_MODEL_ID` | Gemini 서버 키 / 사용자가 확인한 모델 ID. 기본값 없음 |
| `OPENAI_COMPAT_API_KEY` | OpenAI 호환 서버의 키. 기본값 없음 |
| `OPENAI_COMPAT_MODEL_ID` | 사용자가 확인한 모델 ID. 기본값 없음, `owner/model` 형태 가능 |
| `OPENAI_COMPAT_BASE_URL` | 사용자가 확인한 API 기본 주소. 기본값 없음. `/chat/completions`를 뒤에 붙인다. 통상 API 버전 경로까지 입력한다 |
| `LLM_TIMEOUT_MS` | 재시도를 포함한 총 제한시간. 기본 15000ms, 허용 1~15000 |
| `LLM_RETRIES` | 추가 시도 횟수. 기본 0, 허용 0~100 |
| `LLM_DAILY_CALL_LIMIT` | UTC 일일 예약 상한. 기본 0 (차단), 허용 0~10000 |
| `LLM_SESSION_CALL_LIMIT` | Provider 인스턴스/서버 세션 예약 상한. 기본 0 (차단), 허용 0~10000 |
| `LLM_USAGE_FILE` | 실제 서버의 일일 카운터 파일 경로. 기본 `artifacts/llm-usage.json`; 테스트·검증·평가는 격리 경로 사용 |

주소는 HTTPS를 사용한다. 로컬 호환 서버는 loopback HTTP만 허용한다. 주소 안의 사용자명·비밀번호·쿼리·fragment와 리다이렉트는 거부한다. 키는 인증 헤더로만 전달한다. Chat Completions의 `response_format: json_schema`, `strict: true`를 선택했다. 호환 서버의 지원 여부는 별도 확인해야 한다. strict 스키마 호환 범위를 넓히기 위해 `uniqueItems`는 전송 스키마에서 제거하고 로컬 검증에서 계속 강제한다. [공식 OpenAI 구조화 출력 문서](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat).

## Windows PowerShell — 현재 셸

프로젝트 폴더에서 다음을 직접 실행한다. 먼저 공급자 계정의 모델 접근 권한·데이터 보관 정책·무료 한도·요금과 결제 연결 여부를 확인한다. 이 절차는 결제 연결·계정 설정 변경을 자동 실행하지 않는다. 무료 한도는 바뀔 수 있으며 애플리케이션의 호출 수 제한은 계정의 과금 제한이 아니다.

```powershell
$env:LLM_PROVIDER = 'mock'
$secureKey = Read-Host 'API 키 (화면에 표시하지 않음)' -AsSecureString

# Gemini를 사용할 때만:
$env:GEMINI_API_KEY = [System.Net.NetworkCredential]::new('', $secureKey).Password
$env:GEMINI_MODEL_ID = Read-Host '직접 확인한 Gemini 모델 ID'

# OpenAI 호환 서버를 사용할 때만 (위 Gemini 설정 대신):
$env:OPENAI_COMPAT_API_KEY = [System.Net.NetworkCredential]::new('', $secureKey).Password
$env:OPENAI_COMPAT_MODEL_ID = Read-Host '직접 확인한 호환 모델 ID'
$env:OPENAI_COMPAT_BASE_URL = Read-Host '직접 확인한 API 기본 주소'

Remove-Variable secureKey
$env:LLM_TIMEOUT_MS = '15000'
$env:LLM_RETRIES = '0'
# 첫 점검은 일일/세션 각 1회가 보수적이다. 기본값은 0회 차단이다.
$env:LLM_DAILY_CALL_LIMIT = '1'
$env:LLM_SESSION_CALL_LIMIT = '1'
```

선택한 공급자의 설정만 입력한다. 실제 연결을 결정한 뒤 같은 셸에서 아래 **한 가지**를 선택하고 서버를 새로 시작한다. 이미 실행 중인 서버에는 변경된 환경이 적용되지 않는다.

```powershell
$env:LLM_PROVIDER = 'gemini'
# 또는 $env:LLM_PROVIDER = 'openai-compatible'
.\run.ps1 dev
```

키 확인은 값 대신 존재 여부만 확인한다. `Get-ChildItem Env:`나 환경 전체 출력·터미널 기록 공유는 피한다.

```powershell
[bool]$env:GEMINI_API_KEY
[bool]$env:OPENAI_COMPAT_API_KEY
```

키 값·유효 모델·접근 권한 확인은 사용자가 직접 한다. 첫 요청도 실제 입력과 허용된 지식을 외부 서버에 전송하며 요금이 발생할 수 있다. 화면의 `AI 연결 설정됨 · 라이브 미검증`은 설정 존재만 뜻하며 연결 성공을 뜻하지 않는다. 미설정·설정 오류의 시작 시 Mock 선택은 상태 칩에 명시한다. 요청 실패·호출 상한에서 Mock으로 자동 전환하지 않는다.

## 영구 설정과 해제

현재 셸 설정은 그 셸과 자식 프로세스에만 적용된다. 영구 저장이 필요한 경우 사용자가 해당 변수만 직접 저장한다. **User 환경변수는 암호화된 비밀 저장소가 아니며 키가 평문으로 남는다.** 다음 예시는 선택한 공급자에만 적용한다. 키 자체를 명령문 문자열에 붙여 넣지 않는다.

```powershell
[Environment]::SetEnvironmentVariable('GEMINI_API_KEY', $env:GEMINI_API_KEY, 'User')
[Environment]::SetEnvironmentVariable('GEMINI_MODEL_ID', $env:GEMINI_MODEL_ID, 'User')
# 호환 서버를 선택했을 때만:
[Environment]::SetEnvironmentVariable('OPENAI_COMPAT_API_KEY', $env:OPENAI_COMPAT_API_KEY, 'User')
[Environment]::SetEnvironmentVariable('OPENAI_COMPAT_MODEL_ID', $env:OPENAI_COMPAT_MODEL_ID, 'User')
[Environment]::SetEnvironmentVariable('OPENAI_COMPAT_BASE_URL', $env:OPENAI_COMPAT_BASE_URL, 'User')
# 공통 변수도 영구 저장이 필요할 때만:
foreach ($name in @('LLM_PROVIDER', 'LLM_TIMEOUT_MS', 'LLM_RETRIES', 'LLM_DAILY_CALL_LIMIT', 'LLM_SESSION_CALL_LIMIT')) {
  [Environment]::SetEnvironmentVariable($name, [Environment]::GetEnvironmentVariable($name, 'Process'), 'User')
}
```

새 PowerShell을 열어 존재 여부만 다시 확인하고 서버를 재시작한다. 해제 및 Mock 복귀:

```powershell
$env:LLM_PROVIDER = 'mock'
[Environment]::SetEnvironmentVariable('LLM_PROVIDER', 'mock', 'User')
foreach ($name in @('GEMINI_API_KEY', 'GEMINI_MODEL_ID', 'OPENAI_COMPAT_API_KEY', 'OPENAI_COMPAT_MODEL_ID', 'OPENAI_COMPAT_BASE_URL', 'LLM_TIMEOUT_MS', 'LLM_RETRIES', 'LLM_DAILY_CALL_LIMIT', 'LLM_SESSION_CALL_LIMIT')) {
  Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
  [Environment]::SetEnvironmentVariable($name, $null, 'User')
}
```

실행 중인 서버를 종료·재시작해야 메모리에 읽힌 키도 해제된다. 이미 노출한 키는 환경변수 삭제만으로 폐기되지 않으므로 사용자가 공급자에서 폐기·재발급한다.

## 예산·오류·계측

모든 실제 시도 직전에 예약하고 실패·재시도도 차감한다. 429·인증·스키마 오류는 재시도하지 않으며 서버/전송 오류만 설정 횟수 안에서 재시도한다. 전체 시간 제한을 재시도마다 초기화하지 않는다. UTC 일일 예약은 `artifacts/llm-usage.json`의 날짜와 호출 수만 저장한다. 세션은 Provider 인스턴스 기준이며 게임 리셋으로 초기화하지 않는다. 두 공급자는 같은 일일 파일을 사용한다. 잠금 경합·손상·쓰기 실패는 차단한다. 비정상 종료의 `.lock`은 운영자가 실행 프로세스가 없는지 확인한 뒤 복구하며 일일 기록을 지워 한도를 우회하지 않는다.

기존 중립 오류 `timeout`, `rate_limited`, `auth`, `schema`, `server`, `budget`, `aborted`에 031에서 `truncated`, `empty`, `request`, `model`, `google_server`, `parse`를 추가했다. `ProviderError.neutralCode`와 HTTP `outcome.providerCode`가 같은 값을 쓰며 기존 상태 칩·오류칸에 코드와 한국어 안내를 표시한다. 엔진/기존 평가기의 `ProviderError.code` 및 HTTP `outcome.code`는 기존 대문자 코드 호환 별칭이다. 칩의 짧은 분류에 대한 상세 의미·대처는 title/오류칸과 이 문서의 031 절에 있다.

중립 `ProviderUsage`는 `lastUsage`로 마지막 완료 호출에서 읽고, 실패는 `ProviderError.usage`에도 기록한다. 입력/출력 토큰, 총/시도별 지연, 시도·재시도·예약·외부 호출 수, 총/시도별 오류를 제공한다. 실패 응답이나 누락 메타데이터의 토큰은 **null (미상)**이며 성공한 재시도의 토큰만으로 전체를 추정하지 않는다. 평가기는 매 호출 직후 이 정보를 복사해 기록해야 한다. `lastUsage`는 누적 감사 파일이 아니며 동시 호출별 실패는 예외의 usage로 구분한다. 기존 Proposal의 4필드 usage는 호환을 유지하며 숫자만 허용하므로 미상은 0 자리를 사용한다. 비용은 단가를 추정하지 않고 null이다. 외부 응답 본문·헤더·예외 원문·요청 원문·키는 계측에 포함하지 않는다.

## 전송 정책과 한계

**현재 입력 `input.text`는 원문 그대로 전송한다.** 비밀 맥락 필터는 과거 맥락·지식의 공개 경계를 처리하며 현재 입력의 개인정보나 비밀번호를 지우는 필터가 아니다. 현재 입력에 비밀·개인정보·키를 입력하지 않는다. 허용된 지식·최근 맥락·행동 어휘와 NPC 경로의 허용 인물 정보를 함께 보낸다. 이 단계는 기억/문서 토큰 상한이나 일반 의미 기반 DLP를 추가하지 않는다.

키는 서버 환경 또는 로컬 설정 화면에서 읽어 비공개 필드로 보관하고 **인증 헤더로만 전송한다. 모델 입력·프롬프트·대화에는 절대 넣지 않는 것이 1차 방어**다. 상위 오류 원문은 폐기한다. 029에서는 검출 대상과 출력 모두 정규화한 뒤 비교한다: 대소문자 통일, `:`·공백·하이픈·점·줄바꿈·패딩 제거, URL/Unicode escape 해제, `0x` hex 쌍 결합, 4자 분리 Base64 재결합, URL-safe/표준 표기와 구분자 하이픈의 두 해석을 검사한다. 최대 두 겹의 Base64/hex 디코딩으로 이중 인코딩도 확인한다. 12자 이상 키의 영숫자 연속 7자 이상 부분 반사, 원래 키에서 대문자·소문자·숫자가 모두 있는 연속 6자 조각, 24자 이상 인코딩의 정규화 연속 16자 부분도 차단한다. 짧은 일반 단어를 무조건 비밀로 보지는 않는다. 같은 SecretGuard를 liveSource 반환·evaluate 결과·humanSheet 및 JSON/CSV 파일을 쓰기 전 경계에 적용하며 반사 원문을 오류에 담지 않는다. 양 공급자 회귀 시험은 요청 URL·본문에 키가 없고 인증 헤더에만 존재함도 별도로 단언한다.

이는 **임의 인코딩을 완전히 방어하지 못한다**. 세 겹 이상 인코딩, 암호화·임의 치환, 짧은 단편·의미 변형에는 누락이 가능하며, 짧은 부분 일치에는 오탐 가능성도 있다. 리뷰의 역순 6자 조각은 혼합 영숫자 부분 일치로 검출하지만, 더 짧거나 형태가 다른 역순·재배열 조각 전체를 복원하지는 않는다. 키를 모델 입력에 넣은 뒤 출력 필터로 복구하는 설계가 아니다. 64KiB envelope 상한·로컬 스키마/지식 검증을 유지한다. 회귀 시험은 합성 키와 가짜 transport만 사용하며 실제 키·외부 호출을 사용하지 않는다.

완료 대사는 문장·연결 절 단위로 나눈 뒤 부정·미완료 표지를 먼저 판정하고, 완료 어간·보조 표현(놓았/놨/두었/뒀 등)과 질문·조건형을 판정한다. 허용 근거는 엔진 기록의 정확한 해당 문장뿐이다. 부정 뒤의 독립된 긍정 완료는 별도로 차단한다. 이는 유한한 한국어 문법 휴리스틱으로, 복잡한 인용·다중 술어의 부정 범위·새 활용을 완전하게 이해하지 못한다. 리뷰 20개 완료/40개 정상 대화의 결과가 라이브 의미 정확도를 보장하지 않는다.

## 키 없는 확인 및 사용자 라이브 점검

```powershell
node --test tests/provider*.test.ts tests/llm*.test.ts tests/gemini.test.ts
node node_modules/typescript/bin/tsc --noEmit
node --test tests/*.test.ts
node node_modules/vite/bin/vite.js build
```

실제 키 없는 가짜 transport 시험은 두 공급자의 요청·정상·스키마/잘림·4xx/5xx·429·취소/시간초과·예산·키 반사를 검사한다. 실제 연결은 사용자가 위 설정으로 서버를 시작한 뒤 상태 칩과 요청 하나의 응답을 직접 확인한다. 상한 1에서는 두 번째 호출이 budget으로 차단되어야 한다. 오류 때 입력/초안을 보존하고 세계 상태가 실행되지 않는지 확인한다. 점검 뒤 Mock으로 복귀한다. 평가 장치는 별도 소유 작업이며 이 문서가 기존 Gemini 전용 평가기의 다른 공급자 지원을 보증하지 않는다.
# NPC 대화 상태와 입력 정책 (023)

NPC의 현재 입력은 플레이어가 이번 접견 참석자에게 직접 공개한 문장으로 보아 원문 전송한다. 현재 문장에 비밀 세부를 쓰면 그 세부도 Provider에 전달된다. 다른 인물 접견의 원문을 현재 입력으로 자동 합치지 않는다. 과거 기록은 현재 참석자 전원이 목격한 것만 사용하고 비밀 작업/전송 제외 자료는 계속 제외한다. 문서에는 발언자·플레이어·현재 참석자 전체의 열람 권한을 요구하며 비참석자의 정보를 덧붙이지 않는다. 입력 상한과 선택적 단일 호출 두 인물 발언은 [CHARACTERS.md](CHARACTERS.md)의 023 정책을 따른다.

기존 연결 칩과 오류칸은 명령·단독 대화·회의에 동일한 중립 코드를 표시한다: `timeout` 시간 초과, `rate_limited` 공급자 호출 한도, `auth` 인증/설정, `schema` 응답 형식·허용 범위, `server` 서버 연결 실패, `budget` 로컬 예산 소진, `aborted` 취소. 칩은 짧은 분류, title/오류칸은 상세 문구와 입력 보존/재시도 안내를 담는다. Mock로 자동 전환하지 않는다. 작성 응답 또는 일부 회의 발언 대체에는 “작성 대사로 응답함”을 표시하고 실제 AI/작성 출처를 인물별로 응답한다. 실패 후 입력/초안은 남아 있고 계속 고쳐 쓸 수 있다. Provider 보류는 finally에서 해제되며, 남은 입력의 작성 중 보류는 입력 삭제/정상 전송 뒤 해제된다. `node scripts/verify-npc-status.ts`는 가짜 transport만으로 두 해상도에서 오류 6종·부분 대체·재시도·크기/실제 usage를 검증하며 라이브 호출은 하지 않는다.
