// A competent PLAYER bot for tools/balance.mjs (and AI-vs-bot tests). Exports
// `decide(battle, t, memo) -> Command[]`. Not part of the shipped game (there's no "bot"
// slot in BattleState — a real human plays the player side) so its own scratch state lives
// in `memo`, a plain object the CALLER owns and threads through successive calls; this file
// never mutates anything except that object. Pure otherwise.
import { BATTLE, SITE_TYPES, POWERS } from '../config/battle.js';
import { ownerStats, PLAYER_OWNER } from './combat.js';
import { pathBetweenSites, getRuntime } from './runtime.js';
import { squadPosition } from './position.js';

// One look at the board every 3 s (~18 orders a minute, measured): a good human, not a machine. At 0.5 s the
// bot issued ~53 orders a minute and every battle ended in about half the time a person needs.
const THINK_SEC = 3.0;
const RESERVE = 0.2;
const MARGIN = 1.2;
// Impatience: when nothing has happened for a while (everything sitting at its cap, waiting for
// a margin that never arrives) a person stops being careful and commits what they have. Without
// this the bot deadlocks against a full-cap keep it could in fact beat.
const IMPATIENT_AFTER = 12;   // seconds of inactivity before it starts loosening up
const IMPATIENT_RAMP = 20;    // ...and how long until it is fully all-in with an even fight
const IMPATIENT_MARGIN = 1.02;
const ATTRITION_RAMP = 30;    // then, still stuck, it throws waves at a keep it cannot beat in
const ATTRITION_MARGIN = 0.55; // one blow, trusting that its sites regrow faster than the keep does
const SITE_VALUE = { hamlet: 15, village: 35, town: 55, fort: 60, tower: 25, keep: 100, camp: 90 };
const BIG_SQUAD_FRACTION = 0.2; // a squad carrying >=20% of our total troops is "a big squad"
const MAX_LIVE_SQUADS = 14;     // a person does not micro-manage dozens of squads at once
const MIN_SQUAD = 3;            // ...nor trickle one- and two-troop squads into a fight

function pathCostBetween(battle, fromSiteId, toSiteId) {
  const path = pathBetweenSites(battle, fromSiteId, toSiteId);
  if (!path) return null;
  const byIndex = getRuntime(battle).byIndex;
  let cost = 0;
  for (const i of path) cost += byIndex.get(i).cost;
  return cost;
}

function strengthOf(battle, site) {
  const { player, enemy, arena } = battle;
  const stats = ownerStats(site.owner, player, arena.enemyFaction, enemy);
  return site.troops * stats.atk * stats.def * SITE_TYPES[site.type].def;
}

function canUse(battle, power, t) {
  const level = battle.player.powers?.[power] || 0;
  return level >= 1 && t >= battle.cooldowns[power];
}

/** Greedy capture: the best-scoring reachable target we can beat with a comfortable
 * margin, sourced from owned sites' surplus (cheapest-path sources first). */
function planGreedyCapture(battle, mySites, reserve, margin, peak) {
  const { player, enemy, arena } = battle;
  if (battle.squads.filter((q) => q.owner === PLAYER_OWNER).length >= MAX_LIVE_SQUADS) return [];
  const myStats = ownerStats(PLAYER_OWNER, player, arena.enemyFaction, enemy);
  const sources = mySites.filter((s) => s.troops > reserve * peak[s.id]);
  if (sources.length === 0) return [];
  const speed = Math.max(0.01, BATTLE.baseSpeed * myStats.speed);

  let best = null;
  let bestScore = -Infinity;
  for (const target of battle.sites) {
    if (target.owner === PLAYER_OWNER) continue;
    let nearestCost = Infinity;
    for (const s of sources) {
      const cost = pathCostBetween(battle, s.id, target.id);
      if (cost !== null && cost < nearestCost) nearestCost = cost;
    }
    if (!Number.isFinite(nearestCost)) continue;
    const travelSec = nearestCost / speed;
    const defStats = ownerStats(target.owner, player, arena.enemyFaction, enemy);
    const growthDuring = defStats.growth * travelSec;
    const projected = (target.troops + growthDuring) * defStats.atk * defStats.def * SITE_TYPES[target.type].def;
    const troopsNeeded = (projected * margin) / Math.max(0.01, myStats.atk * myStats.def);
    const surplus = sources.reduce((sum, s) => sum + Math.max(0, s.troops - reserve * peak[s.id]), 0);
    if (surplus < troopsNeeded) continue; // only launch when we can comfortably win outright
    const value = SITE_VALUE[target.type] ?? 20;
    const score = value / (troopsNeeded + 1) / (travelSec + 1);
    if (score > bestScore) { bestScore = score; best = { target, troopsNeeded }; }
  }
  if (!best) return [];

  const withCost = mySites
    .filter((s) => s.troops > reserve * peak[s.id])
    .map((s) => ({ site: s, cost: pathCostBetween(battle, s.id, best.target.id) }))
    .filter((x) => x.cost !== null)
    .sort((a, b) => a.cost - b.cost || a.site.id - b.site.id);
  const commands = [];
  let remaining = best.troopsNeeded;
  for (const { site } of withCost) {
    if (remaining <= 0) break;
    if (site.assault && site.assault.owner !== PLAYER_OWNER) continue; // it needs its garrison
    const surplus = Math.max(0, site.troops - reserve * peak[site.id]);
    if (surplus < MIN_SQUAD) continue;
    const take = Math.min(surplus, Math.max(remaining, MIN_SQUAD));
    const fraction = Math.min(1, take / site.troops);
    if (Math.floor(site.troops * fraction) < MIN_SQUAD) continue;
    commands.push({ type: 'send', owner: PLAYER_OWNER, from: [site.id], to: best.target.id, fraction });
    remaining -= take;
  }
  return commands;
}

