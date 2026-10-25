# v0.2 평가 장치

## 039: EXAONE 대사 안전 보완과 비교 결론

[모델 비교·기본 공급자 판정](LLM_COMPARISON.md)을 따른다. EXAONE `N-zhang-zhao-05`·`N-zhou-yu-05`의 `npc.false-completion`은 구조 검사만 통과한 대사다. 게임 표시 전의 기존 claim guard는 두 원문을 이미 차단한다. 039부터 NPC `validated`는 `validateProposal` 뒤에 같은 `hasUnsupportedClaim` 검사를 적용하여 허위 완료·비공개 표식 응답을 거절한다. 후단 거절은 정답으로 세지 않고 `validator=rejected`, `INVALID_PROPOSAL`, 정답 실패로 남긴다. 원본과 어댑터 단계·독립 채점은 바꾸지 않는다.

각 eval 사례는 새 엔진에서 시작해 완료 작업 증거가 없다. 따라서 빈 증거로 검사하며 gold의 `npc.facts`나 모델이 낸 참조를 검증기의 사실 증거로 넣지 않는다. 엔진 실행·전체 표시 동작·회의를 평가한 점수는 아니다. 실제 게임의 완료 작업과 공개 범위별 근거는 기존 엔진 회귀가 별도로 검사한다. 이전 v3 파일의 `stages.validated`는 구조 검사만 뜻하며 아래 036 설명은 당시 계약이다. 새 파일은 `stages.validated`에 추가 guard를 명시한다. 원본 실행 결과는 수정하지 않으며 오프라인 재생을 새 라이브 성능으로 보고하지 않는다.

회귀: `node --test tests/local-llm-safety.test.ts` (원문 2건·게임 비노출), `node --test tests/setup.test.ts` (PowerShell AST·계획·드라이런·설치 스위치). [새 PC 설치](NEW_PC_SETUP_PROMPT.md).

## 평가 호출 간격 (037)

라이브 CLI도 기본 **RPM 12 / TPM 200000**의 60초 sliding window를 적용한다. `--rpm N`이 `LLM_RPM_LIMIT`보다 우선하며 생략 시 환경값, 그마저 없으면 12다. `LLM_TPM_LIMIT=0`은 로컬 TPM 제한만 끈다. 게임의 최대 대기 8초와 달리 CLI는 다음 창까지 기다린다. 단일 요청의 보수적 토큰 예약이 TPM 자체를 넘으면 거절한다. 대기는 모델 응답 timeout 밖에서 이루어지고 네트워크 전송은 기존 timeout으로 제한된다. 실패/429에 대한 자동 재시도는 없으며 429 발생 시 기존대로 평가를 중단한다.

```powershell
node scripts/eval-llm.ts --live --split dev --limit 20 --max-calls 20 --rpm 12
node scripts/eval-llm.ts --live --ids E001,E009,E023,E027,E029,E033,E035,E037,E039 --max-calls 9 --rpm 12
```

CLI는 첫 요청 전에 예정 호출 수와 예상 소요 시간을 출력한다. 빈 창·직렬 요청·응답당 2.3초 가정으로 `start[i] = max(end[i-1], start[i-rpm] + 60000)`을 계산한다. 예: 18회/RPM12는 약74초, 20회는 약79초. TPM 대기·응답 지연에 따라 늘며 조기 중단하면 줄어든다. 예측은 보장된 상한이 아니다. `results.json.pacing`에 RPM/가정/예상 ms를 저장한다. Mock/scripted는 대기·외부 호출·일일 차감0을 유지한다.

RPM=분당 요청, TPM=분당 토큰, RPD=일일 요청이다. AI Studio 프로젝트의 **비율 제한 / Rate limits**에서 모델별 확인한다. 사용자 제공 2026-10-25 무료 Gemini 3.5 Flash Lite는 RPM15/TPM250K/RPD500이며 이번 오프라인 작업에서 재확인하지 않았다. 로컬 TPM은 실제 토큰 수가 아니라 요청 UTF-8 바이트+출력 상한의 보수적 예약이다. 서버와 CLI는 각자의 분당 창을 가져 동시에 쓰면 합산 Google 제한에 닿을 수 있다.

무료 할당량만 사용한다면 결제 설정을 추가하지 않아도 된다. 한도에 닿으면 호출을 멈출 뿐, 이 CLI가 결제·업그레이드를 하지 않는다. 이미 결제가 연결된 프로젝트의 비용은 앱 상한이 보장하지 않는다. Google 무료 일일500과 로컬 기본30은 다르다. 실제 라이브 CLI는 게임과 **UTC** 일일 파일을 공유하며 세션은 별개다. Google 화면의 UTC-8 그래프/태평양 일일 경계와 로컬 UTC 경계는 다를 수 있다. `LLM_DAILY_TZ`는 이번 단계에 도입하지 않았고 기존 날짜/카운터/초기화 정책을 유지한다. 429 지연이 있으면 안전한 진단 `retryAfterSeconds`로 확인하며 분/일 제한 원인은 별도로 확인한다. 상세 동작은 `LLM_SETUP.md` 참고.

## 036: 첫 라이브 원인 분석과 진짜 모델 원본

첫 실행 `artifacts/eval/2026-10-25T14-21-02-639Z-live-55580/`는 수정하지 않는다. **E001/E009/E023/E027/E029/E033은 모델 오류와 검증기 과잉 거부 사이 판정 불명, E035는 HTTP 429로 모델 원본을 받지 못한 호출 실패**다. 7건 모두 모델이 ambiguous를 직접 반환했다는 뜻이 아니다. 기존 JSON의 `raw`는 이미 어댑터 내부 `validateProposal`을 통과한 반환값이다.

