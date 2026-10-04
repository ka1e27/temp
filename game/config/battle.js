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
  // A varied map (DESIGN §10.13; game/config/features.js has their garrisons): a Bandit Hold's camp (its veterans' +30% attack and
  // defence ride on the site), a Siege's Gate (the keep cannot be assaulted until it falls), a Raid's Shrines (hold all three).
  bandit:  { growth: 0.5,  cap: 100, def: 1.2 },
  gate:    { growth: 0.25, cap: 120, def: 2.0 },
  shrine:  { growth: 0.2,  cap: 40,  def: 1.0 },
});

export const BATTLE = Object.freeze({
  baseSpeed: 0.9,            // hexes per second on cost-1.0 terrain
  overCapBleed: 0.02,        // fraction of the excess lost per second above cap
  minBleed: 0.5,             // troops per second, minimum bleed while above cap
  interceptRadius: 0.35,     // hexes: opposing squads closer than this fight
  fightRateFrac: 0.6,        // strength traded per second as a fraction of the smaller side (fights last 0.5-2 s). Faster trades (1.0 with a minimum of 45) shaved only 5% off mid and capital fights and cost the campaign dearly (36 seeds: battle win rate 76% to 67%, Easy fights won 88% to 80% even after refitting the card, Unbroken in mid regions 55% to 25%): quick trades take away the window for staggered reinforcements and relieving a threatened settlement
  fightRateMin: 20,          // minimum strength traded per second; a garrison regrows < this per second (1.92 x growth x atk x def), so no keep is an unbreakable stalemate
  arenaPlayerDepth: 2,       // player-owned tiles within this many hexes join the arena (DESIGN: 4; at 4 the border garrisons out-weighed the camp)
  // Back to DESIGN's starting garrisons (the earlier 1.5-2x raise made tier 1 read Fair and gave
  // 1000-troop keeps once tiers compound); depth comes from ENEMY_SCALING now, not raw size.
  enemyStart: { hamlet: 8, village: 12, town: 18, fort: 22, tower: 10, keep: 35 },
  playerGarrisonFloor: 4,    // troops every own border settlement starts a battle with at least (garrisonShare x cap alone is 1-4)
  freeFolkGrowthMult: 0.25,  // passive Free Folk regrow slowly (was 0.4): a too-strong one must not be a 240 s stalemate that only gets worse while you wait
  sendFractions: [0.25, 0.5, 0.75, 1.0],
  defaultSendFraction: 0.5,
  // Front lines (DESIGN §4.4): the arena guarantees a fight that opens on soft targets. If fewer than this many
  // settlements other than the keep can be attacked from the War Camp at the start, arena.js opens a corridor of
  // connector (link) tiles, across as few foreign tiles as possible, to the nearest one that cannot. The first ring
  // (the tutorial fights) opens on two: with one, a first-timer's opening fight ran about 10 s longer (median 69 s against 61 s
  // without front lines, 30 seeds), with two it is back to 61 s. The same corridors connect any of the player's own
  // border settlements the camp could not otherwise reach. A corridor tile costs this much extra to cross when the
  // corridor is planned, so it cuts through as little enemy land as it can.
  openingTargets: 1,
  openingTargetsFirstRing: 2,
  // "Take the near settlements, then the keep": when true, arena.js also guarantees that every settlement other than the keep
  // can be taken, in some order, before the keep (opening a corridor wherever the keep's land is what walls one in).
  softBeforeKeep: true,
  corridorTilePenalty: 20,   // crossing a foreign tile costs this much extra when a strip is planned, so the fewest foreign tiles always wins
  corridorMaxTiles: 3,       // a border march is at most this many tiles (DESIGN §4.4: "a short strip"); a guarantee that needs more is not given
  // The War Camp's approach (arena.js planApproach): a region whose border with the player is only mountains is reached by a strip of at
  // most corridorMaxTiles tiles from the player's nearest passable land. With this on, the strip may climb the ridge (the mountain tiles
  // on it become hill tiles flagged `pass`, a pass over the mountains); off, it may only use passable land round the ridge, and about
  // 2.5% of frontier regions (16% of conquest states have one) cannot be attacked until another neighbour is taken. Measured over
  // 20,064 conquest states: blocked frontier regions 3815 of 146187 (off) against about 0.1% (on).
  approachCrossesMountains: true,
  corridorKeepPenalty: 40,   // and a foreign tile on the keep's tile or next to it costs this much more: a strip hugging the keep reads as a highway
});

