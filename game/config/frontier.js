// The Living Frontier (DESIGN §10, ARCHITECTURE §10): counterattacks, defense battles, fortifications, militia, the Steward
// and the away trickle. Every number the feature uses lives here, each with its reason. Read by game/meta/frontier.js,
// forts.js, fortsEffects.js, militia.js and game/battle/{defenseArena,steward,defenseEstimate}.js.
//
// Units: "active seconds" are seconds of play with the game open (state.frontier.activeSec); ms are wall-clock timestamps.

const MIN = 60;
const HOUR_MS = 3600 * 1000;

export const FRONTIER = Object.freeze({
  // --- Concurrency (DESIGN §10.5) ---------------------------------------------------------------------------------------
  maxBattles: 3,               // battles running at once (attack + defenses); the manager refuses a 4th
  maxDefenses: 2,              // raids incoming or being fought at once (DESIGN §10.1)

  // --- The raid scheduler (DESIGN §10.1) --------------------------------------------------------------------------------
  checkSec: 20,                // the scheduler rolls once per this many active seconds
  raidMeanSec: 10 * MIN,       // one raid per bordering rival per this many active seconds, before the multipliers
  // How often each personality raids, x the mean rate. Free Folk ('passive') never raid. 'defensive' raids rarely, and at
  // `provoked` once you have taken one of its regions within `provokedSec`.
  personalityRate: Object.freeze({ aggressive: 1.4, swarm: 1.6, defensive: 0.25, passive: 0, undying: 0.8 }), // undying (PLAN-PHASE6): patient, raids a little under the mean
  provokedRate: 1.0,
  provokedSec: 30 * MIN,
  decapitatedRate: 0.5,        // a faction whose capital you hold raids half as often
  regionCooldownSec: 15 * MIN, // a region is left alone this long after a raid on it (counted from its arrival)
  // Grace: no raids in the first `graceSec` active seconds of a realm or dynasty, nor before the player holds `minRegions`.
  graceSec: 20 * MIN,
  minRegions: 4,
  telegraphSec: 45,            // the war band marches visibly this long before it arrives ("arrives in 45 s [Go]")
  beaconSecPerLevel: 20,       // + this much warning per Beacon level in the target region
  // A smart raider probes weak spots: a target's weight is 1 / (1 + perFortLevel x its fortification levels) x
  // (1 + drained x (1 - its militia fill)), so fortifying everything is a gold sink, not a wall.
  targeting: Object.freeze({ perFortLevel: 1, drained: 3 }),
  holdRetrySec: 5,             // a raid whose target is busy (in another battle) or with 3 battles running waits this long at the border

  // --- The defense battle (DESIGN §10.1) --------------------------------------------------------------------------------
  // Hold the keep this long (battle seconds) to win, by the defended region's tier (index = tier, last repeats).
  siegeSecByTier: Object.freeze([90, 90, 100, 110, 120, 130, 140, 150]),
  capitalSiegeMult: 1,
  raidGraceSec: 5,             // the war band's AI waits this long before its first attack (the player has had the telegraph)
  // How the war band's AI plays (game/battle/ai.js, defense battles only): every personality raids alike, with these overrides
  // of its tuning; the player's keep is worth `keepValue` x a normal keep as a target; from `urgencyFrom` of the siege timer
  // on, the margin it wants falls by up to `urgencyMarginDrop` (it throws in everything before time runs out).
  raidAI: Object.freeze({
    tuning: Object.freeze({
      reserve: 0.1, keepGuard: 0, margin: 1.05, maxCommit: 1.0, waves: 2, open: 3, extend: 2.0, softOnly: false, neutrals: false, losing: 0.3, sources: 8,
    }),
    keepValue: 3,
    coverTrust: 2,             // a target counts as covered by squads already on it only at this x what it needs (attacks: 0.9)
    urgencyFrom: 0.5,
    urgencyMarginDrop: 0.35,
  }),

  // The war band (DESIGN §10.1): a camp on the attacker's border plus partial garrisons of its settlements next door. Its
  // strength follows the enemy depth ladder (ENEMY_SCALING, the same troop and atk/def tables as an attack) at `raidDepth`:
  // the defended region's depth, leaning `realmLean` of the way toward the deepest region the player holds, so a raid on an
  // old inner region still means something late in the game.
  warBand: Object.freeze({
    // Measured (tools/balance.mjs --defense, seeds 9-20, 340 raids on real campaign states, no fortifications): held 86% in person,
    // 55% by the Militia Captain (57% / 70% in the first two depth bands); with any two level-I/II fortifications the Captain holds
    // 85-91% (siege preparation included) and a person 98-99%.
    campTroops: 288,           // troops at the war-band camp, x the depth troop multiplier ^ depthExp
    depthExp: 1.02,            // war bands grow a touch faster with depth than the militia
    depthCurve: Object.freeze([[1, 0.22], [1.5, 0.5], [2.2, 1]]), // x this by raid depth (interpolated): raids on a young realm's first ring are gentler
    haloShare: 0.5,            // the attacker's settlements in the arena join with this share of their usual garrison
    realmLean: 0.5,
    personalityStrength: Object.freeze({ aggressive: 1.0, swarm: 0.75, defensive: 1.1, passive: 1, undying: 0.9 }), // undying: a smaller band that grows from the defenders it kills (ASHEN.warBandShare); swarm: more raids, weaker ones
    firstRaidMult: 0.6,        // the first raid of a realm is weak and forgiving (the tutorial's first defense, ARCHITECTURE §10.5)
    capMult: 1.15,             // the camp's cap is this x its starting war band (or the region's cap, if larger)
    perFortLevel: 0.12,        // siege preparation: x (1 + this x the target's total fortification levels)
  }),

  // The defense odds (game/battle/defenseEstimate.js, meta/frontier.js estimateDefense): weights of the closed form and, per
  // commander, a logistic fit of the measured hold rate, logit(P) = a + b ln(yours / theirs). Fitted on raids as the game makes
  // them (tools/balance.mjs --defense --dump, seeds 1-24, war bands x1 and the first raid's x0.6, no fortifications, Walls + Tower,
  // Walls + Hall, a lone Tower: 15,528 battles). The weights were chosen by log-loss over 9,288 battles at x0.5 to x3.
  estimate: Object.freeze({
    horizonSec: 0,             // a defender's growth over the siege: the fit gives it no weight (the war band's growth already sets the clock)
    keepWeight: 1,             // the keep counts like any other garrison (heavier weights fitted worse)
    towerWeight: 0.5,          // an Arrow Tower's kills over the siege, at half (it shoots only what comes in range)
    campGrowthWeight: 1,       // the war band's camp keeps feeding the raid for the whole siege
    haloWeight: 1,             // the raider's own settlements next door count in full
    fit: Object.freeze({
      inPerson: Object.freeze([5.14, 3.42]),
      captain: Object.freeze([2.68, 3.06]),
      stalwart: Object.freeze([5.39, 3.48]),
      general1: Object.freeze([3.56, 3.24]),   // a level-1 General's steward, passive in the ratio (5,008 raids, the four kinds, x0.6 / x1, no forts / Walls + Tower)
      general10: Object.freeze([4.21, 3.21]),  // a level-10 General's steward (5,008 raids)
    }),
    range: Object.freeze([0.02, 0.98]),
  }),

  // --- Militia (DESIGN §10.4) -------------------------------------------------------------------------------------------
  militia: Object.freeze({
    // Garrison per settlement type when full, x `scale`: (War Camp troops from Muster / the base camp)^musterExp x
    // (the region's depth troop multiplier)^depthExp. Muster makes your militia bigger; depth keeps a deep region's garrison
    // in step with the war bands that raid it.
    perType: Object.freeze({ hamlet: 15, village: 25, town: 35, fort: 35, tower: 20, keep: 55 }),
    towerFort: 20,             // an Arrow Tower fortification's garrison when full (x scale)
    musterExp: 1,
    depthExp: 1,
    refillMs: 8 * 60 * 1000,   // empty to full in this long (DESIGN: "full in about 8 min after a defense")
    capHeadroom: 1.6,          // a militia site's cap is this x its full garrison (x the type cap ratio), so it can grow in a siege
    lossFloor: 0.1,            // a defense always drains at least this much (the militia marched)
  }),

  // --- Rewards (DESIGN §10.1; Renown lives in config/renown.js) --------------------------------------------------------------------------------------
  reward: Object.freeze({
    bountyShare: 0.5,          // a defense won pays this share of a conquest bounty (ECONOMY.bountySeconds of realm income)
    retakeBountyShare: 0.5,    // retaking an occupied region pays this share of the conquest bounty (it was yours already)
  }),
  retakeMilitiaFill: 0.25,     // a retaken region's militia starts this full and refills from there
  // An occupied region on the difficulty card (progression.js difficulty): its captured Arrow Tower counts as a tower site worth
  // (1 + towerCredit x level) of a plain one (the volleys); captured Walls multiply its keep's and forts' defence there too.
  occupation: Object.freeze({ towerCredit: 0.5 }),
  renown: Object.freeze({ defenseWon: 2, defenseUnbroken: 3, retake: 2 }),

  // --- While you're away (DESIGN §10.10) -----------------------------------------------------------------------------------
  away: Object.freeze({
    rateMult: 0.2,             // raids happen at this share of the live rate while the game is closed
    lossAfterMs: 3 * HOUR_MS,  // no region can be lost unless the absence is longer than this
    lossWindowMs: 4 * HOUR_MS, // at most one loss per this much absence (and never two closer together than this)
    maxLossesPerAbsence: 2,
    maxRaidsPerAbsence: 12,    // a safety rail for very long absences (the report stays readable)
    winChanceFloor: 0.05,      // an unattended defense is never hopeless in the abstract roll
  }),
});

