// Seeded 2D gradient noise (classic Perlin-style) plus fractional Brownian
// motion on top of it. PURE: derives its permutation table from core/rng.js,
// never Math.random.

import { createRng } from './rng.js';

// Eight gradient directions (the four axes plus the four diagonals,
// normalised so the diagonals aren't longer than the axes).
const DIAG = Math.SQRT1_2;
const GRAD = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [DIAG, DIAG], [-DIAG, DIAG], [DIAG, -DIAG], [-DIAG, -DIAG],
];

// Empirical bound of the raw lattice noise below, so createNoise2D can scale
// its output to fill [-1, 1] rather than the ~[-0.66, 0.66] classic Perlin
// noise actually produces with unit gradients.
const OUTPUT_SCALE = 1.5;

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a, b, t) {
  return a + t * (b - a);
}

function gradDot(hash, x, y) {
  const g = GRAD[hash & 7];
  return g[0] * x + g[1] * y;
}

/**
 * @param {number} seed
 * @returns {(x: number, y: number) => number} noise in [-1, 1]
 */
export function createNoise2D(seed) {
  const rng = createRng(seed >>> 0);
  const base = Array.from({ length: 256 }, (_, i) => i);
  rng.shuffle(base);
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255];

  return function noise2D(x, y) {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);

    const aa = perm[perm[xi] + yi];
    const ab = perm[perm[xi] + yi + 1];
    const ba = perm[perm[xi + 1] + yi];
    const bb = perm[perm[xi + 1] + yi + 1];

    const u = fade(xf);
    const v = fade(yf);

    const x1 = lerp(gradDot(aa, xf, yf), gradDot(ba, xf - 1, yf), u);
    const x2 = lerp(gradDot(ab, xf, yf - 1), gradDot(bb, xf - 1, yf - 1), u);
    const value = lerp(x1, x2, v) * OUTPUT_SCALE;

    return Math.max(-1, Math.min(1, value));
  };
}

/**
 * Fractional Brownian motion: several octaves of `noise` summed and
 * normalised back into [-1, 1].
 * @param {(x: number, y: number) => number} noise
 * @param {number} x @param {number} y
 * @param {{ octaves?: number, lacunarity?: number, gain?: number }} [opts]
 */
export function fbm(noise, x, y, opts = {}) {
  const { octaves = 4, lacunarity = 2, gain = 0.5 } = opts;
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amplitude * noise(x * frequency, y * frequency);
    norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}