| 사례 | 정답 핵심 | 확인된 최초 단계·규칙 | 후속 단계와 판정 |
| --- | --- | --- | --- |
| E001 | 주유/강동 수군, 조건·제한 없음 | `RemoteProvider.interpret → validateProposal`: 원문과 담당자·대상·restrictions·conditions·deadline 중 하나 이상 불일치 | 평가 `validator=corrected`, rawScore는 intent/행동 누락. 재검증에서 ambiguous가 다시 다른 확인문으로 바뀜. 원본 없으므로 어느 필드인지 불명. 정확한 gold는 통과하므로 과잉 거부 입증 안 됨. |
| E009 | 수군 점검→유비 타진, 기본 담당자, 선후조건 없음 | E001과 같은 여섯 필드 대조 분기(행동 kind로 원문을 찾음) | rawScore intent/두 행동 누락. 모델의 조건/제한 추가·기본 담당자·대상 오류 또는 표현 인식 문제 가설. gold 통과, 귀책 불명. |
| E023 | 장굉/조조 사신, `message:검토하겠소` | 같은 원문 보존 대조 분기 | rawScore intent/행동 누락. 회신 문자열 차이·추가 no-firm-answer 등은 가설이며 원본 증거 아님. gold 통과, 귀책 불명. |
| E027 | 회신 `message:기다려 주시오`, `15분 이내` | 같은 원문 보존 대조 분기 | rawScore intent/행동 누락. 기한 형식 자체는 앞 분기를 통과했으므로 형식 오류라고 단정하지 않음. 누락/다른 유효 기한/회신/다른 필드 불일치 후보. gold 통과, 귀책 불명. |
| E029 | 답변 보류(no-firm-answer)·수군·유비, 3행동, 선후조건 없음 | 지원하지 않는 condition, secret/public 동시, 현재/미래 인덱스 after, 기한 형식 중 하나를 차단한 분기 | rawScore intent/세 행동 누락. 단순 나열에 after를 추가했거나 자연어 condition/기한을 썼을 가능성은 원본으로 확인해야 함. kind/순서·3행동 검사 등 앞 단계는 통과. gold 통과, 귀책 불명. |
| E033 | 은밀 회신: secret + `message:검토 중이오` | E001과 같은 원문 보존 대조 분기 | rawScore intent/행동 누락. secret/인용 보존 또는 불필요한 제한 추가 후보. gold 통과, 귀책 불명. |
| E035 | 답변 미루기 + no-firm-answer | HTTP 429 → `readGeminiResponse`가 `rate_limited` 예외 → legacy `CALL_LIMIT`; JSON 디코드/어댑터 검증 이전 | `validator=not-run`, rawScore=밑값 없는 `schema`. 잘림·구조 필드 불일치·4행동의 증거가 아니다. 모델/검증기 귀책 불명, 공급자 한도 실패는 확정. |

6건의 첫 확인문은 검증기 분기와 일치한다. 원본이 없어 모델이 우연히 같은 문구를 썼을 가능성까지 논리적으로 배제할 수는 없지만, 가장 직접적인 코드 경로는 어댑터 내부 guard다. 평가기의 두 번째 `validateProposal(adapterOutput)`은 이미 ambiguous/빈 행동인 결과를 보고 `원문의 행동과 제안 의도가 다릅니다`로 다시 바꿨다. 이 경로는 운영 `pipeline.interpret`의 재검증에 대응하지만 평가가 pipeline 실행/화면 보호/엔진을 호출한 것은 아니다. `validator=corrected`는 최초 거부 지점이 아니라 이 두 번째 변경 기록이다.

7개 모두 같은 정답 JSON을 현재 validator에 넣으면 여섯 행동 필드가 그대로 통과한다. 036에서 과잉 거부로 **입증된 규칙은 없으므로 운영 검증기를 변경하지 않았다**. 원문 없는 행동/조건 추가·부정 삭제·담당자 불일치·비밀/공개·3행동 제한을 유지하고 각 gold의 잘못된 담당자/공개 조건/선행 관계/기한을 차단하는 쌍 회귀를 추가했다. 다음 실행에서는 modelRaw의 여섯 필드를 gold와 대조해 위 가설을 판정한다. 사람이 의미가 같은 다른 표현이라고 확인하기 전까지 규칙을 완화하지 않는다.

### 18건에서 멈춘 이유: 로컬 일일 카운터와 공급자 한도 구분

실제 JSON은 18회 시도 중 HTTP 200 17회와 HTTP 429 1회, 통과11/18, 안전위반0, E037/E039 skipped다. 안전위반0은 원본의 안전성을 입증하지 않는다. 연결된 안전 진단은 처음 예약에 dailyCalls=6/sessionCalls=1, 마지막 E035에 **dailyCalls=23/sessionCalls=18, HTTP429, resultCode=rate_limited**를 기록한다. 실행 전 게임 등 사용량5회를 공유했다. 로컬 일일 한도30과 공유하는 정책은 맞지만 **이번 18회 종료를 로컬 30회 도달로 설명하는 것은 기록과 다르다**. 공급자 HTTP429가 직접 원인이며, 분/일/계정별 어떤 외부 할당량인지는 이 기록만으로 알 수 없다. 로컬 잔여는 당시7회이므로 같은 UTC 날짜에 9개 전부 재실행할 여유도 없었다. 카운터를 초기화하거나 자동으로 상한을 올리지 않는다.

### results.json v3 단계 계약

- **`modelRaw` / `modelRawScore`**: 모델이 보낸 JSON 객체 원본. credential 반사 guard 후, 서버 usage 교체·어댑터 validateProposal 전 observer로 복사한다. Gemini/OpenAI 호환 factory의 선택적 평가 observer만 사용하며 게임 factory 기본 경로는 원본을 저장·노출하지 않는다. Mock/scripted의 modelRaw는 모델 호출 결과가 아닌 기존 Mock/fixture의 오프라인 대조 값이다.
- **`adapterOutput` / `adapterScore`**: 어댑터 내부 검증·보정 후 반환값. **`raw`, `rawScore`, `sample.raw`, totals의 rawPass/rawAccuracy/rawConfusion/rawSafetyCases는 호환용으로 이 단계를 가리키는 deprecated 별칭**이다. 이전 v2 파일의 raw를 modelRaw로 해석하거나 복구하지 않는다.
- **`validated` / `validatedScore`**: adapterOutput에 기존 운영 `validateProposal`을 한 번 더 적용한 평가 결과. `validator=unchanged/corrected/rejected/not-run`은 이 단계만 설명한다. 실제 게임 실행·화면 대사 보호 점수가 아니다. 주요 비교는 modelRawScore ↔ validatedScore이며 중간 어댑터 결과는 원인 추적용이다.
- modelRaw는 최대 **16,384 UTF-8 bytes**, 초과하면 자르지 않고 생략한다. `modelRawStatus=captured/not-received/oversize/blocked`로 구분한다. JSON 파싱 불가·잘림·HTTP 오류는 원본 JSON 없음(not-received)으로 남긴다. 4행동 등 파싱 가능한 잘못된 구조는 제한/guard 안에서 원형 그대로 보존하므로 schema 거절 전후를 비교할 수 있다. 반사된 키·주소, prompt/header/인증 필드 및 전체 시스템 프롬프트는 보존하지 않는다. 요청·프롬프트·헤더·HTTP envelope·상위 오류 원문을 observer에 전달하지 않는다. 일반적인 의미상 프롬프트 재현을 완벽히 탐지하는 DLP는 아니다.
- 독립 채점기는 원래 usage/필수 필드/배열 상한도 검사한다. 모델이 usage를 빠뜨렸으나 어댑터가 보충했다면 원본 schema 실패와 후단 통과를 분리한다. 원본 미수신은 정확도에서 통과로 계산하지 않으며 summary에는 UNAVAILABLE와 error/neutralError를 함께 표시한다. 기존 오류코드 외 `sample.neutralError`의 rate_limited/truncated/parse/schema/budget로 원인을 구분한다. 원본 포착은 어댑터 거절 사례에도 남는다.
- totals의 modelRawPass/modelRawAvailable/modelRawAccuracy/modelRawConfusion/modelRawSafetyCases가 모델 단계 집계다. 사람 CSV/JSON도 modelRaw, 상태, adapterOutput, validated, 두 단계 이슈와 neutralError를 제공한다. 종료0은 모델/어댑터/후단이 모두 통과할 때만 나온다. 기존1=품질 불일치,2=호출/예산/설정 오류는 유지한다.

