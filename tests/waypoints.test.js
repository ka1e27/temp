// THE ROAD THE PLAYER DREW.
//
// A drag used to mean "picked up here, released there" and the pathfinder chose
// everything in between. It still does when the drag is a straight pull — that
// is the right default and most orders do not care. What is new is that a drag
// which visibly goes the long way round is HONOURED, because going the long way
// round is the only counterplay to a wall that shoots at what walks past
// (battle/towers.js) and to territory that slows an intruder (influence.js).
//
// THE FAILURE THIS FILE IS AIMED AT is the one that looks like success: the
// order is accepted, the army marches, and the waypoints were quietly dropped —
// so the route is the short one and the player's decision did nothing. A test
// that only checked "the send was accepted" would pass against exactly that.
// So every claim here compares the DELIVERED ROUTE, never the acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createBattleState } from '../src/battle/state.js';
import { drainCommands } from '../src/battle/commands.js';
import { makeMods, CONTRACT_VERSION } from '../src/battle/contract.js';
import { emptyComp, total } from '../src/battle/combat.js';
import { pathThrough, pathBetween } from '../src/battle/movement.js';
import {
  trackHex, trimWaypoints, isDrawnRoute, MAX_WAYPOINTS,
} from '../src/screens/battle-waypoints.js';

/** A wide open board: camp on the left, farm on the right, nothing between. */
function board() {
  return createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: 'waypoints',
    seed: 7,
    grid: { cols: 16, rows: 9, blocked: [] },
    sites: [
      { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 60 }, hp: 600, hpMax: 600 },
      { id: 'far', kind: 'farm', hex: [12, 0], owner: 'neutral', garrison: { militia: 1 } },
    ],
    player: makeMods({}),
    enemy: makeMods({}),
    boosters: [],
    rules: { victory: 'capture-castle', hardCapMs: 600000, aiTier: 1 },
  });
}

test('a drag that goes the long way round is actually walked the long way', () => {
  // THE HEADLINE CLAIM. Both orders have the same endpoints; only the drawn
  // road differs, and the delivered paths must differ with it.
  const direct = board();
  direct.commands.push({ t: 'SEND', from: 'camp', to: 'far', fraction: 0.5 });
  drainCommands(direct);
  const straight = direct.squads[0].path;

  const detour = board();
  // Swing four rows south of the straight line before turning back.
  const via = [[6, 4], [8, 4]];
  detour.commands.push({ t: 'SEND', from: 'camp', to: 'far', fraction: 0.5, waypoints: via });
  drainCommands(detour);
  const drawn = detour.squads[0].path;

  assert.ok(straight && drawn, 'both orders must have produced a squad');
  assert.ok(drawn.length > straight.length,
    `the detour must cost real ground (${straight.length} vs ${drawn.length}) — `
    + 'equal lengths mean the waypoints were dropped and the short road walked');
  for (const [q, r] of via) {
    assert.ok(drawn.some((h) => h.q === q && h.r === r),
      `the route never passed through the waypoint ${q},${r} it was given`);
  }
  // ...and it still ends where it was sent.
  const last = drawn[drawn.length - 1];
  assert.deepEqual([last.q, last.r], [12, 0]);
});

test('a detour costs more TIME, not just more hexes', () => {
  // A route that is longer on the board but not slower would make the whole
  // decision free, and every one of the mechanics it is counterplay to assumes
  // it is paid for.
  const s = board();
  s.commands.push({ t: 'SEND', from: 'camp', to: 'far', fraction: 0.25 });
  drainCommands(s);
  const quick = s.squads[0].arriveTick - s.squads[0].spawnTick;

  const d = board();
  d.commands.push({
    t: 'SEND', from: 'camp', to: 'far', fraction: 0.25, waypoints: [[6, 4], [8, 4]],
  });
  drainCommands(d);
  const slow = d.squads[0].arriveTick - d.squads[0].spawnTick;
  assert.ok(slow > quick, `the long way round arrived no later (${quick} vs ${slow})`);
});

test('an unreachable waypoint fails the WHOLE order, never silently drops it', () => {
  // Skipping a leg would march the army somewhere nobody pointed at, which is
  // worse than a refusal — the player would watch a route they did not draw.
  const s = board();
  const before = s.sites.find((x) => x.id === 'camp').garrison.militia;
  s.commands.push({
    t: 'SEND', from: 'camp', to: 'far', fraction: 0.5, waypoints: [[99, 99]],
  });
  drainCommands(s);
  assert.equal(s.squads.length, 0, 'an impossible route produced a marching army');
  assert.equal(s.sites.find((x) => x.id === 'camp').garrison.militia, before,
    'a refused order must not have spent the garrison');
  // THE PROPERTY IS THAT IT NAMES ITSELF, not which of the two names it uses.
  // This asserted `no-route` exactly, and the string moved when `routeBlocker`
  // started validating every stop up front: `[99,99]` is off the map, so it is
  // now caught before pathing as the more specific `bad-waypoint`. A waypoint
  // that is on the map and merely unroutable still answers `no-route`. Pinning
  // the constant would have failed a change that made the message BETTER —
  // which is the trap this project records at `resultreason`.
  assert.ok(s.events.some((e) => e.reason === 'bad-waypoint' || e.reason === 'no-route'),
    'the refusal must name itself');
});

