// THE MUSTER — the one thing the enemy does that you have to ANSWER.
//
// The AI grinds. Measured on a real gallowmoor battle: 2,114 enemy columns in
// twenty minutes at a MEDIAN SIZE OF TWO, about one field battle a second,
// forever. It is not making bigger decisions as the war goes on, it is making
// vastly more, equally tiny ones — and a permanent grinder is hard to tune
// precisely because nothing that happens in it is decisive.
//
// So once per battle the enemy stops grinding and commits. It pulls the spare
// from every site it holds into ONE synchronized wave aimed at the player's
// CAMP, and it says so out loud.
//
// PURE DATA. The trigger and the arithmetic are in battle/setpiece.js, the same
// division of labour the region table and the mutator table both use.
//
// FIVE RULES, and the first two are the whole design.
//
// 1. IT IS AIMED AT THE CAMP, AND THAT IS THREE DECISIONS AT ONCE. It is the
//    lose condition, so it is the one target a player cannot decide to ignore.
//    It is a site the player OWNS, so the alert that announces it names ground
//    they can already see — which is what makes it fog-safe by construction
//    rather than by a check, the same property the six existing alert handlers
//    have (`screens/battle-alert.js`; the event bus is emitted regardless of
//    fog, so every handler is individually responsible for not leaking). And it
//    is the one site the ordinary `attack()` phase will almost never pick,
//    because that phase scores by `AI.siteValue` and reach and the camp is
//    usually the furthest thing on the board from the enemy's country.
//
// 2. IT IS ANNOUNCED WHEN IT LAUNCHES, NOT WHEN IT LANDS, and the warning is
//    the TRAVEL TIME — a real number the sim already computes, not a scripted
//    countdown. `launch()` holds every squad in a wave to the slowest
//    contributor's arrival, so on a late map that is thirty to sixty seconds of
//    notice. There are two honest answers and the second one is the reason this
//    is a decision rather than a chore: march home and meet it, or notice that
//    the enemy has just emptied its own country and go and take it. The second
//    is not scripted — it falls out of `launch()` debiting every source.
//
// 3. A SCHEDULE, NOT A PHASE, AND NOT A SINGLE SHOT EITHER. `state.ai.musterWave`
//    is the index of the next wave due; a wave that fires advances it and can
//    never fire twice. Firing ONCE per battle was the first cut and it left the
//    diagnosis half-answered: 93% of every non-win in this campaign is a
//    TIMEOUT rather than a defeat, because the ordinary attack phase cannot
//    mass (measured: 122 enemy troops across 8 sites pooling 16 against a
//    59-defender camp), so the enemy is weather and one scripted moment is not
//    enough weather to decide anything. Three widely-spaced, escalating,
//    individually-announced commitments is still not a phase — the grinder runs
//    at about one field battle a SECOND, and three events in twenty minutes
//    cannot be mistaken for it.
//
//    This is what AI War, They Are Billions, Kingdom Two Crowns and Dune II all
//    do, and none of them made the tactical AI smarter: they manufactured
//    telegraphed spikes at the strategic layer. The alternative is disproven
//    here — `tools/simpool.js` taught the harness to concentrate and moved
//    nothing (25%/33% and 27%/23%, opposite signs), because "the force never
//    exists".
//
// 4. IT MUST BE A HOST OR IT MUST NOT HAPPEN. `minBodies` is what stops the
//    loudest announcement in the game arriving in front of eleven militia. If
//    the enemy cannot raise one inside its window, there is no muster — which
//    is correct: an enemy that thin is losing, and the player does not need
//    telling.
//
// 5. THE WINDOW SCALES WITH THE REGION, not with a per-row table.
//    `hardCapTicks` already encodes how long this battle is meant to be
//    (`targetLengthMin` derives it), so a fraction of it lands mid-fight on a
//    nine-minute opener and mid-fight on a twenty-eight-minute finale with no
//    second table to keep in step.

export const MUSTER = Object.freeze({
  /**
   * THE SCHEDULE. Each wave owns a window `[at, at + span]` as a fraction of
   * `rules.hardCapTicks`, and they are tried in order.
   *
   * `at` 0.30 is comfortably past every tier's `warmupSec` (90-255s), so even
   * the first host is drawn from a country that has actually developed. The
   * last window closes at 0.82, leaving nearly a fifth of the clock — a host
   * that lands with no time to answer is a difficulty spike wearing a
   * set-piece's clothes, which is what `lastFrac` 0.72 protected before.
   *
   * `commit` and `minBodies` both ESCALATE. The first wave is a raid the player
   * can absorb; the third is the enemy emptying its country, and it should feel
   * like a different event rather than the same one again. The rising floor is
   * the other half of that: a late wave that could only scrape together
   * eighteen bodies is not the climax this schedule is promising, and it is
   * better skipped than announced.
   *
   * Each `span` is deliberately WIDE (12% of the cap, 2-3 minutes). A wave does
   * not latch on failure, so a thin enemy keeps trying across its whole window
   * — an enemy that is poor at minute six and rich at minute nine still gets
   * its moment, which is the rule the one-shot version already had and the one
   * most easily lost in a rewrite.
   */
  waves: Object.freeze([
    Object.freeze({ at: 0.30, span: 0.12, commit: 0.55, minBodies: 18 }),
    Object.freeze({ at: 0.50, span: 0.12, commit: 0.70, minBodies: 24 }),
    Object.freeze({ at: 0.70, span: 0.12, commit: 0.85, minBodies: 30 }),
  ]),

  /** How many sites feed it. Deliberately far above `AI.maxSources` (3), which
   *  bounds an ORDINARY assault's search: this is the one moment the enemy is
   *  allowed to draw on its whole country, and capping it at three would make
   *  the set-piece smaller than a routine attack on a late map. */
  maxSources: 12,
});
