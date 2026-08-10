// THE TROOP-TYPE CAP, and the two things it must not break.
//
// The roster reached eight and the loadout screen became a spreadsheet. A cap on
// how many DIFFERENT troops one expedition carries turns "a bit of everything"
// — which is both the dullest army and, because the specialists are share-scaled
// like `counters`, the weakest — back into a decision.
//
// Two properties are load-bearing and neither is obvious:
//
//   1. THE DEFAULT SPREAD MUST NOT MOVE. It is four types, and every win rate in
//      regions.data.js is measured against it. A cap that trimmed it would
//      silently re-tune all twenty-one regions.
//   2. THE BUDGET MUST STILL BE SPENDABLE. Leftover slots normally go to militia,
//      and an army at the cap that does not contain militia cannot take any — so
//      the remainder has to fall back to the cheapest type already present
//      rather than minting a sixth or quietly evaporating.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  distributeExpedition, fitComposition, carryComposition, nudgeComposition,
  canNudge, typeCount, canAddType, compositionSlots, zeroComposition,
} from '../src/meta/composition.js';
import { UNIT_IDS, UNIT_SLOTS, LOADOUT_TYPES_MAX } from '../src/content/balance.js';
import { DEFAULT_COMPOSITION_WEIGHTS } from '../src/content/upgrades.data.js';

const ALL = UNIT_IDS;
const evenWeights = Object.fromEntries(UNIT_IDS.map((u) => [u, 1]));
const named = (comp) => UNIT_IDS.filter((u) => (comp[u] || 0) > 0);

// ---------------------------------------------------------------------------
// The cap itself
// ---------------------------------------------------------------------------

test('cap: no entry point can produce more troop types than the cap allows', () => {
  // Every path into a composition, not just the screen's. A hand-edited params
  // object and a stale save have to land on the same ceiling as the +/- buttons,
  // which is why the rule lives in composition.js rather than in the UI.
  const budgets = [12, 30, 60, 140, 400];
  for (const slots of budgets) {
    const cases = {
      distribute: distributeExpedition(slots, ALL, evenWeights),
      fit: fitComposition(slots, ALL, Object.fromEntries(UNIT_IDS.map((u) => [u, 5]))),
      carry: carryComposition(slots, ALL, Object.fromEntries(UNIT_IDS.map((u) => [u, 3]))),
    };
    for (const [how, comp] of Object.entries(cases)) {
      assert.ok(typeCount(comp) <= LOADOUT_TYPES_MAX,
        `${how} at ${slots} slots produced ${typeCount(comp)} types: ${named(comp)}`);
    }
  }
});

test('cap: NEGATIVE CONTROL — an army under the cap is left completely alone', () => {
  // Without this the test above would pass just as well if the cap trimmed
  // everything to one type, or to nothing at all.
  const three = { militia: 10, raiders: 4, rams: 2 };
  const fitted = fitComposition(compositionSlots(three), ALL, three);
  assert.deepEqual(named(fitted), ['militia', 'raiders', 'rams']);
  assert.equal(typeCount(fitted), 3);
  assert.ok(canAddType(fitted), 'a three-type army must have room for more');
});

test('cap: the default spread is untouched, so no region is re-tuned', () => {
  // The load-bearing one. `distributeExpedition` with the default weights is the
  // army every balance number in regions.data.js was measured against.
  assert.ok(Object.values(DEFAULT_COMPOSITION_WEIGHTS).filter((w) => w > 0).length
    <= LOADOUT_TYPES_MAX, 'the default weights themselves now exceed the cap');
  for (const slots of [19, 60, 137, 260]) {
    const comp = distributeExpedition(slots, ALL);
    assert.deepEqual(named(comp), ['militia', 'spearmen', 'raiders', 'rams'],
      `the default spread changed at ${slots} slots`);
    assert.equal(compositionSlots(comp), slots, `default spread left slots unspent at ${slots}`);
  }
});

test('cap: one discretionary slot on top of the default is the whole point', () => {
  // Four staples plus one specialist has to fit, or the cap would mean "you may
  // never bring a specialist without first giving up a staple", which is a
  // different and much worse rule.
  for (const specialist of ['outriders', 'halberds', 'sappers']) {
    const comp = distributeExpedition(80, ALL, { ...DEFAULT_COMPOSITION_WEIGHTS, [specialist]: 0.3 });
    assert.ok((comp[specialist] || 0) > 0, `${specialist} did not survive the cap`);
    assert.equal(typeCount(comp), 5);
  }
});

// ---------------------------------------------------------------------------
// The budget stays spendable
// ---------------------------------------------------------------------------

