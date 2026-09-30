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

const SEND_FRACTIONS = [0.25, 0.5, 0.75, 1];
const SPEEDS = [1, 2, 3];
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
 * @property {0.25|0.5|0.75|1} sendFraction
 * @property {1|2|3} speed
 * @property {boolean} paused
 * @property {BattleHudPowerData[]} powers
 */

/**
 * @param {{ onSendFraction?: (f: number) => void, onPower?: (id: string) => void,
 *   onPauseToggle?: () => void, onSpeed?: (next: number) => void, onRetreat?: () => void }} [callbacks]
 */
export function createBattleHud({ onSendFraction, onPower, onPauseToggle, onSpeed, onRetreat } = {}) {
  let lastSpeed = 1;
  let lastPaused = false;
  let lastPowers = [];
  const powerEntries = new Map(); // id -> { wrap, btn, iconSlot, nameEl, cdNumEl, pip, hotkeyEl, ring, lastReady, lastLocked }

  // --- top: region name, territory tug-of-war, timer -----------------------
  const regionNameEl = h('div.battle-region-name', {}, '');
  const youBar = h('div.territory-you', {});
  const enemyBar = h('div.territory-enemy', {});
  const timerEl = h('div.battle-timer.nums', {}, icon('clock', 14), h('span', {}, '0:00'));
  const topEl = h('div.battle-top', {},
    regionNameEl,
    h('div.territory-bar', {}, youBar, enemyBar),
    timerEl,
  );

  // --- top right: pause, speed, retreat -------------------------------------
  const pauseIcon = h('span.battle-pause-icon', {}, icon('pause', 18));
  const pauseBtn = h('button.btn-icon.battle-pause', { onClick: () => onPauseToggle?.(), 'aria-label': 'Pause' }, pauseIcon);
  const speedLabel = h('span', {}, '1×');
  const speedBtn = h('button.btn.btn-secondary.battle-speed', {
    onClick: () => onSpeed?.(SPEEDS[(SPEEDS.indexOf(lastSpeed) + 1) % SPEEDS.length]),
  }, icon('speed', 16), speedLabel);
  const retreatBtn = h('button.btn.btn-danger.battle-retreat', { onClick: () => confirmRetreat() },
    icon('flag', 16), h('span.battle-retreat-label', {}, 'Retreat'));
  const topRightEl = h('div.battle-topright', {}, pauseBtn, speedBtn, retreatBtn);

  // --- bottom: send-fraction selector + powers ------------------------------
  const fractionButtons = new Map();
  const fractionEl = h('div.send-fraction-selector', {},
    ...SEND_FRACTIONS.map((f, i) => {
      const btn = h('button.send-fraction-btn', {
        onClick: () => onSendFraction?.(f),
      }, `${Math.round(f * 100)}%`, h('span.send-fraction-key', {}, String(i + 1)));
      fractionButtons.set(f, btn);
      return btn;
    }),
  );
  // DOM order matches "stack bottom-up": fraction row first (renders above,
  // in normal column flow), powers row second (renders last => closest to
  // the pinned bottom edge) — see .battle-bottom's flex-direction: column.
  const powersEl = h('div.power-buttons', {});
  const bottomEl = h('div.battle-bottom', {}, fractionEl, powersEl);

  const el = h('div.battle-hud', {}, topEl, topRightEl, bottomEl);

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
  function onKeydown(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const fi = ['1', '2', '3', '4'].indexOf(e.key);
    if (fi !== -1) {
      onSendFraction?.(SEND_FRACTIONS[fi]);
      return;
    }
    const hi = HOTKEYS.indexOf(e.key.toUpperCase());
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
    const btn = h('button.power-btn', { onClick: () => onPower?.(data.id) },
      ring, iconSlot, cdNumEl, hotkeyEl, pip);
    const nameEl = h('span.power-name', {}, h('span.power-name-full', {}, data.name || data.id), h('span.power-name-short', {}, data.shortName || data.name || data.id));
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
      if (data.territory.youColor) youBar.style.background = data.territory.youColor;
      if (data.territory.enemyColor) enemyBar.style.background = data.territory.enemyColor;
    }

    if (typeof data.timeSec === 'number') setText(timerEl.lastChild, formatClock(data.timeSec));

    if (data.sendFraction != null) {
      for (const [f, btn] of fractionButtons) btn.classList.toggle('is-active', f === data.sendFraction);
    }

    if (data.speed != null) {
      lastSpeed = data.speed;
      setText(speedLabel, `${data.speed}×`);
    }

    if (data.paused != null) {
      lastPaused = data.paused;
      setIcon(pauseIcon, lastPaused ? 'play' : 'pause', 18);
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

        entry.btn.disabled = !!p.locked;
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
    }
  }

  function destroy() {
    window.removeEventListener('keydown', onKeydown);
  }

  return { el, update, destroy };
}
