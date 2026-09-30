// Focused tests for game/meta/perks.js (DESIGN §3.5). The shared fixture in
// meta.fixtures.js only exercises 4 of the 7 biome perks plus one capital
// each — these tiny inline worlds cover the rest, plus all three
// faction-specific Throne mappings and the cooldown floor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { perkAccumulate, perkMultipliers } from '../meta/perks.js';
import { PLAYER_FACTION } from '../meta/state.js';

const BBOX = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
const FACTIONS = [
  { id: 0, name: 'Your Realm', personality: 'player', capitalRegion: -1 },
  { id: 1, name: 'Free Folk', personality: 'passive', capitalRegion: -1 },
  { id: 2, name: 'Crimson Legion', personality: 'aggressive', capitalRegion: -1 },
  { id: 3, name: 'Violet Covenant', personality: 'defensive', capitalRegion: -1 },
  { id: 4, name: 'Amber Horde', personality: 'swarm', capitalRegion: -1 },
];

function region(id, faction, perk, neighbors) {
  return {
    id, name: `Region ${id}`, tiles: [id], neighbors, centroid: { x: id, y: 0 }, bbox: BBOX,
    keep: id, settlements: [id], tier: id === 0 ? 0 : 1, faction,
    isCapital: perk === 'throne', biome: 'grass', perk, coastal: true,
  };
}

/** One start region (perk 'none', ignored) plus one test region. */
function worldWithPerk(perk, faction = 1) {
  return {
    seed: 1, cols: 2, rows: 1, tiles: [],
    regions: [region(0, PLAYER_FACTION, 'none', [1]), region(1, faction, perk, [0])],
    settlements: [
      { id: 0, tile: 0, region: 0, type: 'keep', name: 'Home Keep' },
      { id: 1, tile: 1, region: 1, type: 'keep', name: 'Test Keep' },
    ],
    factions: FACTIONS,
    startRegion: 0,
    bounds: BBOX,
  };
}

/** `count` regions, all owned, all sharing the same non-throne perk. */
function manyRegionsWorld(perk, count) {
  const regions = [region(0, PLAYER_FACTION, 'none', [1])];
  const settlements = [{ id: 0, tile: 0, region: 0, type: 'keep', name: 'Home Keep' }];
  for (let i = 1; i <= count; i++) {
    regions.push(region(i, 1, perk, [0]));
    settlements.push({ id: i, tile: i, region: i, type: 'keep', name: `Keep ${i}` });
  }
  return { seed: 1, cols: count + 1, rows: 1, tiles: [], regions, settlements, factions: FACTIONS, startRegion: 0, bounds: BBOX };
}

const OWNED = { owner: [PLAYER_FACTION, PLAYER_FACTION] };
const NOT_OWNED = { owner: [PLAYER_FACTION, 1] };

test('an unowned region\'s perk contributes nothing', () => {
  const { totals, counts } = perkAccumulate(NOT_OWNED, worldWithPerk('fertile', 1));
  assert.deepEqual(totals, { income: 0, growth: 0, atk: 0, def: 0, speed: 0, bounty: 0, cooldown: 0 });
  assert.equal(counts.fertile, 0);
});

const BIOME_CASES = [
  ['fertile', 'income', 0.12],
  ['timber', 'growth', 0.06],
  ['iron', 'atk', 0.05],
  ['stone', 'def', 0.05],
  ['horses', 'speed', 0.06],
  ['harbour', 'bounty', 0.20],
  ['shrine', 'cooldown', 0.06],
];

for (const [perk, stat, amount] of BIOME_CASES) {
  test(`${perk} perk grants +${amount} to ${stat} when owned`, () => {
    const { totals, counts } = perkAccumulate(OWNED, worldWithPerk(perk, 1));
    assert.equal(totals[stat], amount);
    assert.equal(counts[perk], 1);
  });
}

test('perkMultipliers converts raw totals into the ×multiplier bundle', () => {
  const m = perkMultipliers(OWNED, worldWithPerk('fertile', 1));
  assert.equal(m.income, 1.12);
  assert.equal(m.growth, 1);
  assert.equal(m.cooldownMult, 1); // no shrines owned
});

test('cooldown reduction is floored at 0.2 even with many shrines', () => {
  const world = manyRegionsWorld('shrine', 20); // 20 × 6% = 120% raw reduction
  const owner = world.regions.map(() => PLAYER_FACTION);
  const m = perkMultipliers({ owner }, world);
  assert.equal(m.cooldownMult, 0.2);
});

test('same perk on multiple regions stacks additively, not multiplicatively', () => {
  const world = manyRegionsWorld('fertile', 3);
  const owner = world.regions.map(() => PLAYER_FACTION);
  const { totals } = perkAccumulate({ owner }, world);
  assert.ok(Math.abs(totals.income - 3 * 0.12) < 1e-9, `expected 0.36, got ${totals.income}`);
});

const THRONE_CASES = [
  [2, 'aggressive', 'atk'],
  [3, 'defensive', 'def'],
  [4, 'swarm', 'growth'],
];

for (const [factionId, personality, stat] of THRONE_CASES) {
  test(`Throne perk boosts income and ${stat} for a captured ${personality} capital`, () => {
    const { totals, counts, throneDetail } = perkAccumulate(OWNED, worldWithPerk('throne', factionId));
    assert.equal(totals.income, 0.25);
    assert.equal(totals[stat], 0.15);
    assert.equal(counts.throne, 1);
    assert.deepEqual(throneDetail, [{ regionId: 1, factionId, stat, pct: 0.15 }]);
  });
}
