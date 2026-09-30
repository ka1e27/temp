// Victory / Defeat / Retreat card (DESIGN §4.7, §7.4). Browser only; no
// game-logic imports.
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { shortNumber, formatClock, formatRate } from './format.js';
import { createCrownRow } from './crownRow.js';

const DEFAULT_TIPS = [
  'Try sending from more than one settlement at once — a squad that arrives alone often just feeds the garrison.',
  'Rally sends half of every settlement\'s troops at once — save it for the final push on the keep.',
  'Towers snipe squads that pass close by. Route around them, or clear them first.',
  'A bigger opening send is often safer than reinforcing piecemeal into a losing fight.',
];

/**
 * @typedef {Object} ResultsData
 * @property {'victory'|'defeat'|'retreat'} result
 * @property {string} [regionName]
 * @property {number} [bounty]
 * @property {number} [newIncome]
 * @property {{ icon: string, name: string, text: string }} [perk]
 * @property {number} [durationSec]
 * @property {number} [troopsLost]
 * @property {number} [troopsKilled]
 * @property {string} [tip]     shown on defeat/retreat; a default is used if omitted
 * @property {{ victory: boolean, swift: boolean, unbroken: boolean }} [crowns]  victory only: the crowns just earned
 * @property {number} [parSec]         par time behind the Swift crown
 * @property {number} [crownBonus]     bonus gold the crowns pay (shown as a stat when > 0)
 * @property {number} [bonusPct]       e.g. 25: shown under each earned crown
 * @property {boolean} [firstVictory]  adds the one-line crowns explanation (first victory card only)
 */

/**
 * @param {{ onContinue?: () => void, onRetry?: () => void, onBackToMap?: () => void,
 *   onCrown?: (index: number) => void }} [callbacks]  `onCrown` fires as each earned crown lands
 */
export function createResults({ onContinue, onRetry, onBackToMap, onCrown, crownTexts } = {}) {
  const crownRow = createCrownRow({ size: 'lg', onAward: (_key, i) => onCrown?.(i), texts: crownTexts });
  const bannerEl = h('div.results-banner', {}, '');
  const regionEl = h('div.results-region', {}, '');
  const bodyEl = h('div.results-body', {});

  const el = h('div.results-card.glass-panel', {}, bannerEl, regionEl, bodyEl);

  /** A stat line. A zero is neutral and muted whatever its usual colour: "0 lost" is good news, not an alarm. */
  function stat(iconName, label, extraClass = '', value = null) {
    const zero = value === 0;
    return h(`div.results-stat${zero ? '.is-zero' : extraClass}`, {}, icon(iconName, 18), h('span', {}, label));
  }

  function renderVictory(data) {
    clear(bodyEl);
    if (data.crowns) {
      crownRow.reset(); // two wins in a row with equal crowns must both animate
      crownRow.update({
        earned: data.crowns, parSec: data.parSec, animate: true,
        durationSec: data.durationSec, bonusPct: data.bonusPct,
      });
      bodyEl.appendChild(h('div.results-crowns', {}, crownRow.el));
      if (data.firstVictory) {
        // A static line, not a coach bubble: the card sits above the coach layer.
        bodyEl.appendChild(h('p.results-crown-tip', {}, 'Win faster, or without losing a settlement, for more crowns.'));
      }
    }
    bodyEl.appendChild(h('div.results-stats-grid', {},
      stat('coin', `+${shortNumber(data.bounty || 0)} bounty`, '.icon-gold'),
      data.crownBonus > 0 ? stat('crown', `+${shortNumber(data.crownBonus)} crown bonus`, '.icon-gold') : null,
      stat('coin', `+${formatRate(data.newIncome || 0)}/s income`, '.icon-good'),
      data.perk ? stat(data.perk.icon, data.perk.name) : null,
      stat('clock', formatClock(data.durationSec || 0)),
      stat('sword', `${Math.round(data.troopsKilled || 0)} killed`, '', Math.round(data.troopsKilled || 0)),
      stat('boot', `${Math.round(data.troopsLost || 0)} lost`, '.icon-bad', Math.round(data.troopsLost || 0)),
    ));
    bodyEl.appendChild(h('button.btn.btn-primary.btn-block.results-action', { onClick: () => onContinue?.() }, 'Continue'));
  }

  function renderSetback(data) {
    clear(bodyEl);
    const tip = data.tip || DEFAULT_TIPS[Math.floor((data.durationSec || 0)) % DEFAULT_TIPS.length];
    bodyEl.appendChild(h('p.results-tip', {}, icon('scroll', 16), h('span', {}, tip)));
    bodyEl.appendChild(h('div.results-actions', {},
      h('button.btn.btn-secondary.results-action', { onClick: () => onBackToMap?.() }, icon('map', 16), 'Back to Map'),
      h('button.btn.btn-primary.results-action', { onClick: () => onRetry?.() }, icon('sword', 16), 'Retry'),
    ));
  }

  function update(data) {
    if (!data) return;
    el.dataset.result = data.result;
    bannerEl.textContent = data.result === 'victory' ? 'VICTORY' : data.result === 'retreat' ? 'RETREATED' : 'DEFEAT';
    regionEl.textContent = data.regionName || '';
    if (data.result === 'victory') renderVictory(data);
    else renderSetback(data);
  }

  function destroy() {}

  return { el, update, destroy };
}
