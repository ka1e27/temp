// Terrain decorations (DESIGN §7.1): trees, mounds, peaks, tufts, reeds.
// Split out of tiles.js purely to keep files under ARCHITECTURE's ~500-line
// guideline — `drawTileDecor` is re-exported from tiles.js unchanged, so
// nothing outside game/render/ should ever import this file directly.

import {
  TERRAIN_COLORS, SNOWCAP_COLOR, ROCK_GREY, shade, mix, rgba,
} from './palette.js';

/** @typedef {import('./tiles.js').Tile} Tile */

// elevOffset is duplicated here (tiny, 5 lines) rather than imported from
// tiles.js, so this file and tiles.js don't form an import cycle (tiles.js
// imports `drawTileDecor` from here).
const ELEV_SKIRT_FRAC = [0, 0.22, 0.34, 0.5];
function elevOffset(tile, s) {
  const lvl = tile && Number.isFinite(tile.elev) ? tile.elev : 0;
  return (ELEV_SKIRT_FRAC[lvl] ?? ELEV_SKIRT_FRAC[1]) * s;
}

// Deterministic RNG derived from the tile's own identity (`i`, `jitter`) so
// decorations never re-roll or swim between frames without needing external
// state. mulberry32: tiny, fast, good enough distribution for placement noise.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rngForTile(tile, salt) {
  const i = tile && Number.isFinite(tile.i) ? tile.i : 0;
  const j = tile && typeof tile.jitter === 'number' ? tile.jitter : 0.5;
  const seed = ((i * 2654435761) ^ Math.floor(j * 1e6) ^ ((salt || 0) * 40503)) >>> 0;
  return mulberry32(seed);
}

