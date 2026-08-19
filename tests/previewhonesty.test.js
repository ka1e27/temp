// THE DRAG PREVIEW DREW A ROUTE ONTO A MOUNTAIN THAT THE ORDER THEN REFUSED.
//
// Invariant 3 is that a pre-commit preview calls the same function the
// simulation runs, so it is a guarantee rather than an estimate. For a
// bare-ground march it was not: `previewPath` builds its route with
// `pathThrough`, whose A* uses `occupancy.js passableFor`, and that gives the
// GOAL hex a free pass BEFORE consulting `isBlocked` so a column can target a
// building it means to assault. Nothing confined that exemption to buildings.
//
// Measured live on a generated map with eleven blocked hexes: aiming a drag at
// rock produced a confident seven-hex path ending on it, drawn hex by hex with
// a chevron on the final tile, and releasing produced no squad and a rejection
// banner. `render/routes.js drawDragArc`'s own comment claimed the two asked
// the same question. They did not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattleState } from '../src/battle/state.js';
import { clearPathCache } from '../src/battle/movement.js';
import { makeMods, CONTRACT_VERSION } from '../src/battle/contract.js';
import { emptyComp } from '../src/battle/combat.js';
import {
  cmdSend, cmdMoveSquad, marchBlocker, routeBlocker,
} from '../src/battle/marchorders.js';
import { previewPath } from '../src/screens/battle-waypoints.js';

let n = 0;
const ROCK = [6, 0];
const OPEN = [6, 3];

function board() {
  clearPathCache();
  return createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: `ph-${n++}`, seed: 5,
    grid: { cols: 13, rows: 9, blocked: [ROCK] },
    sites: [
      { id: 'camp', kind: 'camp', hex: [1, 1], owner: 'player',
        garrison: { militia: 12 }, hp: 480, hpMax: 480 },
      { id: 'ec01', kind: 'castle', hex: [9, 7], owner: 'enemy',
        garrison: { militia: 8 }, hp: 900, hpMax: 900 },
    ],
    adjacency: [],
    player: makeMods({ expedition: emptyComp() }),
    enemy: makeMods({ expedition: emptyComp() }),
    boosters: [],
    rules: { victory: 'capture-castle', hardCapMs: 600000, aiTier: 1 },
  });
}
const camp = (s) => s.sites.find((x) => x.id === 'camp');

test('the ORDER refuses a march onto rock', () => {
  // The behaviour the preview has to agree with, asserted first so the test
  // below is anchored to the real rule rather than to my reading of it.
  const s = board();
  assert.equal(cmdSend(s, { t: 'SEND', from: 'camp', toHex: ROCK, fraction: 0.5 }, 'player'),
    'bad-hex');
});

test('...and now the PREVIEW refuses it too', () => {
  // The finding. This assertion fails against every build before the fix,
  // where `previewPath` returned a full path ending on the blocked hex.
  const s = board();
  assert.equal(previewPath(s, camp(s), null, [[1, 1], ROCK]), null);
});

test('a march to OPEN ground still previews a real route', () => {
  // The negative control that matters most: the whole point of the bare-ground
  // march is that it works, and a blunter fix would have killed it.
  const s = board();
  const path = previewPath(s, camp(s), null, [[1, 1], OPEN]);
  assert.ok(Array.isArray(path) && path.length > 1, `got ${JSON.stringify(path)}`);
  assert.deepEqual(path[path.length - 1], { q: OPEN[0], r: OPEN[1] });
  assert.equal(cmdSend(s, { t: 'SEND', from: 'camp', toHex: OPEN, fraction: 0.5 }, 'player'),
    null, 'and the order accepts the same hex');
});

test('a march at a SITE still previews, rock on the map or not', () => {
  // The preview is gated on the bare-hex path ONLY, matching where `cmdSend`
  // checks. A site is guaranteed in-grid by `assertBattleConfig`, so gating it
  // here would make the preview stricter than the order — the same class of
  // disagreement, pointing the other way.
  //
  // (`[9,7]` and not `[11,7]`: `grid` is an OFFSET rectangle, so on 13x9 a row
  // of r=7 holds q from -3 to 9. The first draft of this fixture put the castle
  // off the map, which is the gotcha CLAUDE.md records for four other fixtures.)
  const s = board();
  const path = previewPath(s, camp(s), s.sites.find((x) => x.id === 'ec01'), [[1, 1]]);
  assert.ok(Array.isArray(path) && path.length > 1);
});

