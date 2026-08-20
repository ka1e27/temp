// THE FRONTIER MAP — one enormous board whose difficulty rises with distance
// from the player's own camp.
//
// This is a SECOND PLANNER, not a second generator. `mapgen.js
// generateBattleMap` consumes a plan (`{owner, kind, band, rowBand, near}`
// entries) that `mapgen.place.js planSites` produces for the campaign, and that
// planner is shaped entirely around a throne: the camp corners one edge, the
// walls ring the castle at the other, the farms sweep out from the walls. It is
// the right shape for "raid the country somebody else holds" and the wrong one
// for "walk out into country nobody has mapped".
//
// So `planFrontier` is the other shape — sites spread across the WHOLE board
// rather than banded toward one end — and everything downstream of the plan
// (terrain, rivers, massifs, connectivity repair, the shape mask) is reused
// untouched. `generateBattleMap` gained exactly one line for this: it takes
// `spec.plan` when one is supplied.
//
// THE DIFFICULTY IS A POST-PROCESS, and that is what keeps it honest. The
// generator places sites without knowing anything about rings; `scaleFrontier`
// then walks the finished list and strengthens each one by how far it sits from
// the camp. Two consequences worth having: the terrain and the placement are
// byte-identical to what the campaign generator would produce for the same
// spec, so nothing about rings can affect where a mountain lands; and the ring
// rule is one readable function over a site list rather than a condition
// threaded through placement.
// PURE.
import { UNIT_IDS } from '../content/balance.js';
import { SITE_LEVELS, SITES, MAPGEN } from '../content/balance.js';
import { FRONTIER } from '../content/endless.data.js';
import { distance } from '../core/hex.js';
import { generateBattleMap } from './mapgen.js';

/**
 * How far out a hex sits, in rings, from the near corner of the map.
 *
 * MEASURED FROM THE CORNER RATHER THAN FROM THE CAMP, and that is not a
 * shortcut — it is what makes the ring DERIVABLE instead of stored. The first
 * cut wrote `site.ring` at generation time and it was silently dropped:
 * `createBattleState` rebuilds every site from a fixed field list, so `ring`
 * never reached the simulation and every run scored "deepest ring 0" while the
 * garrisons it had scaled were plainly working. A field that looks meaningful
 * and vanishes at the seam is this project's most-repeated defect.
 *
 * Deriving it needs an origin that survives, and the camp does not: it can be
 * LOST, and its starting hex is not recorded anywhere. The map's near corner is
 * fixed for the life of the board, needs no state and no contract field, and
 * the camp is placed within the corner band — so "rings from the corner" and
 * "rings from your camp" differ by at most one, while generation and scoring
 * agree EXACTLY because both call this.
 *
 * Clamped at `maxRing` so the deep country plateaus rather than curving away
 * forever: an unbounded ramp would make the castle arithmetic rather than a
 * fight, which is the same reason `SAFE_MAX_LEVEL` exists on the shop ladder.
 */
export function ringOf(hex) {
  const d = distance({ q: hex[0], r: hex[1] }, { q: 0, r: 0 });
  return Math.max(0, Math.min(FRONTIER.maxRing, Math.floor(d / FRONTIER.ringHexes)));
}

/**
 * A site the player RAISED rather than took. `battle/construct.js nextBuildId`
 * prefixes every one with `b`, and mapgen's own ids never start with it.
 */
export const wasBuilt = (site) => typeof site.id === 'string' && site.id[0] === 'b';

/**
 * The deepest ring `faction` finished holding — the run's score, derived from
 * where its sites are rather than from anything written down.
 *
 * BUILT SITES DO NOT COUNT, and that is a rule about what the record MEANS
 * rather than a nicety. Measured on the first cut: the harness bot reached ring
 * 8 by minute ten and ring 9 by minute twenty, not by fighting its way out but
 * by laying a chain of 200-gold farms toward the throne — `simbuild.js` scores
 * a build site by its distance to the castle, so the cheapest thing in the game
 * was also the fastest way to claim the deepest ring. A record you can buy for
 * 200 gold is not a record.
 *
 * Crowns still pay on built sites (see meta/endless.js): holding forward ground
 * is worth something, it is simply not what "how far did you get" means.
 */
export function deepestRing(state, faction = 'player') {
  let best = 0;
  for (const s of state.sites) {
    if (s.owner !== faction || wasBuilt(s)) continue;
    const r = ringOf(s.hex);
    if (r > best) best = r;
  }
  return best;
}

/** Every ring the faction holds a site in, one entry per site — what
 *  `meta/endless.js frontierReward` weights the payout by. */
export function heldRings(state, faction = 'player') {
  const out = [];
  for (const s of state.sites) if (s.owner === faction) out.push(ringOf(s.hex));
  return out;
}

/**
 * THE PLAN: a camp in one corner, a castle in the far one, and everything else
 * spread over the whole board.
 *
 * `band` is the fraction of the map's WIDTH a site may land in and `rowBand`
 * the same on the row axis — `mapgen.place.js bandCandidates` reads both. The
 * campaign uses narrow bands to build its ring of war; the frontier uses the
 * full span for everything except the two seats, because a map you explore
 * should have something to find in every direction rather than a populated end
 * and an empty one.
 *
 * The kinds are INTERLEAVED rather than grouped (`i % 3`), which matters
 * because `bandCandidates` is consumed in plan order: a grouped plan would put
 * every wall in whatever hexes happened to be picked first and leave the farms
 * with the leftovers, and the two would end up spatially sorted for no reason
 * the player could see.
 */
