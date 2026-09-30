// The ART of the living map's sprites (DESIGN §7.7): caravan carts, windmill rotor, sailboats, smoke puffs
// and plumes. Pure drawing + `build*` functions that bake one sprite into a canvas; the per-bucket cache
// and the frame budget live in ambientSprites.js. Browser only (canvases); tests inject a fake canvas
// with `setCanvasFactory`.
//
// Coordinates inside the drawing functions are WORLD UNITS times `u`, the bake's device px per
// world unit (a bucket), so the art scales exactly with the map. Side view, light from the upper
// left, flat fills with one darker half, like game/render/sprites-buildings.js.
import { AMBIENT } from '../config/ambient.js';
import { factionColor, factionColorDark, factionColorLight, shade, rgba } from './palette.js';

let makeCanvas = (w, h) => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

/** Tests (no canvas in Node) replace the canvas factory: `(w, h) => ({ width, height, getContext })`. */
export function setCanvasFactory(fn) {
  makeCanvas = fn;
}

export function newSprite(w, h) {
  const width = Math.max(2, Math.ceil(w));
  const height = Math.max(2, Math.ceil(h));
  const canvas = makeCanvas(width, height);
  return { canvas, ctx: canvas.getContext('2d'), w: width, h: height };
}

// ------------------------------------------------------------------- cart

const CART_LAYOUT_W = 0.64; // extent of the drawn train in layout units

function line(ctx, x1, y1, x2, y2, w, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function ellipse(ctx, x, y, rx, ry, color, rot = 0) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  ctx.fill();
}

