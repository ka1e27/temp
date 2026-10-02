// Non-cached, per-frame animated overlays: hover tint, selected/frontier
// region outlines, the battle arena dim + border glow, power-targeting
// cursors and the lasso-select rectangle (DESIGN §7.3, PLAYFEEL §2-3).
// Browser only; pure drawing over plain inputs — no game-state reads.
//
// Region outlines are built ONCE per region as continuous closed loops (world
// units, on the raised tile tops) and stored in a Path2D, so a dashed outline
// flows around the whole silhouette instead of restarting on every hex edge,
// and drawing a region costs one stroke call regardless of its size.
import { elevOffset } from './tiles.js';
import { drawRangeCircle, drawSelectionRing } from './sprites.js';
import { ACCENTS, rgba } from './palette.js';
import { DIRS } from '../core/hex.js';
import { WORLD_SCENE } from '../scenes/timing.js';
import { pickBucket } from './terrainCache.js';

// Edge d of a pointy-top hex spans corners (k, k+1) with k = DIR_EDGE_K[d];
// corner k sits at angle -90 + 60k degrees (clockwise from the top vertex).
const DIR_EDGE_K = [1, 0, 5, 4, 3, 2];
const CORNER = [];
for (let k = 0; k < 6; k++) {
  const a = ((-90 + 60 * k) * Math.PI) / 180;
  CORNER.push([Math.cos(a), Math.sin(a)]);
}

/**
 * @param {import('../world/generate.js').World} world
 */
