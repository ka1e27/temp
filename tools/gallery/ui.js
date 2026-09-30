// UI kit gallery (ARCHITECTURE §2). Renders every game/ui component with
// realistic mock data so the whole kit can be screenshotted and critiqued
// against DESIGN §7.5 without booting the real game. Imports the real
// components and, where it's cheap and more honest than hand-faked numbers,
// the real game/meta/upgrades.js catalogue too — this file is a dev tool,
// not a game/ui component, so that's fair game (unlike game/ui/* itself,
// which must never import game/meta).
import { h, mount } from '../../game/ui/dom.js';
import { icon, ICON_NAMES } from '../../game/ui/icons.js';
import { createHud } from '../../game/ui/hud.js';
import { createRegionCard } from '../../game/ui/regionCard.js';
import { createCouncil } from '../../game/ui/council.js';
import { createBattleHud } from '../../game/ui/battleHud.js';
import { createResults } from '../../game/ui/results.js';
import { createTitle } from '../../game/ui/title.js';
import { createModal } from '../../game/ui/modal.js';
import { createToasts } from '../../game/ui/toasts.js';
import { createSettings } from '../../game/ui/settings.js';
import { createRealm } from '../../game/ui/realm.js';
import { createCoach } from '../../game/ui/coach.js';
import { createWelcome } from '../../game/ui/welcome.js';
import { createDevPanel } from '../../game/ui/devpanel.js';
import { createTooltip } from '../../game/ui/tooltip.js';
import { UPGRADES, upgradeCost, levelOf, buy, buyMax } from '../../game/meta/upgrades.js';
import { dynastyStarText } from '../../game/app/perkInfo.js';

const FACTIONS = {
  player: { name: 'Your Realm', color: '#3d7ef0', emblem: 'star' },
  freefolk: { name: 'Free Folk', color: '#9a927f', emblem: 'wheat' },
  crimson: { name: 'Crimson Legion', color: '#d8433f', emblem: 'sword' },
  violet: { name: 'Violet Covenant', color: '#9b5de5', emblem: 'eye' },
  amber: { name: 'Amber Horde', color: '#f29e38', emblem: 'sun' },
};

// --------------------------------------------------------------------------
// mode switcher
// --------------------------------------------------------------------------
const MODES = ['kit', 'composition', 'battle', 'title'];
function selectMode(mode) {
  for (const b of document.querySelectorAll('.gallery-modes button')) b.classList.toggle('is-active', b.dataset.mode === mode);
  for (const m of MODES) document.getElementById(`view-${m}`).hidden = m !== mode;
}
for (const btn of document.querySelectorAll('.gallery-modes button')) {
  btn.addEventListener('click', () => selectMode(btn.dataset.mode));
}

// ?bare=1&mode=battle — hides the gallery's own chrome and jumps straight
// to a mode, so a screenshot at any viewport size shows exactly what the
// real game would render there (nav can't be clicked to switch modes once
// it's hidden, hence `mode` as a query param too).
const params = new URLSearchParams(location.search);
if (params.get('bare') === '1') document.body.classList.add('gallery-bare');
const initialMode = params.get('mode');
if (initialMode && MODES.includes(initialMode)) selectMode(initialMode);

// --------------------------------------------------------------------------
// small layout helpers
// --------------------------------------------------------------------------
function section(title, ...content) {
  return h('div.gallery-section', {}, h('h2', {}, title), ...content);
}
function slot(modifier) {
  return h(modifier ? `div.gallery-slot.${modifier}` : 'div.gallery-slot', {});
}
function place(el, style) {
  Object.assign(el.style, { position: 'absolute' }, style);
  return el;
}

const kitGrid = h('div.gallery-kit-grid', {});
document.getElementById('view-kit').appendChild(kitGrid);

