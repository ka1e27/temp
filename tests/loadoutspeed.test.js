// THE ARITHMETIC HALF OF THE DOMINANT-LOADOUT PIN, split off `loadoutdominance`
// at the 400-line cap — and the seam is a real one rather than a line count.
//
// Everything here is EXACT: it reads `slowestSpeed` and the unit table and
// asserts arithmetic, so it runs in milliseconds. Its sibling plays 192 real
// battles and costs half an hour. Keeping them in one file meant nobody could
// check the cheap claim without paying for the expensive one, and the cheap one
// is the claim that cannot be noise — a win rate describes whatever dial the
// campaign ships today, where the speed table is simply true.
import test from 'node:test';
import assert from 'node:assert/strict';

import { MOVEMENT, UNITS } from '../src/content/balance.js';
import { slowestSpeed } from '../src/battle/movement.js';

test('the mixed spread marches at RAM speed — true, and measured NOT to be the exploit', () => {
  // THE ARITHMETIC BELOW HAS BEEN RIGHT THROUGH TWO REWRITES OF THIS COMMENT.
  // What keeps changing is what it was thought to EXPLAIN, and the current
  // answer is: nothing. Kept, because it is the exact fact that has to stay
  // true for the disproof below to keep meaning anything.
  //
  // `slowestSpeed` is a MIN over the stack, so the default spread marches at
  // the pace of its rams -- and `MOVEMENT.hexSecondsPerSpeed` was doubled to
  // make marches read as marches, doubling that penalty in absolute seconds.
  // Measured, seconds per hex:
  //
  //     default spread   2.53   (dragged to rams, speed 30)
  //     mono spearmen    1.69   1.5x faster
  //     mono militia     1.38   1.8x faster
  //     mono raiders     0.72   3.5x faster
  //
  // THIS TEST USED TO BE TITLED "...and that is now the exploit". IT IS NOT.
  // `slowestSpeed` was replaced with the slot-weighted harmonic mean of the
  // stack's speeds -- which makes the default spread 1.6x faster (2.53 ->
  // 1.59 s/hex) and, by construction, cannot move a one-type army at all, so
  // it was the one candidate fix that could not backfire the way the three
  // militia nerfs above did. Measured at n=48 on five regions it bought the
  // default spread a net +1 point and the mono gap went 43.6 -> 44.8 average.
  // Sixty percent more speed, no change in outcome. Reverted; see
  // battle/movement.js `slowestSpeed` for the table.
  //
  // So the ram's cost is entirely its SLOTS, which is the mechanism already
  // written above arriving from the other side: 23 rams make 276 siege DPS
  // where the 471 militia they displace make 283, at a third of the field
  // power. Dropping rams is worth +23 to +40 points on the campaign even with
  // the speed penalty weighted away. DO NOT RE-SPEND EITHER MEASUREMENT.
  //
  // Pinned as ARITHMETIC rather than as a win rate, because that is the part
  // that cannot be noise: the speed table is exact, where a win rate is a
  // claim about whatever dial the campaign happens to ship today.
  const spread = { militia: 111, spearmen: 67, raiders: 39, rams: 23 };
  const spreadPace = MOVEMENT.hexSecondsPerSpeed / slowestSpeed(spread);
  for (const unit of ['militia', 'spearmen', 'raiders']) {
    const pace = MOVEMENT.hexSecondsPerSpeed / slowestSpeed({ [unit]: 100 });
    assert.ok(pace < spreadPace,
      `mono-${unit} marches at ${pace.toFixed(2)}s/hex against the spread's `
      + `${spreadPace.toFixed(2)} -- if this stopped being true the exploit changed shape`);
  }
  assert.equal(slowestSpeed(spread), UNITS.rams.speed,
    'the whole point: one ram sets the pace for the entire army');

  // NEGATIVE CONTROL. Drop the rams and the same spread keeps up with a mono
  // army -- so the gap above is the ram, not "mixing units is slow".
  const noRams = { militia: 111, spearmen: 67, raiders: 39 };
  assert.equal(slowestSpeed(noRams), UNITS.spearmen.speed,
    'without rams the spread marches at its next-slowest unit, not at some blend');
  assert.ok(MOVEMENT.hexSecondsPerSpeed / slowestSpeed(noRams)
    <= MOVEMENT.hexSecondsPerSpeed / slowestSpeed({ spearmen: 100 }) + 1e-9,
    'a ram-free mixed army is exactly as quick as the mono army of its slowest type');
});
