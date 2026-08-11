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
import { total } from '../battle/combat.js';
import { rallyKeepOf, rallyTargetsOf, upgradeProgress } from '../battle/state.js';
import { TICK_HZ } from '../core/loop.js';
import { h, mount, bindText, bindClass } from '../ui/dom.js';
import { duration } from '../ui/format.js';
import { siteOf } from './battle-preview.js';
import { createFollower } from './battle-follow.js';
import { createFillBar, createCompBar } from './battle-bars.js';
import {
  updateTerrainBubbles, updateEconBubbles, updateUnitStatBubbles,
  updateUpgradePreviewBubbles, clearBubbles,
} from './battle-bubbles.js';
import {
  siteIntel, trainLine, gateLine, upgradePreview,
} from './battle-econ.js';
import { REJECTIONS, rejectionText, upgradeOffer, upgradeLabel } from './battle-upgrade.js';
import { createKeepRow, createRecruitRow } from './battle-actions.js';
// Re-exported so nothing downstream has to know the actions group moved out.
export { setKeep, recruit, recruitOffer } from './battle-actions.js';

export { createWithdraw, createAlert } from './battle-alert.js';
export { REJECTIONS, rejectionText, upgradeOffer, upgradeLabel } from './battle-upgrade.js';

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

/**
 * The selection panel. Opens for EVERY site — farms included, which previously
 * opened nothing at all — and carries the only route to in-battle levelling.
 *
 * @param {{getState:()=>object, view:object, input:object, board?:object,
 *          tip?:object}} o
 *   `board` is the battleView, used READ-ONLY for `siteScreen` and `camera` so
 *   the panel can sit on its site. Omit it and the panel still renders and
 *   still works — it just does not move. `tip` is the shared unit hover card
 *   (battle-tip.js) the troop composition bar attaches to; also optional.
 */