test('cap: an army at the cap without militia still spends what it can', () => {
  // The ballast is militia. An army at the cap that does not contain any cannot
  // take a militia for the remainder without minting a sixth type — so the
  // leftover has to go to the cheapest type ALREADY present.
  const noMilitia = { spearmen: 4, outriders: 4, raiders: 4, halberds: 2, sappers: 2 };
  const comp = fitComposition(120, ALL, noMilitia);
  assert.equal(comp.militia, 0, 'the cap was broken by the ballast');
  assert.ok(typeCount(comp) <= LOADOUT_TYPES_MAX);
  // Spendable to within one unit of the cheapest type present — 2 slots here,
  // because a spearman is the cheapest thing this army is allowed to buy.
  const cheapest = Math.min(...named(comp).map((u) => UNIT_SLOTS[u]));
  assert.ok(120 - compositionSlots(comp) < cheapest,
    `${120 - compositionSlots(comp)} slots stranded with a ${cheapest}-slot cheapest unit`);
});

test('cap: trimming keeps what the player committed the most SLOTS to', () => {
  // Bodies would be the wrong measure: 30 militia is 30 slots and 6 rams is 30,
  // and the rams are far more obviously a decision. A save written before the
  // cap existed is trimmed, not rejected.
  const eight = {
    militia: 1, spearmen: 1, outriders: 1, raiders: 1,
    halberds: 4, sappers: 4, rams: 4, marshal: 4,
  };
  const comp = carryComposition(200, ALL, eight);
  assert.ok(typeCount(comp) <= LOADOUT_TYPES_MAX);
  for (const kept of ['halberds', 'sappers', 'rams']) {
    assert.ok((comp[kept] || 0) > 0, `${kept} was 16-20 slots of intent and got dropped`);
  }
  // The marshal is never in a composition at all — one rides free, outside the
  // budget — so he cannot consume a type slot however he is asked for.
  assert.equal(comp.marshal, 0);
});

// ---------------------------------------------------------------------------
// The +/- control
// ---------------------------------------------------------------------------

test('cap: the first of a new troop is refused at the cap, more of an old one is not', () => {
  // Only the FIRST. The cap is about breadth, not about how many of anything you
  // may bring, and a control that refused both would read as a budget bug.
  const five = distributeExpedition(90, ALL, {
    militia: 1, spearmen: 1, outriders: 1, raiders: 1, halberds: 1,
  });
  assert.equal(typeCount(five), 5);
  assert.equal(canNudge(five, 'sappers', 1, ALL, 90), false, 'a sixth type was allowed');
  assert.equal(canNudge(five, 'militia', 1, ALL, 90), true, 'more of a fielded troop was refused');
  assert.equal(canNudge(five, 'halberds', -1, ALL, 90), true, 'removing was refused');
});

test('cap: dropping a troop to zero frees the slot for a different one', () => {
  // The swap has to actually be reachable through the control, or the cap is a
  // one-way door and the first five picks are permanent.
  let comp = distributeExpedition(90, ALL, {
    militia: 1, spearmen: 1, outriders: 1, raiders: 1, halberds: 1,
  });
  assert.equal(canNudge(comp, 'sappers', 1, ALL, 90), false);
  while ((comp.halberds || 0) > 0) comp = nudgeComposition(comp, 'halberds', -1, ALL, 90);
  assert.equal(comp.halberds, 0);
  assert.ok(canNudge(comp, 'sappers', 1, ALL, 90), 'the freed type slot was not released');
  const after = nudgeComposition(comp, 'sappers', 1, ALL, 90);
  assert.ok(after.sappers > 0);
  assert.ok(typeCount(after) <= LOADOUT_TYPES_MAX);
  assert.ok(compositionSlots(after) <= 90, 'the swap went over budget');
});

test('cap: a nudge never produces an over-budget or over-cap army, at any budget', () => {
  // Fuzzed rather than argued: the +/- path has a trade-down loop and a ballast
  // fill, and both were touched by the cap.
  let comp = zeroComposition();
  const budget = 64;
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
  for (let i = 0; i < 600; i++) {
    const unit = UNIT_IDS[next() % UNIT_IDS.length];
    const delta = next() % 2 ? 1 : -1;
    comp = nudgeComposition(comp, unit, delta, ALL, budget);
    assert.ok(compositionSlots(comp) <= budget, `over budget after ${unit} ${delta}`);
    assert.ok(typeCount(comp) <= LOADOUT_TYPES_MAX, `over the cap after ${unit} ${delta}`);
    for (const u of UNIT_IDS) assert.ok(comp[u] >= 0 && Number.isInteger(comp[u]), u);
  }
});
