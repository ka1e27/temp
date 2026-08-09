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

/**
 * Unit filter chips: which units every send is allowed to include.
 *
 * DECLARED IN `UNIT_IDS` ORDER, because tests/battleui.test.js asserts exactly
 * that — the chip row and the roster must not be able to disagree about which
 * units exist. The letters are NOT in that order on purpose: the original five
 * keep the keys they always had, and the three specialists take Y / U / I, so
 * adding units did not move anybody's hands.
 */
export const FILTER_KEYS = Object.freeze({
  militia: 'Q', spearmen: 'W', outriders: 'Y', raiders: 'E',
  halberds: 'U', sappers: 'I', rams: 'R', marshal: 'T',
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

/**
 * Selectable battle speeds: 0.25x to 4x in quarters.
 *
 * Three buttons became a sixteen-stop ladder for two reasons. Speeding up was
 * the only direction offered, and the interesting one is DOWN — a three-front
 * endgame map at 1x is not a difficulty problem, it is a reading-speed problem,
 * and a player who wants to watch a siege resolve should be able to.
 *
 * Below 1x is FREE and always will be: slow motion cannot win you a battle you
 * would otherwise lose, so gating it would be charging for legibility. Above 1x
 * keeps exactly the gate it had — up to 2x free, past that the Tactician — since
 * that is real time saved and it is what the upgrade was sold for.
 */
export const SPEEDS = Object.freeze(
  Array.from({ length: 16 }, (_, i) => Number(((i + 1) * 0.25).toFixed(2))),
);

/** Index of 1x — where a battle opens unless a setting says otherwise. */
export const NORMAL_SPEED_INDEX = SPEEDS.indexOf(1);

/** The fastest speed available without the unlock. */
export const FREE_SPEED_MAX = 2;

/** Shop feature (see battle/contract.js FEATURE_IDS) that unlocks past 2x. */
export const SPEED_FEATURE = 'doubleSpeed';

/** The Tactician upgrade, named so a locked control can explain itself. */
export const SPEED_UPGRADE_NAME = 'Tactician';

/** Nearest ladder index to a raw multiplier — how a saved preference is read. */
export function speedIndexOf(mult) {
  if (!Number.isFinite(mult)) return NORMAL_SPEED_INDEX;
  let best = NORMAL_SPEED_INDEX;
  for (let i = 0; i < SPEEDS.length; i++) {
    if (Math.abs(SPEEDS[i] - mult) < Math.abs(SPEEDS[best] - mult)) best = i;
  }
  return best;
}

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
  const max = maxSpeedIndex(unlocked);
  const next = index + (dir < 0 ? -1 : 1);
  return next < 0 ? 0 : next > max ? max : next;
}

/** The highest index the player may select. Slowing is never gated. */
export const maxSpeedIndex = (unlocked) => (unlocked
  ? SPEEDS.length - 1
  : SPEEDS.reduce((best, s, i) => (s <= FREE_SPEED_MAX ? i : best), 0));

/** Is this speed index selectable for the given unlock state? */
export const speedAllowed = (index, unlocked) =>
  index >= 0 && index < SPEEDS.length && (unlocked || SPEEDS[index] <= FREE_SPEED_MAX);