function contactShadow(ctx, x, y, rx, ry, alpha) {
  if (rx <= 0 || ry <= 0) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(8,14,10,${alpha})`);
  g.addColorStop(1, 'rgba(8,14,10,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// A round deciduous canopy built from 3 overlapping SAME-toned circles (so
// there is no seam between lobes), one coherent darker underside crescent,
// and a single soft top-left highlight — the previous per-lobe colour
// variation read as a swirl/cabbage rather than one lit canopy.
function treeRound(ctx, x, y, r, rng, tone) {
  const j = () => (rng() - 0.5) * 0.14;
  contactShadow(ctx, x, y + r * 0.72, r * 1.22, r * 0.44, 0.24);
  const trunkW = Math.max(1, r * 0.15);
  ctx.fillStyle = shade('#5a3a24', -0.1);
  ctx.fillRect(x - trunkW / 2, y, trunkW, r * 0.5);

  const cx0 = x + j() * r;
  const cy0 = y - r * 0.3;
  const lobes = [
    [0, 0, r * (0.58 + j())],
    [-r * (0.32 + j()), r * 0.1, r * (0.44 + j())],
    [r * (0.3 + j()), r * 0.14, r * (0.4 + j())],
  ];
  ctx.fillStyle = tone;
  for (const [dx, dy, rr] of lobes) {
    ctx.beginPath();
    ctx.arc(cx0 + dx, cy0 + dy, rr, 0, Math.PI * 2);
    ctx.fill();
  }
  // One coherent darker underside (not a patchwork of per-lobe shades).
  ctx.fillStyle = mix(tone, '#20401c', 0.4);
  ctx.beginPath();
  ctx.ellipse(cx0 + r * 0.05, cy0 + r * 0.26, r * 0.6, r * 0.3, 0, 0, Math.PI);
  ctx.fill();
  // Single soft highlight, light from top-left.
  ctx.fillStyle = rgba('#ffffff', 0.17);
  ctx.beginPath();
  ctx.arc(cx0 - r * 0.22, cy0 - r * 0.27, r * 0.27, 0, Math.PI * 2);
  ctx.fill();
}

function treePine(ctx, x, y, r, rng, tone) {
  contactShadow(ctx, x, y + r * 0.85, r * 0.9, r * 0.36, 0.22);
  ctx.fillStyle = shade('#4a2f1c', -0.1);
  ctx.fillRect(x - r * 0.08, y + r * 0.35, r * 0.16, r * 0.4);
  const tiers = 3;
  for (let k = 0; k < tiers; k++) {
    const w = r * (0.85 - k * 0.22);
    const top = y - r * (0.95 - k * 0.42);
    const bot = y - r * (0.3 - k * 0.42) + r * 0.1;
    ctx.fillStyle = shade(tone, -0.05 * k);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x + w, bot);
    ctx.lineTo(x - w, bot);
    ctx.closePath();
    ctx.fill();
    // Faceted shading: darker right half of each tier.
    ctx.fillStyle = rgba('#000000', 0.1);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x + w, bot);
    ctx.lineTo(x, bot);
    ctx.closePath();
    ctx.fill();
  }
  void rng;
}

function treePalm(ctx, x, y, r, rng) {
  contactShadow(ctx, x, y + r * 0.15, r * 1.1, r * 0.34, 0.2);
  const lean = (rng() - 0.5) * r * 0.3;
  ctx.strokeStyle = '#7a5a2e';
  ctx.lineWidth = Math.max(1, r * 0.14);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y + r * 0.1);
  ctx.quadraticCurveTo(x + lean * 0.6, y - r * 0.35, x + lean, y - r * 0.75);
  ctx.stroke();
  const topX = x + lean;
  const topY = y - r * 0.75;
  const fronds = 5;
  for (let k = 0; k < fronds; k++) {
    const ang = -Math.PI / 2 + (k - (fronds - 1) / 2) * 0.62;
    const fx = topX + Math.cos(ang) * r * 0.85;
    const fy = topY + Math.sin(ang) * r * 0.55;
    ctx.strokeStyle = '#4f8a44';
    ctx.lineWidth = Math.max(1, r * 0.1);
    ctx.beginPath();
    ctx.moveTo(topX, topY);
    ctx.quadraticCurveTo(topX + Math.cos(ang) * r * 0.5, topY + Math.sin(ang) * r * 0.5 - r * 0.1, fx, fy);
    ctx.stroke();
  }
}

function cactus(ctx, x, y, r, rng) {
  contactShadow(ctx, x, y + r * 0.55, r * 0.55, r * 0.22, 0.2);
  const tone = '#5b8a4f';
  const w = r * 0.32;
  const h = r * 1.1;
  roundRect(ctx, x - w / 2, y - h + r * 0.5, w, h, w * 0.45);
  ctx.fillStyle = tone;
  ctx.fill();
  if (rng() > 0.3) {
    const armY = y - h * 0.55 + r * 0.5;
    const side = rng() > 0.5 ? 1 : -1;
    roundRect(ctx, x + side * w * 0.5, armY - w * 1.1, w * 0.75, w * 1.3, w * 0.35);
    ctx.fillStyle = tone;
    ctx.fill();
  }
  ctx.strokeStyle = rgba('#000000', 0.12);
  ctx.lineWidth = Math.max(1, r * 0.03);
  for (let k = -1; k <= 1; k++) {
    ctx.beginPath();
    ctx.moveTo(x + k * w * 0.28, y - h + r * 0.55);
    ctx.lineTo(x + k * w * 0.28, y + r * 0.4);
    ctx.stroke();
  }
}

// One to three shaded mounds, clearly raised: lit upper-left, shaded
// lower-right, tone pushed darker/rockier than flat hills-green so they
// read as raised ground rather than a pale puddle. Count, size, offset and
// a left/right mirror all come from per-tile `rng()` draws (not a fixed
// lookup table) so a hillside doesn't read as the same wallpaper tile
// repeated — DESIGN feedback. `opts.maxMounds`/`opts.scale` let the low-zoom
// LOD case (drawTileDecor) ask for at most one small mound.
function hillMounds(ctx, cx, cy, s, rng, opts = {}) {
  const tone = mix(TERRAIN_COLORS.hills, ROCK_GREY, 0.14);
  const scale = opts.scale ?? 1;
  const n = Math.min(opts.maxMounds ?? 3, 1 + Math.floor(rng() * 3));
  const mirror = rng() < 0.5 ? -1 : 1;
  for (let k = 0; k < n; k++) {
    const dx = mirror * (rng() - 0.32) * s * 0.72;
    const dy = (rng() - 0.35) * s * 0.34;
    const r = s * scale * (0.24 + rng() * 0.26);
    const x = cx + dx;
    const y = cy + dy;
    contactShadow(ctx, x, y + r * 0.58, r * 1.18, r * 0.34, 0.24);
    ctx.fillStyle = shade(tone, 0.15);
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.64, 0, Math.PI, 0, false);
    ctx.fill();
    ctx.fillStyle = shade(tone, -0.24);
    ctx.beginPath();
    ctx.ellipse(x + r * 0.26 * mirror, y, r * 0.74, r * 0.52, 0, 0, Math.PI, false);
    ctx.fill();
  }
}

// 1–3 big faceted peaks that overflow the hex upward (up to ~1.4s above the
// top face) — a mountain RANGE should read at a glance even at s≈13. The
// tallest peak (or any close to it) gets a snowcap; all peaks sit on a soft
// radial "talus" glow that feathers into the ground rather than a hard edge,
// so the range blends into neighbouring tiles instead of reading as a disc.
const PEAK_LAYOUTS = {
  1: [[0, 0.05, 1]],
  2: [[-0.16, -0.04, 1], [0.22, 0.14, 0.68]],
  3: [[-0.22, -0.02, 0.92], [0.06, -0.14, 1], [0.27, 0.16, 0.6]],
};

function mountainPeaks(ctx, cx, cy, s, rng) {
  const rock = mix(TERRAIN_COLORS.mountain, '#8a7458', 0.22);
  const roll = rng();
  const n = roll < 0.2 ? 1 : roll < 0.75 ? 2 : 3;
  const layout = PEAK_LAYOUTS[n];
  const tallestH = Math.max(...layout.map((p) => p[2]));

  for (const [dxF, dyF, hF] of layout) {
    const jx = (rng() - 0.5) * 0.07;
    const jy = (rng() - 0.5) * 0.05;
    const jh = 0.92 + rng() * 0.16;
    const h = s * 1.4 * hF * jh;
    const x = cx + (dxF + jx) * s;
    const baseY = cy + dyF * s + h * 0.16;
    const topY = baseY - h;
    const w = h * 0.56;

    // Soft talus glow: feathers outward so the peak blends into the ground
    // around it instead of sitting as a hard-edged disc.
    const talusR = w * 1.7;
    const talus = ctx.createRadialGradient(x, baseY - h * 0.04, 0, x, baseY - h * 0.04, talusR);
    talus.addColorStop(0, rgba(shade(rock, -0.08), 0.5));
    talus.addColorStop(1, rgba(shade(rock, -0.08), 0));
    ctx.fillStyle = talus;
    ctx.beginPath();
    ctx.arc(x, baseY - h * 0.04, talusR, 0, Math.PI * 2);
    ctx.fill();

    contactShadow(ctx, x, baseY + h * 0.05, w * 1.15, w * 0.4, 0.22);

    // Lit face (upper-left light) then shaded face (right).
    ctx.fillStyle = shade(rock, 0.15);
    ctx.beginPath();
    ctx.moveTo(x, topY);
    ctx.lineTo(x - w, baseY);
    ctx.lineTo(x, baseY);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = shade(rock, -0.28);
    ctx.beginPath();
    ctx.moveTo(x, topY);
    ctx.lineTo(x + w, baseY);
    ctx.lineTo(x, baseY);
    ctx.closePath();
    ctx.fill();
    // Facet seam down the ridge line.
    ctx.strokeStyle = rgba('#000000', 0.2);
    ctx.lineWidth = Math.max(1, w * 0.05);
    ctx.beginPath();
    ctx.moveTo(x, topY);
    ctx.lineTo(x, baseY);
    ctx.stroke();

    // Snowcap on the tallest peak(s) only.
    if (hF >= tallestH - 0.001 || hF >= 0.85) {
      const capH = h * 0.3;
      const capW = w * 0.46;
      ctx.fillStyle = SNOWCAP_COLOR;
      ctx.beginPath();
      ctx.moveTo(x, topY);
      ctx.lineTo(x - capW, topY + capH);
      ctx.lineTo(x + capW * 0.7, topY + capH * 0.82);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = rgba('#c9d3da', 0.7);
      ctx.beginPath();
      ctx.moveTo(x, topY);
      ctx.lineTo(x + capW, topY + capH);
      ctx.lineTo(x + capW * 0.32, topY + capH * 0.52);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function grassTufts(ctx, cx, cy, s, rng, tone, count) {
  for (let k = 0; k < count; k++) {
    const ang = rng() * Math.PI * 2;
    const dist = rng() * s * 0.55;
    const x = cx + Math.cos(ang) * dist;
    const y = cy + Math.sin(ang) * dist * 0.7;
    const h = s * (0.14 + rng() * 0.08);
    ctx.strokeStyle = shade(tone, -0.2 - rng() * 0.15);
    ctx.lineWidth = Math.max(1, s * 0.045);
    ctx.lineCap = 'round';
    for (let b = -1; b <= 1; b++) {
      ctx.beginPath();
      ctx.moveTo(x + b * h * 0.22, y + h * 0.28);
      ctx.quadraticCurveTo(x + b * h * 0.5, y - h * 0.2, x + b * h * 0.32, y - h);
      ctx.stroke();
    }
  }
}

function meadowFlowers(ctx, cx, cy, s, rng, count) {
  const tones = ['#fff3c4', '#ffe0ee', '#ffffff'];
  for (let k = 0; k < count; k++) {
    const ang = rng() * Math.PI * 2;
    const dist = rng() * s * 0.5;
    const x = cx + Math.cos(ang) * dist;
    const y = cy + Math.sin(ang) * dist * 0.7;
    ctx.fillStyle = tones[k % tones.length];
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.8, s * 0.045), 0, Math.PI * 2);
    ctx.fill();
  }
}

function marshDecor(ctx, cx, cy, s, rng) {
  // Puddle.
  const px = cx + (rng() - 0.5) * s * 0.5;
  const py = cy + (rng() - 0.5) * s * 0.4;
  const pr = s * 0.3;
  ctx.fillStyle = shade(TERRAIN_COLORS.marsh, -0.42);
  ctx.beginPath();
  ctx.ellipse(px, py, pr, pr * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgba('#dff2ea', 0.35);
  ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.beginPath();
  ctx.ellipse(px - pr * 0.15, py - pr * 0.1, pr * 0.5, pr * 0.22, 0.3, 0, Math.PI);
  ctx.stroke();
  // Reeds.
  const clumps = 3;
  for (let c = 0; c < clumps; c++) {
    const ang = rng() * Math.PI * 2;
    const dist = s * (0.3 + rng() * 0.3);
    const x = cx + Math.cos(ang) * dist;
    const y = cy + Math.sin(ang) * dist * 0.7;
    for (let b = 0; b < 3; b++) {
      const lean = (rng() - 0.5) * s * 0.22;
      const h = s * (0.32 + rng() * 0.16);
      ctx.strokeStyle = shade('#5f7a4a', -0.05 * b);
      ctx.lineWidth = Math.max(1, s * 0.04);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + b * s * 0.06 - s * 0.06, y + s * 0.1);
      ctx.quadraticCurveTo(x + lean * 0.6, y - h * 0.6, x + lean, y - h);
      ctx.stroke();
    }
  }
}

function duneLines(ctx, cx, cy, s, rng, tone) {
  for (let k = 0; k < 3; k++) {
    const y = cy + (k - 1) * s * 0.28 + (rng() - 0.5) * s * 0.08;
    const w = s * (0.55 + rng() * 0.15);
    ctx.strokeStyle = shade(tone, k % 2 ? -0.14 : 0.12);
    ctx.lineWidth = Math.max(1, s * 0.05);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - w, y);
    ctx.quadraticCurveTo(cx, y - s * 0.1, cx + w, y);
    ctx.stroke();
  }
}

function snowDrifts(ctx, cx, cy, s, rng) {
  const specs = [[-s * 0.22, s * 0.08, s * 0.4], [s * 0.24, s * 0.18, s * 0.3]];
  for (const [dx, dy, r] of specs) {
    const x = cx + dx + (rng() - 0.5) * s * 0.06;
    const y = cy + dy;
    ctx.fillStyle = shade(SNOWCAP_COLOR, -0.04);
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.5, 0, Math.PI, 0, false);
    ctx.fill();
    ctx.fillStyle = rgba('#9fb3c8', 0.35);
    ctx.beginPath();
    ctx.ellipse(x + r * 0.2, y, r * 0.6, r * 0.4, 0, 0, Math.PI, false);
    ctx.fill();
  }
}

function beachSpecks(ctx, cx, cy, s, rng, count) {
  for (let k = 0; k < count; k++) {
    const ang = rng() * Math.PI * 2;
    const dist = rng() * s * 0.55;
    const x = cx + Math.cos(ang) * dist;
    const y = cy + Math.sin(ang) * dist * 0.7;
    ctx.fillStyle = rgba('#8a7a5a', 0.35);
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.6, s * 0.03), 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Terrain decorations: trees, mounds, peaks, tufts, reeds — DESIGN §7.1.
 * Deterministic from `tile.jitter`/`tile.i` unless an `rng` (0-arg → 0..1
 * function) is supplied. Sits on the raised top face (shifted by `elevOffset`).
 * @param {CanvasRenderingContext2D} ctx
 * @param {Tile} tile
 * @param {number} cx
 * @param {number} cy
 * @param {number} s
 * @param {() => number} [rng]
 */
export function drawTileDecor(ctx, tile, cx, cy, s, rng) {
  const topCy = cy - elevOffset(tile, s);
  const r = rngForTile(tile, 1);
  const roll = rng || r;
  // LOD: keep the world-overview zoom calm (DESIGN 7.6 "elegant, not busy");
  // only bloom into full detail once tiles are big enough to show it off.
  // Mountains are exempt — a range must read at a glance even at s≈13.
  const lod = s >= 26 ? 2 : s >= 17 ? 1 : 0;

  switch (tile.terrain) {
    case 'forest': {
      const n = lod === 2 ? 4 + Math.floor(roll() * 3) : lod === 1 ? 3 : 1;
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * Math.PI * 2 + roll() * 0.8;
        const dist = roll() * s * 0.52;
        const x = cx + Math.cos(ang) * dist;
        const y = topCy + Math.sin(ang) * dist * 0.7 - s * 0.1;
        treeRound(ctx, x, y, s * (0.36 + roll() * 0.13), roll, TERRAIN_COLORS.forest);
      }
      break;
    }
    case 'pine': {
      const n = lod === 2 ? 4 + Math.floor(roll() * 3) : lod === 1 ? 3 : 1;
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * Math.PI * 2 + roll() * 0.8;
        const dist = roll() * s * 0.52;
        const x = cx + Math.cos(ang) * dist;
        const y = topCy + Math.sin(ang) * dist * 0.7 - s * 0.05;
        treePine(ctx, x, y, s * (0.37 + roll() * 0.12), roll, TERRAIN_COLORS.pine);
      }
      break;
    }
    case 'hills':
      // Calm at overview (DESIGN feedback): at most one small mound, and
      // only on half of the tiles, instead of every hill hex getting the
      // same full mound cluster — a hilly stretch of country should read
      // as gentle high ground, not a repeating pattern.
      if (lod === 0) {
        if (roll() < 0.5) hillMounds(ctx, cx, topCy, s, roll, { maxMounds: 1, scale: 0.62 });
      } else {
        hillMounds(ctx, cx, topCy, s, roll);
      }
      break;
    case 'mountain':
      mountainPeaks(ctx, cx, topCy, s, roll);
      break;
    case 'grass':
      if (lod >= 1) grassTufts(ctx, cx, topCy, s, roll, TERRAIN_COLORS.grass, lod === 2 ? 3 : 2);
      break;
    case 'meadow':
      if (lod >= 1) {
        grassTufts(ctx, cx, topCy, s, roll, TERRAIN_COLORS.meadow, lod === 2 ? 2 : 1);
        meadowFlowers(ctx, cx, topCy, s, roll, lod === 2 ? 4 : 2);
      }
      break;
    case 'savanna':
      if (lod >= 1) grassTufts(ctx, cx, topCy, s, roll, '#a89354', 2);
      if (lod === 2 && roll() > 0.55) treePalm(ctx, cx + (roll() - 0.5) * s * 0.3, topCy + s * 0.15, s * 0.5, roll);
      break;
    case 'desert':
      if (lod === 2) duneLines(ctx, cx, topCy, s, roll, TERRAIN_COLORS.desert);
      if (lod >= 1 && roll() > 0.45) cactus(ctx, cx + (roll() - 0.5) * s * 0.3, topCy + s * 0.2, s * 0.55, roll);
      break;
    case 'marsh':
      if (lod >= 1) marshDecor(ctx, cx, topCy, s, roll);
      break;
    case 'snow':
      if (lod >= 1) snowDrifts(ctx, cx, topCy, s, roll);
      break;
    case 'beach':
      if (lod === 2) beachSpecks(ctx, cx, topCy, s, roll, 3);
      break;
    default:
      break;
  }
}
