// Rival leader banner (DESIGN §3.6): a compact, click-through banner that slides in top-centre
// below the HUD with the leader's emblem medallion, name + title and one short line, then leaves
// by itself after about 4 s. Browser only; no game-logic imports — game/meta/leaders.js decides
// WHEN a line is spoken and WHAT it says, this only shows it.
import { h } from './dom.js';
import { drawEmblem } from '../render/sprites.js';

const DEFAULT_MS = 4200;
const MEDAL_PX = 46;
const CREAM = '#f3ead7';
const FALLBACK = { name: '', color: '#9a927f', colorDark: '#5f5847', colorLight: '#d8d0bb', emblem: 'star' };

/**
 * @typedef {Object} LeaderBannerData
 * @property {{ name?: string, color: string, colorDark?: string, colorLight?: string, emblem: string }} faction
 *   a `world.factions[i]` entry works as is
 * @property {string} name        the leader's name, e.g. "Korash"
 * @property {string} title       e.g. "Warlord"
 * @property {string} line        the spoken line (already filled in, ~70 characters at most)
 * @property {number} [durationMs] visible time; default 4200, 0 = stay until hide() (gallery, tests)
 */

function shadeHex(hex, amount) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const mix = (c) => Math.max(0, Math.min(255, Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount)));
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/**
 * The round faction medallion: a seal in the faction colour with the map-banner emblem on it.
 * DPR aware (capped at 2), so it is crisp on phones. Only the backing store is sized here; CSS
 * (.leader-medal) owns the displayed size, so a phone can show it smaller without a blur.
 * @param {HTMLCanvasElement} canvas
 * @param {LeaderBannerData['faction']} faction
 * @param {number} [cssPx]
 */
export function drawMedallion(canvas, faction, cssPx = MEDAL_PX) {
  const f = { ...FALLBACK, ...faction };
  const light = f.colorLight || shadeHex(f.color, 0.35);
  const dark = f.colorDark || shadeHex(f.color, -0.35);
  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  canvas.width = Math.round(cssPx * dpr);
  canvas.height = Math.round(cssPx * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssPx, cssPx);
  const c = cssPx / 2;
  const r = c - 1.5;

  // dark rim, then the coloured disc with a soft top-left light
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(14, 12, 10, 0.85)';
  ctx.fill();
  const g = ctx.createRadialGradient(c - r * 0.35, c - r * 0.4, r * 0.1, c, c, r);
  g.addColorStop(0, light);
  g.addColorStop(0.55, f.color);
  g.addColorStop(1, dark);
  ctx.beginPath();
  ctx.arc(c, c, r - 1.6, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();

  // inner ring
  ctx.beginPath();
  ctx.arc(c, c, r - 4.2, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.38)';
  ctx.lineWidth = 1;
  ctx.stroke();

  drawEmblem(ctx, f.emblem, c, c + 0.5, cssPx * 0.5, CREAM);
}

/**
 * The banner. Mount `el` once in #ui; call `update(data)` to speak a line. It never takes pointer
 * events, so the map underneath stays fully interactive.
 *
 * Where it sits: by default a fixed lane below the world HUD (CSS `--leader-banner-top`). Screens
 * whose top chrome is taller or shaped differently (the phone battle HUD stacks a button row above
 * the region pill) pass `below`, a function returning the element(s) to sit under; the banner is
 * measured against them each time it speaks, so no pixel value is hard-coded.
 * @param {{ below?: () => (HTMLElement|null|undefined|Array<HTMLElement|null|undefined>) }} [opts]
 */
export function createLeaderBanner({ below } = {}) {
  const medal = h('canvas.leader-medal', { width: MEDAL_PX, height: MEDAL_PX });
  const nameEl = h('span.leader-name', {}, '');
  const titleEl = h('span.leader-title', {}, '');
  const lineEl = h('p.leader-line', {}, '');
  const timerEl = h('span.leader-timer', {});
  // Screen readers hear this live region; the visible card is aria-hidden so it is not read twice.
  const srEl = h('span.visually-hidden', {}, '');

  const card = h('div.leader-card', { 'aria-hidden': 'true' },
    medal,
    h('div.leader-text', {}, h('div.leader-head', {}, nameEl, titleEl), lineEl),
    timerEl,
  );
  const el = h('div.leader-banner', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', dataset: { state: 'idle' } },
    card, srEl);

  let hideTimer = 0;
  let cleanTimer = 0;
  let medalKey = '';
  let tick = false;

  /** Sit 8px under the lowest of the `below` elements (visible ones only). */
  function place() {
    if (!below) return;
    const parent = el.offsetParent;
    const originY = parent ? parent.getBoundingClientRect().top : 0;
    let bottom = null;
    for (const node of [].concat(below() || [])) {
      if (!node || node.hidden || !node.isConnected) continue;
      const r = node.getBoundingClientRect();
      if (r.height > 0) bottom = Math.max(bottom ?? -Infinity, r.bottom);
    }
    if (bottom != null) el.style.setProperty('--leader-banner-top', `${Math.round(bottom - originY + 8)}px`);
  }

  function isShowing() {
    return el.dataset.state === 'in';
  }

  function hide() {
    clearTimeout(hideTimer);
    if (el.dataset.state !== 'in') return;
    el.dataset.state = 'out';
    clearTimeout(cleanTimer);
    cleanTimer = setTimeout(() => {
      if (el.dataset.state === 'out') el.dataset.state = 'idle';
    }, 320);
  }

  /** @param {LeaderBannerData|null} data  a falsy value (or no line) hides the banner */
  function update(data) {
    if (!data || !data.line) {
      hide();
      return;
    }
    const f = { ...FALLBACK, ...data.faction };
    card.style.setProperty('--leader-color', f.color);
    card.style.setProperty('--leader-light', f.colorLight || shadeHex(f.color, 0.35));
    card.style.setProperty('--leader-dark', f.colorDark || shadeHex(f.color, -0.35));

    const key = `${f.color}|${f.emblem}`;
    if (key !== medalKey) {
      medalKey = key;
      drawMedallion(medal, f);
    }
    nameEl.textContent = data.name || '';
    titleEl.textContent = data.title || '';
    lineEl.textContent = data.line;
    srEl.textContent = `${data.title ? `${data.title} ` : ''}${data.name || ''}: ${data.line}`;
    card.dataset.faction = f.emblem;

    const ms = data.durationMs != null ? data.durationMs : DEFAULT_MS;
    el.style.setProperty('--leader-ms', `${ms}ms`);
    el.classList.toggle('is-sticky', !ms);

    place();
    // Slide/fade in unless it is already up (a second line then just swaps in place); the tick
    // attribute alternates two identical keyframe names so the countdown bar restarts either way.
    clearTimeout(hideTimer);
    clearTimeout(cleanTimer);
    if (el.dataset.state !== 'in') {
      el.dataset.state = 'idle';
      void el.offsetWidth;
      el.dataset.state = 'in';
    }
    tick = !tick;
    el.dataset.tick = tick ? 'a' : 'b';
    if (ms > 0) hideTimer = setTimeout(hide, ms);
  }

  function destroy() {
    clearTimeout(hideTimer);
    clearTimeout(cleanTimer);
  }

  /** Re-measure while showing: a toast that arrives after the banner spoke pushes it down (the `below` elements include the toast lane). */
  function reflow() {
    if (isShowing()) place();
  }

  return { el, update, hide, isShowing, reflow, destroy };
}
