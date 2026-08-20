// TROOPS ON A TILE BEHAVE LIKE TROOPS IN A BUILDING.
//
// `MOVE_SQUAD` had been in the engine since squads learned to camp — four
// comments across the simulation name it as the way a camped army is re-tasked
// — and NOTHING in the game could issue one. The only caller in the whole tree
// was a test in tests/vision.test.js, using it as a fixture rather than
// exercising it. So the rule "stop on open ground and you keep your options"
// was true of the simulation and false of the game.
//
// Two halves were missing and this file pins both:
//
//   the ORDER — a camped force divides on `fraction` and `filter` exactly as a
//   garrison does, and what is not ordered anywhere stays camped where it was;
//   the GESTURE — battle-drag.js resolves a drag off a camped force down the
//   same four branches a drag off a building takes.
//
// The negative controls are the half that matters. A split that quietly moved
// everything, or a camped branch that fired on an in-flight column, would both
// look perfectly healthy from the outside.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattleState } from '../src/battle/state.js';
import { drainCommands } from '../src/battle/commands.js';
import { spawnSquad, clearPathCache, squadHexOf } from '../src/battle/movement.js';
import { marchCamped } from '../src/battle/retreat.js';
import { emptyComp, total } from '../src/battle/combat.js';
import { makeMods, CONTRACT_VERSION } from '../src/battle/contract.js';
import { resolveDrag, ownSquadAt } from '../src/screens/battle-drag.js';

const comp = (o) => ({ ...emptyComp(), ...o });
let n = 0;

function board(blocked = []) {
  clearPathCache();
  return createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: `camped-${n++}`,
    seed: 5,
    grid: { cols: 13, rows: 11, blocked },
    sites: [
      { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 10 }, hp: 600, hpMax: 600 },
      { id: 'farm', kind: 'farm', hex: [8, 0], owner: 'enemy', garrison: { militia: 2 }, hp: 100, hpMax: 100 },
    ],
    adjacency: [['camp', 'farm']],
    player: makeMods({}),
    enemy: makeMods({}),
    boosters: [],
    rules: { victory: 'capture-castle', hardCapMs: 60000, aiTier: 1 },
  });
}

/** An army of `c` standing still on hex [4,0], the way one that marched onto
 *  bare ground and arrived would be. */
function camped(s, c = { militia: 20, rams: 4 }) {
  const sq = spawnSquad(s, {
    owner: 'player', from: 'camp', to: null, toHex: { q: 4, r: 0 }, comp: comp(c),
  });
  sq.camped = true;
  sq.hex = [4, 0];
  sq.path = [{ q: 4, r: 0 }];
  sq.from = null;
  sq.to = null;
  return sq;
}

const move = (s, cmd) => {
  s.commands.push({ t: 'MOVE_SQUAD', ...cmd });
  drainCommands(s);
};

// ---------------------------------------------------------------------------
// The order divides
// ---------------------------------------------------------------------------

test('half a camped force marches and the other half stays exactly where it was', () => {
  const s = board();
  const sq = camped(s, { militia: 20 });
  const before = s.squads.length;

  move(s, { squadId: sq.id, to: 'farm', fraction: 0.5 });

  assert.equal(s.squads.length, before + 1, 'the half that marches is its own column');
  const stay = s.squads.find((x) => x.id === sq.id);
  const gone = s.squads.find((x) => x.id !== sq.id);
  assert.equal(total(stay.comp), 10, 'the remainder is what was not ordered');
  assert.equal(total(gone.comp), 10);
  assert.equal(stay.camped, true, 'and it is still standing, not drifting home');
  assert.deepEqual(stay.hex, [4, 0], 'on the same hex');
  assert.equal(gone.camped, false, 'while the ordered half is marching');
  assert.equal(gone.to, 'farm');
});

test('the whole force re-tasks IN PLACE rather than spawning a sibling', () => {
  const s = board();
  const sq = camped(s, { militia: 20 });
  const before = s.squads.length;

  move(s, { squadId: sq.id, to: 'farm', fraction: 1 });

  // A squad that spawned a sibling and then emptied itself would leave a
  // zero-strength camp on the board that every consumer would have to learn to
  // ignore — the class of state this project has already been bitten by.
  assert.equal(s.squads.length, before, 'no second column');
  const same = s.squads.find((x) => x.id === sq.id);
  assert.equal(total(same.comp), 20);
  assert.equal(same.camped, false);
  assert.equal(same.to, 'farm');
});