// --------------------------------------------------------------------------
// Icons
// --------------------------------------------------------------------------
{
  // NOT grid-column:span 2 — a "wide" grid item collided with auto-fill's
  // column count in a way that, at some viewport widths, quietly rendered a
  // ghost 2nd column that overflowed the page (see composition-card and the
  // battlehud mobile stacking fixes above for the same family of bug).
  // A uniform single-width card avoids the interaction entirely; the
  // swatches grid just wraps to fewer columns inside it.
  const grid = h('div.icon-swatches', {},
    ...ICON_NAMES.map((name) => h('div.icon-swatch', {}, icon(name, 26), h('span', {}, name))));
  kitGrid.appendChild(section(`Icons (${ICON_NAMES.length})`, h('div.gallery-panel-static', {}, grid)));
}

// --------------------------------------------------------------------------
// HUD — with a live ticking gold counter so the roll/pulse animation shows
// --------------------------------------------------------------------------
function mountLiveHud(container) {
  const hud = createHud({
    onCouncil: () => console.info('[gallery] War Council clicked'),
    onRealm: () => console.info('[gallery] Realm clicked'),
    onSettings: () => console.info('[gallery] Settings clicked'),
  });
  mount(container, hud.el);
  let gold = 1284;
  let tick = 0;
  hud.update({ gold, incomePerSec: 3.42, dynastyStars: 2 });
  setInterval(() => {
    tick += 1;
    // Every 4th tick simulates a conquest bounty landing — a jump big
    // enough to trigger the strong flash on top of the everyday pulse.
    const bounty = tick % 4 === 0;
    gold += bounty ? gold * 0.15 + 80 : 40 + Math.random() * 220;
    hud.update({ gold, incomePerSec: 3.42 + Math.random(), dynastyStars: 2, pulse: bounty || undefined });
  }, 2600);
  return hud;
}
{
  const s = slot();
  kitGrid.appendChild(section('HUD (hud.js)', s));
  mountLiveHud(s);
}

// --------------------------------------------------------------------------
// Region cards — frontier (easy), frontier (deadly capital), surrender,
// owned, and locked/not-frontier
// --------------------------------------------------------------------------
function regionCardSlot(data, label) {
  // --med: the matchup block (chip + two-sided bar + named labels) plus
  // explicit reward lines made the card taller than the default 220px slot,
  // which was clipping the bounty/income lines against overflow:hidden.
  const s = slot('gallery-slot--med');
  const card = createRegionCard({
    onAttack: (id) => console.info('[gallery] attack region', id),
    onSurrender: (id) => console.info('[gallery] accept surrender', id),
  });
  place(card.el, { top: '16px', left: '16px', right: '16px', maxWidth: 'none' });
  mount(s, card.el);
  card.update(data);
  kitGrid.appendChild(section(`Region card — ${label}`, s));
  return card;
}
regionCardSlot({
  id: 1, name: 'Millbrook', tier: 1, owner: FACTIONS.freefolk,
  perk: { icon: 'tree', name: 'Timberland', text: '+6% troop growth' },
  income: 1.0, bounty: 90,
  difficulty: { power: 32.4, strength: 17.7, ratio: 1.83, label: 'Easy', surrender: false },
}, 'frontier, Easy');
regionCardSlot({
  id: 3, name: 'Crimson Keep', tier: 2, owner: FACTIONS.crimson,
  perk: { icon: 'throne', name: 'Throne', text: '+15% attack, +25% income' },
  income: 3.1, bounty: 279,
  difficulty: { power: 32.4, strength: 41.0, ratio: 0.79, label: 'Deadly', surrender: false },
}, 'frontier, Deadly capital');
regionCardSlot({
  id: 4, name: 'Ashport', tier: 2, owner: FACTIONS.crimson,
  perk: { icon: 'pick', name: 'Iron Hills', text: '+5% attack' },
  income: 1.55, bounty: 140,
  difficulty: { power: 210, strength: 38, ratio: 5.5, label: 'Easy', surrender: true },
}, 'frontier, surrender offered');
regionCardSlot({
  id: 0, name: 'Home Shore', tier: 0, owned: true, owner: FACTIONS.player,
  perk: { icon: 'wheat', name: 'Fertile Plains', text: '+12% gold income' },
  income: 1.12,
}, 'owned');
regionCardSlot({ id: 5, name: '???', tier: 3, locked: true, owner: null }, 'locked / not frontier');

