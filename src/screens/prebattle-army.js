// The two strips of the pre-battle screen: the expedition and the boosters.
//
// Both are full rebuilds — the lists are small and a rebuild keeps the rendered
// counts and the model impossible to desynchronise. The scene owns the state and
// hands it in; nothing here reads ctx, so both panels are drivable from a test.

import { h, clear, mount } from '../ui/dom.js';
import { UI, UNITS_UI } from '../content/strings.js';
import { UNIT_IDS, UNITS } from '../content/balance.js';
import { canNudge, canAddType } from '../meta/composition.js';
import { maxCount, parseCount } from './prebattle-count.js';
import {
  UNIT_LABEL, BOOSTER_LABEL, BOOSTER_NOTE, budgetSummary, describeComposition, slotCost,
} from './prebattle-brief.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Repaint the expedition strip.
 * @param {HTMLElement} body
 * @param {{chosen:object, unlocked:string[], budget:number, focusKey:?string,
 *          notice:?string, onStep:(unitId:string, delta:number)=>void,
 *          onSet:(unitId:string, raw:string)=>void}} view
 * @returns {string} the live-region announcement for the new army
 */
export function renderArmy(body, view) {
  const { chosen, unlocked, budget } = view;
  clear(body);
  const sum = budgetSummary(chosen, budget);

  // Slots spent against slots granted is THE number on this screen: it is what
  // makes a marshal a decision rather than a free pick.
  mount(body, h('p.pb-budget', { class: sum.over ? 'is-over' : null },
    h('span.num.pb-budget-n', { text: `${sum.spent} / ${sum.budget}` }),
    h('span.label', { text: ' slots' }),
    h('span.pb-budget-troops.dim', { text: `${plural(sum.troops, 'troop')}` }),
    sum.over
      ? h('span.pb-budget-warn', { text: `over by ${plural(-sum.free, 'slot')}` })
      : h('span.pb-budget-free.dim', {
        text: sum.free > 0 ? `${plural(sum.free, 'slot')} unspent` : 'fully committed',
      })));

  // The SECOND budget. Slots say how big the army is; this says how many
  // different answers it carries. Stated as its own line rather than tucked into
  // a disabled tooltip, because a + that stops working with no visible reason is
  // read as a bug — and the whole point of the cap is that choosing is the game.
  mount(body, h('p.pb-types', { class: sum.typesFull ? 'is-full' : null },
    h('span.num.pb-types-n', { text: `${sum.types} / ${sum.typesMax}` }),
    h('span.label', { text: ' troop types' }),
    h('span.pb-types-note.dim', {
      text: sum.typesFull
        ? 'at the limit — drop one to the last body to swap it out'
        : `room for ${sum.typesMax - sum.types} more`,
    })));

  const list = h('ul.pb-units', { role: 'list' });
  for (const id of UNIT_IDS) {
    if (!unlocked.includes(id)) continue;
    // The Marshal is NOT a budget line any more. Unlocking him grants exactly
    // one on every landing, outside the budget (meta/modifiers.js
    // `withFreeMarshal`), so a row with a +/- on it would only ever let a player
    // pay 8 slots for a body they already have.
    if (id === 'marshal') continue;
    mount(list, unitRow(id, view));
  }
  if (unlocked.includes('marshal')) mount(list, freeMarshalRow());
  mount(body, list);

  // What a typed number cost, or why it did not fit. Rendered where the number
  // was typed, not saved up for the Launch button to refuse.
  if (view.notice) mount(body, h('p.pb-clamp', { role: 'status', text: view.notice }));

  restoreFocus(body, view.focusKey);
  return `Expedition: ${describeComposition(chosen, unlocked)}. `
    + `${sum.spent} of ${sum.budget} slots spent, `
    + `${sum.types} of ${sum.typesMax} troop types.`
    + (view.notice ? ` ${view.notice}` : '');
}

/**
 * The list is rebuilt on every edit, so focus has to be put back where the
 * player left it or the strip is unusable from the keyboard after one press —
 * and typing a number is now the main way to use it.
 */
