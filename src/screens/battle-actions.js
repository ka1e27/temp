// The site panel's ACTIONS group: what you can do about the site you selected.
//
// Split out of ./battle-panel.js for the line budget, same as ./battle-upgrade.js
// before it. battle-panel.js still owns the group element and re-exports these,
// so nothing downstream has to know they moved.
//
// Everything here appends a COMMAND through `input` and reads its value back off
// the SIMULATION. Nothing writes to a site. That is what makes a rejected order
// visibly do nothing instead of leaving a control lying about the state.
import {
  RALLY_KEEP, UNITS, SITES, CENTIGOLD, RECRUIT, BUILDABLE_KINDS, BUILD_COSTS,
} from '../content/balance.js';
import { TICK_HZ } from '../core/loop.js';
import { rallyKeepOf, clampRallyKeep } from '../battle/state.js';
import { recruitReadyTick, buildingFor } from '../battle/commands.js';
import { goldOf } from '../battle/economy.js';
import { h, bindText, bindClass } from '../ui/dom.js';
import { spaceCase } from '../ui/format.js';
import { siteOf } from './battle-preview.js';
import { keepLabel } from './battle-econ.js';

/**
 * The per-site rally hold-back: how many troops a rallied site keeps at home
 * before forwarding the rest. A back-line farm should keep almost nothing; a
 * front stronghold feeding a siege has to hold enough to survive the
 * counter-attack, and one global number cannot be both.
 *
 * A SLIDER rather than a pair of step buttons. The band is 0-40 in twos — 21
 * stops — and the common intent is "none" or "most of it", both of which are one
 * throw of a slider and were eleven presses of a button. The player's usual
 * answer is a saved preference now (meta.settings.rallyKeepDefault), so this
 * control is for the exception rather than for every site in the region.
 */
export function createKeepRow(getState, input, targetId) {
  const value = h('span.keep-value.num', { text: '' });
  const slider = h('input.keep-slider', {
    type: 'range',
    min: `${RALLY_KEEP.min}`, max: `${RALLY_KEEP.max}`, step: `${RALLY_KEEP.step}`,
    'data-interactive': true,
    'aria-label': 'Troops this site keeps at home when rallying',
    // `input` rather than `change`: dragging should move the simulation as you
    // drag, the same way every other control here is live. The element is read
    // from the CLOSURE rather than off the event, so the handler is drivable
    // without a real event object.
    on: { input: () => setKeep(getState(), targetId(), readSlider(slider), input) },
  });
  const el = h('div.hud-keep', {},
    h('span.keep-label', { text: 'Rally' }), slider, value);

  const set = { value: bindText(value, ''), open: bindClass(el, 'is-open') };
  let shown = null;

  return {
    el,
    /** @param {?object} site the selected site, or null to hide the row.
     *  @returns {boolean} true when the row appeared, vanished or changed. */
    show(site) {
      let wrote = set.open(!!site) ? 1 : 0;
      if (!site) return !!wrote;
      const n = rallyKeepOf(site);
      wrote |= set.value(keepLabel(site));
      // Never write the slider back while the player is dragging it — that is
      // what makes a range input fight the hand holding it.
      if (shown !== n && document.activeElement !== slider) {
        shown = n;
        slider.value = `${n}`;
      }
      return !!wrote;
    },
  };
}

/** A range input's current value as a number, however the host spells it. */
const readSlider = (el) => (Number.isFinite(el.valueAsNumber)
  ? el.valueAsNumber : Number(el.value));

/**
 * Set a site's hold-back to an explicit value and append exactly one order.
 *
 * Exported because a control whose handler is untestable is how a dead one ships
 * green: a test can call this without a DOM and still travel the whole real path
 * into `state.commands[]`. The sim owns the clamp; clamping here too only keeps
 * the order from being one that can only ever be rejected.
 * @returns {boolean} true when an order was queued.
 */
export function setKeep(state, siteId, value, input) {
  const site = siteId ? siteOf(state, siteId) : null;
  if (!site || !Number.isFinite(value)) return false;
  input.setRallyKeep(site.id, clampRallyKeep(value));
  return true;
}

/**
 * COMMISSION A MARSHAL.
 *
 * A marshal used to cost you a whole stronghold's output for forty seconds — you
 * had to retask the site, wait, and then remember to set it back — which is why
 * a 4,000-crown unlock went unused. It is one button and a gold price now, and
 * `trainType` is not touched, so the wall keeps building spears while its
 * commander rides in.
 *
 * Priced above the training cost precisely because it skips the wait.
 */
export function createRecruitRow(getState, input, targetId) {
  const btn = h('button.btn.hud-recruit', {
    'data-interactive': true, type: 'button',
    on: { click: () => recruit(getState(), targetId(), input) },
  }, '');
  const set = { label: bindText(btn, ''), open: bindClass(btn, 'is-open') };
  let can = null;

  return {
    el: btn,
    /** @returns {boolean} true when the button appeared, vanished or changed. */
    show(site) {
      const state = getState();
      const offer = recruitOffer(state, site);
      let wrote = set.open(offer.shown) ? 1 : 0;
      if (!offer.shown) return !!wrote;
      wrote |= set.label(offer.label);
      if (can !== offer.can) {
        can = offer.can;
        btn.disabled = !offer.can;
        btn.title = offer.why;
      }
      return !!wrote;
    },
  };
}

