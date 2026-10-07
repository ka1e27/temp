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
// PLAN-PHASE6 §6C: every upgrade cost x this. The campaign now reads the commander-credited card (what a person sees), which
// opens fights earlier: D1's median fell to 1.11 h. A uniform nudge keeps every ratio between lines as tuned above.
// PLAN-PHASE7: Boons (a draft after every battle win) and Relics took D1's median from 1.24 h to 0.93 h at 1.2 (12 seeds); 1.5 brings it
// back to 1.13 h (1.65: 1.16 h with two D2 waits over 40 min). The War Council stays the army's engine: the campaign still buys ~97% of
// the upgrade levels it bought without Boons. A weak lever (D1 is battle- and frontier-bound), so the Boons were trimmed first.
export const UPGRADE_COST_MULT = 1.5; // 1.06 left D1 at 1.10 h, 1.12 at 1.13 h (12 seeds, pre-Phase-7): D1 is mostly battle- and frontier-bound
// PLAN-PHASE11 (early flow): the multiplier is a RAMP over each upgrade's levels instead of a flat x1.5: [level, multiplier] points, straight
// lines between them, the last one held beyond. The first levels cost x1.0 and climb to the Phase 7 price at level 8, where it stays (the
// late levels, where the optimal campaign's time goes, and the Daily, whose army starts at level 8, are priced as before). Measured with
// tools/campaign.mjs --policy=human together with ENEMY_SCALING.ladderCurve: on its own the ramp moves the human's first hour little (the
// shopper is gold-bound on the ladder, not on the first levels) but takes D2 back toward D1's ratio; ending at level 12 instead slowed one
// Daily date past its 20 minutes (a different purchase order, a capital fight lost on time).
export const UPGRADE_COST_RAMP = Object.freeze([[0, 1.0], [8, UPGRADE_COST_MULT]]);
const UPGRADE_BASE = Object.freeze({ // the pre-Phase-6 prices; UPGRADE_TUNING below applies UPGRADE_COST_RAMP[0] (level 0), upgradeCostRamp the rest
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
export const UPGRADE_TUNING = Object.freeze(Object.fromEntries(Object.entries(UPGRADE_BASE)
  .map(([id, t]) => [id, Object.freeze({ ...t, baseCost: Math.round(t.baseCost * UPGRADE_COST_RAMP[0][1]) })])));
/** The cost multiplier of `level` relative to level 0 (UPGRADE_COST_RAMP, interpolated; the last point holds beyond). */
export function upgradeCostRamp(level) {
  const pts = UPGRADE_COST_RAMP;
  let m = pts[pts.length - 1][1];
  for (let i = 1; i < pts.length; i++) {
    if (level <= pts[i][0]) { const [l0, m0] = pts[i - 1]; const [l1, m1] = pts[i]; m = m0 + ((m1 - m0) * (Math.max(l0, level) - l0)) / (l1 - l0); break; }
  }
  return m / pts[0][1];
}

// PLAN-PHASE11b: the council's "Best value" tag (game/app/bestValue.js) rates only cards the player can buy now or within this many seconds
// of current income, so it never points at a Powers unlock far out of reach (the old-bot shopper then bought the first Army card instead).
// With none in reach it names the cheapest card that raises Army Power.
export const BEST_VALUE = Object.freeze({ horizonSec: 60 });

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
// 40 minutes). With front lines, Region Works, the arrow-aware bot, the patience cap (config/battle.js) and the troop ladder of
// ENEMY_SCALING (16 seeds, the campaign builds Works the way an engaged player does):
// D1 1.46 h, D2 1.89 h (1.29x), D3 2.03 h (1.39x), a wait over 40 min on 0, 1 and 2 seeds of 16 (worst 26, 43 and 92 min; the 92 is
// one seed, a structural outlier of the dynasty-3 world).
// The first step is bigger than the later ones: stars pile up, so a single multiplier gave D2 about 1.2x while D3 had 1.35x.
export const DYNASTY = Object.freeze({
  incomePerStar: 0.03,       // DESIGN 0.20
  atkDefPerStar: 0,          // DESIGN 0.04: stars do not touch the fight
  bountyPerStar: 0.03,       // DESIGN 0.10
  regionsPerDynasty: 1,      // each new dynasty's continent has this many more regions (more steps do not lengthen a run: the top of the ladder does)
  maxRegions: 46,
  enemyMultFirst: 1.7,       // garrisons x this once the first dynasty is completed (dynasty 2) ...
  enemyMultPerDynasty: 1.25, // ... and x this again for every further dynasty completed (dynasty 3 is 2.05x dynasty 1)
  starBase: 3,               // stars earned on founding = starBase + the dynasty level just completed
});

// Difficulty readout (DESIGN §5.3): Army Power vs region Strength, ratio -> label. Calibrated by
// tools/balance.mjs + a band-violation fit over ~35k bot-vs-AI battles (synthetic level ladders on seeds 1-12 in
// three border-ownership modes, plus every frontier fight at every decision point of 52 campaigns, with a battle that outlasts the
// bot's patience (PATIENCE_SEC in config/battle.js) counted as lost) so ECONOMY.difficultyLabels mean what they say across tiers, factions and how
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
  // The War Camp's arrows (Region Works, DESIGN §5.8): one Watchtower level next door is worth about this share of Army Power
  // (measured by tools/balance.mjs --works=watchtower1:N against CAMP_VOLLEY: x1.11 / x1.13 / x1.18 at volley level 1 / 2 / 3).
  volleyPerLevel: 0.06,
  // Barracks troops (Region Works) are real troops at the War Camp, but fewer of the fight's weight than a Muster level's: they
  // only start there, with no extra production behind them. The bot won about 6% / 11% / 14% less than the card said at
  // Barracks level I / II / III when it credited them in full (tools/balance.mjs --works=barracks:N); this share of them counts.
  worksCampCredit: 0.3,
  // Barracks' camp growth and Stables' supply interval (Region Works), credited per unit of (growth multiplier - 1) and of
  // (1 / interval multiplier - 1). Measured with tools/balance.mjs --works=barracks1:N / stables1:N, see the table at the end of
  // game/config/works.js.
  campGrowthCredit: 0.25,
  // A region whose border with the player is mountains is attacked from a War Camp that stands 1-3 tiles back, behind a strip of
  // no-man's-land (arena.js planApproach). Those fights play harder than the card reads: the bot won 31% / 24% / 11% of them at a
  // strip of 1 / 2 / 3 tiles where the labels promised the same as an ordinary border (30 sweep seeds, 412 fights). Strength x
  // (1 + this x strip tiles) brings the label back (the needed factors were 1.27 / 1.59 / 2.7).
  approachPerTile: 0.3,
  // The chance of winning the card shows (progression.js winChance): the win rate each label promises at its LOWER edge (DESIGN
  // §5.3: Easy >= 85%, Fair 60-85%, Hard 35-60%, Deadly under 35%). Between the three edges the chance runs along a straight line in
  // (ln ratio, logit of the win rate); the two segments have almost the same slope (3.97 and 3.88), the slope of the measured
  // curve, and beyond them the nearer segment is extended. Against the bot in 5468 fights from real campaign states (36 seeds,
  // every frontier region at every decision point) the curve is within 5 points in every ratio bin, whole-sample and for each
  // rival personality; the first ring (tier 1) plays safer than it reads (the card deliberately reads it harder), tier 2 a little
  // harder. The range is kept off the certainties: a surrender (ratio 3) is about 0.99.
  winAtLabelEdge: Object.freeze({ Easy: 0.85, Fair: 0.60, Hard: 0.35 }),
  winChanceRange: Object.freeze([0.01, 0.99]),
  fieldCredit: 0.08,        // Stables' charge (squad-against-squad strength), per unit of (multiplier - 1): +75% in clashes at level III is worth about x1.06
  supplyCredit: 0,          // the bot turns faster supply lines into no strength at all (lines lose to its own pooling), so none is credited
  // Shorter power cooldowns (Shrines, the Old Shrine perk): per unit of (1 / cooldown multiplier - 1).
  cooldownCredit: 0.3,
  growthExp: 0.5,
  strengthScale: 0.0681,     // band fit on sweep rows plus every frontier fight of 36 + 16 x 3 campaigns, with battles that outlast PATIENCE_SEC lost (config/battle.js)
  overCapCredit: 2,          // troops above 2x a site's cap bleed off before they matter
  horizonSec: 90,            // a garrison regrows while you fight: this many seconds of growth
  // PLAN-PHASE6: an 'undying' capital (the Barrow Keep: Gate + the Rising + The Fallen Rise) reads this much stronger on the card
  undyingCapital: 1.45, // 1.3: Fair Barrow Keeps were won 7 of 13
  // PLAN-PHASE12: a 'raider' capital (the Tide Fortress: Gate + the Tide + sea reinforcements) reads this much stronger on the card, and an
  // archipelago region reads (1 + fordWeight x the share of its tiles that are fords) stronger: fords are slow ground for the attacker
  tideCapital: 1.15, // 1.3: the campaign won 12 of 12 Tide Fortresses (7 read Fair); the bot rarely stands on a ford at flood time
  fordWeight: 0.3,
  depthPerTier: 0.79,        // strength x this per tier above 3: the ladder's atk/def climb slightly over-credits depth
  // Tier 1 plays far easier than its size says (the bot wins it at any upgrade level); the card deliberately
  // reads it harder (2.27 x the Free Folk factor 0.585 x the scale) so the first ring shows Easy-but-not-trivial
  // and stays under the surrender ratio on every seed.
  tierFactor: [1, 1.5, 1.094], // tier 1: the first ring reads Easy on 28 of 30 seeds (the tutorial pick on 10 of 12) and stays under the surrender ratio (card ratio 1.3-2.7); tier 2 was 0.948 before the ladder cliff was smoothed
  personality: Object.freeze({ passive: 1.468, defensive: 1.63, aggressive: 1.63, swarm: 2.4, undying: 2.1, raider: 1.63, usurper: 1.63 }), // usurper (PLAN-PHASE13): starts at the classic factions', measured below; // raider (PLAN-PHASE12): starts at aggressive's, measured below; // undying (PLAN-PHASE6): measured with The Fallen Rise live, see below; Free Folk never attack; rival AIs punish a 3-second-cadence player (swarm 2.48 -> 2.4 with Generals and a varied map: its campaign Fair fights were won 93%; 2.3 broke the synthetic ladder)
});
