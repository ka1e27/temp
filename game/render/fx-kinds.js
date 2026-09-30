// What each fx `kind` IS: spawn-time initialisation and per-frame update for
// every particle kind in DESIGN.md §7.4. `fx-draw.js` is the other half (how
// each kind is painted); `fx.js` just wires pool + spawn + update + draw
// together and exposes the public API.
//
// Two families of kind, by field convention:
//
//  PHYSICS kinds (dust, sparks, burstShard, embers, smoke, confetti, levy):
//    one pool slot per visible speck; `update` integrates x/y from vx/vy/
//    gx/gy every frame, like any other particle system. Organic scatter
//    wants per-speck randomness, so this is real simulation, not a shortcut.
//    Defined in THIS file.
//
//  PROGRESS kinds (shockwave, ripple, floatText, coins, arrow, fireball,
//  fireBloom, telegraph, flood, scorch, shield, rally, burstFlash): one pool
//  slot draws ONE structured shape whose position/size/alpha are a pure
//  function of `t / life` (plus a few spawn-time constants in
//  x/y/tx/ty/sx/sy/p0..p3). `update` only advances `t`; all the shape math
//  lives in fx-draw.js. Defined in `fx-kinds-progress.js` — this file
//  crossed ~500 lines once round 2 added fireBloom/telegraph/flood, and
//  CLAUDE.md asks for files "ideally < 500 lines".
//
// `rm` (reduceMotion) scales particle COUNTS and lifetimes down; it never
// changes what a kind fundamentally looks like.
import { acquire } from './fx-pool.js';
import { FACTIONS } from '../config/world.js';
// `game/render/palette.js` (the render engineer's file) declares itself safe
// to import from anywhere under game/render/ — reused here so fx colours
// (gold coins, gold sparkles) are the exact same gold as the HUD's gold
// counter and gold token (DESIGN §7.5), not a close-but-different hardcode.
import { ACCENTS } from './palette.js';
import {
  spawnShockwave, spawnRipple, spawnFloatText, spawnCoins, spawnArrow, spawnFireball,
  explodeFireball, spawnFireBloom, spawnTelegraph, spawnFlood, spawnScorch, spawnShield, spawnRally,
} from './fx-kinds-progress.js';

const TAU = Math.PI * 2;
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

const GOLD = ACCENTS.gold;
const DUST_COLOR = '#d9c79a';
const SPARK_COLORS = ['#fff3c4', '#ffd873', '#ff9a3d'];
const EMBER_COLORS = ['#ffe3a0', '#ffb15e', '#ff6a3d'];
const SMOKE_COLOR = '#6b6f76';
const CONFETTI_DEFAULT = FACTIONS.map((f) => f.color);

/** Count scaled for reduceMotion (spec: "particle counts × 0.35"). */
function n(base, rm) {
  return Math.max(1, Math.round(base * (rm ? 0.35 : 1)));
}
/** Duration scaled for reduceMotion (spec: "shorter durations"). */
function d(base, rm) {
  return base * (rm ? 0.7 : 1);
}

function take(pool) {
  const i = acquire(pool);
  return i < 0 ? null : pool.items[i];
}

// ---------------------------------------------------------------- physics --

function spawnDust(pool, x, y, opts, rm) {
  const count = n(opts.count ?? 7, rm);
  const color = opts.color ?? DUST_COLOR;
  for (let i = 0; i < count; i++) {
    const p = take(pool);
    if (!p) break;
    const a = rand(0, TAU);
    const spd = rand(0.35, 0.85);
    p.kind = 'dust';
    p.x = x; p.y = y;
    p.vx = Math.cos(a) * spd; p.vy = Math.sin(a) * spd * 0.45 - 0.3;
    p.gx = 0; p.gy = 0.55;
    p.life = d(rand(0.4, 0.65), rm);
    p.size = rand(0.12, 0.22);
    p.color = color;
    p.alpha0 = 0.55;
    p.seed = Math.random();
  }
}

