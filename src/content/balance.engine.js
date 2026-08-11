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
/**
 * `reachHexes` is what `site.adj` MEANS now — how far away a site still counts
 * as your business. It is not a movement limit: an army marches anywhere it can
 * find a path to. It bounds the candidate set the AI and the harness bot scan,
 * which the authored adjacency graph used to do as a side effect of existing.
 *
 * Sized against what it replaces, and MEASURED rather than guessed. The old
 * graph ran `targetAvgDegree` 2.8 on sites at least 3 hexes apart. Average
 * degree at each candidate radius, on real generated maps:
 *
 *     radius        3      4      5      6
 *     riverfen    3.3    4.7    7.1    8.5
 *     thanescar   5.0    8.3   11.2   14.9
 *     widowsgate  5.4    8.8   12.9   17.3
 *
 * 4 is a real widening — roughly triple the old degree, so the AI can finally
 * reach past the site immediately in front of it — while 5 and 6 make nearly
 * every site every other site's neighbour on the late maps, which turns the
 * per-site scan into an O(n^2) sweep whose answer is always "the castle".
 */
export const MOVEMENT = { hexSecondsPerSpeed: 38, minTicks: 1, reachHexes: 4 };

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
  holdBandFrac: 0.30,     // ...but its WALLS AND YARDS stay inside this one, so
                          //    the war machine is on the throne's doorstep and
                          //    the marches are farmland. See mapgen planSites.
  /** ...and a band is not enough on its own, because a band is a vertical STRIPE
   *  and a site at the top of it is nowhere near a castle at the bottom. Holds
   *  are additionally kept inside this fraction of the map's width, measured as
   *  a real hex radius around the throne. See mapgen `pickHex`. */
  holdRadiusFrac: 0.30,
  /** ...and the enemy's FARMS sweep from the edge of the hold band out to here,
   *  which is past `ownBandFrac` on purpose: the marches are farmland and they
   *  reach toward the middle of the map, so the countryside is what the player
   *  meets first and the war machine is what they meet last. */
  farmBandFrac: 0.58,
  neutralBand: [0.28, 0.72],
  blockedFrac: 0.11,      // share of hexes turned into impassable mountain
  blockedClusterMax: 3,
  highlandFortShare: 0.35, // ...of fortifications also get a range around them
  siteClearance: 1,       // no blocked hex within this radius of a site
  adjacency: { minDegree: 2, maxDegree: 4, targetAvgDegree: 2.8 },
  /**
   * How many of a faction's extra sites are HOLDS (walls + yards) rather than
   * farms. 0.34 for this project's whole life, and it had to grow the moment
   * `stronghold` stopped training: half of every faction's holds are now
   * buildings that produce nothing, so the same share bought half the army.
   *
   * Measured on the opening training throughput across all 24 regions, which is
   * what `tests/campaign.test.js` calls the raid claim — "the enemy out-produces
   * you" — and it is a claim the split quietly broke: at 0.34/0.50 saltmere
   * opened at 1.04x against a 1.05 floor, a raid on country you can out-build.
   *
   *     holds  forts   min      median
   *     0.34   0.50    1.04x     1.80x   <- the split, unpaid for
   *     0.34   0.34    1.04x     2.40x
   *     0.45   0.50    1.04x     2.40x
   *     0.45   0.34    1.06x     3.11x   <- shipped
   *     0.50   0.34    1.06x     3.60x
   *
   * The minimum is floored by the TIER-1 regions and cannot be bought here:
   * riverfen's enemy has four extra sites, so one hold is one yard whatever the
   * share is. That WAS the region table's problem: every shipped region now
   * authors its own enemy mix directly (`siteCounts.enemyMix`, regions.data.js
   * via regions.rowbuilder.js `T()`), so this share is a FALLBACK now — read by
   * battle/mapgen.js `planSites` only for a regionSpec with no mix to read (a
   * test fixture, an ad hoc tools/simrunner.js row). No shipped region touches
   * it any more, but plenty of specs built by hand still do.
   */
  enemyStrongholdShare: 0.45,
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
  /** A site's default build. `stronghold` is ABSENT and that is the rule, not an
   *  omission — it trains nothing now, and `trainableUnit` falls back to a
   *  buildable type for anything that has no entry here. */
  trainType: { camp: 'militia', castle: 'militia', trainingGround: 'spearmen', farm: 'militia' },
  /** How many of a faction's non-farm holdings are WALLS rather than YARDS. The
   *  rest are training grounds — a region is mostly farms either way, and this
   *  splits what used to be a single `stronghold` count in two. A THIRD, not a
   *  half: a wall produces nothing, so this is the number that decides how much
   *  of the enemy's country is army rather than architecture (see
   *  `enemyStrongholdShare` above for the measurement). `fortsAmong` in
   *  mapgen.js guarantees at least one yard whatever this rounds to.
   *
   *  STILL LOAD-BEARING FOR THE NEUTRAL POOL, which never got its own per-region
   *  column and still splits off this one share — and still the enemy
   *  fallback's own fort/yard split when a regionSpec has no authored mix. */
  fortShareOfHolds: 0.34,
  /** Starting garrisons before enemyMult. The player's camp is deliberately
   *  empty: the expedition deploys into it at tick 0.
   *
   *  THESE ARE THE LIVE NUMBERS. `PLAYER_SITE_GARRISON` and friends in
   *  content/regions.fallback.js are only read by meta/fallbackMap.js, which the
   *  real path never uses — a balance pass that edits those changes nothing.
   *
   *  Thinned along with EXPEDITION above: a foothold should be a foothold, not
   *  a second army. The player's outposts start held rather than garrisoned. */
  // watchtower is `{}` for all three: `mapgen.js planSites` never places one
  // (nobody starts with a watchtower, you build them — see BUILD_COSTS), so
  // this entry is never actually read on the generated path. It exists so
  // the per-kind tables have no hole for a kind that IS real mid-battle.
  garrison: {
    player: { camp: {}, farm: { militia: 3, spearmen: 1 },
              trainingGround: { militia: 3, spearmen: 1 },
              stronghold: { militia: 3, spearmen: 2 }, watchtower: {} },
    enemy: {
      castle: { militia: 4, spearmen: 3 },
      farm: { militia: 4 },
      trainingGround: { militia: 3, spearmen: 2 },
      stronghold: { militia: 3, spearmen: 3 },
      watchtower: {},
    },
    neutral: { farm: { militia: 3 }, trainingGround: { militia: 2, spearmen: 2 },
               stronghold: { militia: 2, spearmen: 3 }, watchtower: {} },
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
