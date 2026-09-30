// Scout and Sabotage (DESIGN §5.7): costs, gating, the sabotage multiplier, and the contract that
// matters most - the scout report's garrisons ARE the garrisons buildArena places for the battle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateWorld } from '../world/generate.js';
import { createGame } from '../meta/state.js';
import { incomePerSec } from '../meta/economy.js';
import { upgradeCost, levelOf } from '../meta/upgrades.js';
import { frontier, conquer, playerBattleStats, enemyBattleStats } from '../meta/progression.js';
import { buildArena } from '../battle/arena.js';
import { PLAYER_OWNER } from '../battle/owner.js';
import { SITE_TYPES, BATTLE } from '../config/battle.js';
import { INTEL } from '../config/intel.js';
import { UPGRADE_TUNING } from '../config/meta.js';
import * as I from '../meta/intel.js';

const worlds = new Map();
function worldFor(seed) {
  if (!worlds.has(seed)) worlds.set(seed, generateWorld(seed));
  return worlds.get(seed);
}

/** A fresh game whose player already holds the `n` cheapest regions (lowest tier first), gold as given. */
function stateWithConquests(seed, n, gold = 0) {
  const world = generateWorld(seed); // fresh object: the report cache is per world identity
  const state = createGame(seed, world, 0);
  for (let i = 0; i < n; i += 1) {
    const front = frontier(state, world).sort((a, b) => world.regions[a].tier - world.regions[b].tier || a - b);
    conquer(state, world, front[0], 0);
  }
  state.gold = gold;
  return { world, state };
}

/** Conquers frontier regions (lowest tier first) until a rival-faction region borders the player. */
function stateAtRivalBorder(seed) {
  const world = generateWorld(seed);
  const state = createGame(seed, world, 0);
  for (let guard = 0; guard < world.regions.length; guard += 1) {
    const front = frontier(state, world);
    const rival = front.find((id) => world.regions[id].faction >= 2);
    if (rival != null) return { world, state, rival };
    front.sort((a, b) => world.regions[a].tier - world.regions[b].tier || a - b);
    conquer(state, world, front[0], 0);
  }
  throw new Error('no rival region ever became a frontier');
}

function plainFrontier(state, world) {
  return frontier(state, world).sort((a, b) => a - b);
}

// --- tutorial ------------------------------------------------------------------------------------

test('tutorial region: scouting it is free, and only it', () => {
  // Seed 3 has several tier-1 Free Folk regions around the start.
  const { world, state } = stateWithConquests(3, 0);
  const front = plainFrontier(state, world);
  assert.ok(front.length >= 2, 'need at least two frontier regions to tell them apart');
  const tutorial = I.tutorialRegionId(state, world);
  assert.ok(front.includes(tutorial));
  assert.equal(world.regions[tutorial].tier, 1);
  assert.equal(world.regions[tutorial].faction, 1);
  assert.equal(I.isTutorialRegion(state, world, tutorial), true);
  assert.equal(I.scoutCost(state, world, tutorial), 0);
  for (const id of front.filter((f) => f !== tutorial)) {
    assert.equal(I.isTutorialRegion(state, world, id), false);
    assert.ok(I.scoutCost(state, world, id) >= INTEL.scout.minCost);
  }
});

test('tutorial region is the easiest frontier region (best ratio, the one the tutorial hint points at)', async () => {
  const { difficulty } = await import('../meta/progression.js');
  const { world, state } = stateWithConquests(3, 0);
  const best = plainFrontier(state, world)
    .map((id) => ({ id, ratio: difficulty(state, world, id).ratio }))
    .sort((a, b) => b.ratio - a.ratio || a.id - b.id)[0];
  assert.equal(I.tutorialRegionId(state, world), best.id);
});

test('tutorial region: free scouting works with no gold, then it is spent; sabotage elsewhere cannot move it', () => {
  const { world, state } = stateWithConquests(3, 0, 0);
  const tutorial = I.tutorialRegionId(state, world);
  assert.equal(I.canScout(state, world, tutorial), true, 'free means affordable at 0 gold');
  assert.deepEqual(I.scout(state, world, tutorial), { cost: 0 });
  assert.equal(state.gold, 0);
  assert.equal(I.isScouted(state, tutorial), true);
  // Whatever intel other regions hold, the free scout stays put.
  const other = plainFrontier(state, world).find((id) => id !== tutorial);
  state.intel[other] = { scouted: true, sabotage: 2 };
  assert.equal(I.tutorialRegionId(state, world), tutorial);
});

