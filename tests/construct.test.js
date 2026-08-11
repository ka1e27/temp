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
import { markConquered, refreshUnlocks } from '../src/meta/world.js';
import { REGIONS } from '../src/content/regions.data.js';
import {
  BUILD_COSTS, BUILDABLE_KINDS, BUILD_RANGE_HEXES, BUILD_MIN_SEPARATION,
  SITES, SITE_KINDS, CENTIGOLD, VISION_RADIUS,
} from '../src/content/balance.js';
import { siteTrainRate } from '../src/battle/training.js';
import { siteGoldPerSec, goldOf } from '../src/battle/economy.js';
import { distance } from '../src/core/hex.js';
import { canSee } from '../src/battle/vision.js';
import { total } from '../src/battle/combat.js';

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
  // was true on the first cut. `BUILD_RANGE_HEXES` was 2 against a
  // `MAPGEN.minSeparation` of 3, which asks for a hex simultaneously within 2 of
  // your farm and at least 3 from it: every one of gallowmoor's 192 hexes was
  // refused and nothing failed.
  for (const r of REGIONS) {
    const b = battleFor(r.id);
    const n = legalHexes(b).length;
    assert.ok(n > 0, `${r.id}: not one legal build hex on a ${b.grid.cols}x${b.grid.rows} board`);
  }
});

test('build: the range must be able to clear the separation', () => {
  // The invariant underneath the test above, stated where a future pass will
  // read it before moving either number.
  assert.ok(BUILD_RANGE_HEXES >= BUILD_MIN_SEPARATION,
    'a hex cannot be both inside the range of a site you hold and outside its '
    + 'separation — set the range below the separation and the whole board is illegal');
});

test('build: every refusal is a real one, and names itself', () => {
  const b = battleFor();
  const mine = b.sites.find((s) => s.owner === 'player');
  const at = { q: mine.hex[0], r: mine.hex[1] };
  assert.equal(buildBlocker(b, 'player', at), 'occupied', 'a site stands there');
  assert.equal(buildBlocker(b, 'player', { q: at.q + 1, r: at.r }), 'too-close');
  assert.equal(buildBlocker(b, 'player', { q: -99, r: -99 }), 'off-map');

  // ...and somewhere genuinely far from everything the player holds. It has to
  // be open ground too: `blocked-ground` is checked first, so a far hex that
  // happens to be rock would assert the wrong refusal.
  const far = gridHexes(b.grid.cols, b.grid.rows).find((h) => !b.grid.blocked.includes(`${h.q},${h.r}`)
    && b.sites.every((s) => s.owner !== 'player'
      || distance({ q: s.hex[0], r: s.hex[1] }, h) > BUILD_RANGE_HEXES));
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

test('build: one at a time, per faction', () => {
  const b = battleFor();
  const spots = legalHexes(b);
  b.commands.push({ t: 'BUILD', kind: 'farm', hex: [spots[0].q, spots[0].r] });
  step(b);
  assert.deepEqual(rejections(b), []);
  assert.equal(buildingFor(b, 'player').length, 1);

  const next = legalHexes(b)[0];
  assert.ok(next, 'the board still has room — otherwise this proves nothing');
  b.commands.push({ t: 'BUILD', kind: 'farm', hex: [next.q, next.r] });
  step(b);
  assert.deepEqual(rejections(b), ['already-building']);
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
// Losing one
// ---------------------------------------------------------------------------

test('build: SCAFFOLDING YOU SEIZE IS RUBBLE — nobody inherits a half-built yard', () => {
  // `buildTicksLeft` is a timer on the SITE, not on its owner. Before this the
  // enemy could walk onto a half-dug yard and have the timer finish it for them:
  // observed on gallowmoor, the site went to 0 HP under an enemy siege and came
  // out the far side at 180/180 in enemy hands.
  const b = battleFor();
  const at = legalHexes(b)[0];
  b.commands.push({ t: 'BUILD', kind: 'trainingGround', hex: [at.q, at.r] });
  step(b);
  const site = b.sites.find((s) => s.hex[0] === at.q && s.hex[1] === at.r);
  const id = site.id;

  // The enemy walks onto it. At 1 HP the first tick of siege damage finishes it.
  site.siege = { owner: 'enemy', comp: { ...b.sites[0].garrison, militia: 20 } };
  step(b);

  assert.equal(b.sites.some((s) => s.id === id), false,
    'the site is still on the board — it changed hands instead of being razed');
  assert.ok(b.events.some((e) => e.type === 'site-razed' && e.siteId === id),
    'nothing announced it');
  assert.equal(b.events.some((e) => e.type === 'site-captured' && e.siteId === id), false,
    'a raze must never be reported as a capture: nobody holds it afterwards');
});

test('build: an army marching at a razed site turns around instead of vanishing', () => {
  // `resolveArrival` returns early when `siteById` finds nothing, and by then the
  // squads have already been taken off the board — so troops in the air toward a
  // razed site would simply cease to exist, with no event and no body count.
  const b = battleFor();
  const at = legalHexes(b)[0];
  b.commands.push({ t: 'BUILD', kind: 'trainingGround', hex: [at.q, at.r] });
  step(b);
  const site = b.sites.find((s) => s.hex[0] === at.q && s.hex[1] === at.r);

  // Reinforce it from wherever can reach, then raze it before they land.
  const from = b.sites.find((s) => s.owner === 'player' && total(s.garrison) > 10);
  b.commands.push({ t: 'SEND', from: from.id, to: site.id, fraction: 0.5 });
  step(b);
  const inAir = b.squads.filter((q) => q.to === site.id);
  assert.ok(inAir.length > 0, 'nothing was in the air — this proves nothing');
  const bodies = inAir.reduce((a, q) => a + total(q.comp), 0);

  site.siege = { owner: 'enemy', comp: { militia: 20 } };
  step(b);
  const stillFlying = b.squads.reduce((a, q) => a + total(q.comp), 0);
  assert.ok(stillFlying >= bodies,
    `${bodies} troops were marching on the razed site and ${stillFlying} are still on the board`);
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
  // some fixed distance is not enough: a build hex sits within
  // `BUILD_RANGE_HEXES` of a site the player already holds, so plenty of its
  // neighbourhood is already lit and the naive pick failed on exactly that. An
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
