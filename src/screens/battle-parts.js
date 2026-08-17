// Pieces of the battle HUD, split out of battle-hud.js at the 400-line cap:
// the training fan, and the drag/attack preview together with the two small
// renderers it calls.
//
// Each is a "given this data, paint these elements" function over whatever
// host node or bag of cached writers it is handed, never a closure over
// createBattleHud's own construction — which is what let updatePreview move
// here without dragging its caller's whole closure along with it.

import { h, mount, clear, bindClass } from '../ui/dom.js';
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

/** One 44px chip per trainable unit, fanned in an arc around the selected site:
 *  the highest frequency decision in the game, sitting at the point of attention
 *  instead of in a sidebar. A 44px circle cannot hold "Spearmen", so the glyph
 *  stays short and the hover card carries the name and the job.
 *
 *  TRAINABLE_UNITS, not UNIT_IDS: the marshal is commissioned with RECRUIT and
 *  is not a thing a stronghold can be set to build. Offering him here cost a
 *  wall's whole output for forty seconds to duplicate a body every landing
 *  already grants, and then quietly kept building them. */
export function buildTrainPicker(host, input, view, tip) {
  // Radius chosen so the chips across a 170-degree fan do not touch, and the fan
  // GROWS with the roster — this was fixed at a five-chip radius and the three
  // specialists landed on top of each other. TRAIN_FAN_R in battle-anchor.js
  // mirrors the same formula, so the site panel keeps clear of the fan.
  const a0 = -175;
  const units = TRAINABLE_UNITS;
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
  }
  place();
  railable?.addEventListener('change', place);

  // The classes are global, so they have to come off with the scene or the
  // world map inherits a battle HUD's layout mode.
  return () => {
    railable?.removeEventListener('change', place);
    docRoot?.classList.remove('is-railed', 'is-docked');
  };
}
