// Launch art, drawn by the GAME'S OWN renderer functions (browser module, loaded into the real game page by
// tools/launch-assets.mjs over CDP). Nothing here is a separate illustration: the island is `drawTileBase`, the
// keep is `drawSettlement`, the banner is `drawBanner`, the sea is the renderer's ocean gradient, the territory
// border is the player's faction colour. This file only composes them into a bold, simple mark.
//
//   renderIcon(size, { kind })  -> OffscreenCanvas   kind: 'any' (rounded, transparent corners) | 'maskable' (full
//                                   bleed, everything inside the 80% safe circle) | 'apple' (full bleed, opaque) |
//                                   'mini' (favicon sizes, 32 px and below: no keep, a big banner on an azure hex)
//   renderSheet()               -> dataURL of a contact sheet (the sizes side by side, with the safe-zone guide)
//   toPngBase64(canvas)         -> base64 PNG
import { drawTileBase, hexPath, hexCorners, elevOffset } from '../../game/render/tiles.js';
import { drawSettlement, drawBanner, BANNER_ANCHOR } from '../../game/render/sprites.js';
import { seaRGB, SEA_DEEP_E } from '../../game/render/seaField.js';
import { factionColor, factionColorLight, ACCENTS, shade, rgba } from '../../game/render/palette.js';

const PLAYER = 0;

// Layout per kind. `r` (hex radius), `cx`, `cy` are in units of the icon size (`cy` is the tile's BASE centre; the raised top
// sits `elevOffset` above it). `keep` and `banner` scale the keep and the banner relative to `r`; `kx` and `ky` place the
// keep's ground point relative to the hex top's centre, in units of `r` (defaults: just left of centre, a fifth down).
// 'any' and 'apple' have no safe zone to respect, so the hex fills ~85% of the canvas height; 'maskable' keeps everything
// inside the 80% safe circle (radius 0.4 of the icon), hence its small hex.
const KINDS = {
  any: { r: 0.385, cx: 0.5, cy: 0.555, corner: 0.22, keep: 0.5, banner: 0.5, kx: -0.2, ky: 0.5, shadow: 0.8 },
  maskable: { r: 0.205, cx: 0.5, cy: 0.6, corner: 0, keep: 0.66, banner: 0.7 },
  apple: { r: 0.385, cx: 0.5, cy: 0.555, corner: 0, keep: 0.5, banner: 0.5, kx: -0.2, ky: 0.5, shadow: 0.8 },
};

const makeCanvas = (w, h) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));

/** The tile the island is made of: plain lowland grass, raised one level, like any tile of the real map. */
const ISLAND = Object.freeze({ terrain: 'grass', elev: 1, land: true, jitter: 0.5, height: 0.6, river: 0, road: 0, coast: 0 });

// Depth by distance from land, like the real sea field (game/render/seaField.js): bright surf against the shore, turquoise
// shallows, deep blue offshore. The colours come from the game's own `seaRGB`.
const DEPTH_BY_DIST = [1, 0.95, 0.78, 0.6, 0.44, 0.32, SEA_DEEP_E];
function seaBackground(ctx, size, cx, cy, R) {
  const img = ctx.createImageData(size, size);
  const rgb = [0, 0, 0];
  const hexW = Math.sqrt(3) * R; // one hex across: the lattice unit of the real field
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // pointy-top hex distance from the centre, measured outward from the island's edge
      const dx = Math.abs(x - cx);
      const dy = Math.abs(y - cy);
      const hexD = Math.max(dy, dx * 0.866 + dy * 0.5); // "radius" of the pointy-top hex through this pixel
      const out = Math.max(0, hexD - R) / hexW;
      const k = Math.min(DEPTH_BY_DIST.length - 1.001, out * 1.6);
      const i = Math.floor(k);
      const e = DEPTH_BY_DIST[i] + (DEPTH_BY_DIST[i + 1] - DEPTH_BY_DIST[i]) * (k - i);
      seaRGB(e, y / size, rgb);
      const o = (y * size + x) * 4;
      img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // a touch of light from the top-left, like the map
  const light = ctx.createLinearGradient(0, 0, size, size);
  light.addColorStop(0, 'rgba(255,255,255,0.10)');
  light.addColorStop(0.5, 'rgba(255,255,255,0)');
  light.addColorStop(1, 'rgba(0,20,50,0.12)');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, size, size);
}

