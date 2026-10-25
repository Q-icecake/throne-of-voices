# LLM 연결 설정 (v0.2)

## VPN 켬 / 끔과 연결 방식 (034)

VPN 켬: `AI 연결 설정` → `자동 (권장)` → `설정 적용` → `연결 시험` 한 번. 시스템 프록시형이 아니거나 감지되지 않으면 아래 표를 따른다.
VPN 끔: `직접 연결` → `설정 적용` → `연결 시험` 한 번. 자동도 가능하지만 꺼진 VPN의 프록시 설정이 남아 있으면 직접 연결을 선택한다.

| 현재 환경 | 권장 선택 | 확인할 점 |
| --- | --- | --- |
| 시스템 프록시형 VPN 켬 | 자동 또는 VPN·프록시 사용 | Windows의 활성 HTTP/HTTPS 프록시를 읽는다. 감지되지 않으면 주소를 직접 입력한다. |
| 전역/TUN 모드 VPN 켬 | 직접 연결 또는 자동 | OS가 경로를 처리하므로 별도 프록시 주소가 필요 없다. 오래된 프록시가 감지되면 직접 연결. |
| VPN 끔 | 직접 연결 또는 자동 | 직접 연결은 남아 있는 환경/시스템/입력 프록시를 모두 우회한다. |

자동은 **호출 직전** 입력 프록시 → `HTTPS_PROXY`/`https_proxy` → `HTTP_PROXY`/`http_proxy` → 활성 Windows 시스템 프록시 → 직접 연결 순서로 하나만 선택한다. 먼저 연결 시험을 하거나 실패 후 다른 경로로 자동 전환하지 않는다. 수동 `VPN·프록시 사용`의 빈칸은 보관 중인 입력값 또는 자동 감지 값을 사용한다. 아무 프록시도 없으면 `PROXY_NOT_CONFIGURED`로 차단한다. 잘못된 감지 주소는 `PROXY_CONFIG_INVALID`로 차단하며 조용히 직접 연결하지 않는다. 설정이 없어 전송 전에 차단되어도 예약된 시험은 로컬 카운터에 포함된다.

주소 입력은 `VPN·프록시 사용`에서 표시된다. **예시** `127.0.0.1:7890`은 형식 예시일 뿐이며 실제 포트는 VPN 앱에서 확인한다. 로컬 HTTP 프록시를 권장하고 `http://`는 생략할 수 있다. HTTP/HTTPS만 지원하며 SOCKS/PAC는 지원하지 않는다. Windows `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`의 `ProxyEnable`, `ProxyServer`, `AutoConfigURL`만 읽고 바꾸지 않는다. `http=...;https=...` 형식은 HTTPS 항목을 우선한다. PAC가 있으면 기존 진단 요약에 **PAC 자동 구성 미지원**을 표시하며 스크립트를 가져오거나 실행하지 않는다. 레지스트리를 읽을 수 없으면 시스템 프록시는 없는 것으로 취급한다.

입력 주소는 키처럼 password 필드로 가리고 제출 직후 브라우저에서 지운다. 서버 메모리에만 보관하며 상태·로그·디스크·브라우저 저장소에 주소/포트/인증정보를 쓰지 않는다. 빈칸으로 다른 설정을 적용하면 보관된 입력 프록시를 유지한다. `지우기`를 체크해 적용하면 환경/시스템 감지로 돌아간다. `키 지우기`는 입력 프록시도 지운다. 서버 종료 후에는 다시 입력한다. 직접 연결 동안에는 보관된 주소를 사용하지 않는다.

`GET /api/llm/status`의 `networkMode`는 `auto/proxy/direct`, `route`는 `direct/env-proxy/system-proxy/manual-proxy` 종류만 반환한다. 같은 필드를 진단 JSONL에도 기록한다. 상태의 현재 선택과 `lastDiagnostic`의 마지막 시도 경로는 설정 변경 후 다를 수 있다. 실패의 `networkError`는 허용된 name/code만 기록하며, **실제로 선택한 프록시의 주소·포트와 ECONNREFUSED 원인이 일치할 때만** `proxyRefused: true`로 구분한다. 이 경우 화면은 VPN 꺼짐/프록시 미실행 가능성과 다음 선택을 안내한다. 주소나 원문 예외는 표시하지 않는다.

