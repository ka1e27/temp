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
import { lookVersion } from './accessibility.js';

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
    corridor = null;
  }

  // ---- border-march corridors (DESIGN 4.4) -------------------------------------------------------
  // Corridors (`link` tiles) are no-man's-land: never tinted, never recoloured on a capture. Only their OUTLINE is drawn, a subtle dashed edge,
  // so a player sees where troops may cross enemy ground without that ground looking like anyone's.
  const DIRS = [[1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1]]; // the neighbour across edge k (between corners k and k+1)
  let corridor = null; // world-space segments [x1, y1, x2, y2]
  let pass = null; // mountain pass: { polys: [[x, y]...][], track: [x1, y1, x2, y2][] } (a strip that crosses a ridge)

  /**
   * @param {object[]} tiles the world tiles of the arena's `link` tiles
   * @param {object[]} [passTiles] the subset that is a mountain pass (still mountains in the world; the arena lets troops cross them): drawn as a stone fill over the peaks
   * @param {{ points: {x:number,y:number}[], exit: {x:number,y:number}|null, toward: {x:number,y:number}|null }[]} [roads] the routes squads take across the strip
   *   (scenes/battle.js stripRoads: camp to the edge of a settlement's land, world units, lifted); drawn as a road ending in a marker that points at that settlement
   */
  function setCorridors(tiles, passTiles = [], roads = []) {
    const keys = new Set(tiles.map((t) => `${t.q},${t.r}`));
    const segs = [];
    for (const t of tiles) {
      const lift = elevOffset(t, 1);
      for (let k = 0; k < 6; k++) {
        if (keys.has(`${t.q + DIRS[k][0]},${t.r + DIRS[k][1]}`)) continue; // an inner edge between two corridor tiles
        const a = HEX[k];
        const b = HEX[(k + 1) % 6];
        segs.push([t.x + a[0] * 0.98, t.y - lift + a[1] * 0.98, t.x + b[0] * 0.98, t.y - lift + b[1] * 0.98]);
      }
    }
    corridor = segs;
    pass = null;
    if (passTiles.length) {
      const polys = passTiles.map((t) => { const lift = elevOffset(t, 1); return HEX.map((c) => [t.x + c[0] * 0.98, t.y - lift + c[1] * 0.98]); });
      // each road: the route's tile centres, then the edge of the settlement's land; the marker sits at that edge, pointing at the settlement
      const lines = [];
      const markers = [];
      for (const r of roads || []) {
        if (!r || !r.points || r.points.length < 2) continue;
        const pts = r.points.map((p) => [p.x, p.y]);
        if (r.exit) pts.push([r.exit.x, r.exit.y]);
        lines.push(pts);
        if (r.exit && r.toward) markers.push({ x: r.exit.x, y: r.exit.y, ang: Math.atan2(r.toward.y - r.exit.y, r.toward.x - r.exit.x) });
      }
      pass = { polys, lines, markers };
    }
  }

  /** A mountain pass: the peaks are still there, but a pale, untinted track runs across them, so a player can see WHY troops may cross here. */
  function drawPass(ctx, camera) {
    ctx.save();
    ctx.beginPath();
    for (const poly of pass.polys) {
      poly.forEach(([x, y], i) => { const p = camera.worldToScreen(x, y); if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
      ctx.closePath();
    }
    ctx.fillStyle = 'rgba(228, 212, 170, 0.66)'; // neutral stone-and-dust, never a faction colour
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, camera.zoom * 0.05);
    ctx.strokeStyle = 'rgba(70, 52, 28, 0.7)';
    ctx.stroke();
    const trackPath = () => {
      ctx.beginPath();
      for (const line of pass.lines) {
        line.forEach(([x, y], i) => { const p = camera.worldToScreen(x, y); if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
      }
    };
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    trackPath();
    // a road laid across the peaks: dark edge, sandy bed, cream dashes down the middle
    ctx.strokeStyle = 'rgba(52, 38, 20, 0.8)';
    ctx.lineWidth = Math.max(6, camera.zoom * 0.36);
    ctx.stroke();
    trackPath();
    ctx.strokeStyle = '#ead9ae';
    ctx.lineWidth = Math.max(4, camera.zoom * 0.26);
    ctx.stroke();
    ctx.setLineDash([Math.max(4, camera.zoom * 0.22), Math.max(4, camera.zoom * 0.17)]);
    trackPath();
    ctx.strokeStyle = 'rgba(122, 92, 52, 0.95)';
    ctx.lineWidth = Math.max(1.6, camera.zoom * 0.075);
    ctx.stroke();
    ctx.setLineDash([]);
    // where the road reaches a settlement's land: a small arrowhead pointing at that settlement (the strip may lead to more than one)
    const s = Math.max(7, camera.zoom * 0.3);
    for (const m of pass.markers) {
      const p = camera.worldToScreen(m.x, m.y);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(m.ang);
      ctx.beginPath();
      ctx.moveTo(s * 1.1, 0);
      ctx.lineTo(-s * 0.6, -s * 0.8);
      ctx.lineTo(-s * 0.25, 0);
      ctx.lineTo(-s * 0.6, s * 0.8);
      ctx.closePath();
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(2, camera.zoom * 0.06);
      ctx.strokeStyle = 'rgba(52, 38, 20, 0.9)';
      ctx.fillStyle = '#ead9ae';
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawCorridors(ctx, camera) {
    if (!arena || !corridor || corridor.length === 0) return;
    const path = () => {
      ctx.beginPath();
      for (const [x1, y1, x2, y2] of corridor) {
        const a = camera.worldToScreen(x1, y1);
        const b = camera.worldToScreen(x2, y2);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
    };
    ctx.save();
    if (pass) drawPass(ctx, camera);
    ctx.lineCap = 'butt';
    const w = Math.max(1, camera.zoom * 0.035);
    path();
    ctx.strokeStyle = 'rgba(6, 10, 18, 0.22)';
    ctx.lineWidth = w + 1.6;
    ctx.stroke();
    ctx.setLineDash([Math.max(3, camera.zoom * 0.16), Math.max(3, camera.zoom * 0.12)]);
    path();
    ctx.strokeStyle = 'rgba(238, 242, 252, 0.6)';
    ctx.lineWidth = w;
    ctx.stroke();
    ctx.restore();
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
    e.look = lookVersion(); // a colour-vision preset or the pattern overlay changed mid-battle: re-bake (PLAN-PHASE14)
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
    if (!e || e.sig !== sig || e.bucket !== arena.bucket || e.look !== lookVersion()) e = bakeTerritory(arena.bucket, ownerOf, sig);
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
    begin, end, drawTerritory: drawTerritoryLayer, drawDim, setPixelRatio, setCorridors, drawCorridors,
    get active() { return !!arena; },
  };
}
