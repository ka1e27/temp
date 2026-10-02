// Realm panel: lifetime stats + dynasty prestige (DESIGN §5.4, §5.5).
// Browser only; no game-logic imports.
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { shortNumber, formatClock, formatDurationWords } from './format.js';
import { createModal } from './modal.js';
import { watchDialog } from './dialogs.js';
import { createChroniclePanel } from './chroniclePanel.js';
import { createSaveMapButton } from './saveMapButton.js';

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
 * @property {object} [chronicle]  meta/chronicle.js chroniclePanelData(): the realm's story, newest first
 * @property {{ label: string, busyLabel: string, busy: boolean, hint: string }} [save]  the "Save the map" words and state (meta/keepsake.js saveText)
 */

/**
 * @param {{ onFoundDynasty?: () => void, onSaveMap?: () => void, onClose?: () => void }} [callbacks]
 */
export function createRealm({ onFoundDynasty, onSaveMap, onClose } = {}) {
  const statEls = new Map();
  const statsGrid = h('div.realm-stats-grid', {},
    ...STAT_ROWS.map(([key, iconName, label]) => {
      const valueEl = h('span.realm-stat-value.nums', {}, '0');
      statEls.set(key, valueEl);
      return h('div.realm-stat', {}, icon(iconName, 16), h('span.realm-stat-label', {}, label), valueEl);
    }),
    (() => {
      const valueEl = h('span.realm-stat-value.nums', {}, '0 / 0');
      statEls.set('crownsDynasty', valueEl);
      return h('div.realm-stat', {}, icon('crown', 16), h('span.realm-stat-label', {}, 'Dynasty crowns'), valueEl);
    })(),
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

  const DYNASTY_INTRO = 'Conquer the whole continent to found a new dynasty: keep your stars and lifetime stats, and start over: a new continent awaits, with tougher enemies.';
  // The per-star numbers arrive as `dynasty.starText` (built from game/config/meta.js by the scene), never typed here.
  const dynastyDescEl = h('p.dynasty-desc', {}, DYNASTY_INTRO);
  const dynastyLevelEl = h('span.dynasty-level', {}, 'Dynasty I');
  const dynastyStarsEl = h('span.dynasty-stars', {}, icon('star', 16), h('span.nums', {}, '0'));
  const foundBtn = h('button.btn.btn-primary.btn-block.dynasty-found-btn', {
    onClick: () => confirmFound(), disabled: true,
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
  const bodyEl = h('div.realm-body.scroll-y', {}, statsGrid, chronicle.el, saveMap.el, saveMap.statusEl, dynastyEl);
  const el = h('div.realm.glass-panel', {},
    h('div.realm-header', {},
      h('h2.realm-title', {}, 'Realm'),
      h('button.btn-icon.realm-close', { onClick: () => onClose?.(), 'aria-label': 'Close' }, icon('close', 16)),
    ),
    bodyEl,
  );

  watchDialog(el, { onEscape: () => onClose?.() });

  // The last chance to keep a picture of the old continent: the same Save button sits in the confirmation, above the two choices (the safe one stays first).
  // Saving does not close it; the picture is of the realm as it is now (the new continent does not exist until "Found it").
  function confirmFound() {
    const confirmSave = createSaveMapButton({ onSave: () => onSaveMap?.() });
    savers.add(confirmSave);
    if (saveData) confirmSave.update(saveData);
    const close = () => { savers.delete(confirmSave); modal.destroy(); };
    const modal = createModal({
      title: 'Found a new dynasty?',
      body: h('div.keepsake-modal-body', {},
        h('p', { style: { margin: 0 } }, 'Gold, upgrades and the map reset. A new continent awaits, with tougher enemies. Dynasty stars and your lifetime records carry over forever.'),
        h('div.keepsake-save-box', {}, h('p.keepsake-save-note', {}, saveData ? saveData.hint : ''), confirmSave.el, confirmSave.statusEl)),
      actions: [
        { label: 'Not yet', variant: 'secondary', onClick: close },
        { label: 'Found it', variant: 'primary', onClick: () => { close(); onFoundDynasty?.(); } },
      ],
    }, { onDismiss: close });
    document.body.appendChild(modal.el);
  }

  /** @param {RealmData} data */
  function update(data) {
    if (!data) return;
    if (data.stats) {
      for (const [key, el2] of statEls) {
        if (key === 'bestBattleSec') el2.textContent = data.stats.bestBattleSec != null ? formatClock(data.stats.bestBattleSec) : '—';
        else if (key === 'playSec') el2.textContent = formatDurationWords(data.stats.playSec || 0);
        else if (key === 'crownsDynasty') el2.textContent = data.crowns ? `${data.crowns.earned} / ${data.crowns.possible}` : '0 / 0';
        else el2.textContent = shortNumber(data.stats[key] || 0);
      }
    }
    if (data.dynasty) {
      dynastyLevelEl.textContent = `Dynasty ${toRoman(data.dynasty.level)}`;
      dynastyStarsEl.lastChild.textContent = shortNumber(data.dynasty.stars);
      dynastyDescEl.textContent = data.dynasty.starText ? `${DYNASTY_INTRO} Each star: ${data.dynasty.starText}.` : DYNASTY_INTRO;
    }
    if (data.chronicle) chronicle.update(data.chronicle);
    if (data.save) { saveData = data.save; for (const b of savers) b.update(data.save); }
    if (data.canFoundDynasty != null) {
      // the whole continent is won: the Dynasty section comes FIRST (on a phone it was below the fold, under the stats and the Chronicle)
      if (data.canFoundDynasty && bodyEl.firstChild !== dynastyEl) { bodyEl.prepend(dynastyEl); el.classList.add('is-dynasty-ready'); }
      else if (!data.canFoundDynasty && bodyEl.lastChild !== dynastyEl) { bodyEl.append(dynastyEl); el.classList.remove('is-dynasty-ready'); }
      foundBtn.disabled = !data.canFoundDynasty;
      foundBtn.title = data.canFoundDynasty ? '' : 'Conquer every region first';
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
  return { el, update, destroy, chronicle, saveMap, setSaveStatus };
}
