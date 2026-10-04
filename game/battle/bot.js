// A competent PLAYER bot for tools/balance.mjs (and AI-vs-bot tests). Exports
// `decide(battle, t, memo) -> Command[]`. Not part of the shipped game (there's no "bot"
// slot in BattleState — a real human plays the player side) so its own scratch state lives
// in `memo`, a plain object the CALLER owns and threads through successive calls; this file
// never mutates anything except that object. Pure otherwise.
import { BATTLE, SITE_TYPES, POWERS } from '../config/battle.js';
import { ownerStats, siteDefence, PLAYER_OWNER } from './combat.js';
import { routeFor, canRoute } from './routing.js';
import { squadPosition } from './position.js';
import { getRuntime } from './runtime.js';
import { worldDist, hexRadiusToWorld } from './geom.js';
import { stewardThink } from './steward.js';
import { abilityAdvice } from './abilities.js';
import { towerRangeMult, powersBlocked } from './features.js';

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
const SITE_VALUE = { hamlet: 15, village: 35, town: 55, fort: 60, tower: 25, keep: 100, camp: 90, bandit: 40, gate: 90, shrine: 80 };
const BIG_SQUAD_FRACTION = 0.2; // a squad carrying >=20% of our total troops is "a big squad"
const MAX_LIVE_SQUADS = 14;     // a person does not micro-manage dozens of squads at once
const MIN_SQUAD = 3;            // ...nor trickle one- and two-troop squads into a fight
const ARROW_SAFETY = 1.3;       // a squad carries this much more than the arrows it will meet can kill
const FIGHT_EXPOSURE_SEC = 4;   // seconds a squad stands under a tower's arrows while it fights at the target

// Front lines (DESIGN §4.4): the bot plans over the routes it may really march, exactly like a player who can only
// drag to highlighted targets. null = no legal route.
function pathCostBetween(battle, fromSiteId, toSiteId) {
  const route = routeFor(battle, PLAYER_OWNER, fromSiteId, toSiteId);
  return route ? route.cost : null;
}

/**
 * Troops a squad marching `tiles` toward `target` should expect to lose to enemy towers: every tower whose range covers
 * a tile of the route fires once per `volleySec` for as long as the squad is inside it, and again while the squad fights
 * at a target that stands within range. A person does not send three troops past two towers.
 */
function arrowLoss(battle, tiles, target, speed) {
  const towers = battle.sites.filter((x) => x.type === 'tower' && x.owner !== PLAYER_OWNER && x.troops >= 1);
  if (towers.length === 0) return 0;
  const rt = getRuntime(battle);
  const cfg = SITE_TYPES.tower;
  const targetTile = rt.byIndex.get(target.tile);
  let loss = 0;
  for (const tower of towers) {
    const towerTile = rt.byIndex.get(tower.tile);
    if (!towerTile) continue;
    // a fortification or an Ancient Tower carries its own numbers; Night halves every range (DESIGN §10.3, §10.13)
    const range = hexRadiusToWorld((tower.range ?? cfg.range) * towerRangeMult(battle));
    const volleySec = tower.volleySec ?? cfg.volleySec;
    const kills = tower.volleyKills ?? cfg.volleyKills;
    let inRange = 0;
    for (const i of tiles) {
      const t = rt.byIndex.get(i);
      if (t && worldDist(t, towerTile) <= range) inRange += t.cost / speed;
    }
    if (targetTile && worldDist(targetTile, towerTile) <= range) inRange += FIGHT_EXPOSURE_SEC;
    const stats = ownerStats(tower.owner, battle.player, battle.arena.enemyFaction, battle.enemy);
    loss += (inRange / volleySec) * kills * stats.atk;
  }
  return loss;
}

function strengthOf(battle, site) {
  const { player, enemy, arena } = battle;
  const stats = ownerStats(site.owner, player, arena.enemyFaction, enemy);
  return site.troops * stats.atk * stats.def * siteDefence(site);
}

function canUse(battle, power, t) {
  const level = battle.player.powers?.[power] || 0;
  return level >= 1 && t >= battle.cooldowns[power] && !powersBlocked(battle); // Holy Ground: no powers
}

/**
 * Front lines (DESIGN §4.4): a big garrison may have no legal route to the target while one of our other settlements does
 * (the land in between is theirs). A person moves the troops up first: the nearest settlement that can reach the target is
 * where `source` sends its surplus, and it attacks from there. Returns that settlement, or null.
 */
