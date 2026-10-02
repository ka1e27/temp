// Battle-stat derivation, conquest, the difficulty readout and dynasty
// prestige (DESIGN §3.3, §4.6, §5.3, §5.4; ARCHITECTURE §5, §6). Pure: no
// DOM, no Date.now, no Math.random, no storage globals.

import { PLAYER_BASE, DYNASTY, ECONOMY, DIFFICULTY } from '../config/meta.js';
import { ENEMY_SCALING, BATTLE, SITE_TYPES } from '../config/battle.js';
import { PLAYER_FACTION, resetRegions } from './state.js';
import { UPGRADES, POWER_IDS, levelOf } from './upgrades.js';
import { perkMultipliers, perkAccumulate } from './perks.js';
import { bounty } from './economy.js';
import { worksBattleEffects, NO_WORKS_EFFECTS } from './worksEffects.js'; // the leaf: works.js imports this file
import { hexDistance } from '../core/hex.js';
import { hash32 } from '../core/rng.js';
import { canBuildArena, arenaBlockedReason, approachTiles } from '../battle/arena.js';
import { sabotageTroopMult, clearRegionIntel } from './intelState.js'; // the dependency-free leaf: intel.js imports this file

// --- Player --------------------------------------------------------------

/**
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @param {number} [targetRegionId] the region about to be fought over: the Works of the owned regions next to it (Region
 *   Works, DESIGN §5.8) join the army. Leave it out for a stat block that belongs to no particular battle.
 * @returns {import('../battle/sim.js').PlayerStats}
 */
export function playerBattleStats(state, world, targetRegionId) {
  const perks = perkMultipliers(state, world);
  const works = targetRegionId == null ? NO_WORKS_EFFECTS : worksBattleEffects(state, world, targetRegionId);
  const starAtkDef = 1 + state.dynasty.stars * DYNASTY.atkDefPerStar;
  const mult = (id) => 1 + levelOf(state, id) * UPGRADES[id].magnitude;

  const powers = {};
  for (const id of POWER_IDS) powers[id] = levelOf(state, id);

  return {
    atk: PLAYER_BASE.atk * mult('steel') * perks.atk * starAtkDef,
    def: PLAYER_BASE.def * mult('armour') * perks.def * starAtkDef,
    growth: PLAYER_BASE.growth * mult('recruitment') * perks.growth,
    speed: PLAYER_BASE.speed * mult('logistics') * perks.speed * works.speedMult,
    campTroops: PLAYER_BASE.campTroops + levelOf(state, 'muster') * UPGRADES.muster.magnitude + works.campTroops,
    garrisonShare: PLAYER_BASE.garrisonShare,
    capBonus: PLAYER_BASE.capBonus,
    cooldownMult: perks.cooldownMult * works.cooldownMult,
    campVolleyLevel: works.campVolleyLevel, // Watchtowers next door: the War Camp looses arrows like a tower (CAMP_VOLLEY)
    campGrowthMult: works.campGrowthMult,       // Barracks next door: the War Camp's troops-per-second x this
    supplyIntervalMult: works.supplyIntervalMult, // Stables next door: supply lines fire this much sooner (x the interval)
    fieldStrengthMult: works.fieldStrengthMult,   // Stables next door: squads clash in the open this much stronger (the charge)
    worksCampTroops: works.campTroops,      // the part of campTroops that came from Barracks (the difficulty card credits only part of it)
    powers,
  };
}

// --- Enemy -----------------------------------------------------------------

const ladderCache = new WeakMap();
/**
 * Every region beyond the start gets a place on ONE difficulty ladder: sorted by tier (ties broken
 * by a hash of the world seed), evenly spaced from 0 (easiest) to 1 (hardest). Because the ladder is
 * spread over ranks, not tiers, a four-ring and a seven-ring world end equally hard, a world with six
 * first-ring regions does not hand out six trivial conquests, and every conquest is one small, regular
 * step up: no plateaus of similar regions that all flip at once, no cliff at the last few.
 */
