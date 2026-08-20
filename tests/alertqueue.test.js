// THE ONE-LINE ALERT CHANNEL, UNDER LOAD.
//
// `show()` used to replace whatever was on screen unconditionally, with a hold
// measured in wall-clock ms — while the event rate scales roughly linearly with
// SIM SPEED (measured 2 -> 5 -> 12 alert-worthy events per 3s at 1x/4x/8x). So
// at 4x several messages could arrive and be overwritten before the first could
// be read, and the channel silently dropped exactly the events a player who
// sped the game up most needs to see.
//
// Every test here drives the real `createAlert` with an injected clock, because
// the whole rule is about time and a test that could not move the clock would
// be asserting the strip's HTML instead of its behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';
// `h()` reads `document` at call time, so the shim has to be installed before
// the strip is imported — which is exactly what tests/fixtures/panelDom.js does
// as a side effect. Imported for that rather than for anything it exports.
import './fixtures/panelDom.js';

const { createAlert } = await import('../src/screens/battle-alertstrip.js');
const text = (a) => a.el.textContent;

test('a burst leaves the first message readable instead of strobing it away', () => {
  const a = createAlert({ minShowMs: 900 });
  a.show('FIRST', 0);
  assert.equal(text(a), 'FIRST');
  // Four more inside the guaranteed window, as a 4x battle produces.
  a.show('SECOND', 100);
  a.show('THIRD', 200);
  a.show('FOURTH', 300);
  a.update(400);
  assert.equal(text(a), 'FIRST', 'the first must survive its own minimum');
});

test('...and what comes up next is the NEWEST of the burst, not the oldest', () => {
  // A strict queue would show SECOND here and run minutes behind a real battle.
  // What a player needs from a burst is the latest state of the world.
  const a = createAlert({ minShowMs: 900 });
  a.show('FIRST', 0);
  a.show('SECOND', 100);
  a.show('THIRD', 200);
  a.update(900);
  assert.equal(text(a), 'THIRD');
});

test('a threat preempts immediately rather than queueing behind a click', () => {
  // The whole reason `danger` exists is to reach a player looking elsewhere.
  const a = createAlert({ minShowMs: 900 });
  a.show('not adjacent', 0);
  a.show('LOST — stronghold taken', 10, 'danger');
  assert.equal(text(a), 'LOST — stronghold taken');
});

test('an info does NOT preempt a threat, and waits its turn', () => {
  // The negative control on the rule above: a preemption rule that fired both
  // ways would let a rejected click erase the message that mattered.
  const a = createAlert({ minShowMs: 900 });
  a.show('LOST — stronghold taken', 0, 'danger');
  a.show('not adjacent', 10);
  assert.equal(text(a), 'LOST — stronghold taken');
  a.update(500);
  assert.equal(text(a), 'LOST — stronghold taken');
});

test('an identical repeat is counted, not queued', () => {
  // Three sites falling in four seconds is one line with a count, not three
  // lines nobody can read.
  const a = createAlert({ minShowMs: 900 });
  a.show('LOST — farm taken', 0, 'danger');
  a.show('LOST — farm taken', 100, 'danger');
  a.show('LOST — farm taken', 200, 'danger');
  assert.equal(text(a), 'LOST — farm taken x3');
});

test('a parked message goes up when the floor lifts, not when the ttl runs out', () => {
  // Otherwise a burst reads at a third of the rate the channel can carry.
  const a = createAlert({ minShowMs: 900, ttlMs: 2600 });
  a.show('FIRST', 0);
  a.show('SECOND', 100);
  a.update(899);
  assert.equal(text(a), 'FIRST');
  a.update(900);
  assert.equal(text(a), 'SECOND', 'the floor, not the ttl, is what gates the next line');
});

test('an unhurried message is still replaced at once — the floor is not a delay', () => {
  // THE NEGATIVE CONTROL THAT MATTERS. A minimum applied unconditionally would
  // make every ordinary message in the game land up to 900ms late.
  const a = createAlert({ minShowMs: 900 });
  a.show('FIRST', 0);
  a.show('SECOND', 5000);
  assert.equal(text(a), 'SECOND', 'past the floor, a message shows instantly');
});

test('the sticky booster line still returns when a flash expires', () => {
  const a = createAlert({ minShowMs: 900, ttlMs: 1000 });
  a.hold('AIMING RALLY — click a site');
  assert.equal(text(a), 'AIMING RALLY — click a site');
  a.show('not adjacent', 0);
  assert.equal(text(a), 'not adjacent');
  a.update(1001);
  assert.equal(text(a), 'AIMING RALLY — click a site', 'the armed booster must come back');
});

test('an empty message is ignored rather than blanking the strip', () => {
  const a = createAlert({ minShowMs: 900 });
  a.show('FIRST', 0);
  a.show('', 5000);
  assert.equal(text(a), 'FIRST');
});
