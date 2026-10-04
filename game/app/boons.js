// Phase 7 glue (PLAN-PHASE7, Integration): Boons and Relics between the pure modules (meta/boons.js, meta/relics.js) and the UI kit (ui/boonDraft.js,
// ui/duoReveal.js, ui/relicClaim.js, ui/boonsPanel.js, the HUD chip). Owns no rules: every number and line comes from config through the meta functions.
//
//   services.boons = createBoons({ getState, getWorld, ui, services, sfx, tutorial })
//     afterBattle({ before, regionName, regionId }, then)  the result card's Continue: the Relic claim (if the conquest held one), then the draft (if the
//                                                          battle made a new offer), then `then()` (the scene leaves for the map)
//     openPending()                                        the HUD chip / the Realm panel's "Choose your Boon"
//     tick(sceneName)                                      every frame: a Relic claimed or an offer made off screen (a surrender, a battle nobody watched)
//                                                          gets its moment / its chip and a word, once
//     hudData(), realmData(), relicCard(regionId), relicMarks()   plain data for the HUD, the Realm panel, the region card and the map glints
import { offerBoons, pendingBoons, pickBoon, rerollBoons, rerollBoonsInfo, ownedBoons, duoInfo } from '../meta/boons.js';
import { relicsOnMap, relicAt, relicInfo, reliquary, ownedRelics } from '../meta/relics.js';
import { ensureBoons2, ensureRelics } from '../meta/boonsState.js';
import { BOONS } from '../config/boons.js';
import { ICON_NAMES } from '../ui/icons.js';

// The UI's own mark for every Boon, Duo and Relic (config names a generic icon; these are drawn for Phase 7 in ui/icons.js). Unknown ids fall back to the
// config's icon when the kit has it, else the generic card / chest.
const BOON_ICONS = {
  hitAndRun: 'boonHitRun', engineers: 'boonEngineers', hoard: 'boonWarChest', rallyHorns: 'horn', ironRations: 'boonRations', nightRaiders: 'boonNight',
  tithe: 'boonTithe', bannerBearer: 'boonBannerBearer', pathfinder: 'boonCompass', plunderers: 'boonSack', fortuneFavours: 'boonDice',
  scorchedEarth: 'boonScorched', turncoats: 'boonTurncoat', ambushers: 'boonAmbush', siegecraft: 'boonSiege', dragonbane: 'boonDragonbane',
  gravebreaker: 'boonGravebreaker', secondWind: 'boonSecondWind', phalanx: 'boonPhalanx', bloodPrice: 'boonBlood', martyrsCrown: 'boonMartyr',
  warlordsMark: 'boonWarlord', kingslayer: 'boonKingslayer', oathkeeper: 'boonOath',
  // Duos
  fireArrows: 'boonFireArrows', ghostLegion: 'boonGhost', lightningWar: 'boonLightning', gildedBanners: 'boonGilded',
};
const RELIC_ICONS = {
  dragonBanner: 'relicDragonBanner', crownOfReeve: 'relicReeve', sundial: 'relicSundial', hornOfAges: 'relicHorn', seersLens: 'relicLens',
  blackPennant: 'relicPennant', emberHeart: 'relicEmber', gravewardensLantern: 'relicLantern',
};
const known = new Set(ICON_NAMES);
export function boonIcon(id, cfgIcon) { return BOON_ICONS[id] || (known.has(cfgIcon) ? cfgIcon : 'boonCard'); }
export function relicIcon(id, cfgIcon) { return RELIC_ICONS[id] || (known.has(cfgIcon) ? cfgIcon : 'chest'); }
export { BOON_ICONS, RELIC_ICONS };

/** The pending offer's identity: changes whenever a new draft is made (draws advances) or the offer is taken. */
export function offerSig(state) {
  const b = state && state.boons2;
  if (!b || !b.pending || !Array.isArray(b.pending.choices) || !b.pending.choices.length) return '';
  return `${b.draws}|${b.pending.source}|${b.pending.choices.join(',')}`;
}

