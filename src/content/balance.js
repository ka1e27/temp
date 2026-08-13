// ALL tuning constants. No engineer hardcodes a number anywhere else, so a
// balance pass is a single-file diff.
// PURE DATA.

export const UNIT_IDS = [
  'militia', 'spearmen', 'outriders', 'raiders', 'halberds', 'sappers', 'rams', 'marshal',
];

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

  // --- The three specialists -----------------------------------------------
  // Each one owns a VERB the roster did not have, rather than a better number
  // on one it did. The first five are a rock-paper-scissors of stats plus a
  // siege engine; adding a sixth set of stats would only have moved which
  // column of the same table you read. What these do instead:
  //
  //   outriders  MOVE      three times a militia's march. The campaign is a
  //                        beachhead landing into a map that is 30-50% unclaimed
  //                        (see regions.data.js), so the race for neutral ground
  //                        IS the opening, and this is the unit that wins it.
  //                        They also carry `skirmish`, so a failed grab costs a
  //                        fraction rather than the squad.
  //   halberds   BREAK     the defender's ground advantage. `sunder` cuts
  //                        `siteDefMult` — a castle defends at x1.60 and a
  //                        level-5 wall stacks on top of that, which is exactly
  //                        the fight where militia stop scaling.
  //   sappers    HOLD      what you took. `repair` multiplies the site's HP
  //                        regen while they garrison it, and battle/combat.js
  //                        `breachSeconds` returns Infinity the moment repair
  //                        out-paces siege damage — so a stronghold with sappers
  //                        in it is not merely tougher, it is UNCRACKABLE by a
  //                        force that did not bring engines. That is the same
  //                        mechanism that already makes "a few troops cannot
  //                        take a stronghold" true, handed to the player.
  //
  // None of them is in ENEMY_UNITS_BY_TIER, and none has a
  // DEFAULT_COMPOSITION_WEIGHT: they are a deliberate pick on the loadout
  // screen, so the default army — and every balance number measured against it
  // — is exactly what it was.
  outriders: { gold: 30,  trainSec: 10, batch: 1, speed: 165, atk: 6,  def: 3,  siege: 0.5,
              counters: { rams: 0.9 }, skirmish: 0.6,
              ground: { highland: 0.75, river: 1.25 } },
  halberds: { gold: 65,  trainSec: 16, batch: 1, speed: 42,  atk: 12, def: 5,  siege: 1.2,
              counters: { raiders: 0.5 }, sunder: 0.50,
              ground: { highland: 1.10, river: 0.90 } },
  sappers:  { gold: 55,  trainSec: 16, batch: 1, speed: 40,  atk: 3,  def: 7,  siege: 2.5,
              counters: {}, repair: 1.9,
              ground: { highland: 1.15, river: 0.95 } },
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
  militia: 1, spearmen: 2, outriders: 2, raiders: 3, halberds: 4, sappers: 3, rams: 5, marshal: 8,
};

/** Structure HP + regen is the master pacing knob: it sets BOTH battle length
 *  and the minimum-force threshold. A force whose siege DPS is below `hpRegen`
 *  can never breach, which is what stops a handful of troops taking a
 *  stronghold — without an arbitrary "minimum N troops" rule. */
export const SITES = {
  farm:       { gold: 2.0, train: 0,    cap: 30, hp: 100, hpRegen: 2.0, defMult: 1.00 },
  // THE YARD AND THE WALL ARE TWO BUILDINGS NOW.
  //
  // `stronghold` used to be both — the only thing that trained and, apart from
  // the two thrones, the only thing that defended. So there was never a
  // decision: whatever you took for one reason you got the other for free, and
  // the map had exactly one interesting site on it repeated fifteen times.
  //
  // A `trainingGround` is a barracks and nothing else. It trains FASTER than the
  // old stronghold did, because that is all it does, and it is soft — 180 HP at
  // a defence multiplier barely above bare ground. Taking one is cheap and
  // losing one hurts.
  //
  // A `stronghold` trains nothing at all and is a genuine wall: two thirds again
  // the HP, a defMult between a camp and a throne, and `garrisonMult`, which is
  // the part that is not just a bigger number in the same column — see
  // combat.js `power`. It is what "high defence targets with troops in it
  // getting a buff" means, and it is deliberately the one defensive term the
  // halberds' `sunder` cannot strip: they crack masonry, not the men behind it.
  trainingGround:
              { gold: 0,   train: 1.30, cap: 45, hp: 180, hpRegen: 3.0, defMult: 1.05 },
  stronghold: { gold: 0,   train: 0,    cap: 60, hp: 340, hpRegen: 5.5, defMult: 1.55,
                garrisonMult: 1.30 },
  camp:       { gold: 4.0, train: 1.25, cap: 80, hp: 480, hpRegen: 5.0, defMult: 1.40 },
  castle:     { gold: 4.0, train: 1.25, cap: 80, hp: 480, hpRegen: 5.0, defMult: 1.60 },
  // FOG OF WAR'S ONE BUILDING, and it ships here and not earlier: the
  // cheapest cap in the table, useless in a fight, sees past its own doorstep.
  watchtower: { gold: 0,   train: 0,    cap: 15, hp: 120, hpRegen: 2.5, defMult: 1.10 },
};

