// ALL tuning constants. No engineer hardcodes a number anywhere else, so a
// balance pass is a single-file diff.
// PURE DATA.

export const UNIT_IDS = ['militia', 'spearmen', 'raiders', 'rams', 'marshal'];

/**
 * Every unit costs 3.0-4.5 gold/sec to run (gold / trainSec), so switching what
 * a stronghold trains changes WHAT ROLE you buy per second, never HOW MUCH you
 * spend. Players experiment with counters freely.
 *
 * Balance anchor: militia attacking a spearwall (0.583 offense/gold) exactly
 * cancels spears defending (0.583 defense/gold). Every other matchup is a
 * deliberate deviation from that.
 */
export const UNITS = {
  militia:  { gold: 12,  trainSec: 8,  batch: 2, speed: 55,  atk: 4,  def: 3,  siege: 0.6,
              counters: { spearmen: 0.75 } },
  spearmen: { gold: 24,  trainSec: 8,  batch: 1, speed: 45,  atk: 5,  def: 8,  siege: 0.4,
              counters: { raiders: 0.75 }, bulwark: 1.75,
              ground: { highland: 1.20, river: 0.85 } },
  raiders:  { gold: 45,  trainSec: 12, batch: 1, speed: 105, atk: 13, def: 4,  siege: 0.8,
              counters: { militia: 0.60, rams: 1.0 }, skirmish: 0.5,
              ground: { highland: 0.70, river: 1.20 } },
  rams:     { gold: 80,  trainSec: 20, batch: 1, speed: 30,  atk: 6,  def: 2,  siege: 12,
              counters: { spearmen: 2.6 }, base: 0.4,
              ground: { highland: 0.65, river: 0.75 } },
  // banner 0.20 -> 0.25 and trainBuff 0.30 -> 0.40. He is no longer bought with
  // expedition slots (one rides free with the unlock, see meta/composition.js
  // `maxOf`), so his numbers no longer have to justify costing eight militia —
  // they only have to be worth the 4,000-crown unlock and the 250 gold a second
  // one costs to commission.
  marshal:  { gold: 180, trainSec: 40, batch: 1, speed: 60,  atk: 20, def: 14, siege: 2.0,
              counters: {}, banner: 0.25, trainBuff: 0.40, maxPerSite: 1 },
};

/**
 * TERRAIN, per unit — the `ground` block above.
 *
 * A single "terrain multiplier" would just be a second difficulty dial: every
 * army scales the same way and nothing about the ground changes what you BRING.
 * So the multiplier is per unit type, and it lands on both the field battle
 * (combat.js `power`) and on siege damage (combat.js `siegeDps`), which is what
 * makes the same hillside read differently depending on who is walking up it:
 *
 *   spearmen  x1.30 highland / x0.85 river   a spearwall holds a pass; it
 *                                            cannot keep formation in a ford
 *   raiders   x0.70 highland / x1.20 river   no room to ride in broken ground,
 *                                            but they cross water at will
 *   rams      x0.55 highland / x0.75 river   you cannot drag a siege engine up
 *                                            a mountain, or through mud
 *   militia   —  no entry, so exactly 1.0 everywhere. Deliberate: militia is
 *                                            the unit that never cares, which
 *                                            is what makes it the safe answer
 *                                            when you cannot read the map.
 *   marshal   —  a banner is a banner on any ground.
 *
 * Highland is GRADED (see TERRAIN.mountainFull), so the multiplier is
 * interpolated toward 1.0 on merely hilly ground; a river is binary.
 */

/**
 * What one of each unit costs against the EXPEDITION budget.
 *
 * Without this every unit costs one seat and the optimal loadout is trivially
 * "as many marshals/raiders as the roster allows" — there is no decision.
 *
 * The anchor is the gold price above, because gold is already this game's own
 * statement of what a unit is worth (every unit runs at 3.0-4.5 gold/sec, so a
 * gold ratio IS a value ratio). Raw gold ratios are 1 / 2 / 3.75 / 6.67 / 15,
 * which prices a marshal above an entire starting expedition — unbuyable, not a
 * choice. So the curve is compressed by roughly gold^0.83:
 *
 *     militia 1   spearmen 2   raiders 3   rams 5   marshal 8
 *
 * Read as gold-per-slot that is 12 / 12 / 15 / 16 / 22.5: militia and spearmen
 * are priced exactly at their gold value, and the three unlockables carry a
 * deliberate discount so a specialist is affordable rather than theoretical.
 * The marshal's +20% banner pays for its 8 slots at roughly 18 slots of army
 * and up, which is where a player who has bought a 4000-crown unlock already is.
 *
 * The scale is anchored on militia = 1 on purpose: a leftover slot always buys
 * exactly one militia, so a budget is always spendable to the last slot and a
 * budget INCREASE always has somewhere to go.
 */
