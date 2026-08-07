// Seeded PRNG. The ONLY source of randomness in the simulation, and it is
// consumed exclusively by AI tie-breaks and map generation — never by combat.
// Combat is fully deterministic so the pre-commit preview is exact.
// PURE: no Math.random anywhere.

/**
 * mulberry32 — small, fast, good enough distribution, identical across engines.
 * State is a plain integer so it serializes into the save with everything else.
 * @param {number} seed
 */
export function createRng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /** Integer in [lo, hi). */
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo)),
    /** Float in [lo, hi). */
    range: (lo, hi) => lo + next() * (hi - lo),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    /** ±frac jitter around 1.0, e.g. jitter(0.2) -> [0.8, 1.2). */
    jitter: (frac) => 1 + (next() * 2 - 1) * frac,
    get state() { return s; },
    set state(v) { s = v >>> 0; },
  };
}

/** Derive a stable child seed from a parent seed plus a string tag. */
export function deriveSeed(seed, tag) {
  let h = seed >>> 0;
  for (let i = 0; i < tag.length; i++) {
    h ^= tag.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
