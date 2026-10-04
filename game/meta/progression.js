// Battle-stat derivation, conquest, the difficulty readout and dynasty
// prestige (DESIGN §3.3, §4.6, §5.3, §5.4; ARCHITECTURE §5, §6). Pure: no
// DOM, no Date.now, no Math.random, no storage globals.

import { PLAYER_BASE, DYNASTY, ECONOMY, DIFFICULTY } from '../config/meta.js';
import { ENEMY_SCALING, BATTLE, SITE_TYPES } from '../config/battle.js';
import { PLAYER_FACTION, resetRegions } from './state.js';
import { UPGRADES, POWER_IDS, levelOf, upgradeCost } from './upgrades.js';
import { perkMultipliers, perkAccumulate } from './perks.js';
import { bounty } from './economy.js';
import { worksBattleEffects, NO_WORKS_EFFECTS } from './worksEffects.js'; // the leaf: works.js imports this file
import { hexDistance } from '../core/hex.js';
import { hash32 } from '../core/rng.js';
import { canBuildArena, arenaBlockedReason, approachTiles } from '../battle/arena.js';
import { sabotageTroopMult, clearRegionIntel, isScouted } from './intelState.js'; // the dependency-free leaf: intel.js imports this file
import { occupationOf, retake, ensureFrontier, defaultFrontier } from './frontierState.js'; // the Living Frontier's leaf: frontier.js imports this file
import { fortEffects } from './fortsEffects.js';
import { FRONTIER } from '../config/frontier.js';
import { RENOWN } from '../config/renown.js';
import { generalById, commanderEffects, recruitChampion, ensureGenerals } from './generalsState.js';
import { rivalsFor } from './rivals.js';
import { GENERALS } from '../config/generals.js';
import { earnRenown, defaultRenown } from './renownState.js';
import { typeBountyMult, typeRewards, ensureBoons, defaultBoons } from './featuresState.js';
import { plagueMult, defaultWorldEvents } from './eventsState.js';
import { FEATURES } from '../config/features.js';
import { deedBonuses, recordDeed } from './deeds.js';
import { projectedStreakMultiplier, onStreakConquest, defaultStreak } from './streak.js';
import { addGrudge, trophyBonus, defaultGrudges, defaultTrophies } from './grudges.js';
import { defaultBounties } from './bountiesState.js';
import { edictMods, defaultEdict, isEdictId } from './edicts.js'; // the leaf (PLAN-PHASE5): Edicts, Challenges and Legacy, one modifier source
import { ensureLegacy, legacyPointsForFounding, cleanChallenges, buyLegacy } from './legacy.js';
import { CHALLENGES } from '../config/edicts.js';

/** The roster for a new dynasty: every General keeps level, XP and skills; where they last fought is forgotten. */
function carryGenerals(state) {
  const g = structuredClone(ensureGenerals(state));
  for (const x of g.roster) x.regionId = null;
  return g;
}

// --- Player --------------------------------------------------------------

/**
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @param {number} [targetRegionId] the region about to be fought over: the Works of the owned regions next to it (Region
 *   Works, DESIGN §5.8) join the army. Leave it out for a stat block that belongs to no particular battle.
 * @param {{ commander?: object|string|null }} [opts] the General commanding this battle (DESIGN §10.11): a General or its id. Its
 *   passive (with level and skills) is folded in and its ability is set on `ability`; none (the Militia Captain) adds nothing.
 * @returns {import('../battle/sim.js').PlayerStats}
 */