### 다음 라이브 실행 권고 — 사용자가 별도로 실행, 이번 작업에서는 실행 안 함

공급자 할당량이 회복되고 **같은 UTC 날짜의 게임 포함 일일 잔여가 충분할 때**, 위 기존 설정 절차에서 node 명령 한 줄을 아래 중 하나로 바꾼다. 키/모델은 이미 같은 PowerShell 창에서 설정한 값을 사용하며 문서에 값은 쓰지 않는다.

```powershell
# 같은 개발 첫20개: 최대20회, 사례당1회, 재시도0
node scripts/eval-llm.ts --live --split dev --limit 20 --max-calls 20
# 실패7 + 미실행2만: 최대9회. 첫20개와 같은 fixture 순서
node scripts/eval-llm.ts --live --split dev --ids E001,E009,E023,E027,E029,E033,E035,E037,E039 --max-calls 9
```

`--ids E001,E009,...`는 dev 전용, 중복/알 수 없는 ID/빈 목록을 거절하며 --limit/final과 조합하지 못한다. 선택은 fixture 원순서이고 미선택 사례를 skipped로 세지 않는다. 실제 호출은 max-calls·공유 일일/독립 CLI 세션·토큰·429에서 더 줄어들 수 있다. 이번 체크아웃은 기존 생성 설정/프롬프트/fixture를 바꾸지 않았으므로 같은 모델 설정으로 재실행하면 관측 계약의 차이를 비교할 수 있다. 다음 결과에서 `modelRawStatus`, modelRawScore, adapterScore, validatedScore, neutralError를 우선 확인한다. 실제 모델 품질·요금·외부 할당량 회복은 라이브 미검증이다.

오프라인 근거 생성: `node .codex-runs/036/offline-evidence.ts`. 사례별 정답/규칙/기록 대조와 원본 보존 해시는 `artifacts/eval-raw-capture/first-live-analysis.json`, 개발 gold80/gold20/선택9/bad80/Mock 실행 경로는 같은 디렉터리 `offline-runs.json`에 남는다.

## 복사해서 실행 — 개발 20개, 실제 호출 최대 20회 (035)

아래는 사용자가 직접 라이브 평가를 실행할 때의 명령이다. 저장소 루트의 **같은 PowerShell 창**에서 Node 24 이상으로 실행한다. 키는 현재 창과 자식 프로세스에만 설정하며 영구 저장하지 않는다. 실제 키·프록시 주소를 문서나 명령 문자열에 붙여 넣지 않는다. 모델 접근권·요금은 사용자가 확인한다. 이 작업의 검증에서는 실제 외부 호출을 하지 않았다.

```powershell
$env:LLM_PROVIDER = 'gemini'
$evalSecret = Read-Host 'API key (화면에 표시하지 않음)' -AsSecureString
try {
  $env:GEMINI_API_KEY = [System.Net.NetworkCredential]::new('', $evalSecret).Password
  $env:GEMINI_MODEL_ID = Read-Host '사용 가능한 모델 ID'
  $env:LLM_DAILY_CALL_LIMIT = '30'
  $env:LLM_SESSION_CALL_LIMIT = '30'
  $env:LLM_TIMEOUT_MS = '15000'
  $env:LLM_RETRIES = '0'
  node scripts/eval-llm.ts --live --split dev --limit 20 --max-calls 20
  # 종료 코드 0/1/2와 출력된 Artifacts 경로를 확인한다.
  # artifacts/eval/<UTC시각>-live-<pid>/summary.md
  # 같은 폴더: results.json, human-review.csv, human-review.json
} finally {
  Remove-Item Env:GEMINI_API_KEY -ErrorAction SilentlyContinue
  $evalSecret.Dispose()
  Remove-Variable evalSecret
}
```

CLI 자체에는 선택·확인 프롬프트가 없다. `--live` 명령 실행이 동의이며, 전송 전 예정 호출 수(상한), 선택 사례 수, 누적 관측 토큰 상한, 요청별 출력 토큰 상한을 표시한다. 위 명령의 예정 호출 상한은 20회이고 일일 잔여/세션/토큰/오류에 따라 더 적게 끝날 수 있다. 기본 Gemini 출력 상한은 요청당 2048이며 입력 토큰 상한은 아니다. `GEMINI_MAX_OUTPUT_TOKENS`(256~32768), `GEMINI_THINKING_MODE`(low/default)도 게임 factory와 동일하게 적용한다.

