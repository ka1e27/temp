// Battle key bindings and the booster targeting table.
//
// ONE source of truth. BOOSTER_KEYS and FILTER_KEYS used to be declared in BOTH
// battle-hud.js (id -> key, for the button legends) and battle-input.js
// (key -> id, for the handler) — two tables that had to be edited in lockstep
// and nothing checking that they agreed. They are derived from each other here.
// PURE DATA: no DOM, no state.

/** Booster ids in dock order, with the key that arms or fires each one. */
export const BOOSTER_KEYS = Object.freeze({
  rally: 'Z', march: 'X', bombard: 'C', fortify: 'V', tithe: 'B',
});

/** Unit filter chips: which units every send is allowed to include. */
export const FILTER_KEYS = Object.freeze({
  militia: 'Q', spearmen: 'W', raiders: 'E', rams: 'R', marshal: 'T',
});

const invert = (map) => Object.freeze(Object.fromEntries(
  Object.entries(map).map(([id, key]) => [key.toLowerCase(), id]),
));

/** `{z: 'rally', ...}` — what a keydown maps to. */
export const BOOSTER_BY_KEY = invert(BOOSTER_KEYS);
export const FILTER_BY_KEY = invert(FILTER_KEYS);

/**
 * Boosters that battle/commands.js answers `'needs-target'` for. Pressing one
 * of these ARMS it; the next site click fires it at that site. The other two
 * act on everything you own at once and fire immediately.
 *
 * tests/battlehud.test.js pins this list against the simulation itself, so it
 * cannot drift away from what commands.js actually requires.
 */
export const TARGETED_BOOSTERS = Object.freeze(['rally', 'bombard', 'fortify']);

/** @param {string} id @returns {boolean} */
export const needsTarget = (id) => TARGETED_BOOSTERS.includes(id);

// --- speed control ---------------------------------------------------------

/** Selectable battle speeds. 1x and 2x are free; 4x needs the Tactician. */
export const SPEEDS = Object.freeze([1, 2, 4]);

/** Shop feature (see battle/contract.js FEATURE_IDS) that unlocks 4x. */
export const SPEED_FEATURE = 'doubleSpeed';

/** The Tactician upgrade, named so a locked control can explain itself. */
export const SPEED_UPGRADE_NAME = 'Tactician';

/** Held-Space slow motion, and the pause multiplier. */
export const SLOWMO = 0.35;
export const PAUSED = 0;

/** `[` slower, `]` faster. */
export const SPEED_KEYS = Object.freeze({ '[': -1, ']': 1 });

/**
 * Index of the speed a step lands on, clamped to what is unlocked.
 * PURE — the whole gate is testable without a DOM.
 * @param {number} index current index into SPEEDS
 * @param {number} dir -1 or +1
 * @param {boolean} unlocked does the player have `doubleSpeed`
 */
export function stepSpeedIndex(index, dir, unlocked) {
  const max = unlocked ? SPEEDS.length - 1 : SPEEDS.length - 2;
  const next = index + (dir < 0 ? -1 : 1);
  return next < 0 ? 0 : next > max ? max : next;
}

/** Is this speed index selectable for the given unlock state? */
export const speedAllowed = (index, unlocked) =>
  index >= 0 && index < SPEEDS.length && (unlocked || SPEEDS[index] < 4);
