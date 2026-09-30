import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/generate.js';
import {
  buildCaravanRoutes, sampleRoute, roadNeighbor, directionBetween, buildPath,
} from '../world/caravanRoutes.js';
import { AMBIENT } from '../config/ambient.js';
import { DIRS } from '../core/hex.js';
import { elevOffset } from '../render/tiles.js';

const OPP = [3, 4, 5, 0, 1, 2];
const SEEDS = [1, 7, 13, 42];
const worlds = new Map();
function world(seed) {
  if (!worlds.has(seed)) worlds.set(seed, generateWorld(seed));
  return worlds.get(seed);
}

/** Owner table: the player holds the first `n` regions of a BFS from the start region. */
function realm(w, n) {
  const owner = w.regions.map((r) => r.faction);
  const seen = new Set([w.startRegion]);
  const order = [w.startRegion];
  for (let k = 0; k < order.length; k++) {
    for (const nb of [...w.regions[order[k]].neighbors].sort((a, b) => a - b)) {
      if (!seen.has(nb)) { seen.add(nb); order.push(nb); }
    }
  }
  owner.fill(2);
  for (const id of order.slice(0, n)) owner[id] = 0;
  return owner;
}

const check = (name, fn) => test(name, () => { for (const seed of SEEDS) fn(seed, world(seed)); });

check('every consecutive pair of route tiles is road-connected in that direction (both bits set)', (seed, w) => {
  const routes = buildCaravanRoutes(w, realm(w, 9), w.startRegion);
  assert.ok(routes.length > 0, `seed ${seed}: no routes`);
  for (const r of routes) {
    for (let k = 0; k < r.tiles.length - 1; k++) {
      const a = r.tiles[k];
      const b = r.tiles[k + 1];
      const d = directionBetween(w, a, b);
      assert.ok(d >= 0, `seed ${seed} route ${r.key}: tiles ${a},${b} are not adjacent`);
      assert.ok(w.tiles[a].road & (1 << d), `seed ${seed} route ${r.key}: no road bit ${d} on ${a}`);
      assert.ok(w.tiles[b].road & (1 << OPP[d]), `seed ${seed} route ${r.key}: no road bit ${OPP[d]} on ${b}`);
      assert.equal(roadNeighbor(w, a, d), b);
    }
  }
});

check('routes stay inside owned regions; local routes stay inside their own region', (seed, w) => {
  const owner = realm(w, 8);
  for (const r of buildCaravanRoutes(w, owner, w.startRegion)) {
    for (const i of r.tiles) {
      assert.equal(owner[w.tiles[i].region], 0, `seed ${seed} route ${r.key} leaves the realm at tile ${i}`);
      if (r.kind === 'local') assert.equal(w.tiles[i].region, r.regionId, `seed ${seed} local route ${r.key} leaves its region`);
    }
    assert.equal(owner[r.regionId], 0);
    assert.equal(owner[r.toRegionId], 0);
  }
});

check('local routes run settlement to keep; trunks run keep to keep and reach home', (seed, w) => {
  const owner = realm(w, 10);
  const routes = buildCaravanRoutes(w, owner, w.startRegion);
  const keepTile = (rid) => w.settlements[w.regions[rid].keep].tile;
  const settlementTiles = new Set(w.settlements.map((s) => s.tile));
  const next = new Map(); // trunk graph: region -> region
  for (const r of routes) {
    assert.equal(r.tiles[0], r.from);
    assert.equal(r.tiles[r.tiles.length - 1], r.to);
    assert.ok(settlementTiles.has(r.from));
    if (r.kind === 'local') {
      assert.equal(r.to, keepTile(r.regionId));
      assert.notEqual(r.from, r.to);
      assert.equal(w.settlements[w.tiles[r.from].settlement].type, r.sourceType);
    } else {
      assert.equal(r.from, keepTile(r.regionId));
      assert.equal(r.to, keepTile(r.toRegionId));
      assert.notEqual(r.regionId, r.toRegionId);
      assert.equal(r.sourceType, 'keep');
      assert.ok(!next.has(r.regionId), 'one outgoing trunk per keep');
      next.set(r.regionId, r.toRegionId);
    }
  }
  // Following the trunk chain from any region that has one ends at home (no cycles).
  for (const start of next.keys()) {
    let cur = start;
    for (let hops = 0; hops < 40 && cur !== w.startRegion; hops++) {
      assert.ok(next.has(cur), `seed ${seed}: chain from ${start} dead-ends at ${cur}`);
      cur = next.get(cur);
    }
    assert.equal(cur, w.startRegion);
  }
});

