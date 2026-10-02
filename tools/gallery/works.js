// Region Works gallery: every panel and chooser state inside the REAL owned region card (real income,
// prosperity, crowns, real Works data from game/meta/works.js), the five icons and map buildings at every
// size over the ground colours they must survive, and the marks over real terrain drawn by the real
// renderer. Dev-only: nothing here ships.
//
//   works.html                        all views, nav on top
//   works.html?view=chooser           chooser-open states
//   works.html?view=icons             icon and building specimens
//   works.html?view=map&zoom=24       the world map with Works marks at that zoom (px per world unit)
//   works.html?only=mixed,maxed       only those panel states (keys below)
//   works.html?bare=1                 hide the gallery nav (clean screenshots)
//   works.html?sheet=1&only=mixed     one card docked like the phone bottom sheet, with a 50 %-of-screen guide
//   works.html?reduce=1               Reduce Motion on
//   works.html?t=0.6                  freeze the animation clock (deterministic shots)
import { h } from '../../game/ui/dom.js';
import { createRegionCard } from '../../game/ui/regionCard.js';
import { worksIcon, WORKS_ICON_ALL } from '../../game/ui/worksIcons.js';
import { createToasts } from '../../game/ui/toasts.js';
import { generateWorld } from '../../game/world/generate.js';
import { createGame, PLAYER_FACTION } from '../../game/meta/state.js';
import { frontier, revealed, conquer, difficulty } from '../../game/meta/progression.js';
import { prosperityInfo } from '../../game/meta/prosperity.js';
import { getCrowns, parFor } from '../../game/meta/crowns.js';
import * as works from '../../game/meta/works.js';
import { WORKS, WORK_TYPES } from '../../game/config/works.js';
import { effectiveRegionIncome } from '../../game/app/income.js';
import { perkDisplay } from '../../game/app/perkInfo.js';
import { CROWN_BONUS_PCT } from '../../game/app/crownCopy.js';
import { createRenderer } from '../../game/render/renderer.js';
import { createCamera } from '../../game/render/camera.js';
import { createSiteDrawer, regionLabelAnchors } from '../../game/scenes/worldLayers.js';
import { drawRegionLabels } from '../../game/render/labels.js';
import { drawWorksMarks, drawWorkBuilding, worksMarkAlpha, WORK_BUILDING_TYPES } from '../../game/render/worksMarks.js';

const params = new URLSearchParams(location.search);
const SEED = 7;
const FROZEN_T = params.has('t') ? Number(params.get('t')) : null;
const HOUR = 3600 * 1000;
const MIN = 60 * 1000;

if (params.get('bare') === '1') document.body.classList.add('gallery-bare');
if (params.has('only')) document.body.classList.add('only-cards');
if (params.get('sheet') === '1') document.body.classList.add('sheet');
if (window.matchMedia('(max-width: 640px)').matches) document.body.classList.add('phone');
if (params.get('reduce') === '1') document.documentElement.classList.add('reduce-motion');
const REDUCE = document.documentElement.classList.contains('reduce-motion');

// --------------------------------------------------------------------------------------------
// scenario: a real world, six conquests in
// --------------------------------------------------------------------------------------------
const world = generateWorld(SEED);
const NOW = 1_000_000_000_000; // a fixed "now" so prosperity countdowns are the same in every shot

function conquerCheapest(state, n) {
  for (let i = 0; i < n; i += 1) {
    const front = frontier(state, world).sort((a, b) => world.regions[a].tier - world.regions[b].tier || a - b);
    conquer(state, world, front[0], NOW - (n - i) * 25 * MIN);
    state.crowns[front[0]] = { victory: true, swift: i % 2 === 0, unbroken: true };
  }
  return state;
}
const base = conquerCheapest(createGame(SEED, world, NOW - 3 * HOUR), 6);
base.prosperity = world.regions.map(() => 0);
const hero = works.worksTutorialRegion({ ...base, works: {}, stats: { regionsConquered: 6 } }, world);
const heroId = hero >= 0 ? hero : world.startRegion;

/** Region card data exactly as scenes/world.js regionCardData builds it for an owned region. */
function cardData(state, id) {
  const region = world.regions[id];
  const f = world.factions[PLAYER_FACTION];
  const p = prosperityInfo(state, id, NOW);
  return {
    id, name: region.name, tier: region.tier, owned: true,
    owner: { name: f.name, color: f.color, emblem: f.emblem },
    perk: perkDisplay(region.perk, world, region),
    income: effectiveRegionIncome(state, world, region),
    crowns: region.tier === 0 ? undefined : getCrowns(state, id),
    parSec: parFor(world, id, state),
    crownBonusPct: CROWN_BONUS_PCT,
    prosperity: { level: p.level, label: p.label, nextInMs: p.nextInMs, bonusPct: Math.round(p.incomeBonus * 100) },
  };
}

