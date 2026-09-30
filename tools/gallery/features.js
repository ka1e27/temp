// Crowns + rival leaders gallery. Renders every state of the crown row, the leader banner for all
// four factions across every trigger (real lines from game/meta/leaders.js), the map pips over a
// terrain strip, and the components in context (results card, region cards, phone sheet, HUDs).
//
//   features.html?mode=crowns|leaders|pips|compose   pick a page (nav buttons do the same)
//   &bare=1                                          hide the gallery nav (for screenshots)
//   &f=crimson&t=keepAssaulted                       freeze the live leader banner on one line
//   &rm=1                                            start with Reduce Motion on
import { h, mount } from '../../game/ui/dom.js';
import { icon } from '../../game/ui/icons.js';
import { createCrownRow, swiftLabel } from '../../game/ui/crownRow.js';
import { createLeaderBanner } from '../../game/ui/leaderBanner.js';
import { createHud } from '../../game/ui/hud.js';
import { createBattleHud } from '../../game/ui/battleHud.js';
import { createRegionCard } from '../../game/ui/regionCard.js';
import { createResults } from '../../game/ui/results.js';
import { createRealm } from '../../game/ui/realm.js';
import { createToasts } from '../../game/ui/toasts.js';
import { createCoach } from '../../game/ui/coach.js';
import { drawCrownPips } from '../../game/render/crownPips.js';
import { drawTileBase, drawHexTint, elevOffset } from '../../game/render/tiles.js';
import { createSfx } from '../../game/audio/sfx.js';
import { FACTIONS } from '../../game/config/world.js';
import { LEADER_TRIGGERS, LEADER_FACTIONS, LEADERS, LEADER_LINES } from '../../game/config/leaders.js';
import { createLeaderVoice, leaderFor } from '../../game/meta/leaders.js';
import { CROWN_BONUS_PCT, CROWN_TEXTS } from '../../game/app/crownCopy.js';

const params = new URLSearchParams(location.search);
const MODES = ['crowns', 'leaders', 'pips', 'compose'];
const FACTION_KEYS = { freefolk: 1, crimson: 2, violet: 3, amber: 4 };
const SAMPLE_REGIONS = { 1: 'Millbrook', 2: 'Ashport', 3: 'Thistlemere', 4: 'Dunvale' };
const sfx = createSfx();

if (params.get('bare') === '1') document.body.classList.add('gallery-bare');
if (params.get('rm') === '1') document.documentElement.classList.add('reduce-motion');

function selectMode(mode) {
  for (const b of document.querySelectorAll('.gallery-modes button')) b.classList.toggle('is-active', b.dataset.mode === mode);
  for (const m of MODES) document.getElementById(`view-${m}`).hidden = m !== mode;
}
for (const btn of document.querySelectorAll('.gallery-modes button')) btn.addEventListener('click', () => selectMode(btn.dataset.mode));
if (MODES.includes(params.get('mode'))) selectMode(params.get('mode'));

// --------------------------------------------------------------------------- helpers
const section = (title, ...content) => h('div.g-section', {}, h('h2', {}, title), ...content);
const note = (text) => h('p.g-note', {}, text);
const slot = (cls) => h(`div.g-slot.${cls}`, {});
const place = (el, style) => Object.assign(el.style, { position: 'absolute' }, style);
const button = (label, onClick, extra = '') => h(`button.g-btn${extra}`, { type: 'button', onClick }, label);

function toggleReduceMotion(btn) {
  const on = document.documentElement.classList.toggle('reduce-motion');
  btn.classList.toggle('is-on', on);
  btn.textContent = on ? 'Reduce Motion: ON' : 'Reduce Motion: off';
}