function relayFor(battle, mySites, source, target) {
  let best = null;
  let bestCost = Infinity;
  for (const f of mySites) {
    if (f.id === source.id || (f.assault && f.assault.owner !== PLAYER_OWNER)) continue;
    const there = pathCostBetween(battle, f.id, target.id);
    const up = there === null ? null : pathCostBetween(battle, source.id, f.id);
    if (there === null || up === null) continue;
    if (up + there < bestCost) { bestCost = up + there; best = f; }
  }
  return best;
}

/** Greedy capture: the best-scoring reachable target we can beat with a comfortable
 * margin, sourced from owned sites' surplus (cheapest-path sources first). Troops that cannot march to the target
 * themselves count only as far as they can be relayed to a settlement that can. */
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
    let nearestSource = null;
    for (const s of sources) {
      const cost = pathCostBetween(battle, s.id, target.id);
      if (cost !== null && cost < nearestCost) { nearestCost = cost; nearestSource = s; }
    }
    if (!Number.isFinite(nearestCost)) continue;
    const travelSec = nearestCost / speed;
    const defStats = ownerStats(target.owner, player, arena.enemyFaction, enemy);
    const growthDuring = defStats.growth * travelSec;
    const projected = (target.troops + growthDuring) * defStats.atk * defStats.def * siteDefence(target);
    let troopsNeeded = (projected * margin) / Math.max(0.01, myStats.atk * myStats.def);
    if (nearestSource) troopsNeeded += ARROW_SAFETY * arrowLoss(battle, routeFor(battle, PLAYER_OWNER, nearestSource.id, target.id).tiles, target, speed);
    let direct = 0;
    let relay = 0;
    for (const s of sources) {
      if (s.assault && s.assault.owner !== PLAYER_OWNER) continue; // it needs its garrison: it will not send, so it cannot count
      const spare = Math.max(0, s.troops - reserve * peak[s.id]);
      if (pathCostBetween(battle, s.id, target.id) !== null) direct += spare;
      else if (relayFor(battle, mySites, s, target)) relay += spare;
    }
    if (direct + relay < troopsNeeded) continue; // only launch when we can comfortably win outright
    const value = SITE_VALUE[target.type] ?? 20;
    const score = value / (troopsNeeded + 1) / (travelSec + 1);
    if (score > bestScore) { bestScore = score; best = { target, troopsNeeded, direct }; }
  }
  if (!best) return [];

  if (best.direct < best.troopsNeeded) {
    // not enough can march at the target from where it stands: move the rest up to the settlement that can, attack next look
    const relays = [];
    let short = best.troopsNeeded - best.direct;
    for (const s of sources) {
      if (short <= 0) break;
      if (pathCostBetween(battle, s.id, best.target.id) !== null) continue;
      if (s.assault && s.assault.owner !== PLAYER_OWNER) continue;
      const f = relayFor(battle, mySites, s, best.target);
      const spare = Math.max(0, s.troops - reserve * peak[s.id]);
      if (!f || spare < MIN_SQUAD) continue;
      const take = Math.min(spare, short);
      const fraction = Math.min(1, take / s.troops);
      if (Math.floor(s.troops * fraction) < MIN_SQUAD) continue;
      relays.push({ type: 'send', owner: PLAYER_OWNER, from: [s.id], to: f.id, fraction });
      short -= take;
    }
    return relays;
  }

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
    const floor = Math.max(MIN_SQUAD, Math.ceil(ARROW_SAFETY * arrowLoss(battle, routeFor(battle, PLAYER_OWNER, site.id, best.target.id).tiles, best.target, speed)));
    if (surplus < floor) continue; // it would be shot down on the way
    const take = Math.min(surplus, Math.max(remaining, floor));
    const fraction = Math.min(1, take / site.troops);
    if (Math.floor(site.troops * fraction) < floor) continue;
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
    const unit = myStats.atk * myStats.def * siteDefence(site);
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

/**
 * Supply lines (DESIGN §4.3), the way a player who likes them uses them: pick the staging settlement (the one that can
 * attack the most enemy settlements, nearest first) and feed it from every other settlement that has a legal route to it,
 * one standing line each, so the whole realm's growth flows to where the fight is instead of idling at a cap. A line is
 * re-pointed only when its target stops being the staging settlement and is dropped for the staging settlement itself.
 * Only when `memo.supply` is set; `memo.supply === 'overflow'` lines only the settlements that are filling up (about to waste
 * growth at their cap) and takes the line down once they have drained.
 */
