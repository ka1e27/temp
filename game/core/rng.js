// Seeded PRNG — the only source of randomness anywhere in game/core, game/world,
// game/battle or game/meta. PURE: no Math.random, no Date.now, no globals.
//
// mulberry32: tiny, fast, good-enough distribution, identical results across
// engines (only 32-bit integer ops + one division), which matters because
// world generation must be byte-for-byte reproducible from a seed.

/**
 * @typedef {Object} Rng
 * @property {() => number} next            float in [0, 1)
 * @property {(a: number, b: number) => number} int      integer in [a, b] inclusive
 * @property {(a: number, b: number) => number} range    float in [a, b)
 * @property {(arr: any[]) => any} pick                  uniform random element
 * @property {(arr: any[]) => any[]} shuffle             Fisher-Yates, in place, returns arr
 * @property {(p: number) => boolean} chance             true with probability p
 * @property {(label: string|number) => Rng} fork        independent child stream keyed by label
 */

/**
 * @param {number} seed any finite number; only the low 32 bits are used
 * @returns {Rng}
 */
export function createRng(seed) {
  const origin = seed >>> 0;
  let s = origin;

  /** @returns {number} float in [0, 1) */
  function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function int(a, b) {
    return a + Math.floor(next() * (b - a + 1));
  }

  function range(a, b) {
    return a + next() * (b - a);
  }

  function pick(arr) {
    return arr[Math.floor(next() * arr.length)];
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function chance(p) {
    return next() < p;
  }

  // Keyed by the ORIGINAL seed, not the mutable state `s` — so a child stream
  // never depends on how many times the parent's `next()` happened to be
  // called first. That keeps unrelated generation phases from coupling to
  // each other's call order (add one more river source and settlement names
  // do not change).
  function fork(label) {
    return createRng(hash32(origin, 'fork', label));
  }

  return { next, int, range, pick, shuffle, chance, fork };
}

/**
 * Stable hash of any mix of numbers and strings into a uint32. Deterministic
 * across runs/engines (FNV-1a over each argument's string form, with a mixed
 * separator between arguments so `hash32('a','b') !== hash32('ab')`).
 * @param {...(number|string)} parts
 * @returns {number} uint32
 */
export function hash32(...parts) {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const str = typeof part === 'string' ? part : String(part);
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    // Separator mix so argument boundaries matter, not just concatenation.
    h ^= 0x9e3779b9;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