export function createOverlays(world) {
  const { cols, rows } = world;
  const cache = new Map(); // regionId -> { outline: Path2D, fill: Path2D }

  function neighborTile(tile, d) {
    const nr = tile.r + DIRS[d].r;
    const nc = (tile.q + DIRS[d].q) + (nr - (nr & 1)) / 2;
    if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) return null;
    return world.tiles[nr * cols + nc];
  }

  /** Builds (and caches) the region's silhouette loops + its hex fill, in world units. */
  function shapesOf(regionId) {
    let shapes = cache.get(regionId);
    if (shapes) return shapes;
    const region = world.regions[regionId];
    const fill = new Path2D();
    const outline = new Path2D();
    if (region) {
      const edges = []; // { ax, ay, bx, by, ka, kb }
      const startOf = new Map(); // vertex key -> edge indices leaving it
      const vkey = (x, y) => `${Math.round(x * 500)},${Math.round(y * 500)}`;
      for (const i of region.tiles) {
        const tile = world.tiles[i];
        const lift = elevOffset(tile, 1);
        // Hex fill at the raised top face.
        for (let k = 0; k < 6; k++) {
          const px = tile.x + CORNER[k][0];
          const py = tile.y - lift + CORNER[k][1];
          if (k === 0) fill.moveTo(px, py); else fill.lineTo(px, py);
        }
        fill.closePath();
        for (let d = 0; d < 6; d++) {
          const nb = neighborTile(tile, d);
          if (nb && nb.region === regionId) continue;
          const k = DIR_EDGE_K[d];
          const a = CORNER[k];
          const b = CORNER[(k + 1) % 6];
          const e = {
            ax: tile.x + a[0], ay: tile.y - lift + a[1],
            bx: tile.x + b[0], by: tile.y - lift + b[1],
            ka: vkey(tile.x + a[0], tile.y + a[1]), kb: vkey(tile.x + b[0], tile.y + b[1]),
            used: false,
          };
          edges.push(e);
          if (!startOf.has(e.ka)) startOf.set(e.ka, []);
          startOf.get(e.ka).push(e);
        }
      }
      // Chain edges (all wound clockwise around their own tile, so the region
      // boundary forms consistently oriented loops) into closed polylines.
      for (const first of edges) {
        if (first.used) continue;
        let cur = first;
        outline.moveTo(cur.ax, cur.ay);
        for (let guard = 0; guard < edges.length + 2; guard++) {
          cur.used = true;
          outline.lineTo(cur.bx, cur.by);
          const nexts = startOf.get(cur.kb);
          const nxt = nexts ? nexts.find((e) => !e.used) : null;
          if (!nxt) break;
          if (Math.abs(nxt.ax - cur.bx) > 1e-6 || Math.abs(nxt.ay - cur.by) > 1e-6) outline.lineTo(nxt.ax, nxt.ay);
          cur = nxt;
        }
        outline.closePath();
      }
    }
    shapes = { outline, fill };
    cache.set(regionId, shapes);
    return shapes;
  }

  /** Runs `fn` with the context transformed so world units are drawn directly. */
  function inWorld(ctx, camera, fn) {
    const p = camera.worldToScreen(0, 0);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(camera.zoom, camera.zoom);
    fn(1 / camera.zoom);
    ctx.restore();
  }

  function drawOutline(ctx, camera, regionId, color, width, dash, alpha = 1, dashOffset = 0) {
    const { outline } = shapesOf(regionId);
    inWorld(ctx, camera, (px) => {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = width * px;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.setLineDash(dash && dash.length ? dash.map((v) => v * px) : []);
      ctx.lineDashOffset = dashOffset * px;
      ctx.stroke(outline);
    });
  }

  /** Soft light bleeding INWARD from the region's border (clipped to its tiles). */
  function drawInnerGlow(ctx, camera, regionId, color, widths, alphas) {
    const { outline, fill } = shapesOf(regionId);
    inWorld(ctx, camera, (px) => {
      ctx.clip(fill);
      ctx.strokeStyle = color;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (let i = 0; i < widths.length; i++) {
        ctx.globalAlpha = alphas[i];
        ctx.lineWidth = widths[i] * px;
        ctx.stroke(outline);
      }
    });
  }

  function fillRegion(ctx, camera, regionId, color, alpha) {
    const { fill } = shapesOf(regionId);
    inWorld(ctx, camera, () => {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.fill(fill);
    });
  }

  /** Desktop hover: +8% light tint over every tile of the hovered region + a thin rim. */
  function drawHover(ctx, camera, regionId) {
    fillRegion(ctx, camera, regionId, '#ffffff', WORLD_SCENE.hoverBrighten);
    drawOutline(ctx, camera, regionId, 'rgba(20,14,4,0.45)', 4, null, 1);
    drawOutline(ctx, camera, regionId, 'rgba(255,250,235,0.9)', 2, null, 1);
  }

  /** Selected region: bright gold animated outline with a soft halo. */
  function drawSelected(ctx, camera, regionId, t) {
    const breathe = 0.5 + 0.5 * Math.sin(t * 4);
    fillRegion(ctx, camera, regionId, ACCENTS.gold, 0.06 + breathe * 0.03);
    const bandPx = 0.36 * camera.zoom; // ~0.36 hex deep, in CSS px
    drawInnerGlow(ctx, camera, regionId, ACCENTS.gold, [bandPx * 2.6, bandPx * 1.5, bandPx * 0.7], [0.12, 0.18, 0.26 + breathe * 0.08]);
    drawOutline(ctx, camera, regionId, 'rgba(22,14,2,0.7)', 7.5, null, 1);
    drawOutline(ctx, camera, regionId, '#ffe9a6', 3.6 + breathe * 0.8, null, 1);
  }

  /**
   * The region a tutorial hint points at: a bright, thick, pulsing outline (a dark casing under a warm white core) and a faint wash. The frontier band is meant
   * to invite; this one is meant to be found in a second, at any zoom, on any terrain. `t` 0 keeps it still (Reduce Motion).
   */
  function drawHintRegion(ctx, camera, regionId, t) {
    const breathe = 0.5 + 0.5 * Math.sin(t * 5);
    fillRegion(ctx, camera, regionId, '#fff6d0', 0.07 + breathe * 0.06);
    const bandPx = 0.4 * camera.zoom;
    drawInnerGlow(ctx, camera, regionId, '#ffe08a', [bandPx * 2.8, bandPx * 1.6, bandPx * 0.8], [0.14, 0.22, 0.32 + breathe * 0.12]);
    drawOutline(ctx, camera, regionId, 'rgba(18,10,0,0.85)', 10.5, null, 1);
    drawOutline(ctx, camera, regionId, '#fff3c0', 5.2 + breathe * 1.6, null, 1);
  }

  /** The keyboard cursor: a white dashed ring over a dark casing (it must read on every terrain and tint, and differ from the gold selection and the tutorial glow). */
  function drawCursor(ctx, camera, regionId, t) {
    drawOutline(ctx, camera, regionId, 'rgba(6,8,16,0.92)', 9, null, 1);
    drawOutline(ctx, camera, regionId, '#ffffff', 4.4, [11, 7], 1, -t * 26);
  }

  // --- frontier invitation: baked once per region + zoom bucket ------------------------
  // Clipped wide strokes over a many-segment Path2D are by far the most expensive thing
  // in the world frame on a hi-dpi GPU (~10 ms with a handful of frontier regions), yet
  // the look is static apart from its pulse, so each region's glow + casing + dashed core
  // is rendered ONCE into a small bitmap and the pulse is just its drawImage alpha.
  const FRONTIER_GLOW = '#fff0bd';
  const FRONTIER_CORE = '#fff6d9';
  const FRONTIER_BAND_DEPTH = 0.36; // hexes (world units), inward from the border
  let dpr = 1;
  let frontierBucket = 0;
  const frontierCache = new Map(); // regionId -> { bucket, canvas, wx, wy, w, h }

  function makeCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  function bakeFrontier(regionId, bucket) {
    const region = world.regions[regionId];
    const { outline, fill } = shapesOf(regionId);
    const marginPx = 12 * dpr;
    const m = 1.2 + marginPx / bucket; // hex extents beyond tile centres + glow reach, world units
    const minX = region.bbox.minX - m;
    const minY = region.bbox.minY - m - 0.5;
    const maxX = region.bbox.maxX + m;
    const maxY = region.bbox.maxY + m;
    const w = Math.max(2, Math.ceil((maxX - minX) * bucket));
    const h = Math.max(2, Math.ceil((maxY - minY) * bucket));
    const canvas = makeCanvas(w, h);
    const c = canvas.getContext('2d');
    c.setTransform(bucket, 0, 0, bucket, -minX * bucket, -minY * bucket);
    const px = dpr / bucket; // one CSS px, in world units
    c.lineJoin = 'round';
    c.lineCap = 'round';

    // A BAND, not a fill: a soft glow bleeding ~0.35 hex inward from the border (clipped to the
    // region's own tiles, fading to nothing) so the interior terrain stays untinted. Cream-gold
    // rather than the Amber Horde's orange, so the invitation never reads as a faction colour.
    c.save();
    c.clip(fill);
    c.strokeStyle = FRONTIER_GLOW;
    for (const [depthMul, alpha] of [[2, 0.1], [1.45, 0.13], [0.95, 0.17], [0.5, 0.2]]) {
      c.globalAlpha = alpha;
      c.lineWidth = 2 * FRONTIER_BAND_DEPTH * depthMul; // half of a centred stroke falls inside
      c.stroke(outline);
    }
    c.restore();
    c.globalAlpha = 0.85;
    c.strokeStyle = 'rgba(22,14,2,0.75)';
    c.lineWidth = 5.4 * px;
    c.stroke(outline);
    c.globalAlpha = 1;
    c.strokeStyle = FRONTIER_CORE;
    c.lineWidth = 3 * px;
    c.setLineDash([9 * px, 6 * px]);
    c.stroke(outline);
    frontierCache.set(regionId, { bucket, canvas, wx: minX, wy: minY, w, h });
    return frontierCache.get(regionId);
  }

  function setPixelRatio(v) {
    if (v !== dpr) { dpr = v; frontierCache.clear(); frontierBucket = 0; }
  }

  /**
   * Every frontier region invites a click (PLAYFEEL §2): a soft glow band bleeds inward from
   * its border and a bright dashed line runs around it, all pulsing 0.35 <-> 0.85 (WORLD_SCENE) on a 2.2 s period. Gold alone vanishes
   * on sand/desert tiles, so the line has a dark casing and a cream-gold core that read
   * on any terrain.
   */
  function drawFrontierPulse(ctx, camera, regionIds, t, boosts) {
    const { frontierPulsePeriodSec: period, frontierPulseAlphaMin: aMin, frontierPulseAlphaMax: aMax } = WORLD_SCENE;
    const phase = ((t % period) / period) * Math.PI * 2;
    const alpha = aMin + (aMax - aMin) * (0.5 - 0.5 * Math.cos(phase));
    const devScale = camera.zoom * dpr;
    const bucket = pickBucket(devScale, frontierBucket);
    if (bucket !== frontierBucket) { frontierBucket = bucket; }
    const vb = camera.visibleBounds(2);
    let bakesLeft = 2;
    ctx.save();
    for (const id of regionIds) {
      // `boosts` (region id -> 0..1) makes freshly attackable regions pulse extra bright for a moment.
      const boost = boosts ? (boosts.get(id) ?? 0) : 0;
      ctx.globalAlpha = Math.min(1, alpha + Math.max(0, boost) * 0.55);
      const region = world.regions[id];
      if (region.bbox.maxX < vb.minX || region.bbox.minX > vb.maxX || region.bbox.maxY < vb.minY || region.bbox.minY > vb.maxY) continue;
      let e = frontierCache.get(id);
      if ((!e || e.bucket !== bucket) && (bakesLeft > 0 || !e)) { e = bakeFrontier(id, bucket); bakesLeft--; }
      if (!e) continue;
      const k = camera.zoom / e.bucket;
      const p = camera.worldToScreen(e.wx, e.wy);
      ctx.drawImage(e.canvas, p.x, p.y, e.w * k, e.h * k);
    }
    ctx.restore();
    if (frontierCache.size > 20) {
      const keep = new Set(regionIds);
      for (const key of frontierCache.keys()) if (!keep.has(key)) frontierCache.delete(key);
    }
  }

  /** A restrained gold rim along the target region's border: the arena reads as lit from within. */
  function drawArenaGlow(ctx, camera, regionId, t) {
    const breathe = 0.5 + 0.5 * Math.sin(t * 2.4);
    drawOutline(ctx, camera, regionId, rgba(ACCENTS.gold, 0.13 + 0.05 * breathe), 7, null, 1);
    drawOutline(ctx, camera, regionId, 'rgba(20,14,4,0.4)', 3.2, null, 1);
    drawOutline(ctx, camera, regionId, rgba(ACCENTS.goldSoft, 0.75), 1.6, null, 1);
  }

  /** A pulsing ring at a world point — valid-target highlight while a
   *  targeted power (rally/bulwark) is armed, or a generic "eligible site". */
  function drawTargetRing(ctx, camera, x, y, color, t) {
    const p = camera.worldToScreen(x, y);
    drawSelectionRing(ctx, p.x, p.y, 22, color, t);
  }

  /** Firestorm's blast radius under the pointer/target hex. `radiusWorld` is
   *  already in world units (caller: `hexRadiusToWorld(POWERS.firestorm.radius)`). */
  function drawBlastRadius(ctx, camera, worldX, worldY, radiusWorld, color) {
    const p = camera.worldToScreen(worldX, worldY);
    drawRangeCircle(ctx, p.x, p.y, radiusWorld * camera.zoom, color, 0.22);
  }

  /** Shift-drag lasso select rectangle, in SCREEN space. */
  function drawLasso(ctx, x0, y0, x1, y1) {
    const x = Math.min(x0, x1);
    const y = Math.min(y0, y1);
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y1 - y0);
    ctx.save();
    ctx.fillStyle = rgba(ACCENTS.gold, 0.12);
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = rgba(ACCENTS.gold, 0.85);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  return {
    drawOutline,
    drawHover,
    drawSelected,
    drawFrontierPulse,
    drawHintRegion,
    drawCursor,
    setPixelRatio,
    drawArenaGlow,
    drawTargetRing,
    drawBlastRadius,
    drawLasso,
  };
}
