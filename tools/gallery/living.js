// Living-map gallery: REAL terrain from generateWorld(seed), baked with the same chunk recipe the game
// uses PLUS the prosperity decor hook, then the ambient layers (caravans, smoke, windmill sails, boats,
// birds) drawn in the game's order. Dev-only; nothing here is imported by the game.
//
//   living.html                      interactive (panel + readout)
//   living.html?bare=1               chrome-free (for screenshots), drive it with window.__living
//   living.html?mode=compare         the same village at prosperity 0 / I / II / III, 2x2
//   living.html?mode=level01         the same view at level 0 and level I, side by side (mid zoom)
//   ?seed=7  ?w=..&h=..              world seed
import { generateWorld } from '../../game/world/generate.js';
import { createGame } from '../../game/meta/state.js';
import { revealed } from '../../game/meta/progression.js';
import { updateProsperity, prosperityInfo } from '../../game/meta/prosperity.js';
import { PROSPERITY } from '../../game/config/prosperity.js';
import { AMBIENT } from '../../game/config/ambient.js';
import { createCamera } from '../../game/render/camera.js';
import { createSeaField, seaBackgroundStops } from '../../game/render/seaField.js';
import {
  drawTileBase, drawTileDecor, drawRiver, drawRoad, drawCoastFoam, drawFarmFields, isWaterTile, elevOffset,
} from '../../game/render/tiles.js';
import { drawChunkTerritory } from '../../game/render/territory.js';
import { pickBucket } from '../../game/render/terrainCache.js';
import { createSiteSpriteCache } from '../../game/render/sites.js';
import { createCloudLayer } from '../../game/render/cloudLayer.js';
import { createFx } from '../../game/render/fx.js';
import { createSiteDrawer } from '../../game/scenes/worldLayers.js';
import { createAmbient } from '../../game/render/ambient.js';
import { createProsperityPlan, drawProsperityGround, drawProsperityStructures } from '../../game/render/prosperityDecor.js';
import { formatDuration } from '../../game/core/format.js';

const params = new URLSearchParams(location.search);
const SEED = Number(params.get('seed') || 7);
const COMPARE = params.get('mode') === 'compare';
const LEVEL01 = params.get('mode') === 'level01'; // level 0 and level I side by side at mid zoom (?zoom=26&x=48&y=37)
if (params.get('bare')) document.body.classList.add('bare');
const DPR = Math.min(2, Number(params.get('dpr')) || window.devicePixelRatio || 1);

const world = generateWorld(SEED);
const plan = createProsperityPlan(world);
const T0 = 1_700_000_000_000;
const HOUR = 3600e3;
const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------- the realm ---------
function bfsOrder() {
  const order = [world.startRegion];
  const seen = new Set(order);
  for (let k = 0; k < order.length; k++) {
    for (const nb of [...world.regions[order[k]].neighbors].sort((a, b) => a - b)) {
      if (!seen.has(nb)) { seen.add(nb); order.push(nb); }
    }
  }
  return order;
}
const ownedIds = bfsOrder().slice(0, 8);
// One Harbour region next to the realm, so a boat with player-coloured sails is on show too.
const harbourOwned = world.regions.find((r) => r.perk === 'harbour' && !ownedIds.includes(r.id) && r.neighbors.some((n) => ownedIds.includes(n)));
if (harbourOwned) ownedIds.push(harbourOwned.id);

// A "cluster" is a keep with its market, a village with cottages and fields, and the windmill,
// close enough to frame together. The showcase region is the owned one with the tightest cluster.
function clusterOf(regionId) {
  const region = world.regions[regionId];
  const mills = plan.windmillsOf(regionId);
  if (!mills.length) return null;
  const mill = world.tiles[mills[0].tile];
  const keep = world.tiles[world.settlements[region.keep].tile];
  let market = null;
  const cottageTiles = [];
  for (const ti of plan.regionTiles(regionId)) {
    const i = plan.info(ti);
    if (i.market) market = world.tiles[ti];
    if (i.cottages) cottageTiles.push(world.tiles[ti]);
  }
  let best = null;
  for (const sid of region.settlements) {
    const st = world.settlements[sid];
    if (st.type !== 'village' && st.type !== 'town') continue;
    const village = world.tiles[st.tile];
    const cottages = cottageTiles.filter((c) => Math.hypot(c.x - village.x, c.y - village.y) < 3.2);
    if (!cottages.length) continue;
    const pts = [keep, mill, village, ...cottages, ...(market ? [market] : [])];
    const box = { minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)) };
    const diag = Math.hypot(box.maxX - box.minX, box.maxY - box.minY);
    if (!best || diag < best.diag) best = { diag, box, village, keep, mill, market, cottages };
  }
  return best;
}
function showcase() {
  let best = null;
  let bestScore = Infinity;
  for (const id of ownedIds) {
    const c = clusterOf(id);
    if (!c) continue;
    const r = world.regions[id];
    const score = c.diag - (r.biome === 'grass' || r.biome === 'meadow' ? 3 : 0);
    if (score < bestScore) { bestScore = score; best = id; }
  }
  return best ?? ownedIds[1];
}
const FOCUS0 = showcase();

