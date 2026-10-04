// World events' live loop (DESIGN 10.13; docs/briefs/phase3-hookup.md §4): runs the events scheduler on ACTIVE play time beside the raid
// scheduler, offers each event in a toast (Accept / Decline and a countdown), and carries out the player's answer: the Merchant's
// choice of deals, the Plague's notice, the Duel's battle. It owns no rules: those are meta/events.js and the battle manager.
//
//   const events = createEventsLoop({ getState, getWorld, manager, ui, services, isActive });
//   events.tick(dtSec)            // every frame from main.js, after the frontier loop
//   events.devOffer(kind)         // dev / checks: offer an event now
import { FEATURES as FLAGS } from './features.js';
import { EVENTS } from '../config/events.js';
import { tickEvents, pendingEvent, acceptEvent, declineEvent, merchantFortPrice, duelRunFor, ensureWorldEvents } from '../meta/events.js';
import { playerBattleStats } from '../meta/progression.js';
import { nearestFreeGeneral } from '../meta/generals.js';
import { fortName, fortsOf, fortMaxLevel } from '../meta/forts.js';
import { FORT_TYPES } from '../config/frontier.js';
import { PLAYER_FACTION } from '../meta/state.js';
import { recordChronicle } from '../meta/chronicle.js';
import { createModal } from '../ui/modal.js';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { shortNumber } from '../ui/format.js';

const TOAST_ID = 'world-event';
const ICONS = { merchant: 'coin', plague: 'candle', duel: 'sword' };

/**
 * @param {{ getState: () => object, getWorld: () => object, manager: object, ui: object, services: object, isActive: () => boolean,
 *   inTutorial?: () => boolean }} deps
 */
