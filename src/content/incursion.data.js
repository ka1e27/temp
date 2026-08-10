// THE INCURSION LADDER — the campaign's answer to "I have taken everything and
// the shop still sells levels".
//
// Twenty-four regions end. Raids do not (a conquered region re-fights on a
// cooldown, 15% harder every clear), but a raid is a rerun: the same map, the
// same dial, a bigger number. What the endgame did not have was DEPTH — one
// ladder that keeps going, that you can lose on without losing anything, and
// that eventually walls you out and tells you to go and get stronger.
//
// PURE DATA. The arithmetic is in meta/incursion.js and every crown is in
// meta/rewards.js, which is the same division of labour as the region table.
//
// FOUR RULES, and the first two are the whole design:
//
// 1. DEPTH ONLY GOES UP, AND ONLY ON A WIN. There is no cooldown and there does
//    not need to be one: you cannot re-fight a depth you have cleared, so there
//    is no easy rung to farm, and the difficulty compounds until you cannot
//    clear the next one. What bounds the loop is winnability, exactly as it is
//    for raids (see the RAID block in content/regions.rules.js) — a cap would
//    only be a second, worse statement of the same thing.
//
// 2. A LOSS COSTS NOTHING BUT THE BOOSTERS YOU FIRED. Same rule as the campaign
//    (meta/rewards.js), and it is what makes "try it with a different army" the
//    natural response to a wall rather than "grind the rung below it".
//
// 3. IT IS FOUGHT ON ONE PIECE OF GROUND, and that is a MEASUREMENT rather than a
//    preference. The first version cycled through the nine late regions in
//    campaign order, which reads better and cannot work: measured at n=16, depth
//    15 on ravensmarch (dial 5.05, two mutators) won 63% while depth 10 on
//    widowsgate (dial 5.08, two mutators) won 6%. Fifty-seven points at the same
//    dial — the ground, not the depth, was the difficulty, because `develop`, the
//    board, the site counts and the castle gate all differ by design across those
//    nine rows.
//
//    On a ladder that would be fatal in a way it is not for a campaign: rungs
//    cannot be SKIPPED. A player who cleared depth 9 comfortably would meet an
//    unwinnable depth 10 and the ladder would simply end there, at a rung that is
//    not even the hard one. So the arena is fixed and the depth is the only thing
//    that moves. Variety comes from the layout — `seed` includes the depth, so
//    every rung generates a different map of the same region — and from the
//    mutators.
//
//    Rotation is not impossible, it is UNCALIBRATED: it would need a per-region
//    ladder dial, measured, so that every region hit the same difficulty curve.
//    That is a balance pass with nine binary searches in it, and it would have to
//    be re-taken whenever tools/simplayer.js changes. Recorded here so the next
//    pass does not re-derive the 57 points.
//
// 4. THE MUTATORS OWN VERBS, NOT NUMBERS — with two deliberate exceptions. A
//    ladder made of "+10% enemy attack, then +20%, then +30%" is the difficulty
//    dial with extra reading, and the dial is already there. What each mutator
//    below does instead is make a DIFFERENT ANSWER correct: `ironwall` is the
//    first thing in the game that makes sappers-versus-engines a real question
//    on the attacking side, `sealed` makes the countryside mandatory, `thinned`
//    makes the loadout matter more than the budget. `warhost` and `bulwark` are
//    the two plain multipliers and they are here on purpose: three mutators drawn
//    from six verbs would collide constantly, and a tier that is merely harder is
//    a fine third of a hand.

/**
 * The ladder's shape: one arena, one curve, one knob.
 *
 *     dial(depth) = baseDial x (1 + perDepth) ^ (depth - 1)
 *
 * `baseDial` is FLAT and deliberately below the arena's own shipped `enemyMult`
 * (4.48). The ladder is not "the last region again", it is its own curve that
 * happens to be fought there — so the first rungs have to be a victory lap for a
 * player who has just finished the campaign, and the region's own dial is tuned
 * for a player who had not.
 *
 * `perDepth` is small because `enemyMult` is violently non-linear this late: tier
 * 5 lost 22 points over +0.10 (content/regions.data.js). At 1.2% a rung, ten
 * rungs is +13% on the dial, which is about one campaign region's worth of step —
 * roughly the rate at which a player who is idling and buying Crown levels gets
 * stronger, which is what makes the ladder feel like it recedes rather than ends.
 *
 * MEASURED, `node tools/simrunner.js --incursion=... --n=16`, for a player who has
 * just taken the last region and idled half an hour:
 *
 *     depth      1    5   10   20   30   40   55
 *     win%      94   88   75   38   19    0    0
 *     win-med  2.7  4.6  5.8  9.7 11.0    —    —   (minutes)
 *
 * ...and the same table for the same player after ten hours of idling, which is
 * the claim the word "endless" is making and the only one that matters here:
 *
 *     depth     40   55
 *     win%      75   44
 *
 * The wall RECEDES rather than moving: ten hours of income and the Crown levels it
 * buys take depth 40 from impossible to routine and push the coin flip from
 * roughly rung 17 to rung 55. If a future pass makes the ladder feel finite, that
 * second table is the one to re-take — a `perDepth` that outruns the shop's own
 * curve turns the ladder back into a wall with extra steps.
 */
