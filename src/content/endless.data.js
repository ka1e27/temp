// THE FRONTIER — the endless mode, and the one place difficulty is SPATIAL.
//
// Every other mode escalates on a number the player does not choose: a region's
// tier, a rung's depth, a raid's clear count. The frontier escalates on
// DISTANCE FROM YOUR OWN CAMP, which means the player sets the difficulty by
// deciding how far to push, and the tension is the oldest one there is — one
// more site, or bank what you have?
//
// It is one enormous map rather than a sequence of battles. That is the whole
// difference from the incursion ladder: a rung is a fresh arena and a fresh
// landing force, so nothing you build carries; the frontier is continuous, so
// the yard you raised in ring 2 is still training for you in ring 6, and the
// distance a relief column has to walk is the real cost of overreaching.
//
// THERE IS STILL A CASTLE, at the far corner, and that is deliberate rather
// than a concession to `assertBattleConfig` (which does require one). A mode
// with no end at all is a treadmill; a summit nobody is expected to reach makes
// the same map a push-your-luck AND a thing a very good run can finish. It sits
// behind every ring, so reaching it is the achievement, not the plan.
//
// PURE DATA. Sizing here was measured rather than guessed — see FRONTIER.cols.

/**
 * Difficulty by ring, where a ring is `ringHexes` of hex distance from the
 * player's starting camp.
 *
 * The curve is per-ring MULTIPLICATIVE on the garrison and ADDITIVE on the
 * level, for the same reason the campaign keeps `enemyMult` and `develop`
 * orthogonal: bodies are produced during the battle and walls are not, so
 * scaling them together would make the deep rings unapproachable rather than
 * expensive. A ring-8 stronghold should be a real fight, not arithmetic.
 */
