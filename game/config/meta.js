// Idle economy, upgrades and prestige tuning. Owned by the meta module.

// War Council cost/effect tuning (DESIGN §5.2). Every upgrade's baseCost/growth/magnitude lives here so a
// balance pass touches one file; game/meta/upgrades.js reads this table and merges it into each UPGRADES[id]
// definition (id, tab, name, icon, desc, effectText, max?, startLevel? stay in upgrades.js: they are structural,
// not tuning numbers). Power upgrades (rally/firestorm/bulwark/march/levy) have no `magnitude` here: their
// per-level effect sizes live in game/config/battle.js's POWERS table.
//
// Measured with tools/campaign.mjs (12 seeds, the virtual player): the pacing wants MANY small steps, not a few big
// ones. Army lines are a third of DESIGN's per-level size with a gentle 1.4 cost growth: at DESIGN's size and 2x
// growth a handful of levels decided every fight and the last regions were a cost cliff (days) while the middle fell
// in minutes. Every knob below was settled together by coordinate descent against the whole target set (milestones,
// longest wait per seed, win rate, battle lengths, crown rates); the reasons sit on the lines.
export const UPGRADE_TUNING = Object.freeze({
  recruitment: { baseCost: 33, growth: 1.4, magnitude: 0.0333 },  // DESIGN +10%/level; a third of it, see above
  steel: { baseCost: 33, growth: 1.4, magnitude: 0.027 },         // DESIGN +8%
  armour: { baseCost: 33, growth: 1.4, magnitude: 0.027 },        // DESIGN +8%
  logistics: { baseCost: 35, growth: 1.4, magnitude: 0.06 },
  muster: { baseCost: 33, growth: 1.4, magnitude: 2.08 },         // troops per level (DESIGN +6)
  taxes: { baseCost: 59, growth: 1.2, magnitude: 0.0291 },        // DESIGN +10% income; dear to start, cheap to level: income already compounds with depth
  treasury: { baseCost: 120, growth: 1.7, magnitude: 1 },         // +1 h offline cap per level: 120 / 204 / 347 (about one Army upgrade at conquests 3, 6 and 9), 1.0k at level 5, 4.9k at level 8, then steeper
  plunder: { baseCost: 35, growth: 1.4, magnitude: 0.25 },
  // Powers: flat 1.12 growth, so a level is always a cheap, small step (+1.2..3% power on the difficulty card)
  // while unlocking the next power is the real purchase (prices 72 / 143 / 211 / 310 / 457 at level 1). Powers are
  // uncapped. Lever if Army upgrades must matter more: `max: 18` on each power pulls the campaign --no-army stall
  // earlier but puts a long wall on one seed in twelve (tools/campaign.mjs).
  rally: { baseCost: 72, growth: 1.12 },
  firestorm: { baseCost: 143, growth: 1.12 },
  bulwark: { baseCost: 211, growth: 1.12 },
  march: { baseCost: 310, growth: 1.12 },
  levy: { baseCost: 457, growth: 1.12 },
});

// Income, bounty and offline rules (DESIGN §5.1). Income rises 39% per depth tier (the lever that keeps the late waits
// short: the last regions pay like the realm they sit in) and the start region pays 1.82 gold/s so the first upgrades
// arrive within a minute. The conquest bounty is bountySeconds of the realm's TOTAL income at the moment of
// conquest (before the new region joins), times the bounty multipliers: it grows with the realm, so Plunder,
// Harbour and crowns stay worth having all game. The offline cap is a base; Treasury adds an hour per level.
export const ECONOMY = Object.freeze({
  baseIncome: 1.0,           // gold/s for a tier-1 region
  incomePerTier: 1.388,      // x this per tier: at a flatter 1.11 the worst seed's longest wait grows from 55 to 69 minutes
  capitalIncomeMult: 2,
  startRegionIncome: 1.82,
  bountySeconds: 51,         // a win pays about 3 upgrades at conquest 1 and 2-3 at 15-25; one crown (+25%) is 0.6-0.85 of one. 90 s or 120 s make every milestone 10-25% faster
  offlineCapHours: 2,        // base; Treasury +1 h per level (DESIGN §5.2). A check-in twice a day then takes about a day per dynasty
  welcomeBackMinSec: 60,
  surrenderRatio: 3.0,
  difficultyLabels: [        // ratio = power / strength
    { min: 1.55, label: 'Easy' },
    { min: 1.1, label: 'Fair' },
    { min: 0.85, label: 'Hard' },
    { min: 0, label: 'Deadly' },
  ],
});

