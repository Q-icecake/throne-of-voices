import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { GameEngine } from '../server/engine.ts';
const guide = await readFile('docs/PLAY_GUIDE.md', 'utf8');
const rows = [...guide.matchAll(/^\| `([^`]+)` \| [^\n]+ \| `(question|draft|unsupported)` \|$/gm)];
assert.equal(rows.length, 10, 'all ten documented phrases must have an executable Mock expectation');
const results = rows.map(([, text, expected]) => {
  const g = new GameEngine(); const r = g.command({ type: 'submit', text: text! });
  const actual = r.outcome.kind === 'answer' ? r.outcome.intent : r.outcome.kind;
  assert.equal(actual, expected, text); assert.equal(g.view().tasks.length, 0);
  return { text, expected, actual, passed: true };
});
await writeFile('artifacts/m6/guide.json', JSON.stringify({ externalCalls: 0, results }, null, 2) + '\n');
console.log('PASS all 10 guide examples through the actual Mock interpreter; no task before confirmation');
