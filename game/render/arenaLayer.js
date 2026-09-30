// Battle-arena render layers (PLAYFEEL §3): the live territory of the target region (tiles belong to
// their nearest settlement and recolour as settlements flip) and the dim that shades everything
// outside the arena. Browser only; read-only over game data.
//
//  * Territory is baked into two small transparent canvases (a tint blitted with 'overlay' blending,
//    and a flat wash + inner bands + borders blitted normally) using the same drawing code as the
//    world's terrain chunks, so a region looks identical in the world and in the fight. It is rebaked
//    only when the caller's owner signature changes (a capture / one step of the victory flood), then
//    drawn each frame with two drawImage calls.
//  * The dim is a mask baked once per battle in world space: dark everywhere except the arena's own hexes,
//    with a soft outward feather, so the lit area follows the hex outline instead of a rectangle.
import { drawTerritory } from './territory.js';
import { pickBucket } from './terrainCache.js';
import { elevOffset } from './tiles.js';

const HEX = Array.from({ length: 6 }, (_, k) => {
  const a = ((-90 + 60 * k) * Math.PI) / 180;
  return [Math.cos(a), Math.sin(a)];
});
const MASK_RES = 14; // px per world unit of the dim mask
const MASK_PAD = 14; // world units of dark kept around the arena inside the mask canvas
const DIM_COLOR = 'rgb(4,6,10)';

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * @param {import('../world/generate.js').World} world
 */