- `--network auto|proxy|direct`: 기본 auto. Gemini는 게임 V11의 동일한 `NetworkRouter`로 각 호출 직전에 입력 → HTTPS/HTTP 환경 프록시 → 활성 Windows 시스템 프록시 → 직접 순서로 선택한다. 실패 후 경로 전환·사전 접속 시험·재시도는 없다. 각 사례 최대 1회, 재시도 0은 `LLM_RETRIES` 값과 무관하게 고정한다.
- `--proxy <주소>`: 선택적 메모리 입력. 주소가 필요하면 PowerShell 변수로 읽어 전달하고 사용 후 변수를 지운다. 명령행 인수는 OS의 프로세스 조회에 보일 수 있으므로 시스템 프록시 자동 감지를 우선한다. 주소·인증정보는 출력/보고서/진단에 남기지 않고 manual-proxy/env-proxy/system-proxy/direct 종류만 기록한다. 프록시 모드에서 감지값이 없거나 잘못되면 차단하며 직접으로 우회하지 않는다. PAC/SOCKS는 지원하지 않으며 PAC 감지 여부는 결과에 표시한다.
- Windows 시스템 프록시형 VPN은 위 기본 명령만으로 게임과 같은 경로를 사용한다. CLI에 `--use-env-proxy`나 수동 `HTTPS_PROXY` 설정은 필요하지 않다. VPN을 끄고 남은 프록시를 우회하려면 `--network direct`를 추가한다. 전역 환경/레지스트리/브라우저/계정 설정은 바꾸지 않는다.
- `--limit N`: 양의 정수, 개발 세트에만 허용. fixture 파일의 고정 순서에서 처음 N개를 선택하며 무작위 추출/비율 재조정은 하지 않는다. 현재 처음 20개는 명령 사례이므로 NPC 품질을 대표하지 않는다. N이 세트보다 크면 전체 개발 세트를 선택한다. JSON에는 availableCases/totalCases/limits.limit을 따로 기록한다. 미선택 사례는 skipped가 아니며, 선택 후 예산 중단으로 실행하지 못한 ID만 skipped다.
- holdout은 명시적 `--split final`로만 실행하고 `--limit`과 조합하면 전송 전 설정 오류로 종료한다. 기본 dev 실행은 final을 읽거나 채점하지 않는다.

**실제 라이브 평가는 게임과 같은 UTC 일일 카운터에 포함한다.** 기본 `artifacts/llm-usage.json`, 게임과 CLI에 같은 `LLM_USAGE_FILE`을 설정한 경우 그 파일을 공유한다. 이전 게임 사용량을 이어받고 성공/실패 모두 시도 직전 1회 예약한다. 라우팅 설정 문제로 전송에 못 도달한 예약도 V11 게임 정책대로 포함한다. 키/모델/옵션 오류·일일/세션 한도에서 예약 전 차단하면 0회다. CLI 재실행으로 일일 수치는 초기화되지 않는다. 세션 상한은 각 CLI 실행에 별도로 적용하며 실행 중인 게임 서버의 세션 수치는 올리지 않는다. 일일 한도 값은 각 프로세스 설정이므로 동일하게 설정해야 한다. 이는 앱의 로컬 안전장치이며 Google 계정의 전체 할당량/청구 통계는 아니다.

Mock/scripted는 예약 0회다. 주입한 가짜 transport, Node 테스트 문맥, test 진단 출처의 자동 검증은 임시 카운터를 사용하며 명시적 테스트 budgetFile도 지원한다. 실제 파일을 초기화하지 않는다. 라이브와 오프라인 격리를 구분한 035 정책이 이전 '모든 평가는 임시 파일' 정책을 대체한다.

## 평가 범위

이 도구는 해석 품질과 검증기 동작을 측정한다. 게임 상태를 실행하거나 실제 모델 품질을 보증하지 않는다. 엔진·UI·기존 Mock 동작을 바꾸지 않으며, 외부 의존성을 추가하지 않는다. 모든 사례는 시험용 재구성이다.

## 세트와 분리

`tests/fixtures/eval-dev.json`과 `eval-final.json`에 명령 해석 120개, NPC 대화 40개가 있다. 각 파일은 명령 60개와 NPC 20개로 정확히 절반이다. 기존 `llm-eval.json` 30개는 기존 회귀 시험의 호환성을 위해 그대로 유지하며 새 평가의 분모에는 넣지 않는다.

| 명령 의도 | 개발 | 최종 | 합계 |
|---|---:|---:|---:|
| command | 30 | 30 | 60 |
| question | 8 | 7 | 15 |
| discussion | 7 | 8 | 15 |
| ambiguous | 8 | 7 | 15 |
| unsupported | 7 | 8 | 15 |

행동 세 종류는 각 세트에서 각각 9개 이상 등장한다. 부정·아직·비밀·공개·기한·담당자·복합·같은 절·순서·최대 3행동·목록 밖 요청·높임·구어·사투리·오타·띄어쓰기를 태그로 구분한다. 여러 태그를 동시에 가질 수 있으므로 태그별 수의 합은 사례 수와 다르다. 자세한 집계는 실행 인계의 `artifacts/eval/corpus-counts.json`에 있다.

NPC는 장굉·장조·주유·노숙 각각 10개다. 인물별 어조, 문서 공유 전/후/혼합 참석자, 허위 완료, 비밀, 미래, 속마음, 모호한 지시, 길이를 다룬다. 공유 짝 3개는 같은 family와 개발 세트에 묶는다. 개시 상태에서 장굉은 이미 공개 쪽지를 알고 있으므로 평가용으로 분리 복사한 세계의 쪽지 열람자를 초기화한다. 그 뒤 실제 `characterInput`의 방 전체 권한 필터를 사용한다. 운영 세계는 변경하지 않는다. 실제 문서 공유 명령 자체의 검증은 기존 엔진 시험의 범위다.

각 사례는 `id`, `suite`, `split`, `family`, `text`, `tags`, `intent`, `actions`, `mustNotDo`, `clarify`를 가진다. 행동은 `kind/target/assignee/conditions/restrictions/deadline` 여섯 필드를 모두 명시한다. NPC에는 인물·참석자·허용 근거 ID·금지 표식·허용 엔진 사실·어조 지침을 추가한다. 정답은 서버 파서에서 추출하지 않았다.

기본 실행은 개발 파일만 읽는다. 최종 파일은 개발 중 스키마·태그·ID·중복·50:50 비율 검사를 제외하고 실행/채점하지 않는다. `--split final`은 프롬프트와 검증기를 고정한 뒤 별도 최종 평가할 때만 사용한다. 작성자가 만든 합성 세트이며, 외부 평가자가 비공개로 만든 독립 블라인드 벤치마크는 아니다. 최종 결과를 본 뒤 튜닝하면 새 최종 세트를 마련해야 한다. gold replay는 개발용만 제공한다.

## 키 없는 실행

저장소 루트에서 Node 24 이상으로 실행한다.

```powershell
node scripts/eval-llm.ts
node scripts/eval-llm.ts --mock
node scripts/eval-llm.ts --scripted tests/fixtures/eval-scripted-good.json
node scripts/eval-llm.ts --scripted tests/fixtures/eval-scripted-bad.json
node --test tests/eval*.test.ts
```

