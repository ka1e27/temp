// The per-site rally hold-back: how many troops a rallied site keeps at home.
//
// It used to be one global constant for every site on the board. Making it
// per-site is only worth anything if the number a player sets actually reaches
// rallyPhase(), so every test here presses the panel's own stepper, drains the
// REAL commands.js, and then asserts on the garrison a REAL step() left behind.
// A test that stopped at "a command object was constructed" would have passed
// against the global it replaced.
//
// Split from siteintel.test.js only because the pair exceeded the 400-line cap.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createBattleState, clampRallyKeep, rallyKeepOf } from '../src/battle/state.js';
import { drainCommands } from '../src/battle/commands.js';
import { step } from '../src/battle/sim.js';
import { makeMods, CONTRACT_VERSION } from '../src/battle/contract.js';
import { emptyComp, total } from '../src/battle/combat.js';
import { EVENTS } from '../src/battle/events.js';
import { RALLY_KEEP, RALLY_MIN_GARRISON } from '../src/content/balance.js';
import { stepRallyKeep, keepLabel } from '../src/screens/battle-econ.js';
import { setKeep } from '../src/screens/battle-panel.js';
import { createOrders } from '../src/screens/battle-orders.js';
import { createView } from '../src/screens/battle-input.js';

const at = (state, id) => state.sites.find((s) => s.id === id);
const reasons = (state) => state.events
  .filter((e) => e.type === EVENTS.COMMAND_REJECTED).map((e) => e.reason);

function fixture() {
  return createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: 'keep',
    seed: 1,
    grid: { cols: 11, rows: 9, blocked: [] },
    sites: [
      { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 4 }, hp: 600, hpMax: 600 },
      { id: 'f1', kind: 'farm', hex: [1, 0], owner: 'player', garrison: {}, hp: 100, hpMax: 100 },
      { id: 'hold', kind: 'stronghold', hex: [2, 0], owner: 'player', garrison: {}, hp: 250, hpMax: 250 },
      { id: 'cas', kind: 'castle', hex: [5, 0], owner: 'enemy', garrison: { militia: 6 }, hp: 600, hpMax: 600 },
    ],
    adjacency: [['camp', 'f1'], ['f1', 'hold']],
    player: makeMods({ expedition: emptyComp(), startGold: 5000 }),
    enemy: makeMods({ expedition: emptyComp() }),
    boosters: [],
    rules: { victory: 'capture-castle', hardCapMs: 480000, aiTier: 1 },
  });
}

/** The two things battle-orders.js touches outside the simulation, plus the
 *  `input` surface battle-input.js exposes to the panel — same one call, so a
 *  button press in the test travels the same path as a button press in game. */
function harness(state) {
  const view = createView();
  const board = {
    hexSize: 34,
    sitePos: (s, out) => { out.x = s.hex[0] * 51; out.y = s.hex[1] * 59; return out; },
    siteAt: () => null,
  };
  const canvas = { classList: { toggle() {} } };
  const ord = createOrders({ canvas, board, view, getState: () => state, bus: null });
  const input = { setRallyKeep: (id, keep) => ord.issueRallyKeep(id, keep) };
  return { ord, view, input };
}


test('a new site keeps the old global, so nothing moves until a player asks', () => {
  const s = fixture();
  assert.equal(RALLY_KEEP.default, RALLY_MIN_GARRISON);
  for (const site of s.sites) assert.equal(site.rallyKeep, RALLY_KEEP.default);

  const camp = at(s, 'camp');
  camp.garrison = { ...emptyComp(), militia: 20 };
  s.commands.push({ t: 'RALLY', site: 'camp', target: 'f1' });
  step(s);
  assert.equal(total(camp.garrison), RALLY_KEEP.default);
});

test('the hold-back is PER SITE: two rallied sites keep different numbers', () => {
  const s = fixture();
  const { ord } = harness(s);
  const camp = at(s, 'camp');
  const hold = at(s, 'hold');
  camp.garrison = { ...emptyComp(), militia: 20 };
  hold.garrison = { ...emptyComp(), militia: 20 };

  ord.issueRally(camp, at(s, 'f1'));
  ord.issueRally(hold, at(s, 'f1'));
  ord.issueRallyKeep(camp, 0);
  ord.issueRallyKeep(hold, 16);
  step(s);

  assert.deepEqual(reasons(s), []);
  assert.equal(camp.rallyKeep, 0);
  assert.equal(hold.rallyKeep, 16);
  assert.equal(total(camp.garrison), 0, 'keep 0 forwards the whole garrison');
  assert.equal(total(hold.garrison), 16, 'keep 16 holds sixteen back');
});

test('the panel slider sets the value and the SIMULATION follows it', () => {
  const s = fixture();
  const { view, input } = harness(s);
  const camp = at(s, 'camp');
  camp.garrison = { ...emptyComp(), militia: 30 };
  camp.rallyTargets = ['f1'];
  view.selection.push('camp');

  assert.equal(setKeep(s, 'camp', RALLY_KEEP.default + RALLY_KEEP.step, input), true);
  step(s);
  assert.deepEqual(reasons(s), []);
  assert.equal(camp.rallyKeep, RALLY_KEEP.default + RALLY_KEEP.step);
  assert.equal(total(camp.garrison), RALLY_KEEP.default + RALLY_KEEP.step);

  assert.equal(setKeep(s, 'camp', RALLY_KEEP.default - RALLY_KEEP.step, input), true);
  step(s);
  assert.equal(camp.rallyKeep, RALLY_KEEP.default - RALLY_KEEP.step);
  assert.equal(setKeep(s, 'nope', 4, input), false, 'a dead selection queues nothing');
});

