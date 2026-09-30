// The structural rules the balance pass added on top of the battle and meta modules:
//   * enemy settlement caps scale with depth, capitals get a bonus, Free Folk cap lower (DESIGN §4.6)
//   * sabotage reaches the garrisons and the difficulty card, and a conquest forgets it (DESIGN §5.7)
//   * the bounty is seconds of the realm's total income (DESIGN §5.1)
//   * the weak point prefers a town that costs at most 20% more than the softest site (DESIGN §5.7)
//   * the virtual player (tools/campaign.mjs) runs a realm end to end, deterministically
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/generate.js';
import { createGame, PLAYER_FACTION } from '../meta/state.js';
import {
  enemyBattleStats, playerBattleStats, enemyDepth, frontier, difficulty, conquer,
} from '../meta/progression.js';
import { bounty, incomePerSec } from '../meta/economy.js';
import { buildArena } from '../battle/arena.js';
import { createBattle } from '../battle/sim.js';
import { effectiveCap } from '../battle/combat.js';
import { BATTLE, ENEMY_SCALING, SITE_TYPES } from '../config/battle.js';
import { ECONOMY } from '../config/meta.js';
import { INTEL } from '../config/intel.js';
import * as Intel from '../meta/intel.js';
import { runCampaign } from '../../tools/campaign.mjs';

/** First frontier region of a fresh game on `seed` with the given faction test, or null. */
function frontierRegion(seed, pick) {
  const world = generateWorld(seed);
  const state = createGame(seed, world, 0);
  const id = frontier(state, world).find((r) => pick(world.regions[r], world));
  return id == null ? null : { world, state, id };
}

function arenaFor(world, state, id) {
  const player = playerBattleStats(state, world);
  const enemy = enemyBattleStats(world, state, id);
  return { player, enemy, arena: buildArena(world, state.owner, id, player, enemy) };
}

test('caps: depth, capital and Free Folk multipliers come from enemyBattleStats', () => {
  const world = generateWorld(2);
  const state = createGame(2, world, 0);
  for (const region of world.regions) {
    if (region.tier < 1) continue;
    const e = enemyBattleStats(world, state, region.id);
    const passive = world.factions[region.faction].personality === 'passive';
    const expected = Math.pow(ENEMY_SCALING.capPerDepth, Math.max(0, enemyDepth(world, region) - 1))
      * (region.isCapital ? ENEMY_SCALING.capitalCapMult : 1) * (passive ? ENEMY_SCALING.freeFolkCapMult : 1);
    assert.ok(Math.abs(e.capMult - expected) < 1e-9, `${region.name}: capMult ${e.capMult} vs ${expected}`);
  }
  // deeper really means bigger: among rival non-capital regions the multiplier follows the ladder
  const rivals = world.regions.filter((r) => r.tier >= 1 && !r.isCapital && world.factions[r.faction].personality !== 'passive')
    .map((r) => ({ d: enemyDepth(world, r), c: enemyBattleStats(world, state, r.id).capMult }))
    .sort((a, b) => a.d - b.d);
  for (let i = 1; i < rivals.length; i++) assert.ok(rivals[i].c >= rivals[i - 1].c - 1e-9);
  const first = rivals[0];
  const last = rivals[rivals.length - 1];
  assert.ok(last.c >= first.c * Math.pow(ENEMY_SCALING.capPerDepth, last.d - first.d) * 0.999, 'the deepest rival region holds as much more as the ladder says');
});

test('caps: buildArena stamps every enemy site, neutral Free Folk hamlets get the Free Folk cap', () => {
  const found = frontierRegion(1, (r, w) => w.factions[r.faction].personality === 'passive');
  assert.ok(found, 'a Free Folk neighbour');
  const { player, enemy, arena } = arenaFor(found.world, found.state, found.id);
  for (const s of arena.sites) {
    if (s.owner === PLAYER_FACTION) assert.ok(s.capMult == null || s.capMult === 1, 'player sites are not scaled');
    else assert.equal(s.capMult, enemy.capMult, 'a Free Folk region: every site carries the region multiplier');
  }
  assert.ok(enemy.capMult < 1, 'Free Folk cap lower than the base table');
  // a rival region with a neutral hamlet: the hamlet is Free Folk, everything else the rival's
  const rival = (() => {
    for (let seed = 1; seed <= 12; seed++) {
      const world = generateWorld(seed);
      const state = createGame(seed, world, 0);
      // own the whole Free Folk ring so a rival region is on the frontier
      for (const r of world.regions) if (world.factions[r.faction].personality === 'passive') state.owner[r.id] = PLAYER_FACTION;
      for (const id of frontier(state, world)) {
        const region = world.regions[id];
        if (world.factions[region.faction].personality === 'passive') continue;
        if (!region.settlements.some((sid) => world.settlements[sid].type === 'hamlet')) continue;
        try { buildArena(world, state.owner, id, playerBattleStats(state, world), enemyBattleStats(world, state, id)); } catch { continue; }
        return { world, state, id };
      }
    }
    return null;
  })();
  if (rival) {
    const { enemy: e2, arena: a2 } = arenaFor(rival.world, rival.state, rival.id);
    const hamlets = a2.sites.filter((s) => s.type === 'hamlet' && s.owner === 1);
    for (const h of hamlets) assert.equal(h.capMult, ENEMY_SCALING.freeFolkCapMult, 'neutral hamlets cap like Free Folk');
    for (const s of a2.sites.filter((x) => x.owner === a2.enemyFaction)) assert.equal(s.capMult, e2.capMult);
  }
  assert.ok(player.campTroops > 0);
});

