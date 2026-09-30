// The "PROGRESS" half of fx-kinds.js's two kind families (see that file's
// header): one pool slot per kind, whose shape is a pure function of
// `t / life` plus spawn-time constants. Split into its own file once
// fx-kinds.js crossed ~500 lines (CLAUDE.md: "files ideally < 500 lines").
//
// Deliberately has NO import from fx-kinds.js — fx-kinds.js imports FROM
// here (to build the combined `SPAWNERS` table and call `spawnShockwave`
// from `spawnBurst`), never the other way, so there is no circular module
// dependency to reason about. `explodeFireball` reaches embers/smoke back
// in fx-kinds.js only through the `spawnFn` PARAMETER (the public dispatch
// closure fx.js hands it), never a direct import.
import { acquire } from './fx-pool.js';
import { ACCENTS } from './palette.js';

const TAU = Math.PI * 2;
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const GOLD = ACCENTS.gold;

/** Duration scaled for reduceMotion (spec: "shorter durations"). */
function d(base, rm) {
  return base * (rm ? 0.7 : 1);
}

function take(pool) {
  const i = acquire(pool);
  return i < 0 ? null : pool.items[i];
}

export function spawnShockwave(pool, x, y, opts, rm) {
  const p = take(pool);
  if (!p) return;
  p.kind = 'shockwave';
  p.x = x; p.y = y;
  p.size = opts.size ?? 0.25; // start radius, world units
  p.p0 = opts.growth ?? 2.6; // radius added over life, world units
  p.life = d(opts.duration ?? 0.5, rm);
  p.color = opts.color ?? '#ffffff';
  p.alpha0 = opts.alpha ?? 0.9;
  // Line width in WORLD units at the start (p1) and end (p2) of its life —
  // a ring that stays a fixed thin hairline the whole time reads as a
  // decal, not a shockwave; thinning it as it expands (round 2 feedback)
  // sells "a thick wall of force spreading out and losing energy".
  p.p1 = opts.thickness0 ?? 0.05;
  p.p2 = opts.thickness1 ?? p.p1;
}

export function spawnRipple(pool, x, y, opts, rm) {
  const p = take(pool);
  if (!p) return;
  p.kind = 'ripple';
  p.x = x; p.y = y;
  p.size = 0.1;
  p.p0 = opts.growth ?? 1.4;
  p.life = d(opts.duration ?? 0.45, rm);
  p.color = opts.color ?? '#bfe3ff';
  p.alpha0 = 0.6;
}

export function spawnFloatText(pool, x, y, opts, rm) {
  const p = take(pool);
  if (!p) return;
  p.kind = 'floatText';
  p.x = x; p.y = y;
  p.text = String(opts.text ?? '');
  p.color = opts.color ?? '#f3ead7';
  p.size = opts.size ?? 0.34; // baseline font size, world units — a straight
  // multiplier, so a keep capture/bounty can pass a bigger one (round 2).
  p.p0 = opts.rise ?? 1.1; // world units risen over life
  p.life = d(opts.duration ?? 0.9, rm);
  p.alpha0 = 1;
}

export function spawnCoins(pool, x, y, opts, rm) {
  const to = opts.toScreen;
  if (!to) return; // coins need a screen-space target; nothing to draw without one
  const n = Math.max(1, Math.round((opts.count ?? 10) * (rm ? 0.35 : 1)));
  for (let i = 0; i < n; i++) {
    const p = take(pool);
    if (!p) break;
    p.kind = 'coins';
    p.x = x + rand(-0.25, 0.25); p.y = y + rand(-0.15, 0.15);
    p.sx = to.x + rand(-10, 10); p.sy = to.y + rand(-6, 6);
    p.p0 = rand(46, 86); // arc height, CSS px
    p.p1 = i * 0.035; // stagger, sec
    p.life = d((opts.duration ?? 0.6) + p.p1, rm);
    p.size = rand(0.16, 0.24);
    p.color = opts.color ?? GOLD;
    p.spin = rand(6, 12) * (Math.random() < 0.5 ? -1 : 1);
    p.seed = Math.random();
  }
}

// Arrow flight time and fireball fall time are NOT scaled by reduceMotion:
// both mirror timing the battle sim already committed to (an arrow volley's
// travel time, a firestorm's `delay` before impact — see ARCHITECTURE §6's
// `pending` effects), so shrinking them would desync the visual from the
// mechanical moment it is representing.
export function spawnArrow(pool, x, y, opts) {
  const to = opts.to;
  if (!to) return;
  const p = take(pool);
  if (!p) return;
  p.kind = 'arrow';
  p.x = x; p.y = y;
  p.tx = to.x; p.ty = to.y;
  p.p0 = opts.arc ?? 0.55;
  p.life = opts.duration ?? 0.35;
  p.color = opts.color ?? '#e9dcb8';
}