test('the troop filter picks WHICH bodies march, and leaves the rest camped', () => {
  const s = board();
  const sq = camped(s, { militia: 20, rams: 4 });

  move(s, { squadId: sq.id, to: 'farm', fraction: 1, filter: ['rams'] });

  const stay = s.squads.find((x) => x.id === sq.id);
  const gone = s.squads.find((x) => x.id !== sq.id);
  assert.equal(gone.comp.rams, 4, 'the engines went');
  assert.equal(gone.comp.militia, 0);
  assert.equal(stay.comp.militia, 20, 'the line stayed');
  assert.equal(stay.comp.rams, 0);
  assert.equal(stay.camped, true);
});

test('a fraction that rounds to nobody is refused, not silently obeyed', () => {
  const s = board();
  const sq = camped(s, { militia: 1 });
  const before = s.squads.length;

  s.commands.push({ t: 'MOVE_SQUAD', squadId: sq.id, to: 'farm', fraction: 0 });
  drainCommands(s);

  assert.equal(s.squads.length, before);
  assert.equal(s.squads[0].camped, true, 'the army has not moved');
  assert.equal(total(s.squads[0].comp), 1, 'and has not lost anybody');
});

// THIS TEST USED TO ASSERT THE OPPOSITE and is rewritten rather than deleted,
// because the refusal it pinned was an implementation artefact and the whole
// point of removing it is that correcting a wrong-way march used to cost three
// legs. See marchorders.js `cmdMoveSquad` for the measurement.
test('an army in TRANSIT can be re-aimed, and does not teleport doing it', () => {
  const s = board();
  const sq = spawnSquad(s, {
    owner: 'player', from: 'camp', to: 'farm', comp: comp({ militia: 10 }),
  });
  // Let it get properly under way, so "where is it now" is not "where it began".
  s.tick += 3;
  const wasAt = squadHexOf(s, sq);

  move(s, { squadId: sq.id, toHex: [4, 0], fraction: 1 });

  assert.equal(s.squads.length, 1, 'the whole force re-tasks in place');
  const re = s.squads[0];
  assert.equal(re.to, null, 'and is now bound for bare ground');
  // THE ANCHOR, which is the half that silently breaks: position is
  // (tick - spawnTick) / (arriveTick - spawnTick) along `path`, so a re-task
  // that moved `arriveTick` without re-anchoring `spawnTick` would make the
  // column JUMP — the march booster's own bug. It must still be where it was.
  assert.equal(re.spawnTick, s.tick, 'the schedule is re-anchored to now');
  const nowAt = squadHexOf(s, re);
  assert.deepEqual({ q: nowAt.q, r: nowAt.r }, { q: wasAt.q, r: wasAt.r },
    'the re-task must not move the army');
  assert.ok(re.arriveTick > s.tick, 'and it has somewhere still to go');
});

test('a marching column can be SPLIT, and the remainder keeps its own orders', () => {
  const s = board();
  const sq = spawnSquad(s, {
    owner: 'player', from: 'camp', to: 'farm', comp: comp({ militia: 10 }),
  });
  s.tick += 3;
  const { to, arriveTick } = sq;

  move(s, { squadId: sq.id, toHex: [4, 0], fraction: 0.5 });

  assert.equal(s.squads.length, 2, 'the detachment is its own column');
  const rest = s.squads.find((x) => x.id === sq.id);
  assert.equal(total(rest.comp), 5);
  assert.equal(rest.to, to, 'the remainder is still going where it was going');
  assert.equal(rest.arriveTick, arriveTick, 'on the schedule it set out with');
  const off = s.squads.find((x) => x.id !== sq.id);
  assert.equal(total(off.comp), 5);
  assert.equal(off.to, null);
});

test('a split validates its route BEFORE it takes anybody out of the camp', () => {
  // Walled in at creation, NOT by pushing to `s.grid.blocked` afterwards: that
  // list is turned into a lookup once, when the state is built, so a test that
  // mutates it later blocks nothing and quietly asserts the happy path.
  // (`grid` is an OFFSET rectangle — it holds no negative `r` at all — so the
  // four hexes below are every on-board neighbour [4,0] has.)
  const s = board([[5, 0], [3, 0], [4, 1], [3, 1]]);
  const sq = camped(s, { militia: 20 });

  move(s, { squadId: sq.id, to: 'farm', fraction: 0.5 });

  assert.equal(s.squads.length, 1, 'nothing was spawned');
  assert.equal(total(s.squads[0].comp), 20, 'and nobody was debited');
  assert.equal(s.squads[0].camped, true);
});

