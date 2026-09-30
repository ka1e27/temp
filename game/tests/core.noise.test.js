import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNoise2D, fbm } from '../core/noise.js';

test('same seed produces identical noise at the same coordinates', () => {
  const a = createNoise2D(11);
  const b = createNoise2D(11);
  for (let i = 0; i < 100; i++) {
    const x = i * 0.37;
    const y = i * 0.21;
    assert.equal(a(x, y), b(x, y));
  }
});

test('different seeds produce different noise', () => {
  const a = createNoise2D(1);
  const b = createNoise2D(2);
  let sameCount = 0;
  for (let i = 0; i < 50; i++) {
    if (a(i * 0.3, i * 0.5) === b(i * 0.3, i * 0.5)) sameCount++;
  }
  assert.ok(sameCount < 50, 'seeds should not produce identical fields');
});

test('noise stays within [-1, 1]', () => {
  const noise = createNoise2D(5);
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      const v = noise(x * 0.13, y * 0.09);
      assert.ok(v >= -1 && v <= 1, `noise(${x},${y}) = ${v} out of range`);
    }
  }
});

test('noise is continuous-ish: nearby points are closer than far points on average', () => {
  const noise = createNoise2D(9);
  let nearSum = 0;
  let farSum = 0;
  const n = 200;
  for (let i = 0; i < n; i++) {
    const x = i * 0.9;
    const y = i * 0.4;
    nearSum += Math.abs(noise(x, y) - noise(x + 0.05, y));
    farSum += Math.abs(noise(x, y) - noise(x + 5, y));
  }
  assert.ok(nearSum / n < farSum / n, 'small steps should change less than large steps');
});

test('fbm stays within [-1, 1] and is deterministic', () => {
  const noise = createNoise2D(3);
  for (let x = 0; x < 30; x++) {
    for (let y = 0; y < 30; y++) {
      const v = fbm(noise, x * 0.05, y * 0.05, { octaves: 5, lacunarity: 2, gain: 0.5 });
      assert.ok(v >= -1 && v <= 1);
      assert.equal(v, fbm(noise, x * 0.05, y * 0.05, { octaves: 5, lacunarity: 2, gain: 0.5 }));
    }
  }
});

test('fbm with more octaves adds higher-frequency detail (differs from 1 octave)', () => {
  const noise = createNoise2D(3);
  let differed = false;
  for (let i = 0; i < 30; i++) {
    const x = i * 0.31;
    const y = i * 0.17;
    const one = fbm(noise, x, y, { octaves: 1 });
    const many = fbm(noise, x, y, { octaves: 6 });
    if (Math.abs(one - many) > 1e-9) differed = true;
  }
  assert.ok(differed);
});