화면의 연결 시험·명령·대화는 사용자 조작당 최대 한 번만 전송한다. 환경 설정으로 생성하는 Gemini Provider도 재시도는 0으로 고정한다. 실패하면 입력·초안을 보존하고 현재 경로와 다음 선택을 제시하며 사용자가 설정을 바꾼 뒤 다시 누른다. `직접 연결`은 Node의 전역 환경 프록시보다 요청별 명시적 직접 dispatcher를 우선하므로 서버 재시작 없이 전환된다. 이 경로 선택은 **Google 요청에만** 적용하며 로컬 API/Vite와 호환 Provider의 정책을 바꾸지 않는다. `NO_PROXY`는 이 Google 전용 우선순위를 변경하지 않는다.

V10의 `--use-env-proxy`는 시작 시 환경 프록시를 지원하지만 요청별 시스템/입력 프록시와 직접 연결 전환에는 부족하다. 이를 위해 Node fetch 기반 패키지 **`undici` 8.5.0**의 `ProxyAgent`/`Agent`를 런타임 의존성으로 고정하고 `pnpm-lock.yaml`의 SHA-512를 갱신했다. 전역 dispatcher나 환경변수를 변경하지 않는다. 이번 설치는 캐시의 tarball을 오프라인으로 읽었으며 외부 API 호출은 없었다. 서버 재시작 후 이 버전의 `run.ps1 install`로 의존성을 설치할 수 있다. 실제 VPN/Google/API 키/모델 성공은 라이브 미검증이다.

오프라인 검증: `node --test tests/network-mode.test.ts`, `node scripts/verify-network-mode.ts`, `node scripts/verify-all.ts`. 가짜 transport·주입된 Windows 읽기·로컬 가짜 CONNECT 프록시만 사용한다. 설정 화면 두 해상도와 결과는 `artifacts/network-mode/`에 남긴다.

## HTTP 상태 없이 실패할 때 (033)

아래는 V10의 시작 시 환경 프록시 점검 절차다. V11 설정 화면에서는 위의 연결 방식을 우선 사용하며, Node 자체의 프록시 지원과 앱의 Windows 감지는 별개다.

`httpStatus: null`은 Google HTTP 응답을 받지 못했다는 뜻이다. 약 10초 뒤 `fetch failed`라면 DNS·방화벽·VPN/프록시·TLS·연결 제한시간을 먼저 살펴본다. Google에 도달했는지, 과금되었는지는 이 기록만으로 확정할 수 없다. 브라우저의 AI Studio 요청 수는 이 앱의 서버 호출 성공 증거가 아니다.

1. 이 PC에서 **브라우저를 거치지 않는** 연결을 확인한다. PowerShell의 `Test-NetConnection generativelanguage.googleapis.com -Port 443`으로 DNS/TCP 접근부터 확인할 수 있다(키 불필요). 이 검사는 TLS·API 인증·모델 성공을 보장하지 않으며, 프록시 전용 망에서는 직접 연결 실패가 예상될 수 있다.
2. VPN·프록시를 사용하는 환경이면 해당 프로그램에서 확인한 HTTP 프록시 주소를 같은 PowerShell 창의 `HTTPS_PROXY`에 설정하고 `run.ps1 dev`를 실행한다. 브라우저만 사용하는 프록시나 SOCKS 주소를 그대로 넣지 않는다. 아래 주소는 형식 예시이며 실제 주소는 로컬에서만 입력한다.

   ```powershell
   $env:HTTPS_PROXY = 'http://127.0.0.1:실제포트'
   $env:NO_PROXY = '127.0.0.1,localhost'
   .\run.ps1 dev
   ```

   기존 `NO_PROXY`가 있으면 위 로컬 주소를 기존 목록에 추가한다. `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY`는 자식 Node 서버에 그대로 상속되며 시작 스크립트는 값을 출력·변경하지 않는다. 소문자 변수도 Node가 지원하므로 대소문자가 다른 설정이 함께 있으면 사용자가 일치시킨다. Node 내장 프록시는 운영체제/브라우저 설정을 자동으로 가져오지 않는다.