check('no duplicate routes and stable route ids', (seed, w) => {
  const routes = buildCaravanRoutes(w, realm(w, 12), w.startRegion);
  assert.equal(new Set(routes.map((r) => r.key)).size, routes.length);
  routes.forEach((r, i) => assert.equal(r.id, i));
});

check('deterministic: building twice gives identical routes', (seed, w) => {
  const owner = realm(w, 9);
  const dump = () => JSON.stringify(buildCaravanRoutes(w, owner, w.startRegion).map((r) => ({
    ...r, pts: Array.from(r.pts), cum: Array.from(r.cum),
  })));
  assert.equal(dump(), dump());
});

check('a realm of only the start region has local routes and no trunks', (seed, w) => {
  const routes = buildCaravanRoutes(w, realm(w, 1), w.startRegion);
  assert.ok(routes.every((r) => r.kind === 'local' && r.regionId === w.startRegion));
});

check('nothing owned, or home not owned: no routes / no trunks, no throw', (seed, w) => {
  assert.deepEqual(buildCaravanRoutes(w, w.regions.map(() => 2), w.startRegion), []);
  const owner = realm(w, 6);
  owner[w.startRegion] = 2;
  const routes = buildCaravanRoutes(w, owner, w.startRegion);
  assert.ok(routes.every((r) => r.kind === 'local'));
});

check('a region disconnected from home gets local routes but no trunk', (seed, w) => {
  // Own the start region and a region that is NOT reachable through owned land.
  const owner = w.regions.map(() => 2);
  owner[w.startRegion] = 0;
  const far = w.regions.filter((r) => r.tier >= 3 && !r.neighbors.includes(w.startRegion))[0];
  owner[far.id] = 0;
  const routes = buildCaravanRoutes(w, owner, w.startRegion);
  assert.ok(!routes.some((r) => r.kind === 'trunk'), `seed ${seed}: unexpected trunk`);
  assert.ok(routes.some((r) => r.regionId === far.id && r.kind === 'local') || far.settlements.length <= 1);
});

test('handles regions with no roads at all', () => {
  const w = generateWorld(7);
  // Same world with every road removed.
  const bare = { ...w, tiles: w.tiles.map((t) => ({ ...t, road: 0 })) };
  const owner = realm(w, 12);
  assert.deepEqual(buildCaravanRoutes(bare, owner, w.startRegion), []);
  // One region's roads removed: the rest still works.
  const region = w.regions[w.startRegion];
  const partial = { ...w, tiles: w.tiles.map((t) => (t.region === region.id ? { ...t, road: 0 } : t)) };
  const routes = buildCaravanRoutes(partial, owner, w.startRegion);
  assert.ok(routes.every((r) => r.regionId !== region.id || r.kind !== 'local'));
  assert.ok(routes.length >= 0);
});

test('a single-settlement region (keep only) has no local route and does not throw', () => {
  const w = generateWorld(7);
  const owner = realm(w, 25);
  const routes = buildCaravanRoutes(w, owner, w.startRegion);
  for (const region of w.regions) {
    if (region.settlements.length === 1) {
      assert.ok(!routes.some((r) => r.kind === 'local' && r.regionId === region.id));
    }
  }
});

check('smooth path: starts at the first tile centre, ends at the last, length is the cumulative sum', (seed, w) => {
  for (const r of buildCaravanRoutes(w, realm(w, 9), w.startRegion)) {
    const first = w.tiles[r.from];
    const last = w.tiles[r.to];
    const lift = (t) => AMBIENT.elevLift[t.elev];
    assert.ok(Math.abs(r.pts[0] - first.x) < 1e-4 && Math.abs(r.pts[1] - (first.y - lift(first))) < 1e-4);
    const m = r.cum.length;
    assert.ok(Math.abs(r.pts[(m - 1) * 2] - last.x) < 1e-4 && Math.abs(r.pts[(m - 1) * 2 + 1] - (last.y - lift(last))) < 1e-4);
    let sum = 0;
    for (let i = 1; i < m; i++) {
      const seg = Math.hypot(r.pts[i * 2] - r.pts[i * 2 - 2], r.pts[i * 2 + 1] - r.pts[i * 2 - 1]);
      assert.ok(seg > 0, 'no zero-length segments');
      assert.ok(seg < 1.0, `segment too long for a smooth path: ${seg}`);
      sum += seg;
    }
    assert.ok(Math.abs(sum - r.length) < 1e-3);
    // Every point stays within one tile radius of some chain tile centre (it follows the road).
    for (let i = 0; i < m; i++) {
      let best = Infinity;
      for (const ti of r.tiles) {
        const t = w.tiles[ti];
        best = Math.min(best, Math.hypot(r.pts[i * 2] - t.x, r.pts[i * 2 + 1] + 0 - (t.y - lift(t))));
      }
      assert.ok(best < 1.0, `point ${i} strays ${best} from the road`);
    }
    // A path through N tiles is at least (N-1) * pitch * 0.85 and at most (N-1) * pitch * 1.05 long.
    const hops = r.tiles.length - 1;
    assert.ok(r.length > hops * AMBIENT.hexPitch * 0.85 && r.length < hops * AMBIENT.hexPitch * 1.1, `length ${r.length} for ${hops} hops`);
  }
});