// =========================================================================== CROWNS
{
  const view = document.getElementById('view-crowns');
  const STATES = [
    ['Not conquered', null],
    ['Surrender', { victory: true, swift: false, unbroken: false }],
    ['Victory + Swift', { victory: true, swift: true, unbroken: false }],
    ['Victory + Unbroken', { victory: true, swift: false, unbroken: true }],
    ['All three', { victory: true, swift: true, unbroken: true }],
  ];
  const panels = [];
  for (const [size, par] of [['sm', 60], ['md', 90], ['lg', 150]]) {
    const panel = h('div.g-panel.glass-panel', {});
    for (const [label, earned] of STATES) {
      const row = createCrownRow({ size, texts: CROWN_TEXTS });
      row.update({ earned, parSec: par, durationSec: earned && earned.swift ? par - 12 : par + 21 });
      panel.appendChild(h('div.g-row', {}, h('span', {}, label), row.el));
    }
    const bonusRow = createCrownRow({ size, texts: CROWN_TEXTS });
    bonusRow.update({ earned: STATES[4][1], parSec: par, bonusPct: CROWN_BONUS_PCT });
    panel.appendChild(h('div.g-row', {}, h('span', {}, 'With +25%'), bonusRow.el));
    panels.push(section(`Size ${size} — par ${swiftLabel(par).replace('Swift ≤ ', '')}`, panel));
  }

  // animated award
  const live = createCrownRow({
    size: 'lg',
    texts: CROWN_TEXTS,
    onAward: (key, i) => { counter.textContent = `${i + 1} crown${i ? 's' : ''} landed (${key})`; sfx.play('upgrade', { pitch: 1 + i * 0.16, volume: 0.7 }); },
  });
  const counter = h('span.g-note', {}, 'press Replay');
  const replayBtn = button('Replay award', () => {
    sfx.unlock();
    counter.textContent = 'awarding...';
    live.update({ earned: { victory: true, swift: true, unbroken: true }, parSec: 90, animate: false });
    requestAnimationFrame(() => live.update({ earned: { victory: true, swift: true, unbroken: true }, parSec: 90, animate: true, bonusPct: CROWN_BONUS_PCT }));
  });
  const rmBtn = button('Reduce Motion: off', () => toggleReduceMotion(rmBtn));
  if (params.get('rm') === '1') { rmBtn.classList.add('is-on'); rmBtn.textContent = 'Reduce Motion: ON'; }
  const awardPanel = h('div.g-panel.glass-panel', {}, live.el, h('div.g-tools', {}, replayBtn, rmBtn, counter));
  live.update({ earned: { victory: true, swift: true, unbroken: true }, parSec: 90, animate: true, bonusPct: CROWN_BONUS_PCT });
  view.appendChild(h('div.g-grid', {},
    section('Animated award (about 350 ms apart)', awardPanel,
      note('Each crown pops, rings and sparks; Reduce Motion (toggle above) skips the pop and simply fades in. onAward fires per crown (the sound is the existing "upgrade" cue, pitched up per crown).')),
    ...panels));
}

