// The Boon draft (PLAN-PHASE7 §7A, Integration): three cards in rarity frames (Common bronze, Rare silver-blue, Legendary gold, Cursed crimson-violet
// with a small warning mark), pick one, Reroll for Renown, or leave it for later (the HUD's "Boon pending" chip reopens it). It follows the conquest's
// result card after a battle won, and opens from the chip. The Champion's eye (a guaranteed Rare-or-better draft after a Vendetta win) wears its own frame.
// Built once and patched (THE CLICK RULE): the three card buttons are never recreated, only refilled when an offer's ids change. Keyboard: Tab / arrow
// keys move between cards, Enter or Space picks, Escape leaves it for later. Browser only: plain data in (app/boons.js builds it).
import { h } from './dom.js';
import { icon } from './icons.js';
import { watchDialog } from './dialogs.js';

/**
 * @typedef {Object} BoonCardView
 * @property {string} id
 * @property {string} name
 * @property {'common'|'rare'|'legendary'} rarity
 * @property {boolean} [cursed]
 * @property {string} icon          an icons.js name
 * @property {string} text          one line, from config
 * @property {string} [duo]         "Completes Fire Arrows" when the player holds the other half of a Duo
 *
 * @typedef {Object} BoonDraftData
 * @property {'victory'|'pending'|'champion'} source   where it opened from; 'champion' = the Champion's eye frame
 * @property {string} [regionName]                      the conquest it follows ("Greenreach")
 * @property {BoonCardView[]} choices                   3
 * @property {{ cost: number, can: boolean, reason?: string }|null} reroll   null hides Reroll
 * @property {string} [note]                            a gentle line ("A new offer replaced the one you left.")
 * @property {string} [hint]                            tutorial K1: a static line on the first draft
 * @property {string} [laterLabel]                      the leave-it button ("Later"; after a battle "Decide later")
 */

const RARITY_WORD = { common: 'Common', rare: 'Rare', legendary: 'Legendary', cursed: 'Cursed' };
const put = (node, t) => { if (node.textContent !== t) node.textContent = t; };

/** The frame a card wears: Cursed overrides its rarity's colour (the rarity still shows in the word: "Cursed · Rare"). */
export function boonFrame(card) {
  return card && card.cursed ? 'cursed' : (card && card.rarity) || 'common';
}

/**
 * @param {{ onPick?: (id: string) => void, onReroll?: () => void, onLater?: () => void }} [callbacks]
 */
