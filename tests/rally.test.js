// Rally points, from the gesture down to `site.rallyTargets`.
//
// Rally had no test at all while it had exactly one input path — select, then
// right-CLICK — and that path fired on pointerdown at the press point. So
// pressing the source and dragging toward the target resolved to
// `target === source`, which CLEARS a rally. The gesture a player would try
// first did the opposite of what they wanted, silently.
//
// Every test drains the real commands.js and asserts the simulation moved,
// because a rally that reaches the command queue and no further is the same
// bug in a new place.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createBattleState } from '../src/battle/state.js';
import { drainCommands } from '../src/battle/commands.js';
import { step } from '../src/battle/sim.js';
import { makeMods, CONTRACT_VERSION } from '../src/battle/contract.js';
import { emptyComp } from '../src/battle/combat.js';
import { createOrders } from '../src/screens/battle-orders.js';
import { createView } from '../src/screens/battle-input.js';

function fixture() {
  return createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: 'rally',
    seed: 1,
    grid: { cols: 11, rows: 9, blocked: [] },
    sites: [
      { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 10 }, hp: 600, hpMax: 600 },
      { id: 'farm', kind: 'farm', hex: [1, 0], owner: 'player', garrison: { militia: 4 }, hp: 100, hpMax: 100 },
      { id: 'hold', kind: 'stronghold', hex: [2, 0], owner: 'enemy', garrison: { militia: 6 }, hp: 250, hpMax: 250 },
      { id: 'far', kind: 'farm', hex: [5, 0], owner: 'player', garrison: { militia: 2 }, hp: 100, hpMax: 100 },
    ],
    adjacency: [['camp', 'farm'], ['farm', 'hold']],
    player: makeMods({ expedition: emptyComp(), startGold: 1000 }),
    enemy: makeMods({ expedition: emptyComp() }),
    boosters: [],
    rules: { victory: 'capture-castle', hardCapMs: 480000, aiTier: 1 },
  });
}

/** `at` is the site the pointer is over, which is all setRally reads. */
function harness(state, at = null) {
  const view = createView();
  const board = {
    hexSize: 34,
    sitePos: (s, out) => { out.x = s.hex[0] * 51; out.y = s.hex[1] * 59; return out; },
    siteAt: () => at,
  };
  const canvas = { classList: { toggle() {} } };
  const ord = createOrders({ canvas, board, view, getState: () => state, bus: null });
  return { ord, view };
}

const siteOf = (state, id) => state.sites.find((s) => s.id === id);

// ---------------------------------------------------------------------------
// The drag form — what right-button press-drag-release resolves to
// ---------------------------------------------------------------------------

test('rally drag: source to an adjacent site sets the rally in the simulation', () => {
  const state = fixture();
  const { ord } = harness(state);

  assert.equal(ord.issueRally(siteOf(state, 'camp'), siteOf(state, 'farm')), true);
  drainCommands(state);
  assert.deepEqual(siteOf(state, 'camp').rallyTargets, ['farm']);
});

test('rally drag: releasing back on the source clears it — the explicit cancel', () => {
  const state = fixture();
  const { ord } = harness(state);

  ord.issueRally(siteOf(state, 'camp'), siteOf(state, 'farm'));
  drainCommands(state);
  assert.deepEqual(siteOf(state, 'camp').rallyTargets, ['farm']);

  assert.equal(ord.issueRally(siteOf(state, 'camp'), siteOf(state, 'camp')), true);
  drainCommands(state);
  assert.deepEqual(siteOf(state, 'camp').rallyTargets, []);
});

test('rally drag: a non-adjacent target issues NOTHING, so an existing rally survives', () => {
  const state = fixture();
  const { ord } = harness(state);

  ord.issueRally(siteOf(state, 'camp'), siteOf(state, 'farm'));
  drainCommands(state);

  // `far` is a player site with no edge to camp. Refusing must be silent AND
  // must not clear what is already set — abandoning a drag is not an erase.
  assert.equal(ord.issueRally(siteOf(state, 'camp'), siteOf(state, 'far')), false);
  assert.equal(state.commands.length, 0, 'an illegal rally must not reach the queue');
  drainCommands(state);
  assert.deepEqual(siteOf(state, 'camp').rallyTargets, ['farm']);
});

