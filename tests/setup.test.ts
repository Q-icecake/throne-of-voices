import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const shell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
const script = resolve('setup.ps1').replaceAll("'", "''");
const run = (code: string, extraEnv = {}) => spawnSync(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
  '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); ' + code], {
  encoding: 'utf8', windowsHide: true, env: { ...process.env, ...extraEnv }, timeout: 30000,
});
const load = `. '${script}'; `;
const source = readFileSync('setup.ps1', 'utf8');

test('039 setup has a UTF-8 BOM and parses with the installed PowerShell AST parser', () => {
  assert.equal(source.charCodeAt(0), 0xfeff);
  const result = run(`$tokens=$null; $errors=$null; $null=[System.Management.Automation.Language.Parser]::ParseFile('${script}',[ref]$tokens,[ref]$errors); if($errors.Count){$errors | ForEach-Object {$_.Message}; exit 1}`);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('039 pure setup plans gate installers, checks and Ollama behind explicit switches', () => {
  const result = run(load + `
    $plans=@(); foreach($nodeVersion in @('','v22.0.0','v24.0.0','v26.12.1')) {
      foreach($allowNode in @($false,$true)) { foreach($allowOllama in @($false,$true)) {
        foreach($installed in @($false,$true)) { foreach($check in @($false,$true)) {
          $plans += [pscustomobject]@{version=$nodeVersion; allowNode=$allowNode; allowOllama=$allowOllama;
            installed=$installed; check=$check; plan=@(Get-SetupPlan $nodeVersion $installed $allowNode $allowOllama $check)}
        } }
      } }
    }; ConvertTo-Json -Depth 5 -InputObject $plans`);
  assert.equal(result.status, 0, result.stderr);
  const plans = JSON.parse(result.stdout) as { version: string; allowNode: boolean; allowOllama: boolean;
    installed: boolean; check: boolean; plan: { Id: string; Network: boolean }[] }[];
  assert.equal(plans.length, 64);
  for (const p of plans) {
    const ids = p.plan.map(step => step.Id);
    const oldNode = !p.version || p.version.startsWith('v22.');
    if (oldNode && !p.allowNode) { assert.deepEqual(ids, ['blocked']); continue; }
    assert.equal(ids.includes('node'), oldNode && p.allowNode);
    assert.equal(ids.includes('ollama'), p.allowOllama && !p.installed);
    assert.equal(ids.includes('service'), p.allowOllama);
    assert.equal(ids.includes('model'), p.allowOllama);
    assert.equal(ids.includes('result'), p.allowOllama);
    assert.equal(ids.includes('typecheck'), p.check);
    assert.equal(ids.includes('test'), p.check);
    assert.ok(ids.includes('dependencies'));
  }
});

test('039 actual dry run exposes no environment credentials and executes no mutations or network', () => {
  const sentinel = 'SETUP_SECRET_MUST_NEVER_APPEAR_039';
  const result = run(load + `
    $WhatIf=$true; $InstallNode=$true; $WithOllama=$true; $Verify=$true;
    function Find-SetupCommand { return $null }
    function Invoke-SetupNative { throw 'FORBIDDEN_NATIVE' }
    function Get-OllamaTags { throw 'FORBIDDEN_NETWORK' }
    function Start-Process { throw 'FORBIDDEN_START' }
    Invoke-Setup`, { GEMINI_API_KEY: sentinel, OPENAI_API_KEY: sentinel, HTTPS_PROXY: sentinel });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /OpenJS.NodeJS.LTS/);
  assert.match(result.stdout, /Ollama.Ollama/);
  assert.match(result.stdout, /qwen3:8b/);
  assert.ok(!result.stdout.includes(sentinel));
  assert.ok(!result.stderr.includes(sentinel));
  assert.doesNotMatch(result.stdout + result.stderr, /FORBIDDEN_/);
  assert.match(result.stdout.trim(), /0$/);
});

test('039 missing Node without install switch stops before invoking any command', () => {
  const result = run(load + `function Find-SetupCommand { return $null }; function Invoke-SetupNative { throw 'FORBIDDEN_INSTALL' }; Invoke-Setup`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /-InstallNode/);
  assert.doesNotMatch(result.stdout, /FORBIDDEN_INSTALL/);
  assert.match(result.stdout.trim(), /1$/);
});

test('039 native command failure is propagated and setup restores location and process PATH', () => {
  const node = process.execPath.replaceAll("'", "''");
  const result = run(load + `
    function Find-SetupCommand { param($Name); if($Name -eq 'node'){return '${node}'}; return $null }
    function Invoke-SetupNative { throw '명령이 종료 코드 7 로 실패했습니다.' }
    $beforePath=$env:PATH; $beforeLocation=(Get-Location).Path;
    $output=@(Invoke-Setup);
    if($output[-1] -ne 1 -or $env:PATH -ne $beforePath -or (Get-Location).Path -ne $beforeLocation){exit 9}
    $output`);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /7/);
});