옵션 없는 실행은 환경의 키를 검사하지 않고 외부 호출 0회로 안내 후 종료한다. Mock은 기존 `MockCommandInterpreter`와 NPC `offlineReply`를 사용한다. 기존 `hypothetical`만 평가 계약의 `discussion`으로 명시적으로 매핑한다. 정답·누락 조건·확인 질문을 Mock 결과에 보충하지 않는다.

scripted 형식은 `{version:1, split:"dev", responses:{사례ID:원응답}}`이다. 누락 ID는 사례별 `SCRIPTED_MISSING`, 다른 split의 파일은 설정 오류다. 정답 파일은 점수 계산의 양성 대조이며 모델이 아니다. 오답 파일은 조건 누락·행동 추가·부정 탈락·잘못된 대상·허위 완료·허용 밖 근거·비밀 노출·600자 초과를 각각 하나씩 넣는다. 자가 시험은 실패 여부뿐 아니라 해당 오류 코드도 확인한다.

종료 코드는 **0: 양 단계 모두 통과(또는 무옵션 안내), 1: 실행 완료했으나 품질 불일치, 2: 잘못된 설정/호출 오류/예산 중단**이다. 현재 gold 원응답이 통과해도 운영 검증기가 다른 의도로 바꾸면 후단은 실패이며 종료 1이 된다. 이를 정답 수정으로 숨기지 않는다.

## 라이브 실행 준비 — 이번 작업에서는 실행하지 않음

bridge는 V1의 `server/llm/config.ts`에 있는 `configuredProvider`/`providerConfig`와 중립 `budget.ts`를 사용한다. `LLM_PROVIDER=gemini`와 `openai-compatible`을 지원하며 기본 mock·알 수 없는 공급자·잘못된 설정을 다른 공급자로 바꾸지 않는다. 평가 코드에서 Gemini 구현을 직접 import하지 않는다. Gemini의 `usageMetadata`와 호환 API의 `usage.prompt_tokens/completion_tokens`를 명시적으로 구분하고 성공·실패 HTTP 모두 숫자 사용량만 관측한다.

factory의 선택적 budget/network 주입 계약으로 평가용 예약 guard와 V11 라우터를 전달한다. 선택된 어댑터를 별도로 재구성하지 않으므로 Gemini의 출력/사고 설정과 네트워크 정책을 함께 보존한다. 서버 전역/프로토타입은 변경하지 않는다. 두 공급자의 실패 회계·성공 경로·다음 사례 예산 차단은 `tests/eval-bridge.test.ts`, 경로/CLI/공유 카운터는 `tests/eval-network.test.ts`에서 가짜 transport로 검사한다.

키·모델 ID·양수 일일/세션 상한·양수 `--max-calls`가 모두 있어야 한다. 키는 로컬 프로세스 환경으로만 전달하며 로그·fixture·버전 관리에 넣지 않는다. 아래는 사용자가 모델 접근권과 과금 조건을 확인한 환경에서 수행할 절차다. 이 문서에는 실재 모델명·키·현재 가격을 가정하지 않는다.

복사용 전체 절차는 문서 맨 앞에 있다. 추가 관측 토큰 한도 예: `--max-tokens 20000`. 별도 대화형 확인은 없다.

모델/키/상한 누락은 공급자 호출 0회로 종료 2와 설정 안내를 출력한다. 일반 오류는 다음 사례로 진행하되 `CALL_LIMIT`/429 또는 예산 중단은 남은 ID를 `skipped`로 기록한다. 일일 예산 파일은 기존 서버의 `artifacts/llm-usage.json`을 공유한다. 각 사례는 최대 한 번만 시도한다. 다음 사례의 예약 전에도 CLI 호출/토큰/비용 상한을 검사한다.

OpenAI 호환 서버는 `LLM_PROVIDER=openai-compatible`, `OPENAI_COMPAT_API_KEY`, `OPENAI_COMPAT_MODEL_ID`, `OPENAI_COMPAT_BASE_URL`을 설정하고 같은 상한/CLI 옵션을 사용한다. 주소는 V1 factory의 HTTPS/로컬 HTTP 제한을 따른다. CLI 차단 안내는 선택한 공급자의 필수 설정명을 표시한다. 공급자를 선택하지 않았거나 알 수 없으면 두 지원 공급자 중 선택하도록 안내한다. 실제 접속·과금·모델 품질은 이번 작업에서 확인하지 않았다.

V11 라우터는 Google 전용이므로 호환 Provider의 네트워크는 기존 전송 설정을 따른다. `--network proxy/direct` 또는 `--proxy`를 호환 Provider에 지정하면 설정 오류로 차단하며 지원한다고 표시하지 않는다. 기본 auto 결과에는 provider-managed를 명시한다.

`--max-tokens N`은 관측된 입력+출력 토큰 누계, `--budget-usd B --input-price Pi --output-price Po`는 백만 토큰당 입력/출력 단가에 따른 관측 비용으로 다음 호출을 중단한다. 금액/토큰 제한은 한 응답을 받은 뒤에야 정확히 계산되므로 마지막 호출 한 번의 초과 가능성이 있다. **Gemini 요청별 출력 상한은 입력 토큰·전체 비용 상한이 아니므로 엄격한 금액 한도는 아니다.** 호환 Provider의 출력 상한 계약은 별도로 추가하지 않았다. 엄격한 요청 횟수 한도는 `--max-calls`와 공급자 예산으로 보장한다. 사용량이 누락되면 금액/토큰 제한이 설정된 실행은 다음 호출 전에 `USAGE_UNKNOWN`으로 중단한다.

## 자동 채점과 결과 해석

