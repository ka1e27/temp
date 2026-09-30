import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng, hash32 } from '../core/rng.js';

test('same seed produces an identical sequence', () => {
  const a = createRng(12345);
  const b = createRng(12345);
  const seqA = Array.from({ length: 50 }, () => a.next());
  const seqB = Array.from({ length: 50 }, () => b.next());
  assert.deepEqual(seqA, seqB);
});

test('different seeds diverge', () => {
  const a = createRng(1);
  const b = createRng(2);
  const seqA = Array.from({ length: 10 }, () => a.next());
  const seqB = Array.from({ length: 10 }, () => b.next());
  assert.notDeepEqual(seqA, seqB);
});

test('next() stays within [0, 1)', () => {
  const rng = createRng(999);
  for (let i = 0; i < 2000; i++) {
    const v = rng.next();
    assert.ok(v >= 0 && v < 1, `next() out of range: ${v}`);
  }
});

test('int(a,b) is inclusive on both ends and never leaves the range', () => {
  const rng = createRng(7);
  let sawLo = false;
  let sawHi = false;
  for (let i = 0; i < 500; i++) {
    const v = rng.int(1, 3);
    assert.ok(v >= 1 && v <= 3 && Number.isInteger(v));
    if (v === 1) sawLo = true;
    if (v === 3) sawHi = true;
  }
  assert.ok(sawLo && sawHi, 'both endpoints should appear over enough draws');
});

test('range(a,b) stays within [a, b)', () => {
  const rng = createRng(3);
  for (let i = 0; i < 500; i++) {
    const v = rng.range(-5, 5);
    assert.ok(v >= -5 && v < 5);
  }
});

test('pick returns an element of the array', () => {
  const rng = createRng(4);
  const arr = ['a', 'b', 'c', 'd'];
  for (let i = 0; i < 50; i++) assert.ok(arr.includes(rng.pick(arr)));
});

test('shuffle mutates in place, returns the same reference, and is a permutation', () => {
  const rng = createRng(5);
  const arr = [1, 2, 3, 4, 5, 6, 7, 8];
  const original = [...arr];
  const returned = rng.shuffle(arr);
  assert.equal(returned, arr, 'shuffle must return the same array reference');
  assert.deepEqual([...arr].sort((a, b) => a - b), original, 'shuffle must be a permutation');
});

test('chance(0) is always false and chance(1) is always true', () => {
  const rng = createRng(8);
  for (let i = 0; i < 50; i++) {
    assert.equal(rng.chance(0), false);
    assert.equal(rng.chance(1), true);
  }
});

test('chance(p) trends toward p over many draws', () => {
  const rng = createRng(2024);
  let hits = 0;
  const n = 20000;
  for (let i = 0; i < n; i++) if (rng.chance(0.3)) hits++;
  assert.ok(Math.abs(hits / n - 0.3) < 0.02, `chance(0.3) rate was ${hits / n}`);
});

test('fork(label) is deterministic and independent of prior consumption', () => {
  const fresh = createRng(42).fork('rivers');
  const parent = createRng(42);
  parent.next();
  parent.next();
  parent.next();
  const afterUse = parent.fork('rivers');
  assert.equal(fresh.next(), afterUse.next());
});

test('fork(label) with different labels gives independent streams', () => {
  const parent = createRng(42);
  const rivers = parent.fork('rivers');
  const names = parent.fork('names');
  const a = Array.from({ length: 10 }, () => rivers.next());
  const b = Array.from({ length: 10 }, () => names.next());
  assert.notDeepEqual(a, b);
});

test('fork() child streams do not perturb the parent stream', () => {
  const parentA = createRng(9);
  const seqA = Array.from({ length: 5 }, () => parentA.next());

  const parentB = createRng(9);
  parentB.fork('anything'); // forking must not consume the parent's own state
  const seqB = Array.from({ length: 5 }, () => parentB.next());

  assert.deepEqual(seqA, seqB);
});

test('hash32 is deterministic and mixes numbers and strings', () => {
  assert.equal(hash32(1, 'a', 2), hash32(1, 'a', 2));
  assert.notEqual(hash32(1, 'a', 2), hash32(1, 'a', 3));
  assert.notEqual(hash32('a', 'b'), hash32('ab'), 'argument boundaries must matter');
});

test('hash32 always returns a uint32', () => {
  for (const args of [[0], [1, 2, 3], ['seed', 42], ['tile', 1728, 'jitter']]) {
    const h = hash32(...args);
    assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff);
  }
});