// Fortifications (DESIGN §10.3): slots per owned region, separate from Works. One of each type per region. Costs follow the
// Works pattern: base x perDepth^(depth - 1) x levelMult[level - 1] x typeMult[type] (depth = the region's rung on the ladder).
export const FORT_TYPES = Object.freeze(['tower', 'walls', 'hall', 'beacon']);

export const FORTS = Object.freeze({
  slots: Object.freeze({ base: 2, extraAtProsperity: Object.freeze([2]) }), // 2 slots, +1 at Prosperity II
  maxLevel: Object.freeze({ tower: 3, walls: 3, hall: 3, beacon: 2 }),
  cost: Object.freeze({
    base: 120,                 // a level-I fortification in a depth-1 region: about two Works' price
    perDepth: 1.7,             // as Works: about the same share of the realm's income wherever it is built
    levelMult: Object.freeze([1, 1.8, 3.2]),
    typeMult: Object.freeze({ tower: 1, walls: 1.1, hall: 0.8, beacon: 0.6 }),
  }),
  demolishRefund: 0.5,
  effects: Object.freeze({
    // Arrow Tower: a real tower site in the region. Range (hexes) and seconds between volleys per level.
    // Kills per volley are x the owner's attack and, in a defense, x the militia scale (so a tower matters as much late as early).
    tower: Object.freeze({ range: Object.freeze([3.0, 3.4, 3.8]), volleySec: Object.freeze([0.5, 0.4, 0.33]), kills: Object.freeze([0.6, 0.9, 1.2]) }),
    walls: Object.freeze({ defMult: Object.freeze([1.5, 1.65, 1.85]) }),     // the keep and forts defend x this (config is truth; DESIGN started at 1.25)
    hall: Object.freeze({ garrisonMult: Object.freeze([1.6, 2.0, 2.4]), refillMult: Object.freeze([1.25, 1.5, 1.75]) }), // config is truth (DESIGN started at +40 / +80 / +120%)
    beacon: Object.freeze({ warnSec: Object.freeze([20, 40]), speedMult: 1.1 }), // speed: your squads in this region's defenses
  }),
  // Where Arrow Towers stand: passable tiles of the region at least `minGap` hexes from every settlement and from each other,
  // nearest to `keepDist` hexes from the keep first.
  site: Object.freeze({ minGap: 2, keepDist: 2 }),
  copy: Object.freeze({
    names: Object.freeze({ tower: 'Arrow Tower', walls: 'Walls', hall: 'Militia Hall', beacon: 'Beacon' }),
    levels: Object.freeze(['', 'I', 'II', 'III']),
    toasts: Object.freeze({
      built: '{fort} built in {region}',
      upgraded: '{fort} in {region} is now level {level}',
      demolished: '{fort} demolished in {region} (+{refund} gold)',
    }),
    demolishPrompt: 'Demolish {fort}? Refund {n} gold',
    reasons: Object.freeze({
      gold: 'Need {n} more gold', duplicate: 'Already built here', maxed: 'Fully upgraded',
      noSlot: 'No free slot', notOwned: 'Hold this region first', underAttack: 'Under attack',
    }),
    intro: 'Fortifications defend this region when it is attacked. If it falls, they fight for the enemy.',
    lockedLabel: 'Unlocks at Prosperity',
  }),
});