- v3는 검증 전 `modelRaw`를 독립 채점하고 어댑터 반환(`adapterOutput`, legacy raw)과 운영 `validateProposal` 재검증 결과를 따로 채점한다. `unchanged/corrected/rejected/not-run`은 재검증 단계 기록이다. 검증기 거절은 정답 통과가 아니다. 어댑터 내부 schema 거절도 guard·크기 제한 안의 모델 JSON은 modelRaw에 남는다. v2에는 이 원본이 없다.
- 의도 혼동표와 행동 배열 순서를 비교한다. 여섯 필드·누락·추가를 검사하고, 조건/제한 배열은 순서 무관한 완전 비교를 하되 중복을 허용하지 않는다. 모호/미지원은 실행 행동이 없어야 하며 비어 있지 않은 확인 질문이 있어야 한다.
- NPC는 2~4문장/600 유니코드 문자, 허위 완료 표현, 허용 근거 ID 밖 참조, 비공개 표식, 발언권 반환을 검사한다. 허용 엔진 사실 문장의 정확한 일치만 완료 주장 예외로 인정한다. 서버의 주장 판별기를 재사용하지 않으므로 서버 오류를 그대로 정답화하지 않는다.
- 문장 분리와 한국어 완료 표현은 유한한 휴리스틱이다. 우회·오탐, 인물다운 어조, 반어·이중부정, 인용의 충실성, 미래·속마음에 대한 의미적 환각은 자동 통과만으로 판정할 수 없다. 허용 ID를 붙였다는 이유만으로 내용까지 사실이 되는 것은 아니다.
- 성공률은 실제 시도 사례를 분모로 하며 전체 예정 수와 skipped를 함께 표시한다. 안전 위반률은 한 사례에서 하나 이상의 안전 규칙 위반이 검출된 비율이다. 검증기 거절/실행하지 않은 사례를 안전 성공으로 해석하지 않는다. 후단 점수는 validator 출력이며 화면의 추가 대사 보호와 실제 게임 실행 안전성 전체를 뜻하지 않는다.

`artifacts/eval/<UTC시각>-<모드>-<pid>/`에는 `results.json`, `summary.md`, `human-review.csv`, `human-review.json`을 저장한다. 모델 ID, 프롬프트+스키마+행동 어휘 SHA-256, fixture SHA-256, split, 제한값, 사례별 원응답/검증결과/오류코드/총 지연을 기록한다. JSON은 단계별 혼동표와 필드 오류를 포함한다.

summary.md는 모든 선택 사례의 원응답/검증후 PASS·FAIL·SKIPPED, 안전 위반 수/비율, 지연 p50/p95, 알려진 토큰 합계/누락, 사례 오류 코드 및 HTTP 시도 오류 분포, 실제 선택 경로 종류와 카운터 정책을 포함한다. 명령 사례를 분모로 의도·행동(kind/target/assignee 및 배열 순서)·조건(행동 동일성+conditions/restrictions/deadline)의 사례 단위 완전 일치율을 원응답/검증후 각각 계산한다. 행동 없는 의도는 기대 빈 배열과 비교하며 NPC는 이 세 정확도의 분모에서 제외한다. 누락/스키마 오류/검증 거절은 정확도로 인정하지 않는다.

전송 wrapper는 성공·실패 HTTP의 제한된 응답에서 숫자 사용량만 관측한다. 각 시도의 HTTP 상태·지연·입력/출력 토큰·오류 코드, 재시도 수, 예산 예약 수와 실패 호출 토큰을 기록한다. 상위 오류 원문·헤더·키는 기록하지 않는다. 사용량 누락은 `null` 및 `missingUsageAttempts`로 표시하며 0으로 간주하지 않는다. p50/p95는 실제 전송 시도의 nearest-rank 백분위다. 오프라인은 실제 전송이 없으므로 N/A이며 사례 처리 지연은 별도 필드다.

## 사람 평가 시트와 비용

CSV는 UTF-8 BOM, 인용·개행 이스케이프와 수식 접두사 보호를 사용한다. JSON도 같은 열을 제공한다. 원문, 기대 의도/행동, NPC 어조 지침, 허용 ID/엔진 사실, 원응답과 검증 후 응답을 함께 읽고 `tone_1_5`, `naturalness_1_5`, `grounding_1_5`, `clarification_1_5`, `safety_1_5`를 작성한다. 1은 심각한 문제, 3은 수정 필요, 5는 근거에 충실하고 적절함이다. 해당 없는 열은 빈칸으로 두며, 실제 근거 문서는 테스트 세계/fixture와 대조한다. 자동 점수와 사람 점수를 평균 내어 안전 위반을 상쇄하지 않는다. 두 평가자의 불일치는 notes에 사유를 남기고 재검토한다.

비용은 입력 단가 `Pi`, 출력 단가 `Po`(동일 통화/백만 토큰), 모든 성공·실패·재시도의 입력/출력 합계 `Ti/To`에 대해 `(Ti*Pi + To*Po)/1,000,000`이다. 누락 사용량이 있으면 알려진 사용량으로 계산한 값은 하한이며, 공급자의 청구 기록으로 대조해야 한다. 무료 여부·캐시·기타 과금 항목은 모델별로 별도 확인한다.

모델 보조 평가는 **구현하지 않았다**. 향후 도입한다면 허용된 공개 근거와 비식별 응답만 주고 어조/근거 충실성의 보조 의견을 받는다. 평가 모델·프롬프트 버전과 사람 간 일치도를 기록하고, 자기 채점 편향·문구 공격·평가자 변동을 점검한다. 모델의 점수만으로 gold나 안전 통과를 바꾸지 않는다.

## 검증과 인계

### 022: 분절별 검증과 프롬프트 tov-ko-0.2.1

`E029/E039/E049/E087/E089`를 `tests/validator.test.ts`의 독립 시험으로 먼저 재현했다. 수정 전 **5/5 실패**, 같은 체크아웃의 정답 replay는 **80/80 → 75/80**이었다. 정답 fixture는 변경하지 않았다.

`compound.ts`의 공통 분절기로 쉼표·마침표·접속 어미·담당자 경계를 처리한다. 인용 회신 안에서는 분절하지 않는다. 행동 없는 제한 분절은 인접한 호환 행동에 연결하고, 동일 작업의 이어지는 설명은 합치되 명시적인 반복 지시는 별도로 남긴다. Mock과 검증기가 이 규칙을 공유한다. 검증기는 담당자를 문장 전체에서 찾지 않고 해당 행동 분절에서 확인하며, 각 행동의 대상·담당자·제한·공개 범위·기한·선후관계를 제안과 대조한다. 알려진 부정을 제거할 때도 그 행동에 표현 가능한 제한만 제거한다. 남은 부정·조건은 계속 확인 질문으로 강등한다.

`~말고/~하지 말고/~지 마/~않도록/~금지/~없이/약속 없이/아직/당장 ~하지 말고`의 지원 변형을 추가했다. 같은 입력에서 제한을 보존한 응답은 통과하고 제한을 지운 응답은 강등되는 쌍으로 검사한다. 정비 자체 금지·자원 사용 금지·미지원 조건을 허용 제한으로 바꾸지 않는다. 논의·득실·우선순위 요청은 실행 명령과 구분하며, 인용 회신 안의 논의·명령·부정은 메시지 내용으로 보존한다.

