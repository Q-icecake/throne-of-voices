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
      } else { throw 'pnpm 11.25.0을 설치하거나, Codex의 Node.js 환경에서 실행해 주세요.' }
    }
    'dev' { & $nodeExecutable scripts/dev.ts }
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
