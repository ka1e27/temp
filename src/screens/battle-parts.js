// Pieces of the battle HUD, split out of battle-hud.js at the 400-line cap:
// the training fan, and the drag/attack preview together with the two small
// renderers it calls.
//
// Each is a "given this data, paint these elements" function over whatever
// host node or bag of cached writers it is handed, never a closure over
// createBattleHud's own construction — which is what let updatePreview move
// here without dragging its caller's whole closure along with it.

import { h, mount, clear, bindClass, watchOverflow } from '../ui/dom.js';
// `percent` was used by renderCaveats and never imported, so the "walls 62% on
// arrival" caveat threw a ReferenceError on every assault against a damaged wall
// — the one preview line that only appears mid-siege, which is why no screenshot
// ever caught it. tests/battleui.test.js now calls that branch directly.
import { percent } from '../ui/format.js';
import { UNIT_IDS } from '../content/balance.js';
import { UNITS_UI } from '../content/strings.js';
import { TRAINABLE_UNITS } from '../battle/training.js';
import { siteOf, computePreview, computeMultiPreview } from './battle-preview.js';
import {
  TRAIN_FAN_R, TRAIN_FAN_DEG, TRAIN_CHIP_PX, clampBox, panelBounds,
} from './battle-anchor.js';

const _p = { x: 0, y: 0 };
const INSUFFICIENT = 'INSUFFICIENT — walls repair faster than you break them';

/** What the training fan offers: trainable, and carried by this expedition.
 *  Exported so `updateTrain` indexes against exactly the list the chips were
 *  built from — the two drifting apart is how every chip in the fan would
 *  silently mislabel itself. Empty roster falls back to the whole trainable
 *  list, the same safe direction `battle-keys.js filterUnits` takes. */
export function trainFanUnits(roster) {
  if (!Array.isArray(roster) || roster.length === 0) return TRAINABLE_UNITS;
  const out = TRAINABLE_UNITS.filter((u) => roster.includes(u));
  return out.length ? out : TRAINABLE_UNITS;
}

/** One 44px chip per trainable unit, fanned in an arc around the selected site:
 *  the highest frequency decision in the game, sitting at the point of attention
 *  instead of in a sidebar. A 44px circle cannot hold "Spearmen", so the glyph
 *  stays short and the hover card carries the name and the job.
 *
 *  TRAINABLE_UNITS, not UNIT_IDS: the marshal is commissioned with RECRUIT and
 *  is not a thing a stronghold can be set to build. Offering him here cost a
 *  wall's whole output for forty seconds to duplicate a body every landing
 *  already grants, and then quietly kept building them.
 *
 *  ...AND NARROWED AGAIN, TO THIS EXPEDITION'S ROSTER. `cmdTrain` gates on
 *  `mods.player.unlockedUnits`, which `meta/composition.js battleRoster` has
 *  narrowed to the five types the expedition actually carries — so the fan drew
 *  eight chips, six of them permanently locked, in the first second of the
 *  first thing a new player ever selects. The lock is kept rather than trusted
 *  away (the two lists cannot diverge today and the fan must not assume that),
 *  but a chip that can never unlock during THIS battle is not a preview of
 *  anything, it is furniture — and one of them sat behind the coach bubble
 *  teaching the gesture. The fan's radius grows with its own length, so
 *  narrowing it also tightens it around the site it belongs to. */
export function buildTrainPicker(host, input, view, tip, roster) {
  // Radius chosen so the chips across a 170-degree fan do not touch, and the fan
  // GROWS with the roster — this was fixed at a five-chip radius and the three
  // specialists landed on top of each other. TRAIN_FAN_R in battle-anchor.js
  // mirrors the same formula, so the site panel keeps clear of the fan.
  const a0 = -175;
  const units = trainFanUnits(roster);
  return units.map((u, i) => {
    const a = (a0 + (TRAIN_FAN_DEG / Math.max(1, units.length - 1)) * i) * (Math.PI / 180);
    const chip = h('button.train-chip', {
      'data-interactive': true, type: 'button',
      'aria-label': `Train ${UNITS_UI[u].name} here — ${UNITS_UI[u].role}`,
      vars: {
        '--chip': `var(--c-${u})`,
        '--dx': `${Math.round(Math.cos(a) * TRAIN_FAN_R)}px`,
        '--dy': `${Math.round(Math.sin(a) * TRAIN_FAN_R)}px`,
      },
      on: { click: () => input.setTrain(view.trainPickerFor, u) },
    }, h('span.train-chip-icon'), h('span.train-chip-key', { text: u.slice(0, 3).toUpperCase() }));
    mount(host, chip);
    tip.attach(chip, u, 'Click to train this here');
    return { el: chip, on: bindClass(chip, 'is-on'), locked: bindClass(chip, 'is-locked') };
  });
}