export const INCURSION = Object.freeze({
  /** THE ARENA. The last region in the campaign: the deepest ground, the biggest
   *  board, and the only castle gate at the GATE_CLAMP ceiling. Fixed rather than
   *  rotated — see rule 3 above for the 57-point measurement behind that. */
  regionId: 'widowsgate',
  /** Where the curve starts, independent of what the arena's own row says. */
  baseDial: 3.55,
  /** Compounding growth on `baseDial`, per rung. */
  perDepth: 0.012,
  /** Depth at which the 1st, 2nd and 3rd mutator arrive. Three is the ceiling
   *  because the table has eight entries: a fourth would mean half the table
   *  applies at once, and a hand of mutators that is always "most of them" is
   *  not a hand. */
  mutatorsAt: Object.freeze([3, 9, 18]),
  /** Seconds of EMPIRE income a difficulty-1.0 incursion pays, before the dial
   *  and the mutator premium. Deliberately below RAID.lumpSeconds (600): an
   *  incursion has no cooldown, so it is paid per battle rather than per ten
   *  minutes of waiting, and the DIAL is what makes depth worth pushing. */
  lumpSeconds: 300,
  /** Each mutator in play pays this much more, because each one is a thing the
   *  player had to answer rather than a bigger number to out-scale. */
  mutatorPay: 0.15,
});

/**
 * The mutator table.
 *
 * `kind` is what meta/incursion.js switches on, and every one of them is applied
 * through a field that ALREADY crosses the seam — a FactionMods multiplier, a
 * generation input, or a rule. That is not a coincidence, it is the constraint
 * the table was written against: a mutator that needed a new engine field would
 * be a mechanic pretending to be content, and it would have to be tuned against
 * twenty-four regions instead of one ladder.
 *
 * `weight` is drawing frequency, not difficulty. The two plain multipliers are
 * weighted up because they combine with anything; `thinned` is weighted down
 * because it is the one that can make a rung feel unfair when it lands with
 * `sealed`.
 */
export const MUTATORS = Object.freeze([
  {
    id: 'ironwall', name: 'Iron Wall', weight: 3, kind: 'enemyMult',
    field: 'structureRegenMult', value: 1.6,
    note: 'Enemy walls repair 60% faster. A siege that does not out-pace it never breaches.',
  },
  {
    id: 'warhost', name: 'War Host', weight: 4, kind: 'enemyMult',
    field: 'unitAtkMult', value: 1.12,
    note: 'Every enemy troop attacks 12% harder.',
  },
  {
    id: 'bulwark', name: 'Shieldwall', weight: 4, kind: 'enemyMult',
    field: 'unitDefMult', value: 1.12,
    note: 'Every enemy troop defends 12% harder.',
  },
  {
    id: 'scorched', name: 'Scorched Earth', weight: 3, kind: 'playerMult',
    field: 'farmYieldMult', value: 0.6,
    note: 'The farms you take are burnt: they yield 40% less. Take more of them.',
  },
  {
    id: 'levies', name: 'Levied Country', weight: 3, kind: 'enemyMult',
    field: 'trainSpeedMult', value: 1.25,
    note: 'Enemy yards train 25% faster. Stalling in front of a wall now feeds it.',
  },
  {
    id: 'thinned', name: 'Thinned Ranks', weight: 2, kind: 'expedition',
    value: 0.82,
    note: 'Only 82% of your expedition makes the landing. What you brought matters more.',
  },
  {
    id: 'sealed', name: 'Sealed Throne', weight: 3, kind: 'gate',
    value: 0.85,
    note: 'The throne cannot fall until you hold 85% of the region. Take the countryside.',
  },
  {
    id: 'entrenched', name: 'Entrenched', weight: 3, kind: 'develop',
    value: 0.5,
    note: 'Their country starts a level further built. Bring engines.',
  },
]);

export const MUTATOR_BY_ID = Object.freeze(
  Object.fromEntries(MUTATORS.map((m) => [m.id, m])),
);

/** Total drawing weight, precomputed so the draw is one pass. */
export const MUTATOR_WEIGHT_TOTAL = MUTATORS.reduce((a, m) => a + m.weight, 0);