// The War Camp's arrows (Region Works, DESIGN §5.8): `PlayerStats.campVolleyLevel` (0..3, the Watchtowers next to the target
// region) lets the player's War Camp loose a volley at the nearest enemy squad in range, like a tower. `volleySec[level - 1]`
// is the gap between volleys: a level-III camp shoots at 36% of a tower's rate (SITE_TYPES.tower.volleySec). Measured with the
// bot (tools/balance.mjs --works=watchtower1:N): worth x1.11 / x1.13 / x1.18 of Army Power at level I / II / III. The first
// table, [1.6, 1.1, 0.7] (x1.15 / x1.23 / x1.40), made the Watchtower the best Work by far: a campaign that built it first
// finished 20-25% sooner than one that built nothing, and Barracks, Shrines and Stables were not worth a slot.
export const CAMP_VOLLEY = Object.freeze({
  range: 2.6,                  // hexes, as a tower
  volleySec: [2.6, 1.9, 1.4],
  kills: 1,                    // x the owner's attack, as a tower
});

// How long a person stays in one fight (DESIGN §4.7: battles of 60-150 s). The calibration tools stop a battle at this many seconds and count
// it lost, which is what a player who retreats from a slog does: the difficulty labels, the campaign and the bot's win rates all
// mean "wins within this time". By band: the first two rings near home, the body of the campaign, a rival capital. Before, the cap
// was 480 s, and Free Folk keeps at ring 2 (passive, never attack) were "Easy" although beating them took 4-5 minutes.
export const PATIENCE_SEC = Object.freeze({ early: 150, mid: 240, capital: 300 });

// Later dynasties fight bigger garrisons on purpose (DYNASTY.enemyMult*), so the patience grows with them: this share of the band's seconds per
// dynasty above the first.
export const PATIENCE_PER_DYNASTY = 1;

/** The patience cap for a region: its band's seconds, longer in later dynasties. Tools only. */
export function patienceFor(region, dynastyLevel = 1) {
  const base = region.isCapital ? PATIENCE_SEC.capital : region.tier <= 2 ? PATIENCE_SEC.early : PATIENCE_SEC.mid;
  return base * (1 + PATIENCE_PER_DYNASTY * Math.max(0, dynastyLevel - 1)); // tougher dynasties are meant to be longer
}

// Supply lines (DESIGN §4.3): a standing order from one settlement to another. While it stands, the source sends
// `fraction` of its troops every `intervalSec` whenever it holds at least `minTroops` and has a route.
export const SUPPLY = Object.freeze({
  minTroops: 10,
  intervalSec: 3,
  fraction: 0.5,
});

// Enemy scaling by DEPTH (progression.js enemyDepth: every region but the start is a rung on one evenly spaced
// ladder from 1 to the table's last entry, so each conquest is one small step up, in worlds of any size).
// Troops, settlement caps and per-troop attack/defence all follow depth. Measured with tools/campaign.mjs.
export const ENEMY_SCALING = Object.freeze({
  freeFolkTroopMult: 1,      // garrisons of passive (Free Folk) regions x this on top: farmers, not soldiers; they never attack, so their keep is a wait, not a risk
  troopAtDepth1: 1.15,       // garrison x this at depth 1 (the tutorial fight: about a minute for a first-timer) ...
  troopPerTier: 2.5,         // ... and x this for every further depth (depth d is troopAtDepth1 x this^(d-1)). Steep on purpose: difficulty comes from
                             // garrison size while atk/def climb gently (below); a strength-trade fight needs troops in proportion to strength
                             // whichever way it is split, so this is the pace lever, not the fight-length lever (that is PATIENCE_SEC)
  growthPerTier: 1,          // regrowth is per-site, not per-depth: deeper keeps hit harder, they do not refill faster (stalemate bound, see fightRateMin)
  // Enemy atk AND def by depth (index = depth, last entry repeats). Tier 1 is 0.88: a leisurely first-timer wins the tutorial
  // fight in ~60 s (0.82 was a 54 s stroll, 1.0 a 104 s grind). Depth 2 -> 7 climbs 1.22 -> 2.73 (it was 1.76 -> 2.73: that cliff made ring 2
  // thirteen times as strong as ring 1 and its Free Folk keeps a four-minute siege): the top is pinned by the
  // stalemate bound (a garrison must regrow less than fightRateMin per second), so the ladder cannot be steeper.
  atkDefByTier: [1, 0.88, 1.22, 1.523, 1.826, 2.128, 2.431, 2.734],
  personalityStat: { passive: 1.09, defensive: 0.86, aggressive: 0.82, swarm: 0.77, undying: 0.75 }, // undying (PLAN-PHASE6): softer per troop than the others, because its garrisons grow from your dead (0.86 made D2 1.6x a classic D2); extra atk AND def from depth 2. Free Folk only 9%: they never attack, so a stronger keep is not a harder fight, it is a stalemate (+40% gave 100-troop keeps the bot timed out on)
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
