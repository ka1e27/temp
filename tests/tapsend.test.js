// A TAP SELECTS. IT NEVER SENDS.
//
// Tapping one site and then another used to issue a send, through the same
// `issueSend` the drag uses. It read well on paper and was a menace in practice:
// the site panel's own controls sit over the board, every neighbour is a legal
// target for the site before it, and "tap this site, now tap that one" is
// indistinguishable from looking at two sites in a row. Upgrading two sites in
// sequence quietly shipped half of one garrison to the other, and there is no
// undo for a send.
//
// Nothing caught it, because no test drove `tap` at all — tests/battleui.test.js
// exercises `ord.*` directly and tools/smoke.mjs drives drags. So this file
// stands up the real createBattleInput() over a fake pointer surface and
// dispatches the listeners it really registered.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.performance ??= { now: () => 0 };
globalThis.window ??= { addEventListener() {}, removeEventListener() {} };

const { createBattleState } = await import('../src/battle/state.js');
const { drainCommands } = await import('../src/battle/commands.js');
const { makeMods, CONTRACT_VERSION } = await import('../src/battle/contract.js');
const { emptyComp, total } = await import('../src/battle/combat.js');
const { createBattleInput, createView } = await import('../src/screens/battle-input.js');
const { createOrders } = await import('../src/screens/battle-orders.js');
const { recomputeOccupancy } = await import('../src/battle/occupancy.js');
const { previewPath, trimWaypoints, isDrawnRoute } = await import('../src/screens/battle-waypoints.js');

function fixture() {
  return createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: 'tap',
    seed: 1,
    grid: { cols: 9, rows: 9, blocked: [] },
    sites: [
      { id: 'a', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 20 }, hp: 480, hpMax: 480 },
      { id: 'b', kind: 'farm', hex: [1, 0], owner: 'player', garrison: { militia: 6 }, hp: 100, hpMax: 100 },
      { id: 'c', kind: 'farm', hex: [2, 0], owner: 'enemy', garrison: { militia: 3 }, hp: 100, hpMax: 100 },
    ],
    adjacency: [['a', 'b'], ['b', 'c']],
    player: makeMods({ expedition: emptyComp(), startGold: 500 }),
    enemy: makeMods({ expedition: emptyComp() }),
    boosters: [],
    rules: { victory: 'capture-castle', hardCapMs: 480000, aiTier: 1 },
  });
}

/** Each site sits at x = index * 100; a "pointer" is just that coordinate. */
function harness(state) {
  const handlers = {};
  const canvas = {
    classList: { add() {}, remove() {}, toggle() {} },
    setPointerCapture() {}, releasePointerCapture() {},
    addEventListener(type, fn) { (handlers[type] ??= []).push(fn); },
    removeEventListener() {},
  };
  const xOf = (id) => state.sites.findIndex((s) => s.id === id) * 100;
  const board = {
    hexSize: 30,
    camera: { screenToWorld: (x, y, out) => { out.x = x; out.y = y; }, zoomAt() {}, panBy() {} },
    pointer: (ev, out) => { out.x = ev.clientX; out.y = ev.clientY; },
    sitePos: (s, out) => { out.x = xOf(s.id); out.y = 0; return out; },
    // A hit only within 20px, so "empty board" is reachable.
    siteAt: (st, x) => st.sites.find((s) => Math.abs(xOf(s.id) - x) < 20) ?? null,
  };
  const view = createView();
  const input = createBattleInput({ canvas, board, view, getState: () => state });
  const fire = (type, ev) => { for (const fn of handlers[type] ?? []) fn(ev); };

  /** A press and release at the same point: the gesture that must not send. */
  const tap = (id) => {
    const x = typeof id === 'number' ? id : xOf(id);
    const ev = { pointerId: 1, clientX: x, clientY: 0, button: 0, preventDefault() {} };
    fire('pointerdown', ev);
    fire('pointerup', ev);
  };
  /** Press, move well past the slop, release: the gesture that MUST send. */
  const drag = (from, to) => {
    const a = xOf(from);
    const b = xOf(to);
    fire('pointerdown', { pointerId: 1, clientX: a, clientY: 0, button: 0, preventDefault() {} });
    fire('pointermove', { pointerId: 1, clientX: (a + b) / 2, clientY: 0, preventDefault() {} });
    fire('pointermove', { pointerId: 1, clientX: b, clientY: 0, preventDefault() {} });
    fire('pointerup', { pointerId: 1, clientX: b, clientY: 0, button: 0, preventDefault() {} });
  };
  const ord = createOrders({ board, view, getState: () => state, push: (c) => state.commands.push(c) });
  return { view, input, tap, drag, ord };
}

const sends = (state) => state.commands.filter((c) => c.t === 'SEND');

test('tap: selecting two of your own sites in a row sends nothing', () => {
  const state = fixture();
  const { tap, view } = harness(state);

  tap('a');
  assert.deepEqual(view.selection, ['a'], 'the first tap selects');

  tap('b');
  assert.deepEqual(view.selection, ['b'], 'the second tap selects the other one');
  assert.deepEqual(sends(state), [], 'and issues no send at all');
});

