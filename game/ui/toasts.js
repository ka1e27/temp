// Stacked auto-dismiss toasts (ARCHITECTURE §8). Browser only. Every call to
// `update()` pushes ONE new toast — there is no persistent "current state"
// to diff against, so this component intentionally does not follow the
// diff-on-update pattern the way the others do. One exception: a toast that
// carries an `id` a toast on screen already has UPDATES that toast in place and
// restarts its timer, so a run of the same kind of event (a spree in the War
// Council) is one toast, not a pile.
import { h } from './dom.js';
import { icon } from './icons.js';

const DEFAULT_ICON = { info: 'bell', success: 'star', warning: 'flame' };
const DEFAULT_DURATION_MS = 4200;

/**
 * @typedef {Object} ToastData
 * @property {string} [id]
 * @property {'info'|'success'|'warning'} [type]
 * @property {string} message
 * @property {string} [icon]
 * @property {number} [duration]  ms before auto-dismiss
 * @property {{ label: string, ariaLabel?: string, onClick: () => void }} [action]  one button in the toast ("Go"); pressing it also dismisses the toast
 * @property {{ label: string, ariaLabel?: string, onClick: () => void }} [secondary]  a second, quieter button before it (a world event's "Decline")
 * @property {string} [seal]  an icon name: a wax seal that stamps down on the toast (a completed contract, PLAN-PHASE4 §4A); still under Reduce Motion
 * @property {string} [accent]  a colour for the toast's accent (`--toast-accent`, `--vendetta-color`): a Vendetta banner's pennant in the leader's colour
 * @property {string} [className]  extra classes on the toast ('is-event': a world event's wide toast, buttons under the words)
 * @property {string[]} [aliases]  ids this toast also answers to in has() / dismissId() (a merged toast: the shell's post-battle digest)
 */

