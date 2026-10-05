// Small bitmap caches for the things drawn many times a frame (Phase 8 perf): a squad's soldier figure (shadow + two dots), a troop badge (pill,
// outline, numerals) and a fluttering banner baked as a strip of frames. The drawing code itself stays in sprites.js; this module only bakes
// what it would draw into an offscreen canvas at DEVICE resolution, quantised to half a device pixel, and hands it back with the offsets to place
// it. The look is the same drawing, blitted: a figure drawn at s = 31.3 px uses the bake for 31.5 px scaled by 0.994.
//
// Text: the badges use the Nunito web font. A bake made before the font arrives would keep the fallback face for good, so every cache is
// emptied when the document's fonts finish loading. Each cache is capped (oldest bake dropped first).

const CAP = 700;
const caches = new Set();

function makeCache() {
  const m = new Map();
  caches.add(m);
  return m;
}
function remember(m, key, v) {
  if (m.size >= CAP) m.delete(m.keys().next().value);
  m.set(key, v);
  return v;
}
/** Empties every bake (fonts arrived, or a test wants a clean slate). */
export function clearSpriteCaches() { for (const m of caches) m.clear(); }
try {
  const fonts = globalThis.document && globalThis.document.fonts;
  if (fonts && fonts.addEventListener) fonts.addEventListener('loadingdone', clearSpriteCaches);
  if (fonts && fonts.ready) fonts.ready.then(clearSpriteCaches, () => {});
} catch { /* no DOM (unit tests) */ }

function canvasOf(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
  if (globalThis.document) { const c = globalThis.document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; }
  return null;
}

/** Half-device-pixel quantisation of a size in device px. */
export const quant = (v) => Math.max(0.5, Math.round(v * 2) / 2);

/** The device pixel ratio of the context's current transform (the renderer scales by its DPR; a camera shake only translates). */
export function ctxScale(ctx) {
  if (!ctx || typeof ctx.getTransform !== 'function') return 1;
  const m = ctx.getTransform();
  if (!m || typeof m.a !== 'number') return 1;
  return Math.hypot(m.a, m.b || 0) || 1;
}

const bakes = makeCache();
/**
 * A cached bake: `draw(bctx, ox, oy, q)` paints the thing with its anchor at (ox, oy) in a canvas of `w x h` device px, at size `q` (device px).
 * Returns { canvas, ox, oy, w, h, q } or null when no canvas can be made (the caller then draws live).
 */
export function bake(key, q, size, draw) {
  const k = `${key}|${q}`;
  const hit = bakes.get(k);
  if (hit) return hit;
  const { w, h, ox, oy } = size(q);
  const canvas = canvasOf(Math.ceil(w), Math.ceil(h));
  if (!canvas) return null;
  const bctx = canvas.getContext('2d');
  if (!bctx) return null;
  draw(bctx, ox, oy, q);
  return remember(bakes, k, { canvas, ox, oy, w: Math.ceil(w), h: Math.ceil(h), q });
}

/**
 * Blits a bake so that its anchor lands on (x, y) in the context's (CSS px) space, at the wanted device size `want` (the bake was made at `b.q`).
 */
export function blit(ctx, b, x, y, dpr, want) {
  const k = want / b.q / dpr;
  ctx.drawImage(b.canvas, x - b.ox * k, y - b.oy * k, b.w * k, b.h * k);
}

const strips = makeCache();
/**
 * A banner's flutter loop baked into `frames` frames (one period of `speed` rad/s), like render/sites.js does for the settlements' flags.
 * `drawFrame(bctx, ox, oy, sb, t)` draws one frame. Returns { canvas, fw, fh, ox, oy, sb, frames, speed }.
 */
export function bannerStrip(key, sb, drawFrame, frames = 36, speed = 2.1) {
  const k = `${key}|${sb}`;
  const hit = strips.get(k);
  if (hit) return hit;
  const fw = Math.ceil(1.8 * sb) + 2;
  const fh = Math.ceil(2.2 * sb) + 2;
  const ox = Math.ceil(0.16 * sb) + 1;
  const oy = Math.ceil(2.05 * sb) + 1;
  const canvas = canvasOf(fw * frames, fh);
  if (!canvas) return null;
  const bctx = canvas.getContext('2d');
  for (let i = 0; i < frames; i++) {
    bctx.save();
    bctx.translate(i * fw, 0);
    drawFrame(bctx, ox, oy, sb, (i / frames) * ((Math.PI * 2) / speed));
    bctx.restore();
  }
  return remember(strips, k, { canvas, fw, fh, ox, oy, sb, frames, speed });
}

/** Blits frame `t` (seconds, plus a stable `phase` in radians) of a strip with the flag's anchor at (x, y), at device size `want`. */
export function blitStrip(ctx, st, x, y, dpr, want, t, phase = 0) {
  const ph = ((((t * st.speed + phase) / (Math.PI * 2)) % 1) + 1) % 1;
  const frame = Math.floor(ph * st.frames) % st.frames;
  const k = want / st.sb / dpr;
  ctx.drawImage(st.canvas, frame * st.fw, 0, st.fw, st.fh, x - st.ox * k, y - st.oy * k, st.fw * k, st.fh * k);
}
