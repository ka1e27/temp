// The ending (PLAN-PHASE13 §13B), loaded lazily (import()) the first time the Throne of Ages falls. One moment at a time, inside ONE dialog, so the
// shared queues hold everything else while it plays (toasts, leader lines, battles: ui/dialogs.js):
//   1. 'tour'      a short camera tour of the conquered continent (letterbox bars, one caption per stop; the map keeps drawing underneath)
//   2. 'chronicle' "The Chronicle of Your Reign": a parchment scroll of the whole history (app/crown.js builds it from endingRecord())
//   3. 'credits'   the game's name and "made with Claude"
// Skip (top right, and Escape) ends it at once from any moment. Reduce Motion: the camera cuts instead of flying (camera.instant), the scroll does
// not drift, nothing fades. Fits a 360 px phone (the scroll and the credits go full screen). Browser only: no game rules here.
import { h } from './dom.js';
import { icon } from './icons.js';
import { watchDialog } from './dialogs.js';

/**
 * @typedef {Object} EndingSection
 * @property {string} id
 * @property {string} icon
 * @property {string} heading
 * @property {[string, string][]} [rows]   label / value
 * @property {string[]} [lines]            free lines (Edicts chosen, Generals and their levels...)
 *
 * @typedef {Object} EndingData
 * @property {string} kicker                "Crowned in Year 12 · the House of Thistlefield"
 * @property {string} lead                  the scroll's first sentence
 * @property {EndingSection[]} sections
 * @property {{ x: number, y: number, zoom?: number, caption: string }[]} stops   the tour (world points)
 * @property {{ title: string, line: string, more?: string[] }} credits
 */

const TOUR = Object.freeze({ flyMs: 2100, holdMs: 900, stillHoldMs: 1700, scrollPxPerSec: 22, scrollDelayMs: 2600 });

/**
 * @param {{ camera: object, reduceMotion: () => boolean, sfx?: object }} deps
 */
