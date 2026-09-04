// THE RESULTS CARD SAID THE SAME THING FOUR WAYS, AND EMPHASISED THE WRONG
// NUMBER ON THREE OF THEM.
//
// Driven through the real `toOutcome()`/results pipeline and screenshotted, a
// win, a loss, a timeout and a withdrawal rendered as the same 560px card with
// the same rhythm and the same stat table, differing in a 3px top edge, a tag
// word and the headline. Two concrete defects sat inside that:
//
//   1. THE HERO FIGURE WAS POSITIONAL. `results.css` styled `dd:last-of-type`
//      gold at display weight — right on a win, where the last row is the
//      income the victory bought, and wrong on the other three, where the last
//      row is ENEMY LOSSES. A Defeat card's brightest, largest number was a
//      casualty count; a Withdrawn card's was `0`. The meaning-based selector
//      `dd[data-stat='payoff']` was already in the stylesheet and NOTHING in
//      the tree emitted `data-stat`, so the fallback was doing all the work.
//      Same defect `prebattle.css` shipped as `dd:first-of-type`, in the
//      sibling file, one release earlier.
//
//   2. THE PRIMARY BUTTON CONTRADICTED THE COPY. `To the map` was `.primary`,
//      first, and focused on every outcome — so "Change your expedition and
//      try again" sat above a filled button that leaves.
//
// This file pins both as rules rather than as pixels, and its negative controls
// are the half that matters: a card that tagged EVERY row as a payoff, or one
// that led with retry everywhere, would both look fixed from outside.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { statRows, actionOrder } from '../src/screens/results.js';

const outcomeOf = (result, o = {}) => ({
  result,
  durationMs: 60_000,
  stats: { sitesHeld: 3, sitesTotal: 11, unitsLost: 40, unitsKilled: 25 },
  ...o,
});

const kindsOf = (rows) => rows.map((r) => r[2]);
const labels = (rows, kind) => rows.filter((r) => r[2] === kind).map((r) => r[0]);

test('card: every row declares a kind, and only two kinds exist', () => {
  // A row added without a kind falls out of BOTH lists and vanishes from the
  // card silently — the exact failure mode of a screen that partitions its own
  // data. Walk a payload rich enough to reach every branch.
  const rich = statRows(
    outcomeOf('win'),
    {
      crowns: 1200, relics: 3, incomePerSec: 9, newBest: true,
      boostersConsumed: [{ id: 'march', count: 1 }],
      incursion: { depth: 7 },
    },
    1, 9,
  );
  assert.ok(rich.length >= 8, `expected every branch, got ${rich.length} rows`);
  for (const row of rich) {
    assert.equal(row.length, 3, `row ${row[0]} has no kind`);
    assert.ok(row[2] === 'fact' || row[2] === 'payoff',
      `row ${row[0]} has kind "${row[2]}"`);
  }
  assert.deepEqual([...new Set(kindsOf(rich))].sort(), ['fact', 'payoff']);
});

test('card: ENEMY LOSSES is never the payoff — the regression, named', () => {
  // The specific thing that shipped. On a loss, a timeout and a retreat the
  // last row of the table is Enemy losses, and it was rendered gold at display
  // weight as though it were the prize.
  for (const result of ['win', 'loss', 'timeout', 'retreat']) {
    const rows = statRows(outcomeOf(result), { crowns: 500, incomePerSec: 0 }, 0, 0);
    const enemy = rows.find((r) => r[0] === 'Enemy losses');
    assert.ok(enemy, `no Enemy losses row on a ${result}`);
    assert.equal(enemy[2], 'fact', `Enemy losses is a payoff on a ${result}`);
  }
  // And a COST is not a gain either: charges spent is the one row that could
  // plausibly be mistaken for one, and putting it in the gains list would have
  // the card congratulate a player on what a defeat charged them.
  const spent = statRows(
    outcomeOf('loss'), { boostersConsumed: [{ id: 'march', count: 2 }] }, 0, 0);
  assert.equal(spent.find((r) => r[0] === 'Charges spent')[2], 'fact');
});

test('card: a battle that paid nothing has NO payoff rows, so the block is absent', () => {
  // This is what makes a win a different SHAPE rather than a different hue: the
  // earnings list is rendered only when it has content.
  for (const result of ['loss', 'timeout', 'retreat']) {
    const rows = statRows(outcomeOf(result), { crowns: 0, incomePerSec: 0 }, 0, 0);
    assert.deepEqual(labels(rows, 'payoff'), [],
      `a ${result} that paid nothing grew an earnings block`);
  }

  // NEGATIVE CONTROL, and the reason the rule is "paid", not "won": a timeout
  // the player LED pays crowns, and that card must show them. Gating the block
  // on `result === 'win'` is the bug this project already fixed once for the
  // Crowns row itself.
  const held = statRows(outcomeOf('timeout'), { heldField: true, crowns: 33 }, 0, 0);
  assert.deepEqual(labels(held, 'payoff'), ['Crowns']);

  // NEGATIVE CONTROL: a win with a real payout must tag all three.
  const won = statRows(outcomeOf('win'), { crowns: 1200, relics: 3, incomePerSec: 9 }, 1, 9);
  assert.equal(labels(won, 'payoff').length, 3,
    `expected crowns, relics and income, got ${labels(won, 'payoff')}`);
  // ...and must not have quietly swept the facts in with them.
  assert.ok(labels(won, 'fact').includes('Duration'));
  assert.ok(labels(won, 'fact').includes('Sites held'));
});

test('card: the lead action follows the copy, and only where the copy instructs', () => {
  // A defeat and a timeout both tell the player to change their expedition and
  // go again, so that is the filled, first, focused button.
  assert.equal(actionOrder(outcomeOf('loss')), 'retry');
  assert.equal(actionOrder(outcomeOf('timeout')), 'retry');

  // NEGATIVE CONTROLS, and they are the point. A win's next step is the map and
  // the shop. A RETREAT is the subtle one: the player chose to leave and the
  // copy gives them no instruction to reverse, so pressing them straight back
  // in would be the same disagreement pointing the other way.
  assert.equal(actionOrder(outcomeOf('win')), 'map');
  assert.equal(actionOrder(outcomeOf('retreat')), 'map');
  assert.equal(actionOrder(undefined), 'map');
});

test('card: the stylesheet keys the payoff on MEANING, not on position', () => {
  // Asserted against the source text, because this is a claim about which
  // selector exists rather than about what any fixture renders — and the
  // positional rule passed every test in the suite for as long as it shipped.
  // COMMENTS STRIPPED FIRST. The prose above `.results-gains` describes the
  // defect and names the old selector, so a raw grep matches the explanation
  // and reports the bug it is documenting — the same trap
  // `tests/marshalname.test.js` hit once, in a comment, on this same codebase.
  const raw = readFileSync(new URL('../src/styles/results.css', import.meta.url), 'utf8');
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, ' ');
  assert.ok(!/dd:last-of-type/.test(css),
    'results.css still chooses its hero figure by position');
  assert.ok(/\.results-gains/.test(css), 'the earnings list has no styling');

  // And the screen must actually emit the attribute the stylesheet keys on —
  // the original defect was a correct selector with no author.
  const js = readFileSync(new URL('../src/screens/results.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');
  assert.ok(/'data-stat'/.test(js), 'nothing emits data-stat');
});
