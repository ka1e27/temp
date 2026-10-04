// Settlement building shapes (DESIGN §7.2): cottages, well, bell tower,
// stone fort/tower/keep, tents. Split out of sprites.js purely to keep files
// under ARCHITECTURE's ~500-line guideline — `buildSettlement` is the only
// export, called from sprites.js's `drawSettlement`; nothing outside
// game/render/ should ever import this file directly.

import { shade, rgba } from './palette.js';

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

const WALL_COLOR = '#ece0c4';
const STONE_LIGHT = '#b7b2a6';
const STONE_DARK = shade(STONE_LIGHT, -0.34);
const STONE_LIGHTER = shade(STONE_LIGHT, 0.16);
const TENT_COLOR = '#d8c9a3';

function windowSlit(ctx, x, y, w, h, alpha) {
  ctx.fillStyle = `rgba(22,18,20,${alpha})`;
  roundRect(ctx, x, y, w, h, Math.min(w, h) * 0.4);
  ctx.fill();
}

function mortarCourses(ctx, x, top, w, h, rows) {
  ctx.fillStyle = 'rgba(0,0,0,0.07)';
  for (let c = 1; c < rows; c++) {
    ctx.fillRect(x - w / 2, top + (h / rows) * c, w, Math.max(1, h * 0.018));
  }
}

function cottage(ctx, x, baseY, w, h, wall, roof, detailed) {
  const wallTop = baseY - h;
  ctx.fillStyle = wall;
  ctx.fillRect(x - w / 2, wallTop, w, h);
  ctx.fillStyle = shade(wall, -0.13);
  ctx.fillRect(x + w * 0.14, wallTop, w * 0.36, h);
  const roofH = h * 0.9;
  ctx.fillStyle = roof;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.64, wallTop + h * 0.05);
  ctx.lineTo(x, wallTop - roofH);
  ctx.lineTo(x + w * 0.64, wallTop + h * 0.05);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = shade(roof, -0.24);
  ctx.beginPath();
  ctx.moveTo(x, wallTop - roofH);
  ctx.lineTo(x + w * 0.64, wallTop + h * 0.05);
  ctx.lineTo(x + w * 0.1, wallTop + h * 0.05);
  ctx.closePath();
  ctx.fill();
  if (detailed) {
    const dw = w * 0.24;
    const dh = h * 0.55;
    ctx.fillStyle = shade(wall, -0.4);
    roundRect(ctx, x - dw / 2, baseY - dh, dw, dh, dw * 0.5);
    ctx.fill();
  }
}

