// HOW LONG THE EMPIRE KEEPS EARNING WITHOUT YOU, said BEFORE it matters.
//
// The offline cap is gated entirely on Treasury levels, so a player who never
// opens the shop sits at the eight-hour floor forever. Measured by the idle
// critic: at full conquest that is roughly 55 million crowns silently discarded
// on a single missed day — for a play style this genre's audience plainly
// contains (engage with the RTS, ignore the meta-shop).
//
// The away banner already explains the cap AFTER it has bitten
// (`IDLE.awayCapped`, shipped earlier). Nothing said what it WAS beforehand,
// and the world-map header is the last thing a player reads before closing the
// tab. This file pins the arithmetic and the one state worth flagging.
import test from 'node:test';
import assert from 'node:assert/strict';
import { offlineCapMs } from '../src/meta/upgrades.js';
import { OFFLINE } from '../src/content/upgrades.data.js';
import { UI } from '../src/content/strings.js';
import { createMeta } from '../src/core/store.js';

const HOUR = 3600_000;
const withTreasury = (n) => {
  const m = createMeta();
  m.upgrades = { ...(m.upgrades || {}), treasury: n };
  return m;
};

test('a fresh save sits at the base cap, and that is the state worth flagging', () => {
  assert.equal(offlineCapMs(createMeta()), OFFLINE.baseCapMs);
  assert.equal(OFFLINE.baseCapMs, 8 * HOUR, 'the floor the header calls out');
});

test('the cap rises with Treasury and stops at the design ceiling', () => {
  const at = (n) => offlineCapMs(withTreasury(n));
  assert.ok(at(1) > at(0), 'one level must move it or the row teaches nothing');
  assert.ok(at(4) > at(1));
  assert.equal(at(999), OFFLINE.hardMaxCapMs, 'and never past the hard ceiling');
  assert.equal(OFFLINE.hardMaxCapMs, 24 * HOUR);
});

test('the cap is monotonic, so the readout can never go BACKWARDS', () => {
  // A player who buys a level and watches the number drop would rightly stop
  // trusting the row entirely.
  let prev = 0;
  for (let n = 0; n <= 12; n++) {
    const cap = offlineCapMs(withTreasury(n));
    assert.ok(cap >= prev, `level ${n} lowered the cap`);
    prev = cap;
  }
});

test('every cap the game can reach renders as a whole number of hours', () => {
  // The header rounds to hours because nobody plans an absence to the minute,
  // and the steps are whole hours — so rounding must never produce a figure the
  // player cannot reconcile with the shop's own "+2h per level" copy.
  for (let n = 0; n <= 12; n++) {
    const hours = offlineCapMs(withTreasury(n)) / HOUR;
    assert.equal(hours, Math.round(hours), `level ${n} gives ${hours}h`);
  }
});

test('the label exists and is not the treasury it sits beside', () => {
  assert.ok(UI.offlineCap && UI.offlineCap.length > 2);
  assert.notEqual(UI.offlineCap, UI.treasury);
  assert.notEqual(UI.offlineCap, UI.income);
});
