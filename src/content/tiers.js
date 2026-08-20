// WHAT A TIER IS, AND HOW MANY THERE ARE.
//
// The campaign is authored as regions grouped into TIERS, and a tier is not one
// thing in one place — it is a row in five separate tables, in three files, each
// indexed `[tier - 1]`:
//
//   HARD_CAP_MIN_BY_TIER      content/regions.rules.js   the battle backstop
//   ENEMY_MARSHALS_BY_TIER    content/regions.rules.js   banners granted
//   ENEMY_UNITS_BY_TIER       content/regions.rules.js   the enemy's roster
//   AI_TIERS                  content/ai.data.js         the commander
//   WIN_BAND                  tools/simrunner.js         the verdict gate
//
// (`MAX_OPENING_RATIO` was a sixth until the beachhead pass split it into a
// floor and a ceiling and retired the per-tier ladder. It is one global number
// now — listed here only so the next reader does not go looking for it.)
//
// ADDING A TIER MEANT EDITING ALL FIVE AND HOPING, and two of them failed in
// ways nothing would have reported. `HARD_CAP_MIN_BY_TIER[6]` is `undefined`,
// so `Math.max(undefined, x)` is NaN and every tier-7 region would advertise a
// cap of NaN minutes — which `assertBattleConfig` does not reject, because
// `hardCapMs > 0` is false for NaN in a way that reads as an ordinary refusal
// rather than as a missing table row. `WIN_BAND[6]` is `undefined` and the
// harness destructures it, so `npm run sim` would throw on the new tier and
// nowhere else. The other four already clamped, which is worse in its own way:
// a tier-7 region would silently be fought by tier 6's commander with tier 6's
// roster and report as if that were intended.
//
// So: ONE declared count, ONE clamping accessor, and a test that every table
// agrees. The accessor keeps the game RUNNING on a half-added tier (falling
// back to the deepest authored one, which is the only sane guess) and
// `tests/tiers.test.js` makes CI say so loudly. Safe at runtime, loud in CI —
// rather than the reverse, which is what a bare index gives you.
//
// TO ADD A TIER: raise `TIER_COUNT`, then run `node --test tests/tiers.test.js`
// and let it name every table still short a row. That list is the work.
// PURE DATA.

/**
 * How many tiers the campaign is authored to. Declared rather than derived from
 * one of the tables, because deriving it from a table would make that table
 * correct by definition and the other five unchecked.
 */
export const TIER_COUNT = 6;

/** A 1-based tier clamped to an index into any tier table. */
export function tierIndex(tier) {
  const t = Number.isFinite(tier) ? Math.round(tier) : 1;
  return Math.max(0, Math.min(TIER_COUNT - 1, t - 1));
}

/**
 * Read a tier-indexed table safely.
 *
 * Clamps to the table's OWN length as well as to `TIER_COUNT`, so a table that
 * is mid-extension (longer or shorter than the declared count) still answers
 * something rather than `undefined`. The test is what insists they match; this
 * is what stops a mismatch being a crash in the meantime.
 */
export function atTier(table, tier) {
  if (!table || !table.length) return undefined;
  return table[Math.max(0, Math.min(table.length - 1, tierIndex(tier)))];
}
