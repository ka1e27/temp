// Chained sends and chained rallies.
//
// Sends are adjacency-only, which is the rule that makes the site graph mean
// anything. Chaining does not break it — it lets ONE order express several
// legal hops instead of making the player issue each one and babysit every
// arrival. So the interesting assertions are all about what is still REFUSED.
//
// Two different mechanisms, deliberately:
//   - a chained SEND is one squad with a multi-leg route, arriving once;
//   - a chained RALLY is a rally on every site along the road, because rallies
//     already cascade and the sim needs no multi-hop concept at all.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createBattleState } from '../src/battle/state.js';
import { drainCommands } from '../src/battle/commands.js';
import { step } from '../src/battle/sim.js';
import { makeMods, CONTRACT_VERSION } from '../src/battle/contract.js';
import { emptyComp, total } from '../src/battle/combat.js';
import { travelTicks, routeTicks } from '../src/battle/movement.js';
import { createOrders } from '../src/screens/battle-orders.js';
import { createView } from '../src/screens/battle-input.js';
import { EVENTS } from '../src/battle/events.js';

/** A line of four sites: camp - mid - far - foe. Only `foe` is hostile. */
function fixture() {
  return createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: 'chain',
    seed: 1,
    grid: { cols: 13, rows: 9, blocked: [] },
    sites: [
      { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 40 }, hp: 600, hpMax: 600 },
      { id: 'mid', kind: 'farm', hex: [2, 0], owner: 'player', garrison: { militia: 4 }, hp: 100, hpMax: 100 },
      { id: 'far', kind: 'farm', hex: [4, 0], owner: 'player', garrison: { militia: 4 }, hp: 100, hpMax: 100 },
      { id: 'foe', kind: 'stronghold', hex: [6, 0], owner: 'enemy', garrison: { militia: 2 }, hp: 250, hpMax: 250 },
      { id: 'side', kind: 'farm', hex: [2, 3], owner: 'neutral', garrison: { militia: 2 }, hp: 100, hpMax: 100 },
    ],
    // `side` is deliberately wired to BOTH mid and far, so camp->mid->side->far
    // is a perfectly adjacent route and the ONLY thing that can refuse it is
    // that we do not own `side`. Without that edge the ownership test passes
    // even with the ownership check deleted, which is the exact class of
    // wrong-assertion bug this suite exists to catch.
    adjacency: [['camp', 'mid'], ['mid', 'far'], ['far', 'foe'], ['mid', 'side'], ['side', 'far']],
    player: makeMods({ expedition: emptyComp(), startGold: 1000 }),
    enemy: makeMods({ expedition: emptyComp() }),
    boosters: [],
    rules: { victory: 'capture-castle', hardCapMs: 480000, aiTier: 1 },
  });
}

const siteOf = (st, id) => st.sites.find((s) => s.id === id);
const reasons = (st) => st.events
  .filter((e) => e.type === EVENTS.COMMAND_REJECTED).map((e) => e.reason);

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
  return { ord, view };
}

// ---------------------------------------------------------------------------
// Chained send
// ---------------------------------------------------------------------------

test('a chained send is ONE squad that arrives once, at the far end', () => {
  const state = fixture();
  state.commands.push({
    t: 'SEND', from: 'camp', to: 'foe', fraction: 0.5, filter: ['militia'], via: ['mid', 'far'],
  });
  drainCommands(state);

  assert.equal(state.squads.length, 1, 'a chain is one squad, not a relay');
  const sq = state.squads[0];
  assert.deepEqual(sq.route, ['camp', 'mid', 'far', 'foe']);
  assert.equal(sq.from, 'camp');
  assert.equal(sq.to, 'foe', 'from/to stay the endpoints so retreat and arrival still work');
  assert.equal(sq.legEnds.length, 3);
  assert.equal(sq.legEnds.at(-1), 1, 'the last leg must end at exactly 1');
});

test('the chain takes as long as its legs, not as long as the crow flies', () => {
  const state = fixture();
  const comp = { militia: 20 };
  const direct = travelTicks(state, siteOf(state, 'camp'), siteOf(state, 'foe'), comp, 'player');
  const chained = routeTicks(state, ['camp', 'mid', 'far', 'foe'], comp, 'player');
  assert.ok(chained.ticks > direct,
    `marching the road (${chained.ticks}) must cost more than the straight line (${direct})`);
});

test('the squad passes THROUGH its waypoints — no garrison is dropped en route', () => {
  const state = fixture();
  const midBefore = total(siteOf(state, 'mid').garrison);
  const farBefore = total(siteOf(state, 'far').garrison);
  state.commands.push({
    t: 'SEND', from: 'camp', to: 'foe', fraction: 1, filter: ['militia'], via: ['mid', 'far'],
  });
  drainCommands(state);

  const arrive = state.squads[0].arriveTick;
  for (let i = 0; state.squads.length && i < arrive + 20; i++) step(state);

  assert.equal(total(siteOf(state, 'mid').garrison), midBefore, 'mid was only passed through');
  assert.equal(total(siteOf(state, 'far').garrison), farBefore, 'far was only passed through');
  const foe = siteOf(state, 'foe');
  assert.ok(foe.owner === 'player' || foe.siege?.owner === 'player',
    'the column should have engaged the objective at the end of the road');
});

test('every leg must be adjacent — a chain cannot teleport across the graph', () => {
  const state = fixture();
  state.commands.push({
    t: 'SEND', from: 'camp', to: 'foe', fraction: 1, filter: ['militia'], via: ['far'],
  });
  drainCommands(state);
  assert.equal(state.squads.length, 0);
  assert.ok(reasons(state).includes('not-adjacent'));
});