/**
 * The drag/attack preview: works out what (if anything) is legal to compute,
 * then paints every readout off the result. Moved from battle-hud.js at the
 * 400-line cap — the natural cut, since renderComp/renderCaveats (which it
 * calls) already lived here.
 *
 * `set`/`el` are handed in rather than closed over, so this stays a plain
 * function of its arguments: `set` is createBattleHud's cached writers,
 * `el.pvComp`/`el.pvCaveats` the two nodes renderComp/renderCaveats paint.
 * @param {object} state @param {object} view presentation state
 * @param {object} set @param {object} el @param {Function} [travelSeconds]
 */
export function updatePreview(state, view, set, el, travelSeconds) {
  const fromId = view.dragFrom || view.armed || view.selection[0];
  const toId = view.dragTo || (view.hoverId !== fromId ? view.hoverId : null);
  const from = fromId ? siteOf(state, fromId) : null;
  // Free movement: legal is just "ours, distinct" — pathBetween in cmdSend is the real check.
  const legal = from && toId && !view.armedBooster
    && from.owner === 'player' && from.id !== toId;
  const opts = {
    fraction: view.fraction,
    filter: UNIT_IDS.filter((u) => view.filter[u] !== false),
    travelSeconds,
  };
  // CONCENTRATING FORCE PREVIEWS ITSELF, and deliberately claims LESS. A
  // multi-source drag cannot honour invariant 3 with a combined outcome — the
  // columns are at different distances, so they arrive as separate waves and a
  // later one reinforces a fight already under way. `computeMultiPreview` says
  // what is honestly knowable at commit time (how many columns, how many
  // bodies, the arrival spread) and nothing more; see its own header for why
  // withholding the number IS keeping the promise.
  const pv = !legal ? null
    : (view.dragSources && view.dragSources.length > 1
      ? computeMultiPreview(state, view.dragSources, toId, opts)
      : computePreview(state, fromId, toId, opts));

  set.pvOpen(!!pv);
  if (!pv) return;
  if (pv.kind === 'multi') {
    // No verdict, no caveats, no win/loss tint: there is no outcome to tint.
    set.pvWin(false);
    set.pvLoss(false);
    set.pvReinforce(false);
    set.pvTitle(`${pv.sendN} troops → ${pv.to}`);
    set.verdict('');
    set.pvLine(pv.line);
    set.pvNote('');
    set.pvBlocked(false);
    renderComp(el.pvComp, pv.send, pv.sendN);
    renderCaveats(el.pvCaveats, {});
    return;
  }
  // win is undefined for reinforce/unscouted, so compare booleans, not `!`.
  set.pvWin(pv.win === true);
  set.pvLoss(pv.win === false);
  set.pvReinforce(pv.kind === 'reinforce');
  set.pvTitle(`${pv.sendN} troops → ${pv.to}`);
  set.verdict(pv.verdict);
  set.pvLine(pv.line);
  set.pvNote(pv.insufficient ? INSUFFICIENT
    : pv.win === false ? 'Send more, or change what you are sending.' : '');
  set.pvBlocked(!!pv.insufficient);
  renderComp(el.pvComp, pv.send, pv.sendN);
  renderCaveats(el.pvCaveats, pv);
}

/** Mirrors the on-canvas garrison bar, so the same five hues mean the same
 *  five things in both places. */
export function renderComp(host, comp, n) {
  const sig = UNIT_IDS.map((u) => comp[u] || 0).join(',');
  if (host.dataset.sig === sig) return;
  host.dataset.sig = sig;
  clear(host);
  if (!n) return;
  for (const u of UNIT_IDS) {
    const c = comp[u] || 0;
    if (!c) continue;
    mount(host, h('span', { style: { width: `${(c / n) * 100}%`, background: `var(--c-${u})` } }));
  }
}

export function renderCaveats(host, pv) {
  const list = [];
  // Only the two kinds that actually compute a fight earn this caveat — an
  // unscouted target has no "if unreinforced" claim to make, because it has
  // no garrison number for that claim to be conditional on in the first place.
  if (pv.kind === 'assault' || pv.kind === 'relieve') list.push('if unreinforced');
  if (pv.hp !== undefined && pv.hp < pv.hpMax) list.push(`walls ${percent(pv.hp / pv.hpMax)} on arrival`);
  if (pv.defSurvivors > 0) list.push(`${pv.defSurvivors} defenders hold`);
  const sig = list.join('|');
  if (host.dataset.sig === sig) return;
  host.dataset.sig = sig;
  clear(host);
  for (const c of list) mount(host, h('span.pv-caveat', { text: c }));
}