function spawnSparks(pool, x, y, opts, rm) {
  const count = n(opts.count ?? 14, rm);
  for (let i = 0; i < count; i++) {
    const p = take(pool);
    if (!p) break;
    const a = rand(0, TAU);
    const spd = rand(1.8, 3.8);
    p.kind = 'sparks';
    p.x = x; p.y = y;
    p.vx = Math.cos(a) * spd; p.vy = Math.sin(a) * spd;
    p.gx = 0; p.gy = 4.2;
    p.life = d(rand(0.22, 0.4), rm);
    p.size = rand(0.06, 0.12);
    p.color = pick(SPARK_COLORS);
    p.alpha0 = 1;
    p.rot = a;
  }
  // A single bright instant at the point of impact — without it, a clash
  // reads as "a few thin lines" rather than "two things just hit each
  // other". Reuses the same glow draw as burst's flash, just smaller/faster.
  const flash = take(pool);
  if (flash) {
    flash.kind = 'burstFlash';
    flash.x = x; flash.y = y;
    flash.size = opts.flashSize ?? 0.26;
    flash.life = d(0.16, rm);
    flash.color = opts.color ?? '#fff3c4';
  }
  // A low dust puff underfoot — round 2 feedback: without it a field clash
  // is "sparks in mid-air"; with it, it reads as two squads scuffling on
  // the ground. Reuses the same kind `send`'s gate-puff uses.
  spawnDust(pool, x, y, { count: opts.dustCount ?? 5, color: opts.dustColor ?? DUST_COLOR }, rm);
}

// Chunky owner-colour splinters, not dots — round 2 feedback asked for
// "small quads/triangles" you can see are debris, not a firework. Drag
// (see updateParticle's DRAG_RATE) plus a little gravity and spin makes
// them tumble and settle rather than fly forever in a straight line.
function spawnBurstShards(pool, x, y, opts, rm) {
  const count = n(opts.count ?? 18, rm);
  const color = opts.color ?? GOLD;
  for (let i = 0; i < count; i++) {
    const p = take(pool);
    if (!p) break;
    const a = (i / count) * TAU + rand(-0.2, 0.2);
    const spd = rand(2.0, 4.4);
    p.kind = 'burstShard';
    p.x = x; p.y = y;
    p.vx = Math.cos(a) * spd; p.vy = Math.sin(a) * spd;
    p.gx = 0; p.gy = 1.1;
    p.life = d(rand(0.45, 0.75), rm);
    p.size = rand(0.12, 0.2);
    p.color = color;
    p.rot = rand(0, TAU);
    p.spin = rand(-11, 11);
    p.shape = i % 2;
  }
}

function spawnEmbers(pool, x, y, opts, rm) {
  const count = n(opts.count ?? 16, rm);
  const spread = opts.spread ?? 0.15; // world units — a big blast fills a wide area, not a pinpoint
  for (let i = 0; i < count; i++) {
    const p = take(pool);
    if (!p) break;
    const a = rand(-Math.PI / 2 - 0.9, -Math.PI / 2 + 0.9);
    const spd = rand(0.5, 1.8) * (1 + spread);
    p.kind = 'ember';
    p.x = x + rand(-spread, spread); p.y = y + rand(-spread * 0.4, 0);
    p.vx = Math.cos(a) * spd * 0.5; p.vy = Math.sin(a) * spd;
    p.gx = 0; p.gy = -0.3; // embers keep drifting up, slowly
    p.life = d(rand(0.5, 1.0), rm);
    p.size = rand(0.05, 0.11);
    p.color = pick(EMBER_COLORS);
    p.alpha0 = 1;
    p.seed = Math.random();
  }
}

function spawnSmoke(pool, x, y, opts, rm) {
  const count = n(opts.count ?? 5, rm);
  const spread = opts.spread ?? 0.2;
  for (let i = 0; i < count; i++) {
    const p = take(pool);
    if (!p) break;
    p.kind = 'smoke';
    p.x = x + rand(-spread, spread); p.y = y + rand(-spread * 0.3, 0);
    p.vx = rand(-0.15, 0.15); p.vy = rand(-0.6, -0.4);
    p.gx = 0; p.gy = -0.15;
    p.life = d(rand(opts.minLife ?? 1.2, opts.maxLife ?? 1.7), rm); // ~1.5s: "rise and linger"
    p.size = rand(0.22, 0.34) * (1 + spread * 0.6);
    p.color = opts.color ?? SMOKE_COLOR;
    p.alpha0 = 0.45;
    p.seed = Math.random();
  }
}

function spawnLevy(pool, x, y, opts, rm) {
  const count = n(opts.count ?? 5, rm);
  for (let i = 0; i < count; i++) {
    const p = take(pool);
    if (!p) break;
    p.kind = 'levy';
    p.x = x + rand(-0.3, 0.3); p.y = y + rand(-0.1, 0.1);
    p.vx = rand(-0.12, 0.12); p.vy = rand(-0.7, -0.45);
    p.gx = 0; p.gy = 0;
    p.life = d(rand(0.6, 0.95), rm);
    p.size = rand(0.045, 0.075);
    p.color = opts.color ?? GOLD;
    p.alpha0 = 1;
    p.seed = Math.random() * TAU; // twinkle phase
  }
}

