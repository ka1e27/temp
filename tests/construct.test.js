// RAISING A BUILDING MID-BATTLE.
//
// The map used to be the map you were dealt. Every assertion here drives a REAL
// battle through `state.commands` and `step()` — the same path a click takes and
// the same path tools/simplayer.js drives — because the failure mode this
// project keeps hitting is a fixture that encodes the bug and passes forever.
import test from 'node:test';
import assert from 'node:assert/strict';

import { startBattle, step } from '../src/battle/sim.js';
import { buildBlocker, buildingFor, drainCommands } from '../src/battle/commands.js';
import { generateBattleMap, gridHexes } from '../src/battle/mapgen.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { createState } from '../src/core/store.js';
import { createBattleState } from '../src/battle/state.js';
import { makeMods, CONTRACT_VERSION } from '../src/battle/contract.js';
import { markConquered, refreshUnlocks } from '../src/meta/world.js';
import { REGIONS } from '../src/content/regions.data.js';
import {
  BUILD_COSTS, BUILDABLE_KINDS, BUILD_MIN_SEPARATION, SITES, SITE_KINDS, CENTIGOLD, VISION_RADIUS,
} from '../src/content/balance.js';
// BUILD_MAX_CONCURRENT cannot yet ride balance.js's own re-export — see
// battle/construct.js's own import comment for why.
import { BUILD_MAX_CONCURRENT } from '../src/content/balance.construct.js';
import { siteTrainRate } from '../src/battle/training.js';
import { siteGoldPerSec, goldOf } from '../src/battle/economy.js';
import { distance } from '../src/core/hex.js';
import { canSee } from '../src/battle/vision.js';
import { territoryAt } from '../src/battle/influence.js';
import { emptyComp, total } from '../src/battle/combat.js';

/** A real battle for `id`, on the real path, with the enemy AI held off unless
 *  asked otherwise — most of these are about the BUILD, not about surviving it. */
function battleFor(id = 'gallowmoor', { quiet = true, gold = 200000 } = {}) {
  const state = createState({ seed: 1, now: 0 });
  const i = REGIONS.findIndex((r) => r.id === id);
  for (const p of REGIONS.slice(0, i)) markConquered(state.meta, p.id, { now: 0, durationMs: 0 });
  refreshUnlocks(state.meta, null);
  const b = startBattle(buildBattleConfig(state.meta, id, [], generateBattleMap, { seed: 5 }));
  b.factions.player.goldCg = gold;
  if (quiet) b.ai.nextThinkTick = 1e9;
  return b;
}

const legalHexes = (b, faction = 'player') => gridHexes(b.grid.cols, b.grid.rows)
  .filter((h) => !buildBlocker(b, faction, h));

const rejections = (b) => b.events
  .filter((e) => e.type === 'command-rejected').map((e) => e.reason);

// ---------------------------------------------------------------------------
// Where it may stand
// ---------------------------------------------------------------------------

test('build: there is somewhere legal to build on every region in the campaign', () => {
  // A rule with no legal hex is not a rule, it is a disabled feature — and this
  // was true on the first cut, under the OLD range-from-a-site rule:
  // `BUILD_RANGE_HEXES` was 2 against a `MAPGEN.minSeparation` of 3, which asks
  // for a hex simultaneously within 2 of your farm and at least 3 from it, and
  // every one of gallowmoor's 192 hexes was refused with nothing failing loudly.
  //
  // The ground rule is TERRITORY now (buildBlocker reads `state.influence`
  // rather than a distance), so the analogous risk is different but just as
  // real: a beachhead's territory is a small, thin flood, and if
  // `BUILD_MIN_SEPARATION` ever swallowed the whole of it — every hex inside
  // that flood also sitting within 2 of some site — the rule would again have
  // no legal hex anywhere and nothing would say so. This is the one test that
  // would catch it, on every region in the campaign rather than one.
  for (const r of REGIONS) {
    const b = battleFor(r.id);
    const n = legalHexes(b).length;
    assert.ok(n > 0, `${r.id}: not one legal build hex on a ${b.grid.cols}x${b.grid.rows} board`);
  }
});