export const UNIT_SLOTS = {
  militia: 1, spearmen: 2, raiders: 3, rams: 5, marshal: 8,
};

/** Structure HP + regen is the master pacing knob: it sets BOTH battle length
 *  and the minimum-force threshold. A force whose siege DPS is below `hpRegen`
 *  can never breach, which is what stops a handful of troops taking a
 *  stronghold — without an arbitrary "minimum N troops" rule. */
export const SITES = {
  farm:       { gold: 2.0, train: 0,    cap: 30, hp: 100, hpRegen: 2.0, defMult: 1.00 },
  stronghold: { gold: 0,   train: 1.00, cap: 45, hp: 250, hpRegen: 4.0, defMult: 1.25 },
  camp:       { gold: 4.0, train: 1.25, cap: 80, hp: 480, hpRegen: 5.0, defMult: 1.40 },
  castle:     { gold: 4.0, train: 1.25, cap: 80, hp: 480, hpRegen: 5.0, defMult: 1.60 },
};

/**
 * Per-level multipliers for in-battle site upgrades (index 0 = level 1).
 *
 * THESE TWO ARRAYS ARE THE ONLY STATEMENT OF HOW LONG THE LADDER IS. Nothing
 * anywhere may write 3, 5, or any other count: `SITE_LEVELS.length` is the
 * number of levels and `SITE_UPGRADE.length` is always exactly one less, because
 * every drawable step has to be a purchasable one. The renderer derives its
 * whole size ramp from the first (render/siteShapes.js `MAX_LEVEL`), the sim
 * derives HP, regen, gold, training and garrison cap from it, and
 * meta/fallbackMap.js clamps against it.
 *
 * Extended 3 -> 5. Three levels ran out: a stronghold you had held for eight
 * minutes was finished being interesting after 550 gold, and there was nothing
 * left to spend a captured farm belt's income on. HP and regen keep compounding
 * at x1.4 a level, which is what makes a fully built site a genuine fortress —
 * a level-5 stronghold repairs 15.4 HP/s, so it takes a real siege train and
 * not a squad of militia to crack.
 */
export const SITE_LEVELS = [
  { gold: 1.00, train: 1.00, cap: 0,  hp: 1.0,   regen: 1.0 },
  { gold: 1.75, train: 1.35, cap: 20, hp: 1.4,   regen: 1.4 },
  { gold: 2.75, train: 1.75, cap: 40, hp: 1.96,  regen: 1.96 },
  { gold: 3.99, train: 2.19, cap: 60, hp: 2.744, regen: 2.744 },
  { gold: 5.39, train: 2.63, cap: 80, hp: 3.842, regen: 3.842 },
];
/** Gold and build time per step. One entry per step, so exactly
 *  SITE_LEVELS.length - 1 of them. The curve stays steep on purpose: an upgrade
 *  competes with training, and it should never be the automatic answer. */
export const SITE_UPGRADE = [
  { gold: 150,  sec: 20 }, // L1 -> L2
  { gold: 400,  sec: 35 }, // L2 -> L3
  { gold: 950,  sec: 50 }, // L3 -> L4
  { gold: 2200, sec: 65 }, // L4 -> L5
];

/**
 * COMMISSIONING, as opposed to training.
 *
 * A marshal is one body per site and takes 40 seconds — by far the slowest thing
 * in the game — so producing one meant retasking a whole stronghold, waiting,
 * and remembering to set it back. That is why a 4,000-crown unlock went unused.
 *
 * A commission skips the queue entirely: pay, and he rides in. The price carries
 * the difference. 250 against a 180 training cost is the 40 seconds of a
 * stronghold's output you did NOT spend, which at a level-1 site is roughly six
 * militia — so commissioning is the convenient answer and training is still the
 * cheap one. `maxPerSite` is unchanged and still binds.
 */
export const RECRUIT = {
  marshal: { gold: 250 },
};

/** Territory influence radius by site kind, and the movement effect. */
export const INFLUENCE_RADIUS = { farm: 1, stronghold: 2, camp: 3, castle: 3 };
export const TERRITORY_SPEED = { friendly: 1.4, neutral: 1.0, hostile: 0.75 };

/** The enemy commander's numbers live in ./ai.data.js and are re-exported here,
 *  so `import { AI, AI_TIERS } from '../content/balance.js'` keeps working and
 *  balance.js keeps its promise of being the one front door for tuning. */
