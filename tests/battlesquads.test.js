// SQUADS AND THE ORDERS AIMED AT THEM — split out of ./battleui.test.js at the
// 400-line cap, along the seam rather than at a line number: everything here is
// about a column on the board, and nothing else in that file is.
//
// The fixture and the harness are lifted verbatim rather than shared, because
// they are four lines of stub each and a shared one would be a second thing to
// keep in step for no gain — but if either grows, move it to tests/fixtures/.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createBattleState } from '../src/battle/state.js';
import { drainCommands } from '../src/battle/commands.js';
import { makeMods, CONTRACT_VERSION } from '../src/battle/contract.js';
import { emptyComp } from '../src/battle/combat.js';
import { BOOSTERS, UNIT_IDS } from '../src/content/balance.js';
import { EVENTS } from '../src/battle/events.js';
import { createOrders, cmd } from '../src/screens/battle-orders.js';
import { createView } from '../src/screens/battle-input.js';

const ALL_BOOSTERS = Object.keys(BOOSTERS).map((id) => ({ id, charges: 2 }));

function fixture(o = {}) {
  return createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: 'test',
    seed: 1,
    grid: o.grid ?? { cols: 11, rows: 9, blocked: [] },
    sites: o.sites ?? [
      { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 10 }, hp: 600, hpMax: 600 },
      { id: 'farm', kind: 'farm', hex: [1, 0], owner: 'player', garrison: { militia: 4 }, hp: 100, hpMax: 100 },
      { id: 'hold', kind: 'stronghold', hex: [2, 0], owner: 'enemy', garrison: { militia: 6 }, hp: 250, hpMax: 250 },
      { id: 'cas', kind: 'castle', hex: [4, 0], owner: 'enemy', garrison: {}, hp: 600, hpMax: 600 },
    ],
    adjacency: o.adjacency ?? [['camp', 'farm'], ['farm', 'hold'], ['hold', 'cas']],
    player: makeMods({ expedition: emptyComp(), startGold: o.gold ?? 1000, ...(o.mods ?? {}) }),
    enemy: makeMods({ expedition: emptyComp() }),
    boosters: o.boosters ?? ALL_BOOSTERS,
    rules: { victory: 'capture-castle', hardCapMs: 480000, aiTier: 1 },
  });
}

/** The two things battle-orders.js touches outside the sim. */
function harness(state, view = createView()) {
  const classes = new Set();
  const canvas = {
    classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
  };
  const board = {
    hexSize: 34,
    // `hexPos` is what routePath.js walks a squad's route with; `sitePos`
    // defers to it exactly as the real board does, so the stub cannot drift
    // into placing a site and its own hex in two different places.
    hexPos: (q, r, out) => { out.x = q * 51; out.y = r * 59; return out; },
    sitePos: (s, out) => { out.x = s.hex[0] * 51; out.y = s.hex[1] * 59; return out; },
    siteAt: () => null,
  };
  const events = [];
  const bus = { emit: (t, p) => events.push([t, p]) };
  const ord = createOrders({ canvas, board, view, getState: () => state, bus });
  return { ord, view, classes, events, board };
}

const reasons = (state) => state.events
  .filter((e) => e.type === EVENTS.COMMAND_REJECTED).map((e) => e.reason);

// ---------------------------------------------------------------------------
// Withdraw and squad retreat — the last two unreachable verbs
// ---------------------------------------------------------------------------

test('withdraw: the HUD button ends the battle in retreat', () => {
  const state = fixture();
  state.commands.push(cmd.withdraw());
  drainCommands(state);
  assert.deepEqual(reasons(state), []);
  assert.equal(state.status, 'retreat');
  assert.ok(state.events.some((e) => e.type === EVENTS.BATTLE_ENDED && e.result === 'retreat'));
});

