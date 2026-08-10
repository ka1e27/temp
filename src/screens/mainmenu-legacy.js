// The abdication drawer — the prestige decision, and the only place in the game
// that deliberately throws an empire away.
//
// Split out of ./mainmenu.js for the line budget, in the same shape as its
// settings and export drawers: this file owns the CONTENT of one drawer and
// nothing about the menu around it.
//
// IT IS BUILT LIKE THE "NEW CAMPAIGN" CONFIRMATION AND NOT LIKE A REWARD SCREEN,
// on purpose. Both destroy progress, so both name exactly what is about to go and
// both cost a second click. The difference — the whole difference — is the line
// that says what is KEPT, because that is the part a player is actually deciding
// about, and a prestige button that undersells it is a button nobody presses.
import { h, clear, mount } from '../ui/dom.js';
import { compact } from '../ui/format.js';
import { ENDGAME } from '../content/strings.js';
import { legacyView } from '../meta/legacy.js';
import { abdicate, headStartFor } from '../meta/prestige.js';
import { markDirty } from '../core/store.js';
import { clearBattle } from '../meta/resume.js';

/** One `dt`/`dd` pair for the payout table. */
const row = (label, value) => [h('dt.label', { text: label }), h('dd.num', { text: value })];

/**
 * Render the abdication drawer.
 *
 * @param {HTMLElement} drawer
 * @param {object} ctx        scene context (needs `state`, `bus`, `storage`)
 * @param {{onDone:()=>void, onCancel:()=>void}} io
 * @returns {HTMLElement|null} the control to focus
 */
export function renderAbdicate(drawer, ctx, { onDone, onCancel }) {
  clear(drawer);
  const meta = ctx.state.meta;
  const view = legacyView(meta);

  const held = view.points > 0
    ? h('p.set-hint', {
      text: `You hold ${ENDGAME.legacyHeld(view.points)}: +${Math.round(view.bonus.income * 100)}%`
        + ` income, +${Math.round(view.bonus.atk * 100)}% attack and defence,`
        + ` +${Math.round(view.bonus.expedition * 100)}% expedition.`,
    })
    : h('p.set-hint.dim', { text: ENDGAME.legacyNone });

  if (!view.canAbdicate) {
    // Reachable only from a stale menu — the button is not offered otherwise — so
    // it explains rather than failing, exactly like the incursion overlay does.
    mount(drawer, h('div.menu-drawer.menu-legacy', {},
      h('h3.menu-drawer-title', { text: ENDGAME.abdicateTitle }),
      h('p', { text: ENDGAME.abdicateLocked }),
      held,
      h('button.btn.ghost', { type: 'button', text: 'Close', on: { click: onCancel } })));
    return drawer.querySelector('button');
  }

  const { payout } = view;
  mount(drawer, h('div.menu-drawer.menu-legacy', { role: 'group', 'aria-label': 'Abdicate' },
    h('h3.menu-drawer-title', { text: ENDGAME.abdicateTitle }),
    h('p', { text: ENDGAME.abdicateHint }),
    // The payout, itemised. `abdicationValue` is the only implementation of the
    // formula and this reads it — a second copy here would be a number that could
    // disagree with what the button actually pays.
    h('dl.menu-empire.legacy-payout', {},
      ...row('Regions held', `${payout.regions} → ${payout.fromRegions} legacy`),
      ...row('Deepest rung', `${payout.rungs} → ${payout.fromDepth} legacy`),
      ...row('This abdication pays', `${payout.points} legacy`),
      ...row('Crowns given up', compact(meta.crowns)),
      // The head start is the bigger half of the reward and it has to be on the
      // table the player reads before pressing, not a surprise on the world map.
      ...row('Next run opens with', `${headStartFor(view.resets + 1)} regions`)),
    held,
    h('p.set-note.dim', { text: ENDGAME.legacyWorth }),
    h('div.row', {},
      h('button.btn.primary.menu-abdicate-go', {
        type: 'button', text: ENDGAME.abdicateGo,
        'aria-label': `${ENDGAME.abdicateConfirm} It pays ${payout.points} legacy.`,
        on: {
          click: () => {
            const result = abdicate(meta, { bus: ctx.bus });
            if (!result.ok) { onCancel(); return; }
            // A mid-battle blob outlives the empire it belongs to otherwise: its
            // config names a region this save no longer holds, and meta/resume.js
            // validates the CONTRACT rather than the campaign, so it would happily
            // drop the player back into a battle for ground that is not theirs.
            clearBattle(ctx.storage);
            markDirty(ctx.state);
            onDone(result);
          },
        },
      }),
      h('button.btn.ghost', { type: 'button', text: 'Cancel', on: { click: onCancel } }))));

  return drawer.querySelector('.menu-abdicate-go');
}
