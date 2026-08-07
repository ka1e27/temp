// The in-battle HUD: DOM, not canvas.
//
// The outcome preview is the design's load-bearing promise. Combat contains no
// RNG at all, so this panel is not a prediction — it is a guarantee. That only
// holds because it calls resolveField() and breachSeconds() DIRECTLY, the same
// functions the simulation calls. Nothing here re-implements combat maths, and
// nothing here may.
//
// Refreshes on a 10Hz throttle, never per frame: the HUD is text, and text
// that rewrites at 60Hz is pure cost.
import { UNIT_IDS, UNITS, SITES, SITE_LEVELS, SEND_FRACTIONS, BOOSTERS }
  from '../content/balance.js';
import { resolveField, breachSeconds, projectHp, scaleComp, total, emptyComp }
  from '../battle/combat.js';
import { travelTicks } from '../battle/movement.js';
import { TICK_HZ } from '../core/loop.js';
import { h, mount, clear, bindText, bindClass, bindStyle } from '../ui/dom.js';
import { fixed, compact, duration, clock, percent, rate, plural } from '../ui/format.js';

const BOOSTER_KEYS = { rally: 'Z', march: 'X', bombard: 'C', fortify: 'V', tithe: 'B' };
const FILTER_KEYS = { militia: 'Q', spearmen: 'W', raiders: 'E', rams: 'R', marshal: 'T' };
const INSUFFICIENT = 'INSUFFICIENT — walls repair faster than you break them';

const siteOf = (state, id) => state.sites.find((s) => s.id === id) || null;
const lvl = (site) => SITE_LEVELS[Math.min(SITE_LEVELS.length - 1, Math.max(0, site.level - 1))];

function filtered(comp, filter) {
  const out = emptyComp();
  for (const u of UNIT_IDS) if (!filter || filter.includes(u)) out[u] = comp[u] || 0;
  return out;
}

/**
 * Travel time straight from battle/movement.js — the SAME function the sim uses
 * to stamp a squad's arriveTick. Re-deriving it here would reintroduce exactly
 * the drift the "no RNG, exact preview" promise exists to prevent, so the ETA
 * is a fact for the same reason the combat numbers are.
 *
 * Still injectable (`travelSeconds`) so tests can pin a value.
 */
export function travelSecondsFor(state, from, to, comp) {
  return travelTicks(state, from, to, comp, 'player') / TICK_HZ;
}

/** In-progress training is deterministic, so the preview can honestly show the
 *  garrison the attacker will actually meet rather than today's number. */
export function projectGarrison(state, site, seconds) {
  const g = { ...site.garrison };
  const spec = SITES[site.kind];
  if (!spec.train) return g;
  const mods = state.mods?.[site.owner] ?? {};
  const unit = UNITS[site.trainType] || UNITS.militia;
  const speed = spec.train * lvl(site).train * (mods.trainSpeedMult ?? 1);
  const cycles = (site.trainProgress || 0) + (seconds * speed) / unit.trainSec;
  const made = Math.floor(cycles) * (unit.batch || 1);
  if (made <= 0) return g;
  const cap = spec.cap + lvl(site).cap + (mods.garrisonCapBonus ?? 0);
  const room = Math.max(0, cap - total(g));
  g[site.trainType] = (g[site.trainType] || 0) + Math.min(made, room);
  return g;
}

/**
 * The exact outcome of sending `fraction` of `fromId`'s garrison at `toId`.
 * PURE — no DOM, no clock. Tested headlessly.
 * @returns {object|null}
 */
