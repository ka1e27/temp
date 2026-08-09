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
    classList: { add() {}, remove() {} },
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
