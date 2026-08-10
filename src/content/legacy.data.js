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
   * HOW MANY REGIONS A SECOND RUN STARTS HOLDING, per abdication, and the ceiling
   * on it. The reasoning is measured and is written out at meta/prestige.js
   * `headStartFor`: a permanent multiplier big enough to be worth pressing the
   * button for makes the replayed campaign a formality no matter how small the
   * grants are cut, so the reward has to make the replay SHORTER rather than
   * easier. Eight regions a reset, and never past fifteen — so tiers 5 and 6 are
   * earned on every run the player ever plays.
   */
  headStartPerReset: 8,
  headStartMax: 15,

  /**
   * WHAT ONE POINT GRANTS. Every entry rides a bucket that already exists
   * (meta/upgrades.js `upgradeEffects`), so legacy reaches a battle down exactly
   * the channels the shop does and there is no second stacking order to get wrong.
   *
   * THE EXPEDITION GRANT IS A PERCENTAGE, AND THE FIRST VERSION WAS FLAT. That is
   * the whole lesson of this block. `+3 slots a point` reads modest against the
   * 862-slot budget of the last region — it is +9% there — but the OPENING budget
   * is twelve, so the same grant was +675% on riverfen. Measured with the harness's
   * `--legacy` flag at 27 points (what a first abdication pays), it did not make
   * the second run faster, it deleted it:
   *
   *     riverfen kaldan gallowmoor thanescar widowsgate
   *        100%    100%      100%       97%      100%     n=32, legacy 27
   *
   * — the last region of the game won every time in 4.3 minutes. Twenty-four
   * battles nobody can lose is not a victory lap, it is a chore with no decisions
   * in it. A percentage is worth the same PROPORTION at both ends of the campaign,
   * which is the only way one number can be right for a 12-slot landing and an
   * 862-slot one.
   *
   * `atk` and `def` are deliberately the smallest numbers here. They are the two
   * channels the campaign's difficulty curve is measured against
   * (content/regions.data.js, second load-bearing rule), so a generous legacy on
   * those does not make a second run faster either — it makes every measured
   * region a walkover, including the three the tier-6 dial was solved against.
   *
   * `income` is the one number that can be generous without touching a battle: it
   * is the idle half, it buys shop levels rather than troops, and the shop's own
   * curve is logarithmic in crowns. At 27 points it is +135%.
   */
  grant: Object.freeze({
    income: 0.035,
    atk: 0.004,
    def: 0.004,
    /** A FRACTION of the expedition budget, not a slot count. See above. */
    expeditionMult: 0.006,
  }),
});