/** A scenario variant: gold, the hero region's prosperity level and Works. */
function variant({ gold, prosperity = 0, list = [], tenureMin }) {
  const state = structuredClone(base);
  state.gold = gold;
  state.prosperity[heroId] = prosperity;
  const tenure = tenureMin != null ? tenureMin * MIN : [5 * MIN, 45 * MIN, 3 * HOUR, 9 * HOUR][prosperity];
  state.conqueredAt[heroId] = NOW - tenure;
  state.works = list.length ? { [heroId]: list.map((w) => ({ ...w })) } : {};
  return state;
}

const RICH = 1e9;
const PANEL_STATES = [
  { key: 'fresh', title: 'Just conquered: one slot, two locked', opts: { gold: RICH, prosperity: 0, tenureMin: 25 } },
  { key: 'fresh-poor', title: 'Just conquered, cannot afford anything', opts: { gold: 12, prosperity: 0, tenureMin: 25 } },
  { key: 'one', title: 'Barracks I, upgrade affordable', opts: { gold: RICH, prosperity: 1, list: [{ type: 'barracks', level: 1 }] } },
  { key: 'one-poor', title: 'Stables II, next level out of reach, a free slot', opts: { gold: 70, prosperity: 2, list: [{ type: 'stables', level: 2 }] } },
  { key: 'mixed', title: 'Three slots: maxed Barracks, Market II, Watchtower I', opts: { gold: RICH, prosperity: 3, list: [
    { type: 'barracks', level: 3 }, { type: 'market', level: 2 }, { type: 'watchtower', level: 1 }] } },
  { key: 'confirm', title: 'Demolish confirm on a level-III Barracks (Keep / Demolish)', confirm: 0, opts: { gold: RICH, prosperity: 3, list: [
    { type: 'barracks', level: 3 }, { type: 'market', level: 2 }, { type: 'watchtower', level: 1 }] } },
  { key: 'maxed', title: 'Everything level III', opts: { gold: RICH, prosperity: 3, list: [
    { type: 'shrine', level: 3 }, { type: 'stables', level: 3 }, { type: 'barracks', level: 3 }] } },
];
const CHOOSER_STATES = [
  { key: 'choose-ready', title: 'Chooser: everything affordable', slot: 0, opts: { gold: RICH, prosperity: 0, tenureMin: 25 } },
  { key: 'choose-mixed', title: 'Chooser: some too dear, one already built', slot: 1, opts: { gold: 140, prosperity: 2, list: [{ type: 'barracks', level: 1 }] } },
  { key: 'choose-poor', title: 'Chooser: nothing affordable', slot: 0, opts: { gold: 9, prosperity: 0, tenureMin: 25 } },
];

// --------------------------------------------------------------------------------------------
// card grids
// --------------------------------------------------------------------------------------------
const toastStack = createToasts();
document.body.appendChild(toastStack.el);
const only = params.get('only') ? new Set(params.get('only').split(',')) : null;
const cells = [];

function makeCell(def, grid) {
  if (only && !only.has(def.key)) return;
  const state = variant(def.opts);
  // The owned region card carries its own Works panel now (ui/regionCard.js), exactly as the game mounts it; the gallery only supplies the data and the callbacks.
  const card = createRegionCard({
    onDemolishWork: (id, slot) => {
      const res = works.demolishWork(state, world, id, slot);
      toastStack.update({ icon: 'coin', message: res ? works.worksToast('demolished', { work: works.workName(res.type), region: world.regions[id].name, refund: res.refund }) : 'Refused (gallery)' });
      refresh();
    },
    onBuildWork: (id, slot, type) => {
      const res = works.buildWork(state, world, id, type);
      toastStack.update({ icon: 'castle', message: res ? works.worksToast('built', { work: works.workName(type), region: world.regions[id].name }) : 'Refused (gallery)' });
      refresh();
    },
    onUpgradeWork: (id, slot) => {
      const res = works.upgradeWork(state, world, id, slot);
      toastStack.update({ icon: 'star', message: res ? works.worksToast('upgraded', { work: works.workName(res.type), region: world.regions[id].name, level: res.level }) : 'Refused (gallery)' });
      refresh();
    },
  });
  const panel = card.works;
  const refresh = () => {
    card.update({ ...cardData(state, heroId), works: works.worksPanelData(state, world, heroId, NOW) });
    reportHeights();
  };
  const label = h('div.state-label', {}, def.title, h('small', {}, ''));
  const cell = h('div.state-cell', { dataset: { key: def.key } }, label, card.el);
  refresh();
  if (def.slot != null) panel.openChooser(def.slot);
  if (def.confirm != null) panel.askDemolish(def.confirm);
  cells.push({ def, cell, card, label, panel, state, refresh });
  grid.appendChild(cell);
}
for (const def of PANEL_STATES) makeCell(def, document.getElementById('panel-grid'));
for (const def of CHOOSER_STATES) makeCell(def, document.getElementById('chooser-grid'));

