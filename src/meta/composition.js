// ===========================================================================
// The expedition as a SLOT BUDGET.
//
// An expedition used to be a head count, so every unit cost one seat and the
// only sane loadout was "all of whatever is best". Now each unit has a slot
// price (content/balance.js UNIT_SLOTS) and the empire grants a budget, so
// fielding a marshal genuinely means fielding eight fewer militia.
//
// Three ways to arrive at a composition, and they are NOT interchangeable:
//
//   distributeExpedition  spend a budget from scratch by weight       (defaults)
//   fitComposition        treat counts as RATIOS and re-fit           (the seam)
//   carryComposition      keep counts as CHOICES, top up with militia (carry-over)
//
// carryComposition is the one the pre-battle screen opens with: a player who
// picked 4 raiders last time still has 4 raiders, and a budget that grew turns
// into militia rather than silently rescaling everything they chose. A rescale
// there would quietly re-spend their decision for them.
//
// PURE: no clock, no DOM, no randomness.
// ===========================================================================

import { UNIT_IDS, UNIT_SLOTS, UNITS } from '../content/balance.js';
import { DEFAULT_COMPOSITION_WEIGHTS } from '../content/upgrades.data.js';

const clampInt = (n) => Math.max(0, Math.floor(Number(n) || 0));

export const zeroComposition = () => Object.fromEntries(UNIT_IDS.map((u) => [u, 0]));

/** Slots one of `unitId` costs. Unknown ids cost one, so a new unit is never free. */
export const slotCost = (unitId) => UNIT_SLOTS[unitId] ?? 1;

/** What a composition costs against the budget. THE number the screen shows. */
export const compositionSlots = (comp) =>
  UNIT_IDS.reduce((a, u) => a + clampInt(comp?.[u]) * slotCost(u), 0);

/** Bodies, not slots — the other number the screen shows. */
export const compositionTotal = (comp) =>
  UNIT_IDS.reduce((a, u) => a + clampInt(comp?.[u]), 0);

/** The single rule that decides whether Launch is allowed. */
export const overBudget = (comp, budget) => compositionSlots(comp) > Math.max(0, budget);

/**
 * How many of a unit an EXPEDITION may contain.
 *
 * The marshal is 0 — not one — and that is the whole point of the change that
 * made him worth unlocking. `maxPerSite` is still 1 and still enforced by the
 * engine; what moved is who pays. Unlocking the marshal now grants exactly one
 * on every landing, outside the slot budget (meta/modifiers.js
 * `withFreeMarshal`), so letting the loadout buy one as well would only ever be
 * a trap: 8 slots — 42% of a region-1 budget — for a body you already have, and
 * a `banner` that is presence-based and so gains nothing from a second.
 *
 * Wanting more than one is a real thing, and it has its own verb: commission
 * them in battle, at the site that needs one (battle/commands.js `cmdRecruit`).
 */
export const maxOf = (unitId) => (unitId === 'marshal' ? 0 : Infinity);

/** The ballast: cheapest unit the player may field, which absorbs every
 *  leftover slot and every budget increase. Militia in every real roster. */
export function ballastUnit(unlocked) {
  const legal = UNIT_IDS.filter((u) => unlocked.includes(u) && maxOf(u) === Infinity);
  if (!legal.length) return null;
  return legal.reduce((a, b) => (slotCost(b) < slotCost(a) ? b : a));
}

/** Copy, integerize, drop anything locked, and honour maxPerSite. */
export function sanitizeComposition(comp, unlocked) {
  const out = zeroComposition();
  for (const u of UNIT_IDS) {
    if (unlocked && !unlocked.includes(u)) continue;
    out[u] = Math.min(clampInt(comp?.[u]), maxOf(u));
  }
  return out;
}

/** Buy as many of `unit` as `slots` allows, respecting maxPerSite. */
function fill(out, unit, slots) {
  if (!unit || slots <= 0) return slots;
  const room = maxOf(unit) - out[unit];
  const n = Math.min(Math.floor(slots / slotCost(unit)), room);
  if (n <= 0) return slots;
  out[unit] += n;
  return slots - n * slotCost(unit);
}

/**
 * Spend `slots` across the unlocked units in the given weight ratios.
 *
 * Largest remainder measured in SLOTS, not heads: the fractional part of each
 * unit's ideal is worth its own slot cost, so a half-bought spearman outranks a
 * half-bought militia for the last two slots. That is what makes this reproduce
 * the old head-count spread exactly at the budgets it was tuned against.
 * Whatever the ratios cannot spend goes to the ballast, so the budget is always
 * spent to the last slot.
 */