test('tutorial region: nothing is free once the realm holds more than its start region', () => {
  const { world, state } = stateWithConquests(3, 1);
  assert.equal(I.tutorialRegionId(state, world), -1);
  for (const id of frontier(state, world)) assert.ok(I.scoutCost(state, world, id) >= INTEL.scout.minCost);
});

// --- scout costs and affordability -----------------------------------------------------------------

test('scoutCost: about 30 s of current income, never below the floor', () => {
  const { world, state } = stateWithConquests(3, 5, 1e9);
  const id = plainFrontier(state, world)[0];
  const income = incomePerSec(state, world);
  const expected = Math.max(INTEL.scout.minCost, Math.round(income * INTEL.scout.incomeSeconds));
  assert.equal(I.scoutCost(state, world, id), expected);
  assert.ok(income * INTEL.scout.incomeSeconds > INTEL.scout.minCost, 'this state should be above the floor');
  // Doubling income (Taxes) doubles the price.
  state.upgrades.taxes = 20; // +100 %
  const doubled = I.scoutCost(state, world, id);
  assert.ok(doubled > expected * 1.5);
  // At the very start (1 gold/s and a bit) it is a pocketful of coins, never below the floor.
  const start = stateWithConquests(3, 0);
  const notTutorial = plainFrontier(start.state, start.world).find((f) => f !== I.tutorialRegionId(start.state, start.world));
  const early = I.scoutCost(start.state, start.world, notTutorial);
  assert.ok(early >= INTEL.scout.minCost && early <= 2 * upgradeCost('steel', 0), `early scout costs ${early} (a couple of first upgrades at most)`);
});

test('scout: pays, sets the flag once, refuses a repeat and refuses when short of gold', () => {
  const { world, state } = stateWithConquests(3, 5, 0);
  const id = plainFrontier(state, world)[0];
  const cost = I.scoutCost(state, world, id);
  assert.equal(I.canScout(state, world, id), false);
  assert.equal(I.scout(state, world, id), false);
  assert.equal(state.gold, 0);
  assert.equal(I.isScouted(state, id), false);

  state.gold = cost - 0.01;
  assert.equal(I.canScout(state, world, id), false, 'a hair short is still short');

  state.gold = cost + 100;
  assert.equal(I.canScout(state, world, id), true);
  const res = I.scout(state, world, id);
  assert.deepEqual(res, { cost });
  assert.equal(state.gold, 100);
  assert.deepEqual(I.intelOf(state, id), { scouted: true, sabotage: 0 });
  assert.equal(I.canScout(state, world, id), false, 'already scouted');
  assert.equal(I.scout(state, world, id), false);
  assert.equal(state.gold, 100, 'a refused scout costs nothing');
});

test('scout: only frontier regions; never your own land, never a region behind the fog', () => {
  const { world, state } = stateWithConquests(3, 2, 1e9);
  const owned = state.owner.findIndex((o) => o === 0);
  assert.equal(I.canScout(state, world, owned), false);
  const front = new Set(frontier(state, world));
  const far = world.regions.find((r) => state.owner[r.id] !== 0 && !front.has(r.id));
  assert.ok(far, 'there is a non-frontier region');
  assert.equal(I.canScout(state, world, far.id), false);
  assert.equal(I.scout(state, world, far.id), false);
  assert.equal(I.canScout(state, world, 9999), false);
});

// --- sabotage costs, gating and the multiplier -----------------------------------------------------------

test('sabotage: requires a scout first, then two steps, then refuses', () => {
  const { world, state } = stateWithConquests(3, 5, 1e9);
  const id = plainFrontier(state, world)[0];
  assert.equal(I.canSabotage(state, world, id), false, 'not scouted');
  assert.equal(I.sabotage(state, world, id), false);
  assert.equal(state.gold, 1e9, 'a refused sabotage costs nothing');

  assert.ok(I.scout(state, world, id));
  assert.equal(I.canSabotage(state, world, id), true);

  const cost1 = I.sabotageCost(state, world, id);
  const goldBefore = state.gold;
  assert.deepEqual(I.sabotage(state, world, id), { cost: cost1, level: 1 });
  assert.equal(state.gold, goldBefore - cost1);
  assert.equal(I.sabotageLevel(state, id), 1);

  const cost2 = I.sabotageCost(state, world, id);
  assert.ok(cost2 > cost1, 'the second step costs more');
  assert.deepEqual(I.sabotage(state, world, id), { cost: cost2, level: 2 });
  assert.equal(I.sabotageLevel(state, id), INTEL.sabotage.maxLevel);

  assert.equal(I.canSabotage(state, world, id), false, 'maxed');
  assert.equal(I.sabotageCost(state, world, id), Infinity);
  const gold = state.gold;
  assert.equal(I.sabotage(state, world, id), false);
  assert.equal(state.gold, gold);
  assert.equal(I.sabotageLevel(state, id), 2);
});