export function planFrontier(spec = {}) {
  const counts = spec.frontierSites ?? FRONTIER.sites;
  const mix = spec.frontierMix ?? FRONTIER.enemyMix;
  // The player's corner, and the enemy's opposite one. `edgeFrac` is small so
  // both seats are genuinely cornered rather than merely near an edge.
  const edge = 0.18;
  const plan = [
    { owner: 'player', kind: 'camp', band: [0, edge], rowBand: [0, edge] },
    { owner: 'enemy', kind: 'castle', band: [1 - edge, 1], rowBand: [1 - edge, 1] },
  ];
  // The player's own opening sites stay ON the doorstep — this is a beachhead
  // like every other mode's, not a head start across the map.
  for (let i = 1; i < Math.max(1, counts.player); i++) {
    plan.push({
      owner: 'player', kind: i % MAPGEN.playerStrongholdEvery === 0 ? 'trainingGround' : 'farm',
      band: [0, edge * 1.6], rowBand: [0, edge * 1.6],
    });
  }
  const enemyExtra = Math.max(0, counts.enemy - 1);
  const kinds = [];
  for (let i = 0; i < mix.forts; i++) kinds.push('stronghold');
  for (let i = 0; i < mix.grounds; i++) kinds.push('trainingGround');
  for (let i = 0; i < enemyExtra - mix.forts - mix.grounds; i++) kinds.push('farm');
  for (let i = 0; i < kinds.length; i++) {
    // Interleaved: stride through the list rather than walking it in order.
    const k = kinds[(i * 7) % kinds.length];
    plan.push({ owner: 'enemy', kind: k, band: [edge, 1], rowBand: [0, 1] });
  }
  // A GUARANTEED OPENING. `band` is a COLUMN fraction and a ring is a DISTANCE,
  // so banding alone does not control how much sits near the camp: a site at
  // mid-column can be ring 3 or ring 7 depending on its row. Measured across
  // seeds, that left some maps with five sites inside ring 2 and others with
  // twenty — an opening that depends on the roll rather than on the design.
  //
  // So the first `nearNeutral` unclaimed sites are banded tight to the player's
  // corner on BOTH axes, which does pin them to the low rings, and the rest are
  // spread. Unclaimed rather than enemy on purpose: the first few minutes
  // should be a land grab you can win, not a wall you cannot.
  const near = Math.min(counts.neutral, FRONTIER.nearNeutral ?? 8);
  for (let i = 0; i < counts.neutral; i++) {
    const kind = i % 9 === 0 ? 'stronghold' : i % 3 === 0 ? 'trainingGround' : 'farm';
    plan.push(i < near
      ? { owner: 'neutral', kind: i % 4 === 0 ? 'trainingGround' : 'farm',
        band: [edge * 0.5, edge * 3.2], rowBand: [0, edge * 3.2] }
      : { owner: 'neutral', kind, band: [edge * 0.8, 1], rowBand: [0, 1] });
  }
  return plan;
}

/**
 * STRENGTHEN EVERY SITE BY HOW FAR OUT IT IS. Mutates the list it is given,
 * which is the freshly-generated one and nobody else's.
 *
 * Garrison compounds and level steps, kept orthogonal for the reason the
 * campaign keeps `enemyMult` and `develop` apart: bodies are produced during
 * the battle and walls are not, so scaling both on one curve would make the
 * deep rings unapproachable rather than expensive.
 *
 * THE PLAYER'S OWN SITES ARE NEVER TOUCHED, and neither is ring 0 — your
 * doorstep is the baseline the rest is measured against, so a frontier run
 * opens at roughly a tier-1 difficulty however deep the map goes.
 */
export function scaleFrontier(sites) {
  for (const s of sites) {
    if (s.owner === 'player') continue;
    // NOT written to the site. `createBattleState` rebuilds sites from a fixed
    // field list, so anything stored here is dropped before the simulation ever
    // sees it — `ringOf` is called again wherever the ring is needed.
    const ring = ringOf(s.hex);
    if (ring <= 0) continue;
    const mult = (1 + FRONTIER.garrisonPerRing) ** ring;
    const g = {};
    for (const u of UNIT_IDS) {
      const n = s.garrison[u] || 0;
      if (n > 0) g[u] = Math.max(1, Math.round(n * mult));
    }
    s.garrison = g;
    const up = Math.floor(ring / FRONTIER.ringsPerLevel);
    if (up > 0) {
      const level = Math.max(1, Math.min(SITE_LEVELS.length, (s.level ?? 1) + up));
      const lv = SITE_LEVELS[level - 1];
      s.level = level;
      // HP is re-derived from the new level rather than scaled from the old
      // one, so a promoted site is exactly a site of that level — the same
      // rule `cmdUpgrade` follows, and the reason a renderer can read `level`
      // and be right about the wall it draws.
      s.hpMax = Math.round(SITES[s.kind].hp * lv.hp);
      s.hp = s.hpMax;
      s.hpRegen = SITES[s.kind].hpRegen * lv.regen;
    }
  }
  return sites;
}

/**
 * The whole frontier map, as a drop-in for `generateBattleMap` — same
 * `(regionSpec, seed)` signature, same `{grid, sites, adjacency}` back — so
 * `meta/modifiers.js buildBattleConfig` takes it by injection exactly the way
 * it already takes the campaign generator, and nothing in the meta layer has to
 * learn that a second kind of map exists.
 */
export function generateFrontierMap(regionSpec, seed) {
  const spec = { ...regionSpec, plan: planFrontier(regionSpec) };
  const map = generateBattleMap(spec, seed);
  scaleFrontier(map.sites);
  return map;
}
