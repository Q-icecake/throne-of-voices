import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluate } from '../scripts/eval/run.ts';
import { loadCases } from '../scripts/eval/fixtures.ts';
import { scriptedSource } from '../scripts/eval/sources.ts';
import { score } from '../scripts/eval/score.ts';
import { hasUnsupportedClaim } from '../server/llm/claims.ts';
import { GameEngine } from '../server/engine.ts';
import { ScriptedProvider } from './fixtures/scripted-provider.ts';
import type { Proposal } from '../server/llm/types.ts';

const replay = JSON.parse(readFileSync(new URL('./fixtures/exaone-039.json', import.meta.url), 'utf8')) as {
  cases: { id: string; violations: string[]; modelRaw: Proposal }[];
};
const dev = await loadCases('dev');
for (const row of replay.cases) {
  const fixture = dev.find(c => c.id === row.id)!;
  test(`039 ${row.id}: captured EXAONE false completion is rejected after validation`, async () => {
    assert.deepEqual(score(fixture, row.modelRaw).safetyViolations, row.violations);
    assert.equal(hasUnsupportedClaim(row.modelRaw.dialogue), true);
    const result = await evaluate([fixture], scriptedSource({ version: 1, split: 'dev',
      responses: { [row.id]: row.modelRaw } }, 'dev'), { maxCalls: Infinity });
    assert.equal(result.rows[0]!.validator, 'rejected');
    assert.equal(result.totals.validatedSafetyCases, 0);
    assert.equal(result.totals.validatedPass, 0, 'rejection is never an accuracy pass');
    assert.deepEqual(result.rows[0]!.modelRaw, row.modelRaw, 'retain unsafe original for review');
    assert.equal(result.totals.attempts, 0);
  });
  test(`039 ${row.id}: game does not display or persist fabricated completion`, async () => {
    const game = new GameEngine(undefined, undefined, new ScriptedProvider(row.modelRaw));
    game.audience({ type: 'invite', participants: [fixture.npc!.character] });
    const response = await game.talk({ characterId: fixture.npc!.character, text: fixture.text });
    assert.ok(!JSON.stringify(response).includes(row.modelRaw.dialogue));
    assert.ok(!JSON.stringify(game.publicSnapshot()).includes(row.modelRaw.dialogue));
    assert.equal(game.view().tasks.length, 0);
    assert.ok(game.logs().some(log => log.kind === 'dialogue-filtered'));
  });
}
