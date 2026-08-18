// WHY the battle ended, and the arithmetic that has to agree with the sim.
//
// The results screen showed four to seven stat rows and nothing causal — no
// "your siege stalled", no "the gate needed more territory". Every fact the
// three statements need is already in the outcome the screen is holding, so
// this needed no contract field; the constraint that keeps it honest is that it
// may only say what it can PROVE.
//
// The load-bearing test is the last one. `resultReason` derives the player's
// territory share as `sitesHeld / (sitesTotal - 1)` and compares it against the
// castle gate — and that is only equal to `battle/siteinfo.js
// siteControlFraction`, the number `castleSealed` actually compares, because on
// any outcome the player did not WIN they do not hold the castle. A second
// implementation of "how much of the map is theirs" that drifts from the sim's
// is exactly the class of defect this project keeps finding, so the two are
// pinned against each other on a real battle state rather than argued about.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resultReason } from '../src/screens/results.js';
import { RESULTS } from '../src/content/strings.js';
import { createBattleState, sitesOwned } from '../src/battle/state.js';
import { siteControlFraction } from '../src/battle/siteinfo.js';
import { makeMods, CONTRACT_VERSION } from '../src/battle/contract.js';
import { emptyComp } from '../src/battle/combat.js';

const outcome = (o) => ({
  result: 'timeout',
  stats: { sitesHeld: 5, sitesTotal: 11, unitsLost: 0, unitsKilled: 0 },
  ...o,
});
const cfg = (gate) => ({ rules: { castleGateFrac: gate } });

test('a win explains nothing — the title already did', () => {
  assert.equal(resultReason(outcome({ result: 'win' }), cfg(0.6)), null);
});

test('a withdrawal explains nothing — the player knows why they left', () => {
  assert.equal(resultReason(outcome({ result: 'retreat' }), cfg(0.6)), null);
});

test('a loss names which of the two loss conditions fired', () => {
  // battle/sim.js has exactly two: the camp changed hands, or the player held
  // nothing at all with nothing in flight. `sitesHeld` tells them apart, so
  // neither branch is a guess.
  assert.equal(
    resultReason(outcome({ result: 'loss', stats: { sitesHeld: 4, sitesTotal: 11 } }), cfg(0.6)),
    RESULTS.whyCampFell);
  assert.equal(
    resultReason(outcome({ result: 'loss', stats: { sitesHeld: 0, sitesTotal: 11 } }), cfg(0.6)),
    RESULTS.whySweptAway);
});

test('a timeout below the gate says so, and quotes both numbers', () => {
  // 5 of 10 non-castle sites is 50%, against a 60% gate.
  const said = resultReason(outcome({ stats: { sitesHeld: 5, sitesTotal: 11 } }), cfg(0.6));
  assert.match(said, /gate held/i);
  assert.match(said, /50%/);
  assert.match(said, /60%/);
});

test('a timeout AT or above the gate blames the clock, not the countryside', () => {
  // 6 of 10 is exactly the gate — `castleSealed` seals on `<`, so this is open.
  assert.equal(resultReason(outcome({ stats: { sitesHeld: 6, sitesTotal: 11 } }), cfg(0.6)),
    RESULTS.whyClockOnly);
  assert.equal(resultReason(outcome({ stats: { sitesHeld: 9, sitesTotal: 11 } }), cfg(0.6)),
    RESULTS.whyClockOnly);
});

test('a region with no gate never claims one held', () => {
  // Riverfen ships `castleGateFrac: 0`, where `castleSealed` returns false
  // outright. Saying "the gate held" there would be the same defect the coach
  // pair was just split to fix.
  assert.equal(resultReason(outcome({ stats: { sitesHeld: 1, sitesTotal: 11 } }), cfg(0)),
    RESULTS.whyNoGate);
  assert.equal(resultReason(outcome({ stats: { sitesHeld: 1, sitesTotal: 11 } }), null),
    RESULTS.whyNoGate);
});

test('...AND IT MAKES NO TERRITORIAL CLAIM EITHER, which is the bug this caught', () => {
  // THIS TEST USED TO ENCODE THE DEFECT. The no-gate branch returned
  // `whyClockOnly` — "The countryside was yours and the gate was open" — which
  // is a positive claim about ground held, in the branch whose own comment says
  // to make none. Five regions ship no gate (all of tier 1 plus kaldan), so
  // every timeout on them printed it however little the player held: reproduced
  // at 3 of 11 sites and at 2 of 18.
  //
  // Asserting the branch equals a named constant could never catch that, because
  // the constant was the wrong one. So this asserts the PROPERTY: whatever the
  // no-gate line says, it must not tell a player who held 12% of the map that
  // the countryside was theirs.
  for (const held of [0, 1, 3, 9]) {
    const said = resultReason(outcome({ stats: { sitesHeld: held, sitesTotal: 11 } }), cfg(0));
    assert.doesNotMatch(said, /countryside was yours/i,
      `held ${held}/11 and was told the countryside was theirs`);
    // Naming the ABSENCE of a gate is fine and is the point of the line — what
    // it may not do is report one as satisfied, which is the claim the old
    // string smuggled in.
    assert.doesNotMatch(said, /gate (held|was open)/i,
      'a region with no gate must not report one as held or open');
  }
});

test('a board of one site makes no territory claim rather than dividing by zero', () => {
  assert.equal(resultReason(outcome({ stats: { sitesHeld: 0, sitesTotal: 1 } }), cfg(0.6)),
    RESULTS.whyNoGate);
});