test('squads: clicking an in-flight squad selects it, and R turns it around', () => {
  const state = fixture();
  state.commands.push(cmd.send('camp', 'farm', 1, UNIT_IDS));
  drainCommands(state);
  const squad = state.squads[0];
  assert.ok(squad, 'no squad to click');

  const { ord, view, board } = harness(state);
  // Halfway along the route is the worst case for arc bow, so aim there.
  const a = board.sitePos(state.sites[0], { x: 0, y: 0 });
  const b = board.sitePos(state.sites[1], { x: 0, y: 0 });
  state.tick = Math.round((squad.spawnTick + squad.arriveTick) / 2);
  const hit = ord.squadAt(state, (a.x + b.x) / 2, (a.y + b.y) / 2);
  assert.equal(hit?.id, squad.id, 'the squad was not hit-testable');

  ord.selectSquad(hit);
  assert.equal(view.selectedSquad, squad.id);
  assert.deepEqual(view.selection, [], 'selecting a squad clears the site selection');

  state.commands.push(cmd.retreatSquad(view.selectedSquad));
  drainCommands(state);
  assert.deepEqual(reasons(state), []);
  assert.equal(state.squads[0].retreating, true);
});

test('squads: empty board with nothing in flight still just deselects', () => {
  const state = fixture();
  const { ord } = harness(state);
  assert.equal(ord.squadAt(state, 9999, 9999), null);
});

test('squads: a squad that has already arrived is forgotten, not ordered', () => {
  const state = fixture();
  state.commands.push(cmd.send('camp', 'farm', 1, UNIT_IDS));
  drainCommands(state);
  const { ord, view } = harness(state);
  ord.selectSquad(state.squads[0]);

  state.squads.length = 0;              // it landed
  assert.equal(ord.retreatSelectedSquad(), false);
  assert.equal(view.selectedSquad, null, 'a landed squad must be forgotten');
  assert.equal(state.commands.length, 0, 'no order for a squad that no longer exists');
});

// ---------------------------------------------------------------------------
// Re-aiming a column in flight — ONE rule that used to live in three places
// ---------------------------------------------------------------------------

// `issueMove` carried its own `!squad.camped` test, a THIRD copy of a rule the
// simulation already owned, and it is why relaxing the other two changed
// nothing in the shipped game: a marching column could be pressed, dragged,
// previewed and released, `resolveDrag` returned true and `clearDrag` tidied
// up, and NOTHING was pushed. No rejection, no event, no error — the gesture
// evaporated one layer above the sim. Two suites and a source read all said
// the feature worked; a real browser is what found it.
//
// So this asserts at the layer the hole was in, against the real `createOrders`
// rather than a stub, and its negative control is the case that must still be
// refused.
test('orders: a column in flight can be re-aimed, not silently dropped', () => {
  const state = fixture();
  state.commands.push(cmd.send('camp', 'hold', 1, UNIT_IDS));
  drainCommands(state);
  const sq = state.squads[0];
  assert.equal(sq.camped, false, 'premise: this column is marching');

  const { ord } = harness(state);
  assert.equal(ord.issueMove(sq, null, { toHex: [1, 1] }), true,
    'the order must be issued, not dropped');
  assert.equal(state.commands.length, 1);
  assert.equal(state.commands[0].t, 'MOVE_SQUAD');

  // ...and the simulation must then accept it, or the two layers disagree
  // about the same gesture — which is the whole defect, one layer down.
  drainCommands(state);
  assert.deepEqual(reasons(state), []);
});

test('orders: a move with no destination at all is still refused', () => {
  // The negative control. An `issueMove` that returned true unconditionally
  // would pass the test above and push an order the sim can only reject.
  const state = fixture();
  state.commands.push(cmd.send('camp', 'hold', 1, UNIT_IDS));
  drainCommands(state);
  const { ord } = harness(state);
  assert.equal(ord.issueMove(state.squads[0], null, {}), false);
  assert.equal(ord.issueMove(null, null, { toHex: [1, 1] }), false);
  assert.equal(state.commands.length, 0);
});