export function createEventsLoop({ getState, getWorld, manager, ui, services, isActive, inTutorial = () => false }) {
  let lastSec = -1;
  let closedId = null; // the offer whose toast the player closed with its x: its countdown stops re-opening it

  const secondsLeft = (ev) => Math.max(0, Math.ceil(ev.expiresAt - ensureWorldEvents(getState()).activeSec));
  const regionName = (id) => (getWorld().regions[id] ? getWorld().regions[id].name : 'a region');

  function offerText(ev) {
    const title = EVENTS.copy.titles[ev.kind] || 'News';
    const left = secondsLeft(ev);
    if (ev.kind === 'merchant') return `${title}: ${ev.text.replace(/^A merchant offers /, 'offers ')} Or a fortification level at half price. ${left} s.`;
    if (ev.kind === 'plague') return `${ev.text}`;
    return `${ev.text} ${left} s to answer.`;
  }

  function toastOffer(ev) {
    if (closedId === ev.id && !ui.toasts.has?.(TOAST_ID)) return;
    const plague = ev.kind === 'plague';
    ui.toasts.update({
      id: TOAST_ID, className: 'is-event', type: plague ? 'warning' : 'info', icon: ICONS[ev.kind] || 'bell', message: offerText(ev),
      duration: plague ? 12000 : (secondsLeft(ev) + 2) * 1000,
      // the Plague is news, already applied: one button to acknowledge it (meta/events.js: Accept and Decline only dismiss it)
      action: plague ? { label: 'OK', ariaLabel: 'Dismiss the news of the Plague', onClick: () => answer(ev.id, 'decline') }
        : { label: ev.kind === 'merchant' ? 'See deals' : 'Accept', ariaLabel: ev.kind === 'merchant' ? 'See the merchant’s deals' : 'Accept the duel', onClick: () => answer(ev.id, 'accept') },
      secondary: plague ? undefined : { label: 'Decline', ariaLabel: `Decline the ${ev.kind === 'merchant' ? 'merchant' : 'duel'}`, onClick: () => answer(ev.id, 'decline') },
    });
  }

  function chronicle(text, regionId) {
    try { recordChronicle(getState(), { kind: 'event', t: Date.now(), data: { text, regionId } }); } catch (err) { console.warn('[chronicle] event line skipped:', err); }
  }

  function onOffered(ev) {
    closedId = null;
    const world = getWorld();
    toastOffer(ev);
    services.sfx?.play('reveal', { volume: 0.7 });
    services.tutorial?.notify('eventOffered');
    if (ev.kind === 'duel') {
      try { services.speak?.('battleStart', ev.faction, ev.regionId); } catch { /* a leader line is a nicety */ }
      chronicle(`${ev.leader || 'A rival champion'} of the ${world.factions[ev.faction] ? world.factions[ev.faction].name : 'rivals'} challenged you to a duel at ${regionName(ev.regionId)}.`, ev.regionId);
    } else if (ev.kind === 'plague') {
      try { services.speak?.('plague', ev.faction, undefined, `plague-${ev.id}`); } catch { /* a leader line is a nicety */ } // the plagued leader complains (PLAN-PHASE4 §4E)
      chronicle(`Plague swept the lands of the ${world.factions[ev.faction] ? world.factions[ev.faction].name : 'rivals'}.`);
      services.markMapDirty?.();
    } else {
      const grumbler = merchantGrumbler();
      if (grumbler != null) { try { services.speak?.('merchant', grumbler, undefined, `merchant-${ev.id}`); } catch { /* a nicety */ } } // a neighbour grumbles about the caravan
      chronicle('A merchant caravan came to the realm.');
    }
    services.onEventOffered?.(ev);
  }

  /** A rival leader you have met who still holds land beside you: the one who grumbles about the caravan (the lowest id, so it is stable). */
  function merchantGrumbler() {
    const state = getState();
    const world = getWorld();
    const met = new Set(state.metFactions || []);
    const border = new Set();
    for (const r of world.regions) {
      if (state.owner[r.id] !== PLAYER_FACTION) continue;
      for (const n of r.neighbors) { const o = state.owner[n]; if (o > 1 && met.has(o)) border.add(o); }
    }
    const list = [...border].sort((a, b) => a - b);
    return list.length ? list[0] : null;
  }

  /** The player's answer to the open offer (from the toast's buttons, or a check). */
  function answer(id, choice) {
    const state = getState();
    const ev = pendingEvent(state);
    if (!ev || ev.id !== id) return false;
    if (choice === 'decline') {
      declineEvent(state);
      ui.toasts.dismissId?.(TOAST_ID);
      services.autosave?.save();
      services.tutorial?.notify('eventAnswered');
      return true;
    }
    if (ev.kind === 'merchant') { openMerchant(ev); return true; }
    if (ev.kind === 'duel') return startDuel(ev);
    acceptEvent(state, getWorld(), {}, Date.now());
    return true;
  }

  /** Accept a Duel: the event is taken and its battle starts at once (meta/events.js duelRunFor -> manager.start), with the free General nearest the region. */
  function startDuel(ev) {
    const state = getState();
    const world = getWorld();
    if (manager.list().some((r) => r.regionId === ev.regionId)) { ui.toasts.update({ type: 'warning', message: `A battle is already being fought at ${regionName(ev.regionId)}: the duel must wait.` }); return false; }
    let run = null;
    try {
      const g = nearestFreeGeneral(state, world, ev.regionId, Date.now());
      const commander = g ? (g.id || g) : null;
      const stats = playerBattleStats(state, world, ev.regionId, { commander });
      run = duelRunFor(state, world, ev, stats, { nowMs: Date.now(), busy: manager.busy() });
      run.commander = commander;
      run.champion = ev.leader || null;
    } catch (err) {
      console.warn('[events] the duel could not start:', err && (err.code || err.message));
      ui.toasts.update({ type: 'warning', message: 'The duel could not be fought there.' });
      return false;
    }
    if (!acceptEvent(state, world, {}, Date.now())) return false;
    const started = manager.start(run);
    if (!started) { ui.toasts.update({ type: 'warning', message: 'Too many battles at once: the duel is off.' }); return false; }
    started.champion = run.champion;
    ui.toasts.dismissId?.(TOAST_ID);
    services.tutorial?.notify('eventAnswered');
    services.switchToBattle?.(started.id);
    services.autosave?.save();
    return true;
  }

  // --- the Merchant's two deals ----------------------------------------------------------------------------------------------
  function ownedRegions() {
    const state = getState();
    const out = [];
    for (let i = 0; i < state.owner.length; i++) if (state.owner[i] === PLAYER_FACTION) out.push(i);
    return out;
  }

  /** The fortification deals that are possible: [{ regionId, type, price, level }] (a type at its top level is not offered). */
  function fortDeals() {
    const state = getState();
    const world = getWorld();
    const out = [];
    for (const regionId of ownedRegions()) {
      for (const type of FORT_TYPES) {
        const price = merchantFortPrice(state, world, regionId, type);
        if (!Number.isFinite(price)) continue;
        const f = fortsOf(state, regionId).find((x) => x.type === type);
        if (f && f.level >= fortMaxLevel(type)) continue;
        out.push({ regionId, type, price, level: f ? f.level + 1 : 1 });
      }
    }
    return out;
  }

  let merchantModal = null;
  function openMerchant(ev) {
    if (merchantModal) return;
    const state = getState();
    const world = getWorld();
    const renownDeal = ev.deals.find((d) => d.deal === 'renown');
    const status = h('p.merchant-status', { role: 'status' }, '');
    const regionSel = h('select.merchant-region', { 'aria-label': 'Region for the fortification' });
    const typeSel = h('select.merchant-type', { 'aria-label': 'Fortification' });
    const fortPrice = h('span.merchant-price', {}, '');
    const deals = fortDeals();
    const regions = [...new Set(deals.map((d) => d.regionId))].sort((a, b) => world.regions[a].name.localeCompare(world.regions[b].name));
    for (const id of regions) regionSel.appendChild(h('option', { value: String(id) }, world.regions[id].name));
    function fillTypes() {
      const rid = Number(regionSel.value);
      typeSel.replaceChildren(...deals.filter((d) => d.regionId === rid).map((d) => h('option', { value: d.type }, `${fortName(d.type)}${d.level > 1 ? ` ${['', 'I', 'II', 'III'][d.level] || d.level}` : ''}`)));
      priceText();
    }
    function chosen() { return deals.find((d) => d.regionId === Number(regionSel.value) && d.type === typeSel.value) || null; }
    function priceText() { const d = chosen(); fortPrice.textContent = d ? `${shortNumber(d.price)} gold` : ''; buyFort.disabled = !d || state.gold < d.price; }
    regionSel.addEventListener('change', fillTypes);
    typeSel.addEventListener('change', priceText);
    const buyRenown = h('button.btn.btn-primary.merchant-buy-renown', { type: 'button', onClick: () => take({ deal: 'renown' }) },
      h('span', {}, `Buy ${renownDeal.renown} Renown for ${shortNumber(renownDeal.gold)} gold`));
    buyRenown.disabled = state.gold < renownDeal.gold;
    const buyFort = h('button.btn.btn-primary.merchant-buy-fort', { type: 'button', onClick: () => { const d = chosen(); if (d) take({ deal: 'fort', regionId: d.regionId, type: d.type }); } }, 'Buy');
    const body = h('div.merchant-body', {},
      h('p.merchant-intro', {}, 'A caravan stops at your gates with one deal to make. Choose one, or send it on its way.'),
      h('section.merchant-deal', {}, h('h3', {}, icon('laurel', 16), 'Renown'), h('p', {}, `${renownDeal.renown} Renown, for gold.`), buyRenown),
      h('section.merchant-deal', {}, h('h3', {}, icon('castle', 16), 'A fortification'),
        regions.length
          ? h('div.merchant-fort-row', {}, regionSel, typeSel, fortPrice, buyFort)
          : h('p', {}, 'Every fortification of yours is at its top level.')),
      status);
    function take(choice) {
      const res = acceptEvent(getState(), getWorld(), choice, Date.now());
      if (!res) { status.textContent = 'Not enough gold for that deal.'; services.sfx?.play('error', { volume: 0.6 }); return; }
      services.sfx?.play('coin');
      const what = res.deal === 'renown' ? `${res.renown} Renown` : `${fortName(res.type)} ${['', 'I', 'II', 'III'][res.level] || res.level} at ${regionName(res.regionId)}`;
      close();
      ui.toasts.dismissId?.(TOAST_ID);
      ui.toasts.update({ type: 'success', icon: res.deal === 'renown' ? 'laurel' : 'castle', message: `The merchant's deal: ${what} for ${shortNumber(res.gold)} gold` });
      chronicle(`A merchant sold the realm ${what}.`, res.regionId);
      if (res.deal === 'fort') services.goals?.onFortBuilt(res.regionId, res.type); // the Bounty Board (PLAN-PHASE4 §4A)
      services.tutorial?.notify('eventAnswered');
      services.onRenownChanged?.();
      services.autosave?.save();
    }
    function close() { if (merchantModal) { merchantModal.destroy(); merchantModal = null; } }
    merchantModal = createModal({
      title: EVENTS.copy.titles.merchant,
      body,
      actions: [
        { label: 'Not now', variant: 'secondary', onClick: () => { close(); const e2 = pendingEvent(getState()); if (e2) toastOffer(e2); } },
        { label: 'Send it away', variant: 'secondary', onClick: () => { close(); answer(ev.id, 'decline'); } },
      ],
    }, { onDismiss: () => close() });
    merchantModal.el.classList.add('is-merchant');
    document.body.appendChild(merchantModal.el);
    if (regions.length) fillTypes();
  }

  /** @param {number} dtSec real seconds of this frame */
  function tick(dtSec) {
    if (!FLAGS.frontier || !isActive() || inTutorial()) return;
    const state = getState();
    const world = getWorld();
    const { offered, expired } = tickEvents(state, world, Date.now(), dtSec);
    if (expired) {
      ui.toasts.dismissId?.(TOAST_ID);
      if (merchantModal) { merchantModal.destroy(); merchantModal = null; }
      if (expired.kind !== 'plague') ui.toasts.update({ type: 'info', icon: ICONS[expired.kind], message: expired.kind === 'merchant' ? 'The merchant caravan moved on.' : 'The challenge lapsed.', duration: 2600 });
    }
    if (offered) onOffered(offered);
    // the countdown in the offer's toast, once a second (only while the player has not closed it)
    const sec = Math.floor(ensureWorldEvents(state).activeSec);
    if (sec !== lastSec) {
      lastSec = sec;
      const ev = pendingEvent(state);
      if (ev && ev.kind !== 'plague' && ui.toasts.has?.(TOAST_ID)) toastOffer(ev);
      else if (ev && ev.kind !== 'plague' && !ui.toasts.has?.(TOAST_ID)) closedId = ev.id;
    }
  }

  /**
   * Dev / checks only: offers an event of `kind` now (the scheduler's own makeEvent, through a forced due time). Returns the event or null.
   * @param {'merchant'|'plague'|'duel'} kind
   */
  function devOffer(kind) {
    const state = getState();
    const e = ensureWorldEvents(state);
    if (e.pending) { declineEvent(state); ui.toasts.dismissId?.(TOAST_ID); }
    const saved = { activeSec: e.activeSec, graceSec: EVENTS.graceSec };
    e.activeSec = Math.max(e.activeSec, EVENTS.graceSec);
    e.nextAt = e.activeSec;
    // force the kind: draw until the seeded pick is the one asked for (bounded), else give up
    for (let i = 0; i < 40; i++) {
      const rngBefore = e.rng;
      const seqBefore = e.seq;
      const logBefore = { ...e.log };
      const res = tickEvents(state, getWorld(), Date.now(), 0);
      if (res.offered && res.offered.kind === kind) { onOffered(res.offered); return res.offered; }
      if (res.offered) { e.pending = null; if (res.offered.kind === 'plague') e.plague = null; e.log = logBefore; e.seq = seqBefore; e.rng = rngBefore + i + 1; }
      e.nextAt = e.activeSec;
    }
    void saved;
    return null;
  }

  /**
   * The offer whose toast the player closed (or that slid away) while it is still open to answer, for the HUD's envelope pip (PLAN-PHASE4 §4E):
   * `{ id, kind, label }` or null. The Plague is news already applied, so it never gets a pip.
   */
  function closedOffer() {
    const ev = pendingEvent(getState());
    if (!ev || ev.kind === 'plague' || ui.toasts.has?.(TOAST_ID) || merchantModal) return null;
    const title = EVENTS.copy.titles[ev.kind] || 'An offer';
    return { id: ev.id, kind: ev.kind, label: `${title}: reopen the offer (${secondsLeft(ev)} s left)` };
  }

  /** The envelope pip was pressed: the offer's toast comes back with its countdown and buttons. */
  function reopen() {
    const ev = pendingEvent(getState());
    if (!ev || ev.kind === 'plague') return false;
    closedId = null;
    toastOffer(ev);
    services.sfx?.play('click', { volume: 0.6 });
    return true;
  }

  return { tick, answer, devOffer, closedOffer, reopen, openMerchant: () => { const ev = pendingEvent(getState()); if (ev && ev.kind === 'merchant') openMerchant(ev); }, reset: () => { lastSec = -1; closedId = null; } };
}
