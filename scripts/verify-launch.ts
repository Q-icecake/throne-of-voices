import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
// Exercise the documented Windows entry point, including its working directory.
const freePort = async () => {
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = (probe.address() as AddressInfo).port; await new Promise<void>(r => probe.close(() => r())); return port;
};
const apiPort = await freePort(); let webPort = await freePort(); while (webPort === apiPort) webPort = await freePort();
const env = { ...process.env, THRONE_API_PORT: String(apiPort), THRONE_WEB_PORT: String(webPort), LLM_PROVIDER: 'mock', THRONE_SMOKE_STDIN: '1' };
const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'run.ps1', 'dev'], { env, windowsHide: true, stdio: 'pipe' });
let output = ''; child.stdout.on('data', d => { output += d; }); child.stderr.on('data', d => { output += d; });
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`dev exited ${child.exitCode}: ${output}`);
    ready = await fetch(`http://127.0.0.1:${webPort}`).then(r => r.ok, () => false);
    if (ready) break; await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(ready, 'documented dev URL must serve');
  const state = await (await fetch(`http://127.0.0.1:${apiPort}/api/state`)).json();
  assert.equal(state.interpretation.source, 'Mock'); assert.equal(state.tasks.length, 0);
  const proxied = await (await fetch(`http://127.0.0.1:${webPort}/api/state`)).json(); assert.equal(proxied.interpretation.source, 'Mock');
  await writeFile('artifacts/m6/launch.json', JSON.stringify({ command: '.\\run.ps1 dev', environment: { THRONE_API_PORT: apiPort, THRONE_WEB_PORT: webPort }, page: 200, api: 200, proxy: 200, provider: state.interpretation, passed: true }, null, 2));
  console.log(`PASS .\\run.ps1 dev: page ${webPort}, API ${apiPort}, proxy, honest Mock status, no key`);
} finally {
  const exited = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('smoke dev did not shut down after stdin EOF')), 15000);
    child.once('close', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(`smoke dev exited ${code}`)); });
  });
  child.stdin.end(); await exited;
  assert.equal(await fetch(`http://127.0.0.1:${apiPort}/api/state`).then(() => true, () => false), false, 'owned API must stop');
}