// ---------------------------------------------------------------------------
// The gesture resolves
// ---------------------------------------------------------------------------

/** The two things battle-drag.js asks of `ord`, and a log of what it issued. */
function fakeOrders(s, squadHit = null) {
  const issued = [];
  return {
    issued,
    squadAt: () => squadHit,
    site: (id) => s.sites.find((x) => x.id === id) || null,
    isDrawnRoute: () => false,
    trimWaypoints: () => [],
    selectOnly: () => {},
    issueSend: (from, to, o) => { issued.push({ t: 'SEND', from: from.id, to: to?.id ?? null, ...o }); return true; },
    sendFromSelection: (to, o) => { issued.push({ t: 'MULTI', to: to?.id ?? null, ...o }); return 1; },
    issueMove: (sq, to, o) => { issued.push({ t: 'MOVE', squadId: sq.id, to: to?.id ?? null, ...o }); return true; },
  };
}

const dragView = (over) => ({
  dragFrom: null, dragFromSquad: null, dragTo: null,
  dragTrail: [], dragSources: null, armed: null, ...over,
});

test('a drag off a camped force onto a site issues a MOVE, never a SEND', () => {
  const s = board();
  const sq = camped(s);
  const ord = fakeOrders(s, sq);
  const view = dragView({ dragFromSquad: sq.id, dragTo: 'farm' });

  assert.equal(resolveDrag(ord, view, s), true);
  assert.deepEqual(ord.issued.map((c) => c.t), ['MOVE']);
  assert.equal(ord.issued[0].squadId, sq.id);
  assert.equal(ord.issued[0].to, 'farm');
});

test('...and onto bare ground it names the hex the finger ended on', () => {
  const s = board();
  const sq = camped(s);
  const ord = fakeOrders(s, sq);
  const view = dragView({ dragFromSquad: sq.id, dragTrail: [[4, 0], [5, 0], [6, 0]] });

  assert.equal(resolveDrag(ord, view, s), true);
  assert.equal(ord.issued[0].t, 'MOVE');
  assert.equal(ord.issued[0].to, null);
  assert.deepEqual(ord.issued[0].toHex, [6, 0]);
});

test('a drag off a BUILDING is untouched by any of this', () => {
  const s = board();
  const ord = fakeOrders(s);
  const view = dragView({ dragFrom: 'camp', dragTo: 'farm' });

  assert.equal(resolveDrag(ord, view, s), true);
  assert.deepEqual(ord.issued.map((c) => c.t), ['SEND'],
    'the camped branch must not intercept an ordinary send');
});

test('a drag from nothing resolves nothing, so the caller can box-select', () => {
  const s = board();
  const ord = fakeOrders(s);
  assert.equal(resolveDrag(ord, dragView({}), s), false);
  assert.equal(ord.issued.length, 0);
});

// This test used to assert that a column IN TRANSIT was refused as a drag
// source, which was the rule until `cmdMoveSquad` learned to re-task one in
// flight. Rewritten rather than relaxed: the in-transit case flipped and is
// now the interesting half, and ownership is the filter that remains.
test('ownSquadAt takes your own force, marching or standing, and no one else', () => {
  const s = board();
  const marching = spawnSquad(s, {
    owner: 'player', from: 'camp', to: 'farm', comp: comp({ militia: 5 }),
  });
  assert.equal(ownSquadAt(fakeOrders(s, marching), s, 0, 0), marching,
    'a column in flight must be draggable, or MOVE_SQUAD has no caller again');

  const theirs = camped(s, { militia: 5 });
  theirs.owner = 'enemy';
  assert.equal(ownSquadAt(fakeOrders(s, theirs), s, 0, 0), null, 'not yours');

  const mine = camped(s, { militia: 5 });
  assert.equal(ownSquadAt(fakeOrders(s, mine), s, 0, 0), mine, 'yours, and standing');
});

test('marchCamped is still the whole-force path it always was', () => {
  // A negative control on the refactor itself: the older re-task helper is
  // untouched, so a retreat or an arrival that leans on it cannot have
  // acquired a fraction by accident.
  const s = board();
  const sq = camped(s, { militia: 12 });
  assert.equal(marchCamped(s, sq, { to: 'farm' }), true);
  assert.equal(total(sq.comp), 12);
  assert.equal(s.squads.length, 1);
});
