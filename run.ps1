param([ValidateSet('install', 'dev', 'test', 'typecheck', 'build', 'snapshot', 'verify')][string]$Task = 'dev')
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  $nodeExecutable = if ($nodeCommand) { $nodeCommand.Source } else {
    Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
  }
  if (!(Test-Path -LiteralPath $nodeExecutable)) { throw 'Node.js 24 이상을 설치해 주세요.' }
  switch ($Task) {
    'install' {
      $pnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
      $bundledPnpm = Join-Path (Split-Path $nodeExecutable -Parent) '../node_modules/pnpm/bin/pnpm.cjs'
      if ($pnpmCommand) {
        & $pnpmCommand.Source install --frozen-lockfile --store-dir node_modules/.pnpm-store --node-linker=hoisted --package-import-method=copy
      } elseif (Test-Path -LiteralPath $bundledPnpm) {
        & $nodeExecutable $bundledPnpm install --frozen-lockfile --store-dir node_modules/.pnpm-store --node-linker=hoisted --package-import-method=copy
      } elseif (Get-Command npx -ErrorAction SilentlyContinue) {
        # 다른 PC(USB 이동 후): pnpm이 없어도 npx로 고정 버전을 받아 설치한다(인터넷 필요).
        & npx -y pnpm@11.25.0 install --frozen-lockfile --store-dir node_modules/.pnpm-store --node-linker=hoisted --package-import-method=copy
      } else { throw 'Node.js 24 이상(npm 포함)을 설치한 뒤 다시 실행해 주세요.' }
    }
    'dev' {
      # Native child inheritance preserves HTTP(S)_PROXY/NO_PROXY verbatim. Never print their values.
      $nodeHelp = & $nodeExecutable --help
      if ($nodeHelp -match '--use-env-proxy') {
        & $nodeExecutable --use-env-proxy scripts/dev.ts
      } else {
        Write-Warning '이 Node는 --use-env-proxy를 지원하지 않습니다. 환경 프록시를 쓰려면 Node 24.5 이상으로 업데이트해 주세요.'
        & $nodeExecutable scripts/dev.ts
      }
    }
    'test' { & $nodeExecutable --test tests/*.test.ts }
    'typecheck' { & $nodeExecutable node_modules/typescript/bin/tsc --noEmit }
    'build' {
      & $nodeExecutable node_modules/typescript/bin/tsc --noEmit
      if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
      & $nodeExecutable node_modules/vite/bin/vite.js build
    }
    'snapshot' { & $nodeExecutable scripts/snapshot.ts }
    'verify' { & $nodeExecutable scripts/verify-all.ts }
  }
  exit $LASTEXITCODE
} finally { Pop-Location }