// =========================================================================== LEADERS
{
  const view = document.getElementById('view-leaders');
  const state = { seed: 7, dynasty: { level: 1, stars: 0 }, settings: { leaderVoices: true } };
  const voice = createLeaderVoice({ getState: () => state, minGapSec: 0 });
  const factionObj = (id) => FACTIONS[id];

  function sampleLine(id, trigger) {
    voice.resetBattle();
    return voice.say(trigger, { faction: id, region: SAMPLE_REGIONS[id], nowSec: performance.now() / 1000 });
  }

  // four static banners
  const statics = h('div.g-static', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });
  const staticBanners = [];
  for (const id of [2, 3, 4, 1]) {
    const b = createLeaderBanner();
    staticBanners.push({ id, b });
    statics.appendChild(b.el);
  }
  const trigOrder = ['battleStart', 'keepAssaulted', 'keepLost', 'surrenderOffer'];
  function showStatics(trigger) {
    for (const { id, b } of staticBanners) {
      const s = sampleLine(id, trigger);
      b.update({ faction: factionObj(id), name: s.name, title: s.title, line: s.line, durationMs: 0 });
    }
  }
  showStatics('battleStart');
  const trigButtons = h('div.g-tools', {}, ...LEADER_TRIGGERS.map((t) => button(t, () => showStatics(t))));

  // live, auto-hiding banner over a map-ish backdrop, cycling through everything
  const liveSlot = slot('g-map.h-360');
  const liveBanner = createLeaderBanner();
  place(liveBanner.el, { top: '20px', left: '50%' });
  liveBanner.el.style.setProperty('--leader-banner-top', '20px');
  liveSlot.appendChild(liveBanner.el);
  const liveLabel = h('span.g-note', {}, '');
  const combos = [];
  for (const t of LEADER_TRIGGERS) for (const id of [2, 3, 4, 1]) combos.push([id, t]);
  let ci = 0;
  function speak(id, t, sticky) {
    const s = sampleLine(id, t);
    liveLabel.textContent = `${t} · ${LEADERS[id].key}`;
    liveBanner.update({ faction: factionObj(id), name: s.name, title: s.title, line: s.line, durationMs: sticky ? 0 : undefined });
  }
  const pinned = params.get('t');
  if (pinned && FACTION_KEYS[params.get('f')]) {
    speak(FACTION_KEYS[params.get('f')], pinned, true);
  } else {
    const step = () => { const [id, t] = combos[ci++ % combos.length]; speak(id, t, false); };
    step();
    setInterval(step, 5200);
  }
  const rmBtn = button('Reduce Motion: off', () => toggleReduceMotion(rmBtn));
  if (params.get('rm') === '1') { rmBtn.classList.add('is-on'); rmBtn.textContent = 'Reduce Motion: ON'; }

  // one seeded sample of every faction x trigger, so the writing can be read in one place
  const table = h('table.g-table', {},
    h('thead', {}, h('tr', {}, h('th', {}, 'Trigger'), ...[2, 3, 4, 1].map((id) => h('th', {}, `${LEADERS[id].title} ${leaderFor(state.seed, 1, id).name}`)))),
    h('tbody', {}, ...LEADER_TRIGGERS.map((t) => h('tr', {}, h('td', {}, t),
      ...[2, 3, 4, 1].map((id) => h('td', {}, sampleLine(id, t).line))))));

  view.appendChild(h('div.g-grid', {},
    section('All four leaders (sticky, one trigger at a time)', statics, trigButtons,
      note('Names are seeded (seed 7, dynasty 1). Titles are fixed.')),
    section('Live banner: auto-hides after ~4 s, click-through', liveSlot,
      h('div.g-tools', {}, rmBtn, liveLabel),
      note('Cycles every faction x trigger. ?f=violet&t=keepAssaulted freezes it on one line.')),
    section('The writing: one seeded pick per faction and trigger', h('div.g-panel.glass-panel', { style: { overflowX: 'auto' } }, table))));
  // give the writing table the full row
  view.querySelector('.g-grid').lastElementChild.style.gridColumn = '1 / -1';
}