test('sabotage: unaffordable steps are refused without side effects', () => {
  const { world, state } = stateWithConquests(3, 5, 1e9);
  const id = plainFrontier(state, world)[0];
  I.scout(state, world, id);
  const cost = I.sabotageCost(state, world, id);
  state.gold = cost - 1;
  assert.equal(I.canSabotage(state, world, id), false);
  assert.equal(I.sabotage(state, world, id), false);
  assert.equal(state.gold, cost - 1);
  assert.equal(I.sabotageLevel(state, id), 0);
});

test('sabotageCost: max(steelMult x next Steel, incomeSeconds x income), rising with the level', () => {
  const { world, state } = stateWithConquests(3, 5, 0);
  const id = plainFrontier(state, world)[0];
  const income = incomePerSec(state, world);
  for (const steelLevel of [0, 4, 9]) {
    state.upgrades.steel = steelLevel;
    const steel = upgradeCost('steel', levelOf(state, 'steel'));
    for (const level of [0, 1]) {
      state.intel = { [id]: { scouted: true, sabotage: level } };
      const want = Math.round(Math.max(
        INTEL.sabotage.steelMult[level] * steel, INTEL.sabotage.incomeSeconds[level] * income,
      ));
      assert.equal(I.sabotageCost(state, world, id), want, `steel ${steelLevel}, level ${level}`);
    }
  }
});

test('sabotageCost follows the upgrade curve and cannot be gamed by skipping Steel', () => {
  const { world, state } = stateWithConquests(3, 5, 0);
  const id = plainFrontier(state, world)[0];
  const income = incomePerSec(state, world);
  const floor = Math.round(INTEL.sabotage.incomeSeconds[0] * income);

  state.upgrades.steel = 0; // neglected Steel: the cheap Steel term must not make sabotage cheap
  assert.equal(I.sabotageCost(state, world, id), floor);

  state.upgrades.steel = 14; // deep Steel: the price follows the upgrade curve (Steel's own growth per level)
  const deep = I.sabotageCost(state, world, id);
  assert.equal(deep, Math.round(INTEL.sabotage.steelMult[0] * upgradeCost('steel', 14)));
  state.upgrades.steel = 15;
  const deeper = I.sabotageCost(state, world, id);
  assert.ok(deeper / deep > UPGRADE_TUNING.steel.growth - 0.05, `one more Steel level makes sabotage ${deeper / deep}x dearer (Steel grows ${UPGRADE_TUNING.steel.growth}x per level)`);
});

test('sabotage is never a better buy than upgrading Steel', () => {
  // One sabotage step helps one region once; a Steel level helps every region for ever. The step must
  // therefore never be cheaper than the Steel level that comes with the same effect: at least 1x the
  // next Steel level, at every stage of a game.
  const { world, state } = stateWithConquests(3, 5, 0);
  const id = plainFrontier(state, world)[0];
  for (const steelLevel of [0, 2, 5, 8, 12]) {
    state.upgrades.steel = steelLevel;
    assert.ok(I.sabotageCost(state, world, id) >= upgradeCost('steel', steelLevel), `steel level ${steelLevel}`);
  }
});

test('sabotageTroopMult: 1, 0.85, 0.70 and never outside the configured range', () => {
  const state = { intel: {} };
  assert.equal(I.sabotageTroopMult(state, 3), 1);
  state.intel[3] = { scouted: true, sabotage: 1 };
  assert.ok(Math.abs(I.sabotageTroopMult(state, 3) - 0.85) < 1e-12);
  state.intel[3] = { scouted: true, sabotage: 2 };
  assert.ok(Math.abs(I.sabotageTroopMult(state, 3) - 0.7) < 1e-12);
  assert.equal(I.sabotageTroopMult(state, 4), 1, 'other regions are untouched');
  // A tampered save cannot push it past the configured maximum, or below zero.
  state.intel[3] = { scouted: true, sabotage: 99 };
  assert.ok(Math.abs(I.sabotageTroopMult(state, 3) - (1 - INTEL.sabotage.step * INTEL.sabotage.maxLevel)) < 1e-12);
  state.intel[3] = { scouted: true, sabotage: -5 };
  assert.equal(I.sabotageTroopMult(state, 3), 1);
  state.intel[3] = { scouted: true, sabotage: Number.NaN };
  assert.equal(I.sabotageTroopMult(state, 3), 1);
  assert.equal(I.sabotageTroopMult({}, 3), 1, 'a state with no intel table at all');
});