test('build: the ground rule is your TERRITORY, not a radius from a site', () => {
  // A hand-built state, so `state.influence` can be set directly rather than
  // hoping a real region happens to shape one the way this needs — the
  // CONTRACT under test is "buildBlocker reads territoryAt", not "some region
  // has a hex far enough from every site to prove it".
  const b = createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: 'territory',
    seed: 1,
    grid: { cols: 15, rows: 11, blocked: [] },
    sites: [
      { id: 'camp', kind: 'camp', hex: [1, 1], owner: 'player', garrison: {}, hp: 600, hpMax: 600 },
      { id: 'cas', kind: 'castle', hex: [12, 9], owner: 'enemy', garrison: {}, hp: 600, hpMax: 600 },
    ],
    player: makeMods({ expedition: emptyComp() }),
    enemy: makeMods({ expedition: emptyComp() }),
    boosters: [],
    rules: { victory: 'capture-castle', hardCapMs: 480000, aiTier: 1 },
  });

  // Ten hexes from the camp — well past the OLD `BUILD_RANGE_HEXES` (4) — but
  // painted as the player's own by the flood, the way a cluster of sites
  // overlapping into a gap between them would in a real battle.
  const far = { q: 11, r: 1 };
  assert.ok(distance({ q: 1, r: 1 }, far) > 4, 'the probe hex must be outside the old radius');
  b.influence[`${far.q},${far.r}`] = 'player';
  assert.equal(buildBlocker(b, 'player', far), null,
    'territory says this is mine — distance from any one site must not refuse it');

  // The negative control: clear that one entry (absence reads as 'neutral',
  // same as `territoryAt`'s own fallback) and the SAME hex is refused, by name.
  delete b.influence[`${far.q},${far.r}`];
  assert.equal(buildBlocker(b, 'player', far), 'no-ground',
    'unclaimed ground must be refused even where a fixed radius would have allowed it');

  // And enemy territory is refused for the same reason, not merely "not mine".
  b.influence[`${far.q},${far.r}`] = 'enemy';
  assert.equal(buildBlocker(b, 'player', far), 'no-ground');
});

test('build: every refusal is a real one, and names itself', () => {
  const b = battleFor();
  const mine = b.sites.find((s) => s.owner === 'player');
  const at = { q: mine.hex[0], r: mine.hex[1] };
  assert.equal(buildBlocker(b, 'player', at), 'occupied', 'a site stands there');
  // NOT 'too-close', at the current BUILD_MIN_SEPARATION (1) — and that is
  // measured, not an oversight. `d < 1` can only ever be true for d = 0, which
  // `occupied` above already claims one line earlier, so 'too-close' is
  // provably unreachable by distance alone at this value; see the constant's
  // own comment for why it was lowered here (ironcrown and gravenreach had
  // ZERO legal build hexes at 2, unrecoverable by ordinary play). The
  // adjacent hex is legal instead, which is the point of the change.
  assert.equal(buildBlocker(b, 'player', { q: at.q + 1, r: at.r }), null,
    'building on the hex right next to your own site is exactly what the looser separation now allows');
  assert.equal(buildBlocker(b, 'player', { q: -99, r: -99 }), 'off-map');

  // ...and somewhere genuinely outside the player's territory. It has to be
  // open ground too: `blocked-ground` is checked first, so a hex that happens
  // to be rock would assert the wrong refusal; and clear of every site's own
  // separation, or `too-close` would fire first for an unrelated reason.
  const far = gridHexes(b.grid.cols, b.grid.rows).find((h) => !b.grid.blocked.includes(`${h.q},${h.r}`)
    && territoryAt(b, h) !== 'player'
    && b.sites.every((s) => distance({ q: s.hex[0], r: s.hex[1] }, h) >= BUILD_MIN_SEPARATION));
  if (far) {
    assert.equal(buildBlocker(b, 'player', far), 'no-ground',
      'you may not build in country you do not hold');
  }
  const rock = gridHexes(b.grid.cols, b.grid.rows)
    .find((h) => b.grid.blocked.includes(`${h.q},${h.r}`));
  if (rock) assert.equal(buildBlocker(b, 'player', rock), 'blocked-ground');
});

// ---------------------------------------------------------------------------
// What it does
// ---------------------------------------------------------------------------

