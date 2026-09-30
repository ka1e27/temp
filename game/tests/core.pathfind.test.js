import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPath, dijkstraMulti } from '../core/pathfind.js';

// A small 5x5 grid graph shared by several tests below.
const W = 5;
const H = 5;
const idx = (c, r) => r * W + c;
function gridNeighbors(blocked) {
  return function neighbors(i) {
    const r = Math.floor(i / W);
    const c = i % W;
    const out = [];
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc >= 0 && nc < W && nr >= 0 && nr < H && !blocked.has(idx(nc, nr))) out.push(idx(nc, nr));
    }
    return out;
  };
}
const unitCost = () => 1;
function manhattanTo(goal) {
  const gr = Math.floor(goal / W);
  const gc = goal % W;
  return (i) => Math.abs(Math.floor(i / W) - gr) + Math.abs((i % W) - gc);
}

test('findPath returns [start] when start === goal', () => {
  const neighbors = gridNeighbors(new Set());
  const path = findPath({ start: 7, goal: 7, neighbors, cost: unitCost, heuristic: manhattanTo(7) });
  assert.deepEqual(path, [7]);
});

test('findPath finds the shortest path around an obstacle', () => {
  const blocked = new Set([idx(2, 0), idx(2, 1), idx(2, 2), idx(2, 3)]); // gap at row 4
  const neighbors = gridNeighbors(blocked);
  const start = idx(0, 0);
  const goal = idx(4, 4);
  const path = findPath({ start, goal, neighbors, cost: unitCost, heuristic: manhattanTo(goal) });
  assert.ok(path, 'a path must exist through the gap');
  assert.equal(path[0], start);
  assert.equal(path[path.length - 1], goal);
  assert.ok(path.includes(idx(2, 4)), 'the path must pass through the gap');
  // Manhattan distance is 8 steps -> 9 nodes; the gap does not add a detour here.
  assert.equal(path.length, 9);
  for (const i of path) assert.ok(!blocked.has(i));
});

test('findPath returns null when the goal is unreachable', () => {
  const blocked = new Set([idx(2, 0), idx(2, 1), idx(2, 2), idx(2, 3), idx(2, 4)]); // full wall
  const neighbors = gridNeighbors(blocked);
  const goal = idx(4, 4);
  const path = findPath({ start: idx(0, 0), goal, neighbors, cost: unitCost, heuristic: manhattanTo(goal) });
  assert.equal(path, null);
});

test('findPath respects a non-uniform cost function (prefers the cheaper route)', () => {
  // Two routes of equal hex-length; one crosses an expensive lane at col 2.
  const expensive = new Set([idx(2, 2)]);
  const neighbors = gridNeighbors(new Set());
  const cost = (_from, to) => (expensive.has(to) ? 10 : 1);
  const goal = idx(4, 4);
  const path = findPath({ start: idx(0, 0), goal, neighbors, cost, heuristic: manhattanTo(goal) });
  assert.ok(path);
  assert.ok(!path.includes(idx(2, 2)), 'a cheaper detour exists and should be preferred');
});

test('findPath honours maxNodes as a safety cap', () => {
  const neighbors = gridNeighbors(new Set());
  const goal = idx(4, 4);
  const path = findPath({
    start: idx(0, 0), goal, neighbors, cost: unitCost, heuristic: manhattanTo(goal), maxNodes: 1,
  });
  assert.equal(path, null);
});

test('findPath is deterministic across repeated runs on the same inputs', () => {
  const blocked = new Set([idx(1, 1), idx(1, 2), idx(3, 1), idx(3, 2)]);
  const neighbors = gridNeighbors(blocked);
  const goal = idx(4, 4);
  const runs = Array.from({ length: 5 }, () => findPath({
    start: idx(0, 0), goal, neighbors, cost: unitCost, heuristic: manhattanTo(goal),
  }));
  for (const r of runs) assert.deepEqual(r, runs[0]);
});

test('dijkstraMulti assigns every node to its nearest source', () => {
  const neighbors = gridNeighbors(new Set());
  const sources = [idx(0, 0), idx(4, 4)];
  const { dist, source } = dijkstraMulti({ sources, neighbors, cost: unitCost });
  assert.equal(dist.size, W * H, 'every node should be reached on an open grid');
  assert.equal(dist.get(idx(0, 0)), 0);
  assert.equal(dist.get(idx(4, 4)), 0);
  assert.equal(source.get(idx(0, 0)), 0);
  assert.equal(source.get(idx(4, 4)), 1);
  // (2,2) is equidistant (4 steps) from both corners; nearest-distance is still exact.
  assert.equal(dist.get(idx(2, 2)), 4);
  // A point close to (4,4) belongs to source 1.
  assert.equal(source.get(idx(4, 3)), 1);
  assert.equal(source.get(idx(0, 1)), 0);
});

test('dijkstraMulti with mountain-like high cost keeps low-cost territory close to its source', () => {
  const neighbors = gridNeighbors(new Set());
  const ridge = new Set([idx(2, 0), idx(2, 1), idx(2, 2), idx(2, 3), idx(2, 4)]);
  const cost = (_from, to) => (ridge.has(to) ? 4 : 1);
  const { source } = dijkstraMulti({ sources: [idx(0, 2), idx(4, 2)], neighbors, cost });
  // Tiles well clear of the ridge stay with their own-side source.
  assert.equal(source.get(idx(0, 0)), 0);
  assert.equal(source.get(idx(1, 0)), 0);
  assert.equal(source.get(idx(4, 0)), 1);
  assert.equal(source.get(idx(3, 0)), 1);
});