function spawnConfettiPieces(pool, x, y, opts, rm) {
  if (rm) return; // spec: reduceMotion disables confetti entirely
  const count = Math.max(1, Math.round(opts.count ?? 70));
  const colors = opts.colors ?? CONFETTI_DEFAULT;
  const spread = opts.spread ?? 7;
  for (let i = 0; i < count; i++) {
    const p = take(pool);
    if (!p) break;
    p.kind = 'confetti';
    p.x = x + rand(-spread, spread);
    p.y = y - rand(2, 6);
    p.vx = rand(-0.5, 0.5);
    p.vy = rand(0.6, 1.4);
    p.gx = 0; p.gy = 0.5;
    p.life = rand(1.5, 2.3);
    p.size = rand(0.09, 0.16);
    p.color = pick(colors);
    p.spin = rand(-9, 9);
    p.shape = i % 3;
    p.seed = Math.random() * TAU;
  }
}

// Capture: the single most important moment on the map after "you won",
// per the lead's round-2 note, and it has to read in one glance at both
// battle zoom AND the full-map overview. Five layered pieces, each doing
// one job: an instant white-hot flash (the "hit"), chunky flying shards
// (the "something broke"), a thick owner-colour ring thinning as it grows
// (the "force spreading out"), a thinner white ring leading just ahead of
// it (the "shock front"), and a few rising sparkles (the settle).
function spawnBurst(pool, x, y, opts, rm) {
  const color = opts.color ?? GOLD;

  const flash = take(pool);
  if (flash) {
    flash.kind = 'burstFlash';
    flash.x = x; flash.y = y;
    flash.size = opts.flashSize ?? 0.6; // ~0.6 hex radius, per spec
    flash.life = d(0.09, rm); // ~90ms
    flash.color = '#ffffff';
    flash.color2 = color; // rim colour once the white core burns through
  }

  spawnBurstShards(pool, x, y, opts, rm);

  const ringGrowth = opts.ringGrowth ?? 1.35; // world units of radius, ≈1.6 hex all-in with the 0.25 start
  spawnShockwave(pool, x, y, {
    size: 0.25, growth: ringGrowth, duration: d(0.42, rm),
    color, alpha: 1, thickness0: 0.11, thickness1: 0.016,
  }, false);
  spawnShockwave(pool, x, y, {
    size: 0.32, growth: ringGrowth * 1.2, duration: d(0.32, rm),
    color: '#ffffff', alpha: 0.9, thickness0: 0.045, thickness1: 0.008,
  }, false);

  spawnLevy(pool, x, y, { count: opts.sparkleCount ?? 4, color }, rm);
}

export { explodeFireball };

export const SPAWNERS = Object.freeze({
  dust: spawnDust,
  sparks: spawnSparks,
  burst: spawnBurst,
  shockwave: spawnShockwave,
  floatText: spawnFloatText,
  coins: spawnCoins,
  embers: spawnEmbers,
  smoke: spawnSmoke,
  scorch: spawnScorch,
  arrow: spawnArrow,
  fireball: spawnFireball,
  confetti: spawnConfettiPieces,
  ripple: spawnRipple,
  levy: spawnLevy,
  shield: spawnShield,
  rally: spawnRally,
  fireBloom: spawnFireBloom,
  telegraph: spawnTelegraph,
  flood: spawnFlood,
});

/** Kinds that spawn real per-speck pool entries and so respect reduceMotion counts. */
const PHYSICS_KINDS = new Set(['dust', 'sparks', 'burstShard', 'ember', 'smoke', 'confetti', 'levy']);

// Per-second exponential drag applied to a few kinds whose brief explicitly
// asks for "drag" (round 2: burst shards should tumble and settle, not fly
// forever in a straight line). Everything else is a plain ballistic arc.
const DRAG_RATE = { burstShard: 3.2 };

/** @returns {boolean} true if the particle just died and should be released. */
export function updateParticle(p, dt) {
  p.t += dt;
  if (p.t >= p.life) return true;
  if (PHYSICS_KINDS.has(p.kind)) {
    const drag = DRAG_RATE[p.kind];
    if (drag) {
      const k = Math.exp(-drag * dt);
      p.vx *= k; p.vy *= k;
    }
    p.vx += p.gx * dt;
    p.vy += p.gy * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.spin * dt;
  }
  return false;
}

/** Additive ("lighter") kinds get glow; everything else is normal alpha blend. */
export function isAdditiveKind(kind) {
  switch (kind) {
    case 'sparks':
    case 'burstFlash':
    case 'ember':
    case 'shockwave':
    case 'coins':
    case 'arrow':
    case 'fireball':
    case 'levy':
    case 'ripple':
    case 'rally':
    case 'fireBloom':
    case 'telegraph':
    case 'flood':
      return true;
    default:
      return false; // dust, smoke, scorch, floatText, confetti, shield, burstShard
  }
}