function ladderPosition(world, region) {
  let map = ladderCache.get(world);
  if (!map) {
    const ranked = world.regions.filter((r) => r.tier >= 1)
      .map((r) => ({ id: r.id, tier: r.tier, h: hash32(world.seed, 'ladder', r.id) }))
      .sort((a, b) => a.tier - b.tier || a.h - b.h);
    map = new Map(ranked.map((r, i) => [r.id, ranked.length > 1 ? i / (ranked.length - 1) : 0]));
    ladderCache.set(world, map);
  }
  return map.get(region.id) ?? 0;
}

/**
 * How deep a region sits, as a fractional tier: the start region is 0; every other region is spread
 * evenly from 1 (the easiest, always a first-ring region: the tutorial fight) to the deepest rung of
 * ENEMY_SCALING.atkDefByTier by ladder rank.
 * @returns {number}
 */
export function enemyDepth(world, region) {
  const tier = Math.max(0, region.tier);
  if (tier <= 0) return 0;
  const span = ENEMY_SCALING.atkDefByTier.length - 2;
  return 1 + span * Math.pow(ladderPosition(world, region), ENEMY_SCALING.ladderCurve);
}

/** Table lookup with linear interpolation between tiers (tier may be fractional). */
function tableAt(table, x) {
  const i = Math.max(0, Math.min(table.length - 1, x));
  const lo = Math.floor(i);
  const hi = Math.min(table.length - 1, lo + 1);
  return table[lo] + (table[hi] - table[lo]) * (i - lo);
}

/**
 * True once the player holds `factionId`'s capital region (DESIGN §3.3
 * decapitation: -30% strength to the rest of that faction's regions).
 */
function isDecapitated(state, world, factionId) {
  const faction = world.factions[factionId];
  if (!faction || faction.capitalRegion == null || faction.capitalRegion < 0) return false;
  return state.owner[faction.capitalRegion] === PLAYER_FACTION;
}

/**
 * @param {import('../world/generate.js').World} world
 * @param {import('./state.js').GameState} state
 * @param {number} regionId
 * @returns {import('../battle/sim.js').EnemyStats}
 */
export function enemyBattleStats(world, state, regionId) {
  const region = world.regions[regionId];
  const faction = world.factions[region.faction];
  const tier = Math.max(0, region.tier);

  const decapitated = isDecapitated(state, world, region.faction);
  const done = Math.max(0, state.dynasty.level - 1); // dynasties completed
  const dynastyMult = done === 0 ? 1 : DYNASTY.enemyMultFirst * Math.pow(DYNASTY.enemyMultPerDynasty, done - 1);

  // Depth: the tutorial ring keeps its plain tier; every other region's DEPTH is its place on the
  // world's difficulty ladder (ladderPosition), a fractional tier from 2 to the deepest one in the
  // scaling table. Troops, regrowth and per-troop attack/defence all scale with depth, so one
  // conquest is always one small step up instead of a wall at every tier boundary.
  const atkDefTable = ENEMY_SCALING.atkDefByTier;
  const depth = enemyDepth(world, region);

  let troopMult = ENEMY_SCALING.troopAtDepth1 * Math.pow(ENEMY_SCALING.troopPerTier, depth - 1) * dynastyMult;
  if (faction.personality === 'passive') troopMult *= ENEMY_SCALING.freeFolkTroopMult;
  if (region.isCapital) troopMult *= ENEMY_SCALING.capitalMult;
  if (decapitated) troopMult *= ENEMY_SCALING.decapitationMult;
  troopMult *= sabotageTroopMult(state, regionId); // DESIGN §5.7: 1, 0.85, 0.70 (garrisons only: growth, atk and def stay)

  const growth = Math.pow(ENEMY_SCALING.growthPerTier, depth)
    * (faction.personality === 'passive' ? BATTLE.freeFolkGrowthMult : 1);

  // Settlement caps (DESIGN §4.6): deeper regions hold more, capitals a little more, Free Folk less. The arena
  // stamps this on every enemy-side site (neutral Free Folk hamlets in a rival region get freeFolkCapMult).
  const capMult = Math.pow(ENEMY_SCALING.capPerDepth, Math.max(0, depth - 1)) * dynastyMult
    * (region.isCapital ? ENEMY_SCALING.capitalCapMult : 1)
    * (faction.personality === 'passive' ? ENEMY_SCALING.freeFolkCapMult : 1);

  const graceTable = ENEMY_SCALING.graceSecByTier;
  const graceSec = Math.max(ENEMY_SCALING.graceFloorSec, graceTable[Math.min(tier, graceTable.length - 1)]
    * (region.isCapital ? ENEMY_SCALING.capitalGraceMult : 1));

  const thinkTable = ENEMY_SCALING.thinkSecByTier;
  const thinkSec = thinkTable[Math.min(tier, thinkTable.length - 1)];

  // Gentle factions' garrisons are worth less per troop than a rival AI's at equal size (the bot
  // measured it), so they hit/hold a little harder from tier 2 on to keep the difficulty curve
  // continuous across the Free Folk -> rival border (the tier-1 ring stays untouched).
  const personalityStat = tier >= 2 ? (ENEMY_SCALING.personalityStat[faction.personality] ?? 1) : 1;
  // Every region is a little stronger or weaker than its tier says (deterministic per world), so
  // regions of one tier do not all flip from Hard to Fair on the same purchase.
  // (Not in the tutorial ring: tier 1 stays tight so the first battle reads the same on every seed.)
  const jitterAmp = tier >= 2 ? ENEMY_SCALING.regionJitter : 0;
  const jitter = 1 + jitterAmp * ((2 * hash32(world.seed, 'strength', regionId)) / 4294967296 - 1);
  const atkDef = tableAt(atkDefTable, depth) * personalityStat * jitter
    * (region.isCapital ? ENEMY_SCALING.capitalStat : 1); // the throne rooms are the finale

  return {
    atk: atkDef,
    def: atkDef,
    growth,
    speed: 1,
    troopMult,
    capMult,
    thinkSec,
    graceSec,
    personality: faction.personality,
    factionId: region.faction,
  };
}