// --- the scout report ----------------------------------------------------------------------------------

function arenaEnemySites(world, state, regionId, player, enemy) {
  const arena = buildArena(world, state.owner, regionId, player, enemy);
  return arena.sites.filter((s) => s.owner !== PLAYER_OWNER && s.type !== 'camp');
}

/** buildArena throws for a graph-adjacent region with no passable border tile (all-mountain edge). */
function attackable(world, state, regionId, player, enemy) {
  try { buildArena(world, state.owner, regionId, player, enemy); return true; } catch { return false; }
}

test('scoutReport garrisons are EXACTLY the starting troops buildArena places (every frontier region, two worlds)', () => {
  for (const seed of [3, 7]) {
    for (const conquests of [0, 6]) {
      const { world, state } = stateWithConquests(seed, conquests);
      for (const id of plainFrontier(state, world)) {
        const player = playerBattleStats(state, world);
        const enemy = enemyBattleStats(world, state, id);
        if (!attackable(world, state, id, player, enemy)) continue;
        const report = I.scoutReport(state, world, id, player, enemy);
        const expected = arenaEnemySites(world, state, id, player, enemy);
        assert.equal(report.sites.length, expected.length, `region ${id}: same number of sites`);
        assert.deepEqual(
          report.sites.map((s) => [s.id, s.settlement, s.type, s.garrison]),
          expected.map((s) => [s.id, s.settlement, s.type, s.troops]),
          `seed ${seed}, ${conquests} conquests, region ${id}`,
        );
      }
    }
  }
});

test('scoutReport: rival regions keep neutral Free Folk hamlets at base strength, like the arena', () => {
  const { world, state, rival } = stateAtRivalBorder(7);
  const player = playerBattleStats(state, world);
  const enemy = enemyBattleStats(world, state, rival);
  const report = I.scoutReport(state, world, rival, player, enemy);
  const arenaSites = arenaEnemySites(world, state, rival, player, enemy);
  assert.deepEqual(report.sites.map((s) => s.garrison), arenaSites.map((s) => s.troops));
  const neutral = report.sites.filter((s) => s.neutral);
  for (const s of neutral) {
    assert.equal(s.type, 'hamlet');
    assert.equal(s.owner, 1);
    assert.equal(s.garrison, BATTLE.enemyStart.hamlet, 'neutral hamlets start at the base garrison, never scaled by tier');
  }
  for (const s of report.sites.filter((x) => !x.neutral)) assert.equal(s.owner, world.regions[rival].faction);
  assert.equal(report.faction.id, world.regions[rival].faction);
  assert.equal(report.personality, world.factions[world.regions[rival].faction].personality);
  assert.equal(report.personalityLine, INTEL.personalityLines[report.personality]);
});

test('contract: applying sabotageTroopMult to enemyStats.troopMult before buildArena cuts garrisons by 15% and 30%', () => {
  const { world, state, rival } = stateAtRivalBorder(7);
  const region = rival;
  const player = playerBattleStats(state, world);
  const baseEnemy = enemyBattleStats(world, state, region);
  const baseline = arenaEnemySites(world, state, region, player, baseEnemy);
  const sites = baseline.filter((s) => s.owner === world.regions[region].faction);
  assert.ok(sites.length >= 2, 'the region has enemy-owned sites');

  for (const [level, cut] of [[1, 0.15], [2, 0.30]]) {
    const local = { intel: { [region]: { scouted: true, sabotage: level } } };
    const enemy = { ...baseEnemy, troopMult: baseEnemy.troopMult * I.sabotageTroopMult(local, region) };
    const weakened = arenaEnemySites(world, state, region, player, enemy);
    assert.equal(weakened.length, baseline.length);
    weakened.forEach((site, i) => {
      const before = baseline[i];
      if (before.owner === world.regions[region].faction) {
        assert.ok(Math.abs(site.troops - before.troops * (1 - cut)) < 1e-9,
          `${before.type}: ${before.troops} -> ${site.troops} should be -${cut * 100}%`);
      } else {
        assert.equal(site.troops, before.troops, 'neutral Free Folk hamlets are not sabotaged');
      }
    });
    // ... and the scout report reflects exactly the same numbers.
    const report = I.scoutReport(state, world, region, player, enemy);
    assert.deepEqual(report.sites.map((s) => s.garrison), weakened.map((s) => s.troops));
  }
});

