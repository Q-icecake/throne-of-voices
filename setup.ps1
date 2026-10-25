[CmdletBinding()]
param(
  [switch]$InstallNode,
  [switch]$WithOllama,
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$')][string]$OllamaModel = 'qwen3:8b',
  [switch]$Verify,
  [Alias('DryRun')][switch]$WhatIf
)
$ErrorActionPreference = 'Stop'

# Pure plan: tests can inspect every install gate without executing commands.
function Get-SetupPlan {
  param([string]$NodeVersion, [bool]$OllamaInstalled, [bool]$AllowNode,
    [bool]$AllowOllama, [bool]$Check, [string]$Model = 'qwen3:8b')
  $major = 0
  if ($NodeVersion -match '^v?(\d+)\.') { $major = [int]$Matches[1] }
  if ($major -lt 24) {
    if (!$AllowNode) {
      [pscustomobject]@{ Id = 'blocked'; Network = $false; Admin = $false; Command = 'Node.js 24 이상이 필요합니다. Node 공식 설치 후 다시 실행하거나 -InstallNode를 명시하세요.' }
      return
    }
    [pscustomobject]@{ Id = 'node'; Network = $true; Admin = $true; Command = 'winget install OpenJS.NodeJS.LTS' }
  }
  [pscustomobject]@{ Id = 'dependencies'; Network = $true; Admin = $false; Command = '.\run.ps1 install (고정 pnpm, frozen lockfile, 프로젝트 내부 store)' }
  if ($Check) {
    [pscustomobject]@{ Id = 'typecheck'; Network = $false; Admin = $false; Command = '.\run.ps1 typecheck' }
    [pscustomobject]@{ Id = 'test'; Network = $false; Admin = $false; Command = '.\run.ps1 test' }
  }
  if ($AllowOllama) {
    if (!$OllamaInstalled) {
      [pscustomobject]@{ Id = 'ollama'; Network = $true; Admin = $true; Command = 'winget install Ollama.Ollama' }
    }
    [pscustomobject]@{ Id = 'service'; Network = $false; Admin = $false; Command = 'Ollama 서비스 확인: http://127.0.0.1:11434/api/tags (필요 시 숨김 ollama serve)' }
    [pscustomobject]@{ Id = 'model'; Network = $true; Admin = $false; Command = "ollama pull $Model (기본 qwen3:8b 약 5.2GB, 여유 10GB 권장; 다른 모델 크기는 다름)" }
    [pscustomobject]@{ Id = 'result'; Network = $false; Admin = $false; Command = 'Ollama 모델 설치 결과 확인 (/api/tags)' }
  }
}

function Find-SetupCommand {
  param([string]$Name)
  $found = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { return $found.Source }
  $candidates = @()
  if ($Name -eq 'node') {
    $candidates = @("$env:ProgramFiles/nodejs/node.exe", "$env:LOCALAPPDATA/Programs/nodejs/node.exe",
      "$env:USERPROFILE/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe")
  } elseif ($Name -eq 'ollama') { $candidates = @("$env:LOCALAPPDATA/Programs/Ollama/ollama.exe") }
  foreach ($candidate in $candidates) { if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate } }
  return $null
}

function Invoke-SetupNative {
  param([string]$Executable, [string[]]$Arguments)
  if (!$Executable) { throw '실행 파일을 찾지 못했습니다. 설치 후 새 PowerShell 창에서 다시 실행하세요.' }
  # Do not echo native output: package managers can expose inherited proxy values.
  & $Executable @Arguments *> $null
  if ($LASTEXITCODE -ne 0) { throw "명령이 종료 코드 $LASTEXITCODE 로 실패했습니다. 인터넷·디스크·설치 권한을 확인한 뒤 같은 명령을 다시 실행하세요." }
}

function Get-OllamaTags {
  Add-Type -AssemblyName System.Net.Http
  $handler = [System.Net.Http.HttpClientHandler]::new()
  $handler.UseProxy = $false
  $handler.AllowAutoRedirect = $false
  $client = [System.Net.Http.HttpClient]::new($handler)
  $client.Timeout = [TimeSpan]::FromSeconds(3)
  try {
    $response = $client.GetAsync('http://127.0.0.1:11434/api/tags').GetAwaiter().GetResult()
    try {
      if (!$response.IsSuccessStatusCode) { throw 'Ollama 서비스가 정상 응답하지 않습니다.' }
      return ($response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json)
    } finally { $response.Dispose() }
  } finally { $client.Dispose(); $handler.Dispose() }
}