function restoreFocus(body, key) {
  if (!key) return;
  if (key.startsWith('count:')) {
    const field = body.querySelector(`[data-count="${key.slice(6)}"]`);
    if (field) {
      field.focus();
      field.select?.();
      return;
    }
  }
  const btn = body.querySelector(`[data-step="${key}"]`);
  (btn && !btn.disabled ? btn : body.querySelector('.pb-step:not([disabled])'))?.focus();
}

/** What the Marshal unlock actually bought, stated where the army is chosen —
 *  otherwise "free, outside the budget" is invisible and reads as a bug. */
function freeMarshalRow() {
  const stat = UNITS.marshal;
  return h('li.pb-unit.is-free', { 'data-unit': 'marshal' },
    h('div.pb-unit-main', {},
      h('span.pb-unit-name', {},
        h('span', { text: UNIT_LABEL.marshal, title: UNITS_UI.marshal?.desc ?? '' }),
        h('span.pb-unit-free', { text: 'free' })),
      h('span.pb-unit-stat.dim', {
        text: `ATK ${stat.atk} · DEF ${stat.def} · SIEGE ${stat.siege}`,
      })),
    h('div.pb-unit-adjust', {},
      h('span.pb-unit-note.dim', { text: 'one rides with every expedition' })));
}

function unitRow(id, view) {
  const { chosen, unlocked, budget, onStep } = view;
  const count = chosen[id] ?? 0;
  const cost = slotCost(id);
  const stat = UNITS[id];
  const capped = (UNITS[id].maxPerSite ?? Infinity) !== Infinity;
  // A troop you are NOT fielding, on an army that already carries the most types
  // it may. The row is dimmed rather than hidden: what you chose not to bring is
  // part of the decision, and a list that reshuffles as you edit it is unusable.
  const shut = count === 0 && !canAddType(chosen);

  const step = (delta, symbol, word) => {
    const ok = canNudge(chosen, id, delta, unlocked, budget);
    return h('button.btn.pb-step', {
      type: 'button', text: symbol, disabled: !ok,
      'aria-disabled': ok ? null : 'true',
      'aria-label': shut && delta > 0
        ? `${UNIT_LABEL[id]} unavailable: the expedition already carries the most`
          + ' troop types it may'
        : `${word} ${UNIT_LABEL[id]}, ${plural(cost, 'slot')} each`,
      'data-step': `${id}:${delta}`,
      on: { click: () => onStep(id, delta) },
    });
  };

  return h('li.pb-unit', { 'data-unit': id, class: shut ? 'is-shut' : null },
    h('div.pb-unit-main', {},
      h('span.pb-unit-name', {},
        h('span', { text: UNIT_LABEL[id], title: UNITS_UI[id]?.desc ?? '' }),
        // The price tag. Kept out of the stat line so the row stays one line
        // tall — five rows plus a footer is already all the height there is.
        h('span.pb-unit-cost.num', {
          text: `${cost}`,
          title: `${plural(cost, 'slot')} each${capped ? ', one per battle' : ''}`,
          'aria-hidden': 'true',
        }),
        h('span.sr-only', {
          text: `costs ${plural(cost, 'slot')}${capped ? ', one per battle' : ''}`,
        })),
      h('span.pb-unit-stat.dim', {
        text: `ATK ${stat.atk} · DEF ${stat.def} · SIEGE ${stat.siege}`,
      })),
    h('div.pb-unit-adjust', {},
      step(-1, '−', 'One fewer'),
      countField(id, count, view),
      step(1, '+', 'One more')));
}

/**
 * The count, as something you can TYPE INTO. Nineteen clicks to field nineteen
 * militia was the complaint, and it was a fair one.
 *
 * The model is only touched on COMMIT (Enter, or leaving the field), because
 * `renderArmy` rebuilds the whole list and committing per keystroke would eat
 * the caret halfway through "12". While you are typing, an impossible number is
 * marked immediately — clamping is never a surprise sprung at Launch.
 */