test('pathThrough stitches legs; a straight run is byte-identical to plain A*', () => {
  // NEGATIVE CONTROL for the whole feature: with no waypoints the new code path
  // must produce exactly the old route, or every existing balance number moved.
  const s = board();
  const camp = { q: 0, r: 0 };
  const far = { q: 12, r: 0 };
  assert.deepEqual(pathThrough(s, [camp, far], 'player'),
    pathBetween(s, 'camp', 'far', 'player'),
    'a no-waypoint march must be the same route it always was');
  assert.equal(pathThrough(s, [camp], 'player'), null, 'one stop is not a route');
  assert.equal(pathThrough(s, [camp, { q: 99, r: 99 }], 'player'), null);
});

test('a straight pull carries no waypoints at all', () => {
  // The player was POINTING, not drawing. Pinning the army to the incidental
  // hexes under a straight drag would refuse the order outright the moment one
  // of them happened to be occupied — a rule nobody asked for.
  const straight = [];
  for (let q = 0; q <= 8; q++) trackHex(straight, q * 60, 0, 34);
  assert.ok(straight.length > 2, 'sanity: the trail recorded something');
  assert.equal(isDrawnRoute(straight), false,
    'a straight drag registered as a drawn route');

  // NEGATIVE CONTROL: the same endpoints via a real detour DOES register, so
  // the false above is the shape of the gesture and not a dead function.
  //
  // Note what "real" has to mean here, because the first version of this
  // fixture got it wrong: a drag that WIGGLES is not a detour. In hex space a
  // diagonal step still closes the distance, so a gentle S-curve from [0,0] to
  // [8,0] is exactly eight steps — the same as the straight line — and
  // `isDrawnRoute` is right to ignore it. A detour is ground SPENT: out four
  // rows, across, and back.
  const bent = [];
  for (let r = 0; r <= 4; r++) bent.push([0, r]);
  for (let q = 1; q <= 8; q++) bent.push([q, 4]);
  for (let r = 3; r >= 0; r--) bent.push([8, r]);
  assert.equal(bent.length - 1, 16, 'sanity: sixteen steps to cover a distance of eight');
  assert.equal(isDrawnRoute(bent), true, 'a real detour was ignored');
});

test('trackHex dedupes, and trimWaypoints subsamples rather than truncates', () => {
  // pointermove fires far faster than a finger crosses a hex; without the dedupe
  // the trail is hundreds of copies of a handful of tiles, and the cap then
  // throws away the SHAPE of the gesture while keeping its jitter.
  const trail = [];
  for (let i = 0; i < 50; i++) trackHex(trail, 5, 5, 34);
  assert.equal(trail.length, 1, 'fifty samples of one hex are one hex');
  trackHex(trail, 200, 5, 34);
  assert.equal(trail.length, 2);

  // Truncating would march the army to the middle of the gesture and stop —
  // an order the player never gave. Subsampling keeps the endpoints.
  const long = Array.from({ length: 200 }, (_, i) => [i, 0]);
  const cut = trimWaypoints(long);
  assert.equal(cut.length, MAX_WAYPOINTS);
  assert.deepEqual(cut[0], long[1], 'the first waypoint after the origin is kept');
  assert.deepEqual(cut[cut.length - 1], long[long.length - 2],
    'the last waypoint before the destination is kept — this is subsampling, not truncation');

  assert.deepEqual(trimWaypoints([[0, 0], [1, 0]]), [],
    'origin and destination alone are not waypoints');
  assert.deepEqual(trimWaypoints(null), []);
});

test('a send may end on open ground, and the army holds it', () => {
  // The other half of what the drag buys: releasing in open country takes the
  // position instead of abandoning the gesture.
  const s = board();
  s.commands.push({ t: 'SEND', from: 'camp', toHex: [6, 3], fraction: 0.5 });
  drainCommands(s);
  const sq = s.squads[0];
  assert.ok(sq, 'a send to bare ground was refused');
  assert.equal(sq.to, null, 'no destination site — that is what makes it a camp');
  assert.ok(total(sq.comp) > 0);
  const last = sq.path[sq.path.length - 1];
  assert.deepEqual([last.q, last.r], [6, 3]);

  // An off-board hex is refused rather than marched at: `spawnSquad` falls back
  // to a straight line when A* finds nothing, so without the check this would
  // be a column walking into the void on an ordinary-looking arrival tick.
  const bad = board();
  bad.commands.push({ t: 'SEND', from: 'camp', toHex: [99, 99], fraction: 0.5 });
  drainCommands(bad);
  assert.equal(bad.squads.length, 0);
  assert.ok(bad.events.some((e) => e.reason === 'bad-hex'));
});

test('emptyComp is untouched by any of this', () => {
  // Cheap guard on the one shared object these paths all pass through.
  assert.equal(total(emptyComp()), 0);
});
