// The Living Frontier (DESIGN §10, ARCHITECTURE §10.4): the raid scheduler, defense runs and their rewards, occupation and
// retaking, the away trickle and the defense odds for the UI. Pure: no DOM, no Date.now, no Math.random, no storage; time
// (`nowMs`, `activeDt`) is passed in and randomness comes from a seeded counter in `state.frontier.rng`.
//
// Integration calls (docs/briefs/frontier-hookup.md has the exact wiring):
//   tickFrontier(state, world, nowMs, activeDt)   every frame or second of ACTIVE play -> { announced, arrived }
//   defenseRunFor(state, world, raid, stats, opts) for each arrived raid -> a BattleRun for manager.start
//   defenseReward(state, world, run, 'win', nowMs) when a defense is won; occupy(...) when one is lost
//   resolveAway(state, world, awayMs, nowMs)       on return, after offlineEarnings
//   estimateDefense(state, world, regionId, raid)  the odds on the toast and the card
//   attackArenaOpts(state, world, regionId)        the opts for buildArena when the player attacks (busy + captured forts)
import { FRONTIER } from '../config/frontier.js';
import { RENOWN } from '../config/renown.js';
import { earnRenown } from './renownState.js';
import { generalById } from './generalsState.js';
import { boostedForts } from './featuresState.js';
import { GENERALS } from '../config/generals.js';
import { ENEMY_SCALING } from '../config/battle.js';
import { DYNASTY } from '../config/meta.js';
import { hash32 } from '../core/rng.js';
import { PLAYER_FACTION } from './state.js';
import { bounty } from './economy.js';
import { enemyDepth, playerBattleStats } from './progression.js';
import {
  ensureFrontier, occupationOf, occupy,
} from './frontierState.js';
import { fortsOf, regionFortEffects } from './fortsEffects.js';
import {
  militiaGarrisons, militiaTowerGarrison, militiaCapMult, militiaScale, militiaFill, drainMilitia, defenseLossFraction, depthTroopMult,
} from './militia.js';
import { buildDefenseArena, canBuildDefenseArena, busyKey, normalizeBusy } from '../battle/defenseArena.js';
import { createBattle } from '../battle/sim.js';
import { defenseStrengths, defenseWinChance, defenseLabel } from '../battle/defenseEstimate.js';
import { GRUDGES } from '../config/grudges.js';
import {
  tickGrudges, vendettaReady, markSworn, settleVendetta, addGrudge, grudgeOf,
} from './grudges.js';
import { tickStreak, onStreakDefenseWon } from './streak.js';
import { recordDeed, deedBonuses } from './deeds.js';
import { leaderFor } from './leaders.js';
import { boonMods } from './boonsState.js'; // the leaf (PLAN-PHASE7): Oathkeeper, the Black Pennant
import { offerChampionEye } from './boons.js';
import { edictMods } from './edicts.js'; // the leaf (PLAN-PHASE5): Iron Frontier, Peace of the Crowns, Overrun
import { EVENTS } from '../config/events.js';

export * from './frontierState.js';
export { busyKey };

const FREE_FOLK = 1;

// --- Small helpers ------------------------------------------------------------------------------------------------------

/** The next number in [0, 1) of the frontier's seeded stream (advances `state.frontier.rng`). */
function rand(state) {
  const f = ensureFrontier(state);
  const h = hash32(state.seed ?? 0, 'frontier', f.rng);
  f.rng += 1;
  return h / 4294967296;
}

function ownedCount(state) {
  let n = 0;
  for (const o of state.owner) if (o === PLAYER_FACTION) n += 1;
  return n;
}

/** True while raids are held off (DESIGN §10.1): the first FRONTIER.graceSec active seconds, or fewer than minRegions held. */
export function inGrace(state) {
  const f = ensureFrontier(state);
  return f.activeSec < FRONTIER.graceSec || ownedCount(state) < FRONTIER.minRegions;
}

/**
 * What the running battles hold, read from `state.battles` (ARCHITECTURE §10.2): `{ regions, sites }` in the battle manager's
 * `busy()` shape (sites keyed "regionId:index", see busyKey). The manager's own busy() gives the same answer.
 */
export function busyFromState(state, world) {
  const regions = new Set();
  const sites = new Set();
  for (const run of Array.isArray(state.battles) ? state.battles : []) {
    if (!run || run.battle?.result) continue;
    if (Number.isInteger(run.regionId)) regions.add(run.regionId);
    for (const s of run.battle?.arena?.sites || []) if (s.settlement >= 0) sites.add(busyKey(world, s.settlement));
  }
  return { regions, sites };
}

function runningBattles(state) {
  return (Array.isArray(state.battles) ? state.battles : []).filter((r) => r && !r.battle?.result);
}

/** Raids incoming plus defenses being fought (capped at FRONTIER.maxDefenses). */
export function activeDefenses(state) {
  const f = ensureFrontier(state);
  return f.incoming.length + runningBattles(state).filter((r) => r.kind === 'defense').length;
}

