import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { isFetchPortAllowed, listenForFetch } from '../scripts/test-server.ts';

test('029 fetch helper rejects blocked ports and retries a rejected binding', async t => {
  for (const port of [0, 21, 2049, 6000, 6566, 6665, 6669, 6697, 10080, 65536]) assert.equal(isFetchPortAllowed(port), false);
  const server = createServer((_req, res) => res.end('ok'));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  let accepted = 0;
  const port = await listenForFetch(server, () => ++accepted > 1);
  assert.equal(accepted, 2);
  assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), 'ok');
});
