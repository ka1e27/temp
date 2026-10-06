// Fog of the unknown (DESIGN §3.4, §7.1, PLAYFEEL "Clouds"/victory choreography):
// a dense bank of soft puffs over every hidden region (lazily built per region,
// cached), a reveal transition (scale x1.6 + fade, 1.4 s) when a region is told
// it was just revealed, and faint cloud shadows drifting over visible land.
// Browser only; no game-state reads beyond the plain `hiddenRegionIds` the
// scene hands in each frame. Puffs are pre-baked sprites (clouds.js) blitted
// with drawImage — never live gradients.
import { drawCloudShadow, getPuffSprite } from './clouds.js';
import { createRng, hash32 } from '../core/rng.js';

const REVEAL_MS = 1400;
const CULL_MARGIN_WORLD = 5;
const TILES_PER_PUFF = 3.4;
const HAZE_ALPHA = 0.4;
const HAZE_COLOR = '#dde8f2';
const HEX_CORNERS = Array.from({ length: 6 }, (_, k) => {
  const a = ((-90 + 60 * k) * Math.PI) / 180;
  return [Math.cos(a), Math.sin(a)];
});

function buildShadowSpecs(world) {
  const rng = createRng(hash32(world.seed >>> 0, 'cloudshadow'));
  const b = world.bounds;
  const w = Math.max(1, b.maxX - b.minX);
  const h = Math.max(1, b.maxY - b.minY);
  const n = Math.max(6, Math.min(14, Math.round((w * h) / 260)));
  const specs = [];
  for (let i = 0; i < n; i++) {
    specs.push({
      x0: b.minX + rng.range(0, w),
      y0: b.minY + rng.range(0, h),
      range: rng.range(3, 9),
      speed: rng.range(0.03, 0.09),
      phase: rng.range(0, Math.PI * 2),
      r: rng.range(2.6, 5.2),
    });
  }
  return specs;
}

/**
 * @param {import('../world/generate.js').World} world
 */