/** Every site kind, in the order they read as a ladder. ONE STATEMENT of the
 *  list: `contract.js SITE_KINDS` and the render tables derive from it rather
 *  than repeating it, because a kind that exists in four tables and not the
 *  fifth is how the specialists shipped with no CSS colour. */
export const SITE_KINDS = Object.freeze(Object.keys(SITES));

/** What may be RAISED mid-battle, and where. Split to ./balance.construct.js for
 *  the line budget; re-exported so this file stays the one front door. */
export {
  BUILD_COSTS, BUILDABLE_KINDS, BUILD_RANGE_HEXES, BUILD_MIN_SEPARATION,
} from './balance.construct.js';


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
  // `cooldownSec` is FACTION-WIDE, not per site. Gold is the only thing standing
  // between a rich late-game player and a marshal in every stronghold on the
  // board, and by the endgame gold is not scarce — 250 is a rounding error
  // against a treasury that funds a 700-slot landing. A cooldown makes the
  // commission a decision about WHEN and WHERE rather than a purchase you make
  // as many times as you can afford, which is the same reason `maxPerSite` is 1.
  marshal: { gold: 250, cooldownSec: 90 },
};

/** Territory influence radius by site kind, and the movement effect.
 *  watchtower's CLAIM is a farm's — its sight is the special number below,
 *  not its footprint. */
export const INFLUENCE_RADIUS = {
  farm: 1, trainingGround: 1, stronghold: 2, camp: 3, castle: 3, watchtower: 1,
};
export const TERRITORY_SPEED = { friendly: 1.4, neutral: 1.0, hostile: 0.50 }; // hostile WAS 0.75

/** SIGHT radius by kind (battle/vision.js) — NOT a read of INFLUENCE_RADIUS:
 *  that would silently hand a camp a 3-hex sightline and a farm 1. Every
 *  ORDINARY building sees its own doorstep; watchtower sees past it. */
export const VISION_RADIUS = {
  farm: 1, trainingGround: 1, stronghold: 1, camp: 1, castle: 1, watchtower: 4,
};

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

/**
 * THE FIVE BOOSTERS, and why they hit harder than they used to.
 *
 * A charge is priced in RELICS now (content/upgrades.data.js `BOOSTER_SHOP`) —
 * a currency that does not tick, cannot be idled toward, and is paid only for
 * ground you have beaten. At 25-60 crowns each they were free from about region
 * six onward and stayed free forever, so a booster was a lit button rather than
 * a decision, and the numbers below were sized for something you could fire
 * whenever it crossed your mind.
 *
 * They are sized for something you fire three times a battle now. Every one of
 * them was already the ANSWER to a specific loss — the reinforcement that
 * arrives too late, the wall that will not crack, the counter-attack you cannot
 * survive — and each is now big enough to actually be that answer:
 *
 *   rally    2 -> 3 hops, and 50% -> 65% of each garrison. The verb is "every
 *            spare body I own, here, now"; at two hops it reached your own back
 *            line and not the front you were losing.
 *   march    0.50 -> 0.35 travel. Half speed does not beat a siege timer.
 *   bombard  a quarter of a garrison -> a third, 60 -> 110 structure. 60 HP is
 *            fifteen seconds of a stronghold's own repair; it never once turned
 *            an uncrackable wall into a crackable one, which is the whole job.
 *   fortify  20 -> 26 seconds, and attackers at 0.50 -> 0.40. It has to outlast
 *            a real assault, not the first wave of one.
 *   tithe    250 -> 400 gold and 15 -> 22 seconds of the training buff.
 *
 * NONE OF THIS MOVED A BALANCE NUMBER, and that is verifiable rather than
 * hoped: tools/simplayer.js is launched with `boosters: []` on every run in
 * content/regions.data.js, so the harness has never fired one.
 */