function reportHeights() {
  for (const { label, card, def } of cells) {
    const px = Math.round(card.el.getBoundingClientRect().height);
    const pct = Math.round((px / window.innerHeight) * 100);
    label.querySelector('small').textContent = `card ${px}px = ${pct}% of ${window.innerHeight}px`;
    def.height = px;
  }
  window.__worksHeights = Object.fromEntries(cells.map(({ def }) => [def.key, def.height]));
}
requestAnimationFrame(() => requestAnimationFrame(reportHeights));

// sheet mode: dock the first card like the phone bottom sheet and draw the 50 % guide
if (document.body.classList.contains('sheet') && cells[0]) {
  const cell = cells[0].cell;
  Object.assign(cell.style, { position: 'fixed', left: '8px', right: '8px', bottom: '8px', width: 'auto', zIndex: 20 });
  document.body.appendChild(h('div', { style: {
    position: 'fixed', left: 0, right: 0, top: '50%', height: 0, borderTop: '2px dashed rgba(255,255,255,0.7)', zIndex: 30, pointerEvents: 'none',
  } }, h('span', { style: {
    position: 'absolute', right: '8px', top: '2px', font: '800 11px Nunito, sans-serif', color: '#fff', textShadow: '0 1px 3px #000',
  } }, 'a 50% sheet ends here')));
}