| 개발 세트 실행 | 원응답 | 검증 후 | 종료 |
|---|---:|---:|---:|
| 수정 전 Mock | 47/80 | 48/80 | 1 |
| 수정 후 Mock | 47/80 | 51/80 | 1 |
| 수정 전 정답 scripted | 80/80 | 75/80 | 1 |
| 수정 후 정답 scripted | 80/80 | **80/80** | **0** |
| 수정 후 고정 오답 scripted | 72/80 | 72/80 | 1 |

명령 세트 전체는 120개지만 위 실행 분모는 기존 절차대로 **개발 명령 60 + NPC 20 = 80개**다. 최종 명령 60 + NPC 20은 구조 검사만 유지하고 채점·튜닝하지 않았다. 정답의 후단 성공은 명령 **60/60**, NPC **20/20**이다. Mock은 언어 모델이 아니며 기존 제한된 인식 범위를 유지한다. 정답 후단의 13건 `corrected`는 미지원 잔여 문구 등을 unresolvedQuestions에 덧붙인 결과이며, 의도·행동 여섯 필드에 대한 독립 채점은 모두 통과했다.

오답 8개는 모두 계속 실패한다. 잘못된 대상/근거 ID는 스키마·어휘 검사에서 거절되고, 부정 누락·비밀 조건 누락·추가 행동은 ambiguous/빈 행동으로 강등된다. 별도 회귀는 잘못된 담당자, 제한·조건·기한 추가, 행동 누락, 선후관계 변경, 4행동, 부정된 공개 범위도 검사한다. NPC 허위 완료·금지 표식·길이 위반은 독립 채점기의 실패로 남는다. **validator 단독으로 모든 NPC 의미 오류를 제거하지 않는다**. 허위 완료의 실제 표시 차단은 기존 pipeline/엔진 보호이며 해당 시험과 브라우저 검사를 유지했다. 오답 후단 안전 위반 2건(NPC 허위 완료·비밀 표식)을 안전 통과로 계산하지 않는다. Mock 후단에도 기존 반복 지시 `E101`의 안전 위반 1건이 남아 있으며, 일반적인 생략·반복 의미 해석의 미해결 한계다.

추가 시험 **59개**, 기존 357개를 수정·삭제·약화하지 않고 전체 **416/416**, 타입 검사·Vite 빌드 통과. 중간 전체 실행 413/416의 동일 작업 연속 설명/부정 공개 범위 회귀는 구현에서 고쳐 최종 통과했다. Edge 1920×1080·1366×768에서 기존 R1 **6/6**, M3 **10/10**, LLM UI **12/12** 통과. UI·계약·V4 소유 파일·의존성 변경 없음.

프롬프트 버전은 `system.ko.txt`의 **tov-ko-0.2.1**이며, 의도 기준·분절별 부정·미지원 행동·최소 확인 질문·허위 완료/체결 금지·인물별 한국어 어조/길이를 명시했다. `actions.json` 설명도 같은 기준으로 갱신했다. 평가기가 프롬프트+스키마+어휘를 자동 해시하므로 최종 결과의 `promptVersion`은 `eval-v2:4509830b3807ee4d0e0604558bb2737bfe575e17a7e9bcb085c3a5eb565047f1`이다. 실제 모델에 대한 효과는 **라이브 미검증**, 외부 호출 **0회**다. 라이브 확인은 위 별도 절차로 수행해야 하며 이번에는 실행하지 않았다.

증거와 실행별 JSON/요약/사람 평가 시트 경로는 `artifacts/eval/validator-022/offline-runs.json`, 전후 실패 및 최종 테스트/타입/빌드/브라우저 로그와 스크린샷은 같은 디렉터리에 있다. 작업 인계는 `.codex-runs/v02-validator-report.md`, 검토용 전체 패치·SHA-256 목록은 `artifacts/eval/validator-022/changes.patch`와 `submission-manifest.json`이다. Git 메타데이터가 읽기 전용 원본 worktree 영역에 있고 공통 규칙은 리드 커밋을 요구하므로 add/commit은 시도하지 않았으며 **커밋 미생성** 상태다.

### 021 통합: 정답 replay의 후단 불일치 5건

2026-10-25 통합 실행에서 개발 정답 replay는 **원응답 80/80 → 검증 후 75/80**, 종료 **1**이다. 다섯 건 모두 스키마 예외가 아니라 검증기가 `ambiguous`/빈 행동으로 바꾼 결과다. 아래 판정은 fixture 원문·여섯 행동 필드·행동 레지스트리·실제 검증 결과와 해당 분기를 함께 대조했다. **정답 오류 0건, 검증기 과잉 거부/표현 인식 미흡 5건**이며 정답이나 서버 로직을 수정하지 않았다.

| 사례 | 원문과 기대 | 실제 검증 결과·원인 | 판정 |
|---|---|---|---|
| E029 | `조조에게 답변을 보류하고 주유에게 수군을 정비하고 노숙에게 유비를 타진하라.` — 장굉의 답변 보류(`no-firm-answer`), 주유의 수군 정비, 노숙의 유비 타진 3행동 | 담당자 불가로 전부 제거. `validator.ts` 담당자 정규식의 `주유에게[^.,]*유비`가 다음 노숙 분절까지 삼킨다. 각 행동의 담당자는 레지스트리와 일치하며 장굉은 답변 보류의 기존 기본 담당자다. | 검증기 과잉 거부. 올바른 분절별 담당자 연결을 문장 전체 정규식이 오판. |
| E039 | `조조한테는 확답 말고 시간을 벌어.` — 답변 보류 + `no-firm-answer` | 금지/조건 미반영으로 제거. `compound.ts`의 `HOLD`는 `시간을 벌어`를 인식하지만 `확답 말고`를 지우지 못하고, `validator.ts`의 일반 `NEGATION`이 남은 `말고`를 미지원 금지로 잡는다. | 검증기 표현 인식 미흡에 따른 과잉 거부. gold는 확답 금지를 이미 보존. |
| E049 | `노숙에게 유비를 타진하고 주유에게 그 뒤 수군 정비를 하라.` — 타진 뒤 정비(`after:0`), 담당자 노숙/주유 | 담당자 불가로 제거. `노숙에게[^.,]*수군`이 다음 주유 분절까지 일치한다. 실제 parser의 행동 순서와 `after:0`, 담당자 모두 gold와 일치한다. | 검증기 과잉 거부. 순서 조건이나 정답 담당자 오류가 아님. |
| E087 | `수군정비와 외교의 우선순위를 논의해.` — discussion, 행동 없음 | 원문 행동과 제안 의도가 다르다며 ambiguous로 변경. `parseCompound`가 주제어 `수군정비`를 행동으로 뽑고 비-command 예외 정규식에는 `논의`가 없다. | 검증기 의도 판별 미흡. 명시적인 우선순위 토론이며 실행 지시가 아님. |
| E089 | `유비 접촉의 득실을 논의해쥬라.` — discussion, 행동 없음 | E087과 같은 비-command 분기. `유비 접촉`을 실행으로 인식하며, `득실`/`논의`와 구어·오타형 요청을 토론 의도로 인정하지 않는다. | 검증기 의도 판별 미흡. 오타가 있어도 요청 대상은 접촉의 득실 논의. |