/**
 * Every rival faction with land touching the player's, and the (from, to) region pairs it could raid along.
 * @returns {{ faction:number, pairs:{from:number, to:number}[] }[]} by faction id
 */
export function borderingRivals(state, world) {
  const byFaction = new Map();
  for (const region of world.regions) {
    if (state.owner[region.id] !== PLAYER_FACTION) continue;
    for (const n of region.neighbors) {
      const o = state.owner[n];
      if (!(o > FREE_FOLK) || !world.factions[o]) continue;
      if (!byFaction.has(o)) byFaction.set(o, []);
      byFaction.get(o).push({ from: n, to: region.id });
    }
  }
  return [...byFaction.entries()].sort((a, b) => a[0] - b[0]).map(([faction, pairs]) => ({ faction, pairs }));
}

/**
 * Raids per ACTIVE second a faction launches at the player (DESIGN §10.1): 1 / raidMeanSec x its personality's rate
 * (a defensive faction at `provokedRate` for provokedSec after the player took one of its regions), halved once decapitated.
 */
export function raidRate(state, world, faction) {
  const fac = world.factions[faction];
  if (!fac || faction <= FREE_FOLK) return 0;
  const em = edictMods(state);
  if (!em.raids) return 0; // Peace of the Crowns: no raids at all (PLAN-PHASE5)
  const f = ensureFrontier(state);
  let mult = FRONTIER.personalityRate[fac.personality] ?? 1;
  if (fac.personality === 'defensive') {
    const at = f.provoked[faction];
    if (at != null && f.activeSec - at <= FRONTIER.provokedSec) mult = Math.max(mult, FRONTIER.provokedRate);
  }
  if (fac.capitalRegion != null && fac.capitalRegion >= 0 && state.owner[fac.capitalRegion] === PLAYER_FACTION) mult *= FRONTIER.decapitatedRate;
  return (mult * em.raidRateMult) / FRONTIER.raidMeanSec; // Iron Frontier: twice as often
}

/** The deepest rung the player holds (the ladder depth of their deepest region, at least 1). */
function realmDepth(state, world) {
  let d = 1;
  for (const region of world.regions) if (state.owner[region.id] === PLAYER_FACTION && region.tier > 0) d = Math.max(d, enemyDepth(world, region));
  return d;
}

/** The ladder depth a raid on `toRegionId` draws its strength from: the region's own, leaning toward the realm's deepest. */
export function raidDepth(state, world, toRegionId) {
  const region = world.regions[toRegionId];
  const own = Math.max(1, region ? enemyDepth(world, region) : 1);
  return own + FRONTIER.warBand.realmLean * Math.max(0, realmDepth(state, world) - own);
}

/** Linear interpolation in a [[x, y], ...] table (clamped at both ends). */
function curveAt(curve, x) {
  if (!curve || !curve.length) return 1;
  if (x <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    if (x <= curve[i][0]) return curve[i - 1][1] + ((curve[i][1] - curve[i - 1][1]) * (x - curve[i - 1][0])) / (curve[i][0] - curve[i - 1][0]);
  }
  return curve[curve.length - 1][1];
}

function tableAt(table, x) {
  const i = Math.max(0, Math.min(table.length - 1, x));
  const lo = Math.floor(i);
  const hi = Math.min(table.length - 1, lo + 1);
  return table[lo] + (table[hi] - table[lo]) * (i - lo);
}

/**
 * The war band's EnemyStats (ARCHITECTURE §6 plus `campTroops`): the enemy depth ladder at the raid's depth, the raider's
 * personality, FRONTIER.warBand's strength rules (personality, decapitation, the forgiving first raid) and the raid's grace.
 */
