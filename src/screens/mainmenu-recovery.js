// WHAT TO DO WHEN A SAVE CANNOT BE READ.
//
// Split from mainmenu.js at the 400-line cap, alongside its settings and
// abdication siblings.
//
// This existed as strings and an API and nothing else. `SAVE.restoreBackup`,
// `SAVE.autosaveOff` and `save.js loadBackup()` all had ZERO consumers, and the
// one message that was wired — `SAVE.refusedTitle` — sat twenty lines below an
// early return that a refused save always took, because a refused save produces
// a blank state and a blank state is a fresh campaign. So the player was dropped
// into region 1 of a new game with nothing but a console warning.
//
// `save.js load()` is documented as never writing and never deleting, precisely
// so a screen can offer this instead of "your progress is gone". This is that
// screen. The order of what it says is deliberate: what happened, why, that
// nothing was deleted, that it will STAY that way, and only then the buttons.

import { h, clear, mount } from '../ui/dom.js';
import { SAVE } from '../content/strings.js';

/**
 * @param {{drawer:HTMLElement, say:(s:string)=>void, reason:string,
 *          backup:{ok:boolean, state?:object}|null,
 *          onRestore:(backup:object)=>void}} o
 */
export function renderRefusal(o) {
  const { drawer, say, reason, backup, onRestore } = o;
  say(`${SAVE.refusedTitle}. ${SAVE.reasons[reason] ?? ''} ${SAVE.refusedBody}`);
  clear(drawer);

  mount(drawer, h('div.menu-refusal.panel', {
    role: 'group', 'aria-label': SAVE.refusedTitle,
  },
  // The reassurance comes BEFORE the buttons. A player who has just lost a save
  // is deciding whether to clear site data and start over, and site data is
  // where the file they still have is kept.
  h('p.menu-refusal-note', { text: SAVE.autosaveOff }),
  backup?.ok
    ? h('button.btn.primary', {
      type: 'button', text: SAVE.restoreBackup,
      on: { click: () => onRestore(backup) },
    })
    : h('p.dim', { text: SAVE.noBackup }),
  h('p.dim', { text: SAVE.exportFirst })));
}
