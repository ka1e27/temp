// WHICH THREE DOCTRINES A BATTLE OFFERS, AND WHAT PICKING ONE DOES.
//
// The table is content/doctrine.data.js; this is the arithmetic, the same
// division of labour meta/incursion.js has with content/incursion.data.js.
// PURE — no clock, no storage, no randomness that is not seeded.
import { createRng, deriveSeed } from '../core/rng.js';
import { REGIONS } from '../content/regions.data.js';
import {
  DOCTRINES, DOCTRINE_BY_ID, DOCTRINE_HAND, DOCTRINE_FROM_CONQUESTS,
} from '../content/doctrine.data.js';

export { DOCTRINE_BY_ID, DOCTRINES } from '../content/doctrine.data.js';

/**
 * Is the player far enough in to be offered one at all?
 *
 * Counted off CONQUESTS rather than off the region's own index, because the
 * question is "has this player finished a battle yet", not "is this a late
 * map" — a player who abdicates and replays region 2 has seen the loop and
 * should keep the choice, and a player attacking their first region has not.
 */
export const doctrineOpen = (conquered) => (conquered | 0) >= DOCTRINE_FROM_CONQUESTS;

/**
 * The three on offer, in a stable display order.
 *
 * SEEDED ON THE REGION AND THE ATTEMPT COUNTER, never on wall-clock or on a
 * stored roll, for the reason a rung is a pure function of its depth: a retry
 * must offer the SAME three. Re-rolling on retry turns the decision into a
 * slot machine — you would simply back out and re-enter until the one you
 * wanted appeared, which costs nothing and makes the choice free.
 *
 * The counter DOES advance on a raid and on a rung, so the same ground offers
 * a different hand the tenth time you fight it. That is the one place variety
 * is worth more than repeatability, because a raid is by construction a rerun
 * of a map you have already beaten.
 *
 * @param {string} regionId
 * @param {number} [attempt] `clears` for a campaign region or raid, `depth` for
 *   a rung. Anything that distinguishes this attempt from the last one.
 * @returns {import('../content/doctrine.data.js').Doctrine[]}
 */
export function doctrineChoices(regionId, attempt = 0) {
  // ONE shuffle for the whole pool, then a rotation — exactly as
  // `campaignTwistPlan` draws, and for the same reason. A fresh weighted draw
  // per region gave three consecutive maps the same hand once already; a
  // rotation over one shuffled order cannot.
  const order = DOCTRINES.slice();
  const rng = createRng(deriveSeed(0xd0c7, 'doctrine-pool'));
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(0, i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const idx = Math.max(0, REGIONS.findIndex((r) => r.id === regionId));
  // Stride 2 on a pool of 6 shares a factor with it and would only ever reach
  // three of the six; 5 is coprime, so repeated attempts walk every hand.
  const start = (idx + Math.max(0, Math.floor(attempt)) * 5) % order.length;
  const out = [];
  for (let k = 0; k < DOCTRINE_HAND && k < order.length; k++) {
    out.push(order[(start + k) % order.length]);
  }
  return out;
}

/** The one a screen preselects: the first of the hand, so Enter still launches. */
export const defaultDoctrine = (regionId, attempt = 0) =>
  doctrineChoices(regionId, attempt)[0]?.id ?? null;

/** Is `id` actually on offer here? A stale param must not pick a hand it was
 *  never dealt — the same check `buildBattleConfig` makes on an incursion depth. */
export const doctrineOffered = (regionId, attempt, id) =>
  !!id && doctrineChoices(regionId, attempt).some((d) => d.id === id);

/**
 * What this battle actually fights under, given what the caller asked for.
 *
 * VALIDATION LIVES HERE RATHER THAN IN THE SCREEN, for the reason
 * `fitComposition` re-fits an already-fitted army at the seam: a hand-edited
 * params object must not be able to buy a doctrine it was never dealt, or
 * one at all before the gate opens. Refused silently rather than by throwing —
 * unlike a mismatched incursion depth, which names a different MAP and would
 * silently fight the wrong battle, an unoffered doctrine is a modifier the
 * player simply does not get, and the honest answer is "none" rather than a
 * crash on a save somebody hand-edited two versions ago.
 *
 * @returns {string|null}
 */
export function resolveDoctrine(id, { regionId, attempt = 0, conquered = 0 } = {}) {
  if (!doctrineOpen(conquered)) return null;
  return doctrineOffered(regionId, attempt, id) ? id : null;
}

/**
 * Fold a doctrine into the player's FactionMods.
 *
 * MULTIPLICATIVE ON BOTH TERMS, including `startGold` — see the note in
 * content/doctrine.data.js for why a flat grant there would be a fortune at
 * region 1 and a rounding error at region 24.
 *
 * Applied AFTER the shop and after any mutator, so it composes with them the
 * way `incursionMods` composes with `playerMods` rather than replacing
 * anything. Unknown id is a no-op returning the SAME object, so a caller that
 * passes null cannot be told apart from one that never asked — which is what
 * makes `--nodoctrine` and a pre-doctrine save byte-identical rather than
 * merely close.
 *
 * @param {object} mods player FactionMods
 * @param {string|null} id
 * @returns {object}
 */
export function doctrineMods(mods, id) {
  const d = id ? DOCTRINE_BY_ID[id] : null;
  if (!d) return mods;
  const out = { ...mods };
  for (const term of [d.gain, d.cost]) {
    out[term.field] = (out[term.field] ?? 1) * term.value;
  }
  return out;
}
