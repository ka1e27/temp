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
 *
 * IT IS ALSO THE ONLY LABELLED WAY OUT OF A BATTLE, and that was a real
 * problem, because it is not the only way out — screens/battle.js autosaves the
 * whole fight every four seconds and main.js resumes it ahead of every other
 * boot route, for twelve hours. A player who has to stop can simply close the
 * tab and lose nothing. Nothing said so anywhere, so the one visible exit from
 * a 7-to-15-minute battle was the destructive one, and "I had to go" and "I
 * gave up" collapsed into the same button.
 *
 * The hint rides the CONFIRM state rather than a tooltip, for two reasons: a
 * tooltip does not exist on a touchscreen, which is half of where this is
 * played; and arming the button is the exact moment a player has decided to
 * leave and has not yet decided how. It is a sibling element rather than part
 * of the label so the button keeps one accessible name.
 * @param {{input:object, holdMs?:number}} o
 */
export function createWithdraw(o) {
  const { input, holdMs = 4000 } = o;
  let armedAt = 0;
  const el = h('button.btn.ghost.hud-withdraw', {
    'data-interactive': true,
    type: 'button',
    title: 'Give up the region. To stop for now instead, just close the tab —'
      + ' the battle is saved and picks up where you left it.',
    on: {
      click: () => {
        const now = Date.now();
        if (armedAt && now - armedAt < holdMs) { armedAt = 0; sync(0); input.withdraw(); return; }
        armedAt = now;
        sync(now);
      },
    },
  }, 'Withdraw');

  // `role: 'status'` rather than an alert: it is an alternative, not a warning,
  // and it must not interrupt a screen reader mid-battle.
  const hint = h('div.hud-leavehint', { role: 'status', 'aria-live': 'polite', text: '' });

  const set = {
    text: bindText(el, 'Withdraw'),
    armed: bindClass(el, 'is-confirming'),
    hint: bindText(hint, ''),
    hintOpen: bindClass(hint, 'is-open'),
  };
  const sync = (at) => {
    set.text(at ? 'Confirm withdraw' : 'Withdraw');
    set.armed(!!at);
    set.hint(at ? 'This gives up the region. Just closing the tab keeps it — the battle resumes.' : '');
    set.hintOpen(!!at);
  };

  return {
    el,
    /** Placed by the HUD beside the button. Separate so the button keeps one
     *  accessible name and the hint can wrap to its own line. */
    hint,
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
