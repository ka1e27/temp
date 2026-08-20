// THE FRONTIER — the endless mode, and the properties that make it one.
//
// It is one enormous board whose difficulty rises with DISTANCE FROM YOUR OWN
// CAMP, so the player sets the difficulty by deciding how far to push. That is
// the whole difference from the incursion ladder, whose escalation is a number
// nobody chose, and it is why the tests below are mostly about the gradient
// being real and the score being honest rather than about a win rate.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ringOf, deepestRing, heldRings, wasBuilt, planFrontier, generateFrontierMap,
} from '../src/battle/frontier.js';
import { generateBattleMap, verifyReachable } from '../src/battle/mapgen.js';
import { FRONTIER, FRONTIER_ID, frontierRegion, frontierOpen } from '../src/content/endless.data.js';
import { REGIONS, REGION_BY_ID, REGION_IDS } from '../src/content/regions.data.js';
import { frontierReward, frontierRecord, applyFrontierRun, frontierSeed } from '../src/meta/endless.js';
import { createState } from '../src/core/store.js';
import { UNIT_IDS } from '../src/content/balance.js';

const spec = () => ({ ...frontierRegion(), enemyMult: 2.0, develop: 1.3 });
const bodies = (c) => UNIT_IDS.reduce((a, u) => a + (c[u] || 0), 0);
const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];

// ---------------------------------------------------------------------------
// The gradient — the thing the mode IS
// ---------------------------------------------------------------------------

test('the deep country is dramatically harder than the doorstep', () => {
  const map = generateFrontierMap(spec(), 1);
  const byRing = new Map();
  for (const s of map.sites) {
    if (s.owner === 'player') continue;
    const r = ringOf(s.hex);
    if (!byRing.has(r)) byRing.set(r, []);
    byRing.get(r).push(bodies(s.garrison));
  }
  const rings = [...byRing.keys()].sort((a, b) => a - b);
  assert.ok(rings.length >= 6, `only ${rings.length} rings populated`);
  const near = median(byRing.get(rings[0]));
  const far = median(byRing.get(rings[rings.length - 1]));
  assert.ok(far > near * 8, `ring ${rings[0]} medians ${near}, ring ${rings.at(-1)} medians ${far}`);
});

test('...and it rises rather than merely differing at the ends', () => {
  // A gradient with a hump in it would let a player walk past the hard part.
  //
  // THE CASTLE IS EXCLUDED, and that is a claim about what it IS rather than a
  // convenience. It carries a throne's base garrison — measured at 283 bodies
  // against the 112 of the strongest stronghold two rings in — so wherever the
  // far corner happens to put it, it dwarfs its own ring and the one past it.
  // It is the summit, not a rung. The first draft of this test asserted over it
  // and failed on the accident rather than on the property.
  const map = generateFrontierMap(spec(), 7);
  const worst = new Map();
  for (const s of map.sites) {
    if (s.owner === 'player' || s.kind === 'castle') continue;
    const r = ringOf(s.hex);
    worst.set(r, Math.max(worst.get(r) ?? 0, bodies(s.garrison)));
  }
  const rings = [...worst.keys()].sort((a, b) => a - b);
  // The STRONGEST garrison in each ring is non-decreasing, which is the claim
  // that matters — a ring's weakest site may always be a lightly-held farm.
  for (let i = 1; i < rings.length; i++) {
    assert.ok(worst.get(rings[i]) >= worst.get(rings[i - 1]),
      `ring ${rings[i]} tops out below ring ${rings[i - 1]}`);
  }
});

test('the rings SPAN the map rather than clamping a third of it flat', () => {
  // The first cut used 6 hexes a ring against a 60x48 board whose diagonal is
  // 83, so `maxRing` bit at distance 54 and the whole outer third was one flat
  // ring — the bot "reached the deepest ring" two-thirds of the way out.
  const { cols, rows } = FRONTIER;
  const farCorner = { q: (cols - 1) - Math.floor((rows - 1) / 2), r: rows - 1 };
  const span = FRONTIER.ringHexes * FRONTIER.maxRing;
  const diag = (Math.abs(farCorner.q) + Math.abs(farCorner.r)
    + Math.abs(farCorner.q + farCorner.r)) / 2;
  assert.ok(span >= diag * 0.85,
    `rings cover ${span} hexes of a ${diag}-hex diagonal — the outer band is flat`);
});

