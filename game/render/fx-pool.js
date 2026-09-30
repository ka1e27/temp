// A fixed-size pool of reusable, flat particle records. Every field a kind
// might need lives directly on the record (no nested objects), and all
// `maxParticles` records are allocated exactly once, in `createPool` — spawn,
// update and draw only ever *mutate* existing records, never `new` one, so a
// battle with fireballs, confetti and a dozen clashes going at once creates
// zero garbage for the collector to walk.
//
// Deliberately has no idea what a "spark" or a "coin" looks like — that's
// fx-kinds.js. This file is just the allocator: pure enough to run (and be
// tested) under plain Node, no canvas or WebAudio involved.

/** One pool record, with every field any kind might use, at its rest value. */
function makeParticle() {
  return {
    alive: false,
    kind: '', // e.g. 'spark', 'coin' — see fx-kinds.js
    // World-space position, and (for a few kinds) a world-space origin used
    // to recompute position from t/life every frame instead of integrating.
    x: 0, y: 0,
    vx: 0, vy: 0, // velocity, world units/sec
    gx: 0, gy: 0, // acceleration (gravity etc.), world units/sec^2
    t: 0, // seconds since spawn
    life: 0, // total lifetime in seconds; dies when t >= life
    size: 0, // base size in world units (draw scales this by camera zoom)
    rot: 0, spin: 0, // rotation and angular velocity, radians / radians per sec
    color: '', color2: '', // CSS colour strings, set once at spawn
    alpha0: 1, // overall opacity multiplier
    text: '', // floatText payload
    tx: 0, ty: 0, // a world-space target (arrow destination, rally target)
    sx: 0, sy: 0, // a SCREEN-space target in CSS px (coins → HUD counter)
    seed: 0, // stable per-particle random in [0, 1), rolled once at spawn
    shape: 0, // small integer: which visual variant of `kind` to draw
    flag: false, // one-shot latch (e.g. "has this fireball detonated yet?")
    // Four free numeric scratch slots so a kind can carry a couple of extra
    // tunables (arc height, ring growth rate, dome radius...) without a
    // per-particle allocation for a sub-object.
    p0: 0, p1: 0, p2: 0, p3: 0,
  };
}

/**
 * @param {number} size max concurrent particles
 * @returns {{items: object[], free: number[], size: number, activeCount: number}}
 */
export function createPool(size) {
  const items = new Array(size);
  const free = new Array(size);
  for (let i = 0; i < size; i++) {
    items[i] = makeParticle();
    free[i] = size - 1 - i; // so acquire() hands out index 0 first
  }
  return { items, free, size, activeCount: 0 };
}

/** Claim a free slot, or -1 if the pool is full. Never throws, never grows. */
export function acquire(pool) {
  if (pool.free.length === 0) return -1;
  const i = pool.free.pop();
  const p = pool.items[i];
  p.alive = true;
  p.t = 0;
  p.rot = 0;
  p.spin = 0;
  p.flag = false;
  p.p0 = 0; p.p1 = 0; p.p2 = 0; p.p3 = 0;
  pool.activeCount++;
  return i;
}

/** Return a slot to the free list. Safe to call on an already-dead slot. */
export function release(pool, i) {
  const p = pool.items[i];
  if (!p.alive) return;
  p.alive = false;
  pool.activeCount--;
  pool.free.push(i);
}

/** Kill and free every active particle. */
export function releaseAll(pool) {
  for (let i = 0; i < pool.items.length; i++) {
    if (pool.items[i].alive) release(pool, i);
  }
}
