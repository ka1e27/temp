// Full-pipeline guarantees from ARCHITECTURE §4, checked across >= 20 seeds.
// Sub-phase behaviour (terrain classification, region partitioning, faction
// sectors, settlement placement) has its own focused test file; this one
// exercises generateWorld() as a whole, plus roads/perks/names/opts, which
// only exist once every phase has run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/generate.js';
import { neighborIndices } from '../world/terrain.js';
import { hexDistance } from '../core/hex.js';
import { WORLD } from '../config/world.js';
import { DYNASTY } from '../config/meta.js';

const COLS = WORLD.cols;
const ROWS = WORLD.rows;
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const PERK_IDS = ['fertile', 'timber', 'iron', 'stone', 'horses', 'harbour', 'shrine', 'throne'];

function timeIt(fn) {
  const start = Date.now();
  const result = fn();
  return { result, ms: Date.now() - start };
}

// The best of 3 runs per seed: about 90 ms alone, but `npm test` runs files in parallel and one slow run on a loaded machine (GC, a
// sibling process) is noise, not a regression. A real slowdown makes every run slow, so the minimum still catches it.
test('generateWorld runs in well under 300ms at the default size (best of 3 runs)', () => {
  for (const seed of [1, 2, 3]) {
    const ms = Math.min(...[0, 1, 2].map(() => timeIt(() => generateWorld(seed)).ms));
    assert.ok(ms < 300, `seed ${seed} took ${ms}ms at best of 3`);
  }
});

test('same (seed, opts) produces byte-for-byte identical JSON', () => {
  for (const seed of [1, 7, 42]) {
    const a = JSON.stringify(generateWorld(seed));
    const b = JSON.stringify(generateWorld(seed));
    assert.equal(a, b, `seed ${seed} was not deterministic`);
  }
});

test('different seeds produce different worlds', () => {
  const a = JSON.stringify(generateWorld(1));
  const b = JSON.stringify(generateWorld(2));
  assert.notEqual(a, b);
});

test('World shape matches the contract: lengths, ids, indices', () => {
  const world = generateWorld(5);
  assert.equal(world.tiles.length, COLS * ROWS);
  world.tiles.forEach((t, i) => {
    assert.equal(t.i, i);
    assert.equal(t.row * COLS + t.col, i);
  });
  world.regions.forEach((r, i) => assert.equal(r.id, i));
  world.settlements.forEach((s, i) => assert.equal(s.id, i));
  world.factions.forEach((f, i) => assert.equal(f.id, i));
  assert.ok(world.startRegion >= 0 && world.startRegion < world.regions.length);
});

test('tile.region agrees with region.tiles in both directions', () => {
  for (const seed of SEEDS.slice(0, 5)) {
    const world = generateWorld(seed);
    for (const region of world.regions) {
      for (const i of region.tiles) assert.equal(world.tiles[i].region, region.id);
    }
    for (const t of world.tiles) {
      if (t.region === -1) continue;
      assert.ok(world.regions[t.region].tiles.includes(t.i));
    }
  }
});

test('bounds is the exact bounding box of every LAND tile', () => {
  for (const seed of [1, 2, 3]) {
    const world = generateWorld(seed);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const t of world.tiles) {
      if (!t.land) continue;
      minX = Math.min(minX, t.x); minY = Math.min(minY, t.y);
      maxX = Math.max(maxX, t.x); maxY = Math.max(maxY, t.y);
    }
    assert.deepEqual(world.bounds, { minX, minY, maxX, maxY });
  }
});

// --- names ------------------------------------------------------------

test('region names are unique, settlement names are unique, and a keep shares its region\'s name', () => {
  for (const seed of SEEDS.slice(0, 10)) {
    const world = generateWorld(seed);
    const regionNames = new Set();
    for (const r of world.regions) {
      assert.ok(!regionNames.has(r.name), `seed ${seed}: duplicate region name ${r.name}`);
      regionNames.add(r.name);
      assert.equal(world.settlements[r.keep].name, r.name);
    }
    const settlementNames = new Set();
    for (const s of world.settlements) {
      if (s.type === 'keep') continue; // keeps intentionally reuse their region's name
      assert.ok(!settlementNames.has(s.name), `seed ${seed}: duplicate settlement name ${s.name}`);
      settlementNames.add(s.name);
    }
  }
});

// --- perks --------------------------------------------------------------

