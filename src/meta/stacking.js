// THE ONE TRUE STACKING ORDER, and the one function that applies it.
//
// Split out of ./modifiers.js at the 400-line cap, and it had to be a THIRD
// file rather than living in either half: `playerMods` (modifiers.js) and
// `enemyMods` (enemymods.js) both need it, and modifiers.js imports
// enemymods.js — so leaving `stack` where it was and importing it back would
// have made the pair a cycle. Same shape and same reason as
// battle/fightaid.js. Both are re-exported from modifiers.js, so no importer
// has to know it moved.
// PURE.

/** The one true order. Asserted in tests; never reorder without a test change. */
export const STACKING_ORDER = Object.freeze([
  'base', 'additive', 'multiplicative', 'boosters', 'tier',
]);

/**
 * @param {number} base  content baseline + flat upgrade additions
 * @param {{additive?:number, multiplicative?:number, boosters?:number, tier?:number}} [s]
 */
export function stack(base, s = {}) {
  const additive = s.additive ?? 0;
  const multiplicative = s.multiplicative ?? 1;
  const boosters = s.boosters ?? 1;
  const tier = s.tier ?? 1;
  return base * (1 + additive) * multiplicative * boosters * tier;
}
