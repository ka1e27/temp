// THE TUTORIAL SCRIPT — which line, when, and when it retires.
//
// Split from coach.js at the 400-line cap. Pure data plus predicates over the
// latch; no DOM, no clock, no state of its own, which is what lets
// tests/coach.test.js drive the whole thing headlessly.
//
// HALF OF THIS WAS DEAD. `COACH.strongholdTaken`, `buildRams`, `siegeStalled`
// and `retreat` sat in strings.js with no entry in this table for the project's
// whole life — including the three that teach the mechanics people actually
// lose to. The test file could not notice, because all 22 of its assertions
// iterate BEATS: it proved the wired beats worked and never asked about the
// rest, which is the failure mode CLAUDE.md warns about in its own words.

import { COACH } from '../content/strings.js';

/** How long a line holds. A teaching line outlasts a statement, because it is
 *  asking the player to understand something rather than to notice it. */
export const HOLD = Object.freeze({ normal: 6000, teaching: 9000 });



/**
 * The beats, IN ORDER. `when` is a pure predicate over signals; `after` names a
 * beat that must already have fired, which is what stops "Strongholds turn gold
 * into soldiers" arriving before the player has captured anything (the player
 * starts a battle holding 300 gold, so the raw `gold > 100` test is true on
 * tick 0 and would otherwise jump the queue). `until` retires a line early once
 * the player has visibly done the thing it asks for.
 */
export const BEATS = Object.freeze([
  {
    id: 'drag',
    text: COACH.drag,
    hold: HOLD.normal,
    when: (s) => s.started,
    until: (s) => s.sentSquad,
  },
  {
    // The two-stage field-then-siege capture is the core mechanic and nothing
    // else in the game explains it. This is the beat that earns the feature.
    id: 'fieldWon',
    text: COACH.fieldWon,
    hold: HOLD.teaching,
    after: 'drag',
    when: (s) => s.siegeBegun,
  },
  {
    id: 'captured',
    text: COACH.captured,
    hold: HOLD.normal,
    after: 'drag',
    when: (s) => s.captured,
  },
  {
    id: 'gold100',
    text: COACH.gold100,
    hold: HOLD.normal,
    after: 'captured',
    when: (s) => s.gold > 100,
  },
  // MUTUALLY EXCLUSIVE, on the one signal that says whether the rule is real
  // here. A first-timer approaching the throne still needs to hear that it ends
  // the region; what they must not be told is that a gate holds it when the
  // region ships `castleGateFrac: 0`, which the campaign opener does.
  {
    id: 'takeCastle',
    text: COACH.takeCastle,
    hold: HOLD.normal,
    after: 'captured',
    when: (s) => s.castleAdjacent && s.castleGated,
  },
  {
    id: 'takeCastleOpen',
    text: COACH.takeCastleOpen,
    hold: HOLD.normal,
    after: 'captured',
    when: (s) => s.castleAdjacent && !s.castleGated,
  },
  // THE FOUR BEATS THAT WERE WRITTEN AND NEVER SHOWN. `COACH.strongholdTaken`,
  // `buildRams`, `siegeStalled` and `retreat` have existed in strings.js for
  // this project's whole life with no entry here, so half the tutorial script
  // was dead copy — and the three teaching the mechanics that actually beat
  // people (a stalled siege, rams, pulling out) were among them.
  // tests/coach.test.js could not notice: all 22 of its assertions iterate
  // BEATS, so it proved the wired beats worked and never asked about the rest.
  {
    id: 'strongholdTaken',
    text: COACH.strongholdTaken,
    hold: HOLD.normal,
    after: 'captured',
    when: (s) => s.tookStronghold,
  },
  {
    id: 'siegeStalled',
    text: COACH.siegeStalled,
    hold: HOLD.teaching,
    after: 'fieldWon',
    when: (s) => s.siegeStalled,
  },
  {
    id: 'buildRams',
    text: COACH.buildRams,
    hold: HOLD.teaching,
    after: 'gold100',
    when: (s) => s.castleAdjacent && s.gold > 250,
  },
  // `firstIncome` is NOT a battle beat — it belongs to the moment the region is
  // won, which is the results screen (screens/results.js `resultCopy`). Listed
  // here so the derived test in tests/coach.test.js can see that every line of
  // COACH copy reaches a player somewhere, which is the property that was broken.
  {
    id: 'firstIncome',
    text: COACH.firstIncome,
    hold: HOLD.teaching,
    after: 'captured',
    when: () => false,   // shown by results.js, never by the in-battle strip
  },
  {
    id: 'retreat',
    text: COACH.retreat,
    hold: HOLD.normal,
    after: 'fieldWon',
    when: (s) => s.lostSite,
  },
].map(Object.freeze));