export function computePreview(state, fromId, toId, o = {}) {
  const from = siteOf(state, fromId);
  const to = siteOf(state, toId);
  if (!from || !to || from.id === to.id) return null;

  const send = scaleComp(filtered(from.garrison, o.filter), o.fraction ?? 0.5);
  const sendN = total(send);
  const eta = (o.travelSeconds || travelSecondsFor)(state, from, to, send);
  const mods = state.mods || {};
  const regenMult = mods[to.owner]?.structureRegenMult ?? 1;
  const siegeMult = mods.player?.siegeDmgMult ?? 1;
  const pv = { from: from.id, to: to.id, sendN, send, eta, hpMax: to.hpMax };

  const relieving = to.siege && to.siege.owner !== 'player';
  if (to.owner === 'player' && !relieving) {
    pv.kind = 'reinforce';
    pv.verdict = 'REINFORCE';
    pv.line = `REINFORCE +${sendN} · ETA ${duration(eta)}`;
    return pv;
  }

  // Relieving your own besieged site means fighting the besiegers in the open:
  // no walls, no bulwark. Sieges being interruptible is what makes reinforcing
  // dramatic, so the preview has to model it.
  const defenders = relieving ? to.siege.comp : projectGarrison(state, to, eta);
  const res = resolveField(send, defenders, {
    siteDefMult: relieving ? 1 : SITES[to.kind].defMult,
    defenderOwnsSite: !relieving,
    attMult: mods.player?.unitAtkMult ?? 1,
    defMult: mods[relieving ? to.siege.owner : to.owner]?.unitDefMult ?? 1,
    shielded: !relieving && (to.shieldTicks || 0) > 0,
  });

  pv.kind = relieving ? 'relieve' : 'assault';
  pv.ap = res.attPower;
  pv.dp = res.defPower;
  pv.win = res.win;
  pv.survivors = total(res.attSurvivors);
  pv.attSurvivors = res.attSurvivors;
  pv.defSurvivors = total(res.defSurvivors);
  pv.skirmish = res.win ? 0 : Math.floor((send.raiders || 0) * (UNITS.raiders.skirmish ?? 0));
  pv.verdict = res.win ? (relieving ? 'BREAK SIEGE' : 'WIN FIELD') : 'LOSE FIELD';

  if (res.win && !relieving) {
    const hp = projectHp(to.hp, eta, to.kind, to.level, regenMult);
    pv.hp = hp;
    pv.breachSec = breachSeconds(res.attSurvivors, hp, to.kind, to.level, siegeMult, regenMult);
    pv.insufficient = !Number.isFinite(pv.breachSec);
  }
  pv.line = previewLine(pv);
  return pv;
}

/** `AP 239.8 / DP 238.8 · WIN FIELD · 3 survive · BREACH 31s · ETA 4.2s` */
export function previewLine(pv) {
  if (!pv) return '';
  if (pv.kind === 'reinforce') return `REINFORCE +${pv.sendN} · ETA ${duration(pv.eta)}`;
  const parts = [`AP ${fixed(pv.ap)} / DP ${fixed(pv.dp)}`, pv.verdict];
  if (pv.win) parts.push(plural(pv.survivors, 'survives', 'survive'));
  else if (pv.skirmish > 0) parts.push(`${pv.skirmish} skirmish home`);
  if (pv.win && pv.breachSec !== undefined) parts.push(`BREACH ${duration(pv.breachSec)}`);
  parts.push(`ETA ${duration(pv.eta)}`);
  return parts.join(' · ');
}

