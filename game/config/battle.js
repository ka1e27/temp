// Battle tuning. Owned by the battle module; the balance harness tunes these.
export const TICK_SEC = 0.05; // fixed simulation timestep (20 Hz)

// Caps are DESIGN §4.2's table x2 (camp 80 -> 160): ENEMY_SCALING multiplies garrisons per tier, and
// troops above a site's cap bleed away within seconds, so at the old caps everything past tier 4
// was clipped to the same strength and the last three tiers were no harder than tier 4.
export const SITE_TYPES = Object.freeze({
  hamlet:  { growth: 0.35, cap: 40,  def: 1.0 },
  village: { growth: 0.7,  cap: 80,  def: 1.0 },
  town:    { growth: 1.0,  cap: 120, def: 1.1 },
  fort:    { growth: 0.45, cap: 120, def: 1.8 },
  tower:   { growth: 0.2,  cap: 50,  def: 1.4, range: 2.6, volleySec: 0.5, volleyKills: 1 },
  keep:    { growth: 1.2,  cap: 180, def: 1.6 },
  camp:    { growth: 0.8,  cap: 160, def: 1.2 },
});

export const BATTLE = Object.freeze({
  baseSpeed: 0.9,            // hexes per second on cost-1.0 terrain
  overCapBleed: 0.02,        // fraction of the excess lost per second above cap
  minBleed: 0.5,             // troops per second, minimum bleed while above cap
  interceptRadius: 0.35,     // hexes: opposing squads closer than this fight
  fightRateFrac: 0.6,        // strength traded per second as a fraction of the smaller side
  fightRateMin: 20,          // minimum strength traded per second; a garrison regrows < this per second (1.92 x growth x atk x def), so no keep is an unbreakable stalemate
  arenaPlayerDepth: 2,       // player-owned tiles within this many hexes join the arena (DESIGN: 4; at 4 the border garrisons out-weighed the camp)
  // Back to DESIGN's starting garrisons (the earlier 1.5-2x raise made tier 1 read Fair and gave
  // 1000-troop keeps once tiers compound); depth comes from ENEMY_SCALING now, not raw size.
  enemyStart: { hamlet: 8, village: 12, town: 18, fort: 22, tower: 10, keep: 35 },
  playerGarrisonFloor: 4,    // troops every own border settlement starts a battle with at least (garrisonShare x cap alone is 1-4)
  freeFolkGrowthMult: 0.25,  // passive Free Folk regrow slowly (was 0.4): a too-strong one must not be a 240 s stalemate that only gets worse while you wait
  sendFractions: [0.25, 0.5, 0.75, 1.0],
  defaultSendFraction: 0.5,
});

// Enemy scaling by DEPTH (progression.js enemyDepth: every region but the start is a rung on one evenly spaced
// ladder from 1 to the table's last entry, so each conquest is one small step up, in worlds of any size).
// Troops, settlement caps and per-troop attack/defence all follow depth. Measured with tools/campaign.mjs.
export const ENEMY_SCALING = Object.freeze({
  troopPerTier: 1.45,        // garrison x this per depth (DESIGN 1.3): at 1.3 the ladder was too flat to keep the middle regions from falling in clusters
  growthPerTier: 1,          // regrowth is per-site, not per-depth: deeper keeps hit harder, they do not refill faster (stalemate bound, see fightRateMin)
  // Enemy atk AND def by depth (index = depth, last entry repeats). Tier 1 is 0.88: a leisurely first-timer wins the tutorial
  // fight in ~60 s (0.82 was a 54 s stroll, 1.0 a 104 s grind). Depth 2 -> 7 climbs 1.76 -> 2.73: the top is pinned by the
  // stalemate bound (a garrison must regrow less than fightRateMin per second), so the ladder cannot be steeper.
  atkDefByTier: [1, 0.88, 1.759, 1.954, 2.149, 2.344, 2.539, 2.734],
  personalityStat: { passive: 1.09, defensive: 0.86, aggressive: 0.82, swarm: 0.77 }, // extra atk AND def from depth 2. Free Folk only 9%: they never attack, so a stronger keep is not a harder fight, it is a stalemate (+40% gave 100-troop keeps the bot timed out on)
  regionJitter: 0.05,        // each region's atk AND def x 1 +/- this (hash of world seed + region id): regions of one rung are not clones
  ladderCurve: 1,            // 1 = evenly spaced rungs; >1 keeps more regions easy and crowds the hard ones at the end
  capitalStat: 1.038,        // capitals' atk AND def x this on top (capitals already carry capitalMult troops)
  // Opening grace: seconds before a rival AI may attack (it still defends) so the player can read the
  // board; by tier (index = tier, last repeats), capitals get capitalGraceMult of it.
  graceSecByTier: [20, 20, 20, 18, 15, 12, 10, 8],
  capitalGraceMult: 0.7,
  graceFloorSec: 8,
  capitalMult: 1.6,          // DESIGN §4.6
  decapitationMult: 0.7,     // DESIGN §3.3 (measured: the campaign barely notices it, 0.7 vs 1.0 moves no milestone)
  // Settlement caps of enemy sites (DESIGN §4.6): a multiplier on SITE_TYPES[type].cap, fixed per site when the arena
  // is built (arena.js). Troops above a cap bleed away, so a region's real strength stops growing once its garrisons
  // are capped. Steeper scaling lengthened the campaign tail but only by walling single regions: at 1.25 per depth
  // 3-7 seeds of 12 waited over 40 minutes somewhere, so the compromise is gentle.
  capPerDepth: 1.1,          // x this per depth above 1 (depth 7: x1.8)
  capitalCapMult: 1.3,       // a rival capital's sites hold this much more on top
  freeFolkCapMult: 0.6,      // Free Folk sites (their own regions and neutral hamlets in rival ones): farmers, not soldiers
  thinkSecByTier: [2.5, 2.4, 2.2, 2.0, 1.8, 1.6, 1.5, 1.4, 1.3, 1.2],
});

// Per-level growth trimmed (firestorm +5 -> +3 damage, bulwark +2 -> +1 s, march +1 -> +0.5 s, levy +4 -> +2,
// cooldown x0.92 -> x0.95 per level): tools/campaign.mjs bought powers to level 8-10 by mid-game
// and a level-8 Levy alone out-produced every village the player held, swinging fights at
// 35-troops-a-site-a-half-minute; powers should sharpen a fight, not carry it.
export const POWERS = Object.freeze({
  rally:     { cooldown: 30, share: 0.5 },
  firestorm: { cooldown: 25, delay: 0.8, radius: 1.3, damage: 10, damagePerLevel: 3 },
  bulwark:   { cooldown: 30, mult: 2.5, duration: 8, durationPerLevel: 1 },
  march:     { cooldown: 35, mult: 2.0, duration: 6, durationPerLevel: 0.5 },
  levy:      { cooldown: 45, troops: 8, troopsPerLevel: 2 },
  cooldownPerLevel: 0.95,    // each level past 1 multiplies the cooldown by this
});