// The Steward (DESIGN §10.6): the player's side when nobody watches. One table per commander style. 'captain' is the weak
// Militia Captain; 'stalwart' is the strong default; 'bold', 'cunning' and 'swift' are its Phase-2 variants.
//   thinkSec:   seconds between looks          lookahead: answers marches arriving within this many seconds
//   margin:     reinforce until the garrison holds this x the attack       retake: odds needed to retake a site (defense)
//   attackOdds: odds needed to attack in an ATTACK battle                  consolidate: pull surplus into the keep / forts
//   evacuate:   pull a doomed small site's troops back to the keep         powers: which powers it uses
export const STEWARD = Object.freeze({
  captain: Object.freeze({
    thinkSec: 10, lookahead: 2, margin: 1.0, retake: 1.5, attackOdds: 2.0, consolidate: false, evacuate: false,
    powers: Object.freeze(['bulwark', 'levy']), reserve: 0.25,
  }),
  stalwart: Object.freeze({
    thinkSec: 1.5, lookahead: 14, margin: 1.25, retake: 1.5, attackOdds: 2.0, consolidate: true, evacuate: true,
    powers: Object.freeze(['bulwark', 'levy', 'firestorm']), reserve: 0.2,
  }),
  bold: Object.freeze({
    thinkSec: 1.5, lookahead: 12, margin: 1.15, retake: 1.3, attackOdds: 1.7, consolidate: true, evacuate: true,
    powers: Object.freeze(['bulwark', 'levy', 'firestorm']), reserve: 0.15,
  }),
  cunning: Object.freeze({
    thinkSec: 1.5, lookahead: 14, margin: 1.2, retake: 1.5, attackOdds: 2.0, consolidate: true, evacuate: true,
    powers: Object.freeze(['bulwark', 'levy', 'firestorm', 'rally']), reserve: 0.2,
  }),
  swift: Object.freeze({
    thinkSec: 1.0, lookahead: 16, margin: 1.25, retake: 1.5, attackOdds: 2.0, consolidate: true, evacuate: true,
    powers: Object.freeze(['bulwark', 'levy', 'firestorm', 'march']), reserve: 0.2,
  }),
});
