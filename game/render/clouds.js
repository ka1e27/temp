// Fog-of-the-unknown clouds (DESIGN §3.4, §7.1): large soft puffs that drift
// and slowly morph over hidden regions, plus faint shadows drifting over
// visible land. Pure drawing + a deterministic placement helper — no timers,
// no DOM; the caller supplies `t` (seconds) and moves puffs itself.

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A soft, layered radial-gradient cloud puff, centred at (x, y) with a
 * roughly-r radius. Slowly morphs (lobes breathe in/out) driven by `t`;
 * `seed` decorrelates puffs in the same field so a whole sky doesn't
 * pulse in unison.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} r
 * @param {number} alpha 0..1 overall opacity (e.g. fade in/out on reveal)
 * @param {number} t seconds
 * @param {number} seed
 */
export function drawCloudPuff(ctx, x, y, r, alpha, t, seed) {
  if (r <= 0 || alpha <= 0) return;
  const rng = mulberry32((seed >>> 0) || 1);
  const lobes = 5;
  const baseAngle = [];
  const baseDist = [];
  const baseR = [];
  for (let i = 0; i < lobes; i++) {
    baseAngle.push(rng() * Math.PI * 2);
    baseDist.push(0.32 + rng() * 0.3);
    baseR.push(0.4 + rng() * 0.26);
  }
  const phase0 = (seed % 1000) * 0.011;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Undershadow first, for a touch of volume against the sky/terrain below —
  // a subtle grey-blue so the puff doesn't read as a flat white disc.
  const gShade = ctx.createRadialGradient(x, y + r * 0.34, 0, x, y + r * 0.34, r);
  gShade.addColorStop(0, 'rgba(118,142,172,0.26)');
  gShade.addColorStop(1, 'rgba(118,142,172,0)');
  ctx.fillStyle = gShade;
  ctx.beginPath();
  ctx.arc(x, y + r * 0.32, r * 0.95, 0, Math.PI * 2);
  ctx.fill();

  // Flat soft base so the lobes read as one body rather than loose bubbles.
  // Deliberately capped well under 1.0 alpha even in the core: several puffs
  // overlap in a field, and full-white cores stack into a blown-out glow.
  const gBase = ctx.createRadialGradient(x, y, 0, x, y, r);
  gBase.addColorStop(0, 'rgba(247,249,251,0.55)');
  gBase.addColorStop(0.6, 'rgba(247,249,251,0.34)');
  gBase.addColorStop(1, 'rgba(247,249,251,0)');
  ctx.fillStyle = gBase;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < lobes; i++) {
    const ph = phase0 + i * 1.7;
    const ang = baseAngle[i] + Math.sin(t * 0.045 + ph) * 0.12;
    const dist = r * baseDist[i] * (0.85 + 0.15 * Math.sin(t * 0.07 + ph * 1.3));
    const lr = r * baseR[i] * (0.9 + 0.1 * Math.sin(t * 0.06 + ph * 0.8));
    const lx = x + Math.cos(ang) * dist;
    const ly = y + Math.sin(ang) * dist * 0.65;
    const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, lr);
    g.addColorStop(0, 'rgba(252,253,255,0.5)');
    g.addColorStop(1, 'rgba(252,253,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(lx, ly, lr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * A faint cloud shadow drifting over visible land — draw this into the
 * terrain layer, well before settlements/units (ARCHITECTURE §7 draw order).
 */
export function drawCloudShadow(ctx, x, y, r, alpha) {
  if (r <= 0 || alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.scale(1, 0.55);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  g.addColorStop(0, 'rgba(18,26,36,0.55)');
  g.addColorStop(1, 'rgba(18,26,36,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ------------------------------------------------------------ sprite cache
// `drawCloudPuff` rebuilds several radial gradients from scratch — fine for
// a handful of live, morphing hero puffs, too slow for the 150+ puffs a
// fully-clouded map can have on screen at once. `getPuffSprite` bakes a
// puff once per (size bucket, shape variant) into an offscreen canvas the
// caller can blit with `drawImage` — trading the slow per-frame morph for
// near-zero per-puff cost.
const SPRITE_BUCKETS = [14, 20, 28, 40, 56, 80, 112, 160, 224];
const SPRITE_VARIANTS = 4;
const spriteCache = new Map();

function bucketFor(radiusPx) {
  for (let i = 0; i < SPRITE_BUCKETS.length; i++) {
    if (radiusPx <= SPRITE_BUCKETS[i]) return SPRITE_BUCKETS[i];
  }
  return SPRITE_BUCKETS[SPRITE_BUCKETS.length - 1];
}

function makeSpriteCanvas(size) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(size, size);
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    return c;
  }
  return null;
}

/**
 * A pre-rendered cloud puff at a bucketed pixel radius: `ctx.drawImage(
 * sprite.canvas, x - sprite.size/2, y - sprite.size/2)` after setting
 * `ctx.globalAlpha`. Static (no morph) — for a handful of hero/foreground
 * puffs that need to breathe, call `drawCloudPuff` directly instead.
 * `seed` only selects one of a few pre-baked shape variants, so a whole
 * field can still look varied even though each individual puff is a cached
 * bitmap; it does not give every puff a fully unique shape.
 * @param {number} radiusPx desired radius in CSS pixels (rounded up to a bucket)
 * @param {number} [seed]
 * @returns {{canvas: (HTMLCanvasElement|OffscreenCanvas), size: number, radius: number}|null}
 */
export function getPuffSprite(radiusPx, seed = 0) {
  const bucket = bucketFor(Math.max(1, radiusPx));
  const variant = ((seed >>> 0) || 0) % SPRITE_VARIANTS;
  const key = `${bucket}:${variant}`;
  const cached = spriteCache.get(key);
  if (cached) return cached;

  const size = Math.ceil(bucket * 2 * 1.4);
  const canvas = makeSpriteCanvas(size);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  drawCloudPuff(ctx, size / 2, size / 2, bucket, 1, variant * 4.1 + 1.3, 1000 + variant * 733 + bucket * 31);
  const sprite = { canvas, size, radius: bucket };
  spriteCache.set(key, sprite);
  return sprite;
}

/**
 * @typedef {Object} PuffSpec
 * @property {number} x
 * @property {number} y
 * @property {number} r
 * @property {number} alpha
 * @property {number} seed
 */

/**
 * Deterministically scatter a field of cloud puffs (clustered, like real
 * cumulus banks rather than uniform noise) across `bounds`. Plain,
 * JSON-serialisable specs — the caller places/animates/fades them.
 * @param {number} seed
 * @param {{minX:number, minY:number, maxX:number, maxY:number}} bounds
 * @returns {PuffSpec[]}
 */
export function makeCloudField(seed, bounds) {
  const rng = mulberry32((seed >>> 0) || 1);
  const minX = bounds?.minX ?? 0;
  const minY = bounds?.minY ?? 0;
  const maxX = bounds?.maxX ?? minX + 1;
  const maxY = bounds?.maxY ?? minY + 1;
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  // Every size here is a fraction of the bounds' own shorter side, so this
  // works whether `bounds` is in world units or screen pixels — there is no
  // pixel-scale constant to mismatch against a caller's zoom.
  const short = Math.min(w, h);
  const clusters = Math.max(1, Math.round((w * h) / (short * short * 0.9)));
  const puffs = [];
  for (let c = 0; c < clusters; c++) {
    const ccx = minX + rng() * w;
    const ccy = minY + rng() * h;
    const r0 = short * (0.15 + rng() * 0.09);
    const n = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const ang = rng() * Math.PI * 2;
      const dist = rng() * r0 * 0.85;
      puffs.push({
        x: ccx + Math.cos(ang) * dist,
        y: ccy + Math.sin(ang) * dist * 0.6,
        r: r0 * (0.55 + rng() * 0.5),
        alpha: 0.45 + rng() * 0.28,
        seed: Math.floor(rng() * 1e6),
      });
    }
  }
  return puffs;
}
