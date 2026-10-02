// Keepsakes gallery: the Chronicle inside the REAL Realm panel (empty, a few entries, a full chapter, all time over three
// dynasties; real conquests through the real meta layer feed it), and the Tapestry composed over a whole-continent map
// rendered by the REAL renderer through game/scenes/worldImage.js (docs/briefs/keepsakes-hookup.md, section 5). Dev-only: nothing
// in tools/ ships.
//
//   keepsakes.html                      chronicle states
//   keepsakes.html?view=tapestry        the tapestry (&color=%23d8433f for another realm colour, &w=700 map width, &save=1 to download)
//   keepsakes.html?only=few,all         only those chronicle states (keys: empty, few, full, all)
//   keepsakes.html?bare=1               hide the gallery nav (clean screenshots)
//   keepsakes.html?only=few&dialog=1    keep the Realm panel a live modal dialog (focus trap, inert page), as in the game
import { h } from '../../game/ui/dom.js';
import { createRealm } from '../../game/ui/realm.js';
import { createChroniclePanel } from '../../game/ui/chroniclePanel.js';
import { closeDialog } from '../../game/ui/dialogs.js';
import { createSaveMapButton } from '../../game/ui/saveMapButton.js';
import { createModal } from '../../game/ui/modal.js';
import { generateWorld } from '../../game/world/generate.js';
import { createGame, resetRegions, PLAYER_FACTION } from '../../game/meta/state.js';
import { conquer, foundDynasty, frontier } from '../../game/meta/progression.js';
import { awardCrowns } from '../../game/meta/crowns.js';
import {
  chronicleOnConquest, chronicleOnProsperity, chronicleOnDynasty, chroniclePanelData, chronicleEntries, recordChronicle,
} from '../../game/meta/chronicle.js';
import { tapestryData, saveText } from '../../game/meta/keepsake.js';
import { CHRONICLE } from '../../game/config/chronicle.js';
import { createRng } from '../../game/core/rng.js';
import { renderWorldImage, saveTapestry } from '../../game/scenes/worldImage.js';
import {
  composeTapestry, downloadCanvas, ensureTapestryFonts, tapestryFilename, formatTapestryDate,
} from '../../game/render/tapestry.js';

const params = new URLSearchParams(location.search);
if (params.get('bare') === '1') document.body.classList.add('gallery-bare');
if (params.get('stats1') === '1') document.body.classList.add('stats-one');
if (window.matchMedia('(max-width: 640px)').matches) document.body.classList.add('phone');

const DAY = CHRONICLE.dayMs;
const NOW = Date.UTC(2026, 8, 30, 14, 0, 0); // a fixed "now" so every relative date is the same in every shot
const SEED = 7;

// --------------------------------------------------------------------------------------------
// a realm played through the real meta layer
// --------------------------------------------------------------------------------------------
/** Conquers `count` regions, cheapest first, spread over [startT, endT], feeding the chronicle exactly as the game will. */
function play(state, world, { count, startT, endT, rngSeed, prosperityAt = 0.7 }) {
  const rng = createRng(rngSeed);
  for (let i = 0; i < count; i += 1) {
    const front = frontier(state, world).sort((a, b) => world.regions[a].tier - world.regions[b].tier || a - b);
    if (!front.length) break;
    const id = front[0];
    const t = Math.round(startT + ((endT - startT) * (i + 1)) / count);
    const surrender = rng.next() < 0.14 && i > 1;
    const swift = rng.next() < 0.55;
    const crowns = surrender ? { victory: true, swift: false, unbroken: false } : { victory: true, swift, unbroken: rng.next() < 0.85 };
    const battleSec = surrender ? 0 : 42 + rng.next() * 90; // battles are not getting steadily faster: records stay rare
    const result = conquer(state, world, id, t);
    awardCrowns(state, world, id, surrender ? { victory: true, swift: false, unbroken: false } : crowns, result.bounty);
    state.stats.regionsConquered += 1;
    chronicleOnConquest(state, world, id, { crowns, battleSec, surrender, decapitated: !!result.decapitated, t });
    if (count > 8 && i === Math.floor(count * prosperityAt)) {
      chronicleOnProsperity(state, world, [{ regionId: world.startRegion, level: 3, from: 2 }], { t: t + 3600000 });
    }
  }
}