test('THE THRONE IS GATED BEHIND THE WHOLE FRONTIER, or the mode ends', () => {
  // The one property that makes this endless rather than a long region, and it
  // shipped WRONG: `castleGateFrac` was 0 on the reasoning that the castle sits
  // "at ring 9 behind the whole map", which was reasoned and false. Measured on
  // the real pipeline, the throne lands at ring 7 of a board whose deepest ring
  // is 8, and a player with the whole campaign behind them took it in 9,658 and
  // 11,357 ticks — two runs of three WON the endless mode in about sixteen
  // minutes, ending the exploration less than two thirds of the way through the
  // clock.
  //
  // Asserted as a FLOOR rather than as the number, because what matters is that
  // reaching the throne requires owning the frontier, not that it requires
  // exactly 85% of it. `GATE_CLAMP`'s 0.60 campaign ceiling is deliberately not
  // applied here — see the region row for why the inversion is intended.
  const gate = frontierRegion().castleGateFrac;
  assert.ok(gate >= 0.8,
    `the frontier throne opens at ${gate} of the map — a run can be ended by rushing it`);
  assert.ok(gate <= 1, 'a gate above 1 can never be met and the throne is decoration');
});

test('...and the campaign is not dragged up with it', () => {
  // The negative control, and the reason the frontier does not go through
  // `GATE_CLAMP`: a gate this high on a REGION is the exact defect the castle
  // gate pass spent a session removing (thirty-seven of thirty-seven timeouts
  // sat below the gate). It must stay a property of this one board.
  for (const r of REGIONS) {
    assert.ok((r.castleGateFrac ?? 0) <= 0.6,
      `${r.id} carries a gate of ${r.castleGateFrac} — the campaign ceiling is 0.60`);
  }
});

test('the player is never scaled, and neither is the doorstep', () => {
  const plain = generateBattleMap({ ...spec(), plan: planFrontier(spec()) }, 3);
  const scaled = generateFrontierMap(spec(), 3);
  for (const a of plain.sites.filter((s) => s.owner === 'player')) {
    const b = scaled.sites.find((s) => s.id === a.id);
    assert.deepEqual(b.garrison, a.garrison, `${a.id} was scaled`);
    assert.equal(b.level, a.level);
  }
});

// ---------------------------------------------------------------------------
// The score — and the exploit it had
// ---------------------------------------------------------------------------

test('a site you BUILT does not count toward the record', () => {
  // Measured on the first cut: the bot reached the outermost ring by minute ten
  // not by fighting but by laying a chain of 200-gold farms toward the throne,
  // because `simbuild.js` scores a build hex by its distance to the castle. A
  // record you can buy for 200 gold is not a record.
  const far = { id: 'ef09', owner: 'player', hex: [30, 28] };
  const built = { id: 'bf01', owner: 'player', hex: [30, 28] };
  assert.ok(ringOf(far.hex) > 3, 'fixture must be genuinely deep');
  assert.equal(deepestRing({ sites: [built] }), 0);
  assert.ok(deepestRing({ sites: [far] }) > 3);
  assert.equal(wasBuilt(built), true);
  assert.equal(wasBuilt(far), false);
});

test('...but it still counts toward the CROWNS', () => {
  // Holding forward ground is worth something; it is simply not what "how far
  // did you get" means. `heldRings` is the payout's input and counts everything.
  const state = { sites: [{ id: 'bf01', owner: 'player', hex: [30, 28] }] };
  assert.equal(heldRings(state).length, 1);
  assert.ok(heldRings(state)[0] > 3);
});

test('the ring is DERIVED, never stored — it does not survive the seam', () => {
  // The first cut wrote `site.ring` at generation time and it was silently
  // dropped: `createBattleState` rebuilds every site from a fixed field list, so
  // every run scored "deepest ring 0" while the garrisons it had scaled were
  // plainly working. A field that looks meaningful and vanishes is this
  // project's most-repeated defect.
  const map = generateFrontierMap(spec(), 11);
  for (const s of map.sites) {
    assert.equal(s.ring, undefined, `${s.id} carries a stored ring`);
  }
  assert.ok(ringOf(map.sites.find((s) => s.kind === 'castle').hex) >= 5);
});

// ---------------------------------------------------------------------------
// The payout
// ---------------------------------------------------------------------------

test('losing the camp pays nothing at all', () => {
  // Push-your-luck or nothing: a consolation payout is what would make banking
  // pointless.
  const st = createState({ seed: 1 });
  const r = frontierReward(st, { status: 'loss', heldRings: [1, 2, 5, 7] });
  assert.equal(r.crowns, 0);
  assert.equal(r.relics, 0);
});