3. 서버 재시작 후 설정 화면에서 `프록시 환경변수 감지됨/없음`과 남은 로컬 상한을 확인하고 **연결 시험을 한 번** 누른다. 감지 표시는 변수 존재만 뜻하며 프록시 작동이나 Google 도달 성공을 뜻하지 않는다. **프록시 주소·인증정보·키는 채팅에 보내지 않아도 된다.**

본 작업에서 설치된 **Node v26.12.1**의 `node --help`에서 `--use-env-proxy`를 직접 확인했다. `run.ps1 dev`는 지원 여부를 확인한 뒤 이 옵션으로 서버를 시작한다. 미지원 Node에서는 고정 안내를 출력하고 기존 개발 서버를 실행하므로 환경 프록시 적용을 주장하지 않는다. 프록시가 필요하면 Node 24.5 이상을 사용한다. 직접 실행할 때는 `node --use-env-proxy scripts/dev.ts` 또는 실행 전에 `$env:NODE_USE_ENV_PROXY = '1'`을 사용할 수 있다. 공식 문서상 환경변수의 fetch 지원은 Node 24.0+, CLI 옵션은 24.5+다. 새 npm 의존성이나 TLS 검증 해제는 필요 없다. [Node CLI 문서](https://nodejs.org/api/cli.html#--use-env-proxy), [Node 네트워크 설정 문서](https://nodejs.org/en/learn/http/enterprise-network-configuration).

설정 결과는 연결 실패(`network`: 네트워크·DNS·방화벽·프록시 확인), 연결 시간 초과(`timeout`, HTTP 없음), TLS/인증서 문제(`tls`)를 구별한다. HTTP 응답 후 읽기 시간 초과는 기존 응답 시간 초과로 유지한다. 게임도 같은 중립 오류 코드와 기존 칩/오류칸을 사용한다. 연결 시험은 계속 재시도 0회이며 실패도 로컬 카운터 1회를 사용한다.

새 JSONL/상태 요약의 `networkError`는 허용된 오류 `name`과 `code`만 담는다. 예: `{"name":"TypeError","code":"ENOTFOUND"}`. `error.cause.code`와 제한된 중첩 원인/집합 오류를 검사한다. 알려지지 않은 값은 `null`이고, TLS 계열의 미지 코드는 `tls`로 분류하되 원문은 내보내지 않는다. 모든 허용 값에도 키 guard를 적용한다. 원문 메시지·stack·URL·쿼리·헤더는 보관하지 않는다. 응답을 받은 HTTP 오류는 `networkError: null`이다.

새 기록에는 `source: "live"`가 붙고 Node 테스트/오프라인 검증은 `source: "test"`로 표시된다. `live`는 실제 실행 경로라는 뜻이며 Google 도달/성공을 보장하지 않는다. 과거에 섞인 시험 줄은 자동으로 판별·삭제하지 않는다. 이번 변경은 삭제 버튼 대신 출처 표식을 선택해 기존 자료와 UI를 보존한다. 과거 행에는 표식이 없으며 기존 500줄/1 MiB 회전 정책은 유지된다. 테스트 컨텍스트·명시적 예산 파일 옆 진단 경로·검증의 임시 파일 격리를 유지하고 전체 검증 전후 실제 파일 해시를 비교한다.

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

진단 기록은 아래 032 규칙을 따른다. 키·헤더·플레이어 문장·프롬프트·모델 응답 본문은 기록하지 않는다.

## 진단 로그 읽기 (032)

기본 위치는 `<프로젝트>\artifacts\llm-diagnostics.jsonl`이다. **마지막 줄이 가장 최근에 완료된 외부 요청 시도**다. 연결 시험/게임 모두 Gemini 경로를 사용하며 한 실제 요청 시도당 JSON 한 줄을 기록한다. 재시도는 별도 줄이며 `retries=0`이 최초, `1`이 첫 재시도다. 키 없음·로컬 상한 등으로 전송 전 차단되면 새 줄을 만들지 않는다. HTTP 응답 전 실패도 기록하며 `httpStatus=null`이다. 타임아웃 뒤 늦은 응답은 중복 기록하지 않는다.

| 필드 | 읽는 법 |
| --- | --- |
| `timestamp`, `latencyMs` | 요청 시도 시작 UTC 시각, 완료/실패까지 경과 밀리초. 실제 공급자 지연은 라이브 미검증. |
| `callKind`, `provider`, `model` | `connection_test`/`command`/`npc`/`meeting`, `gemini`, **그 시도에서 요청한 모델 ID**. 설정 변경 후에도 과거 기록은 당시 모델이다. |
| `httpStatus`, `googleStatus`, `googleReason` | HTTP 숫자 및 허용 목록의 Google 오류 분류. 미제공/미허용 값은 `null`. |
| `googleMessage` | 오류 message에서 인식한 안전한 진단 구절만 최대 240자. 예: `Invalid JSON payload received. Unknown name Cannot find field`. 인용된 값·임의 문구는 제외한다. 키/인코딩/부분 반사 검사는 **자르기 전 원문 전체**에 적용하며 반사되거나 알려지지 않은 문구만 있으면 `null`. 임의 원문을 보존하는 필드가 아니다. |
| `finishReason` | `MAX_TOKENS`는 출력/사고 상한, `STOP`은 공급자 종료 사유. STOP이라도 제안 검증 실패일 수 있다. |
| `inputTokens`, `outputTokens`, `thinkingTokens` | 공급자가 보고한 입력·출력·사고 토큰. 알 수 없는 값은 `null`이며 0으로 추정하지 않는다. |
| `resultCode` | 응답 파싱·제안 스키마 검증을 마친 분류: `ok`, `truncated`, `request`, `model`, `google_server`, `parse`, `schema`, `timeout` 등. |
| `retries`, `dailyCalls`, `sessionCalls` | 해당 시도의 재시도 번호와 예약 직후 로컬 오늘(UTC)/서버 세션 사용 횟수. Google 콘솔 통계가 아니다. |

예: HTTP 200 + `MAX_TOKENS` + `truncated` + 사고 토큰이 크면 토큰 상한을 살펴본다. 400 + `request`면 message의 안전 구절과 요청 모델을 확인한다. 404 + `model`은 모델/접근 권한, 5xx + `google_server`는 공급자 서버 오류다. HTTP 200 + `schema`는 연결은 되었지만 앱이 제안을 거절한 경우다. `null`은 성공을 뜻하지 않는다.

파일은 최근 **500줄 또는 1 MiB 이하**만 남기는 슬라이딩 회전 방식이다. 임시 파일에 쓴 뒤 교체하며 오래된 줄은 제거한다(무제한 백업 없음). 기존 파일이 1 MiB를 넘으면 다음 쓰기에서 최신 한 줄로 교체해 메모리/디스크 증가를 제한한다. 단일 로컬 서버 사용을 전제로 한다. 파일 쓰기 실패는 게임 결과를 바꾸지 않으며 콘솔과 이번 세션의 메모리 요약은 계속 제공한다.

설정 화면의 기존 결과 아래 안내/요약에서 상태·분류·finishReason·입력/출력/사고 토큰·지연·모델·오류 메시지 앞부분(80자)을 확인할 수 있다. 긴 모델 ID는 48자 뒤 생략하며 마우스를 올리면 전체 ID를 볼 수 있고 API/로그에는 전체가 있다. `GET /api/llm/status`의 `lastDiagnostic`은 **이번 서버 세션에서 마지막으로 완료된 시도**의 위 안전 필드만 반환한다. 재시작 전 파일을 API로 다시 읽지 않으며 새 세션은 `null`이다. 설정을 바꾸거나 다음 호출이 상한으로 차단되어도 이전 호출 요약은 유지하므로 현재 시험 결과와 구별한다. 키 변경 후 새 키와 겹치는 과거 요약은 내보내지 않는다.

카운터 경로를 별도로 지정하면 진단 기본 경로도 같은 폴더로 이동한다. `RuntimeOptions.diagnosticsFile`로 진단 경로를 명시할 수도 있다. 이때 화면의 `<프로젝트>` 안내는 기본 경로이므로 운영자가 지정한 경로를 사용한다. 테스트/검증은 임시 폴더에 격리하며 `node scripts/verify-all.ts`가 매 작업 전후 **실제 진단 파일과 실제 카운터 SHA-256**을 비교한다. 증거는 `artifacts/diagnostic-log/hash-verification.json`, `artifacts/usage-counter/hash-verification.json`이다. 실제 키·환경값 열람이나 실제 외부 호출 없이 가짜 transport로 검증한다.

다시 시험: 업데이트한 서버를 재시작 → `AI 연결 설정`에서 모델·키·남은 일일/세션 상한 확인 → `연결 시험` **한 번** 클릭 → 구체 결과 확인. 이미 오늘/세션 1/1이면 다시 누르기 전에 사용자가 상한을 결정해야 하며, 업데이트는 실제 카운터를 초기화하지 않는다. 이번 검증은 가짜 transport만 사용했고 실제 모델 요청은 0회다.

## 로컬 호출 사용량과 초기화 (030)

`AI 연결 설정`에 **오늘(UTC) 로컬 호출 수/일일 상한**과 **이번 서버 세션 호출 수/세션 상한**을 표시한다. 이는 Google 실제 요청 통계나 할당량이 아니라 앱의 로컬 안전장치다. `로컬 일일 상한(UTC) 도달`, `로컬 세션 상한 도달`, `Google 한도 초과(429)`는 별개다. 파일을 읽을 수 없으면 `확인 불가`로 표시하고 호출을 차단한다.

오염된 541 같은 기존 값은 업데이트·상태 조회·설정 저장으로 지우지 않는다. 확인 후 설정 화면의 **오늘 로컬 카운터 초기화**를 직접 누른다. 버튼 옆 확인 문구는 **Google 쪽 실제 사용량은 바뀌지 않습니다**이며 팝업은 없다. 당일 파일 값만 0으로 바꾸고 서버 세션 사용량과 두 상한은 유지한다. 초기화 전 수치와 UTC 날짜를 서버 세션 사건 로그(`/api/test/logs`, snapshot)에 남기며 게임/설정 리셋에도 보존한다. 서버 종료 후 로그는 유지되지 않는다. 잠금·손상·쓰기 실패는 초기화를 거부한다.

매 시도 직전에 일일·세션을 각각 1회 예약한다. 성공·실패·전송 후 취소도 1회이며 재시도는 매번 추가 1회다. 연결 시험은 재시도가 없어 최대 1회, 인증 설정 부족이나 상한 도달로 전송 전 차단되면 0회다. 결과/usage 기록은 다시 차감하지 않는다. 화면 설정 경로는 서버 수명 동안 같은 예산을 공유하고, CLI Provider는 인스턴스 수명 동안 세션을 유지한다. 일일은 UTC 날짜가 바뀌면 새 날짜의 첫 예약부터 다시 센다. 조회만으로 파일을 변경하지 않는다.

실제 플레이 기본 파일은 `artifacts/llm-usage.json`이며 `LLM_USAGE_FILE`로 다른 파일을 지정할 수 있다. `node --test tests/*.test.ts`는 Node 테스트 컨텍스트에서 프로세스별 임시 파일을 자동 선택하고, 기존 시험별 `budgetFile`도 유지한다. 검증·스크린샷·playthrough/soak는 `scripts/offline-runtime.ts`로 임시 경로·Mock을 지정한다. 035부터 실제 `--live` 평가는 게임과 같은 일일 파일을 공유한다(같은 `LLM_USAGE_FILE` 적용). 성공/실패 예약이 일일 수치에 포함되며 CLI 세션 상한은 게임 서버 세션과 별개다. 가짜 transport·Node 테스트·test 출처의 평가만 임시 파일을 쓰며 별도 `budgetFile` 주입도 지원한다. 임시 파일은 정상 종료 시 정리된다. 테스트/오프라인 평가는 플레이 일일 카운터를 올리지 않는다. 복사용 명령·네트워크 옵션·정책은 [EVAL.md](EVAL.md) 맨 앞을 따른다. `node scripts/verify-all.ts`는 각 작업 전후 실제 기본 파일의 SHA-256을 비교하고 변경되면 실패한다. 증거는 `artifacts/usage-counter/hash-verification.json`이다.

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
| `LLM_USAGE_FILE` | 실제 서버의 일일 카운터 파일 경로. 기본 `artifacts/llm-usage.json`; 실제 라이브 평가는 공유, 테스트·검증·오프라인 평가는 격리 |

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
