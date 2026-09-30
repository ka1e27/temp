// Scout and Sabotage gallery: every panel state inside the REAL region card (real difficulty, real
// income and bounty, real scout reports from generateWorld(7)), plus the world-map marks over real
// terrain drawn by the real renderer. Dev-only: nothing here ships.
//
//   intel.html                       both views, nav on top
//   intel.html?view=map              the world map with garrison badges, weak-point ring and torch marks
//   intel.html?only=scouted,sab-2    only those panel states (keys below)
//   intel.html?bare=1                hide the gallery nav (clean screenshots)
//   intel.html?specimens=1           only the torch specimen strip
//   intel.html?sheet=1&only=scouted  one card docked like the phone bottom sheet, with a 40 %-of-screen guide
//   intel.html?t=0.6                 freeze the animation clock (deterministic shots)
//   intel.html?view=map&focus=0      frame just one scouted region on the map (0 showcase, 1 friendly, 2 third)
import { h } from '../../game/ui/dom.js';
import { createRegionCard } from '../../game/ui/regionCard.js';
import { createIntelPanel } from '../../game/ui/intelPanel.js';
import { createToasts } from '../../game/ui/toasts.js';
import { generateWorld } from '../../game/world/generate.js';
import { createGame } from '../../game/meta/state.js';
import {
  frontier, revealed, conquer, difficulty, playerBattleStats, enemyBattleStats,
} from '../../game/meta/progression.js';
import { bounty } from '../../game/meta/economy.js';
import { effectiveRegionIncome } from '../../game/app/income.js';
import { perkDisplay } from '../../game/app/perkInfo.js';
import * as intel from '../../game/meta/intel.js';
import { INTEL } from '../../game/config/intel.js';
import { createRenderer } from '../../game/render/renderer.js';
import { createCamera } from '../../game/render/camera.js';
import { createSiteDrawer, regionLabelAnchors } from '../../game/scenes/worldLayers.js';
import { drawRegionLabels } from '../../game/render/labels.js';
import { WORLD_SCENE } from '../../game/scenes/timing.js';
import { drawScoutedGarrisons, drawWeakPointMarker, drawSabotageMark } from '../../game/render/intelMarks.js';

const params = new URLSearchParams(location.search);
const SEED = 7;
const FROZEN_T = params.has('t') ? Number(params.get('t')) : null;

if (params.get('bare') === '1') document.body.classList.add('gallery-bare');
if (params.has('only')) document.body.classList.add('only-cards');
if (params.get('specimens') === '1') document.body.classList.add('specimens-only');
if (params.get('sheet') === '1') document.body.classList.add('sheet');
if (window.matchMedia('(max-width: 640px)').matches) document.body.classList.add('phone');
if (params.get('reduce') === '1') document.documentElement.classList.add('reduce-motion');

// --------------------------------------------------------------------------------------------
// scenario: a real world and a few real states
// --------------------------------------------------------------------------------------------
const world = generateWorld(SEED);

function conquerCheapest(state, n) {
  for (let i = 0; i < n; i += 1) {
    const front = frontier(state, world).sort((a, b) => world.regions[a].tier - world.regions[b].tier || a - b);
    conquer(state, world, front[0], 0);
  }
  return state;
}

/** The frontier region with the richest composition: forts and towers make the best showcase. */
function showcaseRegion(state) {
  let best = null;
  for (const id of frontier(state, world).sort((a, b) => a - b)) {
    const r = intel.scoutReport(state, world, id);
    const types = new Set(r.sites.map((s) => s.type));
    const score = (types.has('fort') ? 3 : 0) + (types.has('tower') ? 3 : 0) + types.size
      + (world.regions[id].faction >= 2 ? 1 : 0);
    if (!best || score > best.score) best = { id, score };
  }
  return best.id;
}

const fresh = createGame(SEED, world, 0);                 // start of a dynasty: the tutorial region is free
const mid = conquerCheapest(createGame(SEED, world, 0), 3); // three regions in: a rival border with forts and towers
const showcase = showcaseRegion(mid);
const midFront = frontier(mid, world).sort((a, b) => a - b);
const friendly = midFront.find((id) => world.regions[id].faction === 1) ?? midFront.find((id) => id !== showcase);
const third = midFront.find((id) => id !== showcase && id !== friendly) ?? friendly;
const tutorial = intel.tutorialRegionId(fresh, world);

// Has Balance applied `troopMult *= sabotageTroopMult(...)` inside enemyBattleStats yet?
const probe = structuredClone(mid);
probe.intel = { [showcase]: { scouted: true, sabotage: 2 } };
const hookLanded = enemyBattleStats(world, probe, showcase).troopMult
  < enemyBattleStats(world, mid, showcase).troopMult - 1e-9;

