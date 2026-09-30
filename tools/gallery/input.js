// Gallery / manual + automated test page for game/render/camera.js and
// game/input/pointer.js. A big pointy-top hex grid (40x30, ARCHITECTURE §3
// world units) with a handful of "settlement" circles to drag between.
//
// Exposes `window.test` for tools/gallery/input-check.mjs (driven through
// real CDP mouse/touch/wheel events, not synthetic clicks).
import { createCamera } from '../../game/render/camera.js';
import { createInput } from '../../game/input/pointer.js';
import { createClock } from '../../game/input/clock.js';

// ---------------------------------------------------------------------------
// Hex math (ARCHITECTURE.md §3) — pointy-top, axial (q,r), odd-r offset,
// hex size 1 world unit. Kept local: this is a demo page, not game/core/hex.js.
const SQRT3 = Math.sqrt(3);
const COLS = 40;
const ROWS = 30;

const offsetToAxial = (col, row) => ({ q: col - (row - (row & 1)) / 2, r: row });
const axialToOffset = (q, r) => ({ col: q + (r - (r & 1)) / 2, row: r });
const axialToPixel = (q, r) => ({ x: SQRT3 * (q + r / 2), y: 1.5 * r });

function pixelToAxial(x, y) {
  const qf = (SQRT3 / 3) * x - y / 3;
  const rf = (2 / 3) * y;
  // cube rounding
  let xf = qf, zf = rf, yf = -xf - zf;
  let rx = Math.round(xf), ry = Math.round(yf), rz = Math.round(zf);
  const dx = Math.abs(rx - xf), dy = Math.abs(ry - yf), dz = Math.abs(rz - zf);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}

function hexCorners(cx, cy, size) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 90);
    pts.push([cx + size * Math.cos(a), cy + size * Math.sin(a)]);
  }
  return pts;
}

/** Trace a hex's outline into the current canvas path (fill/stroke it yourself). */
function traceHex(cx, cy, size) {
  const pts = hexCorners(cx, cy, size);
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < 6; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

function hash01(a, b) {
  const h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

function jitterColor(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const f = (shift) => Math.max(0, Math.min(255, Math.round(((n >> shift) & 255) * amount)));
  return `rgb(${f(16)},${f(8)},${f(0)})`;
}

// ---------------------------------------------------------------------------
// World: tile bounds + a handful of settlements to drag between.
const TERRAIN_COLORS = ['#86b46a', '#9cc46e']; // grassland / meadow, DESIGN §7.1

const worldBounds = (() => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const { q, r } = offsetToAxial(col, row);
      const { x, y } = axialToPixel(q, r);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  const pad = 1; // a hex's own radius
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
})();

const SETTLEMENT_SITES = [
  { col: 6, row: 5, color: '#3d7ef0', name: 'War Camp' },
  { col: 33, row: 4, color: '#d8433f', name: 'Crimson outpost' },
  { col: 4, row: 24, color: '#9a927f', name: 'Free Folk hamlet' },
  { col: 35, row: 26, color: '#f29e38', name: 'Amber camp' },
  { col: 19, row: 15, color: '#e0a82e', name: 'Trade town' },
  { col: 12, row: 9, color: '#4fa6cc', name: 'Harbour' },
  { col: 27, row: 20, color: '#9b5de5', name: 'Violet keep' },
];
const settlements = SETTLEMENT_SITES.map((s, i) => {
  const { q, r } = offsetToAxial(s.col, s.row);
  const { x, y } = axialToPixel(q, r);
  return { i, x, y, col: s.col, row: s.row, color: s.color, name: s.name, radius: 0.5 };
});

// ---------------------------------------------------------------------------
// Camera + input
const canvas = document.getElementById('world');
const ctx = canvas.getContext('2d');
const hud = document.getElementById('hud');

// World overview vs. battle zoom: a hex is ~1.73 world units wide, so zoom 12
// shows the whole 40x30 grid comfortably, and zoom 70 fills the screen with
// under a dozen hexes across — see the final report for how these were
// picked (fitZoom against these exact bounds at a 1280x800 viewport).
const camera = createCamera({ minZoom: 8, maxZoom: 90 });

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  camera.resize(w, h);
}
window.addEventListener('resize', resize);
resize();

camera.setBounds(worldBounds, 200);
camera.zoom = camera.fitZoom(worldBounds, 40);
camera.x = (worldBounds.minX + worldBounds.maxX) / 2;
camera.y = (worldBounds.minY + worldBounds.maxY) / 2;

const HIT_PX = 26; // constant on-screen tap tolerance regardless of zoom

function findSettlementAt(wx, wy) {
  const hitRadius = Math.max(0.5, HIT_PX / camera.zoom);
  let best = -1, bestD = Infinity;
  for (const s of settlements) {
    const d = Math.hypot(s.x - wx, s.y - wy);
    if (d <= hitRadius && d < bestD) { best = s.i; bestD = d; }
  }
  return best;
}

function hexAt(wx, wy) {
  const { q, r } = pixelToAxial(wx, wy);
  const { col, row } = axialToOffset(q, r);
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
  return { q, r, col, row };
}

