// WHERE THE SITES GO — the placement half of map generation.
//
// Split out of ./mapgen.js at the 400-line cap and imported back, the same way
// mapshape.js and terrain.js already are. The seam is real rather than
// arbitrary: everything here answers "which kind, in which band, on which hex",
// and nothing here knows about rivers, highlands, reachability or the grid's
// blocked set beyond being handed one.
// PURE.
import { distance, axialFromOffset } from '../core/hex.js';
import { MAPGEN } from '../content/balance.js';
import { shuffle } from './terrain.js';
import { gridHexes, kOf } from './mapgen.js';

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
export const fortsAmong = (holds) => (holds <= 1 ? 0
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
export function planSites(spec) {
  // rowBand corners the beachhead (a real box) instead of just edging it.
  const plan = [{ owner: 'player', kind: 'camp', band: [0, MAPGEN.playerHomeBandFrac], rowBand: [0, MAPGEN.playerHomeBandFrac] },
    { owner: 'enemy', kind: 'castle', band: [1 - MAPGEN.homeBandFrac, 1] }];

  const playerExtra = Math.max(0, (spec.playerSites ?? 2) - 1);
  for (let i = 0; i < playerExtra; i++) {
    const kind = (i + 1) % MAPGEN.playerStrongholdEvery === 0 ? 'trainingGround' : 'farm';
    plan.push({ owner: 'player', kind, band: [0, MAPGEN.ownBandFrac], rowBand: [0, MAPGEN.ownBandFrac] });
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

/** @param {Set<string>} outside a site would be marooned in. `rowBand` mirrors [lo,hi] on the row axis, default the whole grid. */
export function bandCandidates(grid, [lo, hi], outside, rowBand = [0, 1]) {
  const m = MAPGEN.edgeMargin;
  const out = [];
  const span = Math.max(1, grid.cols - 1);
  for (let row = m; row < grid.rows - m; row++) {
    if (row / Math.max(1, grid.rows - 1) < rowBand[0] || row / Math.max(1, grid.rows - 1) > rowBand[1]) continue;
    for (let col = m; col < grid.cols - m; col++) {
      const t = col / span;
      const h = axialFromOffset(col, row);
      if (t >= lo && t <= hi && !outside.has(kOf(h))) out.push(h);
    }
  }
  // The fallback drops the MARGIN, never the shape: a band with no room left in
  // it is a tuning problem, and a site inside the rock would be a bug.
  return out.length ? out : gridHexes(grid.cols, grid.rows).filter((h) => !outside.has(kOf(h)));
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
export function pickHex(rng, cands, placed, wide, near = null) {
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
  // LAST RESORT, AND IT WAS A BARE `return pool[0]` — so on a crowded board it
  // handed back a hex another site was already on (~39 of 4,800 region-seeds,
  // in the dense tier-4/5 regions). `occupancy` is a `hexKey -> owner` map, so
  // one silently overwrote the other: the pathfinder walked through a building
  // and towers.js put two guns on one point. Separation is a preference and can
  // be given up; SHARING A HEX cannot, so the ladder bottoms out here instead.
  for (const h of pool) if (placed.every((p) => distance(p, h) > 0)) return h;
  for (const h of wide) if (placed.every((p) => distance(p, h) > 0)) return h;
  return pool[0];
}