export const FRONTIER = Object.freeze({
  /**
   * THE MAP. 40x32 is 1280 hexes — 3.8x the biggest campaign board
   * (widowsgate, 21x16 = 336) with a 55-hex diagonal against its 28.
   *
   * THE SIZE IS SET BY THE RENDERER, NOT BY THE SIMULATION, and that was the
   * surprise. The sim does not care how big a board is: 336 to 5120 hexes at
   * similar site density measures 0.348 to 0.335 ms/tick, flat, because
   * influence, occupancy and vision are rebuilt on ownership change rather than
   * per tick. What costs is SITES (107 of them run 0.236 ms/tick and 278 run
   * 1.279), which is why the frontier is big and SPARSE — also exactly what
   * makes it feel like exploring rather than like a crowd.
   *
   * The wall is the BACKGROUND REPAINT, which walks every hex:
   *
   *   board      hexes   repaint   idle fps   at 4x
   *   60 x 48     2880     208ms      34.5     21.5
   *   44 x 34     1496      59ms      42.7     26.9
   *   40 x 32     1280      63ms      53.2     44.0   <- shipped
   *   36 x 28     1008      47ms      55.0     43.0
   *
   * With the sim PAUSED a 2880-hex board holds 60.1 fps, so the per-frame layer
   * is entirely fine at any of these — the cost is the repaint being asked for
   * again and again as columns move (render/bgcache.js explains the gate and why
   * it is now a duty cycle). THE UNLOCK FOR A BIGGER MAP IS CLIPPING THAT
   * REPAINT TO THE VIEWPORT: `computeOwners`, `computeVeil`, the flood, the
   * plates, the rock and the grid lines all walk the whole board regardless of
   * what the camera can see, which on a map meant to be explored zoomed in is
   * mostly wasted. Until that lands, this is the honest size.
   */
  cols: 40,
  rows: 32,

  /**
   * Hexes per difficulty ring, and it has to SPAN THE MAP.
   *
   * SPACING x `maxRing` MUST LAND ON THE DIAGONAL, and getting that wrong does
   * not fail, it flattens. On the 60x48 board this was first sized against, the
   * far corner is 83 hexes from the near one; at six hexes a ring the `maxRing`
   * clamp bit at 54 and the whole outer THIRD was one flat ring — measured, 34
   * of 104 sites landed in ring 9, and the harness "reached the deepest ring"
   * by walking two-thirds of the way out. The gradient stopped exactly where
   * the map got interesting.
   *
   * 40x32 is the board that shipped (chosen off an fps curve, not a design
   * argument — see `cols`), and its diagonal is 55 hexes: offset (39,31) is
   * axial {q:24, r:31}, which is 55 from the origin. 6 x 9 is 54, so the clamp
   * bites at the far corner itself and every ring in between is a real band.
   *
   * Re-derive both if the board size ever moves. The check is one line:
   * `distance({q:0,r:0}, axialFromOffset(cols - 1, rows - 1))` against
   * `ringHexes * maxRing`.
   */
  ringHexes: 6,
  /**
   * Rings past which nothing gets harder. Reaching this one means standing at
   * the far corner of the world; the plateau exists so the castle is a fight
   * rather than arithmetic, the same reason `SAFE_MAX_LEVEL` is a ceiling.
   *
   * It is INERT on the shipped board and that is what a safety clamp should be:
   * ring 9 is one corner hex and no site is ever placed there, so the deepest
   * site measured across seeds sits in ring 8. It exists so a future, bigger
   * board cannot silently produce a runaway garrison.
   */
  maxRing: 9,

  /**
   * Garrison multiplier per ring, compounding. 1.45^9 is ~30x at the summit.
   *
   * Started at 0.28 (9.2x) and that was measured as far too weak: the harness
   * bot, playing as a player eight regions into the campaign, held 157 of ~174
   * sites and had reached the outermost ring inside twenty minutes. A frontier
   * you can sweep is not a frontier.
   */
  garrisonPerRing: 0.45,
  /** Rings per extra site level, so ring 9 is +3 levels over your doorstep. */
  ringsPerLevel: 3,
  /** Ring at which the enemy's own roster stops widening — past this every
   *  garrison already fields everything, so a deeper ring is more of it. */
  fullRosterRing: 5,

  /** Sites on the board, by owner. Deliberately sparse: 107 total against
   *  widowsgate's 43 on 8.6x the ground, which is what keeps a march long
   *  enough to be a commitment. */
  sites: Object.freeze({ enemy: 46, neutral: 55, player: 3 }),
  /** Unclaimed sites pinned to the player's own corner, so the opening land
   *  grab exists on every seed rather than on the lucky ones — see
   *  battle/frontier.js `planFrontier` for why banding alone cannot do this. */
  nearNeutral: 9,
  /** The enemy's mix beyond its castle — walls, yards, farms. Weighted to
   *  farms because the frontier should mostly be COUNTRY, with the martial
   *  sites as the things you decide whether to take. */
  enemyMix: Object.freeze({ forts: 10, grounds: 12, farms: 23 }),

  /**
   * The cap. Long, because the mode is a session rather than a battle — but
   * finite, because an unbounded one would be the "a stalled board can eat 74%
   * of a sitting" complaint with no ceiling at all. Withdraw is the intended
   * exit and it banks everything taken.
   *
   * Started at 75 and cut on the same measurement that steepened the ramp: the
   * bot's depth stopped moving at minute ten or twenty on both seeds and it
   * then spent the remaining hour accumulating sites behind its own line. The
   * decision the mode is about — push on, or bank — happens early, and an hour
   * of mopping up after it is the dead-air complaint with a bigger board.
   */
  capMinutes: 30,
});

/**
 * WHAT A RUN PAYS.
 *
 * Crowns scale with the ring a site sits in, so the deep country is worth
 * pushing for and the doorstep is not farmable. Relics are paid ONLY for a new
 * personal best depth — non-farmable by construction, because a record can only
 * be broken by beating it, and that is the one property this project insists on
 * for the hard currency (a raid pays none for exactly this reason).
 */
export const FRONTIER_REWARD = Object.freeze({
  /** Crowns for a ring-0 site. Ring N is worth `base * (1 + N * perRing)`. */
  base: 40,
  perRing: 0.55,
  /** Relics per ring of a NEW record. Beating your best by three rings pays
   *  three; matching it pays nothing. */
  relicsPerRing: 1,
  /** ...and never more than this from one run, however far a lucky map lets
   *  someone jump. A record is meant to be a ladder, not a jackpot. */
  relicsPerRunMax: 6,
  /** Losing your camp costs the haul. The run is push-your-luck or it is
   *  nothing, and a consolation payout is what would make banking pointless. */
  keepOnLoss: 0,
});

