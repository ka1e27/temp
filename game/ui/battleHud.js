// In-battle HUD (DESIGN §4). Browser only; no game-logic imports — receives
// plain data (territory shares, cooldown fractions already computed) and
// fires callbacks. Owns several pieces of pure-UI state: which
// send-fraction is highlighted, hotkey→power mapping, ready-state
// transitions (for the "just became ready" pop), and the retreat confirm.
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { formatClock } from './format.js';
import { createModal } from './modal.js';

// The HUD refreshes ~15 times a second. Anything a player presses must NOT be rebuilt by a refresh: a press
// is a pointerdown ... pointerup pair, and if the element under the finger (the icon inside a button counts)
// is replaced in between, the browser never fires the click. So icons are swapped only when the icon
// CHANGES, and text is assigned only when it differs.
function setIcon(holder, name, size) {
  if (holder.dataset.icon === name) return;
  holder.dataset.icon = name;
  clear(holder);
  holder.appendChild(icon(name, size));
}
const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };
const setAttr = (node, name, value) => { if (node.getAttribute(name) !== value) node.setAttribute(name, value); };

const SEND_FRACTIONS = [0.25, 0.5, 0.75, 1];
// 0.5x is an assist (DESIGN §7.5a): the cycle is 1x, 2x, 3x, 0.5x, back to 1x
const SPEEDS = [1, 2, 3];
const SLOW_SPEEDS = [0.5, 1, 2, 3]; // Settings > Slow battles
const HOTKEYS = ['Q', 'W', 'E', 'R', 'T'];

/**
 * @typedef {Object} BattleHudPowerData
 * @property {string} id
 * @property {string} icon
 * @property {string} [name]        shown under the button in small caps; falls back to `id`
 * @property {string} [shortName]   phones (CSS, <= 640px) show this instead of `name`, so nothing is ellipsised
 * @property {number} level
 * @property {boolean} locked
 * @property {number} cooldownFrac   0 (ready) .. 1 (just used)
 * @property {number} [cooldownSec]  remaining seconds while cooling — shown as a numeral over the sweep if given
 * @property {boolean} [armed]       true while the player is picking a target for this power
 */

/**
 * @typedef {Object} BattleHudData
 * @property {string} regionName
 * @property {{ you: number, enemy: number, youColor?: string, enemyColor?: string }} territory  shares, need not be pre-normalised
 * @property {number} timeSec
 * @property {number} [swiftSec]  seconds left to win with the Swift crown (0 or less: missed)
 * @property {0.25|0.5|0.75|1} sendFraction
 * @property {0.5|1|2|3} speed
 * @property {boolean} [slowBattles]  the speed button also offers 0.5x (Settings > Slow battles)
 * @property {boolean} paused
 * @property {boolean} [auto]        the Auto toggle: while on, every send becomes a supply line (DESIGN 4.3)
 * @property {BattleHudPowerData[]} powers
 */

/**
 * @param {{ onSendFraction?: (f: number) => void, onPower?: (id: string) => void,
 *   onPauseToggle?: () => void, onSpeed?: (next: number) => void, onRetreat?: () => void, onAuto?: () => void }} [callbacks]
 */
