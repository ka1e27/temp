// THE TERRAIN LAYER: what the ground is, and what it does.
//
// Two hex sets ride on `grid`, and they are not the same kind of thing:
//   grid.blocked   MOUNTAINS. Impassable. Already existed; pathing is all it
//                  used to do. Now it is also the reason a fort is hard.
//   grid.rivers    WATERCOURSES. New, and PASSABLE — a river is a modifier,
//                  never a wall. A squad crosses one freely; it just fights
//                  badly in the shallows if it brought the wrong troops.
//
// Two halves live here on purpose:
//   GENERATION   carveRivers / raiseHighlands / scatterMountains — seeded, run
//                once by mapgen.js, which keeps only the reachability invariant
//   QUERIES      groundOf / siteDefMultOf / terrainGoldMult — what the sim, the
//                preview, the AI, the HUD and the balance harness all read
// Keeping them in one file is what stops "is this a river hex?" from being
// written down twice with two different radii.
//
// The queries are memoised per battle state: terrain cannot change during a
// battle, and siegePhase() asks every site every tick at 10 Hz. The cache is a
// WeakMap keyed on the state object, so it holds nothing alive, survives a
// resume (a rehydrated state is a new object and simply recomputes), and never
// puts a Set or a Map inside the state — which must stay plain JSON.
// PURE.
import { distance, neighbors, withinRadius } from '../core/hex.js';
import { createRng, deriveSeed } from '../core/rng.js';
import { MAPGEN, RIVERS, TERRAIN, SITES } from '../content/balance.js';

const k = (q, r) => `${q},${r}`;

/** Deterministic Fisher-Yates. Lives here rather than in mapgen.js because the
 *  dependency runs mapgen -> terrain and must never run back. */
