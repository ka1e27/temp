// Gallery orchestration: builds a mock island, lays out every static
// showcase grid, and runs one shared animation clock. This file (and
// art-mock.js) are dev-only — nothing here is imported by the real game.
import {
  ACCENTS, FACTIONS, factionColor, shade,
} from '../../game/render/palette.js';
import {
  drawTileBase, drawTileDecor, drawRiver, drawRoad, drawCoastFoam, drawFarmFields,
  drawWaterGlints, drawHexTint, drawHexEdge, elevOffset, isWaterTile, hexPath,
  drawOceanBase, WATER_SPLAT_MARGIN, drawWaterSplat,
} from '../../game/render/tiles.js';
import {
  drawSettlement, drawBanner, drawEmblem, drawTroopBadge, drawSquad, drawDragArrow,
  BANNER_ANCHOR,
} from '../../game/render/sprites.js';
import {
  drawCloudPuff, drawCloudShadow, makeCloudField, getPuffSprite,
} from '../../game/render/clouds.js';
import { makeMockWorld, neighborTile, hexDistance } from './art-mock.js';

const SETTLEMENT_TYPES = ['hamlet', 'village', 'town', 'fort', 'tower', 'keep', 'camp'];
const TERRAIN_TYPES = [
  'deep', 'ocean', 'shallows', 'beach', 'grass', 'meadow', 'forest', 'pine',
  'hills', 'mountain', 'snow', 'savanna', 'desert', 'marsh',
];
const TROOPS_BY_TYPE = {
  hamlet: 14, village: 27, town: 46, fort: 52, tower: 19, keep: 74, camp: 58,
};
const FREE_FOLK_ID = 1;