test('scoutReport is deterministic, JSON-safe and read-only friendly', () => {
  const a = stateWithConquests(7, 6);
  const b = stateWithConquests(7, 6);
  for (const id of plainFrontier(a.state, a.world)) {
    const ra = I.scoutReport(a.state, a.world, id);
    const rb = I.scoutReport(b.state, b.world, id);
    assert.deepEqual(ra, rb, 'same seed and state, separate worlds: identical report');
    assert.deepEqual(JSON.parse(JSON.stringify(ra)), ra, 'plain JSON only');
    assert.equal(I.scoutReport(a.state, a.world, id), ra, 'cached: the same object comes back');
  }
});

test('scoutReport cache is invalidated by ownership, sabotage and player stats', () => {
  const { world, state } = stateWithConquests(7, 3);
  const id = plainFrontier(state, world)[0];
  const first = I.scoutReport(state, world, id);
  assert.equal(first.sabotage, 0);
  // A real sabotage: emulate what enemyBattleStats will do once Balance applies the multiplier.
  const player = playerBattleStats(state, world);
  const enemy = enemyBattleStats(world, state, id);
  const cut = I.scoutReport(state, world, id, player, { ...enemy, troopMult: enemy.troopMult * 0.7 });
  assert.notEqual(cut, first);
  assert.ok(cut.total < first.total);
  const better = I.scoutReport(state, world, id, { ...player, atk: player.atk * 2 }, enemy);
  assert.notEqual(better, first);
  // Back to the original inputs: recomputed, equal to the first result.
  assert.deepEqual(I.scoutReport(state, world, id, player, enemy), first);
});

test('scoutReport: null for your own land and unknown regions; works on a non-adjacent region via the formula', () => {
  const { world, state } = stateWithConquests(3, 2);
  const owned = state.owner.findIndex((o) => o === 0);
  assert.equal(I.scoutReport(state, world, owned), null);
  assert.equal(I.scoutReport(state, world, 12345), null);
  const front = new Set(frontier(state, world));
  const far = world.regions.find((r) => state.owner[r.id] !== 0 && !front.has(r.id));
  const report = I.scoutReport(state, world, far.id);
  assert.ok(report && report.sites.length === far.settlements.length);
});

test('scoutReport shape: keep first in groups, chips add up, at most two notes, valid weak point', () => {
  for (const seed of [3, 7]) {
    const { world, state } = stateWithConquests(seed, 6);
    for (const id of plainFrontier(state, world)) {
      const r = I.scoutReport(state, world, id);
      assert.equal(r.regionId, id);
      assert.equal(r.sites.filter((s) => s.isKeep).length, 1);
      assert.equal(r.groups[0].type, 'keep');
      assert.equal(r.groups.reduce((n, g) => n + g.count, 0), r.sites.length);
      assert.ok(Math.abs(r.total - r.sites.reduce((n, s) => n + s.garrison, 0)) < 1e-9);
      assert.ok(r.notes.length <= INTEL.maxNotes && r.notes.every((n) => n.length > 0 && n.length <= 48));
      const weak = r.sites.find((s) => s.id === r.weakPoint);
      assert.ok(weak, 'the weak point is one of the sites');
      assert.equal(r.weakPointType, weak.type);
      assert.ok(r.weakPointReason.length > 0);
      // The keep is the objective, not the first strike, whenever there is anything else to take.
      const candidates = r.sites.filter((s) => !s.isKeep && !s.neutral);
      if (candidates.length > 0) assert.ok(candidates.some((s) => s.id === weak.id));
      for (const s of r.sites) {
        const tile = world.tiles[s.tile];
        assert.equal(s.x, tile.x);
        assert.equal(s.y, tile.y);
        assert.equal(s.elev, tile.elev);
        assert.equal(s.name, world.settlements[s.settlement].name);
      }
      assert.ok(r.personalityLine.length > 0 && r.personalityLine.length <= 56);
    }
  }
});

// --- weak point heuristic (synthetic geometry, hand-checkable) ------------------------------------------

function hexWorld(points) {
  // world.tiles[i] = axial (q, r); tile index = position in the list.
  return { tiles: points.map(([q, r]) => ({ q, r })) };
}
const PLAYER = { atk: 1, def: 1, speed: 1, capBonus: 0 };
const ENEMY = { atk: 1, def: 1, growth: 1, troopMult: 1 };
function site(id, tile, type, garrison, extra = {}) {
  return { id, tile, type, garrison, isKeep: type === 'keep', owner: 2, neutral: false, ...extra };
}

test('weak point: the softest non-keep site wins; the keep and neutral hamlets are never chosen while others exist', () => {
  const world = hexWorld([[0, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0]]);
  const camp = world.tiles[0];
  const sites = [
    site(1, 5, 'keep', 35),
    site(2, 1, 'fort', 22),                       // 22 x 1.8 = 39.6
    site(3, 2, 'village', 12),                    // 12 x 1.0 (+ growth on the march)
    site(4, 3, 'hamlet', 3, { owner: 1, neutral: true }), // tiny, but neutral: skipped
  ];
  const { site: weak } = I.chooseWeakPoint(sites, world, camp, PLAYER, ENEMY, 2);
  assert.equal(weak.id, 3);
});

