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
export function createHud({ onCouncil, onRealm, onRegions, onSettings, onGenerals, onEventReopen } = {}) {
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
  const renownSlot = h('span.hud-renown-slot');
  const goldBlockEl = h('div.hud-gold-block', { role: 'group', 'aria-label': 'Treasury' },
    goldIconEl,
    h('div.hud-gold-text', {}, goldValueEl, h('span.hud-subline', {}, incomeEl, renownSlot), goldSrEl, incomeSrEl));
  const starsCountEl = h('span.hud-stars-count.nums', {}, '0');
  const starsEl = h('div.hud-stars.pill', { hidden: true }, icon('star', 14), starsCountEl);
  // Renown (DESIGN 10.12): a laurel beside the gold; a plain sentence for a screen reader (not live: it changes rarely and the deed's toast says it)
  const renownValueEl = h('span.hud-renown-value.nums', { 'aria-hidden': 'true' }, '0');
  const renownSrEl = h('span.visually-hidden', {}, '0 Renown');
  const renownEl = h('div.hud-renown', { role: 'group', 'aria-label': 'Renown', title: 'Renown: earned by crowns, defenses won, retakes and toppled capitals; spent on Festivals and Generals' },
    icon('laurel', 18), renownValueEl, renownSrEl);
  renownEl.hidden = true;
  renownSlot.appendChild(renownEl); // under the gold, beside the income: no extra width in the bar (a phone has none to spare)
  // the Generals (DESIGN 10.11): a dot when a skill waits to be chosen
  const generalsDot = h('span.hud-dot', { 'aria-hidden': 'true' });
  generalsDot.hidden = true;
  const generalsBtn = h('button.btn.btn-secondary.hud-btn.hud-generals', { onClick: () => onGenerals?.(), 'aria-label': 'Generals' },
    icon('shield', 18), h('span.hud-btn-label', {}, 'Generals'), generalsDot);

  // The Regions button carries a dot when the Bounty Board (in the Regions panel) has news: a contract the player has not seen yet (PLAN-PHASE4 §4A)
  const regionsDot = h('span.hud-dot', { 'aria-hidden': 'true' });
  regionsDot.hidden = true;
  const regionsBtn = h('button.btn.btn-secondary.hud-btn.hud-regions', { onClick: () => onRegions?.(), 'aria-label': 'Regions list' },
    icon('map', 18), h('span.hud-btn-label', {}, 'Regions'), regionsDot);

  // Tabs hanging under the bar's left edge (no width taken from the bar: a 360 px phone has none to spare):
  // the Conquest Streak's flame chip (PLAN-PHASE4 §4B) and the envelope pip that reopens a closed world-event offer (§4E).
  const RING_R = 13;
  const RING_C = 2 * Math.PI * RING_R;
  const svgNs = 'http://www.w3.org/2000/svg';
  const ring = document.createElementNS(svgNs, 'svg');
  ring.setAttribute('viewBox', '0 0 32 32');
  ring.setAttribute('class', 'hud-streak-ring');
  ring.setAttribute('aria-hidden', 'true');
  const ringBack = document.createElementNS(svgNs, 'circle');
  const ringFill = document.createElementNS(svgNs, 'circle');
  for (const c of [ringBack, ringFill]) { c.setAttribute('cx', '16'); c.setAttribute('cy', '16'); c.setAttribute('r', String(RING_R)); ring.appendChild(c); }
  ringBack.setAttribute('class', 'ring-back');
  ringFill.setAttribute('class', 'ring-fill');
  ringFill.setAttribute('stroke-dasharray', RING_C.toFixed(2));
  const streakText = h('span.hud-streak-text.nums', { 'aria-hidden': 'true' }, '');
  const streakSr = h('span.visually-hidden', {}, '');
  const streakChip = h('div.hud-streak', { role: 'group', 'aria-label': 'Conquest streak' },
    h('span.hud-streak-flame', {}, ring, icon('flame', 15)), streakText, streakSr);
  streakChip.hidden = true;
  const eventPip = h('button.hud-pip.hud-event-pip', { type: 'button', onClick: () => onEventReopen?.(), 'aria-label': 'Reopen the offer' }, icon('envelope', 18));
  eventPip.hidden = true;
  const tabsEl = h('div.hud-tabs', {}, streakChip, eventPip);

  const el = h('div.hud', {},
    goldBlockEl,
    starsEl,
    h('div.hud-actions', {},
      generalsBtn,
      h('button.btn.btn-secondary.hud-btn', { onClick: () => onCouncil?.(), 'aria-label': 'War Council' },
        icon('scroll', 18), h('span.hud-btn-label', {}, 'War Council')),
      regionsBtn,
      h('button.btn.btn-secondary.hud-btn', { onClick: () => onRealm?.(), 'aria-label': 'Realm stats' },
        icon('trophy', 18), h('span.hud-btn-label', {}, 'Realm')),
      h('button.btn-icon', { onClick: () => onSettings?.(), 'aria-label': 'Settings' },
        icon('gear', 18)),
    ),
    tabsEl,
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
    if (data.renown != null) {
      const r = String(Math.floor(data.renown));
      if (renownValueEl.textContent !== r) { renownValueEl.textContent = r; renownSrEl.textContent = `${r} Renown`; }
      if (renownEl.hidden !== !data.showRenown) renownEl.hidden = !data.showRenown;
    }
    if (data.pendingPicks != null) {
      if (generalsDot.hidden !== !(data.pendingPicks > 0)) generalsDot.hidden = !(data.pendingPicks > 0);
      const label = data.pendingPicks > 0 ? 'Generals: a skill to choose' : 'Generals';
      if (generalsBtn.getAttribute('aria-label') !== label) generalsBtn.setAttribute('aria-label', label);
    }
    if (data.streak !== undefined) setStreak(data.streak);
    if (data.eventPip !== undefined) {
      const show = !!data.eventPip;
      if (eventPip.hidden === show) eventPip.hidden = !show;
      const label = show ? data.eventPip.label || 'Reopen the offer' : 'Reopen the offer';
      if (eventPip.getAttribute('aria-label') !== label) { eventPip.setAttribute('aria-label', label); eventPip.title = label; }
    }
    if (data.boardNews !== undefined) {
      const on = !!data.boardNews;
      if (regionsDot.hidden === on) regionsDot.hidden = !on;
      const label = on ? 'Regions list: news on the Bounty Board' : 'Regions list';
      if (regionsBtn.getAttribute('aria-label') !== label) regionsBtn.setAttribute('aria-label', label);
    }
    const stars = data.dynastyStars || 0;
    starsEl.hidden = stars <= 0;
    starsCountEl.textContent = `×${stars}`;
  }

  /**
   * The flame chip: "×1.2 · 3", a ring that drains as the window runs out; hidden at a streak of 0-1 (PLAN-PHASE4 §4B).
   * @param {{ count: number, mult: number, remainingSec: number, windowSec: number }|null} st
   */
  let streakCount = 0;
  function setStreak(st) {
    const show = !!st && st.count >= 2;
    if (streakChip.hidden === show) streakChip.hidden = !show;
    if (!show) { streakCount = 0; return; }
    const text = `×${(Math.round(st.mult * 10) / 10).toFixed(1)} · ${st.count}`;
    if (streakText.textContent !== text) streakText.textContent = text;
    const sr = `Conquest streak ${st.count}: conquest bounty times ${(Math.round(st.mult * 10) / 10).toFixed(1)}, ${Math.ceil(st.remainingSec)} seconds to keep it`;
    if (streakSr.textContent !== sr) streakSr.textContent = sr;
    streakChip.title = `Conquest streak: conquer again within ${Math.ceil(st.remainingSec)} s to keep it`;
    const frac = st.windowSec > 0 ? Math.max(0, Math.min(1, st.remainingSec / st.windowSec)) : 0;
    ringFill.setAttribute('stroke-dashoffset', (RING_C * (1 - frac)).toFixed(2));
    streakChip.classList.toggle('is-low', frac < 0.25);
    if (st.count > streakCount && streakCount >= 1 && !reduceMotion()) {
      streakChip.classList.remove('is-bump');
      // eslint-disable-next-line no-unused-expressions
      streakChip.offsetWidth;
      streakChip.classList.add('is-bump');
    }
    streakCount = st.count;
  }

  function destroy() {
    if (rafId != null) cancelAnimationFrame(rafId);
    clearTimeout(pulseTimeout);
    clearTimeout(flashTimeout);
  }

  return { el, update, destroy, tabsEl };
}