function well(ctx, x, baseY, s) {
  const r = s * 0.22;
  ctx.fillStyle = shade(STONE_LIGHT, -0.1);
  ctx.beginPath();
  ctx.ellipse(x, baseY - r * 0.3, r, r * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2c3a3c';
  ctx.beginPath();
  ctx.ellipse(x, baseY - r * 0.42, r * 0.62, r * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#6b5334';
  ctx.lineWidth = Math.max(1, s * 0.05);
  ctx.beginPath();
  ctx.moveTo(x - r * 0.9, baseY - r * 0.3);
  ctx.lineTo(x - r * 0.7, baseY - r * 2.1);
  ctx.moveTo(x + r * 0.9, baseY - r * 0.3);
  ctx.lineTo(x + r * 0.7, baseY - r * 2.1);
  ctx.stroke();
  ctx.fillStyle = shade('#6b5334', 0.15);
  ctx.beginPath();
  ctx.moveTo(x - r * 1.05, baseY - r * 2.05);
  ctx.lineTo(x, baseY - r * 2.55);
  ctx.lineTo(x + r * 1.05, baseY - r * 2.05);
  ctx.closePath();
  ctx.fill();
}

// Taller, higher-contrast crenellations with a shadowed groove just below the
// tooth line — flat same-tone teeth were reading as a fuzzy edge rather than
// a castle silhouette.
function crenellations(ctx, x, topY, w, teeth) {
  const tw = w / (teeth * 2);
  const th = tw * 1.4;
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(x - w / 2, topY - th * 0.1, w, th * 0.32);
  for (let i = 0; i < teeth; i++) {
    const tx = x - w / 2 + tw * (2 * i);
    ctx.fillStyle = shade(STONE_LIGHT, -0.14);
    ctx.fillRect(tx, topY - th, tw, th);
    ctx.fillStyle = STONE_LIGHTER;
    ctx.fillRect(tx, topY - th, tw, th * 0.3);
  }
}

function stoneTower(ctx, x, baseY, w, h, opts = {}) {
  const top = baseY - h;
  ctx.fillStyle = STONE_LIGHT;
  ctx.fillRect(x - w / 2, top, w, h);
  ctx.fillStyle = STONE_DARK;
  ctx.fillRect(x + w * 0.06, top, w * 0.44, h);
  mortarCourses(ctx, x, top, w, h, opts.rows ? opts.rows + 1 : 3);
  crenellations(ctx, x, top, w * 1.05, opts.teeth || 4);
  const rows = opts.rows ?? 2;
  for (let row = 0; row < rows; row++) {
    windowSlit(ctx, x - w * 0.14, top + h * (0.3 + row * (0.5 / rows)), w * 0.28, h * 0.16, 0.34);
  }
}

function tent(ctx, x, baseY, w, h, trim) {
  ctx.fillStyle = TENT_COLOR;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, baseY);
  ctx.lineTo(x, baseY - h);
  ctx.lineTo(x + w / 2, baseY);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = shade(TENT_COLOR, -0.2);
  ctx.beginPath();
  ctx.moveTo(x, baseY - h);
  ctx.lineTo(x + w / 2, baseY);
  ctx.lineTo(x + w * 0.12, baseY);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = trim;
  ctx.lineWidth = Math.max(1, w * 0.05);
  ctx.beginPath();
  ctx.moveTo(x, baseY - h);
  ctx.lineTo(x, baseY);
  ctx.stroke();
}

const SETTLEMENT_BUILDERS = {
  hamlet(ctx, cx, baseY, s, wall, roof) {
    cottage(ctx, cx - s * 0.34, baseY, s * 0.56, s * 0.4, wall, roof, s >= 24);
    cottage(ctx, cx + s * 0.3, baseY - s * 0.03, s * 0.5, s * 0.36, shade(wall, -0.04), shade(roof, -0.05), s >= 24);
  },
  village(ctx, cx, baseY, s, wall, roof) {
    cottage(ctx, cx - s * 0.5, baseY + s * 0.02, s * 0.5, s * 0.36, wall, roof, s >= 24);
    cottage(ctx, cx + s * 0.16, baseY - s * 0.04, s * 0.58, s * 0.42, shade(wall, -0.03), shade(roof, 0.04), s >= 24);
    if (s >= 20) well(ctx, cx + s * 0.62, baseY + s * 0.05, s);
    cottage(ctx, cx - s * 0.02, baseY + s * 0.14, s * 0.4, s * 0.3, shade(wall, -0.06), shade(roof, -0.1), false);
  },
  town(ctx, cx, baseY, s, wall, roof) {
    cottage(ctx, cx - s * 0.72, baseY + s * 0.06, s * 0.46, s * 0.32, wall, roof, s >= 24);
    cottage(ctx, cx - s * 0.24, baseY + s * 0.1, s * 0.5, s * 0.34, shade(wall, -0.03), shade(roof, 0.03), s >= 24);
    cottage(ctx, cx + s * 0.62, baseY + s * 0.08, s * 0.48, s * 0.33, shade(wall, -0.05), shade(roof, -0.04), s >= 24);
    cottage(ctx, cx + 0.14 * s, baseY - s * 0.02, s * 0.4, s * 0.28, shade(wall, -0.02), shade(roof, -0.08), false);
    // bell tower
    const bw = s * 0.42;
    const bh = s * 1.0;
    const top = baseY - bh;
    ctx.fillStyle = shade(wall, -0.08);
    ctx.fillRect(cx - bw / 2, top, bw, bh);
    ctx.fillStyle = shade(wall, -0.22);
    ctx.fillRect(cx + bw * 0.05, top, bw * 0.4, bh);
    ctx.fillStyle = shade(roof, -0.1);
    ctx.beginPath();
    ctx.moveTo(cx - bw * 0.62, top);
    ctx.lineTo(cx, top - bw * 0.95);
    ctx.lineTo(cx + bw * 0.62, top);
    ctx.closePath();
    ctx.fill();
    if (s >= 20) {
      ctx.fillStyle = rgba('#20222c', 0.6);
      ctx.beginPath();
      ctx.ellipse(cx, top + bh * 0.32, bw * 0.16, bw * 0.22, 0, Math.PI, 0);
      ctx.fill();
    }
  },
  fort(ctx, cx, baseY, s, _wall, _roof) {
    const w = s * 1.5;
    const h = s * 0.64;
    const top = baseY - h;
    ctx.fillStyle = STONE_LIGHT;
    ctx.fillRect(cx - w / 2, top, w, h);
    ctx.fillStyle = STONE_DARK;
    ctx.fillRect(cx + w * 0.02, top, w * 0.42, h);
    mortarCourses(ctx, cx, top, w, h, 3);
    crenellations(ctx, cx, top, w, 7);
    // Arched gate, sunk into shadow, with a sliver of warm torchlight.
    ctx.fillStyle = 'rgba(18,14,16,0.55)';
    roundRect(ctx, cx - s * 0.13, top + h * 0.28, s * 0.26, h * 0.72, s * 0.13);
    ctx.fill();
    ctx.fillStyle = 'rgba(247,196,81,0.55)';
    ctx.beginPath();
    ctx.arc(cx, top + h * 0.42, s * 0.04, 0, Math.PI * 2);
    ctx.fill();
    stoneTower(ctx, cx - w / 2, baseY + s * 0.02, s * 0.42, s * 0.98, { teeth: 3, rows: 1 });
    stoneTower(ctx, cx + w / 2, baseY + s * 0.02, s * 0.42, s * 0.98, { teeth: 3, rows: 1 });
  },
  tower(ctx, cx, baseY, s) {
    stoneTower(ctx, cx, baseY, s * 0.62, s * 1.55, { teeth: 4, rows: 2 });
  },
  keep(ctx, cx, baseY, s, _wall, _roof) {
    const w = s * 1.3;
    const h = s * 0.78;
    const top = baseY - h;
    ctx.fillStyle = STONE_LIGHT;
    ctx.fillRect(cx - w / 2, top, w, h);
    ctx.fillStyle = STONE_DARK;
    ctx.fillRect(cx + w * 0.04, top, w * 0.44, h);
    mortarCourses(ctx, cx, top, w, h, 3);
    crenellations(ctx, cx, top, w * 1.05, 6);
    ctx.fillStyle = 'rgba(18,14,16,0.6)';
    roundRect(ctx, cx - s * 0.15, top + h * 0.3, s * 0.3, h * 0.7, s * 0.15);
    ctx.fill();
    const glow = ctx.createRadialGradient(cx, top + h * 0.62, 0, cx, top + h * 0.62, s * 0.22);
    glow.addColorStop(0, 'rgba(247,196,81,0.5)');
    glow.addColorStop(1, 'rgba(247,196,81,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, top + h * 0.62, s * 0.22, 0, Math.PI * 2);
    ctx.fill();
    stoneTower(ctx, cx - w * 0.46, baseY + s * 0.03, s * 0.46, s * 1.2, { teeth: 3, rows: 2 });
    stoneTower(ctx, cx + w * 0.46, baseY + s * 0.03, s * 0.46, s * 1.2, { teeth: 3, rows: 2 });
  },
  // --- A varied map's feature sites (DESIGN 10.13) ---
  // Bandit Camp: a sharpened palisade round two dark hide tents, a skull post at the gate
  bandit(ctx, cx, baseY, s) {
    tent(ctx, cx - s * 0.36, baseY - s * 0.06, s * 0.62, s * 0.58, '#5a2a22');
    tent(ctx, cx + s * 0.34, baseY - s * 0.04, s * 0.56, s * 0.5, '#5a2a22');
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#3a2418';
    ctx.beginPath(); ctx.moveTo(cx - s * 0.67, baseY - s * 0.06); ctx.lineTo(cx - s * 0.36, baseY - s * 0.64); ctx.lineTo(cx - s * 0.05, baseY - s * 0.06); ctx.closePath(); ctx.fill();
    ctx.restore();
    // the palisade: a row of pointed stakes across the front
    const n = 9;
    const w = s * 1.6;
    for (let i = 0; i < n; i++) {
      const x = cx - w / 2 + (w / (n - 1)) * i;
      const hgt = s * (0.36 + ((i * 37) % 5) * 0.025);
      ctx.fillStyle = i % 2 ? '#7a5534' : '#8f6640';
      ctx.beginPath();
      ctx.moveTo(x - s * 0.07, baseY + s * 0.12);
      ctx.lineTo(x - s * 0.07, baseY + s * 0.12 - hgt);
      ctx.lineTo(x, baseY + s * 0.12 - hgt - s * 0.1);
      ctx.lineTo(x + s * 0.07, baseY + s * 0.12 - hgt);
      ctx.lineTo(x + s * 0.07, baseY + s * 0.12);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(cx - w / 2 - s * 0.07, baseY + s * 0.02, w + s * 0.14, s * 0.05);
    // a skull on a post
    ctx.fillStyle = '#5b3d24';
    ctx.fillRect(cx - s * 0.03, baseY - s * 0.72, s * 0.06, s * 0.6);
    ctx.fillStyle = '#efe6d0';
    ctx.beginPath(); ctx.arc(cx, baseY - s * 0.76, s * 0.12, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(cx - s * 0.07, baseY - s * 0.7, s * 0.14, s * 0.08);
    ctx.fillStyle = '#1b1414';
    ctx.beginPath(); ctx.arc(cx - s * 0.045, baseY - s * 0.77, s * 0.03, 0, Math.PI * 2); ctx.arc(cx + s * 0.045, baseY - s * 0.77, s * 0.03, 0, Math.PI * 2); ctx.fill();
  },
  // Gate: a gatehouse astride the road, unlike any keep: low curtain walls running out to both sides, a tall arched gateway with a heavy
  // iron portcullis (spiked teeth showing under it), squat flanking towers and two torches
  gate(ctx, cx, baseY, s) {
    for (const side of [-1, 1]) { // the curtain wall wings
      const x0 = cx + side * s * 0.62;
      const x1 = cx + side * s * 1.3;
      const wl = Math.min(x0, x1);
      const ww = Math.abs(x1 - x0);
      const wh = s * 0.46;
      ctx.fillStyle = side < 0 ? STONE_LIGHT : STONE_DARK;
      ctx.fillRect(wl, baseY - wh, ww, wh);
      mortarCourses(ctx, wl + ww / 2, baseY - wh, ww, wh, 2);
      crenellations(ctx, wl + ww / 2, baseY - wh, ww, 3);
    }
    const w = s * 1.0;
    const h = s * 1.05;
    const top = baseY - h;
    ctx.fillStyle = shade(STONE_LIGHT, -0.06);
    ctx.fillRect(cx - w / 2, top, w, h);
    ctx.fillStyle = STONE_DARK;
    ctx.fillRect(cx + w * 0.08, top, w * 0.42, h);
    mortarCourses(ctx, cx, top, w, h, 4);
    crenellations(ctx, cx, top, w * 1.04, 5);
    const aw = s * 0.56; // the gateway: a deep arch and its iron portcullis
    const ah = h * 0.74;
    ctx.fillStyle = 'rgba(12, 9, 10, 0.92)';
    roundRect(ctx, cx - aw / 2, baseY - ah, aw, ah, aw / 2);
    ctx.fill();
    ctx.strokeStyle = '#8e8a80';
    ctx.lineWidth = Math.max(1.2, s * 0.05);
    ctx.beginPath();
    for (let i = 1; i < 5; i++) { const x = cx - aw / 2 + (aw / 5) * i; ctx.moveTo(x, baseY - ah + aw * 0.12); ctx.lineTo(x, baseY - s * 0.1); }
    for (let j = 1; j < 4; j++) { const y = baseY - ah + (ah / 4.2) * j; ctx.moveTo(cx - aw / 2 + s * 0.02, y); ctx.lineTo(cx + aw / 2 - s * 0.02, y); }
    ctx.stroke();
    ctx.fillStyle = '#8e8a80'; // the portcullis teeth
    for (let i = 1; i < 5; i++) { const x = cx - aw / 2 + (aw / 5) * i; ctx.beginPath(); ctx.moveTo(x - s * 0.035, baseY - s * 0.1); ctx.lineTo(x, baseY - s * 0.02); ctx.lineTo(x + s * 0.035, baseY - s * 0.1); ctx.fill(); }
    ctx.strokeStyle = shade(STONE_LIGHT, 0.12); // the arch's rim
    ctx.lineWidth = Math.max(1, s * 0.06);
    ctx.beginPath(); ctx.arc(cx, baseY - ah + aw / 2, aw / 2 + s * 0.03, Math.PI, 0); ctx.stroke();
    for (const side of [-1, 1]) { // torches either side of the gateway
      const tx = cx + side * (aw / 2 + s * 0.1);
      const ty = baseY - ah * 0.62;
      const g = ctx.createRadialGradient(tx, ty, 0, tx, ty, s * 0.16);
      g.addColorStop(0, 'rgba(255, 196, 90, 0.95)');
      g.addColorStop(1, 'rgba(255, 140, 40, 0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(tx, ty, s * 0.16, 0, Math.PI * 2); ctx.fill();
    }
    stoneTower(ctx, cx - w * 0.58, baseY + s * 0.02, s * 0.36, s * 1.22, { teeth: 3, rows: 1 });
    stoneTower(ctx, cx + w * 0.58, baseY + s * 0.02, s * 0.36, s * 1.22, { teeth: 3, rows: 1 });
  },
  // Shrine: a pale standing stone under a small pillared roof, on a stepped plinth, a glowing rune
  shrine(ctx, cx, baseY, s) {
    ctx.fillStyle = shade(STONE_LIGHT, 0.08);
    ctx.fillRect(cx - s * 0.62, baseY - s * 0.1, s * 1.24, s * 0.14);
    ctx.fillStyle = STONE_LIGHT;
    ctx.fillRect(cx - s * 0.48, baseY - s * 0.22, s * 0.96, s * 0.13);
    // two pillars and a roof
    ctx.fillStyle = '#d9d2c2';
    ctx.fillRect(cx - s * 0.42, baseY - s * 0.92, s * 0.12, s * 0.7);
    ctx.fillRect(cx + s * 0.3, baseY - s * 0.92, s * 0.12, s * 0.7);
    ctx.fillStyle = '#6d5a8c';
    ctx.beginPath(); ctx.moveTo(cx - s * 0.6, baseY - s * 0.9); ctx.lineTo(cx, baseY - s * 1.28); ctx.lineTo(cx + s * 0.6, baseY - s * 0.9); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(cx - s * 0.6, baseY - s * 0.92, s * 1.2, s * 0.05);
    // the standing stone with its rune
    ctx.fillStyle = '#ebe6da';
    roundRect(ctx, cx - s * 0.15, baseY - s * 0.74, s * 0.3, s * 0.54, s * 0.12);
    ctx.fill();
    const g = ctx.createRadialGradient(cx, baseY - s * 0.5, 0, cx, baseY - s * 0.5, s * 0.32);
    g.addColorStop(0, 'rgba(199,155,255,0.75)');
    g.addColorStop(1, 'rgba(199,155,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, baseY - s * 0.5, s * 0.32, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#8a5fd0';
    ctx.lineWidth = Math.max(1, s * 0.04);
    ctx.beginPath(); ctx.moveTo(cx, baseY - s * 0.64); ctx.lineTo(cx, baseY - s * 0.32); ctx.moveTo(cx - s * 0.08, baseY - s * 0.54); ctx.lineTo(cx + s * 0.08, baseY - s * 0.44); ctx.stroke();
  },
  // Ancient Tower (the Ruins): a taller, older tower, mossy and cracked, a pale rune glowing in its window
  ancientTower(ctx, cx, baseY, s) {
    const w = s * 0.7;
    const h = s * 1.75;
    stoneTower(ctx, cx, baseY, w, h, { teeth: 4, rows: 2 });
    ctx.fillStyle = 'rgba(86,120,64,0.75)'; // moss at the foot and up one side
    ctx.beginPath(); ctx.moveTo(cx - w / 2, baseY); ctx.quadraticCurveTo(cx - w * 0.3, baseY - h * 0.35, cx - w / 2, baseY - h * 0.55); ctx.lineTo(cx - w / 2, baseY); ctx.fill();
    ctx.fillRect(cx - w / 2, baseY - s * 0.1, w, s * 0.1);
    ctx.strokeStyle = 'rgba(30,24,22,0.6)'; // a crack
    ctx.lineWidth = Math.max(1, s * 0.03);
    ctx.beginPath(); ctx.moveTo(cx + w * 0.3, baseY - h); ctx.lineTo(cx + w * 0.12, baseY - h * 0.78); ctx.lineTo(cx + w * 0.26, baseY - h * 0.62); ctx.stroke();
    const g = ctx.createRadialGradient(cx, baseY - h * 0.72, 0, cx, baseY - h * 0.72, s * 0.28);
    g.addColorStop(0, 'rgba(140,230,255,0.85)');
    g.addColorStop(1, 'rgba(140,230,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, baseY - h * 0.72, s * 0.28, 0, Math.PI * 2); ctx.fill();
  },
  camp(ctx, cx, baseY, s, wall, roof, faction) {
    const trim = faction.color;
    // about a third larger than it was: the first thing a new player looks for is where their troops start
    tent(ctx, cx - s * 0.64, baseY + s * 0.04, s * 0.72, s * 0.64, trim);
    tent(ctx, cx + s * 0.6, baseY + s * 0.03, s * 0.72, s * 0.62, trim);
    tent(ctx, cx, baseY + s * 0.1, s * 0.84, s * 0.8, trim);
    void wall; void roof;
  },
};

/**
 * Draw one settlement's building geometry (no shadow/highlight/selection —
 * those are `drawSettlement`'s job). `baseY` is the ground-contact line.
 * @param {'hamlet'|'village'|'town'|'fort'|'tower'|'keep'|'camp'} type
 */
export function buildSettlement(type, ctx, cx, baseY, s, wall, roof, faction) {
  const builder = SETTLEMENT_BUILDERS[type] || SETTLEMENT_BUILDERS.hamlet;
  builder(ctx, cx, baseY, s, wall, roof, faction);
}
