// The Steward (DESIGN §10.6, ARCHITECTURE §10.3): commands the PLAYER's side of a battle nobody is watching (or one set to Auto).
// `stewardDecide(battle, t, memo, style) -> Command[]`, a peer of ai.js's think() and bot.js's decide(): it reads the battle and
// returns commands for the caller to issue(); it mutates only `memo` (its own plain-JSON scratch state). Pure and deterministic.
//
// Its aim, per the user, is to keep your troops and buildings alive as long as possible:
//   1. powers first: Bulwark on a site that is about to fall, Levy when ready, Firestorm on a big war party (by style)
//   2. reinforce every threatened site early, keep first, from settlements that can arrive in time, never stripping one that is
//      itself threatened; a small site it cannot save is evacuated into the keep instead of thrown away (stalwart and up)
//   3. pull surplus troops from small settlements into the keep and forts while it is quiet (stalwart and up)
//   4. retake / attack only with clear odds: style.retake (1.5x) in a defense, style.attackOdds (2x) in an attack, so it never
//      sends into a losing fight; in a defense the keep never leaves its walls
//   5. it never retreats (only the player can)
// Styles (FRONTIER STEWARD table in config/frontier.js): 'captain' (the weak Militia Captain: slow, short-sighted, no evacuation),
// 'stalwart' (the strong default), and the Phase-2 variants 'bold', 'cunning', 'swift'.
import { BATTLE, POWERS, SITE_TYPES } from '../config/battle.js';
import { STEWARD } from '../config/frontier.js';
import { GENERALS } from '../config/generals.js';
import { abilityAdvice } from './abilities.js';
import { towerRangeMult, powersBlocked } from './features.js';
import { ownerStats, siteDefence, PLAYER_OWNER } from './combat.js';
import { routeFor } from './routing.js';
import { getRuntime } from './runtime.js';
import { squadPosition } from './position.js';
import { worldDist, hexRadiusToWorld } from './geom.js';

const DEFENSIBLE = new Set(['keep', 'fort', 'tower', 'camp']);
const SITE_VALUE = { hamlet: 15, village: 35, town: 55, fort: 60, tower: 30, keep: 200, camp: 90, bandit: 40, gate: 90, shrine: 80 };
const MIN_SQUAD = 2;
const SAVE_POOL = 0.6;      // help a small site only when the helpers can cover this share of its shortfall
const KEEP_SLACK = 30;      // seconds: help for the keep may arrive this late (the siege goes on)
const SITE_SLACK = 3;       // ...for any other site
const CONSOLIDATE_AT = 0.45; // a quiet small settlement above this share of its cap sends its surplus to the keep
const ARROW_SAFETY = 1.3;
const IMMINENT_SEC = 2;     // squads this close count as landing now (Bulwark timing)

/**
 * The parameter table for a style: a name ('captain', 'stalwart', ...; unknown names get the strong default), or a General's style
 * object `{ style, level, skills }` (meta/generalsState.js commanderStyle): the style's table with its think interval and lookahead
 * set by level (GENERALS.steward, level 1 to 10) and its skills applied (DESIGN §10.11).
 */
export function stewardStyle(style) {
  if (style && typeof style === 'object') return commanderParams(style);
  return STEWARD[style] || STEWARD.stalwart;
}

const paramCache = new Map();

function commanderParams(c) {
  const skills = Array.isArray(c.skills) ? c.skills : [];
  const level = Math.max(1, Math.min(GENERALS.maxLevel, Number(c.level) || 1));
  const key = `${c.style}|${level}|${skills.join(',')}`;
  if (paramCache.has(key)) return paramCache.get(key);
  const style = STEWARD[c.style] || STEWARD.stalwart;
  const tactics = level >= GENERALS.steward.tacticsFromLevel;
  const base = {
    ...STEWARD.captain, retake: style.retake, attackOdds: style.attackOdds, powers: style.powers, reserve: style.reserve,
    ...(tactics ? { consolidate: style.consolidate, evacuate: style.evacuate, margin: style.margin } : {}),
  };
  const k = (level - 1) / (GENERALS.maxLevel - 1);
  const lo = GENERALS.steward.atLevel1;
  const hi = GENERALS.steward.atLevel10;
  const sv = GENERALS.skillValues;
  const p = {
    ...base,
    thinkSec: (lo.thinkSec + (hi.thinkSec - lo.thinkSec) * k) * (skills.includes('thinkFast') ? GENERALS.steward.thinkFast : 1),
    lookahead: lo.lookahead + (hi.lookahead - lo.lookahead) * k + (skills.includes('relocateFast') ? sv.relocateFast : 0),
    useAbility: true,
  };
  if (skills.includes('counter13')) p.retake = Math.min(p.retake, sv.counter13);
  if (skills.includes('holdForts')) p.fortMargin = sv.holdForts;
  if (skills.includes('usesFirestorm') && !p.powers.includes('firestorm')) p.powers = [...p.powers, 'firestorm'];
  paramCache.set(key, p);
  return p;
}

