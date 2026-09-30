// Small shared helpers for the title and world scenes: the y-sorted settlement
// pass, elevation-aware tile picking, label anchors and camera framing. Browser
// glue only (reads world/state, never mutates them).
import { pixelToAxial, axialToOffset } from '../core/hex.js';
import { elevOffset } from '../render/tiles.js';
import { frontier } from '../meta/progression.js';
import { PLAYER_FACTION } from '../meta/state.js';

/**
 * Settlements sorted back-to-front (by tile y) once, then drawn each frame with
 * culling. `filter(regionId)` lets the caller skip settlements the player must not
 * see (fogged regions).
 * @param {import('../world/generate.js').World} world
 */
export function createSiteDrawer(world) {
  const order = world.settlements
    .map((s) => ({ s, tile: world.tiles[s.tile] }))
    .sort((a, b) => a.tile.y - b.tile.y || a.tile.x - b.tile.x);

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} renderer
   * @param {object} camera
   * @param {number[]} owners region id -> faction
   * @param {number} t seconds
   * @param {(regionId: number) => boolean} [filter]
   * @param {{ hideHamlets?: boolean }} [opts]
   */
  function draw(ctx, renderer, camera, owners, t, filter, opts = {}) {
    const vb = camera.visibleBounds(3);
    const zoom = camera.zoom;
    for (const { s, tile } of order) {
      if (tile.y < vb.minY || tile.y > vb.maxY + 2 || tile.x < vb.minX || tile.x > vb.maxX) continue;
      if (filter && !filter(tile.region)) continue;
      if (opts.hideHamlets && s.type === 'hamlet') continue;
      const p = camera.worldToScreen(tile.x, tile.y);
      const topY = p.y - elevOffset(tile, zoom);
      renderer.sites.drawSite(ctx, p.x, topY, zoom, s.type, owners[tile.region] ?? 1, 0, t, { hideBadge: true, phase: tile.i * 0.83 });
    }
  }
  return { draw };
}

/**
 * Region under a world point, honouring the raised tile tops: a mountain's
 * visible face sits ~0.5 units above its cell, so a click on it must resolve to
 * the mountain, not to the tile drawn behind it. Returns the frontmost land tile
 * (largest row wins, matching draw order) or null.
 * @param {import('../world/generate.js').World} world
 */
export function pickLandTile(world, wx, wy) {
  const lifts = [0, 0.22, 0.34, 0.5]; // ELEV_SKIRT_FRAC in tiles.js, world units
  let best = null;
  for (const lift of lifts) {
    const { q, r } = pixelToAxial(wx, wy + lift, 1);
    const { col, row } = axialToOffset(q, r);
    if (col < 0 || col >= world.cols || row < 0 || row >= world.rows) continue;
    const tile = world.tiles[row * world.cols + col];
    if (!tile.land) continue;
    if (lift > 0 && Math.abs(elevOffset(tile, 1) - lift) > 1e-6) continue; // must really be that tall
    if (!best || tile.row > best.row) best = tile;
  }
  return best;
}

/**
 * One label anchor per region: the region tile nearest the centroid that is not
 * crowded by a settlement, so the name never sits on top of a keep.
 * @param {import('../world/generate.js').World} world
 */
export function regionLabelAnchors(world) {
  return world.regions.map((region) => {
    const sites = region.settlements.map((id) => world.tiles[world.settlements[id].tile]);
    let best = null;
    let bestScore = Infinity;
    for (const i of region.tiles) {
      const t = world.tiles[i];
      if (!t.land) continue;
      let score = Math.hypot(t.x - region.centroid.x, t.y - region.centroid.y);
      let nearest = Infinity;
      for (const st of sites) nearest = Math.min(nearest, Math.hypot(t.x - st.x, t.y - st.y));
      if (nearest < 2.2) score += (2.2 - nearest) * 2.2;
      if (t.terrain === 'mountain') score += 0.8;
      if (score < bestScore) { bestScore = score; best = t; }
    }
    const t = best || world.tiles[world.settlements[region.keep].tile];
    return { x: t.x, y: t.y - elevOffset(t, 1) };
  });
}

/** Union of world-unit bounds. */
export function unionBounds(list) {
  let b = null;
  for (const r of list) {
    if (!b) b = { minX: r.minX, minY: r.minY, maxX: r.maxX, maxY: r.maxY };
    else {
      b.minX = Math.min(b.minX, r.minX); b.minY = Math.min(b.minY, r.minY);
      b.maxX = Math.max(b.maxX, r.maxX); b.maxY = Math.max(b.maxY, r.maxY);
    }
  }
  return b;
}