export function raidEnemyStats(state, world, raid) {
  const fac = world.factions[raid.faction] || {};
  const personality = fac.personality || 'aggressive';
  const depth = raid.depth ?? raidDepth(state, world, raid.toRegionId);
  const decap = fac.capitalRegion != null && fac.capitalRegion >= 0 && state.owner[fac.capitalRegion] === PLAYER_FACTION;
  const troopMult = Math.pow(depthTroopMult(state, depth), FRONTIER.warBand.depthExp) * curveAt(FRONTIER.warBand.depthCurve, depth)
    * (FRONTIER.warBand.personalityStrength[personality] ?? 1)
    * (decap ? ENEMY_SCALING.decapitationMult : 1)
    * (raid.first ? FRONTIER.warBand.firstRaidMult : 1)
    * (1 + FRONTIER.warBand.perFortLevel * fortLevels(state, raid.toRegionId)) // siege preparation: a fortified target draws a bigger band
    * (raid.vendetta ? GRUDGES.vendetta.warBandMult : 1) // a Vendetta (PLAN-PHASE4 §4D): the leader comes in person, x1.5
    * edictMods(state).raidTroopMult // the Overrun Challenge (PLAN-PHASE5): war bands x1.4 too
    * boonMods(state).raidTroopMult // the Black Pennant Relic (PLAN-PHASE7): x0.75
    * (raid.deserted ? EVENTS.deserters.raidMult : 1) // the Deserters event (PLAN-PHASE8): x0.7
    * (Number.isFinite(raid.mult) ? raid.mult : 1); // tools and tests only: a stronger or weaker war band
  const done = Math.max(0, ((state.dynasty && state.dynasty.level) || 1) - 1);
  const dynastyMult = done === 0 ? 1 : DYNASTY.enemyMultFirst * Math.pow(DYNASTY.enemyMultPerDynasty, done - 1);
  const atkDef = tableAt(ENEMY_SCALING.atkDefByTier, depth) * (depth >= 2 ? (ENEMY_SCALING.personalityStat[personality] ?? 1) : 1);
  const region = world.regions[raid.toRegionId];
  const tier = region ? Math.max(0, region.tier) : 1;
  const thinkTable = ENEMY_SCALING.thinkSecByTier;
  return {
    atk: atkDef,
    def: atkDef,
    growth: Math.pow(ENEMY_SCALING.growthPerTier, depth),
    speed: 1,
    troopMult,
    capMult: Math.pow(ENEMY_SCALING.capPerDepth, Math.max(0, depth - 1)) * dynastyMult,
    thinkSec: thinkTable[Math.min(tier, thinkTable.length - 1)],
    graceSec: FRONTIER.raidGraceSec,
    personality,
    factionId: raid.faction,
    campTroops: FRONTIER.warBand.campTroops * troopMult,
  };
}

// --- The scheduler ------------------------------------------------------------------------------------------------------

/** Total fortification levels of a region (siege preparation and target choice read it). */
function fortLevels(state, regionId) {
  return fortsOf(state, regionId).reduce((n, x) => n + x.level, 0);
}

/**
 * A smart raider probes the weak spots (DESIGN §10.1): picks one of `tos` (region ids, ascending) with a seeded roll weighted by
 * 1 / (1 + FRONTIER.targeting.perFortLevel x fort levels) x (1 + FRONTIER.targeting.drained x (1 - militia fill)).
 */
function pickTarget(state, tos, nowMs) {
  const cfg = FRONTIER.targeting;
  const weights = tos.map((id) => (1 / (1 + cfg.perFortLevel * fortLevels(state, id))) * (1 + cfg.drained * (1 - militiaFill(state, id, nowMs))));
  const total = weights.reduce((a, w) => a + w, 0);
  let roll = rand(state) * total;
  for (let i = 0; i < tos.length; i++) {
    roll -= weights[i];
    if (roll < 0) return tos[i];
  }
  return tos[tos.length - 1];
}

function pickPair(state, world, faction, pairs, t, extraBusy, nowMs) {
  const f = ensureFrontier(state);
  const busy = busyFromState(state, world);
  const targeted = new Set(f.incoming.map((r) => r.toRegionId));
  const ok = pairs.filter((p) => !((f.cooldown[p.to] ?? -Infinity) > t) && !targeted.has(p.to) && !busy.regions.has(p.to)
    && !(extraBusy && extraBusy.has(p.to)) && canBuildDefenseArena(world, state.owner, p.to, faction));
  if (!ok.length) return null;
  // one candidate per target region (several borders onto the same region are one choice)
  const byTo = new Map();
  for (const p of ok) if (!byTo.has(p.to) || p.from < byTo.get(p.to).from) byTo.set(p.to, p);
  const list = [...byTo.values()].sort((a, b) => a.to - b.to);
  return byTo.get(pickTarget(state, list.map((p) => p.to), nowMs));
}

function announce(state, world, faction, pair, t) {
  const f = ensureFrontier(state);
  const warn = regionFortEffects(state, pair.to).warnSec;
  const raid = {
    id: f.seq++, faction, fromRegionId: pair.from, toRegionId: pair.to,
    announcedAt: t, arriveAt: t + FRONTIER.telegraphSec + warn,
    strength: 0, depth: raidDepth(state, world, pair.to), first: f.stats.raids === 0,
  };
  // the Deserters event (PLAN-PHASE8): this rival's next raid comes smaller, once
  const we = state.worldEvents;
  if (we && we.deserters && we.deserters.faction === faction) { raid.deserted = true; we.deserters = null; }
  raid.strength = Math.round(raidEnemyStats(state, world, raid).campTroops);
  f.incoming.push(raid);
  f.cooldown[pair.to] = raid.arriveAt + FRONTIER.regionCooldownSec;
  f.stats.raids += 1;
  return raid;
}

function rollRaids(state, world, t, announced, nowMs) {
  if (inGrace(state)) return;
  for (const { faction, pairs } of borderingRivals(state, world)) {
    const rate = raidRate(state, world, faction);
    if (rate <= 0) continue;
    const p = 1 - Math.exp(-rate * FRONTIER.checkSec);
    if (rand(state) >= p) continue;
    if (activeDefenses(state) >= FRONTIER.maxDefenses) break;
    const pair = pickPair(state, world, faction, pairs, t, null, nowMs);
    if (pair) announced.push(announce(state, world, faction, pair, t));
  }
}