function findFallingSite(battle, mySites) {
  let worst = null;
  let worstMargin = Infinity;
  for (const site of mySites) {
    if (!site.assault || site.assault.owner === PLAYER_OWNER) continue;
    const attackers = site.assault.squads
      .map((id) => battle.squads.find((s) => s.id === id))
      .filter(Boolean);
    if (attackers.length === 0) continue;
    const { player, enemy, arena } = battle;
    const atkStrength = attackers.reduce((sum, s) => {
      const st = ownerStats(s.owner, player, arena.enemyFaction, enemy);
      return sum + s.count * st.atk * st.def;
    }, 0);
    const defStrength = strengthOf(battle, site);
    const margin = defStrength / Math.max(1, atkStrength);
    if (margin < 1.5 && margin < worstMargin) { worstMargin = margin; worst = site; }
  }
  return worst;
}

function findBiggestNearbyEnemySquad(battle, mySites) {
  const mySiteIds = new Set(mySites.map((s) => s.id));
  let best = null;
  for (const squad of battle.squads) {
    if (squad.owner === PLAYER_OWNER) continue;
    const isNearUs = mySiteIds.has(squad.to) || mySiteIds.has(squad.from);
    if (!isNearUs) continue;
    if (!best || squad.count > best.count) best = squad;
  }
  return best;
}

function nearestArenaTileQR(battle, pos) {
  let best = null;
  let bestDist = Infinity;
  for (const t of battle.arena.tiles) {
    const d = (t.x - pos.x) ** 2 + (t.y - pos.y) ** 2;
    if (d < bestDist) { bestDist = d; best = t; }
  }
  return best ? { q: best.q, r: best.r } : null;
}

/** Answers a march on one of our sites: sends the nearest site's surplus when the incoming
 * strength would beat the garrison (a person watching the screen does this instinctively). */
function reinforceThreatened(battle, mySites, peak) {
  const { player, enemy, arena } = battle;
  const commands = [];
  for (const site of mySites) {
    const incoming = battle.squads.filter((s) => s.owner !== PLAYER_OWNER && s.state === 'march' && s.to === site.id);
    if (incoming.length === 0) continue;
    const atk = incoming.reduce((sum, s) => {
      const st = ownerStats(s.owner, player, arena.enemyFaction, enemy);
      return sum + s.count * st.atk * st.def;
    }, 0);
    const enRoute = battle.squads
      .filter((s) => s.owner === PLAYER_OWNER && s.state === 'march' && s.to === site.id)
      .reduce((sum, s) => sum + s.count, 0);
    const myStats = ownerStats(PLAYER_OWNER, player, arena.enemyFaction, enemy);
    const unit = myStats.atk * myStats.def * SITE_TYPES[site.type].def;
    const deficit = (atk * 1.1) / unit - site.troops - enRoute;
    if (deficit < 1) continue;
    const helpers = mySites
      .filter((h) => h.id !== site.id && h.troops - RESERVE * peak[h.id] >= MIN_SQUAD)
      .map((h) => ({ site: h, cost: pathCostBetween(battle, h.id, site.id) }))
      .filter((x) => x.cost !== null)
      .sort((a, b) => a.cost - b.cost || a.site.id - b.site.id);
    let need = deficit;
    for (const { site: h } of helpers) {
      if (need <= 0) break;
      const take = Math.min(h.troops - RESERVE * peak[h.id], need);
      commands.push({ type: 'send', owner: PLAYER_OWNER, from: [h.id], to: site.id, fraction: Math.min(1, take / h.troops) });
      need -= take;
    }
  }
  return commands;
}