function realmStats(state, world, extra = {}) {
  const owned = world.regions.filter((r) => state.owner[r.id] === PLAYER_FACTION).length;
  return {
    stats: {
      battlesWon: 41, battlesLost: 9, regionsConquered: owned - 1, goldEarned: 48200, troopsSent: 5400, settlementsTaken: 96,
      surrenders: 3, crownsEarned: 61, bestBattleSec: 38, playSec: 9800, ...extra,
    },
    dynasty: { level: state.dynasty.level, stars: state.dynasty.stars },
    canFoundDynasty: false,
    crowns: { earned: 38, possible: 72 },
  };
}

function build(key) {
  const world = generateWorld(SEED);
  const state = createGame(SEED, world, NOW - 3 * DAY);
  if (key === 'empty') return { world, state };
  if (key === 'few') {
    state.conqueredAt[world.startRegion] = NOW - 7 * 3600000;
    play(state, world, { count: 6, startT: NOW - 6.5 * 3600000, endT: NOW - 25 * 60000, rngSeed: 11 });
    return { world, state };
  }
  if (key === 'full') {
    play(state, world, { count: 24, startT: NOW - 3 * DAY + 1800000, endT: NOW - 40 * 60000, rngSeed: 5 });
    // a long realm: top the chapter up to its cap with more perfect victories and surrenders, so the scroll is real
    const names = world.regions.map((r) => r.name);
    let i = 0;
    const rivals = [{ factionId: 2, faction: 'Crimson Legion', leader: 'Warlord Korius' }, { factionId: 3, faction: 'Violet Covenant', leader: 'High Seer Selavane' }, { factionId: 4, faction: 'Free Folk', leader: 'Reeve Alfton' }];
    const mixed = ['tripleCrown', 'surrender', 'fastest', 'prosperity3', 'surrender', 'tripleCrown', 'fastest'];
    while (chronicleEntries(state).length < CHRONICLE.maxEntries && i < 400) {
      i += 1;
      const regionId = (i * 5) % names.length;
      const base = { region: names[regionId], regionId, ...rivals[i % rivals.length] };
      const kind = mixed[i % mixed.length];
      const extra = kind === 'tripleCrown' ? { streak: CHRONICLE.streakMilestones[i % 3] }
        : kind === 'fastest' ? { sec: 40 + (i % 9), prev: 52 + (i % 7) } : {};
      recordChronicle(state, { kind, t: NOW - 2 * DAY + i * 2400000, data: { ...base, ...extra } });
    }
    return { world, state };
  }
  // all time: three dynasties, each on its own continent, the last still young
  const worlds = [world];
  play(state, world, { count: 24, startT: NOW - 3 * DAY + 1800000, endT: NOW - 3 * DAY + 20 * 3600000, rngSeed: 5 });
  for (const [seed, level, startAt, endAt, count] of [[1234, 2, NOW - 2 * DAY + 3600000, NOW - 40 * 3600000 + 6 * 3600000, 24], [99, 3, NOW - 20 * 3600000, NOW - 2 * 3600000, 9]]) {
    const next = foundDynasty(Object.assign(state, { owner: state.owner.map(() => PLAYER_FACTION) }), seed);
    Object.assign(state, next);
    const w = generateWorld(seed, { dynasty: level });
    resetRegions(state, w, startAt);
    chronicleOnDynasty(state, w, { t: startAt });
    play(state, w, { count, startT: startAt + 3600000, endT: endAt, rngSeed: seed });
    worlds.push(w);
  }
  return { world: worlds[worlds.length - 1], state };
}

