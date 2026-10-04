// A varied map in battle (DESIGN 10.13): the drawing half. Browser canvas only; pure drawing, the scene's controller
// (scenes/battleFeatures.js) decides what and where.
//   drawFloodWater   high water over the river ribbons of a Flooded region, planks where a road bridges them
//   drawRangeRing    a tower's reach (Night: half as far), a faint dashed ring
//   drawShrineRing   a Shrine's hold ring: who holds it, and the shared hold progress once all are held
//   drawTelegraph    the Dragon's 1.5 s warning circle, filling as the breath nears
//   drawDragon       the Dragon itself: perched with folded wings, or flying with a ground shadow; drawDragonHp a bar over it
//   drawBreath       the flame stream from its jaws to the target for a moment
//   drawNightShade   the arena darkened, a vignette with a pale moonlit centre
//   drawSnow         a falling snow layer (Reduce Motion: a still, sparse layer)
import { elevOffset } from './tiles.js';

const TAU = Math.PI * 2;
const SQ3_2 = Math.sqrt(3) / 2;
// [E, NE, NW, W, SW, SE] (core/hex.js DIRS) as screen angles of a pointy-top hex's edge midpoints
const DIR_ANGLE = [0, -60, -120, 180, 120, 60].map((d) => (d * Math.PI) / 180);

/**
 * @param {object[]} tiles arena tiles of the flooded region ({ x, y, i, river, road, flood })
 * @param {(i:number)=>object} worldTile the world tile (for its elevation)
 * @param {number} t seconds (0 under Reduce Motion: still water)
 */
export function drawFloodWater(ctx, camera, tiles, worldTile, t) {
  const z = camera.zoom;
  const segs = []; // [cx, cy, mx, my] per river edge
  const bridges = []; // [bx, by, px, py]
  for (const tile of tiles) {
    if (!tile.flood || !tile.river) continue;
    const wt = worldTile(tile.i) || tile;
    const lift = elevOffset(wt, 1);
    const c = camera.worldToScreen(tile.x, tile.y - lift);
    if (c.x < -z * 2 || c.y < -z * 2 || c.x > camera.viewW + z * 2 || c.y > camera.viewH + z * 2) continue;
    for (let d = 0; d < 6; d++) {
      if (!((tile.river >> d) & 1)) continue;
      const a = DIR_ANGLE[d];
      const m = camera.worldToScreen(tile.x + Math.cos(a) * SQ3_2, tile.y - lift + Math.sin(a) * SQ3_2);
      segs.push([c.x, c.y, m.x, m.y]);
      // a road crossing here is a bridge: planks across the water, the one way over
      if ((tile.road >> d) & 1) bridges.push([(c.x + m.x) / 2 + (m.x - c.x) * 0.35, (c.y + m.y) / 2 + (m.y - c.y) * 0.35, Math.cos(a + Math.PI / 2), Math.sin(a + Math.PI / 2)]);
    }
  }
  if (!segs.length) return;
  const path = () => { ctx.beginPath(); for (const [x1, y1, x2, y2] of segs) { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); } };
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // one path per layer, stroked once, so the overlaps at each tile's centre do not double up: a wide pale flood band, then a brighter core
  path();
  ctx.strokeStyle = 'rgba(70, 140, 215, 0.4)';
  ctx.lineWidth = z * 0.8;
  ctx.stroke();
  ctx.strokeStyle = `rgba(150, 205, 255, ${0.55 + 0.1 * Math.sin(t * 2.2)})`;
  ctx.lineWidth = z * 0.3;
  ctx.stroke();
  ctx.lineCap = 'butt';
  for (const [bx, by, px, py] of bridges) {
    ctx.strokeStyle = '#6b4a2b';
    ctx.lineWidth = z * 0.22;
    ctx.beginPath(); ctx.moveTo(bx - px * z * 0.44, by - py * z * 0.44); ctx.lineTo(bx + px * z * 0.44, by + py * z * 0.44); ctx.stroke();
    ctx.strokeStyle = '#a77b4c';
    ctx.lineWidth = z * 0.13;
    ctx.beginPath(); ctx.moveTo(bx - px * z * 0.42, by - py * z * 0.42); ctx.lineTo(bx + px * z * 0.42, by + py * z * 0.42); ctx.stroke();
  }
  ctx.restore();
}

