// The site panel: what the site you clicked is, and what you can do to it.
//
// IT LIVES ON THE BOARD, not in a corner. It used to be pinned to the bottom
// left, so clicking a fort on the right-hand edge of the map meant reading
// about it a whole battle away and then travelling back to press Upgrade. It
// now hangs off the site itself and follows the camera; battle-anchor.js owns
// the geometry that keeps it on screen, off the site it describes, and off the
// adjacent sites (which are drag targets — a covered neighbour is an order you
// cannot issue).
//
// Withdraw and the alert strip moved to battle-alert.js and are re-exported
// below, so nothing downstream has to care that they moved.
//
// HARD RULE, same as everywhere: nothing here mutates simulation state. The
// Upgrade button and the rally stepper append commands through `input`, exactly
// like a click on the board does.
import { SITE_UPGRADE, CENTIGOLD, RALLY_KEEP } from '../content/balance.js';
import { total } from '../battle/combat.js';
import { goldOf } from '../battle/economy.js';
import { rallyKeepOf } from '../battle/state.js';
import { TICK_HZ } from '../core/loop.js';
import { h, mount, bindText, bindClass } from '../ui/dom.js';
import { duration } from '../ui/format.js';
import { siteOf } from './battle-preview.js';
import { createFollower } from './battle-follow.js';
import {
  siteIntel, goldLine, trainLine, terrainLine, stepRallyKeep, keepLabel,
} from './battle-econ.js';

export { createWithdraw, createAlert } from './battle-alert.js';

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
  'bad-keep': 'A rally hold-back is a whole number of troops.',
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

/** The button's label for an offer, so the wording is testable too. The top
 *  level is READ OFF the tuning table rather than written into the string: the
 *  ladder has already been extended once, and a button that says "max" at a
 *  level you can still buy past is worse than no label. */