function speedOf(battle, owner, t) {
  const stats = ownerStats(owner, battle.player, battle.arena.enemyFaction, battle.enemy);
  const march = owner === PLAYER_OWNER && t < battle.effects.marchUntil ? POWERS.march.mult : 1;
  return Math.max(0.01, BATTLE.baseSpeed * (stats.speed ?? 1) * march);
}

function unitOf(battle, owner) {
  const s = ownerStats(owner, battle.player, battle.arena.enemyFaction, battle.enemy);
  return s.atk * s.def;
}

function defUnit(battle, site, t) {
  const bulwark = t < site.bulwarkUntil ? POWERS.bulwark.mult : 1;
  return unitOf(battle, site.owner) * siteDefence(site) * bulwark;
}

function remainingCost(battle, squad) {
  const byIndex = getRuntime(battle).byIndex;
  let cost = 0;
  for (let j = squad.seg; j < squad.path.length; j++) {
    const tile = byIndex.get(squad.path[j]);
    if (tile) cost += tile.cost * (j === squad.seg ? 1 - squad.prog : 1);
  }
  return cost;
}

/** Troops a site will hold in `sec` (growth toward the cap, bleed above it): sim.js's rule. */
function projectTroops(site, sec) {
  if (site.troops < site.cap) return Math.min(site.cap, site.troops + site.growth * sec);
  if (site.troops > site.cap) {
    const bleed = Math.max(BATTLE.minBleed, BATTLE.overCapBleed * (site.troops - site.cap));
    return Math.max(site.cap, site.troops - bleed * sec);
  }
  return site.troops;
}

function routeCost(battle, from, to) {
  const r = routeFor(battle, PLAYER_OWNER, from.id, to.id);
  return r ? r.cost : Infinity;
}

/** Troops a squad should expect to lose to hostile towers on the way and while it fights at the target (bot.js's rule). */
function arrowLoss(battle, route, target, speed) {
  if (!route) return 0;
  const towers = battle.sites.filter((x) => x.type === 'tower' && x.owner !== PLAYER_OWNER && x.troops >= 1);
  if (towers.length === 0) return 0;
  const rt = getRuntime(battle);
  const targetTile = rt.byIndex.get(target.tile);
  let loss = 0;
  for (const tower of towers) {
    const towerTile = rt.byIndex.get(tower.tile);
    if (!towerTile) continue;
    const range = hexRadiusToWorld((tower.range ?? SITE_TYPES.tower.range) * towerRangeMult(battle));
    const volley = tower.volleySec ?? SITE_TYPES.tower.volleySec;
    let inRange = 0;
    for (const i of route.tiles) {
      const tile = rt.byIndex.get(i);
      if (tile && worldDist(tile, towerTile) <= range) inRange += tile.cost / speed;
    }
    if (targetTile && worldDist(targetTile, towerTile) <= range) inRange += 4;
    loss += (inRange / volley) * (tower.volleyKills ?? SITE_TYPES.tower.volleyKills) * ownerStats(tower.owner, battle.player, battle.arena.enemyFaction, battle.enemy).atk;
  }
  return loss;
}

