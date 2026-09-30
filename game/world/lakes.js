// 0-2 small inland lakes: water pockets entirely inside the main landmass.
// Split out of terrain.js to keep that file's size down; takes a
// `neighborsFn` rather than importing one from terrain.js to avoid a
// circular import (terrain.js is the one that calls this).

import { hexDistance, offsetToAxial } from '../core/hex.js';

const MIN_INTERIOR_DEPTH = 4; // hex-steps from any non-landmass tile, so a lake never touches the coast
const MIN_LAKE_SPACING = 8;   // hex-steps between two lakes' centres

function axialOf(i, cols) {
  const row = Math.floor(i / cols);
  return offsetToAxial(i - row * cols, row);
}

/** Plain BFS distance from `seeds`, using an injected neighbour lookup. */
function bfsDistance(seeds, cols, rows, neighborsFn) {
  const dist = new Float64Array(cols * rows).fill(Infinity);
  const queue = [];
  for (const i of seeds) {
    if (dist[i] !== 0) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const d = dist[cur] + 1;
    for (const { index: nb } of neighborsFn(cur, cols, rows)) {
      if (d < dist[nb]) {
        dist[nb] = d;
        queue.push(nb);
      }
    }
  }
  return dist;
}

/** Is `mainLandmass` still (essentially) one connected piece without `removed`? */
function survivesRemoval(mainLandmass, removed, cols, rows, neighborsFn) {
  const n = cols * rows;
  const keep = new Uint8Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    if (mainLandmass[i] && !removed.has(i)) {
      keep[i] = 1;
      total++;
    }
  }
  if (total === 0) return true;
  const seen = new Uint8Array(n);
  let start = -1;
  for (let i = 0; i < n; i++) if (keep[i]) { start = i; break; }
  let size = 0;
  const queue = [start];
  seen[start] = 1;
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    size++;
    for (const { index: nb } of neighborsFn(cur, cols, rows)) {
      if (keep[nb] && !seen[nb]) {
        seen[nb] = 1;
        queue.push(nb);
      }
    }
  }
  // Allow carving to shave off the odd already-tiny sliver, but never split
  // off a substantial second landmass.
  return size >= total * 0.95;
}

/**
 * Carves 0-2 small lakes into `mainLandmass`'s interior lowland, mutating
 * `terrain` ('shallows'), `elev` (0), `land` (false) and `mainLandmass`
 * (false) for the chosen tiles. Never carves a lake that would disconnect
 * the landmass — a candidate that would is simply skipped.
 * @param {import('../core/rng.js').Rng} rng forked for the 'lakes' phase
 * @param {(i: number, cols: number, rows: number) => {dir: number, index: number}[]} neighborsFn
 */
export function carveLakes(rng, terrain, elev, land, mainLandmass, shapedElev, cols, rows, neighborsFn) {
  const lakeCount = rng.int(0, 2);
  if (lakeCount === 0) return;

  const n = cols * rows;
  const distToEdge = bfsDistance((function* () {
    for (let i = 0; i < n; i++) if (!mainLandmass[i]) yield i;
  })(), cols, rows, neighborsFn);

  const candidates = [];
  for (let i = 0; i < n; i++) {
    if (mainLandmass[i] && elev[i] === 1 && distToEdge[i] >= MIN_INTERIOR_DEPTH) candidates.push(i);
  }
  if (candidates.length === 0) return;
  // Prefer the lowest-lying interior ground, like a real basin would collect water.
  candidates.sort((a, b) => shapedElev[a] - shapedElev[b]);

  const placedCenters = [];
  for (const center of candidates) {
    if (placedCenters.length >= lakeCount) break;
    const a = axialOf(center, cols);
    const tooClose = placedCenters.some((c) => {
      const b = axialOf(c, cols);
      return hexDistance(a.q, a.r, b.q, b.r) < MIN_LAKE_SPACING;
    });
    if (tooClose) continue;

    // A small blob: the centre plus whichever of its immediate neighbours
    // are also interior lowland main-landmass tiles (occasionally a couple
    // of second-ring tiles too, for a bit of size variety).
    const blob = new Set([center]);
    for (const { index: nb } of neighborsFn(center, cols, rows)) {
      if (mainLandmass[nb] && elev[nb] === 1 && distToEdge[nb] >= MIN_INTERIOR_DEPTH - 1) blob.add(nb);
    }
    if (rng.chance(0.35)) {
      for (const mid of [...blob]) {
        for (const { index: nb } of neighborsFn(mid, cols, rows)) {
          if (blob.size >= 9) break;
          if (mainLandmass[nb] && elev[nb] === 1 && distToEdge[nb] >= MIN_INTERIOR_DEPTH - 2) blob.add(nb);
        }
      }
    }

    if (!survivesRemoval(mainLandmass, blob, cols, rows, neighborsFn)) continue;

    for (const i of blob) {
      terrain[i] = 'shallows';
      elev[i] = 0;
      land[i] = 0;
      mainLandmass[i] = 0;
    }
    placedCenters.push(center);
  }
}