/** The home region: never the target of a Vendetta (PLAN-PHASE4 §4D). */
function isHome(world, regionId) {
  const r = world.regions[regionId];
  return !r || r.tier === 0 || regionId === world.startRegion;
}

/**
 * The region a Vendetta of `faction` marches on: one of the player's regions bordering that faction, never the home region, not
 * already targeted or fought over (a Vendetta never stacks with a raid). It prefers the region most recently taken FROM that
 * faction (its original owner, by conqueredAt), then the most recently conquered, then the lowest id. Null when none.
 * @returns {{ from:number, to:number }|null}
 */
export function vendettaTarget(state, world, faction, extraBusy = null) {
  const f = ensureFrontier(state);
  const rival = borderingRivals(state, world).find((x) => x.faction === faction);
  if (!rival) return null;
  const busy = busyFromState(state, world);
  const targeted = new Set(f.incoming.map((r) => r.toRegionId));
  const ok = rival.pairs.filter((p) => !isHome(world, p.to) && !targeted.has(p.to) && !busy.regions.has(p.to)
    && !(extraBusy && extraBusy.has(p.to)) && canBuildDefenseArena(world, state.owner, p.to, faction));
  if (!ok.length) return null;
  const at = (id) => (state.conqueredAt && Number.isFinite(state.conqueredAt[id]) ? state.conqueredAt[id] : -Infinity);
  const key = (p) => [world.regions[p.to].faction === faction ? 0 : 1, -at(p.to), p.to, p.from];
  ok.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
    return 0;
  });
  return ok[0];
}

/**
 * Swears the Vendettas that are due (PLAN-PHASE4 §4D): every rival whose Grudge is at the maximum and whose leader is not broken
 * sends a Vendetta raid (`raid.vendetta = { faction, leader }`, GRUDGES.vendetta.telegraphSec warning, x warBandMult war band),
 * if a defense slot is free (FRONTIER.maxDefenses) and a target exists; otherwise it waits at the border and tries again at the
 * next check. Never during the opening grace, never while away (only active time reaches here).
 */
function swearVendettas(state, world, t, announced) {
  if (inGrace(state)) return;
  for (const faction of vendettaReady(state, world)) {
    if (activeDefenses(state) >= FRONTIER.maxDefenses) break;
    const pair = vendettaTarget(state, world, faction);
    if (!pair) continue;
    const f = ensureFrontier(state);
    const warn = regionFortEffects(state, pair.to).warnSec;
    const leader = leaderFor(state.seed ?? 0, state.dynasty ? state.dynasty.level : 1, faction);
    const raid = {
      id: f.seq++, faction, fromRegionId: pair.from, toRegionId: pair.to,
      announcedAt: t, arriveAt: t + GRUDGES.vendetta.telegraphSec + warn,
      strength: 0, depth: raidDepth(state, world, pair.to), first: false,
      vendetta: { faction, leader: leader ? leader.fullName : '' },
    };
    raid.strength = Math.round(raidEnemyStats(state, world, raid).campTroops);
    f.incoming.push(raid);
    f.cooldown[pair.to] = raid.arriveAt + FRONTIER.regionCooldownSec;
    f.stats.raids += 1;
    f.stats.vendettas = (f.stats.vendettas || 0) + 1;
    markSworn(state, faction);
    announced.push(raid);
  }
}

function processArrivals(state, world, t, arrived) {
  const f = ensureFrontier(state);
  if (!f.incoming.length) return;
  const busy = busyFromState(state, world);
  let running = runningBattles(state).length + arrived.length;
  for (const r of arrived) busy.regions.add(r.toRegionId);
  const keep = [];
  for (const raid of [...f.incoming].sort((a, b) => a.arriveAt - b.arriveAt || a.id - b.id)) {
    if (raid.arriveAt > t + 1e-9) { keep.push(raid); continue; }
    if (state.owner[raid.toRegionId] !== PLAYER_FACTION) continue; // the region fell or changed hands: the raid is called off
    const region = world.regions[raid.toRegionId];
    const keepBusy = region && busy.sites.has(busyKey(world, region.keep));
    if (running >= FRONTIER.maxBattles || busy.regions.has(raid.toRegionId) || keepBusy) {
      raid.arriveAt = t + FRONTIER.holdRetrySec; // waits at the border until there is room
      keep.push(raid);
      continue;
    }
    running += 1;
    busy.regions.add(raid.toRegionId);
    arrived.push(raid);
  }
  f.incoming = keep;
}