/** A tower's reach on the ground (screen px), faint and dashed in its owner's colour. */
export function drawRangeRing(ctx, x, y, r, color) {
  ctx.save();
  ctx.setLineDash([Math.max(3, r * 0.08), Math.max(3, r * 0.06)]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.55;
  ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.86, 0, 0, TAU); ctx.stroke();
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

/**
 * A Shrine's ring (screen px): a thin track in its holder's colour; once every Shrine is yours, a bright arc fills with the hold.
 * @param {number} frac 0..1 the shared hold progress (only drawn when `allHeld`)
 */
export function drawShrineRing(ctx, x, y, r, color, frac, allHeld, t) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(3, r * 0.14);
  ctx.strokeStyle = 'rgba(10, 8, 20, 0.55)';
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
  ctx.lineWidth = Math.max(2, r * 0.09);
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.8;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
  if (allHeld) {
    ctx.globalAlpha = 1;
    ctx.lineWidth = Math.max(3, r * 0.15);
    ctx.strokeStyle = '#f0e2ff';
    ctx.shadowColor = '#c79bff';
    ctx.shadowBlur = 8 + 4 * Math.sin(t * 6);
    ctx.beginPath(); ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0.02, Math.min(1, frac))); ctx.stroke();
  }
  ctx.restore();
}

/**
 * The Dragon's warning (screen px): a red ring on the ground, a fill that grows as the breath nears (k 0..1), and a target mark.
 * Reduce Motion: no pulse (t = 0).
 */
export function drawTelegraph(ctx, x, y, r, k, t) {
  ctx.save();
  const pulse = 1 + 0.04 * Math.sin(t * 18);
  ctx.fillStyle = `rgba(255, 70, 40, ${0.12 + 0.28 * k})`;
  ctx.beginPath(); ctx.ellipse(x, y, r * k, r * k * 0.86, 0, 0, TAU); ctx.fill();
  ctx.lineWidth = Math.max(2.5, r * 0.06);
  ctx.strokeStyle = 'rgba(20, 6, 4, 0.7)';
  ctx.beginPath(); ctx.ellipse(x, y, r * pulse, r * 0.86 * pulse, 0, 0, TAU); ctx.stroke();
  ctx.lineWidth = Math.max(2, r * 0.04);
  ctx.strokeStyle = '#ff5a3d';
  ctx.setLineDash([r * 0.18, r * 0.1]);
  ctx.beginPath(); ctx.ellipse(x, y, r * pulse, r * 0.86 * pulse, 0, 0, TAU); ctx.stroke();
  ctx.setLineDash([]);
  // the countdown: an arc shrinking round the ring
  ctx.lineWidth = Math.max(3, r * 0.07);
  ctx.strokeStyle = '#ffd28a';
  ctx.beginPath(); ctx.ellipse(x, y, r * 1.08, r * 0.93, 0, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - k)); ctx.stroke();
  ctx.restore();
}

/**
 * The Dragon (screen px; `s` = camera zoom). Perched: on top of its site, wings folded, breathing smoke. Flying: higher, wings
 * beating, a soft shadow on the ground under it.
 * @param {{ flying?: boolean, flap?: number, facing?: number, flash?: number, groundY?: number, dead?: number }} o
 *   flap: wing phase (radians); facing: 1 right, -1 left; flash 0..1 a white hit flash; groundY: the shadow's screen y when flying;
 *   dead: 0..1 the fall (it tips over and fades)
 */