test('weak point: arrow losses on the way in make a site costly', () => {
  // Two villages with the same garrison at the same distance; the route to one crosses a tower's range.
  const world = hexWorld([[0, 0], [3, 0], [0, 3], [9, 9], [1, 0]]);
  const camp = world.tiles[0];
  const sites = [
    site(1, 3, 'keep', 35),
    site(2, 1, 'village', 12),
    site(3, 2, 'village', 12),
    site(4, 4, 'tower', 10),
  ];
  const exposure = new Map([[2, { troops: 28, towers: 1 }], [3, { troops: 0, towers: 0 }], [4, { troops: 12, towers: 1 }]]);
  const { site: weak, reason } = I.chooseWeakPoint(sites, world, camp, PLAYER, ENEMY, 2, exposure);
  assert.equal(weak.id, 3, 'the village whose route is not shot at');
  assert.match(reason, /tower/i);
});

test('routeExposure: counts route tiles inside a tower range, in seconds x kills per second', () => {
  // Camp (0,0), village (6,0), a tower at (3,1): route tiles q=2..5 on r=0 are within 2 hexes of it (2.6 range).
  const world = hexWorld([[0, 0], [6, 0], [3, 1], [0, 6]]);
  const camp = world.tiles[0];
  const sites = [
    site(1, 1, 'village', 12),
    site(2, 2, 'tower', 10),
    site(3, 3, 'village', 12),   // (0,6): the route heads away from the tower
  ];
  const ex = I.routeExposure(sites, world, camp, PLAYER);
  const { volleySec, volleyKills } = SITE_TYPES.tower;
  const perTile = (1 / (BATTLE.baseSpeed * PLAYER.speed)) * (volleyKills / volleySec);
  assert.ok(Math.abs(ex.get(1).troops - 4 * perTile) < 1e-9, 'four route tiles under fire');
  assert.equal(ex.get(1).towers, 1);
  assert.equal(ex.get(3).troops, 0, 'a route away from the tower is free');
  assert.equal(ex.get(3).towers, 0);
  // Attacking the tower itself adds its own fire for a few seconds.
  assert.ok(ex.get(2).troops > INTEL.weakPoint.towerFightSec * (volleyKills / volleySec) - 1e-9);
  // No towers, no losses, whatever the route.
  const none = I.routeExposure([site(1, 1, 'village', 12)], world, camp, PLAYER);
  assert.equal(none.get(1).troops, 0);
  // Faster armies spend less time under the arrows.
  const fast = I.routeExposure(sites, world, camp, { ...PLAYER, speed: 2 });
  assert.ok(fast.get(1).troops < ex.get(1).troops);
});

test('notes: most useful first, at most two, and never empty', () => {
  const world = hexWorld([[0, 0], [3, 0], [6, 0], [9, 0], [12, 0], [15, 0]]);
  const camp = world.tiles[0];
  const keep = site(1, 5, 'keep', 35);
  const guarded = new Map([[1, { troops: 20, towers: 2 }]]);
  // A guarded keep road outranks a fort, which outranks neutral hamlets and towns.
  const many = [keep, site(2, 1, 'fort', 22), site(3, 2, 'tower', 10), site(4, 3, 'town', 18),
    site(5, 4, 'hamlet', 8, { owner: 1, neutral: true })];
  assert.deepEqual(I.buildNotes(many, world, camp, guarded), ['2 towers guard the keep road', 'Fort defends at 1.8\u00d7']);
  assert.equal(I.buildNotes(many, world, camp, new Map())[0], 'Fort defends at 1.8\u00d7');
  // Nothing special: a plain line rather than an empty box.
  const plain = [site(1, 1, 'keep', 35), site(2, 2, 'village', 12)];
  assert.deepEqual(I.buildNotes(plain, world, camp, new Map()), ['No walls or towers: a straight fight']);
  // A far-off keep earns the long-march note when nothing else is going on.
  const far = [site(1, 5, 'keep', 35), site(2, 2, 'village', 12)];
  assert.match(I.buildNotes(far, world, camp, new Map())[0], /^Long march: keep is 15 hexes from camp$/);
  // Neutral hamlets and forts read naturally in the plural.
  const plural = [keep, site(2, 1, 'fort', 22), site(3, 2, 'fort', 22)];
  assert.equal(I.buildNotes(plural, world, camp, new Map())[0], 'Forts defend at 1.8\u00d7');
});