/**
 * Advances the frontier by `activeDt` seconds of ACTIVE play (the game open and running; pass 0 or skip the call while paused
 * or hidden). Deterministic for a given state and call sequence. Respects grace, rates, the caps of FRONTIER.maxDefenses
 * incoming-or-fought raids and FRONTIER.maxBattles battles, and the per-region cooldown.
 *   - `announced`: raids that set out (show the toast, the marching war band); each is now in `state.frontier.incoming`
 *   - `arrived`: raids at the border: call defenseRunFor and manager.start for each (they are no longer in `incoming`). A raid
 *     whose region is busy or with 3 battles running waits FRONTIER.holdRetrySec and arrives later.
 * @param {import('./state.js').GameState} state MUTATED (state.frontier)
 * @param {import('../world/generate.js').World} world
 * @param {number} nowMs wall clock (the scheduler runs on active seconds; militia fill for target choice is read at nowMs)
 * @param {number} activeDt active seconds since the last call
 * @returns {{ announced: import('./frontierState.js').Raid[], arrived: import('./frontierState.js').Raid[] }}
 */
export function tickFrontier(state, world, nowMs, activeDt) {
  const f = ensureFrontier(state);
  const announced = [];
  const arrived = [];
  const end = f.activeSec + Math.max(0, Number.isFinite(activeDt) ? activeDt : 0);
  for (let guard = 0; f.nextCheckAt <= end && guard < 2000; guard++) {
    const at = Math.max(f.nextCheckAt, f.activeSec);
    f.activeSec = at;
    tickGrudges(state, world); // PLAN-PHASE4 §4D: Grudges cool with active time; a Vendetta whose target fell is called off
    processArrivals(state, world, at, arrived);
    if (edictMods(state).raids) swearVendettas(state, world, at, announced); // Peace of the Crowns: no Vendettas either
    rollRaids(state, world, at, announced, nowMs);
    f.nextCheckAt = at + FRONTIER.checkSec;
  }
  if (f.nextCheckAt <= end) f.nextCheckAt = end + FRONTIER.checkSec;
  f.activeSec = end;
  tickGrudges(state, world);
  processArrivals(state, world, end, arrived);
  const streakEnded = tickStreak(state); // PLAN-PHASE4 §4B: the streak runs out on the same active clock ({ was, reason } or null)
  return { announced, arrived, streakEnded };
}

// --- Defense runs ---------------------------------------------------------------------------------------------------------

/**
 * Builds the defense battle for an arrived raid (ARCHITECTURE §10.1 BattleRun): the region's militia at `opts.nowMs`, its
 * fortifications, the war band, the siege timer. Throws (from buildDefenseArena, with `err.code`) when it cannot be fought,
 * e.g. 'busy' or 'not-owned'.
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @param {import('./frontierState.js').Raid} raid
 * @param {object} [stats] PlayerStats (default playerBattleStats(state, world, raid.toRegionId))
 * @param {{ nowMs?: number, busy?: {regions:Set<number>, sites:Set<string>} }} [opts] busy defaults to busyFromState
 * @returns {object} BattleRun { id, kind: 'defense', regionId, fromRegionId, attackerFaction, battle, commander, auto, startedAt,
 *   raidId, first }
 */
export function defenseRunFor(state, world, raid, stats, opts = {}) {
  const nowMs = Number.isFinite(opts.nowMs) ? opts.nowMs : state.lastSeen;
  const to = raid.toRegionId;
  let player = stats || playerBattleStats(state, world, to);
  // a Vendetta (PLAN-PHASE4 §4D): the Nemesis deed hits its war band harder
  if (raid.vendetta) { const k = deedBonuses(state).vsVendetta; if (k !== 1) player = { ...player, atk: player.atk * k }; }
  const enemy = raidEnemyStats(state, world, raid);
  const arena = buildDefenseArena(world, state.owner, to, {
    attackerFaction: raid.faction,
    fromRegionId: raid.fromRegionId,
    player,
    enemy,
    forts: boostedForts(state, fortsOf(state, to)),
    militia: militiaGarrisons(state, world, to, nowMs),
    towerTroops: militiaTowerGarrison(state, world, to, nowMs),
    militiaCapMult: militiaCapMult(state, world, to),
    towerKillScale: militiaScale(state, world, to),
    busy: opts.busy ? normalizeBusy(opts.busy) : busyFromState(state, world),
    vendetta: raid.vendetta || null,
    noChampion: boonMods(state).noChampion, // Oathkeeper (PLAN-PHASE7)
    siegeSecMult: boonMods(state).siegeSecMult, // the Warden's Bell (PLAN-PHASE8)
  });
  const battle = createBattle(arena, player, enemy, { mode: 'defense', siegeSec: arena.siegeSec });
  const f = ensureFrontier(state);
  const run = {
    id: f.seq++, kind: 'defense', regionId: to, fromRegionId: raid.fromRegionId, attackerFaction: raid.faction,
    battle, commander: null, auto: false, startedAt: Number.isFinite(opts.nowMs) ? opts.nowMs : null,
    raidId: raid.id, first: !!raid.first,
  };
  if (raid.vendetta) run.vendetta = { faction: raid.vendetta.faction, leader: raid.vendetta.leader || '' };
  return run;
}