/** The id `REGION_BY_ID` resolves for a frontier battle. Deliberately not in
 *  `REGIONS`: the campaign array is what every world-map screen, every
 *  non-decreasing invariant and every balance sweep iterates, and the frontier
 *  belongs in none of them. */
export const FRONTIER_ID = 'frontier';

/**
 * The region-shaped inputs a frontier battle is generated from.
 *
 * `enemyMult` and `develop` here are the BASELINE — what a ring-0 site is worth
 * — and `battle/frontier.js scaleFrontier` is what makes the deep country hard.
 * They are held low deliberately: a run should open at about a tier-1
 * difficulty on your own doorstep however far the map goes, or the mode becomes
 * a wall rather than a walk.
 */
export function frontierRegion() {
  return Object.freeze({
    id: FRONTIER_ID,
    name: 'The Frontier',
    tier: 1,
    hex: [0, 0],
    adjacentTo: [],
    enemyMult: 2.0,
    develop: 1.3,
    // `grid` is the shape `meta/fallbackMap.js callMapGen` destructures, and
    // `cols`/`rows` are what `generateBattleMap` reads off the spec — a real
    // region row carries both, so this one does too.
    grid: Object.freeze({ cols: FRONTIER.cols, rows: FRONTIER.rows }),
    cols: FRONTIER.cols,
    rows: FRONTIER.rows,
    // Read by `totalSites` and the results screen. The mix is what
    // `planFrontier` actually uses; these keep every existing plain-number
    // reader working.
    siteCounts: Object.freeze({
      enemy: FRONTIER.sites.enemy,
      neutral: FRONTIER.sites.neutral,
      player: FRONTIER.sites.player,
      enemyMix: FRONTIER.enemyMix,
    }),
    frontierSites: FRONTIER.sites,
    frontierMix: FRONTIER.enemyMix,
    /*
     * THE GATE IS THE WIN CONDITION HERE, ON PURPOSE — and this is the exact
     * inversion of the campaign's own gate finding, which is why it is spelled
     * out rather than left as a number.
     *
     * `GATE_CLAMP` caps every campaign region at 0.60 because a high gate made
     * the throne a formality and the battle a scrape for the last few percent
     * of countryside. That is a defect when a region PROMISES a fight at a
     * castle. The frontier promises the opposite: there is no end to it but the
     * one you choose, so a throne that can be rushed is the thing that breaks
     * it.
     *
     * This shipped at 0 and the measurement is what caught it. The comment here
     * used to claim the castle sat "at ring 9 behind the whole map", which was
     * reasoned and false: measured on seed 1000 the throne lands at ring 7 of a
     * board whose deepest ring is 8, and a player with the whole campaign behind
     * them took it in 9,658-11,357 ticks — two runs of three WON the endless
     * mode in about sixteen minutes. An infinite map that ends is not one.
     *
     * At 0.85 the throne opens only once the frontier is essentially conquered,
     * which is a real ending rather than a shortcut past one, and every other
     * run finishes the way the mode intends: on the clock, or when the player
     * banks what they hold.
     */
    castleGateFrac: 0.85,
    rewardPerSec: 0,
    targetLengthMin: FRONTIER.capMinutes / 2,
    hardCapMs: FRONTIER.capMinutes * 60 * 1000,
    shape: 'open',
    flavour: 'Country nobody has mapped. It gets worse the further you walk.',
    startsUnlocked: false,
  });
}

/**
 * WHEN THE FRONTIER OPENS.
 *
 * Not at the end of the campaign — the incursion ladder and abdication are
 * already there, and a third thing behind the same wall is a third thing most
 * players never see. It opens after the first tier, which is the earliest point
 * the player has an expedition worth marching with: measured, a fresh save
 * lands NINE bodies on the frontier and four regions in it lands about fifty.
 *
 * The point of opening it early is that it is an ALTERNATIVE to grinding the
 * next campaign region, not a reward for having finished grinding them.
 */
export const FRONTIER_UNLOCK_REGIONS = 4;

export const frontierOpen = (conquered) => (conquered ?? 0) >= FRONTIER_UNLOCK_REGIONS;
