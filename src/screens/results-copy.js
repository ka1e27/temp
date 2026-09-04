// The RESULTS COPY LAYER: what the card says, and which of its numbers are
// money. Pure — no DOM, no ctx — which is why all four suites that assert this
// screen (`screens`, `heldfield`, `resultreason`, `bigmoments`) import from
// here rather than mounting anything.
//
// Split out of results.js at the 400-line cap, along the seam that was already
// there: this file decides WHAT is true about a finished battle, and results.js
// decides how it is put on the page. Re-exported from results.js, so no
// existing import had to move.
import { compact, rate, duration, integer, percent } from '../ui/format.js';
import { RESULTS, UI, COACH } from '../content/strings.js';

/**
 * Title and body for an outcome. Pure, so the four branches are testable and
 * none of them can quietly stop being reachable again.
 * @param {object} outcome  BattleOutcome
 * @param {object} applied  summary from applyOutcome()
 * @param {object|null} region
 */
export function resultCopy(outcome, applied, region) {
  const name = region?.name ?? 'The region';
  if (outcome.result === 'win') {
    if (applied?.incursion) {
      return {
        title: `Depth ${applied.incursion.depth} cleared`,
        body: 'The ladder goes on. The next rung is harder, and pays more for it.',
      };
    }
    if (applied?.raided) {
      return { title: `${name} raided`, body: 'A one-time lump. The region was already yours.' };
    }
    // THE FIRST CONQUEST IS WHERE THE TWO HALVES OF THE GAME CONNECT, and the
    // game had never once said so. `COACH.firstIncome` was written for exactly
    // this moment and wired to nothing; the screen said "so does its income" and
    // stopped, so a first-timer played this as a small RTS with a confusing shop
    // attached and never learned the idle half existed until they happened to
    // leave for a minute and come back.
    if (applied?.firstConquest) {
      return { title: `${name} is yours`, body: COACH.firstIncome };
    }
    // ...AND THE TWO MOMENTS AT THE OTHER END. Ordered campaign-complete FIRST:
    // the last region is not the capital, so the two can never both be true
    // today — but the order says which one wins if a future table ever makes
    // the capital the finale, and "you have finished" outranks "you took a
    // city" either way.
    if (applied?.campaignDone) {
      return { title: RESULTS.campaignTitle, body: RESULTS.campaignBody };
    }
    if (applied?.capital) {
      return { title: RESULTS.capitalTitle, body: RESULTS.capitalBody };
    }
    return { title: `${name} is yours`, body: 'Your empire grows, and so does its income.' };
  }
  if (outcome.result === 'retreat') {
    return { title: RESULTS.retreat, body: RESULTS.retreatBody };
  }
  if (outcome.result === 'timeout') {
    // THE CLOCK RAN OUT ON A BATTLE YOU WERE WINNING is a different thing from
    // the clock running out, and the game said the same sentence for both. It
    // branches on what was PAID rather than on the raw verdict, so the headline
    // and the Crowns row can never disagree — the same rule the loss branch
    // below follows for a fired booster charge.
    if (applied?.heldField) {
      return { title: RESULTS.heldField, body: RESULTS.heldFieldBody };
    }
    return { title: RESULTS.timeout, body: RESULTS.timeoutBody };
  }
  // A LOSS COSTS TIME *AND* ANY CHARGE YOU FIRED, so the copy has to know which
  // battle this was. `applyOutcome` consumes boosters unconditionally and there
  // is no refund on a defeat, and a charge is bought with relics — the currency
  // a raid never pays. Saying "nothing was lost but time" two lines above the
  // "Charges spent" row that contradicts it is the kind of small dishonesty
  // that makes a player stop trusting the rest of the screen.
  const firedSomething = (applied?.boostersConsumed ?? []).some((b) => (b.count ?? 0) > 0);
  return {
    title: RESULTS.loss,
    body: firedSomething ? RESULTS.lossBodySpent : RESULTS.lossBody,
  };
}

/**
 * WHY the battle ended the way it did — one sentence, or null on a win.
 *
 * The screen showed four to seven stat rows and nothing causal: no "your siege
 * stalled", no "the gate needed more territory", no "you were out-fought at the
 * wall". Every fact needed for the three statements below is already in the
 * outcome the screen is holding, so this needed no contract field and no new
 * observation — which is also the constraint that keeps it honest.
 *
 * IT ONLY SAYS WHAT IT CAN PROVE. Each branch is a certainty, not a diagnosis:
 *
 *  - A `loss` is one of exactly two things (battle/sim.js): the camp changed
 *    hands, or the player held nothing and had nothing in flight. `sitesHeld`
 *    tells them apart.
 *  - A `timeout` either finished below the castle gate or it did not, and that
 *    is decidable, because on any outcome the player did not WIN they do not
 *    hold the castle — so `sitesHeld` is exactly their non-castle count and
 *    `sitesTotal - 1` is exactly the non-castle total. That ratio IS
 *    `battle/siteinfo.js siteControlFraction`, the same number `castleSealed`
 *    compares against, rather than an approximation of it.
 *
 * There is deliberately no "you were out-fought" branch: casualties do not say
 * who was winning, and a sentence that guesses is worse than no sentence. A
 * retreat gets none either — the player knows why they left.
 *
 * @param {object} outcome BattleOutcome
 * @param {object|null} config the BattleConfig it was fought under; the gate
 *   is read from here rather than from the region table, so an incursion
 *   mutator that moved it is reflected.
 * @returns {string|null}
 */
