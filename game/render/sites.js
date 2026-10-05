// Settlement rendering: sprite cache per (type, faction, zoom bucket), plus
// the live per-frame overlays (banner, troop badge, hover/selection) drawn on
// top of the cached bitmap, and screen-space hit testing (INTEGRATION-NOTES
// "Input"). Browser only; no game-state mutation — callers pass plain data.
import { drawSettlement, drawBanner, drawTroopBadge, drawSelectionRing, BANNER_ANCHOR, bannerStyleVersion } from './sprites.js';
import { ACCENTS, rgba } from './palette.js';
import { nearestBucket } from '../scenes/timing.js';

// Must mirror sprites.js's own (unexported) building-footprint geometry so the
// live highlight glow / selection ring line up with the cached sprite exactly.
const SETTLEMENT_SCALE = 1.2;
function footprintOf(type, s) {
  const bs = s * SETTLEMENT_SCALE;
  const baseY = bs * 0.16;
  const footprint = type === 'gate' ? bs * 1.3 : type === 'keep' ? bs * 1.05 : type === 'fort' ? bs * 1.1 : bs * 0.85;
  return { bs, baseY, footprint };
}

// Generous upward tap-target extension (world-unit-ish, × zoom) per type —
// covers the banner pole + flag + tall building silhouettes (tower/keep/fort).
const HIT_EXTEND_UP = { hamlet: 1.3, village: 1.4, town: 2.0, fort: 2.1, tower: 2.9, keep: 2.3, camp: 1.5, bandit: 1.5, gate: 2.3, shrine: 2.0, ancientTower: 3.1 };

function makeCanvas(size) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(size, size);
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