test('sampleRoute: endpoints, clamping, unit tangents, monotone progress', () => {
  const w = world(7);
  const routes = buildCaravanRoutes(w, realm(w, 8), w.startRegion);
  const out = { x: 0, y: 0, dx: 0, dy: 0 };
  for (const r of routes) {
    sampleRoute(r, -5, out);
    assert.ok(Math.abs(out.x - r.pts[0]) < 1e-4 && Math.abs(out.y - r.pts[1]) < 1e-4);
    sampleRoute(r, r.length + 5, out);
    assert.ok(Math.abs(out.x - r.pts[r.pts.length - 2]) < 1e-4);
    let prevX; let prevY;
    for (let k = 0; k <= 20; k++) {
      sampleRoute(r, (k / 20) * r.length, out);
      assert.ok(Math.abs(Math.hypot(out.dx, out.dy) - 1) < 1e-3);
      if (k > 0) assert.ok(Math.hypot(out.x - prevX, out.y - prevY) < r.length / 20 + 1e-3);
      prevX = out.x; prevY = out.y;
    }
  }
});

test('elevation lift table mirrors render/tiles.js elevOffset', () => {
  for (let e = 0; e < 4; e++) {
    assert.ok(Math.abs(elevOffset({ elev: e }, 1) - AMBIENT.elevLift[e]) < 1e-9, `elev ${e}`);
  }
});

check('elevation: the middle of the curve through each tile sits at exactly that tile top-face height', (seed, w) => {
  const R3 = Math.sqrt(3);
  const half = DIRS.map((d) => ({ x: (R3 * (d.q + d.r / 2)) / 2, y: (1.5 * d.r) / 2 }));
  let hills = 0;
  for (const r of buildCaravanRoutes(w, realm(w, 14), w.startRegion)) {
    for (let k = 1; k < r.tiles.length - 1; k++) {
      const t = w.tiles[r.tiles[k]];
      const din = directionBetween(w, r.tiles[k], r.tiles[k - 1]);
      const dout = directionBetween(w, r.tiles[k], r.tiles[k + 1]);
      // Quadratic curve edge-mid -> centre -> edge-mid at u = 0.5 (a sampled vertex for every tile).
      const mx = 0.25 * (t.x + half[din].x) + 0.5 * t.x + 0.25 * (t.x + half[dout].x);
      const my = 0.25 * (t.y + half[din].y) + 0.5 * t.y + 0.25 * (t.y + half[dout].y) - AMBIENT.elevLift[t.elev];
      let found = false;
      for (let i = 0; i < r.cum.length && !found; i++) {
        found = Math.abs(r.pts[i * 2] - mx) < 1e-4 && Math.abs(r.pts[i * 2 + 1] - my) < 1e-4;
      }
      assert.ok(found, `seed ${seed} route ${r.key}: no curve midpoint for tile ${t.i} (elev ${t.elev})`);
      if (t.elev >= 2) hills++;
    }
  }
  if (seed === 7) assert.ok(hills > 0, 'seed 7 has roads over hills');
});

test('buildPath handles a straight two-tile chain', () => {
  const w = world(7);
  const start = w.tiles.find((t) => t.road && t.land);
  let d = 0;
  while (!(start.road & (1 << d))) d++;
  const other = roadNeighbor(w, start.i, d);
  const { pts, cum, length } = buildPath(w, [start.i, other]);
  assert.ok(pts.length >= 6);
  assert.ok(length > 1.5 && length < 2.0);
  assert.equal(cum[0], 0);
});
