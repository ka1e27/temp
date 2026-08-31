// TWO BEATS THE GAME COMPUTED AND THEN SWALLOWED.
//
// `meta/milestones.js` derives twenty named thresholds off `meta.stats` every
// time anything asks, and nothing announced one: you crossed your thousandth
// kill and found out only if you later thought to open Menu -> Record, where an
// honour earned a second ago is pixel-identical to one from three campaigns
// back. And `WORLD.frontOpened` — "A new front has opened:" — had ZERO readers
// in the whole tree, while `refreshUnlocks` returned the newly-opened ids on
// every conquest and `worldmap.js` silently redrew the board, so a region's
// neighbours stopped reading "???" with no comment of any kind.
import test from 'node:test';
import assert from 'node:assert/strict';

import { earnedHonourIds, honoursSince } from '../src/screens/results.js';
import { HONOURS } from '../src/content/milestones.data.js';
import { WORLD } from '../src/content/strings.js';
import { readFileSync } from 'node:fs';

/** The cheapest honour in the table, so a fixture can cross exactly one. */
const cheapest = [...HONOURS].sort((a, b) => a.need - b.need)[0];
const statsWith = (n) => ({ [cheapest.stat]: n });

test('an honour crossed by this battle is reported, and only once', () => {
  const before = earnedHonourIds(statsWith(cheapest.need - 1));
  const crossed = honoursSince(before, statsWith(cheapest.need));
  assert.ok(crossed.some((r) => r.id === cheapest.id),
    `crossing ${cheapest.stat} ${cheapest.need - 1} -> ${cheapest.need} reported nothing`);

  // ...and it is NOT reported again on the next battle, which is the whole
  // reason the snapshot is a set of ids rather than a count.
  const after = earnedHonourIds(statsWith(cheapest.need));
  assert.deepEqual(honoursSince(after, statsWith(cheapest.need + 5)).map((r) => r.id), [],
    'an honour already standing was announced a second time');
});

test('NEGATIVE CONTROL: a battle that crosses nothing announces nothing', () => {
  const before = earnedHonourIds(statsWith(cheapest.need - 3));
  assert.deepEqual(honoursSince(before, statsWith(cheapest.need - 2)), [],
    'progress short of a threshold was announced as an honour');
  // And standing still reports nothing either.
  assert.deepEqual(honoursSince(before, statsWith(cheapest.need - 3)), []);
});

test('the honour rows carry what the screen prints', () => {
  const before = earnedHonourIds(statsWith(cheapest.need - 1));
  const [row] = honoursSince(before, statsWith(cheapest.need));
  assert.equal(typeof row.title, 'string');
  assert.ok(row.title.length, 'an honour with no title renders an empty card');
  assert.equal(typeof row.note, 'string');
  assert.ok(row.note.length);
});

test('the front-opened line is no longer dead copy', () => {
  // It existed, was correct, and had no reader anywhere for the life of the
  // feature. This asserts the string is reachable from the screen that shows
  // it — the same guard tests/offlinenotice.test.js applies to the IDLE block.
  assert.ok(WORLD.frontOpened && WORLD.frontOpened.length);
  const src = readFileSync(new URL('../src/screens/results.js', import.meta.url), 'utf8');
  assert.match(src, /WORLD\.frontOpened/,
    'results.js stopped naming WORLD.frontOpened — the copy is dead again');
});
