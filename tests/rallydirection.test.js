// Which WAY a rally points, and the fact that it can only point one way.
//
// A link between two sites has three states — off, this way, that way — and one
// gesture cycles them. The rule that makes that safe is a SIMULATION invariant,
// not a UI convention: two sites rallying into each other pump troops back and
// forth forever, burning march time and leaving both permanently
// under-garrisoned. So the loop is broken in commands.js, where it holds for a
// drag, a rally chain, the AI and a resumed save alike.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createBattleState } from '../src/battle/state.js';
import { drainCommands } from '../src/battle/commands.js';
import { step } from '../src/battle/sim.js';
import { makeMods, CONTRACT_VERSION } from '../src/battle/contract.js';
import { emptyComp, total } from '../src/battle/combat.js';
import { createOrders } from '../src/screens/battle-orders.js';
import { createView } from '../src/screens/battle-input.js';

function fixture() {
  return createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: 'raldir',
    seed: 1,
    grid: { cols: 11, rows: 9, blocked: [] },
    sites: [
      { id: 'a', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 40 }, hp: 600, hpMax: 600 },
      { id: 'b', kind: 'farm', hex: [2, 0], owner: 'player', garrison: { militia: 30 }, hp: 100, hpMax: 100 },
      { id: 'c', kind: 'farm', hex: [4, 0], owner: 'player', garrison: { militia: 4 }, hp: 100, hpMax: 100 },
      // An enemy castle with NO edges. Without a surviving enemy the battle is
      // already won and step() returns immediately, so a rally test would sit
      // watching a frozen board; with no edges the AI cannot reach anything and
      // cannot perturb what is being measured.
      { id: 'foe', kind: 'castle', hex: [9, 6], owner: 'enemy', garrison: { militia: 5 }, hp: 480, hpMax: 480 },
    ],
    adjacency: [['a', 'b'], ['b', 'c']],
    player: makeMods({ expedition: emptyComp(), startGold: 1000 }),
    enemy: makeMods({ expedition: emptyComp() }),
    boosters: [],
    rules: { victory: 'capture-castle', hardCapMs: 480000, aiTier: 1 },
  });
}

const siteOf = (st, id) => st.sites.find((s) => s.id === id);

function harness(state) {
  const view = createView();
  const board = {
    hexSize: 34,
    sitePos: (s, out) => { out.x = s.hex[0] * 51; out.y = s.hex[1] * 59; return out; },
    siteAt: () => null,
  };
  const ord = createOrders({
    canvas: { classList: { toggle() {} } }, board, view, getState: () => state, bus: null,
  });
  return { ord };
}

// ---------------------------------------------------------------------------
// The simulation invariant
// ---------------------------------------------------------------------------

test('two sites can never rally INTO each other — the newer order wins', () => {
  const state = fixture();
  state.commands.push({ t: 'RALLY', site: 'a', target: 'b' });
  drainCommands(state);
  assert.equal(siteOf(state, 'a').rallyTarget, 'b');

  state.commands.push({ t: 'RALLY', site: 'b', target: 'a' });
  drainCommands(state);
  assert.equal(siteOf(state, 'b').rallyTarget, 'a', 'the newer order takes effect');
  assert.equal(siteOf(state, 'a').rallyTarget, null, 'the reciprocal one is dropped');
});

test('the loop cannot form through a rally CHAIN either', () => {
  const state = fixture();
  const { ord } = harness(state);
  ord.issueRallyChain(siteOf(state, 'a'), ['b'], siteOf(state, 'c'));
  drainCommands(state);
  assert.equal(siteOf(state, 'a').rallyTarget, 'b');
  assert.equal(siteOf(state, 'b').rallyTarget, 'c');

  // Now point the middle back at the start: b->a must kill a->b, not coexist.
  state.commands.push({ t: 'RALLY', site: 'b', target: 'a' });
  drainCommands(state);
  assert.equal(siteOf(state, 'b').rallyTarget, 'a');
  assert.equal(siteOf(state, 'a').rallyTarget, null);
});

