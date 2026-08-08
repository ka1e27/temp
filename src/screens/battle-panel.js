// Site panel, withdraw control, and command-rejection feedback.
//
// Three pieces of HUD that had no home before: every site (farms included) now
// opens a panel with garrison, HP, level and a working Upgrade action; the
// player can leave a region they are losing; and an order the simulation throws
// away finally says so out loud instead of failing silently.
//
// HARD RULE, same as everywhere: nothing here mutates simulation state. The
// Upgrade and Withdraw buttons append commands through `input`, exactly like a
// click on the board does.
import { SITE_UPGRADE, CENTIGOLD } from '../content/balance.js';
import { total } from '../battle/combat.js';
import { goldOf } from '../battle/economy.js';
import { TICK_HZ } from '../core/loop.js';
import { h, mount, bindText, bindClass } from '../ui/dom.js';
import { duration } from '../ui/format.js';
import { siteOf } from './battle-preview.js';

/**
 * Player-facing text for every reason battle/commands.js can reject an order
 * with. A rejection the player cannot see is the same as no feedback at all —
 * that is how three boosters shipped unreachable and nobody noticed.
 * PURE DATA.
 */
export const REJECTIONS = Object.freeze({
  'unknown-site': 'That site is gone.',
  'not-your-site': 'You do not hold that site.',
  'not-adjacent': 'Sends only reach adjacent sites.',
  'bad-fraction': 'Nothing selected to send.',
  'empty-send': 'That garrison is empty — nothing to send.',
  'site-cannot-train': 'Farms cannot train troops.',
  'unknown-unit': 'No such unit.',
  'unit-locked': 'That unit is not unlocked yet.',
  'already-upgrading': 'That site is already building.',
  'max-level': 'Already at level 3.',
  'insufficient-gold': 'Not enough gold.',
  'unknown-target': 'No such rally target.',
  'nowhere-to-retreat': 'Nowhere to retreat to.',
  'nothing-to-retreat': 'Nothing there to retreat.',
  'unknown-squad': 'That squad has already arrived.',
  'not-your-squad': 'That is not your squad.',
  'already-retreating': 'That squad is already retreating.',
  'not-your-battle': 'Only you can withdraw.',
  'boosters-are-the-players': 'Boosters are yours alone.',
  'booster-unavailable': 'You did not bring that booster.',
  'no-charges': 'No charges left.',
  'unknown-booster': 'No such booster.',
  'needs-target': 'Pick a site for that booster.',
  'no-sources': 'No nearby garrison to rally.',
  'nothing-in-flight': 'No squads are marching.',
  'not-a-target': 'Bombard an enemy or neutral site.',
  malformed: 'That order made no sense.',
  'unknown-command': 'That order made no sense.',
});

/** @param {{reason?:string, cmd?:object}} ev @returns {string} */
export function rejectionText(ev) {
  const reason = ev?.reason ?? '';
  const said = REJECTIONS[reason] || `Order refused (${reason || 'unknown'}).`;
  const id = ev?.cmd?.id;
  return id && reason !== 'needs-target' ? `${id.toUpperCase()}: ${said}` : said;
}

/**
 * What the Upgrade action can offer for one site right now.
 * PURE — the whole affordability gate is testable without a DOM.
 * @returns {{level:number, cost:number, sec:number, can:boolean, why:string}}
 */
export function upgradeOffer(state, site) {
  const out = { level: site.level, cost: 0, sec: 0, can: false, why: '' };
  const spec = SITE_UPGRADE[site.level - 1];
  if (!spec) { out.why = 'max-level'; return out; }
  out.cost = spec.gold;
  out.sec = spec.sec;
  if (site.owner !== 'player') { out.why = 'not-your-site'; return out; }
  if (site.upgradeTicksLeft > 0) { out.why = 'already-upgrading'; return out; }
  if (goldOf(state.factions.player) < spec.gold * CENTIGOLD) {
    out.why = 'insufficient-gold';
    return out;
  }
  out.can = true;
  return out;
}