function makeStrip(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function createSiteSpriteCache() {
  const cache = new Map(); // `${type}:${factionId}:${bucket}` -> { canvas, size, cx, cy, bucket }
  let dpr = 1;

  // Banners flutter on a ~3 s loop. Redrawing six-segment bezier cloth + emblem for every
  // settlement every frame is costly at hi-dpi. One full period is baked into a 36-frame
  // strip per (faction, bucket) and each site picks a frame from its own stable `opts.phase`.
  const BANNER_FRAMES = 36;
  const BANNER_SPEED = 2.1; // drawBanner's flutter speed (rad/s)
  const bannerCache = new Map(); // `${factionId}:${bucket}` -> { canvas, fw, fh, ox, oy, bucket }

  // Phase 8 perf: a few hundred settlements a frame ask for their sprite and banner at the same zoom: the bucket is worked out once per zoom and
  // numeric factions are looked up in plain arrays (no key string built per call)
  let lastS = -1;
  let lastBucket = 0;
  const bucketOf = (s) => { if (s !== lastS) { lastS = s; lastBucket = nearestBucket(s * dpr); } return lastBucket; };
  const fastSprites = new Map(); // bucket -> type -> [factionId] -> entry
  const fastStrips = new Map(); // bucket -> [factionId] -> strip

  let styleVer = bannerStyleVersion();
  function getBannerStrip(factionId, s) {
    // Phase 9: the realm's banner style changed: every baked flag is rebaked (only the player's look differs, but it is a rare event)
    if (styleVer !== bannerStyleVersion()) { styleVer = bannerStyleVersion(); bannerCache.clear(); fastStrips.clear(); }
    const bucket = bucketOf(s);
    const numeric = typeof factionId === 'number';
    let row = null;
    if (numeric) {
      row = fastStrips.get(bucket);
      if (!row) { row = []; fastStrips.set(bucket, row); }
      if (row[factionId]) return row[factionId];
    }
    const key = `${numeric ? factionId : factionId && (factionId.id ?? factionId.color)}:${bucket}`;
    let e = bannerCache.get(key);
    if (e) { if (row) row[factionId] = e; return e; }
    const sb = bucket * 0.46;
    const fw = Math.ceil(1.8 * sb) + 2;
    const fh = Math.ceil(2.2 * sb) + 2;
    const ox = Math.ceil(0.16 * sb) + 1;
    const oy = Math.ceil(2.05 * sb) + 1;
    const canvas = makeStrip(fw * BANNER_FRAMES, fh);
    const bctx = canvas.getContext('2d');
    for (let k = 0; k < BANNER_FRAMES; k++) {
      bctx.save();
      bctx.translate(k * fw, 0);
      drawBanner(bctx, ox, oy, sb, factionId, (k / BANNER_FRAMES) * ((Math.PI * 2) / BANNER_SPEED), { phase: 0 });
      bctx.restore();
    }
    e = { canvas, fw, fh, ox, oy, bucket };
    bannerCache.set(key, e);
    if (row) row[factionId] = e;
    return e;
  }

  function getSprite(type, factionId, s) {
    const bucket = bucketOf(s); // device px per world unit
    let row = null;
    if (typeof factionId === 'number') {
      let byType = fastSprites.get(bucket);
      if (!byType) { byType = new Map(); fastSprites.set(bucket, byType); }
      row = byType.get(type);
      if (!row) { row = []; byType.set(type, row); }
      if (row[factionId]) return row[factionId];
    }
    const key = typeof factionId === 'object' ? `${type}:${factionId && (factionId.id ?? factionId.color)}:${bucket}` : `${type}:${factionId}:${bucket}`;
    let entry = cache.get(key);
    if (entry) { if (row) row[factionId] = entry; return entry; }

    const { bs } = footprintOf(type, bucket);
    const size = Math.ceil(bs * 3.2);
    const canvas = makeCanvas(size);
    const ctx = canvas.getContext('2d');
    const cx = size / 2;
    const cy = size * 0.62;
    drawSettlement(ctx, type, cx, cy, bucket, factionId, {});
    entry = { canvas, size, cx, cy, bucket };
    cache.set(key, entry);
    if (row) row[factionId] = entry;
    return entry;
  }

  /**
   * Draws one settlement: cached plain sprite (scaled to the exact `s`),
   * live banner + troop badge, and — as live overlays, never baked — an
   * optional hover glow and/or selection ring.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} screenX @param {number} screenY ground anchor (unraised cy already elevation-shifted by the caller)
   * @param {number} s current px-per-world-unit (camera.zoom)
   * @param {string} type @param {number|object} factionId
   * @param {number} troops @param {number} t seconds, for banner flutter / pulses
   * @param {{highlight?:boolean, selected?:boolean, dim?:boolean, pulse?:boolean, hideBadge?:boolean,
   *   phase?:number, bannerDrop?:number, flash?:number}} [opts]
   *   phase: stable per-site banner flutter offset (radians); bannerDrop 0..1 sinks the flag;
   *   flash 1..0 draws a fading red ring on the badge. (Threat chips: drawThreatChips.)
   */
  function drawSite(ctx, screenX, screenY, s, type, factionId, troops, t, opts = {}) {
    // `badgeOnly`: just the troop badge (and its flash), drawn in a second pass OVER the squads so a crowd at the gate never hides the number
    if (opts.badgeOnly) { drawBadgePart(ctx, screenX, screenY, s, troops, factionId, t, opts); return; }
    const sprite = getSprite(type, factionId, s);
    const scale = s / sprite.bucket;

    if (opts.highlight) {
      const { bs, baseY, footprint } = footprintOf(type, s);
      const g = ctx.createRadialGradient(screenX, screenY + baseY - bs * 0.3, 0, screenX, screenY + baseY - bs * 0.3, footprint * 1.6);
      g.addColorStop(0, rgba(ACCENTS.gold, 0.3));
      g.addColorStop(1, rgba(ACCENTS.gold, 0));
      ctx.save();
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(screenX, screenY + baseY - bs * 0.3, footprint * 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // (no save/restore unless it is dimmed: a few hundred settlements a frame, Phase 8 perf)
    const a0 = ctx.globalAlpha;
    if (opts.dim) ctx.globalAlpha = a0 * 0.42;
    ctx.drawImage(
      sprite.canvas,
      screenX - sprite.cx * scale, screenY - sprite.cy * scale,
      sprite.size * scale, sprite.size * scale,
    );
    if (opts.dim) ctx.globalAlpha = a0;

    if (opts.selected) {
      const { bs, baseY, footprint } = footprintOf(type, s);
      drawSelectionRing(ctx, screenX, screenY + baseY + bs * 0.06, footprint * 1.15, ACCENTS.gold, t);
    }

    const anchor = BANNER_ANCHOR[type] || { dx: 0, dy: -1 };
    const strip = getBannerStrip(factionId, s);
    const ph = ((((t * BANNER_SPEED + (opts.phase || 0)) / (Math.PI * 2)) % 1) + 1) % 1;
    const frame = Math.floor(ph * BANNER_FRAMES) % BANNER_FRAMES;
    const k = s / strip.bucket;
    // `bannerDrop` 0..1: the flag sinks down its pole and fades (a defeated War Camp).
    const drop = Math.max(0, Math.min(1, opts.bannerDrop || 0));
    if (drop < 1) {
      const b0 = ctx.globalAlpha;
      if (drop > 0) ctx.globalAlpha = b0 * (1 - drop * 0.85);
      ctx.drawImage(
        strip.canvas, frame * strip.fw, 0, strip.fw, strip.fh,
        screenX + anchor.dx * s - strip.ox * k,
        screenY + anchor.dy * s - strip.oy * k + drop * s * 1.15,
        strip.fw * k, strip.fh * k,
      );
      if (drop > 0) ctx.globalAlpha = b0;
    }

    if (!opts.hideBadge) drawBadgePart(ctx, screenX, screenY, s, troops, factionId, t, opts);
  }

  function drawBadgePart(ctx, screenX, screenY, s, troops, factionId, t, opts) {
    {
      const badgeS = s * 0.95;
      const badgeY = screenY - s * 0.05;
      drawTroopBadge(ctx, screenX, badgeY, troops, factionId, badgeS, {
        pulse: opts.pulse ? t : false,
      });
      if (opts.flash) {
        // A brief red ring when the site was just lost, pulsing outward from the badge.
        const f = Math.max(0, Math.min(1, opts.flash));
        ctx.save();
        ctx.strokeStyle = `rgba(235,87,87,${0.85 * f})`;
        ctx.lineWidth = Math.max(2, s * 0.08);
        ctx.beginPath();
        ctx.arc(screenX, badgeY, s * (0.42 + (1 - f) * 0.5), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  /**
   * Threat chips ("−14 · holds" green / "falls, 6 short" red) hanging under the troop badges of
   * threatened settlements. Drawn as their OWN pass after squads and fx so nothing covers them, and
   * nudged down when two chips would overlap (neighbouring settlements).
   * @param {{x:number, y:number, s:number, threat:{text:string, holds:boolean}}[]} items x,y = the site's
   *   screen anchor (the same point passed to drawSite), s = its size
   */
  function drawThreatChips(ctx, items, t) {
    if (!items.length) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const placed = [];
    for (const it of items.slice().sort((p, q) => p.y - q.y)) {
      const font = Math.max(10.5, it.s * 0.3);
      const h = font * 1.55;
      ctx.font = `800 ${font}px Nunito, system-ui, sans-serif`;
      const w = ctx.measureText(it.threat.text).width + font * 1.1;
      const badgeS = it.s * 0.95;
      const badgeBottom = it.y - it.s * 0.05 + Math.max(10, badgeS * 0.62) / 2;
      let cy = badgeBottom + 3 + h / 2;
      for (let guard = 0; guard < 6; guard++) {
        const hit = placed.find((r) => Math.abs(r.x - it.x) < (r.w + w) / 2 + 2 && Math.abs(r.y - cy) < (r.h + h) / 2 + 1);
        if (!hit) break;
        cy = hit.y + (hit.h + h) / 2 + 2;
      }
      placed.push({ x: it.x, y: cy, w, h });
      const color = it.threat.holds ? ACCENTS.good : ACCENTS.bad;
      ctx.globalAlpha = it.threat.holds ? 1 : 0.86 + 0.14 * Math.sin(t * 7);
      ctx.beginPath();
      ctx.roundRect(it.x - w / 2, cy - h / 2, w, h, h / 2);
      ctx.fillStyle = 'rgba(10,12,18,0.88)';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillText(it.threat.text, it.x, cy + 0.5);
    }
    ctx.restore();
  }

  /** Sprites bake at device resolution so hi-dpi screens stay sharp. */
  function setPixelRatio(v) { if (v !== dpr) { dpr = v; lastS = -1; fastSprites.clear(); fastStrips.clear(); } }

  return { getSprite, drawSite, drawThreatChips, setPixelRatio };
}

/**
 * Screen-space hit test against a list of settlement-like candidates
 * (INTEGRATION-NOTES "Input"): project each anchor with `camera.worldToScreen`,
 * test against its screen box (extended upward for tall sprites), tolerance
 * `max(minWorld, 26px / zoom)` converted to screen px. Returns the closest hit's
 * `id`, or null.
 * @param {{id:*, x:number, y:number, type:string}[]} candidates world-unit anchor positions
 * @param {object} camera
 * @param {number} sx @param {number} sy
 * @param {{minWorld?: number}} [opts]
 */
export function hitTestSites(candidates, camera, sx, sy, opts = {}) {
  const minWorld = opts.minWorld ?? 0.32;
  const toleranceWorld = Math.max(minWorld, 26 / camera.zoom);
  const tolerancePx = toleranceWorld * camera.zoom;

  let best = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const p = camera.worldToScreen(c.x, c.y);
    const dx = sx - p.x;
    const dy = sy - p.y;
    const upExtendPx = (HIT_EXTEND_UP[c.type] ?? 1.5) * camera.zoom;
    const withinX = Math.abs(dx) <= tolerancePx;
    const withinY = dy <= tolerancePx * 0.9 && dy >= -(upExtendPx + tolerancePx * 0.5);
    if (!withinX || !withinY) continue;
    const dist = Math.hypot(dx, Math.max(0, dy));
    if (dist < bestDist) {
      bestDist = dist;
      best = c.id;
    }
  }
  return best;
}
