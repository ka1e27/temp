// THE NUMBER THAT DECIDES SEVERAL OF THESE BATTLES, MADE VISIBLE BEFORE YOU
// COMMIT TWENTY MINUTES TO ONE.
//
// `castleGateFrac` is the share of the countryside the throne holds out for.
// Until now it appeared NOWHERE before the fight, and in the fight only inside
// the castle's own panel and only once the throne was already under siege —
// `castleSealed` requires an active siege to answer at all. So a player
// correctly taking the countryside for twenty minutes had no way to know
// whether they were two points short of the gate or forty-seven, and the
// castle-gate pass measured every one of thirty-seven timeouts sitting below it.
//
// It leaks nothing: it is a static rule of the region, like its grid size.
import test from 'node:test';
import assert from 'node:assert/strict';
import { regionBrief } from '../src/screens/prebattle-brief.js';
import { createMeta } from '../src/core/store.js';
import { REGIONS, GATE_CLAMP } from '../src/content/regions.data.js';
import { planFor, incursionRules } from '../src/meta/incursion.js';

const gateRow = (rows) => rows.find((r) => r[0] === 'Throne holds until');

test('a region with a gate says what it is', () => {
  const brief = regionBrief(createMeta(), 'gallowmoor');
  const row = gateRow(brief.rows);
  assert.ok(row, 'gallowmoor has a gate and must say so');
  assert.match(row[1], /\d+%/);
});

test('a region with NO gate says nothing rather than "0%"', () => {
  // Five regions ship `castleGateFrac: 0` — all of tier 1 plus kaldan. "0%"
  // reads as a requirement of zero rather than as the absence of one, which is
  // the same confusion the results screen's own no-gate line was just fixed for.
  const brief = regionBrief(createMeta(), 'riverfen');
  assert.equal(gateRow(brief.rows), undefined);
});

test('every region either shows a gate or has none — no silent omissions', () => {
  const meta = createMeta();
  for (const r of REGIONS) {
    const shown = !!gateRow(regionBrief(meta, r.id).rows);
    const has = GATE_CLAMP(r.castleGateFrac ?? 0) > 0;
    assert.equal(shown, has, `${r.id}: gate ${r.castleGateFrac}, row shown ${shown}`);
  }
});

test('the figure shown is the CLAMPED one the battle will run under', () => {
  // `GATE_CLAMP` caps the campaign at 0.60 — the ceiling the castle-gate pass
  // brought down from 0.85 precisely because the table had walked up to it one
  // region at a time. Showing the raw column would advertise a gate the battle
  // does not use.
  const meta = createMeta();
  for (const r of REGIONS) {
    const row = gateRow(regionBrief(meta, r.id).rows);
    if (!row) continue;
    const pct = Number(row[1].match(/(\d+)%/)[1]);
    assert.equal(pct, Math.round(GATE_CLAMP(r.castleGateFrac) * 100), r.id);
    assert.ok(pct <= 60, `${r.id} advertises a gate above the campaign ceiling`);
  }
});

test('AN INCURSION SHOWS THE RUNG\'S GATE, NOT THE ARENA\'S', () => {
  // `sealed` raises the gate on a rung, and the ladder has its own ceiling
  // (`INCURSION.gateCeiling`) rather than the campaign's — quoting the region's
  // own figure at a rung fought under a different one is the same defect the
  // brief already fixes for `enemyMult`.
  const meta = createMeta();
  const arena = REGIONS.find((r) => r.id === 'widowsgate');
  let checked = 0;
  for (let d = 1; d <= 40; d++) {
    const plan = planFor(d);
    if (!plan.mutators.includes('sealed')) continue;
    const row = gateRow(regionBrief(meta, 'widowsgate', d).rows);
    assert.ok(row, `depth ${d} carries sealed and must show a gate`);
    const pct = Number(row[1].match(/(\d+)%/)[1]);
    const expected = incursionRules(
      { castleGateFrac: arena.castleGateFrac ?? 0 }, plan).castleGateFrac;
    assert.equal(pct, Math.round(expected * 100), `depth ${d}`);
    assert.ok(pct > Math.round(GATE_CLAMP(arena.castleGateFrac) * 100),
      `depth ${d}: sealed must RAISE the gate or the mutator is inert`);
    checked++;
    if (checked >= 3) break;
  }
  assert.ok(checked > 0, 'no rung in the first forty carries `sealed` — recheck the draw');
});

test('...and an unsealed rung shows the arena\'s own gate', () => {
  // The negative control: the incursion branch must not invent a raise.
  const meta = createMeta();
  const arena = REGIONS.find((r) => r.id === 'widowsgate');
  for (let d = 1; d <= 40; d++) {
    if (planFor(d).mutators.includes('sealed')) continue;
    const row = gateRow(regionBrief(meta, 'widowsgate', d).rows);
    assert.equal(Number(row[1].match(/(\d+)%/)[1]),
      Math.round(GATE_CLAMP(arena.castleGateFrac) * 100), `depth ${d}`);
    return;
  }
});
