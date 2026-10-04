// Marching war bands on the world map (DESIGN 10.1): every incoming raid walks visibly from the region it left towards the region of yours it marches on, in
// its faction's colour, with its strength on a badge. Browser canvas only; pure drawing.
//
//   drawWarBands(ctx, camera, bands, { time })
//   bands: [{ from: {x, y}, to: {x, y}, progress: 0..1, color, strength, label }] in world units (keep to keep)
// `time` undefined (Reduce Motion): no bobbing, the dashes stand still.
import { formatNum } from '../core/format.js';

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} camera
 * @param {{ from: {x:number,y:number}, to: {x:number,y:number}, progress: number, color: string, strength?: number }[]} bands
 * @param {{ time?: number }} [opts]
 */
export function drawWarBands(ctx, camera, bands, { time, avoid = [] } = {}) {
  if (!bands || !bands.length) return;
  const hits = (bx) => avoid.some((o) => bx.x0 < o.x1 && bx.x1 > o.x0 && bx.y0 < o.y1 && bx.y1 > o.y0);
  for (const b of bands) {
    const k0 = 0.3; // the band sets out from its border, not from the middle of its region (where the region's name sits)
    const a0 = camera.worldToScreen(b.from.x, b.from.y);
    const z = camera.worldToScreen(b.to.x, b.to.y);
    const a = { x: a0.x + (z.x - a0.x) * k0, y: a0.y + (z.y - a0.y) * k0 };
    const k = Math.max(0, Math.min(1, b.progress));
    const px = a.x + (z.x - a.x) * k;
    const py = a.y + (z.y - a.y) * k;
    ctx.save();
    // the road ahead: dashes from the band to the target, marching towards it
    ctx.setLineDash([7, 6]);
    ctx.lineDashOffset = time == null ? 0 : -(time * 14) % 13;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(8, 10, 16, 0.55)';
    ctx.lineWidth = 4.5;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(z.x, z.y); ctx.stroke();
    ctx.strokeStyle = b.color;
    ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(z.x, z.y); ctx.stroke();
    ctx.setLineDash([]);
    // an arrowhead at the target
    const ang = Math.atan2(z.y - py, z.x - px);
    ctx.translate(z.x, z.y);
    ctx.rotate(ang);
    ctx.beginPath(); ctx.moveTo(2, 0); ctx.lineTo(-9, -6); ctx.lineTo(-9, 6); ctx.closePath();
    ctx.fillStyle = b.color; ctx.strokeStyle = 'rgba(8, 10, 16, 0.8)'; ctx.lineWidth = 1.5;
    ctx.fill(); ctx.stroke();
    ctx.restore();

    // the band itself: a cluster of troop dots under a banner, bobbing as it marches
    ctx.save();
    ctx.translate(px, py);
    const bob = time == null ? 0 : Math.sin(time * 7) * 1.2;
    const dots = [[-7, 3], [0, 5], [7, 3], [-3.5, -1], [3.5, -1]];
    for (const [dx, dy] of dots) {
      ctx.beginPath(); ctx.arc(dx, dy + bob, 3.6, 0, Math.PI * 2);
      ctx.fillStyle = b.color; ctx.fill();
      ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(8, 10, 16, 0.85)'; ctx.stroke();
    }
    // banner pole and flag
    ctx.strokeStyle = '#3a2a18'; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(0, -2 + bob); ctx.lineTo(0, -20 + bob); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -20 + bob); ctx.lineTo(11, -16.5 + bob); ctx.lineTo(0, -13 + bob); ctx.closePath();
    ctx.fillStyle = b.color; ctx.fill(); ctx.strokeStyle = 'rgba(8, 10, 16, 0.85)'; ctx.lineWidth = 1.2; ctx.stroke();
    // strength badge
    if (b.strength != null) {
      const text = formatNum(Math.round(b.strength));
      ctx.font = '800 11px Nunito, system-ui, sans-serif';
      const w = ctx.measureText(text).width + 10;
      const hgt = 15; const r = 7.5;
      // below the band, else beside it or above: the first spot no region name has taken (labels.js returns its boxes)
      const spots = [[-w / 2, 9], [12, -hgt / 2], [-w - 12, -hgt / 2], [-w / 2, -24 - hgt], [-w / 2, 22]];
      let [x0, y0] = spots[0];
      for (const [sx, sy] of spots) { if (!hits({ x0: px + sx, x1: px + sx + w, y0: py + sy, y1: py + sy + hgt })) { x0 = sx; y0 = sy; break; } }
      y0 += bob;
      ctx.beginPath();
      ctx.moveTo(x0 + r, y0); ctx.arcTo(x0 + w, y0, x0 + w, y0 + hgt, r); ctx.arcTo(x0 + w, y0 + hgt, x0, y0 + hgt, r); ctx.arcTo(x0, y0 + hgt, x0, y0, r); ctx.arcTo(x0, y0, x0 + w, y0, r);
      ctx.fillStyle = 'rgba(14, 18, 28, 0.9)'; ctx.fill();
      ctx.strokeStyle = b.color; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.fillStyle = '#f3ead7'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, 0, y0 + hgt / 2 + 0.5);
    }
    ctx.restore();
  }
}
