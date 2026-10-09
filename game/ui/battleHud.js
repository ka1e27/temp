// In-battle HUD (DESIGN §4). Browser only; no game-logic imports — receives
// plain data (territory shares, cooldown fractions already computed) and
// fires callbacks. Owns several pieces of pure-UI state: which
// send-fraction is highlighted, hotkey→power mapping, ready-state
// transitions (for the "just became ready" pop), and the retreat confirm.
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { formatClock } from './format.js';
import { createModal } from './modal.js';
import { matches, labelOf, bindingOf, onBindingsChange } from './keymap.js';

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
export function createBattleHud({ onSendFraction, onPower, onPauseToggle, onSpeed, onRetreat, onAuto, onMap, onAbility } = {}) {
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
  // A varied map (DESIGN 10.13): the fight's twist or boss in one line under the timer: "Hold all 3 Shrines" with its progress, the Dragon's
  // health, "Take the Gate first", or the twist's name. A bar shows progress (shrines held, then the hold; the Dragon's health).
  const featureText = h('span.battle-feature-text', {}, '');
  const featureFill = h('span.battle-feature-fill', {});
  const featureBar = h('span.battle-feature-bar', { 'aria-hidden': 'true' }, featureFill);
  const featureEl = h('div.battle-feature', { role: 'status' }, featureText, featureBar);
  featureEl.hidden = true;
  const topEl = h('div.battle-top', {},
    regionNameEl,
    h('div.territory-bar', { role: 'img', 'aria-label': 'Territory' }, youBar, enemyBar),
    timerEl,
    featureEl,
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
    onClick: () => cycleSpeed(), // a speed outside the cycle (0.5x just switched off) goes to the first
    'aria-label': 'Battle speed 1×, press to change',
  }, icon('speed', 16), speedLabel);
  const retreatBtn = h('button.btn.btn-danger.battle-retreat', { onClick: () => confirmRetreat(), 'aria-label': 'Retreat' },
    icon('flag', 16), h('span.battle-retreat-label', {}, 'Retreat'));
  // Back to the map WITHOUT ending the fight (DESIGN 10.5): the battle keeps running under its commander; the tray brings you back. Shown when the shell allows it.
  const mapBtn = h('button.btn-icon.battle-map', { onClick: () => onMap?.(), 'aria-label': 'Map: leave this battle running and go to the map', title: 'Map (the battle keeps going)' }, icon('map', 18));
  mapBtn.hidden = true;
  const topRightEl = h('div.battle-topright', {}, mapBtn, pauseBtn, speedBtn, retreatBtn);

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
  // the commander's ability (DESIGN 10.11): once per battle, key G; a Raid then waits for its target (armed). Hidden under the Militia Captain.
  const abilityLabel = h('span.battle-ability-label', {}, '');
  const abilityIcon = h('span.battle-ability-icon', { 'aria-hidden': 'true' }, icon('star', 16));
  let abilityKind = null;
  const abilityBtn = h('button.btn.btn-primary.battle-ability', { type: 'button', onClick: () => onAbility?.(), 'aria-keyshortcuts': 'G' },
    abilityIcon, abilityLabel, h('span.battle-ability-key', { 'aria-hidden': 'true' }, 'G'));
  abilityBtn.hidden = true;
  const sendRowEl = h('div.battle-sendrow', {}, abilityBtn, autoBtn, fractionEl);
  // DOM order matches "stack bottom-up": fraction row first (renders above,
  // in normal column flow), powers row second (renders last => closest to
  // the pinned bottom edge) — see .battle-bottom's flex-direction: column.
  const powersEl = h('div.power-buttons', {});
  // a rule that locks every power (Iron Will, Holy Ground), written across the bar; it lets presses through (a press still explains in a toast)
  const powersRuleEl = h('div.power-rule', { 'aria-hidden': 'true' }, icon('lock', 14), h('span', {}, ''));
  powersRuleEl.hidden = true;
  powersEl.appendChild(powersRuleEl);
  const bottomEl = h('div.battle-bottom', {}, sendRowEl, powersEl);

  // the name of an ability just used, under the battle header (DESIGN 10.11): a banner, not world text a settlement badge could cover
  const abilityBanner = h('div.battle-ability-banner', { 'aria-hidden': 'true' }, '');
  abilityBanner.hidden = true;
  let bannerTimer = 0;
  function showAbilityBanner(text, iconEl) {
    clearTimeout(bannerTimer);
    abilityBanner.replaceChildren(...(iconEl ? [iconEl] : []), h('span', {}, text));
    abilityBanner.hidden = false;
    abilityBanner.classList.remove('is-in');
    void abilityBanner.offsetWidth;
    abilityBanner.classList.add('is-in');
    bannerTimer = setTimeout(() => { abilityBanner.hidden = true; abilityBanner.classList.remove('is-in'); }, 1600);
  }
  // "{Leader}'s champion has fallen!" (PLAN-PHASE4 §4D): a bigger, rarer banner than the ability's, ~2.6 s
  const championBanner = h('div.battle-champion-banner', { 'aria-hidden': 'true' }, '');
  championBanner.hidden = true;
  let championTimer = 0;
  // PLAN-PHASE13: the Throne's moments (a Champion falls, a phase begins, a borrowed weapon) come close together: a banner already up finishes
  // its 2.6 s before the next one shows (at most 3 wait; the oldest waiting one is dropped). `variant` 'throne' is the regal wine-and-gold look.
  const bannerQueue = [];
  let championBusyUntil = 0;
  function showChampionBanner(text, iconEl, variant) {
    const now = performance.now();
    if (now < championBusyUntil) {
      bannerQueue.push([text, iconEl, variant]);
      if (bannerQueue.length > 3) bannerQueue.shift();
      return;
    }
    clearTimeout(championTimer);
    championBanner.replaceChildren(...(iconEl ? [iconEl] : []), h('span', {}, text));
    championBanner.classList.toggle('is-throne', variant === 'throne');
    championBanner.hidden = false;
    championBanner.classList.remove('is-in');
    void championBanner.offsetWidth;
    championBanner.classList.add('is-in');
    championBusyUntil = now + 2500;
    championTimer = setTimeout(() => {
      championBanner.hidden = true; championBanner.classList.remove('is-in'); championBusyUntil = 0;
      const next = bannerQueue.shift();
      if (next) showChampionBanner(...next);
    }, 2600);
  }
  const el = h('div.battle-hud', {}, topEl, topRightEl, pausedTag, abilityBanner, championBanner, bottomEl);

  // --- retreat confirm (composes modal.js) ----------------------------------
  // The words of the confirmation: an attack's (the default), or a defense's, which gives the region up (DESIGN 10.1: a retreat from a defense is a loss)
  let retreatCopy = null; // { title, body, action } from update({ retreat })
  function confirmRetreat() {
    const c = retreatCopy || { title: 'Retreat?', body: 'Your War Camp falls back. Squads already in the field will be lost.', action: 'Retreat' };
    const modal = createModal({
      title: c.title,
      body: c.body,
      actions: [
        { label: 'Keep fighting', variant: 'secondary', onClick: () => modal.destroy() },
        { label: c.action, variant: 'danger', onClick: () => { modal.destroy(); onRetreat?.(); } },
      ],
    }, { onDismiss: () => modal.destroy() });
    document.body.appendChild(modal.el);
  }

  // --- keyboard: the send sizes, the five powers, Auto, the ability and the speed, through the rebindable map (ui/keymap.js; defaults 1-4, Q W E R T,
  // S, G, F). Shortcuts use the PHYSICAL key (`e.code`), so they work on any layout; they stand down for text entry and while a dialog is open (ui/dialogs.js).
  const SEND_ACTIONS = ['send25', 'send50', 'send75', 'send100'];
  const POWER_ACTIONS = ['power1', 'power2', 'power3', 'power4', 'power5'];
  function onKeydown(e) {
    if (e.metaKey || e.ctrlKey || e.altKey || el.hidden) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;
    if (document.documentElement.hasAttribute('data-dialog')) return;
    if (matches('auto', e)) { onAuto?.(); return; }
    if (matches('ability', e)) { if (!abilityBtn.hidden && !abilityBtn.disabled) onAbility?.(); return; }
    if (matches('speed', e)) { if (!e.repeat) cycleSpeed(); return; }
    const fi = SEND_ACTIONS.findIndex((a) => matches(a, e));
    if (fi !== -1) {
      onSendFraction?.(SEND_FRACTIONS[fi]);
      return;
    }
    const hi = POWER_ACTIONS.findIndex((a) => matches(a, e));
    if (hi === -1) return;
    const p = lastPowers[hi];
    if (!p || p.locked) return;
    onPower?.(p.id);
  }
  window.addEventListener('keydown', onKeydown);

  /** Every key label and aria-keyshortcuts on the HUD follows the map (a rebind relabels at once). */
  function relabelKeys() {
    SEND_ACTIONS.forEach((a, i) => {
      const btn = fractionButtons.get(SEND_FRACTIONS[i]);
      if (!btn) return;
      btn.setAttribute('aria-keyshortcuts', labelOf(a));
      const k = btn.querySelector('.send-fraction-key');
      if (k) k.textContent = labelOf(a);
    });
    lastPowers.forEach((p, i) => {
      const entry = powerEntries.get(p.id);
      if (!entry || i >= POWER_ACTIONS.length) return;
      entry.hotkeyEl.textContent = labelOf(POWER_ACTIONS[i]);
      entry.btn.setAttribute('aria-keyshortcuts', labelOf(POWER_ACTIONS[i]));
    });
    abilityBtn.setAttribute('aria-keyshortcuts', labelOf('ability'));
    abilityBtn.querySelector('.battle-ability-key').textContent = labelOf('ability');
    pauseBtn.setAttribute('aria-keyshortcuts', bindingOf('pause') === 'Space' ? 'Space' : labelOf('pause'));
    speedBtn.setAttribute('aria-keyshortcuts', labelOf('speed'));
    autoBtn.title = `Auto supply lines (${labelOf('auto')}): sends become supply lines`;
  }
  const offBindings = onBindingsChange(relabelKeys);
  relabelKeys();

  /** The speed button's cycle (1x, 2x, 3x; 0.5x first with Settings > Slow battles), from a press or the speed key. */
  function cycleSpeed() {
    if (el.hidden) return;
    const cycle = slow ? SLOW_SPEEDS : SPEEDS;
    onSpeed?.(cycle[(cycle.indexOf(lastSpeed) + 1) % cycle.length]);
  }

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
    if (data.canLeave != null && mapBtn.hidden === !!data.canLeave) mapBtn.hidden = !data.canLeave;
    if (data.ability !== undefined) {
      const a = data.ability;
      if (abilityBtn.hidden !== !a) abilityBtn.hidden = !a;
      if (a) {
        // the commanding General's emblem (a shield for the Marshal, an eye for the Oracle...), so the button says WHO acts, even icon-only on a phone
        if (a.emblem && a.kind !== abilityKind) { abilityKind = a.kind; abilityIcon.replaceChildren(a.emblem()); }
        // Warrior Kings (PLAN-PHASE5 §5A): two uses a battle; the label counts what is left ("Shield Wall · 2")
        const multi = (a.uses || 1) > 1;
        const spent = multi ? a.left <= 0 : a.used;
        setText(abilityLabel, spent ? `${a.name} used` : a.armed ? `${a.name}: pick a target` : multi ? `${a.name} · ${a.left}` : a.name);
        const dis = !a.ready && !a.armed;
        if (abilityBtn.disabled !== dis) abilityBtn.disabled = dis;
        abilityBtn.classList.toggle('is-used', !!spent);
        abilityBtn.classList.toggle('is-armed', !!a.armed);
        setAttr(abilityBtn, 'aria-label', spent ? `${a.name}: used this battle` : multi ? `${a.name} (G), ${a.left} of ${a.uses} uses left: ${a.desc || ''}${a.armed ? '. Pick a target, or press again to cancel' : ''}` : `${a.name} (G): ${a.desc || ''}${a.armed ? '. Pick a target, or press again to cancel' : ''}`);
        setAttr(abilityBtn, 'title', a.desc || a.name);
      }
    }
    if (data.retreat !== undefined) retreatCopy = data.retreat;
    if (data.feature !== undefined) {
      const f = data.feature;
      if (featureEl.hidden !== !f) featureEl.hidden = !f;
      if (f) {
        setText(featureText, f.text);
        const kind = `battle-feature is-${f.kind}${f.tone ? ` is-${f.tone}` : ''}`;
        if (featureEl.className !== kind) featureEl.className = kind;
        const hasBar = typeof f.frac === 'number';
        if (featureBar.hidden !== !hasBar) featureBar.hidden = !hasBar;
        if (hasBar) featureFill.style.width = `${Math.round(Math.max(0, Math.min(1, f.frac)) * 100)}%`;
      }
    }

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
    // a DEFENSE counts down its siege instead: "0:31 · Hold 1:12" (hold the keep until it runs out, DESIGN 10.1)
    if (typeof data.holdSec === 'number') {
      swiftEl.hidden = false;
      setText(swiftEl, `· Hold ${formatClock(Math.max(0, data.holdSec))}`);
      swiftEl.classList.remove('is-missed');
      swiftEl.classList.add('is-hold');
    } else if (typeof data.swiftSec === 'number') {
      swiftEl.classList.remove('is-hold');
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

    if (data.powersRule !== undefined) {
      const rule = data.powersRule || '';
      if (powersRuleEl.hidden !== !rule) powersRuleEl.hidden = !rule;
      if (rule) setText(powersRuleEl.lastChild, rule);
    }
    if (data.powers) {
      lastPowers = data.powers;
      data.powers.forEach((p, i) => {
        let entry = powerEntries.get(p.id);
        if (!entry) {
          entry = buildPower(p, i < POWER_ACTIONS.length ? labelOf(POWER_ACTIONS[i]) : HOTKEYS[i]);
          powerEntries.set(p.id, entry);
        }

        const ready = !p.locked && p.cooldownFrac <= 0;
        const cooling = !p.locked && p.cooldownFrac > 0;

        // a locked power stays focusable ("Rally, level 0, locked") and says so; pressing it explains how to unlock it (the scene's toast)
        setAttr(entry.btn, 'aria-disabled', p.locked ? 'true' : 'false');
        const lockWhy = p.blocked || (p.holy ? 'cannot be used on Holy Ground' : null); // Holy Ground, or a Challenge (Iron Will) that forbids powers
        const state = lockWhy ? lockWhy : p.locked ? 'locked' : cooling && p.cooldownSec != null ? `recharging ${Math.max(1, Math.ceil(p.cooldownSec))} s` : cooling ? 'recharging' : 'ready';
        setAttr(entry.btn, 'aria-label', `${p.name || p.id}, level ${p.level}, ${state}`);
        if (p.armed) setAttr(entry.btn, 'aria-pressed', 'true'); else if (entry.btn.hasAttribute('aria-pressed')) entry.btn.removeAttribute('aria-pressed'); // pressed only while armed
        entry.btn.classList.toggle('is-locked', !!p.locked);
        entry.btn.classList.toggle('is-holy', !!lockWhy); // Holy Ground (DESIGN 10.13): every power greyed, a halo lock
        entry.btn.classList.toggle('is-boosted', !!p.boost); // Blizzard: the stronger Firestorm
        entry.btn.classList.toggle('is-ready', ready && !lockWhy);
        entry.btn.classList.toggle('is-armed', !!p.armed);
        entry.btn.classList.toggle('is-cooling', cooling);
        entry.btn.style.setProperty('--cd', String(Math.max(0, Math.min(1, p.cooldownFrac))));

        setIcon(entry.iconSlot, p.locked || lockWhy ? 'lock' : p.icon, 28);

        setText(entry.cdNumEl, cooling && p.cooldownSec != null ? String(Math.max(1, Math.ceil(p.cooldownSec))) : '');

        setText(entry.pip, p.boost && p.level > 0 ? `${p.level} ${p.boost}` : p.level > 0 ? String(p.level) : '');
        if (p.boost) setAttr(entry.btn, 'aria-label', `${p.name || p.id}, level ${p.level}, ${state}, ${p.boost} in the Blizzard`);
        entry.pip.hidden = p.level <= 0 || p.locked;

        const fullName = p.name || p.id;
        const shortName = p.shortName || fullName;
        if (entry.nameEl.firstChild.textContent !== fullName) entry.nameEl.firstChild.textContent = fullName;
        if (entry.nameEl.lastChild.textContent !== shortName) entry.nameEl.lastChild.textContent = shortName;
        entry.nameEl.classList.toggle('is-locked', !!p.locked);

        if (ready && !lockWhy && !entry.lastReady) popReady(entry.btn);
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
    offBindings();
  }

  /** A new battle: no banner of the last one is left waiting. */
  function clearBanners() { bannerQueue.length = 0; clearTimeout(championTimer); championBusyUntil = 0; championBanner.hidden = true; championBanner.classList.remove('is-in'); }
  return { el, update, destroy, refuse, showAbilityBanner, showChampionBanner, clearBanners, abilityButton: () => (abilityBtn.hidden ? null : abilityBtn) };
}
