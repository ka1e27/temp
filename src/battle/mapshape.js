// A region is not a rectangle any more.
//
// Every battle in this game was fought on the same silhouette — cols x rows,
// corner to corner — and the only thing that varied was how much loose rock
// `scatterMountains` sprinkled inside it. Meanwhile the region table has spent
// its whole life CLAIMING otherwise: Ironwood's "single-file passes",
// Saltmere's "salt lagoon splits the field", Gallowmoor's "one approach, no way
// around", Obsidian's "three fronts". None of it was true, in exactly the way
// Ironcrown's Marshal was not true. This file is what makes it true.
//
// A shape is a MASK: the hexes that are out of play. Everything downstream
// already knows what to do with those — they join `grid.blocked`, the renderer
// draws them as a massif (terrain.js `drawBlocked`), pathing walks around them,
// and `verifyReachable` treats them as wall. So the whole feature needed one
// new field on the region row and no change at all to movement, combat, the AI
// or the save format.
//
// PURE, and seeded off `deriveSeed(seed, 'shape')` on its own stream — the same
// discipline `carveRivers` follows, so adding shapes did not reshuffle the site
// or mountain placement of anything that already existed.
import { key, findPath } from '../core/hex.js';
import { createRng, deriveSeed } from '../core/rng.js';

/** The silhouettes a region may ask for. `open` is the rectangle this game
 *  shipped with, and it is still the right answer for the regions whose whole
 *  identity is that there is nowhere to hide (Greywater's "widest front line"). */
export const SHAPES = Object.freeze(['open', 'narrow', 'choke', 'split', 'branch']);

/** Offset (col,row) -> axial, inlined rather than imported from mapgen.js,
 *  which imports THIS file. terrain.js `gridOf` sets the same precedent. */
const A = (col, row) => ({ q: col - (row >> 1), r: row });
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// HOW HARD A SHAPE SQUEEZES — the three numbers that decide what a silhouette
// COSTS, as opposed to what it looks like.
//
// A shape is not free and cannot be made free. Squeezing the playable area
// concentrates the sites the region table placed for a full rectangle, and that
// is a real difficulty change: measured at n=96 against the unshaped campaign,
// the first cut of these numbers (neck 0.52 / keep 0.76 / trunk 0.34) moved
// eighteen regions by -29 to +9 points and put EIGHT of them outside their
// tier's WIN_BAND.
//
// THE FINDING THAT MATTERS, AND IT COST THREE FULL SWEEPS: A SHAPE IS NOT A
// DIAL. It does not apply a tax that a smaller carve scales down — it RE-ROLLS
// where the sites land, and a late region's win rate is a steep function of its
// layout. Softening these three numbers by ~40% did not shrink each region's
// delta toward zero; it moved them by -17 to +22 in scattered directions.
// Duskfell went -14 -> +8 and Thanescar +2 -> -17 on the same softening. So do
// not reach for these expecting to trade "a bit less silhouette" for "a bit
// less difficulty" — you get a different map, and you have to re-measure it.
//
// It is also violently size-dependent: the same `choke` is a gift on a 13x10
// board (Ironwood +5) and a catastrophe on a 21x16 one (Widowsgate -16). More
// sites in less room is fine while you can still walk round the flank, and
// fatal once you cannot. That is why TIER 6 SHIPS UNSHAPED — it is the one tier
// with no `enemyMult` headroom (4.37/4.44/4.48 against Nightharrow's 4.36, see
// regions.rules.js), so there is nothing to pay a shape with, and Widowsgate is
// additionally the incursion arena. Reverting it restored all three to their
// exact pre-shape win rates (26/29/26) and left the endless ladder untouched.
//
// So these are set at the value where the campaign stays inside its measured
// bands, and the silhouette is what fits inside that budget — NOT the other way
// round. Moving any of them re-tunes the campaign, and that is a balance pass
// with a binary search per region in it, not a tweak.
// ---------------------------------------------------------------------------

/**
 * Exported so the tests assert the PROFILE against the same numbers the
 * generator uses. A test that hardcoded "a valley keeps at most 85%" would go
 * red the first time this is re-tuned and tell nobody anything.
 */
export const SQUEEZE = Object.freeze({
  /** Rows a `choke` keeps at its waist, as a fraction of the full height. */
  chokeNeck: 0.74,
  /** Rows a `narrow` valley keeps, as a fraction of the full height. */
  narrowKeep: 0.86,
  /** Where a `branch` stops being a trunk and forks, along the map. Later means
   *  shorter arms, and the arms are the whole cost. */
  branchTrunk: 0.50,
});
const { chokeNeck: CHOKE_NECK, narrowKeep: NARROW_KEEP, branchTrunk: BRANCH_TRUNK } = SQUEEZE;