test('tap: tapping your site then an ENEMY one sends nothing either', () => {
  // The variant that actually cost people battles: the second tap is a target,
  // so the old code read it as "attack" and committed the garrison.
  const state = fixture();
  const { tap } = harness(state);
  tap('b');
  tap('c');
  assert.deepEqual(sends(state), []);

  drainCommands(state);
  assert.equal(total(state.sites.find((s) => s.id === 'b').garrison), 6,
    'the garrison never left');
});

test('tap: a whole sequence of taps still sends nothing', () => {
  const state = fixture();
  const { tap } = harness(state);
  for (const id of ['a', 'b', 'a', 'c', 'b', 'a']) tap(id);
  assert.deepEqual(sends(state), []);
});

test('tap: dragging still sends — the gesture that shows you what it will do', () => {
  // The guard on the guard: it would be easy to "fix" the tap by breaking sends.
  const state = fixture();
  const { drag } = harness(state);
  drag('a', 'b');

  const issued = sends(state);
  assert.equal(issued.length, 1, 'exactly one send');
  assert.equal(issued[0].from, 'a');
  assert.equal(issued[0].to, 'b');
});

test('tap: tapping empty board clears the selection rather than sending', () => {
  const state = fixture();
  const { tap, view } = harness(state);
  tap('a');
  tap(500);                                  // nowhere near a site
  assert.deepEqual(view.selection, []);
  assert.deepEqual(sends(state), []);
  assert.equal(view.armed, null);
});

test('tap: the last-touched site is still remembered, because rally reads it', () => {
  // `view.armed` outlived the gesture it was named for. battle-orders.js
  // `setRally` falls back to it, and battle-hud.js uses it as the preview's
  // implied origin — so it has to keep tracking taps even though nothing sends.
  const state = fixture();
  const { tap, view } = harness(state);
  tap('a');
  assert.equal(view.armed, 'a');
  tap('c');
  assert.equal(view.armed, null, 'an enemy site is not a source');
});

// ---------------------------------------------------------------------------
// RALLY MODE — the same drag, meaning something else
// ---------------------------------------------------------------------------
//
// A rally had exactly one input and it was a RIGHT-drag: unavailable on a
// touchscreen, and unreliable on a trackpad, where a two-finger click held
// through a drag is not dependably reported as button 2. The two-finger-tap
// fallback in battle-input.js only ever covered the CLICK form of setRally, so
// the drag — and with it the chain and the toggle — was unreachable on both of
// the devices this game is actually played on.
//
// Driven through the real listeners with button 0, because "does a LEFT drag
// set a rally" is the entire question and a test that called `ord.toggleRally`
// directly would pass against the broken version.

const rallies = (state) => state.commands.filter((c) => c.t === 'RALLY');

test('rally mode: a plain left drag sets a rally instead of sending', () => {
  const state = fixture();
  const { view, input, drag } = harness(state);

  input.setRallyMode(true);
  assert.equal(view.rallyMode, true);

  drag('a', 'b');
  assert.deepEqual(sends(state), [], 'rally mode must not send troops');
  assert.equal(rallies(state).length, 1, 'the left drag issued no rally');
  assert.equal(rallies(state)[0].site, 'a');
  assert.equal(rallies(state)[0].target, 'b');

  drainCommands(state);
  assert.deepEqual(state.sites.find((s) => s.id === 'a').rallyTargets, ['b']);
  assert.equal(total(state.sites.find((s) => s.id === 'a').garrison), 20,
    'the garrison must not have moved');
});

test('rally mode: NEGATIVE CONTROL — the same drag sends when the mode is off', () => {
  // Without this the test above would pass just as well against a build where
  // dragging never sent anything at all.
  const state = fixture();
  const { view, drag } = harness(state);
  assert.equal(view.rallyMode, false, 'send is the default and must stay it');
  drag('a', 'b');
  assert.equal(sends(state).length, 1);
  assert.deepEqual(rallies(state), []);
});

test('rally mode: turning it off restores sending, on the same input', () => {
  const state = fixture();
  const { input, drag } = harness(state);
  input.setRallyMode(true);
  drag('a', 'b');
  input.setRallyMode(false);
  drag('a', 'b');
  assert.equal(rallies(state).length, 1, 'one rally, from the first drag');
  assert.equal(sends(state).length, 1, 'one send, from the second');
});

test('rally mode: an armed booster still outranks it', () => {
  // Both are "the next gesture means something else". A one-shot aim beats a
  // standing mode, or arming a bombard while rally mode happens to be on would
  // silently set a rally and leave the booster armed at whatever you hit next.
  const state = fixture();
  const { view, input, drag } = harness(state);
  input.setRallyMode(true);
  view.armedBooster = 'bombard';
  drag('a', 'b');
  assert.deepEqual(rallies(state), [], 'aiming was overridden by the mode');
});

