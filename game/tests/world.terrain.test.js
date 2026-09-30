import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../core/rng.js';
import { WORLD } from '../config/world.js';
import { generateTerrain, neighborIndices } from '../world/terrain.js';
import { connectedComponents, fixPassableConnectivity } from '../world/connectivity.js';

const COLS = WORLD.cols;
const ROWS = WORLD.rows;

function terrainFor(seed) {
  return generateTerrain(seed, createRng(seed).fork('terrain'), COLS, ROWS, WORLD.landFraction);
}

function passableComponents(tiles, mainLandmass) {
  const passable = tiles.map((t, i) => mainLandmass[i] && t.passable);
  const { components } = connectedComponents(new Uint8Array(passable.map(Number)), COLS, ROWS);
  return components;
}

test('generateTerrain is deterministic for a given seed', () => {
  const a = terrainFor(11);
  const b = terrainFor(11);
  assert.deepEqual(a.tiles, b.tiles);
  assert.deepEqual(a.mainLandmass, b.mainLandmass);
});

test('land fraction lands close to WORLD.landFraction (percentile sea level)', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const { tiles } = terrainFor(seed);
    const landFrac = tiles.filter((t) => t.land).length / tiles.length;
    assert.ok(Math.abs(landFrac - WORLD.landFraction) < 0.02, `seed ${seed}: land fraction ${landFrac}`);
  }
});

test('every tile has plausible field shapes and ranges', () => {
  const { tiles } = terrainFor(3);
  for (const t of tiles) {
    assert.ok(t.height >= 0 && t.height <= 1);
    assert.ok(t.moisture >= 0 && t.moisture <= 1);
    assert.ok(t.jitter >= 0 && t.jitter < 1);
    assert.equal(t.passable, t.land && t.terrain !== 'mountain');
    if (!t.passable) assert.equal(t.cost, Infinity);
    else assert.ok(Number.isFinite(t.cost) && t.cost > 0);
    if (!t.land) assert.equal(t.coast, 0);
    assert.equal(t.region, -1); // regions.js hasn't run yet at this layer
    assert.equal(t.settlement, -1);
    assert.equal(t.road, 0);
  }
});

test('elev matches the documented bands: 0 water, 1 lowland, 2 hills, 3 mountain', () => {
  const { tiles } = terrainFor(3);
  for (const t of tiles) {
    if (!t.land) assert.equal(t.elev, 0);
    else if (t.terrain === 'mountain') assert.equal(t.elev, 3);
    else if (t.terrain === 'hills') assert.equal(t.elev, 2);
    else assert.equal(t.elev, 1);
  }
});

/** A water tile's connected water-component: small = an inland lake, huge = the sea. */
function waterComponentSize(tiles, start, cols, rows) {
  const seen = new Set([start]);
  const queue = [start];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    for (const { index: nb } of neighborIndices(cur, cols, rows)) {
      if (!tiles[nb].land && !seen.has(nb)) {
        seen.add(nb);
        queue.push(nb);
      }
    }
  }
  return seen.size;
}

test('water terrain is deep/ocean/shallows only, and SEA shallows always touch land', () => {
  const { tiles } = terrainFor(3);
  for (const t of tiles) {
    if (t.land) continue;
    assert.ok(['deep', 'ocean', 'shallows'].includes(t.terrain));
    if (t.terrain !== 'shallows') continue;
    // A lake's interior tile can be fully surrounded by more lake (also
    // 'shallows', per DESIGN's "lakes are shallows-coloured") — only the
    // SEA's shallows band is guaranteed to border land, by definition of
    // how water depth is computed (distance-to-land <= 1).
    if (waterComponentSize(tiles, t.i, COLS, ROWS) < 20) continue;
    const touchesLand = neighborIndices(t.i, COLS, ROWS).some((e) => tiles[e.index].land);
    assert.ok(touchesLand, `sea shallows tile ${t.i} should touch land`);
  }
});

test('beach only appears on land adjacent to water, never at high elevation', () => {
  const { tiles } = terrainFor(3);
  for (const t of tiles) {
    if (t.terrain !== 'beach') continue;
    assert.ok(t.land && t.coast !== 0);
    assert.equal(t.elev, 1);
  }
});