export function createArenaLayer(world) {
  let dpr = 1;
  let arena = null;

  /**
   * @param {{ regionId: number, holeTiles: object[] }} opts
   *   holeTiles: every world tile that belongs to the lit arena (its passable tiles plus the target
   *   region's rock); the target region's land tiles are what the territory layer paints.
   */
  function begin({ regionId, holeTiles }) {
    const region = world.regions[regionId];
    const regionTiles = region.tiles.map((i) => world.tiles[i]).filter((t) => t.land);
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const t of regionTiles) {
      minX = Math.min(minX, t.x); maxX = Math.max(maxX, t.x);
      minY = Math.min(minY, t.y); maxY = Math.max(maxY, t.y);
    }
    const m = 2.2;
    arena = {
      regionId,
      regionTiles,
      bbox: { minX: minX - m, minY: minY - m - 0.6, maxX: maxX + m, maxY: maxY + m },
      entry: null,
      bucket: 0,
      mask: buildMask(holeTiles),
    };
  }

  function end() {
    arena = null;
  }

  // ---- territory --------------------------------------------------------------
  function bakeTerritory(bucket, ownerOf, sig) {
    const { bbox } = arena;
    const w = Math.ceil((bbox.maxX - bbox.minX) * bucket);
    const h = Math.ceil((bbox.maxY - bbox.minY) * bucket);
    let e = arena.entry;
    if (!e || e.w !== w || e.h !== h || e.bucket !== bucket) {
      e = { bucket, w, h, tint: makeCanvas(w, h), over: makeCanvas(w, h), sig: null };
      arena.entry = e;
    }
    const tctx = e.tint.getContext('2d');
    const octx = e.over.getContext('2d');
    tctx.clearRect(0, 0, w, h);
    octx.clearRect(0, 0, w, h);
    drawTerritory({ tint: tctx, over: octx, overlay: false }, world, arena.regionTiles, ownerOf,
      bucket, -bbox.minX * bucket, -bbox.minY * bucket, dpr);
    e.sig = sig;
    return e;
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} camera
   * @param {(tile: object) => number} ownerOf faction owning any world tile right now
   * @param {string} sig changes whenever `ownerOf` would give a different answer
   */
  function drawTerritoryLayer(ctx, camera, ownerOf, sig) {
    if (!arena) return;
    arena.bucket = pickBucket(camera.zoom * dpr, arena.bucket);
    let e = arena.entry;
    if (!e || e.sig !== sig || e.bucket !== arena.bucket) e = bakeTerritory(arena.bucket, ownerOf, sig);
    const k = camera.zoom / e.bucket;
    const p = camera.worldToScreen(arena.bbox.minX, arena.bbox.minY);
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.drawImage(e.tint, p.x, p.y, e.w * k, e.h * k);
    ctx.restore();
    ctx.drawImage(e.over, p.x, p.y, e.w * k, e.h * k);
  }

  // ---- dim ---------------------------------------------------------------------
  function buildMask(holeTiles) {
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const t of holeTiles) {
      minX = Math.min(minX, t.x); maxX = Math.max(maxX, t.x);
      minY = Math.min(minY, t.y); maxY = Math.max(maxY, t.y);
    }
    const bounds = { minX: minX - MASK_PAD, minY: minY - MASK_PAD, maxX: maxX + MASK_PAD, maxY: maxY + MASK_PAD };
    const w = Math.ceil((bounds.maxX - bounds.minX) * MASK_RES);
    const h = Math.ceil((bounds.maxY - bounds.minY) * MASK_RES);
    const canvas = makeCanvas(w, h);
    const c = canvas.getContext('2d');
    c.fillStyle = DIM_COLOR;
    c.fillRect(0, 0, w, h);
    c.setTransform(MASK_RES, 0, 0, MASK_RES, -bounds.minX * MASK_RES, -bounds.minY * MASK_RES);
    const path = new Path2D();
    for (const t of holeTiles) {
      const lift = elevOffset(t, 1);
      for (let k = 0; k < 6; k++) {
        const x = t.x + HEX[k][0] * 1.03;
        const y = t.y - lift + HEX[k][1] * 1.03;
        if (k === 0) path.moveTo(x, y); else path.lineTo(x, y);
      }
      path.closePath();
    }
    c.globalCompositeOperation = 'destination-out';
    c.fillStyle = '#000';
    c.fill(path);
    // Feather outward: strokes centred on every hex edge clear a little more dark just outside
    // the outline (inside the hole they clear what is already clear, so they cost nothing).
    c.lineJoin = 'round';
    c.strokeStyle = '#000';
    for (const [width, alpha] of [[1.9, 0.12], [1.3, 0.16], [0.8, 0.22], [0.4, 0.3]]) {
      c.globalAlpha = alpha;
      c.lineWidth = width;
      c.stroke(path);
    }
    return { canvas, bounds };
  }

  /**
   * Shades everything outside the arena. `dimAlpha` 0..1 (0 = fully lit).
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} camera
   * @param {number} dimAlpha
   */
  function drawDim(ctx, camera, dimAlpha) {
    if (!arena || dimAlpha <= 0.002) return;
    const { canvas, bounds } = arena.mask;
    const W = camera.viewW;
    const H = camera.viewH;
    const tl = camera.worldToScreen(bounds.minX, bounds.minY);
    const br = camera.worldToScreen(bounds.maxX, bounds.maxY);
    ctx.save();
    ctx.globalAlpha = dimAlpha;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(canvas, tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    ctx.fillStyle = DIM_COLOR;
    const x0 = Math.max(0, tl.x);
    const x1 = Math.min(W, br.x);
    const y0 = Math.max(0, tl.y);
    const y1 = Math.min(H, br.y);
    if (tl.y > 0) ctx.fillRect(0, 0, W, Math.min(H, tl.y));
    if (br.y < H) ctx.fillRect(0, Math.max(0, br.y), W, H - Math.max(0, br.y));
    if (tl.x > 0 && y1 > y0) ctx.fillRect(0, y0, Math.min(W, tl.x), y1 - y0);
    if (br.x < W && y1 > y0) ctx.fillRect(Math.max(0, br.x), y0, W - Math.max(0, br.x), y1 - y0);
    ctx.restore();
    void x0; void x1;
  }

  function setPixelRatio(v) {
    if (v !== dpr) { dpr = v; if (arena) arena.entry = null; }
  }

  return {
    begin, end, drawTerritory: drawTerritoryLayer, drawDim, setPixelRatio,
    get active() { return !!arena; },
  };
}