// --------------------------------------------------------------------------
// War Council — real UPGRADES catalogue + real buy()/buyMax() math
// --------------------------------------------------------------------------
function mockUpgradeView(state, def) {
  const level = levelOf(state, def.id);
  const maxed = def.max != null && level >= def.max;
  const cost = maxed ? null : upgradeCost(def.id, level);
  return {
    id: def.id, tab: def.tab, icon: def.icon, name: def.name, desc: def.desc,
    level, max: def.max ?? null, locked: def.tab === 'powers' && level < 1,
    current: def.effectText(level), next: maxed ? null : def.effectText(level + 1),
    cost, affordable: !maxed && state.gold >= cost,
  };
}
function mountLiveCouncil(container) {
  const state = { gold: 640, upgrades: { rally: 1, steel: 3, taxes: 2, treasury: 16, firestorm: 1 } };
  const council = createCouncil({
    onBuy: (id) => { buy(state, id); render(); },
    onBuyMax: (id) => { buyMax(state, id); render(); },
    onClose: () => console.info('[gallery] council closed'),
  });
  function render() {
    council.update({ gold: state.gold, upgrades: Object.values(UPGRADES).map((d) => mockUpgradeView(state, d)) });
  }
  place(council.el, { top: '16px', right: '16px', left: '16px', width: 'auto', maxHeight: 'none', bottom: '16px' });
  mount(container, council.el);
  render();
  return council;
}
{
  const s = slot('gallery-slot--tall');
  kitGrid.appendChild(section('War Council (council.js) — try buying something', s));
  mountLiveCouncil(s);
}

// --------------------------------------------------------------------------
// Battle HUD — live, interactive power cooldowns
// --------------------------------------------------------------------------
function mountLiveBattleHud(container) {
  // cooldownTotal: fixed duration used only to drive this mock's own ticking
  // (real cooldown math lives in game/battle + game/meta, not here).
  const powers = [
    { id: 'rally', name: 'Rally', icon: 'horn', level: 1, locked: false, cooldownFrac: 0, cooldownTotal: 30 },
    { id: 'firestorm', name: 'Firestorm', icon: 'flame', level: 2, locked: false, cooldownFrac: 0.4, cooldownTotal: 25 },
    { id: 'bulwark', name: 'Bulwark', icon: 'shield', level: 0, locked: true, cooldownFrac: 0, cooldownTotal: 30 },
    { id: 'march', name: 'Forced March', icon: 'boot', level: 1, locked: false, cooldownFrac: 0.9, cooldownTotal: 35 },
    { id: 'levy', name: 'Levy', icon: 'bell', level: 0, locked: true, cooldownFrac: 0, cooldownTotal: 45 },
  ];
  let armedId = null;
  let sendFraction = 0.5;
  let speed = 2;
  let paused = false;
  let timeSec = 47;
  let youShare = 0.62;

  const hud = createBattleHud({
    onSendFraction: (f) => { sendFraction = f; render(); },
    onPower: (id) => {
      const p = powers.find((x) => x.id === id);
      if (!p || p.locked || p.cooldownFrac > 0) return;
      if (armedId === id) {
        // second click on the same power = target chosen, fire it
        armedId = null;
        p.cooldownFrac = 1;
      } else {
        // first click arms it — DESIGN §4.5's powers are all
        // target-a-hex/settlement, so the player picks the target next
        armedId = id;
      }
      render();
    },
    onPauseToggle: () => { paused = !paused; render(); },
    onSpeed: (next) => { speed = next; render(); },
    onRetreat: () => console.info('[gallery] retreat confirmed'),
  });

  function render() {
    hud.update({
      regionName: 'Millbrook',
      territory: { you: youShare, enemy: 1 - youShare, youColor: FACTIONS.player.color, enemyColor: FACTIONS.freefolk.color },
      timeSec, sendFraction, speed, paused,
      powers: powers.map((p) => ({
        ...p, armed: p.id === armedId, cooldownSec: p.cooldownFrac * p.cooldownTotal,
      })),
    });
  }
  mount(container, hud.el);
  render();
  setInterval(() => {
    if (paused) return;
    timeSec += 1;
    youShare = Math.max(0.05, Math.min(0.95, youShare + (Math.random() - 0.48) * 0.03));
    for (const p of powers) if (p.cooldownFrac > 0) p.cooldownFrac = Math.max(0, p.cooldownFrac - 1 / p.cooldownTotal);
    render();
  }, 1000);
  return hud;
}
{
  // Uniform single-width card, same reasoning as the Icons section above.
  const s = slot('gallery-slot--tall');
  kitGrid.appendChild(section('Battle HUD (battleHud.js) — click a power', s));
  mountLiveBattleHud(s);
}