// --- demo/HUD state ---------------------------------------------------------
const state = {
  lastIntent: 'ready',
  lastKey: null,
  sendFraction: 0.5,
  selectedHex: null,
  selectedSettlement: null,
  hoverHex: null,
  flying: false,
  arrow: null, // { fromIdx, sx, sy }
  lasso: null, // { x0, y0, x1, y1 }
  lastSend: null,
  lastCancelled: false,
};

let dragSourceSettlement = -1;

const handlers = {
  onHover(sx, sy, wx, wy) {
    state.hoverHex = hexAt(wx, wy);
  },

  onTap(sx, sy, wx, wy, info) {
    const hit = findSettlementAt(wx, wy);
    state.selectedSettlement = hit >= 0 ? hit : null;
    state.selectedHex = hit >= 0 ? null : hexAt(wx, wy);
    state.lastIntent = `tap (${info.pointerType}${info.shift ? '+shift' : ''})`;
  },

  onLongPress(sx, sy, wx, wy, info) {
    const hit = findSettlementAt(wx, wy);
    state.selectedSettlement = hit >= 0 ? hit : null;
    state.selectedHex = hit >= 0 ? null : hexAt(wx, wy);
    state.lastIntent = `long-press (${info.pointerType})`;
  },

  canStartDrag(wx, wy, info) {
    if (info.shift) return 'lasso';
    const hit = findSettlementAt(wx, wy);
    if (hit >= 0) { dragSourceSettlement = hit; return 'send'; }
    return 'pan';
  },

  onDragStart(kind, sx, sy, wx, wy) {
    canvas.classList.add('dragging');
    if (kind === 'send') state.arrow = { fromIdx: dragSourceSettlement, sx, sy };
    else if (kind === 'lasso') state.lasso = { x0: sx, y0: sy, x1: sx, y1: sy };
    state.lastIntent = `drag-start:${kind}`;
  },

  onDragMove(kind, sx, sy, wx, wy) {
    if (kind === 'send' && state.arrow) { state.arrow.sx = sx; state.arrow.sy = sy; }
    else if (kind === 'lasso' && state.lasso) { state.lasso.x1 = sx; state.lasso.y1 = sy; }
    state.lastIntent = `drag-move:${kind}`;
  },

  onDragEnd(kind, sx, sy, wx, wy, { cancelled }) {
    canvas.classList.remove('dragging');
    state.lastCancelled = cancelled;
    if (kind === 'send') {
      const toIdx = cancelled ? -1 : findSettlementAt(wx, wy);
      state.lastSend = { from: dragSourceSettlement, to: toIdx >= 0 ? toIdx : null, cancelled };
      if (!cancelled) camera.shake(0.4); // a little impact juice, DESIGN §7.4
      state.arrow = null;
    } else if (kind === 'lasso') {
      if (!cancelled && state.lasso) {
        const x0 = Math.min(state.lasso.x0, state.lasso.x1);
        const x1 = Math.max(state.lasso.x0, state.lasso.x1);
        const y0 = Math.min(state.lasso.y0, state.lasso.y1);
        const y1 = Math.max(state.lasso.y0, state.lasso.y1);
        state.lastSend = {
          lasso: settlements.filter((s) => {
            const p = camera.worldToScreen(s.x, s.y);
            return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
          }).map((s) => s.i),
        };
      }
      state.lasso = null;
    }
    state.lastIntent = `drag-end:${kind}${cancelled ? ' (cancelled)' : ''}`;
  },

  onCancel() {
    state.selectedHex = null;
    state.selectedSettlement = null;
    state.arrow = null;
    state.lasso = null;
    state.lastIntent = 'cancel';
  },

  onKey(key, event) {
    if (['1', '2', '3', '4'].includes(key)) {
      state.sendFraction = { 1: 0.25, 2: 0.5, 3: 0.75, 4: 1 }[key];
    } else if (key === 'a' || key === 'A') {
      state.lastIntent = 'key: select-all (stub)';
    }
    state.lastKey = key;
  },
};

const input = createInput(canvas, camera, handlers);

document.getElementById('btnFar').addEventListener('click', async () => {
  state.flying = true;
  const far = settlements[3]; // far corner-ish settlement
  await camera.flyTo({ x: far.x, y: far.y, zoom: 60 }, 900);
  state.flying = false;
});
document.getElementById('btnHome').addEventListener('click', async () => {
  state.flying = true;
  await camera.flyTo({ bounds: worldBounds, padding: 40 }, 900);
  state.flying = false;
});