export function createSitePanel(o) {
  const { getState, view, input, board, tip } = o;
  const targetId = () => (view.selection.length === 1 ? view.selection[0] : null);
  const title = h('div.hud-selection-title', { text: '' });
  const sub = h('div.hud-selection-sub', { text: '' });
  // HP and troop composition as BARS rather than a plain "N troops · HP x/y"
  // line — see battle-bars.js. Fractions come straight off site.hp/hpMax and
  // site.garrison; nothing here re-derives them.
  const hpBar = createFillBar('bar-hp');
  const compBar = createCompBar(tip);
  // What the site EARNS and SPENDS, straight from the sim's own economy and
  // training functions — see battle-econ.js for why it may not be re-derived.
  // A row of bubbles now, not a sentence — see battle-bubbles.js.
  const money = h('div.hud-site-money.bubbles', {});
  const trains = h('div.hud-selection-sub.hud-site-train', { text: '' });
  // The "moving bar that shows when the troop is going to be trained" —
  // site.trainProgress read directly, never re-derived (see battle-bars.js).
  const trainBar = createFillBar('bar-train');
  const trainStats = h('div.hud-site-unit-stats.bubbles', {});
  // The build timer, as a BAR rather than the "building · 12s left" line it
  // replaces. A countdown is a number you have to read twice to know whether it
  // is nearly done; a fill answers that at a glance, which is the same argument
  // the HP and training bars already won. `upgradeProgress` is the sim's, not
  // this file's — see battle-bars.js's header on why a fraction is never
  // computed here.
  const buildBar = createFillBar('bar-build');
  // WHY a site is tough. Terrain the player cannot read is an invisible
  // difficulty dial, and this row is what makes it visible.
  const terrain = h('div.hud-site-terrain.bubbles', {});
  const stat = h('div.hud-selection-sub.hud-site-stat', { text: '' });
  // "What upgrading gives you" — bubbles read straight off upgradePreview(),
  // sitting directly above the button they explain (see battle-econ.js/
  // battle-bubbles.js for why every number here is real, never fabricated).
  const upgradePreviewRow = h('div.hud-upgrade-preview.bubbles', {});
  const upgrade = h('button.btn.hud-upgrade', {
    'data-interactive': true, type: 'button',
    on: { click: () => { const id = targetId(); if (id) input.upgrade(id); } },
  }, 'Upgrade');
  const keep = createKeepRow(getState, input, targetId);
  const hire = createRecruitRow(getState, input, targetId);
  // Four visual groups, so the eye chunks "what this site IS" (head) from
  // "what it's WORTH" (econ) from "why it's hard / what's happening to it"
  // (context) from "what you can do about it" (actions) instead of scanning
  // one flat stack of same-size lines. Each group vanishes on its own — see
  // the `:has()` rules in screens.css — when it would otherwise have carried
  // only empty lines, so a farm with nothing to say about terrain shows no
  // stray divider either.
  const head = h('div.hud-site-head', {}, title, sub, hpBar.el, compBar.el);
  const econ = h('div.hud-site-econ', {}, money, trains, trainBar.el, trainStats);
  const context = h('div.hud-site-context', {}, terrain, buildBar.el, stat);
  const actions = h('div.hud-site-actions', {}, keep.el, hire.el, upgradePreviewRow, upgrade);
  // `data-interactive` (see base.css) is what makes the panel a real surface.
  // #hud is pointer-events:none, and a panel that let clicks through would sit
  // over the board, take a click on its own text as a click on empty ground,
  // clear the selection — and vanish under the cursor that was reaching for it.
  const el = h('div.hud-selection.panel', { 'data-interactive': true },
    head, econ, context, actions);
  const follower = createFollower(el, board, siteOf);
  let anchor = null;

  const set = {
    open: bindClass(el, 'is-open'),
    // The WHOLE panel reads danger under a hostile siege, not just one line —
    // see screens.css `.hud-selection.is-siege`.
    siege: bindClass(el, 'is-siege'),
    title: bindText(title, ''),
    sub: bindText(sub, ''),
    trains: bindText(trains, ''),
    stat: bindText(stat, ''),
    drain: bindClass(money, 'is-drain'),
    // A site actively under siege is the one status worth interrupting a calm
    // scan for — same idea as the rejection shake, applied to typography
    // instead of motion.
    statWarn: bindClass(stat, 'is-warn'),
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
   *  Mounted into the actions group, alongside the rally stepper, rather than
   *  onto the panel directly — one group for every control the player can
   *  actually press.
   *  @returns {boolean} true when the panel's height just changed. */
  function setShown(on) {
    if (on === shown) return false;
    shown = on;
    if (on) mount(actions, upgrade);
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

  /** Nothing to fill the bars/bubbles with — multi-select, the squad view,
   *  and no selection at all all share this. */
  function blankVitals() {
    let wrote = 0;
    wrote |= hpBar.show(false);
    wrote |= compBar.show(false);
    wrote |= trainBar.show(false);
    wrote |= buildBar.show(false);
    wrote |= clearBubbles(money, terrain, trainStats, upgradePreviewRow) ? 1 : 0;
    return wrote;
  }

  function update(state) {
    // Nothing selected is the common case at 10Hz, so it costs one comparison.
    const squad = view.selectedSquad != null ? squadById(state, view.selectedSquad) : null;
    if (squad) { setShown(false); showSquad(state, squad); return; }

    const id = view.selection[0];
    const site = id ? siteOf(state, id) : null;
    setAnchor(site);
    set.open(!!site);
    if (!site) {
      setShown(false); keep.show(null); hire.show(null);
      blankVitals(); set.siege(false); return;
    }

    // Every bind* returns whether it really touched the DOM, so `wrote` is a
    // free answer to "did the panel's box just change?". Bitwise, not `||`:
    // every writer has to run, and this allocates nothing.
    let wrote = 0;
    const n = view.selection.length;
    if (n > 1) {
      wrote |= set.title(`${n} sites selected`);
      wrote |= set.sub('R retreats · right-drag sets rally');
      wrote |= blankVitals();
      wrote |= set.trains('');
      wrote |= set.stat('');
      set.statWarn(false);
      set.siege(false);
      setShown(false);
      keep.show(null);
      hire.show(null);
      if (wrote) follower.markDirty();
      return;
    }

    const intel = siteIntel(state, site);
    // The same condition statusLine() already used to say "UNDER SIEGE" —
    // escalated here into the whole panel's chrome instead of one line.
    const hostile = !!(site.siege || intel?.gate?.sealed);
    wrote |= set.title(`${site.kind.toUpperCase()} · L${site.level}`);
    wrote |= set.sub('');

    // Bar fills never change the panel's own BOX size (fixed height, content
    // sized elsewhere), so only `.show()` — which toggles display:none — ever
    // needs to feed `wrote`; a fill sliding does not have to re-anchor the
    // panel.
    const hpFrac = site.hpMax > 0 ? site.hp / site.hpMax : 0;
    hpBar.color(hpColor(site, hpFrac));
    hpBar.update(hpFrac, `${Math.round(site.hp)}/${Math.round(site.hpMax)}`);
    wrote |= hpBar.show(true);
    compBar.update(site.garrison, intel.held);
    wrote |= compBar.show(true);

    wrote |= updateEconBubbles(money, intel);
    set.drain(intel.net < 0);
    wrote |= set.trains(trainLine(intel));
    // "Currently training" for the stat bubbles below: intel.unit is set even
    // while blocked (FULL) or halted (brownout) — the stats of what is QUEUED,
    // not only what is actively advancing.
    const training = intel.trains && !!intel.unit;
    if (training) {
      trainBar.color((site.brownout ?? 1) < 1 ? 'var(--c-warn)' : 'var(--c-accent)');
      trainBar.update(Math.max(0, Math.min(1, site.trainProgress || 0)), '');
    }
    wrote |= trainBar.show(training);
    wrote |= updateUnitStatBubbles(trainStats, training ? intel.unit : null);

    wrote |= updateTerrainBubbles(terrain, intel);
    // The bar carries the build now, which also un-masks the status line: a site
    // besieged WHILE it builds used to report "building · 12s left" and never
    // once say UNDER SIEGE, because the build branch returned first.
    const building = site.upgradeTicksLeft > 0;
    if (building) {
      buildBar.update(upgradeProgress(site),
        `L${site.level} · ${duration(site.upgradeTicksLeft / TICK_HZ)}`);
    }
    wrote |= buildBar.show(building);
    wrote |= set.stat(statusLine(site, intel));
    set.statWarn(hostile);
    set.siege(hostile);
    // A hold-back only means anything where there is a rally to hold back from.
    wrote |= keep.show(site.owner === 'player' && rallyTargetsOf(site).length ? site : null);
    wrote |= hire.show(site);

    const offer = upgradeOffer(state, site);
    wrote |= setShown(site.owner === 'player');
    wrote |= updateUpgradePreviewBubbles(upgradePreviewRow,
      site.owner === 'player' ? upgradePreview(site) : null);
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
    wrote |= blankVitals();
    wrote |= set.trains('');
    wrote |= set.stat(squad.retreating
      ? 'retreating'
      : `arrives in ${duration(Math.max(0, squad.arriveTick - state.tick) / TICK_HZ)} · R retreats`);
    set.statWarn(false);
    set.siege(false);
    wrote |= keep.show(null);
    wrote |= hire.show(null);
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


function squadById(state, id) {
  for (let i = 0; i < state.squads.length; i++) {
    if (state.squads[i].id === id) return state.squads[i];
  }
  return null;
}

/**
 * The HP bar's fill colour: the owning faction's own hue at full health — the
 * same signal `p.owner[site.owner]` gives the on-canvas HP ring (siteGlyphs.js
 * `drawHpRing`) — and, under an active siege, the SAME danger/warn split that
 * ring already uses (`frac < 0.35 ? danger : warn`), so a wall reads as
 * draining identically on the board and in the panel.
 */
function hpColor(site, frac) {
  if (site.siege) return frac < 0.35 ? 'var(--c-danger)' : 'var(--c-warn)';
  return `var(--c-${site.owner})`;
}

function statusLine(site, intel) {
  if (intel?.gate?.sealed) return `UNDER SIEGE · ${gateLine(intel)}`;
  if (site.siege) return 'UNDER SIEGE';
  if (site.shieldTicks > 0) return 'fortified';
  // One site may feed several neighbours in turn, so the status names all of
  // them — "rallying → a" when a two-way split is live would be a lie.
  const rally = rallyTargetsOf(site);
  if (rally.length) return `rallying → ${rally.join(' · ')}`;
  return '';
}

function offerTitle(o) {
  if (o.can) return `Spend ${o.cost} gold · ${o.sec}s to build`;
  return REJECTIONS[o.why] || 'Cannot upgrade';
}
