// THE COACH STRIP — the DOM half, and only the DOM half.
//
// Split from ui/coach.js at the 400-line cap, along the line that file's own
// header already draws: above it is a pure decision machine with no clock and
// no document, below it is the element that shows what the machine decided.
// IMPORTED DIRECTLY BY ITS CONSUMER, NOT RE-EXPORTED FROM `coach.js`, and that
// is the rule this project already follows for `rally.js`, `refund.js` and
// `retreat.js`: this file imports FROM its parent, so a re-export back would
// close a cycle. `screens/battle.js` names this module.
import { h, mount, unmount } from './dom.js';
import { HOLD } from './coach.data.js';
import { createCoachMachine, shouldMarkSeen } from './coach.js';


/** Poll rate for the two state-derived beats. 5Hz is far below the 10Hz sim and
 *  costs one array scan; per-frame polling would cost 12x that for nothing. */
const POLL_MS = 200;
/** Beats never stack or cross-fade — one clear line at a time, then a beat of
 *  silence so two hints never read as one sentence. */
const GAP_MS = 500;

const defaultNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Mount the coach strip.
 *
 * @param {object} o
 * @param {HTMLElement} o.root      where the strip lives — `#hud` (see notes)
 * @param {object} o.bus            the game bus; battle events arrive as `battle:<type>`
 * @param {()=>object|null} o.getState  the LIVE BATTLE state (ctx.state.battle)
 * @param {()=>object|null} o.getMeta   the meta slice (ctx.state.meta)
 * @param {()=>void} [o.onComplete] called once, when the last beat has shown
 * @param {()=>number} [o.now]      injectable clock, for tests
 * @returns {{el:HTMLElement, update:()=>void, dispose:()=>void,
 *            dismiss:()=>void, skip:()=>void, machine:object}}
 */
export function createCoach(o = {}) {
  const { root, bus, getState, getMeta, onComplete } = o;
  const now = o.now ?? defaultNow;
  const machine = o.machine ?? createCoachMachine(o);

  // role/aria-live so a screen reader announces each beat as it lands. No
  // `data-interactive`, deliberately: base.css only opts interactive children
  // of #hud back into hit testing, so this strip is invisible to the pointer
  // and can never swallow a drag order aimed at the board behind it.
  const el = h('div.hint', {
    role: 'status', 'aria-live': 'polite', 'data-coach': 'strip',
  });
  if (root) mount(root, el);

  let showing = null;
  let hideAt = 0;
  let readyAt = 0;
  let lastPoll = -Infinity;
  let completed = false;
  const offs = [];

  if (bus) {
    for (const type of ['siege-begun', 'site-captured', 'squad-sent']) {
      offs.push(bus.on(`battle:${type}`, (ev) => machine.note(type, ev)));
    }
    // ONE region-1 battle's worth of coaching, then never again. See
    // shouldMarkSeen() for why this is not simply "all five beats fired".
    offs.push(bus.on('battle:battle-ended', () => {
      if (shouldMarkSeen(machine.fired, { ended: true })) finish(getMeta?.() ?? null);
    }));
  }

  // Skippable without being a target: Esc already means "never mind" in this
  // game (battle-input.js deselects on it), so it retires the current line too.
  if (typeof window !== 'undefined') {
    const onKey = (ev) => { if (ev.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', onKey);
    offs.push(() => window.removeEventListener('keydown', onKey));
  }

  function show(beat, t) {
    showing = beat;
    el.textContent = beat.text;
    el.dataset.beat = beat.id;
    el.classList.add('is-on');
    hideAt = t + (beat.hold ?? HOLD.normal);
    // The board's half of the beat. Published rather than resolved here: this
    // file knows about an element and a clock, and which building is "the
    // player's camp" is a question about the live battle.
    o.onBeat?.(beat);
  }

  function hide(t) {
    showing = null;
    el.classList.remove('is-on');
    // THE ATTRIBUTE GOES WITH THE LINE. `data-beat` was written in `show` and
    // never cleared, so it named the last beat SHOWN rather than the one on
    // screen — and the strip fades by class, so `textContent` outlives it too.
    // A critic driving the real game read both and filed "the coach mark never
    // advances"; measured since, it retires within two seconds of a legal
    // march. Same shape as the site panel reporting `display: flex` at opacity
    // 0.00016. The TEXT stays: it is mid-fade, and clearing it would blank the
    // line rather than fade it. Nothing in the stylesheet reads `data-beat`.
    delete el.dataset.beat;
    o.onBeat?.(null);
    readyAt = t + GAP_MS;
  }

  /** Retire whatever is on screen right now. Never cancels a future beat. */
  function dismiss() {
    if (showing) hide(now());
  }

  /** Opt out of onboarding entirely, for good. */
  function skip() {
    machine.skipAll();
    dismiss();
    finish(getMeta?.() ?? null);
  }

  function finish(meta) {
    if (completed) return;
    completed = true;
    // `meta.tutorialSeen` is declared in core/store.js and rebuilt by
    // fromPersisted, so this survives a reload with no migration. The autosaver
    // only writes while `session.dirty`; pass `onComplete` if you want the flag
    // on disk before the next meta mutation rather than at the unload flush.
    if (meta) meta.tutorialSeen = true;
    bus?.emit('coach:complete', { fired: machine.fired });
    onComplete?.();
  }

  /** Call once per rendered frame; internally throttled to POLL_MS. */
  function update() {
    const t = now();
    const battle = getState?.() ?? null;

    // AN INSTRUCTION STAYS UNTIL IT IS OBEYED. Every beat retired on a timer,
    // so the one line a new player gets — "drag from your camp" — vanished after
    // six seconds and could never come back: no help button, no replay, nothing
    // else on screen. A player who did not work out the gesture in six seconds
    // was then left in silence for the remaining nineteen minutes of the battle,
    // and that is the single biggest quit point in the product.
    //
    // A timer is the right retirement for a STATEMENT ("Farms fund your army")
    // and exactly the wrong one for an instruction. A beat carrying `until`
    // knows what doing-the-thing looks like, so it waits for it.
    const overtaken = machine.retired(showing, battle, getMeta?.() ?? null);
    if (showing && (overtaken || (!showing.until && t >= hideAt))) hide(t);
    if (t - lastPoll < POLL_MS) return;
    lastPoll = t;

    // Keep the latches warm even while a line is up, so a beat whose moment
    // passed behind another beat's text is still remembered and still shown.
    if (showing || t < readyAt) { machine.observe(battle); return; }

    const meta = getMeta?.() ?? null;
    const beat = machine.step(battle, meta);
    if (beat) show(beat, t);
    if (!completed && shouldMarkSeen(machine.fired)) finish(meta);
  }

  return {
    el,
    machine,
    update,
    dismiss,
    skip,
    get showing() { return showing?.id ?? null; },
    get fired() { return machine.fired; },
    dispose() {
      for (let i = offs.length - 1; i >= 0; i--) offs[i]();
      offs.length = 0;
      unmount(el);
    },
  };
}
