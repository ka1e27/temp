// Battle map generation: the {grid, sites, adjacency} third of a BattleConfig.
//
// Seeded and deterministic — the same (regionSpec, seed) always produces the
// same map, byte for byte, so a battle is reproducible from its config alone.
// Two invariants are VERIFIED here rather than hoped for:
//   1. every site can reach every other site over unblocked hexes;
//   2. the derived site graph is one connected component.
// PURE.
import { distance, findPath, key } from '../core/hex.js';
import { createRng, deriveSeed } from '../core/rng.js';
import { MAPGEN, SITES, SITE_LEVELS, UNIT_IDS } from '../content/balance.js';
import {
  carveRivers, scatterMountains, raiseHighlands, openGroundTest, shuffle,
} from './terrain.js';
import { shapeMask } from './mapshape.js';

// --- grid geometry (offset <-> axial). mapgen owns the grid's shape, so the
// --- rest of battle/ imports these rather than re-deriving them. -----------

/** Offset (col,row) -> axial. Pointy-top, rows shifted every second row. */
export const axialFromOffset = (col, row) => ({ q: col - Math.floor(row / 2), r: row });
/** Inverse of axialFromOffset. */
export const offsetFromAxial = (h) => ({ col: h.q + Math.floor(h.r / 2), row: h.r });

/** Is this hex inside the rectangular play area? */
export function inGrid(grid, h) {
  const { col, row } = offsetFromAxial(h);
  return row >= 0 && row < grid.rows && col >= 0 && col < grid.cols;
}

/** Every hex of the grid, row-major — a stable iteration order. */
export function gridHexes(cols, rows) {
  const out = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) out.push(axialFromOffset(col, row));
  }
  return out;
}

const k = (h) => key(h.q, h.r);

// --- site placement --------------------------------------------------------

/** Which kinds go where, in a fixed order so placement is reproducible. */
function planSites(spec) {
  const plan = [{ owner: 'player', kind: 'camp', band: [0, MAPGEN.homeBandFrac] },
    { owner: 'enemy', kind: 'castle', band: [1 - MAPGEN.homeBandFrac, 1] }];

  const playerExtra = Math.max(0, (spec.playerSites ?? 2) - 1);
  for (let i = 0; i < playerExtra; i++) {
    const kind = (i + 1) % MAPGEN.playerStrongholdEvery === 0 ? 'stronghold' : 'farm';
    plan.push({ owner: 'player', kind, band: [0, MAPGEN.ownBandFrac] });
  }

  const enemyExtra = Math.max(0, (spec.enemySites ?? 6) - 1);
  const enemyForts = Math.min(enemyExtra, Math.max(1, Math.round(enemyExtra * MAPGEN.enemyStrongholdShare)));
  for (let i = 0; i < enemyExtra; i++) {
    plan.push({
      owner: 'enemy', kind: i < enemyForts ? 'stronghold' : 'farm',
      band: [1 - MAPGEN.ownBandFrac, 1],
    });
  }

  const neutral = spec.neutralSites ?? 0;
  const neutralForts = Math.round(neutral * MAPGEN.neutralStrongholdShare);
  for (let i = 0; i < neutral; i++) {
    plan.push({
      owner: 'neutral', kind: i < neutralForts ? 'stronghold' : 'farm',
      band: MAPGEN.neutralBand,
    });
  }
  return plan;
}

/** @param {Set<string>} outside hexes the region's SHAPE puts out of play — a
 *  site placed in one would be marooned inside a mountain range. */
function bandCandidates(grid, [lo, hi], outside) {
  const m = MAPGEN.edgeMargin;
  const out = [];
  const span = Math.max(1, grid.cols - 1);
  for (let row = m; row < grid.rows - m; row++) {
    for (let col = m; col < grid.cols - m; col++) {
      const t = col / span;
      const h = axialFromOffset(col, row);
      if (t >= lo && t <= hi && !outside.has(k(h))) out.push(h);
    }
  }
  // The fallback drops the MARGIN, never the shape: a band with no room left in
  // it is a tuning problem, and a site inside the rock would be a bug.
  return out.length ? out : gridHexes(grid.cols, grid.rows).filter((h) => !outside.has(k(h)));
}

/** First hex of a shuffled band that clears every placed site, relaxing the
 *  separation rather than failing — placement must always terminate. */
function pickHex(rng, cands, placed, wide) {
  const pool = shuffle(rng, cands);
  for (let sep = MAPGEN.minSeparation; sep >= MAPGEN.minSeparationFloor; sep--) {
    for (const h of pool) {
      if (placed.every((p) => distance(p, h) >= sep)) return h;
    }
  }
  for (const h of shuffle(rng, wide)) {
    if (placed.every((p) => distance(p, h) >= MAPGEN.minSeparationFloor)) return h;
  }
  return pool[0];
}

