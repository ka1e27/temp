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
import { TICK_HZ } from '../core/loop.js';
import { h, mount, clear, bindText, bindClass, bindStyle, createDisposer } from '../ui/dom.js';
import { compact, clock, percent, rate } from '../ui/format.js';
import { BOOSTER_KEYS, FILTER_KEYS, needsTarget } from './battle-keys.js';
import { siteOf, computePreview, income } from './battle-preview.js';
import { createSitePanel, createWithdraw, createAlert, rejectionText } from './battle-panel.js';
import { createSpeedControl } from './battle-speed.js';

export {
  computePreview, previewLine, income, projectGarrison, travelSecondsFor,
} from './battle-preview.js';

const INSUFFICIENT = 'INSUFFICIENT — walls repair faster than you break them';
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
      title: `Send ${percent(f)} of a garrison — key ${i + 1}`,
      on: { click: () => input.setFraction(f) },
    }));
  const chips = UNIT_IDS.map((u) =>
    h('button.chip', {
      'data-interactive': true, type: 'button', vars: { '--chip': `var(--c-${u})` },
      title: `Include ${u} in every send — key ${FILTER_KEYS[u]}`,
      on: { click: () => input.toggleFilter(u) },
    }, u.slice(0, 3), h('span.chip-key', { text: FILTER_KEYS[u] })));
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

  const speed = createSpeedControl({ bus, onSetSpeed: o.onSetSpeed });
  const site = createSitePanel({ getState, view, input });
  const withdraw = createWithdraw({ input });
  const alert = createAlert();

  el.gold = h('span.hud-value.num', { text: '0' });
  el.rate = h('span.hud-rate.num', { text: '+0.0/s' });
  el.clock = h('span.hud-value.num', { text: '0:00' });
  el.clockBox = h('div.hud-clock.panel', {}, h('span.label', { text: 'Elapsed' }), el.clock);
  el.verdict = h('span.pv-verdict', { text: '' });
  el.pvTitle = h('span', { text: '' });
  el.pvLine = h('div.pv-line');
  el.pvNote = h('div.pv-note');
  el.pvComp = h('div.pv-comp');
  el.pvCaveats = h('div.pv-caveats');
  el.preview = h('div.hud-preview.panel', {},
    h('div.pv-head', {}, el.pvTitle, el.verdict), el.pvComp, el.pvLine, el.pvNote, el.pvCaveats);
  el.train = h('div.hud-train');
  el.alert = alert.el;
  el.selection = site.el;
  el.withdraw = withdraw.el;

  mount(root,
    h('div.hud-corner.hud-tl', {},
      h('div.hud-gold.panel', {}, el.gold, el.rate),
      h('div.hud-objective', { text: 'Take the Castle. Don’t lose the Camp.' }),
      alert.el),
    h('div.hud-corner.hud-tr', {}, el.clockBox, withdraw.el),
    h('div.hud-dock', {},
      h('div.hud-group.panel', {}, h('span.hud-group-label', { text: 'Strength' }), ...strength),
      h('div.hud-group.panel', {}, h('span.hud-group-label', { text: 'Send' }), ...chips),
      h('div.hud-group.panel', {}, h('span.hud-group-label', { text: 'Boosters' }), ...boosters),
      speed.el),
    site.el, el.preview, el.train);

  // Cached writers: an unchanged value costs one comparison and no DOM work.
  set.gold = bindText(el.gold, '0');
  set.rate = bindText(el.rate, '');
  set.clock = bindText(el.clock, '');
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
  const chipOn = chips.map((c) => bindClass(c, 'is-on'));
  const chipOff = chips.map((c) => bindClass(c, 'is-off'));
  const boostCd = boosters.map((b) => bindStyle(b.lastChild, '--cd'));
  const boostN = boosters.map((b) => bindText(b.children[1], '0'));
  const boostEmpty = boosters.map((b) => bindClass(b, 'is-empty'));
  const boostArmed = boosters.map((b) => bindClass(b, 'is-armed'));
  const boostShake = boosters.map((b) => bindClass(b, 'is-rejected'));
  const boostLabel = boosters.map((b, i) => bindText(b.children[2], boosterIds[i]));
  const trainChips = buildTrainPicker(el.train, input, view);

  // The simulation never touches the bus; screens/battle.js re-emits every sim
  // event as `battle:<type>`. A rejected order used to end here, unheard.
  if (bus) {
    off(bus.on('battle:command-rejected', (ev) => {
      const t = now();
      alert.show(rejectionText(ev), t);
      const i = ev?.cmd?.t === 'BOOSTER' ? boosterIds.indexOf(ev.cmd.id) : -1;
      if (i >= 0) { shaken = i; shakeUntil = t + 420; boostShake[i](true); }
    }));
    off(bus.on('ui:armed-booster', (id) => alert.hold(id ? AIMING(id) : '')));
  }

  function update(force) {
    const t = now();
    if (!force && t - last < 100) return;   // 10Hz, never per frame
    last = t;
    alert.update(t);
    withdraw.update(Date.now());
    if (shaken >= 0 && t >= shakeUntil) { boostShake[shaken](false); shaken = -1; }
    const state = getState();
    if (!state) return;

    set.gold(compact(state.factions.player.goldCg / 100));
    set.rate(rate(income(state, 'player')));
    const sec = state.tick / TICK_HZ;
    set.clock(clock(sec));
    set.urgent(state.rules.hardCapTicks - state.tick < TICK_HZ * 60);

    for (let i = 0; i < SEND_FRACTIONS.length; i++) segOn[i](view.fraction === SEND_FRACTIONS[i]);
    for (let i = 0; i < UNIT_IDS.length; i++) {
      chipOn[i](view.filter[UNIT_IDS[i]] !== false);
      chipOff[i](view.filter[UNIT_IDS[i]] === false);
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
    updatePreview(state);
    updateTrain(state);
  }

  function updatePreview(state) {
    const fromId = view.dragFrom || view.armed || view.selection[0];
    const toId = view.dragTo || (view.hoverId !== fromId ? view.hoverId : null);
    const from = fromId ? siteOf(state, fromId) : null;
    const legal = from && toId && !view.armedBooster
      && from.owner === 'player' && from.adj.includes(toId);
    const pv = legal
      ? computePreview(state, fromId, toId, {
        fraction: view.fraction,
        filter: UNIT_IDS.filter((u) => view.filter[u] !== false),
        travelSeconds: o.travelSeconds,
      })
      : null;

    set.pvOpen(!!pv);
    if (!pv) return;
    set.pvWin(pv.kind !== 'reinforce' && pv.win);
    set.pvLoss(pv.kind !== 'reinforce' && !pv.win);
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

  function updateTrain(state) {
    const id = view.trainPickerFor;
    const s = id ? siteOf(state, id) : null;
    const open = !!s && s.owner === 'player' && !!SITES[s.kind].train && !view.armedBooster;
    set.trainOpen(open);
    if (!open) return;
    board.siteScreen(s, _p);
    set.trainX(`${Math.round(_p.x)}px`);
    set.trainY(`${Math.round(_p.y)}px`);
    const unlocked = state.mods?.player?.unlockedUnits ?? UNIT_IDS;
    for (let i = 0; i < trainChips.length; i++) {
      trainChips[i].on(s.trainType === UNIT_IDS[i]);
      trainChips[i].locked(!unlocked.includes(UNIT_IDS[i]));
    }
  }

  return {
    el,
    update,
    dispose() { off.dispose(); speed.dispose(); clear(root); },
  };
}

const _p = { x: 0, y: 0 };

/** Five 44px chips fanned in an arc around the selected site: the highest
 *  frequency decision in the game, sitting at the point of attention instead
 *  of in a sidebar. */
function buildTrainPicker(host, input, view) {
  // Radius chosen so five 44px chips across a 170-degree fan do not touch:
  // 170/360 * 2*pi*94 ~= 279px of arc for 220px of chip.
  const R = 94;
  return UNIT_IDS.map((u, i) => {
    const a = (-175 + (170 / (UNIT_IDS.length - 1)) * i) * (Math.PI / 180);
    const chip = h('button.train-chip', {
      'data-interactive': true, type: 'button', title: `Train ${u}`,
      vars: {
        '--chip': `var(--c-${u})`,
        '--dx': `${Math.round(Math.cos(a) * R)}px`,
        '--dy': `${Math.round(Math.sin(a) * R)}px`,
      },
      on: { click: () => input.setTrain(view.trainPickerFor, u) },
    }, h('span.train-chip-icon'), h('span.train-chip-key', { text: u.slice(0, 3).toUpperCase() }));
    mount(host, chip);
    return { el: chip, on: bindClass(chip, 'is-on'), locked: bindClass(chip, 'is-locked') };
  });
}

/** Mirrors the on-canvas garrison bar, so the same five hues mean the same
 *  five things in both places. */
function renderComp(host, comp, n) {
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

function renderCaveats(host, pv) {
  const list = [];
  if (pv.kind !== 'reinforce') list.push('if unreinforced');
  if (pv.hp !== undefined && pv.hp < pv.hpMax) list.push(`walls ${percent(pv.hp / pv.hpMax)} on arrival`);
  if (pv.defSurvivors > 0) list.push(`${pv.defSurvivors} defenders hold`);
  const sig = list.join('|');
  if (host.dataset.sig === sig) return;
  host.dataset.sig = sig;
  clear(host);
  for (const c of list) mount(host, h('span.pv-caveat', { text: c }));
}