function Invoke-Setup {
  $step = 'Node 버전 확인'
  $originalPath = $env:PATH
  $originalOllamaHost = $env:OLLAMA_HOST
  Push-Location $PSScriptRoot
  try {
    $nodeExe = Find-SetupCommand 'node'
    $version = if ($nodeExe) { (& $nodeExe --version 2>$null | Select-Object -First 1) } else { '' }
    $ollamaExe = Find-SetupCommand 'ollama'
    $plan = @(Get-SetupPlan -NodeVersion $version -OllamaInstalled ([bool]$ollamaExe) `
      -AllowNode ([bool]$InstallNode) -AllowOllama ([bool]$WithOllama) -Check ([bool]$Verify) -Model $OllamaModel)
    Write-Output '키를 입력받거나 저장하지 않습니다. 기본 공급자는 Mock입니다.'
    foreach ($item in $plan) {
      $network = if ($item.Network) { '인터넷 필요' } else { '외부 인터넷 불필요' }
      $admin = if ($item.Admin) { ' / 설치 관리자 권한이 필요할 수 있음' } else { '' }
      Write-Output "계획 [$network$admin] $($item.Command)"
    }
    if ($WhatIf) { Write-Output '드라이런 완료: 설치·의존성 변경·서비스 접속·모델 다운로드 0회.'; return 0 }
    # Match serve/pull to the fixed loopback probe, even with an inherited remote host.
    if ($WithOllama) { $env:OLLAMA_HOST = '127.0.0.1:11434' }
    foreach ($item in $plan) {
      $step = $item.Id
      Write-Output "실행 단계: $step (완료까지 기다려 주세요)"
      switch ($step) {
        'blocked' { throw $item.Command }
        'node' {
          Invoke-SetupNative (Find-SetupCommand 'winget') @('install', 'OpenJS.NodeJS.LTS', '--exact', '--silent', '--disable-interactivity', '--accept-source-agreements', '--accept-package-agreements')
          $nodeExe = Find-SetupCommand 'node'
          $installed = if ($nodeExe) { & $nodeExe --version } else { '' }
          if ($installed -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 24) { throw 'Node 24 이상 확인 실패. 새 PowerShell 창에서 다시 실행하세요.' }
        }
        'dependencies' {
          # Child run.ps1 uses exit; keep it in a child shell and reuse its install contract.
          # Only current process PATH changes, so run.ps1 sees a newly installed Node/npm.
          $env:PATH = (Split-Path $nodeExe -Parent) + [IO.Path]::PathSeparator + $env:PATH
          $setupShell = (Get-Process -Id $PID).Path
          Invoke-SetupNative $setupShell @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'run.ps1'), 'install')
        }
        { $_ -in 'typecheck', 'test' } {
          Invoke-SetupNative $setupShell @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'run.ps1'), $step)
        }
        'ollama' {
          Invoke-SetupNative (Find-SetupCommand 'winget') @('install', 'Ollama.Ollama', '--exact', '--silent', '--disable-interactivity', '--accept-source-agreements', '--accept-package-agreements')
          $ollamaExe = Find-SetupCommand 'ollama'
          if (!$ollamaExe) { throw 'Ollama 실행 파일 없음. 설치 후 새 PowerShell 창에서 -WithOllama로 다시 실행하세요.' }
        }
        'service' {
          try { $null = Get-OllamaTags } catch {
            $null = Start-Process -FilePath $ollamaExe -ArgumentList 'serve' -WindowStyle Hidden -PassThru
            $ready = $false
            for ($attempt = 0; $attempt -lt 5; $attempt++) {
              Start-Sleep -Seconds 1
              try { $null = Get-OllamaTags; $ready = $true; break } catch { }
            }
            if (!$ready) { throw 'Ollama 서비스 연결 실패. Ollama 실행·11434 포트 충돌을 확인 후 다시 실행하세요.' }
          }
        }
        'model' {
          $modelDrive = if ($env:OLLAMA_MODELS) { [IO.Path]::GetPathRoot($env:OLLAMA_MODELS) } else { [IO.Path]::GetPathRoot($env:USERPROFILE) }
          $disk = Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Root -eq $modelDrive } | Select-Object -First 1
          if ($disk -and $null -ne $disk.Free) {
            Write-Output ('모델 저장 드라이브 여유: {0:N1} GB. 기본 모델 약 5.2 GB, 10 GB 이상 권장.' -f ($disk.Free / 1GB))
            if ($OllamaModel -eq 'qwen3:8b' -and $disk.Free -lt 10GB) { throw '모델 드라이브 여유 부족. 10GB 이상 확보하거나 작은 -OllamaModel을 지정하세요.' }
          } else { Write-Output '모델 저장 드라이브 여유 확인 불가. 모델별 다운로드 크기와 저장 위치를 확인하세요.' }
          Invoke-SetupNative $ollamaExe @('pull', $OllamaModel)
        }
        'result' {
          $tags = Get-OllamaTags
          $modelName = if ($OllamaModel -match ':') { $OllamaModel } else { $OllamaModel + ':latest' }
          if (!(@($tags.models) | Where-Object { $_.name -eq $modelName -or $_.model -eq $modelName })) { throw '모델 설치 확인 실패. Ollama 저장 위치와 모델 이름을 확인하세요.' }
          Write-Output 'Ollama 서비스·요청 모델 설치 확인 완료. 추론 호출은 하지 않았습니다.'
        }
      }
    }
    Write-Output '설치 완료. .\run.ps1 dev 실행 후 Mock으로 시작하세요. AI 설정은 docs/LLM_SETUP.md를 참고하세요.'
    return 0
  } catch {
    # Only our Korean messages are emitted; raw exceptions can contain private paths/URLs.
    $message = if ($_.Exception.Message -match '^(Node|Ollama|모델|실행 파일|명령이)') { $_.Exception.Message } else { '설치·점검 실패. 인터넷, 설치 권한, 디스크 여유를 확인하고 새 PowerShell 창에서 다시 실행하세요.' }
    Write-Output "실패 단계: $step. $message"
    return 1
  } finally { $env:PATH = $originalPath; $env:OLLAMA_HOST = $originalOllamaHost; Pop-Location }
}

if ($MyInvocation.InvocationName -ne '.') {
  # Capture function return code without mixing status output into the exit value.
  $setupExitCode = 0
  Invoke-Setup | ForEach-Object { if ($_ -is [int]) { $setupExitCode = $_ } else { Write-Output $_ } }
  exit $setupExitCode
}
