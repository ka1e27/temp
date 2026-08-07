import test from 'node:test';
import assert from 'node:assert/strict';
import {
  distance, neighbors, withinRadius, toPixel, fromPixel, round,
  findPath, key, parseKey, add, equals,
} from '../src/core/hex.js';
import { createRng, deriveSeed } from '../src/core/rng.js';
import { fnv1a, stableStringify } from '../src/core/hash.js';
import { createLoop, TICK_MS } from '../src/core/loop.js';
import { createBus } from '../src/core/bus.js';

// --- hex math -------------------------------------------------------------

test('distance is zero to self and one to each neighbour', () => {
  const o = { q: 3, r: -2 };
  assert.equal(distance(o, o), 0);
  for (const n of neighbors(o)) assert.equal(distance(o, n), 1);
});

test('distance is symmetric', () => {
  const a = { q: 0, r: 0 };
  const b = { q: 4, r: -2 };
  assert.equal(distance(a, b), distance(b, a));
});

test('withinRadius returns the correct hex count', () => {
  // Centred hex counts: 1, 7, 19, 37 — 3r(r+1)+1.
  for (let r = 0; r <= 3; r++) {
    assert.equal(withinRadius({ q: 0, r: 0 }, r).length, 3 * r * (r + 1) + 1);
  }
});

test('withinRadius contains only hexes within the radius', () => {
  const c = { q: 2, r: 1 };
  for (const h of withinRadius(c, 3)) assert.ok(distance(c, h) <= 3);
});

test('pixel conversion round-trips', () => {
  for (let q = -5; q <= 5; q++) {
    for (let r = -5; r <= 5; r++) {
      const { x, y } = toPixel({ q, r }, 24);
      const back = fromPixel(x, y, 24);
      assert.deepEqual(back, { q, r }, `failed at ${q},${r}`);
    }
  }
});

test('round snaps fractional coords to a valid hex', () => {
  const h = round({ q: 1.4, r: -0.6 });
  assert.ok(Number.isInteger(h.q) && Number.isInteger(h.r));
});

test('key/parseKey round-trip, including negatives', () => {
  for (const [q, r] of [[0, 0], [3, -2], [-7, 11]]) {
    assert.deepEqual(parseKey(key(q, r)), { q, r });
  }
});

test('add and equals behave', () => {
  assert.ok(equals(add({ q: 1, r: 2 }, { q: -1, r: 1 }), { q: 0, r: 3 }));
});

// --- pathfinding ----------------------------------------------------------

const open = () => true;

test('findPath returns an inclusive, contiguous path', () => {
  const start = { q: 0, r: 0 };
  const goal = { q: 4, r: -2 };
  const path = findPath(start, goal, open);
  assert.ok(path);
  assert.ok(equals(path[0], start));
  assert.ok(equals(path[path.length - 1], goal));
  assert.equal(path.length - 1, distance(start, goal), 'unobstructed path is the hex distance');
  for (let i = 1; i < path.length; i++) {
    assert.equal(distance(path[i - 1], path[i]), 1, 'every step is one hex');
  }
});

test('findPath routes around a wall', () => {
  // A vertical wall at q === 2, with a gap at r === 3.
  const blocked = new Set();
  for (let r = -3; r <= 2; r++) blocked.add(key(2, r));
  const passable = (h) => !blocked.has(key(h.q, h.r)) && Math.abs(h.q) <= 8 && Math.abs(h.r) <= 8;

  const path = findPath({ q: 0, r: 0 }, { q: 4, r: 0 }, passable);
  assert.ok(path, 'a detour exists');
  for (const h of path) assert.ok(passable(h), 'path never crosses a blocked hex');
});

test('findPath returns null when the goal is walled off', () => {
  const goal = { q: 3, r: 0 };
  // Seal every neighbour of the goal.
  const walls = new Set(neighbors(goal).map((h) => key(h.q, h.r)));
  const passable = (h) => !walls.has(key(h.q, h.r)) && Math.abs(h.q) <= 6 && Math.abs(h.r) <= 6;
  assert.equal(findPath({ q: 0, r: 0 }, goal, passable), null);
});

test('findPath is deterministic across runs', () => {
  const a = findPath({ q: 0, r: 0 }, { q: 5, r: -3 }, open);
  const b = findPath({ q: 0, r: 0 }, { q: 5, r: -3 }, open);
  assert.deepEqual(a, b, 'equal-cost paths must resolve identically every time');
});

// --- rng ------------------------------------------------------------------

test('the same seed always produces the same sequence', () => {
  const a = createRng(42);
  const b = createRng(42);
  for (let i = 0; i < 50; i++) assert.equal(a.next(), b.next());
});

test('different seeds diverge', () => {
  const a = createRng(1);
  const b = createRng(2);
  const seqA = Array.from({ length: 10 }, () => a.next());
  const seqB = Array.from({ length: 10 }, () => b.next());
  assert.notDeepEqual(seqA, seqB, 'guards against an accidentally constant RNG');
});