/**
 * The hexes a region's shape puts OUT OF PLAY, as a Set of `key(q,r)`.
 *
 * Never disconnects the board: whatever the generators produce, the last step
 * keeps only the largest connected open component and masks the rest. Islands
 * are unreachable ground, and unreachable ground is out of play by definition —
 * so this is the honest reading rather than a rescue, and it means no shape can
 * ever hand `repairConnectivity` a problem it must solve by punching a hole
 * through the silhouette.
 *
 * @param {string} shape one of SHAPES; anything unknown is treated as `open`
 * @param {number} cols @param {number} rows @param {number} seed
 * @returns {Set<string>}
 */
export function shapeMask(shape, cols, rows, seed) {
  if (!shape || shape === 'open' || !SHAPES.includes(shape)) return new Set();
  const rng = createRng(deriveSeed(seed >>> 0, `shape:${shape}`));
  const mask = shape === 'narrow' ? narrow(cols, rows, rng)
    : shape === 'choke' ? choke(cols, rows, rng)
      : shape === 'split' ? split(cols, rows, rng)
        : branch(cols, rows, rng);
  return pruneIslands(cols, rows, mask);
}

/** Mask everything outside a per-column band. The two silhouettes that are
 *  really "how tall is the map here" both come out of this. */
function bandMask(cols, rows, bandAt) {
  const out = new Set();
  for (let col = 0; col < cols; col++) {
    const [lo, hi] = bandAt(col);
    for (let row = 0; row < rows; row++) {
      if (row < lo || row > hi) { const h = A(col, row); out.add(key(h.q, h.r)); }
    }
  }
  return out;
}

/**
 * NARROW — a valley. A band of roughly three-quarter height that MEANDERS, so
 * it is a river-cut corridor rather than a letterbox. The meander is what makes
 * it interesting: a straight tube is just a smaller rectangle, and the whole
 * point of a corridor is that you cannot see the far end of it.
 */
function narrow(cols, rows, rng) {
  const h = clamp(Math.round(rows * NARROW_KEEP), 4, rows);
  const amp = (rows - h) / 2;
  const phase = rng.range(0, TAU);
  const freq = TAU / rng.range(cols * 0.7, cols * 1.4);
  return bandMask(cols, rows, (col) => {
    const mid = (rows - 1) / 2 + amp * Math.sin(phase + col * freq);
    const lo = clamp(Math.round(mid - (h - 1) / 2), 0, rows - h);
    return [lo, lo + h - 1];
  });
}

/**
 * CHOKE — an hourglass. Full width at both ends, pinched to about half at a
 * waist somewhere in the middle third. This is the shape that makes a relief
 * force a real decision: there is one place the two halves of the map talk to
 * each other, and both sides know where it is.
 */
function choke(cols, rows, rng) {
  const neck = CHOKE_NECK;
  const waist = rng.range(0.38, 0.62);
  const reach = Math.max(waist, 1 - waist);
  // The pass does not have to be at mid-height, and a waist that is always
  // dead centre reads as a machine part rather than as ground.
  const drift = rng.range(-0.16, 0.16) * rows;
  const span = Math.max(1, cols - 1);
  return bandMask(cols, rows, (col) => {
    const t = Math.abs(col / span - waist) / reach;
    const h = clamp(Math.round(rows * (neck + (1 - neck) * t)), 3, rows);
    const centre = (rows - 1) / 2 + drift * (1 - t);
    const lo = clamp(Math.round(centre - (h - 1) / 2), 0, rows - h);
    return [lo, lo + h - 1];
  });
}

/**
 * SPLIT — a rift across the middle with two crossings. Cheap in area and the
 * most transformative of the four: the map becomes two lanes, a squad sent down
 * one cannot answer a threat in the other, and the crossings are worth holding
 * for their own sake. Saltmere's causeway and the Sunder's two bridges are this.
 */
function split(cols, rows, rng) {
  const thick = rows >= 13 ? 2 : 1;
  const row0 = clamp(Math.round((rows - 1) / 2 + rng.range(-0.08, 0.08) * rows),
    1, rows - 1 - thick);
  // Stops short of both ends, so the lanes always meet behind each home band
  // even before the crossings are counted.
  const c0 = Math.round(cols * 0.10);
  const c1 = cols - 1 - Math.round(cols * 0.10);
  // ONE hex wide, and that is the point: a crossing you can hold with a
  // garrison is a place on the map, and a two-hex gap is just a gap.
  const inner = c1 - c0;
  const g1 = c0 + Math.round(inner * rng.range(0.18, 0.34));
  const g2 = c0 + Math.round(inner * rng.range(0.66, 0.82));

  const out = new Set();
  for (let col = c0; col <= c1; col++) {
    if (col === g1 || col === g2) continue;
    for (let d = 0; d < thick; d++) {
      const h = A(col, row0 + d);
      out.add(key(h.q, h.r));
    }
  }
  return out;
}