/** Region card data exactly as scenes/world.js regionCardData builds it. */
function cardData(state, id) {
  const region = world.regions[id];
  const f = world.factions[state.owner[id]];
  return {
    id, name: region.name, tier: region.tier, owned: false,
    owner: { name: f.name, color: f.color, emblem: f.emblem },
    perk: perkDisplay(region.perk, world, region),
    income: effectiveRegionIncome(state, world, region),
    bounty: bounty(state, world, id),
    difficulty: difficulty(state, world, id),
  };
}

/** Panel data from the real meta layer; until the hook lands, emulate what enemyBattleStats will do to the report. */
function panelData(state, id) {
  const d = intel.intelPanelData(state, world, id);
  if (d.scouted && d.sabotage > 0 && !hookLanded) {
    const player = playerBattleStats(state, world);
    const enemy = enemyBattleStats(world, state, id);
    d.report = intel.scoutReport(state, world, id, player,
      { ...enemy, troopMult: enemy.troopMult * intel.sabotageTroopMult(state, id) });
  }
  return d;
}

function variant(base, id, { gold, scouted = false, sabotage = 0 }) {
  const state = structuredClone(base);
  state.gold = gold;
  state.intel = scouted ? { [id]: { scouted: true, sabotage } } : {};
  return state;
}

const RICH = 1e7;
const STATES = [
  { key: 'base', title: 'No intel panel (the card today)', region: showcase, base: mid, opts: { gold: RICH }, noPanel: true },
  { key: 'unscouted', title: 'Unscouted, affordable', region: friendly, base: mid, opts: { gold: RICH } },
  { key: 'poor', title: 'Unscouted, cannot pay', region: friendly, base: mid, opts: { gold: 5 } },
  { key: 'free', title: 'Unscouted, free (tutorial region)', region: tutorial, base: fresh, opts: { gold: 0 } },
  { key: 'scouted', title: 'Scouted, no sabotage', region: showcase, base: mid, opts: { gold: RICH, scouted: true } },
  { key: 'sab-1', title: 'Sabotage 1 of 2', region: showcase, base: mid, opts: { gold: RICH, scouted: true, sabotage: 1 } },
  { key: 'sab-2', title: 'Sabotage 2 of 2 (maxed)', region: showcase, base: mid, opts: { gold: RICH, scouted: true, sabotage: 2 } },
  { key: 'scouted-poor', title: 'Scouted, cannot afford sabotage', region: showcase, base: mid, opts: { gold: 30, scouted: true } },
  { key: 'scouted-free-folk', title: 'Scouted Free Folk region', region: third, base: mid, opts: { gold: RICH, scouted: true } },
];

// --------------------------------------------------------------------------------------------
// panel view
// --------------------------------------------------------------------------------------------
const grid = document.getElementById('state-grid');
const only = params.get('only') ? new Set(params.get('only').split(',')) : null;
const toastStack = createToasts();
document.body.appendChild(toastStack.el);

const cells = [];
for (const def of STATES) {
  if (only && !only.has(def.key)) continue;
  const state = variant(def.base, def.region, def.opts);
  const card = createRegionCard();
  const panel = createIntelPanel({
    onScout: (id) => {
      const res = intel.scout(state, world, id);
      toastStack.update({ icon: 'eye', message: res ? intel.intelToast('scouted', { region: world.regions[id].name }) : 'Refused (gallery)' });
      refresh();
    },
    onSabotage: (id) => {
      const res = intel.sabotage(state, world, id);
      toastStack.update({ type: 'warning', icon: 'flame', message: res ? intel.intelToast('sabotaged', { region: world.regions[id].name, pct: intel.sabotagePercent(res.level) }) : 'Refused (gallery)' });
      refresh();
    },
  });

  const label = h('div.state-label', {}, def.title, h('small', {}, ''));
  const cell = h('div.state-cell', { dataset: { key: def.key } }, label, card.el);

  function refresh() {
    card.update(cardData(state, def.region));
    // Mount exactly where integration will: inside the card body, under the difficulty bar.
    const matchup = card.el.querySelector('.region-card-matchup');
    if (def.noPanel) return;
    matchup.after(panel.el);
    panel.update(panelData(state, def.region));
  }
  refresh();
  cells.push({ def, cell, card, label, refresh });
  grid.appendChild(cell);
}