/** Put the fan on its site. Split from battle-hud.js with the fan itself so the
 *  scratch point `_p` stays next to the only thing that writes it.
 *
 *  ...AND KEEP IT ON THE SCREEN, which it did not do. It anchored on the site's
 *  raw projected position with no clamping at all, while the site PANEL right
 *  next to it has a whole `clampBox`/`placePanel` system built for exactly this
 *  — that machinery was simply never pointed at the fan. Measured at 390px on a
 *  phone, a camp near the left edge put `Train Militia` at x −45 and
 *  `Train Spearmen` at −29: the two staples of the default spread, entirely
 *  off-screen, with no error and no scroll affordance. `tools/mobile.mjs` now
 *  catches it (it could not before — see the two dead lookups fixed there).
 *
 *  The fan is an arc from −175° to −5°, so it reaches `R` left, `R` right and
 *  `R` UP from the anchor and essentially nothing down. Clamping its box rather
 *  than the anchor is what keeps that asymmetry honest. */
export function placeFan(board, site, set, vw, vh) {
  board.siteScreen(site, _p);
  let { x, y } = _p;
  if (vw && vh) {
    const half = TRAIN_CHIP_PX / 2;
    const w = TRAIN_FAN_R * 2 + TRAIN_CHIP_PX;
    const hgt = TRAIN_FAN_R + TRAIN_CHIP_PX;
    const at = clampBox(x - TRAIN_FAN_R - half, y - TRAIN_FAN_R - half, w, hgt,
      panelBounds(vw, vh, null));
    x = at.x + TRAIN_FAN_R + half;
    y = at.y + TRAIN_FAN_R + half;
  }
  set.trainX(`${Math.round(x)}px`);
  set.trainY(`${Math.round(y)}px`);
}

/**
 * Put the control rails where the screen has room for them, and keep them
 * there. Returns a disposer.
 *
 * BOTH AXES. Width alone was the first version and it put the rails on the
 * sides of a phone in LANDSCAPE — 844px wide, so "not a phone", and 390px tall,
 * so no room for a column at all. Board share fell to 52%. A rail needs width
 * to spare AND height to fill.
 *
 * This is also the single source of truth for the decision: it sets the classes
 * the stylesheets key off, rather than the same condition being written once
 * here and again as a breakpoint in CSS with nothing checking they agree.
 *
 * THREE RAILS, NOT TWO, and `el.build` is OPTIONAL rather than a third named
 * parameter every caller must supply — the build rail rides in the RIGHT
 * corner, stacked under the boosters one, because it is the same shape of
 * control (spend gold on a limited action) rather than a standing preference
 * like the troop filter on the left. A caller with only the original two
 * rails (`el.build` left undefined) places exactly as before.
 */
export function placeRails(el) {
  const railable = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(min-width: 721px) and (min-height: 561px)') : null;
  const docRoot = typeof document !== 'undefined' ? document.documentElement : null;
  const rightRails = [el.right, el.build].filter(Boolean);
  let unwatch = () => {}; // clipped card = drawn but UNCLICKABLE; see watchOverflow
  function place() {
    const railed = !railable || railable.matches;
    docRoot?.classList.toggle('is-railed', railed);
    docRoot?.classList.toggle('is-docked', !railed);
    if (railed) {
      mount(el.tl, el.rail);
      mount(el.tr, ...rightRails);
    } else {
      mount(el.dock, el.rail, ...rightRails);
    }
    unwatch(); unwatch = watchOverflow([el.rail, ...rightRails]);
  }
  place();
  railable?.addEventListener('change', place);
  // The classes are global, so they have to come off with the scene or the
  // world map inherits a battle HUD's layout mode.
  return () => {
    railable?.removeEventListener('change', place);
    unwatch();
    docRoot?.classList.remove('is-railed', 'is-docked');
  };
}

/**
 * The two readout panels and the preview card: the treasury group, the clock
 * group, and the six nodes updatePreview paints. Split out of battle-hud.js at
 * the 400-line cap, along the seam that costs nothing — this block is pure
 * construction with no reference to createBattleHud's own closure, which is the
 * same reason updatePreview itself lives here.
 *
 * It fills the caller's `el` bag in place rather than returning a new object,
 * because every one of these nodes is read back by name from half a dozen
 * places (`el.clockBox` by placeRails, `el.pvComp` by updatePreview, `el.gold`
 * by the writer cache) and a second container would just be a name to keep in
 * step.
 */
