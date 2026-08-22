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
// 3. ONCE. `state.ai.musterTick` is written when it fires and checked before it
//    can fire again. A set-piece that repeats is a phase, and a phase is the
//    grinder this exists to interrupt.
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
  /** Earliest, as a fraction of `rules.hardCapTicks`. Comfortably past every
   *  tier's `warmupSec` (90-255s) so the host is drawn from a country that has
   *  actually developed, and well before the cap so there is a battle left to
   *  fight afterwards. */
  atFrac: 0.42,

  /** Latest. Past this the moment has gone: a host that lands with three
   *  minutes on the clock cannot be answered either way, so it would be a
   *  difficulty spike wearing a set-piece's clothes. If the enemy has not
   *  raised one by here, this battle simply does not have a muster in it. */
  lastFrac: 0.72,

  /** Share of each contributing site's SPARE garrison — spare meaning above
   *  `floorFor`, because it goes through the same `sourceFrom` every other
   *  phase uses. High on purpose: the whole point is a commitment, and the
   *  counter-play in rule 2 only exists if their country is genuinely thin
   *  afterwards. */
  commit: 0.75,

  /** Below this it is a rumour, not a host — see rule 4. */
  minBodies: 24,

  /** How many sites feed it. Deliberately far above `AI.maxSources` (3), which
   *  bounds an ORDINARY assault's search: this is the one moment the enemy is
   *  allowed to draw on its whole country, and capping it at three would make
   *  the set-piece smaller than a routine attack on a late map. */
  maxSources: 12,
});