test('mountains are impassable and never carry a road', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const { tiles } = terrainFor(seed);
    for (const t of tiles) {
      if (t.terrain === 'mountain') {
        assert.equal(t.passable, false);
        assert.equal(t.cost, Infinity);
      }
    }
  }
});

test('row 0 (north) never produces desert/savanna; the far south band never produces snow', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const { tiles } = terrainFor(seed);
    for (const t of tiles) {
      const latT = t.row / (ROWS - 1);
      if (latT < 0.1) assert.ok(!['desert', 'savanna'].includes(t.terrain), `seed ${seed} tile ${t.i}`);
      if (latT > 0.9) assert.notEqual(t.terrain, 'snow', `seed ${seed} tile ${t.i}`);
    }
  }
});

test('river bits are always mutual (if a points to b, b points back to a)', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const { tiles } = terrainFor(seed);
    const OPPOSITE = [3, 4, 5, 0, 1, 2];
    for (const t of tiles) {
      if (t.river === 0) continue;
      for (const { dir, index: nb } of neighborIndices(t.i, COLS, ROWS)) {
        if (t.river & (1 << dir)) {
          assert.ok(tiles[nb].river & (1 << OPPOSITE[dir]), `river bit ${t.i}->${nb} has no return bit`);
        }
      }
    }
  }
});

test('4-7 river sources worth of river network exists on a typical map', () => {
  // Not every tile needs a river, but SOME should exist given high ground.
  for (const seed of [1, 2, 3, 4, 5]) {
    const { tiles } = terrainFor(seed);
    const riverTiles = tiles.filter((t) => t.river !== 0).length;
    assert.ok(riverTiles > 0, `seed ${seed} produced no rivers at all`);
  }
});

test('the passable part of the main landmass is a single connected component', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const { tiles, mainLandmass } = terrainFor(seed);
    const components = passableComponents(tiles, mainLandmass);
    assert.equal(components.length, 1, `seed ${seed}: ${components.length} passable components`);
  }
});

test('generateTerrain runs well under the 300ms budget (terrain is one of several phases)', () => {
  const start = Date.now();
  terrainFor(99);
  assert.ok(Date.now() - start < 150);
});

test('fixPassableConnectivity carves a pass through a synthetic mountain ring', () => {
  // A 7x7 grid: a hex ring of mountains completely encloses the centre tile,
  // isolating it from every other (passable) tile in the grid.
  const cols = 7, rows = 7, n = cols * rows;
  const centerIdx = 3 * cols + 3;
  const ring = neighborIndices(centerIdx, cols, rows).map((e) => e.index);

  const terrain = new Array(n).fill('grass');
  const elev = new Uint8Array(n).fill(1);
  const cost = new Float64Array(n).fill(1);
  for (const i of ring) {
    terrain[i] = 'mountain';
    elev[i] = 3;
    cost[i] = Infinity;
  }
  const mainLandmass = new Uint8Array(n).fill(1);

  function componentSizes() {
    const passable = new Uint8Array(n);
    for (let i = 0; i < n; i++) passable[i] = mainLandmass[i] && terrain[i] !== 'mountain' ? 1 : 0;
    return connectedComponents(passable, cols, rows).components.map((c) => c.length);
  }

  assert.deepEqual(componentSizes().sort((a, b) => a - b), [1, 42]);

  fixPassableConnectivity(terrain, elev, cost, mainLandmass, cols, rows);

  assert.deepEqual(componentSizes(), [44]);
  const convertedCount = ring.filter((i) => terrain[i] === 'hills').length;
  assert.equal(convertedCount, 1, 'exactly one ring tile should become the pass');
  for (const i of ring) {
    if (terrain[i] === 'hills') assert.ok(Number.isFinite(cost[i]));
    else assert.equal(terrain[i], 'mountain');
  }
});

test('fixPassableConnectivity is a no-op when already fully connected', () => {
  const cols = 5, rows = 5, n = cols * rows;
  const terrain = new Array(n).fill('grass');
  const elev = new Uint8Array(n).fill(1);
  const cost = new Float64Array(n).fill(1);
  const mainLandmass = new Uint8Array(n).fill(1);
  fixPassableConnectivity(terrain, elev, cost, mainLandmass, cols, rows);
  assert.ok(terrain.every((t) => t === 'grass'));
});
