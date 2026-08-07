import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateBattleMap, verifyReachable, inGrid, axialFromOffset, offsetFromAxial, gridHexes,
} from '../src/battle/mapgen.js';
import { distance, findPath, key } from '../src/core/hex.js';
import { MAPGEN, SITES } from '../src/content/balance.js';
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

test('the site graph is one connected component with a sane degree spread', () => {
  for (const seed of SEEDS) {
    for (const spec of [SPEC, BIG]) {
      const { sites, adjacency } = generateBattleMap(spec, seed);
      const ids = sites.map((s) => s.id);
      const adj = Object.fromEntries(ids.map((id) => [id, []]));
      for (const [a, b] of adjacency) {
        assert.notEqual(a, b, 'no self loops');
        adj[a].push(b);
        adj[b].push(a);
      }
      // flood fill
      const seen = new Set([ids[0]]);
      const stack = [ids[0]];
      while (stack.length) {
        for (const n of adj[stack.pop()]) if (!seen.has(n)) { seen.add(n); stack.push(n); }
      }
      assert.equal(seen.size, ids.length, `isolated cluster at seed ${seed}`);

      const degrees = ids.map((id) => adj[id].length);
      assert.ok(Math.min(...degrees) >= 1, 'no isolated site');
      // +2 rather than +1: the soft-opening guarantee may add an edge to a site
      // already at the cap. A map where a home base has no reachable soft target
      // has no legal opening move, which is worse than a slightly busy node.
      assert.ok(Math.max(...degrees) <= MAPGEN.adjacency.maxDegree + 2, 'degree stays readable');
      const avg = (adjacency.length * 2) / ids.length;
      // Upper bound allows for the soft-opening edge: every home base is
      // guaranteed a bordering farm it does not own, which can add an edge
      // beyond the target average. Without it a camp can generate walled in
      // behind a stronghold and the battle has no legal opening move.
      assert.ok(avg >= 2.4 && avg <= 3.6, `average degree ${avg} outside the design range`);
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
    boosters: {},
    rules: { victory: 'capture-castle', hardCapMs: 480000, aiTier: 1 },
  });
  assert.equal(cfg.sites.length, SPEC.playerSites + SPEC.enemySites + SPEC.neutralSites);
  for (const s of cfg.sites) {
    assert.equal(s.hpMax, SITES[s.kind].hp, 'sites start at level 1 full health');
    assert.equal(s.hp, s.hpMax);
  }
});