function foamRing(ctx, cx, cy, r, size) {
  ctx.save();
  ctx.lineJoin = 'round';
  for (const [grow, alpha, w] of [[1.28, 0.16, 0.05], [1.14, 0.3, 0.032], [1.04, 0.85, 0.018]]) {
    hexPath(ctx, cx, cy, r * grow);
    ctx.strokeStyle = `rgba(242, 251, 250, ${alpha})`;
    ctx.lineWidth = size * w;
    ctx.stroke();
  }
  ctx.restore();
}

const STONE = '#b7b2a6';

/**
 * The simplified mark for favicon sizes (32 px and below): the territory hex in the player's azure on the sea, a BIG
 * white-star banner centred on it, and the keep cut down to a plain stone silhouette (walls, three merlons, a dark gate)
 * that only has to read as "a castle". Readability beats detail here; the banner is still the game's own `drawBanner`.
 */
function renderMini(size, flutter) {
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const cx = size * 0.5;
  const R = size * 0.41;
  const topCy = size * 0.47;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, size * 0.2);
  ctx.clip();
  seaBackground(ctx, size, cx, topCy, R);
  const azure = factionColor(PLAYER);
  ctx.lineJoin = 'round';
  // the raised hex: a darker skirt, the azure top, a dark casing and a light rim (the territory border of the real map)
  // (a deep azure: the banner cloth is the player's bright azure, so it has to read AGAINST the hex, not melt into it)
  hexPath(ctx, cx, topCy + R * 0.14, R);
  ctx.fillStyle = shade(azure, -0.72);
  ctx.fill();
  const face = ctx.createLinearGradient(0, topCy - R, 0, topCy + R);
  face.addColorStop(0, shade(azure, -0.34));
  face.addColorStop(1, shade(azure, -0.58));
  hexPath(ctx, cx, topCy, R);
  ctx.fillStyle = face;
  ctx.fill();
  ctx.strokeStyle = 'rgba(8, 20, 40, 0.8)';
  ctx.lineWidth = size * 0.05;
  ctx.stroke();
  hexPath(ctx, cx, topCy, R * 0.93);
  ctx.strokeStyle = factionColorLight(PLAYER);
  ctx.lineWidth = size * 0.03;
  ctx.stroke();

  // the banner first: large, flown from a pole whose foot is hidden behind the keep, flag across the middle of the hex
  const B = size * 0.36;
  const w = size * 0.4;
  const h = size * 0.15;
  const x0 = cx - w / 2;
  const base = size * 0.8;
  const top = base - h;
  const mw = w / 5;
  const mh = size * 0.05;
  const poleX = cx - size * 0.17;
  const poleY = base - h * 0.5;
  // a cream halo round the whole banner (the same drawBanner, stamped offset in four directions with a cream shadow), so
  // the azure cloth separates from the azure hex at 16-32 px
  const halo = Math.max(1, size * 0.04);
  ctx.save();
  ctx.shadowColor = '#f3ead7';
  ctx.shadowBlur = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    ctx.shadowOffsetX = dx * halo;
    ctx.shadowOffsetY = dy * halo;
    drawBanner(ctx, poleX, poleY, B, PLAYER, flutter, { phase: 0.6 });
  }
  ctx.restore();
  drawBanner(ctx, poleX, poleY, B, PLAYER, flutter, { phase: 0.6 });

  // keep silhouette: one plain block with merlons and a gate
  ctx.fillStyle = STONE;
  ctx.strokeStyle = 'rgba(14, 20, 32, 0.85)';
  ctx.lineWidth = Math.max(1, size * 0.026);
  ctx.beginPath();
  ctx.rect(x0, top, w, h);
  for (let i = 0; i < 3; i++) ctx.rect(x0 + i * mw * 2, top - mh, mw, mh + 0.5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(28, 22, 18, 0.92)';
  ctx.beginPath();
  ctx.roundRect(cx - size * 0.03, base - size * 0.07, size * 0.06, size * 0.07, [size * 0.03, size * 0.03, 0, 0]);
  ctx.fill();
  ctx.restore();
  return canvas;
}