/** What threatens each of my sites: { strength, eta, assault } keyed by site id, and my squads already on their way. */
function threats(battle, t) {
  const out = new Map();
  const enRoute = new Map();
  for (const sq of battle.squads) {
    const to = battle.sites[sq.to];
    if (!to) continue;
    if (sq.owner === PLAYER_OWNER) {
      if (to.owner === PLAYER_OWNER && sq.state === 'march') enRoute.set(to.id, (enRoute.get(to.id) || 0) + sq.count);
      continue;
    }
    if (to.owner !== PLAYER_OWNER || sq.state !== 'march') continue;
    const eta = remainingCost(battle, sq) / speedOf(battle, sq.owner, t);
    const cur = out.get(to.id) || { strength: 0, eta: Infinity, assault: 0, soon: 0, squads: [] };
    cur.strength += sq.count * unitOf(battle, sq.owner);
    if (eta <= IMMINENT_SEC) cur.soon += sq.count * unitOf(battle, sq.owner);
    cur.eta = Math.min(cur.eta, eta);
    cur.squads.push(sq);
    out.set(to.id, cur);
  }
  for (const site of battle.sites) {
    if (site.owner !== PLAYER_OWNER || !site.assault || site.assault.owner === PLAYER_OWNER) continue;
    let s = 0;
    for (const id of site.assault.squads) {
      const sq = battle.squads.find((q) => q.id === id);
      if (sq) s += sq.count * unitOf(battle, sq.owner);
    }
    const cur = out.get(site.id) || { strength: 0, eta: Infinity, assault: 0, soon: 0, squads: [] };
    cur.assault = s;
    cur.strength += s;
    cur.soon += s;
    cur.eta = 0;
    out.set(site.id, cur);
  }
  return { threat: out, enRoute };
}

function canUse(battle, power, t) {
  const level = battle.player.powers?.[power] || 0;
  return level >= 1 && t >= (battle.cooldowns[power] ?? 0) && !powersBlocked(battle); // Holy Ground: no powers
}

function send(commands, spent, site, to, count) {
  const n = Math.floor(Math.min(count, site.troops - (spent.get(site.id) || 0)));
  if (n < MIN_SQUAD) return 0;
  commands.push({ type: 'send', owner: PLAYER_OWNER, from: [site.id], to: to.id, fraction: Math.min(1, (n + 0.01) / site.troops) });
  spent.set(site.id, (spent.get(site.id) || 0) + n);
  return n;
}

function nearestArenaTileQR(battle, pos) {
  let best = null;
  let bestDist = Infinity;
  for (const tile of battle.arena.tiles) {
    const d = (tile.x - pos.x) ** 2 + (tile.y - pos.y) ** 2;
    if (d < bestDist) { bestDist = d; best = tile; }
  }
  return best ? { q: best.q, r: best.r } : null;
}

/**
 * The steward's decisions with an explicit parameter table (the shape of a STEWARD entry). `stewardDecide` is this with the
 * table of a named style; the tools' in-person defender (bot.js decideDefense) uses its own.
 * @param {object} battle BattleState
 * @param {number} t battle time
 * @param {object} memo plain JSON scratch state owned by the caller (kept across calls)
 * @param {object} p a STEWARD-shaped parameter table
 * @returns {object[]} commands
 */