export function upgradeLabel(o) {
  if (o.why === 'max-level') return `Level ${SITE_UPGRADE.length + 1} · max`;
  return `Upgrade → L${o.level + 1} · ${o.cost}g · ${o.sec}s`;
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

/**
 * The selection panel. Opens for EVERY site — farms included, which previously
 * opened nothing at all — and carries the only route to in-battle levelling.
 *
 * @param {{getState:()=>object, view:object, input:object, board?:object}} o
 *   `board` is the battleView, used READ-ONLY for `siteScreen` and `camera` so
 *   the panel can sit on its site. Omit it and the panel still renders and
 *   still works — it just does not move.
 */
export function createSitePanel(o) {
  const { getState, view, input, board } = o;
  const targetId = () => (view.selection.length === 1 ? view.selection[0] : null);
  const title = h('div.hud-selection-title', { text: '' });
  const sub = h('div.hud-selection-sub', { text: '' });
  // What the site EARNS and SPENDS, straight from the sim's own economy and
  // training functions — see battle-econ.js for why it may not be re-derived.
  const money = h('div.hud-selection-sub.hud-site-money', { text: '' });
  const trains = h('div.hud-selection-sub.hud-site-train', { text: '' });
  // WHY a site is tough. Terrain the player cannot read is an invisible
  // difficulty dial, and this is the line that makes it visible.
  const terrain = h('div.hud-selection-sub.hud-site-terrain', { text: '' });
  const stat = h('div.hud-selection-sub.hud-site-stat', { text: '' });
  const upgrade = h('button.btn.hud-upgrade', {
    'data-interactive': true, type: 'button',
    on: { click: () => { const id = targetId(); if (id) input.upgrade(id); } },
  }, 'Upgrade');
  const keep = createKeepRow(getState, input, targetId);
  // `data-interactive` (see base.css) is what makes the panel a real surface.
  // #hud is pointer-events:none, and a panel that let clicks through would sit
  // over the board, take a click on its own text as a click on empty ground,
  // clear the selection — and vanish under the cursor that was reaching for it.
  const el = h('div.hud-selection.panel', { 'data-interactive': true },
    title, sub, money, trains, terrain, stat, keep.el, upgrade);
  const follower = createFollower(el, board, siteOf);
  let anchor = null;

  const set = {
    open: bindClass(el, 'is-open'),
    title: bindText(title, ''),
    sub: bindText(sub, ''),
    money: bindText(money, ''),
    trains: bindText(trains, ''),
    terrain: bindText(terrain, ''),
    stat: bindText(stat, ''),
    drain: bindClass(money, 'is-drain'),
    upLabel: bindText(upgrade, 'Upgrade'),
    upOff: bindClass(upgrade, 'is-disabled'),
  };
  let disabled = null;
  let shown = true;

  /** Native `disabled` is cached the same way class writes are: an unchanged
   *  value costs one comparison and no DOM work. */
  function setDisabled(on) {
    if (on === disabled) return;
    disabled = on;
    upgrade.disabled = on;
  }

  /** Detached rather than `hidden`, so no future stylesheet rule on the button
   *  can accidentally out-specify the UA's `[hidden] { display: none }`.
   *  @returns {boolean} true when the panel's height just changed. */
  function setShown(on) {
    if (on === shown) return false;
    shown = on;
    if (on) mount(el, upgrade);
    else upgrade.remove();
    return true;
  }

  /** Remember what the panel is hanging off, and forget which side it settled
   *  on whenever that changes — hysteresis from the previous site is worse than
   *  no hysteresis at all. */
  function setAnchor(site) {
    if (anchor?.id === site?.id) { anchor = site; return; }
    anchor = site;
    follower.reset();
  }

  function update(state) {
    // Nothing selected is the common case at 10Hz, so it costs one comparison.
    const squad = view.selectedSquad != null ? squadById(state, view.selectedSquad) : null;
    if (squad) { setShown(false); showSquad(state, squad); return; }

    const id = view.selection[0];
    const site = id ? siteOf(state, id) : null;
    setAnchor(site);
    set.open(!!site);
    if (!site) { setShown(false); keep.show(null); return; }

    // Every bind* returns whether it really touched the DOM, so `wrote` is a
    // free answer to "did the panel's box just change?". Bitwise, not `||`:
    // every writer has to run, and this allocates nothing.
    let wrote = 0;
    const n = view.selection.length;
    if (n > 1) {
      wrote |= set.title(`${n} sites selected`);
      wrote |= set.sub('R retreats · right-drag sets rally');
      wrote |= set.money('');
      wrote |= set.trains('');
      wrote |= set.terrain('');
      wrote |= set.stat('');
      setShown(false);
      keep.show(null);
      if (wrote) follower.markDirty();
      return;
    }

    const intel = siteIntel(state, site);
    wrote |= set.title(`${site.kind.toUpperCase()} · L${site.level}`);
    wrote |= set.sub(
      `${total(site.garrison)} troops · HP ${Math.round(site.hp)}/${Math.round(site.hpMax)}`);
    wrote |= set.money(goldLine(intel));
    set.drain(intel.net < 0);
    wrote |= set.trains(trainLine(intel));
    wrote |= set.terrain(terrainLine(intel));
    wrote |= set.stat(statusLine(site));
    // A hold-back only means anything where there is a rally to hold back from.
    wrote |= keep.show(site.owner === 'player' && site.rallyTarget ? site : null);

    const offer = upgradeOffer(state, site);
    wrote |= setShown(site.owner === 'player');
    wrote |= set.upLabel(upgradeLabel(offer));
    set.upOff(!offer.can);
    setDisabled(!offer.can);
    const why = offerTitle(offer);
    if (upgrade.title !== why) upgrade.title = why;
    if (wrote) follower.markDirty();
  }

  function showSquad(state, squad) {
    // A squad stores no position — the renderer derives one from `arriveTick`
    // — so the panel hangs off where the column is HEADED, which is the site
    // the player is actually watching.
    setAnchor(siteOf(state, squad.to));
    set.open(true);
    let wrote = 0;
    wrote |= set.title(`SQUAD · ${total(squad.comp)} troops`);
    wrote |= set.sub(`${squad.from} → ${squad.to}`);
    wrote |= set.money('');
    wrote |= set.trains('');
    wrote |= set.terrain('');
    wrote |= set.stat(squad.retreating
      ? 'retreating'
      : `arrives in ${duration(Math.max(0, squad.arriveTick - state.tick) / TICK_HZ)} · R retreats`);
    wrote |= keep.show(null);
    if (wrote) follower.markDirty();
  }

  return {
    el,
    update,
    /**
     * Re-anchor. Called EVERY FRAME by the HUD rather than on the 10Hz text
     * refresh: a panel that only catches up ten times a second visibly lags
     * behind the map while you are panning, which is exactly the "stranded in
     * the corner" feeling this whole change is about.
     * @param {object} state @param {number} now ms @param {object} [insets]
     */
    follow(state, now, insets) {
      if (anchor) follower.place(state, anchor, view, now, insets);
    },
    get side() { return follower.side; },
  };
}

/**
 * The per-site rally hold-back: how many troops a rallied site keeps at home
 * before forwarding the rest. A back-line farm should keep almost nothing; a
 * front stronghold feeding a siege has to hold enough to survive the
 * counter-attack, and one global number cannot be both.
 *
 * The buttons append a RALLY_KEEP command through `input` — nothing here writes
 * to the site. The value shown is read back off the simulation, so a rejected
 * order visibly does nothing rather than leaving the control lying.
 */
function createKeepRow(getState, input, targetId) {
  const value = h('span.keep-value.num', { text: '' });
  const step = (dir, glyph) => h('button.btn.ghost.keep-step', {
    'data-interactive': true, type: 'button',
    title: dir < 0 ? 'Forward more of this garrison' : 'Hold more of this garrison back',
    'aria-label': dir < 0 ? 'Keep fewer troops at home' : 'Keep more troops at home',
    on: { click: () => pressKeep(getState(), targetId(), dir, input) },
  }, glyph);
  const down = step(-1, '−');
  const up = step(1, '+');
  const el = h('div.hud-keep', {}, h('span.keep-label', { text: 'Rally' }), down, value, up);

  const set = { value: bindText(value, ''), open: bindClass(el, 'is-open') };
  let lo = null;
  let hi = null;

  return {
    el,
    /** @param {?object} site the selected site, or null to hide the row.
     *  @returns {boolean} true when the row appeared, vanished or changed. */
    show(site) {
      let wrote = set.open(!!site) ? 1 : 0;
      if (!site) return !!wrote;
      const n = rallyKeepOf(site);
      wrote |= set.value(keepLabel(site));
      if (lo !== (n <= RALLY_KEEP.min)) { lo = n <= RALLY_KEEP.min; down.disabled = lo; }
      if (hi !== (n >= RALLY_KEEP.max)) { hi = n >= RALLY_KEEP.max; up.disabled = hi; }
      return !!wrote;
    },
  };
}

/**
 * What a hold-back stepper does when pressed: read the site back off the
 * SIMULATION, work out the next legal value, and append exactly one order.
 * Nothing here writes to the site — a rejected order therefore makes the
 * control visibly do nothing rather than leave it lying about the state.
 *
 * Exported because a button whose handler is untestable is how a dead control
 * ships green: a test can press this without a DOM and still travel the whole
 * real path into `state.commands[]`.
 * @returns {boolean} true when an order was queued.
 */
export function pressKeep(state, siteId, dir, input) {
  const site = siteId ? siteOf(state, siteId) : null;
  if (!site) return false;
  input.setRallyKeep(site.id, stepRallyKeep(site, dir));
  return true;
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