export function createToasts() {
  // `data-keep-live`: a dialog never makes the toasts inert, so they are still announced. Each toast's MESSAGE is its own polite status (not the whole
  // toast, so its Dismiss button is not read out); the text is set a moment after the node exists, which is what makes it announce. A toast that is updated in
  // place (a spree of purchases) changes that text once: one announcement of the latest words.
  const el = h('div.toasts', { 'data-keep-live': '' });
  let seq = 0;
  // THE CLICK RULE for the column (Phase 15B): while a finger or the mouse is down on a toast, and for PRESS_SETTLE_MS after it lifts (a touch's click comes
  // after touchend), nothing in the column moves: a new toast waits in the queue, a dismissed one keeps its (invisible) room, and an updated message keeps
  // its words until the press is over (a longer line can wrap and move the buttons). main.js holds a new leader banner too (`pressHeld`), which would push
  // the whole column down: on a slow device that slid a Duel's Decline 124 px away under the press and the decline was lost.
  const PRESS_SETTLE_MS = 250;
  let pressing = false;
  let pressUpAt = -1e9;
  const pressHeld = () => pressing || Date.now() - pressUpAt < PRESS_SETTLE_MS;
  /** Runs `fn` now, or once the press on the column is over. */
  const afterPress = (fn) => { if (!pressHeld()) { fn(); return; } setTimeout(() => afterPress(fn), pressing ? 60 : Math.max(20, PRESS_SETTLE_MS - (Date.now() - pressUpAt) + 10)); };
  const say = (node, message) => { clearTimeout(node._sayTimer); node._sayTimer = setTimeout(() => afterPress(() => { const m = node.querySelector('.toast-message'); if (m && node.dataset.message === message) m.textContent = message; }), 40); };
  el.addEventListener('pointerdown', (e) => { if (e.target instanceof Element && e.target.closest('.toast')) pressing = true; }, true);
  const pressEnd = () => { if (!pressing) return; pressing = false; pressUpAt = Date.now(); setTimeout(pump, PRESS_SETTLE_MS + 20); };
  if (typeof window !== 'undefined') { window.addEventListener('pointerup', pressEnd, true); window.addEventListener('pointercancel', pressEnd, true); }

  // A toast waits while it is being read: hovering it or focusing inside it pauses its timer; leaving restarts it with at least a couple of seconds (WCAG 2.2.1)
  const arm = (node, ms) => {
    clearTimeout(node._toastTimer);
    node._dueMs = ms;
    node._armedAt = Date.now();
    node._toastTimer = setTimeout(() => dismiss(node), ms);
  };
  const hold = (node) => {
    if (node._held) return;
    node._held = true;
    clearTimeout(node._toastTimer);
    node._dueMs = Math.max(2500, (node._dueMs ?? DEFAULT_DURATION_MS) - (Date.now() - (node._armedAt ?? Date.now())));
  };
  const release = (node) => {
    if (!node._held) return;
    node._held = false;
    arm(node, node._dueMs ?? 2500);
  };

  // While a modal dialog is open no toast may cover it: new toasts wait in a short queue (same id or same words merge, at most
  // QUEUE_CAP, oldest dropped) and the ones already on screen step back into it; they come out one by one when the last dialog closes.
  // Feedback for an action taken INSIDE a dialog is shown inside that dialog instead (the council's status line, Settings' Copied/Import lines).
  const QUEUE_CAP = 4;
  let held = false;
  let queue = [];
  let flushTimer = 0;
  function enqueue(toast) {
    queue = queue.filter((q) => !((toast.id != null && q.id === toast.id) || q.message === toast.message));
    queue.push(toast);
    if (queue.length > QUEUE_CAP) queue = queue.slice(-QUEUE_CAP);
  }
  function setHeld(on) {
    on = !!on;
    if (on === held) return;
    held = on;
    clearTimeout(flushTimer);
    if (held) {
      for (const node of [...el.children]) {
        if (!node.isConnected || node.classList.contains('is-out')) continue;
        const left = (node._dueMs ?? DEFAULT_DURATION_MS) - (node._held ? 0 : Date.now() - (node._armedAt ?? Date.now()));
        if (left > 1200 && node._data) enqueue({ ...node._data, message: node.dataset.message, duration: Math.max(2500, left) });
        clearTimeout(node._toastTimer);
        node.remove(); // gone at once: it must not show over the dialog even for the length of a fade
      }
    } else {
      const next = () => {
        if (held || !queue.length) return;
        update(queue.shift());
        if (queue.length) flushTimer = setTimeout(next, 450);
      };
      flushTimer = setTimeout(next, 250); // let the dialog's close animation start first
    }
  }

  // A cap on how many toasts show at once (the shell sets it: a phone's top lane holds two notices, the leader banner counting as one). A new toast past
  // the cap waits in the same queue and comes out when one leaves; event offers jump that queue (they have a countdown).
  let maxVisible = Infinity;
  // a toast that asks for a decision against a clock (a world event's offer, a raid's or a Vendetta's Go) never waits behind news
  const urgent = (t) => !!(t && (t.action || String(t.className || '').includes('is-event')));
  const urgentNode = (n) => n.classList.contains('is-event') || !!n.querySelector('.toast-action');
  const showing = () => [...el.children].filter((n) => n.isConnected && !n.classList.contains('is-out'));
  function pump() {
    clearTimeout(pumpTimer);
    if (held || !queue.length || showing().length >= maxVisible) return;
    if (pressHeld()) { pumpTimer = setTimeout(pump, 120); return; } // nothing joins the column under a press
    const i = queue.findIndex(urgent);
    const next = queue.splice(i >= 0 ? i : 0, 1)[0];
    update(next);
    if (queue.length) pumpTimer = setTimeout(pump, 300);
  }
  let pumpTimer = 0;
  /** @param {number} n at most this many toasts on screen (Infinity = no cap); the newest beyond it step back into the queue */
  function setMaxVisible(n) {
    const cap = n > 0 ? n : 0;
    if (cap === maxVisible) return;
    maxVisible = cap;
    const live = showing();
    // the newest toasts that are not event offers step back first
    const extra = live.length - maxVisible;
    if (extra > 0) {
      const order = live.filter((x) => !urgentNode(x)).reverse().concat(live.filter(urgentNode).reverse());
      for (const node of order.slice(0, extra)) {
        const left = (node._dueMs ?? DEFAULT_DURATION_MS) - (node._held ? 0 : Date.now() - (node._armedAt ?? Date.now()));
        if (left > 1200 && node._data) enqueue({ ...node._data, message: node.dataset.message, duration: Math.max(2500, left) });
        clearTimeout(node._toastTimer);
        node.remove();
      }
    } else pump();
  }

  /** @param {ToastData} toast */
  function update(toast) {
    if (!toast || !toast.message) return;
    if (held) { enqueue(toast); return; }
    if (toast.id != null) {
      const live = [...el.children].find((n) => n.dataset.id === String(toast.id) && n.isConnected && !n.classList.contains('is-out'));
      if (live) {
        if (toast.action) live._action = toast.action.onClick;
        if (toast.secondary) live._secondary = toast.secondary.onClick;
        say(live, toast.message);
        live.dataset.message = toast.message;
        if (live._held) { live._dueMs = toast.duration ?? DEFAULT_DURATION_MS; } else arm(live, toast.duration ?? DEFAULT_DURATION_MS);
        return;
      }
    }
    if (pressHeld()) { enqueue(toast); clearTimeout(pumpTimer); pumpTimer = setTimeout(pump, 120); return; } // a new toast waits for the press to end
    if (showing().length >= maxVisible) {
      // an urgent toast (an offer, a Go) takes the slot of the newest ordinary toast, which steps back into the queue
      const bump = urgent(toast) ? showing().filter((n) => !urgentNode(n)).pop() : null;
      if (!bump) { enqueue(toast); return; }
      const left = (bump._dueMs ?? DEFAULT_DURATION_MS) - (bump._held ? 0 : Date.now() - (bump._armedAt ?? Date.now()));
      if (left > 1200 && bump._data) enqueue({ ...bump._data, message: bump.dataset.message, duration: Math.max(2500, left) });
      clearTimeout(bump._toastTimer);
      bump.remove();
    }
    const type = toast.type || 'info';
    const actionBtn = toast.action ? h('button.btn.btn-primary.toast-action', {
      type: 'button',
      'aria-label': toast.action.ariaLabel || toast.action.label,
      onClick: () => { const fn = node._action; dismiss(node); if (fn) fn(); },
    }, toast.action.label) : null;
    const secondaryBtn = toast.secondary ? h('button.btn.btn-secondary.toast-action.toast-secondary', {
      type: 'button',
      'aria-label': toast.secondary.ariaLabel || toast.secondary.label,
      onClick: () => { const fn = node._secondary; dismiss(node); if (fn) fn(); },
    }, toast.secondary.label) : null;
    const node = h(`div.toast.toast-${type}`, {},
      icon(toast.icon || DEFAULT_ICON[type] || 'bell', 18),
      h('span.toast-message', { role: 'status', 'aria-live': 'polite' }, ''),
      secondaryBtn,
      actionBtn,
      h('button.toast-close', { onClick: () => dismiss(node), 'aria-label': 'Dismiss' }, icon('close', 12)),
    );
    if (secondaryBtn) node.classList.add('has-two');
    if (toast.accent) { node.style.setProperty('--toast-accent', toast.accent); node.style.setProperty('--vendetta-color', toast.accent); }
    if (toast.seal) { node.classList.add('is-sealed'); node.appendChild(h('span.toast-seal', { 'aria-hidden': 'true' }, icon(toast.seal, 18))); }
    if (toast.className) node.classList.add(...String(toast.className).split(' ').filter(Boolean)); // e.g. 'is-event': a world event's wide toast
    node._action = toast.action ? toast.action.onClick : null;
    node._secondary = toast.secondary ? toast.secondary.onClick : null;
    node.addEventListener('pointerenter', () => hold(node));
    node.addEventListener('pointerleave', () => { if (!node.contains(document.activeElement)) release(node); });
    node.addEventListener('focusin', () => hold(node));
    node.addEventListener('focusout', () => { if (!node.matches(':hover')) release(node); });
    node._data = toast;
    node.dataset.id = toast.id ?? `t${++seq}`;
    if (Array.isArray(toast.aliases) && toast.aliases.length) node.dataset.aliases = toast.aliases.join(' ');
    node.dataset.message = toast.message;
    el.appendChild(node);
    say(node, toast.message);
    requestAnimationFrame(() => node.classList.add('is-in'));

    arm(node, toast.duration ?? DEFAULT_DURATION_MS);
  }

  function dismiss(node) {
    if (!node.isConnected) return;
    clearTimeout(node._toastTimer);
    node.classList.remove('is-in');
    node.classList.add('is-out');
    setTimeout(() => afterPress(() => node.remove()), 260); // its room closes only once no press is on the column
    if (queue.length) pumpTimer = setTimeout(pump, 280); // the next one waiting for room
  }

  function destroy() {
    clearTimeout(flushTimer);
    clearTimeout(pumpTimer);
    queue = [];
    for (const node of [...el.children]) clearTimeout(node._toastTimer);
    el.replaceChildren();
  }

  /** Takes a toast away by its id (on screen or still queued): a raid's countdown once the band has arrived. */
  // a merged toast (the shell's digest) carries `aliases`: the ids of the toasts it stands for
  const isId = (id) => (q) => q.id === id || (Array.isArray(q.aliases) && q.aliases.includes(id));
  const nodeIs = (n, id) => n.dataset.id === String(id) || (n.dataset.aliases || '').split(' ').includes(String(id));
  function dismissId(id) {
    queue = queue.filter((q) => !isId(id)(q));
    for (const node of [...el.children]) if (nodeIs(node, id)) dismiss(node);
  }

  /** Is a toast with this id on screen or waiting in the queue? (A world event's countdown only updates a toast the player has not closed.) */
  function has(id) {
    return queue.some(isId(id)) || [...el.children].some((n) => nodeIs(n, id) && n.isConnected && !n.classList.contains('is-out'));
  }

  return { el, update, destroy, dismissId, has, setHeld, setMaxVisible, isHeld: () => held, queued: () => queue.length, pressHeld };
}