test('build: it costs gold, goes up over time, and produces nothing until it opens', () => {
  const b = battleFor();
  const before = goldOf(b.factions.player);
  const at = legalHexes(b)[0];
  b.commands.push({ t: 'BUILD', kind: 'trainingGround', hex: [at.q, at.r] });
  // `drainCommands` and not `step`, so the price is asserted against the charge
  // alone: a whole tick also runs the economy, and the farms paying in behind it
  // turn an exact number into an approximate one.
  drainCommands(b);
  assert.deepEqual(rejections(b), [], 'a legal build was refused');

  const site = b.sites.find((s) => s.hex[0] === at.q && s.hex[1] === at.r);
  assert.ok(site, 'nothing appeared on the board');
  assert.equal(goldOf(b.factions.player), before - BUILD_COSTS.trainingGround.gold * CENTIGOLD);
  assert.equal(site.hp, 1, 'scaffolding is fragile — that is the risk the purchase carries');
  assert.ok(site.buildTicksLeft > 0);
  assert.equal(siteTrainRate(b, site), 0, 'a yard that trained while going up makes the timer decorative');
  assert.equal(siteGoldPerSec(b, site), 0);

  // READ THE TOTAL ONCE. It counts DOWN, so a loop bounded by the live field
  // exits halfway — a bug this repo has now written twice.
  const total0 = site.buildTicksLeft;
  for (let i = 0; i < total0 + 2; i++) {
    step(b);
    if (site.buildTicksLeft > 0) {
      assert.equal(site.hp, 1, 'scaffolding must not repair itself into safety');
    }
  }
  assert.equal(site.buildTicksLeft, 0);
  assert.equal(site.hp, site.hpMax, 'it opens at full strength');
  assert.ok(siteTrainRate(b, site) > 0, 'a finished yard trains');
});

test('build: BUILD_MAX_CONCURRENT at a time, per faction — a third names the cap', () => {
  // Pinned against the constant rather than the literal 2, so a future change
  // to BUILD_MAX_CONCURRENT moves this test's expectation with it instead of
  // silently becoming a test of the OLD number.
  assert.equal(BUILD_MAX_CONCURRENT, 2, 'sanity: the rest of this test assumes exactly two');

  const b = battleFor();
  const first = legalHexes(b)[0];
  b.commands.push({ t: 'BUILD', kind: 'farm', hex: [first.q, first.r] });
  step(b);
  assert.deepEqual(rejections(b), []);
  assert.equal(buildingFor(b, 'player').length, 1);

  // A SECOND, concurrent build — the whole point of raising the cap from one —
  // must be allowed. Recomputed fresh: the first build now occupies its hex,
  // which can shrink the legal set for anything within BUILD_MIN_SEPARATION.
  const second = legalHexes(b)[0];
  assert.ok(second, 'the board still has room for a second — otherwise this proves nothing');
  b.commands.push({ t: 'BUILD', kind: 'farm', hex: [second.q, second.r] });
  step(b);
  assert.deepEqual(rejections(b), [], 'a second concurrent build must be allowed now');
  assert.equal(buildingFor(b, 'player').length, 2);

  // A THIRD must still be refused, by the SPECIFIC reason — this is the
  // negative control: without a cap at all, this would also pass.
  const third = legalHexes(b)[0];
  assert.ok(third, 'the board still has room for a third probe — otherwise this proves nothing');
  b.commands.push({ t: 'BUILD', kind: 'farm', hex: [third.q, third.r] });
  step(b);
  assert.deepEqual(rejections(b), ['already-building'], 'a third must be refused, and refused by name');
  assert.equal(buildingFor(b, 'player').length, 2, 'the count must not have crept past the cap');
});

test('build: the two kinds you cannot raise are the two that would undo a loss', () => {
  // A `camp` is where you landed and a `castle` is the win condition. Being able
  // to raise either would mean building your way out of losing one.
  for (const kind of SITE_KINDS) {
    const buildable = BUILDABLE_KINDS.includes(kind);
    assert.equal(buildable, !['camp', 'castle'].includes(kind), `${kind}`);
    assert.equal(buildable, !!BUILD_COSTS[kind], `${kind}: priced and buildable must agree`);
  }
  const b = battleFor();
  const at = legalHexes(b)[0];
  b.commands.push({ t: 'BUILD', kind: 'castle', hex: [at.q, at.r] });
  step(b);
  assert.deepEqual(rejections(b), ['not-buildable']);
});

test('build: it is refused when the treasury cannot cover it', () => {
  const b = battleFor('gallowmoor', { gold: 100 });
  const at = legalHexes(b)[0];
  b.commands.push({ t: 'BUILD', kind: 'stronghold', hex: [at.q, at.r] });
  step(b);
  assert.deepEqual(rejections(b), ['insufficient-gold']);
});

// ---------------------------------------------------------------------------
// A site appearing mid-battle
// ---------------------------------------------------------------------------

