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
import { siteOf, computePreview } from './battle-preview.js';
import { TRAIN_FAN_R, TRAIN_FAN_DEG } from './battle-anchor.js';

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
  const pv = legal
    ? computePreview(state, fromId, toId, {
      fraction: view.fraction,
      filter: UNIT_IDS.filter((u) => view.filter[u] !== false),
      travelSeconds,
    })
    : null;

  set.pvOpen(!!pv);
  if (!pv) return;
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
 *  scratch point `_p` stays next to the only thing that writes it. */
export function placeFan(board, site, set) {
  board.siteScreen(site, _p);
  set.trainX(`${Math.round(_p.x)}px`);
  set.trainY(`${Math.round(_p.y)}px`);
}

/**
 * Put the two control rails where the screen has room for them, and keep them
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
 */
export function placeRails(el) {
  const railable = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(min-width: 721px) and (min-height: 561px)') : null;
  const docRoot = typeof document !== 'undefined' ? document.documentElement : null;

  function place() {
    const railed = !railable || railable.matches;
    docRoot?.classList.toggle('is-railed', railed);
    docRoot?.classList.toggle('is-docked', !railed);
    if (railed) {
      mount(el.tl, el.rail);
      mount(el.tr, el.right);
    } else {
      mount(el.dock, el.rail, el.right);
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
