// BULK PURCHASE: what the shop buys NEXT, and how it buys a lot of it at once.
//
// Split out of ./upgrades.js at the 400-line cap, along the seam that matters:
// that file answers "what does this line cost, what does it do, may I buy it";
// this one is the LOOP over those answers.
//
// IT IS NOT RE-EXPORTED FROM `upgrades.js`, and that is deliberate rather than
// an omission. Everything here imports `canBuy`/`buy`/`shopListing` from there,
// so a re-export back would close a cycle — the same reason `battle/rally.js`,
// `core/refund.js` and `battle/retreat.js` are each imported directly by their
// consumers. There are three: screens/shop.js, tools/simshop.js and
// tests/shopbulk.test.js.
import { UPGRADES } from '../content/upgrades.data.js';
import { canBuy, buy, shopListing } from './upgrades.js';

// ---------------------------------------------------------------------------
// Bulk purchase. One rule, shared by the shop screen's "Spend all"/"x10"
// controls and the harness's own shopping routine — see tools/simshop.js,
// which used to carry a private copy of the loop below. Two implementations
// of "what does the shop buy next" is exactly the drift this codebase keeps
// finding, so there is exactly one, here, and every caller shares it.
// ---------------------------------------------------------------------------

const EMPTY_SKIP = Object.freeze(new Set());

/**
 * SPEND EVERYTHING IN ONE PURSE, cheapest-affordable-first, until nothing is
 * left to buy.
 *
 * This is the loop that used to cost a player 10 to 146 identical clicks to
 * run by hand (measured through this exact function, at 1k/100k/1M/50M
 * crowns) — the shop's "Spend all" button IS this call, with no skip list,
 * because a player who pressed it has already decided everything on sale is
 * fair game. `tools/simshop.js` is the other caller, and it DOES pass a skip
 * set, because the harness knows in advance which specialists a run will
 * never field and must not spend a measurement's crowns on one.
 *
 * The 400-round guard is not a real limit: the cheapest line in the game is
 * 45 crowns and the richest purse this project has measured is tens of
 * millions, so the loop always runs out of affordable lines first. It exists
 * so a future bug in the cost curve (a price that stops rising, say) fails as
 * a bounded loop instead of a hung tab.
 *
 * @returns {number} purchases made, so a caller can tell "there was nothing
 *   to spend" from "that spent everything" without a second listing pass.
 */
export function spendAll(meta, currency, bus = null, skip = EMPTY_SKIP) {
  let bought = 0;
  for (let guard = 0; guard < 400; guard++) {
    const affordable = shopListing(meta)
      .flatMap((g) => g.items)
      .filter((i) => (i.currency ?? 'crowns') === currency
        && i.affordable && i.level < i.maxLevel && !skip.has(i.id))
      .sort((a, b) => a.cost - b.cost);
    if (!affordable.length) break;
    buy(meta, affordable[0].id, bus);
    bought++;
  }
  return bought;
}

/**
 * Buy ONE line up to `n` times, stopping the moment it is unaffordable or
 * maxed. Priced level-by-level through `buy()`, never a single deduction at
 * today's rate times `n` — a level-9 line does not cost nine times its
 * level-0 price, and quoting it that way would be a lie about its own price.
 * Powers the shop's per-line "x10" control, offered only on the endless lines
 * (see `isEndless`), where "again" is ever a question worth a shortcut.
 * @returns {number} purchases actually made (0..n)
 */
export function buyN(meta, id, n, bus = null) {
  let bought = 0;
  while (bought < n && buy(meta, id, bus).ok) bought++;
  return bought;
}

/**
 * THE SUGGESTED BUY: the cheapest AFFORDABLE line in one group, or null.
 *
 * Exists because cheapest-affordable-first is the only allocation this
 * project has ever measured winning (33% at n=48, against 2% for buying
 * Standing Army first and 0% for Treasury first — see CLAUDE.md's
 * uphill-raid section) and nothing on the screen ever taught it. It names no
 * numbers and ranks nothing: it points at ONE row, so a player learns the
 * rule by watching it move rather than by reading a recommendation engine's
 * opinion of six competing figures — which is exactly the min-max meta-game
 * this feature is not allowed to become.
 *
 * Scoped to the EMPIRE group alone, on purpose: those are the six lines a
 * player revisits on every single purchase, which is the decision the
 * 33/2/0 split is actually about. An Unlock is bought once and a Troops line
 * is gated to a unit already in play, so "which of these do I feed next" is
 * never a live question the way it is for the six that never end.
 *
 * @returns {?string} an upgrade id, or null when nothing in the group is
 *   affordable — the negative control that matters as much as the happy path.
 */
export function suggestedBuy(meta, groupId = 'empire') {
  let best = null;
  for (const u of UPGRADES) {
    if (u.group !== groupId) continue;
    const check = canBuy(meta, u.id);
    if (check.ok && (!best || check.cost < best.cost)) best = { id: u.id, cost: check.cost };
  }
  return best?.id ?? null;
}