export const BOOSTERS = {
  rally:    { charges: 2, cooldownSec: 75,  radius: 3, fraction: 0.65 },
  march:    { charges: 3, cooldownSec: 40,  factor: 0.35 },
  bombard:  { charges: 1, cooldownSec: 120, garrisonFrac: 0.33, hp: 110 },
  fortify:  { charges: 2, cooldownSec: 60,  hp: 100, regenMult: 2, attackerMult: 0.40, sec: 26 },
  tithe:    { charges: 2, cooldownSec: 90,  gold: 400, trainMult: 1.5, sec: 22 },
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
 *
 * THE FOURTH SEGMENT (`finalAfter` / `finalBonus` / `perRegionFinal`) IS TIER 6,
 * AND IT COULD NOT HAVE BEEN THE THIRD ONE RAISED. Tier 6 measured 16 / 6 / 16
 * against an 18-36 band on the segments above, and the obvious fix — a bigger
 * `perRegionSurge` — is the one thing that is not available: that rate applies
 * from the ninth conquest, so every region from gallowmoor on would be re-tuned
 * by it, and all sixteen of them are measured. `finalAfter: 20` cannot touch a
 * region before the twenty-second BY CONSTRUCTION, because region 21 is attacked
 * with twenty conquests. That is the same argument `taperAfter` makes for the
 * frozen opening, one end of the campaign later.
 *
 * The split into a STEP and a RATE is the lesson the surge already paid for: a
 * landing force needs a LEVEL (enough to contest a 55-site board the player
 * starts on five sites of) and a SLOPE (how fast it grows region to region), and
 * one number cannot set both.
 */
export const EXPEDITION = {
  base: 12, perRegion: 10, taperAfter: 3, perRegionLate: 24,
  surgeAfter: 8, surgeBonus: 232, perRegionSurge: 14,
  finalAfter: 20, finalBonus: 52, perRegionFinal: 8,
};

/**
 * A rallied site forwards its garrison once it can do so and still keep this
 * many troops at home. The default is the old global; it is now a PER-SITE
 * setting, because the right answer differs by role — a back-line farm should
 * keep almost nothing, a front stronghold feeding a siege has to hold enough
 * to survive the counter-attack that follows.
 */
export const RALLY_MIN_GARRISON = 8;
/**
 * How many DIFFERENT troop types one expedition may field.
 *
 * The roster reached eight and the loadout screen became a spreadsheet: with
 * every unit available at once the interesting question ("which three answers am
 * I bringing to this map") collapses into "a bit of everything", which is both
 * the dullest army and — because the specialists are share-scaled like
 * `counters` — the weakest one. A token halberd escort strips almost nothing.
 *
 * Five, not four: the default spread is already four (militia, spearmen,
 * raiders, rams), so a cap of four would mean bringing any specialist at all
 * required dropping one of the staples before you could even try it. Five leaves
 * exactly one discretionary slot on top of the default, which is the decision
 * this is meant to create.
 *
 * The marshal is not counted and cannot be: `maxOf('marshal')` is 0, so he is
 * never part of a composition — one is granted free per landing outside the
 * budget entirely.
 */
export const LOADOUT_TYPES_MAX = 5;

export const RALLY_KEEP = { min: 0, max: 40, step: 2, default: RALLY_MIN_GARRISON };
export const SEND_FRACTIONS = [0.25, 0.5, 0.75, 1.0];
export const CENTIGOLD = 100;

// --------------------------------------------------------------------------
// Battle-engine tuning lives in ./balance.engine.js and is re-exported here,
// so `import { MAPGEN } from "../content/balance.js"` keeps working and this
// file stays under the 400-line cap. Shape there, power here.
// --------------------------------------------------------------------------
export { MOVEMENT, SQUAD_VISION_RADIUS, INFLUENCE, MAPGEN, RIVERS, TERRAIN } from './balance.engine.js';
