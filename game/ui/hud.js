// Top HUD bar (DESIGN §7.5, ARCHITECTURE §8). Browser only; no game-logic
// imports — receives plain data and fires callbacks.
import { h } from './dom.js';
import { icon } from './icons.js';
import { shortNumber, formatRate } from './format.js';

const ROLL_MS = 700;
const FLASH_MS = 650;
// A jump is "large" (gets the strong flash, not just the small pulse) when
// it's at least this fraction of the gold the player already had — a
// relative threshold reads correctly whether it's minute 1 (bounty 90 on a
// base of 0) or hour 10 (a huge conquest bounty on a large treasury).
const BIG_JUMP_RATIO = 0.05;

/**
 * @param {{ onCouncil?: () => void, onRealm?: () => void, onRegions?: () => void, onSettings?: () => void }} [callbacks]
 * @returns {{ el: HTMLElement, update(data: { gold: number, incomePerSec: number, dynastyStars?: number, pulse?: boolean, quiet?: boolean }): void, destroy(): void }}
 *   `pulse` forces the big flash; `quiet` (idle drift) suppresses every pulse/flash and re-aims a
 *   running roll instead of restarting it.
 */
export function createHud({ onCouncil, onRealm, onRegions, onSettings } = {}) {
  let displayedGold = 0;
  let lastTargetGold = 0;
  let rafId = null;

  const goldValueEl = h('span.hud-gold-value.nums', {}, '0');
  const goldIconEl = h('span.hud-gold-icon', {}, icon('coin', 26));
  const incomeEl = h('span.hud-income.nums', {}, '+0/s');
  // The Treasury, for a screen reader: "Treasury: 1.2K gold, +3.5 per second". The rolling numbers are hidden from it (they change every frame); the plain
  // sentence below only changes when the TARGET changes, and is deliberately NOT a live region (gold ticks all the time).
  const goldSrEl = h('span.visually-hidden', {}, '0 gold');
  const incomeSrEl = h('span.visually-hidden', {}, '0 per second');
  goldValueEl.setAttribute('aria-hidden', 'true');
  incomeEl.setAttribute('aria-hidden', 'true');
  const goldBlockEl = h('div.hud-gold-block', { role: 'group', 'aria-label': 'Treasury' },
    goldIconEl,
    h('div.hud-gold-text', {}, goldValueEl, incomeEl, goldSrEl, incomeSrEl));
  const starsCountEl = h('span.hud-stars-count.nums', {}, '0');
  const starsEl = h('div.hud-stars.pill', { hidden: true }, icon('star', 14), starsCountEl);

  const el = h('div.hud', {},
    goldBlockEl,
    starsEl,
    h('div.hud-actions', {},
      h('button.btn.btn-secondary.hud-btn', { onClick: () => onCouncil?.(), 'aria-label': 'War Council' },
        icon('scroll', 18), h('span.hud-btn-label', {}, 'War Council')),
      h('button.btn.btn-secondary.hud-btn', { onClick: () => onRegions?.(), 'aria-label': 'Regions list' },
        icon('map', 18), h('span.hud-btn-label', {}, 'Regions')),
      h('button.btn.btn-secondary.hud-btn', { onClick: () => onRealm?.(), 'aria-label': 'Realm stats' },
        icon('trophy', 18), h('span.hud-btn-label', {}, 'Realm')),
      h('button.btn-icon', { onClick: () => onSettings?.(), 'aria-label': 'Settings' },
        icon('gear', 18)),
    ),
  );

  function reduceMotion() {
    return document.documentElement.classList.contains('reduce-motion');
  }

  // One roll animation at a time. A new target while a roll is in flight re-aims the SAME
  // roll (no restart from the eased start, no new rAF chain), so a HUD fed every few
  // hundred ms by the idle economy stays smooth instead of stuttering.
  let anim = null; // { start, target, startTime }

  function setGoldText(v) {
    displayedGold = v;
    goldValueEl.textContent = shortNumber(v);
  }

  function step(now) {
    if (!anim) { rafId = null; return; }
    const t = Math.min(1, (now - anim.startTime) / ROLL_MS);
    const eased = 1 - Math.pow(1 - t, 3);
    setGoldText(anim.start + (anim.target - anim.start) * eased);
    if (t < 1) {
      rafId = requestAnimationFrame(step);
    } else {
      setGoldText(anim.target);
      anim = null;
      rafId = null;
    }
  }

  /**
   * @param {number} target
   * @param {boolean} big  strong flash (large jump)
   * @param {boolean} quiet  no pulse/flash at all (idle drift): tiny changes are applied
   *   directly, larger ones roll.
   */
  function animateGoldTo(target, big, quiet) {
    const delta = target - displayedGold;
    if (Math.abs(delta) < 0.005) {
      if (anim) { anim.target = target; } else { setGoldText(target); }
      return;
    }
    if (reduceMotion()) {
      anim = null;
      setGoldText(target);
      return;
    }
    if (quiet) {
      if (anim) { anim.target = target; return; } // re-aim the running roll
      // Nothing rolling: a drift smaller than ~2% of the balance (or under 3 gold) needs no tween.
      if (Math.abs(delta) < Math.max(3, Math.abs(displayedGold) * 0.02)) { setGoldText(target); return; }
    } else if (delta > 0) {
      pulse(big);
    }
    anim = { start: displayedGold, target, startTime: performance.now() };
    if (rafId == null) rafId = requestAnimationFrame(step);
  }

  let pulseTimeout = null;
  let flashTimeout = null;
  function pulse(big) {
    goldValueEl.classList.remove('gold-pulse');
    goldIconEl.classList.remove('gold-pulse');
    // eslint-disable-next-line no-unused-expressions
    goldValueEl.offsetWidth; // restart the CSS animation
    goldValueEl.classList.add('gold-pulse');
    goldIconEl.classList.add('gold-pulse');
    clearTimeout(pulseTimeout);
    pulseTimeout = setTimeout(() => {
      goldValueEl.classList.remove('gold-pulse');
      goldIconEl.classList.remove('gold-pulse');
    }, 500);

    if (!big) return;
    goldBlockEl.classList.remove('is-flashing');
    // eslint-disable-next-line no-unused-expressions
    goldBlockEl.offsetWidth;
    goldBlockEl.classList.add('is-flashing');
    clearTimeout(flashTimeout);
    flashTimeout = setTimeout(() => goldBlockEl.classList.remove('is-flashing'), FLASH_MS);
  }

  function update(data) {
    if (!data) return;
    if (typeof data.gold === 'number') {
      const delta = data.gold - lastTargetGold;
      const quiet = data.quiet === true && data.pulse !== true;
      const big = data.pulse === true
        || (!quiet && delta > 0 && (lastTargetGold <= 0 || delta / lastTargetGold >= BIG_JUMP_RATIO));
      animateGoldTo(data.gold, big, quiet);
      lastTargetGold = data.gold;
      const goldSr = `${shortNumber(data.gold)} gold`;
      if (goldSrEl.textContent !== goldSr) goldSrEl.textContent = goldSr;
    }
    if (typeof data.incomePerSec === 'number') {
      incomeEl.textContent = `+${formatRate(data.incomePerSec)}/s`;
      const incomeSr = `plus ${formatRate(data.incomePerSec)} per second`;
      if (incomeSrEl.textContent !== incomeSr) incomeSrEl.textContent = incomeSr;
    }
    const stars = data.dynastyStars || 0;
    starsEl.hidden = stars <= 0;
    starsCountEl.textContent = `×${stars}`;
  }

  function destroy() {
    if (rafId != null) cancelAnimationFrame(rafId);
    clearTimeout(pulseTimeout);
    clearTimeout(flashTimeout);
  }

  return { el, update, destroy };
}
