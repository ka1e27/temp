// HONOURS, derived — the "what is there to look forward to" half of the record.
//
// Sibling of ./record.js and it follows that file's rules exactly: the
// arithmetic lives here rather than in the screen, everything is a pure function
// of `meta.stats`, and nothing is stored. See content/milestones.data.js for the
// measurement that motivated the table and for why an honour pays nothing.
//
// THE INTERESTING FUNCTION IS `nextHonours`, NOT `honourView`. A list of things
// already done is a museum; the reason to open the drawer is the rung you are
// part-way up, which is why the screen leads with the next rung of every ladder
// and lists the earned ones underneath.
// PURE.
import { HONOURS } from '../content/milestones.data.js';

/** Safe non-negative read, matching ./record.js: a hand-edited or partial save
 *  must not make a rung look earned, or unearnable. */
const num = (n) => (Number.isFinite(n) && n > 0 ? n : 0);

/** One row, with everything a screen needs and nothing it has to work out. */
function rowFor(h, stats) {
  const have = num(stats?.[h.stat]);
  return {
    id: h.id,
    stat: h.stat,
    title: h.title,
    note: h.note,
    need: h.need,
    have,
    done: have >= h.need,
    /** Clamped to [0,1] so a screen can size a bar without checking. */
    progress: h.need > 0 ? Math.min(1, have / h.need) : 1,
  };
}

/**
 * Every rung, in table order, with its progress.
 *
 * `earned`/`total` are counted here rather than by the caller for the same
 * reason record.js derives its ratios: a screen that counted for itself is a
 * second implementation, and the only way to check it is to open a menu.
 */
export function honourView(stats) {
  const rows = HONOURS.map((h) => rowFor(h, stats));
  return { rows, earned: rows.filter((r) => r.done).length, total: rows.length };
}

/**
 * The next unearned rung of each ladder — at most one per `stat`, in table
 * order, and a ladder that is finished contributes nothing.
 *
 * THE TABLE'S ORDER IS LOAD-BEARING and tests/milestones.test.js pins it: this
 * takes the FIRST unearned row of each group, which is the smallest one only
 * because the table is sorted ascending within a group. An unsorted table would
 * offer a plausible, confident, wrong goal.
 */
export function nextHonours(stats) {
  const seen = new Set();
  const out = [];
  for (const h of HONOURS) {
    if (seen.has(h.stat)) continue;
    const r = rowFor(h, stats);
    if (r.done) continue;
    seen.add(h.stat);
    out.push(r);
  }
  return out;
}

/**
 * The one figure the MENU carries, so the drawer has a reason to be opened.
 *
 * Null when nothing has been earned AND nothing has been played — the same
 * "null rather than zero" rule record.js uses, and for the same reason: `0 / 20`
 * on a fresh save is a scolding, where an absent count is simply a drawer that
 * has not filled in yet. A player who has earned none but HAS played gets `0 /
 * 20`, which is a goal rather than a judgement.
 */
export function honourCount(stats) {
  const v = honourView(stats);
  if (v.earned === 0 && num(stats?.battles) === 0 && num(stats?.playMs) === 0) return null;
  return { earned: v.earned, total: v.total };
}
