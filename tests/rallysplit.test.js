// SPLITTING a rally: one site feeding several neighbours, in turn.
//
// A rear stronghold sitting behind two fronts used to be forced to pick one of
// them, because `rallyTarget` was a single id — so the player either split the
// garrison by hand every few seconds or let one front starve. It is a list now,
// and battle/rally.js takes the targets in strict rotation.
//
// The cursor that does that rotating lives in SIM STATE on purpose. Everything
// read during a tick has to, or a replay driven from the command log diverges
// from the battle it is replaying, and the "zero randomness in combat" promise
// stops being checkable. The determinism test at the bottom is the guard on that.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createBattleState, rallyTargetsOf, ralliesTo } from '../src/battle/state.js';
import { drainCommands } from '../src/battle/commands.js';
import { rallyPhase, nextRallyTarget } from '../src/battle/rally.js';
import { step } from '../src/battle/sim.js';
import { makeMods, CONTRACT_VERSION } from '../src/battle/contract.js';
import { emptyComp } from '../src/battle/combat.js';

/** A hub with three neighbours, so "alternates" is distinguishable from
 *  "flip-flops" and from "always picks the first one". */
function fixture() {
  return createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: 'split',
    seed: 1,
    grid: { cols: 11, rows: 9, blocked: [] },
    sites: [
      { id: 'hub', kind: 'camp', hex: [2, 2], owner: 'player', garrison: { militia: 40 }, hp: 600, hpMax: 600 },
      { id: 'west', kind: 'farm', hex: [1, 2], owner: 'player', garrison: {}, hp: 100, hpMax: 100 },
      { id: 'east', kind: 'farm', hex: [3, 2], owner: 'player', garrison: {}, hp: 100, hpMax: 100 },
      { id: 'north', kind: 'farm', hex: [2, 1], owner: 'player', garrison: {}, hp: 100, hpMax: 100 },
    ],
    adjacency: [['hub', 'west'], ['hub', 'east'], ['hub', 'north']],
    player: makeMods({ expedition: emptyComp(), startGold: 1000 }),
    enemy: makeMods({ expedition: emptyComp() }),
    boosters: [],
    rules: { victory: 'capture-castle', hardCapMs: 480000, aiTier: 1 },
  });
}

const hub = (s) => s.sites.find((x) => x.id === 'hub');
const rally = (state, target, mode) => {
  state.commands.push({ t: 'RALLY', site: 'hub', target, mode });
  drainCommands(state);
};
/**
 * Where each rally send went, in order.
 *
 * The hub is topped back up between ticks because a rally forwards its WHOLE
 * surplus in one go — so alternation is visible across sends, not across
 * consecutive ticks, and the site that actually does this in a battle is one
 * that keeps training. `refill: false` models a site that does not.
 */
function sendsOver(state, ticks, { refill = 40 } = {}) {
  const out = [];
  for (let i = 0; i < ticks; i++) {
    if (refill) hub(state).garrison = { ...emptyComp(), militia: refill };
    const before = state.squads.length;
    rallyPhase(state);
    for (let k = before; k < state.squads.length; k++) out.push(state.squads[k].to);
  }
  return out;
}

test('rally split: a second target is ADDED, not substituted', () => {
  const state = fixture();
  rally(state, 'west', 'toggle');
  rally(state, 'east', 'toggle');
  assert.deepEqual(rallyTargetsOf(hub(state)), ['west', 'east']);
});

test('rally split: dragging an existing link again removes just that one', () => {
  const state = fixture();
  rally(state, 'west', 'toggle');
  rally(state, 'east', 'toggle');
  rally(state, 'west', 'toggle');
  assert.deepEqual(rallyTargetsOf(hub(state)), ['east'],
    'removing one link must not take the other down with it');
});

test('rally split: a null target still clears everything at once', () => {
  const state = fixture();
  rally(state, 'west', 'toggle');
  rally(state, 'east', 'toggle');
  rally(state, null);
  assert.deepEqual(rallyTargetsOf(hub(state)), []);
});