test('every region has a valid perk id; start region is fertile; every capital is throne', () => {
  for (const seed of SEEDS) {
    const world = generateWorld(seed);
    for (const region of world.regions) assert.ok(PERK_IDS.includes(region.perk), `seed ${seed} region ${region.id}: ${region.perk}`);
    assert.equal(world.regions[world.startRegion].perk, 'fertile');
    for (const region of world.regions) if (region.isCapital) assert.equal(region.perk, 'throne');
  }
});

test('every non-throne perk appears at least twice and at most ~5(+1) times, when there are enough regions', () => {
  // +1 slack on the cap: the start region's forced 'fertile' (DESIGN §3.5)
  // is applied AFTER the greedy pass's own cap of 5, so fertile alone can
  // legitimately reach 6.
  const NON_THRONE = PERK_IDS.filter((p) => p !== 'throne');
  for (const seed of SEEDS) {
    const world = generateWorld(seed);
    if (world.regions.length < NON_THRONE.length * 2) continue; // not enough map to guarantee it
    const counts = {};
    for (const r of world.regions) if (r.perk !== 'throne') counts[r.perk] = (counts[r.perk] ?? 0) + 1;
    for (const perk of NON_THRONE) {
      assert.ok((counts[perk] ?? 0) >= 2, `seed ${seed}: ${perk} appears ${counts[perk] ?? 0} times`);
      assert.ok((counts[perk] ?? 0) <= 6, `seed ${seed}: ${perk} appears ${counts[perk] ?? 0} times`);
    }
  }
});

test('perk scoring correlates with terrain in aggregate: iron regions lean hills, timber regions lean forest/pine', () => {
  // Not a per-region rule any more (round 2: greedy assignment with
  // diminishing returns and a same-neighbour penalty can hand a region a
  // perk that isn't its single best terrain match, to keep the map varied)
  // — but the aggregate tendency should still be obvious.
  let ironHillsShare = [];
  let timberForestShare = [];
  for (const seed of SEEDS) {
    const world = generateWorld(seed);
    for (const region of world.regions) {
      const hills = region.tiles.filter((i) => world.tiles[i].terrain === 'hills').length / region.tiles.length;
      const forestPine = region.tiles.filter((i) => ['forest', 'pine'].includes(world.tiles[i].terrain)).length / region.tiles.length;
      if (region.perk === 'iron') ironHillsShare.push(hills);
      if (region.perk === 'timber') timberForestShare.push(forestPine);
    }
  }
  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  assert.ok(ironHillsShare.length > 5, 'expected iron to show up across 20 seeds');
  assert.ok(avg(ironHillsShare) > 0.25, `iron regions averaged only ${avg(ironHillsShare)} hills share`);
  assert.ok(timberForestShare.length > 5, 'expected timber to show up across 20 seeds');
  assert.ok(avg(timberForestShare) > 0.25, `timber regions averaged only ${avg(timberForestShare)} forest/pine share`);
});

test('perk assignment is deterministic for a given seed', () => {
  const a = generateWorld(9).regions.map((r) => r.perk);
  const b = generateWorld(9).regions.map((r) => r.perk);
  assert.deepEqual(a, b);
});

// --- roads ----------------------------------------------------------------

function roadReachable(tiles, cols, rows, startTile, withinSet) {
  const seen = new Set([startTile]);
  const queue = [startTile];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    for (const { dir, index: nb } of neighborIndices(cur, cols, rows)) {
      if (withinSet && !withinSet.has(nb)) continue;
      if ((tiles[cur].road & (1 << dir)) && !seen.has(nb)) {
        seen.add(nb);
        queue.push(nb);
      }
    }
  }
  return seen;
}

test('roads connect every settlement within a region (MST over region.settlements)', () => {
  for (const seed of SEEDS.slice(0, 10)) {
    const world = generateWorld(seed);
    for (const region of world.regions) {
      if (region.settlements.length <= 1) continue;
      const regionTileSet = new Set(region.tiles);
      const keepTile = world.settlements[region.keep].tile;
      const reached = roadReachable(world.tiles, COLS, ROWS, keepTile, regionTileSet);
      for (const id of region.settlements) {
        assert.ok(reached.has(world.settlements[id].tile), `seed ${seed} region ${region.id} settlement ${id} not road-connected`);
      }
    }
  }
});