// =========================================================================== PIPS
{
  const view = document.getElementById('view-pips');
  const TILES = [
    { terrain: 'grass', elev: 1, jitter: 0.3, height: 0.4, name: 'Ashmere', n: 0 },
    { terrain: 'meadow', elev: 1, jitter: 0.7, height: 0.5, name: 'Fenwall', n: 1 },
    { terrain: 'forest', elev: 1, jitter: 0.5, height: 0.45, name: 'Oakhollow', n: 2 },
    { terrain: 'hills', elev: 2, jitter: 0.6, height: 0.7, name: 'Ironridge', n: 3 },
    { terrain: 'beach', elev: 1, jitter: 0.4, height: 0.3, name: 'Wynbay', n: 3 },
    { terrain: 'snow', elev: 1, jitter: 0.5, height: 0.6, name: 'Frostgard', n: 2 },
    { terrain: 'desert', elev: 1, jitter: 0.2, height: 0.5, name: 'Dunvale', n: 1 },
    { terrain: 'marsh', elev: 1, jitter: 0.8, height: 0.35, name: 'Reedmoor', n: 3 },
  ];

  // A patch of real terrain tiles, one terrain per label segment, under the azure owned tint.
  function drawStrip(canvas, dpr, { total, sizePx }) {
    // narrow screens get fewer, wider segments instead of a squashed strip
    const W = Math.min(780, document.documentElement.clientWidth - 40);
    const tiles = W < 560 ? TILES.filter((_, i) => i % 2 === 0) : TILES;
    const H = 150;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    canvas.style.maxWidth = 'none';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#27668a';
    ctx.fillRect(0, 0, W, H);
    const s = 26;
    const tw = Math.sqrt(3) * s;
    const seg = W / tiles.length;
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < Math.ceil(W / tw) + 1; col++) {
        const cx = col * tw + (row % 2 ? tw / 2 : 0);
        const cy = 14 + row * s * 1.5;
        const t = tiles[Math.min(tiles.length - 1, Math.max(0, Math.floor(cx / seg)))];
        const tile = { land: true, terrain: t.terrain, elev: t.elev, jitter: ((col * 7 + row * 13) % 10) / 10, height: t.height };
        drawTileBase(ctx, tile, cx, cy, s);
        drawHexTint(ctx, cx, cy - elevOffset(tile, s), s, '#3d7ef0', 0.2);
      }
    }
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    tiles.forEach((t, i) => {
      const cx = seg * (i + 0.5);
      const ty = 66;
      ctx.font = '700 13px Cinzel, Georgia, serif';
      ctx.lineWidth = 3.6;
      ctx.strokeStyle = 'rgba(20,16,10,0.75)';
      ctx.fillStyle = '#f3ead7';
      ctx.strokeText(t.name, cx, ty);
      ctx.fillText(t.name, cx, ty);
      drawCrownPips(ctx, cx, ty + 14, t.n, sizePx, { total });
    });
  }

  function stripPanel(title, dpr, opts, cls = '') {
    const c = h(`canvas.g-canvas${cls}`, {});
    drawStrip(c, dpr, opts);
    return { node: section(title, c), canvas: c };
  }

  const draw = () => {
    const a = stripPanel('Device DPR 1, 11 px pips', 1, { total: 0, sizePx: 11 });
    const b = stripPanel('Device DPR 2, 11 px pips', 2, { total: 0, sizePx: 11 });
    const c = stripPanel('DPR 2, 11 px pips with hollow slots (total = 3)', 2, { total: 3, sizePx: 11 });
    const d = stripPanel('DPR 2, 14 px pips (zoomed-in world)', 2, { total: 0, sizePx: 14 });

    // 4x pixel zoom of a crop of the DPR 2 strip: shows whether the outline is crisp on device pixels
    const zoom = h('canvas.g-canvas.g-zoom', {});
    const crop = { x: 100 * 2, y: 50 * 2, w: 150 * 2, h: 44 * 2 };
    zoom.width = crop.w;
    zoom.height = crop.h;
    zoom.style.width = `${crop.w * 2.4}px`;
    zoom.style.maxWidth = '100%';
    zoom.getContext('2d').drawImage(b.canvas, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);

    view.replaceChildren(h('div.g-pips-wrap', {},
      note('Owned-region labels: name in Cinzel, then earned crowns as gold pips with a dark outline. Tiles are the real terrain sprites under the azure owned tint.'),
      a.node, b.node, c.node, d.node,
      section('DPR 2 pixel zoom (each square is one device pixel)', zoom)));
  };
  // Cinzel must be loaded before the canvas text is drawn, or the labels fall back to Georgia
  const fonts = document.fonts && document.fonts.load ? Promise.race([document.fonts.load('700 12px Cinzel'), new Promise((r) => setTimeout(r, 1500))]) : Promise.resolve();
  fonts.then(draw, draw);
}