// --------------------------------------------------------------------------------------------
// chronicle states, in the real Realm panel
// --------------------------------------------------------------------------------------------
const STATES = [
  { key: 'empty', title: 'Empty: a new realm', mode: 'dynasty' },
  { key: 'few', title: 'A few entries: a young realm', mode: 'dynasty' },
  { key: 'full', title: 'Full chapter (40 entries, capped), scrolling', mode: 'dynasty' },
  { key: 'all', title: 'All time: highlights across three dynasties', mode: 'all' },
];
const only = params.get('only') ? new Set(params.get('only').split(',')) : null;

const realms = [];

const saveWords = (busy) => ({ label: saveText('button'), busyLabel: saveText('busy'), busy });
/** What the game's onSaveMap does: busy label, saveTapestry, then the toast words (here: shown in the gallery's own line). */
async function runSave(button, state, world, key) {
  button.update(saveWords(true));
  const res = await saveTapestry(state, world, NOW);
  button.update(saveWords(false));
  const words = res.ok ? saveText('done', { file: res.file }) : saveText('failed');
  const line = document.querySelector(`.state-cell[data-key="${key}"] .state-label small`);
  if (line) line.textContent = words;
  window.__saved = res;
  window.__savedWords = words;
}
for (const def of STATES) {
  if (only && !only.has(def.key)) continue;
  const { world, state } = build(def.key);
  // the Realm panel as the game builds it: the Chronicle and "Save the map" are part of it (ui/realm.js), fed through update()
  const realm = createRealm({ onSaveMap: () => runSave(realm.saveMap, state, world, def.key) });
  realms.push(realm);
  const panel = realm.chronicle;
  const body = realm.el.querySelector('.realm-body');
  realm.update({ ...realmStats(state, world), chronicle: chroniclePanelData(state, world, NOW), save: { ...saveWords(false), hint: saveText('hint') } });
  if (def.mode === 'all') panel.setMode('all');
  const grid = document.getElementById('chronicle-grid');
  const counts = `${chronicleEntries(state).length} entries this dynasty`;
  grid.appendChild(h('div.state-cell', { dataset: { key: def.key } },
    h('div.state-label', {}, def.title, h('small', {}, counts)),
    h('div.realm-frame', {}, realm.el)));
  // on a phone the real Realm body scrolls (the stats come first); show the panel scrolled to the Chronicle, unless ?top=1
  if (document.body.classList.contains('phone') && !params.get('top')) {
    body.scrollTop = body.scrollTop + panel.el.getBoundingClientRect().top - body.getBoundingClientRect().top - 6;
  }
  window.__keepsakes = window.__keepsakes || {};
  window.__keepsakes[def.key] = { world, state, panel, realm, data: () => chroniclePanelData(state, world, NOW) };
}

// ?modal=1: the real Found a Dynasty confirmation (ui/realm.js confirmFound) with the Save the map button added to its body.
if (params.get('modal')) {
  const { world, state } = build('full');
  state.dynasty = { level: 2, stars: 4 };
  const save = createSaveMapButton({ onSave: () => runSave(save, state, world, 'modal') });
  save.update(saveWords(false));
  const body = h('div.keepsake-modal-body', {},
    h('p', { style: { margin: 0 } }, 'Gold, upgrades and the map reset. A new continent awaits, with tougher enemies. Dynasty stars and your lifetime records carry over forever.'),
    h('div.keepsake-save-box', {}, h('p.keepsake-save-note', {}, saveText('hint')), save.el));
  const modal = createModal({
    title: 'Found a new dynasty?',
    body,
    actions: [
      { label: 'Not yet', variant: 'secondary', onClick: () => modal.destroy() },
      { label: 'Found it', variant: 'primary', onClick: () => modal.destroy() },
    ],
  }, { onDismiss: () => modal.destroy() });
  document.body.appendChild(modal.el);
  document.body.dataset.ready = '1';
}

