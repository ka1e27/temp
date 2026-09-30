// Realm panel: lifetime stats + dynasty prestige (DESIGN §5.4, §5.5).
// Browser only; no game-logic imports.
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { shortNumber, formatClock, formatDurationWords } from './format.js';
import { createModal } from './modal.js';

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
 */

/**
 * @param {{ onFoundDynasty?: () => void, onClose?: () => void }} [callbacks]
 */
export function createRealm({ onFoundDynasty, onClose } = {}) {
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

  const el = h('div.realm.glass-panel', {},
    h('div.realm-header', {},
      h('h2.realm-title', {}, 'Realm'),
      h('button.btn-icon.realm-close', { onClick: () => onClose?.(), 'aria-label': 'Close' }, icon('close', 16)),
    ),
    h('div.realm-body.scroll-y', {},
      statsGrid,
      h('section.dynasty-panel', {},
        h('div.dynasty-header', {}, dynastyLevelEl, dynastyStarsEl),
        dynastyDescEl,
        foundBtn,
      ),
    ),
  );

  function confirmFound() {
    const modal = createModal({
      title: 'Found a new dynasty?',
      body: 'Gold, upgrades and the map reset. A new continent awaits, with tougher enemies. Dynasty stars and your lifetime records carry over forever.',
      actions: [
        { label: 'Not yet', variant: 'secondary', onClick: () => modal.destroy() },
        { label: 'Found it', variant: 'primary', onClick: () => { modal.destroy(); onFoundDynasty?.(); } },
      ],
    }, { onDismiss: () => modal.destroy() });
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
    if (data.canFoundDynasty != null) {
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
    clear(el);
  }

  return { el, update, destroy };
}
