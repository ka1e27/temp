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
  marshal:  { gold: 180, trainSec: 40, batch: 1, speed: 60,  atk: 20, def: 14, siege: 2.0,
              counters: {}, banner: 0.20, trainBuff: 0.30, maxPerSite: 1 },
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

/** Territory influence radius by site kind, and the movement effect. */
export const INFLUENCE_RADIUS = { farm: 1, stronghold: 2, camp: 3, castle: 3 };
export const TERRITORY_SPEED = { friendly: 1.4, neutral: 1.0, hostile: 0.75 };

/**
 * `staging: boolean` became two numbers, `stagingRatio` and `stagingKeep`.
 *
 * The old boolean was the single biggest exploit in the game. Tiers 1 and 2 had
 * it OFF, and sends are adjacency-only, so everything an interior stronghold
 * trained was stranded where it stood forever: measured on kaldan, a mean of 67
 * enemy troops — more than HALF of everything the AI owned — sat two or more
 * hops behind its own front line, and the player only ever met the skin of it.
 * "I only win when I fully make use of the dumb NPC" is that number.
 *
 * Turning it on is not the fix on its own: at n=240 kaldan went 60% -> 8%,
 * because a region's `enemyMult` had been implicitly tuned against an AI that
 * wasted half its production. So tier 2 releases the rear army AND has its
 * `economyMult` cut to pay for it. The force you fight is about the same size;
 * the difference is that all of it now turns up. Measured at n=240:
 *
 *      staging off, economy 0.85   60% / 20.3m   (~40% of runs hit the cap)
 *      staging on,  economy 0.85    8% / 12.4m
 *      staging on,  economy 0.84   44% / 20.4m
 *      staging on,  economy 0.82   57% / 18.0m
 *      staging on,  economy 0.80   66% / 16.6m   <- shipped
 *
 * 0.80 over 0.82 for the MEDIAN, not the win rate: kaldan's length sits on a
 * cliff (about 40% of runs used to grind all the way to the hard cap) and 16.6m
 * against a 14m advertised length is the first time this region has finished
 * anywhere near what it promises.
 *
 * `stagingKeep` is the share of its CAP a rear site holds back. Tiers 3-4 keep
 * almost nothing, which is exactly the drain-to-the-floor behaviour they always
 * had; tier 2 keeps a third, so what moves forward is the overflow a site was
 * wasting rather than its whole garrison.
 */
export const AI_TIERS = [
  { reactionTicks: 45, aggression: 0.60, commitRatio: 0.45, safetyMargin: 1.60,
    economyMult: 0.65, concurrent: 1, retreatDiscipline: 0.10, adaptComposition: false,
    ramAppetite: 0.1, stagingRatio: 0, stagingKeep: 1.0 },
  { reactionTicks: 32, aggression: 0.75, commitRatio: 0.50, safetyMargin: 1.50,
    economyMult: 0.80, concurrent: 1, retreatDiscipline: 0.35, adaptComposition: false,
    ramAppetite: 0.4, stagingRatio: 0.70, stagingKeep: 0.35 },
  { reactionTicks: 22, aggression: 1.00, commitRatio: 0.70, safetyMargin: 1.25,
    economyMult: 1.05, concurrent: 2, retreatDiscipline: 0.65, adaptComposition: true,
    ramAppetite: 0.8, stagingRatio: 0.70, stagingKeep: 0.05 },
  { reactionTicks: 15, aggression: 1.20, commitRatio: 0.80, safetyMargin: 1.15,
    economyMult: 1.35, concurrent: 3, retreatDiscipline: 0.90, adaptComposition: true,
    ramAppetite: 1.0, stagingRatio: 0.80, stagingKeep: 0.05 },
];

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
 *     base + perRegion * regionsConquered + 4 per Standing Army level.
 *
 * Re-based when slot costs landed. The old headcount numbers (14 + 4/region)
 * bought a default 9 militia + 5 spearmen at region 1, which is 19 slots — so
 * base moved 14 -> 19 and hands region 1 back the identical opening army.
 *
 * perRegion is well above the naive x1.36 (~5.5) for two reasons that only a
 * run of tools/simrunner.js shows: Standing Army's flat +4 is now +4 SLOTS
 * rather than +4 bodies, and the late slice unlocks raiders, which cost three
 * slots each. At 9/region Kaldan sat at 56% win / 22.0m (n=240) against a 22.4m
 * ceiling; at 10 it was 63% / 20.1m.
 *
 * 10 -> 12 pays for the TERRAIN LAYER. Mountains and rivers cost Kaldan about 5
 * points of win rate and 2.4 minutes on the harness (n=480), split evenly
 * between the deliberate massifs around forts and the combat/siege multipliers
 * — the player attacks, so anything that helps a defender is a net tax. This is
 * the right knob to pay it with because it scales with regionsConquered: the
 * tier-1 opener is untouched (+0 slots) and Kaldan, where four regions' worth
 * of terrain has accumulated, gets +8. Measured at n=480: 63%/20.4m before the
 * terrain layer, 57%/22.4m after it at 11, 60%/20.7m at 12.
 * Tuned on the harness, not on paper.
 *
 * The AI pass did NOT need paying for here, which is worth recording because it
 * was the obvious place to reach for. Releasing the enemy's stranded rear army
 * and cutting its `economyMult` to match is a wash on the harness, so the
 * expedition budget is unchanged and the loadout screen still says what it said.
 */