test('roads connect every pair of neighbouring regions\' keeps', () => {
  for (const seed of SEEDS.slice(0, 10)) {
    const world = generateWorld(seed);
    for (const region of world.regions) {
      const keepTile = world.settlements[region.keep].tile;
      const reached = roadReachable(world.tiles, COLS, ROWS, keepTile, null);
      for (const nb of region.neighbors) {
        const nbKeepTile = world.settlements[world.regions[nb].keep].tile;
        assert.ok(reached.has(nbKeepTile), `seed ${seed}: region ${region.id} keep not road-connected to region ${nb} keep`);
      }
    }
  }
});

test('every road tile costs exactly ROAD_COST', () => {
  const world = generateWorld(1);
  for (const t of world.tiles) if (t.road !== 0) assert.equal(t.cost, 0.55);
});

test('road bits are mutual', () => {
  const world = generateWorld(1);
  const OPPOSITE = [3, 4, 5, 0, 1, 2];
  for (const t of world.tiles) {
    if (t.road === 0) continue;
    for (const { dir, index: nb } of neighborIndices(t.i, COLS, ROWS)) {
      if (t.road & (1 << dir)) assert.ok(world.tiles[nb].road & (1 << OPPOSITE[dir]));
    }
  }
});

// --- opts -------------------------------------------------------------

test('opts.cols/rows override the default grid size', () => {
  const world = generateWorld(1, { cols: 20, rows: 16 });
  assert.equal(world.cols, 20);
  assert.equal(world.rows, 16);
  assert.equal(world.tiles.length, 20 * 16);
});

test('opts.cols/rows alone (regionCount left at the default 28, oversized for a tiny grid) degrades gracefully rather than crashing', () => {
  // Regression: a tiny grid with the default regionCount used to merge the
  // START region itself away (World.startRegion pointing at nothing) and
  // could ask for 3 rival anchors when fewer than 3 regions were even left
  // for rivals. Neither should ever throw; a small enough map may simply
  // end up with fewer regions and/or fewer rival factions holding territory.
  for (const seed of [1, 2, 3, 4, 5]) {
    const world = generateWorld(seed, { cols: 20, rows: 16 });
    assert.ok(world.startRegion >= 0 && world.startRegion < world.regions.length);
    assert.equal(world.regions[world.startRegion].tier, 0);
    assert.equal(world.regions[world.startRegion].faction, 0);
  }
});

test('opts.regionCount overrides the target region count', () => {
  const world = generateWorld(1, { cols: 30, rows: 24, regionCount: 10 });
  assert.ok(Math.abs(world.regions.length - 10) <= 3, `got ${world.regions.length} regions`);
});

test('opts.dynasty enlarges the region count by regionsPerDynasty per extra dynasty, capped at maxRegions', () => {
  const base = generateWorld(1, { dynasty: 1 });
  const two = generateWorld(1, { dynasty: 2 });
  assert.ok(two.regions.length >= base.regions.length, 'dynasty 2 should not shrink the continent');
  const huge = generateWorld(1, { dynasty: 50 });
  assert.ok(huge.regions.length <= DYNASTY.maxRegions + 3, 'region count must respect the configured cap (+/- merge tolerance)');
});

test('generateWorld(seed) with no opts at all does not throw (the meta integration test relies on this)', () => {
  assert.doesNotThrow(() => generateWorld(123));
});

// --- cross-check against hexDistance for a quick sanity pass -------------

test('no two settlements anywhere occupy the very same tile', () => {
  for (const seed of SEEDS) {
    const world = generateWorld(seed);
    const seenTiles = new Set();
    for (const s of world.settlements) {
      assert.ok(!seenTiles.has(s.tile), `seed ${seed}: two settlements share tile ${s.tile}`);
      seenTiles.add(s.tile);
    }
  }
});

test('hexDistance sanity: every settlement pair reported at 0 hexes apart is the same settlement', () => {
  for (const seed of [1, 2]) {
    const world = generateWorld(seed);
    for (let i = 0; i < world.settlements.length; i++) {
      for (let j = i + 1; j < world.settlements.length; j++) {
        const a = world.settlements[i], b = world.settlements[j];
        const d = hexDistance(world.tiles[a.tile].q, world.tiles[a.tile].r, world.tiles[b.tile].q, world.tiles[b.tile].r);
        assert.ok(d > 0);
      }
    }
  }
});
