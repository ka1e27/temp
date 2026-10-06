// Terrain chunk cache (ARCHITECTURE §7, INTEGRATION-NOTES "Art"): bakes the
// static continent (sea, land tops + skirts, decor, rivers, roads, coast foam)
// PLUS the territory tint/borders into offscreen canvases and blits them each
// frame. Browser only (offscreen canvases); never mutates game state.
//
// Design notes (each one is a bug we hit or a trap the art recipe leaves open):
//  * The chunk grid is a plain rectangular partition of the WORLD PLANE (not of
//    tile indices). Every chunk bakes EVERY tile that touches its rect (plus a
//    2 px overscan), in global row-major order, so each pixel is produced by the
//    exact same draw sequence a single whole-world render would use. Adjacent
//    chunks therefore overlap by a few pixels with identical content: no seams,
//    and raised mountain tops never get clipped or overpainted by the chunk that
//    is drawn after them (the naive "one canvas per 8x8 block, each with an
//    opaque ocean margin" recipe paints ocean over its neighbours' land).
//  * The ocean base gradient is a GLOBAL vertical gradient (by world y), so it is
//    continuous across chunks and matches the plain background fill outside the
//    world (`oceanBackground`).
//  * Buckets are measured in DEVICE pixels per world unit, so a DPR-2 screen gets
//    a sharp bake instead of an upscaled one. Chunks bake at the bucket that suits
//    the camera once the zoom has settled; meanwhile the old bake is blitted
//    scaled. A soft pixel budget evicts least-recently-drawn chunks.
//  * Territory (tint via 'overlay', crisp borders) is baked INTO the chunk so the
//    overlay blend works against real terrain; the chunk carries an owner
//    signature and only chunks whose owners changed are re-baked.
import {
  drawTileBase, drawTileDecor, drawRiver, drawRoad, drawCoastFoam, drawFarmFields,
  drawWaterGlints, isWaterTile, elevOffset,
} from './tiles.js';
import { drawChunkTerritory } from './territory.js';
import { createProsperityPlan, drawProsperityGround, drawProsperityStructures } from './prosperityDecor.js';
import { createSeaField, seaBackgroundStops } from './seaField.js';
import { drawSandbar } from './seaMarks.js';

const SQ3 = Math.sqrt(3);
const CHUNK = 8; // tiles per chunk side
const PAD_PX = 2; // overscan (device px) so neighbouring chunks overlap, hiding resample seams
const FARM_ADJACENT_TYPES = new Set(['hamlet', 'village', 'town']);

// Device px per world unit. The last entries only matter at battle zoom on hi-dpi.
export const BUCKETS = Object.freeze([8, 11, 16, 22, 32, 45, 64, 90]);

// World-unit reach of one tile's drawing beyond its centre (peaks/trees above,
// skirts below, decor sideways), and of a water splat (radius <= 2.2).
const LAND_REACH = { left: 1.3, right: 1.3, up: 2.7, down: 1.3 };
const WATER_REACH = 2.4;

const SEA_PAD = 8; // world units of sea baked beyond the tile grid (must be >= seaField's lattice pad)
const BASE_BUDGET_PX = 46e6; // ~180 MB of chunk canvases before LRU eviction
const OWNER_REBAKE_BUDGET_MS = 9; // per-frame time for ownership-change rebakes (at least one chunk always runs)
const REBAKE_BUDGET_MS = 7; // per-frame time we allow for lazy rebakes once the zoom has settled
const ZOOM_SETTLE_SEC = 0.16;

/** CSS colours of the open-sea gradient (top, bottom of the world) for the plain background fill. */
export const oceanStops = seaBackgroundStops;

function makeCanvas(w, h) {
  const cw = Math.max(1, Math.ceil(w));
  const ch = Math.max(1, Math.ceil(h));
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(cw, ch);
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  return c;
}

/** Pick the bake bucket for a device-px-per-unit scale, with hysteresis around `prev`. */
export function pickBucket(devScale, prev = 0) {
  if (prev && devScale >= prev * 0.74 && devScale <= prev * 1.16) return prev;
  const want = devScale * 0.92;
  for (const b of BUCKETS) if (b >= want) return b;
  return BUCKETS[BUCKETS.length - 1];
}