test('deep ground is worth more than the doorstep', () => {
  const st = createState({ seed: 1 });
  const near = frontierReward(st, { status: 'timeout', heldRings: [0, 0, 0, 0] });
  const far = frontierReward(st, { status: 'timeout', heldRings: [6, 6, 6, 6] });
  assert.ok(far.crowns > near.crowns * 2, `${far.crowns} against ${near.crowns}`);
});

test('relics are paid ONLY for beating your own record', () => {
  // The property that makes the hard currency non-farmable here by
  // construction rather than by a cooldown: a record can only be broken by
  // breaking it. A raid pays no relics for exactly this reason.
  const st = createState({ seed: 1 });
  const first = frontierReward(st, { status: 'timeout', heldRings: [3] });
  assert.equal(first.relics, 3);
  assert.equal(first.record, true);
  applyFrontierRun(st, first);
  assert.equal(frontierRecord(st).bestRing, 3);

  const same = frontierReward(st, { status: 'timeout', heldRings: [3] });
  assert.equal(same.relics, 0, 'matching the record pays nothing');
  assert.equal(same.record, false);
  const worse = frontierReward(st, { status: 'timeout', heldRings: [1] });
  assert.equal(worse.relics, 0);
  const better = frontierReward(st, { status: 'timeout', heldRings: [5] });
  assert.equal(better.relics, 2, 'only the rings BEYOND the record pay');
});

test('...and one lucky run cannot pay out the whole ladder', () => {
  const st = createState({ seed: 1 });
  const r = frontierReward(st, { status: 'timeout', heldRings: [99] });
  assert.ok(r.relics <= 6, `${r.relics} relics from one run`);
});

test('the run counter advances even on a loss', () => {
  // It is what seeds the next map. Not advancing it would hand the player the
  // identical country to retry, which is the one thing a push-your-luck mode
  // must not offer.
  const st = createState({ seed: 1 });
  const before = frontierSeed(st, st.seed);
  applyFrontierRun(st, { deepest: 0 });
  assert.equal(frontierRecord(st).runs, 1);
  assert.notEqual(frontierSeed(st, st.seed), before, 'the next run is the same map');
});

// ---------------------------------------------------------------------------
// ...and it stays OUT of the campaign
// ---------------------------------------------------------------------------

test('the frontier is resolvable by id and absent from the campaign', () => {
  // The separation that keeps the endless mode outside every measured number:
  // `REGIONS` is what the world map draws, what campaign.test.js walks for its
  // non-decreasing invariants, what `regionsConquered` counts and what
  // `npm run sim --all` sweeps.
  assert.ok(REGION_BY_ID[FRONTIER_ID], 'must be resolvable by buildBattleConfig');
  assert.equal(REGIONS.some((r) => r.id === FRONTIER_ID), false);
  assert.equal(REGION_IDS.includes(FRONTIER_ID), false);
  assert.equal(REGIONS.length, 24, 'the campaign is still 24 regions');
});

test('no campaign region carries a plan, so the hook is inert', () => {
  // `generateBattleMap` takes `spec.plan` when one is supplied. Nothing shipped
  // supplies one, which is what makes the second planner provably free.
  for (const r of REGIONS) assert.equal(r.plan, undefined, `${r.id} carries a plan`);
});

test('it opens after the first tier, not after the campaign', () => {
  // The incursion ladder and abdication are already behind the finished
  // campaign; a third thing behind the same wall is a third thing most players
  // never see. This is meant to be an ALTERNATIVE to grinding the next region.
  assert.equal(frontierOpen(0), false);
  assert.equal(frontierOpen(3), false);
  assert.equal(frontierOpen(4), true);
  assert.equal(frontierOpen(24), true);
});

test('every generated frontier is fully connected', () => {
  // The one invariant a bigger board is most likely to break: a site walled off
  // by the rock scatter is a site nobody can ever reach.
  for (const seed of [1, 7, 42, 4242]) {
    const map = generateFrontierMap(spec(), seed);
    assert.equal(verifyReachable(map.grid, map.sites), true, `seed ${seed}`);
    assert.ok(map.sites.some((s) => s.kind === 'camp' && s.owner === 'player'));
    assert.ok(map.sites.some((s) => s.kind === 'castle' && s.owner === 'enemy'));
  }
});
