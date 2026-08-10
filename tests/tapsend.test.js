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
  return { view, input, tap, drag };
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