// --------------------------------------------------------------------------
// Results — victory and defeat
// --------------------------------------------------------------------------
function resultsSlot(data, label) {
  const s = slot('gallery-slot--med');
  const results = createResults({
    onContinue: () => console.info('[gallery] continue'),
    onRetry: () => console.info('[gallery] retry'),
    onBackToMap: () => console.info('[gallery] back to map'),
  });
  mount(s, results.el);
  results.update(data);
  kitGrid.appendChild(section(`Results — ${label}`, s));
}
resultsSlot({
  result: 'victory', regionName: 'Millbrook', bounty: 90, newIncome: 1.0,
  perk: { icon: 'tree', name: 'Timberland' }, durationSec: 74, troopsLost: 6, troopsKilled: 24,
}, 'victory');
resultsSlot({ result: 'defeat', regionName: 'Crimson Keep' }, 'defeat');

// --------------------------------------------------------------------------
// Title screen
// --------------------------------------------------------------------------
{
  const s = slot('gallery-slot--tall');
  const title = createTitle({
    onContinue: () => console.info('[gallery] continue game'),
    onNewRealm: () => console.info('[gallery] new realm'),
    onSettings: () => console.info('[gallery] settings'),
  });
  mount(s, title.el);
  title.update({ hasSave: true, version: '2.0.0' });
  kitGrid.appendChild(section('Title screen (title.js)', s));
}

// --------------------------------------------------------------------------
// Modal
// --------------------------------------------------------------------------
{
  const s = slot('gallery-slot--med');
  kitGrid.appendChild(section('Modal (modal.js)', s));
  const modal = createModal({
    title: 'Retreat?',
    body: 'Your War Camp falls back. Squads already in the field will be lost.',
    actions: [
      { label: 'Keep fighting', variant: 'secondary', onClick: () => console.info('[gallery] cancel retreat') },
      { label: 'Retreat', variant: 'danger', onClick: () => console.info('[gallery] confirmed retreat') },
    ],
  }, { onDismiss: () => console.info('[gallery] modal dismissed') });
  mount(s, modal.el);
}

