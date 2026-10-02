import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  playerBattleStats, enemyBattleStats, frontier, revealed, conquer,
  difficulty, perkTotals, canFoundDynasty, foundDynasty, enemyDepth,
} from '../meta/progression.js';
import { PLAYER_FACTION } from '../meta/state.js';
import { DYNASTY, DIFFICULTY, ECONOMY, UPGRADE_TUNING, PLAYER_BASE } from '../config/meta.js';
import { ENEMY_SCALING, BATTLE } from '../config/battle.js';
import { makeWorld, makeGame, ownEverything } from './meta.fixtures.js';
import { incomePerSec } from '../meta/economy.js';

/** Garrison multiplier of a region at `depth` on the enemy ladder (config/battle.js ENEMY_SCALING). */
const troopScale = (depth) => ENEMY_SCALING.troopAtDepth1 * Math.pow(ENEMY_SCALING.troopPerTier, depth - 1);

function close(actual, expected, msg) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${msg}: expected ${expected}, got ${actual}`);
}

// --- playerBattleStats -------------------------------------------------------

test('playerBattleStats: fresh game equals PLAYER_BASE plus the start region\'s own perk', () => {
  const world = makeWorld();
  const state = makeGame(world);
  const p = playerBattleStats(state, world);
  close(p.atk, 1, 'atk'); close(p.def, 1, 'def'); close(p.growth, 1, 'growth'); close(p.speed, 1, 'speed');
  assert.equal(p.campTroops, PLAYER_BASE.campTroops);
  assert.equal(p.garrisonShare, PLAYER_BASE.garrisonShare);
  assert.deepEqual(p.powers, { rally: 1, firestorm: 0, bulwark: 0, march: 0, levy: 0 });
});

test('playerBattleStats: upgrades, region perks and dynasty stars all compound', () => {
  const world = makeWorld();
  const state = makeGame(world, {
    upgrades: { steel: 3, armour: 2, recruitment: 1, logistics: 4, muster: 5 },
    dynasty: { stars: 2 },
  });
  state.owner[3] = PLAYER_FACTION; // also own the Crimson throne: +15% atk, +25% income

  const p = playerBattleStats(state, world);
  const T = UPGRADE_TUNING;
  const starAtkDef = 1 + 2 * DYNASTY.atkDefPerStar;
  close(p.atk, 1 * (1 + 3 * T.steel.magnitude) * (1 + 0.15) * starAtkDef, 'atk');
  close(p.def, 1 * (1 + 2 * T.armour.magnitude) * 1 * starAtkDef, 'def'); // no def perk owned
  close(p.growth, 1 * (1 + 1 * T.recruitment.magnitude) * 1, 'growth');
  close(p.speed, 1 * (1 + 4 * T.logistics.magnitude) * 1, 'speed');
  assert.equal(p.campTroops, 30 + 5 * T.muster.magnitude);
});

// --- enemyBattleStats --------------------------------------------------------

test('enemyBattleStats: tier and growth scaling, thinkSec by tier, Free Folk grow slowly', () => {
  const world = makeWorld();
  const state = makeGame(world);
  const e = enemyBattleStats(world, state, 1); // Millbrook: tier 1, Free Folk, not a capital
  const depth = enemyDepth(world, world.regions[1]);
  close(e.troopMult, troopScale(depth), 'troopMult');
  close(e.growth, Math.pow(ENEMY_SCALING.growthPerTier, depth) * BATTLE.freeFolkGrowthMult, 'growth (passive × freeFolkGrowthMult)');
  assert.equal(e.thinkSec, ENEMY_SCALING.thinkSecByTier[1]);
  assert.equal(e.personality, 'passive');
  assert.equal(e.factionId, 1);
});

test('enemyBattleStats: a faction capital is scaled up by ENEMY_SCALING.capitalMult', () => {
  const world = makeWorld();
  const state = makeGame(world);
  const e = enemyBattleStats(world, state, 3); // Crimson Keep: tier 2, capital
  const depth = enemyDepth(world, world.regions[3]); // troops scale with depth (a fractional tier on the world's ladder)
  assert.ok(depth >= 1 && depth <= ENEMY_SCALING.atkDefByTier.length - 1, `depth ${depth}`);
  close(e.troopMult, troopScale(depth) * ENEMY_SCALING.capitalMult, 'capital troopMult');
});

test('enemyBattleStats: decapitation weakens the rest of a faction once its capital falls', () => {
  const world = makeWorld();
  const state = makeGame(world);
  const before = enemyBattleStats(world, state, 4); // Ashport: same faction as the Crimson capital (region 3)
  const base = troopScale(enemyDepth(world, world.regions[4]));
  close(before.troopMult, base, 'no decapitation yet');

  state.owner[3] = PLAYER_FACTION; // conquer the Crimson capital
  const after = enemyBattleStats(world, state, 4);
  close(after.troopMult, base * ENEMY_SCALING.decapitationMult, 'decapitated');
});

test('enemyBattleStats: each founded dynasty scales enemy garrisons up further', () => {
  const world = makeWorld();
  const state = makeGame(world, { dynasty: { level: 3 } }); // two dynasties completed
  const e = enemyBattleStats(world, state, 1);
  const expected = troopScale(enemyDepth(world, world.regions[1])) * DYNASTY.enemyMultFirst * DYNASTY.enemyMultPerDynasty;
  close(e.troopMult, expected, 'dynasty-scaled troopMult');
});

// --- frontier / revealed -----------------------------------------------------

test('frontier: only unowned regions adjacent to owned territory', () => {
  const world = makeWorld();
  const state = makeGame(world); // owns only region 0
  assert.deepEqual(frontier(state, world).sort(), [1, 2]);
});

test('frontier grows as territory grows, unlocking newly adjacent regions', () => {
  const world = makeWorld();
  const state = makeGame(world);
  state.owner[1] = PLAYER_FACTION; // take Millbrook
  assert.deepEqual(frontier(state, world).sort(), [2, 3]); // Crimson Keep (3) is now reachable
});

test('revealed: owned regions and their immediate neighbours, nothing further', () => {
  const world = makeWorld();
  const state = makeGame(world);
  assert.deepEqual(revealed(state, world), [true, true, true, false, false, false]);
});

// --- conquer -----------------------------------------------------------------

test('conquer: flips ownership, timestamps it, pays the bounty and counts it', () => {
  const world = makeWorld();
  const state = makeGame(world);
  const result = conquer(state, world, 1, 5000);
  close(result.bounty, ECONOMY.bountySeconds * incomePerSec(makeGame(world), world), "bounty (bountySeconds of the realm's income before the region joined it)");
  assert.equal(result.perk, 'timber');
  assert.equal(result.decapitated, undefined);
  assert.equal(state.owner[1], PLAYER_FACTION);
  assert.equal(state.conqueredAt[1], 5000);
  close(state.gold, result.bounty, 'gold received');
  close(state.stats.goldEarned, result.bounty, 'goldEarned tracks bounty too');
  assert.equal(state.stats.regionsConquered, 1);
});

test('conquer: taking a faction capital reports decapitated: true', () => {
  const world = makeWorld();
  const state = makeGame(world);
  const result = conquer(state, world, 3, 1000);
  assert.equal(result.decapitated, true);
  assert.equal(result.perk, 'throne');
});

test('conquer: does not touch battle-outcome stats (integration layer\'s job)', () => {
  const world = makeWorld();
  const state = makeGame(world);
  conquer(state, world, 1, 1000);
  assert.equal(state.stats.battlesWon, 0);
  assert.equal(state.stats.surrenders, 0);
});

// --- difficulty ---------------------------------------------------------------

/** The easiest first-ring neighbour (the ladder puts the smallest tier-1 region at the bottom: the tutorial fight). */
function easiestNeighbour(state, world) {
  return frontier(state, world).map((id) => difficulty(state, world, id)).sort((a, b) => b.ratio - a.ratio)[0];
}

test('difficulty: the gentlest tier-1 Free Folk neighbour reads Easy at game start', () => {
  const world = makeWorld();
  const state = makeGame(world);
  const d = easiestNeighbour(state, world);
  close(d.power, 30 * 1.08, 'power: campTroops × (1 + 0.08 × unlocked rally)');
  assert.equal(d.label, 'Easy');
  assert.equal(d.surrender, false);
  assert.ok(d.ratio > ECONOMY.difficultyLabels[0].min);
});

test('difficulty: a distant faction capital reads much harder at game start', () => {
  const world = makeWorld();
  const state = makeGame(world);
  const d = difficulty(state, world, 3);
  assert.equal(d.label, 'Deadly');
  assert.ok(d.ratio < ECONOMY.difficultyLabels[ECONOMY.difficultyLabels.length - 2].min);
});

test('difficulty: surrender flips on once power outmatches strength by ECONOMY.surrenderRatio', () => {
  const world = makeWorld();
  // campTroops 30 → 330; a battle already won (surrender is never offered before the first win)
  const state = makeGame(world, { upgrades: { muster: 50 }, stats: { battlesWon: 1 } });
  const d = easiestNeighbour(state, world);
  assert.equal(d.surrender, true);
  assert.equal(d.label, 'Easy');
});

// --- perkTotals (UI) ----------------------------------------------------------

test('perkTotals: UI-facing summary matches perks.js\'s own aggregation', () => {
  const world = makeWorld();
  const state = makeGame(world);
  const t = perkTotals(state, world);
  assert.equal(t.counts.fertile, 1);
  close(t.totals.income, 0.12);
  close(t.multipliers.income, 1.12);
});

// --- dynasty prestige ---------------------------------------------------------

test('canFoundDynasty: false until every region is owned', () => {
  const world = makeWorld();
  const state = makeGame(world);
  assert.equal(canFoundDynasty(state), false);
  ownEverything(state, world);
  assert.equal(canFoundDynasty(state), true);
});

test('foundDynasty: refuses when the continent isn\'t fully conquered', () => {
  const world = makeWorld();
  const state = makeGame(world);
  assert.equal(foundDynasty(state, 999), false);
});

test('foundDynasty: awards starBase + completed dynasty level in stars, resets gold/upgrades, keeps lifetime stats', () => {
  const world = makeWorld();
  const state = makeGame(world, { gold: 5000, upgrades: { steel: 4 }, stats: { battlesWon: 7 } });
  ownEverything(state, world);

  const next = foundDynasty(state, 42);
  assert.equal(next.seed, 42);
  assert.equal(next.dynasty.level, 2);
  assert.equal(next.dynasty.stars, DYNASTY.starBase + 1); // dynasty 1 just completed
  assert.equal(next.gold, 0);
  assert.deepEqual(next.upgrades, { rally: 1 });
  assert.equal(next.stats.battlesWon, 7, 'lifetime stats carry over');
  assert.equal(next.tutorial.done, true);
  assert.equal(next.battle, null);
  assert.deepEqual(next.owner, [], 'owner is empty until resetRegions runs on the new world');
});

test('foundDynasty: with a world already in hand, also repopulates owner/conqueredAt', () => {
  const world = makeWorld();
  const state = makeGame(world, {}, 12345);
  ownEverything(state, world);
  const next = foundDynasty(state, 42, world);
  assert.deepEqual(next.owner, world.regions.map((r) => r.faction));
  assert.equal(next.conqueredAt[world.startRegion], 12345);
});