export function resultReason(outcome, config) {
  const r = outcome?.result;
  if (r === 'win' || r === 'retreat') return null;
  const held = outcome.stats?.sitesHeld ?? 0;
  const total = outcome.stats?.sitesTotal ?? 0;
  if (r === 'loss') return held > 0 ? RESULTS.whyCampFell : RESULTS.whySweptAway;
  if (r !== 'timeout') return null;

  const need = config?.rules?.castleGateFrac ?? 0;
  // No gate on this region, or a board with nothing but a castle on it: there
  // is no territory claim to make, so make none — and `whyNoGate` is what
  // making none sounds like. This branch used to return `whyClockOnly`, whose
  // text is "the countryside was yours and the gate was open", which is a
  // positive territorial claim and was therefore exactly the thing the comment
  // above forbids. Five regions ship `castleGateFrac: 0` — all of tier 1 plus
  // kaldan — so every timeout on them printed it regardless of the ground held;
  // reproduced at 3 of 11 sites and at 2 of 18.
  if (need <= 0 || total <= 1) return RESULTS.whyNoGate;
  const frac = held / (total - 1);
  return frac < need
    ? RESULTS.whyGateHeld(percent(frac), percent(need))
    : RESULTS.whyClockOnly;
}

/**
 * The stat block, as `[label, value, kind]` where kind is `fact` or `payoff`.
 *
 * THE THIRD ELEMENT EXISTS BECAUSE THE CARD USED TO CHOOSE ITS HERO FIGURE BY
 * POSITION. `results.css` styled `dd:last-of-type` gold at display weight —
 * right on a win, where the last row is the income the victory bought, and
 * wrong on the other three outcomes, where the last row is ENEMY LOSSES. So a
 * Defeat card's brightest, largest number was a casualty count, and a
 * withdrawal's was `0`. Screenshotted on all four; the same defect
 * `prebattle.css` shipped as `dd:first-of-type` one release earlier, in the
 * sibling stylesheet, found the same way.
 *
 * The stylesheet already carried `dd[data-stat='payoff']` — the meaning-based
 * selector was written for exactly this and **nothing in the tree ever emitted
 * `data-stat`**, so the positional fallback was doing all the work. This is the
 * wiring it was waiting for.
 *
 * Rows stay ARRAYS with the kind appended rather than becoming objects: four
 * existing assertions across two suites index `r[0]` and `r[1]`, and an extra
 * element leaves every one of them true.
 */
export function statRows(outcome, applied, before, after) {
  const rows = [
    ['Duration', duration(outcome.durationMs / 1000) + (applied?.newBest ? ' — best yet' : ''), 'fact'],
    ['Sites held', `${outcome.stats.sitesHeld} / ${outcome.stats.sitesTotal}`, 'fact'],
    ['Units lost', integer(outcome.stats.unitsLost), 'fact'],
    ['Enemy losses', integer(outcome.stats.unitsKilled), 'fact'],
  ];
  const spent = applied?.boostersConsumed ?? [];
  if (spent.length) {
    // A COST, so it is a fact rather than a payoff — it is the one row that
    // could plausibly be mistaken for one, and putting it in the gains list
    // would have the card congratulate a player on what a defeat charged them.
    rows.push(['Charges spent', spent.map((b) => `${b.count} ${b.id}`).join(', '), 'fact']);
  }
  // THE CROWNS ROW IS GATED ON THE PAYOUT, NOT ON THE RESULT, and that is the
  // same rule the headline follows. It used to sit inside `result === 'win'`,
  // which was true right up until a timeout could pay: a battle the player led
  // credited 33 crowns and the screen said nothing, so the one place the new
  // rule announces itself was the one place it could not. Driven in a real
  // browser — the copy read "You held the field" over a stat block with no
  // Crowns row in it. `applied.crowns` is nonzero only on a win or a held
  // field, so this cannot over-report.
  if (applied?.crowns) rows.push(['Crowns', `+${compact(applied.crowns)}`, 'payoff']);
  if (outcome.result === 'win') {
    // Only ever on a first conquest or a cleared rung, so its presence is
    // itself the news: a raid on ground you already hold never shows this row.
    if (applied?.relics) rows.push([UI.relics, `+${applied.relics}`, 'payoff']);
    if (after > before) rows.push([UI.income, `${rate(before)} → ${rate(after)}`, 'payoff']);
  }
  if (applied?.incursion) rows.push(['Depth', `${applied.incursion.depth}`, 'fact']);
  return rows;
}


/**
 * WHICH ACTION THE CARD LEADS WITH — `'retry'` or `'map'`.
 *
 * `To the map` used to be `.btn.primary`, first in the row, and therefore the
 * one `enter()` focuses, on every outcome. So a Defeat card read "Change your
 * expedition and try again" over a filled button that LEAVES, with the action
 * the sentence names sitting beside it in the secondary style and Enter bound
 * to the wrong one. Screenshotted on all four outcomes.
 *
 * Pure and here rather than inside the scene for the reason `recruitOffer`,
 * `offlineNotice` and `stalemateCheck` are: a rule about which button matters
 * is testable with no DOM, and a rule buried in a DOM builder is not.
 *
 * A RETREAT DELIBERATELY LEADS WITH THE MAP. The copy gives a player who
 * withdrew no instruction to reverse — they chose to leave — so pressing them
 * to go straight back in would be the same disagreement pointing the other
 * way. Only a defeat and a timeout tell you to try again.
 *
 * The incursion ladder is decided by the caller, not here: a rung leads with
 * its own depth button win or lose, which is a fact about the ladder rather
 * than about the outcome.
 */
export const actionOrder = (outcome) => (
  outcome?.result === 'loss' || outcome?.result === 'timeout' ? 'retry' : 'map');