test('rally drag: an enemy site is never a legal source', () => {
  const state = fixture();
  const { ord } = harness(state);

  assert.equal(ord.issueRally(siteOf(state, 'hold'), siteOf(state, 'farm')), false);
  assert.equal(state.commands.length, 0);
});

test('rally drag: adjacency is enforced by the SIM too, not just the input layer', () => {
  // The input layer snaps to legal targets, so a bad pair should be unreachable
  // by hand — but the command queue is replayable and resume-loaded, so the
  // rule has to hold when the order arrives from somewhere else.
  const state = fixture();
  state.commands.push({ t: 'RALLY', site: 'camp', target: 'far' });
  drainCommands(state);
  assert.deepEqual(siteOf(state, 'camp').rallyTargets, []);
  assert.ok(state.events.some((e) => e.reason === 'not-adjacent'));
});

// ---------------------------------------------------------------------------
// The click form — kept for setting a whole flank at once
// ---------------------------------------------------------------------------

test('rally click: the selection rallies to the site under the pointer', () => {
  const state = fixture();
  const { ord, view } = harness(state, siteOf(state, 'farm'));

  view.selection.push('camp');
  ord.setRally(0, 0);
  drainCommands(state);
  assert.deepEqual(siteOf(state, 'camp').rallyTargets, ['farm']);
});

test('rally click: sources that cannot legally reach the target are skipped, not thrown', () => {
  const state = fixture();
  const { ord, view } = harness(state, siteOf(state, 'hold'));

  // camp->hold is not an edge; farm->hold is. One command, not two, not a crash.
  view.selection.push('camp', 'farm');
  ord.setRally(0, 0);
  assert.equal(state.commands.length, 1);
  drainCommands(state);
  assert.deepEqual(siteOf(state, 'camp').rallyTargets, []);
  assert.deepEqual(siteOf(state, 'farm').rallyTargets, ['hold']);
});

test('rally click and rally drag agree about every legal pair', () => {
  // The two paths exist because one sets a flank and the other sets one site.
  // They must never disagree about what is ALLOWED, which is why both funnel
  // through issueRally.
  const ids = ['camp', 'farm', 'hold', 'far'];
  for (const fromId of ids) {
    for (const toId of ids) {
      const a = fixture();
      const ha = harness(a);
      const viaDrag = ha.ord.issueRally(siteOf(a, fromId), siteOf(a, toId));

      const b = fixture();
      const hb = harness(b, siteOf(b, toId));
      hb.view.selection.push(fromId);
      hb.ord.setRally(0, 0);
      const viaClick = b.commands.length > 0;

      assert.equal(viaDrag, viaClick, `${fromId} -> ${toId} disagrees between drag and click`);
    }
  }
});

// ---------------------------------------------------------------------------
// What the rally actually buys
// ---------------------------------------------------------------------------

test('a rallied site auto-sends once it has troops to spare', () => {
  const state = fixture();
  const { ord } = harness(state);
  ord.issueRally(siteOf(state, 'camp'), siteOf(state, 'farm'));
  drainCommands(state);

  // Give the camp a garrison worth forwarding, then run the sim and watch a
  // squad appear without any further input. That is the whole point of rally:
  // it is the idle affordance INSIDE the battle.
  siteOf(state, 'camp').garrison.militia = 60;
  const before = state.squads.length;
  for (let i = 0; i < 200 && state.squads.length === before; i++) step(state);
  assert.ok(state.squads.length > before, 'a rallied site never forwarded anything');
  assert.equal(state.squads.at(-1).to, 'farm');
});