export const EXPEDITION = { base: 19, perRegion: 12 };

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
  trainType: { camp: 'militia', castle: 'militia', stronghold: 'spearmen', farm: 'militia' },
  /** Starting garrisons before enemyMult. The player's camp is deliberately
   *  empty: the expedition deploys into it at tick 0. */
  garrison: {
    player: { camp: {}, farm: { militia: 5, spearmen: 2 },
              stronghold: { militia: 4, spearmen: 3 } },
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

/** AI knobs that are the SAME at every tier. Per-tier knobs live in AI_TIERS. */
export const AI = {
  freeLunchDefence: 25,     // "leave a farm on 3 militia and it will be taken"
  defendMargin: 1.10,       // reinforce to close the gap x1.1
  threatHorizonTicks: 60,
  garrisonFloor: 3,         // never strip a front site below this
  reliefMarginSec: 10,      // breach must beat relief by this much or pull out
  siteValue: { farm: 100, stronghold: 150, camp: 400, castle: 400 },
  consolidationBonus: 0.15, // per adjacent site already held
  sampleDecay: 0.7,         // exponential decay on the observed player army
  ramTrainShare: 0.5,       // share of strongholds that take rams when hungry
  stagingCapMult: 2,        // how far over a garrison cap the AI will mass to strike
  thinkJitter: 0.2,

  // --- surplus: press when there is army going spare ----------------------
  // "More troops than it needs to hold what it has" is measurable: reserve is
  // the garrison floor plus whatever is actually being thrown at each site, and
  // anything past that is spare. At full surplus the tier's commit and staging
  // ratios open `surplusPress` of the way to total commitment.
  surplusFullAt: 1.0,       // spare == this x the reserve is a FULL surplus
  surplusPress: 0.80,       // how far toward all-in a full surplus opens a ratio
  surplusConcurrentAt: 0.5, // ...and above this it opens a second front
  surplusConcurrent: 1,

  // --- home: the castle is the win condition ------------------------------
  // defend() only sees squads already in the air inside threatHorizonTicks —
  // six seconds. For the castle that is too late, so homeGuard reads the army
  // STANDING within homeRadius hops as well, reinforces down chained sends from
  // anywhere in its own territory, and abandons a siege of its own when the gap
  // is still this far from closed.
  // Radius 1 = "standing on the doorstep". 2 was measured and is too jumpy: on
  // a tier-1 map half the board is within two hops of the castle, so the AI
  // spent the whole battle recalling an army nobody was threatening, and the
  // COUNTRYSIDE got easier by exactly as much as the castle got harder.
  homeRadius: 1,            // hops from the castle that count as encroachment
  homeGuardMargin: 1.30,    // hold the castle against this multiple of what is near
  homeRecallRatio: 0.75,    // below this share of `need`, call the siege army home
  /** Rock-paper-scissors answer to whatever the player fields most. */
  counterPick: {
    militia: 'raiders', spearmen: 'militia', raiders: 'spearmen',
    rams: 'raiders', marshal: 'spearmen',
  },
};