/**
 * Whether the Recruit action applies to this site, and what it should say.
 * PURE — the whole affordability gate is testable without a DOM.
 * @returns {{shown:boolean, can:boolean, label:string, why:string}}
 */
export function recruitOffer(state, site) {
  const out = { shown: false, can: false, label: '', why: '' };
  if (!state || !site || site.owner !== 'player') return out;
  if (!SITES[site.kind]?.train) return out;
  if (!(state.mods?.player?.unlockedUnits ?? []).includes('marshal')) return out;

  out.shown = true;
  out.label = `Marshal · ${RECRUIT.marshal.gold}g`;
  if ((site.garrison.marshal || 0) >= (UNITS.marshal.maxPerSite ?? 1)) {
    out.why = 'This site already has a Marshal.';
    return out;
  }
  // The cooldown is read from the SIM rather than recomputed, so the button can
  // never offer a commission the next tick would refuse. It counts down in the
  // label because a disabled button with no reason is indistinguishable from a
  // broken one — which is how three boosters shipped unreachable.
  const left = recruitReadyTick(state, 'player', 'marshal') - state.tick;
  if (left > 0) {
    out.label = `Marshal · ${Math.ceil(left / TICK_HZ)}s`;
    out.why = 'No one to commission yet — the last one only just rode out.';
    return out;
  }
  if (goldOf(state.factions.player) < RECRUIT.marshal.gold * CENTIGOLD) {
    out.why = 'Not enough gold.';
    return out;
  }
  out.can = true;
  out.why = '';
  return out;
}

/** Queue the RECRUIT order. Exported for the same reason as `setKeep`.
 *  @returns {boolean} true when an order was queued. */
export function recruit(state, siteId, input) {
  const site = siteId ? siteOf(state, siteId) : null;
  if (!site || !recruitOffer(state, site).can) return false;
  input.recruit(site.id, 'marshal');
  return true;
}

/**
 * RAISE A BUILDING.
 *
 * Unlike Recruit, a click here does not act on the selected site at all — it
 * ARMS a kind, and a separate click on the board (battle-input.js) resolves
 * the hex and fires. `buildBlocker` already answers WHERE; this only ever
 * has to answer WHAT, and whether the treasury covers it right now, which is
 * why `kind` is a loop variable here rather than something read off the
 * current selection the way Recruit's `site` is.
 * PURE — the whole affordability gate is testable without a DOM.
 * @returns {{shown:boolean, can:boolean, label:string, why:string}}
 */
export function buildOffer(state, kind) {
  const out = { shown: false, can: false, label: '', why: '' };
  const spec = BUILD_COSTS[kind];
  if (!state || !spec) return out;
  out.shown = true;
  out.label = `${spaceCase(kind).toUpperCase()} · ${spec.gold}g · ${spec.sec}s`;
  if (buildingFor(state, 'player').length) {
    out.why = 'Already raising something — one at a time.';
    return out;
  }
  if (goldOf(state.factions.player) < spec.gold * CENTIGOLD) {
    out.why = 'Not enough gold.';
    return out;
  }
  out.can = true;
  return out;
}

/**
 * The build action's row: one button per buildable kind, so `kind` is fixed
 * per button rather than a picker the player opens first — the loadout is
 * short enough (three) that naming each one on its own face costs nothing and
 * saves a click every time.
 */
export function createBuildRow(getState, input, view) {
  const buttons = BUILDABLE_KINDS.map((kind) => h(`button.btn.hud-build.hud-build-${kind}`, {
    'data-interactive': true, type: 'button',
    on: { click: () => input.useBuild(kind) },
  }, ''));
  const el = h('div.hud-build-row', {}, ...buttons);
  const label = buttons.map((b) => bindText(b, ''));
  const armedSet = buttons.map((b) => bindClass(b, 'is-armed'));
  const open = bindClass(el, 'is-open');
  const can = buttons.map(() => null);

  return {
    el,
    /** @param {?object} site the selected site, or null to hide the row.
     *  @returns {boolean} true when the row appeared, vanished or changed. */
    show(site) {
      const state = getState();
      const shown = !!state && !!site && site.owner === 'player';
      let wrote = open(shown) ? 1 : 0;
      if (!shown) return !!wrote;
      for (let i = 0; i < BUILDABLE_KINDS.length; i++) {
        const kind = BUILDABLE_KINDS[i];
        const offer = buildOffer(state, kind);
        const armed = view.armedBuild === kind;
        wrote |= label[i](offer.label);
        wrote |= armedSet[i](armed);
        if (can[i] !== offer.can) {
          can[i] = offer.can;
          buttons[i].disabled = !offer.can;
        }
        buttons[i].title = armed ? 'Click a hex to place it · Esc cancels' : offer.why;
      }
      return !!wrote;
    },
  };
}