test('the CLEARED-gate line still says the countryside was yours, because it was', () => {
  // The negative control for the test above: `whyClockOnly` is correct where it
  // was always correct — a real gate, genuinely satisfied, and the clock beat
  // the throne. Losing that claim would be over-correcting.
  const said = resultReason(outcome({ stats: { sitesHeld: 9, sitesTotal: 11 } }), cfg(0.6));
  assert.equal(said, RESULTS.whyClockOnly);
  assert.match(said, /countryside was yours/i);
});

test('the gate is read off the BATTLE, so an incursion mutator is reflected', () => {
  // `sealed` raises `castleGateFrac` on a rung. Reading the region table
  // instead would quote the campaign's gate at a battle that was not fought
  // under it.
  const said = resultReason(outcome({ stats: { sitesHeld: 5, sitesTotal: 11 } }), cfg(0.9));
  assert.match(said, /90%/);
});

// ---------------------------------------------------------------------------
// ...and it is the SIM's fraction, not a lookalike
// ---------------------------------------------------------------------------

test('sitesHeld / (sitesTotal - 1) IS siteControlFraction when the castle is not held', () => {
  const state = createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: 'why', seed: 1,
    grid: { cols: 13, rows: 9, blocked: [] },
    sites: [
      { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 8 }, hp: 480, hpMax: 480 },
      { id: 'pf1', kind: 'farm', hex: [2, 0], owner: 'player', garrison: {}, hp: 100, hpMax: 100 },
      { id: 'pf2', kind: 'farm', hex: [3, 0], owner: 'player', garrison: {}, hp: 100, hpMax: 100 },
      { id: 'nf1', kind: 'farm', hex: [4, 0], owner: 'neutral', garrison: {}, hp: 100, hpMax: 100 },
      { id: 'ef1', kind: 'farm', hex: [6, 0], owner: 'enemy', garrison: {}, hp: 100, hpMax: 100 },
      { id: 'castle', kind: 'castle', hex: [8, 0], owner: 'enemy', garrison: { militia: 20 }, hp: 900, hpMax: 900 },
    ],
    adjacency: [],
    player: makeMods({ expedition: emptyComp() }),
    enemy: makeMods({ expedition: emptyComp() }),
    boosters: [],
    rules: { victory: 'capture-castle', hardCapMs: 600000, aiTier: 1, castleGateFrac: 0.6 },
  });

  const held = sitesOwned(state, 'player').length;
  const total = state.sites.length;
  assert.equal(held, 3, 'camp plus two farms, and no castle');

  // The screen's derivation and the sim's own must be the same number.
  assert.equal(held / (total - 1), siteControlFraction(state, 'player'));

  // And the sentence it produces agrees with what `castleSealed` would decide:
  // 3/5 is 60%, exactly the gate, so the gate is OPEN and the reason must be
  // the clock rather than the territory.
  assert.equal(siteControlFraction(state, 'player'), 0.6);
  assert.equal(
    resultReason({ result: 'timeout', stats: { sitesHeld: held, sitesTotal: total } },
      { rules: state.rules }),
    RESULTS.whyClockOnly);
});

// ---------------------------------------------------------------------------
// A loss costs time AND whatever you fired
// ---------------------------------------------------------------------------

import { resultCopy } from '../src/screens/results.js';

test('"nothing was lost but time" only when nothing WAS spent', () => {
  // `applyOutcome` calls `consumeBoosters` unconditionally, before the win/loss
  // branch, and `boosters.js consume()` has no refund path — so a charge fired
  // into a battle you go on to lose is gone, and a charge costs 1-3 RELICS, the
  // currency a raid never pays. The headline sentence overclaimed directly above
  // the "Charges spent" row that contradicted it.
  const lost = { result: 'loss', stats: { sitesHeld: 2, sitesTotal: 11 } };

  const clean = resultCopy(lost, { boostersConsumed: [] }, { name: 'Riverfen' });
  assert.match(clean.body, /Nothing was lost but time/);

  const spent = resultCopy(lost, { boostersConsumed: [{ id: 'rally', count: 1 }] },
    { name: 'Riverfen' });
  assert.doesNotMatch(spent.body, /Nothing was lost but time/,
    'a fired charge is a real cost and the copy may not deny it');
  assert.match(spent.body, /charges you fired are spent/i);
});

test('a zero-count entry is not a spend', () => {
  // `boostersConsumed` is built by filtering on `used > 0`, so this should not
  // arise — but a copy branch that flips on the ARRAY rather than on the counts
  // would be wrong the moment that filter changed.
  const lost = { result: 'loss', stats: { sitesHeld: 2, sitesTotal: 11 } };
  const c = resultCopy(lost, { boostersConsumed: [{ id: 'rally', count: 0 }] }, null);
  assert.match(c.body, /Nothing was lost but time/);
});

test('a missing applied summary does not crash the loss screen', () => {
  const lost = { result: 'loss', stats: { sitesHeld: 0, sitesTotal: 11 } };
  for (const applied of [null, undefined, {}]) {
    assert.match(resultCopy(lost, applied, null).body, /Nothing was lost but time/);
  }
});

test('a WIN with charges spent is untouched — this is the loss copy only', () => {
  const won = { result: 'win', stats: { sitesHeld: 11, sitesTotal: 11 } };
  const c = resultCopy(won, { boostersConsumed: [{ id: 'rally', count: 2 }] },
    { name: 'Riverfen' });
  assert.match(c.title, /Riverfen is yours/);
  assert.doesNotMatch(c.body, /charges you fired/i);
});
