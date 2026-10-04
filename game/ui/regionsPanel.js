// The Regions list panel (DESIGN 7.5a): every region the player can see as a real button, frontier first, so the whole realm can be played without pointing at the
// map. Each row is one button named by a full sentence ("Greenreach: Free Folk, tier 1. Easy: your chance to win is about 4 in 5. Can be attacked."); choosing it
// opens that region's card exactly as clicking the map would. Browser only; the rows arrive as plain data (game/app/regionsList.js).
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { watchDialog } from './dialogs.js';
import { shortNumber } from './format.js';
import { createGrudgeMeter } from './grudgeMeter.js';

/**
 * @typedef {Object} BountyRowData
 * @property {number} slot
 * @property {string} id              the contract's id (a new id in a slot = a new contract)
 * @property {string} text            "Conquer a Gold Mine"
 * @property {number} progress
 * @property {number} goal
 * @property {{ gold: number, renown?: number, xp?: number }} reward
 * @property {'free'|number} rerollCost
 * @property {boolean} canReroll
 * @property {boolean} [isNew]        drawn since the board was last seen
 *
 * @typedef {Object} BoardData
 * @property {boolean} unlocked
 * @property {string} [lockedText]
 * @property {string} [rerollNote]    "Free reroll ready" / "Free reroll in 12 min"
 * @property {BountyRowData[]} contracts
 *
 * @typedef {Object} RivalData
 * @property {number} faction
 * @property {string} name            "the Crimson Legion"
 * @property {string} leader          "Khan Bokbek"
 * @property {string} emblem
 * @property {string} color
 * @property {import('./grudgeMeter.js').GrudgeData} grudge
 */

/**
 * @param {{ onSelect?: (id: number) => void, onClose?: () => void }} [callbacks]
 */
