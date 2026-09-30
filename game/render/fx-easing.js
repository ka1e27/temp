// Pure easing/interpolation helpers used by fx-kinds.js. No canvas, no
// randomness, no time source of their own — just numbers in, numbers out —
// so they run and can be unit-tested under plain Node (see
// game/tests/fx.pool.test.js).

/** Linear interpolation from `a` to `b` at `t` in [0, 1]. */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Clamp `v` into `[lo, hi]`. */
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Clamp `t` into [0, 1] — the input every easing curve below expects. */
export function clamp01(t) {
  return clamp(t, 0, 1);
}

export function easeOutQuad(t) {
  return 1 - (1 - t) * (1 - t);
}

export function easeInQuad(t) {
  return t * t;
}

export function easeOutCubic(t) {
  const u = 1 - t;
  return 1 - u * u * u;
}

export function easeInCubic(t) {
  return t * t * t;
}

/** Overshoots slightly past 1 then settles — good for "pop" scale-ins. */
export function easeOutBack(t, overshoot = 1.7) {
  const u = t - 1;
  return 1 + (overshoot + 1) * u * u * u + overshoot * u * u;
}

/** Symmetric ease in/out, the default for anything that just needs to feel soft. */
export function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
}

/** A 0→1→0 hump, peaking at `peak` (0..1) — fade in, hold-ish, fade out. */
export function hump(t, peak = 0.5) {
  if (t <= 0 || t >= 1) return 0;
  return t < peak ? t / peak : 1 - (t - peak) / (1 - peak);
}

/** A symmetric parabolic arc, 0 at t=0 and t=1, `height` at t=0.5 — projectile arcs. */
export function arc(t, height) {
  return height * 4 * t * (1 - t);
}