function softShadow(ctx, x, y, rx, ry, alpha) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(5,8,6,${alpha})`);
  g.addColorStop(1, 'rgba(5,8,6,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * One frame of the cart facing right: a draught ox pulling a two-wheeled cart under a cloth in the
 * player colour, with a little pennant. `frame` 0/1 swaps the legs and turns the wheel a notch.
 * The sprite origin (0, 0) is the ground contact at the middle of the train.
 */
function drawCart(ctx, ox, oy, u, frame, colors, empty) {
  const X = (x) => ox + x * u;
  const Y = (y) => oy + y * u;
  const hide = '#94623f';
  softShadow(ctx, X(0.02), Y(0.004), 0.36 * u, 0.062 * u, 0.32);

  // Legs (behind the body), swapping with the frame.
  const legW = 0.03 * u;
  const dark = shade(hide, -0.45);
  const a = frame ? 0.02 : -0.02;
  line(ctx, X(0.11), Y(-0.07), X(0.11 + a), Y(0), legW, dark);
  line(ctx, X(0.14), Y(-0.07), X(0.14 - a), Y(0), legW, shade(hide, -0.3));
  line(ctx, X(0.24), Y(-0.07), X(0.24 - a), Y(0), legW, dark);
  line(ctx, X(0.27), Y(-0.07), X(0.27 + a), Y(0), legW, shade(hide, -0.3));
  // Body, neck, head.
  ellipse(ctx, X(0.19), Y(-0.108), 0.112 * u, 0.064 * u, hide);
  ellipse(ctx, X(0.2), Y(-0.078), 0.095 * u, 0.03 * u, shade(hide, -0.22));
  ellipse(ctx, X(0.16), Y(-0.13), 0.05 * u, 0.026 * u, shade(hide, 0.16), -0.2);
  ellipse(ctx, X(0.285), Y(-0.128), 0.05 * u, 0.034 * u, shade(hide, 0.05), 0.3);
  ellipse(ctx, X(0.315), Y(-0.116), 0.022 * u, 0.017 * u, '#c9a17b');
  ctx.fillStyle = '#f1e6cf';
  ctx.beginPath();
  ctx.moveTo(X(0.265), Y(-0.15));
  ctx.lineTo(X(0.27), Y(-0.19));
  ctx.lineTo(X(0.29), Y(-0.15));
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#20160e';
  ctx.beginPath();
  ctx.arc(X(0.293), Y(-0.137), 0.007 * u, 0, Math.PI * 2);
  ctx.fill();
  line(ctx, X(0.078), Y(-0.118), X(0.04), Y(-0.09 + (frame ? 0.01 : -0.01)), 0.012 * u, dark);
  // Yoke pole to the cart.
  line(ctx, X(0.1), Y(-0.1), X(-0.02), Y(-0.085), 0.016 * u, '#6b4a2c');

  // Cart box.
  ctx.fillStyle = '#9b6c40';
  ctx.fillRect(X(-0.285), Y(-0.158), 0.31 * u, 0.086 * u);
  ctx.fillStyle = shade('#9b6c40', -0.24);
  ctx.fillRect(X(-0.285), Y(-0.09), 0.31 * u, 0.02 * u);
  ctx.fillStyle = shade('#9b6c40', 0.22);
  ctx.fillRect(X(-0.285), Y(-0.158), 0.31 * u, 0.014 * u);
  if (empty) {
    // Empty return cart: an open bed (the far wall's inner face shows above the near wall), end boards,
    // a rope coil and a single loose sack; no cloth, no pennant.
    ctx.fillStyle = shade('#9b6c40', -0.42);
    ctx.fillRect(X(-0.28), Y(-0.205), 0.3 * u, 0.05 * u);
    ctx.fillStyle = shade('#9b6c40', -0.12);
    ctx.fillRect(X(-0.285), Y(-0.215), 0.014 * u, 0.145 * u);
    ctx.fillRect(X(0.012), Y(-0.215), 0.014 * u, 0.145 * u);
    ctx.fillStyle = shade('#9b6c40', 0.25);
    ctx.fillRect(X(-0.285), Y(-0.216), 0.31 * u, 0.012 * u);
    ctx.strokeStyle = '#d8c9a3';
    ctx.lineWidth = Math.max(1, 0.014 * u);
    ctx.beginPath();
    ctx.arc(X(-0.05), Y(-0.19), 0.028 * u, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#cdbb8e';
    ctx.beginPath();
    ctx.ellipse(X(-0.21), Y(-0.19), 0.05 * u, 0.028 * u, 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shade('#cdbb8e', -0.22);
    ctx.beginPath();
    ctx.ellipse(X(-0.195), Y(-0.183), 0.032 * u, 0.018 * u, 0.15, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Load under a cloth in the player colour.
    ctx.fillStyle = colors.cloth;
    ctx.beginPath();
    ctx.moveTo(X(-0.28), Y(-0.15));
    ctx.quadraticCurveTo(X(-0.27), Y(-0.33), X(-0.13), Y(-0.325));
    ctx.quadraticCurveTo(X(0.0), Y(-0.32), X(0.02), Y(-0.15));
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = rgba(colors.dark, 0.7);
    ctx.beginPath();
    ctx.moveTo(X(-0.12), Y(-0.325));
    ctx.quadraticCurveTo(X(0.0), Y(-0.32), X(0.02), Y(-0.15));
    ctx.lineTo(X(-0.07), Y(-0.15));
    ctx.quadraticCurveTo(X(-0.06), Y(-0.24), X(-0.12), Y(-0.325));
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = rgba(colors.light, 0.55);
    ctx.beginPath();
    ctx.ellipse(X(-0.2), Y(-0.245), 0.05 * u, 0.028 * u, -0.55, 0, Math.PI * 2);
    ctx.fill();
    line(ctx, X(-0.19), Y(-0.31), X(-0.185), Y(-0.15), 0.011 * u, rgba('#f3ead7', 0.8));
    line(ctx, X(-0.06), Y(-0.31), X(-0.05), Y(-0.15), 0.011 * u, rgba('#f3ead7', 0.8));
    // Pennant.
    line(ctx, X(-0.275), Y(-0.16), X(-0.275), Y(-0.38), 0.014 * u, '#5a3d24');
    ctx.fillStyle = colors.cloth;
    ctx.beginPath();
    ctx.moveTo(X(-0.275), Y(-0.38));
    ctx.quadraticCurveTo(X(-0.32), Y(-0.385), X(-0.365), Y(-0.355));
    ctx.quadraticCurveTo(X(-0.32), Y(-0.34), X(-0.275), Y(-0.335));
    ctx.closePath();
    ctx.fill();

  }

  // Wheel, turning a notch per frame.
  const wx = X(-0.11);
  const wy = Y(-0.058);
  const wr = 0.064 * u;
  ctx.fillStyle = '#33261a';
  ctx.beginPath();
  ctx.arc(wx, wy, wr, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#b08350';
  ctx.beginPath();
  ctx.arc(wx, wy, wr * 0.74, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#4a3320';
  ctx.lineWidth = Math.max(1, 0.012 * u);
  const rot = frame ? 0.4 : 0;
  for (let k = 0; k < 3; k++) {
    const ang = rot + (k * Math.PI) / 3;
    ctx.beginPath();
    ctx.moveTo(wx - Math.cos(ang) * wr * 0.74, wy - Math.sin(ang) * wr * 0.74);
    ctx.lineTo(wx + Math.cos(ang) * wr * 0.74, wy + Math.sin(ang) * wr * 0.74);
    ctx.stroke();
  }
  ctx.fillStyle = '#33261a';
  ctx.beginPath();
  ctx.arc(wx, wy, wr * 0.2, 0, Math.PI * 2);
  ctx.fill();
}

// A faint trail of dust puffs behind the cart (baked into the sprite, drawn facing right).
function drawDust(ctx, ox, oy, u) {
  const D = AMBIENT.caravans.dust;
  for (let j = 1; j <= D.puffs; j++) {
    const x = ox - (0.3 + j * D.spacing * 0.9) * u;
    const y = oy - (0.03 + j * 0.018) * u;
    const r = D.radius * (0.7 + 0.32 * j) * u;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const al = D.alpha * (1 - (j - 1) / (D.puffs + 0.5));
    g.addColorStop(0, `rgba(214,190,138,${al})`);
    g.addColorStop(1, 'rgba(214,190,138,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Tilt steps the cart sprite is baked at: index -3..3 -> index * maxTilt / 3 radians. */
export const CART_TILT_STEPS = 3;

// The sprite is baked already tilted and mirrored, so a cart costs one blit per frame.
export function buildCart(bucket, frame, tiltIdx, left, dust, empty) {
  const C = AMBIENT.caravans;
  const u = bucket * (C.length / CART_LAYOUT_W);
  const w = 1.7 * u;
  const h = 1.25 * u;
  const spr = newSprite(w, h);
  const ox = spr.w * 0.62;
  const oy = spr.h * 0.78;
  const colors = { cloth: factionColor(0), dark: factionColorDark(0), light: factionColorLight(0) };
  const ctx = spr.ctx;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.rotate((tiltIdx * C.maxTilt) / CART_TILT_STEPS);
  if (left) ctx.scale(-1, 1);
  if (dust) drawDust(ctx, 0, 0, u);
  drawCart(ctx, 0, 0, u, frame, colors, !!empty);
  ctx.restore();
  return { canvas: spr.canvas, w: spr.w, h: spr.h, ox, oy, bucket, worldW: spr.w / bucket };
}

// ------------------------------------------------------------------- sails

function drawSails(ctx, cx, cy, u, len) {
  const L = len * u;
  for (let arm = 0; arm < 4; arm++) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((arm * Math.PI) / 2);
    // Soft dark outline: the shapes below cast a tight, unoffset shadow, so the sails hold their shape
    // against pale ground and against the tower behind them.
    ctx.shadowColor = 'rgba(26,18,10,0.6)';
    ctx.shadowBlur = Math.max(2, 0.045 * u);
    ctx.fillStyle = '#5a3d24';
    ctx.fillRect(0.03 * u, -0.026 * u, L - 0.03 * u, 0.052 * u);
    // Lattice sail on one side of the arm: light cloth, darker frame, crossbars.
    const x0 = 0.17 * u;
    const x1 = L - 0.02 * u;
    const y0 = 0.026 * u;
    const y1 = 0.25 * u;
    ctx.fillStyle = 'rgba(244,236,214,0.97)';
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.fillStyle = rgba('#8b6a45', 0.18);
    ctx.fillRect(x0 + (x1 - x0) * 0.5, y0, x1 - x0 - (x1 - x0) * 0.5, y1 - y0);
    ctx.strokeStyle = rgba('#5a3d24', 0.95);
    ctx.lineWidth = Math.max(1.4, 0.03 * u);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.lineWidth = Math.max(1, 0.015 * u);
    ctx.strokeStyle = rgba('#5a3d24', 0.7);
    for (let k = 1; k < 4; k++) {
      const x = x0 + ((x1 - x0) * k) / 4;
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(x0, (y0 + y1) / 2);
    ctx.lineTo(x1, (y0 + y1) / 2);
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = '#4a3320';
  ctx.beginPath();
  ctx.arc(cx, cy, 0.062 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = rgba('#d8b98a', 0.7);
  ctx.beginPath();
  ctx.arc(cx - 0.014 * u, cy - 0.014 * u, 0.022 * u, 0, Math.PI * 2);
  ctx.fill();
}

// A strip of `frames` rotor frames covering a quarter turn (four identical arms), so drawing the
// turning sails is an axis-aligned blit of one frame instead of a rotated bilinear blit.
export function buildSails(bucket) {
  const len = AMBIENT.windmill.sailLen;
  const frames = AMBIENT.windmill.frames;
  const u = bucket;
  const size = Math.ceil(2 * (len + 0.06) * u);
  const spr = newSprite(size * frames, size);
  for (let k = 0; k < frames; k++) {
    const ctx = spr.ctx;
    ctx.save();
    ctx.translate(k * size + size / 2, size / 2);
    ctx.rotate((k / frames) * (Math.PI / 2));
    drawSails(ctx, 0, 0, u, len);
    ctx.restore();
  }
  return { canvas: spr.canvas, fw: size, fh: size, frames, cx: size / 2, cy: size / 2, bucket };
}

// ------------------------------------------------------------------- boat

function drawBoat(ctx, ox, oy, u, sail) {
  const X = (x) => ox + x * u;
  const Y = (y) => oy + y * u;
  softShadow(ctx, X(0.0), Y(0.045), 0.3 * u, 0.045 * u, 0.22);
  // Hull.
  ctx.fillStyle = AMBIENT.boats.hull;
  ctx.beginPath();
  ctx.moveTo(X(-0.25), Y(-0.06));
  ctx.quadraticCurveTo(X(-0.16), Y(0.045), X(0.02), Y(0.05));
  ctx.quadraticCurveTo(X(0.2), Y(0.045), X(0.27), Y(-0.105));
  ctx.quadraticCurveTo(X(0.0), Y(-0.06), X(-0.25), Y(-0.06));
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = shade(AMBIENT.boats.hull, -0.3);
  ctx.beginPath();
  ctx.moveTo(X(-0.2), Y(0.0));
  ctx.quadraticCurveTo(X(-0.1), Y(0.05), X(0.02), Y(0.05));
  ctx.quadraticCurveTo(X(0.2), Y(0.045), X(0.245), Y(-0.03));
  ctx.quadraticCurveTo(X(0.0), Y(0.0), X(-0.2), Y(0.0));
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = shade(AMBIENT.boats.hull, 0.3);
  ctx.lineWidth = Math.max(1, 0.014 * u);
  ctx.beginPath();
  ctx.moveTo(X(-0.25), Y(-0.06));
  ctx.quadraticCurveTo(X(0.0), Y(-0.06), X(0.27), Y(-0.105));
  ctx.stroke();
  // Mast, sails, pennant.
  line(ctx, X(0.0), Y(-0.06), X(0.0), Y(-0.55), 0.02 * u, '#5a3d24');
  ctx.fillStyle = sail.main;
  ctx.beginPath();
  ctx.moveTo(X(-0.012), Y(-0.52));
  ctx.quadraticCurveTo(X(0.16), Y(-0.3), X(0.19), Y(-0.13));
  ctx.lineTo(X(-0.012), Y(-0.13));
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = sail.shade;
  ctx.beginPath();
  ctx.moveTo(X(0.06), Y(-0.4));
  ctx.quadraticCurveTo(X(0.16), Y(-0.3), X(0.19), Y(-0.13));
  ctx.lineTo(X(0.05), Y(-0.13));
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = sail.jib;
  ctx.beginPath();
  ctx.moveTo(X(0.012), Y(-0.5));
  ctx.quadraticCurveTo(X(0.13), Y(-0.34), X(0.255), Y(-0.115));
  ctx.lineTo(X(0.012), Y(-0.13));
  ctx.closePath();
  ctx.fill();
  line(ctx, X(-0.03), Y(-0.125), X(0.2), Y(-0.125), 0.014 * u, '#5a3d24');
  ctx.fillStyle = sail.flag;
  ctx.beginPath();
  ctx.moveTo(X(0.0), Y(-0.55));
  ctx.lineTo(X(-0.085), Y(-0.525));
  ctx.lineTo(X(0.0), Y(-0.5));
  ctx.closePath();
  ctx.fill();
}

export function buildBoat(bucket, variant) {
  const u = bucket * (AMBIENT.boats.length / 0.52);
  const spr = newSprite(0.74 * u, 0.74 * u);
  const owner = variant === 0;
  const main = owner ? '#f3ead7' : AMBIENT.boats.otherSail;
  const sail = owner
    ? { main: shade(factionColor(0), 0.14), shade: factionColor(0), jib: factionColorLight(0), flag: '#f3ead7' }
    : { main, shade: shade(main, -0.14), jib: shade(main, 0.03), flag: '#c9564a' };
  drawBoat(spr.ctx, spr.w * 0.5, spr.h * 0.72, u, sail);
  return { canvas: spr.canvas, w: spr.w, h: spr.h, ox: spr.w * 0.5, oy: spr.h * 0.72, bucket };
}

// ------------------------------------------------------------------- puffs

const PUFF = 64;

// A soft, rim-less blob (a few overlapping gaussian-ish lobes): the building block of a smoke wisp.
export function buildPuff(rgb, variant) {
  const spr = newSprite(PUFF, PUFF);
  const ctx = spr.ctx;
  const blobs = [
    [[0.5, 0.5, 0.46], [0.4, 0.55, 0.3], [0.62, 0.45, 0.28]],
    [[0.5, 0.5, 0.45], [0.6, 0.58, 0.29], [0.4, 0.42, 0.29]],
    [[0.5, 0.52, 0.44], [0.36, 0.44, 0.31], [0.64, 0.56, 0.26]],
    [[0.5, 0.5, 0.46], [0.56, 0.38, 0.28], [0.44, 0.62, 0.28]],
  ][variant % 4];
  for (const [bx, by, br] of blobs) {
    const g = ctx.createRadialGradient(bx * PUFF, by * PUFF, 0, bx * PUFF, by * PUFF, br * PUFF);
    g.addColorStop(0, `rgba(${rgb},0.9)`);
    g.addColorStop(0.3, `rgba(${rgb},0.62)`);
    g.addColorStop(0.62, `rgba(${rgb},0.2)`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, PUFF, PUFF);
  }
  return { canvas: spr.canvas, size: PUFF };
}

// ------------------------------------------------------------------- smoke wisps

// One chimney's whole wisp as a looping strip of frames (a chimney costs ONE blit per frame). The
// wisp is a stream of `count` soft, elongated puffs that leave the chimney thin and fresh (a little
// greyer), swell as they rise, lean into the wind, wander a little and fade to nothing: a tapering
// column rather than a chain of bubbles. Puff `i` sits at life fraction u = fract(T - i/count); the
// per-puff wander is a function of the puff's index, so the pattern repeats after ONE FULL LIFE and
// the strip's `frames` frames cover exactly that, looping seamlessly.
export function buildPlume(bucket, variant, count, light, dark) {
  const S = AMBIENT.smoke;
  const u = bucket;
  const x0 = -S.radius1 * 1.4 - 0.02;
  const x1 = S.drift + S.wobble + S.radius1 * 1.4 + 0.02;
  const yTop = -(S.rise * 0.86 + S.radius1 * 1.4 + 0.02);
  const yBot = S.radius0 + 0.03;
  const fw = Math.ceil((x1 - x0) * u);
  const fh = Math.ceil((yBot - yTop) * u);
  const F = S.frames;
  const spr = newSprite(fw * F, fh);
  const ctx = spr.ctx;
  const seed = variant * 2.3 + 0.7;
  const smooth = (e0, e1, v) => { const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  for (let k = 0; k < F; k++) {
    const T = k / F;
    for (let i = 0; i < count; i++) {
      const life = (T - i / count) - Math.floor(T - i / count);
      // Per-puff wander (index based, small): each puff drifts a little differently.
      const wander = Math.sin(i * 12.9898 + seed * 3.1) * 0.5 + Math.sin(i * 4.1 + seed) * 0.5;
      const sway = Math.sin(life * 6.6 + seed) * S.wobble * (0.3 + life) + wander * 0.035 * life;
      const x = S.drift * Math.pow(life, 1.15) + sway;
      const y = -S.rise * (1.05 * life - 0.2 * life * life);
      const r = S.radius0 + (S.radius1 - S.radius0) * Math.pow(life, 0.8) * (0.9 + wander * 0.12);
      const alpha = S.alpha * Math.pow(1 - life, 1.35) * smooth(0, 0.12, life);
      if (alpha < 0.008) continue;
      // Elongate along the local direction of travel.
      const dx = S.drift * 1.15 * Math.pow(Math.max(life, 0.05), 0.15) + Math.cos(life * 6.6 + seed) * 6.6 * S.wobble * (0.3 + life);
      const dy = -S.rise * (1.05 - 0.4 * life);
      const ang = Math.atan2(dy, dx);
      const fresh = 1 - smooth(0.05, 0.55, life); // young smoke is a touch greyer
      const px = k * fw + (x - x0) * u;
      const py = (y - yTop) * u;
      const rr = r * u;
      // rotate(ang) then scale(1.55, 1) as ONE matrix (no save/restore: this loop runs ~560 times per strip)
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      ctx.setTransform(ca * 1.55, sa * 1.55, -sa, ca, px, py);
      const sprIdx = (i + variant) & 3;
      if (fresh > 0.02) {
        ctx.globalAlpha = alpha * fresh;
        ctx.drawImage(dark[sprIdx].canvas, -rr, -rr, rr * 2, rr * 2);
      }
      if (fresh < 0.98) {
        ctx.globalAlpha = alpha * (1 - fresh);
        ctx.drawImage(light[sprIdx].canvas, -rr, -rr, rr * 2, rr * 2);
      }
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  // (ax, ay): where the chimney mouth sits inside one frame.
  return { canvas: spr.canvas, fw, fh, frames: F, ax: -x0 * u, ay: -yTop * u, count, bucket };
}