const KIND_TAG = { farm: 'f', stronghold: 's', camp: 'c', castle: 'k' };

/**
 * How built the enemy's country is. The region's `develop` is a position on the
 * SITE_LEVELS ladder, not a multiplier: forts start on it and farms one step
 * below, so late regions are fought over worked ground rather than over the same
 * raw outposts with bigger numbers stacked on them.
 *
 * IT IS FRACTIONAL ON PURPOSE, and that is the whole reason this works. A whole
 * level is a huge step — measured at n=48, moving one region from develop 2 to
 * develop 3 cost about fifty points of win rate, which is more than three
 * regions' worth of the player's own growth. Stepping in whole levels therefore
 * forces `enemyMult` to fall at every step to compensate, and a difficulty dial
 * that goes DOWN as the campaign goes on is a lie on the world map. So a
 * fraction promotes that share of the enemy's forts (and of its farms) one level
 * higher, best sites first, which lets the ladder rise about a sixth of a level
 * per region and keeps the dial monotone the whole way.
 *
 * Everything a level means is already in content/balance.js SITE_LEVELS and is
 * read straight from it by economy, training, siege and the renderer — this
 * invents nothing, it only decides who starts where on the ladder. The player
 * and the neutrals stay at 1: taking developed ground and having to build it
 * back up yourself is the asymmetry the expedition budget pays for.
 */
function developLevels(plan, develop) {
  const out = new Map();
  const base = Math.max(1, Math.floor(develop));
  const share = Math.max(0, Math.min(1, develop - base));
  const clamp = (n) => Math.max(1, Math.min(SITE_LEVELS.length, n));
  // Forts and farms are promoted as separate pools so a region is never all
  // castle and no countryside, or the other way round.
  for (const group of [['castle', 'stronghold'], ['farm']]) {
    const pool = plan.filter((e) => e.owner === 'enemy' && group.includes(e.kind));
    const floor = group[0] === 'farm' ? base - 1 : base;
    const up = Math.round(share * pool.length);
    pool.forEach((entry, i) => out.set(entry, clamp(i < up ? floor + 1 : floor)));
  }
  return out;
}

function scaleGarrison(base, mult) {
  const out = {};
  for (const u of UNIT_IDS) {
    const n = base[u] || 0;
    if (n > 0) out[u] = Math.max(1, Math.round(n * mult));
  }
  return out;
}

// --- terrain ---------------------------------------------------------------
// The ground itself is generated by battle/terrain.js — rivers, then the
// massifs, then the loose scatter. mapgen keeps only the INVARIANT that terrain
// must not break: every site can still reach every other one.

/**
 * Guarantee every site is reachable from every other. Because reachability is
 * transitive we only test site[0] -> each; where a path is missing we clear the
 * terrain along the unobstructed route, which strictly shrinks the blocked set
 * and therefore always terminates.
 */
function repairConnectivity(grid, blocked, siteHexes, outside) {
  // `anywhere` is what this pass is allowed to CLEAR, and it stops at the
  // region's shape: a repair that drilled through the silhouette would undo the
  // one thing the region asked for. It never has to — mapshape.js hands back a
  // connected open region, and every site was placed inside it.
  const anywhere = (h) => inGrid(grid, h) && !outside.has(k(h));
  const open = (h) => anywhere(h) && !blocked.has(k(h));
  const from = siteHexes[0];
  for (let i = 1; i < siteHexes.length; i++) {
    let guard = 0;
    while (!findPath(from, siteHexes[i], open) && guard++ < 64) {
      const raw = findPath(from, siteHexes[i], anywhere);
      if (!raw) break; // the rectangle itself is connected, so this cannot fire
      let cleared = 0;
      for (const h of raw) if (blocked.delete(k(h))) cleared++;
      if (!cleared) break;
    }
  }
}

// --- the site graph is GONE ------------------------------------------------
//
// `buildAdjacency` drew a planar-ish graph of edges and a send was legal only
// along one. Armies march freely now, so there is no graph to draw: the ground
// itself decides what connects to what, and `verifyReachable` below is promoted
// from a belt-and-braces check to THE connectivity invariant of a map.
//
// `config.adjacency` is still accepted and validated by the contract — a
// fixture written before this may keep supplying one — and is simply ignored.
// `battle/state.js recomputeReach` derives `site.adj` from hex distance instead.


// --- entry point -----------------------------------------------------------

/**
 * @param {object} regionSpec {cols, rows, enemySites, neutralSites, playerSites,
 *                             enemyMult, tier}
 * @param {number} seed
 * @returns {{grid:object, sites:object[], adjacency:string[][]}}
 */