export function createBattleHud({ onSendFraction, onPower, onPauseToggle, onSpeed, onRetreat, onAuto } = {}) {
  let lastSpeed = 1;
  let slow = false; // Settings > Slow battles: 0.5x joins the cycle
  let lastPaused = false;
  let lastPowers = [];
  const powerEntries = new Map(); // id -> { wrap, btn, iconSlot, nameEl, cdNumEl, pip, hotkeyEl, ring, lastReady, lastLocked }

  // --- top: region name, territory tug-of-war, timer -----------------------
  const regionNameEl = h('div.battle-region-name', {}, '');
  const youBar = h('div.territory-you', {});
  const enemyBar = h('div.territory-enemy', {});
  const swiftEl = h('span.battle-swift', {}, '');
  swiftEl.hidden = true;
  const timerEl = h('div.battle-timer.nums', {}, icon('clock', 14), h('span.battle-clock', {}, '0:00'), swiftEl);
  const topEl = h('div.battle-top', {},
    regionNameEl,
    h('div.territory-bar', { role: 'img', 'aria-label': 'Territory' }, youBar, enemyBar),
    timerEl,
  );
  topEl.setAttribute('role', 'group');
  topEl.setAttribute('aria-label', 'Battle status');
  const territoryEl = topEl.querySelector('.territory-bar');
  timerEl.setAttribute('role', 'timer');
  timerEl.setAttribute('aria-live', 'off');
  // "Paused" in words, not only the play icon (a battle also pauses itself while a dialog is open)
  const pausedTag = h('div.battle-paused-tag', { hidden: true, role: 'status' }, icon('pause', 14), h('span', {}, 'Paused'));

  // --- top right: pause, speed, retreat -------------------------------------
  const pauseIcon = h('span.battle-pause-icon', {}, icon('pause', 18));
  const pauseBtn = h('button.btn-icon.battle-pause', { onClick: () => onPauseToggle?.(), 'aria-label': 'Pause', 'aria-keyshortcuts': 'Space' }, pauseIcon);
  const speedLabel = h('span', {}, '1×');
  const speedBtn = h('button.btn.btn-secondary.battle-speed', {
    onClick: () => { const cycle = slow ? SLOW_SPEEDS : SPEEDS; onSpeed?.(cycle[(cycle.indexOf(lastSpeed) + 1) % cycle.length]); }, // a speed outside the cycle (0.5x just switched off) goes to the first
    'aria-label': 'Battle speed 1×, press to change',
  }, icon('speed', 16), speedLabel);
  const retreatBtn = h('button.btn.btn-danger.battle-retreat', { onClick: () => confirmRetreat(), 'aria-label': 'Retreat' },
    icon('flag', 16), h('span.battle-retreat-label', {}, 'Retreat'));
  const topRightEl = h('div.battle-topright', {}, pauseBtn, speedBtn, retreatBtn);

  // --- bottom: send-fraction selector + powers ------------------------------
  const fractionButtons = new Map();
  const fractionEl = h('div.send-fraction-selector', {},
    ...SEND_FRACTIONS.map((f, i) => {
      const btn = h('button.send-fraction-btn', {
        onClick: () => onSendFraction?.(f), 'aria-label': `Send ${Math.round(f * 100)}%`, 'aria-pressed': 'false', 'aria-keyshortcuts': String(i + 1),
      }, `${Math.round(f * 100)}%`, h('span.send-fraction-key', { 'aria-hidden': 'true' }, String(i + 1)));
      fractionButtons.set(f, btn);
      return btn;
    }),
  );
  // The Auto toggle sits left of the send size: while it is ON every send order becomes a supply line (a standing order: the settlement keeps
  // sending on its own). Its on/off state is text as well as colour ("ON" / "OFF"), and aria-pressed.
  const autoState = h('span.battle-auto-state', {}, 'Off');
  const autoBtn = h('button.battle-auto', {
    onClick: () => onAuto?.(), 'aria-pressed': 'false', 'aria-label': 'Auto supply lines', title: 'Auto supply lines (S): sends become supply lines',
  }, h('span.battle-auto-icon', {}, icon('supply', 22)), h('span.battle-auto-text', {}, h('span.battle-auto-name', {}, 'Auto'), autoState));
  const sendRowEl = h('div.battle-sendrow', {}, autoBtn, fractionEl);
  // DOM order matches "stack bottom-up": fraction row first (renders above,
  // in normal column flow), powers row second (renders last => closest to
  // the pinned bottom edge) — see .battle-bottom's flex-direction: column.
  const powersEl = h('div.power-buttons', {});
  const bottomEl = h('div.battle-bottom', {}, sendRowEl, powersEl);

  const el = h('div.battle-hud', {}, topEl, topRightEl, pausedTag, bottomEl);

  // --- retreat confirm (composes modal.js) ----------------------------------
  function confirmRetreat() {
    const modal = createModal({
      title: 'Retreat?',
      body: 'Your War Camp falls back. Squads already in the field will be lost.',
      actions: [
        { label: 'Keep fighting', variant: 'secondary', onClick: () => modal.destroy() },
        { label: 'Retreat', variant: 'danger', onClick: () => { modal.destroy(); onRetreat?.(); } },
      ],
    }, { onDismiss: () => modal.destroy() });
    document.body.appendChild(modal.el);
  }

  // --- keyboard: 1-4 send fraction, Q/W/E/R/T the first 5 powers ------------
  // Letter shortcuts use the PHYSICAL key (`e.code`), so they work on any layout; they stand down for text entry and while a dialog is open (ui/dialogs.js).
  const LETTER_CODES = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT'];
  const DIGIT_CODES = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];
  const NUMPAD_CODES = ['Numpad1', 'Numpad2', 'Numpad3', 'Numpad4'];
  function onKeydown(e) {
    if (e.metaKey || e.ctrlKey || e.altKey || el.hidden) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;
    if (document.documentElement.hasAttribute('data-dialog')) return;
    if (e.code === 'KeyS') { onAuto?.(); return; }
    let fi = DIGIT_CODES.indexOf(e.code);
    if (fi === -1) fi = NUMPAD_CODES.indexOf(e.code);
    if (fi === -1) fi = ['1', '2', '3', '4'].indexOf(e.key);
    if (fi !== -1) {
      onSendFraction?.(SEND_FRACTIONS[fi]);
      return;
    }
    const hi = LETTER_CODES.indexOf(e.code);
    if (hi === -1) return;
    const p = lastPowers[hi];
    if (!p || p.locked) return;
    onPower?.(p.id);
  }
  window.addEventListener('keydown', onKeydown);

  function buildPower(data, hotkey) {
    const ring = h('div.power-cooldown-ring', {});
    const iconSlot = h('span.power-icon', {}, icon(data.icon, 28));
    const cdNumEl = h('span.power-cooldown-num.nums', {}, '');
    const pip = h('span.power-level-pip', {}, '');
    const hotkeyEl = h('span.power-hotkey', {}, hotkey || '');
    const btn = h('button.power-btn', { onClick: () => onPower?.(data.id), 'aria-keyshortcuts': hotkey || '' },
      ring, iconSlot, cdNumEl, hotkeyEl, pip);
    hotkeyEl.setAttribute('aria-hidden', 'true');
    const nameEl = h('span.power-name', { 'aria-hidden': 'true' }, h('span.power-name-full', {}, data.name || data.id), h('span.power-name-short', {}, data.shortName || data.name || data.id));
    const wrap = h('div.power-item', {}, btn, nameEl);
    powersEl.appendChild(wrap);
    return { wrap, btn, iconSlot, nameEl, cdNumEl, pip, hotkeyEl, ring, lastReady: true, lastLocked: data.locked };
  }

  function popReady(btn) {
    btn.classList.remove('power-just-ready');
    // eslint-disable-next-line no-unused-expressions
    btn.offsetWidth; // restart the CSS animation
    btn.classList.add('power-just-ready');
  }

  function update(data) {
    if (!data) return;

    if (data.regionName != null) setText(regionNameEl, data.regionName);

    if (data.territory) {
      const total = Math.max(data.territory.you + data.territory.enemy, 1e-6);
      const youPct = (data.territory.you / total) * 100;
      youBar.style.width = `${youPct}%`;
      enemyBar.style.width = `${100 - youPct}%`;
      setAttr(territoryEl, 'aria-label', `Territory: you ${Math.round(youPct)} percent, enemy ${100 - Math.round(youPct)} percent`);
      if (data.territory.youColor) youBar.style.background = data.territory.youColor;
      if (data.territory.enemyColor) enemyBar.style.background = data.territory.enemyColor;
    }

    if (typeof data.timeSec === 'number') setText(timerEl.querySelector('.battle-clock'), formatClock(data.timeSec));
    // "0:31 · Swift 0:43": the time left to win with the Swift crown; dimmed, and said in words, once it is missed (DESIGN 4.8)
    if (typeof data.swiftSec === 'number') {
      const missed = data.swiftSec <= 0;
      swiftEl.hidden = false;
      setText(swiftEl, missed ? '· Swift missed' : `· Swift ${formatClock(data.swiftSec)}`);
      swiftEl.classList.toggle('is-missed', missed);
    }

    if (data.sendFraction != null) {
      for (const [f, btn] of fractionButtons) {
        btn.classList.toggle('is-active', f === data.sendFraction);
        setAttr(btn, 'aria-pressed', f === data.sendFraction ? 'true' : 'false');
      }
    }

    if (data.auto != null) {
      autoBtn.classList.toggle('is-on', !!data.auto);
      autoBtn.setAttribute('aria-pressed', data.auto ? 'true' : 'false');
      setText(autoState, data.auto ? 'On' : 'Off');
    }

    if (data.slowBattles != null) slow = !!data.slowBattles;
    if (data.speed != null) {
      lastSpeed = data.speed;
      setText(speedLabel, `${data.speed}×`);
      setAttr(speedBtn, 'aria-label', `Battle speed ${data.speed}×, press to change`);
    }

    if (data.paused != null) {
      lastPaused = data.paused;
      setIcon(pauseIcon, lastPaused ? 'play' : 'pause', 18);
      setAttr(pauseBtn, 'aria-label', lastPaused ? 'Resume' : 'Pause');
      pausedTag.hidden = !lastPaused;
    }

    if (data.powers) {
      lastPowers = data.powers;
      data.powers.forEach((p, i) => {
        let entry = powerEntries.get(p.id);
        if (!entry) {
          entry = buildPower(p, HOTKEYS[i]);
          powerEntries.set(p.id, entry);
        }

        const ready = !p.locked && p.cooldownFrac <= 0;
        const cooling = !p.locked && p.cooldownFrac > 0;

        // a locked power stays focusable ("Rally, level 0, locked") and says so; pressing it explains how to unlock it (the scene's toast)
        setAttr(entry.btn, 'aria-disabled', p.locked ? 'true' : 'false');
        const state = p.locked ? 'locked' : cooling && p.cooldownSec != null ? `recharging ${Math.max(1, Math.ceil(p.cooldownSec))} s` : cooling ? 'recharging' : 'ready';
        setAttr(entry.btn, 'aria-label', `${p.name || p.id}, level ${p.level}, ${state}`);
        if (p.armed) setAttr(entry.btn, 'aria-pressed', 'true'); else if (entry.btn.hasAttribute('aria-pressed')) entry.btn.removeAttribute('aria-pressed'); // pressed only while armed
        entry.btn.classList.toggle('is-locked', !!p.locked);
        entry.btn.classList.toggle('is-ready', ready);
        entry.btn.classList.toggle('is-armed', !!p.armed);
        entry.btn.classList.toggle('is-cooling', cooling);
        entry.btn.style.setProperty('--cd', String(Math.max(0, Math.min(1, p.cooldownFrac))));

        setIcon(entry.iconSlot, p.locked ? 'lock' : p.icon, 28);

        setText(entry.cdNumEl, cooling && p.cooldownSec != null ? String(Math.max(1, Math.ceil(p.cooldownSec))) : '');

        setText(entry.pip, p.level > 0 ? String(p.level) : '');
        entry.pip.hidden = p.level <= 0 || p.locked;

        const fullName = p.name || p.id;
        const shortName = p.shortName || fullName;
        if (entry.nameEl.firstChild.textContent !== fullName) entry.nameEl.firstChild.textContent = fullName;
        if (entry.nameEl.lastChild.textContent !== shortName) entry.nameEl.lastChild.textContent = shortName;
        entry.nameEl.classList.toggle('is-locked', !!p.locked);

        if (ready && !entry.lastReady) popReady(entry.btn);
        entry.lastReady = ready;
        entry.lastLocked = p.locked;
      });
      if (!namesFitted) fitNames();
    }
  }

  /** A power pressed while it cannot fire: the button shakes and flashes red once (the error blip is nothing with the sound off). */
  function refuse(id) {
    const entry = powerEntries.get(id);
    if (!entry) return;
    entry.btn.classList.remove('is-refused');
    void entry.btn.offsetWidth;
    entry.btn.classList.add('is-refused');
    setTimeout(() => entry.btn.classList.remove('is-refused'), 520);
  }

  /** A power's full name that does not fit its room is replaced by its short name, never cut off with an ellipsis. Measured once the bar is on screen, and again when the window changes. */
  let namesFitted = false;
  function fitNames() {
    if (el.hidden || !el.getClientRects().length) { namesFitted = false; return; }
    for (const entry of powerEntries.values()) {
      entry.nameEl.classList.remove('is-short', 'is-tight');
      const over = () => entry.nameEl.scrollWidth > entry.nameEl.clientWidth + 0.5;
      if (over()) entry.nameEl.classList.add('is-short');
      if (over()) entry.nameEl.classList.add('is-tight'); // the short form (phones always show it) still does not fit: tighter tracking, never an ellipsis
    }
    namesFitted = true;
  }
  window.addEventListener('resize', () => { namesFitted = false; });

  function destroy() {
    window.removeEventListener('keydown', onKeydown);
  }

  return { el, update, destroy, refuse };
}
