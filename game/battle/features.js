// Battle twists and the feature sites of a varied map in the sim (DESIGN §10.13). Pure. The arena carries `twist` and `type`
// (arena.js stamps them from the world region on an attack); everything here reads `battle.arena.twist`.
//   night     tower (and camp) range x FEATURES.night.towerRange, both sides
//   blizzard  march speed x FEATURES.blizzard.speed, both sides; Firestorm x FEATURES.blizzard.firestorm
//   flooded   river crossings closed except on road bridges (arena tiles carry `flood`, `river`, `road`; geom.js findPath)
//   holy      powers refused (General abilities still work)
//   siege     the target keep cannot be assaulted while its region's Gate site is held by the keep's owner
//   raid      hold every Shrine site of the target region for FEATURES.shrine.holdSec to win
import { FEATURES } from '../config/features.js';
import { PLAYER_OWNER } from './owner.js';

export function twistOf(battle) {
  return (battle && battle.arena && battle.arena.twist) || null;
}

/** Multiplier on every tower's (and the War Camp's) range. */
export function towerRangeMult(battle) {
  return twistOf(battle) === 'night' ? FEATURES.night.towerRange : 1;
}

/** Multiplier on every squad's march speed. */
export function marchSpeedMult(battle) {
  return twistOf(battle) === 'blizzard' ? FEATURES.blizzard.speed : 1;
}

/** Multiplier on Firestorm damage. */
export function firestormMult(battle) {
  return twistOf(battle) === 'blizzard' ? FEATURES.blizzard.firestorm : 1;
}

export function powersBlocked(battle) {
  return twistOf(battle) === 'holy' || !!(battle && battle.player && battle.player.powersBlocked); // Holy Ground, or Iron Will (PLAN-PHASE5)
}

/**
 * Siege: true when `owner` may not attack site `toId` because it is the target region's keep and a Gate of that region still
 * stands for the keep's owner.
 */
export function gateBlocks(battle, owner, toId) {
  const to = battle.sites[toId];
  if (!to || to.type !== 'keep' || to.owner === owner) return false;
  for (const s of battle.sites) if (s.type === 'gate' && s.owner === to.owner) return true;
  return false;
}

/**
 * Raid: the Shrine rule, checked once per step. Returns true when the player has held every Shrine for long enough (the caller
 * then ends the battle as a win). Pushes `shrines { held, total, sec, need }` events when the count changes and every whole
 * second while all are held.
 */
export function checkShrines(battle, t) {
  if (twistOf(battle) !== 'raid') return false;
  const shrines = battle.sites.filter((s) => s.type === 'shrine');
  if (!shrines.length) return false;
  const held = shrines.filter((s) => s.owner === PLAYER_OWNER).length;
  const st = battle.shrines || (battle.shrines = { held: 0, since: null });
  const all = held === shrines.length;
  const need = FEATURES.shrine.holdSec;
  if (all && st.since == null) st.since = t;
  if (!all) st.since = null;
  const sec = all ? t - st.since : 0;
  if (held !== st.held || (all && Math.floor(sec) !== Math.floor(sec - 0.05 - 1e-9))) {
    battle.events.push({ type: 'shrines', held, total: shrines.length, sec: Math.min(need, sec), need });
  }
  st.held = held;
  return all && sec + 1e-9 >= need;
}