// =========================================================================== COMPOSE
{
  const view = document.getElementById('view-compose');
  const ALL = { victory: true, swift: true, unbroken: true };

  // --- victory card with the row awarded one by one
  const resultsSlot = slot('g-map.h-520');
  const results = createResults({ crownTexts: CROWN_TEXTS });
  const resultsRow = createCrownRow({ size: 'lg', texts: CROWN_TEXTS, onAward: (_k, i) => sfx.play('upgrade', { pitch: 1 + i * 0.16, volume: 0.6 }) });
  results.update({
    result: 'victory', regionName: 'Millbrook', bounty: 90, newIncome: 1.0,
    perk: { icon: 'tree', name: 'Timberland', text: '+6% growth' },
    durationSec: 54, troopsLost: 12, troopsKilled: 41,
  });
  const body = results.el.querySelector('.results-body');
  const statsGrid = results.el.querySelector('.results-stats-grid');
  const crownBlock = h('div.results-crowns', { style: { margin: '2px 0 4px' } }, resultsRow.el);
  body.insertBefore(crownBlock, statsGrid);
  // the "+22 crown bonus" line the integration would add
  statsGrid.appendChild(h('div.results-stat', {}, icon('crown', 18), h('span', {}, '+68 crown bonus')));
  resultsRow.update({ earned: ALL, parSec: 60, animate: true, durationSec: 54, bonusPct: CROWN_BONUS_PCT });
  resultsSlot.appendChild(results.el);
  const replay = button('Replay award', () => { sfx.unlock(); resultsRow.replay(); });

  // --- region cards: frontier (target crowns + par), owned (earned crowns)
  const frontierSlot = slot('g-map.h-520');
  const frontierCard = createRegionCard({ crownTexts: CROWN_TEXTS });
  place(frontierCard.el, { top: '16px', left: '16px', right: '16px', maxWidth: 'none' });
  frontierCard.update({
    id: 1, name: 'Millbrook', tier: 1, owner: { name: 'Free Folk', color: '#9a927f', emblem: 'wheat' },
    perk: { icon: 'tree', name: 'Timberland', text: '+6% troop growth' }, income: 1.0, bounty: 90,
    difficulty: { power: 32.4, strength: 17.7, ratio: 1.83, label: 'Easy', surrender: false },
  });
  const frontierRow = createCrownRow({ size: 'sm', texts: CROWN_TEXTS });
  frontierRow.update({ earned: null, parSec: 60 });
  frontierCard.el.querySelector('.region-card-body').insertBefore(
    h('div.crowns-block', {}, h('div.g-note', { style: { margin: '0 0 4px', color: 'var(--text-muted)', textShadow: 'none' } }, 'Crowns: +25% bounty each'), frontierRow.el),
    frontierCard.el.querySelector('.region-card-rewards'));
  frontierSlot.appendChild(frontierCard.el);

  const ownedSlot = slot('g-map.h-360');
  const ownedCard = createRegionCard({ crownTexts: CROWN_TEXTS });
  place(ownedCard.el, { top: '16px', left: '16px', right: '16px', maxWidth: 'none' });
  ownedCard.update({
    id: 4, name: 'Ashport', tier: 2, owned: true, owner: { name: 'Your Realm', color: '#3d7ef0', emblem: 'star' },
    perk: { icon: 'pick', name: 'Iron Hills', text: '+5% attack' }, income: 1.55,
  });
  const ownedRow = createCrownRow({ size: 'sm', texts: CROWN_TEXTS });
  ownedRow.update({ earned: { victory: true, swift: false, unbroken: true }, parSec: 90 });
  ownedCard.el.querySelector('.region-card-body').appendChild(ownedRow.el);
  ownedSlot.appendChild(ownedCard.el);

  // --- realm rows
  const realmSlot = slot('g-map.h-620');
  const realm = createRealm({});
  realm.update({
    stats: { battlesWon: 41, battlesLost: 9, regionsConquered: 17, goldEarned: 48200, troopsSent: 5400, settlementsTaken: 96, surrenders: 3, bestBattleSec: 38, playSec: 9800 },
    dynasty: { level: 2, stars: 3 }, canFoundDynasty: false,
  });
  const grid = realm.el.querySelector('.realm-stats-grid');
  const mkStat = (label, value) => h('div.realm-stat', {}, icon('crown', 16), h('span.realm-stat-label', {}, label), h('span.realm-stat-value.nums', {}, value));
  grid.appendChild(mkStat('Crowns this dynasty', '38 / 78'));
  grid.appendChild(mkStat('Crowns, lifetime', '61'));
  place(realm.el, { top: '50%', left: '50%' });
  realmSlot.appendChild(realm.el);

  // --- banner under the real HUDs (top-centre lane). The first frame is wrapped in a real #ui so the
  // shipped "glide below a toast" rule (#ui:has(.toasts > .toast)) is live; press the button to fire one.
  const hudSlot = slot('g-map.h-360');
  const uiRoot = h('div', { id: 'ui' });
  const hud = createHud({});
  hud.update({ gold: 1284, incomePerSec: 3.42, dynastyStars: 2 });
  const toasts = createToasts();
  const banner1 = createLeaderBanner({ below: () => [hud.el, toasts.el] });
  uiRoot.append(hud.el, banner1.el, toasts.el);
  hudSlot.appendChild(uiRoot);
  const speak1 = () => banner1.update({ faction: FACTIONS[2], name: leaderFor(7, 1, 2).name, title: 'Warlord', line: 'Enjoy Ashport. You’ll be handing it back in pieces.', durationMs: 0 });
  const toastBtn = button('Fire a toast', () => {
    toasts.update({ type: 'success', icon: 'coin', message: '+90 gold', duration: 3000 });
    speak1();
  });

  const battleSlot = slot('g-map.h-520');
  const battleHud = createBattleHud({});
  battleHud.update({
    regionName: 'Ashport', territory: { you: 0.55, enemy: 0.45, youColor: '#3d7ef0', enemyColor: '#d8433f' },
    timeSec: 47, sendFraction: 0.5, speed: 2, paused: false,
    powers: [{ id: 'rally', name: 'Rally', icon: 'horn', level: 1, locked: false, cooldownSec: 0, armed: false }],
  });
  const banner2 = createLeaderBanner({
    below: () => [battleHud.el.querySelector('.battle-top'), battleHud.el.querySelector('.battle-topright')],
  });
  battleSlot.append(battleHud.el, banner2.el);
  const speak2 = () => banner2.update({ faction: FACTIONS[3], name: leaderFor(7, 1, 3).name, title: 'High Seer', line: 'I foresaw the breach. I did not foresee how rude it would be.', durationMs: 0 });

  const stack = (...nodes) => h('div', { style: { display: 'flex', flexDirection: 'column', gap: '20px', minWidth: 0 } }, ...nodes);
  view.append(h('div.g-grid', {},
    section('Victory card, crowns awarded one by one', resultsSlot, h('div.g-tools', {}, replay)),
    section('Region card: frontier (par + empty crowns) and owned (earned)', stack(frontierSlot, ownedSlot)),
    section('Realm: crown totals rows (mock)', realmSlot)),
  h('div.g-grid', { style: { gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 640px), 1fr))', marginTop: '20px' } },
    section('World: HUD, leader banner and a toast (banner glides below it)', hudSlot, h('div.g-tools', {}, toastBtn)),
    section('Battle: HUD pill and leader banner', battleSlot,
      note('At a real 390 px viewport (pageshot --w=390) every media query applies, so the phone HUDs are checked by resizing the page rather than by a fake frame.'))));
  // the banners measure the HUDs they sit under, so they speak once everything is in the document
  speak1();
  speak2();
  void createCoach;
}
