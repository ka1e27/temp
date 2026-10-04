// World-map markers for the Living Frontier (DESIGN 10.5): crossed swords over every region being fought over. Browser canvas only; pure drawing.
//
//   drawBattleMarkers(ctx, camera, markers, { time })   // markers: [{ x, y, kind: 'attack'|'defense', focused? }] in world units (the region's label anchor)
// Drawn in screen space at a fixed size (a hex is tiny at overview zoom), just above the region's name label, after the labels so nothing covers them.
// `time` undefined (Reduce Motion) stills the pulse.

const R = 13; // px: the disc's radius

/** One crossed-swords glyph centred at (0, 0), about 2R across. */
function swords(ctx, color) {
  ctx.lineCap = 'round';
  for (const dir of [1, -1]) {
    ctx.save();
    ctx.rotate(dir * Math.PI / 4);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.moveTo(0, -R * 0.78); ctx.lineTo(0, R * 0.45); ctx.stroke(); // the blade
    ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(-R * 0.3, R * 0.42); ctx.lineTo(R * 0.3, R * 0.42); ctx.stroke(); // the crossguard
    ctx.lineWidth = 2.8;
    ctx.beginPath(); ctx.moveTo(0, R * 0.48); ctx.lineTo(0, R * 0.72); ctx.stroke(); // the grip
    ctx.restore();
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} camera
 * @param {{ x: number, y: number, kind?: string, focused?: boolean }[]} markers
 * @param {{ time?: number, liftPx?: number }} [opts]
 */
export function drawBattleMarkers(ctx, camera, markers, { time, liftPx = 34 } = {}) {
  if (!markers || !markers.length) return;
  for (const m of markers) {
    const p = camera.worldToScreen(m.x, m.y);
    const x = p.x;
    const y = p.y - liftPx;
    if (x < -R * 2 || y < -R * 2 || x > camera.viewW + R * 2 || y > camera.viewH + R * 2) continue;
    const pulse = time == null ? 0.5 : 0.5 + 0.5 * Math.sin(time * 4.2);
    ctx.save();
    ctx.translate(x, y);
    // a soft red ring that breathes: something is happening here
    ctx.beginPath();
    ctx.arc(0, 0, R + 3 + pulse * 3, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(235, 87, 87, ${0.35 + 0.35 * (1 - pulse)})`;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(14, 18, 28, 0.88)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = m.kind === 'defense' || m.kind === 'duel' ? '#9cc4ff' : '#f5c451';
    ctx.stroke();
    swords(ctx, '#f3ead7');
    ctx.restore();
  }
}