/** True when every settlement of the region the player held at the start is still theirs (for the Unbroken Renown). */
function unbrokenDefense(battle) {
  return battle.arena.sites.every((s) => s.owner !== PLAYER_FACTION || battle.sites[s.id].owner === PLAYER_FACTION);
}

/**
 * Settles a finished defense (ARCHITECTURE §10.1 'ended'). On a win: pays FRONTIER.reward.bountyShare of a conquest bounty
 * (gold is ADDED to state.gold and stats.goldEarned), drains the militia by what the siege cost, counts the win and restarts
 * the region's cooldown. On anything else it changes nothing and pays nothing: call `occupy(state, world, run.regionId,
 * run.attackerFaction, nowMs)` for a lost defense (a retreat from a defense is a loss).
 * @returns {{ gold:number, renown:number }} Renown is paid too (RENOWN.earn.defenseWon, +defenseUnbroken when no settlement fell)
 */
export function defenseReward(state, world, run, result, nowMs) {
  if (!run || !run.battle) return { gold: 0, renown: 0 };
  if (result !== 'win') {
    // a lost Vendetta (PLAN-PHASE4 §4D): the Grudge falls to GRUDGES.afterLoss (the region is occupied by occupy(), as for any raid)
    if (run.vendetta) return { gold: 0, renown: 0, vendetta: settleVendetta(state, run.vendetta.faction, false) };
    return { gold: 0, renown: 0 };
  }
  const f = ensureFrontier(state);
  const rewardMult = edictMods(state).defenseRewardMult; // Iron Frontier: x2 gold and x2 Renown (PLAN-PHASE5)
  const gold = bounty(state, world, run.regionId) * FRONTIER.reward.bountyShare * rewardMult;
  state.gold += gold;
  if (state.stats) state.stats.goldEarned += gold;
  f.stats.defensesWon += 1;
  f.cooldown[run.regionId] = f.activeSec + FRONTIER.regionCooldownSec;
  drainMilitia(state, run.regionId, defenseLossFraction(run.battle), Number.isFinite(nowMs) ? nowMs : state.lastSeen);
  let renown = earnRenown(state, (RENOWN.earn.defenseWon + (unbrokenDefense(run.battle) ? RENOWN.earn.defenseUnbroken : 0)) * rewardMult, 'defense');
  // Phase 4: a won defense keeps the Conquest Streak alive and counts for the Warden deed
  onStreakDefenseWon(state);
  recordDeed(state, 'defense', 1);
  const out = { gold, renown };
  if (run.vendetta) {
    // a Vendetta beaten (PLAN-PHASE4 §4D): +Renown, a Trophy, the Grudge back to 0, the Nemesis deed
    out.vendetta = settleVendetta(state, run.vendetta.faction, true);
    renown += earnRenown(state, GRUDGES.vendetta.renown, 'vendetta');
    out.renown = renown;
    recordDeed(state, 'vendetta', 1);
    // the Champion's eye (PLAN-PHASE7 §7A): once per dynasty, a Vendetta win drafts a Rare-or-better Boon
    const eye = offerChampionEye(state, world);
    if (eye) out.boonOffer = eye;
  } else if (run.attackerFaction > FREE_FOLK) {
    const g = addGrudge(state, run.attackerFaction, 'raidBeaten', nowMs); // beating their raid feeds the leader's Grudge
    if (g) out.grudge = { faction: run.attackerFaction, value: g.value, crossed: g.crossed };
  }
  return out;
}

/**
 * The opts for buildArena when the player attacks `regionId` (ARCHITECTURE §10.3): what the running battles hold, and the
 * fortifications an occupier captured there (they fight for it, DESIGN §10.2).
 * @returns {{ busy:{regions:Set<number>, sites:Set<string>}, forts?:{type:string, level:number}[] }}
 */
export function attackArenaOpts(state, world, regionId, busy) {
  const out = { busy: busy ? normalizeBusy(busy) : busyFromState(state, world) };
  const occ = occupationOf(state, regionId);
  if (occ && Array.isArray(occ.forts) && occ.forts.length) out.forts = occ.forts;
  return out;
}

// --- Odds ---------------------------------------------------------------------------------------------------------------------

/** The raid most likely to hit a region (for odds before any raid is announced): its lowest-id bordering rival. */
function likelyRaid(state, world, regionId) {
  const region = world.regions[regionId];
  if (!region) return null;
  let best = null;
  for (const n of region.neighbors) {
    const o = state.owner[n];
    if (!(o > FREE_FOLK)) continue;
    if (!best || o < best.faction || (o === best.faction && n < best.fromRegionId)) best = { faction: o, fromRegionId: n };
  }
  if (!best) return null;
  return { id: 0, ...best, toRegionId: regionId, depth: raidDepth(state, world, regionId), first: false };
}

