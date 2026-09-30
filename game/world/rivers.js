// River flow simulation: 4-7 sources on high ground, steepest descent to
// water. Split out of terrain.js purely to keep that file's size down.

import { offsetToAxial, hexDistance } from '../core/hex.js';
import { createNoise2D } from '../core/noise.js';
import { hash32 } from '../core/rng.js';
import { neighborIndices } from './terrain.js';

const OPPOSITE = [3, 4, 5, 0, 1, 2]; // DIRS index -> its opposite direction

/** 4-7 rivers flowing by steepest descent from high passable ground to water. */
export function computeRivers(rng, terrain, elev, shapedElev, mainLandmass, cols, rows) {
  const n = cols * rows;
  const river = new Int32Array(n);
  const tieBreak = createNoise2D(hash32(rng.int(0, 0x7fffffff), 'river-tiebreak'));

  const candidates = [];
  for (let i = 0; i < n; i++) {
    if (mainLandmass[i] && terrain[i] !== 'mountain' && elev[i] >= 1 && shapedElev[i] > 0) candidates.push(i);
  }
  candidates.sort((a, b) => shapedElev[b] - shapedElev[a]);
  const highGround = candidates.slice(0, Math.max(1, Math.floor(candidates.length * 0.25)));

  const axialOf = (i) => {
    const row = Math.floor(i / cols);
    return offsetToAxial(i - row * cols, row);
  };

  const sourceCount = Math.min(highGround.length, rng.int(4, 7));
  const sources = [];
  // Spread sources out rather than clustering: greedily pick from highGround
  // (already sorted by elevation) while skipping anything too close to a
  // source already chosen.
  const minSpacing = Math.max(cols, rows) * 0.12;
  for (const i of highGround) {
    if (sources.length >= sourceCount) break;
    const a = axialOf(i);
    const tooClose = sources.some((s) => {
      const b = axialOf(s);
      return hexDistance(a.q, a.r, b.q, b.r) < minSpacing;
    });
    if (!tooClose) sources.push(i);
  }

  for (const source of sources) {
    let cur = source;
    const visited = new Set([cur]);
    for (let step = 0; step < cols + rows; step++) {
      if (!mainLandmass[cur] || terrain[cur] === 'deep' || terrain[cur] === 'ocean' || terrain[cur] === 'shallows') break;
      const options = neighborIndices(cur, cols, rows).filter((e) => mainLandmass[e.index] && !visited.has(e.index));
      if (options.length === 0) break;
      let bestDir = -1, bestIdx = -1, bestScore = Infinity;
      for (const { dir, index: nb } of options) {
        const score = shapedElev[nb] + tieBreak(nb * 0.37, dir * 0.51) * 1e-3;
        if (score < bestScore) {
          bestScore = score;
          bestDir = dir;
          bestIdx = nb;
        }
      }
      if (bestIdx === -1 || shapedElev[bestIdx] >= shapedElev[cur] + 0.02) break; // local minimum: river ends here
      river[cur] |= 1 << bestDir;
      river[bestIdx] |= 1 << OPPOSITE[bestDir];
      visited.add(bestIdx);
      cur = bestIdx;
    }
  }
  return river;
}
