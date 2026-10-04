// Threat readout for the player's settlements (docs/BACKLOG.md #1): for every player-owned site
// that enemy squads are marching on (or already besieging), predict whether it holds, the same way
// `previewSend` predicts a player send. Pure: reads a BattleState, never mutates it.
//
// APPROXIMATION (deliberate, and the only one): every incoming squad is assumed to arrive at
// the same moment as the FIRST one and nothing else changes. Garrison growth (or over-cap bleed)
// up to that first arrival IS projected, Bulwark IS honoured if it is active at arrival, but later
// reinforcements, interceptions and the player's own next order are not. That is exactly the
// information a player needs to decide "do I send help?", and it is cheap enough to recompute at
// a few Hz.
import { BATTLE, POWERS } from '../config/battle.js';
import {
  ownerStats, squadPerTroopStrength, garrisonPerTroopStrength, PLAYER_OWNER,
} from '../battle/combat.js';
import { getRuntime } from '../battle/runtime.js';

/** Seconds until a marching squad reaches the end of its path (0 if it is already at the gate). */
export function squadEtaSec(battle, squad) {
  if (squad.state === 'assault') return 0;
  const rt = getRuntime(battle);
  const stats = ownerStats(squad.owner, battle.player, battle.arena.enemyFaction, battle.enemy);
  const marchActive = squad.owner === PLAYER_OWNER && battle.t < battle.effects.marchUntil;
  const speed = BATTLE.baseSpeed * stats.speed * (marchActive ? POWERS.march.mult : 1);
  const path = squad.path || [];
  let sec = 0;
  for (let i = Math.min(squad.seg, path.length); i < path.length; i++) {
    const tile = rt.byIndex.get(path[i]);
    if (!tile) continue;
    const remaining = i === squad.seg ? 1 - Math.max(0, Math.min(1, squad.prog)) : 1;
    sec += (tile.cost * remaining) / speed;
  }
  return sec;
}

/** Garrison size `seconds` from now (growth below cap, bleed above it). */
export function projectGarrison(site, seconds) {
  if (site.troops < site.cap) return Math.min(site.cap, site.troops + site.growth * seconds);
  if (site.troops > site.cap) {
    const excess = site.troops - site.cap;
    const bleed = Math.max(BATTLE.minBleed, BATTLE.overCapBleed * excess);
    return Math.max(site.cap, site.troops - bleed * seconds);
  }
  return site.troops;
}

/**
 * @typedef {Object} Threat
 * @property {number} siteId
 * @property {number} incoming      total enemy troops heading here (including those already at the gate)
 * @property {number} etaSec        first arrival
 * @property {boolean} holds
 * @property {number} loss          troops the garrison is predicted to lose (if it holds)
 * @property {number} short         garrison troops missing to hold (if it falls)
 * @property {string} text          "−14 · holds" or "falls, 6 short"
 * @property {number} attackerOwner faction of the strongest attacker (for the chip's accent)
 */

/**
 * @param {object} battle BattleState
 * @returns {Map<number, Threat>} keyed by player-owned site id; sites nobody is coming for are absent
 */
export function computeThreats(battle) {
  const groups = new Map();
  for (const sq of battle.squads) {
    if (sq.owner === PLAYER_OWNER) continue;
    const target = battle.sites[sq.to];
    if (!target || target.owner !== PLAYER_OWNER) continue;
    let g = groups.get(target.id);
    if (!g) { g = { squads: [], target }; groups.set(target.id, g); }
    g.squads.push(sq);
  }

  const out = new Map();
  for (const [siteId, g] of groups) {
    const site = g.target;
    let firstEta = Infinity;
    let atk = 0;
    let incoming = 0;
    let top = { count: -1, owner: g.squads[0].owner };
    for (const sq of g.squads) {
      const eta = squadEtaSec(battle, sq);
      if (eta < firstEta) firstEta = eta;
      atk += sq.count * squadPerTroopStrength(sq.owner, battle.player, battle.arena.enemyFaction, battle.enemy);
      incoming += sq.count;
      if (sq.count > top.count) top = { count: sq.count, owner: sq.owner };
    }
    const garrison = projectGarrison(site, firstEta);
    // per troop: site defence x Walls (combat.js siteDefence(site), site.defMult) x Bulwark: a walled keep holds more
    const defPer = garrisonPerTroopStrength(
      site, PLAYER_OWNER, battle.player, battle.arena.enemyFaction, battle.enemy, battle.t + firstEta,
    );
    const def = garrison * defPer;
    const holds = def >= atk;
    const loss = Math.max(1, Math.round(atk / defPer));
    const short = Math.max(1, Math.ceil((atk - def) / defPer));
    out.set(siteId, {
      siteId,
      incoming: Math.round(incoming),
      etaSec: firstEta,
      holds,
      loss,
      short,
      text: holds ? `−${loss} · holds` : `falls, ${short} short`,
      attackerOwner: top.owner,
    });
  }
  return out;
}