export function createRegionsPanel({ onSelect, onClose, onReroll } = {}) {
  const listEl = h('div.regions-list', {});

  // --- the Bounty Board (PLAN-PHASE4 §4A): three contract rows, built once per slot and patched (THE CLICK RULE: a Reroll press must survive a refresh) ---
  const boardStatus = h('p.bounty-status', { role: 'status' }, '');
  const rerollNote = h('span.bounty-reroll-note', {}, '');
  const boardList = h('ul.bounty-list', { role: 'list' });
  const lockedEl = h('p.bounty-locked', {}, '');
  const board = h('section.bounty-board', { 'aria-label': 'Bounty Board' },
    h('h3.bounty-head', {}, icon('bounty', 18), 'Bounty Board', rerollNote), lockedEl, boardList, boardStatus);
  board.hidden = true;
  const slotEls = [];
  function slotRow(i) {
    if (slotEls[i]) return slotEls[i];
    const text = h('p.bounty-text', {}, '');
    const barFill = h('span');
    const count = h('span.bounty-count.nums', {}, '');
    const gold = h('span.is-gold', {}, icon('coin', 14), h('span.nums', {}, ''));
    const renown = h('span.is-renown', {}, icon('laurel', 14), h('span.nums', {}, ''));
    const xp = h('span.is-xp', {}, icon('star', 14), h('span.nums', {}, ''));
    const costEl = h('span.bounty-reroll-cost', {}, '');
    const btn = h('button.btn.btn-secondary.bounty-reroll', { type: 'button', onClick: () => onReroll?.(slotEls[i].slot ?? i) }, h('span', {}, 'Reroll'), costEl);
    const li = h('li.bounty-row', { 'data-slot': String(i) }, text,
      h('div.bounty-progress', { 'aria-hidden': 'true' }, h('span.bounty-bar', {}, barFill), count),
      h('div.bounty-reward', {}, gold, renown, xp), btn);
    slotEls[i] = { li, text, barFill, count, gold, renown, xp, btn, costEl, id: null, costKey: '' };
    return slotEls[i];
  }
  const put = (node, t) => { if (node.textContent !== t) node.textContent = t; };
  /** @param {BoardData|null} b */
  function updateBoard(b) {
    board.hidden = !b;
    if (!b) return;
    lockedEl.hidden = !!b.unlocked;
    put(lockedEl, b.unlocked ? '' : (b.lockedText || 'Contracts open after your first conquest beyond home.'));
    put(rerollNote, b.unlocked ? (b.rerollNote || '') : '');
    const list = b.unlocked ? b.contracts || [] : [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const r = slotRow(i);
      if (boardList.children[i] !== r.li) boardList.insertBefore(r.li, boardList.children[i] || null);
      put(r.text, c.text);
      const goal = Math.max(1, c.goal || 1);
      const prog = Math.max(0, Math.min(goal, c.progress || 0));
      r.barFill.style.width = `${(100 * prog) / goal}%`;
      put(r.count, `${prog}/${goal}`);
      put(r.gold.lastChild, shortNumber(c.reward.gold || 0));
      r.renown.hidden = !(c.reward.renown > 0);
      put(r.renown.lastChild, `${c.reward.renown || 0}`);
      r.xp.hidden = !(c.reward.xp > 0);
      put(r.xp.lastChild, `${c.reward.xp || 0} XP`);
      r.li.classList.toggle('is-new', !!c.isNew);
      const costKey = String(c.rerollCost);
      if (r.costKey !== costKey) {
        r.costKey = costKey;
        r.costEl.replaceChildren(...(c.rerollCost === 'free' ? [h('span', {}, 'free')] : [icon('laurel', 11), h('span.nums', {}, String(c.rerollCost))]));
      }
      if (r.btn.disabled !== !c.canReroll) r.btn.disabled = !c.canReroll;
      const aria = `Reroll this contract (${c.rerollCost === 'free' ? 'free' : `${c.rerollCost} Renown`}): ${c.text}`;
      if (r.btn.getAttribute('aria-label') !== aria) r.btn.setAttribute('aria-label', aria);
      const sr = `${c.text}. ${prog} of ${goal}. Reward ${shortNumber(c.reward.gold || 0)} gold${c.reward.renown > 0 ? `, ${c.reward.renown} Renown` : ''}${c.reward.xp > 0 ? `, ${c.reward.xp} XP for the commander` : ''}.`;
      if (r.li.getAttribute('aria-label') !== sr) r.li.setAttribute('aria-label', sr);
      r.id = c.id;
      r.slot = c.slot ?? i;
    }
    for (let i = list.length; i < slotEls.length; i++) if (slotEls[i] && slotEls[i].li.parentNode) slotEls[i].li.remove();
  }
  /** A reroll's result, said in the board (never a toast over the open panel). */
  function setBoardStatus(message, kind) {
    put(boardStatus, message || '');
    boardStatus.classList.toggle('is-warning', kind === 'warning');
  }

  // --- rival leaders and their Grudge (PLAN-PHASE4 §4D) ---
  const rivalsList = h('div.rivals-list', {});
  const rivalsEl = h('section.rivals-strip', { 'aria-label': 'Rival leaders' }, h('h3.rivals-title', {}, 'Rival leaders'), rivalsList);
  rivalsEl.hidden = true;
  const rivalEls = new Map();
  /** @param {RivalData[]|null} list */
  function updateRivals(list) {
    rivalsEl.hidden = !list || !list.length;
    if (!list) return;
    const keep = new Set();
    list.forEach((r, i) => {
      keep.add(r.faction);
      let e = rivalEls.get(r.faction);
      if (!e) {
        const portrait = h('span.rival-portrait', { 'aria-hidden': 'true' }, icon(r.emblem || 'flag', 18));
        const leaderEl = h('span', {}, '');
        const factionEl = h('small', {}, '');
        const name = h('span.rival-name', {}, leaderEl, ' ', factionEl);
        const meter = createGrudgeMeter();
        e = { row: h('div.rival-row', { 'data-faction': String(r.faction) }, portrait, name, meter.el), portrait, leaderEl, factionEl, meter };
        rivalEls.set(r.faction, e);
      }
      e.portrait.style.setProperty('--chip-color', r.color || '#888');
      put(e.leaderEl, r.leader || '');
      put(e.factionEl, r.name || '');
      e.meter.el.hidden = !r.grudge; // no Grudges in a Peace of the Crowns (PLAN-PHASE5 §5A)
      if (r.grudge) e.meter.update({ ...r.grudge, leader: r.leader });
      if (rivalsList.children[i] !== e.row) rivalsList.insertBefore(e.row, rivalsList.children[i] || null);
    });
    for (const [f, e] of rivalEls) if (!keep.has(f)) { e.row.remove(); rivalEls.delete(f); }
  }
  const el = h('div.regions.glass-panel', {},
    h('div.regions-header', {},
      h('h2.regions-title', {}, 'Regions'),
      h('button.btn-icon.regions-close', { onClick: () => onClose?.(), 'aria-label': 'Close' }, icon('close', 16)),
    ),
    h('div.regions-body.scroll-y', {}, board, rivalsEl, h('p.regions-hint', {}, 'Choose a region to open its card. The ones you can attack come first.'), listEl),
  );
  watchDialog(el, { onEscape: () => onClose?.() });

  let lastSig = '';

  function emblemEl(r) {
    const e = h('span.region-row-emblem', {}, icon(r.owner.emblem || 'flag', 16));
    e.style.setProperty('--chip-color', r.owner.colorLight || r.owner.color);
    return e;
  }

  function rowEl(r) {
    const btn = h('button.region-row', {
      type: 'button',
      'data-region': String(r.id),
      'data-kind': r.kind,
      'aria-label': r.summary,
      onClick: () => onSelect?.(r.id),
    },
    emblemEl(r),
    h('span.region-row-main', {},
      h('span.region-row-name', {}, r.name),
      h('span.region-row-sub', {}, r.kind === 'owned' ? `Yours · ${r.tier === 0 ? 'Home' : `Tier ${r.tier}`}` : `${r.owner.name} · Tier ${r.tier}`),
    ),
    r.kind === 'owned'
      ? h('span.region-row-status.is-owned', {}, r.crowns != null ? `${r.crowns}/3 crowns` : 'Home')
      : h('span.region-row-status', {},
        r.surrender
          ? h('span.matchup-chip.pill.diff-easy', {}, 'Surrender')
          : r.blocked
            ? h('span.pill.region-row-blocked', {}, 'Walled off')
            : h(`span.matchup-chip.pill.diff-${String(r.label).toLowerCase()}`, {}, r.label),
        r.blocked && !r.surrender ? h('span.region-row-chance', {}, 'No passable border') : h('span.region-row-chance', {}, r.surrender ? 'No battle needed' : r.chanceText || ''),
      ));
    // the visible words are the label; the sentence is the accessible name, so the row never reads as a pile of fragments
    for (const c of btn.querySelectorAll('.region-row-main, .region-row-status, .region-row-emblem')) c.setAttribute('aria-hidden', 'true');
    return btn;
  }

  /** @param {{ rows: import('../app/regionsList.js').RegionRow[] }} data */
  function update(data) {
    if (!data) return;
    if (data.board !== undefined) updateBoard(data.board);
    if (data.rivals !== undefined) updateRivals(data.rivals);
    if (!data.rows) return;
    const rows = data.rows || [];
    const sig = rows.map((r) => `${r.id}|${r.summary}|${r.chanceText}|${r.label}`).join(';');
    if (sig === lastSig) return;
    lastSig = sig;
    const focusedId = el.contains(document.activeElement) && document.activeElement.dataset ? document.activeElement.dataset.region : null;
    clear(listEl);
    const front = rows.filter((r) => r.kind === 'frontier');
    const own = rows.filter((r) => r.kind === 'owned');
    const group = (title, list, cls) => {
      if (!list.length) return;
      listEl.appendChild(h(`h3.regions-group.${cls}`, {}, title, h('span.regions-count.nums', {}, String(list.length))));
      const ul = h('ul.regions-group-list', { role: 'list' });
      for (const r of list) ul.appendChild(h('li', {}, rowEl(r)));
      listEl.appendChild(ul);
    };
    group('Frontier', front, 'is-frontier');
    group('Your regions', own, 'is-owned');
    // the first row takes focus when the panel opens (the most useful place to start)
    const first = listEl.querySelector('.region-row');
    if (first) first.dataset.autofocus = '';
    if (focusedId != null) { const again = listEl.querySelector(`.region-row[data-region="${focusedId}"]`); if (again) again.focus({ preventScroll: true }); }
  }

  function destroy() { clear(el); }

  return { el, update, destroy, setBoardStatus, board, rerollButton: (i) => (slotEls[i] && slotEls[i].li.isConnected ? slotEls[i].btn : null) };
}
