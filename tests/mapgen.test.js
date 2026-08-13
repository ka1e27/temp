import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateBattleMap, verifyReachable, inGrid, axialFromOffset, offsetFromAxial, gridHexes,
} from '../src/battle/mapgen.js';
import { distance, findPath, key } from '../src/core/hex.js';
import { MAPGEN, SITES } from '../src/content/balance.js';
import { REGIONS } from '../src/content/regions.data.js';
import { assertBattleConfig, makeMods, CONTRACT_VERSION } from '../src/battle/contract.js';

const SPEC = {
  cols: 11, rows: 9, enemySites: 7, neutralSites: 2, playerSites: 2, enemyMult: 1, tier: 1,
};
const BIG = {
  cols: 15, rows: 11, enemySites: 12, neutralSites: 4, playerSites: 2, enemyMult: 2.6, tier: 2,
};
const SEEDS = [1, 2, 7, 12345, 99991, 0];

test('offset <-> axial round-trips over the whole grid', () => {
  for (const h of gridHexes(13, 10)) {
    const { col, row } = offsetFromAxial(h);
    assert.deepEqual(axialFromOffset(col, row), h);
    assert.ok(inGrid({ cols: 13, rows: 10 }, h));
  }
  assert.equal(inGrid({ cols: 13, rows: 10 }, { q: -9, r: 0 }), false);
  assert.equal(inGrid({ cols: 13, rows: 10 }, { q: 0, r: 10 }), false);
});

test('mapgen is deterministic for a fixed seed and diverges on a different one', () => {
  const a = generateBattleMap(SPEC, 4242);
  const b = generateBattleMap(SPEC, 4242);
  assert.deepEqual(a, b, 'same seed must produce a byte-identical map');
  const c = generateBattleMap(SPEC, 4243);
  assert.notDeepEqual(a.sites.map((s) => s.hex), c.sites.map((s) => s.hex));
});

test('every site is placed legally: in grid, unblocked, and separated', () => {
  for (const seed of SEEDS) {
    for (const spec of [SPEC, BIG]) {
      const { grid, sites } = generateBattleMap(spec, seed);
      const blocked = new Set(grid.blocked.map(([q, r]) => key(q, r)));
      const seen = new Set();
      for (const s of sites) {
        const h = { q: s.hex[0], r: s.hex[1] };
        assert.ok(inGrid(grid, h), `${s.id} off grid at seed ${seed}`);
        assert.ok(!blocked.has(key(h.q, h.r)), `${s.id} sits on blocked terrain`);
        assert.ok(!seen.has(key(h.q, h.r)), `${s.id} overlaps another site`);
        seen.add(key(h.q, h.r));
      }
      for (let i = 0; i < sites.length; i++) {
        for (let j = i + 1; j < sites.length; j++) {
          const d = distance(
            { q: sites[i].hex[0], r: sites[i].hex[1] },
            { q: sites[j].hex[0], r: sites[j].hex[1] },
          );
          assert.ok(d >= MAPGEN.minSeparationFloor,
            `${sites[i].id}/${sites[j].id} crowded at ${d} (seed ${seed})`);
        }
      }
    }
  }
});

test('every site can reach every other site over unblocked hexes', () => {
  for (const seed of SEEDS) {
    for (const spec of [SPEC, BIG]) {
      const { grid, sites } = generateBattleMap(spec, seed);
      const blocked = new Set(grid.blocked.map(([q, r]) => key(q, r)));
      const passable = (h) => inGrid(grid, h) && !blocked.has(key(h.q, h.r));
      // Full all-pairs, not just the transitive shortcut the generator uses.
      for (let i = 0; i < sites.length; i++) {
        for (let j = i + 1; j < sites.length; j++) {
          const path = findPath(
            { q: sites[i].hex[0], r: sites[i].hex[1] },
            { q: sites[j].hex[0], r: sites[j].hex[1] },
            passable,
          );
          assert.ok(path, `no route ${sites[i].id} -> ${sites[j].id} (seed ${seed})`);
        }
      }
      assert.ok(verifyReachable(grid, sites));
      assert.ok(grid.blocked.length > 0, 'chokepoints are part of the design');
    }
  }
});

test('there is no site graph any more: adjacency is empty, and hex reach is the connectivity invariant', () => {
  // buildAdjacency/mapgraph.js are deleted — armies march freely, so there is
  // no authored edge list to hold a degree spread against. What replaced it is
  // verifyReachable (a BFS over unblocked hexes), already exercised above as
  // THE connectivity invariant; what is left to pin here is that nothing
  // quietly resurrects a graph in its place.
  for (const seed of SEEDS) {
    for (const spec of [SPEC, BIG]) {
      const { grid, sites, adjacency } = generateBattleMap(spec, seed);
      assert.deepEqual(adjacency, [], 'generateBattleMap must return an empty adjacency');
      assert.ok(verifyReachable(grid, sites), `seed ${seed}: a site got walled off`);
    }
  }
});