export function createBoons({ getState, getWorld, ui, services, sfx, tutorial }) {
  let seenOffer = offerSig(getState());       // the offer the player already knows about (opened, or told by a toast)
  let seenRelics = new Set(ownedIds());       // the Relics whose claim moment has played (or that were held before this session)
  let draftCtx = null;                        // { source, regionName, then } while the draft is open
  let missedNote = false;                     // the replaced-offer note, shown once on the next open
  const claimQueue = [];
  let claimThen = null;

  function ownedIds() {
    const s = getState();
    return s && s.relics && Array.isArray(s.relics.owned) ? s.relics.owned.slice() : [];
  }

  /** A new world (new realm, import, dynasty): forget the bookkeeping. */
  function reset() {
    seenOffer = offerSig(getState());
    seenRelics = new Set(ownedIds());
    wasFoundBefore.clear();
    for (const id of foundIds()) wasFoundBefore.add(id);
    missedNote = false;
    claimQueue.length = 0;
    if (ui.boonDraft && ui.boonDraft.open) ui.boonDraft.hide();
    draftCtx = null;
  }

  // --- the draft -------------------------------------------------------------------------------------------------------------------------------
  function duoHintFor(id) {
    const st = getState();
    const owned = st.boons2 && Array.isArray(st.boons2.owned) ? st.boons2.owned : [];
    const d = duoInfo(st).find((x) => !x.active && x.parts.includes(id) && x.parts.every((p) => p === id || owned.includes(p)));
    return d ? `Completes the Duo ${d.name}` : '';
  }

  function draftData() {
    const st = getState();
    const p = pendingBoons(st);
    if (!p) return null;
    const r = rerollBoonsInfo(st);
    const firstDraft = !(st.boons2 && st.boons2.owned && st.boons2.owned.length) && st.settings.hints !== false;
    return {
      source: p.source === 'champion' ? 'champion' : (draftCtx && draftCtx.source) || 'pending',
      regionName: draftCtx ? draftCtx.regionName : '',
      choices: p.choices.map((c) => ({ id: c.id, name: c.name, rarity: c.rarity, cursed: !!c.cursed, icon: boonIcon(c.id, c.icon), text: c.text, duo: duoHintFor(c.id) })),
      reroll: { cost: r.cost, can: r.can, reason: r.can ? '' : `needs ${r.cost} Renown` },
      note: missedNote || p.missed ? BOONS.copy.missed : '',
      // tutorial K1 (the first draft), a static line inside the dialog (the coach layer sits under dialogs, like D1 in the ceremony)
      hint: firstDraft && !(st.tutorial && st.tutorial.seen && st.tutorial.seen.K1) ? 'Your first Boon: pick the card that suits how you fight. It lasts the dynasty. Not now? Decide later from the Boon chip.' : '',
      laterLabel: draftCtx && draftCtx.then ? 'Decide later' : 'Later',
    };
  }

  function openDraft(ctx) {
    const d = (draftCtx = ctx, draftData());
    if (!d) { draftCtx = null; ctx.then?.(); return false; }
    seenOffer = offerSig(getState());
    ui.boonDraft.update(d);
    ui.boonDraft.show();
    sfx?.play('upgrade', { pitch: 0.8, volume: 0.5 });
    return true;
  }

  function closeDraft() {
    const ctx = draftCtx;
    draftCtx = null;
    missedNote = false;
    ui.boonDraft.hide();
    services.autosave?.save();
    services.onBoonsChanged?.();
    ctx?.then?.();
  }

  function onPick(id) {
    const st = getState();
    const res = pickBoon(st, id);
    if (!res.ok) { ui.toasts.update({ type: 'warning', icon: 'boonCard', message: 'That Boon is no longer on offer.' }); closeDraft(); return; }
    tutorial?.notify('boonPicked');
    seenOffer = offerSig(st);
    sfx?.play('upgrade', { pitch: 1.25, volume: 0.7 });
    ui.boonDraft.celebrate(id, () => {
      if (res.duo) {
        const ctx = draftCtx;
        draftCtx = null;
        ui.boonDraft.hide();
        playDuo(res.duo, () => { draftCtx = ctx; closeDraft(); });
      } else closeDraft();
    });
  }

  function playDuo(duo, then) {
    const parts = duo.parts.map((p) => ownedBoons(getState()).find((b) => b.id === p)).filter(Boolean);
    sfx?.play('victory', { volume: 0.45 });
    duoThen = then;
    ui.duoReveal.play({ id: duo.id, name: duo.name, icon: boonIcon(duo.id, duo.icon), text: duo.text, parts: parts.map((b) => ({ name: b.name, icon: boonIcon(b.id, b.icon) })) });
  }
  let duoThen = null;
  function onDuoDone() { const t = duoThen; duoThen = null; t?.(); }

  function onReroll() {
    const st = getState();
    const res = rerollBoons(st, getWorld());
    if (!res.ok) {
      ui.toasts.update({ type: 'warning', icon: 'laurel', message: res.reason === 'renown' ? `A reroll needs ${res.cost} Renown.` : 'Nothing new to offer.' });
      return;
    }
    seenOffer = offerSig(st);
    sfx?.play('click');
    ui.boonDraft.update(draftData());
    services.onBoonsChanged?.();
    services.autosave?.save();
  }

  function onLater() { closeDraft(); }

  /** Re-reads the open draft (Renown changed elsewhere, a dev hook). */
  function refreshDraft() { if (ui.boonDraft.open) { const d = draftData(); if (d) ui.boonDraft.update(d); } }

  /** The HUD chip / the Realm panel's button: the waiting offer. */
  function openPending() {
    if (ui.boonDraft.open) return;
    if (ui.realm && !ui.realm.el.hidden) ui.realm.el.hidden = true;
    openDraft({ source: 'pending', regionName: '', then: null });
  }

  // --- Relics ----------------------------------------------------------------------------------------------------------------------------------
  function claimView(id) {
    const info = relicInfo(id);
    if (!info) return null;
    return { id, name: info.name, icon: relicIcon(id, info.icon), text: info.text, isNew: foundIds().includes(id) && !wasFoundBefore.has(id) };
  }
  function foundIds() { const st = getState(); return (st && st.generals && st.generals.reliquary && st.generals.reliquary.found) || []; }
  const wasFoundBefore = new Set(foundIds());

  function playNextClaim() {
    const id = claimQueue.shift();
    if (!id) { const t = claimThen; claimThen = null; t?.(); return; }
    const v = claimView(id);
    if (!v) { playNextClaim(); return; }
    sfx?.play('victory', { volume: 0.5, pitch: 1.2 });
    ui.relicClaim.play(v);
    wasFoundBefore.add(id);
  }
  function onClaimDone() { playNextClaim(); }

  function newRelics() {
    return ownedIds().filter((id) => !seenRelics.has(id));
  }

  /** The result card's Continue after a win: the Relic's moment, then the draft (when this battle made a new offer), then `then`. */
  /** Checks only (`?dev=1` under tools/check.mjs and tools/hints.mjs): the moments wait on the chip, so older flows' Continue still reaches the map. */
  function momentsOff() {
    return typeof window !== 'undefined' && window.__HD_TEST_NO_BOON_MOMENTS === true && /[?&]dev=1/.test(window.location.search);
  }

  // Moments held for the post-battle sequence (a capital's recruit card): opened one at a time after the Relic claim, before the draft
  let collecting = false;
  const held = [];
  /** The battle scene calls it just before applying a watched win (manager.finish): moments raised meanwhile wait for afterBattle. */
  function beginSequence() { collecting = true; held.length = 0; }
  /** Queues `fn(done)` when a sequence is collecting; false = not collecting (the caller shows it at once). */
  function holdMoment(fn) { if (!collecting) return false; held.push(fn); return true; }
  function runHeld(then) {
    const fn = held.shift();
    if (!fn) { then(); return; }
    let called = false;
    fn(() => { if (called) return; called = true; runHeld(then); });
  }

  function afterBattle({ before, regionName } = {}, then) {
    collecting = false;
    if (momentsOff()) { seenRelics = new Set(ownedIds()); runHeld(() => then?.()); return; }
    const offered = offerSig(getState());
    if (offered && offered !== before) seenOffer = offered; // this card shows it: no "A Boon awaits" toast while the Relic's moment plays
    const fresh = newRelics();
    for (const id of fresh) { seenRelics.add(id); claimQueue.push(id); }
    const goDraft = () => {
      const sig = offerSig(getState());
      if (sig && sig !== before) {
        const p = getState().boons2.pending;
        missedNote = !!p.missed;
        openDraft({ source: 'victory', regionName, then });
      } else then?.();
    };
    const next = () => runHeld(goDraft);
    if (claimQueue.length) { claimThen = next; playNextClaim(); } else next();
  }

  /** Every frame: an off-screen offer gets its chip and one word; a Relic claimed off screen (a surrender, a Quick Conquest, an unwatched battle) plays its moment on the map. */
  function tick(scene) {
    const st = getState();
    if (!st) return;
    const sig = offerSig(st);
    if (sig && sig !== seenOffer && !draftCtx) {
      seenOffer = sig;
      if (st.boons2.pending.missed) missedNote = true;
      ui.toasts.update({ id: 'boon-pending', type: 'info', icon: 'boonCard', message: st.boons2.pending.source === 'champion' ? "The Champion's eye: a Rare-or-better Boon awaits. Tap the Boon chip." : 'A Boon awaits: tap the Boon chip to choose it.', duration: 5200 });
    }
    if (momentsOff()) seenRelics = new Set(ownedIds());
    if (scene === 'world' && !ui.relicClaim.playing && !ui.duoReveal.playing && !ui.boonDraft.open && !document.documentElement.hasAttribute('data-dialog')) {
      const fresh = newRelics();
      if (fresh.length) { for (const id of fresh) { seenRelics.add(id); claimQueue.push(id); } playNextClaim(); }
    }
  }

  // --- plain data ------------------------------------------------------------------------------------------------------------------------------
  function hudData() {
    const p = pendingBoons(getState());
    return { boonPending: p && !(ui.boonDraft && ui.boonDraft.open) ? { champion: p.source === 'champion' } : null };
  }

  function realmData() {
    const st = getState();
    const boons = ownedBoons(st).map((b) => ({ id: b.id, name: b.name, frame: b.cursed ? 'cursed' : b.rarity, icon: boonIcon(b.id, b.icon), text: b.text }));
    const duos = duoInfo(st).filter((d) => d.active).map((d) => ({ id: d.id, name: d.name, frame: 'duo', icon: boonIcon(d.id, d.icon), text: d.text }));
    const relics = ownedRelics(st).map((r) => ({ id: `relic:${r.id}`, name: r.name, frame: 'relic', icon: relicIcon(r.id, r.icon), text: r.text }));
    const q = reliquary(st);
    const unlocked = boons.length > 0 || !!pendingBoons(st) || (st.dynasty && st.dynasty.level > 1) || (st.stats && st.stats.battlesWon >= 2);
    return {
      boonStrip: unlocked || relics.length ? { owned: [...boons, ...duos, ...relics], pending: !!pendingBoons(st) } : null,
      reliquary: q.found > 0 || relicsOnMap(st).length ? { found: q.found, total: q.total, slots: q.items.map((x) => ({ id: x.id, name: x.name, icon: relicIcon(x.id, x.icon), text: x.text, found: x.found, owned: x.owned })) } : null,
    };
  }

  /** The region card's Relic line (shown before you commit), or null. */
  function relicCard(regionId) {
    const id = relicAt(getState(), regionId);
    if (!id) return null;
    const info = relicInfo(id);
    return { id, name: info.name, icon: relicIcon(id, info.icon), text: info.text };
  }

  /** The map's glinting chests: region ids holding an unclaimed Relic. */
  function relicMarks() { return relicsOnMap(getState()).map((x) => x.regionId); }

  // --- dev hooks (checks and shots; `?dev=1`) -------------------------------------------------------------------------------------------------
  /** An offer now: `choices` (Boon ids) as given, or a seeded draft of `source` ('battle' | 'champion'). Returns the pending choices. */
  function devOffer(choices, source = 'battle') {
    const st = getState();
    if (Array.isArray(choices) && choices.length) { const b = ensureBoons2(st); b.pending = { choices: choices.slice(0, 3), source }; }
    else offerBoons(st, getWorld(), typeof choices === 'string' ? choices : source);
    services.onBoonsChanged?.();
    return st.boons2.pending ? st.boons2.pending.choices.slice() : null;
  }
  /** Owns these Boons at once (no draft). */
  function devGrant(ids) {
    const b = ensureBoons2(getState());
    for (const id of ids || []) if (!b.owned.includes(id)) b.owned.push(id);
    services.onBoonsChanged?.();
    return b.owned.slice();
  }
  /** Puts `relicId` in `regionId` (an unowned region), replacing whatever lay there. */
  function devPlaceRelic(regionId, relicId) {
    const r = ensureRelics(getState());
    for (const k of Object.keys(r.placed)) if (r.placed[k] === relicId) delete r.placed[k];
    r.owned = r.owned.filter((x) => x !== relicId);
    r.placed[regionId] = relicId;
    services.onBoonsChanged?.();
    return { ...r.placed };
  }

  return {
    devOffer, devGrant, devPlaceRelic, refreshDraft, beginSequence, holdMoment,
    afterBattle, openPending, tick, reset, hudData, realmData, relicCard, relicMarks, draftData,
    onPick, onReroll, onLater, onDuoDone, onClaimDone, playDuo,
    get draftOpen() { return !!(ui.boonDraft && ui.boonDraft.open); },
    snapshot: () => offerSig(getState()),
  };
}