test('you may march through your OWN ground only — never through someone else\'s', () => {
  const state = fixture();
  // Every leg here IS adjacent (camp-mid, mid-side, side-far), so adjacency
  // cannot be what refuses it. Asserting the exact reason is the point: an
  // `||` over two reasons would pass with the ownership check deleted.
  state.commands.push({
    t: 'SEND', from: 'camp', to: 'far', fraction: 1, filter: ['militia'], via: ['mid', 'side'],
  });
  drainCommands(state);
  assert.equal(state.squads.length, 0);
  assert.deepEqual(reasons(state), ['chain-not-yours']);
});

test('the FINAL stop may be hostile — that is the whole point of chaining', () => {
  const state = fixture();
  state.commands.push({
    t: 'SEND', from: 'camp', to: 'foe', fraction: 0.5, filter: ['militia'], via: ['mid', 'far'],
  });
  drainCommands(state);
  assert.equal(state.squads.length, 1);
  assert.deepEqual(reasons(state), []);
});

test('a route that revisits a stop is refused, which is also what bounds it', () => {
  const state = fixture();
  state.commands.push({
    t: 'SEND', from: 'camp', to: 'far', fraction: 1, filter: ['militia'], via: ['mid', 'far', 'mid'],
  });
  drainCommands(state);
  assert.equal(state.squads.length, 0);
  assert.ok(reasons(state).includes('chain-repeats'));
});

test('an ordinary send is untouched: no route, no legEnds, still one hop only', () => {
  const state = fixture();
  state.commands.push({ t: 'SEND', from: 'camp', to: 'mid', fraction: 0.5, filter: ['militia'] });
  drainCommands(state);
  const sq = state.squads[0];
  assert.ok(sq, 'a plain send must still work');
  assert.equal(sq.route, undefined);
  assert.equal(sq.legEnds, undefined);

  const st2 = fixture();
  st2.commands.push({ t: 'SEND', from: 'camp', to: 'far', fraction: 0.5, filter: ['militia'] });
  drainCommands(st2);
  assert.equal(st2.squads.length, 0, 'non-adjacent without a chain is still refused');
  assert.ok(reasons(st2).includes('not-adjacent'));
});

test('a retreating chained squad walks back down its own road', () => {
  const state = fixture();
  state.commands.push({
    t: 'SEND', from: 'camp', to: 'foe', fraction: 0.5, filter: ['militia'], via: ['mid', 'far'],
  });
  drainCommands(state);
  const id = state.squads[0].id;
  for (let i = 0; i < 5; i++) step(state);

  state.commands.push({ t: 'RETREAT_SQUAD', squadId: id });
  drainCommands(state);
  const sq = state.squads.find((s) => s.id === id);
  assert.ok(sq.retreating);
  assert.deepEqual(sq.route, ['foe', 'far', 'mid', 'camp'], 'the road reverses with it');
  assert.equal(sq.legEnds.at(-1), 1);
});

// ---------------------------------------------------------------------------
// Chained rally — a different mechanism on purpose
// ---------------------------------------------------------------------------

test('a chained rally sets a rally on EVERY site along the road', () => {
  const state = fixture();
  const { ord } = harness(state);

  assert.equal(
    ord.issueRallyChain(siteOf(state, 'camp'), ['mid'], siteOf(state, 'far')),
    true,
  );
  drainCommands(state);
  assert.deepEqual(siteOf(state, 'camp').rallyTargets, ['mid']);
  assert.deepEqual(siteOf(state, 'mid').rallyTargets, ['far']);
});

test('a chained rally actually moves troops down the whole chain', () => {
  const state = fixture();
  const { ord } = harness(state);
  ord.issueRallyChain(siteOf(state, 'camp'), ['mid'], siteOf(state, 'far'));
  drainCommands(state);

  const farBefore = total(siteOf(state, 'far').garrison);
  // Long enough for the camp to forward to mid AND for mid to forward on.
  for (let i = 0; i < 900; i++) step(state);
  assert.ok(total(siteOf(state, 'far').garrison) > farBefore,
    'troops never reached the end of the rally chain');
});

test('a rally chain through ground you do not hold is refused whole', () => {
  const state = fixture();
  const { ord } = harness(state);
  assert.equal(
    ord.issueRallyChain(siteOf(state, 'camp'), ['mid', 'side'], siteOf(state, 'far')),
    false,
  );
  assert.equal(state.commands.length, 0, 'a refused chain must not half-apply');
});

test('the UI refuses exactly what the simulation refuses', () => {
  const state = fixture();
  const { ord } = harness(state);
  const cases = [
    [['mid', 'far'], 'foe', true],
    [['far'], 'foe', false],          // camp is not adjacent to far
    [['mid', 'side'], 'far', false],  // side is not ours
    [['mid', 'far'], 'mid', false],   // revisits mid
  ];
  for (const [via, to, want] of cases) {
    assert.equal(ord.canChain(siteOf(state, 'camp'), via, siteOf(state, to)), want,
      `canChain(camp, [${via}], ${to})`);

    const st = fixture();
    st.commands.push({ t: 'SEND', from: 'camp', to, fraction: 1, filter: ['militia'], via });
    drainCommands(st);
    assert.equal(st.squads.length > 0, want,
      `the sim disagreed with canChain for [${via}] -> ${to}`);
  }
});