export function playerBattleStats(state, world, targetRegionId, opts = {}) {
  const perks = perkMultipliers(state, world);
  const em = edictMods(state); // PLAN-PHASE5: the Edict, the Challenges and the Legacy nodes
  const general = opts && opts.commander && !em.forceCaptain ? generalById(state, opts.commander) : null; // Lone Banner: the Militia Captain
  const dragonscale = state.boons && state.boons.dragonscale ? 1 + em.dragonscaleAtk : 1; // Age of Dragons: Dragonscale +10% attack
  const cmd = commanderEffects(general);
  const works = targetRegionId == null ? NO_WORKS_EFFECTS : worksBattleEffects(state, world, targetRegionId);
  const starAtkDef = 1 + state.dynasty.stars * DYNASTY.atkDefPerStar;
  const mult = (id) => 1 + levelOf(state, id) * UPGRADES[id].magnitude;
  // Phase 4 (PLAN-PHASE4 §4C, §4D): the Deeds' settlement defence, and against the target's owner the Kingbreaker deed and Trophies
  const deeds = deedBonuses(state);
  const foe = targetRegionId == null ? null : targetFaction(state, world, targetRegionId);
  const vsFoe = foe == null ? 1 : (deeds.attackVs[foe] ?? 1) * trophyBonus(state, foe);

  const powers = {};
  for (const id of POWER_IDS) powers[id] = levelOf(state, id);

  let ability = cmd.ability;
  if (ability && em.noAbility) ability = null;
  else if (ability && em.abilityUses > 1) ability = { ...ability, uses: em.abilityUses }; // Warrior Kings: twice per battle

  const out = {
    atk: PLAYER_BASE.atk * mult('steel') * perks.atk * starAtkDef * vsFoe * em.atkMult * dragonscale,
    def: PLAYER_BASE.def * mult('armour') * perks.def * starAtkDef,
    growth: PLAYER_BASE.growth * mult('recruitment') * perks.growth,
    speed: PLAYER_BASE.speed * mult('logistics') * perks.speed * works.speedMult * cmd.speedMult * em.speedMult, // Swift Banners
    campTroops: (PLAYER_BASE.campTroops + levelOf(state, 'muster') * UPGRADES.muster.magnitude + works.campTroops) * cmd.campTroopsMult * em.campTroopsMult, // Veteran Camp
    garrisonShare: PLAYER_BASE.garrisonShare,
    capBonus: PLAYER_BASE.capBonus,
    cooldownMult: perks.cooldownMult * works.cooldownMult * cmd.cooldownMult * em.powerCooldownMult, // Warrior Kings +50%, Warlord -15%
    garrisonMult: cmd.garrisonMult * deeds.defenceMult, // the commander's passive (Marshal) x the Warden deed: the player's garrisons defend x this
    assaultMult: cmd.assaultMult,         // the commander's passive: squads assaulting a settlement x this (Champion)
    reclaim: cmd.reclaim,                 // the Gravewarden's passive (PLAN-PHASE6, battle/fallen.js): share of attackers' dead joining your settlement
    ability,                              // the commander's active (battle/abilities.js; `uses` > 1 under Warrior Kings), null with no General
    commander: general ? general.id : null,
    campVolleyLevel: works.campVolleyLevel, // Watchtowers next door: the War Camp looses arrows like a tower (CAMP_VOLLEY)
    campGrowthMult: works.campGrowthMult,       // Barracks next door: the War Camp's troops-per-second x this
    supplyIntervalMult: works.supplyIntervalMult, // Stables next door: supply lines fire this much sooner (x the interval)
    fieldStrengthMult: works.fieldStrengthMult,   // Stables next door: squads clash in the open this much stronger (the charge)
    worksCampTroops: works.campTroops,      // the part of campTroops that came from Barracks (the difficulty card credits only part of it)
    powers,
  };
  if (em.noPowers) out.powersBlocked = 'ironWill'; // Iron Will: battle/powers.js refuses every power
  return out;
}

/** The rival faction a battle for `regionId` is fought against: its occupier, else its owner; null for the player's own region. */
function targetFaction(state, world, regionId) {
  const occ = occupationOf(state, regionId);
  if (occ) return occ.by;
  const owner = state.owner[regionId];
  if (owner == null || owner === PLAYER_FACTION) return null;
  return owner;
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
 * Holy Ground (DESIGN §10.13) takes the powers away, which late in a realm are most of an army's worth (the card's power bonus).
 * Its garrisons and caps shrink by the same factor, so the fight plays differently without walling the campaign:
 * 1 / (1 + powerBonusPerUnlocked x power units) x FEATURES.holy.garrison, never below FEATURES.holy.floor.
 */