export function createCloudLayer(world) {
  const fields = new Map(); // regionId -> puff specs (world units)
  const hazes = new Map(); // regionId -> Path2D of the region's hex tops (world units)
  const revealTransitions = new Map(); // regionId -> { startMs }
  const shadowSpecs = buildShadowSpecs(world);
  let dpr = 1;
  let ps = 1; // device px per CSS px of whatever surface the fog is currently drawn to
  // The fog is soft by nature, so it is composed at half resolution into its own buffer
  // and blitted once: a third of the fill cost of drawing 300+ big translucent puffs at
  // native resolution on a hi-dpi screen.
  const FOG_RES = 0.5;
  let fog = null; // { canvas, ctx, w, h }

  /** Dense puff bank covering the region's own tiles, jittered and varied. */
  function fieldFor(regionId) {
    let f = fields.get(regionId);
    if (f) return f;
    const region = world.regions[regionId];
    if (!region) return null;
    const rng = createRng(hash32(world.seed >>> 0, 'fog', regionId));
    // PLAN-PHASE12: a region's ford tiles (water) take no fog: the strait stays visible, and a battle's arena (which borrows the fords touching it)
    // is never fogged by a hidden neighbour's ford
    const land = region.tiles.map((i) => world.tiles[i]).filter((t) => !t.ford);
    const pts = land.length ? land : region.tiles.map((i) => world.tiles[i]);
    const n = Math.max(4, Math.round(pts.length / TILES_PER_PUFF) + 2);
    f = [];
    for (let k = 0; k < n; k++) {
      // Anchor each puff on a random region tile (so every tile stays covered
      // in expectation), then jitter by up to a tile.
      const t = pts[Math.floor(rng.range(0, pts.length)) % pts.length];
      const big = rng.next() < 0.28;
      f.push({
        x: t.x + rng.range(-1.1, 1.1),
        y: t.y + rng.range(-0.9, 0.9),
        r: big ? rng.range(3.0, 4.0) : rng.range(1.9, 2.9),
        alpha: rng.range(0.62, 0.92),
        seed: Math.floor(rng.range(0, 1e6)),
        phase: rng.range(0, Math.PI * 2),
        amp: rng.range(0.25, 0.7),
        // Deterministic reveal stagger so the bank peels apart rather than
        // fading in lockstep.
        delay: rng.range(0, 0.35),
      });
    }
    fields.set(regionId, f);
    return f;
  }

  /** A milky wash over the region's whole silhouette: hidden land reads as unexplored
   *  (pale, desaturated) even where the puffs leave gaps. */
  function hazeFor(regionId) {
    let p = hazes.get(regionId);
    if (p) return p;
    p = new Path2D();
    const region = world.regions[regionId];
    for (const i of region.tiles) {
      const t = world.tiles[i];
      if (t.ford) continue; // no haze over a strait (PLAN-PHASE12)
      const lift = t.elev === 3 ? 0.5 : t.elev === 2 ? 0.34 : t.elev === 1 ? 0.22 : 0;
      for (let k = 0; k < 6; k++) {
        const x = t.x + HEX_CORNERS[k][0] * 1.02;
        const y = t.y - lift + HEX_CORNERS[k][1] * 1.02;
        if (k === 0) p.moveTo(x, y); else p.lineTo(x, y);
      }
      p.closePath();
    }
    hazes.set(regionId, p);
    return p;
  }

  function drawHaze(ctx, camera, regionId, alpha) {
    if (alpha <= 0.01) return;
    const c = camera.worldToScreen(0, 0);
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = HAZE_COLOR;
    ctx.fill(hazeFor(regionId));
    ctx.restore();
  }

  function bboxVisible(region, vb) {
    return !(region.bbox.maxX < vb.minX || region.bbox.minX > vb.maxX
      || region.bbox.maxY < vb.minY || region.bbox.minY > vb.maxY);
  }

  function drawPuffField(ctx, camera, puffs, t, vb, reveal, fade = 1) {
    const zoom = camera.zoom;
    for (let i = 0; i < puffs.length; i++) {
      const puff = puffs[i];
      let scale = 1;
      let alpha = puff.alpha * fade;
      let dx = 0;
      let dy = 0;
      if (reveal >= 0) {
        // Each puff has its own delay inside the total reveal window.
        const local = Math.min(1, Math.max(0, (reveal - puff.delay) / (1 - puff.delay)));
        scale = 1 + local * 0.6;
        alpha *= 1 - local;
        // Drift outward from the region centre as it parts.
        dx = Math.cos(puff.phase) * local * 0.9;
        dy = Math.sin(puff.phase) * local * 0.5;
        if (alpha <= 0.01) continue;
      }
      const wx = puff.x + dx + Math.sin(t * 0.05 + puff.phase) * puff.amp;
      const wy = puff.y + dy + Math.cos(t * 0.037 + puff.phase * 1.3) * puff.amp * 0.35;
      if (wx < vb.minX || wx > vb.maxX || wy < vb.minY || wy > vb.maxY) continue;
      const screen = camera.worldToScreen(wx, wy);
      const rPx = puff.r * zoom * scale;
      const sprite = getPuffSprite(rPx * ps, puff.seed);
      if (!sprite) continue;
      // The sprite is baked for radius `sprite.radius` device px; scale it to the
      // exact radius we want on screen.
      const k = rPx / sprite.radius;
      const size = sprite.size * k;
      ctx.globalAlpha = alpha;
      ctx.drawImage(sprite.canvas, screen.x - size / 2, screen.y - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} camera
   * @param {Iterable<number>} hiddenRegionIds regions currently NOT revealed (DESIGN §3.4)
   * @param {number} t seconds, for drift
   * @param {number} nowMs wall-clock ms, for reveal-transition timing
   * @param {number} [fade] 0..1 global opacity of the standing fog banks (mists rolling in)
   */
  function draw(mainCtx, camera, hiddenRegionIds, t, nowMs, fade = 1) {
    const vb = camera.visibleBounds(CULL_MARGIN_WORLD);
    let any = revealTransitions.size > 0;
    if (!any) {
      for (const id of hiddenRegionIds) {
        const region = world.regions[id];
        if (region && bboxVisible(region, vb)) { any = true; break; }
      }
    }
    if (!any || fade <= 0.01 && revealTransitions.size === 0) return;
    const fw = Math.max(1, Math.ceil(camera.viewW * FOG_RES));
    const fh = Math.max(1, Math.ceil(camera.viewH * FOG_RES));
    if (!fog || fog.w !== fw || fog.h !== fh) {
      const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(fw, fh) : Object.assign(document.createElement('canvas'), { width: fw, height: fh });
      fog = { canvas, ctx: canvas.getContext('2d'), w: fw, h: fh, sig: '', at: -1e9 };
    }
    // Phase 8 perf: the banks drift a hair a second, so while the camera holds still (and nothing is parting) the composed buffer is reused for 120 ms
    let hs = 0;
    for (const id of hiddenRegionIds) hs = (hs * 31 + id + 1) | 0;
    const sig = `${camera.x},${camera.y},${camera.zoom},${fw},${fh},${fade},${hs}`;
    const reuse = revealTransitions.size === 0 && fog.sig === sig && nowMs >= fog.at && nowMs - fog.at < 120;
    if (!reuse) { fog.sig = sig; fog.at = nowMs; composeFog(camera, hiddenRegionIds, t, nowMs, fade, vb, fw, fh); }
    mainCtx.save();
    mainCtx.imageSmoothingEnabled = true;
    mainCtx.imageSmoothingQuality = 'medium';
    mainCtx.drawImage(fog.canvas, 0, 0, fw, fh, 0, 0, camera.viewW, camera.viewH);
    mainCtx.restore();
  }

  function composeFog(camera, hiddenRegionIds, t, nowMs, fade, vb, fw, fh) {
    const ctx = fog.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, fw, fh);
    ctx.setTransform(FOG_RES, 0, 0, FOG_RES, 0, 0);
    ps = FOG_RES;
    drawBanks(ctx, camera, hiddenRegionIds, t, nowMs, fade, vb);
    ps = dpr;
  }

  function drawBanks(ctx, camera, hiddenRegionIds, t, nowMs, fade, vb) {
    ctx.save();
    for (const regionId of hiddenRegionIds) {
      const region = world.regions[regionId];
      if (!region || !bboxVisible(region, vb)) continue;
      const puffs = fieldFor(regionId);
      if (fade > 0.01) drawHaze(ctx, camera, regionId, HAZE_ALPHA * fade);
      if (puffs && fade > 0.01) drawPuffField(ctx, camera, puffs, t, vb, -1, fade);
    }

    if (revealTransitions.size > 0) {
      for (const [regionId, tr] of [...revealTransitions]) {
        const region = world.regions[regionId];
        const p = (nowMs - tr.startMs) / REVEAL_MS;
        if (p >= 1) {
          revealTransitions.delete(regionId);
          fields.delete(regionId); // fully revealed: free the puff specs
          hazes.delete(regionId);
          continue;
        }
        if (p < 0) {
          // Staggered reveals scheduled slightly in the future keep their bank intact.
          if (region && bboxVisible(region, vb)) {
            const puffs = fieldFor(regionId);
            drawHaze(ctx, camera, regionId, HAZE_ALPHA * fade);
            if (puffs) drawPuffField(ctx, camera, puffs, t, vb, -1);
          }
          continue;
        }
        if (region && bboxVisible(region, vb)) {
          const puffs = fieldFor(regionId);
          drawHaze(ctx, camera, regionId, HAZE_ALPHA * fade * Math.max(0, 1 - p * 1.4));
          if (puffs) drawPuffField(ctx, camera, puffs, t, vb, p);
        }
      }
    }
    ctx.restore();
  }

  /** Call once, the frame a region's `revealed()` flips from false to true. `nowMs` may be in the future to stagger. */
  function revealRegion(regionId, nowMs) {
    if (!revealTransitions.has(regionId)) revealTransitions.set(regionId, { startMs: nowMs });
  }

  /** Regions whose bank is still in the middle of parting (the scene keeps
   *  them out of its hidden list once revealed, this just tells it to keep drawing). */
  function isRevealing(regionId) {
    return revealTransitions.has(regionId);
  }

  function drawShadows(ctx, camera, t) {
    const vb = camera.visibleBounds(6);
    for (const d of shadowSpecs) {
      const wx = d.x0 + Math.sin(t * d.speed + d.phase) * d.range;
      if (wx < vb.minX || wx > vb.maxX || d.y0 < vb.minY || d.y0 > vb.maxY) continue;
      const screen = camera.worldToScreen(wx, d.y0);
      drawCloudShadow(ctx, screen.x, screen.y, d.r * camera.zoom, 0.16);
    }
  }

  // A few big banks that wander across the whole map on the wind — atmosphere for
  // the title screen (and the odd flourish elsewhere). World space, so they parallax with the map.
  const ambient = (() => {
    const rng = createRng(hash32(world.seed >>> 0, 'ambient'));
    const b = world.bounds;
    return Array.from({ length: 9 }, () => ({
      y: b.minY + rng.range(-4, (b.maxY - b.minY) + 4),
      phase: rng.range(0, 1),
      speed: rng.range(0.004, 0.011),
      r: rng.range(3.4, 6.2),
      alpha: rng.range(0.34, 0.55),
      seed: Math.floor(rng.range(0, 1e6)),
      bob: rng.range(0, Math.PI * 2),
    }));
  })();

  function drawAmbient(ctx, camera, t) {
    const b = world.bounds;
    const span = (b.maxX - b.minX) + 24;
    const vb = camera.visibleBounds(8);
    for (const a of ambient) {
      const f = (a.phase + t * a.speed) % 1;
      const wx = b.minX - 12 + f * span;
      const wy = a.y + Math.sin(t * 0.06 + a.bob) * 0.8;
      if (wx < vb.minX || wx > vb.maxX || wy < vb.minY || wy > vb.maxY) continue;
      const edge = Math.min(f, 1 - f) * 8; // fade in/out at the wrap points
      const screen = camera.worldToScreen(wx, wy);
      const rPx = a.r * camera.zoom;
      const sprite = getPuffSprite(rPx * dpr, a.seed);
      if (!sprite) continue;
      const size = sprite.size * ((rPx * dpr) / sprite.radius / dpr);
      ctx.globalAlpha = a.alpha * Math.min(1, edge);
      ctx.drawImage(sprite.canvas, screen.x - size / 2, screen.y - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
  }

  function setPixelRatio(v) { dpr = v; ps = v; }

  /** Dynasty reset / New Realm onto the same World instance: forget every transition. */
  function reset() {
    fields.clear();
    hazes.clear();
    revealTransitions.clear();
  }

  return { draw, drawShadows, drawAmbient, revealRegion, isRevealing, setPixelRatio, reset };
}