export function createBoonDraft({ onPick, onReroll, onLater } = {}) {
  let data = null;
  let busy = false; // between a pick and the hand-over: no second pick, no reroll

  const kickerEl = h('p.boon-draft-kicker', {}, '');
  const titleEl = h('h2.boon-draft-title', {}, 'Choose a Boon');
  const subEl = h('p.boon-draft-sub', {}, 'It lasts the dynasty, and Boons stack.');
  const eyeEl = h('span.boon-draft-eye', { 'aria-hidden': 'true' }, icon('eye', 18));
  const closeBtn = h('button.btn-icon.boon-draft-close', { type: 'button', onClick: () => later(), 'aria-label': 'Decide later' }, icon('close', 16));
  const noteEl = h('p.boon-draft-note', { role: 'note' }, icon('scroll', 14), h('span', {}, ''));
  noteEl.hidden = true;
  // tutorial K1: a static hint line on the first draft (the coach layer sits under dialogs)
  const hintEl = h('p.boon-draft-hint', { role: 'note' }, icon('star', 14), h('span', {}, ''));
  hintEl.hidden = true;

  const cards = [0, 1, 2].map((i) => makeCard(i));
  const listEl = h('div.boon-cards', { role: 'group', 'aria-label': 'Boons on offer' }, ...cards.map((c) => c.el));

  const rerollCost = h('span.boon-reroll-cost.nums', {}, '1');
  const rerollBtn = h('button.btn.btn-secondary.boon-reroll', { type: 'button', onClick: () => { if (!busy && !rerollBtn.disabled) onReroll?.(); } },
    icon('speed', 16), h('span', {}, 'Reroll'), h('span.boon-reroll-price', {}, icon('laurel', 14), rerollCost));
  const laterBtn = h('button.btn.btn-secondary.boon-later', { type: 'button', onClick: () => later() }, 'Decide later');
  const statusEl = h('p.visually-hidden', { role: 'status', 'aria-live': 'polite' }, '');

  const panel = h('div.boon-draft-panel.glass-panel', {},
    h('div.boon-draft-head', {}, eyeEl, h('div.boon-draft-heading', {}, kickerEl, titleEl, subEl), closeBtn),
    noteEl, hintEl, listEl,
    h('div.boon-draft-actions', {}, rerollBtn, laterBtn),
    statusEl);
  const el = h('div.boon-draft', {}, h('div.boon-draft-veil', { 'aria-hidden': 'true' }), panel);
  el.hidden = true;
  watchDialog(el, { labelEl: panel, titleEl, onEscape: () => later(), initialFocus: () => cards[0].el });

  // arrow keys move between the cards (a row on desktop, a column on a phone: both axes work)
  listEl.addEventListener('keydown', (e) => {
    const i = cards.findIndex((c) => c.el === document.activeElement);
    if (i < 0) return;
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    cards[(i + step + cards.length) % cards.length].el.focus();
  });

  function makeCard(i) {
    const rarityEl = h('span.boon-card-rarity', {}, '');
    const warnEl = h('span.boon-card-warn', { 'aria-hidden': 'true' }, '!');
    const iconEl = h('span.boon-card-icon', { 'aria-hidden': 'true' });
    const nameEl = h('span.boon-card-name', {}, '');
    const textEl = h('span.boon-card-text', {}, '');
    const duoEl = h('span.boon-card-duo', {}, icon('duoLink', 14), h('span', {}, ''));
    const cardEl = h('button.boon-card', { type: 'button', onClick: () => pick(i) },
      h('span.boon-card-top', {}, rarityEl, warnEl), iconEl, h('span.boon-card-words', {}, nameEl, textEl, duoEl));
    return { el: cardEl, rarityEl, warnEl, iconEl, nameEl, textEl, duoEl, iconName: '', id: '' };
  }

  function fillCard(c, v) {
    const frame = boonFrame(v);
    if (c.el.dataset.rarity !== frame) c.el.dataset.rarity = frame;
    c.el.dataset.boon = v.id;
    c.id = v.id;
    put(c.rarityEl, v.cursed ? `Cursed · ${RARITY_WORD[v.rarity] || 'Common'}` : RARITY_WORD[v.rarity] || 'Common');
    c.warnEl.hidden = !v.cursed;
    if (c.iconName !== v.icon) { c.iconName = v.icon; c.iconEl.replaceChildren(icon(v.icon, 40)); }
    put(c.nameEl, v.name);
    put(c.textEl, v.text);
    c.duoEl.hidden = !v.duo;
    put(c.duoEl.lastChild, v.duo || '');
    const label = `${v.name}, ${v.cursed ? 'cursed ' : ''}${RARITY_WORD[v.rarity] || 'Common'} Boon: ${v.text}${v.duo ? `. ${v.duo}` : ''}`;
    if (c.el.getAttribute('aria-label') !== label) c.el.setAttribute('aria-label', label);
  }

  function pick(i) {
    if (busy || !data) return;
    const c = cards[i];
    if (!c.id) return;
    onPick?.(c.id);
  }

  function later() {
    if (busy) return;
    onLater?.();
  }

  /** @param {BoonDraftData} d */
  function update(d) {
    if (!d) return;
    const sigBefore = data ? data.choices.map((c) => c.id).join(',') : '';
    data = d;
    busy = false;
    el.classList.remove('is-chosen');
    const champ = d.source === 'champion';
    el.classList.toggle('is-champion-eye', champ);
    eyeEl.classList.toggle('is-off', !champ);
    put(kickerEl, champ ? "The Champion's eye" : d.source === 'victory' ? `Spoils of ${d.regionName || 'victory'}` : 'Boon pending');
    put(subEl, champ ? 'Your victory over the Champion shows you rarer gifts: every card is Rare or better.' : 'It lasts the dynasty, and Boons stack.');
    noteEl.hidden = !d.note;
    put(noteEl.lastChild, d.note || '');
    hintEl.hidden = !d.hint;
    put(hintEl.lastChild, d.hint || '');
    d.choices.slice(0, 3).forEach((v, i) => fillCard(cards[i], v));
    for (const c of cards) c.el.classList.remove('is-picked', 'is-passed');
    const r = d.reroll;
    rerollBtn.hidden = !r;
    if (r) {
      put(rerollCost, String(r.cost));
      rerollBtn.disabled = !r.can;
      const label = r.can ? `Reroll the offer for ${r.cost} Renown` : `Reroll: ${r.reason || `needs ${r.cost} Renown`}`;
      if (rerollBtn.getAttribute('aria-label') !== label) { rerollBtn.setAttribute('aria-label', label); rerollBtn.title = label; }
    }
    put(laterBtn, d.laterLabel || 'Decide later');
    const sig = d.choices.map((c) => c.id).join(',');
    if (sig !== sigBefore && !el.hidden) {
      // a reroll: the new cards deal in again, and a screen reader hears what is now on offer
      el.classList.remove('is-dealt');
      void el.offsetWidth;
      el.classList.add('is-dealt');
      statusEl.textContent = `New offer: ${d.choices.map((c) => c.name).join(', ')}`;
    }
  }

  /** The chosen card lifts, the others fall away; `then` runs after the moment (at once under Reduce Motion). */
  function celebrate(id, then) {
    busy = true;
    el.classList.add('is-chosen');
    for (const c of cards) { c.el.classList.toggle('is-picked', c.id === id); c.el.classList.toggle('is-passed', c.id !== id); }
    const card = cards.find((c) => c.id === id);
    statusEl.textContent = card ? `${card.nameEl.textContent} chosen` : '';
    const still = document.documentElement.classList.contains('reduce-motion');
    setTimeout(() => { busy = false; then?.(); }, still ? 60 : 620);
  }

  function show() {
    el.classList.remove('is-dealt');
    el.hidden = false;
    void el.offsetWidth;
    el.classList.add('is-dealt');
  }
  function hide() { el.hidden = true; busy = false; }

  return { el, update, show, hide, celebrate, get open() { return !el.hidden; }, cards: () => cards.map((c) => c.el), destroy() {} };
}