/**
 * The odds of holding `regionId` against `raid` (ARCHITECTURE §10.3; the toast and the card). `raid` may be omitted: the most
 * likely raider is assumed. Builds the real defense arena (militia at `opts.nowMs`, fortifications) and reads it in closed form.
 * @param {object} [opts] { commander: 'captain'|'stalwart'|... (default 'captain', who holds it if you do not go),
 *   general: a General (or id) commanding it unattended (its passive counts, its steward's odds by level), nowMs, stats, busy }
 * @returns {{ winChance:number, label:string, theirs:number, yours:number, ratio:number, inPerson:number, siegeSec:number,
 *   none?:true }} theirs / yours are troop counts at the start; `inPerson` is the chance if the player defends it;
 *   `none` when no rival can reach the region (then winChance is 1)
 */
export function estimateDefense(state, world, regionId, raid, opts = {}) {
  const r = raid || likelyRaid(state, world, regionId);
  const fallback = { winChance: 1, label: 'Easy', theirs: 0, yours: 0, ratio: Infinity, inPerson: 1, siegeSec: 0, none: true };
  if (!r || state.owner[regionId] !== PLAYER_FACTION) return fallback;
  const nowMs = Number.isFinite(opts.nowMs) ? opts.nowMs : state.lastSeen;
  const general = opts.general ? generalById(state, opts.general) : null;
  const player = opts.stats || playerBattleStats(state, world, regionId, general ? { commander: general } : {});
  const enemy = raidEnemyStats(state, world, r);
  let arena;
  try {
    arena = buildDefenseArena(world, state.owner, regionId, {
      attackerFaction: r.faction, fromRegionId: r.fromRegionId, player, enemy,
      forts: boostedForts(state, fortsOf(state, regionId)),
      militia: militiaGarrisons(state, world, regionId, nowMs),
      towerTroops: militiaTowerGarrison(state, world, regionId, nowMs),
      militiaCapMult: militiaCapMult(state, world, regionId),
      towerKillScale: militiaScale(state, world, regionId),
      busy: opts.busy ? normalizeBusy(opts.busy) : null,
      vendetta: r.vendetta || null, // the Champion counts in the odds
      noChampion: boonMods(state).noChampion, // Oathkeeper (PLAN-PHASE7)
    siegeSecMult: boonMods(state).siegeSecMult, // the Warden's Bell (PLAN-PHASE8)
    });
  } catch {
    return fallback;
  }
  const playerInBattle = arena.playerSpeedMult ? { ...player, speed: (player.speed ?? 1) * arena.playerSpeedMult } : player;
  const s = defenseStrengths(arena, playerInBattle, enemy);
  // a General commanding unattended (Phase 2): the fit runs from a level-1 to a level-10 General's steward
  const k = general ? (general.level - 1) / (GENERALS.maxLevel - 1) : 0;
  const winChance = general
    ? defenseWinChance(s.ratio, 'general1') * (1 - k) + defenseWinChance(s.ratio, 'general10') * k
    : defenseWinChance(s.ratio, opts.commander || 'captain');
  return {
    winChance, label: defenseLabel(winChance), theirs: Math.round(s.theirsTroops), yours: Math.round(s.yoursTroops),
    ratio: s.ratio, inPerson: defenseWinChance(s.ratio, 'inPerson'), siegeSec: arena.siegeSec,
  };
}

// --- While you're away (DESIGN §10.10) ----------------------------------------------------------------------------------------

/**
 * Resolves the raids of an absence in the abstract, gently (DESIGN §10.10). Call it on return, AFTER offlineEarnings, with the
 * length of the absence. Raids happen at FRONTIER.away.rateMult of the live rate, from the rivals bordering the realm, at times
 * drawn across the absence (raids still marching when the game closed arrive first). Each is held or lost by a seeded roll
 * against estimateDefense (the Militia Captain's odds), but a region can only FALL when:
 *   - the absence is longer than FRONTIER.away.lossAfterMs (3 h),
 *   - no other region fell less than lossWindowMs (4 h) earlier in the absence, and at most ceil(away / 4 h) fell so far,
 *   - fewer than maxLossesPerAbsence (2) fell in this absence,
 *   - it is not the home region (the start region).
 * Otherwise the raid is repelled. Lost regions are occupied (occupy) at the moment they fell. Clears `state.frontier.incoming`.
 * Stores the report in `state.frontier.lastAwayReport` and returns it.
 * @param {import('./state.js').GameState} state MUTATED
 * @param {import('../world/generate.js').World} world
 * @param {number} awayMs the absence (now - lastSeen before offlineEarnings moved it)
 * @param {number} nowMs
 * @param {{ odds?: (raid) => number }} [opts] tests and tools only: replaces the odds of each raid
 * @returns {{ awayMs:number, at:number, raids:{faction:number, fromRegionId:number, toRegionId:number, atMs:number,
 *   result:'repelled'|'occupied', winChance:number}[], repelled:number, lost:number[] }}
 */
