// THE JOIN BETWEEN THE TUTORIAL'S TWO HALVES.
//
// Split out of ./coach.test.js for the 400-line cap. Everything in that file
// asks whether a COACH line reaches a BEAT — the fix for "half the tutorial was
// written and never shown". These two ask the next question, which is where the
// bug moved to: whether the beat's own predicate can ever see a true value.
import test from 'node:test';
import assert from 'node:assert/strict';

import { BEATS, COACH_REGION, readSignals, emptyLatch } from '../src/ui/coach.js';
import { createMeta } from '../src/core/store.js';

test('every signal a beat asks about is one readSignals actually publishes', () => {
  // THE JOIN, which is the half nothing was checking. `tests/coach.test.js`
  // already fails if a COACH line reaches no BEAT — that was the fix for "half
  // the tutorial was written and never shown". It did not ask the next
  // question, and the next question was where the bug moved to: three signals
  // (`tookStronghold`, `siegeStalled`, `lostSite`) were latched by `noteEvent`,
  // read by three beats' `when`, and dropped on the floor by `readSignals`. So
  // the training tip, the stalled-siege tip and the retreat tip could not fire
  // in any battle at any time, and every assertion in this file passed.
  //
  // Read off the PREDICATE rather than a list, by handing it a proxy that
  // records what it is asked for — a hand-maintained list of signal names would
  // be a third place to forget one.
  const published = new Set(Object.keys(readSignals({ latch: emptyLatch() })));
  const latched = new Set(Object.keys(emptyLatch()));
  for (const beat of BEATS) {
    const asked = new Set();
    const probe = new Proxy({}, {
      get(_, k) { if (typeof k === 'string') asked.add(k); return undefined; },
    });
    try { beat.when(probe); } catch { /* a predicate may deref; the reads still landed */ }
    for (const name of asked) {
      assert.ok(published.has(name),
        `beat "${beat.id}" gates on signals.${name}, which readSignals never returns — `
        + `it can never fire${latched.has(name) ? ' (the latch tracks it; only the publish is missing)' : ''}`);
    }
  }
});

test('the three re-published signals really do reach their beats', () => {
  // The negative control for the test above: `published.has(name)` would be
  // satisfied by a key whose value is hardcoded false, which is what a "fix"
  // that only widened the object would look like.
  const meta = createMeta();
  for (const [field, id] of [['tookStronghold', 'strongholdTaken'],
    ['siegeStalled', 'siegeStalled'], ['lostSite', 'retreat']]) {
    const latch = { ...emptyLatch(), started: true, [field]: true };
    const s = readSignals({ battle: { regionId: COACH_REGION }, meta, latch });
    assert.equal(s[field], true, `${field} is published but never true`);
    const beat = BEATS.find((b) => b.id === id);
    assert.equal(beat.when(s), true, `${id} still refuses to fire on its own signal`);
  }
});
