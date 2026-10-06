// The Tide Fortress's Tide and the Admiral's Broadside on the battlefield (PLAN-PHASE12 §12B): pure drawing in screen px. The controller
// (scenes/battleSea.js) owns the timing and positions.
import { rgba } from './palette.js';

const TAU = Math.PI * 2;
export const SEA_FX = Object.freeze({
  water: '#3fb7c9',  // flood water over the fords
  deep: '#1d6f8a',
  foam: '#f2fbfa',
  warn: '#bdf4ff',   // the telegraph ring
  shot: '#ffcf6a',   // Broadside muzzle flash
});

/**
 * The Tide's telegraph round one ford tile (or the fortress's whole ring): water welling up from the edges toward the centre, a dashed
 * foam ring and a countdown arc. `k` 0..1 is the telegraph's progress (1 = the fords flood now). `r` px.
 */
export function drawTideRing(ctx, x, y, r, k, t, still) {
  ctx.save();
  const ry = 0.86;
  const pulse = still ? 1 : 1 + 0.03 * Math.sin(t * 7);
  // the water rising: a ring that thickens inward
  const inner = r * (1 - 0.85 * k);
  ctx.fillStyle = rgba(SEA_FX.water, 0.12 + 0.3 * k);
  ctx.beginPath();
  ctx.ellipse(x, y, r * pulse, r * ry * pulse, 0, 0, TAU);
  ctx.ellipse(x, y, inner, inner * ry, 0, 0, TAU, true);
  ctx.fill('evenodd');
  // the outer ring: a dark casing under dashed foam
  ctx.lineWidth = Math.max(3, r * 0.06);
  ctx.strokeStyle = 'rgba(6, 24, 36, 0.65)';
  ctx.beginPath(); ctx.ellipse(x, y, r * pulse, r * ry * pulse, 0, 0, TAU); ctx.stroke();
  ctx.lineWidth = Math.max(2, r * 0.035);
  ctx.strokeStyle = SEA_FX.warn;
  ctx.setLineDash([r * 0.1, r * 0.08]);
  ctx.lineDashOffset = still ? 0 : -t * r * 0.3;
  ctx.beginPath(); ctx.ellipse(x, y, r * pulse, r * ry * pulse, 0, 0, TAU); ctx.stroke();
  ctx.setLineDash([]);
  // the inner tide line, a scalloped foam edge creeping inward
  ctx.strokeStyle = rgba(SEA_FX.foam, 0.4 + 0.5 * k);
  ctx.lineWidth = Math.max(1.5, r * 0.03);
  ctx.beginPath();
  const n = 28;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * TAU;
    const w = 1 + 0.04 * Math.sin(a * 7 + (still ? 0 : t * 4));
    const px = x + Math.cos(a) * inner * w; const py = y + Math.sin(a) * inner * ry * w;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();
  // the countdown arc
  ctx.lineWidth = Math.max(3, r * 0.07);
  ctx.strokeStyle = SEA_FX.warn;
  ctx.beginPath(); ctx.ellipse(x, y, r * 1.1, r * ry * 1.1, 0, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - k)); ctx.stroke();
  ctx.restore();
}

/**
 * One flooded ford tile (a hex of radius `s` px at (x, y)): deep-ish water over the sandbar with moving foam. `k` 1..0 = flood time left
 * (it drains over the last 15%).
 */
export function drawFloodTile(ctx, x, y, s, k, t, still) {
  const a = Math.min(1, k / 0.15);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const ang = ((-90 + 60 * i) * Math.PI) / 180;
    const px = x + s * 1.02 * Math.cos(ang); const py = y + s * 1.02 * Math.sin(ang);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = rgba(SEA_FX.deep, 0.62);
  ctx.fill();
  ctx.clip();
  ctx.strokeStyle = rgba(SEA_FX.foam, 0.55);
  ctx.lineWidth = Math.max(1, s * 0.05);
  const off = still ? 0 : (t * 0.6) % 1;
  for (let j = -1; j <= 2; j++) {
    const yy = y - s + (j + off) * s * 0.7;
    ctx.beginPath();
    for (let i = 0; i <= 8; i++) {
      const xx = x - s + (i / 8) * s * 2;
      const w = Math.sin(i * 1.4 + j + (still ? 0 : t * 3)) * s * 0.06;
      if (i === 0) ctx.moveTo(xx, yy + w); else ctx.lineTo(xx, yy + w);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** The Broadside on one coastal site: a smoke puff ring and a gold muzzle-flash star, `k` 0..1 through each shot. */
export function drawBroadsideHit(ctx, x, y, r, k) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - k);
  ctx.fillStyle = 'rgba(210,210,200,0.5)';
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    ctx.beginPath(); ctx.arc(x + Math.cos(a) * r * (0.4 + k * 0.5), y + Math.sin(a) * r * 0.5 * (0.4 + k * 0.5), r * 0.22, 0, TAU); ctx.fill();
  }
  ctx.fillStyle = SEA_FX.shot;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU; const rr = i % 2 ? r * 0.18 : r * 0.42 * (1 - k * 0.5);
    if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath(); ctx.fill();
  ctx.restore();
}
