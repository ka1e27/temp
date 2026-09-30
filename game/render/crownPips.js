// Tiny gold crown pips for owned regions' map labels (DESIGN §4.8: "Owned regions show small
// crown pips under their map label"). Pure canvas drawing, no state, no allocation beyond one
// gradient per pip; the world scene decides where and when.

const OUTLINE = 'rgba(20, 14, 6, 0.92)';
const GOLD_TOP = '#ffe9a0';
const GOLD_MID = '#f5c451';
const GOLD_LOW = '#d99a1e';
const BAND = 'rgba(120, 70, 8, 0.55)';

// A crown in a unit box (x -0.5..0.5, y -0.36..0.36): band along the bottom, three peaks.
const CROWN = [
  [-0.5, 0.36], [-0.5, -0.2], [-0.25, 0.04], [0, -0.36], [0.25, 0.04], [0.5, -0.2], [0.5, 0.36],
];

function crownPath(ctx, cx, cy, w) {
  ctx.beginPath();
  for (let i = 0; i < CROWN.length; i++) {
    const px = cx + CROWN[i][0] * w;
    const py = cy + CROWN[i][1] * w;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** Device pixels per CSS pixel of the current transform (uniform scale assumed). */
function deviceScale(ctx) {
  const m = ctx.getTransform ? ctx.getTransform() : null;
  return m && m.a > 0 ? m.a : 1;
}

/**
 * Draws `count` gold crown pips in a row, horizontally centred on `x`, vertically centred on `y`.
 * Dark outline so they read over sand, snow and grass alike; snapped to device pixels so the
 * outline stays crisp at DPR 2 (draw in CSS pixels with the DPR transform applied).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x  centre of the whole row, in the ctx's current coordinate space
 * @param {number} y  vertical centre of the pips
 * @param {number} count  crowns earned, 0-3
 * @param {number} sizePx  width of one pip (label-sized: 9-14 px works well)
 * @param {{ total?: number, alpha?: number }} [opts]  `total` > `count` also draws the missing
 *   crowns as dim empty slots (so 2/3 reads as two gold, one hollow); `alpha` fades the row
 * @returns {{ w: number, h: number }} the row's size, so the caller can reserve room in label layout
 */
export function drawCrownPips(ctx, x, y, count, sizePx, opts = {}) {
  const earned = Math.max(0, Math.min(3, Math.floor(count) || 0));
  const total = Math.max(earned, Math.min(3, Math.floor(opts.total || 0) || earned));
  if (total === 0 || !(sizePx > 0)) return { w: 0, h: 0 };

  const w = sizePx;
  const h = sizePx * 0.72;
  const gap = Math.max(1, sizePx * 0.22);
  const rowW = total * w + (total - 1) * gap;
  const scale = deviceScale(ctx);
  const snap = (v) => Math.round(v * scale) / scale;
  const line = Math.max(1 / scale * 2, sizePx * 0.15);

  ctx.save();
  if (opts.alpha != null) ctx.globalAlpha *= opts.alpha;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (let i = 0; i < total; i++) {
    const cx = snap(x - rowW / 2 + w / 2 + i * (w + gap));
    const cy = snap(y);
    crownPath(ctx, cx, cy, w);

    if (i >= earned) {
      // empty slot: a dim hollow crown
      ctx.fillStyle = 'rgba(20, 14, 6, 0.38)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 233, 160, 0.55)';
      ctx.lineWidth = Math.max(1 / scale, sizePx * 0.08);
      ctx.stroke();
      continue;
    }

    // dark outline first (wider), then the gold body on top
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = line;
    ctx.stroke();
    const g = ctx.createLinearGradient(cx, cy - h / 2, cx, cy + h / 2);
    g.addColorStop(0, GOLD_TOP);
    g.addColorStop(0.5, GOLD_MID);
    g.addColorStop(1, GOLD_LOW);
    ctx.fillStyle = g;
    ctx.fill();

    // band line just above the base, and a jewel dot on the middle peak when big enough
    if (sizePx >= 9) {
      ctx.strokeStyle = BAND;
      ctx.lineWidth = Math.max(1 / scale, sizePx * 0.07);
      ctx.beginPath();
      ctx.moveTo(cx - w * 0.5, cy + w * 0.2);
      ctx.lineTo(cx + w * 0.5, cy + w * 0.2);
      ctx.stroke();
    }
    if (sizePx >= 11) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.beginPath();
      ctx.arc(cx, cy - w * 0.02, sizePx * 0.06, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
  return { w: rowW, h };
}
