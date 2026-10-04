// The Ashen Host on the battlefield (PLAN-PHASE6 §6B; docs/briefs/phase6-hookup.md §4): pure drawing, in screen px. The controller
// (scenes/battleAshen.js) owns the timing and positions.
//
//   drawWisp(ctx, x, y, r, color, alpha, tail)   a soft glowing wisp with a fading tail [[x, y], ...] (newest first)
//   drawAshRing(ctx, x, y, r, k, t, still)       the Barrow Keep's Rising telegraph: an ash ring closing in (k 0..1 = progress)
//   drawBurnGround(ctx, x, y, r, k, t, still)    Firestorm's burning ground where no dead rise (k 1..0 = time left)
//   ASHEN_FX                                     the colours (the faction's cold glow, bone, the ember of a burn)

const TAU = Math.PI * 2;

export const ASHEN_FX = Object.freeze({
  glow: '#a9dfd6',   // the cold ember glow (FACTIONS[5].colorLight)
  core: '#f1fffb',
  bone: '#e6dcc4',
  ash: '#2c2b33',    // FACTIONS[5].colorDark
  ember: '#ff8a3d',  // Firestorm burning the dead
  emberCore: '#ffe3a0',
});

/** Hex "#rrggbb" + alpha -> rgba(). */
function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}

/**
 * A wisp: a radial glow with a bright core, and its tail of fading specks.
 * @param {number} r radius in px
 * @param {string} color ASHEN_FX.glow or ASHEN_FX.ember
 * @param {Array<[number, number]>} [tail]
 */
export function drawWisp(ctx, x, y, r, color, alpha, tail) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  if (tail) {
    for (let i = 0; i < tail.length; i++) {
      const k = 1 - (i + 1) / (tail.length + 1);
      ctx.fillStyle = rgba(color, alpha * 0.45 * k);
      ctx.beginPath(); ctx.arc(tail[i][0], tail[i][1], r * (0.35 + 0.4 * k), 0, TAU); ctx.fill();
    }
  }
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.2);
  g.addColorStop(0, rgba(color, alpha * 0.7));
  g.addColorStop(0.35, rgba(color, alpha * 0.3));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r * 2.2, 0, TAU); ctx.fill();
  ctx.fillStyle = rgba(color === ASHEN_FX.ember ? ASHEN_FX.emberCore : ASHEN_FX.core, alpha * 0.85);
  ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, TAU); ctx.fill();
  ctx.restore();
}

/**
 * The Rising's telegraph round the Barrow Keep: a dark ash disc that fills as the squad nears, a dashed bone ring, ash motes spiralling in,
 * and a countdown arc in the cold glow. `k` 0..1 is the telegraph's progress (1 = the dead rise now).
 */
export function drawAshRing(ctx, x, y, r, k, t, still) {
  ctx.save();
  const ry = 0.86;
  const pulse = still ? 1 : 1 + 0.035 * Math.sin(t * 9);
  // the ground darkening with ash
  ctx.fillStyle = `rgba(28, 27, 34, ${0.14 + 0.3 * k})`;
  ctx.beginPath(); ctx.ellipse(x, y, r * pulse, r * ry * pulse, 0, 0, TAU); ctx.fill();
  // an inner ring closing on the keep
  const inner = r * (1 - 0.72 * k);
  ctx.lineWidth = Math.max(2, r * 0.05);
  ctx.strokeStyle = rgba(ASHEN_FX.glow, 0.25 + 0.55 * k);
  ctx.beginPath(); ctx.ellipse(x, y, inner, inner * ry, 0, 0, TAU); ctx.stroke();
  // the outer ring: a dark casing under dashed bone
  ctx.lineWidth = Math.max(3, r * 0.065);
  ctx.strokeStyle = 'rgba(10, 10, 14, 0.7)';
  ctx.beginPath(); ctx.ellipse(x, y, r * pulse, r * ry * pulse, 0, 0, TAU); ctx.stroke();
  ctx.lineWidth = Math.max(2, r * 0.04);
  ctx.strokeStyle = ASHEN_FX.bone;
  ctx.setLineDash([r * 0.12, r * 0.09]);
  ctx.lineDashOffset = still ? 0 : -t * r * 0.25;
  ctx.beginPath(); ctx.ellipse(x, y, r * pulse, r * ry * pulse, 0, 0, TAU); ctx.stroke();
  ctx.setLineDash([]);
  // ash motes drifting inward (deterministic per mote: angle + time)
  const motes = still ? 8 : 18;
  for (let i = 0; i < motes; i++) {
    const a0 = (i / motes) * TAU;
    const ph = still ? 0.5 : ((t * 0.55 + i * 0.137) % 1);
    const rr = r * (1 - ph * 0.8);
    const a = a0 + (still ? 0 : ph * 1.4);
    const mx = x + Math.cos(a) * rr;
    const my = y + Math.sin(a) * rr * ry - ph * r * 0.12;
    ctx.fillStyle = i % 3 === 0 ? rgba(ASHEN_FX.glow, 0.75 * (1 - ph * 0.6)) : `rgba(70, 68, 78, ${0.85 * (1 - ph * 0.5)})`;
    ctx.beginPath(); ctx.arc(mx, my, Math.max(1.5, r * 0.03), 0, TAU); ctx.fill();
  }
  // the countdown arc
  ctx.lineWidth = Math.max(3, r * 0.07);
  ctx.strokeStyle = ASHEN_FX.glow;
  ctx.beginPath(); ctx.ellipse(x, y, r * 1.1, r * ry * 1.1, 0, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - k)); ctx.stroke();
  ctx.restore();
}

/** Firestorm's burning ground (the dead do not rise inside it): a faint ember wash and a flickering ember rim. `k` 1..0 = time left. */
export function drawBurnGround(ctx, x, y, r, k, t, still) {
  if (k <= 0) return;
  ctx.save();
  const ry = 0.86;
  const g = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
  g.addColorStop(0, rgba(ASHEN_FX.ember, 0.3 * k));
  g.addColorStop(1, rgba(ASHEN_FX.ember, 0.06 * k));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(x, y, r, r * ry, 0, 0, TAU); ctx.fill();
  ctx.lineWidth = Math.max(2, r * 0.04);
  ctx.strokeStyle = rgba(ASHEN_FX.ember, (0.6 + (still ? 0 : 0.2 * Math.sin(t * 11))) * k);
  ctx.setLineDash([r * 0.06, r * 0.08]);
  ctx.beginPath(); ctx.ellipse(x, y, r, r * ry, 0, 0, TAU); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}
