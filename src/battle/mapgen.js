// Battle map generation: the {grid, sites, adjacency} third of a BattleConfig.
//
// Seeded and deterministic — the same (regionSpec, seed) always produces the
// same map, byte for byte, so a battle is reproducible from its config alone.
// Two invariants are VERIFIED here rather than hoped for:
//   1. every site can reach every other site over unblocked hexes;
//   2. the derived site graph is one connected component.
// PURE.
import {
  distance, findPath, key, axialFromOffset, offsetFromAxial, inGrid,
} from '../core/hex.js';
import { createRng, deriveSeed } from '../core/rng.js';
import { MAPGEN, SITES, SITE_LEVELS, UNIT_IDS } from '../content/balance.js';
import {
  carveRivers, scatterMountains, raiseHighlands, openGroundTest, shuffle,
} from './terrain.js';
import { shapeMask } from './mapshape.js';

// --- grid geometry (offset <-> axial) --------------------------------------
//
// Moved to core/hex.js, which is where arithmetic with no battle in it belongs,
// and re-exported here so that every `import { inGrid } from './mapgen.js'`
// still resolves. What forced the move: battle/contract.js has to validate that
// a site is on the board, and the seam may not import map generation.
export { axialFromOffset, offsetFromAxial, inGrid };

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

/**
 * How many of `holds` are walls. THE REST ARE YARDS, AND THERE IS ALWAYS AT
 * LEAST ONE.
 *
 * Not fussiness: a stronghold trains nothing now, so a faction whose only
 * non-farm holding is a wall cannot replace a single casualty for the whole
 * battle. Rounding alone produced exactly that — riverfen's enemy gets four
 * extra sites, `enemyStrongholdShare` 0.34 rounds to one hold, and a 50% fort
 * share rounds that one to a fort. The tier-1 enemy would have fought the whole
 * campaign opener on castle production alone, and nothing would have failed.
 */
const fortsAmong = (holds) => (holds <= 1 ? 0
  : Math.min(holds - 1, Math.round(holds * MAPGEN.fortShareOfHolds)));

/**
 * Which kinds go where, in a fixed order so placement is reproducible.
 *
 * THE ENEMY'S COUNTRY HAS A SHAPE NOW: a ring of war around the throne and
 * farmland beyond it. It used to be flat — every enemy holding drew from one
 * band `ownBandFrac` wide, so a region read as a uniform scatter of sites that
 * happened to be red, and no part of the map was more the enemy's than any
 * other.
 *
 * Three rules, and each is one line below:
 *
 *  - THE WAR MACHINE SITS ON THE THRONE'S DOORSTEP. Strongholds and training
 *    grounds take the narrow `holdBandFrac` beside the castle AND stay inside
 *    `holdRadius` of it. A handful of each, and taking them is the campaign —
 *    a wall you have to crack and a yard that stops replacing what you kill.
 *  - THE FARMS ARE OUTSIDE THAT RING, AND THIN AS THEY GO. Farm `i` of `n` may
 *    reach from the edge of the hold band out to `farmBandFrac`, so the belt
 *    nearest the ring is crowded and the marches are sparse. The ring is what
 *    makes "the war machine is nearer the throne than the farmland" true by
 *    construction rather than on average — see `pickHex`, and the riverfen
 *    measurement in it for what happened when it was only on average.
 *  - THE PLAYER LANDS WITH A YARD, NOT A WALL. A stronghold trains nothing now,
 *    so a beachhead of camp-plus-strongholds would be an army that cannot
 *    replace itself. Alternating farm and training ground is a foothold that
 *    works on the day you land; the walls are what you build.
 */