function reportHeights() {
  for (const { label, card, def } of cells) {
    const px = Math.round(card.el.getBoundingClientRect().height);
    const pct = Math.round((px / window.innerHeight) * 100);
    label.querySelector('small').textContent = `card ${px}px = ${pct}% of ${window.innerHeight}px`;
    def.height = px;
  }
  window.__intelHeights = Object.fromEntries(cells.map(({ def }) => [def.key, def.height]));
}
requestAnimationFrame(() => requestAnimationFrame(reportHeights));

const note = document.getElementById('hook-note');
if (!hookLanded) {
  note.hidden = false;
  note.textContent = 'enemyBattleStats does not apply sabotageTroopMult yet (Balance: one line, see docs/briefs/intel-hookup.md). '
    + 'Sabotaged cards below emulate it for the scout report; the difficulty bar still shows the un-sabotaged region.';
}

// sheet mode: dock the first card like the phone bottom sheet and draw the 40 % guide
if (document.body.classList.contains('sheet') && cells[0]) {
  const cell = cells[0].cell;
  Object.assign(cell.style, { position: 'fixed', left: '8px', right: '8px', bottom: '8px', width: 'auto', zIndex: 20 });
  const guide = h('div', { style: {
    position: 'fixed', left: 0, right: 0, top: '60%', height: 0, borderTop: '2px dashed rgba(255,255,255,0.7)', zIndex: 30, pointerEvents: 'none',
  } }, h('span', { style: {
    position: 'absolute', right: '8px', top: '2px', font: '800 11px Nunito, sans-serif', color: '#fff', textShadow: '0 1px 3px #000',
  } }, 'a 40% sheet ends here'));
  document.body.appendChild(guide);
}

