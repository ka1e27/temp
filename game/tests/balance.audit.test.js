// PLAN-PHASE15 (Honest labels): the label audit, fast: bot AND human policy pooled, seeds 1-6, D1-D2 (game/tests/_labelAuditFast.js;
// the full audit is tools/labelAudit.mjs). Before Phase 15 this failed: Fair fights were won 91 %, Hard 88 % in D2.
import test from 'node:test';
import { fastRows, assertHonest } from './_labelAuditFast.js';

test('honest labels in real campaign states (bot + human, D1-D2, seeds 1-6): each band wins what it promises', async () => {
  const rows = await fastRows([1, 2, 3, 4, 5, 6]);
  assertHonest(rows, 'D1-D2');
  assertHonest(rows.filter((r) => r.d === 1), 'D1');
  assertHonest(rows.filter((r) => r.d === 2), 'D2');
});
