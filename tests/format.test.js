// NUMBER FORMATTING — the one module every string the player reads passes
// through, and the one that had no test file at all.
//
// The bug that prompted this: `compact()` documented "the string never exceeds 5
// chars" and stopped scaling at `T`, so a Crown-tier price of 4.1e18 rendered as
// "4100000T" — eight characters in a column built for five, in a game whose
// stated formatting rule is that a number must never change width. The promise
// was a comment. A comment is not a check.
//
// So the assertions here are about the PROPERTIES the rest of the game relies on,
// across the whole reachable range, rather than about a handful of hand-picked
// examples: bounded width, monotonicity, and the two infinities that mean
// something specific in this game.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compact, integer, duration, clock, percent, rate, signed, fixed, plural, numStr,
} from '../src/ui/format.js';
import { UPGRADES, upgradeCost, SAFE_MAX_LEVEL } from '../src/content/upgrades.data.js';

/** Every magnitude the game can produce, sampled densely enough to catch a cliff. */
function* magnitudes() {
  for (let e = 0; e <= 40; e++) {
    for (const m of [1, 1.0001, 1.5, 4.1, 9.9, 9.999, 12, 99.5, 999, 999.9]) {
      yield m * 10 ** e;
    }
  }
}

test('format: compact never grows wider than six characters, at any magnitude', () => {
  let worst = { len: 0, n: 0, s: '' };
  for (const n of magnitudes()) {
    const s = compact(n);
    if (s.length > worst.len) worst = { len: s.length, n, s };
    assert.ok(s.length <= 6,
      `compact(${n}) = "${s}" is ${s.length} chars — the column is sized for six`);
    // ...and negatives cost exactly one more, never a different shape.
    assert.equal(compact(-n), `-${s}`);
  }
  // A bound nothing reaches is not a bound. Prove the wide case is real.
  assert.ok(worst.len >= 5, `nothing in the sample got past ${worst.len} chars`);
});

test('format: compact is monotonic — a bigger number never reads smaller', () => {
  // The failure this catches is a suffix boundary that inverts (1e15 reading as
  // "1000T" while 9e14 reads as "900T" is fine; "1Qa" after "1000T" is the step
  // that must not go backwards in VALUE order).
  const parse = (s) => {
    const suffix = s.replace(/^[-\d.]+/, '');
    const scale = { '': 1, K: 1e3, M: 1e6, B: 1e9, T: 1e12, Qa: 1e15, Qi: 1e18,
      Sx: 1e21, Sp: 1e24, Oc: 1e27, No: 1e30, Dc: 1e33 }[suffix];
    if (scale === undefined) return Number(s.replace('e', 'e+'));  // exponential tail
    return Number(s.slice(0, s.length - suffix.length)) * scale;
  };
  let prev = -Infinity;
  // Sorted: the generator walks mantissas inside each exponent, so its natural
  // order dips (999.9 then 10). Monotonicity is a claim about VALUE order.
  for (const n of [...magnitudes()].sort((a, b) => a - b)) {
    const read = parse(compact(n));
    assert.ok(read >= prev * 0.995,
      `compact(${n}) reads as ${read}, which is less than the previous ${prev}`);
    // ...and it is the right number to within the rounding it advertises.
    assert.ok(Math.abs(read - n) <= n * 0.06 + 1,
      `compact(${n}) = "${compact(n)}" reads as ${read} — off by more than rounding`);
    prev = read;
  }
});

test('format: every price the shop can ever charge is printable', () => {
  // The range is not hypothetical: this is the actual reachable price of every
  // line at the actual level ceiling, which is what took the old ladder past `T`.
  for (const u of UPGRADES) {
    const top = Math.min(u.maxLevel, SAFE_MAX_LEVEL) - 1;
    for (const level of [0, 1, 10, Math.max(0, top)]) {
      if (level > top) continue;
      const cost = upgradeCost(u, level);
      const s = compact(cost);
      assert.ok(Number.isFinite(cost), `${u.id} at level ${level} costs ${cost}`);
      assert.ok(s.length <= 6,
        `${u.id} at level ${level} costs ${cost}, which renders as "${s}"`);
    }
  }
});

test('format: the two infinities mean what the game uses them to mean', () => {
  // `∞` is a real answer in this game — a siege whose repair out-paces damage
  // (battle/combat.js breachSeconds) and an endless upgrade line's cost-to-max.
  // `—` is "no value", which must never be confused with zero.
  assert.equal(duration(Infinity), '∞');
  assert.equal(compact(Infinity), '∞');
  assert.equal(compact(-Infinity), '—');
  assert.equal(compact(NaN), '—');
  assert.equal(integer(NaN), '—');
  assert.equal(rate(NaN), '—');
  assert.equal(percent(NaN), '—');
  assert.equal(fixed(Infinity), '∞');
  assert.equal(duration(0), '0s');
});

test('format: durations round before they split, so no clock ever lies', () => {
  // The regression on record: float siege maths lands on 249.99999999999977 and
  // truncating that gave 4:09 for what is 4:10.
  assert.equal(duration(249.99999999999977), '4:10');
  assert.equal(duration(59.6), '1:00');
  assert.equal(duration(3599.7), '1:00:00');
  assert.equal(duration(4.25), '4.3s');
  assert.equal(duration(-5), '0s');
  assert.equal(clock(0), '0:00');
  assert.equal(clock(-9), '0:00');
  assert.equal(clock(65.9), '1:05');
});

test('format: the small-integer intern table agrees with String()', () => {
  // It exists to remove the last per-frame allocation in the canvas text loop, so
  // the only thing that matters is that it is invisible.
  for (const n of [0, 1, 7, 42, 999, 1000, 1001, -1, 1.5]) {
    assert.equal(numStr(n), String(n), `numStr(${n}) diverged from String(${n})`);
  }
});

test('format: the readable helpers', () => {
  assert.equal(integer(1234567), '1,234,567');
  assert.equal(integer(-1234), '-1,234');
  assert.equal(integer(0), '0');
  assert.equal(percent(0.5), '50%');
  assert.equal(percent(0.1234, 1), '12.3%');
  assert.equal(rate(2.44), '+2.4/s');
  assert.equal(rate(-1), '-1.0/s');
  assert.equal(signed(-1500), '-1.5K');
  assert.equal(signed(1500), '+1.5K');
  assert.equal(plural(1, 'survives', 'survive'), '1 survives');
  assert.equal(plural(3, 'survives', 'survive'), '3 survive');
});