/** The bounds worth showing after a conquest / on entering the world: owned regions plus the frontier. */
export function realmBounds(state, world) {
  const boxes = [];
  for (const r of world.regions) if (state.owner[r.id] === PLAYER_FACTION) boxes.push(r.bbox);
  for (const id of frontier(state, world)) boxes.push(world.regions[id].bbox);
  return unionBounds(boxes) || world.bounds;
}

/**
 * Camera target that frames `bounds` inside `rect` (the part of the screen the UI leaves free:
 * below the HUD, left of the region card on desktop), centred in that rect, with a zoom cap.
 * @param {object} camera
 * @param {{minX:number,minY:number,maxX:number,maxY:number}} bounds world units
 * @param {{x0:number,y0:number,x1:number,y1:number}} rect screen px
 * @param {{padding?: number, maxZoom?: number}} [opts]
 * @returns {{x:number, y:number, zoom:number}}
 */
export function frameInRect(camera, bounds, rect, { padding = 24, maxZoom = 26 } = {}) {
  const bw = Math.max(1e-6, bounds.maxX - bounds.minX);
  const bh = Math.max(1e-6, bounds.maxY - bounds.minY);
  const availW = Math.max(40, rect.x1 - rect.x0 - 2 * padding);
  const availH = Math.max(40, rect.y1 - rect.y0 - 2 * padding);
  const lo = camera._minZoom ?? 0.05;
  const hi = Math.min(maxZoom, camera._maxZoom ?? 200);
  const zoom = Math.max(lo, Math.min(hi, availW / bw, availH / bh));
  const rectCx = (rect.x0 + rect.x1) / 2;
  const rectCy = (rect.y0 + rect.y1) / 2;
  return {
    x: (bounds.minX + bounds.maxX) / 2 - (rectCx - camera.viewW / 2) / zoom,
    y: (bounds.minY + bounds.maxY) / 2 - (rectCy - camera.viewH / 2) / zoom,
    zoom,
  };
}

/** Screen rect the UI leaves free for the map: below the HUD; beside the region card (desktop). */
export function freeRect(viewW, viewH, { reserveCard = true } = {}) {
  const hudBottom = viewW <= 640 ? 72 : 92;
  if (viewW <= 640) return { x0: 10, y0: hudBottom, x1: viewW - 10, y1: viewH - 16 };
  const cardW = viewH < 520 ? 300 : 360;
  const x1 = reserveCard ? Math.max(viewW * 0.45, viewW - cardW - 36) : viewW - 24;
  return { x0: 24, y0: hudBottom, x1, y1: viewH - 20 };
}

/**
 * The view to show on entering the world and after a conquest: every region the player owns plus the
 * NEAREST frontier regions, added while the framing stays readable (>= `minReadable` px per hex);
 * always at least the nearest frontier region, so there is something to attack in view. Distant
 * frontier regions of a big realm are simply left for the player to pan to.
 * @returns {{minX:number,minY:number,maxX:number,maxY:number}}
 */
export const HEX_MARGIN = 1.4; // world units: one hex plus the height of what stands on it

export function realmFraming(state, world, camera, rect, { minReadable = 18, padding = 24, maxZoom = 26 } = {}) {
  const owned = world.regions.filter((r) => state.owner[r.id] === PLAYER_FACTION);
  let b = unionBounds(owned.map((r) => r.bbox)) || world.regions[world.startRegion].bbox;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const ids = frontier(state, world).sort((p, q) => {
    const rp = world.regions[p].centroid;
    const rq = world.regions[q].centroid;
    return Math.hypot(rp.x - cx, rp.y - cy) - Math.hypot(rq.x - cx, rq.y - cy);
  });
  const zoomFor = (bounds) => frameInRect(camera, bounds, rect, { padding, maxZoom: 1e9 }).zoom;
  ids.forEach((id, i) => {
    const cand = unionBounds([b, world.regions[id].bbox]);
    if (i === 0 || zoomFor(cand) >= minReadable) b = cand;
  });
  void maxZoom;
  // A region's bbox is its tile CENTRES: the outer hexes (a full hex wide, plus mountains and trees rising above
  // their tops) hang beyond it. Without this margin the frontier region's far edge sat on the screen edge on a phone.
  return { minX: b.minX - HEX_MARGIN, minY: b.minY - HEX_MARGIN, maxX: b.maxX + HEX_MARGIN, maxY: b.maxY + HEX_MARGIN };
}

/**
 * Every scene sets its own zoom limits on enter; `fitZoom` clamps to whatever
 * limits are active, so a scene must first open the limits wide before asking
 * "what zoom fits these bounds?" or it inherits the previous scene's clamp.
 */
export function openCameraLimits(camera) {
  camera.setBounds(null);
  camera.setZoomLimits(0.05, 200);
}