/**
 * @param {number} size
 * @param {{ kind?: 'any'|'maskable'|'apple'|'mini', flutter?: number }} [opts]
 */
export function renderIcon(size, { kind = 'any', flutter = 1.05 } = {}) {
  if (kind === 'mini') return renderMini(size, flutter);
  const L = KINDS[kind] || KINDS.any;
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const cx = size * L.cx;
  const cy = size * L.cy;
  const R = size * L.r;

  ctx.save();
  if (L.corner > 0) {
    const rr = size * L.corner;
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, rr);
    ctx.clip();
  }
  seaBackground(ctx, size, cx, cy - elevOffset(ISLAND, R) * 0.5, R);

  // soft shadow of the island on the water
  ctx.fillStyle = 'rgba(5, 25, 50, 0.32)';
  ctx.beginPath();
  ctx.ellipse(cx + R * 0.05, cy + R * 0.26, R * (L.shadow ?? 1.08), R * 0.56 * (L.shadow ?? 1.08) / 1.08, 0, 0, Math.PI * 2);
  ctx.fill();
  foamRing(ctx, cx, cy - elevOffset(ISLAND, R) * 0.4, R, size);

  // the region: a real map tile, in the player's colours
  drawTileBase(ctx, ISLAND, cx, cy, R);
  const topCy = cy - elevOffset(ISLAND, R);
  // the territory tint and the border a region wears on the real map
  hexPath(ctx, cx, topCy, R);
  ctx.fillStyle = rgba(factionColor(PLAYER), 0.2);
  ctx.fill();
  ctx.lineJoin = 'round';
  hexPath(ctx, cx, topCy, R * 0.985);
  ctx.strokeStyle = 'rgba(8, 20, 40, 0.75)';
  ctx.lineWidth = size * 0.03;
  ctx.stroke();
  hexPath(ctx, cx, topCy, R * 0.985);
  ctx.strokeStyle = factionColorLight(PLAYER);
  ctx.lineWidth = size * 0.018;
  ctx.stroke();

  // the keep and the banner of the player's dominion
  const ks = R * L.keep;
  const keepX = cx + R * (L.kx ?? -0.06);
  const keepY = topCy + R * (L.ky ?? 0.22);
  drawSettlement(ctx, 'keep', keepX, keepY, ks, PLAYER);
  const a = BANNER_ANCHOR.keep;
  drawBanner(ctx, keepX + a.dx * ks, keepY + a.dy * ks, R * L.banner, PLAYER, flutter, { phase: 0.6 });
  ctx.restore();

  return canvas;
}

