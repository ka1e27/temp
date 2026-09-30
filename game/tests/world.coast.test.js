// Coast and start-region rules (round 3 world-generation fixes): no stray 1-3 tile islets, beach as a thin
// fringe (never more than BEACH.regionCap of a region), kept islets with some green, and a lush, fair start.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../core/rng.js';
import { WORLD, FACTIONS, BEACH, ISLET, START, TERRAIN_COST, RIVER_PENALTY } from '../config/world.js';
import { generateWorld } from '../world/generate.js';
import { generateTerrain, neighborIndices } from '../world/terrain.js';
import { rankStartTiles, pickStartTile, regionComposition, isGreen } from '../world/regions.js';
import { chooseStart, startQuality, rivalSectorSizes } from '../world/start.js';
import { coastSides, beachScore, trimBeach, capRegionBeaches } from '../world/beaches.js';

const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);
const worlds = new Map();
function world(seed) {
  if (!worlds.has(seed)) worlds.set(seed, generateWorld(seed));
  return worlds.get(seed);
}

/** Land components of a generated world (by the tiles' own `land` flag). */
function landComponents(w) {
  const seen = new Uint8Array(w.tiles.length);
  const out = [];
  for (const t of w.tiles) {
    if (!t.land || seen[t.i]) continue;
    const comp = [t.i];
    seen[t.i] = 1;
    for (let k = 0; k < comp.length; k++) {
      for (const { index: nb } of neighborIndices(comp[k], w.cols, w.rows)) {
        if (w.tiles[nb].land && !seen[nb]) { seen[nb] = 1; comp.push(nb); }
      }
    }
    out.push(comp);
  }
  return out;
}

test('no islet smaller than ISLET.minTiles survives (any seed)', () => {
  for (const seed of SEEDS) {
    const w = world(seed);
    for (const comp of landComponents(w)) {
      assert.ok(comp.length >= ISLET.minTiles, `seed ${seed}: a ${comp.length}-tile islet at tile ${comp[0]}`);
    }
  }
});

test('the land a removed islet leaves behind is open water, not a stray shallow or a stray beach', () => {
  for (const seed of SEEDS) {
    const w = world(seed);
    for (const t of w.tiles) {
      if (t.land) continue;
      assert.ok(['shallows', 'ocean', 'deep'].includes(t.terrain), `seed ${seed} tile ${t.i}: water tile has terrain ${t.terrain}`);
      assert.equal(t.passable, false);
    }
  }
});

test('kept islets (off the main landmass) are not pure beach: they hold green, and beach is at most half', () => {
  let kept = 0;
  for (const seed of SEEDS) {
    const w = world(seed);
    const comps = landComponents(w);
    const main = comps.reduce((a, b) => (b.length > a.length ? b : a), comps[0]);
    for (const comp of comps) {
      if (comp === main) continue;
      kept++;
      const beach = comp.filter((i) => w.tiles[i].terrain === 'beach').length;
      const green = comp.filter((i) => isGreen(w.tiles[i].terrain)).length;
      assert.ok(green >= 1, `seed ${seed}: a ${comp.length}-tile islet with no green`);
      assert.ok(beach <= Math.ceil(comp.length * BEACH.isletCap), `seed ${seed}: a ${comp.length}-tile islet with ${beach} beach tiles`);
    }
  }
  assert.ok(kept > 0, 'the sweep should meet some decorative islets');
});

test('beach is a thin fringe: never more than BEACH.regionCap of a region, and only low, water-facing tiles', () => {
  let beachTiles = 0;
  for (const seed of SEEDS) {
    const w = world(seed);
    for (const r of w.regions) {
      const beach = r.tiles.filter((i) => w.tiles[i].terrain === 'beach').length;
      assert.ok(beach <= Math.floor(BEACH.regionCap * r.tiles.length), `seed ${seed} region ${r.id} (${r.name}): ${beach}/${r.tiles.length} beach`);
    }
    for (const t of w.tiles) {
      if (t.terrain !== 'beach') continue;
      beachTiles++;
      assert.ok(t.coast !== 0, `seed ${seed} tile ${t.i}: beach that is not on the coast`);
    }
  }
  assert.ok(beachTiles > 0, 'some beach should exist');
});

test('the whole world stays a modest share of beach (a fringe, not a biome)', () => {
  let land = 0;
  let beach = 0;
  for (const seed of SEEDS) {
    const w = world(seed);
    for (const t of w.tiles) {
      if (!t.land) continue;
      land++;
      if (t.terrain === 'beach') beach++;
    }
  }
  assert.ok(beach / land < 0.04, `beach share across seeds 1-30 was ${(100 * beach / land).toFixed(1)}%`);
});

