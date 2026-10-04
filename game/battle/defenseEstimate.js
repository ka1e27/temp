// Fast odds for a defense battle on a BUILT defense arena (ARCHITECTURE §10.3, DESIGN §10.1): no simulation, a closed form
// over the arena's starting troops, the defenders' growth over the siege and the war band's camp. Pure. The defense twin of
// difficulty.js estimateDifficulty; meta/frontier.js estimateDefense builds the arena and wraps this for the UI.
//
//   yours  = sum over the player's sites of (troops + growth x horizon) x site defence (Walls included) x atk x def,
//            the keep weighted by keepWeight, plus an Arrow Tower's volleys over the siege (enemy troops it kills x their unit)
//   theirs = (camp troops + camp growth x siege x campGrowthWeight) x atk x def, plus the raider's settlements in the arena
//            at haloWeight
//   winChance = sigmoid(a + b ln(yours / theirs)) with (a, b) fitted per commander (FRONTIER.estimate.fit) by tools/balance.mjs
// The weights were chosen by log-loss over 11,268 defense battles (tools/balance.mjs --defense --dump, seeds 1-12, war bands x0.5
// to x1.8, three fortification sets): with today's values horizon 0, keep 1, tower 0.5, camp growth 1, halo 1.
import { SITE_TYPES } from '../config/battle.js';
import { FRONTIER } from '../config/frontier.js';
import { ownerStats, siteDefence, PLAYER_OWNER } from './combat.js';

/**
 * @param {object} arena a defense Arena (buildDefenseArena)
 * @param {object} player PlayerStats
 * @param {object} enemy EnemyStats of the war band
 * @returns {{ yours:number, theirs:number, ratio:number, yoursTroops:number, theirsTroops:number }}
 */
export function defenseStrengths(arena, player, enemy) {
  const cfg = FRONTIER.estimate;
  const siege = arena.siegeSec ?? 120;
  const pUnit = player.atk * player.def;
  const foe = arena.enemyFaction;
  const eStats = ownerStats(foe, player, foe, enemy);
  const eUnit = eStats.atk * eStats.def;
  let yours = 0;
  let theirs = 0;
  let yoursTroops = 0;
  let theirsTroops = 0;
  for (const s of arena.sites) {
    const type = SITE_TYPES[s.type];
    if (!type) continue;
    if (s.owner === PLAYER_OWNER) {
      const cap = (type.cap + (player.capBonus || 0)) * (s.pCapMult ?? 1);
      const grown = Math.min(Math.max(cap, s.troops), s.troops + type.growth * (player.growth ?? 1) * Math.min(siege, cfg.horizonSec));
      let v = grown * siteDefence(s) * pUnit;
      if (s.id === arena.keepSite) v *= cfg.keepWeight;
      yours += v;
      yoursTroops += s.troops;
      if (s.type === 'tower') {
        const volley = s.volleySec ?? type.volleySec;
        yours += (siege / volley) * (s.volleyKills ?? type.volleyKills ?? 1) * player.atk * eUnit * cfg.towerWeight;
      }
    } else if (s.owner === foe) {
      const growth = type.growth * (eStats.growth ?? 1);
      if (s.type === 'camp') theirs += (s.troops + growth * siege * cfg.campGrowthWeight) * eUnit;
      else theirs += (s.troops + growth * siege * cfg.campGrowthWeight) * eUnit * cfg.haloWeight;
      theirsTroops += s.troops;
    }
  }
  // a Vendetta's Champion (PLAN-PHASE4 §4D): its troops at their power, like the camp's
  if (arena.champion) {
    theirs += arena.champion.troops * (arena.champion.power ?? 1) * eUnit;
    theirsTroops += arena.champion.troops;
  }
  const ratio = theirs > 0 ? yours / theirs : Infinity;
  return { yours, theirs, ratio, yoursTroops, theirsTroops };
}

/**
 * The chance a defense holds for a strength ratio and a commander: 'inPerson' (the player defends it), 'captain', 'stalwart'
 * (and the other steward styles, which share the stalwart curve until they are measured).
 * @param {number} ratio yours / theirs
 * @param {string} [who='captain']
 * @returns {number} 0..1, clamped to FRONTIER.estimate.range
 */
export function defenseWinChance(ratio, who = 'captain') {
  const cfg = FRONTIER.estimate;
  const [lo, hi] = cfg.range;
  if (!(ratio > 0)) return lo;
  if (ratio === Infinity) return hi;
  const [a, k] = cfg.fit[who] || cfg.fit.stalwart;
  const p = 1 / (1 + Math.exp(-(a + k * Math.log(ratio))));
  return Math.max(lo, Math.min(hi, p));
}

/** The card label for a win chance: the attack labels' bands (Easy >= 85%, Fair >= 60%, Hard >= 35%, else Deadly). */
export function defenseLabel(chance) {
  if (chance >= 0.85) return 'Easy';
  if (chance >= 0.6) return 'Fair';
  if (chance >= 0.35) return 'Hard';
  return 'Deadly';
}
