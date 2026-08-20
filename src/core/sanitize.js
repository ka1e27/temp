// HOW A HAND-EDITED SAVE IS MADE SAFE.
//
// Split out of ./store.js at the 400-line cap and re-exported from there, the
// same arrangement ./refund.js already has — so every existing
// `import { ... } from '../core/store.js'` keeps resolving and nothing
// downstream has to learn where the healing moved to.
//
// The seam is a real one rather than a convenient cut: store.js is the SHAPE of
// a save (what fields exist, what a new one looks like, how it serialises) and
// this is the rule for every value that comes back off disk. Three of the five
// functions below exist because a specific hand-edited or stale save broke
// something — an uncapped level that hung the tab on boot, an uncapped loadout
// that froze it on the first Attack, an unbounded counter that produced an
// `Infinity` difficulty. They are load-bearing, not defensive habit.
// PURE.
import { UNIT_IDS } from '../content/balance.js';
import { SAFE_MAX_LEVEL } from '../content/upgrades.data.js';

const MAX_LOADOUT = 100000;

export const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/**
 * A saved expedition, healed rather than trusted: unknown unit ids are dropped,
 * counts are floored to non-negative integers, and an all-zero army becomes
 * `null` so the screen falls back to the default spread. Whether it still FITS
 * the budget is not decided here — meta/composition.js carryComposition() owns
 * that, because the budget can legitimately move between sessions.
 */
export function sanitizeComposition(comp) {
  if (!comp || typeof comp !== 'object') return null;
  const out = {};
  let any = 0;
  for (const u of UNIT_IDS) {
    // Capped: `carryComposition` trims an over-budget loadout by decrementing one
    // body at a time, so an uncapped count froze the tab on the first Attack.
    out[u] = counter(comp[u], MAX_LOADOUT);
    any += out[u];
  }
  return any > 0 ? out : null;
}

/**
 * Preferences, healed rather than trusted. Every field is nullable and `null`
 * means "whatever the content default is", so a save from before a setting
 * existed and a player who never touched it are the same case — which is what
 * lets a new preference ship without a migration.
 *
 * The DEFAULTS ARE INJECTED rather than imported. `createSettings` is a SHAPE
 * function and lives in store.js with the others; importing it back here would
 * close a cycle, which is the same reason ./refund.js is imported directly by
 * its consumers instead of being re-exported from its parent.
 */
export function sanitizeSettings(raw, defaults) {
  const out = { ...defaults };
  if (!raw || typeof raw !== 'object') return out;
  const keep = Math.floor(num(raw.rallyKeepDefault, NaN));
  if (Number.isFinite(keep) && keep >= 0) out.rallyKeepDefault = keep;
  const speed = num(raw.defaultSpeed, NaN);
  if (Number.isFinite(speed) && speed > 0) out.defaultSpeed = speed;
  // Tri-state on purpose: `null` means "never chosen" and reads as ON, so a
  // save written before sound existed is not silently muted by its own absence.
  if (typeof raw.sound === 'boolean') out.sound = raw.sound;
  const vol = num(raw.volume, NaN);
  if (Number.isFinite(vol) && vol >= 0 && vol <= 1) out.volume = vol;
  return out;
}

/**
 * Levels and charges, healed — and CLAMPED, which is the half that was missing.
 *
 * Nothing on the read path consulted `SAFE_MAX_LEVEL`, so a hand-edited save
 * could carry `{fieldManual: 1e15}` and `refundRetired` below would loop 10^15
 * times inside `fromPersisted`. That runs at module scope on boot, before the
 * page paints and before `load()` can delete anything — so the tab hung on every
 * reload, permanently, with no way out but clearing storage by hand. A ceiling
 * here fixes it for every consumer at once rather than at each loop.
 *
 * Unknown ids are DROPPED rather than kept-and-ignored. They were inert (every
 * consumer iterates the content table, never the save), but an import could carry
 * megabytes of junk keys that persisted forever and counted against the origin's
 * storage quota — which is the cheapest way to make a save unwritable.
 */
export function sanitizeLevels(obj, known = null) {
  const out = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (known && !known.has(k)) continue;
    const n = Math.floor(num(v, 0));
    if (n > 0) out[k] = Math.min(n, SAFE_MAX_LEVEL);
  }
  return out;
}

/** Non-negative integer, with a ceiling. Every counter that feeds an exponential
 *  goes through this: `clears` drives `enemyMult x 1.15^clears` and `cleared`
 *  drives the incursion dial, so an unbounded value produces an `Infinity`
 *  difficulty that `assertBattleConfig` then rejects — making the region
 *  permanently unattackable while the map cheerfully renders its dial as `∞`. */
export const counter = (v, max) => Math.min(max, Math.max(0, Math.floor(num(v, 0))));
