// THE HONOURS BLOCK of the record drawer — the goals half.
//
// Its own file rather than more of ./mainmenu-record.js, along the seam that
// matters: that one renders WHAT HAS HAPPENED, this one renders WHAT IS LEFT.
// Both are mounted by `renderRecord`, and neither computes anything — every
// figure comes from meta/milestones.js, for the reason record.js's header
// gives.
//
// THE NEXT RUNGS LEAD, and the earned ones are a footnote. A list of things
// already done is a museum; the reason this exists at all is that all eleven
// unlocks are bought by region 8 of 24, so the back half has nothing to aim at
// — see content/milestones.data.js for the measurement. A drawer that opened on
// twenty ticks and no goals would restate the problem rather than answer it.
import { h } from '../ui/dom.js';
import { compact, duration, integer } from '../ui/format.js';
import { HONOUR_FORMAT } from '../content/milestones.data.js';
import { honourView, nextHonours } from '../meta/milestones.js';
import { RECORD } from '../content/strings.js';

/** A rung's numbers, in the units that rung is counted in. Switched on the
 *  FORMAT rather than on the stat name, so a new ladder needs no change here. */
function amount(stat, n) {
  const kind = HONOUR_FORMAT[stat];
  if (kind === 'hours') return duration(Math.round(n / 1000));
  if (kind === 'crowns') return compact(n);
  return integer(n);
}

/** One goal: what it is called, how far along it is, and what it asks for. The
 *  bar is a plain div sized by `progress`, which meta/milestones.js has already
 *  clamped to [0,1] — a renderer that clamped for itself would be the second
 *  implementation this project keeps finding. */
const goal = (r) => h('li.menu-honour', {},
  h('div.menu-honour-line', {},
    h('span.menu-honour-title', { text: r.title }),
    h('span.menu-honour-num', {
      text: `${amount(r.stat, r.have)} / ${amount(r.stat, r.need)}`,
    })),
  h('div.menu-honour-bar', { 'aria-hidden': 'true' },
    h('div.menu-honour-fill', { style: { width: `${Math.round(r.progress * 100)}%` } })),
  h('p.menu-honour-note.dim', { text: r.note }));

/**
 * The honours section, as an array of nodes to spread into the drawer body.
 *
 * @param {object} stats  `meta.stats`
 * @returns {Node[]}
 */
export function honoursSection(stats) {
  const v = honourView(stats);
  const next = nextHonours(stats);
  const earned = v.rows.filter((r) => r.done);
  return [
    h('h4.menu-record-head', { text: RECORD.honoursTitle }),
    h('p.menu-honour-count', {
      text: `${integer(v.earned)} / ${integer(v.total)}`,
      // The count is the one figure the menu button also carries, so it is
      // named for a screen reader rather than left as two bare numbers.
      'aria-label': `${RECORD.honoursTitle}: ${v.earned} of ${v.total} earned`,
    }),
    // ALL TWENTY EARNED IS THE ONE STATE WITH NO NEXT RUNG, and it must say so
    // rather than render an empty list — an absent section reads as a bug on
    // exactly the save that has done the most.
    // NEAREST FIRST. `nextHonours` answers in TABLE order, which is right for
    // the module — a ladder's identity does not depend on how far up it you
    // are — and wrong on screen: seven goals in a fixed order is a list, where
    // the same seven sorted by how close they are is a target. Sorting is a
    // presentation decision and stays here; the arithmetic it sorts on was
    // already computed and clamped by meta/milestones.js.
    ...(next.length
      ? [h('ul.menu-honour-list', {},
        ...[...next].sort((a, b) => b.progress - a.progress).map(goal))]
      : [h('p.set-hint.dim', { text: RECORD.honoursAll })]),
    ...(earned.length
      ? [h('p.menu-honour-earned.dim', {
        text: `${RECORD.honoursEarned} ${earned.map((r) => r.title).join(' · ')}`,
      })]
      : []),
  ];
}