// --------------------------------------------------------------------------
// Toasts
// --------------------------------------------------------------------------
{
  // --med: toasts.css docks the stack ~84px down (clearing the HUD's gold
  // bar in the real game); this standalone slot has no HUD above it, so it
  // needs the extra height or the stack clips against the slot's own
  // overflow:hidden.
  const s = slot('gallery-slot--med');
  const toasts = createToasts();
  mount(s, toasts.el);
  const sample = [
    { type: 'success', message: 'Millbrook conquered! +90 gold' },
    { type: 'info', message: 'Try Rally — every settlement sends half its troops.' },
    { type: 'warning', message: 'Treasury offline cap almost full.' },
  ];
  let i = 0;
  const fireBtn = h('button', {}, 'Fire another toast');
  fireBtn.addEventListener('click', () => toasts.update(sample[i++ % sample.length]));
  for (const t of sample) toasts.update(t);
  kitGrid.appendChild(section('Toasts (toasts.js)', s, h('div.hint-btn-row', {}, fireBtn)));
}

// --------------------------------------------------------------------------
// Settings
// --------------------------------------------------------------------------
{
  const s = slot('gallery-slot--tall');
  const settings = createSettings({
    onToggleSound: (v) => console.info('[gallery] sound', v),
    onToggleReduceMotion: (v) => console.info('[gallery] reduceMotion', v),
    onToggleHints: (v) => console.info('[gallery] hints', v),
    onExport: () => 'aGV4ZG9taW5pb24tZGVtby1zYXZlLWNvZGU=',
    onImport: (code) => code.length > 4,
    onReset: () => console.info('[gallery] reset save'),
    onClose: () => console.info('[gallery] settings closed'),
  });
  mount(s, settings.el);
  settings.update({ sound: true, reduceMotion: false, hints: true });
  kitGrid.appendChild(section('Settings (settings.js)', s));
}

// --------------------------------------------------------------------------
// Realm
// --------------------------------------------------------------------------
{
  const s = slot('gallery-slot--tall');
  const realm = createRealm({
    onFoundDynasty: () => console.info('[gallery] dynasty founded'),
    onClose: () => console.info('[gallery] realm closed'),
  });
  mount(s, realm.el);
  realm.update({
    stats: {
      battlesWon: 14, battlesLost: 3, regionsConquered: 9, goldEarned: 48200,
      troopsSent: 812, settlementsTaken: 37, bestBattleSec: 52, playSec: 5400, surrenders: 2,
    },
    dynasty: { level: 1, stars: 0, starText: dynastyStarText() },
    canFoundDynasty: true,
  });
  kitGrid.appendChild(section('Realm (realm.js)', s));
}

// --------------------------------------------------------------------------
// Coach
// --------------------------------------------------------------------------
{
  const s = slot();
  // coach.js's ring/bubble are position:fixed, i.e. truly viewport-relative
  // by design (so a coach mark keeps tracking its target while the map pans
  // under it) — exactly like every other .gallery-slot uses transform to
  // make itself the containing block for position:fixed children, which
  // would otherwise make every slot's demo self-contained. Coach is the one
  // component where that trick actively breaks the demo: getBoundingClientRect
  // still reports true viewport coordinates, so the ring ends up positioned
  // relative to the slot but measured against the viewport, landing off in
  // the wrong place. Opt this one slot back out.
  s.style.transform = 'none';
  const dummyTarget = h('div', { style: { position: 'absolute', left: '70%', top: '65%', width: '28px', height: '28px' } });
  mount(s, dummyTarget);
  const coach = createCoach({ onDismiss: () => coach.update({ visible: false }) });
  s.appendChild(coach.el);
  coach.update({ visible: true, text: 'Click a glowing region to attack.', target: { el: dummyTarget } });
  kitGrid.appendChild(section('Coach mark (coach.js)', s));
}

// --------------------------------------------------------------------------
// Welcome back
// --------------------------------------------------------------------------
{
  const s = slot('gallery-slot--med');
  const welcome = createWelcome({ onCollect: () => console.info('[gallery] collected offline gold') });
  mount(s, welcome.el);
  welcome.update({ timeAwaySec: 5 * 3600 + 24 * 60, goldEarned: 2300 });
  kitGrid.appendChild(section('Welcome back (welcome.js) — click Collect', s));
}

