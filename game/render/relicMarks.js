// The map's Relic marks (PLAN-PHASE7 §7B): a small treasure chest beside the keep of every revealed region still holding a Relic, with a soft gold halo
// and a four-point glint that flashes every few seconds (still under Reduce Motion). Screen-space vector drawing, crisp at any DPR. Browser only; pure
// drawing: the scene passes the region ids, nothing here reads or changes game state.
//
//   drawRelicMarks(ctx, camera, world, regionIds, { t, alpha, skip })
//   relicMarkPos(camera, world, regionId)          the chest's screen point (tests, the tutorial's L1 target)

import { elevOffset } from './tiles.js';

const GOLD = '#ffd86b';
const GOLD_DEEP = '#a8701a';
const WOOD = '#6b3f1d';
const WOOD_DARK = '#3d220f';

/** World point of the chest: a little right of and below the region's keep, so the keep sprite stays clear. */
function chestWorld(world, regionId) {
  const region = world.regions[regionId];
  if (!region) return null;
  const keep = world.settlements[region.keep];
  const tile = keep ? world.tiles[keep.tile] : null;
  if (!tile) return null;
  return { x: tile.x + 0.72, y: tile.y + 0.4, tile };
}

/** Pixel size of the chest at this zoom (camera.zoom = px per world unit), clamped so it reads when zoomed out and never dwarfs a keep. */
export function chestSizePx(zoom) {
  return Math.max(24, Math.min(44, zoom * 0.75)); // ~1.5x the first cut: the promise is 'visible before you commit'
}

export function relicMarkPos(camera, world, regionId) {
  const w = chestWorld(world, regionId);
  if (!w) return null;
  const p = camera.worldToScreen(w.x, w.y);
  return { x: p.x, y: p.y - elevOffset(w.tile, camera.zoom), size: chestSizePx(camera.zoom) };
}

function drawChest(ctx, x, y, s) {
  // y = the chest's base; s = its width
  const w = s;
  const hBody = s * 0.5;
  const hLid = s * 0.32;
  const left = x - w / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(x, y + s * 0.04, w * 0.6, s * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  // body
  ctx.fillStyle = WOOD;
  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = Math.max(1, s * 0.07);
  ctx.beginPath();
  ctx.rect(left, y - hBody, w, hBody);
  ctx.fill();
  ctx.stroke();
  // lid (a rounded top)
  ctx.beginPath();
  ctx.moveTo(left, y - hBody);
  ctx.lineTo(left, y - hBody - hLid * 0.4);
  ctx.quadraticCurveTo(x, y - hBody - hLid * 1.6, left + w, y - hBody - hLid * 0.4);
  ctx.lineTo(left + w, y - hBody);
  ctx.closePath();
  ctx.fillStyle = '#7d4a22';
  ctx.fill();
  ctx.stroke();
  // gold bands and the lock
  ctx.fillStyle = GOLD;
  const band = Math.max(1.2, s * 0.1);
  ctx.fillRect(left + w * 0.18 - band / 2, y - hBody - hLid * 0.75, band, hBody + hLid * 0.75);
  ctx.fillRect(left + w * 0.82 - band / 2, y - hBody - hLid * 0.75, band, hBody + hLid * 0.75);
  ctx.fillRect(left, y - hBody - band / 2, w, band);
  ctx.fillStyle = GOLD_DEEP;
  ctx.fillRect(x - s * 0.1, y - hBody - s * 0.08, s * 0.2, s * 0.24);
  ctx.fillStyle = GOLD;
  ctx.fillRect(x - s * 0.06, y - hBody - s * 0.04, s * 0.12, s * 0.12);
}

function drawGlint(ctx, x, y, r, a) {
  if (a <= 0.01) return;
  ctx.save();
  ctx.globalAlpha *= a;
  ctx.fillStyle = '#fff8dc';
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 4;
    const rr = i % 2 === 0 ? r : r * 0.22;
    const px = x + Math.cos(ang) * rr;
    const py = y + Math.sin(ang) * rr;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx screen space
 * @param {{ worldToScreen: Function, zoom: number }} camera
 * @param {object} world
 * @param {number[]} regionIds   regions holding an unclaimed Relic
 * @param {{ t?: number, alpha?: number, skip?: (id: number) => boolean }} [opts]  t omitted = Reduce Motion (a still glint)
 */
export function drawRelicMarks(ctx, camera, world, regionIds, opts = {}) {
  if (!regionIds || !regionIds.length) return;
  const { t, alpha = 1, skip } = opts;
  ctx.save();
  for (const id of regionIds) {
    if (skip && skip(id)) continue;
    const p = relicMarkPos(camera, world, id);
    if (!p) continue;
    const s = p.size;
    if (p.x < -40 || p.y < -40 || p.x > ctx.canvas.width + 40 || p.y > ctx.canvas.height + 40) continue;
    ctx.globalAlpha = alpha;
    // the halo: a slow breath, so the eye finds it on any terrain
    const breath = t == null ? 0.75 : 0.6 + 0.25 * Math.sin(t * 2.2 + id);
    const g = ctx.createRadialGradient(p.x, p.y - s * 0.35, 0, p.x, p.y - s * 0.35, s * 1.25);
    g.addColorStop(0, `rgba(255, 224, 130, ${0.75 * breath})`);
    g.addColorStop(1, 'rgba(255, 216, 107, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y - s * 0.35, s * 1.25, 0, Math.PI * 2);
    ctx.fill();
    drawChest(ctx, p.x, p.y, s);
    // the glint: a sharp star flash on the lid every ~2.6 s (offset per region); held at a soft glow under Reduce Motion
    // a small steady spark always, a sharp flash every ~2.6 s (held at a bright spark under Reduce Motion)
    let a = 0.8;
    if (t != null) {
      const ph = ((t + id * 0.37) % 2.6) / 2.6;
      a = ph < 0.22 ? Math.sin((ph / 0.22) * Math.PI) : 0;
    }
    const gx = p.x + s * 0.3;
    const gy = p.y - s * 0.8;
    const flare = ctx.createRadialGradient(gx, gy, 0, gx, gy, s * 0.7);
    flare.addColorStop(0, `rgba(255, 250, 220, ${0.35 + 0.5 * a})`);
    flare.addColorStop(1, 'rgba(255, 250, 220, 0)');
    ctx.fillStyle = flare;
    ctx.beginPath(); ctx.arc(gx, gy, s * 0.7, 0, Math.PI * 2); ctx.fill();
    drawGlint(ctx, gx, gy, s * (0.3 + 0.35 * a), Math.max(0.55, a));
  }
  ctx.restore();
}
