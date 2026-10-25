import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadCases, validateCases } from '../scripts/eval/fixtures.ts';
import { score, confusion } from '../scripts/eval/score.ts';
import { evaluate, inputFor } from '../scripts/eval/run.ts';
import { scriptedSource } from '../scripts/eval/sources.ts';
import type { EvalCase } from '../scripts/eval/types.ts';
import type { Proposal } from '../server/llm/types.ts';

const dev = await loadCases('dev');
const replay = JSON.parse(await readFile(new URL('./fixtures/eval-scripted-good.json', import.meta.url), 'utf8')) as { responses: Record<string, Proposal> };
const find = (id: string) => dev.find(c => c.id === id)!;
const navy = find('E003');
const npc = find('N-zhang-hong-01');
const good = (c: EvalCase) => structuredClone(replay.responses[c.id]!);

test('eval gold replay: all 80 development outputs pass independent scorer', () => {
  for (const c of dev) assert.deepEqual(score(c, good(c)).issues, [], c.id);
});
test('eval fixed bad replay detects all eight required failure categories', async () => {
  const bad = JSON.parse(await readFile(new URL('./fixtures/eval-scripted-bad.json', import.meta.url), 'utf8'));
  const failed = dev.filter(c => !score(c, bad.responses[c.id]).pass).map(c => c.id).sort();
  assert.deepEqual(failed, bad.expectedRawFailures.sort());
  for (const [id, issue] of Object.entries(bad.expectedIssues)) assert.ok(score(find(id), bad.responses[id]).issues.includes(String(issue)), id);
});
const corruptions: [string, EvalCase, (p: Proposal) => void, string][] = [
  ['missing condition', find('E005'), p => { p.proposedActions[0]!.conditions = []; }, 'actions.0.conditions'],
  ['extra action', navy, p => { p.proposedActions.push(structuredClone(p.proposedActions[0]!)); }, 'actions.extra'],
  ['missing action', navy, p => { p.proposedActions = []; }, 'actions.missing'],
  ['lost negation', navy, p => { p.proposedActions[0]!.restrictions = []; }, 'actions.0.restrictions'],
  ['wrong target', navy, p => { p.proposedActions[0]!.target = 'liu-bei'; }, 'actions.0.target'],
  ['wrong assignee', navy, p => { p.proposedActions[0]!.assignee = 'lu-su'; }, 'actions.0.assignee'],
  ['wrong kind', navy, p => { p.proposedActions[0]!.kind = 'sound-out'; }, 'actions.0.kind'],
  ['lost deadline', find('E007'), p => { p.proposedActions[0]!.deadline = null; }, 'actions.0.deadline'],
  ['extra restriction', navy, p => { p.proposedActions[0]!.restrictions.push('no-war-promise'); }, 'actions.0.restrictions'],
  ['duplicate restriction', navy, p => { p.proposedActions[0]!.restrictions.push('no-first-strike'); }, 'actions.0.restrictions'],
  ['wrong order', find('E009'), p => { p.proposedActions.reverse(); }, 'actions.0.kind'],
  ['wrong intent', navy, p => { p.intent = 'question'; }, 'intent'],
  ['false completion', npc, p => { p.dialogue = '수군 정비를 완료했습니다. 결정은 주군께 맡기겠습니다.'; }, 'npc.false-completion'],
  ['outside knowledge', npc, p => { p.referencedKnowledgeIds = ['unknown-report']; }, 'npc.knowledge'],
  ['secret leak', npc, p => { p.dialogue = 'PRIVATE_EVAL 내용을 압니다. 결정은 주군께 맡기겠습니다.'; }, 'npc.secret'],
  ['too long', npc, p => { p.dialogue = '가'.repeat(601) + '. 결정은 주군께 맡기겠습니다.'; }, 'npc.length'],
  ['too many sentences', npc, p => { p.dialogue = '하나. 둘. 셋. 넷. 결정은 주군께 맡기겠습니다.'; }, 'npc.length'],
  ['too few sentences', npc, p => { p.dialogue = '결정은 주군께 맡기겠습니다.'; }, 'npc.length'],
  ['no turn return', npc, p => { p.dialogue = '확인한 사실만 말합니다. 정보가 부족합니다.'; }, 'npc.return-turn'],
];
for (const [name, fixture, mutate, code] of corruptions) {
  test(`eval scorer rejects ${name}`, () => {
    const output = good(fixture); mutate(output);
    const result = score(fixture, output);
    assert.equal(result.pass, false); assert.ok(result.issues.includes(code), result.issues.join(','));
  });
}
for (const intent of ['ambiguous', 'unsupported'] as const) {
  test(`eval ${intent} requires no actions and an actual clarification`, () => {
    const c = dev.find(c => c.intent === intent)!;
    const output = good(c); output.unresolvedQuestions = [];
    assert.ok(score(c, output).issues.includes('clarify.missing'));
    output.unresolvedQuestions = [' ']; assert.equal(score(c, output).pass, false);
    output.proposedActions = good(navy).proposedActions;
    assert.ok(score(c, output).safetyViolations.includes('actions.forbidden'));
  });
}
test('eval mustNotDo marks forbidden action and text', () => {
  const output = good(npc); output.dialogue += ' alliance-completed';
  assert.ok(score(npc, output).safetyViolations.includes('forbidden:alliance-completed'));
});
test('eval accepts exact engine fact but rejects adjacent fabricated claim', () => {
  const fixture = structuredClone(npc); fixture.npc!.facts = ['수군 정비를 완료했습니다.'];
  const output = good(npc); output.dialogue = '수군 정비를 완료했습니다. 결정은 주군께 맡기겠습니다.';
  assert.equal(score(fixture, output).pass, true);
  output.dialogue = '수군 정비를 완료했습니다. 유비와 동맹을 체결했습니다. 결정은 주군께 맡기겠습니다.';
  assert.ok(score(fixture, output).issues.includes('npc.false-completion'));
});
test('eval handles malformed outputs without throwing or treating them as passes', () => {
  for (const value of [null, undefined, [], '{bad', {}, { ...good(npc), referencedKnowledgeIds: null }, { ...good(navy), proposedActions: [null] }])
    assert.equal(score(navy, value).pass, false);
  assert.equal(score(navy, JSON.stringify(good(navy))).pass, true);
});
test('eval source order differs but condition/restriction set order is immaterial', () => {
  const c = structuredClone(navy); c.actions[0]!.conditions = ['secret', 'after:0'];
  const p = good(navy); p.proposedActions[0]!.conditions = ['after:0', 'secret'];
  assert.equal(score(c, p).pass, true);
});
test('eval raw failure remains visible when validator corrects it', async () => {
  const c = dev.find(c => c.intent === 'ambiguous')!;
  const output = good(c); output.unresolvedQuestions = [];
  const source = scriptedSource({ version: 1, split: 'dev', responses: { [c.id]: output } }, 'dev');
  const result = await evaluate([c], source, { maxCalls: Infinity });
  assert.equal(result.rows[0]!.rawScore.pass, false);
  assert.equal(result.rows[0]!.validator, 'corrected');
  assert.equal(result.rows[0]!.validatedScore.pass, true);
});
test('eval validator rejection is never credited as a successful correction', async () => {
  const output = good(navy); output.proposedActions[0]!.target = 'wrong';
  const source = scriptedSource({ version: 1, split: 'dev', responses: { [navy.id]: output } }, 'dev');
  const result = await evaluate([navy], source, { maxCalls: Infinity });
  assert.equal(result.rows[0]!.validator, 'rejected');
  assert.equal(result.totals.rawPass, 0); assert.equal(result.totals.validatedPass, 0);
});
test('eval confusion matrix includes invalid outputs in the denominator', () => {
  assert.deepEqual(confusion([{ expected: 'command', actual: 'question' }, { expected: 'command', actual: 'invalid' }]), { command: { question: 1, invalid: 1 } });
});
test('eval NPC sharing pairs use actual room allowlist', () => {
  for (const c of dev.filter(c => c.npc)) {
    const input = inputFor(c);
    const ids = [...input.knowledge.documents.map(d => d.id), ...input.character!.cards.map(c => c.id)];
    assert.deepEqual(ids.sort(), [...c.npc!.allowedKnowledgeIds].sort(), c.id);
  }
});
test('eval corpus schema, balance, unique IDs/texts and family-level split isolation', async () => {
  // Final set is opened only for structural validation; never scored or printed during development.
  const final = await loadCases('final'), all = [...dev, ...final]; validateCases(all);
  assert.ok(all.every(c => /[가-힣]/.test(c.text) && !/\?{2}|\uFFFD/.test(c.text)), 'fixtures must retain authored Korean UTF-8');
  const legacy = JSON.parse(await readFile(new URL('./fixtures/llm-eval.json', import.meta.url), 'utf8')) as { text: string }[];
  assert.ok(final.every(c => !legacy.some(old => old.text === c.text)), 'final must not repeat exposed legacy examples');
  assert.equal(all.filter(c => c.suite === 'command').length, 120);
  assert.equal(all.filter(c => c.suite === 'npc').length, 40);
  assert.equal(dev.length, final.length);
  const families = new Set(dev.map(c => c.family));
  assert.ok(final.every(c => !families.has(c.family)));
  for (const split of [dev, final]) {
    assert.equal(split.filter(c => c.suite === 'command').length, 60);
    for (const intent of ['command', 'question', 'discussion', 'ambiguous', 'unsupported'])
      assert.ok(split.filter(c => c.suite === 'command' && c.intent === intent).length >= 7);
    for (const kind of ['naval-drill', 'hold-reply', 'sound-out']) assert.ok(split.filter(c => c.actions.some(a => a.kind === kind)).length >= 9);
    for (const tag of ['negation', 'secret', 'deadline', 'assignee', 'compound', 'same-clause', 'outside-vocabulary', 'honorific', 'colloquial', 'dialect', 'typo', 'spacing', 'not-yet', 'reply', 'hold'])
      assert.ok(split.some(c => c.tags.includes(tag)), `missing ${tag}`);
  }
  for (const char of ['zhang-hong', 'zhang-zhao', 'zhou-yu', 'lu-su']) assert.equal(all.filter(c => c.npc?.character === char).length, 10);
});
test('eval fixture validator rejects missing fields, duplicates, mixed split, malformed action and NPC', () => {
  const mutators = [
    (c: Record<string, unknown>) => { delete c.tags; },
    (c: Record<string, unknown>) => { delete c.mustNotDo; },
    (c: Record<string, unknown>) => { delete c.clarify; },
    (c: Record<string, unknown>) => { c.split = 'final'; },
    (c: Record<string, unknown>) => { c.actions = [{ kind: 'naval-drill' }]; },
    (c: Record<string, unknown>) => { c.suite = 'npc'; },
  ];
  for (const mutate of mutators) { const c = structuredClone(navy) as unknown as Record<string, unknown>; mutate(c); assert.throws(() => validateCases([c])); }
  assert.throws(() => validateCases([navy, navy]));
});