// ------------------------------------------------------ terrain (game recipe + decor) ---------
const SQ3 = Math.sqrt(3);
function createLivingTerrain(dpr) {
  const { cols, rows, tiles } = world;
  const CHUNK = 8; const PAD_PX = 2; const SEA_PAD = 8;
  const gridMinX = -SQ3 / 2 - SEA_PAD; const gridMaxX = SQ3 * cols + SEA_PAD;
  const gridMinY = -1 - SEA_PAD; const gridMaxY = (rows - 1) * 1.5 + 1 + SEA_PAD;
  const CW = CHUNK * SQ3; const CH = CHUNK * 1.5;
  const chunkCols = Math.ceil((gridMaxX - gridMinX) / CW - 0.1);
  const chunkRows = Math.ceil((gridMaxY - gridMinY) / CH - 0.1);
  const sea = createSeaField(world, { minY: -2, maxY: (rows - 1) * 1.5 + 2 });
  const typeByTile = new Map(world.settlements.map((s) => [s.tile, s.type]));
  const AX = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  const farmNear = (t) => AX.some(([dq, dr]) => {
    const r = t.r + dr; const col = t.q + dq + (r - (r & 1)) / 2;
    if (col < 0 || col >= cols || r < 0 || r >= rows) return false;
    const ty = typeByTile.get(r * cols + col);
    return ty === 'hamlet' || ty === 'village' || ty === 'town';
  });
  const desc = new Map();
  const rowRange = (row, x0, x1) => {
    const sh = (row & 1) / 2;
    return [Math.max(0, Math.ceil(x0 / SQ3 - sh)), Math.min(cols - 1, Math.floor(x1 / SQ3 - sh))];
  };
  function descriptor(cx, cy) {
    const key = cy * chunkCols + cx;
    if (desc.has(key)) return desc.get(key);
    const x0 = gridMinX + cx * CW; const x1 = cx === chunkCols - 1 ? gridMaxX : x0 + CW;
    const y0 = gridMinY + cy * CH; const y1 = cy === chunkRows - 1 ? gridMaxY : y0 + CH;
    const land = []; const regs = new Set();
    const r0 = Math.max(0, Math.ceil((y0 - 1.3) / 1.5)); const r1 = Math.min(rows - 1, Math.floor((y1 + 2.7) / 1.5));
    for (let row = r0; row <= r1; row++) {
      const [c0, c1] = rowRange(row, x0 - 1.3, x1 + 1.3);
      for (let col = c0; col <= c1; col++) {
        const t = tiles[row * cols + col];
        if (isWaterTile(t)) continue;
        land.push(t);
        if (t.region >= 0) regs.add(t.region);
      }
    }
    const d = { cx, cy, x0, x1, y0, y1, land, regions: [...regs] };
    desc.set(key, d);
    return d;
  }
  const baked = new Map();
  let owners = null; let levels = [];
  let curBucket = 0; let lastBakeMs = 0; let bakes = 0;
  const sigOf = (d) => d.regions.map((r) => `${owners ? owners[r] : -1}:${levels[r] | 0}`).join(',');

  function bake(d, bucket, sig) {
    const t0 = performance.now();
    const s = bucket;
    const cw = Math.ceil((d.x1 - d.x0) * s) + PAD_PX * 2;
    const chh = Math.ceil((d.y1 - d.y0) * s) + PAD_PX * 2;
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = chh;
    const ctx = canvas.getContext('2d');
    const ox = PAD_PX - d.x0 * s; const oy = PAD_PX - d.y0 * s;
    sea.paint(ctx, cw, chh, s, ox, oy);
    for (const t of d.land) {
      const x = ox + t.x * s; const y = oy + t.y * s;
      drawTileBase(ctx, t, x, y, s);
      drawCoastFoam(ctx, t, x, y, s);
      drawRiver(ctx, t, x, y, s);
      drawRoad(ctx, t, x, y, s);
      if (t.elev === 1 && t.settlement === -1 && farmNear(t)) drawFarmFields(ctx, x, y - elevOffset(t, s), s, t.i + 1, t);
      drawTileDecor(ctx, t, x, y, s);
      // Prosperity GROUND hook: right after drawTileDecor, before the territory tint (docs/briefs/living-map-hookup.md).
      const info = plan.info(t.i);
      if (info) drawProsperityGround(ctx, t, x, y, s, levels[t.region] | 0, info);
    }
    if (owners) drawChunkTerritory(ctx, world, d.land, owners, s, ox, oy, dpr);
    // Prosperity STRUCTURES hook: after the tint and the borders, so they keep their natural colours.
    for (const t of d.land) {
      const info = plan.info(t.i);
      if (info) drawProsperityStructures(ctx, t, ox + t.x * s, oy + t.y * s, s, levels[t.region] | 0, info);
    }
    baked.set(d.cy * chunkCols + d.cx, { bucket, sig, canvas, w: cw, h: chh, wx: d.x0 - PAD_PX / s, wy: d.y0 - PAD_PX / s });
    lastBakeMs = performance.now() - t0;
    bakes++;
  }

  return {
    setState(o, lv) { owners = o; levels = lv; },
    draw(ctx, cam) {
      const want = pickBucket(cam.zoom * dpr, curBucket);
      if (want !== curBucket) { curBucket = want; }
      const vb = cam.visibleBounds(0);
      const cx0 = Math.max(0, Math.floor((vb.minX - gridMinX) / CW)); const cx1 = Math.min(chunkCols - 1, Math.floor((vb.maxX - gridMinX) / CW));
      const cy0 = Math.max(0, Math.floor((vb.minY - gridMinY) / CH)); const cy1 = Math.min(chunkRows - 1, Math.floor((vb.maxY - gridMinY) / CH));
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const d = descriptor(cx, cy);
          const sig = sigOf(d);
          let e = baked.get(cy * chunkCols + cx);
          if (!e || e.bucket !== curBucket || e.sig !== sig) { bake(d, curBucket, sig); e = baked.get(cy * chunkCols + cx); }
          const k = cam.zoom / e.bucket;
          const p = cam.worldToScreen(e.wx, e.wy);
          ctx.drawImage(e.canvas, p.x, p.y, e.w * k, e.h * k);
        }
      }
    },
    stats: () => ({ lastBakeMs, bakes, bucket: curBucket, chunks: baked.size }),
  };
}

