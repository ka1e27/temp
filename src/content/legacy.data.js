// ABDICATION — what ending a run is worth, and what the crown you hand on buys.
// PURE DATA. The arithmetic is in meta/legacy.js.
//
// An idle game's last mechanic is usually a reset, and the reason is not that
// players enjoy losing things: it is that a curve which only ever goes up
// eventually stops meaning anything. Twenty-four regions and six endless lines
// give a very patient player a hundred times the income of an ordinary one and
// almost none of the power (prices compound while effects add, so strength grows
// with the LOGARITHM of crowns — see content/upgrades.data.js). Abdication is the
// other direction: give up the empire, keep a permanent multiplier, and take the
// campaign again with a landing force that makes the early regions a victory lap
// instead of a re-tread.
//
// THREE RULES, and the first is the one that makes the rest safe:
//
// 1. YOU MAY ONLY ABDICATE FROM A FINISHED CAMPAIGN. Every region taken, or the
//    button is not there. That is what stops the obvious exploit — reset after
//    four cheap regions, forever — without a cooldown, a diminishing return or
//    any other machinery: the price of a payout is the whole campaign, and the
//    payout is worth about one campaign's worth of power.
//
// 2. LEGACY IS NEVER SPENT. It is a multiplier, not a currency. A prestige
//    currency with its own shop is a second economy to balance, a second screen
//    to read, and a second place for a number to be wrong; points here simply
//    apply, forever, to everything. What a player DECIDES is when to abdicate,
//    which is the interesting decision, and how deep to push the ladder first.
//
// 3. THE LADDER IS NOT AN EMPIRE AND DOES NOT RESET. `meta.incursion.cleared`
//    survives, because it is a record of what the player has beaten rather than
//    something they own — and because it is half of what a run pays.

/**
 * What one run is worth, in points.
 *
 *     points = perRegion x regions conquered + floor(rungs cleared / rungsPerPoint)
 *
 * A first abdication therefore pays 24 for the campaign plus whatever the ladder
 * gave — and the ladder half is the part that scales with how long the player
 * chose to stay, which is why it is worth pushing depth before ending a run.
 *
 * `rungsPerPoint` is 2 rather than 1 so that the two halves are the same order of
 * magnitude at the point most players will first abdicate (a campaign plus ten to
 * twenty rungs), instead of the ladder immediately dominating something that
 * costs twenty-four battles.
 */
export const LEGACY = Object.freeze({
  perRegion: 1,
  rungsPerPoint: 2,

  /**
   * WHAT ONE POINT GRANTS. Every entry rides a bucket that already exists
   * (meta/upgrades.js `upgradeEffects`), so legacy reaches a battle down exactly
   * the channels the shop does and there is no second stacking order to get wrong.
   *
   * Sized against a first payout of roughly 30 points: +150% income, +45% attack
   * and defence, +90 expedition slots. That is about what the shop's whole first
   * campaign is worth, which is the intent — the second run is a different game
   * for the first ten regions and an ordinary one by the last three.
   *
   * NOTE `atk` and `def` are deliberately the smallest numbers here. They are the
   * two channels the campaign's difficulty curve is measured against
   * (content/regions.data.js, second load-bearing rule), so a generous legacy on
   * those would not make a second run faster, it would make every measured region
   * a walkover — including the three the tier-6 dial was solved against.
   */
  grant: Object.freeze({
    income: 0.05,
    atk: 0.015,
    def: 0.015,
    expedition: 3,
  }),
});
