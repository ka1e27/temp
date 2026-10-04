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
import { checkShrines } from './features.js';
import { damageDragon } from './dragon.js';
import { onAssaultTrade, onClash } from './fallen.js';

function isTargetRegionKeep(battle, site) {
  if (site.type !== 'keep') return false;
  const tile = tileAt(battle, site.tile);
  return !!tile && tile.region === battle.arena.regionId;
}

/** Every site of the target region not held by `winner` surrenders to it (the keep's cascade). Returns the flipped ids. */
function cascade(battle, winner) {
  const flipped = [];
  for (const site of battle.sites) {
    if (site.owner === winner) continue;
    const tile = tileAt(battle, site.tile);
    if (!tile || tile.region !== battle.arena.regionId) continue;
    site.owner = winner;
    site.cap = effectiveCap(site.type, site.owner, battle.player, site.capMult, site.pCapMult);
    site.growth = effectiveGrowth(site.type, site.owner, battle.player, battle.arena.enemyFaction, battle.enemy);
    site.bulwarkUntil = 0;
    site.assault = null;
    flipped.push(site.id);
  }
  return flipped;
}

function endBattle(battle, result, t) {
  battle.result = result;
  battle.stats.durationSec = t;
  battle.events.push({ type: 'end', result });
}

function checkWin(battle, capturedSite, t) {
  if (!isTargetRegionKeep(battle, capturedSite)) return;
  if (battle.mode === 'defense') {
    // Defense (ARCHITECTURE §10.3): the attackers took YOUR keep. The region's remaining sites surrender to them.
    if (capturedSite.owner === PLAYER_OWNER) return;
    const flipped = cascade(battle, capturedSite.owner);
    battle.events.push({ type: 'surrender', sites: flipped, to: capturedSite.owner });
    endBattle(battle, 'lose', t);
    return;
  }
  if (capturedSite.owner !== PLAYER_OWNER) return;
  if (battle.dragon && !battle.dragon.dead) return; // a Dragon's Lair falls with its Dragon, not its keep (DESIGN §10.13)
  battle.events.push({ type: 'surrender', sites: cascade(battle, PLAYER_OWNER) });
  endBattle(battle, 'win', t);
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
    const aPerTroop = squadPerTroopStrength(squad.owner, player, arena.enemyFaction, enemy, true) * (squad.power ?? 1);
    const bPerTroop = squadPerTroopStrength(foe.owner, player, arena.enemyFaction, enemy, true) * (foe.power ?? 1);
    const beforeA = squad.count;
    const beforeB = foe.count;
    const traded = applyStrengthTrade({
      atkTroops: squad.count, atkPerTroop: aPerTroop, defTroops: foe.count, defPerTroop: bPerTroop, dt,
    });
    squad.count = Math.max(0, traded.atkTroops);
    foe.count = Math.max(0, traded.defTroops);
    onClash(battle, t, squad, beforeA, foe, beforeB); // the losses log Raise the Fallen reads (PLAN-PHASE6)
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
    if (battle.result && battle.dragon) break; // the Dragon fell: the region surrendered this tick
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
    // Charge squads (DESIGN §10.11) count `power` x their troops; with none, power is 1 and this is the plain troop sum
    const atkTotal = squads.reduce((sum, s) => sum + s.count * (s.power ?? 1), 0);
    const beforeDef = site.troops;
    const traded = applyStrengthTrade({
      atkTroops: atkTotal, atkPerTroop, defTroops: site.troops, defPerTroop, dt,
    });
    let loss = Math.max(0, atkTotal - traded.atkTroops);
    // a Dragon perched here takes the blows the assault lands (DESIGN §10.13)
    if (battle.dragon && battle.dragon.perch === site.id && attackerOwner === PLAYER_OWNER) {
      if (damageDragon(battle, (beforeDef - Math.max(0, traded.defTroops)) * defPerTroop, t)) {
        battle.events.push({ type: 'surrender', sites: cascade(battle, PLAYER_OWNER) });
        endBattle(battle, 'win', t);
      }
    }
    const countBefore = squads.reduce((sum, s) => sum + s.count, 0);
    for (const s of squads) {
      const p = s.power ?? 1;
      const take = Math.min(loss, s.count * p);
      s.count -= take / p;
      loss -= take;
      if (isDead(s.count)) dead.add(s.id);
    }
    site.troops = Math.max(0, traded.defTroops);
    // The Ashen Host (PLAN-PHASE6): The Fallen Rise, war-band growth, the Gravewarden's passive, the losses log
    const alive = squads.filter((s) => !dead.has(s.id));
    const atkLost = countBefore - squads.reduce((sum, s) => sum + Math.max(0, s.count), 0);
    onAssaultTrade(battle, site, attackerOwner, alive, atkLost, beforeDef - site.troops, isDead(site.troops), t);

    if (isDead(site.troops)) {
      const survivors = squads.filter((s) => !dead.has(s.id));
      const garrison = survivors.reduce((sum, s) => sum + s.count, 0);
      const fromOwner = site.owner;
      creditLoss(battle, fromOwner, beforeDef);
      site.owner = attackerOwner;
      site.troops = garrison;
      site.cap = effectiveCap(site.type, site.owner, player, site.capMult, site.pCapMult);
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
  const defense = battle.mode === 'defense';
  for (const site of battle.sites) {
    // Defense battles: a garrison under assault does not regrow. A walled, Bulwarked keep with a strong player's attack and
    // defence regrows nearly BATTLE.fightRateMin of strength a second, so an assault on it could never finish (a stalemate
    // the siege timer would always win); attack battles keep their own tuned rule.
    if (defense && site.assault && site.troops < site.cap) continue;
    if (site.troops < site.cap) {
      site.troops = Math.min(site.cap, site.troops + site.growth * dt);
    } else if (site.troops > site.cap) {
      const excess = site.troops - site.cap;
      const bleed = Math.max(BATTLE.minBleed, BATTLE.overCapBleed * excess);
      site.troops = Math.max(site.cap, site.troops - bleed * dt);
    }
  }
}

/**
 * Lose: the player has no sites and no squads left in the arena.
 * Defense mode (ARCHITECTURE §10.3) also ends in a WIN when the siege timer runs out with the player's keep still held
 * (`battle.t >= battle.siegeSec`), or when the attackers (the arena's enemy faction) have no sites and no squads left.
 */
export function checkEndConditions(battle, t) {
  if (battle.result) return;
  const hasSite = battle.sites.some((s) => s.owner === PLAYER_OWNER);
  const hasSquad = battle.squads.some((s) => s.owner === PLAYER_OWNER);
  if (!hasSite && !hasSquad) {
    endBattle(battle, 'lose', t);
    return;
  }
  if (battle.mode !== 'defense') {
    if (battle.dragon && battle.dragon.dead) { // the Dragon fell (or had nowhere left to perch): the region surrenders
      battle.events.push({ type: 'surrender', sites: cascade(battle, PLAYER_OWNER) });
      endBattle(battle, 'win', t);
      return;
    }
    if (checkShrines(battle, t)) { // Raid (DESIGN §10.13): every Shrine held long enough
      battle.events.push({ type: 'surrender', sites: cascade(battle, PLAYER_OWNER) });
      endBattle(battle, 'win', t);
    }
    return;
  }
  const foe = battle.arena.enemyFaction;
  if (!battle.sites.some((s) => s.owner === foe) && !battle.squads.some((s) => s.owner === foe)) {
    endBattle(battle, 'win', t);
    return;
  }
  if (t + 1e-9 >= battle.siegeSec && keepHeld(battle)) endBattle(battle, 'win', t);
}

/** True while the player holds the target region's keep (a defense arena always has one). */
export function keepHeld(battle) {
  const keep = battle.sites.find((s) => isTargetRegionKeep(battle, s));
  return !!keep && keep.owner === PLAYER_OWNER;
}
