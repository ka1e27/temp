// Per-tick resolution of active fights and assaults (progressive strength trade, capture,
// death), site growth/bleed, and win/lose checks. Split out of sim.js to keep files under
// the line budget.
import { BATTLE } from '../config/battle.js';
import {
  applyStrengthTrade, squadPerTroopStrength, garrisonPerTroopStrength, isDead,
  effectiveCap, effectiveGrowth, PLAYER_OWNER,
} from './combat.js';
import { squadPosition } from './position.js';
import { tileAt } from './runtime.js';

function isTargetRegionKeep(battle, site) {
  if (site.type !== 'keep') return false;
  const tile = tileAt(battle, site.tile);
  return !!tile && tile.region === battle.arena.regionId;
}

function checkWin(battle, capturedSite, t) {
  if (capturedSite.owner !== PLAYER_OWNER || !isTargetRegionKeep(battle, capturedSite)) return;
  const flipped = [];
  for (const site of battle.sites) {
    if (site.owner === PLAYER_OWNER) continue;
    const tile = tileAt(battle, site.tile);
    if (!tile || tile.region !== battle.arena.regionId) continue;
    site.owner = PLAYER_OWNER;
    site.cap = effectiveCap(site.type, site.owner, battle.player, site.capMult);
    site.growth = effectiveGrowth(site.type, site.owner, battle.player, battle.arena.enemyFaction, battle.enemy);
    site.bulwarkUntil = 0;
    site.assault = null;
    flipped.push(site.id);
  }
  battle.events.push({ type: 'surrender', sites: flipped });
  battle.result = 'win';
  battle.stats.durationSec = t;
  battle.events.push({ type: 'end', result: 'win' });
}

/** Resolves every squad-vs-squad fight and site assault in progress this tick. */
export function resolveCombat(battle, dt, t) {
  const { player, enemy, arena } = battle;
  const dead = new Set();
  const seen = new Set();

  for (const squad of battle.squads) {
    if (squad.state !== 'fight' || seen.has(squad.id)) continue;
    const foe = battle.squads.find((s) => s.id === squad.foe);
    if (!foe) {
      squad.state = 'march';
      squad.foe = null;
      continue;
    }
    seen.add(squad.id);
    seen.add(foe.id);
    const aPerTroop = squadPerTroopStrength(squad.owner, player, arena.enemyFaction, enemy, true);
    const bPerTroop = squadPerTroopStrength(foe.owner, player, arena.enemyFaction, enemy, true);
    const beforeA = squad.count;
    const beforeB = foe.count;
    const traded = applyStrengthTrade({
      atkTroops: squad.count, atkPerTroop: aPerTroop, defTroops: foe.count, defPerTroop: bPerTroop, dt,
    });
    squad.count = Math.max(0, traded.atkTroops);
    foe.count = Math.max(0, traded.defTroops);
    const aDead = isDead(squad.count);
    const bDead = isDead(foe.count);
    if (aDead || bDead) {
      const pos = squadPosition(battle, squad);
      const winner = aDead && bDead ? null : (aDead ? foe.id : squad.id);
      battle.events.push({ type: 'clashEnd', x: pos.x, y: pos.y, winner });
      if (aDead) { dead.add(squad.id); creditLoss(battle, squad.owner, beforeA); }
      else { squad.state = 'march'; squad.foe = null; }
      if (bDead) { dead.add(foe.id); creditLoss(battle, foe.owner, beforeB); }
      else { foe.state = 'march'; foe.foe = null; }
    }
  }

  for (const site of battle.sites) {
    if (!site.assault) continue;
    const squads = site.assault.squads
      .map((id) => battle.squads.find((s) => s.id === id))
      .filter(Boolean)
      .sort((a, b) => a.id - b.id);
    if (squads.length === 0) {
      site.assault = null;
      continue;
    }
    const attackerOwner = site.assault.owner;
    const atkPerTroop = squadPerTroopStrength(attackerOwner, player, arena.enemyFaction, enemy);
    const defPerTroop = garrisonPerTroopStrength(site, site.owner, player, arena.enemyFaction, enemy, t);
    const atkTotal = squads.reduce((sum, s) => sum + s.count, 0);
    const beforeDef = site.troops;
    const traded = applyStrengthTrade({
      atkTroops: atkTotal, atkPerTroop, defTroops: site.troops, defPerTroop, dt,
    });
    let loss = Math.max(0, atkTotal - traded.atkTroops);
    for (const s of squads) {
      const take = Math.min(loss, s.count);
      s.count -= take;
      loss -= take;
      if (isDead(s.count)) dead.add(s.id);
    }
    site.troops = Math.max(0, traded.defTroops);

    if (isDead(site.troops)) {
      const survivors = squads.filter((s) => !dead.has(s.id));
      const garrison = survivors.reduce((sum, s) => sum + s.count, 0);
      const fromOwner = site.owner;
      creditLoss(battle, fromOwner, beforeDef);
      site.owner = attackerOwner;
      site.troops = garrison;
      site.cap = effectiveCap(site.type, site.owner, player, site.capMult);
      site.growth = effectiveGrowth(site.type, site.owner, player, arena.enemyFaction, enemy);
      site.bulwarkUntil = 0;
      site.assault = null;
      for (const s of survivors) dead.add(s.id);
      if (attackerOwner === PLAYER_OWNER) battle.stats.captured += 1;
      const pos = tileAt(battle, site.tile);
      battle.events.push({ type: 'capture', site: site.id, from: fromOwner, to: attackerOwner, x: pos.x, y: pos.y });
      checkWin(battle, site, t);
    } else if (squads.every((s) => dead.has(s.id))) {
      site.assault = null;
    }
  }

  if (dead.size) battle.squads = battle.squads.filter((s) => !dead.has(s.id));
}

function creditLoss(battle, owner, amount) {
  if (owner === PLAYER_OWNER) battle.stats.lost += amount;
  else battle.stats.killed += amount;
}

/** Growth below cap, bleed above cap (DESIGN §4.2). */
export function applyGrowth(battle, dt) {
  for (const site of battle.sites) {
    if (site.troops < site.cap) {
      site.troops = Math.min(site.cap, site.troops + site.growth * dt);
    } else if (site.troops > site.cap) {
      const excess = site.troops - site.cap;
      const bleed = Math.max(BATTLE.minBleed, BATTLE.overCapBleed * excess);
      site.troops = Math.max(site.cap, site.troops - bleed * dt);
    }
  }
}

/** Lose: the player has no sites and no squads left in the arena. */
export function checkEndConditions(battle, t) {
  if (battle.result) return;
  const hasSite = battle.sites.some((s) => s.owner === PLAYER_OWNER);
  const hasSquad = battle.squads.some((s) => s.owner === PLAYER_OWNER);
  if (!hasSite && !hasSquad) {
    battle.result = 'lose';
    battle.stats.durationSec = t;
    battle.events.push({ type: 'end', result: 'lose' });
  }
}