/** The button's label for an offer, so the wording is testable too. */
export function upgradeLabel(o) {
  if (o.why === 'max-level') return 'Level 3 · max';
  return `Upgrade → L${o.level + 1} · ${o.cost}g · ${o.sec}s`;
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

/**
 * The selection panel. Opens for EVERY site — farms included, which previously
 * opened nothing at all — and carries the only route to in-battle levelling.
 * @param {{getState:()=>object, view:object, input:object}} o
 */
export function createSitePanel(o) {
  const { getState, view, input } = o;
  const title = h('div.hud-selection-title', { text: '' });
  const sub = h('div.hud-selection-sub', { text: '' });
  const stat = h('div.hud-selection-sub.hud-site-stat', { text: '' });
  const upgrade = h('button.btn.hud-upgrade', {
    'data-interactive': true, type: 'button',
    on: { click: () => { const id = targetId(); if (id) input.upgrade(id); } },
  }, 'Upgrade');
  const el = h('div.hud-selection.panel', {}, title, sub, stat, upgrade);

  const set = {
    open: bindClass(el, 'is-open'),
    title: bindText(title, ''),
    sub: bindText(sub, ''),
    stat: bindText(stat, ''),
    upLabel: bindText(upgrade, 'Upgrade'),
    upOff: bindClass(upgrade, 'is-disabled'),
  };
  let disabled = null;
  let shown = true;

  const targetId = () => (view.selection.length === 1 ? view.selection[0] : null);

  /** Native `disabled` is cached the same way class writes are: an unchanged
   *  value costs one comparison and no DOM work. */
  function setDisabled(on) {
    if (on === disabled) return;
    disabled = on;
    upgrade.disabled = on;
  }

  /** Detached rather than `hidden`, so no future stylesheet rule on the button
   *  can accidentally out-specify the UA's `[hidden] { display: none }`. */
  function setShown(on) {
    if (on === shown) return;
    shown = on;
    if (on) mount(el, upgrade);
    else upgrade.remove();
  }

  function update(state) {
    // Nothing selected is the common case at 10Hz, so it costs one comparison.
    const squad = view.selectedSquad != null ? squadById(state, view.selectedSquad) : null;
    if (squad) { setShown(false); showSquad(state, squad); return; }

    const id = view.selection[0];
    const site = id ? siteOf(state, id) : null;
    set.open(!!site);
    if (!site) { setShown(false); return; }

    const n = view.selection.length;
    if (n > 1) {
      set.title(`${n} sites selected`);
      set.sub('R retreats · right-drag sets rally');
      set.stat('');
      setShown(false);
      return;
    }

    set.title(`${site.kind.toUpperCase()} · L${site.level}`);
    set.sub(`${total(site.garrison)} troops · HP ${Math.round(site.hp)}/${Math.round(site.hpMax)}`);
    set.stat(statusLine(site));

    const offer = upgradeOffer(state, site);
    setShown(site.owner === 'player');
    set.upLabel(upgradeLabel(offer));
    set.upOff(!offer.can);
    setDisabled(!offer.can);
    const why = offerTitle(offer);
    if (upgrade.title !== why) upgrade.title = why;
  }

  function showSquad(state, squad) {
    set.open(true);
    set.title(`SQUAD · ${total(squad.comp)} troops`);
    set.sub(`${squad.from} → ${squad.to}`);
    set.stat(squad.retreating
      ? 'retreating'
      : `arrives in ${duration(Math.max(0, squad.arriveTick - state.tick) / TICK_HZ)} · R retreats`);
  }

  return { el, update };
}

function squadById(state, id) {
  for (let i = 0; i < state.squads.length; i++) {
    if (state.squads[i].id === id) return state.squads[i];
  }
  return null;
}

function statusLine(site) {
  if (site.upgradeTicksLeft > 0) {
    return `building · ${duration(site.upgradeTicksLeft / TICK_HZ)} left`;
  }
  if (site.siege) return 'UNDER SIEGE';
  if (site.shieldTicks > 0) return 'fortified';
  if (site.rallyTarget) return `rallying → ${site.rallyTarget}`;
  return '';
}

function offerTitle(o) {
  if (o.can) return `Spend ${o.cost} gold · ${o.sec}s to build`;
  return REJECTIONS[o.why] || 'Cannot upgrade';
}

/**
 * Withdraw. Confirm-style rather than a plain button: ending a run on one
 * stray click is the kind of thing you only regret once, which is also why
 * battle-input.js keeps it off every key.
 * @param {{input:object, holdMs?:number}} o
 */
export function createWithdraw(o) {
  const { input, holdMs = 4000 } = o;
  let armedAt = 0;
  const el = h('button.btn.ghost.hud-withdraw', {
    'data-interactive': true, type: 'button', title: 'Leave the region unconquered',
    on: {
      click: () => {
        const now = Date.now();
        if (armedAt && now - armedAt < holdMs) { armedAt = 0; sync(0); input.withdraw(); return; }
        armedAt = now;
        sync(now);
      },
    },
  }, 'Withdraw');

  const set = { text: bindText(el, 'Withdraw'), armed: bindClass(el, 'is-confirming') };
  const sync = (at) => { set.text(at ? 'Confirm withdraw' : 'Withdraw'); set.armed(!!at); };

  return {
    el,
    /** Called from the HUD's 10Hz refresh; disarms itself so a forgotten click
     *  never turns into a withdrawal minutes later. */
    update(now) {
      if (armedAt && now - armedAt >= holdMs) { armedAt = 0; sync(0); }
    },
    get isArmed() { return armedAt !== 0; },
  };
}

/**
 * One-line inline message: rejections, and what an armed booster is waiting
 * for. Empty text renders nothing at all, so it costs no space when silent.
 * @param {{ttlMs?:number}} [o]
 */
export function createAlert(o = {}) {
  const ttl = o.ttlMs ?? 2600;
  const el = h('div.hud-alert', { role: 'status', 'aria-live': 'polite', text: '' });
  const set = { text: bindText(el, ''), open: bindClass(el, 'is-open') };
  let until = 0;
  let sticky = '';

  return {
    el,
    /** Transient message; replaces whatever is showing. */
    show(text, now) {
      until = now + ttl;
      set.text(text);
      set.open(true);
    },
    /** Persistent message (armed booster). Restored when a flash expires. */
    hold(text) {
      sticky = text || '';
      if (!until) { set.text(sticky); set.open(!!sticky); }
    },
    update(now) {
      if (until && now >= until) {
        until = 0;
        set.text(sticky);
        set.open(!!sticky);
      }
    },
  };
}