// --- Map state ---------------------------------------------------------------

/**
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @returns {number[]} region ids not owned by the player, adjacent to one that is
 */
export function frontier(state, world) {
  const owned = (id) => state.owner[id] === PLAYER_FACTION;
  const out = [];
  for (const region of world.regions) {
    if (owned(region.id)) continue;
    if (region.neighbors.some(owned)) out.push(region.id);
  }
  return out;
}

/**
 * Can the player attack this region right now? False when it is the player's own, or when no arena can be built for it:
 * the border it shares with the player's land is mountains and no passable strip of at most BATTLE.corridorMaxTiles tiles
 * leads round them (arena.js canBuildArena). The region card shows "No passable border: conquer a neighbour first" for a
 * frontier region that fails this, instead of Attack.
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @param {number} regionId
 * @returns {boolean}
 */
export function attackable(state, world, regionId) {
  return state.owner[regionId] !== PLAYER_FACTION && canBuildArena(world, state.owner, regionId);
}

/**
 * Why a region cannot be attacked, or null when it can: 'owned' | 'not-adjacent' | 'no-passable-border' | 'no-region'.
 * @returns {string|null}
 */
export function attackBlocker(state, world, regionId) {
  return arenaBlockedReason(world, state.owner, regionId);
}

/**
 * `frontier()` without the regions whose border is only mountains (see `attackable`): the ones the player can actually attack.
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @returns {number[]}
 */
export function attackableFrontier(state, world) {
  return frontier(state, world).filter((id) => canBuildArena(world, state.owner, id));
}

/**
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @returns {boolean[]} per region id: owned, or adjacent to an owned region
 */
export function revealed(state, world) {
  const owned = world.regions.map((r) => state.owner[r.id] === PLAYER_FACTION);
  return world.regions.map((region) => owned[region.id] || region.neighbors.some((n) => owned[n]));
}

/**
 * Flips a region to the player, pays its bounty and updates conquest stats.
 * Does NOT touch battlesWon/battlesLost/surrenders/settlementsTaken/troopsSent
 * — those are per-battle counters the integration layer owns, since this
 * function is also the one called for an instant surrender (DESIGN §5.3),
 * which never runs a battle at all.
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @param {number} regionId
 * @param {number} now
 * @returns {{ bounty: number, perk: string, decapitated?: true }}
 */
