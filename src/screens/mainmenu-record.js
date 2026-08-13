// The lifetime record drawer — the thirteen counters `meta.stats` has been
// collecting since long before anything displayed them.
//
// Split out of ./mainmenu.js for the line budget, in the same shape as its
// settings and abdication drawers: this file owns the CONTENT of one drawer and
// nothing about the menu around it.
//
// IT COMPUTES NOTHING. Every figure comes from meta/record.js `recordView`,
// which is a pure function of `meta.stats` and is tested on its own. A screen
// that derived its own win rate would be a second implementation of the rule,
// and the only place it could be checked is by opening a menu and squinting.
//
// The DERIVED rows are the reason to open it at all — a raw counter is a number
// and a ratio is a story. Win rate, kill ratio and the away share go at the top
// of their groups for that reason, with the counters they are built from
// underneath so nothing is a black box.
import { h, clear, mount } from '../ui/dom.js';
import { compact, duration, percent, fixed } from '../ui/format.js';
import { RECORD } from '../content/strings.js';
import { recordView } from '../meta/record.js';

/** One `dt`/`dd` pair. Same markup as the abdication payout table, so the two
 *  drawers line up rather than each inventing a layout. */
const row = (label, value) => [h('dt.label', { text: label }), h('dd.num', { text: value })];

/** A derived figure, or an em dash when there is nothing to derive it from —
 *  see meta/record.js on why null rather than zero. */
const orDash = (v, fmt) => (v == null ? '—' : fmt(v));

/** Milliseconds as hours-and-minutes; `duration` takes seconds. */
const hours = (ms) => duration(Math.round(ms / 1000));

function section(title, ...pairs) {
  return [
    h('h4.menu-record-head', { text: title }),
    h('dl.menu-empire.menu-record', {}, ...pairs.flat()),
  ];
}

/**
 * Render the record drawer.
 *
 * @param {HTMLElement} drawer
 * @param {object} ctx   scene context (needs `state`)
 * @param {{onCancel:()=>void}} io
 * @returns {HTMLElement|null} the control to focus
 */
export function renderRecord(drawer, ctx, { onCancel }) {
  clear(drawer);
  const v = recordView(ctx.state.meta.stats);
  const close = h('button.btn.ghost.menu-record-close', {
    type: 'button', text: 'Close', on: { click: onCancel },
  });
  // FOCUS GOES TO THE TITLE, NOT TO CLOSE, and this drawer is the first one
  // long enough for the difference to matter. Focusing a control at the BOTTOM
  // of seventeen rows scrolls the drawer's own heading off the top — the player
  // opens Record and lands halfway down it. Moving focus to the start of the
  // new content is also what a screen reader wants: heading, then table, in
  // reading order. `tabindex="-1"` makes it focusable without putting a heading
  // into the tab ring.
  const title = h('h3.menu-drawer-title.menu-record-title', {
    text: RECORD.title, tabindex: '-1',
  });

  if (v.empty) {
    // A table of zeroes is the one shape that reads as broken rather than as
    // new, so a save that has done nothing says so in a sentence instead.
    mount(drawer, h('div.menu-drawer', {},
      title,
      h('p.set-hint.dim', { text: RECORD.empty }),
      close));
    return title;
  }

  // HEADER, SCROLLING BODY, FOOTER — and all three parts are load-bearing.
  // This is the only drawer in the menu tall enough to overflow a laptop
  // window, and the two obvious layouts both fail: letting `.dialog` scroll the
  // whole thing puts the title off the top the moment anything below is
  // focused, and giving the drawer ONE scroller nested inside the dialog's own
  // does both at once. Capping only the middle keeps the title and Close
  // on screen at every window height, which is what makes Close reachable
  // without scrolling — a dialog whose dismiss control is below the fold is a
  // trap, and the browser smoke test failed on exactly that.
  const body = h('div.menu-record-body', {}, ...[
  ...section(RECORD.warTitle,
    row(RECORD.winRate, orDash(v.winRate, (x) => percent(x))),
    row(RECORD.battles, compact(v.battles)),
    row(RECORD.wins, compact(v.wins)),
    row(RECORD.losses, compact(v.losses)),
    // Shown only when it has happened: a permanent "Withdrawn 0" row teaches a
    // player that withdrawing exists by looking like a scolding.
    ...(v.withdrawals > 0 ? [row(RECORD.withdrawals, compact(v.withdrawals))] : []),
    row(RECORD.raids, compact(v.raids)),
    row(RECORD.incursions, compact(v.incursions))),

  ...section(RECORD.troopsTitle,
    row(RECORD.killRatio, orDash(v.killRatio, (x) => `${fixed(x, 2)} : 1`)),
    row(RECORD.killed, compact(v.unitsKilled)),
    row(RECORD.lost, compact(v.unitsLost))),

  ...section(RECORD.timeTitle,
    // THE IDLE HALF, MADE VISIBLE, and the headline of its own group: this is a
    // game that pays out absences, and until now nothing on any screen said how
    // much of the empire was built while the tab was shut.
    row(RECORD.awayShare, orDash(v.awayShare, (x) => percent(x))),
    row(RECORD.played, hours(v.playMs)),
    row(RECORD.away, hours(v.offlineMsClaimed))),

  ...section(RECORD.purseTitle,
    row(RECORD.crownsEarned, compact(v.crownsEarned)),
    row(RECORD.crownsSpent, compact(v.crownsSpent)),
    row(RECORD.relicsEarned, compact(v.relicsEarned)),
    row(RECORD.relicsSpent, compact(v.relicsSpent))),
  ]);

  mount(drawer, h('div.menu-drawer', { role: 'group', 'aria-label': RECORD.title },
    title,
    h('p.set-hint.dim', { text: RECORD.hint }),
    body,
    h('p.set-note.dim', { text: RECORD.survives }),
    close));

  return title;
}