test('off the map is refused by both, the same way', () => {
  // `marchBlocker` folds the two reasons together because `spawnSquad` answers
  // an impossible route with a straight line rather than a refusal — an
  // off-map order would otherwise march a column into the void on an ordinary
  // arrival tick.
  const s = board();
  const off = [99, 99];
  assert.equal(previewPath(s, camp(s), null, [[1, 1], off]), null);
  assert.equal(cmdSend(s, { t: 'SEND', from: 'camp', toHex: off, fraction: 0.5 }, 'player'),
    'bad-hex');
});

test('the two commands and the preview share ONE predicate', () => {
  // Asserted as behaviour across all three callers rather than by reading the
  // source: three copies of this rule is how the preview came to be missing it.
  const s = board();
  assert.equal(marchBlocker(s, { q: ROCK[0], r: ROCK[1] }), 'bad-hex');
  assert.equal(marchBlocker(s, { q: OPEN[0], r: OPEN[1] }), null);
  s.squads.push({
    id: 1, owner: 'player', camped: true, hex: [2, 2],
    comp: { ...emptyComp(), militia: 4 }, path: [{ q: 2, r: 2 }],
    spawnTick: 0, arriveTick: 0, from: null, to: null,
  });
  assert.equal(cmdMoveSquad(s, { t: 'MOVE_SQUAD', squadId: 1, toHex: ROCK, fraction: 1 }, 'player'),
    'bad-hex');
});

test('a null target is not "blocked" — it is simply no target', () => {
  // `marchBlocker` is called on every pointermove that crosses a hex, and a
  // drag in progress often has no end yet. Answering 'bad-hex' there would
  // suppress the preview for every ordinary drag.
  const s = board();
  assert.equal(marchBlocker(s, null), null);
  assert.equal(marchBlocker(s, undefined), null);
});

// ---------------------------------------------------------------------------
// ...and the same question of every STOP on a drawn route
// ---------------------------------------------------------------------------

test('a route DRAWN THROUGH a mountain is refused', () => {
  // The critic flagged this as a reasoned extension and did not test it. It is
  // real, and it was a SIM bug rather than a preview one: `pathThrough` stitches
  // one A* leg per stop and `passableFor` waives the terrain check for each
  // LEG'S GOAL, so an intermediate waypoint got the same free pass the
  // destination did. Only the final `toHex` was ever validated.
  //
  // Measured before the fix: the order was ACCEPTED, and the resulting squad's
  // path was 9 hexes with one step standing on blocked rock. Mountains are the
  // one piece of terrain the game promises is impassable, and a player could
  // walk an army through one by drawing the road themselves.
  const s = board();
  assert.equal(cmdSend(s, {
    t: 'SEND', from: 'camp', toHex: OPEN, fraction: 0.5, waypoints: [ROCK],
  }, 'player'), 'bad-waypoint');
  assert.equal(s.squads.length, 0, 'and no column was created');
});

test('a route drawn through OPEN ground is still accepted', () => {
  // The negative control: drawing a road is the feature, and it must survive.
  const s = board();
  assert.equal(cmdSend(s, {
    t: 'SEND', from: 'camp', toHex: OPEN, fraction: 0.5, waypoints: [[3, 2]],
  }, 'player'), null);
  assert.equal(s.squads.length, 1);
});

test('no waypoints at all is not a bad route', () => {
  // Every order the AI and the harness issue omits `waypoints` entirely — which
  // is also why this whole change cannot move a measured number.
  const s = board();
  assert.equal(routeBlocker(s, { q: OPEN[0], r: OPEN[1] }, undefined), null);
  assert.equal(routeBlocker(s, { q: OPEN[0], r: OPEN[1] }, null), null);
  assert.equal(routeBlocker(s, { q: OPEN[0], r: OPEN[1] }, []), null);
});

test('a camped force cannot be re-tasked through rock either', () => {
  const s = board();
  s.squads.push({
    id: 1, owner: 'player', camped: true, hex: [2, 2],
    comp: { ...emptyComp(), militia: 4 }, path: [{ q: 2, r: 2 }],
    spawnTick: 0, arriveTick: 0, from: null, to: null,
  });
  assert.equal(cmdMoveSquad(s, {
    t: 'MOVE_SQUAD', squadId: 1, toHex: OPEN, fraction: 1, waypoints: [ROCK],
  }, 'player'), 'bad-waypoint');
});