export function conquer(state, world, regionId, now) {
  const region = world.regions[regionId];
  const gold = bounty(state, world, regionId);

  state.owner[regionId] = PLAYER_FACTION;
  state.conqueredAt[regionId] = now;
  clearRegionIntel(state, regionId); // a conquered region forgets what was scouted or sabotaged (DESIGN §5.7)
  state.gold += gold;
  state.stats.goldEarned += gold;
  state.stats.regionsConquered += 1;

  const result = { bounty: gold, perk: region.perk };
  if (region.isCapital) result.decapitated = true;
  return result;
}

// --- Difficulty readout (DESIGN §5.3) ---------------------------------------

/** What the owned powers are worth: each unlocked power adds its weight (Levy is worth several
 * Rallies in a fight, Bulwark less than one), a little more per level past the first. */
function powerUnits(player) {
  let n = 0;
  for (const id of POWER_IDS) {
    const level = player.powers[id];
    if (level > 0) n += (DIFFICULTY.powerWeight[id] ?? 1) * (1 + DIFFICULTY.powerLevelWeight * (level - 1));
  }
  return n;
}

const FREE_FOLK_FACTION = 1;

/**
 * Troops the player's own settlements near `region` add to the fight: every settlement in an
 * owned region within BATTLE.arenaPlayerDepth hexes of the target joins the arena with
 * garrisonShare x its cap (buildArena's rule). Needs tile geometry; a world without tiles (a
 * unit-test fixture) has no border garrisons to count.
 */
function supportTroops(state, world, region, player) {
  if (!world.tiles || world.tiles.length === 0) return 0;
  const depth = BATTLE.arenaPlayerDepth;
  const pad = depth * 1.8 + 1;
  const b = region.bbox;
  let cells = null;
  let sum = 0;
  for (const settlement of world.settlements) {
    if (state.owner[settlement.region] !== PLAYER_FACTION) continue;
    const t = world.tiles[settlement.tile];
    if (!t || t.x < b.minX - pad || t.x > b.maxX + pad || t.y < b.minY - pad || t.y > b.maxY + pad) continue;
    if (!cells) cells = region.tiles.map((i) => world.tiles[i]);
    let near = false;
    for (const c of cells) {
      if (hexDistance(t.q, t.r, c.q, c.r) <= depth) { near = true; break; }
    }
    if (near) sum += DIFFICULTY.supportWeight * Math.max(player.garrisonShare * (SITE_TYPES[settlement.type].cap + player.capBonus), BATTLE.playerGarrisonFloor);
  }
  return sum;
}

/**
 * Army Power: everything the player can bring — War Camp plus border garrisons — scaled by
 * attack x defence, growth (production over the fight) and the unlocked powers.
 * Fitted against bot-vs-AI battles by tools/balance.mjs (see DIFFICULTY in config/meta.js).
 */
function estimatePower(state, world, region, player) {
  const troops = player.campTroops - (1 - DIFFICULTY.worksCampCredit) * (player.worksCampTroops || 0)
    + supportTroops(state, world, region, player);
  return troops * player.atk * player.def * Math.pow(player.growth, DIFFICULTY.growthExp)
    * (1 + DIFFICULTY.powerBonusPerUnlocked * powerUnits(player))
    * (1 + DIFFICULTY.volleyPerLevel * (player.campVolleyLevel || 0))
    * (1 + DIFFICULTY.campGrowthCredit * ((player.campGrowthMult || 1) - 1))
    * (1 + DIFFICULTY.supplyCredit * (1 / (player.supplyIntervalMult || 1) - 1))
    * (1 + DIFFICULTY.fieldCredit * ((player.fieldStrengthMult || 1) - 1))
    * (1 + DIFFICULTY.cooldownCredit * (1 / (player.cooldownMult || 1) - 1));
}

/**
 * Region Strength: what its garrisons are worth in a real fight. Troops above a site's cap bleed
 * off within seconds, so only DIFFICULTY.overCapCredit x cap counts; a garrison also regrows
 * while you fight, worth DIFFICULTY.horizonSec seconds of production; and each faction's AI
 * plays a little differently (DIFFICULTY.personality). Neutral Free Folk hamlets inside a rival
 * region are base-stat troops, exactly as buildArena places them.
 */