export function drawDragon(ctx, x, y, s, o = {}) {
  const k = s * 1.25;
  const face = o.facing || 1;
  const flap = o.flap || 0;
  ctx.save();
  if (o.flying && o.groundY != null) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.beginPath(); ctx.ellipse(x, o.groundY, k * 1.3, k * 0.34, 0, 0, TAU); ctx.fill();
  }
  ctx.translate(x, y);
  if (o.dead) { ctx.globalAlpha *= 1 - o.dead; ctx.rotate(o.dead * 1.2 * face); ctx.translate(0, o.dead * k * 0.8); }
  ctx.scale(face, 1);
  const body = '#9a2f22';
  const dark = '#5e1a14';
  const belly = '#e8a95a';
  const wing = '#7b241b';
  const wingIn = 'rgba(240, 120, 80, 0.55)';
  // wings: spread and beating in flight, folded when perched
  const spread = o.flying ? 0.55 + 0.45 * Math.sin(flap) : 0.12;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.scale(1, 1);
    const tipX = side * k * (0.4 + 1.2 * spread) - k * 0.1;
    const tipY = -k * (0.55 + 0.9 * spread);
    ctx.fillStyle = side < 0 ? dark : wing;
    ctx.beginPath();
    ctx.moveTo(-k * 0.05, -k * 0.35);
    ctx.lineTo(tipX, tipY);
    ctx.quadraticCurveTo(tipX * 0.7, -k * 0.2, side * k * 0.25 - k * 0.05, -k * 0.05);
    ctx.closePath();
    ctx.fill();
    if (side > 0) {
      ctx.fillStyle = wingIn;
      ctx.beginPath(); ctx.moveTo(-k * 0.02, -k * 0.32); ctx.lineTo(tipX * 0.85, tipY * 0.85); ctx.lineTo(tipX * 0.55, -k * 0.2); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  // tail
  ctx.strokeStyle = body;
  ctx.lineCap = 'round';
  ctx.lineWidth = k * 0.16;
  ctx.beginPath(); ctx.moveTo(-k * 0.35, -k * 0.12); ctx.quadraticCurveTo(-k * 0.95, k * 0.05, -k * 1.15, -k * 0.35); ctx.stroke();
  ctx.fillStyle = dark;
  ctx.beginPath(); ctx.moveTo(-k * 1.15, -k * 0.5); ctx.lineTo(-k * 1.32, -k * 0.3); ctx.lineTo(-k * 1.06, -k * 0.26); ctx.closePath(); ctx.fill();
  // body
  ctx.fillStyle = body;
  ctx.beginPath(); ctx.ellipse(0, -k * 0.2, k * 0.48, k * 0.3, -0.1, 0, TAU); ctx.fill();
  ctx.fillStyle = belly;
  ctx.beginPath(); ctx.ellipse(k * 0.06, -k * 0.1, k * 0.3, k * 0.14, -0.1, 0, Math.PI); ctx.fill();
  // legs (perched)
  if (!o.flying) {
    ctx.fillStyle = dark;
    ctx.fillRect(-k * 0.25, -k * 0.05, k * 0.1, k * 0.22);
    ctx.fillRect(k * 0.18, -k * 0.05, k * 0.1, k * 0.22);
  }
  // neck and head
  ctx.strokeStyle = body;
  ctx.lineWidth = k * 0.2;
  ctx.beginPath(); ctx.moveTo(k * 0.3, -k * 0.32); ctx.quadraticCurveTo(k * 0.55, -k * 0.75, k * 0.78, -k * 0.72); ctx.stroke();
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(k * 0.68, -k * 0.86); ctx.lineTo(k * 1.12, -k * 0.74); ctx.lineTo(k * 1.14, -k * 0.64); ctx.lineTo(k * 0.7, -k * 0.58); ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#efe0c0'; // horns
  ctx.beginPath(); ctx.moveTo(k * 0.72, -k * 0.84); ctx.lineTo(k * 0.56, -k * 1.06); ctx.lineTo(k * 0.8, -k * 0.86); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffe36b'; // the ember eye
  ctx.beginPath(); ctx.arc(k * 0.86, -k * 0.76, k * 0.045, 0, TAU); ctx.fill();
  if (o.flash) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha *= Math.min(1, o.flash) * 0.7;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.ellipse(0, -k * 0.3, k * 0.75, k * 0.5, 0, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

/** The Dragon's health over it (screen px). */
export function drawDragonHp(ctx, x, y, s, frac) {
  const w = Math.max(44, s * 1.7);
  const hgt = Math.max(5, s * 0.14);
  ctx.save();
  ctx.fillStyle = 'rgba(12, 8, 8, 0.82)';
  ctx.beginPath(); ctx.roundRect(x - w / 2 - 2, y - 2, w + 4, hgt + 4, (hgt + 4) / 2); ctx.fill();
  const g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
  g.addColorStop(0, '#ff4d2e');
  g.addColorStop(1, '#ffa45c');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.roundRect(x - w / 2, y, Math.max(hgt, w * Math.max(0, Math.min(1, frac))), hgt, hgt / 2); ctx.fill();
  ctx.restore();
}

/** The flame stream (screen px) from the jaws (x1, y1) to the target (x2, y2); k 0..1 its life. */
export function drawBreath(ctx, x1, y1, x2, y2, k, s) {
  const a = Math.max(0, 1 - k);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const [w, col] of [[s * 0.5, `rgba(255, 90, 30, ${0.45 * a})`], [s * 0.26, `rgba(255, 190, 80, ${0.7 * a})`], [s * 0.1, `rgba(255, 250, 210, ${0.8 * a})`]]) {
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo((x1 + x2) / 2, Math.min(y1, y2) - s * 0.8, x2, y2); ctx.stroke();
  }
  ctx.restore();
}

/** Night: the arena darkened at its edges, a cool moonlit centre. */
export function drawNightShade(ctx, w, h, alpha = 1) {
  ctx.save();
  const g = ctx.createRadialGradient(w / 2, h * 0.5, Math.min(w, h) * 0.18, w / 2, h * 0.5, Math.max(w, h) * 0.72);
  g.addColorStop(0, `rgba(20, 30, 70, ${0.18 * alpha})`);
  g.addColorStop(1, `rgba(4, 6, 20, ${0.62 * alpha})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/** A falling snow layer, screen space; `t` = 0 under Reduce Motion (a still, sparse layer). Flakes are a stable hash of their index. */
export function drawSnow(ctx, w, h, t, still) {
  const n = still ? 90 : 200;
  ctx.save();
  ctx.fillStyle = 'rgba(235, 245, 255, 0.85)';
  for (let i = 0; i < n; i++) {
    const hx = ((i * 7919) % 1000) / 1000;
    const hy = ((i * 104729) % 1000) / 1000;
    const sz = 1.3 + ((i * 31) % 3) * 0.9;
    const speed = 22 + ((i * 13) % 7) * 6;
    const x = (hx * w + Math.sin(t * 0.9 + i) * 14 + t * 18) % w;
    const y = (hy * h + t * speed) % h;
    ctx.globalAlpha = 0.55 + ((i * 17) % 5) * 0.1;
    ctx.beginPath(); ctx.arc(x < 0 ? x + w : x, y, sz, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(220, 235, 250, 0.14)'; // a pale wash: the cold
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/** A small label pill under a site (screen px): the Gate's "Gate". */
export function drawSiteTag(ctx, x, y, text, color) {
  ctx.save();
  ctx.font = '800 11px Nunito, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 14;
  ctx.fillStyle = 'rgba(10, 12, 18, 0.85)';
  ctx.beginPath(); ctx.roundRect(x - w / 2, y - 9, w, 18, 9); ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#fff6dc';
  ctx.fillText(text, x, y + 0.5);
  ctx.restore();
}

/** A padlock (screen px, `s` its height): a keep shut until its Gate falls. */
export function drawPadlock(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  const u = s / 20;
  ctx.scale(u, u);
  ctx.lineWidth = 3.4;
  ctx.strokeStyle = 'rgba(12, 10, 8, 0.9)';
  ctx.beginPath(); ctx.arc(0, -3, 5, Math.PI, 0); ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#d9d2c0';
  ctx.beginPath(); ctx.arc(0, -3, 5, Math.PI, 0); ctx.stroke();
  ctx.fillStyle = 'rgba(12, 10, 8, 0.9)';
  ctx.beginPath(); ctx.roundRect(-8, -4, 16, 13, 3); ctx.fill();
  ctx.fillStyle = '#f5c451';
  ctx.beginPath(); ctx.roundRect(-6.5, -2.5, 13, 10, 2); ctx.fill();
  ctx.fillStyle = '#5a3d10';
  ctx.beginPath(); ctx.arc(0, 1.5, 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(-0.8, 1.5, 1.6, 3.5);
  ctx.restore();
}