// ---------------------------------------------------------------------------
// Draw
function drawHexGrid() {
  const b = camera.visibleBounds(2);
  const rowLo = Math.max(0, Math.floor(b.minY / 1.5) - 1);
  const rowHi = Math.min(ROWS - 1, Math.ceil(b.maxY / 1.5) + 1);
  for (let row = rowLo; row <= rowHi; row++) {
    for (let col = 0; col < COLS; col++) {
      const { q, r } = offsetToAxial(col, row);
      const { x, y } = axialToPixel(q, r);
      if (x < b.minX - 2 || x > b.maxX + 2) continue;
      const p = camera.worldToScreen(x, y);
      const base = TERRAIN_COLORS[(col + row) % 2];
      traceHex(p.x, p.y, camera.zoom);
      ctx.fillStyle = jitterColor(base, 0.96 + hash01(col, row) * 0.08);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.10)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

function strokeHex(col, row, color, width) {
  const { q, r } = offsetToAxial(col, row);
  const { x, y } = axialToPixel(q, r);
  const p = camera.worldToScreen(x, y);
  traceHex(p.x, p.y, camera.zoom);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function drawSettlements() {
  for (const s of settlements) {
    const p = camera.worldToScreen(s.x, s.y);
    const r = s.radius * camera.zoom;
    const selected = state.selectedSettlement === s.i;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = s.color;
    ctx.fill();
    ctx.lineWidth = selected ? 3 : 1.5;
    ctx.strokeStyle = selected ? '#f5c451' : 'rgba(0,0,0,0.35)';
    ctx.stroke();
    if (camera.zoom > 20) {
      ctx.fillStyle = '#f3ead7';
      ctx.font = '11px Nunito, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(s.name, p.x, p.y - r - 6);
    }
  }
}

function drawArrow() {
  if (!state.arrow) return;
  const src = settlements[state.arrow.fromIdx];
  const from = camera.worldToScreen(src.x, src.y);
  const to = { x: state.arrow.sx, y: state.arrow.sy };
  ctx.strokeStyle = src.color;
  ctx.fillStyle = src.color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const ah = 10;
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - ah * Math.cos(ang - 0.4), to.y - ah * Math.sin(ang - 0.4));
  ctx.lineTo(to.x - ah * Math.cos(ang + 0.4), to.y - ah * Math.sin(ang + 0.4));
  ctx.closePath();
  ctx.fill();
}

function drawLasso() {
  if (!state.lasso) return;
  const { x0, y0, x1, y1 } = state.lasso;
  const x = Math.min(x0, x1), y = Math.min(y0, y1);
  const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
  ctx.fillStyle = 'rgba(111,207,151,0.15)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#6fcf97';
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
}

function updateHud() {
  const c = camera;
  const lines = [
    `<b>camera</b>  x=${c.x.toFixed(1)} y=${c.y.toFixed(1)} zoom=${c.zoom.toFixed(1)}` +
      `  ${c.isMoving() ? '(moving)' : ''}${state.flying ? ' (flying)' : ''}`,
    `<b>intent</b>  ${state.lastIntent}`,
    `<b>send %</b>  ${Math.round(state.sendFraction * 100)}  (keys 1-4)   <b>key</b> ${state.lastKey ?? '-'}`,
    state.selectedHex ? `<b>hex</b>  col=${state.selectedHex.col} row=${state.selectedHex.row} (q=${state.selectedHex.q},r=${state.selectedHex.r})` : '<b>hex</b>  -',
    state.selectedSettlement != null ? `<b>settlement</b>  #${state.selectedSettlement} ${settlements[state.selectedSettlement].name}` : '<b>settlement</b>  -',
    state.lastSend ? `<b>last order</b>  ${JSON.stringify(state.lastSend)}` : '<b>last order</b>  -',
  ];
  hud.innerHTML = lines.join('\n');
}

const clock = createClock();
function frame(now) {
  const dt = clock.tick(now);
  camera.update(dt);

  ctx.save();
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, camera.viewW, camera.viewH);
  ctx.translate(camera.shakeX, camera.shakeY); // shake is draw-time only (camera.js contract)
  drawHexGrid();
  if (state.hoverHex) strokeHex(state.hoverHex.col, state.hoverHex.row, 'rgba(255,255,255,0.5)', 1.5);
  if (state.selectedHex) strokeHex(state.selectedHex.col, state.selectedHex.row, '#f5c451', 3);
  drawSettlements();
  drawArrow();
  ctx.restore(); // lasso is a screen-space UI overlay: draw it un-shaken
  drawLasso();

  updateHud();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------------------
// Automation hooks for tools/gallery/input-check.mjs
window.test = {
  camera: () => ({
    x: camera.x, y: camera.y, zoom: camera.zoom,
    viewW: camera.viewW, viewH: camera.viewH,
    shakeX: camera.shakeX, shakeY: camera.shakeY,
    moving: camera.isMoving(),
  }),
  state: () => JSON.parse(JSON.stringify(state)),
  worldToScreen: (wx, wy) => camera.worldToScreen(wx, wy),
  screenToWorld: (sx, sy) => camera.screenToWorld(sx, sy),
  settlements: () => settlements.map((s) => ({ i: s.i, name: s.name, world: { x: s.x, y: s.y }, screen: camera.worldToScreen(s.x, s.y) })),
  flyFar: () => document.getElementById('btnFar').click(),
  flyHome: () => document.getElementById('btnHome').click(),
  setEnabled: (v) => input.setEnabled(v),
};