/** Each site's decaying peak garrison: what it "normally holds" (reserves are shares of that, so
 * they mean the same thing whatever the site caps are). */
function trackPeaks(battle, memo) {
  const peak = memo.peak || (memo.peak = {});
  for (const s of battle.sites) peak[s.id] = Math.max(s.troops, (peak[s.id] || 0) * 0.995);
  return peak;
}

/** Decides this tick's player commands. `memo` is owned/persisted by the caller. */
export function decide(battle, t, memo = {}) {
  if (t < (memo.nextThink || 0)) return [];
  memo.nextThink = t + THINK_SEC;

  const mySites = battle.sites.filter((s) => s.owner === PLAYER_OWNER);
  if (mySites.length === 0) return [];
  const peak = trackPeaks(battle, memo);
  const commands = [];

  const falling = findFallingSite(battle, mySites);
  if (falling && canUse(battle, 'bulwark', t)) {
    commands.push({ type: 'power', owner: PLAYER_OWNER, power: 'bulwark', target: falling.id });
  }

  const totalTroops = mySites.reduce((sum, s) => sum + s.troops, 0);
  const bigSquad = battle.squads.find(
    (s) => s.owner === PLAYER_OWNER && s.state === 'march' && s.count > BIG_SQUAD_FRACTION * totalTroops,
  );
  if (bigSquad && canUse(battle, 'march', t) && t >= battle.effects.marchUntil) {
    commands.push({ type: 'power', owner: PLAYER_OWNER, power: 'march', target: null });
  }

  const bigEnemySquad = findBiggestNearbyEnemySquad(battle, mySites);
  if (bigEnemySquad && canUse(battle, 'firestorm', t)) {
    const qr = nearestArenaTileQR(battle, squadPosition(battle, bigEnemySquad));
    if (qr) commands.push({ type: 'power', owner: PLAYER_OWNER, power: 'firestorm', target: qr });
  }

  if (canUse(battle, 'levy', t)) {
    commands.push({ type: 'power', owner: PLAYER_OWNER, power: 'levy', target: null });
  }

  const keep = battle.sites.find((s) => s.type === 'keep' && s.owner !== PLAYER_OWNER);
  if (keep && canUse(battle, 'rally', t)) {
    const { player, enemy, arena } = battle;
    const myStats = ownerStats(PLAYER_OWNER, player, arena.enemyFaction, enemy);
    const rallyShare = POWERS.rally.share;
    const wouldSend = mySites.filter((s) => s.id !== keep.id)
      .reduce((sum, s) => sum + Math.floor(s.troops * rallyShare), 0);
    const attackStrength = wouldSend * myStats.atk * myStats.def;
    if (attackStrength > strengthOf(battle, keep) * MARGIN) {
      commands.push({ type: 'power', owner: PLAYER_OWNER, power: 'rally', target: keep.id });
    }
  }

  commands.push(...reinforceThreatened(battle, mySites, peak));
  if (commands.length === 0) {
    const idle = t - (memo.lastAct || 0) - IMPATIENT_AFTER;
    const k = Math.max(0, Math.min(1, idle / IMPATIENT_RAMP));
    const k2 = Math.max(0, Math.min(1, (idle - IMPATIENT_RAMP) / ATTRITION_RAMP));
    const margin = MARGIN + (IMPATIENT_MARGIN - MARGIN) * k + (ATTRITION_MARGIN - IMPATIENT_MARGIN) * k2;
    commands.push(...planGreedyCapture(battle, mySites, RESERVE * (1 - k), margin, peak));
  }
  // Only orders that move troops count as activity: a Levy going off every 40 s must not keep
  // resetting the impatience clock of a bot that is otherwise sitting still.
  if (commands.some((c) => c.type === 'send')) memo.lastAct = t;
  return commands;
}
