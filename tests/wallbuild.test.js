// UNDER PRESSURE YOU BUILD A WALL, NOT A FARM — the bot's fifth build rule.
//
// `constructTurn`'s rule 1 said the bot never builds a stronghold at any
// pressure, on the argument that levelling ground you already hold is cheaper
// per point of defence than raising one from nothing. That is true, and it is
// not the whole of what a player does. Measured on obsidian, a run the bot LOST:
// seven farms raised and seven razed while its army collapsed. Nobody under that
// much pressure keeps laying farmland.
//
// IT SHIPS OFF, AND THAT IS THE RESULT RATHER THAN A HEDGE. Measured, n=16,
// matched seeds: gallowmoor 50% -> 25%, thanescar 25% -> 13%. The mechanism is
// in `simbuild.js`'s own docblock — `underPressure` is true on 57% of thinks,
// so it is the normal state of a battle rather than an emergency, and the rule
// spends the OPENING on two 500g buildings that produce nothing.
//
// The code and these tests stay so the delta is re-takeable rather than
// remembered, and so the next person to have this idea finds the measurement
// instead of rebuilding it. `--wall` opts in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { constructTurn, buildHexes } from '../tools/simbuild.js';
import { CENTIGOLD } from '../src/content/balance.js';
import { createBattleState } from '../src/battle/state.js';
import { makeMods, CONTRACT_VERSION } from '../src/battle/contract.js';
import { emptyComp } from '../src/battle/combat.js';
import { recomputeInfluence } from '../src/battle/influence.js';

let n = 0;

/**
 * A board where the bot can legally build, with a THREAT that can be switched
 * on and off — the only difference between the two halves of every assertion
 * below, so a delta cannot come from anywhere else.
 *
 * A REAL `createBattleState`, not a stub: `constructTurn` reads the influence
 * flood through `buildBlocker` and the training bill through the sim's own
 * `factionTrainCostPerSec`, and a hand-built object thin enough to look
 * sufficient throws inside one of them.
 */
function board({ threat = false, walls = 0, yards = 3, gold = 4000 } = {}) {
  const sites = [
    // Two ranks, so `rearOf` has a gradient to work with: the front site borders
    // the enemy and the rear one does not.
    { id: 'front', kind: 'farm', hex: [6, 2], owner: 'player',
      garrison: { militia: 6 }, hp: 100, hpMax: 100 },
    { id: 'rear', kind: 'camp', hex: [1, 2], owner: 'player',
      garrison: { militia: 8 }, hp: 480, hpMax: 480, trainType: 'militia' },
  ];
  for (let i = 0; i < yards; i++) {
    sites.push({ id: `y${i}`, kind: 'trainingGround', hex: [1 + i, 4], owner: 'player',
      garrison: {}, hp: 180, hpMax: 180, trainType: 'militia' });
  }
  for (let i = 0; i < walls; i++) {
    sites.push({ id: `w${i}`, kind: 'stronghold', hex: [1 + i, 6], owner: 'player',
      garrison: {}, hp: 340, hpMax: 340 });
  }
  sites.push({ id: 'castle', kind: 'castle', hex: [13, 2], owner: 'enemy',
    garrison: { militia: 10 }, hp: 900, hpMax: 900 });
  const state = createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: `wall-${n++}`, seed: 1,
    grid: { cols: 16, rows: 11, blocked: [] },
    sites,
    adjacency: [],
    player: makeMods({ expedition: emptyComp() }),
    enemy: makeMods({ expedition: emptyComp() }),
    boosters: [],
    rules: { victory: 'capture-castle', hardCapMs: 600000, aiTier: 1 },
  });
  recomputeInfluence(state);
  state.factions.player.goldCg = Math.round(gold * CENTIGOLD);
  // THE SIEGE GOES ON AFTER, and that is the documented gotcha rather than a
  // style choice: `createBattleState` rebuilds every site from a FIXED FIELD
  // LIST, so a `siege` set on the config's site list is silently dropped and the
  // board comes back peaceful. The first draft of this fixture did exactly that
  // and read as the rule not firing.
  if (threat) {
    const front = state.sites.find((s) => s.id === 'front');
    front.siege = { owner: 'enemy', comp: { militia: 5 }, ticks: 30 };
  }
  return state;
}

