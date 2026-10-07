// Unrest (PLAN-PHASE11b; numbers in game/config/unrest.js): a structural catch-up for map walls. The clock runs on ACTIVE seconds: while no
// attackable frontier region reads Easy or Fair on its card (the default commander credited), `state.unrest.idleSec` grows; at UNREST.idleSec
// the weakest frontier region (the best power ratio) becomes the target and thins by UNREST.perMin per minute up to UNREST.max. It calms
// when it is attacked (calmUnrest), when anything on the frontier reads Easy or Fair, or when it leaves the frontier; calm regions recover
// UNREST.recoverPerMin per minute. Never in a challenge. Pure: no DOM, no Date.now, no Math.random.
import { UNREST } from '../config/unrest.js';
import { attackableFrontier, difficulty } from './progression.js';
import { bestFreeGeneral } from './generals.js';
import { commanderFor, edictMods } from './edicts.js';
import { ensureUnrest, unrestThin } from './unrestState.js';

export * from './unrestState.js';

/** The card's reading of a frontier region: its default commander (the best free General) credited, as world.js shows it. */
function cardDifficulty(state, world, regionId, nowMs) {
  const g = bestFreeGeneral(state, world, regionId, 'attack', nowMs);
  return difficulty(state, world, regionId, { commander: commanderFor(state, g ? g.id : null) });
}

/**
 * Advances Unrest by `dtSec` ACTIVE seconds (call it in chunks of a few seconds; skip it while paused, hidden or in a challenge).
 * MUTATES state.unrest. Returns `{ started }`: the region that has just fallen into Unrest this call (for the first-time toast), or null.
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @param {number} dtSec
 * @param {number} [nowMs] wall clock, for which Generals are free (the card's commander)
 */
export function tickUnrest(state, world, dtSec, nowMs = 0) {
  const out = { started: null };
  if (state.challenge || !(dtSec > 0)) return out;
  const u = ensureUnrest(state);
  const ids = attackableFrontier(state, world).filter((id) => world.regions[id] && world.regions[id].type !== 'dragon'); // the Lair is optional
  let ok = false;
  let best = null;
  for (const id of ids) {
    const d = cardDifficulty(state, world, id, nowMs);
    if (d.surrender || d.label === 'Easy' || d.label === 'Fair') { ok = true; break; }
    if (!best || d.ratio > best.ratio) best = { id, ratio: d.ratio };
  }
  const min = dtSec / 60;
  const calm = ok || !ids.length;
  if (calm || (u.target != null && !ids.includes(u.target))) u.target = null;
  for (const k of Object.keys(u.thin)) { // every region but the active target recovers
    if (Number(k) === u.target) continue;
    const v = Number(u.thin[k]) - UNREST.recoverPerMin * min;
    if (v > 1e-9) u.thin[k] = v; else delete u.thin[k];
  }
  if (calm) { u.idleSec = 0; return out; }
  u.idleSec += dtSec;
  if (u.target == null && u.idleSec >= UNREST.idleSec + edictMods(state).unrestIdleAdd && best) { // Loyal Subjects (PLAN-PHASE13 Ascension 4)
    u.target = best.id;
    out.started = best.id;
  }
  if (u.target != null) u.thin[u.target] = Math.min(UNREST.max, (Number(u.thin[u.target]) || 0) + UNREST.perMin * min);
  return out;
}

/** The player attacks `regionId`: if it is the region in Unrest, it calms (it starts to recover) and the idle clock starts over. */
export function calmUnrest(state, regionId) {
  if (state.challenge) return;
  const u = ensureUnrest(state);
  if (u.target !== regionId) return;
  u.target = null;
  u.idleSec = 0;
}

/**
 * What the card and the map show: `{ pct, thinning, text }` for a region in Unrest (pct: whole percent its garrisons are down; thinning:
 * true while it is the active target, false while it recovers), or null.
 */
export function unrestInfo(state, regionId) {
  const thin = unrestThin(state, regionId);
  if (thin < UNREST.showMin) return null;
  const pct = Math.max(1, Math.round(thin * 100));
  const thinning = !!state.unrest && state.unrest.target === regionId;
  return { pct, thinning, text: (thinning ? UNREST.copy.thinning : UNREST.copy.recovering).replace('{pct}', String(pct)) };
}