function planSites(spec) {
  const plan = [{ owner: 'player', kind: 'camp', band: [0, MAPGEN.homeBandFrac] },
    { owner: 'enemy', kind: 'castle', band: [1 - MAPGEN.homeBandFrac, 1] }];

  const playerExtra = Math.max(0, (spec.playerSites ?? 2) - 1);
  for (let i = 0; i < playerExtra; i++) {
    const kind = (i + 1) % MAPGEN.playerStrongholdEvery === 0 ? 'trainingGround' : 'farm';
    plan.push({ owner: 'player', kind, band: [0, MAPGEN.ownBandFrac] });
  }

  // THE MIX IS AUTHORED PER REGION WHEN ONE IS SUPPLIED (regions.data.js
  // `siteCounts.enemyMix`, via regions.rowbuilder.js `T()`) — a tuner can say
  // "riverfen's enemy has 2 yards" directly, which the share below cannot: a
  // handful of extra sites rounds to a fixed hold count no matter the share.
  // A bare regionSpec (a test fixture, an ad hoc tools/simrunner.js row) has
  // no mix to read, so it still falls back to the two shares below, exactly
  // as this always worked.
  const enemyExtra = Math.max(0, (spec.enemySites ?? 6) - 1);
  const mix = spec.enemyMix ?? spec.region?.siteCounts?.enemyMix;
  const holds = mix ? mix.forts + mix.grounds : Math.min(enemyExtra,
    Math.max(1, Math.round(enemyExtra * MAPGEN.enemyStrongholdShare)));
  const forts = mix ? mix.forts : fortsAmong(holds);
  const farms = mix ? mix.farms : Math.max(1, enemyExtra - holds);
  for (let i = 0; i < enemyExtra; i++) {
    if (i < holds) {
      plan.push({
        owner: 'enemy', kind: i < forts ? 'stronghold' : 'trainingGround',
        band: [1 - MAPGEN.holdBandFrac, 1], near: 'in',
      });
    } else {
      // 0 for the first farm, 1 for the last. The ceiling sweeps from where the
      // holds STOP out to the marches, rather than from the throne — a farm belt
      // that started at the castle would put the innermost farms closer in than
      // the walls, which is the shape this is meant to invert. Measured on
      // riverfen when it did: one hold at 4 hexes, three farms averaging 2.7.
      const out = ((i - holds) + 1) / farms;
      const reach = MAPGEN.holdBandFrac + (MAPGEN.farmBandFrac - MAPGEN.holdBandFrac) * out;
      plan.push({ owner: 'enemy', kind: 'farm', band: [1 - reach, 1], near: 'out' });
    }
  }

  const neutral = spec.neutralSites ?? 0;
  const neutralHolds = Math.round(neutral * MAPGEN.neutralStrongholdShare);
  const neutralForts = fortsAmong(neutralHolds);
  for (let i = 0; i < neutral; i++) {
    const kind = i < neutralForts ? 'stronghold'
      : (i < neutralHolds ? 'trainingGround' : 'farm');
    plan.push({ owner: 'neutral', kind, band: MAPGEN.neutralBand });
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

/**
 * First hex of a shuffled band that clears every placed site, relaxing the
 * separation rather than failing — placement must always terminate.
 *
 * `near` is an anchor hex and a radius, and it is what actually puts the war
 * machine on the throne's doorstep. A `band` cannot: it is a vertical STRIPE of
 * the map, so on a 16-wide board a band 30% wide is five columns by twelve rows
 * and a site inside it can sit eight hexes from a castle inside the same one.
 * Measured on gallowmoor before this existed, the enemy's holds landed at 3, 5,
 * 6 and 8 hexes from the throne while its farms averaged CLOSER — the exact
 * opposite of the intended shape.
 *
 * A FILTER rather than a sort. Sorting the pool by distance would pack every
 * hold into one ring at exactly `minSeparation` and make the shuffle
 * decorative; filtering keeps the placement as varied as it ever was and only
 * says where it may happen. It falls back to the whole band when the disc has
 * no room left, because a map that fails to place a site is worse than a map
 * whose last stronghold sits a little further out than it wanted to.
 *
 * `near.side` cuts the SAME circle both ways, and that is what makes "the war
 * machine is nearer the throne than the farmland" true by construction instead
 * of on average. Bands alone could not: on an 11-wide riverfen a 30% band is
 * three columns, holds and the innermost farms drew from the same three, and
 * with one hold on the map the "gradient" was a single coin flip — measured, the
 * farms came out NEARER on half the seeds.
 */
function pickHex(rng, cands, placed, wide, near = null) {
  const ring = near
    ? cands.filter((h) => (near.side === 'out'
      ? distance(h, near.at) > near.radius : distance(h, near.at) <= near.radius))
    : cands;
  const pool = shuffle(rng, ring.length ? ring : cands);
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

// Exported so tests/sitekinds.test.js can walk it directly.
export const KIND_TAG = {
  farm: 'f', trainingGround: 'y', stronghold: 's', camp: 'c', castle: 'k', watchtower: 'w',
};

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
  for (const group of [['castle', 'stronghold', 'trainingGround'], ['farm']]) {
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

  // The throne is placed second, before anything that wants to sit near it.
  let throneAt = null;
  const holdRadius = Math.max(MAPGEN.minSeparation + 1,
    Math.round(cols * MAPGEN.holdRadiusFrac));

  for (const entry of plan) {
    const near = entry.near && throneAt
      ? { at: throneAt, radius: holdRadius, side: entry.near } : null;
    const hex = pickHex(rng, bandCandidates(grid, entry.band, outside), placed, wide, near);
    placed.push(hex);
    if (entry.kind === 'castle') throneAt = hex;
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