export function buildReadouts(el) {
  el.gold = h('span.hud-value.num', { text: '0' });
  // NET, not income: the number the player decides on is what the treasury does
  // per second once the strongholds have taken their cut, so switching a
  // stronghold to rams has to move THIS figure. The breakdown underneath shows
  // both halves, because a net alone hides which half moved.
  el.rate = h('span.hud-rate.num', {
    text: '+0.0/s', title: 'Net gold per second — income minus training',
  });
  el.flow = h('span.hud-flow.num', { text: '' });
  // WHERE YOUR ARMY IS, which nothing anywhere answered. Gold carries a total
  // AND a rate; troops carried neither — no bodies commanded, no standing
  // versus marching, no orders in flight. CLAUDE.md writes that exact blind
  // spot up at length for the HARNESS BOT (1,092 bodies with 239 standing, 78%
  // permanently in transit) and treats it as a first-order balance concern; the
  // player had the same problem and no readout to notice it by.
  //
  // It rides the gold panel because that panel is already the "totals plus a
  // breakdown" shape this is asking for, and because troops and gold are the
  // two things a battle is spent in. Hidden until there is an army, so battle
  // one does not open on a row of zeros.
  el.army = h('span.hud-army.num', { text: '' });
  // WALLPAPER UNTIL NOW: one fixed sentence for the whole battle, while the
  // castle gate — the win condition on nineteen of twenty-four regions — was
  // only ever visible inside the castle's own panel, mid-siege. The line is
  // live; battle-status.js `objectiveLine` is the whole reasoning.
  el.objective = h('div.hud-objective', { text: '' });
  el.clock = h('span.hud-value.num', { text: '0:00' });
  // ELAPSED AND THE CAP. It counted up with no end in sight, and the hard cap
  // was stated exactly once, on the pre-battle brief — so a player who did not
  // memorise it had no way to know whether a slow grind was still affordable
  // until the last sixty seconds turned the panel red. A battle that TIMES OUT
  // is a loss, so the runway is not trivia.
  el.runway = h('span.hud-runway.num', { text: '' });
  // WHO IS AHEAD, in the one currency the win condition is made of. Nothing in
  // the HUD carried it: `sitesOwned` exists and no screen imported it, so on a
  // 20x15 board over 7-24 minutes the only way to answer "am I winning" was to
  // pan the whole map and count. Sites rather than troops because territory is
  // what pays, what gates the castle, and what the results screen scores.
  // It rides the CLOCK's row, and is hidden in the docked (phone) layout — see
  // hud.css for the three placements measured and why none of them fit there.
  el.tally = h('span.hud-value.num', { text: '' });
  // DECLARED BEFORE THE BOX THAT MOUNTS IT, and that is not style. It used to
  // be created ten lines BELOW this, so `el.tally` was `undefined` here — and
  // `h()` skips an undefined child rather than throwing, so the box mounted the
  // label alone and the value span was never in the document at all. The
  // binding below then wrote every update into a detached node: the readout was
  // built, wired, tested and permanently blank. The same "sold and did nothing"
  // shape this file's own history is full of, shipped by the pass that added it.
  el.tallyBox = h('span.hud-tally', {}, h('span.label', { text: 'Sites' }), el.tally);
  el.clockBox = h('div.hud-clock.panel', {},
    el.tallyBox, h('span.label', { text: 'Elapsed' }), el.clock, el.runway);
  el.verdict = h('span.pv-verdict', { text: '' });
  el.pvTitle = h('span', { text: '' });
  el.pvLine = h('div.pv-line');
  el.pvNote = h('div.pv-note');
  el.pvComp = h('div.pv-comp');
  el.pvCaveats = h('div.pv-caveats');
  el.preview = h('div.hud-preview.panel', {},
    h('div.pv-head', {}, el.pvTitle, el.verdict), el.pvComp, el.pvLine, el.pvNote, el.pvCaveats);
}

/**
 * Assemble the four corners, the dock and the three rails onto the caller's
 * `el` bag. Split from battle-hud.js at the 400-line cap, on the same seam
 * `buildReadouts` above uses: pure construction with no reference to
 * createBattleHud's own closure, so it moves without dragging its caller along.
 *
 * `parts` carries the pieces that are BUILT elsewhere and only mounted here —
 * the speed control, the site panel, the alert strip, the withdraw button and
 * the build rail. Passing them rather than importing them is what keeps this a
 * layout function rather than a second constructor.
 */
export function buildFrame(el, parts) {
  const { alert, withdraw, speed, strength, dragMode, chips, boosters, buildRail } = parts;
  el.tl = h('div.hud-corner.hud-tl', {},
    h('div.hud-gold.panel', {}, el.gold, el.rate, el.flow, el.army),
    el.objective,
    el.empire,
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
}