test('the start region is lush: at least 60% non-beach land, at least START.minGreen green, some grass/meadow/forest', () => {
  for (const seed of SEEDS) {
    const w = world(seed);
    const labels = w.tiles.map((t) => t.region);
    const comp = regionComposition(w.tiles, labels, w.startRegion);
    assert.ok(1 - comp.beach >= 0.6, `seed ${seed}: start region is ${(100 * comp.beach).toFixed(0)}% beach`);
    assert.ok(comp.green >= START.minGreen, `seed ${seed}: start region is only ${(100 * comp.green).toFixed(0)}% green`);
    const start = w.regions[w.startRegion];
    const hasGreen = start.tiles.some((i) => ['grass', 'meadow', 'forest', 'pine'].includes(w.tiles[i].terrain));
    assert.ok(hasGreen, `seed ${seed}: no grass, meadow or forest in the start region`);
  }
});

test('the start stays coastal, on the west side, and the three rival sectors stay fair (within 2 regions, none under 3)', () => {
  for (const seed of SEEDS) {
    const w = world(seed);
    const keep = w.settlements[w.regions[w.startRegion].keep].tile;
    assert.ok(w.tiles[keep].col < w.cols * 0.65, `seed ${seed}: start keep too far east`);
    assert.ok(w.regions[w.startRegion].tiles.some((i) => w.tiles[i].coast !== 0), `seed ${seed}: start region is not coastal`);
    const sizes = rivalSectorSizes(w.regions);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= START.maxSectorGap, `seed ${seed}: sectors ${sizes.join('/')}`);
    assert.ok(Math.min(...sizes) >= START.minSector, `seed ${seed}: sectors ${sizes.join('/')}`);
  }
});

test('region counts stay near the target (about 28) after the islet / start changes', () => {
  for (const seed of SEEDS) {
    const n = world(seed).regions.length;
    assert.ok(n >= 24 && n <= 32, `seed ${seed}: ${n} regions`);
  }
});

test('generation with the new passes is deterministic', () => {
  for (const seed of [1, 7, 19]) {
    const a = generateWorld(seed);
    const b = generateWorld(seed);
    assert.deepEqual(a.tiles.map((t) => t.terrain), b.tiles.map((t) => t.terrain));
    assert.deepEqual(a.tiles.map((t) => t.region), b.tiles.map((t) => t.region));
    assert.equal(a.startRegion, b.startRegion);
  }
});

test('beach edits keep cost consistent with terrain (and river penalty) off the roads', () => {
  for (const seed of [2, 7, 20]) {
    const w = world(seed);
    for (const t of w.tiles) {
      if (!t.land || !t.passable || t.road !== 0) continue; // roads replace the terrain cost (roads.js)
      const penalty = t.river !== 0 ? RIVER_PENALTY : 0;
      assert.equal(t.cost, TERRAIN_COST[t.terrain] + penalty, `seed ${seed} tile ${t.i} (${t.terrain})`);
    }
  }
});

test('generateTerrain returns the beach bookkeeping: base terrain and lowland rank of every beach tile', () => {
  const rng = createRng(3);
  const { tiles, beachInfo } = generateTerrain(3, rng.fork('terrain'), WORLD.cols, WORLD.rows, WORLD.landFraction);
  assert.ok(beachInfo instanceof Map);
  let beach = 0;
  for (const t of tiles) {
    if (t.terrain !== 'beach') continue;
    beach++;
    const info = beachInfo.get(t.i);
    assert.ok(info, `beach tile ${t.i} missing from beachInfo`);
    assert.ok(['grass', 'meadow', 'savanna', 'desert'].includes(info.base));
    assert.ok(info.rel >= 0 && info.rel <= BEACH.maxRelElev + 1e-9, `rel ${info.rel}`);
  }
  assert.ok(beach > 0);
});

// ---- beaches.js units ---------------------------------------------------------------------

test('coastSides counts the water-facing neighbour bits', () => {
  assert.equal(coastSides(0), 0);
  assert.equal(coastSides(0b000001), 1);
  assert.equal(coastSides(0b101010), 3);
  assert.equal(coastSides(0b111111), 6);
  assert.equal(coastSides(0b1000000), 0, 'only the six direction bits count');
});

test('beachScore ranks exposed, low tiles above sheltered, higher ones', () => {
  const exposedLow = beachScore({ rel: 0.05 }, 0b000111);
  const exposedHigh = beachScore({ rel: 0.3 }, 0b000111);
  const shelteredLow = beachScore({ rel: 0.05 }, 0b000001);
  assert.ok(exposedLow > exposedHigh);
  assert.ok(exposedLow > shelteredLow);
});