/** Gold per second a faction is currently earning, for the income readout. */
export function income(state, faction) {
  const mods = state.mods?.[faction] ?? {};
  let g = 0;
  for (const s of state.sites) {
    if (s.owner !== faction) continue;
    const spec = SITES[s.kind];
    if (!spec.gold) continue;
    g += spec.gold * lvl(s).gold * (mods.goldRateMult ?? 1)
      * (s.kind === 'farm' ? (mods.farmYieldMult ?? 1) : 1);
  }
  return g;
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

/**
 * @param {{root:HTMLElement, getState:()=>object, view:object, input:object,
 *          board:object, bus?:object, travelSeconds?:Function}} o
 */
export function createBattleHud(o) {
  const { root, getState, view, input, board } = o;
  const el = {};
  const set = {};
  let last = -1e9;

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
  const boosters = Object.keys(BOOSTERS).map((id) =>
    h('button.booster', {
      'data-interactive': true, type: 'button', title: `${id} — key ${BOOSTER_KEYS[id]}`,
      on: { click: () => input.useBooster(id) },
    },
    h('span.booster-key', { text: BOOSTER_KEYS[id] }),
    h('span.booster-charges', { text: '0' }),
    h('span.booster-name', { text: id }),
    h('span.booster-cd')));

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
  el.selTitle = h('div.hud-selection-title', { text: '' });
  el.selSub = h('div.hud-selection-sub', { text: '' });
  el.selection = h('div.hud-selection.panel', {}, el.selTitle, el.selSub);

  mount(root,
    h('div.hud-corner.hud-tl', {},
      h('div.hud-gold.panel', {}, el.gold, el.rate),
      h('div.hud-objective', { text: 'Take the Castle. Don’t lose the Camp.' })),
    h('div.hud-corner.hud-tr', {}, el.clockBox),
    h('div.hud-dock', {},
      h('div.hud-group.panel', {}, h('span.hud-group-label', { text: 'Strength' }), ...strength),
      h('div.hud-group.panel', {}, h('span.hud-group-label', { text: 'Send' }), ...chips),
      h('div.hud-group.panel', {}, h('span.hud-group-label', { text: 'Boosters' }), ...boosters)),
    el.selection, el.preview, el.train);

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
  set.selOpen = bindClass(el.selection, 'is-open');
  set.selTitle = bindText(el.selTitle, '');
  set.selSub = bindText(el.selSub, '');
  set.trainOpen = bindClass(el.train, 'is-open');
  set.trainX = bindStyle(el.train, '--x');
  set.trainY = bindStyle(el.train, '--y');
  const segOn = strength.map((s) => bindClass(s, 'is-on'));
  const chipOn = chips.map((c) => bindClass(c, 'is-on'));
  const chipOff = chips.map((c) => bindClass(c, 'is-off'));
  const boostCd = boosters.map((b) => bindStyle(b.lastChild, '--cd'));
  const boostN = boosters.map((b) => bindText(b.children[1], '0'));
  const boostEmpty = boosters.map((b) => bindClass(b, 'is-empty'));
  const trainChips = buildTrainPicker(el.train, input, view);

  function update(force) {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!force && now - last < 100) return;   // 10Hz, never per frame
    last = now;
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
    const ids = Object.keys(BOOSTERS);
    for (let i = 0; i < ids.length; i++) {
      const b = state.boosters?.[ids[i]];
      boostN[i](b ? String(b.charges) : '–');
      boostCd[i](b && b.cdMax ? String(1 - b.cdTicks / b.cdMax) : '1');
      boostEmpty[i](!b || b.charges <= 0);
    }

    updateSelection(state);
    updatePreview(state);
    updateTrain(state);
  }

  function updateSelection(state) {
    const id = view.selection[0];
    const s = id ? siteOf(state, id) : null;
    set.selOpen(!!s);
    if (!s) return;
    const n = view.selection.length;
    set.selTitle(n > 1 ? `${n} sites selected` : `${s.kind.toUpperCase()} · L${s.level}`);
    set.selSub(n > 1 ? 'R retreats · right-click sets rally'
      : `${total(s.garrison)} troops · HP ${Math.round(s.hp)}/${s.hpMax}`
        + (s.siege ? ' · UNDER SIEGE' : ''));
  }

  function updatePreview(state) {
    const fromId = view.dragFrom || view.armed || view.selection[0];
    const toId = view.dragTo || (view.hoverId !== fromId ? view.hoverId : null);
    const from = fromId ? siteOf(state, fromId) : null;
    const legal = from && toId && from.owner === 'player' && from.adj.includes(toId);
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
    const open = !!s && s.owner === 'player' && !!SITES[s.kind].train;
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

  return { el, update, dispose() { clear(root); } };
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