test('weak point: nearer the War Camp beats farther when everything else is equal', () => {
  const world = hexWorld([[0, 0], [2, 0], [6, 0], [8, 0]]);
  const camp = world.tiles[0];
  const sites = [site(1, 3, 'keep', 35), site(2, 1, 'village', 12), site(3, 2, 'village', 12)];
  assert.equal(I.chooseWeakPoint(sites, world, camp, PLAYER, ENEMY, 2).site.id, 2);
});

test('weak point: falls back to the keep when nothing else can be taken', () => {
  const world = hexWorld([[0, 0], [3, 0]]);
  const sites = [site(1, 1, 'keep', 35)];
  const { site: weak, reason } = I.chooseWeakPoint(sites, world, world.tiles[0], PLAYER, ENEMY, 2);
  assert.equal(weak.id, 1);
  assert.match(reason, /keep/i);
});

test('weak point: a fort (defence 1.8) is judged by garrison x defence, not garrison alone', () => {
  const world = hexWorld([[0, 0], [2, 0], [2, 1], [7, 0]]);
  const camp = world.tiles[0];
  const sites = [
    site(1, 3, 'keep', 35),
    site(2, 1, 'fort', 15),     // 15 troops but 1.8x defence = 27
    site(3, 2, 'village', 20),  // 20 troops at 1.0x = 20 < 27
  ];
  assert.equal(I.chooseWeakPoint(sites, world, camp, PLAYER, ENEMY, 2).site.id, 3);
  assert.ok(SITE_TYPES.fort.def > 1.2);
});

// --- reset, clear, sanitise, panel data ---------------------------------------------------------------------

test('resetIntel and clearRegionIntel', () => {
  const state = { intel: { 2: { scouted: true, sabotage: 1 }, 5: { scouted: true, sabotage: 0 } } };
  I.clearRegionIntel(state, 2);
  assert.deepEqual(state.intel, { 5: { scouted: true, sabotage: 0 } });
  I.clearRegionIntel(state, 99); // harmless
  I.clearRegionIntel({}, 1); // harmless with no table
  assert.equal(I.resetIntel(state), state);
  assert.deepEqual(state.intel, {});
  assert.equal(I.sabotageTroopMult(state, 5), 1);
});

test('conquest clears intel: after clearRegionIntel the region reads as never scouted', () => {
  const { world, state } = stateWithConquests(3, 5, 1e9);
  const id = plainFrontier(state, world)[0];
  I.scout(state, world, id);
  I.sabotage(state, world, id);
  conquer(state, world, id, 0);
  I.clearRegionIntel(state, id);
  assert.deepEqual(I.intelOf(state, id), { scouted: false, sabotage: 0 });
  assert.ok(!(id in state.intel));
});

test('ensureIntel creates a missing table defensively and leaves an existing one alone', () => {
  const state = {};
  const table = I.ensureIntel(state);
  assert.deepEqual(table, {});
  table[1] = { scouted: true, sabotage: 0 };
  assert.equal(I.ensureIntel(state), table);
  const broken = { intel: [1, 2, 3] };
  assert.deepEqual(I.ensureIntel(broken), {});
  assert.deepEqual(I.intelOf({}, 4), { scouted: false, sabotage: 0 });
});

test('a game state with no intel table still works end to end (old saves)', () => {
  const { world, state } = stateWithConquests(3, 5, 1e9);
  delete state.intel;
  const id = plainFrontier(state, world)[0];
  assert.equal(I.isScouted(state, id), false);
  assert.ok(I.scout(state, world, id));
  assert.ok(state.intel && state.intel[id].scouted);
});

test('sanitizeIntel keeps only plausible entries, clamps levels and implies scouted', () => {
  const clean = I.sanitizeIntel({
    3: { scouted: true, sabotage: 1 },
    4: { scouted: false, sabotage: 2 },        // sabotage implies scouted
    5: { scouted: true, sabotage: 99 },        // clamped
    6: { scouted: false, sabotage: 0 },        // nothing to remember
    '-1': { scouted: true, sabotage: 1 },      // not a region id
    x: { scouted: true },
    7: 'nope',
    8: null,
    9: { scouted: 1, sabotage: 'two' },        // truthy scouted, junk level
  });
  assert.deepEqual(clean, {
    3: { scouted: true, sabotage: 1 },
    4: { scouted: true, sabotage: 2 },
    5: { scouted: true, sabotage: 2 },
    9: { scouted: true, sabotage: 0 },
  });
  for (const junk of [null, undefined, 'x', 5, [], [1, 2]]) assert.deepEqual(I.sanitizeIntel(junk), {});
});