test('rally split: two targets are fed in strict alternation', () => {
  const state = fixture();
  rally(state, 'west', 'toggle');
  rally(state, 'east', 'toggle');
  // The hub holds 40 and keeps 8, so it can send on every tick for a while.
  assert.deepEqual(sendsOver(state, 4), ['west', 'east', 'west', 'east']);
});

test('rally split: three targets rotate rather than ping-pong', () => {
  const state = fixture();
  for (const id of ['west', 'east', 'north']) rally(state, id, 'toggle');
  assert.deepEqual(sendsOver(state, 6),
    ['west', 'east', 'north', 'west', 'east', 'north']);
});

test('rally split: a tick that cannot afford to send does not skip a target', () => {
  // The cursor advances on a SEND, never on a think. If it advanced regardless,
  // a site sitting under its hold-back would silently rotate past destinations
  // and the split would stop being even — which is the whole promise.
  const state = fixture();
  rally(state, 'west', 'toggle');
  rally(state, 'east', 'toggle');
  assert.deepEqual(sendsOver(state, 1), ['west']);

  hub(state).garrison = { ...emptyComp(), militia: 2 };   // below the hold-back
  assert.deepEqual(sendsOver(state, 3, { refill: 0 }), [], 'nothing sent while starved');

  assert.deepEqual(sendsOver(state, 1), ['east'], 'resumes where it left off');
});

test('rally split: a target that stops being legal is dropped, not skipped forever', () => {
  const state = fixture();
  rally(state, 'west', 'toggle');
  rally(state, 'east', 'toggle');
  // The enemy takes west. `nextRallyTarget` prunes it and east keeps flowing.
  state.sites.find((x) => x.id === 'west').owner = 'enemy';
  state.sites.find((x) => x.id === 'west').adj = [];
  hub(state).adj = ['east', 'north'];

  assert.equal(nextRallyTarget(state, hub(state)).id, 'east');
  assert.deepEqual(rallyTargetsOf(hub(state)), ['east'], 'the dead link is pruned');
});

test('rally split: the reciprocal-loop guard drops one link, not the whole list', () => {
  // Two sites rallying into each other pump troops back and forth forever. The
  // newer order wins. With lists that must cost the loser exactly the offending
  // link — a hub feeding two neighbours keeps the innocent one.
  const state = fixture();
  rally(state, 'west', 'toggle');
  rally(state, 'east', 'toggle');

  state.commands.push({ t: 'RALLY', site: 'west', target: 'hub', mode: 'toggle' });
  drainCommands(state);

  assert.ok(ralliesTo(state.sites.find((x) => x.id === 'west'), 'hub'));
  assert.deepEqual(rallyTargetsOf(hub(state)), ['east'],
    'only the hub->west link is dropped');
});

test('rally split: capture clears the standing order and the cursor with it', () => {
  const state = fixture();
  rally(state, 'west', 'toggle');
  rally(state, 'east', 'toggle');
  sendsOver(state, 1);
  assert.equal(hub(state).rallyCursor, 1);

  hub(state).siege = { owner: 'enemy', comp: { ...emptyComp(), militia: 99 } };
  hub(state).hp = 0;
  step(state);

  assert.deepEqual(rallyTargetsOf(hub(state)), []);
  assert.equal(hub(state).rallyCursor, 0, 'a stale cursor would misalign the next owner');
});

test('rally split: a split rally is deterministic under replay', () => {
  // The property the sim-owned cursor exists for. Same orders, same ticks, same
  // battle — byte for byte, because nothing here reads a clock or an RNG.
  const run = () => {
    const state = fixture();
    rally(state, 'west', 'toggle');
    rally(state, 'east', 'toggle');
    rally(state, 'north', 'toggle');
    for (let i = 0; i < 30; i++) step(state);
    return JSON.stringify(state.squads.map((q) => [q.from, q.to, q.arriveTick]));
  };
  assert.equal(run(), run());
});
