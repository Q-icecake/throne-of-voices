# USB로 옮겨 다른 PC에서 계속 작업하기

## 무엇을 옮기나

이 폴더(`Throne of Voices`) **하나**면 된다. git 저장소(`.git`)에 전체 히스토리와 백업 태그가 들어 있다. 코드에는 이 PC의 절대 경로가 없다(통합 시 검사함).

단, `.git`이 디렉터리가 아니라 다른 저장소를 가리키는 **파일인 worktree**는 폴더만 복사하면 Git 기록을 옮길 수 없다. USB에는 정본 clone을 복사하거나 독립 clone을 준비한다. 설치 스크립트는 Git 메타데이터를 수정하지 않는다.

**제외해도 되는 것(용량 절약, 다시 만들 수 있음)**: `node_modules/`(수백 MB, `.pnpm-store` 포함), `dist/`, `artifacts/`(스크린샷·평가 결과).
단, `artifacts/eval/`의 평가 결과는 다시 만들기 어렵다(실호출 결과). 필요하면 함께 복사한다. 그 안에 키는 없다.

**옮기지 않는 것**: API 키(환경변수/화면 입력이라 파일에 없음), Ollama 모델(아래 참고).

## 복사 방법 (이 PC에서)

폴더를 통째로 복사하되 큰 폴더를 빼려면 PowerShell에서(`E:`는 USB 드라이브 문자):

```powershell
robocopy "C:\경로\Throne of Voices" "E:\Throne of Voices" /E /XD node_modules dist
```

OneDrive 폴더에서 복사하는 경우 파일이 "클라우드에만 있는" 상태일 수 있으니 폴더를 "항상 이 장치에 유지"로 두고 복사한다. 복사 후 USB에서 `git status`가 깨끗한지 확인한다. 프로젝트를 USB 파일시스템에서 직접 열 때 git이 "dubious ownership"을 말하면 한 번만 `git config --global --add safe.directory "E:/Throne of Voices"`를 실행한다. NTFS/exFAT 어느 쪽이든 동작한다.

## 새 PC에서 처음 한 번 (준비물)

한 번에 준비하려면 저장소 루트의 `setup.ps1`을 사용한다. [새 Claude 창용 설치 프롬프트](NEW_PC_SETUP_PROMPT.md)를 그대로 붙여 넣어도 된다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\setup.ps1 -WhatIf -Verify
# 위 계획을 확인한 뒤 실제 설치 (인터넷 필요)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\setup.ps1 -Verify
# Node가 없거나 24 미만일 때만 자동 설치 허용: -InstallNode
# 로컬 모델을 원할 때만: -WithOllama (-OllamaModel 기본 qwen3:8b)
```

실행 위치 대신 스크립트 폴더를 기준으로 의존성을 설치하므로 USB의 공백·한글 경로에서도 동작한다. `-WhatIf`/`-DryRun`은 설치·서비스 접속·모델 다운로드를 하지 않는다. 실제 설치의 고정 pnpm·프로젝트 내부 store·frozen lockfile은 `run.ps1 install`을 재사용한다. winget 단계는 설치 관리자 권한이 필요할 수 있으며 자동 권한 상승은 하지 않는다. 실패하면 원인과 다음 조치를 한국어로 출력하고 종료한다. 키는 받거나 저장하지 않는다. 모델은 USB가 아니라 Ollama의 모델 저장 드라이브(기본 사용자 프로필, 선택적 `OLLAMA_MODELS`)에 내려받는다. qwen3:8b는 약 5.2GB이며 여유 10GB 이상을 권장한다.

1. **Node.js 24 이상**(개발 기준 26.12) — npm이 같이 설치된다. https://nodejs.org
2. **Git** (`git log`로 히스토리를 보려면)
3. **Microsoft Edge 또는 Chrome** (게임 화면, 그리고 `run.ps1 verify`/스크린샷 검증)
4. (선택, Ollama를 쓸 때만) **Ollama**와 모델: `ollama pull qwen3:4b` (qwen3:8b, exaone3.5:7.8b도 비교에 사용). 모델은 PC마다 따로 받는다. 16GB RAM이면 8b급 모델은 느릴 수 있다.
5. (선택) Gemini 키 — 파일에 저장하지 말고 화면에 입력

pnpm은 따로 설치하지 않아도 된다(`run.ps1 install`이 npx로 11.25.0을 받아 쓴다).

## 이어서 작업하기

```powershell
cd "E:\Throne of Voices"       # 복사한 위치
.\run.ps1 install              # 인터넷 필요. node_modules 생성
.\run.ps1 test                 # 1138개 통과하는지 확인
.\run.ps1 dev                  # http://127.0.0.1:5173 에서 Mock 시작
```

PowerShell이 스크립트 실행을 막으면 현재 창에서만 `Set-ExecutionPolicy -Scope Process Bypass` 후 다시 실행한다. 그다음 [HANDOFF.md](../HANDOFF.md)의 6절(다음 단계)부터 보면 된다.

## 작업을 USB에 되돌릴 때

작업은 커밋으로 남긴다(`git add -A; git commit -m "..."`). 커밋하면 히스토리가 USB 폴더 안 `.git`에 쌓이므로 두 PC가 같은 폴더를 오가며 사용해도 된다. 두 PC에서 동시에 수정하지 않는다. `.git` 없이 파일만 복사하면 히스토리와 백업 태그를 잃는다.

## 이 PC의 옛 작업 폴더 정리 (선택, 급하지 않음)

`%USERPROFILE%\dispatch-work\throne-*`는 이 저장소의 git worktree였다. 내용은 모두 main에 들어갔으므로 필요 없지만, 백업 태그가 있으니 지워도 복구 가능하다. 지울 때는 폴더만 삭제하지 말고 먼저 `git worktree remove <경로>`, 그다음 `git worktree prune`을 사용한다. 실행 중인 평가가 그 폴더를 쓰고 있을 수 있으니 끝난 뒤에 한다. `dispatch-work\throne-v02\artifacts\`에는 평가 결과·스크린샷이 있으니 필요한 것은 복사해 둔다.
