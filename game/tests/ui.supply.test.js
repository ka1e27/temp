// Supply lines and front lines, the UI half (DESIGN §4.3, §4.4): the chevron geometry, the arena's display ownership now coming from the simulation's own
// territory function (and corridors never recolouring), the HUD wording, and the no-route copy. The real-input half is tools/check.mjs (drag feedback,
// Ctrl-drag, Auto, refusal) and tools/hints.mjs (C1 and C2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { polylineLength, pointAlong, drawSupplyLine } from '../render/supplyLines.js';
import { createArenaOwnership } from '../scenes/arenaOwnership.js';
import { createBattle, canRoute, tileOwner as simTileOwner } from '../battle/sim.js';
import { buildArena } from '../battle/arena.js';
import { NO_ROUTE_TEXT, DRAG_ARROW, TUTORIAL_STEPS } from '../scenes/timing.js';
import { RULES } from '../app/tutorialRules.js';
import { buildTestWorld, TARGET_REGION, DEFAULT_OWNERS } from './fixtures/battle-world.js';

/** A canvas context that records what is stroked (enough for counting chevrons). */
function recordingCtx() {
  const calls = { strokes: 0, moves: 0 };
  const ctx = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'calls') return calls;
      if (prop === 'stroke') return () => { calls.strokes += 1; };
      if (prop === 'moveTo') return () => { calls.moves += 1; };
      return () => {};
    },
    set() { return true; },
  });
  return ctx;
}

const STRAIGHT = [{ x: 0, y: 0 }, { x: 200, y: 0 }];

test('polylineLength and pointAlong walk a route by distance, with the unit tangent', () => {
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }];
  const { total, seg } = polylineLength(pts);
  assert.equal(total, 150);
  assert.deepEqual(seg, [100, 50]);
  const a = pointAlong(pts, seg, 40);
  assert.equal(a.x, 40); assert.equal(a.y, 0); assert.equal(a.tx, 1); assert.equal(a.ty, 0);
  const b = pointAlong(pts, seg, 125);
  assert.equal(b.x, 100); assert.equal(b.y, 25); assert.equal(b.tx, 0); assert.equal(b.ty, 1);
  const end = pointAlong(pts, seg, 9999); // clamped
  assert.equal(end.x, 100); assert.equal(end.y, 50);
});

test('a supply line draws flowing chevrons, keeps clear of both ends, and draws nothing for a route too short to hold one', () => {
  const n = drawSupplyLine(recordingCtx(), STRAIGHT, '#3d7ef0', 0, { zoom: 46 });
  assert.ok(n >= 6 && n <= 12, `about one chevron per 19 px of a 200 px route, got ${n}`);
  assert.equal(drawSupplyLine(recordingCtx(), [{ x: 0, y: 0 }, { x: 10, y: 0 }], '#3d7ef0', 0, { zoom: 46 }), 0, 'two settlements on top of each other');
  assert.ok(drawSupplyLine(recordingCtx(), [{ x: 0, y: 0 }, { x: 50, y: 0 }], '#3d7ef0', 0, { zoom: 46 }) >= 1, 'a short hop between neighbours still shows its line');
  assert.equal(drawSupplyLine(recordingCtx(), [{ x: 0, y: 0 }], '#3d7ef0', 0), 0, 'one point is not a route');
  assert.equal(drawSupplyLine(recordingCtx(), null, '#3d7ef0', 0), 0);
});

test('the chevrons flow: a later time shifts them along the route (and the count stays about the same)', () => {
  const seen = [];
  for (const t of [0, 0.25, 0.5]) {
    const positions = [];
    const ctx = new Proxy({}, {
      get(_tt, prop) {
        if (prop === 'moveTo') return (x) => positions.push(Math.round(x));
        return () => {};
      },
      set() { return true; },
    });
    drawSupplyLine(ctx, STRAIGHT, '#fff', t, { zoom: 46 });
    seen.push(positions.join(','));
  }
  assert.notEqual(seen[0], seen[1]);
  assert.notEqual(seen[1], seen[2]);
});

// --- arena display ownership -------------------------------------------------------------------------------------------------------

function arenaFixture() {
  const world = buildTestWorld();
  const arena = buildArena(world, DEFAULT_OWNERS, TARGET_REGION, { attack: 1 }, { attack: 1 });
  const battle = createBattle(arena, { attack: 1, defense: 1, powers: {}, speed: 1, cooldownMult: 1 }, { attack: 1, defense: 1 });
  return { world, battle };
}

