// The HUD's two message controls: Withdraw, and the one-line status strip.
//
// Split out of battle-panel.js when the site panel moved onto the board. They
// never had anything to do with a selected site — they are corner furniture —
// and battle-panel.js needed the room for the anchoring maths.
//
// battle-panel.js re-exports both, so every existing import path still works.
//
// HARD RULE, same as everywhere: nothing here mutates simulation state. The
// Withdraw button appends a command through `input`, exactly like a click on
// the board does.
import { h, bindText, bindClass } from '../ui/dom.js';

/**
 * Withdraw. Confirm-style rather than a plain button: ending a run on one
 * stray click is the kind of thing you only regret once, which is also why
 * battle-input.js keeps it off every key.
 * @param {{input:object, holdMs?:number}} o
 */
export function createWithdraw(o) {
  const { input, holdMs = 4000 } = o;
  let armedAt = 0;
  const el = h('button.btn.ghost.hud-withdraw', {
    'data-interactive': true, type: 'button', title: 'Leave the region unconquered',
    on: {
      click: () => {
        const now = Date.now();
        if (armedAt && now - armedAt < holdMs) { armedAt = 0; sync(0); input.withdraw(); return; }
        armedAt = now;
        sync(now);
      },
    },
  }, 'Withdraw');

  const set = { text: bindText(el, 'Withdraw'), armed: bindClass(el, 'is-confirming') };
  const sync = (at) => { set.text(at ? 'Confirm withdraw' : 'Withdraw'); set.armed(!!at); };

  return {
    el,
    /** Called from the HUD's 10Hz refresh; disarms itself so a forgotten click
     *  never turns into a withdrawal minutes later. */
    update(now) {
      if (armedAt && now - armedAt >= holdMs) { armedAt = 0; sync(0); }
    },
    get isArmed() { return armedAt !== 0; },
  };
}

/**
 * One-line inline message: rejections, and what an armed booster is waiting
 * for. Empty text renders nothing at all, so it costs no space when silent.
 * @param {{ttlMs?:number}} [o]
 */
export function createAlert(o = {}) {
  const ttl = o.ttlMs ?? 2600;
  const el = h('div.hud-alert', { role: 'status', 'aria-live': 'polite', text: '' });
  const set = {
    text: bindText(el, ''),
    open: bindClass(el, 'is-open'),
    danger: bindClass(el, 'is-danger'),
    good: bindClass(el, 'is-good'),
  };
  let until = 0;
  let sticky = '';

  return {
    el,
    /**
     * Transient message; replaces whatever is showing.
     *
     * `tone` exists because this line now carries losing a stronghold as well
     * as a rejected click, and those must not look the same. A threat also
     * holds twice as long: the whole point is that it reaches a player who is
     * looking at another part of the map.
     * @param {'info'|'danger'|'good'} [tone]
     */
    show(text, now, tone = 'info') {
      until = now + (tone === 'danger' ? ttl * 1.6 : ttl);
      set.text(text);
      set.danger(tone === 'danger');
      set.good(tone === 'good');
      set.open(true);
    },
    /** Persistent message (armed booster). Restored when a flash expires. */
    hold(text) {
      sticky = text || '';
      if (!until) { set.text(sticky); set.open(!!sticky); }
    },
    update(now) {
      if (until && now >= until) {
        until = 0;
        set.text(sticky);
        set.open(!!sticky);
      }
    },
  };
}