/**
 * @param {import('../world/generate.js').World} world
 */
export function createTerrainCache(world) {
  const { cols, rows } = world;
  const tiles = world.tiles;

  // The chunk grid covers the tile grid PLUS SEA_PAD units of open sea on every side, so
  // the depth-shaded shallows that continue past the map edge are baked, not cut off.
  const gridMinX = -SQ3 / 2 - SEA_PAD;
  const gridMaxX = SQ3 * cols + SEA_PAD;
  const gridMinY = -1 - SEA_PAD;
  const gridMaxY = (rows - 1) * 1.5 + 1 + SEA_PAD;
  const CW = CHUNK * SQ3;
  const CH = CHUNK * 1.5;
  const chunkCols = Math.max(1, Math.ceil((gridMaxX - gridMinX) / CW - 0.1));
  const chunkRows = Math.max(1, Math.ceil((gridMaxY - gridMinY) / CH - 0.1));
  const seaExtent = { minY: -2, maxY: (rows - 1) * 1.5 + 2 };

  let dpr = 1;

  const sea = createSeaField(world, seaExtent);
  // Where prosperity decor goes: once per world, shared with the ambient layer (it reads the windmill sites).
  const plan = createProsperityPlan(world);
  // Region id -> prosperity level to SHOW (0 unless player-owned and revealed). It joins the chunk signature, so a
  // level-up re-bakes exactly the chunks that contain the region, through the existing time-boxed ownership path.
  let levels = [];
  const settlementTypeByTile = new Map();
  for (const s of world.settlements) settlementTypeByTile.set(s.tile, s.type);

  const AX_DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  // PLAN-PHASE12: a ford's sandbar runs toward every neighbour it links (another ford, or land)
  const islandOf = (t) => (t.region >= 0 && world.regions[t.region] ? world.regions[t.region].island : -1);
  function fordDirs(tile) {
    const out = [];
    for (let d = 0; d < 6; d++) {
      const [dq, dr] = AX_DIRS[d];
      const r = tile.r + dr;
      const col = (tile.q + dq) + (r - (r & 1)) / 2;
      if (col < 0 || col >= cols || r < 0 || r >= rows) continue;
      const n = tiles[r * cols + col];
      // to the shore, and across the strait (a ford of the other island's side): never along it, which drew a lattice of sand
      if (n && (n.land || (n.ford && islandOf(n) !== islandOf(tile)))) out.push(d);
    }
    return out;
  }

  function hasFarmSeedNeighbor(tile) {
    for (const [dq, dr] of AX_DIRS) {
      const r = tile.r + dr;
      const col = (tile.q + dq) + (r - (r & 1)) / 2;
      if (col < 0 || col >= cols || r < 0 || r >= rows) continue;
      const type = settlementTypeByTile.get(r * cols + col);
      if (type && FARM_ADJACENT_TYPES.has(type)) return true;
    }
    return false;
  }

  // ---- chunk descriptors (zoom independent) ---------------------------------
  const descriptors = new Map();

  function rowColRange(row, x0, x1) {
    const shift = (row & 1) / 2;
    const c0 = Math.max(0, Math.ceil(x0 / SQ3 - shift));
    const c1 = Math.min(cols - 1, Math.floor(x1 / SQ3 - shift));
    return [c0, c1];
  }

  function descriptorFor(cx, cy) {
    const key = cy * chunkCols + cx;
    let d = descriptors.get(key);
    if (d) return d;
    const x0 = gridMinX + cx * CW;
    const x1 = cx === chunkCols - 1 ? gridMaxX : x0 + CW;
    const y0 = gridMinY + cy * CH;
    const y1 = cy === chunkRows - 1 ? gridMaxY : y0 + CH;

    const land = [];
    const fords = []; // PLAN-PHASE12: archipelago straits, drawn as sandbars between the sea and the land
    const regionSet = new Set();

    // Land tiles: everything whose drawing can touch [x0..x1] x [y0..y1].
    const lr0 = Math.max(0, Math.ceil((y0 - LAND_REACH.down) / 1.5));
    const lr1 = Math.min(rows - 1, Math.floor((y1 + LAND_REACH.up) / 1.5));
    for (let row = lr0; row <= lr1; row++) {
      const [c0, c1] = rowColRange(row, x0 - LAND_REACH.left, x1 + LAND_REACH.right);
      for (let col = c0; col <= c1; col++) {
        const t = tiles[row * cols + col];
        if (isWaterTile(t)) { if (t.ford) fords.push(t); continue; }
        land.push(t);
        if (t.region >= 0) regionSet.add(t.region);
      }
    }
    // Rows are visited in order and cols ascend, so both lists are already in
    // global tile-index order (the tiles-water.js seam contract).
    d = { cx, cy, x0, x1, y0, y1, land, fords, regions: [...regionSet], hasLand: land.length > 0 || fords.length > 0 };
    descriptors.set(key, d);
    return d;
  }

  // ---- baked canvases --------------------------------------------------------
  const baked = new Map(); // key -> entry
  let totalPx = 0;
  let frameNo = 0;
  let bakeCount = 0;

  function chunkSig(desc, owners) {
    if (!owners) return 'none';
    let sig = '';
    for (const r of desc.regions) sig += `${owners[r] ?? -1}:${levels[r] | 0},`;
    return sig;
  }

  function bake(desc, bucket, owners, sig) {
    const s = bucket;
    const cw = Math.ceil((desc.x1 - desc.x0) * s) + PAD_PX * 2;
    const chh = Math.ceil((desc.y1 - desc.y0) * s) + PAD_PX * 2;
    const canvas = makeCanvas(cw, chh);
    const ctx = canvas.getContext('2d');
    // Canvas px of world (0,0); the rect's top-left lands on (PAD_PX, PAD_PX).
    const ox = PAD_PX - desc.x0 * s;
    const oy = PAD_PX - desc.y0 * s;

    sea.paint(ctx, cw, chh, s, ox, oy); // global smooth sea field, continuous across chunks
    for (const t of desc.fords) drawSandbar(ctx, ox + t.x * s, oy + t.y * s, s, t.i + 1, fordDirs(t));

    for (const t of desc.land) {
      const x = ox + t.x * s;
      const y = oy + t.y * s;
      drawTileBase(ctx, t, x, y, s);
      drawCoastFoam(ctx, t, x, y, s);
      drawRiver(ctx, t, x, y, s);
      drawRoad(ctx, t, x, y, s);
      if (t.elev === 1 && t.settlement === -1 && hasFarmSeedNeighbor(t)) {
        // The tile is the 6th argument: the plots repaint its river and road ribbons on top.
        drawFarmFields(ctx, x, y - elevOffset(t, s), s, t.i + 1, t);
      }
      drawTileDecor(ctx, t, x, y, s);
      // Prosperity level I (haystacks, orchards, hedgerows) is ground: it takes the territory tint like terrain.
      const info = plan.info(t.i);
      if (info) drawProsperityGround(ctx, t, x, y, s, levels[t.region] | 0, info);
    }

    if (owners) drawChunkTerritory(ctx, world, desc.land, owners, s, ox, oy, dpr);

    // Levels II and III (cottages, windmills, paving, market) are drawn AFTER the tint and the borders, so they
    // keep their natural colours (the tint would grey cream walls toward blue).
    for (const t of desc.land) {
      const info = plan.info(t.i);
      if (info) drawProsperityStructures(ctx, t, ox + t.x * s, oy + t.y * s, s, levels[t.region] | 0, info);
    }

    const key = desc.cy * chunkCols + desc.cx;
    const old = baked.get(key);
    if (old) totalPx -= old.px;
    const entry = {
      key, bucket, sig, canvas, w: cw, h: chh, px: cw * chh,
      // world coords of the canvas' top-left corner
      wx: desc.x0 - PAD_PX / s,
      wy: desc.y0 - PAD_PX / s,
      lastUsed: frameNo,
    };
    baked.set(key, entry);
    totalPx += entry.px;
    bakeCount++;
    return entry;
  }

  function evictIfNeeded(protectFrame) {
    const budget = BASE_BUDGET_PX;
    if (totalPx <= budget) return;
    const list = [...baked.values()].filter((e) => e.lastUsed < protectFrame).sort((a, b) => a.lastUsed - b.lastUsed);
    for (const e of list) {
      if (totalPx <= budget * 0.85) break;
      baked.delete(e.key);
      totalPx -= e.px;
    }
  }

  // ---- per-frame draw --------------------------------------------------------
  let curBucket = 0;
  let lastZoom = 0;
  let lastZoomChangeMs = 0;
  let lastOwnersKey = null;
  let lastNow = 0;

  /**
   * @param {CanvasRenderingContext2D} ctx CSS-px space (already scaled by dpr)
   * @param {object} camera
   * @param {number[]|null} [owners] region id -> faction id (or -1/undefined = no territory);
   *   omit for bare terrain.
   * @param {number[]} [showLevels] region id -> prosperity level to show; omitted = keep the last levels
   *   (the battle scene draws the same map without passing them)
   */
  // `opts.newBakeMs` (the title only, Phase 8 perf): chunks never baked before are baked for at most this many ms a frame (at least one); the rest
  // wait for the next frames and the sea shows there meanwhile. The title is under the fading boot splash then, and a slow phone shows it a second sooner.
  function draw(ctx, camera, owners, showLevels, opts) {
    const newBakeMs = opts && opts.newBakeMs > 0 ? opts.newBakeMs : Infinity;
    let newSpent = 0;
    let newBakes = 0;
    if (showLevels) levels = showLevels; // BEFORE the loop computes chunkSig
    if (owners !== undefined) drawOwners = owners;
    frameNo++;
    const now = performance.now();
    lastNow = now;
    if (Math.abs(camera.zoom - lastZoom) > 1e-6) {
      lastZoom = camera.zoom;
      lastZoomChangeMs = now;
    }
    const settled = now - lastZoomChangeMs >= ZOOM_SETTLE_SEC * 1000 && !camera.isMoving();
    const devScale = camera.zoom * dpr;
    if (!curBucket) curBucket = pickBucket(devScale, 0);
    else if (settled) curBucket = pickBucket(devScale, curBucket);

    const ownersKey = owners ? owners.join(',') : 'none';
    const ownersChanged = ownersKey !== lastOwnersKey;
    lastOwnersKey = ownersKey;

    const vb = camera.visibleBounds(0);
    const cxMin = Math.max(0, Math.floor((vb.minX - gridMinX) / CW));
    const cxMax = Math.min(chunkCols - 1, Math.floor((vb.maxX - gridMinX) / CW));
    const cyMin = Math.max(0, Math.floor((vb.minY - gridMinY) / CH));
    const cyMax = Math.min(chunkRows - 1, Math.floor((vb.maxY - gridMinY) / CH));

    let budgetLeft = REBAKE_BUDGET_MS;
    let ownerBudgetLeft = OWNER_REBAKE_BUDGET_MS;
    let ownerRebakes = 0;
    const zoom = camera.zoom;
    for (let cy = cyMin; cy <= cyMax; cy++) {
      for (let cx = cxMin; cx <= cxMax; cx++) {
        const desc = descriptorFor(cx, cy);
        const key = cy * chunkCols + cx;
        let entry = baked.get(key);
        const sig = chunkSig(desc, owners);
        if (!entry) {
          if (newBakes > 0 && newSpent >= newBakeMs) continue;
          const t0 = performance.now();
          entry = bake(desc, curBucket, owners, sig);
          newSpent += performance.now() - t0;
          newBakes += 1;
        } else if (entry.sig !== sig && (ownerRebakes === 0 || ownerBudgetLeft > 0)) {
          // Ownership changed: re-bake at the chunk's OWN bucket so the change shows within a
          // frame or two (the bucket upgrade happens later). Time-boxed, but always at least one
          // chunk per frame so a change can never stall; the rest keep their old (stale) image
          // for a few frames instead of causing a hitch, e.g. when a whole map's fog changes.
          const t0 = performance.now();
          entry = bake(desc, entry.bucket, owners, sig);
          ownerBudgetLeft -= performance.now() - t0;
          ownerRebakes++;
        } else if (entry.bucket !== curBucket && settled && budgetLeft > 0) {
          const t0 = performance.now();
          entry = bake(desc, curBucket, owners, sig);
          budgetLeft -= performance.now() - t0;
        }
        entry.lastUsed = frameNo;
        const scale = zoom / entry.bucket; // CSS px per baked px
        const p = camera.worldToScreen(entry.wx, entry.wy);
        ctx.drawImage(entry.canvas, p.x, p.y, entry.w * scale, entry.h * scale);
      }
    }
    void ownersChanged;
    evictIfNeeded(frameNo);
  }

  // Phase 8 perf: the boot no longer bakes every chunk before the title shows. `schedulePrebake` queues the land chunks (the ones on screen bake in
  // draw, as always) and `prebakeStep(ms)` bakes the rest a few at a time from the frame loop, so a later pan finds them ready.
  let pendingPrebake = [];
  let drawOwners = null;
  function schedulePrebake(devScale, owners, showLevels) {
    if (showLevels) levels = showLevels;
    curBucket = pickBucket(devScale, 0);
    drawOwners = owners;
    pendingPrebake = [];
    for (let cy = 0; cy < chunkRows; cy++) for (let cx = 0; cx < chunkCols; cx++) if (descriptorFor(cx, cy).hasLand) pendingPrebake.push([cx, cy]);
    return pendingPrebake.length;
  }
  /** Bakes queued chunks for up to `budgetMs` (at least one); returns how many are still queued. */
  function prebakeStep(budgetMs) {
    if (!pendingPrebake.length) return 0;
    const t0 = performance.now();
    while (pendingPrebake.length) {
      const [cx, cy] = pendingPrebake.shift();
      const key = cy * chunkCols + cx;
      if (baked.has(key)) continue;
      const desc = descriptorFor(cx, cy);
      bake(desc, curBucket, drawOwners, chunkSig(desc, drawOwners));
      if (performance.now() - t0 >= budgetMs) break;
    }
    return pendingPrebake.length;
  }

  /** Bake every chunk at `bucket` up front (boot: avoids first-view hitches). */
  function prebakeAll(devScale, owners, showLevels) {
    pendingPrebake = [];
    if (showLevels) levels = showLevels;
    curBucket = pickBucket(devScale, 0);
    let n = 0;
    for (let cy = 0; cy < chunkRows; cy++) {
      for (let cx = 0; cx < chunkCols; cx++) {
        const desc = descriptorFor(cx, cy);
        if (!desc.hasLand) continue; // pure-sea chunks bake lazily when first seen
        bake(desc, curBucket, owners, chunkSig(desc, owners));
        n++;
      }
    }
    return n;
  }

  // ---- per-frame water shimmer ----------------------------------------------
  const waterTiles = tiles.filter((t) => isWaterTile(t) && !t.ford); // no glints on a sandbar (PLAN-PHASE12)

  function drawGlints(ctx, camera, t) {
    if (camera.zoom < 9) return;
    const vb = camera.visibleBounds(1);
    const r0 = Math.max(0, Math.floor(vb.minY / 1.5));
    const r1 = Math.min(rows - 1, Math.ceil(vb.maxY / 1.5));
    const s = camera.zoom;
    for (const tile of waterTiles) {
      if (tile.row < r0 || tile.row > r1) continue;
      if (tile.x < vb.minX || tile.x > vb.maxX) continue;
      const p = camera.worldToScreen(tile.x, tile.y);
      drawWaterGlints(ctx, p.x, p.y, s, t, tile.i);
    }
  }

  function setPixelRatio(v) {
    if (v !== dpr) {
      dpr = v;
      curBucket = 0;
    }
  }

  function invalidateAll() {
    baked.clear();
    totalPx = 0;
  }

  return {
    draw,
    drawGlints,
    prebakeAll,
    schedulePrebake,
    prebakeStep,
    setPixelRatio,
    invalidateAll,
    bakedChunkCount: () => baked.size,
    stats: () => ({
      chunks: baked.size, megapixels: totalPx / 1e6, bucket: curBucket, bakes: bakeCount, lastNow,
    }),
    get bucket() { return curBucket; },
    seaExtent,
    plan,
  };
}