test('build: a new site joins the reach graph and denies its own hex', () => {
  // Both derived per-site maps go stale at once when a site appears. `adj` is hex
  // reach, which nothing recomputed on its own because the site list used to be
  // fixed for a whole battle; occupancy is what makes a building something an
  // army has to walk around rather than scenery.
  const b = battleFor();
  const at = legalHexes(b)[0];
  b.commands.push({ t: 'BUILD', kind: 'farm', hex: [at.q, at.r] });
  step(b);
  const site = b.sites.find((s) => s.hex[0] === at.q && s.hex[1] === at.r);

  assert.ok(site.adj.length > 0, 'the new site has no neighbours — recomputeReach was not run');
  for (const id of site.adj) {
    const other = b.sites.find((s) => s.id === id);
    assert.ok(other.adj.includes(site.id), 'reach must be symmetric — the old sites did not learn about it');
  }
  assert.equal(b.occupancy[`${at.q},${at.r}`], 'player', 'it does not deny its own hex');
});

test('build: a raised site is shaped exactly like a generated one', () => {
  // A built site missing a field works until the one tick something reads it,
  // and `createBattleState` is the only other place a site is constructed.
  const b = battleFor();
  const at = legalHexes(b)[0];
  b.commands.push({ t: 'BUILD', kind: 'trainingGround', hex: [at.q, at.r] });
  step(b);
  const made = b.sites.find((s) => s.hex[0] === at.q && s.hex[1] === at.r);
  const generated = b.sites.find((s) => s.id !== made.id);
  for (const key of Object.keys(generated)) {
    assert.ok(key in made, `a raised site has no "${key}" — every generated one does`);
  }
  assert.ok(SITES[made.kind].train === 0 || made.trainType,
    'a yard was raised with nothing to build');
});

test('build: SCAFFOLDING IS BLIND, and the tick it opens is a vision event', () => {
  // Vision is the WHOLE of what a watchtower produces, so leaving it ungated
  // would make its build timer decorative: 120 gold buys an instant reveal and
  // the bar is a formality. The rule is the one every other output already
  // follows — a site under construction earns no gold and trains nothing.
  //
  // Occupancy is deliberately NOT gated the same way, and the contrast is the
  // point: a half-dug foundation is physically in the way from the moment it is
  // paid for. Presence is not production.
  //
  // It also adds a FOURTH vision-invalidation event. The other three key off the
  // site list or its ownership changing; this one is a timer running out, where
  // nothing appears and nothing changes hands. Miss it and the one building
  // bought purely for sight never grants any.
  const b = battleFor();
  const at = legalHexes(b)[0];
  // The hex to watch has to be DARK to begin with, and picking the first one at
  // some fixed distance is not enough: a legal build hex sits inside the
  // player's own territory, which sits inside (or beside) whatever a held
  // site already sees, so plenty of its neighbourhood is already lit and the
  // naive pick failed on exactly that. An
  // already-lit hex would also pass against an engine that never recomputed
  // anything, which is the whole thing under test. It must additionally be
  // further out than an ORDINARY building's radius 1, or a farm would do.
  const R = VISION_RADIUS.watchtower;
  assert.ok(R >= 3, 'a watchtower that sees no further than a farm is not a watchtower');
  const far = gridHexes(b.grid.cols, b.grid.rows).find((h) => {
    const d = distance(h, at);
    return d >= 2 && d <= R && !canSee(b, 'player', h.q, h.r);
  });
  assert.ok(far, 'nowhere dark inside the tower\'s reach — this proves nothing');

  b.commands.push({ t: 'BUILD', kind: 'watchtower', hex: [at.q, at.r] });
  step(b);
  const site = b.sites.find((s) => s.hex[0] === at.q && s.hex[1] === at.r);
  assert.ok(site && site.buildTicksLeft > 0, 'the tower did not go up');
  assert.equal(canSee(b, 'player', far.q, far.r), false,
    'scaffolding is seeing four hexes — it produces nothing until it opens');
  // ...and it IS in the way already, which is the half that is not gated.
  assert.equal(b.occupancy[`${at.q},${at.r}`], 'player',
    'a foundation is physically there even while it is blind');

  const total0 = site.buildTicksLeft;          // read once — it counts down
  for (let i = 0; i < total0 + 2; i++) step(b);
  assert.equal(site.buildTicksLeft, 0);
  assert.equal(canSee(b, 'player', far.q, far.r), true,
    'the tower opened and still sees nothing — a build finishing must recompute vision');
});
