// The dependency-free half of Unrest (PLAN-PHASE11b; game/config/unrest.js): the shape of `state.unrest`, the troop/cap multiplier
// progression.js applies, clearing a conquered region, and save sanitising. Pure: no DOM, no Date.now, no Math.random. A LEAF so
// progression.js can import it; game/meta/unrest.js (the clock, which reads difficulty) imports progression.js and re-exports this file.
//
//   state.unrest = { idleSec, target, thin: { [regionId]: fraction 0..UNREST.max }, toasted }
//     idleSec: active seconds since a frontier region last read Easy or Fair; target: the region thinning now (null: none);
//     thin: how far each region's garrisons and caps are thinned (the target grows, the rest recover); toasted: the first-time toast was shown.
import { UNREST } from '../config/unrest.js';

export function defaultUnrest() {
  return { idleSec: 0, target: null, thin: {}, toasted: false };
}

/** Creates (or repairs) `state.unrest` and returns it. */
export function ensureUnrest(state) {
  const u = state.unrest && typeof state.unrest === 'object' && !Array.isArray(state.unrest) ? state.unrest : (state.unrest = defaultUnrest());
  if (!Number.isFinite(u.idleSec)) u.idleSec = 0;
  if (!Number.isInteger(u.target)) u.target = null;
  if (!u.thin || typeof u.thin !== 'object' || Array.isArray(u.thin)) u.thin = {};
  u.toasted = !!u.toasted;
  return u;
}

/** How far a region's garrisons and caps are thinned, 0..UNREST.max (0 in a challenge, and for regions without Unrest). */
export function unrestThin(state, regionId) {
  if (state.challenge) return 0;
  const v = state.unrest && state.unrest.thin ? Number(state.unrest.thin[regionId]) : 0;
  return Number.isFinite(v) && v > 0 ? Math.min(UNREST.max, v) : 0;
}

/** The multiplier on a region's starting garrisons and settlement caps: 1 - its thinning. */
export function unrestTroopMult(state, regionId) {
  return 1 - unrestThin(state, regionId);
}

/** A conquered region forgets its Unrest. */
export function clearRegionUnrest(state, regionId) {
  if (!state.unrest) return;
  if (state.unrest.thin) delete state.unrest.thin[regionId];
  if (state.unrest.target === regionId) state.unrest.target = null;
}

/** A save's `unrest`, made valid (junk dropped). Never throws. For save.js withDefaults. */
export function sanitizeUnrest(raw) {
  const out = defaultUnrest();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  out.idleSec = Number.isFinite(Number(raw.idleSec)) ? Math.max(0, Number(raw.idleSec)) : 0;
  out.target = Number.isInteger(raw.target) && raw.target >= 0 ? raw.target : null;
  out.toasted = !!raw.toasted;
  if (raw.thin && typeof raw.thin === 'object' && !Array.isArray(raw.thin)) {
    for (const [k, v] of Object.entries(raw.thin)) {
      const n = Number(v);
      if (/^\d+$/.test(k) && Number.isFinite(n) && n > 0) out.thin[k] = Math.min(UNREST.max, n);
    }
  }
  return out;
}
