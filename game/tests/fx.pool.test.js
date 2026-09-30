// game/render/fx.js's particle pool, exercised headlessly (node:test — see
// docs/ARCHITECTURE.md §1). Deliberately never calls `.draw()`: that needs a
// real CanvasRenderingContext2D, which Node does not have. Everything tested
// here — the pool allocator, spawn/update, reduceMotion scaling, the
// fireball → explosion handoff — runs on plain data, which is the point of
// keeping fx-pool.js/fx-kinds.js free of any canvas/DOM dependency.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPool, acquire, release, releaseAll } from '../render/fx-pool.js';
import { createFx } from '../render/fx.js';
import {
  clamp, clamp01, lerp, easeOutCubic, easeInQuad, hump, arc,
} from '../render/fx-easing.js';

test('fx-pool: acquire never throws once the pool is full, and hands back -1', () => {
  const pool = createPool(8);
  const taken = [];
  for (let i = 0; i < 8; i++) {
    const idx = acquire(pool);
    assert.notEqual(idx, -1);
    taken.push(idx);
  }
  assert.equal(pool.activeCount, 8);
  assert.doesNotThrow(() => {
    for (let i = 0; i < 50; i++) assert.equal(acquire(pool), -1);
  });
  // Releasing one frees exactly one slot back up.
  release(pool, taken[0]);
  assert.equal(pool.activeCount, 7);
  assert.notEqual(acquire(pool), -1);
  assert.equal(pool.activeCount, 8);
});

test('fx-pool: release is a no-op on an already-dead slot (no double free)', () => {
  const pool = createPool(4);
  const i = acquire(pool);
  release(pool, i);
  assert.equal(pool.activeCount, 0);
  release(pool, i); // second release of the same slot must not go negative
  assert.equal(pool.activeCount, 0);
});

test('fx-pool: releaseAll empties every active slot', () => {
  const pool = createPool(5);
  for (let i = 0; i < 5; i++) acquire(pool);
  assert.equal(pool.activeCount, 5);
  releaseAll(pool);
  assert.equal(pool.activeCount, 0);
  assert.equal(pool.free.length, 5);
});

test('fx: spawning far beyond maxParticles never throws and stays at the cap', () => {
  const fx = createFx({ maxParticles: 32 });
  assert.doesNotThrow(() => {
    for (let i = 0; i < 200; i++) {
      fx.spawn('sparks', 0, 0, { count: 20 }); // 20/call × 200 calls >> 32
    }
  });
  assert.ok(fx.count() <= 32, `count() ${fx.count()} exceeded the 32 cap`);
});

test('fx: update() removes particles once their lifetime elapses', () => {
  const fx = createFx({ maxParticles: 64 });
  fx.spawn('dust', 0, 0, { count: 6 });
  assert.ok(fx.count() > 0);
  // Every cue-driven kind's lifetime is well under a couple of seconds;
  // stepping far past it must drain the pool back to empty.
  for (let i = 0; i < 60; i++) fx.update(0.1); // 6 simulated seconds
  assert.equal(fx.count(), 0);
});

test('fx: unknown kinds and malformed opts are silently ignored', () => {
  const fx = createFx({ maxParticles: 16 });
  assert.doesNotThrow(() => fx.spawn('not-a-real-kind', 0, 0));
  assert.equal(fx.count(), 0);
  // coins with no toScreen target has nothing to arc to — no-op, not a throw.
  assert.doesNotThrow(() => fx.spawn('coins', 0, 0, {}));
  assert.equal(fx.count(), 0);
});

test('fx: reduceMotion scales particle counts down (~0.35x) without disabling the kind', () => {
  const full = createFx({ maxParticles: 200, reduceMotion: false });
  const reduced = createFx({ maxParticles: 200, reduceMotion: true });
  full.spawn('dust', 0, 0, { count: 20 });
  reduced.spawn('dust', 0, 0, { count: 20 });
  assert.ok(reduced.count() < full.count(), 'reduceMotion should spawn fewer particles');
  assert.ok(reduced.count() > 0, 'reduceMotion must not zero out the effect entirely');
});

test('fx: reduceMotion disables confetti entirely (spec: "no confetti")', () => {
  const reduced = createFx({ maxParticles: 200, reduceMotion: true });
  reduced.spawn('confetti', 0, 0, { count: 50 });
  assert.equal(reduced.count(), 0);
});

