// Region Works panel for the OWNED region card (DESIGN §5.8). Browser only; no game-logic imports: the integrator
// builds the data with `worksPanelData(state, world, regionId, now)` from game/meta/works.js and passes it in on every
// card refresh; the buttons call back with plain ids.
//
//   const works = createWorksPanel({ onBuild: (regionId, slot, type) => ..., onUpgrade: (regionId, slot) => ... });
//   ownedCardBody.append(works.el);
//   works.update(worksPanelData(state, world, regionId, Date.now()));
//
// One row per slot, always three of them so the card never jumps as prosperity opens slots:
//   built    icon chip, name, level pips, "what it does now", and an Upgrade button with its price
//            (disabled with the reason when it cannot be paid, or "Maxed" at level III)
//   empty    a "Build..." button; it swaps the list for the chooser (worksChooser.js) in place
//   locked   "Unlocks at Prosperity II" with the countdown when the data has one
// A built row also has a small "..." at the end of its name line. It leads to one thing: Demolish. Tapping it turns the row into
// a confirm step ("Demolish Barracks? Refund 190 gold" with Keep / Demolish) in the same space, so the row never grows and
// nothing is destroyed by a single tap. It cancels itself on Keep, Escape, a region change, the chooser opening, or after a few
// seconds, so a stray prompt never lingers.
//
// BUILT ONCE and patched in place, like the region card around it (see regionCard.js): the card refreshes about once a
// second, so a rebuilt button between a pointerdown and pointerup would swallow the tap. Slot rows are created once and
// every patch (text, pips, `disabled`, the cost nodes) is skipped when its value did not change, so an update identical to
// the last touches nothing.
import { h } from './dom.js';
import { icon } from './icons.js';
import { worksIcon } from './worksIcons.js';
import { createWorksChooser } from './worksChooser.js';
import { shortNumber, formatDurationWords } from './format.js';

/**
 * @typedef {Object} WorkSlotView   (game/meta/works.js)
 * @property {number} index
 * @property {'built'|'empty'|'locked'} state
 * @property {string} [type]  @property {string} [name]
 * @property {number} [level] @property {number} [maxLevel]
 * @property {string} [effect]            built: what it does now
 * @property {string|null} [nextEffect]   built: what the next level does
 * @property {number|null} [upgradeCost]  built: gold for the next level, null when maxed
 * @property {boolean} [affordable]       built: can pay the next level
 * @property {string|null} [reason]       built: why the upgrade is disabled
 * @property {boolean} [canBuild]         empty: something is affordable
 * @property {number|null} [cheapest]     empty: the cheapest Work's price
 * @property {string} [unlockLabel]       locked: "Unlocks at Prosperity II"
 * @property {number|null} [unlockInMs]   locked: time until it opens
 *
 * @typedef {Object} WorksPanelData
 * @property {number} regionId
 * @property {number} gold
 * @property {boolean} owned
 * @property {WorkSlotView[]} slots
 * @property {number} freeSlot            -1 when no empty unlocked slot
 * @property {import('./worksChooser.js').WorkChoice[]} choices
 * @property {string} intro
 */

const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };
/** Writes a data-* attribute or an aria/title attribute only when it would change (an identical refresh touches nothing). */
const setData = (node, key, value) => { const v = String(value); if (node.dataset[key] !== v) node.dataset[key] = v; };
const setAttr = (node, key, value) => { if (node.getAttribute(key) !== value) node.setAttribute(key, value); };
const setHidden = (node, hidden) => { if (node.hidden !== hidden) node.hidden = hidden; };
const setTitle = (node, value) => { if (node.title !== value) node.title = value; };

const CONFIRM_MS = 6000;

/** The words of the panel: Region Works by default; the Fortifications panel (DESIGN 10.3) passes its own (same panel, same patterns). */
export const WORKS_PANEL_COPY = Object.freeze({
  title: 'Works', chooseTitle: 'Build a Work', subLong: 'Helps battles in the regions next to this one', subTitle: 'Helps battles in the regions next to this one',
  subShort: 'Helps battles in nearby regions', backLabel: 'Back to the Works list', slotsLabel: 'Works slots', groupLabel: 'Region Works',
  chooseTip: 'Choose a Work to build in this slot.', noneAffordable: 'Every Work is out of reach for now', chooserLabel: 'Works you can build',
});

/**
 * @param {{ onBuild?: (regionId: number, slot: number, type: string) => void,
 *           onUpgrade?: (regionId: number, slot: number) => void,
 *           onDemolish?: (regionId: number, slot: number) => void,
 *           onView?: (view: 'slots'|'choose') => void }} [callbacks]
 *   `onView` fires when the panel swaps between the slot list and the chooser (the card may want to scroll).
 */
