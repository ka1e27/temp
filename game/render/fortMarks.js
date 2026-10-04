// Fortifications on the world map (DESIGN 10.3: "they show on the map as real structures"): a stone ring of Walls round the keep, the Arrow Tower where the
// sim places it, a timber Militia Hall and a Beacon brazier beside the keep. In the holder's colour: yours, or the occupier's once the region fell (10.2).
// Browser canvas only; pure drawing. Data: meta/forts.js fortsMarksData(state, world).
//
//   drawFortMarks(ctx, camera, world, marks, { colorOf, t, alpha, skip })
// Fades with the zoom like the Works marks (render/worksMarks.js worksMarkAlpha): nothing at the overview, nothing when zoomed right in on a battle.
import { elevOffset } from './tiles.js';
import { worksMarkAlpha } from './worksMarks.js';

function stoneTower(ctx, x, y, s, color) {
  const w = s * 0.22;
  const h = s * 0.5;
  ctx.fillStyle = '#9b9384'; ctx.strokeStyle = 'rgba(30, 26, 22, 0.85)'; ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.beginPath(); ctx.rect(x - w / 2, y - h, w, h); ctx.fill(); ctx.stroke();
  // crenellations
  for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.rect(x - w / 2 + i * (w / 2.5), y - h - s * 0.06, w / 4, s * 0.06); ctx.fill(); ctx.stroke(); }
  // flag
  ctx.beginPath(); ctx.moveTo(x, y - h - s * 0.06); ctx.lineTo(x, y - h - s * 0.32); ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(x, y - h - s * 0.32); ctx.lineTo(x + s * 0.16, y - h - s * 0.26); ctx.lineTo(x, y - h - s * 0.2); ctx.closePath(); ctx.fill(); ctx.stroke();
}

function hall(ctx, x, y, s, color) {
  const w = s * 0.32;
  const h = s * 0.16;
  ctx.fillStyle = '#7a5a36'; ctx.strokeStyle = 'rgba(30, 22, 14, 0.85)'; ctx.lineWidth = Math.max(1, s * 0.025);
  ctx.beginPath(); ctx.rect(x - w / 2, y - h, w, h); ctx.fill(); ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(x - w / 2 - s * 0.03, y - h); ctx.lineTo(x, y - h - s * 0.14); ctx.lineTo(x + w / 2 + s * 0.03, y - h); ctx.closePath(); ctx.fill(); ctx.stroke();
}

function beacon(ctx, x, y, s, t) {
  ctx.strokeStyle = 'rgba(30, 22, 14, 0.9)'; ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.beginPath(); ctx.moveTo(x - s * 0.08, y); ctx.lineTo(x, y - s * 0.22); ctx.lineTo(x + s * 0.08, y); ctx.stroke(); // tripod
  const flick = t == null ? 0 : Math.sin(t * 9 + x) * s * 0.02;
  ctx.fillStyle = '#ffb347';
  ctx.beginPath(); ctx.ellipse(x, y - s * 0.3 + flick, s * 0.07, s * 0.11, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff1a8';
  ctx.beginPath(); ctx.ellipse(x, y - s * 0.28 + flick, s * 0.035, s * 0.06, 0, 0, Math.PI * 2); ctx.fill();
}

function walls(ctx, x, y, s, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, 0.58);
  ctx.lineWidth = Math.max(2.5, s * 0.1);
  ctx.strokeStyle = 'rgba(30, 26, 22, 0.75)';
  ctx.beginPath(); ctx.arc(0, 0, s * 0.62, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([Math.max(3, s * 0.12), Math.max(2, s * 0.05)]);
  ctx.lineWidth = Math.max(1.6, s * 0.07);
  ctx.strokeStyle = '#c9bfa8';
  ctx.beginPath(); ctx.arc(0, 0, s * 0.62, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineWidth = Math.max(1, s * 0.02);
  ctx.strokeStyle = color;
  ctx.beginPath(); ctx.arc(0, 0, s * 0.62 + Math.max(1.5, s * 0.05), 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} camera
 * @param {object} world
 * @param {{ regionId: number, occupiedBy: number|null, forts: { type: string, level: number }[], towerTile: number|null, keepTile: number }[]} marks
 * @param {{ colorOf: (factionId: number|null) => string, t?: number, alpha?: number, skip?: (mark: object) => boolean }} opts
 */
export function drawFortMarks(ctx, camera, world, marks, opts) {
  if (!marks || !marks.length) return;
  const s = camera.zoom;
  const alpha = worksMarkAlpha(s) * (opts.alpha ?? 1);
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  for (const m of marks) {
    if (opts.skip && opts.skip(m)) continue;
    const keep = world.tiles[m.keepTile];
    if (!keep) continue;
    const color = opts.colorOf(m.occupiedBy);
    const kp = camera.worldToScreen(keep.x, keep.y - elevOffset(keep, 1));
    if (kp.x < -s * 2 || kp.y < -s * 2 || kp.x > camera.viewW + s * 2 || kp.y > camera.viewH + s * 2) continue;
    const has = (type) => m.forts.some((f) => f.type === type);
    if (has('walls')) walls(ctx, kp.x, kp.y + s * 0.12, s, color);
    if (has('hall')) hall(ctx, kp.x - s * 0.55, kp.y + s * 0.3, s, color);
    if (has('beacon')) beacon(ctx, kp.x + s * 0.55, kp.y + s * 0.32, s, opts.t);
    if (has('tower')) {
      const tt = m.towerTile != null ? world.tiles[m.towerTile] : null;
      const tp = tt ? camera.worldToScreen(tt.x, tt.y - elevOffset(tt, 1)) : { x: kp.x + s * 0.5, y: kp.y - s * 0.1 };
      stoneTower(ctx, tp.x, tp.y + s * 0.2, s, color);
    }
  }
  ctx.restore();
}