export function spawnFireball(pool, x, y, opts) {
  const p = take(pool);
  if (!p) return;
  p.kind = 'fireball';
  p.x = x; p.y = y; // impact point — the head falls TO here, not from here
  p.p0 = opts.delay ?? 0.8; // seconds to fall
  p.p1 = opts.dropHeight ?? 9; // world units above the target it falls from
  p.p3 = opts.radius ?? 1.3; // blast radius, world units (DESIGN §4.5 Firestorm default)
  p.life = p.p0; // dies exactly on impact; fx.js triggers the explosion then
  p.color = opts.color ?? '#ff7a3d';
  // Round 2: "the player sees where it will land" — a pulsing danger ring
  // for the whole delay, synced 1:1 since it shares the same duration.
  if (opts.telegraph !== false) {
    spawnTelegraph(pool, x, y, { radius: p.p3, duration: p.p0, color: opts.telegraphColor });
  }
}

/** Called by fx.js right when a `fireball` particle's fall completes. */
export function explodeFireball(spawnFn, x, y, radius = 1.3) {
  spawnFn('fireBloom', x, y, { radius });
  spawnFn('embers', x, y, { count: 30, spread: radius * 0.55 });
  spawnFn('smoke', x, y, { count: 6, spread: radius * 0.5 });
  spawnFn('shockwave', x, y, {
    size: radius * 0.25, growth: radius * 1.1, duration: 0.5, color: '#ffd28a',
    thickness0: 0.14, thickness1: 0.02,
  });
  spawnFn('scorch', x, y, { size: radius * 0.85 });
}

// A brief, big orange->yellow fill so the player can actually SEE the area a
// blast covers, not just its rim (round 2 feedback: the ring alone read as
// "a small ring", not "this whole patch of ground just got hit"). Additive,
// so it reads as light/heat rather than a flat coloured disc.
export function spawnFireBloom(pool, x, y, opts, rm) {
  const p = take(pool);
  if (!p) return;
  p.kind = 'fireBloom';
  p.x = x; p.y = y;
  p.size = opts.radius ?? 1.3; // full blast radius, world units
  p.life = d(opts.duration ?? 0.42, rm);
  p.color = opts.color ?? '#ff8a3d';
}

// Pulsing danger-zone ring, shown on the ground for the duration of a
// delayed strike (e.g. Firestorm's 0.8s wind-up) so the player has a real
// chance to react before impact. Pulse speeds up as impact nears.
export function spawnTelegraph(pool, x, y, opts, rm) {
  const p = take(pool);
  if (!p) return;
  p.kind = 'telegraph';
  p.x = x; p.y = y;
  p.size = opts.radius ?? 1.3;
  p.life = d(opts.duration ?? 0.8, rm);
  p.color = opts.color ?? '#ff4d4d';
}

// Victory-flood helper (round 2, item 5): one tile's soft owner-colour
// shimmer, for the integrator to spawn per tile in an outward ripple as the
// region floods. Deliberately tiny and cheap — a real flood spawns dozens.
export function spawnFlood(pool, x, y, opts, rm) {
  const p = take(pool);
  if (!p) return;
  p.kind = 'flood';
  p.x = x; p.y = y;
  p.size = opts.size ?? 0.5; // hex units — roughly one tile's radius
  p.life = d(opts.duration ?? 0.35, rm);
  p.color = opts.color ?? GOLD;
}

export function spawnScorch(pool, x, y, opts, rm) {
  const p = take(pool);
  if (!p) return;
  p.kind = 'scorch';
  p.x = x; p.y = y;
  p.size = opts.size ?? rand(0.75, 0.95);
  p.rot = rand(0, TAU);
  p.life = d(opts.duration ?? 6, rm);
  p.color = opts.color ?? '#1c140f';
  p.seed = Math.random();
}

export function spawnShield(pool, x, y, opts, rm) {
  const p = take(pool);
  if (!p) return;
  p.kind = 'shield';
  p.x = x; p.y = y;
  p.size = opts.radius ?? 1.05;
  p.life = opts.duration ?? d(8, rm);
  p.color = opts.color ?? '#9fd8ff';
}

export function spawnRally(pool, x, y, opts, rm) {
  const to = opts.to;
  if (!to) return;
  const p = take(pool);
  if (!p) return;
  p.kind = 'rally';
  p.x = x; p.y = y;
  p.tx = to.x; p.ty = to.y;
  p.life = d(opts.duration ?? 0.7, rm);
  p.color = opts.color ?? GOLD;
}
