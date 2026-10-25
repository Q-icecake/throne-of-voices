import assert from 'node:assert/strict';
import { make, until, boundaries } from './scenarios.ts';

export function runSoak() {
  const g = make(), results = [];
  const commands = [null, '주유에게 수군을 정비하라고 전해. 먼저 공격하지는 마.', '노숙은 유비에게 비밀리에 연락해. 참전은 약속하지 말고.', '조조에게 "논의 후 답하겠다"라고 회신해.'];
  for (let cycle = 0; cycle < 12; cycle++) {
    g.reset(); assert.equal(g.view().clock.activeMs, 0); assert.equal(g.view().tasks.length, 0);
    const command = commands[cycle % commands.length];
    if (command) {
      until(g, cycle % 2 ? 10000 : 70000);
      const r = g.command({ type: 'submit', text: command }); assert.equal(r.outcome.kind, 'draft');
      if (r.outcome.kind === 'draft') g.command({ type: 'confirm', draftId: r.outcome.draftId, version: r.outcome.version });
    }
    until(g, 650000);
    const counts = () => ({ logs: g.logs().length, notices: g.view().opening!.notices.length, documents: g.internalSnapshot().world.documents.length, queue: g.view().audience.requested.length });
    const settled = counts();
    assert.ok(settled.documents <= 16 && settled.queue <= 2 && settled.notices <= 20 && settled.logs < 100);
    // 250 individual active seconds, then one more minute beyond the promised 15.
    for (let target = 651000; target <= 900000; target += 1000) { until(g, target); boundaries(g); }
    const at15 = counts();
    assert.deepEqual({ ...at15, logs: 0 }, { ...settled, logs: 0 });
    assert.equal(at15.logs - settled.logs, 250, 'only one intentional advance audit record per input; no repeated events');
    until(g, 960000); boundaries(g);
    assert.equal(g.view().clock.activeMs, 960000);
    assert.deepEqual({ ...counts(), logs: 0 }, { ...at15, logs: 0 });
    // Prove the same session still accepts decisions after 15 minutes.
    g.audience({ type: 'invite', participants: ['zhang-zhao'] });
    assert.deepEqual(g.view().audience.participants, ['zhang-zhao']);
    results.push({ cycle, variant: command ?? 'no decision', activeMs: 960000, settled, at15, passed: true });
  }
  return results;
}