export function distributeExpedition(slots, unlocked, weights = DEFAULT_COMPOSITION_WEIGHTS) {
  const out = zeroComposition();
  let left = clampInt(slots);
  if (left <= 0) return out;

  const legal = UNIT_IDS.filter((u) => unlocked.includes(u));
  const ballast = ballastUnit(unlocked);
  if (!legal.length) return out;

  // No marshal branch: `maxOf('marshal')` is 0, because one is granted free
  // outside the budget and the budget's job is troops.
  const pool = legal.filter((u) => maxOf(u) === Infinity && (weights[u] ?? 0) > 0);
  if (!pool.length) { fill(out, ballast, left); return out; }

  const denom = pool.reduce((a, u) => a + weights[u] * slotCost(u), 0);
  const scale = left / denom;
  const parts = pool.map((u) => {
    const want = scale * weights[u];
    const n = Math.floor(want);
    return { u, n, rem: (want - n) * slotCost(u) };
  });
  for (const p of parts) { out[p.u] += p.n; left -= p.n * slotCost(p.u); }

  parts.sort((a, b) => b.rem - a.rem
    || slotCost(b.u) - slotCost(a.u)
    || UNIT_IDS.indexOf(a.u) - UNIT_IDS.indexOf(b.u));
  for (const p of parts) {
    if (left >= slotCost(p.u)) { out[p.u] += 1; left -= slotCost(p.u); }
  }
  fill(out, ballast, left);
  return out;
}

/**
 * Treat a composition as RATIOS and re-fit it to the budget the empire granted,
 * so nothing downstream of the screen can mint troops. A composition that
 * already costs exactly `slots` comes back untouched — that identity is what
 * lets the screen's carry-over survive the seam intact.
 */
export function fitComposition(slots, unlocked, chosen) {
  const weights = {};
  for (const u of UNIT_IDS) {
    weights[u] = unlocked.includes(u) ? Math.max(0, Number(chosen?.[u]) || 0) : 0;
  }
  const any = UNIT_IDS.reduce((a, u) => a + weights[u], 0);
  return distributeExpedition(slots, unlocked, any > 0 ? weights : DEFAULT_COMPOSITION_WEIGHTS);
}

/**
 * Carry a previous loadout into a new budget.
 *
 * Growth (a region conquered, a Standing Army level) becomes MILITIA. It is
 * never a rescale: the four raiders a player deliberately paid ten slots for are
 * still four raiders. A budget that shrank sheds from the cheapest unit up, for
 * the same reason — militia is the ballast, the specialists were the decision.
 *
 * `prev` is trusted only as far as it is legal: locked units drop out, so a unit
 * refunded or removed from the roster cannot ride along in a stale save.
 */
export function carryComposition(slots, unlocked, prev) {
  const budget = clampInt(slots);
  if (!prev) return distributeExpedition(budget, unlocked);

  const out = sanitizeComposition(prev, unlocked);
  let spent = compositionSlots(out);

  const cheapestFirst = UNIT_IDS
    .filter((u) => out[u] > 0)
    .sort((a, b) => slotCost(a) - slotCost(b) || UNIT_IDS.indexOf(a) - UNIT_IDS.indexOf(b));
  for (const u of cheapestFirst) {
    while (spent > budget && out[u] > 0) { out[u] -= 1; spent -= slotCost(u); }
  }

  const ballast = ballastUnit(unlocked);
  if (spent < budget) fill(out, ballast, budget - spent);
  return out;
}

/**
 * Move the loadout by exactly one unit of `unitId`, inside the budget.
 *
 * `+` spends free slots first and otherwise trades DOWN — it takes from the
 * cheapest other unit that has stock, so one click buys a raider instead of
 * four (remove militia, remove militia, remove militia, add raider). `-` hands
 * the freed slots straight back to the ballast. Both directions land exactly on
 * the budget, so the control cannot produce an over-budget army at all; the
 * Launch gate exists on top of that, not instead of it.
 */
export function nudgeComposition(chosen, unitId, delta, unlocked, budget) {
  const out = sanitizeComposition(chosen, unlocked);
  if (!delta || !unlocked.includes(unitId)) return out;
  const cost = slotCost(unitId);
  const ballast = ballastUnit(unlocked);

  if (delta < 0) {
    if (out[unitId] <= 0) return out;
    out[unitId] -= 1;
    if (ballast !== unitId) fill(out, ballast, cost);
    return out;
  }

  if (out[unitId] >= maxOf(unitId)) return out;
  let free = clampInt(budget) - compositionSlots(out);
  while (free < cost) {
    const donor = UNIT_IDS
      .filter((u) => u !== unitId && out[u] > 0)
      .sort((a, b) => slotCost(a) - slotCost(b) || UNIT_IDS.indexOf(a) - UNIT_IDS.indexOf(b))[0];
    if (!donor) return sanitizeComposition(chosen, unlocked); // nothing to trade
    out[donor] -= 1;
    free += slotCost(donor);
  }
  out[unitId] += 1;
  fill(out, ballast, free - cost);
  return out;
}

/** Would that nudge change anything? Drives the +/- disabled state. */
export function canNudge(chosen, unitId, delta, unlocked, budget) {
  const before = sanitizeComposition(chosen, unlocked);
  const after = nudgeComposition(chosen, unitId, delta, unlocked, budget);
  return UNIT_IDS.some((u) => after[u] !== before[u]);
}