test('a would-be loop SETTLES instead of trading troops forever', () => {
  // The reason the invariant exists, and it has to be asserted on traffic
  // rather than on a garrison: a ping-ponging pair still LOOKS fine in a
  // snapshot, because the troops are all present — they are just permanently
  // in the air, which is the same as not existing when the front needs them.
  const state = fixture();
  state.commands.push({ t: 'RALLY', site: 'a', target: 'b' });
  state.commands.push({ t: 'RALLY', site: 'b', target: 'a' });
  drainCommands(state);

  for (let i = 0; i < 900; i++) step(state);
  const spawnedBy900 = state.nextSquadId;
  for (let i = 0; i < 900; i++) step(state);

  assert.equal(state.nextSquadId, spawnedBy900,
    `still spawning squads after 90s — a and b are trading forever `
    + `(${state.nextSquadId - spawnedBy900} more in the second window)`);
  assert.equal(state.squads.length, 0, 'nothing should still be marching');
});

// ---------------------------------------------------------------------------
// What the drag gesture means
// ---------------------------------------------------------------------------

test('dragging the same direction twice CLEARS the rally', () => {
  const state = fixture();
  const { ord } = harness(state);
  const a = () => siteOf(state, 'a');
  const b = () => siteOf(state, 'b');

  ord.toggleRally(a(), b());
  drainCommands(state);
  assert.equal(a().rallyTarget, 'b');

  ord.toggleRally(a(), b());
  drainCommands(state);
  assert.equal(a().rallyTarget, null, 'the second drag in the same direction removes it');
});

test('dragging the OTHER way flips the link instead of doubling it', () => {
  const state = fixture();
  const { ord } = harness(state);

  ord.toggleRally(siteOf(state, 'a'), siteOf(state, 'b'));
  drainCommands(state);
  ord.toggleRally(siteOf(state, 'b'), siteOf(state, 'a'));
  drainCommands(state);

  assert.equal(siteOf(state, 'b').rallyTarget, 'a', 'now points the other way');
  assert.equal(siteOf(state, 'a').rallyTarget, null, 'and only the other way');
});

test('the three states cycle: off -> this way -> that way -> off', () => {
  const state = fixture();
  const { ord } = harness(state);
  const dir = () => {
    if (siteOf(state, 'a').rallyTarget === 'b') return 'a->b';
    if (siteOf(state, 'b').rallyTarget === 'a') return 'b->a';
    return 'off';
  };

  assert.equal(dir(), 'off');
  ord.toggleRally(siteOf(state, 'a'), siteOf(state, 'b'));
  drainCommands(state);
  assert.equal(dir(), 'a->b');

  ord.toggleRally(siteOf(state, 'b'), siteOf(state, 'a'));
  drainCommands(state);
  assert.equal(dir(), 'b->a');

  ord.toggleRally(siteOf(state, 'b'), siteOf(state, 'a'));
  drainCommands(state);
  assert.equal(dir(), 'off');
});

test('re-dragging a whole rally chain cancels it', () => {
  const state = fixture();
  const { ord } = harness(state);
  ord.issueRallyChain(siteOf(state, 'a'), ['b'], siteOf(state, 'c'));
  drainCommands(state);
  assert.equal(siteOf(state, 'a').rallyTarget, 'b');
  assert.equal(siteOf(state, 'b').rallyTarget, 'c');

  ord.issueRallyChain(siteOf(state, 'a'), ['b'], siteOf(state, 'c'));
  drainCommands(state);
  assert.equal(siteOf(state, 'a').rallyTarget, null);
  assert.equal(siteOf(state, 'b').rallyTarget, null);
});

test('toggling still refuses what was always illegal', () => {
  const state = fixture();
  const { ord } = harness(state);
  // a and c are not adjacent.
  assert.equal(ord.toggleRally(siteOf(state, 'a'), siteOf(state, 'c')), false);
  assert.equal(state.commands.length, 0);

  siteOf(state, 'a').owner = 'enemy';
  assert.equal(ord.toggleRally(siteOf(state, 'a'), siteOf(state, 'b')), false);
  assert.equal(state.commands.length, 0);
});