test('state.intel survives a JSON round trip (the save format)', () => {
  const { world, state } = stateWithConquests(3, 5, 1e9);
  const id = plainFrontier(state, world)[0];
  I.scout(state, world, id);
  I.sabotage(state, world, id);
  const copy = JSON.parse(JSON.stringify(state));
  assert.deepEqual(I.intelOf(copy, id), { scouted: true, sabotage: 1 });
  assert.deepEqual(I.sanitizeIntel(copy.intel), copy.intel);
});

test('intelPanelData: unscouted, scouted and maxed', () => {
  const { world, state } = stateWithConquests(7, 3, 1e9);
  const id = plainFrontier(state, world)[0];

  let d = I.intelPanelData(state, world, id);
  assert.equal(d.regionId, id);
  assert.equal(d.scouted, false);
  assert.equal(d.report, null);
  assert.equal(d.scoutCost, I.scoutCost(state, world, id));
  assert.equal(d.sabotage, 0);
  assert.equal(d.sabotageMax, INTEL.sabotage.maxLevel);
  assert.equal(d.sabotageStep, INTEL.sabotage.step);
  assert.equal(d.sabotageCost, I.sabotageCost(state, world, id));
  assert.equal(d.gold, 1e9);

  I.scout(state, world, id);
  d = I.intelPanelData(state, world, id);
  assert.equal(d.scouted, true);
  assert.equal(d.scoutCost, 0);
  assert.equal(d.report.regionId, id);

  I.sabotage(state, world, id);
  I.sabotage(state, world, id);
  d = I.intelPanelData(state, world, id);
  assert.equal(d.sabotage, 2);
  assert.equal(d.sabotageCost, null, 'maxed: no next price');
  assert.deepEqual(JSON.parse(JSON.stringify(d)), d);
});

test('toasts and battle note', () => {
  const state = { intel: {} };
  assert.equal(I.sabotageBattleNote(state, 3), null);
  state.intel[3] = { scouted: true, sabotage: 1 };
  assert.equal(I.sabotageBattleNote(state, 3), 'Your agents weakened the garrisons (−15%)');
  state.intel[3] = { scouted: true, sabotage: 2 };
  assert.equal(I.sabotageBattleNote(state, 3), 'Your agents weakened the garrisons (−30%)');
  assert.equal(I.intelToast('sabotaged', { region: 'Fenwall', pct: 15 }), 'Saboteurs weakened Fenwall (−15%)');
  assert.equal(I.intelToast('scouted', { region: 'Fenwall' }), 'Scouts report back from Fenwall');
  assert.equal(I.sabotagePercent(0), 0);
  assert.equal(I.sabotagePercent(2), 30);
});

test('intel modules are pure: no DOM, clock, randomness or storage', () => {
  for (const file of ['../meta/intel.js', '../meta/intelState.js', '../config/intel.js']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const banned of [/Math\.random/, /Date\.now/, /performance\./, /\bdocument\b/, /\bwindow\b/, /localStorage/, /requestAnimationFrame/]) {
      assert.doesNotMatch(src, banned, `${file} must not use ${banned}`);
    }
  }
});

test('progression can import the leaf without a cycle: intelState.js has no meta dependencies', () => {
  const src = readFileSync(new URL('../meta/intelState.js', import.meta.url), 'utf8');
  const imports = [...src.matchAll(/^import .* from '(.*)';$/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['../config/intel.js']);
});

test('scoutReport falls back to the arena formula for a region buildArena cannot build (no passable border)', () => {
  let checked = 0;
  for (const seed of [3, 7, 11]) {
    const { world, state } = stateWithConquests(seed, 6);
    for (const id of plainFrontier(state, world)) {
      const player = playerBattleStats(state, world);
      const enemy = enemyBattleStats(world, state, id);
      if (attackable(world, state, id, player, enemy)) continue;
      const report = I.scoutReport(state, world, id, player, enemy);
      const rival = world.regions[id].faction !== 1;
      const expected = world.regions[id].settlements
        .map((sid) => world.settlements[sid]).sort((a, b) => a.id - b.id)
        .map((st) => BATTLE.enemyStart[st.type] * (rival && st.type === 'hamlet' ? 1 : enemy.troopMult));
      assert.deepEqual(report.sites.map((x) => x.garrison), expected, `seed ${seed} region ${id}`);
      assert.ok(world.regions[id].settlements.includes(report.sites[0].settlement));
      checked += 1;
    }
  }
  assert.ok(checked > 0, 'at least one unattackable frontier region exists in these worlds (seed 7, region 10)');
});
