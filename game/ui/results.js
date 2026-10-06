// Victory / Defeat / Retreat card (DESIGN §4.7, §7.4). Browser only; no
// game-logic imports.
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { shortNumber, formatClock, formatRate } from './format.js';
import { createCrownRow } from './crownRow.js';
import { watchDialog } from './dialogs.js';

const DEFAULT_TIPS = [
  'Try sending from more than one settlement at once — a squad that arrives alone often just feeds the garrison.',
  'Rally sends half of every settlement\'s troops at once — save it for the final push on the keep.',
  'Towers snipe squads that pass close by. Route around them, or clear them first.',
  'A bigger opening send is often safer than reinforcing piecemeal into a losing fight.',
];

/**
 * @typedef {Object} ResultsData
 * @property {'victory'|'defeat'|'retreat'|'defended'|'occupied'|'duelWon'|'duelLost'} result   'defended' / 'occupied': the end of a DEFENSE (DESIGN 10.1);
 *   'duelWon' / 'duelLost': a world event's Duel (DESIGN 10.13): Renown for a win, nothing lost for a loss
 * @property {number} [renown]      duelWon: the Renown the duel paid
 * @property {string} [champion]    duel: who challenged ("Kael of the Crimson Legion")
 * @property {number} [reward]      defended: the gold the defense paid
 * @property {string} [occupier]    occupied: who took it ("the Crimson Legion")
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
  const bannerEl = h('h2.results-banner', {}, '');
  const regionEl = h('div.results-region', {}, '');
  const bodyEl = h('div.results-body', {});

  // A screen reader hears the outcome as soon as the card opens: a polite status line ("Victory. Greenreach captured. +104 gold.") that is filled a moment
  // AFTER the card shows (a change inside a hidden element is never announced).
  const statusEl = h('p.visually-hidden', { role: 'status', 'aria-live': 'polite' }, '');
  let summary = '';
  const el = h('div.results-card.glass-panel', {}, bannerEl, regionEl, bodyEl, statusEl);
  watchDialog(el, { titleEl: bannerEl, onEscape: null, initialFocus: () => el.querySelector('.btn-primary.results-action') || el.querySelector('.results-action') });
  new MutationObserver(() => {
    statusEl.textContent = '';
    if (!el.hidden) setTimeout(() => { if (!el.hidden) statusEl.textContent = summary; }, 250);
  }).observe(el, { attributes: true, attributeFilter: ['hidden'] });

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
      data.tideTook > 0 ? stat('tide', `The Tide took ${Math.round(data.tideTook)}`, '.icon-bad') : null, // the Tide Fortress (Phase 12)
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

  /** A defense held (DESIGN 10.1): the reward and the toll, then Continue. */
  function renderDefended(data) {
    clear(bodyEl);
    bodyEl.appendChild(h('div.results-stats-grid', {},
      stat('coin', `+${shortNumber(data.reward || 0)} reward`, '.icon-gold'),
      stat('clock', formatClock(data.durationSec || 0)),
      stat('sword', `${Math.round(data.troopsKilled || 0)} killed`, '', Math.round(data.troopsKilled || 0)),
      stat('boot', `${Math.round(data.troopsLost || 0)} lost`, '.icon-bad', Math.round(data.troopsLost || 0)),
    ));
    bodyEl.appendChild(h('button.btn.btn-primary.btn-block.results-action', { onClick: () => onContinue?.() }, 'Continue'));
  }

  /** A defense lost (DESIGN 10.2): the region is occupied, not gone; there is no Retry, only the way back to the map to retake it. */
  function renderOccupied(data) {
    clear(bodyEl);
    const tip = data.tip || `${data.regionName || 'The region'} is occupied by ${data.occupier || 'the enemy'}. Retake it from the map: its income, prosperity and buildings come back with it.`;
    bodyEl.appendChild(h('p.results-tip', {}, icon('flag', 16), h('span', {}, tip)));
    bodyEl.appendChild(h('div.results-actions', {},
      h('button.btn.btn-primary.results-action', { onClick: () => onBackToMap?.() }, icon('map', 16), 'Back to Map'),
    ));
  }

  /** A Duel's end (DESIGN 10.13): its own card. A win pays Renown; a loss costs nothing (no occupation), so both just go back to the map. */
  function renderDuel(data) {
    clear(bodyEl);
    const won = data.result === 'duelWon';
    if (won) {
      bodyEl.appendChild(h('div.results-stats-grid', {},
        stat('laurel', `+${shortNumber(data.renown || 0)} Renown`, '.icon-gold'),
        stat('clock', formatClock(data.durationSec || 0)),
        stat('sword', `${Math.round(data.troopsKilled || 0)} killed`, '', Math.round(data.troopsKilled || 0)),
        stat('boot', `${Math.round(data.troopsLost || 0)} lost`, '.icon-bad', Math.round(data.troopsLost || 0)),
      ));
    }
    const tip = won ? `${data.champion || 'The champion'} yields. Your name is sung across the realm.` : `${data.champion || 'The champion'} wins the duel. No harm done: ${data.regionName || 'the region'} is still yours.`;
    bodyEl.appendChild(h('p.results-tip', {}, icon(won ? 'laurel' : 'shield', 16), h('span', {}, tip)));
    bodyEl.appendChild(h('button.btn.btn-primary.btn-block.results-action', { onClick: () => (won ? onContinue?.() : onBackToMap?.()) }, 'Continue'));
  }

  function update(data) {
    if (!data) return;
    el.dataset.result = data.result;
    bannerEl.textContent = { victory: 'VICTORY', retreat: 'RETREATED', defended: 'DEFENDED', occupied: 'REGION LOST', duelWon: 'DUEL WON', duelLost: 'DUEL LOST' }[data.result] || 'DEFEAT';
    regionEl.textContent = data.regionName || '';
    summary = data.result === 'victory'
      ? `Victory. ${data.regionName || 'The region'} captured. +${shortNumber(data.bounty || 0)} gold${data.crownBonus > 0 ? `, +${shortNumber(data.crownBonus)} crown bonus` : ''}. ${formatClock(data.durationSec || 0)}.`
      : data.result === 'defended' ? `Defended. ${data.regionName || 'The region'} held. +${shortNumber(data.reward || 0)} gold.`
        : data.result === 'occupied' ? `Region lost. ${data.regionName || 'The region'} is occupied by ${data.occupier || 'the enemy'}.`
          : data.result === 'duelWon' ? `Duel won at ${data.regionName || 'the region'}. +${shortNumber(data.renown || 0)} Renown.`
            : data.result === 'duelLost' ? `Duel lost at ${data.regionName || 'the region'}. Nothing is lost.`
          : `${data.result === 'retreat' ? 'Retreated' : 'Defeat'}. ${data.regionName || ''}`.trim();
    if (data.result === 'victory') renderVictory(data);
    else if (data.result === 'defended') renderDefended(data);
    else if (data.result === 'occupied') renderOccupied(data);
    else if (data.result === 'duelWon' || data.result === 'duelLost') renderDuel(data);
    else renderSetback(data);
  }

  function destroy() {}

  return { el, update, destroy };
}
