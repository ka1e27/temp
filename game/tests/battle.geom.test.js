// Hex geometry and pathfinding: A* respects terrain cost, road shortcuts, river crossing
// penalties, and never routes through impassable terrain. See docs/ARCHITECTURE.md §3/§4.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hexKey, axialNeighbors, hexDistance, axialToPixel, buildTileIndex, findPath, HEX_WORLD_UNIT,
} from '../battle/geom.js';
import { buildTestWorld } from './fixtures/battle-world.js';
import { RIVER_PENALTY } from '../config/world.js';

test('axialNeighbors returns the 6 ARCHITECTURE §3 directions in order', () => {
  const n = axialNeighbors(0, 0);
  assert.deepEqual(n, [
    { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 }, { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
  ]);
});

test('hexDistance and axialToPixel match the documented formulas', () => {
  assert.equal(hexDistance({ q: 0, r: 0 }, { q: 2, r: -1 }), 2);
  assert.equal(hexDistance({ q: 0, r: 0 }, { q: 0, r: 3 }), 3);
  const p = axialToPixel(1, 2);
  assert.ok(Math.abs(p.x - Math.sqrt(3) * (1 + 1)) < 1e-9);
  assert.equal(p.y, 3);
  // Adjacent hex centres are always exactly HEX_WORLD_UNIT apart (hex size = 1).
  for (const n of axialNeighbors(2, -1)) {
    const a = axialToPixel(2, -1);
    const b = axialToPixel(n.q, n.r);
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    assert.ok(Math.abs(d - HEX_WORLD_UNIT) < 1e-9);
  }
});

test('findPath prefers the cheap road corridor over costlier direct terrain', () => {
  const world = buildTestWorld();
  const byKey = buildTileIndex(world.tiles.filter((t) => t.passable));
  const border = world.tiles.find((t) => t.q === 3 && t.r === 2); // road tile
  const keep = world.tiles.find((t) => t.q === 5 && t.r === 2);   // Crimson Keep's tile
  const path = findPath(byKey, border, keep);
  assert.ok(path, 'a path should exist');
  const totalCost = path.reduce((sum, t) => sum + t.cost, 0);
  // The road corridor (3,2)->(4,2)->(5,2 = keep): entering the road tile (4,2) costs 0.55,
  // then plain grass into the keep's own tile costs 1.0 (the keep tile itself carries no
  // road override) = 1.55 total. Any detour through hills/extra grass costs strictly more
  // (e.g. via r=1's hills tile alone is 1.5, before even reaching the keep).
  assert.equal(path.length, 2);
  assert.equal(path[0].q, 4);
  assert.equal(path[0].r, 2);
  assert.equal(path[1].q, 5);
  assert.equal(path[1].r, 2);
  assert.ok(Math.abs(totalCost - 1.55) < 1e-9, `expected cost 1.55, got ${totalCost}`);
});

test('findPath never routes through an impassable (mountain) tile', () => {
  const world = buildTestWorld();
  const byKey = buildTileIndex(world.tiles.filter((t) => t.passable));
  const mountain = world.tiles.find((t) => t.terrain === 'mountain');
  assert.ok(mountain, 'fixture should have a mountain tile');
  assert.ok(!byKey.has(hexKey(mountain.q, mountain.r)), 'impassable tiles are excluded from the index');

  // A path that would naturally pass near/through the mountain (border row 1 crossing to the
  // far side) must route around it instead.
  const from = world.tiles.find((t) => t.q === 3 && t.r === 1);
  const to = world.tiles.find((t) => t.q === 5 && t.r === 1);
  const path = findPath(byKey, from, to);
  assert.ok(path);
  assert.ok(!path.some((t) => t.q === mountain.q && t.r === mountain.r));
  assert.ok(path.every((t) => Number.isFinite(t.cost)));
});

test('crossing the river costs strictly more than the same step without one', () => {
  const world = buildTestWorld();
  const byKey = buildTileIndex(world.tiles.filter((t) => t.passable));
  const a = world.tiles.find((t) => t.q === 2 && t.r === 1); // river: true to E
  const b = world.tiles.find((t) => t.q === 3 && t.r === 1); // river: true to W (reciprocal)
  assert.ok(a.river !== 0 && b.river !== 0, 'fixture should carry the river bits');

  const path = findPath(byKey, a, b);
  assert.ok(path);
  const directCost = path.reduce((sum, t) => sum + t.cost, 0)
    + (path.length === 1 ? RIVER_PENALTY : 0); // single-hop: the crossing is the only edge
  // A single-tile hop straight across the river: grass cost (1.0) + river penalty (0.8).
  assert.equal(path.length, 1);
  assert.ok(Math.abs(directCost - (1.0 + RIVER_PENALTY)) < 1e-9);

  // The same two tiles, but with the river edge removed on both sides: strictly cheaper.
  // (findPath resolves start/goal by (q,r) through `byKey`, so the substitute tiles must
  // actually replace the originals in a fresh index — passing a fake object as `start`
  // would not do it, since the real tile is still what gets looked up during the search.)
  const noRiverTiles = world.tiles
    .filter((t) => t.passable)
    .map((t) => ((t.q === a.q && t.r === a.r) || (t.q === b.q && t.r === b.r) ? { ...t, river: 0 } : t));
  const noRiverByKey = buildTileIndex(noRiverTiles);
  const noRiverPath = findPath(noRiverByKey, noRiverByKey.get(hexKey(a.q, a.r)), noRiverByKey.get(hexKey(b.q, b.r)));
  const noRiverCost = noRiverPath.reduce((sum, t) => sum + t.cost, 0);
  assert.ok(noRiverCost < directCost);
});
