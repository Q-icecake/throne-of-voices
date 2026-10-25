import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { build, createServer } from 'vite';

test('Vite serves the frontend while rejecting server source, private artifacts and environment values', async t => {
  const artifacts = fileURLToPath(new URL('../artifacts/', import.meta.url));
  await mkdir(artifacts, { recursive: true });
  const fixtureDir = await mkdtemp(join(artifacts, 'boundary-'));
  const fixtureFile = join(fixtureDir, 'private.json');
  await writeFile(fixtureFile, '{"hidden":"SERVER_ONLY_M0_SENTINEL"}');
  t.after(async () => { await unlink(fixtureFile); await rmdir(fixtureDir); });
  // Synthetic credential, not a real key. Even VITE_-prefixed values must stay out.
  const previous = process.env.VITE_M0_TEST_SECRET;
  process.env.VITE_M0_TEST_SECRET = 'SYNTHETIC_KEY_DO_NOT_SHIP';
  t.after(() => {
    if (previous === undefined) delete process.env.VITE_M0_TEST_SECRET;
    else process.env.VITE_M0_TEST_SECRET = previous;
  });
  const server = await createServer({ server: { port: 0 }, logLevel: 'silent' });
  t.after(() => server.close());
  await server.listen();
  const address = server.httpServer!.address();
  assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  const html = await fetch(url);
  assert.equal(html.status, 200);
  assert.ok((await html.text()).includes('MOCK 시험 모드'));
  const source = await fetch(url + '/src/main.ts');
  assert.equal(source.status, 200);
  const text = await source.text();
  assert.ok(!text.includes('SYNTHETIC_KEY_DO_NOT_SHIP'));
  assert.deepEqual(Object.keys(server.config.env).sort(), ['BASE_URL', 'DEV', 'MODE', 'PROD']);
  const targets = ['server/world.ts', 'server/engine.ts', '.env', 'tests/engine.test.ts'].map(relative => fileURLToPath(new URL('../' + relative, import.meta.url)));
  for (const target of [...targets, fixtureFile]) {
    const absolute = target.replaceAll('\\', '/');
    for (const suffix of ['', '?raw', '?import']) {
      const response = await fetch(url + '/@fs/' + encodeURI(absolute) + suffix);
      assert.ok([403, 404].includes(response.status), `${target}${suffix}: ${response.status}`);
      assert.ok(!(await response.text()).includes('SERVER_ONLY_M0_SENTINEL'));
    }
  }
});

test('production frontend bundle contains no private fixtures, server modules, or keys', async t => {
  const previous = process.env.VITE_M0_TEST_SECRET;
  process.env.VITE_M0_TEST_SECRET = 'SYNTHETIC_KEY_DO_NOT_SHIP';
  t.after(() => {
    if (previous === undefined) delete process.env.VITE_M0_TEST_SECRET;
    else process.env.VITE_M0_TEST_SECRET = previous;
  });
  const result = await build({ build: { write: false }, logLevel: 'silent' });
  assert.ok('output' in result);
  assert.ok(result.output.length > 0);
  for (const output of result.output) {
    const text = output.type === 'chunk' ? output.code : String(output.source);
    for (const forbidden of ['SERVER_ONLY_M0_SENTINEL', 'PRIVATE_ENEMY_INTENT', '987654', 'UNRELEASED_NAVAL_REPORT', 'process.env', 'SYNTHETIC_KEY_DO_NOT_SHIP']) {
      assert.ok(!text.includes(forbidden), `${output.fileName}: ${forbidden}`);
    }
    if (output.type === 'chunk') {
      assert.ok(!Object.keys(output.modules).some(path => path.replaceAll('\\', '/').includes('/server/')));
    }
  }
});