export async function toPngBase64(canvas) {
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Contact sheet: the real sizes at 1:1 plus the 48 px one enlarged, and the maskable icon with its safe zone. */
export async function renderSheet() {
  const W = 1400;
  const H = 620;
  const sheet = makeCanvas(W, H);
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#10161f';
  ctx.fillRect(0, 0, W, H);
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.fillStyle = ACCENTS.muted;
  const put = (canvas, x, y, label, w = canvas.width) => {
    ctx.imageSmoothingEnabled = w === canvas.width;
    ctx.drawImage(canvas, x, y, w, w);
    ctx.fillStyle = ACCENTS.muted;
    ctx.fillText(label, x, y + w + 18);
  };
  put(renderIcon(512, { kind: 'any' }), 20, 20, 'icon-512.png (purpose: any)');
  const mask = renderIcon(512, { kind: 'maskable' });
  put(mask, 552, 20, 'icon-maskable-512.png + the 80% safe circle', 300);
  // safe zone: a circle of radius 40% of the icon, which every launcher mask must keep visible
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 90, 90, 0.95)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.arc(552 + 150, 20 + 150, 0.4 * 300, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  // a few real launcher masks on the maskable art: circle and squircle-ish rounded square
  for (const [i, shape] of ['circle', 'squircle'].entries()) {
    const d = 96;
    const x = 880 + i * 120;
    ctx.save();
    ctx.beginPath();
    if (shape === 'circle') ctx.arc(x + d / 2, 20 + d / 2, d / 2, 0, Math.PI * 2);
    else ctx.roundRect(x, 20, d, d, d * 0.3);
    ctx.clip();
    ctx.drawImage(mask, x, 20, d, d);
    ctx.restore();
    ctx.fillStyle = ACCENTS.muted;
    ctx.fillText(`masked: ${shape}`, x, 20 + d + 16);
  }
  put(renderIcon(192, { kind: 'any' }), 552, 340, 'icon-192.png', 192);
  put(renderIcon(180, { kind: 'apple' }), 764, 340, 'apple-touch-icon 180', 180);
  put(renderIcon(96, { kind: 'any' }), 964, 340, '96', 96);
  put(renderIcon(48, { kind: 'any' }), 1074, 340, '48', 48);
  put(renderIcon(32, { kind: 'mini' }), 1074, 420, '32 mini', 32);
  put(renderIcon(16, { kind: 'mini' }), 1130, 340, '16', 16);
  // the small ones enlarged with nearest-neighbour: what a tab strip or a launcher really shows
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(renderIcon(48, { kind: 'any' }), 964, 470, 96, 96);
  ctx.drawImage(renderIcon(32, { kind: 'mini' }), 1074, 470, 96, 96);
  ctx.fillStyle = ACCENTS.muted;
  ctx.fillText('48 px, 2x', 964, 586);
  ctx.fillText('32 px mini, 3x', 1074, 586);
  ctx.drawImage(renderIcon(32, { kind: 'mini' }), 1190, 340, 192, 192);
  ctx.fillText('32 px mini, 6x (nearest neighbour)', 1190, 552);
  return `data:image/png;base64,${await toPngBase64(sheet)}`;
}

// ---- the hero shot -------------------------------------------------------------------------------------------------

/**
 * Picks where to point the camera for the social card, from the live game state: an owned region whose keep and windmill
 * stand close together (a lush level-III corner), with a stretch of sea a few hexes away, the fog of the unknown not far
 * beyond it, and plenty of road for the caravans. Returns { x, y, regionId, score, parts } in world units.
 * @param {object} hd window.__hd
 */
export async function pickHero(hd) {
  const { world, state } = hd;
  const { revealed } = await import(new URL('../../game/meta/progression.js', import.meta.url).href);
  const plan = hd.renderer.terrain.plan;
  const reveal = revealed(state, world);
  const owned = (rid) => state.owner[rid] === 0;
  const water = world.tiles.filter((t) => t.land === false);
  const hiddenTiles = world.tiles.filter((t) => t.region >= 0 && !reveal[t.region]);
  const roads = world.tiles.filter((t) => t.land !== false && t.road);
  const near = (list, x, y) => { let d = 1e9; for (const t of list) d = Math.min(d, Math.hypot(t.x - x, t.y - y)); return d; };
  const within = (list, x, y, r) => list.reduce((n, t) => n + (Math.hypot(t.x - x, t.y - y) <= r ? 1 : 0), 0);
  let best = null;
  for (const w of plan.windmills) {
    if (!owned(w.region)) continue;
    const region = world.regions[w.region];
    const keepT = world.tiles[world.settlements[region.keep].tile];
    const dKeep = Math.hypot(keepT.x - w.x, keepT.y - w.y);
    if (dKeep > 6) continue;
    // centre between the keep and the mill, nudged toward the sea and the fog when they are close
    const cx = (keepT.x * 1.2 + w.x) / 2.2;
    const cy = (keepT.y * 1.2 + w.y) / 2.2;
    const seaD = near(water, cx, cy);
    const fogD = hiddenTiles.length ? near(hiddenTiles, cx, cy) : 30;
    const nRoad = within(roads, cx, cy, 7);
    const nSites = world.settlements.filter((s) => owned(world.tiles[s.tile].region) && Math.hypot(world.tiles[s.tile].x - cx, world.tiles[s.tile].y - cy) < 9).length;
    const parts = {
      close: -dKeep * 0.6, sea: -Math.abs(seaD - 7.5) * 0.45, fog: -Math.abs(fogD - 11) * 0.22, road: Math.min(nRoad, 14) * 0.25, sites: Math.min(nSites, 6) * 0.5,
    };
    const score = Object.values(parts).reduce((a, b) => a + b, 0);
    if (!best || score > best.score) best = { x: cx, y: cy, regionId: w.region, score, parts, dKeep, seaD, fogD, nRoad, nSites };
  }
  return best;
}