// --------------------------------------------------------------------------------------------
// icons and building specimens
// --------------------------------------------------------------------------------------------
{
  const row = document.getElementById('icon-row');
  for (const name of WORKS_ICON_ALL) {
    const sizes = h('div.spec-sizes', {}, ...[14, 16, 20, 28, 40].map((px) => {
      const chip = h('span.works-chip', { dataset: { type: name } }, worksIcon(name, px));
      if (px >= 28) { chip.style.width = `${px + 12}px`; chip.style.height = `${px + 12}px`; }
      return chip;
    }));
    row.appendChild(h('div.spec', {}, sizes, name));
  }

  const canvas = document.getElementById('mark-canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = 720;
  const H = 214;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const grounds = ['#e3cf98', '#86b46a', '#e8eef2', '#7e9450', '#8d8478'];
  const gw = W / grounds.length;
  grounds.forEach((c, gi) => {
    ctx.fillStyle = c;
    ctx.fillRect(gi * gw, 0, gw, H);
    WORK_BUILDING_TYPES.forEach((type, ti) => {
      drawWorkBuilding(ctx, type, gi * gw + 24 + ti * 26, 52, 22, { level: (gi + ti) % 3 + 1, color: '#3d7ef0', t: FROZEN_T ?? 0.5 });
    });
    WORK_BUILDING_TYPES.forEach((type, ti) => {
      drawWorkBuilding(ctx, type, gi * gw + 30 + (ti % 3) * 40, 110 + Math.floor(ti / 3) * 52, 30, { level: 3, color: '#3d7ef0', t: FROZEN_T ?? 0.5 });
    });
    [10, 14, 18].forEach((w, i) => {
      drawWorkBuilding(ctx, WORK_BUILDING_TYPES[(gi + i) % 5], gi * gw + 94 + i * 26, 204, w, { level: 1, color: '#3d7ef0' });
    });
  });
}

// --------------------------------------------------------------------------------------------
// map view: real renderer, real terrain, real sites, real labels, then the Works marks
// --------------------------------------------------------------------------------------------
const mapState = structuredClone(base);
const ownedIds = world.regions.filter((r) => mapState.owner[r.id] === PLAYER_FACTION).map((r) => r.id);
mapState.works = {};
{
  const plan = [
    ['barracks', 2], ['market', 3], ['watchtower', 1], ['stables', 2], ['shrine', 1], ['market', 1], ['barracks', 3],
  ];
  ownedIds.forEach((id, i) => {
    const count = [3, 1, 2, 3, 1, 2, 3][i % 7];
    const list = [];
    for (let k = 0; k < count; k += 1) {
      const [type, level] = plan[(i + k * 2) % plan.length];
      if (!list.some((w) => w.type === type)) list.push({ type, level });
    }
    mapState.works[id] = list;
  });
}

function startMap() {
  const canvas = document.getElementById('map');
  const renderer = createRenderer(canvas);
  const camera = createCamera({ minZoom: 0.5, maxZoom: 200 });
  const siteDrawer = createSiteDrawer(world);
  const anchors = regionLabelAnchors(world);
  renderer.setWorld(world);
  const marks = works.worksMarksData(mapState, world);
  const visible = revealed(mapState, world);
  const owners = mapState.owner.map((o, i) => (visible[i] ? o : -1));
  const frontierIds = frontier(mapState, world);
  const realmColor = world.factions[PLAYER_FACTION].color;
  const focusId = params.has('focus') ? Number(params.get('focus')) : null;

  function fit() {
    const cssW = Math.max(1, canvas.clientWidth);
    const cssH = Math.max(1, canvas.clientHeight);
    renderer.resize(cssW, cssH, window.devicePixelRatio || 1);
    camera.resize(cssW, cssH);
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    const ids = focusId != null ? [focusId] : ownedIds;
    for (const id of ids) {
      const b = world.regions[id].bbox;
      minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY); maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY);
    }
    const w = maxX - minX + 4;
    const hgt = maxY - minY + 4;
    camera.zoom = params.has('zoom') ? Number(params.get('zoom')) : Math.min(cssW / w, cssH / hgt);
    camera.x = (minX + maxX) / 2;
    camera.y = (minY + maxY) / 2;
    document.getElementById('map-caption').textContent = `${marks.length} regions with Works · zoom ${camera.zoom.toFixed(1)} px/unit · mark alpha ${worksMarkAlpha(camera.zoom).toFixed(2)}`;
  }
  fit();
  window.addEventListener('resize', fit);

  const labelData = [];
  const frontierSet = new Set(frontierIds);
  for (const region of world.regions) {
    if (!visible[region.id]) continue;
    const a = anchors[region.id];
    const owned = mapState.owner[region.id] === PLAYER_FACTION;
    const rivalCapital = region.isCapital && !owned;
    const datum = { x: a.x, y: a.y, name: region.name, isCapital: rivalCapital, regionId: region.id };
    if (frontierSet.has(region.id)) { datum.difficulty = difficulty(mapState, world, region.id); datum.priority = 1; }
    else datum.priority = rivalCapital ? 2 : owned ? 3 : 4;
    labelData.push(datum);
  }

  let frames = 0;
  function frame(ms) {
    const t = FROZEN_T != null ? FROZEN_T : ms / 1000;
    const { ctx } = renderer;
    renderer.beginFrame(camera);
    renderer.terrain.draw(ctx, camera, owners);
    renderer.terrain.drawGlints(ctx, camera, t);
    renderer.overlays.drawFrontierPulse(ctx, camera, frontierIds, t);
    siteDrawer.draw(ctx, renderer, camera, mapState.owner, t, () => true, { hideHamlets: false });
    // The Works layer: after the settlements, before labels (and, in the game, before clouds and fx).
    drawWorksMarks(ctx, camera, marks, camera.zoom, { color: realmColor, t: REDUCE ? undefined : t });
    drawRegionLabels(ctx, camera, labelData);
    frames += 1;
    if (frames === 120) document.body.dataset.ready = '1';
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// --------------------------------------------------------------------------------------------
// mode switcher
// --------------------------------------------------------------------------------------------
const MODES = ['panels', 'chooser', 'icons', 'map'];
let mapStarted = false;
function selectMode(mode) {
  for (const b of document.querySelectorAll('.gallery-modes button')) b.classList.toggle('is-active', b.dataset.mode === mode);
  for (const m of MODES) document.getElementById(`view-${m}`).hidden = m !== mode;
  if (mode === 'map' && !mapStarted) { mapStarted = true; startMap(); }
  if (mode === 'panels' || mode === 'chooser') requestAnimationFrame(reportHeights);
}
for (const btn of document.querySelectorAll('.gallery-modes button')) btn.addEventListener('click', () => selectMode(btn.dataset.mode));
const initialView = params.get('view');
if (MODES.includes(initialView)) selectMode(initialView);

window.__worksGallery = { world, base, heroId, works, WORKS, WORK_TYPES, cells, cardData, now: NOW };
