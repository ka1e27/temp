// THE ONE-LINE ALERT CHANNEL.
//
// Split out of ./battle-alert.js at the 400-line cap, along the seam that was
// already there: that file DECIDES what is worth saying (`fightAlert`,
// `stalemateCheck`, `wireAlerts`), and this one is the single line those
// decisions have to fit through. Re-exported from ./battle-alert.js so the two
// existing import paths are unchanged; nothing here imports the parent back.
import { h, bindText, bindClass } from '../ui/dom.js';

/**
 * HOW LONG A MESSAGE IS GUARANTEED, and it is the whole fix.
 *
 * `show()` used to replace whatever was on screen, unconditionally, with a hold
 * measured in wall-clock ms — while the event rate scales roughly linearly with
 * SIM SPEED. Measured: 2 -> 5 -> 12 alert-worthy events per 3 seconds at
 * 1x/4x/8x in one sample, 8 -> 21 at 1x/4x in another. So at 4x several
 * messages could arrive and be overwritten before the first could be read, and
 * the channel silently dropped exactly the events a player speeding up the game
 * most needs to notice. The renderer stays crisp throughout: this is an
 * information-channel failure, not a legibility one.
 *
 * Reading speed does NOT scale with sim speed, which is why the answer is a
 * floor on display time rather than a shorter hold or a faster strip.
 */
const MIN_SHOW_MS = 900;

/** Rank, so a threat is never made to wait behind a rejected click. */
const RANK = { info: 0, good: 1, danger: 2 };

/**
 * ONE PENDING SLOT, NOT A QUEUE, and the bound is the point.
 *
 * A queue that never drops is worse than dropping: at 12 events a second a
 * strict FIFO runs minutes behind the battle and starts narrating history. What
 * a player needs from a burst is the most important thing in it and the most
 * recent — so a message arriving inside another's minimum goes into a single
 * slot and displaces whatever was there, keeping the higher rank and, at equal
 * rank, the newer.
 *
 * A higher rank PREEMPTS instead of waiting, because the whole reason `danger`
 * exists is to reach a player looking somewhere else.
 *
 * And an identical repeat COALESCES rather than queueing — three sites falling
 * in four seconds is one line with a count, not three lines nobody can read.
 */
export function createAlert(o = {}) {
  const ttl = o.ttlMs ?? 2600;
  const minMs = o.minShowMs ?? MIN_SHOW_MS;
  const el = h('div.hud-alert', { role: 'status', 'aria-live': 'polite', text: '' });
  const set = {
    text: bindText(el, ''),
    open: bindClass(el, 'is-open'),
    danger: bindClass(el, 'is-danger'),
    good: bindClass(el, 'is-good'),
  };
  let until = 0;        // when the current flash expires
  let floorUntil = 0;   // ...and the earliest anything may replace it
  let sticky = '';
  let cur = null;       // {text, tone, n} — n is the coalesced repeat count
  let pending = null;

  const label = (m) => (m.n > 1 ? `${m.text} x${m.n}` : m.text);

  function paint(m, now) {
    cur = m;
    until = now + (m.tone === 'danger' ? ttl * 1.6 : ttl);
    floorUntil = now + minMs;
    set.text(label(m));
    set.danger(m.tone === 'danger');
    set.good(m.tone === 'good');
    set.open(true);
  }

  return {
    el,
    /**
     * Transient message.
     *
     * @param {'info'|'danger'|'good'} [tone] a threat also holds longer: the
     *   whole point is that it reaches a player looking at another part of the
     *   map, and losing a stronghold must not look like a rejected click.
     */
    show(text, now, tone = 'info') {
      if (!text) return;
      // An identical repeat is a count, wherever it lands — on the line being
      // shown or on the one waiting to be.
      if (cur && until && cur.text === text && RANK[tone] <= RANK[cur.tone]) {
        cur.n += 1;
        set.text(label(cur));
        until = now + (cur.tone === 'danger' ? ttl * 1.6 : ttl);
        return;
      }
      if (pending && pending.text === text) { pending.n += 1; return; }

      const m = { text, tone, n: 1 };
      // Free, or outranking what is on screen: show it now.
      if (!until || now >= floorUntil || RANK[tone] > RANK[cur?.tone ?? 'info']) {
        paint(m, now);
        return;
      }
      // Inside another message's guaranteed window: park it, keeping whichever
      // of the two a player would rather see.
      if (!pending || RANK[tone] >= RANK[pending.tone]) pending = m;
    },
    /** Persistent message (armed booster). Restored when a flash expires. */
    hold(text) {
      sticky = text || '';
      if (!until) { set.text(sticky); set.open(!!sticky); }
    },
    update(now) {
      // A parked message goes up the moment the floor lifts, rather than
      // waiting out the full ttl — otherwise a burst reads at a third of the
      // rate it could.
      if (pending && now >= floorUntil) {
        const m = pending;
        pending = null;
        paint(m, now);
        return;
      }
      if (until && now >= until) {
        until = 0;
        cur = null;
        set.text(sticky);
        set.open(!!sticky);
      }
    },
  };
}