export function resolveAway(state, world, awayMs, nowMs, opts = {}) {
  const f = ensureFrontier(state);
  const report = { awayMs: Math.max(0, awayMs || 0), at: nowMs, raids: [], repelled: 0, lost: [] };
  const away = report.awayMs;
  const departMs = nowMs - away;
  // a Vendetta never happens away (PLAN-PHASE4 §4D): one still marching is called back and sworn again once the player is back
  for (const r of f.incoming) if (r.vendetta) { const g = grudgeOf(state, r.vendetta.faction); g.vendettaAt = null; g.orphanSince = null; }
  const pending = f.incoming.filter((r) => !r.vendetta);
  f.incoming = [];
  if (away <= 0 || (inGrace(state) && pending.length === 0)) {
    f.lastAwayReport = report;
    return report;
  }
  const cfg = FRONTIER.away;
  // the raids: those still marching when the game closed, then a seeded trickle across the absence
  const events = pending.map((r) => ({ atMs: 0, faction: r.faction, fixed: r }));
  if (!inGrace(state)) {
    for (const { faction } of borderingRivals(state, world)) {
      const rate = raidRate(state, world, faction) * cfg.rateMult; // per second
      if (rate <= 0) continue;
      let t = 0;
      for (let guard = 0; guard < 64; guard++) {
        t += -Math.log(1 - rand(state)) / rate;
        if (t * 1000 >= away) break;
        events.push({ atMs: t * 1000, faction });
      }
    }
  }
  events.sort((a, b) => a.atMs - b.atMs || a.faction - b.faction);
  const maxLosses = away > cfg.lossAfterMs ? Math.min(cfg.maxLossesPerAbsence, Math.ceil(away / cfg.lossWindowMs)) : 0;
  const cooldownMs = {};
  let lastLoss = null;
  for (const ev of events.slice(0, cfg.maxRaidsPerAbsence)) {
    let pair = null;
    if (ev.fixed && state.owner[ev.fixed.toRegionId] === PLAYER_FACTION && state.owner[ev.fixed.fromRegionId] === ev.faction) {
      pair = { from: ev.fixed.fromRegionId, to: ev.fixed.toRegionId };
    } else {
      const rival = borderingRivals(state, world).find((x) => x.faction === ev.faction);
      if (!rival) continue;
      const ok = rival.pairs.filter((p) => !((cooldownMs[p.to] ?? -Infinity) > ev.atMs) && canBuildDefenseArena(world, state.owner, p.to, ev.faction));
      if (!ok.length) continue;
      const tos = [...new Set(ok.map((p) => p.to))].sort((a, b) => a - b);
      const to = pickTarget(state, tos, departMs + ev.atMs);
      pair = ok.filter((p) => p.to === to).sort((a, b) => a.from - b.from)[0];
    }
    const raid = { id: 0, faction: ev.faction, fromRegionId: pair.from, toRegionId: pair.to, depth: raidDepth(state, world, pair.to), first: false };
    const at = departMs + ev.atMs;
    const odds = typeof opts.odds === 'function' ? opts.odds(raid) : estimateDefense(state, world, pair.to, raid, { commander: 'captain', nowMs: at }).winChance;
    const chance = Math.max(cfg.winChanceFloor, odds);
    const roll = rand(state);
    cooldownMs[pair.to] = ev.atMs + FRONTIER.regionCooldownSec * 1000;
    const home = world.regions[pair.to].tier === 0 || pair.to === world.startRegion;
    const canLose = !home && report.lost.length < maxLosses && (lastLoss === null || ev.atMs - lastLoss >= cfg.lossWindowMs);
    if (roll >= chance && canLose) {
      occupy(state, world, pair.to, ev.faction, at);
      lastLoss = ev.atMs;
      report.lost.push(pair.to);
      report.raids.push({ faction: ev.faction, fromRegionId: pair.from, toRegionId: pair.to, atMs: at, result: 'occupied', winChance: chance });
    } else {
      report.repelled += 1;
      report.raids.push({ faction: ev.faction, fromRegionId: pair.from, toRegionId: pair.to, atMs: at, result: 'repelled', winChance: chance });
    }
  }
  f.lastAwayReport = report;
  return report;
}

/**
 * The welcome-back line for an away report (DESIGN §10.10): "While you were away: 4 attacks repelled at Fenwall and Lowshire.
 * Brindle was occupied by the Amber Horde: retake it." Empty string when nothing happened.
 */
export function awayReportText(report, world) {
  if (!report || !report.raids || report.raids.length === 0) return '';
  const names = (ids) => {
    const list = [...new Set(ids)].map((id) => world.regions[id]?.name).filter(Boolean);
    if (list.length <= 1) return list.join('');
    return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
  };
  const parts = [];
  const held = report.raids.filter((r) => r.result === 'repelled');
  if (held.length) parts.push(`${held.length} ${held.length === 1 ? 'attack' : 'attacks'} repelled at ${names(held.map((r) => r.toRegionId))}.`);
  for (const r of report.raids.filter((x) => x.result === 'occupied')) {
    parts.push(`${world.regions[r.toRegionId]?.name} was occupied by the ${world.factions[r.faction]?.name}: retake it.`);
  }
  return `While you were away: ${parts.join(' ')}`;
}