// --------------------------------------------------------------------------
// Dev panel
// --------------------------------------------------------------------------
{
  const s = slot();
  const dev = createDevPanel({
    onGrantGold: (n) => console.info('[gallery] grant gold', n),
    onRevealMap: () => console.info('[gallery] reveal map'),
    onWinBattle: () => console.info('[gallery] win battle'),
    onLoseBattle: () => console.info('[gallery] lose battle'),
    onSpeedX8: (v) => console.info('[gallery] speed x8', v),
    onReseed: (seed) => console.info('[gallery] reseed', seed),
  });
  mount(s, dev.el);
  kitGrid.appendChild(section('Dev panel (devpanel.js)', s));
}

// --------------------------------------------------------------------------
// Tooltip
// --------------------------------------------------------------------------
{
  const s = slot();
  const tooltip = createTooltip();
  mount(s, tooltip.el);
  tooltip.update({ visible: true, x: 130, y: 110, text: 'Send 24 → capture, 6 left' });
  s.addEventListener('pointermove', (e) => {
    const r = s.getBoundingClientRect();
    tooltip.update({ visible: true, x: e.clientX - r.left, y: e.clientY - r.top });
  });
  kitGrid.appendChild(section('Tooltip (tooltip.js) — move your pointer over this card', s));
}

// ==========================================================================
// Composition view: HUD + region card + toasts over the living map
// ==========================================================================
{
  const root = document.getElementById('view-composition');
  const stage = h('div.gallery-fullscreen', {});
  root.appendChild(stage);

  mountLiveHud(stage);

  const card = createRegionCard({
    onAttack: () => toasts.update({ type: 'info', message: 'Marching on Millbrook...' }),
    onSurrender: () => toasts.update({ type: 'success', message: 'Millbrook surrendered!' }),
  });
  // Anchored below the HUD via the .composition-card CSS rule (see
  // ui.html), not a JS-measured offset: composition starts out `hidden`
  // (Kit is the default mode), and a hidden ancestor lays out at 0×0, so
  // measuring the HUD's real height at build time here always reads back 0.
  // A CSS rule keyed to the same breakpoint the HUD's own compact layout
  // uses doesn't have that problem.
  card.el.classList.add('composition-card');
  // NOT mount(): stage already holds the HUD — mount() clears its container
  // before appending, which would wipe out whatever was mounted just before.
  // Use appendChild directly whenever a container hosts more than one
  // independently-mounted component (see also the Coach kit slot below).
  stage.appendChild(card.el);
  card.update({
    id: 1, name: 'Millbrook', tier: 1, owner: FACTIONS.freefolk,
    perk: { icon: 'tree', name: 'Timberland', text: '+6% troop growth' },
    income: 1.0, bounty: 90,
    difficulty: { power: 32.4, strength: 17.7, ratio: 1.83, label: 'Easy', surrender: false },
  });

  const toasts = createToasts();
  stage.appendChild(toasts.el);
  toasts.update({ type: 'success', message: 'Home Shore is paying tribute.' });
}

// ==========================================================================
// Battle view: the battle HUD alone, full screen and realistic
// ==========================================================================
{
  const root = document.getElementById('view-battle');
  const stage = h('div.gallery-fullscreen', {});
  root.appendChild(stage);
  mountLiveBattleHud(stage);
}

// ==========================================================================
// Title view: full-viewport check for the vw-based logo sizing (the Kit
// grid's narrow slot clips "DOMINION" — that's the slot, not the component;
// this view is the real test).
// ==========================================================================
{
  const root = document.getElementById('view-title');
  const stage = h('div.gallery-fullscreen', {});
  root.appendChild(stage);
  const title = createTitle({
    onContinue: () => console.info('[gallery] continue game'),
    onNewRealm: () => console.info('[gallery] new realm'),
    onSettings: () => console.info('[gallery] settings'),
  });
  mount(stage, title.el);
  title.update({ hasSave: true, version: '2.0.0' });
}
