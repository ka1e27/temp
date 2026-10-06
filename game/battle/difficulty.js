// Fast difficulty heuristic on a BUILT arena (ARCHITECTURE §6, DESIGN §5.3) — no simulation, just
// a closed form over the arena's starting troops. Pure.
//
// This is the arena-level twin of `difficulty()` in game/meta/progression.js and uses the same fitted
// constants (DIFFICULTY in game/config/meta.js, calibrated by tools/balance.mjs against real
// bot-vs-AI battles). The difference: here the player's border garrisons and the enemy's garrisons
// are read off the real sites instead of being estimated from the world, so it knows exactly what
// buildArena placed — but it has no region tier, so the tier factors (tutorial ring, depth) that
// the meta readout applies are not included.
import { SITE_TYPES } from '../config/battle.js';
import { DIFFICULTY } from '../config/meta.js';
import { FEATURES } from '../config/features.js';
import { ownerStats, PLAYER_OWNER } from './combat.js';

const POWER_IDS = ['rally', 'firestorm', 'bulwark', 'march', 'levy'];

function powerUnits(player) {
  let n = 0;
  for (const id of POWER_IDS) {
    const level = player.powers ? player.powers[id] : 0;
    if (level > 0) n += (DIFFICULTY.powerWeight[id] ?? 1) * (1 + DIFFICULTY.powerLevelWeight * (level - 1));
  }
  return n;
}

/**
 * @param {object} arena Arena (pre-battle; ARCHITECTURE §6).
 * @param {object} player PlayerStats.
 * @param {object} enemy EnemyStats.
 * @returns {{power:number, strength:number, ratio:number}}
 */
export function estimateDifficulty(arena, player, enemy) {
  let troops = 0;
  let strength = 0;
  for (const site of arena.sites) {
    if (site.owner === PLAYER_OWNER) {
      // The camp counts in full; border sites at their garrison x supportWeight (they also keep
      // producing troops through the fight).
      troops += site.type === 'camp' ? site.troops : DIFFICULTY.supportWeight * site.troops;
      continue;
    }
    const cfg = SITE_TYPES[site.type];
    const stats = ownerStats(site.owner, player, arena.enemyFaction, enemy);
    const growth = cfg.growth * stats.growth;
    const start = Math.min(site.troops, DIFFICULTY.overCapCredit * cfg.cap * (site.capMult ?? 1));
    strength += (start + growth * DIFFICULTY.horizonSec) * cfg.def * (site.defMult ?? 1) * stats.atk * stats.def;
  }
  // A varied map (DESIGN §10.13): the Dragon's health, and the measured factor of the arena's type and twist
  if (arena.dragon) strength += arena.dragon.hp * FEATURES.difficulty.dragonHpWeight;
  strength *= (arena.twist ? FEATURES.difficulty[arena.twist] ?? 1 : 1) * (arena.type ? FEATURES.difficulty[arena.type] ?? 1 : 1);
  const power = troops * player.atk * player.def * Math.pow(player.growth, DIFFICULTY.growthExp)
    * (1 + DIFFICULTY.powerBonusPerUnlocked * (arena.twist === 'holy' ? 0 : powerUnits(player))); // Holy Ground: no powers
  const strip = (arena.marches || []).filter((m) => m.approach).reduce((n, m) => n + m.tiles.length, 0);
  strength *= DIFFICULTY.strengthScale * (DIFFICULTY.personality[enemy.personality] ?? 1) * (1 + DIFFICULTY.approachPerTile * strip);
  // PLAN-PHASE12: the Tide Fortress, and the share of the target's own tiles that are fords (the meta card's rule, progression.js)
  if (arena.sea && arena.sea.tide) strength *= DIFFICULTY.tideCapital;
  const own = arena.tiles.filter((t) => t.region === arena.regionId);
  if (own.length && arena.sea) strength *= 1 + DIFFICULTY.fordWeight * (own.filter((t) => t.ford).length / own.length);
  const ratio = strength > 0 ? power / strength : (power > 0 ? Infinity : 1);
  return { power, strength, ratio };
}