export function createEnding({ camera, reduceMotion, sfx }) {
  let phase = null;
  let finish = null; // resolves play()
  let token = 0; // bumps on every skip / phase change: stale timers and flights stand down
  let raf = 0;

  const skipBtn = h('button.btn.btn-secondary.ending-skip', { type: 'button', onClick: () => skip(), 'aria-label': 'Skip the ending' }, h('span', {}, 'Skip'), icon('play', 12));
  // the tour
  const tourTitle = h('h2.ending-tour-title', {}, 'The Crown of Ages');
  const tourCaption = h('p.ending-tour-caption', { 'aria-live': 'polite' }, '');
  const tourEl = h('div.ending-tour', {}, h('div.ending-bar.is-top', { 'aria-hidden': 'true' }), h('div.ending-bar.is-bottom', { 'aria-hidden': 'true' }),
    h('div.ending-tour-words', {}, h('span.ending-tour-crown', { 'aria-hidden': 'true' }, icon('crown', 30)), tourTitle, tourCaption));
  // the Chronicle scroll
  const scrollTitle = h('h2.ending-scroll-title', {}, 'The Chronicle of Your Reign');
  const scrollKicker = h('p.ending-scroll-kicker', {}, '');
  const scrollLead = h('p.ending-scroll-lead', {}, '');
  const sectionsEl = h('div.ending-sections');
  const scrollBody = h('div.ending-scroll-body.scroll-y', { tabindex: '0', 'aria-label': 'The Chronicle of Your Reign' },
    h('div.ending-scroll-head', {}, icon('scroll', 28), scrollTitle, scrollKicker), scrollLead, sectionsEl,
    h('p.ending-scroll-end', { 'aria-hidden': 'true' }, '· · ·'));
  const scrollNext = h('button.btn.btn-primary.ending-next', { type: 'button', onClick: () => go('credits') }, 'Continue');
  const scrollEl = h('section.ending-scroll', {}, h('div.ending-scroll-paper', {}, h('span.ending-rod.is-top', { 'aria-hidden': 'true' }), scrollBody,
    h('span.ending-rod.is-bottom', { 'aria-hidden': 'true' })), h('div.ending-foot', {}, scrollNext));
  // the credits
  const creditsTitle = h('h2.ending-credits-title', {}, 'Hex Dominion');
  const creditsLine = h('p.ending-credits-line', {}, '');
  const creditsMore = h('div.ending-credits-more');
  const creditsNext = h('button.btn.btn-primary.ending-next', { type: 'button', onClick: () => end(false) }, 'Return to the realm');
  const creditsEl = h('section.ending-credits', {}, h('span.ending-credits-crown', { 'aria-hidden': 'true' }, icon('crown', 54)), creditsTitle, creditsLine, creditsMore,
    h('div.ending-foot', {}, creditsNext));

  const el = h('div.ending', { 'data-phase': '' }, h('div.ending-veil', { 'aria-hidden': 'true' }), tourEl, scrollEl, creditsEl, skipBtn);
  el.hidden = true;
  watchDialog(el, { titleEl: tourTitle, onEscape: () => skip(), initialFocus: () => skipBtn });

  const wait = (ms, t) => new Promise((res) => setTimeout(() => res(t === token), ms));
  const still = () => !!reduceMotion();

  function show(p) {
    phase = p;
    el.dataset.phase = p;
    tourEl.hidden = p !== 'tour';
    scrollEl.hidden = p !== 'chronicle';
    creditsEl.hidden = p !== 'credits';
    el.classList.toggle('is-still', still());
  }

  async function tour(stops) {
    const t = token;
    show('tour');
    for (const s of stops) {
      if (t !== token) return;
      tourCaption.textContent = s.caption || '';
      tourCaption.classList.remove('is-in'); void tourCaption.offsetWidth; tourCaption.classList.add('is-in');
      const target = { x: s.x, y: s.y, ...(s.zoom ? { zoom: s.zoom } : {}) };
      if (still()) { camera.cancelFlight?.(); camera.x = target.x; camera.y = target.y; if (target.zoom) camera.zoom = target.zoom; }
      else await camera.flyTo(target, TOUR.flyMs, 'inOutCubic');
      if (!(await wait(still() ? TOUR.stillHoldMs : TOUR.holdMs, t))) return;
    }
    if (t === token) go('chronicle');
  }

  function autoScroll() {
    cancelAnimationFrame(raf);
    if (still()) return;
    const t = token;
    const startAt = performance.now() + TOUR.scrollDelayMs;
    let last = 0;
    let acc = 0;
    const step = (now) => {
      if (t !== token || phase !== 'chronicle') return;
      if (now >= startAt) {
        const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
        acc += dt * TOUR.scrollPxPerSec;
        if (acc >= 1) { const n = Math.floor(acc); acc -= n; scrollBody.scrollTop += n; }
        last = now;
        if (scrollBody.scrollTop + scrollBody.clientHeight >= scrollBody.scrollHeight - 1) return; // reached the end
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }
  // a reader's own scroll, press or key takes the scroll over from the drift
  const takeOver = () => { cancelAnimationFrame(raf); };
  for (const ev of ['wheel', 'pointerdown', 'keydown', 'touchstart']) scrollBody.addEventListener(ev, takeOver, { passive: true });

  function go(p) {
    token += 1;
    cancelAnimationFrame(raf);
    if (p === 'chronicle') {
      show('chronicle');
      scrollBody.scrollTop = 0;
      sfx?.play('upgrade', { pitch: 0.7, volume: 0.6 });
      scrollNext.focus({ preventScroll: true });
      autoScroll();
    } else if (p === 'credits') {
      show('credits');
      sfx?.play('victory', { pitch: 0.9, volume: 0.5 });
      creditsNext.focus({ preventScroll: true });
    }
  }

  function end(skipped) {
    if (!finish) return;
    token += 1;
    cancelAnimationFrame(raf);
    camera.cancelFlight?.();
    el.hidden = true;
    document.documentElement.removeAttribute('data-ending');
    phase = null;
    el.dataset.phase = '';
    const f = finish;
    finish = null;
    f({ skipped });
  }

  function skip() { end(true); }

  function fill(d) {
    scrollKicker.textContent = d.kicker || '';
    scrollLead.textContent = d.lead || '';
    sectionsEl.replaceChildren(...(d.sections || []).map((s) => h('section.ending-section', { 'data-section': s.id },
      h('h3.ending-section-title', {}, icon(s.icon || 'star', 18), h('span', {}, s.heading)),
      ...(s.rows && s.rows.length ? [h('dl.ending-rows', {}, ...s.rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd.nums', {}, v)]))] : []),
      ...(s.lines && s.lines.length ? [h('ul.ending-lines', {}, ...s.lines.map((x) => h('li', {}, x)))] : []))));
    creditsTitle.textContent = d.credits?.title || 'Hex Dominion';
    creditsLine.textContent = d.credits?.line || 'made with Claude';
    creditsMore.replaceChildren(...(d.credits?.more || []).map((x) => h('p', {}, x)));
  }

  /** Plays the ending; resolves `{ skipped }` once it is over (Skip, Escape, or "Return to the realm"). */
  function play(d) {
    if (finish) return Promise.resolve({ skipped: true });
    fill(d);
    token += 1;
    el.hidden = false;
    document.documentElement.setAttribute('data-ending', ''); // the game's own UI steps aside for the cinematic (styles/components/crown.css)
    const p = new Promise((res) => { finish = res; });
    if (d.stops && d.stops.length) tour(d.stops); else go('chronicle');
    return p;
  }

  return {
    el, play, skip, go,
    get phase() { return phase; },
    get playing() { return !!finish; },
    /** Dev / checks: the scroll's text. */
    text: () => scrollBody.textContent,
  };
}
