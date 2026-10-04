// The dependency-free half of a varied map in the meta (DESIGN §10.13): rewards of region types, the Dragonscale boon, the Gold Mine's
// income, the Monastery's free scouting. A LEAF: progression.js (conquer), economy.js (income), intel.js (scouting) and
// fortsEffects.js (Dragonscale) import it. Pure.
//
//   state.boons = { dragonscale: boolean }      PER DYNASTY (reset by a new one)
import { FEATURES } from '../config/features.js';
import { FORTS } from '../config/frontier.js';

const PLAYER = 0;

export function defaultBoons() {
  return { dragonscale: false };
}

export function ensureBoons(state) {
  if (!state.boons || typeof state.boons !== 'object') state.boons = defaultBoons();
  return state.boons;
}

export function sanitizeBoons(raw) {
  return { dragonscale: !!(raw && raw.dragonscale === true) };
}

/** A region type's rewards (FEATURES.rewards), or null for a plain region. */
export function typeRewards(region) {
  return region && region.type ? FEATURES.rewards[region.type] || null : null;
}

/** Bounty multiplier for conquering this region (Gold Mine x3, Bandit Hold x2, else 1). */
export function typeBountyMult(region) {
  const r = typeRewards(region);
  return r && r.bounty ? r.bounty : 1;
}

/** The region's own income multiplier from its type (a Gold Mine +25% while held). */
export function typeIncomeMult(region) {
  const r = typeRewards(region);
  return r && r.income ? 1 + r.income : 1;
}

/**
 * True when a Monastery the player holds lies within FEATURES.rewards.monastery.scoutHops region steps of `regionId` (it then
 * counts as scouted, DESIGN §10.13). Says nothing about regions the player owns.
 */
export function monasteryScoutsFree(state, world, regionId) {
  const hops = FEATURES.rewards.monastery.scoutHops;
  if (!world.regions[regionId] || state.owner[regionId] === PLAYER) return false;
  let frontier = [regionId];
  const seen = new Set(frontier);
  for (let d = 0; d <= hops; d++) {
    for (const id of frontier) {
      const r = world.regions[id];
      if (r.type === 'monastery' && state.owner[id] === PLAYER) return true;
    }
    if (d === hops) break;
    const next = [];
    for (const id of frontier) for (const n of world.regions[id].neighbors) if (!seen.has(n)) { seen.add(n); next.push(n); }
    frontier = next;
  }
  return false;
}

/** Fortifications as they fight: with Dragonscale, every one counts one level higher (capped at its type's top). */
export function boostedForts(state, list) {
  if (!Array.isArray(list)) return [];
  if (!(state && state.boons && state.boons.dragonscale)) return list;
  return list.map((f) => ({ type: f.type, level: Math.min(FORTS.maxLevel[f.type] ?? f.level, f.level + 1) }));
}