export const PLAYER_BASE = Object.freeze({
  atk: 1, def: 1, growth: 1, speed: 1,
  campTroops: 30, garrisonShare: 0.0185, capBonus: 0, cooldownMult: 1, // DESIGN 0.35: a thin share keeps border garrisons from out-weighing the camp (BATTLE.playerGarrisonFloor gives each at least 4)
});

// Prestige (DESIGN §5.4). Measured with tools/campaign.mjs --dynasties=3 on 12 seeds (real world regeneration, stars earned).
// A star has one clear effect: +3% income and +3% bounty, no attack or defence (a power star shortened every later dynasty:
// at DESIGN's +20% income / +4% attack and defence D2 took 0.44x and D3 0.27x of D1's time). Longer dynasties come from
// tougher enemies, but only gently: a bigger multiplier stretches them as walls (1.65 gave 5 seeds of 12 a wait over
// 40 minutes). Result: D1 1.4 h, D2 1.8 h (1.3x), D3 2.0 h (1.4x), a wait over 40 min on 1, 0 and 2 seeds of 12.
export const DYNASTY = Object.freeze({
  incomePerStar: 0.03,       // DESIGN 0.20
  atkDefPerStar: 0,          // DESIGN 0.04: stars do not touch the fight
  bountyPerStar: 0.03,       // DESIGN 0.10
  regionsPerDynasty: 1,      // each new dynasty's continent has this many more regions (more steps do not lengthen a run: the top of the ladder does)
  maxRegions: 46,
  enemyMultPerDynasty: 1.38, // garrisons x this per dynasty completed
  starBase: 3,               // stars earned on founding = starBase + the dynasty level just completed
});

// Difficulty readout (DESIGN §5.3): Army Power vs region Strength, ratio -> label. Calibrated by
// tools/balance.mjs + a band-violation fit over ~35k bot-vs-AI battles (synthetic level ladders on seeds 1-12 in
// three border-ownership modes, plus every frontier fight at every decision point of 48 campaigns) so ECONOMY.difficultyLabels mean what they say across tiers, factions and how
// much border you hold: Easy >= 85 % wins, Fair 60-85, Hard 35-60, Deadly < 35, and ratio >= surrenderRatio
// wins ~99 %. The yardstick is the bot in game/battle/bot.js (a good human: one look at the board every 3 s).
//   power    = (campTroops + supportWeight x border garrisons) x atk x def x growth^growthExp
//              x (1 + bonus x powerUnits)
//   strength = strengthScale x personality x tierFactor[tier] x depthPerTier^(tier-3) x
//              sum over sites of (min(start troops, overCapCredit x cap) + growth x horizonSec)
//              x site def x atk x def
export const DIFFICULTY = Object.freeze({
  powerBonusPerUnlocked: 0.08,   // Rally at level 1 (DESIGN §5.3's pinned example)
  powerWeight: { rally: 1, firestorm: 1.51, bulwark: 0.72, march: 0.55, levy: 4.23 }, // x the above: what each power is worth in a fight
  powerLevelWeight: 0.163,    // each power level past the first adds this share of its unlock
  supportWeight: 1.3,         // border sites also keep producing troops through the fight
  growthExp: 0.5,
  strengthScale: 0.092,
  overCapCredit: 2,          // troops above 2x a site's cap bleed off before they matter
  horizonSec: 90,            // a garrison regrows while you fight: this many seconds of growth
  depthPerTier: 0.79,        // strength x this per tier above 3: the ladder's atk/def climb slightly over-credits depth
  // Tier 1 plays far easier than its size says (the bot wins it at any upgrade level); the card deliberately
  // reads it harder (2.27 x the Free Folk factor 0.585 x the scale) so the first ring shows Easy-but-not-trivial
  // and stays under the surrender ratio on every seed.
  tierFactor: [1, 2.27, 0.948],
  personality: Object.freeze({ passive: 0.585, defensive: 1.42, aggressive: 1.63, swarm: 2.48 }), // Free Folk never attack; rival AIs punish a 3-second-cadence player
});
