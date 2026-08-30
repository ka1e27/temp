// THE SITE PANEL MUST NOT LAND ON THE ARMY IT JUST SELECTED.
//
// `createFollower.place` returns early on a falsy anchor, so an anchor of null
// is not "the panel floats" — it is "the panel renders wherever the stylesheet
// puts it, with no keep-out box for anything". A camped squad has no
// destination, so anchoring squads to `squad.to` gave exactly that, and the
// panel could cover the force it was describing: inspectable, then undraggable,
// with no order, no rejection and no error.
//
// Pinned here as the PROPERTY — a selected squad always yields an anchor — so a
// future rewrite with different plumbing cannot reopen it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { squadAnchor, squadRoute } from '../src/screens/battle-status.js';

/** A camped column: on a hex, `to` and `from` cleared, path behind it. */
const camped = (id = 7) => ({
  id, owner: 'player', camped: true, to: null, from: null,
  hex: { q: -1, r: 2 }, path: [{ q: 0, r: 0 }, { q: -1, r: 2 }],
  spawnTick: 0, arriveTick: 10, comp: { militia: 4 },
});

/** A column still in the air, headed somewhere real. */
const marching = (id = 8) => ({
  id, owner: 'player', camped: false, to: 'ef01', from: 'py01',
  hex: null, path: [{ q: 0, r: 0 }, { q: 2, r: 2 }],
  spawnTick: 0, arriveTick: 100, comp: { militia: 4 },
});

const state = (tick = 50) => ({ tick });

test('a camped squad still gets an anchor, and it is where the army stands', () => {
  const a = squadAnchor(state(), camped(), null);
  assert.ok(a, 'a camped squad anchored to nothing — the panel would fall back '
    + 'to the stylesheet and can then cover the army it selected');
  assert.deepEqual(a.hex, [-1, 2], 'the anchor must be the hex the army is on');
});

test('the anchor carries exactly the three fields the follower reads', () => {
  // `siteScreen` reads `.hex`, the neighbour keep-out loop reads `.adj.length`,
  // and `setAnchor` compares `.id` — a missing `adj` throws in a per-frame path
  // and a missing `id` tears the follower down every frame.
  const a = squadAnchor(state(), camped(), null);
  assert.ok(Array.isArray(a.hex) && a.hex.length === 2);
  assert.ok(Array.isArray(a.adj), 'adj must be an array, not undefined');
  assert.equal(typeof a.id, 'string');
  assert.ok(a.id.length > 0);
});

test('the anchor id is STABLE across frames', () => {
  // `setAnchor` resets the follower whenever the id changes, so an id derived
  // from anything per-tick would re-measure and re-place the panel every frame.
  assert.equal(squadAnchor(state(10), camped(), null).id,
    squadAnchor(state(900), camped(), null).id);
});

test('NEGATIVE CONTROL: a marching column still anchors to its destination', () => {
  // The old rule is right for a march and must not be disturbed — the
  // destination holds still while the column does not.
  const dest = { id: 'ef01', hex: [2, 2], adj: [] };
  assert.equal(squadAnchor(state(), marching(), dest), dest,
    'a resolved destination must win outright');
});

test('NEGATIVE CONTROL: a squad that is nowhere yields no anchor', () => {
  const nowhere = { ...camped(), camped: false, hex: null, path: null };
  assert.equal(squadAnchor(state(), nowhere, null), null,
    'inventing an anchor for a squad with no position would place the panel at NaN');
});

test('the subtitle never reads "null → null"', () => {
  // Same stale premise as the anchor, one field along: a camped force has
  // neither end of a route any more.
  const sub = squadRoute(state(), camped());
  assert.doesNotMatch(sub, /null/, `camped subtitle read "${sub}"`);
  assert.match(sub, /-1,2/, 'it should say where the force is holding');
  // NEGATIVE CONTROL: a march still reads as a route.
  assert.equal(squadRoute(state(), marching()), 'py01 → ef01');
});