// ------------------------------------------------------------------- a view -----------------
function fitCamera(cam, b, w, h, pad, minZ = 4, maxZ = 200) {
  const zoom = Math.max(minZ, Math.min(maxZ, Math.min((w - 2 * pad) / (b.maxX - b.minX), (h - 2 * pad) / (b.maxY - b.minY))));
  cam.zoom = zoom;
  cam.x = (b.minX + b.maxX) / 2;
  cam.y = (b.minY + b.maxY) / 2;
}
function unionBox(ids) {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const id of ids) {
    const r = world.regions[id].bbox;
    b.minX = Math.min(b.minX, r.minX); b.minY = Math.min(b.minY, r.minY);
    b.maxX = Math.max(b.maxX, r.maxX); b.maxY = Math.max(b.maxY, r.maxY);
  }
  return { minX: b.minX - 1.5, minY: b.minY - 1.5, maxX: b.maxX + 1.5, maxY: b.maxY + 1.5 };
}

function createView(host, opts = {}) {
  const box = document.createElement('div');
  box.className = 'view';
  const canvas = document.createElement('canvas');
  box.appendChild(canvas);
  if (opts.tag) { const tag = document.createElement('div'); tag.className = 'tag'; tag.textContent = opts.tag; box.appendChild(tag); }
  host.appendChild(box);
  const ctx = canvas.getContext('2d', { alpha: false });
  const cam = createCamera({ minZoom: 1, maxZoom: 400 });
  const terrain = createLivingTerrain(DPR);
  const sites = createSiteSpriteCache();
  sites.setPixelRatio(DPR);
  const drawer = createSiteDrawer(world);
  const clouds = createCloudLayer(world);
  clouds.setPixelRatio(DPR);
  const ambient = createAmbient({ world, seed: SEED, plan, pixelRatio: DPR, reduceMotion: false });
  const fx = createFx({ reduceMotion: false });

  const state = createGame(SEED, world, T0);
  state.prosperity = world.regions.map(() => 0);
  for (const id of ownedIds) { state.owner[id] = 0; state.conqueredAt[id] = T0; }
  const v = {
    box, canvas, ctx, cam, state, ambient, terrain, fx, sites, clouds,
    shiftMs: opts.shiftMs || 0, focus: FOCUS0, fog: !!opts.fog, amb: true, routes: false, battle: false,
    forced: opts.forced ?? null, ups: [], frameMs: 0, cssW: 300, cssH: 150,
  };

  v.now = () => T0 + v.shiftMs;
  v.resize = () => {
    const w = Math.max(1, box.clientWidth); const h = Math.max(1, box.clientHeight);
    v.cssW = w; v.cssH = h;
    canvas.width = Math.round(w * DPR); canvas.height = Math.round(h * DPR);
    cam.resize(w, h);
  };
  v.hiddenIds = [];
  v.refresh = () => {
    const now = v.now();
    if (v.forced != null) {
      // Compare mode: every owned region held for exactly the tenure of that level.
      for (const id of ownedIds) v.state.conqueredAt[id] = now - (v.forced === 0 ? 0 : PROSPERITY.thresholdsMs[v.forced - 1] + 1000);
    }
    const ups = updateProsperity(state, world, now);
    const rev = v.fog ? revealed(state, world) : world.regions.map(() => true);
    const owners = state.owner.map((o, r) => (rev[r] ? o : -1));
    terrain.setState(owners, state.prosperity);
    ambient.rebuild(state);
    v.hiddenIds = world.regions.filter((r) => !rev[r.id]).map((r) => r.id);
    ambient.setHiddenMask((r) => !rev[r] || (v.battle && r === v.focus));
    v.rev = rev;
    for (const u of ups) v.onLevelUp?.(u);
    return ups;
  };
  v.forceLevel = (regionId, level) => {
    state.conqueredAt[regionId] = v.now() - (level === 0 ? 0 : PROSPERITY.thresholdsMs[level - 1] + 1000);
    if (level === 0) state.prosperity[regionId] = 0;
    return v.refresh();
  };
  v.frame = (dt, t, nowMs) => {
    const t0 = performance.now();
    cam.resize(v.cssW, v.cssH);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const [top, bottom] = seaBackgroundStops();
    const y0 = cam.worldToScreen(0, -2).y; const y1 = cam.worldToScreen(0, 56).y;
    const g = ctx.createLinearGradient(0, y0, 0, Math.max(y0 + 1, y1));
    g.addColorStop(0, top); g.addColorStop(1, bottom);
    ctx.fillStyle = g; ctx.fillRect(0, 0, v.cssW, v.cssH);
    terrain.draw(ctx, cam);
    const vb = cam.visibleBounds(2);
    if (v.amb) { ambient.update(dt); ambient.drawGround(ctx, cam, vb); }
    const visible = (r) => r < 0 || v.rev[r];
    drawer.draw(ctx, { sites }, cam, state.owner, t, visible, { hideHamlets: cam.zoom < 12 });
    if (v.amb) ambient.drawAir(ctx, cam, vb);
    fx.update(dt); fx.draw(ctx, cam);
    if (v.fog) clouds.draw(ctx, cam, v.hiddenIds, t, nowMs, 1);
    if (v.routes) drawRoutes(ctx, cam, ambient.routes);
    v.frameMs += (performance.now() - t0 - v.frameMs) * 0.1;
  };
  v.resize();
  v.refresh();
  return v;
}

