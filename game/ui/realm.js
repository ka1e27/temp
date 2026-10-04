// Realm panel: lifetime stats + dynasty prestige (DESIGN §5.4, §5.5).
// Browser only; no game-logic imports.
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { shortNumber, formatClock, formatDurationWords } from './format.js';
import { watchDialog } from './dialogs.js';
import { createChroniclePanel } from './chroniclePanel.js';
import { createSaveMapButton } from './saveMapButton.js';
import { createDeedsSection, createTrophySection } from './deedsPanel.js';
import { createEdictSection, createLegacySection } from './dynastyPanel.js';
import { createBoonStrip, createReliquary } from './boonsPanel.js';

const STAT_ROWS = [
  ['battlesWon', 'trophy', 'Battles won'],
  ['battlesLost', 'shield', 'Battles lost'],
  ['regionsConquered', 'flag', 'Regions conquered'],
  ['goldEarned', 'coin', 'Gold earned'],
  ['troopsSent', 'boot', 'Troops sent'],
  ['settlementsTaken', 'castle', 'Settlements taken'],
  ['surrenders', 'scroll', 'Surrenders accepted'],
  ['crownsEarned', 'crown', 'Crowns, lifetime'],
];

/**
 * @typedef {Object} RealmData
 * @property {import('../meta/state.js').GameStats} stats
 * @property {{ level: number, stars: number, starText?: string }} dynasty  `starText`: what one star adds, e.g. "+20% income, ..."
 * @property {boolean} canFoundDynasty
 * @property {{ earned: number, possible: number }} [crowns]  this dynasty's crowns, e.g. 38 / 78
 * @property {import('./deedsPanel.js').DeedCell[]} [deeds]  Phase 4: the Deeds grid
 * @property {{ show: boolean, trophies: import('./deedsPanel.js').TrophyCell[] }} [trophies]  Phase 4: the Trophy wall
 * @property {object} [chronicle]  meta/chronicle.js chroniclePanelData(): the realm's story, newest first
 * @property {{ label: string, busyLabel: string, busy: boolean, hint: string }} [save]  the "Save the map" words and state (meta/keepsake.js saveText)
 */

/**
 * @param {{ onFoundDynasty?: () => void, onSaveMap?: () => void, onClose?: () => void }} [callbacks]
 */
