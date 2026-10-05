// The compact challenge tracker on the HUD (PLAN-PHASE9): the challenge's name, the active-play timer, the goal's short progress line and a
// Leave button. It hangs in the HUD's tab row (main.js mounts it into ui.hud.tabsEl), so the leader banner and the toasts already make room.
// Pure UI: data in (challengeKit.trackerData), callbacks out.
import { h } from './dom.js';
import { icon } from './icons.js';

/** @param {{ onLeave?: () => void }} cb */
export function createGoalTracker(cb = {}) {
  const nameEl = h('span.gt-name', {}, '');
  const timeEl = h('span.gt-time.nums', { 'aria-hidden': 'true' }, '0:00');
  const lineEl = h('span.gt-line', { 'aria-hidden': 'true' }, '');
  const srEl = h('span.visually-hidden', {}, '');
  const leaveBtn = h('button.gt-leave', { type: 'button', onClick: () => cb.onLeave?.(), 'aria-label': 'Leave the challenge', title: 'Leave the challenge' }, icon('flag', 15));
  const el = h('div.gt', { role: 'group', 'aria-label': 'Challenge' },
    h('span.gt-icon', { 'aria-hidden': 'true' }, icon('clock', 16)),
    h('span.gt-text', {}, h('span.gt-top', {}, nameEl, timeEl), lineEl, srEl),
    leaveBtn);
  el.hidden = true;
  let srAt = -1;

  /** @param {{ visible: boolean, name?: string, time?: string, sec?: number, line?: string, goal?: string, met?: boolean, failed?: boolean }} d */
  function update(d) {
    if (!d || !d.visible) { if (!el.hidden) el.hidden = true; return; }
    if (el.hidden) el.hidden = false;
    if (nameEl.textContent !== d.name) nameEl.textContent = d.name;
    if (timeEl.textContent !== d.time) timeEl.textContent = d.time;
    if (lineEl.textContent !== d.line) lineEl.textContent = d.line;
    if (el.title !== d.goal) el.title = d.goal || '';
    el.classList.toggle('is-met', !!d.met);
    el.classList.toggle('is-failed', !!d.failed);
    // the screen-reader sentence changes at most every 10 s of play (the clock ticks every second; it is not a live region)
    const bucket = Math.floor((d.sec || 0) / 10);
    if (bucket !== srAt) { srAt = bucket; srEl.textContent = `${d.name}: ${d.goal}. ${d.line}. Time ${d.time}.`; }
  }
  return { el, update };
}
