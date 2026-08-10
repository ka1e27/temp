// Battle-engine tuning: shape and pacing knobs, split out of balance.js when
// that file hit the 400-line cap. Re-exported from balance.js, so no importer
// has to know this file exists — same arrangement as ai.data.js.
//
// Everything here is SHAPE. Power lives in balance.js (units, sites, boosters)
// and in regions.data.js (the per-region dials). Nothing in this file reads
// anything from either, which is what made it a clean cut.

/** Squad travel. secondsPerHex = hexSecondsPerSpeed / slowestUnitSpeed, so a
 *  militia (55) crosses a hex in ~1.1s and a ram (30) in 2.0s — one ram really
 *  does halve a stack's march, which is what telegraphs a siege push. */
export const MOVEMENT = { hexSecondsPerSpeed: 38, minTicks: 1 };

/** Territory flood. Strength falls off linearly with distance from the site;
 *  two factions within `contestRatio` of each other paint a hatched band. */
export const INFLUENCE = { contestRatio: 0.15, levelBonus: 0.25 };

/** Map generation. Shape only — power lives in `garrison` below and is scaled
 *  by the region's enemyMult. */
export const MAPGEN = {
  minSeparation: 3,       // hexes between any two sites...
  minSeparationFloor: 2,  // ...relaxed to this so placement always terminates
  edgeMargin: 1,          // keep sites off the outer ring
  homeBandFrac: 0.25,     // camp/castle sit inside this fraction of their edge
  ownBandFrac: 0.42,      // a faction's other sites stay inside this fraction
  neutralBand: [0.28, 0.72],
  blockedFrac: 0.11,      // share of hexes turned into impassable mountain
  blockedClusterMax: 3,
  highlandFortShare: 0.35, // ...of fortifications also get a range around them
  siteClearance: 1,       // no blocked hex within this radius of a site
  adjacency: { minDegree: 2, maxDegree: 4, targetAvgDegree: 2.8 },
  enemyStrongholdShare: 0.34,
  neutralStrongholdShare: 0.25,
  playerStrongholdEvery: 2,
  neutralScaleShare: 0.5, // neutrals feel enemyMult at half strength
  /**
   * THE THRONE IS THE WIN CONDITION, so it is the one site that has to be a
   * wall and not a speed bump. Its garrison scales with the region's `develop`
   * on top of the dial, so a late castle is a capital with an army in it rather
   * than the same seven-man outpost every other region ships.
   *
   * This is a LENGTH knob and it was measured as one. `victory: capture-castle`
   * means a battle ends the moment the throne falls, and a level-1 castle held
   * by 15 troops falls to the first stack that reaches it — which is why tier-3
   * and tier-4 battles resolved in five to seven minutes against advertised
   * lengths of seventeen to twenty-three, however the rest of the region was
   * tuned. Making the last fight the longest one is the only place the time can
   * honestly come from. develop is exactly 1 through regions 1-5, so this term
   * is exactly 1.0 there and the frozen opening does not move.
   */
  throneGarrisonPerDevelop: 1.80,
  trainType: { camp: 'militia', castle: 'militia', stronghold: 'spearmen', farm: 'militia' },
  /** Starting garrisons before enemyMult. The player's camp is deliberately
   *  empty: the expedition deploys into it at tick 0.
   *
   *  THESE ARE THE LIVE NUMBERS. `PLAYER_SITE_GARRISON` and friends in
   *  content/regions.rules.js are only read by meta/fallbackMap.js, which the
   *  real path never uses — a balance pass that edits those changes nothing.
   *
   *  Thinned along with EXPEDITION above: a foothold should be a foothold, not
   *  a second army. The player's outposts start held rather than garrisoned. */
  garrison: {
    player: { camp: {}, farm: { militia: 3, spearmen: 1 },
              stronghold: { militia: 3, spearmen: 2 } },
    enemy: {
      castle: { militia: 4, spearmen: 3 },
      farm: { militia: 4 },
      stronghold: { militia: 3, spearmen: 3 },
    },
    neutral: { farm: { militia: 3 }, stronghold: { militia: 2, spearmen: 3 } },
  },
};

/**
 * RIVERS. Carved before the mountains are scattered, on their own derived RNG
 * stream, so a river hex is never also a blocked hex — rivers are PASSABLE and
 * a watercourse that vanished under a peak would be a lie.
 *
 * `meander`/`turn` are the whole reason this reads as a river rather than as
 * blue confetti: a step either carries on downstream or slides sideways, and
 * the sideways direction persists until it flips. Straight runs with occasional
 * long lateral reaches is what a watercourse looks like from above.
 */
export const RIVERS = {
  hexesPerRiver: 120,  // one watercourse per this much grid area...
  minCount: 1,         // ...clamped, so a small map still has one and a huge
  maxCount: 4,         //    one never turns into a marsh
  meander: 0.34,       // chance a step goes sideways instead of onward
  turn: 0.30,          // chance the sideways drift reverses
  minLength: 4,        // shorter than this and it is a puddle: re-rolled
};

/**
 * What the ground DOES.
 *
 * Mountains already existed as pathing obstacles and nothing else. A site does
 * not sit ON one (mapgen keeps `siteClearance` hexes clear around every site),
 * so "in the mountains" means RINGED BY them: how many blocked hexes lie within
 * `mountainRadius`, normalised by `mountainFull`.
 *
 * `highlandDef` is deliberately MULTIPLICATIVE on the site's own defMult, which
 * is what answers "give advantage to forts in mountains" without a special case
 * for forts: a castle at 1.60 gains +0.32 of defence from full highland, a farm
 * at 1.00 gains +0.20. The fort is the thing the terrain rewards, because a
 * fort is what was already worth defending.
 *
 * `riverDefMult` is the mirror, and it is what stops the whole terrain layer
 * from being a tax. Water is the one thing you cannot dig a dry ditch through:
 * a site on a watercourse defends at 0.85. So the map now reads in two
 * directions rather than one —
 *
 *     a mountain fort   POOR and HARD    (no river gold, x1.20 defence)
 *     a river farm      RICH and SOFT    (x1.35 gold, x0.85 defence)
 *
 * — which is a decision about where to attack, not a difficulty dial. Measured:
 * with highland alone the terrain layer cost kaldan 6 points of win rate and
 * 1.7 minutes on the harness, because ~40% of forts got tougher and nothing
 * anywhere got easier.
 */
export const TERRAIN = {
  mountainRadius: 2,    // how far a site feels the peaks around it
  mountainFull: 4,      // blocked hexes inside that radius for FULL highland
  highlandDef: 0.20,    // x(1 + this) on siteDefMult at full highland
  riverRadius: 1,       // "on the river": the site hex or one of its neighbours
  riverDefMult: 0.85,   // soft ground: walls on a watercourse hold less well
  riverFarmGold: 1.35,  // ...and the farm behind them is worth this much more
};
