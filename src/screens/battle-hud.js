// The in-battle HUD: DOM, not canvas.
//
// The outcome preview is the design's load-bearing promise, and it lives in
// battle-preview.js as pure functions this file merely renders. Everything
// re-exported below is that module — the import path is kept so nothing
// downstream has to care where the maths moved to.
//
// Refreshes on a 10Hz throttle, never per frame: the HUD is text, and text
// that rewrites at 60Hz is pure cost. Every writer is a cached bind*, so an
// unchanged value costs one comparison and no DOM work, and nothing in this
// file allocates per refresh.
import { UNIT_IDS, SITES, SEND_FRACTIONS, BOOSTERS } from '../content/balance.js';
import { UNITS_UI } from '../content/strings.js';
import { TICK_HZ } from '../core/loop.js';
import { h, mount, clear, bindText, bindClass, bindStyle, createDisposer } from '../ui/dom.js';
import { compact, clock, percent, rate } from '../ui/format.js';
import { BOOSTER_KEYS, FILTER_KEYS, filterUnits, needsTarget } from './battle-keys.js';
import { siteOf } from './battle-preview.js';
import { sitesOwned } from '../battle/siteinfo.js';
import { goldFlow, flowLine } from './battle-econ.js';
import {
  createSitePanel, createWithdraw, createAlert, createBuildRail, wireAlerts,
} from './battle-panel.js';
import { createUnitTip } from './battle-tip.js';
import { createHudInsets } from './battle-insets.js';
import { createSpeedControl } from './battle-speed.js';
import {
  buildTrainPicker, updatePreview, placeFan, placeRails, buildReadouts,
  trainFanUnits,
} from './battle-parts.js';
// `updateTrain` indexes the chips against the SAME list they were built from,
// so this stays here even though the fan itself moved.

export {
  computePreview, previewLine, projectGarrison, travelSecondsFor,
} from './battle-preview.js';

const AIMING = (id) => `AIMING ${id.toUpperCase()} — click a site · Esc cancels`;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * @param {{root:HTMLElement, getState:()=>object, view:object, input:object,
 *          board:object, bus?:object, onSetSpeed?:(n:number)=>void,
 *          travelSeconds?:Function}} o
 *   `onSetSpeed(multiplier)` is the ONLY way this file can touch the clock:
 *   0 pauses, 0.35 is slow motion, 1/2/4 are the segmented speeds.
 */
