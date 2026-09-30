// Connected-component utilities and the mountain-pass carving that keeps the
// main landmass's PASSABLE tiles a single component. Split out of terrain.js
// purely to keep that file's size down as it grows the silhouette/biome work.

import { neighborIndices } from './terrain.js';
import { TERRAIN_COST } from '../config/world.js';

/** Connected components over a boolean membership array, via grid adjacency. */
export function connectedComponents(members, cols, rows) {
  const n = cols * rows;
  const label = new Int32Array(n).fill(-1);
  const components = [];
  for (let start = 0; start < n; start++) {
    if (!members[start] || label[start] !== -1) continue;
    const compIndex = components.length;
    const tiles = [];
    const queue = [start];
    label[start] = compIndex;
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++];
      tiles.push(cur);
      for (const { index: nb } of neighborIndices(cur, cols, rows)) {
        if (members[nb] && label[nb] === -1) {
          label[nb] = compIndex;
          queue.push(nb);
        }
      }
    }
    components.push(tiles);
  }
  return { label, components };
}

/** Cheapest path (by mountain-tiles-crossed) from any tile in `from` to any tile in `to`. */
function shortestPassToComponent(from, to, neighborsFn, costFn) {
  // 0-1 BFS: edge weights are only ever 0 or 1, so two plain arrays (this
  // level / the next level) stand in for the deque a general Dijkstra would
  // need, and stay O(tiles) instead of a binary heap's O(tiles log tiles).
  const targetSet = new Set(to);
  const dist = new Map();
  const cameFrom = new Map();
  const settled = new Set();
  let current = [];
  for (const i of from) {
    dist.set(i, 0);
    current.push(i);
  }

  let d = 0;
  while (current.length > 0) {
    const next = [];
    for (const cur of current) {
      if (settled.has(cur)) continue;
      settled.add(cur);
      if (targetSet.has(cur)) {
        const path = [cur];
        let c = cur;
        while (cameFrom.has(c)) {
          c = cameFrom.get(c);
          path.push(c);
        }
        return path.reverse();
      }
      for (const nb of neighborsFn(cur)) {
        const weight = costFn(cur, nb);
        const nd = d + weight;
        if (nd < (dist.get(nb) ?? Infinity)) {
          dist.set(nb, nd);
          cameFrom.set(nb, cur);
          (weight === 0 ? current : next).push(nb);
        }
      }
    }
    current = next;
    d++;
  }
  return null;
}

/**
 * Ensures the PASSABLE part of `mainLandmass` is one connected component: for
 * every smaller passable pocket, carve the cheapest mountain-only pass to the
 * largest pocket (converting those specific mountain tiles to hills).
 */
export function fixPassableConnectivity(terrain, elev, passableCost, mainLandmass, cols, rows) {
  const n = cols * rows;
  for (let guard = 0; guard < 8; guard++) {
    const passable = new Uint8Array(n);
    for (let i = 0; i < n; i++) passable[i] = mainLandmass[i] && terrain[i] !== 'mountain' ? 1 : 0;
    const { components } = connectedComponents(passable, cols, rows);
    if (components.length <= 1) return;

    let largest = 0;
    for (let c = 1; c < components.length; c++) {
      if (components[c].length > components[largest].length) largest = c;
    }

    // Smallest non-largest component first: cheapest to reconnect, and this
    // keeps the loop converging monotonically.
    let victim = -1;
    for (let c = 0; c < components.length; c++) {
      if (c === largest) continue;
      if (victim === -1 || components[c].length < components[victim].length) victim = c;
    }
    if (victim === -1) return;

    // Cost 0 to cross a tile already passable, 1 per mountain tile crossed;
    // confined to the main landmass (a pass must stay on this continent, not
    // detour through the sea or a decorative islet).
    const neighborsFn = (i) => neighborIndices(i, cols, rows).map((e) => e.index)
      .filter((nb) => mainLandmass[nb]);
    const costFn = (_from, to) => (terrain[to] === 'mountain' ? 1 : 0);

    // Multi-source, multi-goal 0/1 BFS from the whole victim component to the
    // nearest tile anywhere in the target component — cheaper than one A*
    // call per candidate pair, and costs are only ever 0 or 1 here.
    const best = shortestPassToComponent(components[victim], components[largest], neighborsFn, costFn);

    if (!best) return; // should not happen on a real landmass, but never loop forever
    for (const i of best) {
      if (terrain[i] === 'mountain') {
        terrain[i] = 'hills';
        elev[i] = 2;
        passableCost[i] = TERRAIN_COST.hills;
      }
    }
  }
}