export function createRealm({ onFoundDynasty, onSaveMap, onClose, onBuyLegacy, onOpenDraft } = {}) {
  const statEls = new Map();
  const statsGrid = h('div.realm-stats-grid', {},
    ...STAT_ROWS.map(([key, iconName, label]) => {
      const valueEl = h('span.realm-stat-value.nums', {}, '0');
      statEls.set(key, valueEl);
      return h('div.realm-stat', {}, icon(iconName, 16), h('span.realm-stat-label', {}, label), valueEl);
    }),
    (() => {
      const valueEl = h('span.realm-stat-value.nums', {}, '0:00');
      statEls.set('bestBattleSec', valueEl);
      return h('div.realm-stat', {}, icon('clock', 16), h('span.realm-stat-label', {}, 'Best battle time'), valueEl);
    })(),
    (() => {
      const valueEl = h('span.realm-stat-value.nums', {}, '0s');
      statEls.set('playSec', valueEl);
      return h('div.realm-stat', {}, icon('clock', 16), h('span.realm-stat-label', {}, 'Time played'), valueEl);
    })(),
  );

  // This dynasty's numbers, apart from the lifetime records (every stat in `state.stats` is lifetime: foundDynasty keeps them all), so neither is misread
  const dynastyGrid = h('div.realm-stats-grid', {},
    (() => {
      const valueEl = h('span.realm-stat-value.nums', {}, '0 / 0');
      statEls.set('crownsDynasty', valueEl);
      return h('div.realm-stat', {}, icon('crown', 16), h('span.realm-stat-label', {}, 'Crowns'), valueEl);
    })(),
    (() => {
      const valueEl = h('span.realm-stat-value.nums', {}, '0 / 0');
      statEls.set('regionsHeld', valueEl);
      return h('div.realm-stat', {}, icon('flag', 16), h('span.realm-stat-label', {}, 'Regions held'), valueEl);
    })(),
  );
  const statsSection = h('section.realm-stats-groups', {},
    h('h3.realm-section-title', {}, icon('star', 16), 'This dynasty'), dynastyGrid,
    h('h3.realm-section-title', {}, icon('trophy', 16), 'All time', h('small', {}, 'kept across every dynasty')), statsGrid);

  const DYNASTY_INTRO = 'Conquer the whole continent to found a new dynasty: keep your stars, Legacy and lifetime stats, and start over. A new continent awaits, with tougher enemies.';
  // The per-star numbers arrive as `dynasty.starText` (built from game/config/meta.js by the scene), never typed here.
  const dynastyDescEl = h('p.dynasty-desc', {}, DYNASTY_INTRO);
  const dynastyLevelEl = h('span.dynasty-level', {}, 'Dynasty I');
  const dynastyStarsEl = h('span.dynasty-stars', {}, icon('star', 16), h('span.nums', {}, '0'));
  const foundBtn = h('button.btn.btn-primary.btn-block.dynasty-found-btn', {
    onClick: () => onFoundDynasty?.(), disabled: true, // opens the founding ceremony (ui/ceremony.js), which replaced the old confirm
  }, icon('crown', 16), 'Found a Dynasty');

  // Keepsakes (DESIGN 5.9): the realm's story, and a picture of the map to keep. Every live "Save the map" button (the panel's, plus the confirmation's while it is open) is kept in step.
  const chronicle = createChroniclePanel();
  const savers = new Set();
  let saveData = null;
  const saveMap = createSaveMapButton({ onSave: () => onSaveMap?.() });
  savers.add(saveMap);

  const dynastyEl = h('section.dynasty-panel', {},
    h('div.dynasty-header', {}, dynastyLevelEl, dynastyStarsEl),
    dynastyDescEl,
    foundBtn,
  );
  // Boons of this dynasty (DESIGN 10.13): Dragonscale, once the Dragon of a Lair has fallen. The words come from config/features.js via the scene.
  const boonText = h('span', {}, '');
  const boonEl = h('p.realm-boon', { role: 'note' }, icon('shield', 16), boonText);
  boonEl.hidden = true;
  // Phase 4 (PLAN-PHASE4 §4C, §4D): the Trophy wall (this dynasty's Vendetta banners) and the Deeds grid (kept forever)
  const trophies = createTrophySection();
  const deeds = createDeedsSection();
  // Phase 5 (PLAN-PHASE5): this dynasty's Edict and Challenge laurels (top: they are the rules you play by), and the Legacy tree (spend any time)
  const edictSection = createEdictSection();
  const legacySection = createLegacySection({ onBuy: (id) => onBuyLegacy?.(id) });
  // Phase 7 (PLAN-PHASE7): the Boons held this dynasty, a compact strip under the Edict line; the Reliquary (kept forever) beside the Deeds
  const boonStrip = createBoonStrip({ onOpenDraft: () => onOpenDraft?.() });
  const reliquary = createReliquary();
  // Order (lead decision 2026-10-04): [Dynasty, when the continent is won] · the Edict and Challenges (one compact line) · the Chronicle (on a 390x844 phone it
  // starts on the first screen) · Deeds · Trophies · the stats · the Legacy tree; the Dynasty section sits last until the continent is won.
  const bodyEl = h('div.realm-body.scroll-y', {}, edictSection.el, boonStrip.el, boonEl, chronicle.el, saveMap.el, saveMap.statusEl, deeds.el, reliquary.el, trophies.el, statsSection, legacySection.el, dynastyEl);
  const el = h('div.realm.glass-panel', {},
    h('div.realm-header', {},
      h('h2.realm-title', {}, 'Realm'),
      h('button.btn-icon.realm-close', { onClick: () => onClose?.(), 'aria-label': 'Close' }, icon('close', 16)),
    ),
    bodyEl,
  );

  watchDialog(el, { onEscape: () => onClose?.() });
  // opened with the continent won: start at the top, where Found a Dynasty is (a scroll left from an earlier visit hid it)
  if (typeof MutationObserver === 'function') {
    new MutationObserver(() => { if (!el.hidden && el.classList.contains('is-dynasty-ready')) bodyEl.scrollTop = 0; }).observe(el, { attributes: true, attributeFilter: ['hidden'] });
  }

  /** @param {RealmData} data */
  function update(data) {
    if (!data) return;
    if (data.stats) {
      for (const [key, el2] of statEls) {
        if (key === 'bestBattleSec') el2.textContent = data.stats.bestBattleSec != null ? formatClock(data.stats.bestBattleSec) : '—';
        else if (key === 'playSec') el2.textContent = formatDurationWords(data.stats.playSec || 0);
        else if (key === 'crownsDynasty') el2.textContent = data.crowns ? `${data.crowns.earned} / ${data.crowns.possible}` : '0 / 0';
        else if (key === 'regionsHeld') el2.textContent = data.held ? `${data.held.owned} / ${data.held.total}` : '—';
        else el2.textContent = shortNumber(data.stats[key] || 0);
      }
    }
    if (data.dynasty) {
      dynastyLevelEl.textContent = `Dynasty ${toRoman(data.dynasty.level)}`;
      dynastyStarsEl.lastChild.textContent = shortNumber(data.dynasty.stars);
      dynastyDescEl.textContent = data.dynasty.starText ? `${DYNASTY_INTRO} Each star: ${data.dynasty.starText}.` : DYNASTY_INTRO;
    }
    if (data.boons !== undefined) {
      const list = Array.isArray(data.boons) ? data.boons : [];
      boonEl.hidden = !list.length;
      const text = list.join(' · ');
      if (boonText.textContent !== text) boonText.textContent = text;
    }
    if (data.dynastyRules !== undefined) edictSection.update(data.dynastyRules);
    if (data.boonStrip !== undefined) boonStrip.update(data.boonStrip);
    if (data.reliquary !== undefined) reliquary.update(data.reliquary);
    if (data.legacy !== undefined) legacySection.update(data.legacy);
    if (data.deeds !== undefined) deeds.update(data.deeds);
    if (data.trophies !== undefined) trophies.update(data.trophies);
    if (data.chronicle) chronicle.update(data.chronicle);
    if (data.save) { saveData = data.save; for (const b of savers) b.update(data.save); }
    if (data.canFoundDynasty != null) {
      // the whole continent is won: the Dynasty section comes FIRST (on a phone it was below the fold, under the stats and the Chronicle)
      if (data.canFoundDynasty && bodyEl.firstChild !== dynastyEl) { bodyEl.prepend(dynastyEl); bodyEl.scrollTop = 0; el.classList.add('is-dynasty-ready'); } // to the top, where it now is
      else if (!data.canFoundDynasty && bodyEl.lastChild !== dynastyEl) { bodyEl.append(dynastyEl); el.classList.remove('is-dynasty-ready'); }
      foundBtn.disabled = !data.canFoundDynasty;
      foundBtn.title = data.canFoundDynasty ? '' : "Conquer every region first (the Dragon's Lair is optional)";
    }
  }

  function toRoman(n) {
    const table = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let out = '';
    let v = Math.max(1, Math.round(n));
    for (const [val, sym] of table) {
      while (v >= val) { out += sym; v -= val; }
    }
    return out || 'I';
  }

  function destroy() {
    chronicle.destroy();
    for (const b of savers) b.destroy();
    savers.clear();
    clear(el);
  }

  /** Says how a save went beside every live "Save the map" button (the panel's and the confirmation's): never a toast over the dialog. */
  const setSaveStatus = (message, kind) => { for (const b of savers) b.setStatus(message, kind); };
  return { el, update, destroy, chronicle, saveMap, setSaveStatus, legacyTree: legacySection.tree };
}
