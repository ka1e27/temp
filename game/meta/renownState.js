// The dependency-free half of Renown (DESIGN §10.7, §10.12): the balance and earning it. A LEAF, so crowns.js (awardCrowns),
// progression.js (conquer: a capital toppled), frontierState.js (retake) and frontier.js (defenseReward) can pay Renown without an
// import cycle. Spending lives in renown.js. Pure: no DOM, no Date.now, no Math.random, no storage.
//
//   state.renown = { points, earned, spent, festivals, log: { crown, defense, retake, capital }, carry }   PER DYNASTY (reset by a new one)
//     carry: the fraction of a point an Edict's Renown multiplier left over (PLAN-PHASE5: Peace of the Crowns x0.5), paid with the next
import { edictMods } from './edicts.js'; // a leaf: Phase 5's one modifier source

/** A fresh Renown record. */
export function defaultRenown() {
  return { points: 0, earned: 0, spent: 0, festivals: 0, log: { crown: 0, defense: 0, retake: 0, capital: 0, feature: 0, bounty: 0, vendetta: 0, deed: 0 } };
}

/** Creates (or repairs) `state.renown` and returns it. */
export function ensureRenown(state) {
  if (!state.renown || typeof state.renown !== 'object') state.renown = defaultRenown();
  const r = state.renown;
  const d = defaultRenown();
  for (const k of Object.keys(d)) if (r[k] === undefined || r[k] === null) r[k] = d[k];
  for (const k of Object.keys(d.log)) if (!Number.isFinite(r.log[k])) r.log[k] = 0;
  return r;
}

/** Renown in hand. */
export function renownPoints(state) {
  return state.renown && Number.isFinite(state.renown.points) ? state.renown.points : 0;
}

/**
 * Pays Renown for a deed. MUTATES. Returns the amount paid (0 for nothing).
 * @param {'crown'|'defense'|'retake'|'capital'|'feature'|'bounty'|'vendetta'|'deed'} reason
 */
export function earnRenown(state, amount, reason) {
  let n = Math.max(0, Math.floor(Number(amount) || 0));
  if (n <= 0) return 0;
  const r = ensureRenown(state);
  // PLAN-PHASE5: Renown earned x the Edict's multiplier (start-of-dynasty grants, reason 'deed', are exempt); fractions carry over
  const mult = reason === 'deed' ? 1 : edictMods(state).renownMult;
  if (mult !== 1) {
    const exact = n * mult + (Number.isFinite(r.carry) ? r.carry : 0);
    n = Math.floor(exact + 1e-9);
    r.carry = Math.max(0, exact - n);
    if (n <= 0) return 0;
  }
  r.points += n;
  r.earned += n;
  if (reason && reason in r.log) r.log[reason] += n;
  return n;
}

/** Takes Renown for a spend (no check: renown.js refuses first). MUTATES. */
export function spendRenown(state, amount) {
  const r = ensureRenown(state);
  r.points -= amount;
  r.spent += amount;
}

/** A save's `renown`, made valid. Never throws. */
export function sanitizeRenown(raw) {
  const out = defaultRenown();
  if (!raw || typeof raw !== 'object') return out;
  const n = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : 0);
  out.points = n(raw.points);
  out.earned = Math.max(out.points, n(raw.earned));
  out.spent = n(raw.spent);
  out.festivals = n(raw.festivals);
  if (raw.log && typeof raw.log === 'object') for (const k of Object.keys(out.log)) out.log[k] = n(raw.log[k]);
  if (Number.isFinite(Number(raw.carry)) && Number(raw.carry) > 0) out.carry = Math.min(0.999, Number(raw.carry));
  return out;
}