function makeOffscreen(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

const WATER_TERRAINS = new Set(['deep', 'ocean', 'shallows']);
function groundTile(terrain, i) {
  const water = WATER_TERRAINS.has(terrain);
  return {
    i, terrain, elev: water ? 0 : 1, height: water ? 0.2 : 0.5,
    land: !water, jitter: ((i * 0.618) % 1), river: 0, road: 0, coast: 0,
  };
}

// ---------------------------------------------------------- (a) island view

function computeOwners(world) {
  const settlements = world.settlements;
  const owner = new Int8Array(world.tiles.length).fill(-1);
  for (const t of world.tiles) {
    if (!t.land) continue;
    let best = -1;
    let bestD = Infinity;
    for (const st of settlements) {
      const stile = world.tiles[st.tile];
      const d = hexDistance(t, stile);
      if (d < bestD) { bestD = d; best = st.faction; }
    }
    owner[t.i] = best;
  }
  return owner;
}

function isNearSettlementType(world, tile, types) {
  for (let d = 0; d < 6; d++) {
    const nb = neighborTile(world, tile, d);
    if (nb && nb.settlement !== -1) {
      const st = world.settlements.find((s) => s.id === nb.settlement);
      if (st && types.includes(st.type)) return true;
    }
  }
  return false;
}

function bakeTerrain(world, s, originX, originY, w, h, owners) {
  const canvas = makeOffscreen(w, h);
  const ctx = canvas.getContext('2d');

  // --- Water (art-direction round 3): flat base, then soft overlapping
  // splats — tiles-water.js. This bake is one terrain-cache "chunk"
  // (ARCHITECTURE §7); a real chunk renderer must ALSO splat every water
  // tile within WATER_SPLAT_MARGIN tiles OUTSIDE its own bounds (clipped to
  // its own rect, as here) so two adjacent chunks agree at the seam —
  // demonstrated here even though this "chunk" happens to be the whole view.
  drawOceanBase(ctx, 0, 0, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  // Tile spacing is 1.5s (rows) / √3 s (cols); 1.8s per margin tile is a
  // generous, direction-agnostic pixel conversion of WATER_SPLAT_MARGIN.
  const splatMarginPx = WATER_SPLAT_MARGIN * s * 1.8;
  for (let idx = 0; idx < world.tiles.length; idx++) {
    const t = world.tiles[idx];
    if (!isWaterTile(t)) continue;
    const x = originX + t.x * s;
    const y = originY + t.y * s;
    if (x < -splatMarginPx || x > w + splatMarginPx || y < -splatMarginPx || y > h + splatMarginPx) continue;
    drawWaterSplat(ctx, t, x, y, s);
  }
  ctx.restore();

  const margin = s * 2.2;
  const visible = [];
  for (let idx = 0; idx < world.tiles.length; idx++) {
    const t = world.tiles[idx];
    const x = originX + t.x * s;
    const y = originY + t.y * s;
    if (x < -margin || x > w + margin || y < -margin || y > h + margin) continue;
    visible.push({ t, x, y });
  }

  // Terrain chunk: base, coast, river, road, farm fields, decor — row order
  // preserved (tiles are already in row-major order) so tops overlap skirts.
  // `drawTileBase` no-ops for water tiles now (drawn above already).
  for (const { t, x, y } of visible) {
    drawTileBase(ctx, t, x, y, s);
    drawCoastFoam(ctx, t, x, y, s);
    drawRiver(ctx, t, x, y, s);
    drawRoad(ctx, t, x, y, s);
    if (t.settlement === -1 && t.land && t.elev === 1
        && isNearSettlementType(world, t, ['hamlet', 'village', 'town'])) {
      drawFarmFields(ctx, x, y - elevOffset(t, s), s, t.i + 1);
    }
    drawTileDecor(ctx, t, x, y, s);
  }

  // Territory tint + borders (DESIGN §7.3, art-direction round 2): the Free
  // Folk are passive squatters, not a banner power, so their land gets NO
  // tint wash — just a border in their stone colour. Everyone else gets a
  // light tint (an 'overlay' blend inside drawHexTint keeps the terrain's
  // own texture showing through instead of flattening into a muddy wash).
  // Border width is a fixed pixel weight (not zoom-proportional), crisper
  // and heavier once tiles are big enough to show it off.
  const borderW = s >= 30 ? 2.75 : 2;
  for (const { t, x, y } of visible) {
    if (!t.land || owners[t.i] < 0) continue;
    const topY = y - elevOffset(t, s);
    const ownerId = owners[t.i];
    const color = factionColor(ownerId);
    if (ownerId !== FREE_FOLK_ID) {
      drawHexTint(ctx, x, topY, s, color, 0.18);
    }
    for (let d = 0; d < 6; d++) {
      const nb = neighborTile(world, t, d);
      const differs = !nb || !nb.land || owners[nb.i] !== ownerId;
      if (!differs) continue;
      drawHexEdge(ctx, x, topY, s, d, 'rgba(6,10,8,0.55)', borderW + 1.4);
      drawHexEdge(ctx, x, topY, s, d, color, borderW);
    }
  }

  return { canvas, visible };
}

function createIslandView(canvas, world, s, origin, owners, opts) {
  const w = canvas.width;
  const h = canvas.height;
  const baked = bakeTerrain(world, s, origin.x, origin.y, w, h, owners);
  const waterTiles = baked.visible.filter(({ t }) => !t.land);
  const settlementById = new Map(world.settlements.map((st) => [st.id, st]));

  // "A proper cloud mass", not one blob: concatenate two independently-
  // seeded fields over the same corner so it reads as many overlapping
  // puffs of varied size rather than a single cluster.
  const cornerBounds = opts.cloudCorner;
  const cloudPuffs = cornerBounds
    ? [
      ...makeCloudField(opts.cloudSeed || 7, cornerBounds),
      ...makeCloudField((opts.cloudSeed || 7) + 101, cornerBounds),
    ]
    : [];
  const shadowPuffs = opts.shadowDrift || [];

  const ctx = canvas.getContext('2d');

  function screenOf(tile) {
    const x = origin.x + tile.x * s;
    const y = origin.y + tile.y * s;
    return { x, y, topY: y - elevOffset(tile, s) };
  }

  return {
    update(t) {
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(baked.canvas, 0, 0);

      for (const { t: tile, x, y } of waterTiles) {
        drawWaterGlints(ctx, x, y, s, t, tile.i);
      }

      for (const drift of shadowPuffs) {
        const px = origin.x + (drift.x0 + Math.sin(t * drift.speed + drift.phase) * drift.range) * s;
        const py = origin.y + drift.y0 * s;
        drawCloudShadow(ctx, px, py, drift.r * s, 0.22);
      }

      // Settlements, banners, badges.
      for (const st of world.settlements) {
        const tile = world.tiles[st.tile];
        const { x, topY } = screenOf(tile);
        drawSettlement(ctx, st.type, x, topY, s, st.faction, {
          selected: opts.selectedId === st.id,
        });
        const anchor = BANNER_ANCHOR[st.type] || { dx: 0, dy: -1 };
        drawBanner(ctx, x + anchor.dx * s, topY + anchor.dy * s, s * 0.46, st.faction, t);
        drawTroopBadge(ctx, x, topY - s * 0.05, TROOPS_BY_TYPE[st.type] || 20, st.faction, s * 0.95);
      }

      // A couple of marching squads, for life + to exercise drawSquad.
      if (opts.squads) {
        for (const sq of opts.squads) {
          const a = world.tiles[sq.fromTile];
          const b = world.tiles[sq.toTile];
          const p = (Math.sin(t * sq.speed + sq.phase) + 1) / 2;
          const ax = origin.x + a.x * s; const ay = origin.y + a.y * s;
          const bx = origin.x + b.x * s; const by = origin.y + b.y * s;
          const x = ax + (bx - ax) * p;
          const y = ay + (by - ay) * p - elevOffset(a, s);
          const dx = bx - ax; const dy = by - ay;
          drawSquad(ctx, x, y, sq.count, sq.faction, s * 0.8, t, dx, dy);
        }
      }

      // Drag-to-send preview arrow.
      if (opts.dragArrow) {
        const a = world.tiles[opts.dragArrow.fromTile];
        const b = world.tiles[opts.dragArrow.toTile];
        const ax = origin.x + a.x * s; const ay = origin.y + a.y * s - elevOffset(a, s);
        const bx = origin.x + b.x * s; const by = origin.y + b.y * s - elevOffset(b, s);
        drawDragArrow(ctx, ax, ay, bx, by, ACCENTS.gold, t);
      }

      // Fog of the unknown over one corner: cached sprites blitted with
      // drawImage (the intended cheap path for 150+ puffs/frame), each
      // gently drifting so a field of static bitmaps still feels alive.
      for (const p of cloudPuffs) {
        const drift = Math.sin(t * 0.05 + p.seed * 0.013) * s * 0.5;
        const px = origin.x + p.x * s + drift;
        const py = origin.y + p.y * s;
        const sprite = getPuffSprite(p.r * s, p.seed);
        if (!sprite) { drawCloudPuff(ctx, px, py, p.r * s, p.alpha, t, p.seed); continue; }
        ctx.globalAlpha = p.alpha;
        ctx.drawImage(sprite.canvas, px - sprite.size / 2, py - sprite.size / 2);
        ctx.globalAlpha = 1;
      }

      void settlementById;
    },
  };
}

function fitOrigin(world, s, w, h) {
  const b = world.bounds;
  const bw = (b.maxX - b.minX) * s;
  const bh = (b.maxY - b.minY) * s;
  return { x: (w - bw) / 2 - b.minX * s, y: (h - bh) / 2 - b.minY * s };
}

const ISLAND = makeMockWorld(20260929, { cols: 30, rows: 22 });
const islandOwners = computeOwners(ISLAND);
const settlementById = new Map(ISLAND.settlements.map((s) => [s.id, s]));

const overviewCanvas = document.getElementById('overview-canvas');
const battleCanvas = document.getElementById('battle-canvas');

const overviewOrigin = fitOrigin(ISLAND, 13, overviewCanvas.width, overviewCanvas.height);
const westCluster = [0, 1, 2, 3].map((id) => ISLAND.tiles[settlementById.get(id).tile]);
const focusX = westCluster.reduce((a, t) => a + t.x, 0) / westCluster.length;
const focusY = westCluster.reduce((a, t) => a + t.y, 0) / westCluster.length;
const S_BATTLE = 38;
const battleOrigin = {
  x: battleCanvas.width / 2 - focusX * S_BATTLE,
  y: battleCanvas.height / 2 - focusY * S_BATTLE,
};

const cornerBoundsWorld = {
  minX: ISLAND.bounds.minX + (ISLAND.bounds.maxX - ISLAND.bounds.minX) * 0.66,
  maxX: ISLAND.bounds.maxX + 3,
  minY: ISLAND.bounds.minY - 3,
  maxY: ISLAND.bounds.minY + (ISLAND.bounds.maxY - ISLAND.bounds.minY) * 0.32,
};

const demoSquads = [
  { fromTile: settlementById.get(1).tile, toTile: settlementById.get(2).tile, count: 9, faction: 0, speed: 0.35, phase: 0 },
  { fromTile: settlementById.get(3).tile, toTile: settlementById.get(2).tile, count: 5, faction: 1, speed: 0.5, phase: 2 },
];
const demoDragArrow = { fromTile: settlementById.get(1).tile, toTile: settlementById.get(3).tile };
const shadowDrift = [
  { x0: 0.35, y0: 0.3, range: 4, speed: 0.12, phase: 0, r: 2.6 },
  { x0: 0.6, y0: 0.55, range: 5, speed: 0.09, phase: 1.4, r: 3.4 },
].map((d) => ({ ...d, x0: (ISLAND.bounds.minX + ISLAND.bounds.maxX) / 2 / 13 + d.x0 * 10, y0: d.y0 * 10 }));
// (Shadow drift positions are illustrative wander-loops in world units, not
// tied to any particular land tile — good enough for a gallery demo.)

const overviewView = createIslandView(overviewCanvas, ISLAND, 13, overviewOrigin, islandOwners, {
  cloudCorner: cornerBoundsWorld,
  cloudSeed: 11,
  squads: demoSquads,
  dragArrow: demoDragArrow,
  shadowDrift,
  selectedId: 0,
});
const battleView = createIslandView(battleCanvas, ISLAND, S_BATTLE, battleOrigin, islandOwners, {
  cloudCorner: null,
  squads: demoSquads,
  dragArrow: demoDragArrow,
  shadowDrift,
  selectedId: 2,
});

// -------------------------------------------------------------- (b) terrain

const terrainGrid = document.getElementById('terrain-grid');
terrainGrid.style.gridTemplateColumns = `repeat(${TERRAIN_TYPES.length}, minmax(70px, 1fr))`;
const terrainCanvases = TERRAIN_TYPES.map((terrain, i) => {
  const wrap = document.createElement('div');
  wrap.className = 'swatch';
  const canvas = document.createElement('canvas');
  canvas.width = 100; canvas.height = 118;
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = terrain;
  wrap.appendChild(canvas);
  wrap.appendChild(name);
  terrainGrid.appendChild(wrap);
  return { canvas, tile: groundTile(terrain, i * 97 + 13) };
});

function drawTerrainSwatch({ canvas, tile }) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const s = 40;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2 + 20;
  if (isWaterTile(tile)) {
    // drawTileBase no-ops for water now — a single splat over the ocean
    // base is exactly what this swatch should show. Clipped to a hex purely
    // so this standalone card matches the others; the real renderer never
    // clips like this, splats are meant to spill past their own tile.
    ctx.save();
    hexPath(ctx, cx, cy, s * 1.35);
    ctx.clip();
    drawOceanBase(ctx, 0, 0, canvas.width, canvas.height);
    drawWaterSplat(ctx, tile, cx, cy, s);
    ctx.restore();
    return;
  }
  drawTileBase(ctx, tile, cx, cy, s);
  drawCoastFoam(ctx, tile, cx, cy, s);
  drawTileDecor(ctx, tile, cx, cy, s);
}

// --------------------------------------------------- (c) settlement grids

function buildSettlementGrid(container, s, cellW, cellH) {
  const table = document.createElement('table');
  table.className = 'settlement-grid';
  const thead = document.createElement('tr');
  thead.appendChild(document.createElement('th'));
  for (const f of FACTIONS) {
    const th = document.createElement('th');
    th.textContent = f.name;
    th.style.color = f.color;
    thead.appendChild(th);
  }
  table.appendChild(thead);

  const cells = [];
  for (const type of SETTLEMENT_TYPES) {
    const row = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = type;
    row.appendChild(th);
    for (const f of FACTIONS) {
      const td = document.createElement('td');
      const canvas = document.createElement('canvas');
      canvas.width = cellW; canvas.height = cellH;
      td.appendChild(canvas);
      row.appendChild(td);
      cells.push({ canvas, type, faction: f, s });
    }
    table.appendChild(row);
  }
  container.appendChild(table);
  return cells;
}

const grid36 = buildSettlementGrid(document.getElementById('settlement-wrap-36'), 36, 150, 168);
const grid16 = buildSettlementGrid(document.getElementById('settlement-wrap-16'), 16, 82, 96);

function drawSettlementCell(cell, t) {
  const { canvas, type, faction, s } = cell;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const cx = canvas.width / 2;
  const groundY = canvas.height * 0.62;
  const groundTop = groundY - s * 0.16;
  drawTileBase(ctx, groundTile('grass', faction.id * 13 + 5), cx, groundY, s * 1.55);
  drawSettlement(ctx, type, cx, groundTop, s, faction.id);
  const anchor = BANNER_ANCHOR[type] || { dx: 0, dy: -1 };
  drawBanner(ctx, cx + anchor.dx * s, groundTop + anchor.dy * s, s * 0.46, faction.id, t);
}

// --------------------------------------------- (d) squads/badges/banners

const SQUAD_COUNTS = [1, 5, 12, 40, 250];
const squadRow = document.getElementById('squad-row');
const squadCells = SQUAD_COUNTS.map((count, i) => {
  const col = document.createElement('div');
  col.className = 'col';
  const canvas = document.createElement('canvas');
  canvas.width = 150; canvas.height = 130;
  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = `${count} troops`;
  col.appendChild(canvas);
  col.appendChild(label);
  squadRow.appendChild(col);
  return { canvas, count, faction: FACTIONS[(i % 4) + 1] };
});

function drawSquadCell(cell, t) {
  const { canvas, count, faction } = cell;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawTileBase(ctx, groundTile('grass', faction.id * 31 + 3), canvas.width / 2, canvas.height * 0.68, 60);
  drawSquad(ctx, canvas.width / 2, canvas.height * 0.6, count, faction.id, 20, t, 0.4, -1);
}

const badgeRow = document.getElementById('badge-row');
const badgeSpecs = [
  { count: 8, faction: 0, s: 30, pulse: false },
  { count: 128, faction: 2, s: 30, pulse: false },
  { count: 1450, faction: 3, s: 30, pulse: false },
  { count: 34500, faction: 4, s: 30, pulse: false },
  { count: 47, faction: 1, s: 30, pulse: true },
];
const badgeCells = badgeSpecs.map((spec) => {
  const canvas = document.createElement('canvas');
  canvas.width = 120; canvas.height = 64;
  badgeRow.appendChild(canvas);
  return { canvas, spec };
});
function drawBadgeCell(cell, t) {
  const { canvas, spec } = cell;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawTroopBadge(ctx, canvas.width / 2, canvas.height / 2, spec.count, spec.faction, spec.s, {
    pulse: spec.pulse ? t : false,
  });
}

const bannerRow = document.getElementById('banner-row');
const bannerCells = FACTIONS.map((f) => {
  const col = document.createElement('div');
  col.className = 'col';
  const canvas = document.createElement('canvas');
  canvas.width = 110; canvas.height = 140;
  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = f.name;
  col.appendChild(canvas);
  col.appendChild(label);
  bannerRow.appendChild(col);
  return { canvas, faction: f };
});
function drawBannerCell(cell, t) {
  const { canvas, faction } = cell;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBanner(ctx, canvas.width * 0.32, canvas.height * 0.92, 36, faction.id, t);
}

const emblemRow = document.getElementById('emblem-row');
for (const f of FACTIONS) {
  const col = document.createElement('div');
  col.className = 'col';
  const canvas = document.createElement('canvas');
  canvas.width = 90; canvas.height = 100;
  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = `${f.emblem}`;
  col.appendChild(canvas);
  col.appendChild(label);
  emblemRow.appendChild(col);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = shade(f.color, -0.5);
  ctx.beginPath();
  ctx.arc(45, 42, 34, 0, Math.PI * 2);
  ctx.fill();
  drawEmblem(ctx, f.emblem, 45, 42, 46, '#fbf6ea');
}

// ------------------------------------------------------------- render loop

const t0 = performance.now();
function frame() {
  const t = (performance.now() - t0) / 1000;
  overviewView.update(t);
  battleView.update(t);
  for (const s of terrainCanvases) drawTerrainSwatch(s);
  for (const c of grid36) drawSettlementCell(c, t);
  for (const c of grid16) drawSettlementCell(c, t);
  for (const c of squadCells) drawSquadCell(c, t);
  for (const c of badgeCells) drawBadgeCell(c, t);
  for (const c of bannerCells) drawBannerCell(c, t);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ------------------------------------------------------------ (5) bench

function benchDraw(world, s) {
  const w = Math.ceil(Math.sqrt(3) * world.cols * s + s * 2);
  const h = Math.ceil(1.5 * world.rows * s + s * 2);
  const canvas = makeOffscreen(w, h);
  const ctx = canvas.getContext('2d');
  const originX = s;
  const originY = s;
  const start = performance.now();
  // Ocean base + splats first (real bake order), so the timing includes the
  // actual cost of the new water render, not the flat fills it replaced.
  drawOceanBase(ctx, 0, 0, w, h);
  for (let idx = 0; idx < world.tiles.length; idx++) {
    const t = world.tiles[idx];
    if (!isWaterTile(t)) continue;
    drawWaterSplat(ctx, t, originX + t.x * s, originY + t.y * s, s);
  }
  for (let idx = 0; idx < world.tiles.length; idx++) {
    const t = world.tiles[idx];
    const x = originX + t.x * s;
    const y = originY + t.y * s;
    drawTileBase(ctx, t, x, y, s);
    drawCoastFoam(ctx, t, x, y, s);
    drawRiver(ctx, t, x, y, s);
    drawRoad(ctx, t, x, y, s);
    drawTileDecor(ctx, t, x, y, s);
  }
  const ms = performance.now() - start;
  return { ms, w, h, count: world.tiles.length };
}

function runBench() {
  const benchWorld = makeMockWorld(555222, { cols: 50, rows: 40, settlements: [] });
  const r14 = benchDraw(benchWorld, 14);
  const r36 = benchDraw(benchWorld, 36);
  const out = document.getElementById('bench-output');
  const fmt = (r, s) => {
    const perTile = (r.ms / r.count) * 1000;
    return `s=${s}: <b>${r.ms.toFixed(1)} ms</b> for ${r.count} tiles (${perTile.toFixed(2)} µs/tile), canvas ${r.w}×${r.h}`;
  };
  const ok14 = r14.ms < 150;
  out.innerHTML = [
    fmt(r14, 14) + (ok14 ? '  — under the 150 ms target' : '  <span class="warn">— over the 150 ms target</span>'),
    fmt(r36, 36),
  ].join('\n');
}
setTimeout(runBench, 50);
