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
 * (5.48, post-retune). The ladder is not "the last region again", it is its own
 * curve that happens to be fought there — so the first rungs have to be a
 * victory lap for a player who has just finished the campaign, and the region's
 * own dial is tuned for a player who had not.
 *
 * `perDepth` is small because `enemyMult` is violently non-linear this late: tier
 * 5 lost 22 points over +0.10 (content/regions.data.js). At 1.2% a rung, ten
 * rungs is +13% on the dial, which is about one campaign region's worth of step —
 * roughly the rate at which a player who is idling and buying Crown levels gets
 * stronger, which is what makes the ladder feel like it recedes rather than ends.
 * IT ALSO CANNOT GO LOWER THAN ~0.0118: `tests/incursion.test.js` "the dial rises
 * with depth, and only with depth" asserts sixty rungs is worth more than
 * doubling the dial, i.e. `(1+perDepth)^59 > 2`. That floor is what pins this
 * knob in practice — the tail (see below) cannot be eased through `perDepth`
 * without breaking that assertion, only through `baseDial`.
 *
 * RE-MEASURED after a shared-tree accident briefly stacked a second engineer's
 * `siteCounts`/`develop` edits under this pass's own `enemyMult` column (see
 * the commit that rebuilt content/regions.data.js from the last known-good
 * base). The arena (widowsgate) now ships at its ORIGINAL, pre-that-episode
 * shape — `develop` 3.3, `siteCounts.enemy` 18 — which is softer than the
 * harder arena a previous `baseDial`/`perDepth` (3.55-3.65 / 0.012) had been
 * calibrated against: at 3.65 the ladder read 100/100/100 at depths 1/5/10,
 * a formality rather than a climb.
 *
 * `baseDial` moved 3.65 -> 4.38 to restore the shape against the arena as it
 * now ships (`perDepth` untouched — moving it risks the doubling floor below).
 *
 * RE-MEASURED AFTER THE CAMPAIGN RE-TUNE, which moved the arena underneath this
 * curve twice over: widowsgate's own dial, and the fog changes (squad sight,
 * sightings memory, hidden enemy buildings) that apply to a rung exactly as they
 * apply to a raid. `node tools/simrunner.js --incursion=1,5,10,20,30,40 --n=48`:
 *
 *     depth      1    5   10   20   30   40
 *     win%      98   88   71   50   19    2
 *     win-med  2.9  3.9  5.3  5.3 11.3  6.7   (minutes)
 *     target    94   88   75   38   19   ~0
 *
 * The shape survived, which is the finding: 90%+ at the opening rung, a real
 * climb through the middle, a coin flip in the low 20s and nothing past 40.
 * NOTHING WAS CHANGED FOR IT. Five of the six rungs are within four points of
 * target and depth 30 is exact; the one outlier is depth 20 at +12, which is
 * 1.7 standard errors on an n=48 sample and cannot be corrected without a
 * knob that moves the rungs already sitting on target — `baseDial` shifts the
 * whole curve and `perDepth` is pinned from below by the doubling assertion.
 * Recorded as an open observation rather than tuned, the same way `split`'s
 * uniform -6 is in CLAUDE.md: re-take it at n>=96 before spending a change.
 *
 * `sealed` is live here too: the campaign's own `GATE_CLAMP` plateaus at 0.60
 * regardless of what a region's raw `castleGateFrac` was authored as, so the
 * mutator's 0.72 is a genuine +0.12 whatever the arena's other columns do.
 *
 * The ten-hour-idle endurance table this section used to carry (depth 40/55
 * win% for a player who has kept idling and buying Crown levels) was NOT
 * re-measured in this pass — it is long-running (`--idle=600`) and orthogonal
 * to the depth curve above, which is measured at a fixed idle time. Re-take it
 * with `node tools/simrunner.js --incursion=40,55 --idle=600 --n=16` before
 * trusting the word "endless" against the new dial.
 */
export const INCURSION = Object.freeze({
  /** THE ARENA. The last region in the campaign: the deepest ground and the
   *  biggest board. Fixed rather than rotated — see rule 3 above for the
   *  57-point measurement behind that. */
  regionId: 'widowsgate',
  /**
   * THE LADDER'S OWN CASTLE-GATE CEILING, and it is deliberately HIGHER than
   * the campaign's `GATE_CLAMP` (0.60) rather than shared with it.
   *
   * The campaign cap is 0.60 because a region has to be winnable on its own
   * terms and the player has exactly one route through the table; measured,
   * anything above that stopped being an anti-rush guarantee and became the
   * win condition (thirty-seven of thirty-seven timeouts sat under the gate).
   *
   * A rung is different in one direction and identical in the other. It is
   * retried freely, so a hard gate costs a retry rather than a run — that buys
   * the headroom. But a rung CANNOT BE SKIPPED, so an unwinnable one does not
   * cost a retry, it ends the ladder permanently at a rung that is not even
   * the hard one. So the ladder needs a ceiling too; it is simply a different
   * number, and it is the reason `sealed` sits at 0.72 rather than wherever a
   * future pass fancies.
   */
  gateCeiling: 0.75,
  /** Where the curve starts, independent of what the arena's own row says. */
  baseDial: 4.38,
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
    // INERT FROM THE DAY THE ARENA WAS FIXED, AND THAT IS WHY THIS VALUE IS NOT
    // 0.85 ANY MORE. `incursionRules` takes `max(the region's own gate, this)`,
    // and the arena is widowsgate, whose gate WAS 0.85 — so the max was always
    // the region's own and this mutator changed nothing, on any rung, ever. The
    // note promised "take the countryside" and the rung played identically
    // without it. That is the fifth piece of inert content this project has
    // found, and the comment above `incursionRules` warns about exactly this
    // class two paragraphs before the line that had it.
    //
    // The campaign gate now plateaus at 0.60 (regions.rules.js GATE_CLAMP and
    // the measurement behind it), so there is real headroom here for the first
    // time. 0.72 against a 0.60 base is a genuine +0.12 that makes the
    // countryside mandatory the way the note claims, and it stays under
    // INCURSION_GATE_CEILING — because a rung CANNOT BE SKIPPED, so an
    // unwinnable one ends the ladder outright rather than costing a retry.
    id: 'sealed', name: 'Sealed Throne', weight: 3, kind: 'gate',
    value: 0.72,
    note: 'The throne cannot fall until you hold 72% of the region. Take the countryside.',
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