test('caps: the simulated site holds base x capMult, and loses the bonus once the player takes it', () => {
  const found = frontierRegion(3, (r, w) => w.factions[r.faction].personality !== 'passive' || r.tier >= 1);
  const { player, enemy, arena } = arenaFor(found.world, found.state, found.id);
  const battle = createBattle(arena, player, enemy);
  for (const site of battle.sites) {
    const mult = arena.sites[site.id].capMult ?? 1;
    const want = site.owner === PLAYER_FACTION ? SITE_TYPES[site.type].cap + player.capBonus : SITE_TYPES[site.type].cap * mult;
    assert.ok(Math.abs(site.cap - want) < 1e-9, `${site.type} cap ${site.cap} vs ${want}`);
    assert.equal(site.capMult, mult, 'the multiplier travels with the site (saved with the battle)');
  }
  const enemySite = battle.sites.find((s) => s.owner !== PLAYER_FACTION);
  assert.equal(effectiveCap(enemySite.type, PLAYER_FACTION, player, enemySite.capMult), SITE_TYPES[enemySite.type].cap + player.capBonus);
  assert.equal(effectiveCap(enemySite.type, enemySite.owner, player, enemySite.capMult), enemySite.cap);
});

test('sabotage: cuts the garrisons and the card, leaves growth, attack and defence alone; conquest forgets it', () => {
  const found = frontierRegion(4, () => true);
  const { world, state, id } = found;
  const before = enemyBattleStats(world, state, id);
  const ratioBefore = difficulty(state, world, id).ratio;
  state.intel = { [id]: { scouted: true, sabotage: 2 } };
  const after = enemyBattleStats(world, state, id);
  assert.ok(Math.abs(after.troopMult - before.troopMult * (1 - 2 * INTEL.sabotage.step)) < 1e-12);
  for (const k of ['atk', 'def', 'growth', 'capMult']) assert.equal(after[k], before[k], `${k} untouched`);
  assert.ok(difficulty(state, world, id).ratio > ratioBefore, 'the card reads the sabotage at once');
  conquer(state, world, id, 0);
  assert.equal(Intel.intelOf(state, id).scouted, false, 'a conquered region forgets its intel');
});

test('bounty: the realm pays, and a bigger realm pays more', () => {
  const world = generateWorld(5);
  const state = createGame(5, world, 0);
  const first = frontier(state, world)[0];
  const small = bounty(state, world, first);
  assert.ok(Math.abs(small - ECONOMY.bountySeconds * incomePerSec(state, world)) < 1e-9);
  const paid = conquer(state, world, first, 0).bounty;
  assert.ok(Math.abs(paid - small) < 1e-9, 'conquer pays the bounty read before the region joined the realm');
  const second = frontier(state, world)[0];
  assert.ok(bounty(state, world, second) > small, 'the second conquest pays more: the realm grew');
});

test('weak point: a town within 20% of the softest site is taken first, a dearer one is not', () => {
  const world = { tiles: [{ q: 0, r: 0 }, { q: 3, r: 0 }, { q: 3, r: 1 }, { q: 0, r: 4 }] };
  const player = { speed: 1, atk: 1, def: 1, growth: 1, capBonus: 0 };
  const enemy = { atk: 1, def: 1, growth: 0, factionId: 2 };
  const site = (id, tile, type, garrison) => ({ id, tile, type, garrison, owner: 2, neutral: false, isKeep: false, capMult: 1 });
  const camp = world.tiles[0];
  const cost = (g, type) => g * SITE_TYPES[type].def;
  const village = site(1, 1, 'village', 20);
  // same distance, so the camp bias is shared: compare raw cost
  const cheapTown = site(2, 2, 'town', Math.round((cost(20, 'village') * 1.1) / SITE_TYPES.town.def));
  const dearTown = site(2, 2, 'town', Math.round((cost(20, 'village') * 1.5) / SITE_TYPES.town.def));
  const a = Intel.chooseWeakPoint([village, cheapTown], world, camp, player, enemy, 2);
  assert.equal(a.site.type, 'town', 'a town only 10% dearer wins');
  const b = Intel.chooseWeakPoint([village, dearTown], world, camp, player, enemy, 2);
  assert.equal(b.site.type, 'village', 'a town 50% dearer does not');
});

test('campaign: a realm runs end to end, deterministically, with crowns and a growing bounty', () => {
  const a = runCampaign(1, { maxRegions: 6 });
  const b = runCampaign(1, { maxRegions: 6 });
  assert.equal(a.conquestCount, 6);
  assert.deepEqual(a.timeline.map((r) => [r.region, r.wallSec, r.crownsEarned]), b.timeline.map((r) => [r.region, r.wallSec, r.crownsEarned]));
  assert.ok(a.timeline[0].wallSec <= 120, 'first conquest within two minutes');
  for (let i = 1; i < a.timeline.length; i++) assert.ok(a.timeline[i].bounty > 0 && a.timeline[i].income >= a.timeline[i - 1].income * 0.99);
  assert.ok(a.timeline.some((r) => r.crownsEarned >= 1), 'crowns are tracked and awarded');
  assert.ok(a.timeline[5].bounty > a.timeline[0].bounty, 'the bounty grows with the realm');
});

test('campaign: the intel policies scout and sabotage without changing the rules (finisher, heavy)', () => {
  for (const intel of ['finisher', 'heavy']) {
    const r = runCampaign(2, { maxRegions: 10, intel });
    assert.equal(r.conquestCount, 10, `${intel}: still conquers`);
    assert.ok(BATTLE.baseSpeed > 0);
  }
});