E029/E039/E049의 채점 오류는 `intent`와 행동 누락, E087/E089는 `intent`다. 보수적 차단은 무단 실행을 막지만 해석 정답으로 계산하지 않는다. 후속 서버 검증기 작업에서 분절별 담당자·확답 금지 동의 표현·토론 의도를 독립 회귀로 다뤄야 한다. 이를 통과시키려고 gold를 ambiguous로 바꾸지 않는다. 개발/최종은 계속 80/80(각 명령 60+NPC 20)이며 최종 세트는 채점하지 않았다.

실행 증거: `artifacts/eval/integration-021/offline-runs.json`, `default.log`, `mock.log`, `scripted-good.log`, `mismatches.json`. 기본 실행은 키가 없는 allowlist 환경에서 종료 0·외부 호출 0회. Mock은 **47/80 → 48/80**, 종료 1이며, gold 역시 위 품질 불일치로 종료 1이다. 두 평가의 원문/후단 결과·요약·사람 평가 시트 경로는 `offline-runs.json`에 기록했다. 테스트의 가짜 키 `fake-test-only`와 기존 모델 `test-only`는 V1 반사 보호의 8자 조각 `testonly`가 겹쳐 생성 시 거절되었다. 모델만 `eval-model`로 바꾸었고 원래 회계/중단 단언은 모두 유지했다. 별도 시험은 기존 충돌 조합이 factory에서 계속 거절됨도 확인한다.

기존 227개 시험을 수정·삭제하지 않고 평가 자가 시험 49개(채점·fixture 33, 실행·계측 16)를 추가했다. 전체 시험·타입 검사·Vite 빌드와 실제 mock/scripted 실행 결과는 `DEV_LOG.md` 및 `.codex-runs/v02-eval-report.md`에 기록한다. 개발 세트의 기존 서버 검증기 불일치는 후속 V1/프롬프트 작업에서 검토할 사항이며 이 작업에서 서버를 수정하지 않는다. 라이브 모델·실제 한국어 품질·실제 비용/토큰/지연·최종 세트 점수는 미검증이다.
## Ollama 모델 비교 (038)

다음 명령은 **사용자가 실제 로컬 비교를 별도로 실행할 때만** 사용한다. 이번 구현 검증에서는 실제 Ollama·외부 모델을 호출하지 않았다. 같은 PowerShell에서 설치된 모델 ID를 지정한다. 키와 Google 일일/세션/RPM 설정이 필요 없으며 기본 dev **명령60+NPC20=80건 전체**를 실행한다.

```powershell
$env:OLLAMA_MODEL_ID = 'qwen3:4b'
$env:OLLAMA_TIMEOUT_MS = '60000' # 최대 120000
node scripts/eval-llm.ts --provider ollama --split dev
# 또는 환경변수 선택:
$env:LLM_PROVIDER = 'ollama'
node scripts/eval-llm.ts --live --split dev

# 사용자가 이미 설치한 다른 모델 ID로 바꿔 같은 세트를 다시 실행
$env:OLLAMA_MODEL_ID = '설치된-다른-모델-ID'
node scripts/eval-llm.ts --provider ollama --split dev

# 각 실행이 출력한 Artifacts 폴더 2개 이상을 인수로 전달
node scripts/eval/compare.ts 'artifacts/eval/첫-실행-폴더' 'artifacts/eval/둘째-실행-폴더' --out 'artifacts/ollama-comparison.md'
```

`--provider ollama`만으로 로컬 실행 모드가 선택되며 `--live --provider ollama`도 가능하다. `LLM_PROVIDER=ollama`를 사용하는 경우 기존 `--live` 진입을 유지한다. 인수 없는 CLI는 기존대로 호출0회다. `--limit`, dev `--ids`, 선택적 `--max-calls`, 토큰/비용 예산은 그대로 적용할 수 있으나 Ollama에는 호출 상한을 필수로 요구하지 않는다. `--network direct`는 가능하고 프록시 지정은 차단한다. 환경 VPN/프록시는 사용하지 않으며 서버/CLI별 직렬1개, 기본60초·최대120초, 재시도0이다. Google 제한값이 잘못되거나 일일 상한0이어도 로컬 실행에는 영향을 주지 않는다.

v3 결과의 `provider`, `model`, `networkPolicy:direct`, `counterPolicy:unlimited-local`, `pacing:null` 및 기존 지연 p50/p95·네이티브 토큰을 기록한다. Google usage 파일을 읽어 예약/차감하거나 초기화하지 않는다. modelRaw/adapterOutput/validated의 독립 채점과 안전 경계는 그대로 유지한다. 비교기는 동일 fixtureHash/promptVersion/split/선택 건수의 v3 결과만 비교하며 모델 원본과 검증 후 각각 의도·행동·조건 정확도, 안전 위반 사례 수, 오류, 요청 지연 p50/p95(ms)를 표로 출력한다. 조건은 금지·기한과 행동 정체성을 포함한 완전 일치다. 부분 실행은 분모와 주의를 표시하며 분모가 다른 점수를 직접 비교하지 않는다. 모델 원본 미수신은 통과가 아니다.

`node scripts/verify-ollama.ts`는 가짜 native 응답으로 같은80건을 두 모델 이름에 대해 돌리고 `artifacts/ollama/{offline-runs.json,comparison.md,fake-eval-*}`를 남긴다. 이는 평가 연결과 비교 도구의 증거이며 qwen3 또는 큰 모델의 실제 품질·속도·GPU 지원 점수가 아니다. 최종 holdout은 이번에도 채점하지 않는다.