function estimateStrength(world, region, enemy) {
  const rival = enemy.factionId !== FREE_FOLK_FACTION;
  let sum = 0;
  for (const siteId of region.settlements) {
    const type = world.settlements[siteId].type;
    const cfg = SITE_TYPES[type];
    if (!cfg) continue;
    const neutral = rival && type === 'hamlet';
    const mult = neutral ? 1 : enemy.troopMult;
    const unit = neutral ? 1 : enemy.atk * enemy.def;
    const growth = cfg.growth * (neutral ? BATTLE.freeFolkGrowthMult : enemy.growth);
    const cap = cfg.cap * (neutral ? ENEMY_SCALING.freeFolkCapMult : (enemy.capMult ?? 1));
    const start = Math.min((BATTLE.enemyStart[type] ?? 0) * mult, DIFFICULTY.overCapCredit * cap);
    sum += (start + growth * DIFFICULTY.horizonSec) * cfg.def * unit;
  }
  return sum * DIFFICULTY.strengthScale * (DIFFICULTY.personality[enemy.personality] ?? 1)
    * Math.pow(DIFFICULTY.depthPerTier, Math.max(0, region.tier - 3))
    * (DIFFICULTY.tierFactor[region.tier] ?? 1);
}

/** The label bands as { label, min (ratio), lo, hi (win chance) }, best first; built once from ECONOMY and DIFFICULTY. */
const WIN_BANDS = (() => {
  const [floor, ceil] = DIFFICULTY.winChanceRange;
  const labels = ECONOMY.difficultyLabels; // best first, the last one has min 0
  return labels.map((entry, i) => ({
    label: entry.label,
    min: entry.min,
    lo: i === labels.length - 1 ? floor : DIFFICULTY.winAtLabelEdge[entry.label],
    hi: i === 0 ? ceil : DIFFICULTY.winAtLabelEdge[labels[i - 1].label],
  }));
})();
/** The anchors (ratio at a label's lower edge, the win chance promised there), worst first, and the logit slope of each gap. */
const WIN_ANCHORS = WIN_BANDS.filter((b) => b.min > 0).reverse().map((b) => ({ ratio: b.min, logit: Math.log(b.lo / (1 - b.lo)) }));
const WIN_SLOPES = WIN_ANCHORS.slice(1).map((a, i) => (a.logit - WIN_ANCHORS[i].logit) / Math.log(a.ratio / WIN_ANCHORS[i].ratio));

/**
 * The estimated chance of winning a fight, 0..1, from the card's ratio (power / strength): what the region card's bar shows
 * (DESIGN §5.3). Monotonic in the ratio and clamped to DIFFICULTY.winChanceRange. It agrees with the label at every edge: the
 * chance is 0.85 at the Easy edge (ratio 1.55) and above it for Easy, 0.60..0.85 for Fair, 0.35..0.60 for Hard and under 0.35 for
 * Deadly; a ratio just under an edge reads just under the band's lower value. Calibrated on real campaign states (see
 * DIFFICULTY.winAtLabelEdge). One curve serves every rival: the card's personality and tier factors already put each of them on
 * the same ratio scale (the measured curves of the four personalities lie within 6 points of this one).
 * @param {number} ratio  power / strength; 0, negatives and NaN read as hopeless, Infinity as certain
 * @returns {number}
 */
export function winChance(ratio) {
  const [floor, ceil] = DIFFICULTY.winChanceRange;
  if (!(ratio > 0)) return floor;
  if (ratio === Infinity) return ceil;
  const band = WIN_BANDS.find((b) => ratio >= b.min) || WIN_BANDS[WIN_BANDS.length - 1];
  // the segment this ratio lies on (the outermost ones are extended past the first and last anchor)
  let seg = WIN_SLOPES.length - 1;
  for (let i = 1; i < WIN_ANCHORS.length; i++) if (ratio < WIN_ANCHORS[i].ratio) { seg = i - 1; break; }
  const anchor = WIN_ANCHORS[seg];
  const logit = anchor.logit + WIN_SLOPES[seg] * Math.log(ratio / anchor.ratio);
  const p = 1 / (1 + Math.exp(-logit));
  // inside the label's own band, whatever rounding does at the edges (a ratio exactly on an edge belongs to the better label)
  return Math.min(Math.max(p, band.lo), band.hi === ceil ? ceil : band.hi - 1e-9);
}

