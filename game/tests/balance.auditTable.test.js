// PLAN-PHASE15 (Honest labels): the audit table's own rules (tools/labelAudit.mjs auditTable), on made-up rows: what counts as on target.
import test from 'node:test';
import assert from 'node:assert/strict';
import { auditTable, BAND_SLACK, CHANCE_SLACK } from '../../tools/labelAudit.mjs';

const rows = (label, n, won, promised, extra = {}) => Array.from({ length: n }, (_, i) => ({ policy: 'bot', tag: 'base', d: 1, label, promised, won: i < won, ...extra }));
const cell = (cells, slice, label) => cells.find((c) => c.slice === slice && c.label === label);

test('audit table: a band inside its promise (+-5 at the edges, chance +-12) is on target; outside is not; thin cells are not judged', () => {
  const cells = auditTable([
    ...rows('Easy', 40, 36, 0.93), // 90 %: in band
    ...rows('Fair', 40, 35, 0.72), // 87.5 %: inside 85 + 5, chance off 15.5 -> off target
    ...rows('Hard', 40, 17, 0.47), // 42.5 %: on target
    ...rows('Deadly', 10, 9, 0.1), // n 10: not judged
  ], { min: 30 });
  assert.equal(cell(cells, 'all', 'Easy').ok, true);
  const fair = cell(cells, 'all', 'Fair');
  assert.equal(fair.judged, true); assert.equal(fair.ok, false); assert.match(fair.why, /chance off/);
  assert.equal(cell(cells, 'all', 'Hard').ok, true);
  assert.equal(cell(cells, 'all', 'Deadly').judged, false);
  assert.equal(cell(cells, 'D1', 'Easy').n, 40, 'the dynasty slice reads the plain dyn plan');
  assert.equal(cell(cells, 'bot', 'Fair').judged, false, 'the policies are shown, not judged');
  assert.ok(BAND_SLACK === 0.05 && CHANCE_SLACK === 0.12, 'the plan\'s tolerances');
});

test('audit table: slices by personality, twist, type, capital, Gate, Throne, Crown and Ascension tag', () => {
  const cells = auditTable([
    ...rows('Fair', 30, 21, 0.72, { personality: 'swarm', twist: 'siege', capital: true }),
    ...rows('Fair', 30, 21, 0.72, { personality: 'usurper', throne: true, crown: true, tag: 'Crown', d: 7 }),
    ...rows('Hard', 30, 6, 0.47, { tag: 'A10', d: 3, asc: 10, type: 'ruins' }), // 20 %: below 35 - 5
  ]);
  for (const s of ['swarm', 'twist:siege', 'capital', 'Gate', 'usurper', 'Throne', 'Crown']) assert.equal(cell(cells, s, 'Fair').ok, true, s);
  assert.equal(cell(cells, 'A10', 'Hard').ok, false);
  assert.equal(cell(cells, 'type:ruins', 'Hard').ok, false);
  assert.equal(cell(cells, 'D7', 'Fair').n, 0, 'the Crown is its own slice, not D7');
});