test('trimBeach hands back the least beach-like tiles first, ties by index, and stops at the cap', () => {
  const info = new Map([
    [10, { base: 'grass', rel: 0.1 }],
    [11, { base: 'meadow', rel: 0.1 }],
    [12, { base: 'grass', rel: 0.3 }],
    [13, { base: 'savanna', rel: 0.1 }],
  ]);
  const coast = { 10: 0b000111, 11: 0b000001, 12: 0b000111, 13: 0b000001 };
  const beach = new Set([10, 11, 12, 13]);
  const reverted = [];
  const n = trimBeach([10, 11, 12, 13, 14], 2, info, (i) => coast[i] ?? 0, (i) => beach.has(i), (i, base) => { reverted.push([i, base]); beach.delete(i); });
  assert.equal(n, 2);
  assert.deepEqual(reverted, [[11, 'meadow'], [13, 'savanna']], 'sheltered tiles first, tie by index');
  assert.equal(trimBeach([10, 12], 5, info, (i) => coast[i] ?? 0, (i) => beach.has(i), () => assert.fail('under the cap')), 0);
});

test('capRegionBeaches trims each region to the cap and keeps terrain and cost in step', () => {
  const tiles = [];
  const labels = [];
  const info = new Map();
  for (let i = 0; i < 20; i++) {
    const beach = i < 10; // 10 of 20 tiles are beach: over the 35% cap
    tiles.push({ i, terrain: beach ? 'beach' : 'grass', cost: TERRAIN_COST[beach ? 'beach' : 'grass'], coast: i % 3 === 0 ? 0b000011 : 0b000001, river: i === 4 ? 2 : 0 });
    labels.push(0);
    if (beach) info.set(i, { base: 'meadow', rel: i / 40 });
  }
  const n = capRegionBeaches(tiles, labels, info);
  const cap = Math.floor(BEACH.regionCap * 20);
  assert.equal(n, 10 - cap);
  assert.equal(tiles.filter((t) => t.terrain === 'beach').length, cap);
  for (const t of tiles) {
    if (t.i < 10 && t.terrain === 'meadow') {
      assert.equal(t.cost, TERRAIN_COST.meadow + (t.river !== 0 ? RIVER_PENALTY : 0));
    }
  }
  // a second run is a no-op
  assert.equal(capRegionBeaches(tiles, labels, info), 0);
});

// ---- start.js / regions.js units ----------------------------------------------------------

test('rankStartTiles is deterministic, coastal, passable and on the main landmass; pickStartTile is its first entry', () => {
  for (const seed of [1, 7, 13]) {
    const rng = createRng(seed);
    const { tiles, mainLandmass } = generateTerrain(seed, rng.fork('terrain'), WORLD.cols, WORLD.rows, WORLD.landFraction);
    const a = rankStartTiles(tiles, mainLandmass, WORLD.cols, WORLD.rows);
    const b = rankStartTiles(tiles, mainLandmass, WORLD.cols, WORLD.rows);
    assert.deepEqual(a, b);
    assert.ok(a.length >= START.candidates, `seed ${seed}: only ${a.length} start candidates`);
    assert.equal(a[0], pickStartTile(tiles, mainLandmass, WORLD.cols, WORLD.rows));
    for (const i of a) {
      assert.ok(mainLandmass[i] && tiles[i].passable && tiles[i].coast !== 0);
    }
  }
});

test('chooseStart returns labels for the chosen start, deterministically, accepting a lush and balanced candidate', () => {
  for (const seed of [1, 7, 13]) {
    const rng = createRng(seed);
    const { tiles, mainLandmass } = generateTerrain(seed, rng.fork('terrain'), WORLD.cols, WORLD.rows, WORLD.landFraction);
    const a = chooseStart(rng, tiles, mainLandmass, WORLD.cols, WORLD.rows, WORLD, FACTIONS);
    const b = chooseStart(createRng(seed), tiles, mainLandmass, WORLD.cols, WORLD.rows, WORLD, FACTIONS);
    assert.equal(a.startTile, b.startTile);
    assert.deepEqual([...a.labels], [...b.labels]);
    assert.ok(a.quality >= 1, `seed ${seed}: quality ${a.quality}`);
    assert.ok(a.tried >= 1 && a.tried <= START.candidates);
    assert.equal(a.labels[a.startTile], a.startRegion);
  }
});

test('startQuality: lush and fair is 1, a lopsided split or a thin sector is penalised', () => {
  assert.equal(startQuality(0.8, [6, 6, 6]), 1);
  assert.equal(startQuality(START.minGreen, [5, 6, 7]), 1);
  assert.ok(startQuality(START.minGreen / 2, [6, 6, 6]) < 1);
  assert.ok(startQuality(0.8, [6, 6, 9]) < 1);
  assert.ok(startQuality(0.8, [1, 9, 7]) < startQuality(0.8, [4, 9, 7]), 'a tiny sector is worse');
  assert.ok(startQuality(0.8, [2, 9, 9]) < 0.5, 'a sector under START.minSector costs a full point');
});
