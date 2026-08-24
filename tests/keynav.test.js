// THE KEYBOARD PATH TO THE BOARD, and the fog gate it has to keep.
//
// Before `battle-keynav.js` there was no way to make a SELECTION without a
// pointer, and every verb in the game hangs off one — so the site panel never
// opened and train, upgrade, build, rally, retreat and the send were all
// mouse-only. The claim this file pins is small and load-bearing: the cycle
// reaches every site you own, in an order that does not move under you, and it
// refuses every site you have not seen.
//
// Each assertion is paired with a control that fails if the rule were deleted,
// because this project's signature failure is a test that only checks the true
// branch.
import test from 'node:test';
import assert from 'node:assert/strict';

import { navigableSites, stepId } from '../src/screens/battle-keynav.js';
import { startBattle } from '../src/battle/sim.js';
import { generateBattleMap } from '../src/battle/mapgen.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { createState } from '../src/core/store.js';
import { markConquered, refreshUnlocks } from '../src/meta/world.js';
import { REGIONS } from '../src/content/regions.data.js';
import { siteKnown } from '../src/battle/vision.js';

/** A real battle on the real path, copied from tests/vision.test.js. */
function battleFor(id = 'gallowmoor') {
  const state = createState({ seed: 1, now: 0 });
  const i = REGIONS.findIndex((r) => r.id === id);
  for (const p of REGIONS.slice(0, i)) markConquered(state.meta, p.id, { now: 0, durationMs: 0 });
  refreshUnlocks(state.meta, null);
  const b = startBattle(buildBattleConfig(state.meta, id, [], generateBattleMap, { seed: 5 }));
  b.ai.nextThinkTick = 1e9;
  return b;
}

test('keynav: the cycle reaches every site the player owns, and only those', () => {
  const b = battleFor();
  const mine = navigableSites(b, 'player', true);
  const owned = b.sites.filter((s) => s.owner === 'player');
  assert.ok(owned.length >= 3, `a beachhead is 3-5 sites, got ${owned.length}`);
  assert.deepEqual(
    mine.map((s) => s.id).sort(),
    owned.map((s) => s.id).sort(),
    'the owned cycle is exactly the player\'s sites',
  );

  // AND IT WALKS ALL OF THEM, which is the property a player actually needs:
  // stepping `mine.length` times from any start returns to that start having
  // visited each id once. A cycle that skipped one would strand a site.
  const seen = new Set();
  let id = mine[0].id;
  for (let n = 0; n < mine.length; n++) { seen.add(id); id = stepId(mine, id, 1); }
  assert.equal(seen.size, mine.length, 'every owned site is reachable');
  assert.equal(id, mine[0].id, 'and the cycle wraps back to where it started');
});

test('keynav: NEGATIVE CONTROL — the cycle refuses a site the player has never seen', () => {
  // The whole reason this is fog-gated: `battleView.js siteAt` already refuses
  // an unscouted building, and a keyboard cycle over the raw list would hand
  // back every enemy building's existence for a keystroke. A battle opens
  // 85-90% dark, so there is always something to refuse.
  const b = battleFor();
  const all = navigableSites(b, 'player', false);
  const unseen = b.sites.filter((s) => !siteKnown(b, 'player', s));
  assert.ok(unseen.length > 0,
    'this fixture is meant to open with unscouted ground — if it does not, the '
    + 'control below proves nothing and the fixture needs re-choosing');
  for (const s of unseen) {
    assert.ok(!all.some((n) => n.id === s.id),
      `${s.id} has never been seen and must not be navigable`);
  }
  // ...and the positive half, or the assertion above would pass just as
  // happily if `navigableSites` returned nothing at all.
  assert.ok(all.length > 0, 'the player can still reach what they HAVE seen');
  for (const s of all) assert.ok(siteKnown(b, 'player', s), `${s.id} is known`);
});

test('keynav: the order is READING ORDER, and it does not move under a new building', () => {
  const b = battleFor();
  const list = navigableSites(b, 'player', false);
  const col = (h) => h[0] + Math.floor(h[1] / 2);
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1].hex;
    const c = list[i].hex;
    assert.ok(a[1] < c[1] || (a[1] === c[1] && col(a) <= col(c)),
      `row-then-column broke between ${list[i - 1].id} and ${list[i].id}`);
  }

  // THE POINT OF ORDERING BY HEX RATHER THAN BY ARRAY INDEX. `state.sites`
  // appends anything the player builds, so array order would put a new farm
  // last however close it stands — and would renumber nothing else, which is
  // worse: the queue silently means something different from one minute to the
  // next. Splicing a site in at its own position leaves every neighbour's
  // relative order untouched.
  const before = list.map((s) => s.id);
  const anchor = list[Math.floor(list.length / 2)];
  b.sites.push({
    ...anchor, id: 'b99', hex: [anchor.hex[0], anchor.hex[1]], owner: 'player',
  });
  const after = navigableSites(b, 'player', false).map((s) => s.id).filter((x) => x !== 'b99');
  assert.deepEqual(after, before, 'an added building must not reorder the others');
});

test('keynav: stepId wraps both ways and recovers from an id that is gone', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(stepId(list, 'a', 1), 'b');
  assert.equal(stepId(list, 'c', 1), 'a', 'forward wraps');
  assert.equal(stepId(list, 'a', -1), 'c', 'backward wraps');

  // A CURSOR THAT STOPS RESPONDING IS THE FAILURE THIS AVOIDS. The id it was
  // on can vanish between keystrokes — the site was captured, or fog closed
  // over it — and returning null there would leave the player pressing a key
  // that does nothing, with no way to find out why.
  assert.equal(stepId(list, 'gone', 1), 'a');
  assert.equal(stepId(list, 'gone', -1), 'c');
  assert.equal(stepId(list, null, 1), 'a', 'and a cold start picks the first');
  assert.equal(stepId([], 'a', 1), null, 'but an empty board has nowhere to go');
});