/**
 * BRANCH — a trunk that forks. The player's third of the board is open; past it
 * two ridges fan the enemy's country into three arms, each with one pass to the
 * next. It is the shape behind "three fronts, choose where you lose ground":
 * you cannot cover all three from the middle, because there is no middle.
 */
function branch(cols, rows, rng) {
  const thick = 1;
  const trunk = Math.round(cols * BRANCH_TRUNK);
  const rowsAt = [
    clamp(Math.round(rows * rng.range(0.30, 0.38)), 1, rows - 2),
    clamp(Math.round(rows * rng.range(0.62, 0.70)), 2, rows - 1 - thick),
  ];
  const out = new Set();
  for (const r0 of rowsAt) {
    // One pass per ridge, and never the same column twice — two passes in line
    // would be a corridor through the middle and undo the fork.
    const gap = trunk + 2 + Math.round((cols - trunk - 4) * rng.range(0.1, 0.9));
    for (let col = trunk; col < cols; col++) {
      if (col === gap) continue;
      for (let d = 0; d < thick; d++) {
        const rr = r0 + d;
        if (rr < 0 || rr >= rows) continue;
        const h = A(col, rr);
        out.add(key(h.q, h.r));
      }
    }
  }
  return out;
}

/**
 * Keep only the biggest connected open region; everything else joins the mask.
 *
 * This is the guarantee the rest of mapgen leans on. `repairConnectivity` fixes
 * a walled-off SITE by deleting rock, and if it could delete shape rock it
 * would drill straight through the silhouette the region was asked for — so the
 * silhouette has to arrive already connected, rather than be repaired into
 * connectedness afterwards.
 */
function pruneIslands(cols, rows, mask) {
  const open = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const h = A(col, row);
      if (!mask.has(key(h.q, h.r))) open.push(h);
    }
  }
  if (!open.length) return mask;
  const free = (h) => {
    const kk = key(h.q, h.r);
    if (mask.has(kk)) return false;
    const row = h.r;
    const col = h.q + (row >> 1);
    return row >= 0 && row < rows && col >= 0 && col < cols;
  };
  // findPath from one open hex reaches exactly its own component, and the
  // largest component always contains the hex with the most open neighbours —
  // but proving that is harder than just measuring each component, and the grid
  // is at most 21x16.
  const seen = new Set();
  let best = null;
  for (const start of open) {
    if (seen.has(key(start.q, start.r))) continue;
    const group = [];
    const stack = [start];
    seen.add(key(start.q, start.r));
    while (stack.length) {
      const cur = stack.pop();
      group.push(cur);
      for (const n of ringOf(cur)) {
        const kk = key(n.q, n.r);
        if (seen.has(kk) || !free(n)) continue;
        seen.add(kk);
        stack.push(n);
      }
    }
    if (!best || group.length > best.length) best = group;
  }
  const keep = new Set(best.map((h) => key(h.q, h.r)));
  const out = new Set(mask);
  for (const h of open) {
    const kk = key(h.q, h.r);
    if (!keep.has(kk)) out.add(kk);
  }
  return out;
}

/** Neighbours, inlined for the same reason `A` is — and because this walk runs
 *  once per generated map, not per tick. */
const ringOf = (h) => [
  { q: h.q + 1, r: h.r }, { q: h.q - 1, r: h.r },
  { q: h.q, r: h.r + 1 }, { q: h.q, r: h.r - 1 },
  { q: h.q + 1, r: h.r - 1 }, { q: h.q - 1, r: h.r + 1 },
];

/** True when every hex outside `mask` can reach every other. Exported for the
 *  tests, which assert it for every shape at every grid the table ships. */
export function maskConnected(cols, rows, mask) {
  const free = (h) => {
    const row = h.r;
    const col = h.q + (row >> 1);
    return row >= 0 && row < rows && col >= 0 && col < cols
      && !mask.has(key(h.q, h.r));
  };
  const open = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const h = A(col, row);
      if (free(h)) open.push(h);
    }
  }
  if (open.length < 2) return true;
  return open.every((h) => findPath(open[0], h, free) !== null);
}