test('the slider cannot set a value outside the RALLY_KEEP band', () => {
  const s = fixture();
  const { input } = harness(s);
  const camp = at(s, 'camp');

  camp.rallyKeep = RALLY_KEEP.max;
  setKeep(s, 'camp', RALLY_KEEP.max + 50, input);
  step(s);
  assert.equal(camp.rallyKeep, RALLY_KEEP.max);
  assert.equal(keepLabel(camp), `keeps ${RALLY_KEEP.max}`);

  camp.rallyKeep = RALLY_KEEP.min;
  setKeep(s, 'camp', RALLY_KEEP.min - 50, input);
  step(s);
  assert.equal(camp.rallyKeep, RALLY_KEEP.min);
  assert.equal(keepLabel(camp), 'sends everything');
  assert.equal(stepRallyKeep(camp, -1), RALLY_KEEP.min);
});

test('an out-of-range order is CLAMPED by the sim, and the clamp bites', () => {
  const s = fixture();
  const camp = at(s, 'camp');
  camp.garrison = { ...emptyComp(), militia: RALLY_KEEP.max + 5 };
  camp.rallyTargets = ['f1'];
  s.commands.push({ t: 'RALLY_KEEP', site: 'camp', keep: 9999 });
  step(s);

  assert.deepEqual(reasons(s), []);
  assert.equal(camp.rallyKeep, RALLY_KEEP.max, 'never above the band');
  // The clamp has to be REAL, not cosmetic: an unclamped 9999 would hold the
  // whole garrison, a clamped 40 forwards the five over the line.
  assert.equal(total(camp.garrison), RALLY_KEEP.max);
  assert.equal(s.squads.length, 1);
  assert.equal(total(s.squads[0].comp), 5);

  s.commands.push({ t: 'RALLY_KEEP', site: 'camp', keep: -12 });
  step(s);
  assert.equal(camp.rallyKeep, RALLY_KEEP.min, 'never below the band');
});

test('a hold-back that is not a whole number is refused, and changes nothing', () => {
  const s = fixture();
  const camp = at(s, 'camp');
  for (const keep of [3.5, '4', null, undefined, NaN, Infinity, {}]) {
    camp.rallyKeep = 12;
    s.events = [];                     // step() clears these; drainCommands does not
    s.commands.push({ t: 'RALLY_KEEP', site: 'camp', keep });
    drainCommands(s);
    assert.deepEqual(reasons(s), ['bad-keep'], `keep=${String(keep)} must be refused`);
    assert.equal(camp.rallyKeep, 12);
  }
});

test('you cannot set the hold-back on a site you do not hold', () => {
  const s = fixture();
  const cas = at(s, 'cas');
  const { ord } = harness(s);
  assert.equal(ord.issueRallyKeep(cas, 4), false, 'the order is not even queued');
  assert.equal(s.commands.length, 0);

  s.commands.push({ t: 'RALLY_KEEP', site: 'cas', keep: 4 });
  s.commands.push({ t: 'RALLY_KEEP', site: 'ghost', keep: 4 });
  drainCommands(s);
  assert.deepEqual(reasons(s), ['not-your-site', 'unknown-site']);
  assert.equal(cas.rallyKeep, RALLY_KEEP.default);
});

test('a site resumed without the field falls back to the old global', () => {
  const s = fixture();
  const camp = at(s, 'camp');
  camp.garrison = { ...emptyComp(), militia: 20 };
  camp.rallyTargets = ['f1'];
  delete camp.rallyKeep;                       // a save written before the field existed
  assert.equal(rallyKeepOf(camp), RALLY_MIN_GARRISON);
  step(s);
  assert.equal(total(camp.garrison), RALLY_MIN_GARRISON);
});

test('clampRallyKeep rounds, bounds, and never returns a surprise', () => {
  assert.equal(clampRallyKeep(RALLY_KEEP.max + 1), RALLY_KEEP.max);
  assert.equal(clampRallyKeep(RALLY_KEEP.min - 1), RALLY_KEEP.min);
  assert.equal(clampRallyKeep(7.6), 8);
  assert.equal(clampRallyKeep(undefined), RALLY_KEEP.default);
  assert.equal(clampRallyKeep(null), RALLY_KEEP.default);
  assert.equal(clampRallyKeep('nope'), RALLY_KEEP.default);
  // Not a number the band can contain, so it is not clamped into it — the
  // command path refuses Infinity outright before this ever sees it.
  assert.equal(clampRallyKeep(Infinity), RALLY_KEEP.default);
});

test('capturing a site clears the previous owner\'s standing order', () => {
  const s = fixture();
  const hold = at(s, 'hold');
  hold.rallyKeep = RALLY_KEEP.max;
  hold.rallyTargets = ['f1'];
  hold.hp = 1;
  hold.siege = { owner: 'enemy', comp: { ...emptyComp(), militia: 30 } };
  step(s);
  assert.equal(hold.owner, 'enemy');
  assert.deepEqual(hold.rallyTargets, []);
  assert.equal(hold.rallyKeep, RALLY_KEEP.default);
});