test('rng output stays in range', () => {
  const r = createRng(7);
  for (let i = 0; i < 500; i++) {
    const v = r.next();
    assert.ok(v >= 0 && v < 1);
    const n = r.int(3, 9);
    assert.ok(n >= 3 && n < 9 && Number.isInteger(n));
    const j = r.jitter(0.2);
    assert.ok(j >= 0.8 && j <= 1.2);
  }
});

test('rng state can be saved and restored', () => {
  const r = createRng(99);
  for (let i = 0; i < 5; i++) r.next();
  const snapshot = r.state;
  const expected = [r.next(), r.next()];
  r.state = snapshot;
  assert.deepEqual([r.next(), r.next()], expected);
});

test('deriveSeed is stable and tag-sensitive', () => {
  assert.equal(deriveSeed(1, 'riverfen'), deriveSeed(1, 'riverfen'));
  assert.notEqual(deriveSeed(1, 'riverfen'), deriveSeed(1, 'ironwood'));
});

// --- hash -----------------------------------------------------------------

test('stableStringify sorts keys recursively', () => {
  const a = { b: 1, a: { d: 2, c: 3 } };
  const b = { a: { c: 3, d: 2 }, b: 1 };
  assert.equal(stableStringify(a), stableStringify(b));
  assert.equal(fnv1a(stableStringify(a)), fnv1a(stableStringify(b)));
});

test('fnv1a produces an 8-char hex digest and distinguishes inputs', () => {
  assert.match(fnv1a('hello'), /^[0-9a-f]{8}$/);
  assert.notEqual(fnv1a('hello'), fnv1a('hellp'));
});

// --- loop -----------------------------------------------------------------

function fakeLoop(onUpdate) {
  let t = 0;
  const pending = [];
  const loop = createLoop({
    update: onUpdate,
    render: () => {},
    now: () => t,
    raf: (cb) => { pending.push(cb); return pending.length; },
    cancelRaf: () => {},
  });
  return {
    loop,
    advance(ms) { t += ms; const cbs = pending.splice(0); cbs.forEach((cb) => cb()); },
  };
}

test('the loop runs exactly one tick per TICK_MS', () => {
  let ticks = 0;
  const { loop, advance } = fakeLoop(() => ticks++);
  loop.start();
  // Advance one frame at a time; a single 300ms frame would hit the
  // MAX_FRAME_MS clamp, which is a different behaviour (tested below).
  for (let i = 0; i < 3; i++) advance(TICK_MS);
  assert.equal(ticks, 3);
});

test('a long frame is clamped rather than replayed in full', () => {
  let ticks = 0;
  const { loop, advance } = fakeLoop(() => ticks++);
  loop.start();
  advance(1000); // one very long frame
  assert.equal(ticks, 2, '1000ms clamps to MAX_FRAME_MS (250) => 2 ticks');
});

test('the loop never replays a backgrounded tab', () => {
  let ticks = 0;
  const { loop, advance } = fakeLoop(() => ticks++);
  loop.start();
  advance(60 * 60 * 1000); // an hour away
  assert.ok(ticks <= 5, `expected the backlog to be dropped, got ${ticks} ticks`);
});

test('a backwards clock produces no negative time', () => {
  let ticks = 0;
  let t = 1000;
  const pending = [];
  const loop = createLoop({
    update: () => ticks++,
    render: () => {},
    now: () => t,
    raf: (cb) => { pending.push(cb); return 1; },
    cancelRaf: () => {},
  });
  loop.start();
  t = 0; // clock stepped backwards
  pending.splice(0).forEach((cb) => cb());
  assert.equal(ticks, 0);
});

test('runTicks advances headlessly with no rendering', () => {
  let ticks = 0;
  const { loop } = fakeLoop(() => ticks++);
  loop.runTicks(120);
  assert.equal(ticks, 120);
  assert.equal(loop.simTimeMs, 120 * TICK_MS);
});

// --- bus ------------------------------------------------------------------

test('bus delivers, and on() returns a working unsubscribe', () => {
  const bus = createBus();
  let n = 0;
  const off = bus.on('x', () => n++);
  bus.emit('x');
  off();
  bus.emit('x');
  assert.equal(n, 1);
});

test('a listener may unsubscribe itself mid-emit', () => {
  const bus = createBus();
  let n = 0;
  const off = bus.on('x', () => { n++; off(); });
  bus.on('x', () => n++);
  assert.doesNotThrow(() => bus.emit('x'));
  assert.equal(n, 2);
});

test('once fires exactly once', () => {
  const bus = createBus();
  let n = 0;
  bus.once('x', () => n++);
  bus.emit('x');
  bus.emit('x');
  assert.equal(n, 1);
});
