// Map glyphs for a varied map (DESIGN 10.13): a region type's icon beside its name, a twist's glyph on its frontier chip. Browser canvas; pure drawing,
// centred at (x, y), `s` = the glyph's size in px. Bold silhouettes with a dark rim so they read over any terrain.
//   types:  goldmine (pickaxe), monastery (bell tower), bandit (skull banner), ruins (broken arch), dragon (a dragon's head)
//   twists: night (moon), blizzard (snowflake), flooded (wave), holy (sun with a halo), siege (gate), raid (shrine)


function badge(ctx, x, y, s, fill) {
  ctx.beginPath();
  ctx.arc(x, y, s * 0.56, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(14, 16, 24, 0.82)';
  ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.08);
  ctx.strokeStyle = fill;
  ctx.stroke();
}

const TYPE_COLOR = { goldmine: '#f5c451', monastery: '#e8dcc0', bandit: '#eb5757', ruins: '#b8b0a0', dragon: '#ff7a3d' };
const TWIST_COLOR = { night: '#b9c6ff', blizzard: '#dff3ff', flooded: '#6fb3ff', holy: '#ffe08a', siege: '#c9bfa8', raid: '#c79bff' };

/** A region type's icon in a round dark badge. */
export function drawTypeIcon(ctx, type, x, y, s) {
  const c = TYPE_COLOR[type];
  if (!c) return;
  ctx.save();
  badge(ctx, x, y, s, c);
  ctx.translate(x, y);
  ctx.fillStyle = c;
  ctx.strokeStyle = c;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const u = s / 24; // a 24-unit grid
  ctx.scale(u, u);
  if (type === 'goldmine') {
    // a pickaxe: a curved head across a diagonal handle
    ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.moveTo(-6, 7); ctx.lineTo(5, -4); ctx.stroke();
    ctx.lineWidth = 2.8;
    ctx.beginPath(); ctx.moveTo(-1, -8); ctx.quadraticCurveTo(6, -7, 8, 0); ctx.stroke();
  } else if (type === 'monastery') {
    // a bell tower: a tall block, a pointed roof, a bell opening
    ctx.beginPath(); ctx.moveTo(-4, 8); ctx.lineTo(-4, -3); ctx.lineTo(0, -9); ctx.lineTo(4, -3); ctx.lineTo(4, 8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(14, 16, 24, 0.9)';
    ctx.beginPath(); ctx.arc(0, 0, 2, Math.PI, 0); ctx.lineTo(2, 2.5); ctx.lineTo(-2, 2.5); ctx.closePath(); ctx.fill();
  } else if (type === 'bandit') {
    // a skull on a banner
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-6, 9); ctx.lineTo(-6, -9); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-6, -9); ctx.lineTo(7, -9); ctx.lineTo(4, -4); ctx.lineTo(7, 1); ctx.lineTo(-6, 1); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(14, 16, 24, 0.95)';
    ctx.beginPath(); ctx.arc(0.5, -4.6, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(-0.5, -5, 0.7, 0, Math.PI * 2); ctx.arc(1.5, -5, 0.7, 0, Math.PI * 2); ctx.fill();
  } else if (type === 'ruins') {
    // a broken arch: two pillars, the arch snapped on one side
    ctx.fillRect(-7, -2, 3, 10);
    ctx.fillRect(4, 1, 3, 7);
    ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.arc(0, -2, 5.5, Math.PI, Math.PI * 1.65); ctx.stroke();
    ctx.fillRect(-8, 7, 16, 2);
  } else if (type === 'dragon') {
    // a dragon's head in profile: horned skull, open jaw, an ember eye
    ctx.beginPath();
    ctx.moveTo(-8, 2); ctx.lineTo(-3, -4); ctx.lineTo(-4, -9); ctx.lineTo(0, -5); ctx.lineTo(6, -4); ctx.lineTo(9, -1); ctx.lineTo(3, 0);
    ctx.lineTo(8, 3); ctx.lineTo(1, 4); ctx.lineTo(-2, 8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff1a8';
    ctx.beginPath(); ctx.arc(1.5, -2.5, 1.1, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/** A twist's glyph (no badge: it sits inside the frontier chip). */
export function drawTwistGlyph(ctx, twist, x, y, s) {
  const c = TWIST_COLOR[twist];
  if (!c) return;
  ctx.save();
  ctx.translate(x, y);
  const u = s / 24;
  ctx.scale(u, u);
  ctx.fillStyle = c;
  ctx.strokeStyle = c;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (twist === 'night') {
    // a crescent: the disc minus an offset disc, clipped to the disc (no compositing: it sits on a chip)
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.clip();
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.arc(4, -3, 7, 0, Math.PI * 2, true); ctx.fill('evenodd');
  } else if (twist === 'blizzard') {
    ctx.lineWidth = 2;
    for (let k = 0; k < 3; k++) {
      ctx.save(); ctx.rotate((k * Math.PI) / 3);
      ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(0, 9); ctx.moveTo(-3, -6.5); ctx.lineTo(0, -4); ctx.lineTo(3, -6.5); ctx.moveTo(-3, 6.5); ctx.lineTo(0, 4); ctx.lineTo(3, 6.5); ctx.stroke();
      ctx.restore();
    }
  } else if (twist === 'flooded') {
    ctx.lineWidth = 2.4;
    for (const dy of [-4, 3]) { ctx.beginPath(); ctx.moveTo(-9, dy); ctx.quadraticCurveTo(-4.5, dy - 4, 0, dy); ctx.quadraticCurveTo(4.5, dy + 4, 9, dy); ctx.stroke(); }
  } else if (twist === 'holy') {
    ctx.beginPath(); ctx.arc(0, 2, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.ellipse(0, -6, 6.5, 2.2, 0, 0, Math.PI * 2); ctx.stroke();
  } else if (twist === 'siege') {
    ctx.beginPath(); ctx.moveTo(-8, 8); ctx.lineTo(-8, -5); ctx.lineTo(-5, -5); ctx.lineTo(-5, -8); ctx.lineTo(5, -8); ctx.lineTo(5, -5); ctx.lineTo(8, -5); ctx.lineTo(8, 8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(14, 16, 24, 0.95)';
    ctx.beginPath(); ctx.moveTo(-3.5, 8); ctx.lineTo(-3.5, 1); ctx.arc(0, 1, 3.5, Math.PI, 0); ctx.lineTo(3.5, 8); ctx.closePath(); ctx.fill();
  } else if (twist === 'raid') {
    // a shrine: a small roofed stone on a step
    ctx.beginPath(); ctx.moveTo(-8, -3); ctx.lineTo(0, -9); ctx.lineTo(8, -3); ctx.closePath(); ctx.fill();
    ctx.fillRect(-5, -3, 10, 8);
    ctx.fillRect(-8, 5, 16, 3);
  }
  ctx.restore();
}

/** The Plague's mark beside a region's name (DESIGN 10.13): a sickly green drop with a dark rim and three spots. */
export function drawPlagueMark(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  const u = s / 24;
  ctx.scale(u, u);
  ctx.beginPath();
  ctx.moveTo(0, -11); ctx.bezierCurveTo(5, -4, 9, 1, 9, 5); ctx.arc(0, 5, 9, 0, Math.PI); ctx.bezierCurveTo(-9, 1, -5, -4, 0, -11); ctx.closePath();
  ctx.fillStyle = '#b5d33a';
  ctx.fill();
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = 'rgba(20, 26, 6, 0.9)';
  ctx.stroke();
  ctx.fillStyle = '#3b4a0c';
  for (const [dx, dy] of [[-3, 3], [3, 4], [0, 8]]) { ctx.beginPath(); ctx.arc(dx, dy, 1.8, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}
