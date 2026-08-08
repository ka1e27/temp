// Typing a number into the expedition, as pure arithmetic.
//
// The loadout only had +/- steppers, so building 19 militia meant nineteen
// clicks. A text field is the obvious fix and also the dangerous one: the
// steppers CANNOT produce an over-budget army (meta/composition.js lands every
// nudge exactly on the budget), whereas a keyboard can ask for four marshals on
// a nineteen-slot budget in one keystroke.
//
// So a typed value is clamped HERE, before it reaches the model, and the caller
// is handed everything it needs to say so out loud. Silently accepting a number
// and then refusing to launch is the failure mode this exists to prevent.
//
// The slot arithmetic itself is NOT re-implemented: the cap, the shedding order
// and the per-unit maximum all come from meta/composition.js, the same module
// the steppers use. Two implementations of "what fits" would disagree, and the
// one the player was reading would be the wrong one.
// PURE: no DOM, no clock.

import { UNIT_IDS } from '../content/balance.js';
import {
  sanitizeComposition, compositionSlots, slotCost, maxOf,
} from '../meta/composition.js';

/**
 * A typed string as a count, or null when it is not one.
 *
 * Deliberately strict: `'12'` yes, `''`/`'-3'`/`'2.5'`/`'1e3'`/`'abc'` no. A
 * field the player has half-cleared must revert to what the model says rather
 * than guess at zero.
 * @param {string|number} text @returns {?number}
 */
export function parseCount(text) {
  const s = String(text ?? '').trim();
  if (!/^\d{1,6}$/.test(s)) return null;
  return Number(s);
}

/**
 * The most of one unit this budget can ever hold — every other unit sold off.
 * A marshal is additionally capped at one by the engine itself.
 * @param {string} unitId @param {number} budget
 */
export function maxCount(unitId, budget) {
  const b = Math.max(0, Math.floor(Number(budget) || 0));
  return Math.min(Math.floor(b / slotCost(unitId)), maxOf(unitId));
}

/**
 * Set one unit to an absolute count, inside the budget.
 *
 * Over-budget is resolved the same way `nudgeComposition` resolves it: trade
 * DOWN, cheapest unit first, because the cheap units are the ballast and the
 * expensive ones were the decision. What cannot be paid for even after selling
 * everything else is clamped, and `clamped` says so.
 *
 * Under-budget is left alone — no auto-refill. `budgetSummary` already renders
 * "N slots unspent", and a field that springs back to 19 the moment you type 5
 * is a field you cannot use.
 *
 * @param {object} chosen @param {string} unitId @param {number} n
 * @param {string[]} unlocked @param {number} budget
 * @returns {{comp:object, requested:number, applied:number, max:number,
 *            clamped:boolean, traded:number}}
 */
export function setUnitCount(chosen, unitId, n, unlocked, budget) {
  const comp = sanitizeComposition(chosen, unlocked);
  const requested = Math.max(0, Math.floor(Number(n) || 0));
  const budgetN = Math.max(0, Math.floor(Number(budget) || 0));
  if (!unlocked.includes(unitId)) {
    return { comp, requested, applied: 0, max: 0, clamped: requested > 0, traded: 0 };
  }

  const max = maxCount(unitId, budgetN);
  const applied = Math.min(requested, max);
  comp[unitId] = applied;

  let spent = compositionSlots(comp);
  let traded = 0;
  if (spent > budgetN) {
    const donors = UNIT_IDS
      .filter((u) => u !== unitId && comp[u] > 0)
      .sort((a, b) => slotCost(a) - slotCost(b) || UNIT_IDS.indexOf(a) - UNIT_IDS.indexOf(b));
    for (const u of donors) {
      while (spent > budgetN && comp[u] > 0) { comp[u] -= 1; spent -= slotCost(u); traded += 1; }
    }
  }
  return { comp, requested, applied, max, clamped: applied < requested, traded };
}

/**
 * What to tell the player about what just happened to their typed number.
 * Empty when the number was taken exactly as asked and cost nothing else.
 * @param {object} r a setUnitCount result @param {string} label unit name
 */
export function countNote(r, label) {
  if (!r) return '';
  if (r.clamped) {
    return r.max === 0
      ? `No room for a ${label} in this budget.`
      : `${r.requested} ${label} will not fit — ${r.max} is the most this budget buys.`;
  }
  if (r.traded > 0) {
    return `${r.applied} ${label}: traded ${r.traded} other troop${r.traded === 1 ? '' : 's'} `
      + 'for the slots.';
  }
  return '';
}