/** What `constructTurn` decides to raise, or null. */
function builds(state, opts = {}) {
  const front = {};
  for (const s of state.sites) {
    if (s.owner !== 'player') continue;
    // Distance to the nearest thing somebody else holds — the same quantity
    // `simplayer.js frontDistance` computes, built here so the fixture states
    // its own gradient rather than depending on that function's internals.
    let best = Infinity;
    for (const f of state.sites) {
      if (f.owner === 'player') continue;
      const d = (Math.abs(s.hex[0] - f.hex[0]) + Math.abs(s.hex[1] - f.hex[1])
        + Math.abs((s.hex[0] + s.hex[1]) - (f.hex[0] + f.hex[1]))) / 2;
      if (d < best) best = d;
    }
    front[s.id] = best;
  }
  state.commands.length = 0;
  constructTurn(state, front, buildHexes(state), opts);
  return state.commands.find((c) => c.t === 'BUILD') ?? null;
}

test('a quiet board still builds a farm', () => {
  // THE NEGATIVE CONTROL, and it is the one that matters: the rule must be inert
  // when nothing is happening, or it is not a pressure rule, it is a policy
  // change that would move every measured number in regions.data.js.
  const cmd = builds(board({ threat: false }));
  assert.ok(cmd, 'the fixture must be able to build at all, or nothing below means anything');
  assert.equal(cmd.kind, 'farm');
});

test('...and the same board under attack builds a wall', () => {
  const cmd = builds(board({ threat: true }), { walls: true });
  assert.ok(cmd);
  assert.equal(cmd.kind, 'stronghold');
});

test('the yard still outranks the wall', () => {
  // A bot with no way to make troops has a worse problem than a bot being shot
  // at, and rule 1 is already the answer to it. Under pressure AND short of
  // yards, the yard wins.
  const cmd = builds(board({ threat: true, yards: 0 }), { walls: true });
  assert.ok(cmd);
  assert.equal(cmd.kind, 'trainingGround');
});

test('it stops at WANT_WALLS rather than paving the map', () => {
  // A third wall is a builder's answer to a problem that is plainly not being
  // solved by building.
  assert.equal(builds(board({ threat: true, walls: 1 }), { walls: true }).kind, 'stronghold');
  assert.equal(builds(board({ threat: true, walls: 2 }), { walls: true }).kind, 'farm');
});

test('OFF BY DEFAULT is the shipped behaviour, and it is the measured one', () => {
  // The assertion that matters most in this file: every number in
  // regions.data.js is taken with the wall rule off, so a default that drifted
  // on would silently re-tune the whole campaign by ~-18 points.
  const cmd = builds(board({ threat: true }));
  assert.ok(cmd);
  assert.equal(cmd.kind, 'farm', 'rule 5 must not fire without --wall');
});

test('a CAMPED enemy column is not pressure', () => {
  // The distinction `aihome.js encroachment` exists to make for the AI, applied
  // here: a stack parked next door has not moved against anything, and a wall
  // raised at 1 HP against a force that never comes is worse than the farm it
  // replaced.
  const state = board({ threat: false });
  state.squads.push({
    id: 'q1', owner: 'enemy', comp: { militia: 20 }, camped: true, to: null,
    from: null, hex: { q: 5, r: 2 }, path: [{ q: 5, r: 2 }], spawnTick: 0, arriveTick: 0,
  });
  assert.equal(builds(state, { walls: true }).kind, 'farm');
});

test('...but a column actually inbound to my ground is', () => {
  const state = board({ threat: false });
  state.squads.push({
    id: 'q2', owner: 'enemy', comp: { militia: 20 }, camped: false, to: 'front',
    from: 'castle', hex: { q: 9, r: 2 }, path: [{ q: 9, r: 2 }], spawnTick: 0, arriveTick: 200,
  });
  assert.equal(builds(state, { walls: true }).kind, 'stronghold');
});

test('the wall goes BEHIND THE THREAT, not toward the throne', () => {
  // Rule 4 and rule 5 want opposite things from the same scan. Scoring a wall by
  // distance to the throne would put it at the far end of the country from
  // whatever is being attacked — legal, useless, and exactly the shape of "it
  // built something while it was losing" this rule exists to fix.
  const wall = builds(board({ threat: true }), { walls: true });
  const farm = builds(board({ threat: false }), { walls: true });
  assert.equal(wall.kind, 'stronghold');
  assert.equal(farm.kind, 'farm');
  const dist = (hex, to) => (Math.abs(hex[0] - to[0]) + Math.abs(hex[1] - to[1])
    + Math.abs((hex[0] + hex[1]) - (to[0] + to[1]))) / 2;
  // `front` at [6,2] is the besieged site; the throne is at [13,2].
  assert.ok(dist(wall.hex, [6, 2]) <= dist(farm.hex, [6, 2]),
    `the wall landed ${dist(wall.hex, [6, 2])} hexes from the site under siege and the `
    + `farm ${dist(farm.hex, [6, 2])} — the wall must be the one that is closer`);
});