export function createBattleHud(o) {
  const { root, getState, view, input, board, bus } = o;
  const off = createDisposer();
  const el = {};
  const set = {};
  let last = -1e9;
  let shakeUntil = 0;
  let shaken = -1;

  const boosterIds = Object.keys(BOOSTERS);
  const strength = SEND_FRACTIONS.map((f, i) =>
    h('button.seg', {
      text: percent(f), 'data-interactive': true, type: 'button',
      title: `Each order sends ${percent(f)} of the garrison — key ${i + 1}`,
      'aria-label': `Send ${percent(f)} of a garrison per order`,
      on: { click: () => input.setFraction(f) },
    }));
  /**
   * WHAT A DRAG MEANS. Two segments, because a rally had exactly one input and
   * it was a RIGHT-drag — which does not exist on a phone at all, and on a
   * trackpad is a two-finger click held and dragged, which most trackpads will
   * not reliably report. The two-finger-tap fallback in battle-input.js only
   * ever covered the click form, never the drag, so the chained rally and the
   * toggle were unreachable on both of the devices this is actually played on.
   *
   * A MODE rather than a one-shot arm: setting a rally network is several
   * gestures in a row. It is loud about being on — the segment lights, and the
   * board's drag line goes dashed — because a mode that silently turns your
   * attacks into standing orders would be the worst possible bug to ship here.
   * Right-drag still works and is unchanged.
   */
  const dragMode = [
    ['send', 'Send', 'A drag sends troops now'],
    ['rally', 'Rally', 'A drag sets a standing rally instead of sending'],
  ].map(([id, label, title]) =>
    h('button.seg.hud-dragmode', {
      text: label, 'data-interactive': true, type: 'button', 'data-mode': id,
      title, 'aria-label': title,
      on: { click: () => input.setRallyMode(id === 'rally') },
    }));

  // FULL NAMES, never `MIL`/`SPE`/`RAI`. The three-letter stubs were unreadable
  // to anyone who had not already learned the roster, and the hover card is
  // where that roster is now taught — see battle-tip.js.
  const tip = createUnitTip({ root });
  // ONLY THE TROOPS THIS EXPEDITION BROUGHT. It was `UNIT_IDS` — all nine —
  // against a five-type loadout cap, so the campaign opener drew seven chips
  // that filtered a troop the army cannot contain and cannot train (`cmdTrain`
  // answers `unit-locked` on the same field). They toggled, they lit up, and
  // they changed nothing. Fixed at the LIST rather than by disabling them,
  // because a permanently dead control is worse on the rail than absent: on a
  // phone the rail is a scrolling column, and seven of its nine entries were
  // there to be scrolled past.
  const railUnits = filterUnits(getState());
  const chips = railUnits.map((u) =>
    h('button.chip', {
      'data-interactive': true, type: 'button', vars: { '--chip': `var(--c-${u})` },
      'aria-label': `${UNITS_UI[u].name} — ${UNITS_UI[u].role}. `
        + `Include them when sending troops. Key ${FILTER_KEYS[u]}`,
      on: { click: () => input.toggleFilter(u) },
    }, h('span.chip-name', { text: UNITS_UI[u].name }),
    h('span.chip-key', { text: FILTER_KEYS[u] })));
  for (let i = 0; i < chips.length; i++) {
    tip.attach(chips[i], railUnits[i], `Key ${FILTER_KEYS[railUnits[i]]} · include in every order`);
  }
  const boosters = boosterIds.map((id) =>
    h('button.booster', {
      'data-interactive': true, type: 'button', 'aria-pressed': 'false',
      title: needsTarget(id)
        ? `${id} — key ${BOOSTER_KEYS[id]}, then click a site`
        : `${id} — key ${BOOSTER_KEYS[id]}`,
      on: { click: () => input.useBooster(id) },
    },
    h('span.booster-key', { text: BOOSTER_KEYS[id] }),
    h('span.booster-charges', { text: '0' }),
    h('span.booster-name', { text: id }),
    h('span.booster-cd')));

  const speed = createSpeedControl({
    bus, onSetSpeed: o.onSetSpeed, initialSpeed: o.initialSpeed,
  });
  // `board` is what lets the panel sit on the site it describes. Read-only.
  // `tip` (built above) is the hover card the composition bar's segments
  // attach to.
  const site = createSitePanel({ getState, view, input, board, tip });
  const withdraw = createWithdraw({ input });
  const alert = createAlert();
  // ALWAYS visible, like the troop-type and booster rails it now sits beside
  // — arming a build never read the selected site, so it no longer lives in
  // the panel that follows one. See battle-actions.js `createBuildRail`.
  const buildRail = createBuildRail(getState, input, view);

  buildReadouts(el);
  el.train = h('div.hud-train');
  el.alert = alert.el;
  el.selection = site.el;
  el.withdraw = withdraw.el;

  el.tl = h('div.hud-corner.hud-tl', {},
    h('div.hud-gold.panel', {}, el.gold, el.rate, el.flow),
    h('div.hud-objective', { text: 'Take the Castle. Don’t lose the Camp.' }),
    alert.el);
  el.tr = h('div.hud-corner.hud-tr', {}, el.clockBox, withdraw.el, withdraw.hint);
  // Each card is a header row (the label, full width, ruled off) over a
  // CONTROLS row. Two real rows, not one flex row with the label faked into
  // its own line via flex-basis — that trick fooled the browser's own
  // max-content sizing (used because the dock sizes itself to its content)
  // into measuring the label as if it could grow arbitrarily wide, which
  // quietly inflated every card by 30-40% and pushed the dock into wrapping a
  // full viewport step earlier than intended.
  // FOUR CARDS ALONG THE BOTTOM WAS TOO MANY, and the two that moved are the
  // two you touch least often: the troop filter is a standing preference you
  // set once, and a booster is fired a handful of times a battle. What is left
  // at the bottom is what you change constantly — how much of a garrison an
  // order sends, what a drag means, and how fast the battle runs.
  //
  // The rail is a COLUMN down the left, which costs board width rather than
  // board height. That is the right trade on both screens this has to work on:
  // a phone is tall and narrow, and a laptop is wide and short.
  el.dock = h('div.hud-dock', {},
    h('div.hud-group.panel', {}, h('span.hud-group-label', { text: '% of garrison' }),
      h('div.hud-group-row', {}, ...strength)),
    h('div.hud-group.panel', {}, h('span.hud-group-label', { text: 'Drag does' }),
      h('div.hud-group-row', {}, ...dragMode)),
    speed.el);
  // ONE RAIL PER SIDE, because both together do not fit in one column: eight
  // named troop chips and five boosters stack to about 700px and a 760px
  // viewport has roughly 500 to give once the readouts and the dock have taken
  // theirs. Splitting them also puts each next to the corner it belongs with —
  // the filter beside the treasury you spend, the boosters beside the clock
  // they are raced against.
  el.rail = h('div.hud-rail', {},
    h('div.hud-group.panel', {}, h('span.hud-group-label', { text: 'Troop types' }),
      h('div.hud-group-row', {}, ...chips)));
  el.railRight = h('div.hud-rail.hud-rail-right', {},
    h('div.hud-group.panel', {}, h('span.hud-group-label', { text: 'Boosters' }),
      h('div.hud-group-row', {}, ...boosters)));
  // A THIRD rail, stacked under Boosters rather than reparented on its own —
  // see placeRails's own comment on why the build rail rides in the right
  // corner. Built by battle-actions.js `createBuildRail`, same as the site
  // panel used to, but no longer anything the panel owns.
  el.railBuild = buildRail.el;
  // MOUNTED INSIDE THE CORNERS, not as free-floating siblings. As a sibling the
  // rail was centred on the viewport and promptly sat on top of the gold
  // readout while its own bottom card ran off under the dock — a tall column and
  // a top-anchored stack both laying claim to the same edge with nothing
  // arbitrating. Inside a corner they are one flow: the rail starts where the
  // readouts end, and the corner's height cap makes it scroll rather than
  // collide with the dock.
  mount(root, el.tl, el.tr, el.dock, site.el, el.preview, el.train);

  /**
   * WHERE THE RAILS LIVE DEPENDS ON THE SHAPE OF THE SCREEN, and this is a
   * reparent rather than a CSS rule because CSS cannot move a node.
   *
   * On a desktop the sides are the free space: the board is wide, the corners
   * are short, and a column costs width nobody was using. On a phone the sides
   * are the ONLY space — measured at 390x844, two vertical rails covered both
   * flanks and squeezed the board into a strip down the middle, which is the
   * same disease as the four-card dock, just rotated. There the rails go back
   * into the dock, which is already one horizontally scrolling row.
   *
   * `display: contents` on a docked rail (see hud.responsive.css) makes its
   * cards direct flex items of the dock, so they scroll with everything else
   * instead of being a box inside a box.
   */
  off(placeRails({
    tl: el.tl, tr: el.tr, dock: el.dock, rail: el.rail, right: el.railRight, build: el.railBuild,
  }));

  // Where the HUD's own furniture is, so the anchored site panel can stay off
  // it. The two rails live INSIDE the corner plates, so they are covered by the
  // same two rectangles and there is nothing extra to register — which is the
  // second reason they are mounted there. Measured rarely — see
  // battle-insets.js.
  const insets = createHudInsets({ dock: el.dock, plates: [el.tl, el.tr] });

  // Cached writers: an unchanged value costs one comparison and no DOM work.
  set.gold = bindText(el.gold, '0');
  set.rate = bindText(el.rate, '');
  set.flow = bindText(el.flow, '');
  set.drain = bindClass(el.rate, 'is-drain');
  set.clock = bindText(el.clock, '');
  set.tally = bindText(el.tally, '');
  set.runway = bindText(el.runway, '');
  set.urgent = bindClass(el.clockBox, 'is-urgent');
  set.pvOpen = bindClass(el.preview, 'is-open');
  set.pvWin = bindClass(el.preview, 'is-win');
  set.pvLoss = bindClass(el.preview, 'is-loss');
  set.pvReinforce = bindClass(el.preview, 'is-reinforce');
  set.verdict = bindText(el.verdict, '');
  set.pvTitle = bindText(el.pvTitle, '');
  set.pvLine = bindText(el.pvLine, '');
  set.pvNote = bindText(el.pvNote, '');
  set.pvBlocked = bindClass(el.pvNote, 'is-blocked');
  set.trainOpen = bindClass(el.train, 'is-open');
  set.trainX = bindStyle(el.train, '--x');
  set.trainY = bindStyle(el.train, '--y');
  const segOn = strength.map((s) => bindClass(s, 'is-on'));
  const dragOn = dragMode.map((s) => bindClass(s, 'is-on'));
  const chipOn = chips.map((c) => bindClass(c, 'is-on'));
  const chipOff = chips.map((c) => bindClass(c, 'is-off'));
  const boostCd = boosters.map((b) => bindStyle(b.lastChild, '--cd'));
  const boostN = boosters.map((b) => bindText(b.children[1], '0'));
  const boostEmpty = boosters.map((b) => bindClass(b, 'is-empty'));
  const boostArmed = boosters.map((b) => bindClass(b, 'is-armed'));
  const boostShake = boosters.map((b) => bindClass(b, 'is-rejected'));
  const boostLabel = boosters.map((b, i) => bindText(b.children[2], boosterIds[i]));
  const fanUnits = trainFanUnits(railUnits);
  const trainChips = buildTrainPicker(el.train, input, view, tip, railUnits);

  // The simulation never touches the bus; screens/battle.js re-emits every sim
  // event as `battle:<type>`. A rejected order used to end here, unheard.
  // WHAT THE HUD SAYS WHEN THE SIM SPEAKS lives in battle-alert.js, beside the
  // control that shows it — split at the 400-line cap along that seam.
  if (bus) {
    wireAlerts({
      bus, off, alert, getState, boosterIds, boostShake, aiming: AIMING,
      onShake: (i, until) => { shaken = i; shakeUntil = until; },
    });
  }

  /**
   * The frame entry point. Text is refreshed at 10Hz — it is text, and text
   * that rewrites at 60Hz is pure cost — but the two overlays that are PINNED
   * TO POINTS ON THE BOARD are placed every frame, because a position that
   * only catches up ten times a second visibly lags the map while you pan.
   * Both are cached style writes, so a still camera costs a few comparisons.
   *
   * Placement runs last, after any refresh, so it always reads the panel the
   * player is actually looking at rather than the one from a frame ago.
   */
  function update(force) {
    const t = now();
    const state = getState();
    if (force || t - last >= 100) { last = t; refresh(state, t); }
    if (!state) return;
    site.follow(state, t, insets.get(t));
    placeTrain(state);
  }

  function refresh(state, t) {
    alert.update(t);
    withdraw.update(Date.now());
    if (shaken >= 0 && t >= shakeUntil) { boostShake[shaken](false); shaken = -1; }
    if (!state) return;

    const flow = goldFlow(state, 'player');
    set.gold(compact(state.factions.player.goldCg / 100));
    set.rate(rate(flow.net));
    set.drain(flow.net < 0);
    set.flow(flowLine(flow));
    const sec = state.tick / TICK_HZ;
    set.clock(clock(sec));
    set.runway(` / ${clock(state.rules.hardCapTicks / TICK_HZ)}`);
    set.tally(`${sitesOwned(state, 'player').length} v ${sitesOwned(state, 'enemy').length}`);
    set.urgent(state.rules.hardCapTicks - state.tick < TICK_HZ * 60);

    for (let i = 0; i < SEND_FRACTIONS.length; i++) segOn[i](view.fraction === SEND_FRACTIONS[i]);
    dragOn[0](!view.rallyMode);
    dragOn[1](!!view.rallyMode);
    // `railUnits.length`, not `UNIT_IDS.length`: the rail is the expedition's
    // roster, so the two differ on every battle that is not carrying all nine.
    for (let i = 0; i < railUnits.length; i++) {
      chipOn[i](view.filter[railUnits[i]] !== false);
      chipOff[i](view.filter[railUnits[i]] === false);
    }
    for (let i = 0; i < boosterIds.length; i++) {
      const b = state.boosters?.[boosterIds[i]];
      const armed = view.armedBooster === boosterIds[i];
      boostN[i](b ? String(b.charges) : '–');
      boostCd[i](b && b.cdMax ? String(1 - b.cdTicks / b.cdMax) : '1');
      boostEmpty[i](!b || b.charges <= 0);
      // Text as well as a class: the armed state has to READ as armed before
      // the stylesheet for `.booster.is-armed` exists.
      if (boostArmed[i](armed)) {
        boosters[i].setAttribute('aria-pressed', armed ? 'true' : 'false');
        boostLabel[i](armed ? 'AIM ▸' : boosterIds[i]);
      }
    }

    speed.update(state);
    site.update(state);
    buildRail.update();
    // The drag/attack preview — computing it and painting every readout off
    // the result moved to battle-parts.js at the 400-line cap, the natural
    // cut since renderComp/renderCaveats (which it calls) already lived
    // there.
    updatePreview(state, view, set, el, o.travelSeconds);
    updateTrain(state);
  }

  /** The fan's POSITION only — the cheap half of updateTrain, run per frame so
   *  the chips stay on their site through a pan. */
  function placeTrain(state) {
    const id = view.trainPickerFor;
    const s = id ? siteOf(state, id) : null;
    if (!s) return;
    // The viewport, so the fan can be kept inside it — see placeFan. Read off
    // the camera, which already tracks it, rather than touching `window`.
    placeFan(board, s, set, board.camera?.vw, board.camera?.vh);
  }

  function updateTrain(state) {
    const id = view.trainPickerFor;
    const s = id ? siteOf(state, id) : null;
    const open = !!s && s.owner === 'player' && !!SITES[s.kind].train && !view.armedBooster;
    set.trainOpen(open);
    if (!open) return;
    const unlocked = state.mods?.player?.unlockedUnits ?? UNIT_IDS;
    // Indexed against the SAME list the chips were built from. It was UNIT_IDS
    // while the chips came from UNIT_IDS too, so it read as correct and would
    // have silently mislabelled every chip the moment the two diverged.
    for (let i = 0; i < trainChips.length; i++) {
      trainChips[i].on(s.trainType === fanUnits[i]);
      trainChips[i].locked(!unlocked.includes(fanUnits[i]));
    }
  }

  return {
    el,
    update,
    dispose() { off.dispose(); tip.dispose(); speed.dispose(); clear(root); },
  };
}

// The training fan, the drag/attack preview and its two small renderers all
// live in ./battle-parts.js — split out at the 400-line cap, imported above.