export function shuffle(rng, arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/** Offset column of an axial q on row r — the grid is a brick rectangle. */
const colOf = (h) => h.q + (h.r >> 1);
const inRect = (cols, rows, h) => {
  const c = colOf(h);
  return h.r >= 0 && h.r < rows && c >= 0 && c < cols;
};

/** How many watercourses a grid this size carries. */
export function riverCount(cols, rows) {
  const n = Math.round((cols * rows) / RIVERS.hexesPerRiver);
  return Math.max(RIVERS.minCount, Math.min(RIVERS.maxCount, n));
}

/**
 * Walk one river from `start` to the far side of the grid.
 *
 * At each step the candidate neighbours are split into ONWARD (progress along
 * the river's axis increases) and SIDEWAYS (progress unchanged). Taking
 * sideways steps in runs — `drift` only flips with probability RIVERS.turn — is
 * what produces long lateral reaches instead of a jittery diagonal. A river
 * that snakes is worth reading; a diagonal line is not.
 */
function walkRiver(rng, cols, rows, start, vertical) {
  const progress = vertical ? (h) => h.r : colOf;
  const lateral = vertical ? colOf : (h) => h.r;
  const limit = (vertical ? rows : cols) - 1;

  const path = [start];
  const seen = new Set([k(start.q, start.r)]);
  let cur = start;
  let drift = rng.next() < 0.5 ? -1 : 1;

  for (let guard = 0; guard < cols * rows && progress(cur) < limit; guard++) {
    const p = progress(cur);
    const onward = [];
    const sideways = [];
    for (const h of neighbors(cur)) {
      if (!inRect(cols, rows, h) || seen.has(k(h.q, h.r))) continue;
      if (progress(h) > p) onward.push(h);
      else if (progress(h) === p) sideways.push(h);
    }
    if (rng.next() < RIVERS.turn) drift = -drift;
    let pool = rng.next() < RIVERS.meander && sideways.length ? sideways : onward;
    if (!pool.length) pool = sideways;
    if (!pool.length) break;

    // Within the chosen bucket, follow the drift. Ties resolve by the sorted
    // lateral value, so the walk is reproducible for a given stream.
    pool.sort((a, b) => (lateral(a) - lateral(b)) * drift);
    cur = pool[pool.length - 1];
    seen.add(k(cur.q, cur.r));
    path.push(cur);
  }
  return path;
}

/**
 * Carve every river for a grid. Deterministic in `seed` alone, and on a DERIVED
 * stream (`deriveSeed(seed, 'rivers')`) so adding rivers did not reshuffle every
 * pre-existing map's site and mountain placement.
 *
 * @param {number} seed
 * @param {number} cols @param {number} rows
 * @returns {Array<[number,number]>} sorted, de-duplicated river hexes
 */
export function carveRivers(seed, cols, rows) {
  const rng = createRng(deriveSeed(seed >>> 0, 'rivers'));
  const out = new Map();
  const n = riverCount(cols, rows);

  for (let i = 0; i < n; i++) {
    // Alternate the axis so a map with two rivers gets a confluence-ish cross
    // rather than two parallel stripes.
    const vertical = i % 2 === 0;
    let path = [];
    for (let attempt = 0; attempt < 4 && path.length < RIVERS.minLength; attempt++) {
      // A source on the near edge, in AXIAL coords. Row 0 has col == q, so a
      // vertical river starts at (col, 0); a horizontal one starts at column 0
      // of a random row, which is q = -(row >> 1).
      const row = vertical ? 0 : rng.int(0, rows);
      const from = vertical ? { q: rng.int(0, cols), r: 0 } : { q: -(row >> 1), r: row };
      path = walkRiver(rng, cols, rows, from, vertical);
    }
    for (const h of path) out.set(k(h.q, h.r), [h.q, h.r]);
  }
  return [...out.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

// --- mountains -------------------------------------------------------------

/**
 * Top the impassable ranges up to MAPGEN.blockedFrac of the grid. Runs in short
 * walks rather than as loose hexes, so blocked ground reads as a RIDGE and
 * produces chokepoints instead of a minefield. Never lands on a river (a
 * watercourse under a peak would be a lie the renderer then tells) and never
 * inside `siteClearance` of a site.
 *
 * Takes the set raiseHighlands() already seeded and fills the REMAINDER, so the
 * deliberate massifs come out of the same rock budget the scatter always had.
 * Adding them on top instead measurably clogged the board: same map, longer
 * marches, fewer routes.
 * @returns {Set<string>} the same set, extended
 */
export function scatterMountains(rng, grid, free, blocked = new Set()) {
  const target = Math.round(grid.cols * grid.rows * MAPGEN.blockedFrac);
  const pool = shuffle(rng, gridOf(grid.cols, grid.rows).filter(free));

  let i = 0;
  while (blocked.size < target && i < pool.length) {
    let cur = pool[i++];
    if (blocked.has(k(cur.q, cur.r))) continue;
    const runLen = 1 + rng.int(0, MAPGEN.blockedClusterMax);
    for (let n = 0; n < runLen && blocked.size < target; n++) {
      blocked.add(k(cur.q, cur.r));
      const opts = neighbors(cur)
        .filter((h) => inRect(grid.cols, grid.rows, h) && free(h) && !blocked.has(k(h.q, h.r)));
      if (!opts.length) break;
      cur = opts[rng.int(0, opts.length)];
    }
  }
  return blocked;
}

/**
 * Give a share of the FORTIFICATIONS a range to sit in.
 *
 * Left to chance, a loose 11% scatter puts three or more peaks around a fort
 * about one time in seven — so "a fort in the mountains" would be a lottery the
 * player could never plan around, and a feature nobody can plan around is
 * decoration. This tops the chosen forts up to a full massif deliberately, the
 * way a level designer would, and it is applied to BOTH sides' forts: terrain
 * that only ever helped the enemy would just be a difficulty dial.
 *
 * The added hexes obey exactly the same rules as the scatter, and connectivity
 * is repaired afterwards by mapgen, so a walled-off site is impossible.
 */
export function raiseHighlands(rng, grid, forts, blocked, free) {
  const want = Math.round(forts.length * MAPGEN.highlandFortShare);
  for (const site of shuffle(rng, forts).slice(0, want)) {
    const centre = { q: site.hex[0], r: site.hex[1] };
    const ring = shuffle(rng, withinRadius(centre, TERRAIN.mountainRadius)).filter(
      (h) => inRect(grid.cols, grid.rows, h) && free(h) && !blocked.has(k(h.q, h.r)),
    );
    let have = 0;
    for (const h of withinRadius(centre, TERRAIN.mountainRadius)) {
      if (blocked.has(k(h.q, h.r))) have++;
    }
    for (const h of ring) {
      if (have >= TERRAIN.mountainFull) break;
      blocked.add(k(h.q, h.r));
      have++;
    }
  }
  return blocked;
}

/** Every hex of a cols x rows brick rectangle, row-major. */
function gridOf(cols, rows) {
  const out = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) out.push({ q: col - (row >> 1), r: row });
  }
  return out;
}

/** "No blocked hex within `siteClearance` of any site, and never on a river" —
 *  the predicate both mountain passes share, built once per map. */
export function openGroundTest(siteHexes, wet) {
  return (h) => !wet.has(k(h.q, h.r))
    && !siteHexes.some((s) => distance(s, h) <= MAPGEN.siteClearance);
}

// ---------------------------------------------------------------------------
// Queries — one answer, read by the sim, the preview, the AI and the HUD
// ---------------------------------------------------------------------------

/** @type {WeakMap<object, Record<string, object>>} */
const cache = new WeakMap();

const setOf = (list) => {
  const s = new Set();
  for (const e of list ?? []) s.add(typeof e === 'string' ? e : k(e[0], e[1]));
  return s;
};

/**
 * The ground a site stands on.
 * @returns {{highland:number, river:boolean, mountains:number}}
 *   highland  0..1, how ringed by peaks the site is
 *   river     does a watercourse touch it
 */
export function groundOf(state, site) {
  let byId = cache.get(state);
  if (!byId) { byId = {}; cache.set(state, byId); }
  const hit = byId[site.id];
  if (hit) return hit;

  const blocked = setOf(state.grid?.blocked);
  const rivers = setOf(state.grid?.rivers);
  const centre = { q: site.hex[0], r: site.hex[1] };

  let mountains = 0;
  if (blocked.size) {
    for (const h of withinRadius(centre, TERRAIN.mountainRadius)) {
      if (blocked.has(k(h.q, h.r))) mountains++;
    }
  }
  let river = false;
  if (rivers.size) {
    river = withinRadius(centre, TERRAIN.riverRadius).some((h) => rivers.has(k(h.q, h.r)));
  }

  const g = {
    mountains,
    highland: Math.min(1, mountains / TERRAIN.mountainFull),
    river,
  };
  byId[site.id] = g;
  return g;
}

/** True when the ground modifies nothing — the common case, and the one the
 *  HUD stays quiet about. */
export const isOpen = (g) => !g || (!g.river && g.highland <= 0);

/**
 * The defence multiplier a site actually fights with: its kind's baseline, made
 * harder by the mountains around it and softer by the water under it. THE one
 * function; sim.js, the preview, the AI and the balance harness all call it
 * rather than reading SITES[kind].defMult and each drifting their own way.
 */
export function siteDefMultOf(state, site) {
  const base = SITES[site.kind].defMult;
  const g = groundOf(state, site);
  return base * (1 + TERRAIN.highlandDef * g.highland)
    * (g.river ? TERRAIN.riverDefMult : 1);
}

/** What a farm on a watercourse is worth. 1 for anything that is not one. */
export function terrainGoldMult(state, site) {
  if (site.kind !== 'farm') return 1;
  return groundOf(state, site).river ? TERRAIN.riverFarmGold : 1;
}

/** `'highland'` / `'river'` / `'highland river'` / `''`. */
export function terrainName(g) {
  if (isOpen(g)) return '';
  const parts = [];
  if (g.highland > 0) parts.push(g.highland >= 1 ? 'highland' : 'hills');
  if (g.river) parts.push('river');
  return parts.join(' ');
}
