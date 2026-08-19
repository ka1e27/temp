// "DRAG BACK TO WHERE YOU STARTED AND LET GO" DESTROYED TROOPS, SILENTLY.
//
// `resolveDrag`'s own comment said "releasing back on the source is an explicit
// cancel". It was not. `battle-waypoints.js updateDragPreview` nulls
// `view.dragTo` whenever the snap target resolves back to the drag's own origin
// — right for a rally, which is what that line was written for — and for a SEND
// that made a returning drag INDISTINGUISHABLE from a release on open ground.
// So it fell into the bare-ground branch and marched a share of the garrison
// onto the tile it was already standing on.
//
// Measured before the fix, with real pointer events: press on the camp, drag
// out 30px, come back and release on it — squads-from-camp went 0 to 1, a new
// squad appeared `{to: null, camped: true}` having marched nowhere, and
// repeating the "safe" gesture peeled off ANOTHER share. The detachment then
// sits exactly on its own site's hex, where `siteAt` wins every hit-test, so it
// can never be selected or reabsorbed. The single most natural way to abort a
// gesture permanently fragmented the garrison, with no error and nothing on
// screen to notice.
//
// The comment was the specification and the code had drifted from it, which is
// this project's most-repeated failure shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDrag } from '../src/screens/battle-drag.js';

const SITES = [
  { id: 'camp', kind: 'camp', hex: [3, 4], owner: 'player' },
  { id: 'far', kind: 'farm', hex: [9, 4], owner: 'enemy' },
];
const state = { sites: SITES, squads: [] };

function fakeOrders() {
  const issued = [];
  return {
    issued,
    squadAt: () => null,
    site: (id) => SITES.find((x) => x.id === id) || null,
    isDrawnRoute: () => false,
    trimWaypoints: () => [],
    selectOnly: () => {},
    issueSend: (from, to, o) => { issued.push({ t: 'SEND', to: to?.id ?? null, ...o }); },
    sendFromSelection: (to, o) => { issued.push({ t: 'MULTI', to: to?.id ?? null, ...o }); },
    issueMove: (sq, to, o) => { issued.push({ t: 'MOVE', to: to?.id ?? null, ...o }); },
  };
}
const view = (over) => ({
  dragFrom: null, dragFromSquad: null, dragTo: null,
  dragTrail: [], dragSources: null, armed: null, ...over,
});

test('a drag that comes back to its own site issues NOTHING', () => {
  // The bug, as the assertion that fails against every build before this one.
  const ord = fakeOrders();
  resolveDrag(ord, view({
    dragFrom: 'camp', dragTo: null,
    dragTrail: [{ q: 3, r: 4 }, { q: 4, r: 4 }, { q: 3, r: 4 }],
  }), state);
  assert.deepEqual(ord.issued, [], 'a cancel must cost nothing at all');
});

test('...and neither does a MULTI-source drag that comes home', () => {
  // `sendFromSelection(null, {toHex})` has the identical shape one branch up,
  // so the same gesture fragmented every selected garrison at once.
  const ord = fakeOrders();
  resolveDrag(ord, view({
    dragFrom: 'camp', dragTo: null, dragSources: ['camp', 'far'],
    dragTrail: [{ q: 3, r: 4 }, { q: 5, r: 4 }, { q: 3, r: 4 }],
  }), state);
  assert.deepEqual(ord.issued, []);
});

test('...nor a CAMPED force dragged back onto its own tile', () => {
  // The same bug one verb along, and worse: `cmdMoveSquad` takes a FRACTION,
  // so instead of marching nowhere the force SPLIT, leaving two camped squads
  // stacked on one hex.
  const sq = { id: 7, camped: true, hex: [3, 4], owner: 'player' };
  const ord = fakeOrders();
  resolveDrag(ord, view({
    dragFromSquad: 7, dragTo: null,
    dragTrail: [{ q: 3, r: 4 }, { q: 4, r: 5 }, { q: 3, r: 4 }],
  }), { sites: SITES, squads: [sq] });
  assert.deepEqual(ord.issued, []);
});

test('a camped force reads either hex shape', () => {
  // `sq.hex` is `[q,r]` in some paths and `{q,r}` in others — `squadHexOf`
  // normalises it with `asHex` and this must agree, or the guard is live for
  // one of them and silently absent for the other.
  const ord = fakeOrders();
  resolveDrag(ord, view({
    dragFromSquad: 7, dragTo: null,
    dragTrail: [{ q: 2, r: 2 }, { q: 2, r: 2 }],
  }), { sites: SITES, squads: [{ id: 7, camped: true, hex: { q: 2, r: 2 } }] });
  assert.deepEqual(ord.issued, []);
});

// ---------------------------------------------------------------------------
// The negative controls. Every one of these must still work exactly as it did.
// ---------------------------------------------------------------------------

test('a drag to another SITE still sends', () => {
  const ord = fakeOrders();
  resolveDrag(ord, view({
    dragFrom: 'camp', dragTo: 'far',
    dragTrail: [{ q: 3, r: 4 }, { q: 9, r: 4 }],
  }), state);
  assert.equal(ord.issued.length, 1);
  assert.equal(ord.issued[0].to, 'far');
});

test('a drag to genuinely OPEN GROUND still marches there', () => {
  // The half the squad rewrite bought, and the half a blunter fix would have
  // broken: releasing on a bare tile must still take that tile.
  const ord = fakeOrders();
  resolveDrag(ord, view({
    dragFrom: 'camp', dragTo: null,
    dragTrail: [{ q: 3, r: 4 }, { q: 5, r: 6 }],
  }), state);
  assert.equal(ord.issued.length, 1);
  assert.deepEqual(ord.issued[0].toHex, { q: 5, r: 6 });
});

test('a drag ending one hex from home is a march, not a cancel', () => {
  // The guard is an exact hex match, deliberately. Anything fuzzier would eat
  // the shortest legal order in the game — stepping a garrison onto the tile
  // next door.
  const ord = fakeOrders();
  resolveDrag(ord, view({
    dragFrom: 'camp', dragTo: null,
    dragTrail: [{ q: 3, r: 4 }, { q: 4, r: 4 }],
  }), state);
  assert.equal(ord.issued.length, 1);
  assert.deepEqual(ord.issued[0].toHex, { q: 4, r: 4 });
});

test('a camped force marched somewhere real still moves', () => {
  const ord = fakeOrders();
  resolveDrag(ord, view({
    dragFromSquad: 7, dragTo: null,
    dragTrail: [{ q: 3, r: 4 }, { q: 6, r: 1 }],
  }), { sites: SITES, squads: [{ id: 7, camped: true, hex: [3, 4] }] });
  assert.equal(ord.issued.length, 1);
  assert.deepEqual(ord.issued[0].toHex, { q: 6, r: 1 });
});

test('an empty trail cancels rather than throwing', () => {
  // A press-and-release with no movement at all never reaches here in practice
  // (that is a tap), but `dragTrail[length - 1]` on an empty array is undefined
  // and this runs on every pointerup.
  const ord = fakeOrders();
  assert.doesNotThrow(() => resolveDrag(ord, view({ dragFrom: 'camp', dragTrail: [] }), state));
  assert.deepEqual(ord.issued, []);
});