test('the roster matches the region spec and enemy garrisons scale', () => {
  const weak = generateBattleMap(SPEC, 31);
  const strong = generateBattleMap({ ...SPEC, enemyMult: 2.5 }, 31);
  const count = (m, owner) => m.sites.filter((s) => s.owner === owner).length;
  assert.equal(count(weak, 'player'), SPEC.playerSites);
  assert.equal(count(weak, 'enemy'), SPEC.enemySites);
  assert.equal(count(weak, 'neutral'), SPEC.neutralSites);
  assert.equal(weak.sites.filter((s) => s.kind === 'camp').length, 1);
  assert.equal(weak.sites.filter((s) => s.kind === 'castle').length, 1);
  assert.equal(weak.sites.find((s) => s.kind === 'camp').owner, 'player');
  assert.equal(weak.sites.find((s) => s.kind === 'castle').owner, 'enemy');

  const troops = (m, owner) => m.sites.filter((s) => s.owner === owner)
    .reduce((n, s) => n + Object.values(s.garrison).reduce((a, b) => a + b, 0), 0);
  assert.ok(troops(strong, 'enemy') > troops(weak, 'enemy') * 1.8, 'enemyMult must bite');
  assert.equal(troops(strong, 'player'), troops(weak, 'player'), 'the player is never scaled');
});

test('camp and castle start on opposite edges', () => {
  for (const seed of SEEDS) {
    const { grid, sites } = generateBattleMap(SPEC, seed);
    const camp = offsetFromAxial({ q: sites.find((s) => s.kind === 'camp').hex[0], r: sites.find((s) => s.kind === 'camp').hex[1] });
    const castle = offsetFromAxial({ q: sites.find((s) => s.kind === 'castle').hex[0], r: sites.find((s) => s.kind === 'castle').hex[1] });
    assert.ok(camp.col < grid.cols * MAPGEN.homeBandFrac + 1, `camp too far in (seed ${seed})`);
    assert.ok(castle.col > grid.cols * (1 - MAPGEN.homeBandFrac) - 2, `castle too far in (seed ${seed})`);
    assert.ok(castle.col - camp.col > grid.cols * 0.4, 'the two homes must be a war apart');
  }
});

test('a generated map is a valid BattleConfig', () => {
  const map = generateBattleMap(SPEC, 808);
  const cfg = assertBattleConfig({
    contractVersion: CONTRACT_VERSION,
    battleId: 'mapgen-808',
    seed: 808,
    region: { id: 'riverfen', name: 'Riverfen', tier: 1 },
    ...map,
    player: makeMods({ startGold: 300 }),
    enemy: makeMods({ startGold: 200 }),
    boosters: [],
    rules: { victory: 'capture-castle', hardCapMs: 480000, aiTier: 1 },
  });
  assert.equal(cfg.sites.length, SPEC.playerSites + SPEC.enemySites + SPEC.neutralSites);
  for (const s of cfg.sites) {
    assert.equal(s.hpMax, SITES[s.kind].hp, 'sites start at level 1 full health');
    assert.equal(s.hp, s.hpMax);
  }
});

test('no two sites share a hex, on the REAL region table', () => {
  // THE GAP THIS CLOSES. The test above asserts exactly the right property —
  // and against `SPEC` and `BIG`, two synthetic specs, so it could never fire.
  // The bug lived in the dense tier-4/5 regions (obsidian, gravenreach,
  // nightharrow) which that test never generates: `pickHex`'s last resort was a
  // bare `return pool[0]` with no separation check at all, so on a crowded
  // board it handed back a hex another site was already standing on. Measured
  // across 4,800 region-seed pairs it fired on ~39 of them, and it had been
  // there since placement was written.
  //
  // Two sites on one hex is not a cosmetic overlap: `occupancy` is a
  // `hexKey -> owner` map, so one silently overwrites the other — the
  // pathfinder walks through a building, the influence flood counts one site
  // twice, and battle/towers.js puts two guns on one point. Walking the REAL
  // table is the whole point here; a fixture that cannot exhibit the defect is
  // what let this survive.
  for (const region of REGIONS) {
    for (let seed = 1; seed <= 40; seed++) {
      const { sites } = generateBattleMap(region, seed);
      const seen = new Map();
      for (const s of sites) {
        const k = key(s.hex[0], s.hex[1]);
        assert.ok(!seen.has(k),
          `${region.id} seed ${seed}: ${s.id} shares a hex with ${seen.get(k)}`);
        seen.set(k, s.id);
      }
    }
  }
});