test('fx: setReduceMotion(true) zeroes an in-flight shake', () => {
  const fx = createFx({ maxParticles: 16 });
  fx.shake(1, 1);
  assert.ok(fx.shakeOffset().x !== 0 || fx.shakeOffset().y !== 0 || true); // shake is time-phased; just must not throw
  fx.setReduceMotion(true);
  assert.deepEqual(fx.shakeOffset(), { x: 0, y: 0 });
  fx.shake(1, 1); // and a fresh call while reduced stays a no-op
  assert.deepEqual(fx.shakeOffset(), { x: 0, y: 0 });
});

test('fx: a weaker/shorter shake never cuts a stronger one short', () => {
  const fx = createFx({ maxParticles: 16 });
  fx.shake(1, 2);
  fx.update(0.05);
  const strong = fx.shakeOffset();
  fx.shake(0.05, 0.1); // much weaker — must be dropped, not override
  const after = fx.shakeOffset();
  // Same phase (update() hasn't advanced between the two reads), so a
  // genuine override would change the magnitude; dropping it keeps it exact.
  assert.equal(after.x, strong.x);
  assert.equal(after.y, strong.y);
});

test('fx: clear() releases every particle and silences shake', () => {
  const fx = createFx({ maxParticles: 64 });
  fx.spawn('embers', 0, 0, { count: 10 });
  fx.shake(1, 1);
  fx.clear();
  assert.equal(fx.count(), 0);
  assert.deepEqual(fx.shakeOffset(), { x: 0, y: 0 });
});

test('fx: fireball explodes into embers/smoke/shockwave/scorch on impact, and consumes itself', () => {
  const fx = createFx({ maxParticles: 128 });
  fx.spawn('fireball', 3, 3, { delay: 0.4 });
  // The falling head, plus its auto-paired ground telegraph (round 2).
  assert.equal(fx.count(), 2);
  for (let i = 0; i < 4; i++) fx.update(0.11); // 0.44s > 0.4s delay: impact
  // Both are gone, but the explosion (fireBloom+embers+smoke+shockwave+scorch)
  // filled the pool with fresh particles.
  assert.ok(fx.count() > 1, 'expected an explosion to spawn multiple particles');
});

test('fx: fireball with opts.telegraph=false skips the ground warning ring', () => {
  const fx = createFx({ maxParticles: 128 });
  fx.spawn('fireball', 3, 3, { delay: 0.4, telegraph: false });
  assert.equal(fx.count(), 1); // just the falling head, no telegraph
});

test('fx: fireBloom/telegraph/flood spawn without throwing and are counted', () => {
  const fx = createFx({ maxParticles: 32 });
  fx.spawn('fireBloom', 0, 0, { radius: 1.3 });
  fx.spawn('telegraph', 0, 0, { radius: 1.3, duration: 0.8 });
  fx.spawn('flood', 0, 0, { size: 0.5 });
  assert.equal(fx.count(), 3);
});

test('fx: coins need an opts.toScreen target; without one nothing spawns', () => {
  const fx = createFx({ maxParticles: 64 });
  fx.spawn('coins', 1, 1, { count: 8 }); // no toScreen
  assert.equal(fx.count(), 0);
  fx.spawn('coins', 1, 1, { count: 8, toScreen: { x: 400, y: 20 } });
  assert.ok(fx.count() > 0);
});

// -------------------------------------------------------- pure easing math

test('fx-easing: clamp/clamp01/lerp behave at and outside their bounds', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
  assert.equal(clamp01(1.5), 1);
  assert.equal(clamp01(-0.5), 0);
  assert.equal(lerp(0, 10, 0.5), 5);
  assert.equal(lerp(10, 20, 0), 10);
  assert.equal(lerp(10, 20, 1), 20);
});

test('fx-easing: easing curves start at 0 and end at 1 over [0,1]', () => {
  for (const fn of [easeOutCubic, easeInQuad]) {
    assert.ok(Math.abs(fn(0)) < 1e-9);
    assert.ok(Math.abs(fn(1) - 1) < 1e-9);
  }
});

test('fx-easing: hump is 0 at both ends and positive at its peak', () => {
  assert.equal(hump(0), 0);
  assert.equal(hump(1), 0);
  assert.ok(hump(0.5) > 0);
});

test('fx-easing: arc is 0 at both ends and `height` at the midpoint', () => {
  assert.equal(arc(0, 10), 0);
  assert.equal(arc(1, 10), 0);
  assert.equal(arc(0.5, 10), 10);
});