// ---------------------------------------------------------------------------
// THE ROUTE THE PLAYER DREW, AND THE MAGNET THAT USED TO EAT IT
// ---------------------------------------------------------------------------

test('orders: a hex march is refused onto a base, and allowed onto your own', () => {
  // `passableFor` gives the GOAL hex a free pass so an army can path onto a
  // site it means to assault. Right for an order aimed AT a building, wrong for
  // a march to bare ground: `to: null` plus an enemy base's own tile is an order
  // to CAMP inside it, and arrivals.js obliges — a camped squad never consults
  // occupancy again. Nothing caught it because the drag could not reach the case
  // until the snap magnet shrank.
  const state = fixture();
  recomputeOccupancy(state);
  const foe = state.sites.find((s) => s.id === 'c');
  const mine = state.sites.find((s) => s.id === 'b');

  state.commands.push({
    t: 'SEND', by: 'player', from: 'a', toHex: { q: foe.hex[0], r: foe.hex[1] }, fraction: 0.5,
  });
  drainCommands(state);
  assert.equal(state.squads.length, 0, 'a march onto an enemy base was accepted');

  // NEGATIVE CONTROL, and it is the half the feature is FOR: your own building
  // is ground you may stand on, which is what lets a drawn route chain through
  // your own yard rather than stopping at its door.
  state.commands.push({
    t: 'SEND', by: 'player', from: 'a', toHex: { q: mine.hex[0], r: mine.hex[1] }, fraction: 0.5,
  });
  drainCommands(state);
  assert.equal(state.squads.length, 1, 'a march onto my OWN building was refused');
});

test('orders: the previewed route is the route the order walks', () => {
  // A PREVIEW THAT DISAGREES WITH THE ORDER IS WORSE THAN NO PREVIEW — the same
  // rule the pre-commit battle preview follows by calling `resolveField` rather
  // than approximating it. `previewPath` builds the same `stops` array cmdSend
  // builds and hands it to the same `pathThrough`, so this asserts the drawn
  // line against the walked one hex for hex rather than against a second
  // implementation of the pathfinder.
  const state = fixture();
  recomputeOccupancy(state);
  const from = state.sites.find((s) => s.id === 'a');
  // A trail long enough to count as DRAWN: straight-line distance 2, so it needs
  // at least two hexes of slack (see isDrawnRoute).
  const trail = [[0, 0], [0, 1], [1, 1], [2, 1], [3, 1], [3, 0]];
  assert.equal(isDrawnRoute(trail), true, 'fixture trail is not a drawn route — proves nothing');

  const preview = previewPath(state, from, null, trail);
  assert.ok(preview && preview.length > 3, 'no route previewed for a legal drawn road');

  state.commands.push({
    t: 'SEND', by: 'player', from: 'a', toHex: { q: 3, r: 0 },
    waypoints: trimWaypoints(trail), fraction: 0.5,
  });
  drainCommands(state);
  const sq = state.squads[0];
  assert.ok(sq, 'the order the preview described was refused');
  assert.deepEqual(sq.path.map((h) => [h.q, h.r]), preview.map((h) => [h.q, h.r]),
    'the army walked a different road from the one the arrow drew');
});

test('orders: a DRAWN route turns the snap magnet off', () => {
  // The magnet exists so a quick pull at a neighbour lands on it without
  // precision. A player who has curved a route around a building has already
  // said where they want the army, and having the building they steered around
  // reach out and claim the order is the opposite of the gesture — which is
  // exactly why a road past your own gate could not be drawn.
  const state = fixture();
  const { ord } = harness(state);
  const from = state.sites.find((s) => s.id === 'a');

  // 30px from site 'b' (at x=100): outside the 20px exact hit, inside the old
  // 2.4-hex (72px) magnet, outside the new one.
  assert.equal(ord.snapTarget(from, 130, 0, null)?.id, undefined,
    'the magnet still reaches most of a hex away — the radius did not shrink');
  assert.equal(ord.snapTarget(from, 105, 0, null)?.id, 'b',
    'a release ON a building must still snap, or nothing can be targeted');

  // ...and with a drawn trail the magnet stands down entirely: only the exact
  // hit-test decides, so ENDING a drawn route on a building still works, it
  // just has to be on the building rather than near it.
  const drawn = [[0, 0], [0, 1], [1, 1], [2, 1], [3, 1], [3, 0]];
  assert.equal(isDrawnRoute(drawn), true, 'fixture trail is not drawn — proves nothing');
  assert.equal(ord.snapTarget(from, 105, 0, drawn)?.id, 'b',
    'an exact hit must still resolve, drawn route or not');
  // x=123 is past this fixture's 20px exact hit and inside the 25.5px magnet —
  // the only window where the two rules can be told apart at all.
  assert.equal(ord.snapTarget(from, 123, 0, drawn), null,
    'a drawn route was captured by a building it merely passed');
  // NEGATIVE CONTROL: the SAME near miss with no drawn trail still snaps, so
  // the line above is the drawn-route rule and not the radius a second time.
  assert.equal(ord.snapTarget(from, 123, 0, null)?.id, 'b');
});
