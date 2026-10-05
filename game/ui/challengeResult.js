// The challenge result screen (PLAN-PHASE9 §9A, §9B): time, crowns, attempts, the streak, the share line with a Copy button (the clipboard,
// no network), the stars of a scenario, and Retry / Back. Pure UI: the words arrive as data (game/app/challengeKit.js resultData).
//
//   const res = createChallengeResult({ onRetry, onBack });  document.body.appendChild(res.el);  res.open(data);  res.close();
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { watchDialog } from './dialogs.js';

/** Copies `text` to the clipboard (falls back to a selected, hidden textarea). Resolves true when it worked. */
export async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* not allowed here: the fallback below */ }
  const ta = h('textarea.visually-hidden', { readOnly: true });
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

/** @param {{ onRetry?: () => void, onBack?: () => void }} cb */
export function createChallengeResult(cb = {}) {
  const titleEl = h('h2.chr-title', {}, '');
  const subEl = h('p.chr-sub', {}, '');
  const statsEl = h('dl.chr-stats', {});
  const starsEl = h('div.chr-stars', {});
  const shareBox = h('div.chr-share', {});
  const notesEl = h('ul.chr-notes', {});
  const copyMsg = h('span.chr-copy-msg', { role: 'status', 'aria-live': 'polite' }, '');
  const retryBtn = h('button.btn.btn-secondary.chr-retry', { type: 'button', onClick: () => cb.onRetry?.() }, icon('swords', 16), 'Retry');
  const backBtn = h('button.btn.btn-primary.chr-back', { type: 'button', 'data-autofocus': '', onClick: () => cb.onBack?.() }, icon('flag', 16), 'Back');
  const el = h('div.chr.glass-panel', { hidden: true },
    h('div.chr-head', {}, h('span.chr-icon', { 'aria-hidden': 'true' }, icon('trophy', 34)), h('div', {}, titleEl, subEl)),
    statsEl, starsEl, shareBox, notesEl,
    h('div.chr-actions', {}, retryBtn, backBtn));
  watchDialog(el, { titleEl, onEscape: () => cb.onBack?.() });

  let copyTimer = 0;
  function stat(label, value, extra) {
    statsEl.append(h('dt', {}, label), h('dd.nums', {}, value, extra || null));
  }

  /**
   * @param {{ met: boolean, title: string, sub: string, time: string, crowns: number, crownRating: number, attempts: number, streak?: number|null,
   *   stars?: { n: number, max: number, marks: Array<{ text: string, on: boolean }> }|null, share?: string|null, notes?: string[], extra?: Array<[string, string]> }} d
   */
  function open(d) {
    el.classList.toggle('is-met', !!d.met);
    el.classList.toggle('is-missed', !d.met);
    titleEl.textContent = d.title;
    subEl.textContent = d.sub || '';
    clear(statsEl);
    stat('Time', d.time);
    stat('Crowns', String(d.crowns), h('span.chr-crowns', { 'aria-hidden': 'true' }, ...Array.from({ length: 3 }, (_, i) => h(`span${i < d.crownRating ? '.is-on' : ''}`, {}, icon('crown', 14)))));
    stat('Attempts', String(d.attempts));
    if (d.streak != null) stat('Daily streak', `${d.streak} ${d.streak === 1 ? 'day' : 'days'}`);
    for (const [k, v] of d.extra || []) stat(k, v);
    clear(starsEl);
    starsEl.hidden = !d.stars;
    if (d.stars) {
      starsEl.append(h('div.chr-star-row', { 'aria-label': `${d.stars.n} of ${d.stars.max} stars` },
        ...d.stars.marks.map((m) => h(`span.chr-star${m.on ? '.is-on' : ''}`, { 'aria-hidden': 'true' }, icon('star', 26)))),
      h('ol.chr-marks', {}, ...d.stars.marks.map((m) => h(`li${m.on ? '.is-on' : ''}`, {}, m.text))));
    }
    clear(shareBox);
    shareBox.hidden = !d.share;
    copyMsg.textContent = '';
    if (d.share) {
      const text = h('output.chr-share-text', { 'aria-label': 'Share text' }, d.share);
      const copy = h('button.btn.btn-secondary.chr-copy', { type: 'button', onClick: async () => {
        const ok = await copyText(d.share);
        copyMsg.textContent = ok ? 'Copied: paste it anywhere' : 'Select the line and copy it';
        copyMsg.classList.toggle('is-error', !ok);
        clearTimeout(copyTimer);
        copyTimer = setTimeout(() => { copyMsg.textContent = ''; }, 3000);
      } }, icon('scroll', 16), 'Copy');
      shareBox.append(text, h('div.chr-share-row', {}, copy, copyMsg));
    }
    clear(notesEl);
    for (const n of d.notes || []) notesEl.appendChild(h('li', {}, icon('star', 13), n));
    notesEl.hidden = !(d.notes && d.notes.length);
    el.hidden = false;
  }
  function close() { el.hidden = true; }
  return { el, open, close, isOpen: () => !el.hidden };
}