export function stewardThink(battle, t, memo, p) {
  if (battle.result) return [];
  if (t < (memo.nextThink || 0)) return [];
  memo.nextThink = t + p.thinkSec;
  const mine = battle.sites.filter((s) => s.owner === PLAYER_OWNER);
  if (mine.length === 0) return [];
  const defense = battle.mode === 'defense';
  const commands = [];
  const spent = new Map();
  const { threat, enRoute } = threats(battle, t);
  const keep = defense ? mine.find((s) => s.type === 'keep' && s.id === battle.arena.keepSite) || mine.find((s) => s.type === 'keep') : null;
  const myUnit = unitOf(battle, PLAYER_OWNER);
  const mySpeed = speedOf(battle, PLAYER_OWNER, t);
  const powers = new Set(p.powers || []);

  // What each threatened site still needs (troops), judged at the attack's arrival.
  const need = new Map();
  for (const site of mine) {
    const th = threat.get(site.id);
    if (!th || th.eta > p.lookahead) continue;
    const unit = defUnit(battle, site, t + th.eta);
    const garrison = projectTroops(site, th.eta) + (enRoute.get(site.id) || 0);
    const margin = p.margin + (p.fortMargin && (site.type === 'keep' || site.type === 'fort') ? p.fortMargin : 0);
    const deficit = (th.strength * margin) / unit - garrison;
    if (deficit > 0) need.set(site.id, deficit);
  }
  const holdBack = (site) => {
    if (defense && keep && site.id === keep.id) return site.troops; // the keep never leaves its walls
    let hold = p.reserve * site.troops;
    const th = threat.get(site.id);
    if (th && th.eta <= p.lookahead) {
      hold = Math.max(hold, Math.min(site.troops, (th.strength * 1.05) / defUnit(battle, site, t + th.eta)));
    }
    if (site.assault && site.assault.owner !== PLAYER_OWNER) hold = site.troops;
    return hold;
  };
  const avail = (site) => Math.max(0, site.troops - holdBack(site) - (spent.get(site.id) || 0));

  // 0. The commander's ability (a General's steward uses it when a sensible commander would, DESIGN §10.11)
  if (p.useAbility) {
    const a = abilityAdvice(battle, t);
    if (a) commands.push(a);
  }

  // 1. Powers ---------------------------------------------------------------------------------------------------------
  // a Dragon's telegraphed breath on a settlement of ours: Bulwark it first (DESIGN §10.13)
  const breath = battle.dragon && battle.dragon.breath;
  if (powers.has('bulwark') && breath && breath.target != null && battle.sites[breath.target]?.owner === PLAYER_OWNER && canUse(battle, 'bulwark', t)) {
    commands.push({ type: 'power', owner: PLAYER_OWNER, power: 'bulwark', target: breath.target });
  } else if (powers.has('bulwark') && canUse(battle, 'bulwark', t)) {
    let best = null;
    for (const site of mine) {
      const th = threat.get(site.id);
      // only when the bulk of the attack lands now: Bulwark lasts a few seconds, so a scout squad must not waste it
      if (!th || th.soon <= 0 || th.soon < 0.5 * th.strength || t < site.bulwarkUntil) continue;
      const ratio = (site.troops * defUnit(battle, site, t)) / Math.max(1e-6, th.soon);
      if (ratio >= 1.3 || ratio < 0.25) continue; // safe already, or past saving
      const key = (SITE_VALUE[site.type] ?? 20) / ratio;
      if (!best || key > best.key) best = { site, key };
    }
    if (best) commands.push({ type: 'power', owner: PLAYER_OWNER, power: 'bulwark', target: best.site.id });
  }
  if (powers.has('levy') && canUse(battle, 'levy', t) && (threat.size > 0 || t >= 8)) {
    commands.push({ type: 'power', owner: PLAYER_OWNER, power: 'levy', target: null });
  }
  if (powers.has('firestorm') && canUse(battle, 'firestorm', t)) {
    const level = battle.player.powers.firestorm;
    const damage = POWERS.firestorm.damage + POWERS.firestorm.damagePerLevel * (level - 1);
    let best = null;
    for (const sq of battle.squads) {
      if (sq.owner === PLAYER_OWNER) continue;
      const to = battle.sites[sq.to];
      if (!to || to.owner !== PLAYER_OWNER) continue;
      if (sq.count < damage * 1.2) continue;
      if (!best || sq.count > best.count) best = sq;
    }
    if (best) {
      const qr = nearestArenaTileQR(battle, squadPosition(battle, best));
      if (qr) commands.push({ type: 'power', owner: PLAYER_OWNER, power: 'firestorm', target: qr });
    }
  }
  if (powers.has('rally') && keep && canUse(battle, 'rally', t) && need.get(keep.id) > 0) {
    commands.push({ type: 'power', owner: PLAYER_OWNER, power: 'rally', target: keep.id });
  }
  if (powers.has('march') && canUse(battle, 'march', t) && t >= battle.effects.marchUntil
    && battle.squads.some((s) => s.owner === PLAYER_OWNER && s.state === 'march' && s.count >= 10 && battle.sites[s.to]?.owner === PLAYER_OWNER)) {
    commands.push({ type: 'power', owner: PLAYER_OWNER, power: 'march', target: null });
  }

  // 2. Reinforce threatened sites, keep first, then by value -------------------------------------------------------------
  const order = [...need.keys()].map((id) => battle.sites[id])
    .sort((a, b) => (SITE_VALUE[b.type] ?? 20) - (SITE_VALUE[a.type] ?? 20) || a.id - b.id);
  for (const site of order) {
    let deficit = need.get(site.id);
    const th = threat.get(site.id);
    const isKeep = keep && site.id === keep.id;
    const slack = isKeep || site.type === 'camp' ? KEEP_SLACK : SITE_SLACK;
    const helpers = [];
    for (const h of mine) {
      if (h.id === site.id || need.has(h.id)) continue;
      const cost = routeCost(battle, h, site);
      if (!Number.isFinite(cost)) continue;
      const eta = cost / mySpeed;
      if (eta > th.eta + slack) continue;
      const a = avail(h);
      if (a >= MIN_SQUAD) helpers.push({ site: h, avail: a, eta });
    }
    helpers.sort((a, b) => a.eta - b.eta || a.site.id - b.site.id);
    const pool = helpers.reduce((s, h) => s + h.avail, 0);
    if (!isKeep && pool < deficit * SAVE_POOL) {
      // past saving: pull the garrison back into the keep (or a fort) instead of losing it for nothing
      if (p.evacuate && !DEFENSIBLE.has(site.type) && site.troops >= MIN_SQUAD && (!site.assault || site.assault.owner === PLAYER_OWNER)) {
        const refuge = mine.filter((r) => r.id !== site.id && DEFENSIBLE.has(r.type) && r.type !== 'tower' && !need.has(r.id))
          .map((r) => ({ r, cost: routeCost(battle, site, r) }))
          .filter((x) => Number.isFinite(x.cost))
          .sort((a, b) => (b.r === keep) - (a.r === keep) || a.cost - b.cost || a.r.id - b.r.id)[0];
        if (refuge && refuge.cost / mySpeed < Math.max(th.eta + 6, 4)) send(commands, spent, site, refuge.r, site.troops);
      }
      continue;
    }
    for (const h of helpers) {
      if (deficit <= 0) break;
      const n = send(commands, spent, h.site, site, Math.min(h.avail, deficit + 1));
      deficit -= n;
    }
  }

  // 3. Consolidate: quiet small settlements feed the keep (defense) ------------------------------------------------------
  if (p.consolidate && keep && !need.has(keep.id) && keep.troops < keep.cap * 0.95) {
    for (const site of mine) {
      if (site.id === keep.id || DEFENSIBLE.has(site.type) || threat.has(site.id)) continue;
      if (site.troops < CONSOLIDATE_AT * site.cap) continue;
      if (!Number.isFinite(routeCost(battle, site, keep))) continue;
      send(commands, spent, site, keep, Math.floor(site.troops * 0.5));
    }
  }

  // 4. Retake / attack with clear odds -----------------------------------------------------------------------------------
  const odds = defense ? p.retake : p.attackOdds;
  const sources = mine.filter((s) => !need.has(s.id) && avail(s) >= MIN_SQUAD);
  if (sources.length && battle.squads.filter((s) => s.owner === PLAYER_OWNER).length < 12) {
    let best = null;
    for (const target of battle.sites) {
      if (target.owner === PLAYER_OWNER) continue;
      if (target.assault && target.assault.owner === PLAYER_OWNER) continue; // already under our attack
      const reach = sources.map((s) => ({ s, route: routeFor(battle, PLAYER_OWNER, s.id, target.id) })).filter((x) => x.route);
      if (reach.length === 0) continue;
      reach.sort((a, b) => a.route.cost - b.route.cost || a.s.id - b.s.id);
      const arrive = reach[0].route.cost / mySpeed;
      const garrison = projectTroops(target, arrive);
      let needTroops = (garrison * defUnit(battle, target, t + arrive) * odds) / myUnit;
      needTroops += ARROW_SAFETY * arrowLoss(battle, reach[0].route, target, mySpeed);
      // squads of theirs on the way to reinforce it count against us too
      for (const sq of battle.squads) if (sq.owner === target.owner && sq.to === target.id) needTroops += (sq.count * unitOf(battle, sq.owner) * odds) / myUnit;
      let pooled = 0;
      for (const x of reach) pooled += avail(x.s);
      if (pooled < needTroops) continue;
      const value = (SITE_VALUE[target.type] ?? 20) * (defense && target.type === 'camp' ? 1.5 : 1);
      const score = value / (needTroops + 1) / (arrive + 2);
      if (!best || score > best.score) best = { target, reach, needTroops, score };
    }
    if (best) {
      let left = best.needTroops * 1.05 + 1;
      for (const x of best.reach) {
        if (left <= 0) break;
        left -= send(commands, spent, x.s, best.target, Math.min(avail(x.s), left));
      }
    }
  }
  return commands;
}

/**
 * The player-side policy of DESIGN §10.6 for a battle nobody is watching (ARCHITECTURE §10.3).
 * @param {object} battle BattleState (attack or defense)
 * @param {number} t battle time (battle.t)
 * @param {object} [memo] plain-JSON scratch state the caller keeps across calls; when omitted, `battle.steward` is used (created
 *   on first use), so a saved battle resumes its steward exactly
 * @param {'captain'|'stalwart'|'bold'|'cunning'|'swift'|{style:string, level:number, skills:string[]}} [style='stalwart'] a style name,
 *   or a General's style object (meta/generalsState.js commanderStyle): quality then scales with its level and skills
 * @returns {object[]} commands to issue() before the next step()
 */
export function stewardDecide(battle, t, memo, style = 'stalwart') {
  const m = memo || battle.steward || (battle.steward = {});
  return stewardThink(battle, t, m, stewardStyle(style));
}