// The Realm panel registers itself as a modal dialog (everything else becomes inert, Tab is trapped). Four panels side by side
// would inert each other, so the gallery releases them, unless ?dialog=1: then they behave exactly as in the game (use it with
// ?only=few to drive the keyboard through the real dialog).
if (!params.get('dialog')) queueMicrotask(() => { for (const r of realms) closeDialog(r.el); });

// --------------------------------------------------------------------------------------------
// the tapestry: the real world image + the composed keepsake
// --------------------------------------------------------------------------------------------
function startTapestry() {
  const { world, state } = build('full');
  // a realm in its second dynasty with some history behind it, so the stats are not zeros
  state.dynasty = { level: 2, stars: 4 };
  state.stats = { ...state.stats, battlesWon: 1284, playSec: 2 * 86400 + 14 * 3600 };
  const width = Number(params.get('w')) || CHRONICLE.tapestryWidth.desktop;
  const t0 = performance.now();
  const map = renderWorldImage({ world, state, width, scale: 2 });
  const mapMs = Math.round(performance.now() - t0);
  const t1 = performance.now();
  const data = tapestryData(state, world, NOW);
  if (params.get('color')) data.factionColor = params.get('color');
  const tapestry = composeTapestry({ mapCanvas: map, ...data });
  const composeMs = Math.round(performance.now() - t1);
  const file = tapestryFilename({ dynasty: data.dynasty, date: data.date });
  const stage = document.getElementById('tapestry-stage');
  stage.replaceChildren(tapestry);
  document.getElementById('tapestry-info').textContent = `map ${map.width}x${map.height} in ${mapMs} ms, tapestry ${tapestry.width}x${tapestry.height} in ${composeMs} ms, file ${file}`;
  document.getElementById('tapestry-note').textContent = `${formatTapestryDate(data.date)}. The map is the real renderer's whole continent (game/scenes/worldImage.js), the words come from game/meta/keepsake.js, the frame is game/render/tapestry.js.`;
  document.getElementById('save-btn').onclick = () => downloadCanvas(tapestry, file);
  // the exact call the game's "Save the map" button makes (render + frame + download in one go)
  const realBtn = document.getElementById('save-real-btn');
  realBtn.onclick = async () => {
    realBtn.disabled = true;
    realBtn.textContent = saveText('busy');
    const t = performance.now();
    const res = await saveTapestry(state, world, NOW);
    realBtn.disabled = false;
    realBtn.textContent = saveText('button');
    document.getElementById('tapestry-info').textContent = (res.ok ? saveText('done', { file: res.file }) : saveText('failed')) + ` (${Math.round(performance.now() - t)} ms)`;
    window.__saved = res;
  };
  document.body.dataset.ready = '1';
  window.__tapestry = { tapestry, map, mapMs, composeMs, data, file };
  if (params.get('save') === '1') downloadCanvas(tapestry, file);
}

// --------------------------------------------------------------------------------------------
// mode switcher
// --------------------------------------------------------------------------------------------
const MODES = ['chronicle', 'tapestry'];
let tapestryStarted = false;
async function selectMode(mode) {
  for (const b of document.querySelectorAll('.gallery-modes button')) b.classList.toggle('is-active', b.dataset.mode === mode);
  for (const m of MODES) document.getElementById(`view-${m}`).hidden = m !== mode;
  if (mode === 'tapestry' && !tapestryStarted) {
    tapestryStarted = true;
    await ensureTapestryFonts();
    startTapestry();
  }
}
for (const btn of document.querySelectorAll('.gallery-modes button')) btn.addEventListener('click', () => selectMode(btn.dataset.mode));
const initialView = params.get('view');
if (MODES.includes(initialView)) selectMode(initialView);
else document.body.dataset.ready = '1';