function planSupply(battle, mySites, memo) {
  const foes = battle.sites.filter((x) => x.owner !== PLAYER_OWNER);
  if (foes.length === 0 || mySites.length < 2) return [];
  let hub = null;
  let hubKey = null;
  for (const site of mySites) {
    let reach = 0;
    let cost = 0;
    for (const f of foes) {
      const route = routeFor(battle, PLAYER_OWNER, site.id, f.id);
      if (route) { reach += 1; cost += route.cost; }
    }
    if (reach === 0) continue;
    const key = [-reach, cost / reach, site.id];
    if (!hubKey || key[0] < hubKey[0] || (key[0] === hubKey[0] && (key[1] < hubKey[1] || (key[1] === hubKey[1] && key[2] < hubKey[2])))) {
      hubKey = key;
      hub = site;
    }
  }
  if (!hub) return [];
  const lines = new Map((battle.supply || []).filter((l) => l.owner === PLAYER_OWNER).map((l) => [l.from, l]));
  const commands = [];
  for (const site of mySites) {
    const line = lines.get(site.id);
    if (site.id === hub.id) {
      if (line) commands.push({ type: 'unsupply', owner: PLAYER_OWNER, from: site.id });
      continue;
    }
    const wants = memo.supply !== 'overflow' || site.troops >= (line ? 0.3 : 0.6) * site.cap;
    if (!wants) {
      if (line) commands.push({ type: 'unsupply', owner: PLAYER_OWNER, from: site.id });
      continue;
    }
    if (line && line.to === hub.id) continue;
    if (canRoute(battle, PLAYER_OWNER, site.id, hub.id)) {
      commands.push({ type: 'supply', owner: PLAYER_OWNER, from: site.id, to: hub.id });
    } else if (line) {
      commands.push({ type: 'unsupply', owner: PLAYER_OWNER, from: site.id });
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
  const ability = abilityAdvice(battle, t); // the commander's once-per-battle active (DESIGN §10.11), used as a person would
  if (ability) commands.push(ability);

  // a Dragon's telegraphed breath on one of our settlements: Bulwark it (DESIGN §10.13 counterplay)
  const breath = battle.dragon && battle.dragon.breath;
  if (breath && breath.target != null && battle.sites[breath.target]?.owner === PLAYER_OWNER && canUse(battle, 'bulwark', t)) {
    commands.push({ type: 'power', owner: PLAYER_OWNER, power: 'bulwark', target: breath.target });
  }
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
    const wouldSend = mySites.filter((s) => s.id !== keep.id && canRoute(battle, PLAYER_OWNER, s.id, keep.id))
      .reduce((sum, s) => sum + Math.floor(s.troops * rallyShare), 0);
    const attackStrength = wouldSend * myStats.atk * myStats.def;
    if (attackStrength > strengthOf(battle, keep) * MARGIN) {
      commands.push({ type: 'power', owner: PLAYER_OWNER, power: 'rally', target: keep.id });
    }
  }

  if (memo.supply) commands.push(...planSupply(battle, mySites, memo));
  commands.push(...reinforceThreatened(battle, mySites, peak));
  // a look that only fired powers or the ability still plans a capture (with very short cooldowns a power fires at every look, and
  // the bot used to stand still for the whole battle: dragon fights in later dynasties timed out at 12 minutes)
  if (!commands.some((c) => c.type === 'send' || c.type === 'supply' || c.type === 'unsupply')) {
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

// --- Defending in person (DESIGN §10.1), for tools/campaign.mjs and tools/balance.mjs ------------------------------------
// The player watching a defense: the Steward's rules (steward.js) at a person's cadence (one look every 3 s, like decide()),
// looking further ahead, holding a wider margin, using every power it owns (Rally to the keep when it is short) and
// counterattacking the war band with modest odds. Not shipped in the game: the real player plays a watched defense.
const DEFENDER = Object.freeze({
  thinkSec: THINK_SEC, lookahead: 20, margin: 1.3, retake: 1.25, attackOdds: 1.25, consolidate: true, evacuate: true,
  powers: Object.freeze(['bulwark', 'levy', 'firestorm']), reserve: 0.15, useAbility: true,
});

/** Decides this tick's player commands in a DEFENSE battle, as a person defending in person would. `memo` is the caller's. */
export function decideDefense(battle, t, memo = {}) {
  return stewardThink(battle, t, memo, DEFENDER);
}