function labelFor(ratio) {
  for (const entry of ECONOMY.difficultyLabels) {
    if (ratio >= entry.min) return entry.label;
  }
  return ECONOMY.difficultyLabels[ECONOMY.difficultyLabels.length - 1].label;
}

/**
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @param {number} regionId
 * @returns {{ power: number, strength: number, ratio: number, label: string, surrender: boolean, approach: number, winChance: number }}
 *   `winChance`: the estimated chance of winning, 0..1 (see `winChance(ratio)`), what the card's bar shows
 *   `approach`: tiles of the War Camp's approach strip (0 for an ordinary border; the card charges for them)
 */
export function difficulty(state, world, regionId) {
  const region = world.regions[regionId];
  const player = playerBattleStats(state, world, regionId);
  const enemy = enemyBattleStats(world, state, regionId);

  const power = estimatePower(state, world, region, player);
  // a border of mountains puts the War Camp behind a strip of no-man's-land: those fights play harder (DIFFICULTY.approachPerTile)
  const approach = approachTiles(world, state.owner, regionId) || 0;
  const strength = estimateStrength(world, region, enemy) * (1 + DIFFICULTY.approachPerTile * approach);
  const ratio = strength > 0 ? power / strength : Infinity;

  // Surrender is a reward for a proven army: never offered before the first battle is won, so the
  // tutorial fight always happens (DESIGN §5.3).
  const surrender = ratio >= ECONOMY.surrenderRatio && state.stats.battlesWon > 0;

  return { power, strength, ratio, label: labelFor(ratio), surrender, approach, winChance: winChance(ratio) };
}

// --- Perks (UI display) ------------------------------------------------------

/**
 * UI-facing summary of every perk bonus the player currently holds, for
 * realm.js/regionCard.js. See perks.js for the raw aggregation.
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 */
export function perkTotals(state, world) {
  const { totals, counts, throneDetail } = perkAccumulate(state, world);
  return { totals, counts, throneDetail, multipliers: perkMultipliers(state, world) };
}

// --- Dynasty prestige (DESIGN §5.4) -----------------------------------------

/** @param {import('./state.js').GameState} state */
export function canFoundDynasty(state) {
  return state.owner.length > 0 && state.owner.every((f) => f === PLAYER_FACTION);
}

/**
 * Founds the next dynasty: keeps dynasty stars (plus the newly earned batch),
 * lifetime stats and settings; resets gold, upgrades, tutorial and the
 * in-progress battle. Matches ARCHITECTURE §5's `foundDynasty(state, newSeed)`
 * exactly; `world` is an OPTIONAL third argument — pass the freshly
 * generated continent for `newSeed` if you already have it and this call
 * will populate `owner`/`conqueredAt` for you via resetRegions(). If you
 * don't have it yet, omit it: owner/conqueredAt come back empty and you must
 * call `resetRegions(state, newWorld, now)` yourself once the new world
 * exists (DESIGN says the new continent is "slightly larger", so it cannot
 * be generated until this call decides there IS a next dynasty).
 * @param {import('./state.js').GameState} state
 * @param {number} newSeed
 * @param {import('../world/generate.js').World} [world]
 * @returns {import('./state.js').GameState|false}
 */
export function foundDynasty(state, newSeed, world) {
  if (!canFoundDynasty(state)) return false;

  const earned = DYNASTY.starBase + state.dynasty.level;
  const next = {
    ...state,
    seed: newSeed,
    dynasty: { level: state.dynasty.level + 1, stars: state.dynasty.stars + earned },
    gold: 0,
    owner: [],
    conqueredAt: [],
    upgrades: { rally: 1 },
    settings: { ...state.settings },
    stats: { ...state.stats },
    tutorial: { ...state.tutorial, done: true },
    battle: null,
    // per-continent state starts empty (resetRegions would do it too; this keeps the interim state clean)
    intel: {},
    crowns: [],
    metFactions: [],
    prosperity: [],
  };
  return world ? resetRegions(next, world, state.lastSeen) : next;
}