// --------------------------------------------------------------------------------------------
// specimen strip: the torch at label sizes over the four ground colours it has to survive
// --------------------------------------------------------------------------------------------
{
  const canvas = document.getElementById('specimen-canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = 480 * dpr;
  canvas.height = 96 * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const grounds = ['#e8d3a4', '#86b26a', '#eef3f5', '#6f6a63'];
  const sizes = [12, 16, 22, 32];
  grounds.forEach((c, gi) => {
    ctx.fillStyle = c;
    ctx.fillRect(gi * 120, 0, 120, 96);
    sizes.forEach((sz, si) => drawSabotageMark(ctx, gi * 120 + [14, 36, 62, 94][si], 34, sz, 0.6));
    ctx.font = "700 13px Cinzel, Georgia, serif";
    ctx.fillStyle = 'rgba(20,16,10,0.85)';
    ctx.fillText('Fenwall', gi * 120 + 10, 82);
    drawSabotageMark(ctx, gi * 120 + 78, 78, 15, 0.6);
  });
}

// --------------------------------------------------------------------------------------------
// mode switcher
// --------------------------------------------------------------------------------------------
const MODES = ['panels', 'map'];
let mapStarted = false;
function selectMode(mode) {
  for (const b of document.querySelectorAll('.gallery-modes button')) b.classList.toggle('is-active', b.dataset.mode === mode);
  document.getElementById('view-panels').hidden = mode !== 'panels';
  document.getElementById('view-map').hidden = mode !== 'map';
  if (mode === 'map' && !mapStarted) { mapStarted = true; startMap(); }
  if (mode === 'panels') requestAnimationFrame(reportHeights);
}
for (const btn of document.querySelectorAll('.gallery-modes button')) btn.addEventListener('click', () => selectMode(btn.dataset.mode));
const initialView = params.get('view');
if (MODES.includes(initialView)) selectMode(initialView);

// --------------------------------------------------------------------------------------------
// map view: real renderer, real terrain, real sites, real labels, then the intel marks
// --------------------------------------------------------------------------------------------
function startMap() {
  const canvas = document.getElementById('map');
  const renderer = createRenderer(canvas);
  const camera = createCamera({ minZoom: 0.5, maxZoom: 200 });
  const siteDrawer = createSiteDrawer(world);
  const anchors = regionLabelAnchors(world);
  renderer.setWorld(world);

  // Three scouted regions with different stories.
  const scenes = [
    { id: showcase, sabotage: 1, weak: true },
    { id: friendly, sabotage: 0, weak: false },
    { id: third, sabotage: 2, weak: false },
  ].filter((s, i, all) => all.findIndex((o) => o.id === s.id) === i);

  const mapState = structuredClone(mid);
  mapState.intel = {};
  for (const s of scenes) mapState.intel[s.id] = { scouted: true, sabotage: s.sabotage };
  const reports = new Map();
  for (const s of scenes) reports.set(s.id, panelData(mapState, s.id).report);

  const visible = revealed(mapState, world);
  const owners = mapState.owner.map((o, i) => (visible[i] ? o : -1));
  const frontierIds = frontier(mapState, world);

  function fit() {
    const cssW = Math.max(1, canvas.clientWidth);
    const cssH = Math.max(1, canvas.clientHeight);
    renderer.resize(cssW, cssH, window.devicePixelRatio || 1);
    camera.resize(cssW, cssH);
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    const focus = params.has('focus') ? scenes[Number(params.get('focus'))] : null;
    for (const s of focus ? [focus] : scenes) {
      const b = world.regions[s.id].bbox;
      minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY);
    }
    const w = maxX - minX + 3;
    const hgt = maxY - minY + 3.5;
    camera.zoom = Math.min(cssW / w, cssH / hgt);
    camera.x = (minX + maxX) / 2;
    camera.y = (minY + maxY) / 2;
    const caption = document.getElementById('map-caption');
    caption.textContent = `${world.regions[showcase].name}: scouted, sabotage 1 (torch, weak-point ring) · ${world.regions[friendly].name}: scouted · ${world.regions[third].name}: sabotage 2 · zoom ${camera.zoom.toFixed(1)}`;
  }
  fit();
  window.addEventListener('resize', fit);

  const labelData = [];
  const frontierSet = new Set(frontierIds);
  for (const region of world.regions) {
    if (!visible[region.id]) continue;
    const a = anchors[region.id];
    const owned = mapState.owner[region.id] === 0;
    const rivalCapital = region.isCapital && !owned;
    const datum = { x: a.x, y: a.y, name: region.name, isCapital: rivalCapital, regionId: region.id };
    if (frontierSet.has(region.id)) { datum.difficulty = difficulty(mapState, world, region.id); datum.priority = 1; }
    else datum.priority = rivalCapital ? 2 : owned ? 3 : 4;
    labelData.push(datum);
  }

  let frames = 0;
  const reduce = document.documentElement.classList.contains('reduce-motion');
  function frame(ms) {
    const t = FROZEN_T != null ? FROZEN_T : ms / 1000;
    const { ctx } = renderer;
    renderer.beginFrame(camera);
    renderer.terrain.draw(ctx, camera, owners);
    renderer.terrain.drawGlints(ctx, camera, t);
    renderer.overlays.drawFrontierPulse(ctx, camera, frontierIds.filter((id) => id !== showcase), t);
    renderer.overlays.drawSelected(ctx, camera, showcase, t);
    siteDrawer.draw(ctx, renderer, camera, mapState.owner, t, () => true, { hideHamlets: false });

    // --- intel marks: garrison badges on scouted regions, the ring on the suggested first strike
    for (const s of scenes) {
      const report = reports.get(s.id);
      drawScoutedGarrisons(ctx, camera, report.sites, world.regions[s.id].faction, camera.zoom, { force: true });
      if (s.weak) {
        const weak = report.sites.find((x) => x.id === report.weakPoint);
        drawWeakPointMarker(ctx, camera, weak, camera.zoom, t, { reduceMotion: reduce });
      }
    }

    drawRegionLabels(ctx, camera, labelData);
    // The torch by the label (integration puts this inside labels.js; see the hookup doc).
    const fontPx = Math.max(11, Math.min(23, camera.zoom * 0.66));
    ctx.font = `700 ${fontPx}px Cinzel, Georgia, serif`;
    // Labels fade out between these zooms (render/labels.js labelAlpha); the torch fades with its label.
    const lz = camera.zoom;
    const labelFade = lz <= WORLD_SCENE.labelFadeStartZoom ? 1
      : lz >= WORLD_SCENE.labelFadeEndZoom ? 0 : 1 - (lz - WORLD_SCENE.labelFadeStartZoom) / (WORLD_SCENE.labelFadeEndZoom - WORLD_SCENE.labelFadeStartZoom);
    ctx.save();
    ctx.globalAlpha = labelFade;
    for (const s of scenes) {
      if (!s.sabotage || labelFade <= 0.01) continue;
      const a = anchors[s.id];
      const p = camera.worldToScreen(a.x, a.y);
      const nameW = ctx.measureText(world.regions[s.id].name).width;
      drawSabotageMark(ctx, p.x + nameW / 2 + fontPx * 0.8, p.y - fontPx * 0.6 - fontPx * 0.32, fontPx * 1.15, reduce ? undefined : t);
    }
    ctx.restore();

    frames += 1;
    if (frames === 120) document.body.dataset.ready = '1';
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

if (initialView === 'map') { /* selectMode already started it */ } else if (params.get('autostartmap') === '1') selectMode('map');

window.__intelGallery = { world, mid, fresh, showcase, friendly, third, tutorial, hookLanded, INTEL };