export function createWorksPanel({ onBuild, onUpgrade, onDemolish, onView, copy = WORKS_PANEL_COPY, iconFor = worksIcon } = {}) {
  let data = null;
  let confirmSlot = -1;
  let confirmTimer = 0;
  let view = 'slots';
  let chooseSlot = -1;
  let lastRegionId = null;

  const chooser = createWorksChooser({
    iconFor, listLabel: copy.chooserLabel,
    onPick: (type) => { if (data && chooseSlot >= 0) onBuild?.(data.regionId, chooseSlot, type); },
  });

  // --- header ---------------------------------------------------------------------------
  const titleEl = h('span.works-title', {}, copy.title);
  // the full sentence on a wide screen; a phone sheet has no room for a second line, so it gets the short one (the full words stay in the tooltip and for a screen reader)
  const subEl = h('span.works-sub', { title: copy.subTitle },
    h('span.works-sub-long', {}, copy.subLong),
    h('span.works-sub-short', { 'aria-hidden': 'true' }, copy.subShort));
  const backBtn = h('button.works-back', { type: 'button', 'aria-label': copy.backLabel, onClick: () => setView('slots') },
    icon('close', 12), h('span', {}, 'Back'));
  const headEl = h('div.works-head', {}, titleEl, subEl, backBtn);
  backBtn.hidden = true;

  // --- the three slot rows (built once, patched in place) ------------------------------------
  function makeSlot(index) {
    const chip = h('span.works-chip', { dataset: { type: '' } });
    const nameEl = h('strong.works-slot-name', {}, '');
    const pips = [0, 1, 2].map((i) => h('span.works-pip', { dataset: { on: '0', i: String(i) } }));
    const pipsEl = h('span.works-pips', { role: 'img' }, ...pips);
    const moreBtn = h('button.works-more', {
      type: 'button', title: 'Demolish\u2026',
      onClick: () => askDemolish(index),
    }, worksIcon('more', 16));
    const effectEl = h('span.works-slot-effect', {}, '');
    const upgradeLabel = h('span.works-btn-label', {}, 'Upgrade');
    const upgradeCost = h('span.works-btn-cost', {});
    const upgradeBtn = h('button.btn.btn-secondary.works-upgrade', {
      type: 'button',
      onClick: () => { if (data && !upgradeBtn.disabled) onUpgrade?.(data.regionId, index); },
    }, upgradeLabel, upgradeCost);
    const buildLabel = h('span.works-btn-label', {}, 'Build…');
    const buildHint = h('span.works-build-hint', {}, '');
    const buildBtn = h('button.btn.btn-secondary.works-build', {
      type: 'button',
      onClick: () => openChooser(index),
    }, worksIcon('build', 16), buildLabel, buildHint);
    const lockText = h('span.works-lock-text', {}, '');
    const lockNext = h('span.works-lock-next', {}, '');
    const lockEl = h('span.works-lock', {}, lockText, lockNext);

    // the confirm step: text where the name and effect were, Keep / Demolish where the Upgrade button was
    const confirmText = h('span.works-confirm-text', {}, '');
    const keepBtn = h('button.btn.btn-secondary.works-keep', { type: 'button', onClick: () => cancelDemolish() }, 'Keep');
    const demolishBtn = h('button.btn.btn-danger.works-demolish', {
      type: 'button',
      onClick: () => {
        const slotIdx = confirmSlot;
        cancelDemolish(false);
        if (data && slotIdx >= 0) onDemolish?.(data.regionId, slotIdx);
      },
    }, 'Demolish');
    const confirmActions = h('span.works-confirm-actions', {}, keepBtn, demolishBtn);

    const main = h('div.works-slot-main', {}, h('div.works-slot-line', {}, nameEl, pipsEl, moreBtn), effectEl);
    const row = h('div.works-slot', { role: 'listitem', dataset: { state: 'locked', index: String(index), confirm: '0' } },
      chip, main, upgradeBtn, buildBtn, lockEl, confirmText, confirmActions);
    return {
      row, chip, nameEl, pips, pipsEl, effectEl, upgradeBtn, upgradeLabel, upgradeCost, buildBtn, buildHint, lockText, lockNext,
      moreBtn, confirmText, keepBtn, demolishBtn, chipKey: '', costKey: '',
    };
  }
  const slots = [0, 1, 2].map(makeSlot);
  const listEl = h('div.works-slots', { role: 'list', 'aria-label': copy.slotsLabel }, ...slots.map((s) => s.row));

  const chooseWrap = h('div.works-choose', {}, chooser.el);
  chooseWrap.hidden = true;

  const el = h('div.works-panel', { role: 'group', 'aria-label': copy.groupLabel, dataset: { view: 'slots' } },
    headEl, listEl, chooseWrap);

  // --- view switching ---------------------------------------------------------------------------
  function setView(next, slot = -1) {
    if (next === view && slot === chooseSlot) return;
    const leaving = view === 'choose' ? chooseSlot : -1;
    if (next === 'choose') cancelDemolish(false);
    view = next;
    chooseSlot = next === 'choose' ? slot : -1;
    setData(el, 'view', view);
    listEl.hidden = view !== 'slots';
    chooseWrap.hidden = view !== 'choose';
    backBtn.hidden = view !== 'choose';
    subEl.hidden = view === 'choose';
    setText(titleEl, view === 'choose' ? copy.chooseTitle : copy.title);
    if (data && view === 'choose') chooser.update({ choices: data.choices, intro: data.intro });
    // Keyboard users keep their place: focus moves into the chooser (Escape then works) and back to the slot's button.
    if (view === 'choose') backBtn.focus?.({ preventScroll: true });
    else if (leaving >= 0 && slots[leaving]) {
      const s = slots[leaving];
      (s.row.dataset.state === 'built' ? s.upgradeBtn : s.buildBtn).focus?.({ preventScroll: true });
    }
    onView?.(view);
  }
  function openChooser(slot) {
    if (!data || !data.choices.length) return;
    setView('choose', slot);
  }

  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (confirmSlot >= 0) { e.stopPropagation(); cancelDemolish(); } else if (view === 'choose') { e.stopPropagation(); setView('slots'); }
  });

  // --- demolish: ask, then confirm ---------------------------------------------------------------------
  function askDemolish(slot) {
    if (!data || view !== 'slots' || !slots[slot] || slots[slot].row.dataset.state !== 'built') return;
    cancelDemolish(false);
    confirmSlot = slot;
    slots[slot].row.style.minHeight = `${slots[slot].row.offsetHeight}px`; // the confirm step takes the row's own height: the list never jumps
    setData(slots[slot].row, 'confirm', '1');
    clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => cancelDemolish(false), CONFIRM_MS);
    slots[slot].keepBtn.focus?.({ preventScroll: true }); // the safe answer is the default one
  }
  /** @param {boolean} [refocus]  put focus back on the row's "..." (Keep, Escape); false when something else took over */
  function cancelDemolish(refocus = true) {
    clearTimeout(confirmTimer);
    const slot = confirmSlot;
    if (slot < 0) return;
    confirmSlot = -1;
    if (slots[slot]) {
      setData(slots[slot].row, 'confirm', '0');
      slots[slot].row.style.minHeight = '';
      if (refocus) slots[slot].moreBtn.focus?.({ preventScroll: true });
    }
  }

  // --- patching -----------------------------------------------------------------------------------
  function patchCost(slot, cost) {
    const key = cost == null ? 'none' : String(cost);
    if (slot.costKey === key) return;
    slot.costKey = key;
    if (cost == null) { slot.upgradeCost.replaceChildren(); return; }
    slot.upgradeCost.replaceChildren(icon('coin', 13), h('span.nums', {}, shortNumber(cost)));
  }

  /** The chip shows the Work's own icon once built, a dashed "+" for an empty slot, a padlock for a locked one. */
  function patchChip(slot, state, type) {
    const key = state === 'built' ? `built:${type}` : state;
    if (slot.chipKey === key) return;
    slot.chipKey = key;
    setData(slot.chip, 'type', state === 'built' ? type : '');
    slot.chip.replaceChildren(state === 'built' ? iconFor(type, 20) : state === 'empty' ? worksIcon('build', 18) : icon('lock', 15));
  }

  function patchBuilt(slot, s) {
    setText(slot.nameEl, s.name);
    slot.pips.forEach((pip, i) => setData(pip, 'on', i < s.level ? '1' : '0'));
    setAttr(slot.pipsEl, 'aria-label', `Level ${s.level} of ${s.maxLevel}`);
    setText(slot.effectEl, s.effect);
    const maxed = s.upgradeCost == null;
    setData(slot.upgradeBtn, 'maxed', maxed ? '1' : '0');
    setText(slot.upgradeLabel, maxed ? 'Maxed' : 'Upgrade');
    patchCost(slot, s.upgradeCost);
    const disabled = maxed || !s.affordable;
    if (slot.upgradeBtn.disabled !== disabled) slot.upgradeBtn.disabled = disabled;
    setData(slot.upgradeBtn, 'poor', !maxed && !s.affordable ? '1' : '0');
    const tip = maxed ? `${s.name} is fully upgraded.` : s.affordable
      ? `Upgrade to level ${s.level + 1}: ${s.nextEffect}`
      : `${s.reason || 'Cannot upgrade'}. Next level: ${s.nextEffect}`;
    setTitle(slot.upgradeBtn, tip);
    setText(slot.confirmText, s.demolishPrompt || `Demolish ${s.name}?`);
    setAttr(slot.moreBtn, 'aria-label', `Demolish ${s.name}, refund ${shortNumber(s.refund || 0)} gold`);
    setAttr(slot.demolishBtn, 'aria-label', `Confirm: demolish ${s.name}, refund ${shortNumber(s.refund || 0)} gold`);
    const aria = maxed ? `${s.name}, fully upgraded`
      : `Upgrade ${s.name} to level ${s.level + 1} for ${shortNumber(s.upgradeCost)} gold${s.affordable ? '' : `. ${s.reason}`}`;
    setAttr(slot.upgradeBtn, 'aria-label', aria);
  }

  function patchEmpty(slot, s) {
    setText(slot.buildHint, s.canBuild || s.cheapest == null ? '' : `from ${shortNumber(s.cheapest)}`);
    setData(slot.buildBtn, 'poor', s.canBuild ? '0' : '1');
    const tip = s.canBuild ? copy.chooseTip : `${copy.noneAffordable} (the cheapest costs ${shortNumber(s.cheapest ?? 0)} gold).`;
    setTitle(slot.buildBtn, tip);
  }

  function patchLocked(slot, s) {
    setText(slot.lockText, s.unlockLabel || '');
    setText(slot.lockNext, s.unlockInMs != null ? ` · in ${formatDurationWords(s.unlockInMs / 1000)}` : '');
  }

  /** @param {WorksPanelData} next */
  function update(next) {
    if (!next) return;
    const sameRegion = lastRegionId === next.regionId;
    data = next;
    lastRegionId = next.regionId;
    setHidden(el, !next.owned);
    if (!next.owned) { cancelDemolish(false); setView('slots'); return; }
    if (!sameRegion) { cancelDemolish(false); setView('slots'); }

    for (let i = 0; i < slots.length; i++) {
      const s = next.slots[i];
      const slot = slots[i];
      if (!s) { setHidden(slot.row, true); continue; }
      setHidden(slot.row, false);
      setData(slot.row, 'state', s.state);
      patchChip(slot, s.state, s.type);
      if (s.state === 'built') patchBuilt(slot, s);
      else if (s.state === 'empty') patchEmpty(slot, s);
      else patchLocked(slot, s);
    }

    if (confirmSlot >= 0 && (!next.slots[confirmSlot] || next.slots[confirmSlot].state !== 'built')) cancelDemolish(false);
    // A build that landed (the slot is no longer empty) or a region with no free slot left: back to the list.
    if (view === 'choose') {
      const target = next.slots[chooseSlot];
      if (!target || target.state !== 'empty') setView('slots');
      else chooser.update({ choices: next.choices, intro: next.intro });
    }
    // Keep the chooser's rows fresh for tutorial pointers even while hidden; it is cheap and identical data is a no-op.
    else if (next.choices.length) chooser.update({ choices: next.choices, intro: next.intro });
  }

  // --- pointers for the tutorial coach -------------------------------------------------------------
  /** The "Build..." button of a slot (default: the first empty one) when it is on screen, else null. */
  function buildButton(slotIndex) {
    const idx = slotIndex != null ? slotIndex : (data ? data.freeSlot : -1);
    const slot = slots[idx];
    return slot && slot.row.dataset.state === 'empty' && view === 'slots' && !el.hidden ? slot.buildBtn : null;
  }
  /** The Upgrade button of a built slot, or null. */
  function upgradeButton(slotIndex) {
    const slot = slots[slotIndex];
    return slot && slot.row.dataset.state === 'built' && view === 'slots' && !el.hidden ? slot.upgradeBtn : null;
  }
  /** The "..." (Demolish) button of a built slot, or null. */
  function demolishButton(slotIndex) {
    const slot = slots[slotIndex];
    return slot && slot.row.dataset.state === 'built' && view === 'slots' && !el.hidden ? slot.moreBtn : null;
  }
  /** A row of the open chooser (for "tap Barracks"), or null when the chooser is closed. */
  function chooserRow(type) {
    return view === 'choose' ? chooser.row(type) : null;
  }

  function destroy() {
    clearTimeout(confirmTimer);
    chooser.destroy();
    el.replaceChildren();
    data = null;
  }

  return {
    el, update, destroy, chooser, buildButton, upgradeButton, demolishButton, chooserRow,
    openChooser, closeChooser: () => setView('slots'),
    askDemolish, cancelDemolish,
    get view() { return view; },
    /** The slot whose Demolish confirm is open, or -1. */
    get confirming() { return confirmSlot; },
  };
}