function countField(id, count, view) {
  const { budget, onSet, onStep } = view;
  const most = maxCount(id, budget);

  /**
   * @param {HTMLInputElement} el
   * @param {string|null} [focus] where focus should land after the repaint;
   *   `undefined` keeps it in this field.
   */
  const commit = (el, focus) => {
    // An untouched field commits NOTHING. Without this, clicking from one count
    // to another rebuilt the whole strip for no reason — and the rebuild
    // destroyed the field being clicked before it ever received the focus.
    if (el.value === `${count}`) return;
    onSet(id, el.value, focus);
  };

  return h('input.num.pb-unit-count', {
    type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '4',
    value: `${count}`, 'data-count': id, autocomplete: 'off',
    'aria-label': `${UNIT_LABEL[id]} count, ${plural(slotCost(id), 'slot')} each, `
      + `at most ${most} on this budget`,
    on: {
      // Live: does what has been typed so far even fit?
      input: (e) => {
        const n = parseCount(e.currentTarget.value);
        e.currentTarget.classList.toggle('is-over', n !== null && n > most);
      },
      // Leaving the field commits it, and focus follows the player rather than
      // springing back: `relatedTarget` is where they were heading, and the
      // repaint replaces that element with an identical one.
      blur: (e) => commit(e.currentTarget, focusKeyFor(e.relatedTarget)),
      keydown: (e) => {
        // Enter must not reach prebattle.js's launch binding, and Escape must
        // not reach its back-to-the-map binding: inside a field they mean
        // "take this" and "forget it".
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit(e.currentTarget); }
        else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          e.currentTarget.value = `${count}`;
          e.currentTarget.classList.remove('is-over');
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          // Steps the model, but keeps focus in the FIELD rather than throwing
          // it at the +/- button the rebuild would otherwise land on.
          e.preventDefault();
          onStep(id, e.key === 'ArrowUp' ? 1 : -1, `count:${id}`);
        }
      },
    },
  });
}

/** The focus key for whatever the player was tabbing or clicking towards, so
 *  the repaint can put focus on its replacement. `null` for anything outside
 *  the strip — focus belongs to the browser at that point. */
function focusKeyFor(el) {
  if (!(el instanceof HTMLElement)) return null;
  return el.dataset.count ? `count:${el.dataset.count}` : (el.dataset.step ?? null);
}

/**
 * Repaint the booster strip.
 * @param {HTMLElement} body
 * @param {{items:object[], carried:Set<string>, isUsable:(b:object)=>boolean,
 *          onToggle:(id:string, on:boolean)=>void}} view
 */
export function renderBoosters(body, view) {
  clear(body);
  const list = h('ul.pb-booster-list', { role: 'list' });
  let any = false;

  for (const b of view.items) {
    const usable = view.isUsable(b);
    any = any || usable;
    mount(list, boosterRow(b, usable, usable ? null : (b.unlocked ? 'No charges' : UI.locked), view));
  }
  mount(body, list);
  if (!any) {
    mount(body, h('p.pb-note.dim', {
      text: 'No charges in stock. Buy some in Upgrades — they are only spent when fired.',
    }));
  }
}

function boosterRow(b, usable, reason, view) {
  const on = usable && view.carried.has(b.id);
  const chip = h('button.chip.pb-booster', {
    type: 'button',
    class: on ? 'is-on' : 'is-off',
    'aria-pressed': on ? 'true' : 'false',
    'aria-disabled': usable ? null : 'true',
    disabled: !usable,
    'aria-label': `${BOOSTER_LABEL[b.id]}${usable ? `, ${b.count} charges` : `, ${reason}`}`,
    on: {
      // Toggled in place rather than re-rendered: the chip keeps focus.
      click: (e) => {
        if (!usable) return;
        const next = !view.carried.has(b.id);
        view.onToggle(b.id, next);
        e.currentTarget.setAttribute('aria-pressed', String(next));
        e.currentTarget.classList.toggle('is-on', next);
        e.currentTarget.classList.toggle('is-off', !next);
      },
    },
  },
  h('span.pb-booster-name', { text: BOOSTER_LABEL[b.id] }),
  h('span.num.pb-booster-count', { text: usable ? `x${b.count}` : (reason ?? '') }));

  return h('li.pb-booster-row', { 'data-booster': b.id },
    chip,
    h('span.pb-booster-note.dim', { text: BOOSTER_NOTE[b.id] ?? '' }));
}