function holyGarrisonMult(state) {
  const powers = {};
  for (const id of POWER_IDS) powers[id] = levelOf(state, id);
  return Math.max(FEATURES.holy.floor, FEATURES.holy.garrison / (1 + DIFFICULTY.powerBonusPerUnlocked * powerUnits({ powers })));
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
  // An occupied region (DESIGN §10.2) is held by its occupier: that faction's personality fights for it, on the region's own rung.
  const occ = occupationOf(state, regionId);
  const factionId = occ ? occ.by : region.faction;
  const faction = world.factions[factionId] || world.factions[region.faction];
  const tier = Math.max(0, region.tier);

  const decapitated = isDecapitated(state, world, factionId);
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
  troopMult *= plagueMult(state, factionId); // a Plague on the faction (DESIGN §10.13): -20% for a while
  const holy = region.twist === 'holy' ? holyGarrisonMult(state) : 1; // Holy Ground: no powers, garrisons smaller in proportion
  troopMult *= holy;
  const em = edictMods(state);
  troopMult *= em.enemyGarrisonMult; // Open Roads +10%, the Overrun Challenge x1.4 (PLAN-PHASE5)

  const growth = Math.pow(ENEMY_SCALING.growthPerTier, depth)
    * (faction.personality === 'passive' ? BATTLE.freeFolkGrowthMult : 1);

  // Settlement caps (DESIGN §4.6): deeper regions hold more, capitals a little more, Free Folk less. The arena
  // stamps this on every enemy-side site (neutral Free Folk hamlets in a rival region get freeFolkCapMult).
  const capMult = Math.pow(ENEMY_SCALING.capPerDepth, Math.max(0, depth - 1)) * dynastyMult
    * (region.isCapital ? ENEMY_SCALING.capitalCapMult : 1)
    * (faction.personality === 'passive' ? ENEMY_SCALING.freeFolkCapMult : 1)
    * holy; // Holy Ground: smaller garrisons and caps

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
    factionId,
    // PLAN-PHASE5, read by battle/arena.js: Merchant Princes' towers and forts, Kingmaker's capital Gates, Age of Dragons' Dragon
    fortTroopMult: em.enemyFortTroopMult,
    gateTroopMult: region.isCapital ? em.capitalGateTroopMult : 1,
    dragonHpMult: em.dragonHpMult,
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
 * The gold `conquer` pays for this region right now: the conquest bounty, or, for an occupied region of yours (DESIGN 10.2), the retake share of it
 * (it was the player's already). The ONE place the payout is computed: the region card and the results card read it too.
 */
export function conquestBounty(state, world, regionId) {
  const occupied = occupationOf(state, regionId) !== null;
  // a Gold Mine pays x3, a Bandit Hold x2 the first time it is taken (DESIGN §10.13)
  // x the Conquest Streak the win would make (PLAN-PHASE4 §4B: gold only; the card shows what the next win pays)
  // PLAN-PHASE5: Merchant Princes x2 (not a retake: that was already the player's), Age of Dragons' Lair rewards x2
  const em = edictMods(state);
  const region = world.regions[regionId];
  const edict = occupied ? 1 : em.bountyMult * (region && region.type === 'dragon' ? em.dragonRewardMult : 1);
  return bounty(state, world, regionId) * (occupied ? FRONTIER.reward.retakeBountyShare : typeBountyMult(region))
    * projectedStreakMultiplier(state) * edict;
}

/**
 * Whether winning this region now pays crowns: a region keeps the crowns it was first won with (crowns.js awardCrowns pays nothing when the region
 * already has some), so a retaken region that holds crowns earns none again.
 */
export function crownsPayable(state, regionId) {
  return !(Array.isArray(state.crowns) && state.crowns[regionId]);
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
export function conquer(state, world, regionId, now, opts = {}) {
  const region = world.regions[regionId];
  const occupied = occupationOf(state, regionId) !== null;
  const share = opts && Number.isFinite(opts.bountyShare) ? Math.max(0, opts.bountyShare) : 1; // Quick Conquest pays part (PLAN-PHASE5 §5D)
  const gold = conquestBounty(state, world, regionId) * share; // a retake pays its share (DESIGN §10.2)
  const loser = state.owner[regionId];

  state.owner[regionId] = PLAYER_FACTION;
  state.conqueredAt[regionId] = now;
  clearRegionIntel(state, regionId); // a conquered region forgets what was scouted or sabotaged (DESIGN §5.7)
  state.gold += gold;
  state.stats.goldEarned += gold;
  if (!occupied) state.stats.regionsConquered += 1;
  // Taking a region from a rival provokes it (a defensive faction raids mostly after you take one of theirs, DESIGN §10.1)
  if (loser > 1) {
    const f = ensureFrontier(state);
    f.provoked[loser] = f.activeSec;
  }

  const result = { bounty: gold, perk: region.perk };
  if (region.isCapital) result.decapitated = true;
  result.streak = onStreakConquest(state); // PLAN-PHASE4 §4B: { count, mult } (the gold above already carries the mult)
  // a rival leader's Grudge (PLAN-PHASE4 §4D): +12 for a region, +40 for the capital
  if (loser > 1) {
    const g = addGrudge(state, loser, region.isCapital && region.faction === loser ? 'capital' : 'region', now);
    if (g) result.grudge = { faction: loser, value: g.value, crossed: g.crossed };
  }
  // Deeds (PLAN-PHASE4 §4C): regions conquered (not retakes), a Dragon slain, a rival capital toppled
  if (!occupied) recordDeed(state, 'conquer', 1);
  if (!occupied && region.type === 'dragon') recordDeed(state, 'dragon', 1);
  if (region.isCapital && !occupied && loser > 1) recordDeed(state, `capital:${region.faction}`, 1);
  // Toppling a rival capital (not a retake of one) recruits its faction's champion and pays Renown (DESIGN §10.11, §10.12)
  // A region type's Renown (Monastery 3, Bandit Hold 2, Ruins 5, the Dragon 10 and Dragonscale; DESIGN §10.13), once
  const rewards = typeRewards(region);
  if (rewards && !occupied) {
    const dragonMult = region.type === 'dragon' ? edictMods(state).dragonRewardMult : 1; // Age of Dragons: Dragon rewards x2
    result.renown = (result.renown || 0) + earnRenown(state, (rewards.renown || 0) * dragonMult, 'feature');
    if (region.type === 'dragon') { ensureBoons(state).dragonscale = true; result.dragonscale = true; }
    result.type = region.type;
  }
  if (region.isCapital && !occupied && loser > 1) {
    const champion = recruitChampion(state, region.faction);
    if (champion) result.recruited = champion.id;
    result.renown = (result.renown || 0) + earnRenown(state, RENOWN.earn.capital, 'capital');
  }
  // Long Winter (PLAN-PHASE5 §5A): +Renown for every Blizzard region won (not a retake)
  const winter = edictMods(state).blizzardRenown;
  if (winter > 0 && region.twist === 'blizzard' && !occupied) result.renown = (result.renown || 0) + earnRenown(state, winter, 'feature');
  if (occupied) {
    const back = retake(state, world, regionId, now); // restores prosperity, fortifications, Works and a thin militia
    result.retaken = true;
    result.renown = (result.renown || 0) + (back ? back.renown : 0);
  }
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
  const holy = region.twist === 'holy' || !!player.powersBlocked; // Holy Ground (DESIGN §10.13) or Iron Will (PLAN-PHASE5): no powers in this fight
  return troops * player.atk * player.def * Math.pow(player.growth, DIFFICULTY.growthExp)
    * (1 + DIFFICULTY.powerBonusPerUnlocked * (holy ? 0 : powerUnits(player)))
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
/** What a region's feature sites add to its strength (the arena places them: arena.js addFeatureSites). */
function featureStrength(region, enemy, siteValue) {
  const tm = enemy.troopMult;
  const unit = enemy.atk * enemy.def;
  const capped = (type, troops) => {
    const cfg = SITE_TYPES[type];
    const cap = cfg.cap * (enemy.capMult ?? 1);
    return (Math.min(troops, DIFFICULTY.overCapCredit * cap) + cfg.growth * enemy.growth * DIFFICULTY.horizonSec) * cfg.def * unit;
  };
  let sum = 0;
  if (region.type === 'bandit') sum += capped('bandit', FEATURES.bandit.troops * tm) * FEATURES.bandit.vet * FEATURES.bandit.vet;
  if (region.type === 'ruins') sum += capped('tower', FEATURES.ancientTower.troops * tm) * (1 + FRONTIER.occupation.towerCredit * 3);
  if (region.twist === 'siege') sum += capped('gate', FEATURES.gate.troops * tm * (enemy.gateTroopMult ?? 1)); // Kingmaker
  if (region.twist === 'raid') sum += capped('shrine', FEATURES.shrine.troops * tm) * FEATURES.shrine.count;
  if (region.type === 'dragon') sum += FEATURES.dragon.hp * tm * (enemy.dragonHpMult ?? 1) * FEATURES.difficulty.dragonHpWeight; // Age of Dragons
  void siteValue;
  return sum;
}

/** The measured strength factor of a region's type and twist (FEATURES.difficulty; Night only while the region is unscouted). */
function featureFactor(region, scouted) {
  const d = FEATURES.difficulty;
  let k = 1;
  if (region.twist) k *= region.twist === 'night' && !scouted ? d.nightUnscouted : d[region.twist] ?? 1;
  if (region.type) k *= d[region.type] ?? 1;
  return k;
}

function estimateStrength(world, region, enemy, captured = null, scouted = false) {
  const rival = enemy.factionId !== FREE_FOLK_FACTION;
  let sum = 0;
  const siteValue = (type, neutral, defMult = 1) => {
    const cfg = SITE_TYPES[type];
    if (!cfg) return 0;
    const mult = neutral ? 1 : enemy.troopMult;
    const unit = neutral ? 1 : enemy.atk * enemy.def;
    const growth = cfg.growth * (neutral ? BATTLE.freeFolkGrowthMult : enemy.growth);
    const cap = cfg.cap * (neutral ? ENEMY_SCALING.freeFolkCapMult : (enemy.capMult ?? 1));
    const fortMult = !neutral && (type === 'tower' || type === 'fort') ? (enemy.fortTroopMult ?? 1) : 1; // Merchant Princes
    const start = Math.min((BATTLE.enemyStart[type] ?? 0) * mult * fortMult, DIFFICULTY.overCapCredit * cap);
    return (start + growth * DIFFICULTY.horizonSec) * cfg.def * defMult * unit;
  };
  for (const siteId of region.settlements) {
    const type = world.settlements[siteId].type;
    const walls = captured && (type === 'keep' || type === 'fort') ? captured.wallsMult : 1;
    sum += siteValue(type, rival && type === 'hamlet', walls);
  }
  // An occupied region's captured fortifications fight for the occupier (DESIGN §10.2): its Arrow Tower is one more tower site,
  // worth more per level (FRONTIER.occupation.towerCredit), and its Walls harden the keep and forts (above).
  if (captured && captured.towerLevel > 0) sum += siteValue('tower', false) * (1 + FRONTIER.occupation.towerCredit * captured.towerLevel);
  // A varied map (DESIGN §10.13): the feature sites, then a measured factor per type and twist (Night only while unscouted)
  sum += featureStrength(region, enemy, siteValue);
  sum *= featureFactor(region, scouted);
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
export function difficulty(state, world, regionId, opts = {}) {
  const region = world.regions[regionId];
  const player = playerBattleStats(state, world, regionId);
  const enemy = enemyBattleStats(world, state, regionId);

  // the commander (DESIGN §10.11; the card's "Commander: ..." choice): credited at its measured worth, GENERALS.cardCredit
  const general = opts && opts.commander && !edictMods(state).forceCaptain ? generalById(state, opts.commander) : null; // Lone Banner: no General to credit
  const vs = (GENERALS.cardCredit.vs && GENERALS.cardCredit.vs[enemy.personality]) ?? 1; // worth more against some rivals (swarm)
  const cmd = general ? 1 + (GENERALS.cardCredit.base + GENERALS.cardCredit.perLevel * (general.level - 1)) * vs : 1;
  const power = estimatePower(state, world, region, player) * cmd;
  // a border of mountains puts the War Camp behind a strip of no-man's-land: those fights play harder (DIFFICULTY.approachPerTile)
  const approach = approachTiles(world, state.owner, regionId) || 0;
  const occ = occupationOf(state, regionId);
  const captured = occ && occ.forts && occ.forts.length ? fortEffects(occ.forts) : null;
  const strength = estimateStrength(world, region, enemy, captured, isScouted(state, regionId)) * (1 + DIFFICULTY.approachPerTile * approach);
  const ratio = strength > 0 ? power / strength : Infinity;

  // Surrender is a reward for a proven army: never offered before the first battle is won, so the
  // tutorial fight always happens (DESIGN §5.3).
  // Old Alliances (PLAN-PHASE5 Legacy): Free Folk regions surrender at a lower ratio
  const ff = edictMods(state).freeFolkSurrender;
  const surrenderAt = ff > 0 && enemy.personality === 'passive' ? Math.min(ff, ECONOMY.surrenderRatio) : ECONOMY.surrenderRatio;
  const surrender = ratio >= surrenderAt && state.stats.battlesWon > 0;

  const out = { power, strength, ratio, label: labelFor(ratio), surrender, approach, winChance: winChance(ratio) };
  if (enemy.personality === 'undying') out.mechanic = 'fallen'; // PLAN-PHASE6: the card shows The Fallen Rise (meta/rivals.js fallenLine)
  return out;
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
/**
 * True when the continent is whole. With `world`, an unconquered Dragon's Lair does not count (DESIGN §10.13: an optional peak;
 * founding without it only forgoes its Renown and Dragonscale). Without `world` (the old signature) every region must be held.
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} [world] the CURRENT continent
 */
export function canFoundDynasty(state, world) {
  if (!(state.owner.length > 0)) return false;
  return state.owner.every((f, id) => f === PLAYER_FACTION || (world && world.regions[id] && world.regions[id].type === 'dragon'));
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
 * @param {import('../world/generate.js').World} [world] the NEW continent (optional, see above)
 * @param {import('../world/generate.js').World} [currentWorld] the continent being left: with it, an unconquered Dragon's Lair does not
 *   block founding (canFoundDynasty)
 * @returns {import('./state.js').GameState|false}
 */
export function foundDynasty(state, newSeed, world, currentWorld, choice = {}) {
  if (!canFoundDynasty(state, currentWorld)) return false;

  const earned = DYNASTY.starBase + state.dynasty.level;
  const legacyEarned = legacyPointsForFounding(state); // PLAN-PHASE5 §5B/§5C: the stars x the Challenge bonus of the dynasty completed
  const edictId = choice && isEdictId(choice.edict) ? choice.edict : null;
  const challenges = cleanChallenges(choice && choice.challenges);
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
    battles: [], // no battle crosses into a new continent (ARCHITECTURE 10.2)
    // per-continent state starts empty (resetRegions would do it too; this keeps the interim state clean)
    intel: {},
    crowns: [],
    metFactions: [],
    prosperity: [],
    // the Living Frontier is per continent too (ARCHITECTURE 10.2): the raid clock and its grace start over
    frontier: defaultFrontier(),
    occupation: {},
    forts: {},
    militia: {},
    // Renown belongs to the dynasty (DESIGN §10.12); the Generals' roster carries over (spread above), freed from the old map
    renown: defaultRenown(),
    boons: defaultBoons(),          // Dragonscale is this dynasty's (DESIGN §10.13)
    worldEvents: defaultWorldEvents(),
    generals: carryGenerals(state), // the lifetime Deeds ride inside it (meta/deeds.js)
    // Phase 4 (PLAN-PHASE4): the Bounty Board, the Conquest Streak, the Grudges and the Trophies start over; the Deeds are kept
    bounties: defaultBounties(),
    streak: defaultStreak(),
    grudges: defaultGrudges(),
    trophies: defaultTrophies(),
  };
  // Phase 5: this dynasty's Edict and Challenges; the lifetime Legacy (inside `generals`) gains the points founding pays
  next.edict = { ...defaultEdict(), id: edictId, challenges };
  next.rivals = rivalsFor(newSeed, next.dynasty.level); // PLAN-PHASE6 §6A: the new continent's rivals (worldOptsFor passes them on)
  const legacy = ensureLegacy(next);
  legacy.points += legacyEarned;
  legacy.pendingBonus = CHALLENGES.legacyBonus * challenges.length;
  // the ceremony's Legacy purchases (choice.legacyBuys), in order, after the points are credited: a refused one is skipped and reported
  const report = { legacyEarned, bought: [], refused: [] };
  for (const id of Array.isArray(choice && choice.legacyBuys) ? choice.legacyBuys : []) {
    const r = buyLegacy(next, id);
    if (r.ok) report.bought.push(id); else report.refused.push({ id, reason: r.reason });
  }
  Object.defineProperty(next, 'founding', { value: report, enumerable: false, configurable: true, writable: true }); // never saved
  applyLegacyStart(next); // after the buys: nodes bought in the ceremony count for this dynasty
  const startRenown = deedBonuses(next).renownAtDynastyStart + edictMods(next).startRenown; // the Dragonslayer deed and Patronage (resetRegions grants them again on its fresh record)
  if (startRenown > 0) earnRenown(next, startRenown, 'deed');
  return world ? resetRegions(next, world, state.lastSeen) : next;
}

/**
 * The Legacy start effects that need no world (PLAN-PHASE5 §5B), applied by foundDynasty to the new dynasty's state: War Chest (free
 * levels of the cheapest Army upgrade) and Royal Treasury (start gold). Old Roads and Patronage are resetRegions' (they need the world
 * or a fresh Renown record).
 */
function applyLegacyStart(next) {
  const em = edictMods(next);
  if (em.warChestLevels > 0) {
    const army = Object.values(UPGRADES).filter((u) => u.tab === 'army');
    const cheapest = army.reduce((a, u) => (upgradeCost(u.id, levelOf(next, u.id)) < upgradeCost(a.id, levelOf(next, a.id)) ? u : a));
    next.upgrades[cheapest.id] = levelOf(next, cheapest.id) + em.warChestLevels;
  }
  if (em.treasuryGoldSec > 0) next.gold += Math.round(em.treasuryGoldSec * ECONOMY.startRegionIncome * next.dynasty.level);
}