export function generateBattleMap(regionSpec, seed) {
  const spec = regionSpec ?? {};
  const cols = Math.max(5, spec.cols ?? 11);
  const rows = Math.max(5, spec.rows ?? 9);
  const enemyMult = spec.enemyMult ?? 1;
  const develop = spec.develop ?? spec.region?.develop ?? 1;
  const rng = createRng(deriveSeed(seed >>> 0, 'mapgen'));
  const grid = { cols, rows, blocked: [] };
  // The region's SILHOUETTE, chosen once and never re-derived. It is decided
  // before anything is placed, because it decides where things CAN be placed —
  // see mapshape.js for why it also joins the rock budget rather than adding
  // to it.
  const outside = shapeMask(spec.shape ?? spec.region?.shape, cols, rows, seed >>> 0);

  const plan = planSites(spec);
  const levels = developLevels(plan, develop);
  const wide = bandCandidates(grid, [0, 1], outside);
  const placed = [];
  const sites = [];
  const counters = {};

  for (const entry of plan) {
    const hex = pickHex(rng, bandCandidates(grid, entry.band, outside), placed, wide);
    placed.push(hex);
    const n = (counters[entry.kind] = (counters[entry.kind] ?? 0) + 1);
    const id = entry.kind === 'camp' ? 'camp'
      : entry.kind === 'castle' ? 'castle'
        : `${entry.owner[0]}${KIND_TAG[entry.kind]}${String(n).padStart(2, '0')}`;

    const throne = entry.owner === 'enemy' && entry.kind === 'castle'
      ? 1 + Math.max(0, develop - 1) * MAPGEN.throneGarrisonPerDevelop : 1;
    const mult = entry.owner === 'enemy' ? enemyMult * throne
      : entry.owner === 'neutral' ? 1 + (enemyMult - 1) * MAPGEN.neutralScaleShare : 1;
    const base = MAPGEN.garrison[entry.owner][entry.kind] ?? {};
    const level = levels.get(entry) ?? 1;
    const lv = SITE_LEVELS[level - 1];
    const hpMax = SITES[entry.kind].hp * lv.hp;

    sites.push({
      id,
      kind: entry.kind,
      hex: [hex.q, hex.r],
      owner: entry.owner,
      level,
      // Deliberately NOT scaled by the level. `develop` buys walls, income and
      // training throughput; `enemyMult` buys bodies. Keeping them orthogonal is
      // what makes a developed region reward hitting it EARLY — the garrison
      // that fills those bigger caps has to be produced during the battle, so
      // "starve it and the castle falls itself" is a real plan and not flavour.
      garrison: scaleGarrison(base, mult),
      hp: hpMax,
      hpMax,
      hpRegen: SITES[entry.kind].hpRegen * lv.regen,
      trainType: MAPGEN.trainType[entry.kind],
    });
  }

  // Rivers first, on their OWN derived stream: mountains must avoid them, and
  // a separate stream means adding water did not reshuffle the site and
  // mountain placement of every map that already existed.
  // ...and a watercourse that runs into a mountain range is the same lie the
  // renderer would otherwise tell about rock on top of water (terrain.js
  // `drawBlocked`), so the shape trims the rivers too.
  grid.rivers = carveRivers(seed >>> 0, cols, rows).filter(([q, r]) => !outside.has(key(q, r)));
  const free = openGroundTest(placed, new Set(grid.rivers.map(([q, r]) => key(q, r))));

  // Massifs around a share of the forts FIRST, then the loose scatter tops the
  // map up to the same total blockedFrac it always had — the ranges are a
  // redistribution of the rock budget, not an addition to it. Connectivity is
  // repaired straight after, so neither pass can wall a site off.
  //
  // The SHAPE is seeded into the same set for exactly that reason, and it is
  // what makes shapes cost what they should: a `narrow` valley already spends
  // more than the whole rock budget, so the scatter adds nothing on top of it
  // and the silhouette IS the region's terrain — while a `split` rift spends a
  // fraction of it and the scatter still lays texture around the crossings.
  const blocked = new Set(outside);
  raiseHighlands(rng, grid, sites.filter((s) => s.kind !== 'farm'), blocked, free);
  scatterMountains(rng, grid, free, blocked);
  repairConnectivity(grid, blocked, placed, outside);
  grid.blocked = [...blocked]
    .map((s) => s.split(',').map(Number))
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);

  return { grid, sites, adjacency: [] };
}

/** True when every site can reach every other over unblocked hexes. Exported
 *  so tests (and the dev overlay) can assert the invariant directly. */
export function verifyReachable(grid, sites) {
  const blocked = new Set(grid.blocked.map(([q, r]) => key(q, r)));
  const open = (h) => inGrid(grid, h) && !blocked.has(k(h));
  const hexes = sites.map((s) => ({ q: s.hex[0], r: s.hex[1] }));
  return hexes.every((h) => findPath(hexes[0], h, open) !== null);
}
