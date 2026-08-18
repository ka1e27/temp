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
    RESULTS.whyClockOnly);
  assert.equal(resultReason(outcome({ stats: { sitesHeld: 1, sitesTotal: 11 } }), null),
    RESULTS.whyClockOnly);
});

test('a board of one site makes no territory claim rather than dividing by zero', () => {
  assert.equal(resultReason(outcome({ stats: { sitesHeld: 0, sitesTotal: 1 } }), cfg(0.6)),
    RESULTS.whyClockOnly);
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