function drawRoutes(ctx, cam, routes) {
  ctx.save();
  ctx.lineWidth = 1.5;
  for (const r of routes) {
    ctx.strokeStyle = r.kind === 'trunk' ? 'rgba(255,220,120,0.9)' : 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    for (let i = 0; i < r.pts.length; i += 2) {
      const p = cam.worldToScreen(r.pts[i], r.pts[i + 1]);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// ------------------------------------------------------------------ camera presets -----------
function showcasePoints(view) {
  const region = world.regions[view.focus];
  const cl = clusterOf(view.focus);
  const keep = world.tiles[world.settlements[region.keep].tile];
  if (cl) return { village: cl.village, keep: cl.keep, mill: plan.windmillsOf(view.focus)[0], cluster: cl };
  return { village: keep, keep, mill: plan.windmillsOf(view.focus)[0] || null, cluster: null };
}

function setPreset(view, name) {
  const { cam, cssW: w, cssH: h } = view;
  const pts = showcasePoints(view);
  const phone = w < 640;
  switch (name) {
    case 'overview': fitCamera(cam, world.bounds, w, h, 24); break;
    case 'mid': fitCamera(cam, unionBox(ownedIds), w, h, 30, 12, 34); break;
    // What the game's realmFraming keeps on a phone: >= ~16 px per hex, centred on the realm.
    case 'phone': fitCamera(cam, unionBox(ownedIds), w, h, 14, 16, 40); break;
    case 'close': {
      if (pts.cluster) {
        const b = pts.cluster.box;
        fitCamera(cam, { minX: b.minX - 2.6, maxX: b.maxX + 2.6, minY: b.minY - 3.2, maxY: b.maxY + 2.2 }, w, h, 8, 20, 90);
      } else { cam.x = pts.village.x; cam.y = pts.village.y; cam.zoom = 60; }
      break;
    }
    case 'village': cam.x = pts.village.x; cam.y = pts.village.y; cam.zoom = phone ? 52 : 90; break;
    case 'keep': cam.x = pts.keep.x; cam.y = pts.keep.y + 0.8; cam.zoom = phone ? 52 : 80; break;
    case 'mill': {
      const m = pts.mill || pts.village;
      cam.x = m.x; cam.y = m.y - 0.3; cam.zoom = phone ? 64 : 100; break;
    }
    case 'harbour': {
      const r = ownedIds.find((id) => world.regions[id].perk === 'harbour') ?? world.regions.find((x) => x.perk === 'harbour').id;
      const region = world.regions[r];
      const c = world.tiles[world.settlements[region.keep].tile];
      cam.x = c.x + 1.5; cam.y = c.y; cam.zoom = phone ? 30 : 46; break;
    }
    default: break;
  }
}

// -------------------------------------------------------------------------- main ----------------
const stage = $('stage');
const views = [];
if (LEVEL01) {
  stage.className = 'level01';
  views.push(createView(stage, { tag: 'Level 0', forced: 0 }));
  views.push(createView(stage, { tag: 'Level I', forced: 1 }));
} else if (COMPARE) {
  stage.className = 'compare';
  const labels = ['Level 0', 'Level I', 'Level II', 'Level III'];
  for (let L = 0; L < 4; L++) {
    views.push(createView(stage, { tag: labels[L], forced: L }));
  }
} else {
  stage.className = 'single';
  views.push(createView(stage, {}));
}
const main = views[0];
for (const v of views) setPreset(v, COMPARE ? 'close' : 'mid');
if (LEVEL01) {
  for (const v of views) { v.cam.x = Number(params.get('x') || 48); v.cam.y = Number(params.get('y') || 37); v.cam.zoom = Number(params.get('zoom') || 26); }
}

const logEl = $('log');
main.onLevelUp = (u) => {
  if (document.body.classList.contains('bare')) return; // no pops in clean screenshots
  const name = world.regions[u.regionId].name;
  logEl.textContent = `${name} prospers! -> ${PROSPERITY.labels[u.level]} (from ${PROSPERITY.labels[u.from] || '0'})\n${logEl.textContent}`.slice(0, 600);
  const t = world.tiles[world.settlements[world.regions[u.regionId].keep].tile];
  main.fx.spawn('floatText', t.x, t.y - 1.4, { text: `${name} prospers!`, color: '#f7d774', size: 0.5 });
  main.fx.spawn('burst', t.x, t.y - 0.3, { color: '#f7d774', flashSize: 1.4, sparkleCount: 8 });
};

function syncPanel() {
  if (COMPARE || LEVEL01) return;
  const info = prosperityInfo(main.state, main.focus, main.now());
  const nextTxt = info.nextInMs == null ? 'top level' : `next in ${formatDuration(info.nextInMs / 1000)}`;
  $('focusLabel').textContent = `Focus: ${world.regions[main.focus].name} (Prosperity ${info.label || '0'} - ${nextTxt})`;
  const h = main.shiftMs / HOUR;
  $('timeLabel').textContent = `Time held: ${Math.floor(h)} h ${Math.round((h % 1) * 60)} min`;
  document.querySelectorAll('[data-level]').forEach((b) => b.classList.toggle('on', Number(b.dataset.level) === info.level));
}

function setHours(h) {
  main.shiftMs = h * HOUR;
  $('time').value = String(Math.round(h * 60));
  main.refresh();
  syncPanel();
}

if (!COMPARE && !LEVEL01) {
  $('time').addEventListener('input', (e) => { main.shiftMs = Number(e.target.value) * 60 * 1000; main.refresh(); syncPanel(); });
  document.querySelectorAll('[data-level]').forEach((b) => b.addEventListener('click', () => { main.forceLevel(main.focus, Number(b.dataset.level)); syncPanel(); }));
  document.querySelectorAll('[data-all]').forEach((b) => b.addEventListener('click', () => {
    for (const id of ownedIds) main.forceLevel(id, Number(b.dataset.all));
    syncPanel();
  }));
  document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setPreset(main, b.dataset.view)));
  let playing = false;
  $('play').addEventListener('click', () => { playing = !playing; $('play').classList.toggle('on', playing); });
  $('reset').addEventListener('click', () => { for (const id of ownedIds) main.state.conqueredAt[id] = T0; main.state.prosperity = world.regions.map(() => 0); setHours(0); });
  $('rm').addEventListener('change', (e) => { for (const v of views) v.ambient.setReduceMotion(e.target.checked); });
  $('fog').addEventListener('change', (e) => { main.fog = e.target.checked; main.refresh(); });
  $('amb').addEventListener('change', (e) => { main.amb = e.target.checked; main.ambient.setEnabled(e.target.checked); });
  $('routes').addEventListener('change', (e) => { main.routes = e.target.checked; });
  $('battle').addEventListener('change', (e) => { main.battle = e.target.checked; main.refresh(); });
  $('quality').addEventListener('input', (e) => { $('qv').textContent = Number(e.target.value).toFixed(2); main.ambient.setQuality(Number(e.target.value)); });
  $('flock').addEventListener('click', () => main.ambient.spawnFlock());
  $('stress').addEventListener('click', () => { for (const id of world.regions.map((r) => r.id)) { main.state.owner[id] = 0; main.state.conqueredAt[id] = main.now() - 9 * HOUR; } main.refresh(); syncPanel(); });
  setInterval(() => { if (playing) setHours(Math.min(9, main.shiftMs / HOUR + 0.25)); }, 250);
  main.canvas.addEventListener('click', (e) => {
    const rect = main.canvas.getBoundingClientRect();
    const w = main.cam.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    let best = null; let bd = 1.3;
    for (const t of world.tiles) {
      if (t.region < 0) continue;
      const d = Math.hypot(t.x - w.x, t.y - elevOffset(t, 1) - w.y);
      if (d < bd) { bd = d; best = t.region; }
    }
    if (best != null && main.state.owner[best] === 0) { main.focus = best; syncPanel(); }
  });
}

// ------------------------------------------------------------------- loop + readout ------------
let last = performance.now();
let fpsAvg = 60;
let paused = false;
function loop(nowMs) {
  if (paused) { last = nowMs; requestAnimationFrame(loop); return; }
  const dt = Math.min(0.25, (nowMs - last) / 1000);
  last = nowMs;
  fpsAvg += (1 / Math.max(dt, 1e-3) - fpsAvg) * 0.05;
  for (const v of views) v.frame(dt, nowMs / 1000, nowMs);
  requestAnimationFrame(loop);
}
window.addEventListener('resize', () => { for (const v of views) v.resize(); });
requestAnimationFrame(loop);

function readout() {
  const s = main.ambient.stats();
  const c = s.caravans;
  const ts = main.terrain.stats();
  const budget = AMBIENT.budgetMs;
  const tot = s.totalMs;
  $('readout').innerHTML = [
    `<b>frame</b> ${main.frameMs.toFixed(1)} ms   ${fpsAvg.toFixed(0)} fps   zoom ${main.cam.zoom.toFixed(1)}   dpr ${DPR}`,
    `<b>ambient</b> ground ${s.groundMs.toFixed(2)}  air ${s.airMs.toFixed(2)}  <span class="${tot <= budget ? 'ok' : 'warn'}">total ${tot.toFixed(2)} ms</span> / ${budget.toFixed(1)}  (main thread; CPU-raster pageshots inflate it)`,
    `<b>caravans</b> ${c.drawn} drawn / ${c.candidates} in view  (routes ${c.routes}, lanes ${c.lanes}, keep ${(c.keepProb * 100).toFixed(0)}%)`,
    `<b>smoke</b> ${s.smokeSources} chimneys, ${s.smokePuffsDrawn} puffs   <b>sails</b> ${s.sailsDrawn}/${s.windmills}`,
    `<b>boats</b> ${s.boatsDrawn}/${s.boats}   <b>birds</b> ${s.birdsActive ? 'flock in flight' : 'none'}${s.reduceMotion ? '   [reduce motion]' : ''}`,
    `<b>terrain</b> bucket ${ts.bucket}  chunks ${ts.chunks}  last bake ${ts.lastBakeMs.toFixed(1)} ms`,
  ].join('\n');
  syncPanel();
}
setInterval(readout, 300);

// ------------------------------------------------------------------ benchmark ------------------
/**
 * Ambient cost per frame INCLUDING raster: draws the ambient layers `frames` times over a sea
 * fill and forces a sync (getImageData) after every frame, once without and once with ambient, on a
 * cleared canvas. The difference is the ambient cost (software raster here: pessimistic).
 */
async function bench({ frames = 240, view = 'mid', batch = 20 } = {}) {
  const v = views[0];
  setPreset(v, view);
  const vb = v.cam.visibleBounds(2);
  // Frames are recorded in batches of `batch` and rastered by ONE sync per batch, so a GPU is not
  // forced to read back after every frame. Base and ambient batches are INTERLEAVED and compared by
  // median, so clock ramp-up and driver noise hit both alike.
  const runBatch = (withAmbient) => {
    const t0 = performance.now();
    for (let i = 0; i < batch; i++) {
      v.ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      v.ctx.fillStyle = '#27668a';
      v.ctx.fillRect(0, 0, v.cssW, v.cssH);
      if (withAmbient) {
        v.ambient.update(1 / 60);
        v.ambient.drawGround(v.ctx, v.cam, vb);
        v.ambient.drawAir(v.ctx, v.cam, vb);
      }
    }
    v.ctx.getImageData(0, 0, 1, 1);
    return (performance.now() - t0) / batch;
  };
  for (let i = 0; i < 6; i++) { runBatch(true); runBatch(false); } // warm sprites, JIT and the GPU clocks
  const baseT = []; const ambT = [];
  for (let i = 0; i < frames / batch; i++) { baseT.push(runBatch(false)); ambT.push(runBatch(true)); }
  const med = (arr) => { const c = arr.slice().sort((x, y) => x - y); return c[Math.floor(c.length / 2)]; };
  const p95 = (arr) => { const c = arr.slice().sort((x, y) => x - y); return c[Math.floor(c.length * 0.95)]; };
  const base = { mean: med(baseT), p95: p95(baseT) };
  const amb = { mean: med(ambT), p95: p95(ambT) };
  // Main-thread cost only (no forced sync): what the JS of the three calls costs per frame.
  const js = [];
  for (let i = 0; i < frames * 4; i++) {
    v.ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const t0 = performance.now();
    v.ambient.update(1 / 60);
    v.ambient.drawGround(v.ctx, v.cam, vb);
    v.ambient.drawAir(v.ctx, v.cam, vb);
    js.push(performance.now() - t0);
    v.ctx.getImageData(0, 0, 1, 1); // outside the timer: no backlog builds up behind the measurement
  }
  js.sort((a, b) => a - b);
  const st = v.ambient.stats();
  return {
    zoom: v.cam.zoom, dpr: DPR, w: v.cssW, h: v.cssH,
    baseMs: +base.mean.toFixed(3), ambientMs: +amb.mean.toFixed(3), deltaMs: +(amb.mean - base.mean).toFixed(3),
    deltaP95: +(amb.p95 - base.p95).toFixed(3), jsGround: +st.groundMs.toFixed(3), jsAir: +st.airMs.toFixed(3),
    jsMean: +(js.reduce((a, b) => a + b, 0) / js.length).toFixed(3), jsP95: +js[Math.floor(js.length * 0.95)].toFixed(3), jsMax: +js[js.length - 1].toFixed(3),
    caravansDrawn: st.caravans.drawn, candidates: st.caravans.candidates, puffs: st.smokePuffsDrawn, sails: st.sailsDrawn,
    boats: st.boatsDrawn, flock: st.birdsActive,
  };
}

/**
 * End-to-end frame cost, ambient on vs off: runs the WHOLE scene (terrain, sites, ambient) in a
 * requestAnimationFrame loop, alternating blocks of frames with the ambient layers on and off, and
 * compares the median rAF-to-rAF interval. Only meaningful when rAF is not capped to vsync (launch
 * Chrome with --disable-frame-rate-limit --disable-gpu-vsync); otherwise both sit at 16.7 ms.
 */
async function benchLoop({ frames = 60, blocks = 4, view = 'mid' } = {}) {
  const v = views[0];
  setPreset(v, view);
  paused = true;
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const runBlock = async (amb) => {
    v.amb = amb; v.ambient.setEnabled(amb);
    const times = []; const js = [];
    let prev = await raf();
    for (let i = 0; i < frames; i++) {
      const t0 = performance.now();
      v.frame(1 / 60, performance.now() / 1000, performance.now());
      js.push(performance.now() - t0);
      const now = await raf();
      times.push(now - prev);
      prev = now;
    }
    const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
    return { interval: med(times), js: med(js) };
  };
  await runBlock(true); await runBlock(false); // warm
  const on = []; const off = [];
  for (let b = 0; b < blocks; b++) { off.push(await runBlock(false)); on.push(await runBlock(true)); }
  const med = (a, k) => a.map((x) => x[k]).sort((x, y) => x - y)[Math.floor(a.length / 2)];
  v.amb = true; v.ambient.setEnabled(true);
  paused = false;
  const st = v.ambient.stats();
  return {
    zoom: +v.cam.zoom.toFixed(1), w: v.cssW, h: v.cssH, dpr: DPR,
    intervalOffMs: +med(off, 'interval').toFixed(2), intervalOnMs: +med(on, 'interval').toFixed(2),
    deltaIntervalMs: +(med(on, 'interval') - med(off, 'interval')).toFixed(2),
    jsFrameOffMs: +med(off, 'js').toFixed(2), jsFrameOnMs: +med(on, 'js').toFixed(2),
    ambientJsMs: +(st.groundMs + st.airMs).toFixed(3),
    caravansDrawn: st.caravans.drawn, puffs: st.smokePuffsDrawn, sails: st.sailsDrawn, boats: st.boatsDrawn,
  };
}

window.__living = {
  benchLoop,
  world, plan, views, main, ownedIds,
  T0, HOUR,
  setPreset: (name, i = 0) => setPreset(views[i], name),
  setHours, setFocus: (id) => { main.focus = id; syncPanel(); },
  forceLevel: (regionId, level) => main.forceLevel(regionId ?? main.focus, level),
  forceAll: (level) => { for (const id of ownedIds) main.forceLevel(id, level); },
  setCamera: (x, y, zoom, i = 0) => { views[i].cam.x = x; views[i].cam.y = y; views[i].cam.zoom = zoom; },
  reduceMotion: (b) => { for (const v of views) v.ambient.setReduceMotion(b); $('rm').checked = !!b; },
  fog: (b) => { main.fog = !!b; main.refresh(); $('fog').checked = !!b; },
  battle: (b) => { main.battle = !!b; main.refresh(); },
  quality: (q) => main.ambient.setQuality(q),
  enabled: (b) => { main.amb = !!b; main.ambient.setEnabled(!!b); },
  routes: (b) => { main.routes = !!b; },
  flock: () => main.ambient.spawnFlock(),
  advance: (sec) => { for (const v of views) { const n = Math.round(sec * 20); for (let i = 0; i < n; i++) v.ambient.update(0.05); } },
  stats: () => main.ambient.stats(),
  bench,
  /** Force the drawing-surface size (a hidden browser pane reports 0x0): for benchmarks. */
  setSize: (w, h) => {
    for (const v of views) {
      v.cssW = w; v.cssH = h;
      v.canvas.width = Math.round(w * DPR); v.canvas.height = Math.round(h * DPR);
      v.cam.resize(w, h);
    }
  },
  /** Per-layer cost: runs the benchmark with only one layer on at a time. */
  benchParts: async (opts = {}) => {
    const out = {};
    for (const only of ['caravans', 'smoke', 'sails', 'boats', 'birds']) {
      const patch = { caravans: false, smoke: false, sails: false, boats: false, birds: false, [only]: true };
      main.ambient.setFeatures(patch);
      if (only === 'birds') main.ambient.spawnFlock();
      const r = await bench(opts);
      out[only] = { deltaMs: r.deltaMs, js: +(r.jsGround + r.jsAir).toFixed(3), drawn: only === 'smoke' ? r.puffs : only === 'caravans' ? r.caravansDrawn : only === 'sails' ? r.sails : only === 'boats' ? r.boats : r.flock };
    }
    main.ambient.setFeatures({ caravans: true, smoke: true, sails: true, boats: true, birds: true });
    return out;
  },
  showcase: () => showcasePoints(main),
  /** Centre the camera on the middle of route `i` (default: the longest visible-realm route). */
  focusRoute: (i, zoom = 90) => {
    const r = main.ambient.routes[i ?? 0];
    const k = Math.floor(r.pts.length / 4) * 2;
    main.cam.x = r.pts[k]; main.cam.y = r.pts[k + 1]; main.cam.zoom = zoom;
    return { id: r.id, kind: r.kind, from: r.from, to: r.to, len: r.length };
  },
  /** Centre on a boat lane (index into the world's Harbour lanes). */
  focusBoat: (i = 0, zoom = 90) => {
    const lane = main.ambient.boatLanes[i];
    const k = Math.floor(lane.pts.length / 4) * 2;
    main.cam.x = lane.pts[k]; main.cam.y = lane.pts[k + 1]; main.cam.zoom = zoom;
    return { region: lane.region, len: lane.length };
  },
  /** Centre on the first chimney of the first owned settlement of `type`. */
  focusChimney: (type = 'village', zoom = 110) => {
    const s = world.settlements.find((x) => x.type === type && main.state.owner[x.region] === 0);
    const t = world.tiles[s.tile];
    main.cam.x = t.x; main.cam.y = t.y - 0.6; main.cam.zoom = zoom;
    return { id: s.id, region: s.region };
  },
  focusId: () => main.focus,
};
