// The territory pattern overlay (PLAN-PHASE14 §14B.1): stripes, dots or cross-hatch per faction over its land, so ownership never rests on colour
// alone. Drawn by territory.js inside each owned tile's top face, anchored to the world plane (canvas px relative to world (0,0), lifted with
// the tile's elevation), so a pattern runs on unbroken from tile to tile. Baked into the terrain chunks like the tint.
import { hexPath } from './tiles.js';
import { PATTERN_LOOK } from '../config/palettes.js';

const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
};

/** The ink a pattern uses over a faction's land: its dark variant, or its light one when the faction is itself dark. */
export function patternInk(f) {
  if (!f) return null;
  const dark = lum(f.color) < 0.28;
  return { color: dark ? f.colorLight : f.colorDark, alpha: dark ? PATTERN_LOOK.lightAlpha : PATTERN_LOOK.alpha };
}

/**
 * Draws `kind` inside the hex top face centred at (cx, topY), radius s px.
 * @param {number} ox @param {number} oy canvas px of world (0, 0); `lift` px the tile's top is raised (elevOffset), so the pattern rides on it
 */
export function drawPatternTile(ctx, kind, cx, topY, s, ox, oy, lift, ink) {
  if (!kind || kind === 'none' || !ink) return;
  const sp = Math.max(3, PATTERN_LOOK.spacing * s);
  const x0 = cx - s; const x1 = cx + s; const y0 = topY - s; const y1 = topY + s;
  // pattern space: u, v relative to the world origin, v measured on the un-lifted plane
  const u = (x) => x - ox;
  const v = (y) => y - oy + lift;
  ctx.save();
  hexPath(ctx, cx, topY, s);
  ctx.clip();
  ctx.globalAlpha = ink.alpha;
  ctx.strokeStyle = ink.color;
  ctx.fillStyle = ink.color;
  ctx.lineWidth = Math.max(1, PATTERN_LOOK.lineWidth * s);
  ctx.beginPath();
  const lines = (dir) => {
    // dir: 'h' v = c; 'v' u = c; 'd' u + v = c (/); 'b' u - v = c (\)
    if (dir === 'h') for (let c = Math.floor(v(y0) / sp) * sp; c <= v(y1); c += sp) { const y = c + oy - lift; ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    if (dir === 'v') for (let c = Math.floor(u(x0) / sp) * sp; c <= u(x1); c += sp) { const x = c + ox; ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    if (dir === 'd') {
      for (let c = Math.floor((u(x0) + v(y0)) / sp) * sp; c <= u(x1) + v(y1); c += sp) {
        ctx.moveTo(c - v(y0) + ox, y0); ctx.lineTo(c - v(y1) + ox, y1);
      }
    }
    if (dir === 'b') {
      for (let c = Math.floor((u(x0) - v(y1)) / sp) * sp; c <= u(x1) - v(y0); c += sp) {
        ctx.moveTo(c + v(y0) + ox, y0); ctx.lineTo(c + v(y1) + ox, y1);
      }
    }
  };
  if (kind === 'stripes') lines('d');
  else if (kind === 'backstripes') lines('b');
  else if (kind === 'hlines') lines('h');
  else if (kind === 'vlines') lines('v');
  else if (kind === 'crosshatch') { lines('d'); lines('b'); }
  else if (kind === 'grid') { lines('h'); lines('v'); }
  if (kind === 'dots') {
    const r = Math.max(1, PATTERN_LOOK.dotRadius * s);
    for (let j = Math.floor(v(y0) / sp); j * sp <= v(y1); j++) {
      const off = (j & 1) * sp / 2;
      for (let i = Math.floor((u(x0) - off) / sp); i * sp + off <= u(x1); i++) {
        const x = i * sp + off + ox; const y = j * sp + oy - lift;
        ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  } else {
    ctx.stroke();
  }
  ctx.restore();
}
