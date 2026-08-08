// The two strips of the pre-battle screen: the expedition and the boosters.
//
// Both are full rebuilds — the lists are small and a rebuild keeps the rendered
// counts and the model impossible to desynchronise. The scene owns the state and
// hands it in; nothing here reads ctx, so both panels are drivable from a test.

import { h, clear, mount } from '../ui/dom.js';
import { UI } from '../content/strings.js';
import { UNIT_IDS, UNITS } from '../content/balance.js';
import { canNudge } from '../meta/composition.js';
import {
  UNIT_LABEL, BOOSTER_LABEL, BOOSTER_NOTE, budgetSummary, describeComposition, slotCost,
} from './prebattle-brief.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Repaint the expedition strip.
 * @param {HTMLElement} body
 * @param {{chosen:object, unlocked:string[], budget:number, focusKey:?string,
 *          onStep:(unitId:string, delta:number)=>void}} view
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

  const list = h('ul.pb-units', { role: 'list' });
  for (const id of UNIT_IDS) {
    if (!unlocked.includes(id)) continue;
    mount(list, unitRow(id, view));
  }
  mount(body, list);

  // The list is rebuilt on every step, so put focus back where the player left
  // it or the control is unusable from the keyboard after one press.
  if (view.focusKey) {
    const btn = body.querySelector(`[data-step="${view.focusKey}"]`);
    (btn && !btn.disabled ? btn : body.querySelector('.pb-step:not([disabled])'))?.focus();
  }
  return `Expedition: ${describeComposition(chosen, unlocked)}. `
    + `${sum.spent} of ${sum.budget} slots spent.`;
}

function unitRow(id, view) {
  const { chosen, unlocked, budget, onStep } = view;
  const count = chosen[id] ?? 0;
  const cost = slotCost(id);
  const stat = UNITS[id];
  const capped = (UNITS[id].maxPerSite ?? Infinity) !== Infinity;

  const step = (delta, symbol, word) => {
    const ok = canNudge(chosen, id, delta, unlocked, budget);
    return h('button.btn.pb-step', {
      type: 'button', text: symbol, disabled: !ok,
      'aria-disabled': ok ? null : 'true',
      'aria-label': `${word} ${UNIT_LABEL[id]}, ${plural(cost, 'slot')} each`,
      'data-step': `${id}:${delta}`,
      on: { click: () => onStep(id, delta) },
    });
  };

  return h('li.pb-unit', { 'data-unit': id },
    h('div.pb-unit-main', {},
      h('span.pb-unit-name', {},
        h('span', { text: UNIT_LABEL[id] }),
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
      h('span.num.pb-unit-count', {
        text: `${count}`,
        'aria-label': `${count} ${UNIT_LABEL[id]}, ${plural(count * cost, 'slot')}`,
      }),
      step(1, '+', 'One more')));
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