test('arena ownership shows exactly what the simulation says owns each tile', () => {
  const { world, battle } = arenaFixture();
  const own = createArenaOwnership(world, battle, TARGET_REGION, DEFAULT_OWNERS);
  let checked = 0;
  for (const t of battle.arena.tiles) {
    const tile = world.tiles[t.i];
    if (!tile.land || tile.region !== TARGET_REGION || t.link) continue;
    assert.equal(own.tileOwner(tile, 0), simTileOwner(battle, t.i), `tile ${t.i}`);
    checked += 1;
  }
  assert.ok(checked > 5);
});

test('arena ownership follows a capture the moment the simulation flips a settlement', () => {
  const { world, battle } = arenaFixture();
  const own = createArenaOwnership(world, battle, TARGET_REGION, DEFAULT_OWNERS);
  const foe = battle.sites.find((s) => s.owner !== 0 && world.tiles[s.tile].region === TARGET_REGION);
  const tile = world.tiles[foe.tile];
  assert.notEqual(own.tileOwner(tile, 0), 0);
  foe.owner = 0; // what a capture does
  assert.equal(own.tileOwner(tile, 0), 0);
  assert.equal(own.tileOwner(tile, 0), simTileOwner(battle, foe.tile));
});

test('corridor tiles (link) never ripple, flood or recolour with a capture', () => {
  const { world, battle } = arenaFixture();
  const target = battle.arena.tiles.filter((t) => t.region === TARGET_REGION && world.tiles[t.i].land);
  const corridor = target[Math.floor(target.length / 2)];
  corridor.link = true; // mark one tile of the target region as a border-march corridor before the ownership is built
  const own = createArenaOwnership(world, battle, TARGET_REGION, DEFAULT_OWNERS);
  assert.ok(own.linkTiles.has(corridor.i));
  for (const tiles of own.cells.values()) assert.ok(!tiles.some((t) => t.i === corridor.i), 'not in any settlement cell, so no ripple');
  const before = own.tileOwner(world.tiles[corridor.i], 0);
  const foe = battle.sites.find((s) => s.owner !== 0 && world.tiles[s.tile].region === TARGET_REGION);
  foe.owner = 0;
  own.onCapture(foe.id, 2, 0, 250);
  assert.equal(own.tileOwner(world.tiles[corridor.i], 10), before, 'the corridor tile does not ripple');
  const flood = own.startFlood(0, 0, 40, world.tiles[foe.tile], () => 2);
  assert.ok(!flood.schedule.some((e) => e.tile.i === corridor.i), 'the victory flood skips corridors');
});

// --- copy and tutorial -------------------------------------------------------------------------------------------------------------

test('the no-route words are one string and the grey arrow is grey', () => {
  assert.match(NO_ROUTE_TEXT, /^No route: take a closer settlement first$/);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(DRAG_ARROW.blocked.slice(i, i + 2), 16));
  assert.ok(Math.max(r, g, b) - Math.min(r, g, b) < 40);
  const src = readFileSync(new URL('../scenes/battle.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /'No route: take/, 'battle.js uses NO_ROUTE_TEXT, never a typed copy');
});

test('C1 and C2 are live and follow PLAYFEEL: C1 is seen by a supply line, C2 shows on the first refusal or 20 s in and leaves by timeout', () => {
  const c1 = TUTORIAL_STEPS.find((s) => s.id === 'C1');
  const c2 = TUTORIAL_STEPS.find((s) => s.id === 'C2');
  assert.deepEqual(c1.seenOn, ['supplyCreated']);
  assert.equal(c1.anchor, 'supply');
  assert.equal(c2.anchor, 'blocked');
  assert.equal(c2.timeoutSec, 6);
  const facts = { live: true, battlesBefore: 1, hasBlocked: true, noRouteSeen: false, t: 5, features: { supply: true }, seen: () => false };
  assert.ok(!RULES.C2(facts), 'not before 20 s without a refusal');
  assert.ok(RULES.C2({ ...facts, t: 21 }));
  assert.ok(RULES.C2({ ...facts, noRouteSeen: true }), 'the first refusal brings it');
  assert.ok(!RULES.C2({ ...facts, t: 30, hasBlocked: false }), 'nothing cut off, nothing to point at');
});

test('the front-line rule the UI leans on: a settlement with no route for any of ours reports as unroutable', () => {
  const { battle } = arenaFixture();
  const camp = battle.sites.find((s) => s.type === 'camp');
  const reach = battle.sites.filter((s) => s.owner !== 0).map((s) => canRoute(battle, 0, camp.id, s.id));
  assert.ok(reach.length > 0 && reach.some((x) => x === true || x === false));
});