export { AI_TIERS, AI } from './ai.data.js';

/** Anti-stalemate ladder, keyed off seconds since the last OWNERSHIP CHANGE —
 *  besieging a wall you cannot breach does not reset the clock. */
export const ATTRITION = [
  { afterSec: 150, farmMult: 0.75, regenMult: 1.0,  garrisonBleed: 0,
    trainMult: 1, trainCostMult: 1 },
  { afterSec: 210, farmMult: 0.75, regenMult: 0.5,  garrisonBleed: 1,
    trainMult: 1, trainCostMult: 1 },
  { afterSec: 270, farmMult: 0.50, regenMult: 0.0,  garrisonBleed: 1,
    trainMult: 2, trainCostMult: 2 },
];
/** Oversized garrisons bleed every this many seconds from stage 2 onward. */
export const ATTRITION_BLEED_SEC = 5;
/** The ladder is only re-evaluated every N ticks; it moves on a 30s scale. */
export const ATTRITION_CHECK_TICKS = 10;

export const BOOSTERS = {
  rally:    { charges: 2, cooldownSec: 75,  radius: 2, fraction: 0.5 },
  march:    { charges: 3, cooldownSec: 40,  factor: 0.5 },
  bombard:  { charges: 1, cooldownSec: 120, garrisonFrac: 0.25, hp: 60 },
  fortify:  { charges: 2, cooldownSec: 60,  hp: 100, regenMult: 2, attackerMult: 0.5, sec: 20 },
  tithe:    { charges: 2, cooldownSec: 90,  gold: 250, trainMult: 1.5, sec: 15 },
};

/**
 * Expedition budget, in SLOTS (see UNIT_SLOTS), not bodies:
 *     base + perRegion * regionsConquered + 4 per Standing Army level,
 *     tapering to `perRegionLate` past `taperAfter` conquests.
 *
 * `perRegion` is well above the naive x1.36 for two reasons only a run of
 * tools/simrunner.js shows: Standing Army's flat +4 is +4 SLOTS rather than +4
 * bodies, and the late slice unlocks raiders at three slots each. It has been
 * re-tuned on the harness twice — once to pay for the terrain layer (mountains
 * and rivers cost Kaldan ~5 points and 2.4 minutes at n=480, and this is the
 * right knob for it because it scales with conquests, so the tier-1 opener pays
 * nothing), and once by the re-base below.
 *
 * RE-BASED SO THE EMPIRE, NOT THE HANDOUT, IS WHAT YOU LAND WITH: base 19 -> 12
 * and perRegion 12 -> 10. A raid is supposed to be uphill, and at 19 base slots
 * the opening force simply rolled the first regions rather than having to build
 * into them. The end-to-start ratio went from 7.6x to 9.75x — more of your
 * landing force is something you went and got. It pairs with a WARM-UP on the
 * enemy (content/ai.data.js `AI.warmup`): landing smaller against an opponent
 * that presses from tick 0 is not a harder fight, it is a shorter one.
 *
 * THE TAPER PAST `taperAfter` IS A PACING KNOB, NOT A NERF. Regions 1-5 are
 * attacked with 0-4 conquests, so the frozen opening is untouched by
 * construction. What it fixes is a shape problem: victory is CAPTURE-CASTLE, so
 * a landing force that grows faster than the map eventually lands with enough
 * army to one-shot every site on the road to the throne, and late battles get
 * SHORTER the further you get. Adding sites does not fix it, because sites off
 * that road are never fought over — obsidian at 26 enemy sites on a 21x15 grid
 * still resolved in 6.6m.
 */
export const EXPEDITION = {
  base: 12, perRegion: 10, taperAfter: 4, perRegionLate: 11, surgeAfter: 8, perRegionSurge: 23,
};

/**
 * A rallied site forwards its garrison once it can do so and still keep this
 * many troops at home. The default is the old global; it is now a PER-SITE
 * setting, because the right answer differs by role — a back-line farm should
 * keep almost nothing, a front stronghold feeding a siege has to hold enough
 * to survive the counter-attack that follows.
 */
export const RALLY_MIN_GARRISON = 8;
export const RALLY_KEEP = { min: 0, max: 40, step: 2, default: RALLY_MIN_GARRISON };
export const SEND_FRACTIONS = [0.25, 0.5, 0.75, 1.0];
export const CENTIGOLD = 100;

// --------------------------------------------------------------------------
// Battle-engine tuning. Shape and pacing knobs, added by the battle engine so
// that no simulation file hardcodes a number.
// --------------------------------------------------------------------------

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