for (const optional of [false, true]) test(`039 setup dispatcher with mocked executables: Ollama=${optional}`, () => {
  const node = process.execPath.replaceAll("'", "''");
  const result = run(load + `
    $WithOllama=$${optional}; $Verify=$true; $script:ready=$false; $script:probes=0;
    $env:OLLAMA_HOST='private-inherited-host';
    $script:calls=[System.Collections.Generic.List[string]]::new();
    function Find-SetupCommand { param($Name)
      if($Name -eq 'node'){return '${node}'}
      if($Name -eq 'winget'){return 'mock-winget'}
      if($Name -eq 'ollama' -and $script:ready){return 'mock-ollama'}
      return $null
    }
    function Invoke-SetupNative { param($Executable,$Arguments)
      if(($Arguments -contains 'pull') -and $env:OLLAMA_HOST -ne '127.0.0.1:11434'){throw 'wrong model host'}
      $script:calls.Add($Executable + ' ' + ($Arguments -join ' '));
      if($Arguments -contains 'Ollama.Ollama'){$script:ready=$true}
    }
    function Get-OllamaTags {
      $script:probes++;
      if($script:probes -eq 1){throw 'offline simulated service'}
      return [pscustomobject]@{models=@([pscustomobject]@{name='qwen3:8b';model='qwen3:8b'})}
    }
    function Start-Process { param($FilePath,$ArgumentList,$WindowStyle,[switch]$PassThru)
      if($WindowStyle -ne 'Hidden'){throw 'visible process'}
      $script:calls.Add('serve-hidden')
    }
    function Start-Sleep { param($Seconds) }
    $output=@(Invoke-Setup);
    if($output[-1] -ne 0 -or $env:OLLAMA_HOST -ne 'private-inherited-host'){$output; exit 9}
    ConvertTo-Json -InputObject @($script:calls)` , { OLLAMA_MODELS: 'Z:\\setup-test-models' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const calls = JSON.parse(result.stdout) as string[];
  assert.equal(calls.length, optional ? 6 : 3);
  assert.ok(calls[0]!.endsWith('run.ps1 install'));
  assert.ok(calls[1]!.endsWith('run.ps1 typecheck'));
  assert.ok(calls[2]!.endsWith('run.ps1 test'));
  assert.equal(calls.some(call => call.includes('Ollama.Ollama')), optional);
  assert.equal(calls.some(call => call.includes('pull qwen3:8b')), optional);
  assert.equal(calls.includes('serve-hidden'), optional);
  assert.ok(!calls.some(call => call.includes('OpenJS.NodeJS.LTS')));
});

test('039 installation reuses run.ps1 and does not request or persist keys', () => {
  assert.match(source, /Join-Path \$PSScriptRoot 'run\.ps1'/);
  assert.doesNotMatch(source, /Read-Host|Set-Content|WriteAllText|setx|Invoke-Expression|Set-ExecutionPolicy/i);
  assert.match(source, /\$handler\.UseProxy = \$false/);
  assert.match(source, /\$handler\.AllowAutoRedirect = \$false/);
});
