// World scene (DESIGN §2-3, §5, ARCHITECTURE §9, PLAYFEEL §2): the living,
// interactive continent — HUD, region selection/attack/surrender, War Council,
// Realm, idle pops, fog of the unknown, the conquest flood, tutorial steps 0-2
// and 6.
import { hexDistance } from '../core/hex.js';
import { drawHexTint, elevOffset } from '../render/tiles.js';
import { ACCENTS, factionColor } from '../render/palette.js';
import {
  frontier, revealed, difficulty, conquer, canFoundDynasty,
} from '../meta/progression.js';
import { incomePerSec, bounty } from '../meta/economy.js';
import {
  UPGRADES, levelOf, upgradeCost, canBuy, buy, buyMax,
} from '../meta/upgrades.js';
import { PLAYER_FACTION } from '../meta/state.js';
import {
  parFor, getCrowns, crownCount, awardCrowns, crownsForSurrender, crownTotals,
} from '../meta/crowns.js';
import { newContacts, markMet, seedContacts } from '../meta/leaders.js';
import {
  intelPanelData, intelOf, scoutReport, scout, sabotage, intelToast, sabotagePercent, clearRegionIntel,
} from '../meta/intel.js';
import { drawScoutedGarrisons, drawWeakPointMarker } from '../render/intelMarks.js';
import { prosperityInfo } from '../meta/prosperity.js';
import { CROWN_BONUS_PCT } from '../app/crownCopy.js';
import { shortNumber } from '../ui/format.js';
import { perkDisplay, dynastyStarText } from '../app/perkInfo.js';
import { bestValueUpgrade } from '../app/bestValue.js';
import { effectiveRegionIncome } from '../app/income.js';
import { drawRegionLabels } from '../render/labels.js';
import { WORLD_SCENE, VICTORY, TUTORIAL_STEPS } from './timing.js';
import {
  createSiteDrawer, pickLandTile, regionLabelAnchors, realmFraming, frameInRect, freeRect, openCameraLimits,
} from './worldLayers.js';

const FOG_FADE_SEC = 1.6;
const DERIVED_REFRESH_MS = 300;
const CARD_SETTLE_MS = 520; // the dock / sheet animation is 260-300 ms, plus a frame or two of camera nudge
const SURRENDER_HINT = 'Accept their surrender, or attack for crowns!';
const CONTACT_RETRY_MS = 1000; // a first contact blocked by a hint or the 15 s gap is offered again
const CONTACT_AFTER_CONQUEST_MS = 1200; // lands when the mists part

/**
 * @param {object} services shared instances from main.js
 */
export function createWorldScene(services) {
  const {
    camera, renderer, ui, input, container, sfx, tutorial, goto,
  } = services;

  let hoveredRegionId = null;
  let selectedRegionId = null;
  let fogAlpha = 1;
  let enteredAtMs = 0;
  let visualOwners = [];
  let flood = null; // active conquest flood, see beginFlood()
  let creditHold = null; // { amount, releaseAtMs } bounty not yet shown on the HUD
  let lastHudMs = -1e9;
  let lastCouncilMs = -1e9;
  let lastRealmMs = -1e9;
  let contactCheckAtMs = 0;
  let nextCelebrationMs = 0; // one prosperity celebration per 0.7 s
  let lastAmbientMs = -1e9;
  let visualLevels = []; // region id -> prosperity level drawn (0 under fog, mid-flood and for anything not yours)
  let coachSig = '';
  let cardOpenedAtMs = -1e9; // when the region card last opened: its slide-in (and the camera nudge) must finish before a hint anchors to it
  let coachAt = 0;
  let nudgeRaf = 0;
  const newFrontier = new Map(); // region id -> ms when its 'newly attackable' pulse begins

  // Per-world caches (rebuilt when the world object changes).
  let cachedWorld = null;
  let siteDrawer = null;
  let anchors = [];

  // Values derived from state (revealed/frontier/labels/difficulty). They only
  // change on conquests and upgrade purchases, so they refresh on a timer or
  // when marked dirty instead of every frame.
  const derived = {
    key: '', atMs: -1e9, dirty: true,
    revealed: [], frontier: [], hidden: [], labels: [],
    scouted: [], // [{ id, report }] scouted frontier regions, for the garrison badges and the weak-point ring
  };

  function ensureWorldCaches() {
    const world = container.get().world;
    if (cachedWorld === world) return;
    cachedWorld = world;
    siteDrawer = createSiteDrawer(world);
    anchors = regionLabelAnchors(world);
    derived.dirty = true;
  }

  function markDirty() { derived.dirty = true; }

  function refreshDerived(nowMs) {
    const { state, world } = container.get();
    const key = state.owner.join(',');
    if (!derived.dirty && key === derived.key && nowMs - derived.atMs < DERIVED_REFRESH_MS) return;
    derived.dirty = false;
    derived.key = key;
    derived.atMs = nowMs;
    derived.revealed = revealed(state, world);
    derived.frontier = frontier(state, world);
    derived.hidden = [];
    for (const r of world.regions) if (!derived.revealed[r.id]) derived.hidden.push(r.id);
    const labels = [];
    const frontierSet = new Set(derived.frontier);
    for (const region of world.regions) {
      const isRevealed = derived.revealed[region.id] || services.devRevealAll;
      if (!isRevealed) continue;
      const a = anchors[region.id];
      const owned = state.owner[region.id] === PLAYER_FACTION;
      const rivalCapital = region.isCapital && !owned;
      const datum = { x: a.x, y: a.y, name: region.name, isCapital: rivalCapital, regionId: region.id };
      // Placement priority (labels.js): selected 0 > frontier 1 > rival capital 2 > owned 3 > the rest 4.
      if (frontierSet.has(region.id)) { datum.difficulty = difficulty(state, world, region.id); datum.kind = 1; }
      else if (rivalCapital) datum.kind = 2;
      else if (owned) datum.kind = 3;
      else datum.kind = 4;
      // Earned crowns show as pips under the name (owned regions only; the home region has none).
      if (owned) datum.crowns = crownCount(getCrowns(state, region.id));
      else datum.sabotage = intelOf(state, region.id).sabotage; // a torch by the name of a sabotaged region
      datum.priority = datum.kind;
      labels.push(datum);
    }
    derived.labels = labels;

    // Scout reports are cached per (region, ownership, sabotage, stats) in meta/intel.js, so this is cheap.
    derived.scouted = [];
    for (const [key, entry] of Object.entries(state.intel || {})) {
      const id = Number(key);
      if (!entry.scouted || state.owner[id] === PLAYER_FACTION || !isVisibleRegion(id)) continue;
      const report = scoutReport(state, world, id);
      if (report) derived.scouted.push({ id, report });
    }
  }

  function isVisibleRegion(regionId) {
    if (services.devRevealAll) return true;
    return regionId < 0 || derived.revealed[regionId] || renderer.clouds.isRevealing(regionId);
  }

  // --- geometry / lookups -----------------------------------------------------
  function regionAt(wx, wy) {
    const world = container.get().world;
    const tile = pickLandTile(world, wx, wy);
    return tile && tile.region >= 0 ? tile.region : null;
  }

  // --- view-model builders -----------------------------------------------------
  function regionCardData(regionId) {
    const { state, world } = container.get();
    const region = world.regions[regionId];
    const isRevealed = derived.revealed[regionId] || services.devRevealAll;
    if (!isRevealed) return { id: regionId, name: '???', tier: region.tier, locked: true };

    const ownerFactionId = state.owner[regionId];
    const ownerFaction = world.factions[ownerFactionId];
    const owner = { name: ownerFaction.name, color: ownerFaction.color, emblem: ownerFaction.emblem };
    const perk = perkDisplay(region.perk, world, region);
    if (ownerFactionId === PLAYER_FACTION) {
      return {
        id: regionId, name: region.name, tier: region.tier, owned: true, owner, perk,
        income: effectiveRegionIncome(state, world, region),
        crowns: region.tier === 0 ? undefined : getCrowns(state, regionId),
        parSec: parFor(world, regionId, state),
        crownBonusPct: CROWN_BONUS_PCT,
        prosperity: (() => {
          const p = prosperityInfo(state, regionId, Date.now());
          return { level: p.level, label: p.label, nextInMs: p.nextInMs, bonusPct: Math.round(p.incomeBonus * 100) };
        })(),
      };
    }
    return {
      id: regionId,
      name: region.name,
      tier: region.tier,
      owned: false,
      owner,
      perk,
      income: effectiveRegionIncome(state, world, region),
      bounty: bounty(state, world, regionId),
      difficulty: difficulty(state, world, regionId),
      intel: intelPanelData(state, world, regionId),
      parSec: parFor(world, regionId, state),
      crownBonusPct: CROWN_BONUS_PCT,
    };
  }

  let cardOffersSurrender = false; // the open card shows Accept Surrender instead of Attack

  function refreshRegionCard() {
    if (selectedRegionId == null) return null;
    const data = regionCardData(selectedRegionId);
    ui.regionCard.update(data);
    cardOffersSurrender = !!(data.difficulty && data.difficulty.surrender);
    return data;
  }

  function hudGoldCenter() {
    const el = ui.hud.el.querySelector('.hud-gold-icon');
    const r = el ? el.getBoundingClientRect() : { left: 40, top: 30, width: 0, height: 0 };
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  /** Pushes gold/income to the HUD: idle drift is `quiet` (no pulse), events pass `pulse`. */
  function updateHud(nowMs, { pulse = false, force = false } = {}) {
    if (!force && !pulse && nowMs - lastHudMs < 250) return;
    lastHudMs = nowMs;
    const { state, world } = container.get();
    // A welcome-back hold ends when the card goes away by any route (Collect starts the coin flight; Escape or a
    // scene change just releases it), so the counter can never stay short.
    if (creditHold && creditHold.welcome && !creditHold.collecting && ui.welcome.el.hidden) creditHold.releaseAtMs = nowMs;
    if (creditHold && nowMs >= creditHold.releaseAtMs) {
      creditHold = null;
      pulse = true;
    }
    const shown = state.gold - (creditHold ? creditHold.amount : 0);
    ui.hud.update({ gold: shown, incomePerSec: incomePerSec(state, world), dynastyStars: state.dynasty.stars, pulse, quiet: !pulse });
  }

  // "Best value": the one Army upgrade that raises Army Power the most per gold (game/app/bestValue.js). Recomputed on purchase and, while the council
  // is open, at most once a second (gold, conquests and the frontier move it); the council only ever receives the id.
  let bestValueId = null;
  let bestValueAtMs = -1e9;
  function refreshBestValue(nowMs, force) {
    if (!force && nowMs - bestValueAtMs < 1000) return;
    bestValueAtMs = nowMs;
    const { state, world } = container.get();
    const best = bestValueUpgrade(state, world);
    bestValueId = best ? best.id : null;
  }

  function councilRow(id) {
    const { state } = container.get();
    const def = UPGRADES[id];
    const level = levelOf(state, id);
    const locked = def.tab === 'powers' && level < 1;
    const maxed = def.max != null && level >= def.max;
    return {
      id, tab: def.tab, icon: def.icon, name: def.name, desc: def.desc, level,
      max: def.max ?? null, locked,
      current: locked ? 'Locked' : def.effectText(level),
      next: maxed ? null : def.effectText(level + 1),
      cost: maxed ? null : upgradeCost(id, level),
      affordable: !maxed && canBuy(state, id),
      bestValue: id === bestValueId,
    };
  }

  function updateCouncil(force = false) {
    refreshBestValue(performance.now(), force);
    ui.council.update({ upgrades: Object.keys(UPGRADES).map(councilRow) });
  }

  function updateRealm() {
    const { state } = container.get();
    const { world } = container.get();
    ui.realm.update({
      stats: state.stats, dynasty: { ...state.dynasty, starText: dynastyStarText() }, canFoundDynasty: canFoundDynasty(state),
      crowns: crownTotals(state, world),
    });
  }

  // --- selection ----------------------------------------------------------------
  function setSelected(id) {
    if (id != null && (id !== selectedRegionId || ui.regionCard.dock.hidden)) cardOpenedAtMs = performance.now();
    selectedRegionId = id;
    ui.regionCard.dock.hidden = id == null;
    if (id == null) return;
    const data = refreshRegionCard();
    tutorial.notify('regionSelected');
    // A region that would surrender: its leader offers, once per region (selection only, not the card's 1 s refresh).
    if (data && data.difficulty && data.difficulty.surrender) {
      services.speak('surrenderOffer', container.get().state.owner[id], id, id);
    }
    if (!nudgeRaf) nudgeRaf = requestAnimationFrame(() => { nudgeRaf = 0; nudgeCameraClearOfCard(); });
  }

  /**
   * After selecting a region, ease the camera just enough that it is not under the card (right
   * column on desktop, bottom sheet on phones): the region's anchor must land inside the part of the
   * screen the card leaves free, with a comfortable inset.
   */
  function nudgeCameraClearOfCard() {
    if (selectedRegionId == null || ui.regionCard.dock.hidden) return;
    const a = anchors[selectedRegionId];
    if (!a) return;
    const W = renderer.cssWidth;
    const H = renderer.cssHeight;
    const dock = ui.regionCard.dock.getBoundingClientRect();
    const sheet = dock.width > W * 0.7;
    const rect = freeRect(W, H);
    // Use the card's real footprint, not the reserved default.
    if (sheet) rect.y1 = Math.min(rect.y1, dock.top - 12);
    else rect.x1 = Math.min(rect.x1, dock.left - 16);
    const inset = 56;
    const p = camera.worldToScreen(a.x, a.y);
    const tx = Math.max(rect.x0 + inset, Math.min(rect.x1 - inset, p.x));
    const ty = Math.max(rect.y0 + inset, Math.min(rect.y1 - inset, p.y));
    if (Math.abs(tx - p.x) < 1 && Math.abs(ty - p.y) < 1) return;
    // Aim for the middle of the free area, not just its edge, so the region sits comfortably.
    const cx = (rect.x0 + rect.x1) / 2;
    const cy = (rect.y0 + rect.y1) / 2;
    const gx = tx + (cx - tx) * 0.5;
    const gy = ty + (cy - ty) * 0.5;
    camera.flyTo({ x: camera.x + (p.x - gx) / camera.zoom, y: camera.y + (p.y - gy) / camera.zoom, zoom: camera.zoom }, 420, 'outCubic');
  }

  // --- conquest choreography ---------------------------------------------------------
  /** Region tiles ordered by distance from the keep; drives the flood. */
  function beginFlood(regionId, oldOwner, startMs) {
    const { world } = container.get();
    const region = world.regions[regionId];
    const keepTile = world.tiles[world.settlements[region.keep].tile];
    const tiles = region.tiles
      .map((i) => world.tiles[i])
      .filter((t) => t.land)
      .map((tile) => ({ tile, dist: hexDistance(tile.q, tile.r, keepTile.q, keepTile.r) }))
      .sort((a, b) => a.dist - b.dist);
    const maxDist = tiles.length ? tiles[tiles.length - 1].dist : 0;
    flood = {
      regionId, oldOwner, tiles, startMs,
      endMs: startMs + maxDist * VICTORY.floodMsPerHex + VICTORY.floodShimmerMs,
      spawned: new Set(),
    };
  }

  function applyConquestVisuals(regionId, beforeRevealed, gained, opts = {}) {
    const { state, world } = container.get();
    const region = world.regions[regionId];
    const keepTile = world.tiles[world.settlements[region.keep].tile];
    const now = performance.now();
    contactCheckAtMs = now + CONTACT_AFTER_CONQUEST_MS; // a newly met leader speaks as the mists part

    const frontierBefore = new Set(opts.frontierBefore || derived.frontier);
    if (!opts.fromBattle) {
      // An instant surrender plays the whole conquest here; after a real battle the shockwave,
      // surrender cascade and flood already happened on the arena itself.
      beginFlood(regionId, opts.oldOwner ?? 1, now);
      renderer.fx.spawn('shockwave', keepTile.x, keepTile.y, {
        color: factionColor(PLAYER_FACTION), growth: 4.5, duration: 0.7, thickness0: 0.12, thickness1: 0.03,
      });
      renderer.fx.spawn('burst', keepTile.x, keepTile.y, { color: factionColor(PLAYER_FACTION) });
      renderer.fx.shake(region.isCapital ? 0.55 : 0.32, 0.35);
      sfx.play('capture');
    }

    // Coins arc from the keep to the HUD counter; the bounty is credited (and the
    // counter rolls up) when the first coin lands.
    const flightMs = VICTORY.coinFlightMs;
    renderer.fx.spawn('coins', keepTile.x, keepTile.y, {
      toScreen: hudGoldCenter(), count: VICTORY.coinCount, duration: flightMs / 1000,
    });
    sfx.play('coin', { volume: 0.55 });
    creditHold = { amount: gained, releaseAtMs: now + flightMs };
    updateHud(now, { force: true });

    // The mists part over newly revealed neighbours, staggered.
    const after = revealed(state, world);
    let i = 0;
    for (const r of world.regions) {
      if (!beforeRevealed[r.id] && after[r.id]) {
        renderer.clouds.revealRegion(r.id, now + 250 + i * VICTORY.cloudPartStaggerMs);
        i++;
      }
    }
    if (i > 0) setTimeout(() => sfx.play('reveal'), 300);
    markDirty();
    refreshDerived(now);
    // Regions that just became attackable start pulsing once the mists have parted: a brief extra-bright pulse.
    for (const id of derived.frontier) {
      if (!frontierBefore.has(id)) newFrontier.set(id, now + 900 + Math.max(0, i - 1) * VICTORY.cloudPartStaggerMs * 0.5);
    }

    if (!opts.keepCamera) {
      flyToRealm(VICTORY.pullBackMs);
    }
  }

  function drawFlood(ctx, nowMs) {
    if (!flood) return;
    const { world } = container.get();
    const s = camera.zoom;
    const color = factionColor(PLAYER_FACTION);
    for (const { tile, dist } of flood.tiles) {
      const at = flood.startMs + dist * VICTORY.floodMsPerHex;
      if (nowMs < at) continue;
      const k = Math.min(1, (nowMs - at) / VICTORY.floodShimmerMs);
      if (!flood.spawned.has(tile.i)) {
        flood.spawned.add(tile.i);
        renderer.fx.spawn('flood', tile.x, tile.y, { color });
      }
      const p = camera.worldToScreen(tile.x, tile.y);
      drawHexTint(ctx, p.x, p.y - elevOffset(tile, s), s, color, 0.16 + 0.3 * (1 - k));
    }
    void world;
    if (nowMs >= flood.endMs) flood = null;
  }

  // --- callbacks ----------------------------------------------------------------
  function onAttack(regionId) {
    goto.battle({ regionId });
  }

  function onSurrender(regionId) {
    const { state, world } = container.get();
    const beforeRevealed = revealed(state, world);
    const oldOwner = state.owner[regionId];
    ui.leaderBanner.hide(); // the offer has been taken
    const result = conquer(state, world, regionId, Date.now());
    clearRegionIntel(state, regionId); // a conquered region forgets what was scouted and sabotaged
    // Accepting a surrender earns Victory only (DESIGN 4.8), one crown of bonus bounty.
    const crownAward = awardCrowns(state, world, regionId, crownsForSurrender(), result.bounty);
    state.stats.surrenders += 1;
    const gained = result.bounty + crownAward.bonusGold;
    applyConquestVisuals(regionId, beforeRevealed, gained, { oldOwner });
    if (result.decapitated) services.speak('decapitation', oldOwner, regionId); // before the toast: the leader shows first on a phone
    ui.toasts.update({ type: 'success', icon: 'flag', message: `${world.regions[regionId].name} surrendered! +${shortNumber(gained)} gold` });
    setSelected(null);
    services.autosave.save();
  }

  // --- Scout / Sabotage (DESIGN 5.7) ---------------------------------------------------------
  function afterIntel() {
    markDirty(); // label chips and frontier data
    refreshRegionCard(); // the new numbers
    updateHud(performance.now(), { force: true }); // gold went down
    services.autosave.save();
    // A scouted card is taller (the phone sheet grows by about 100 px): keep the region above it.
    requestAnimationFrame(nudgeCameraClearOfCard);
  }

  function onScout(regionId) {
    const { state, world } = container.get();
    const res = scout(state, world, regionId); // { cost } | false: pays and records
    if (!res) { sfx.play('error'); return; }
    sfx.play('click');
    // The leader first, then the toast: on a phone the toast waits until the banner has gone.
    services.speak('scouted', state.owner[regionId], regionId, regionId); // the leader notices; the gate does the rest
    ui.toasts.update({ type: 'info', icon: 'eye', message: intelToast('scouted', { region: world.regions[regionId].name }) });
    afterIntel();
  }

  function onSabotage(regionId) {
    const { state, world } = container.get();
    const res = sabotage(state, world, regionId); // { cost, level } | false
    if (!res) { sfx.play('error'); return; }
    sfx.play('upgrade');
    ui.toasts.update({
      type: 'warning', icon: 'flame',
      message: intelToast('sabotaged', { region: world.regions[regionId].name, pct: sabotagePercent(res.level) }),
    });
    // The leader reacts at the BATTLE START (battle.js), not on purchase.
    afterIntel();
  }

  function onBuy(id) {
    const { state } = container.get();
    const level = buy(state, id);
    if (level) {
      sfx.play('upgrade');
      // one toast for a run of purchases (a spree in the council would otherwise pile four over the map on a phone)
      ui.toasts.update({ id: 'upgrade-bought', type: 'success', message: `${UPGRADES[id].name} → level ${level}` });
    } else {
      sfx.play('error');
    }
    markDirty();
    updateCouncil(true); // a purchase changes which upgrade is the best value now
    updateHud(performance.now(), { force: true });
  }

  function onBuyMax(id) {
    const { state } = container.get();
    const res = buyMax(state, id);
    if (res.levels > 0) {
      sfx.play('upgrade');
      ui.toasts.update({ type: 'success', message: `${UPGRADES[id].name} +${res.levels} levels` });
    } else {
      sfx.play('error');
    }
    markDirty();
    updateCouncil(true);
    updateHud(performance.now(), { force: true });
  }

  function onFoundDynasty() {
    const res = container.tryFoundDynasty();
    if (!res) return;
    services.applyWorld();
    sfx.play('victory');
    ui.toasts.update({ type: 'success', icon: 'crown', message: 'A new dynasty begins. A new continent awaits, with tougher enemies.' });
    enter({ freshRealm: true, newWorld: true });
    services.autosave.save();
  }

  function onCouncilOpen() {
    setSelected(null);
    ui.realm.el.hidden = true;
    ui.council.el.hidden = false;
    updateCouncil(true);
    tutorial.notify('councilOpened');
  }

  function onRealmOpen() {
    setSelected(null);
    ui.council.el.hidden = true;
    ui.realm.el.hidden = false;
    updateRealm();
  }

  function showWelcome(w) {
    ui.welcome.update(w);
    ui.welcome.el.hidden = false;
    // The gold is already in state.gold (credited at boot / on return), but the HUD must not show it before the
    // player has pressed Collect: hold it back, and let the coins carry it up to the counter.
    creditHold = { amount: w.goldEarned, releaseAtMs: Infinity, welcome: true };
    updateHud(performance.now(), { force: true });
  }

  function onWelcomeCollect() {
    ui.welcome.el.hidden = true;
    const { state } = container.get();
    renderer.fx.spawn('coins', camera.x, camera.y, { toScreen: hudGoldCenter(), count: 10, duration: 0.7 });
    sfx.play('coin', { volume: 0.5 });
    if (creditHold && creditHold.welcome) { creditHold.collecting = true; creditHold.releaseAtMs = performance.now() + 700; }
    else ui.hud.update({ gold: state.gold, pulse: true });
  }

  function closeTopPanel() {
    if (!ui.settings.el.hidden) { services.closeSettings(); return true; }
    if (!ui.welcome.el.hidden) { ui.welcome.el.hidden = true; return true; }
    if (!ui.council.el.hidden) { ui.council.el.hidden = true; return true; }
    if (!ui.realm.el.hidden) { ui.realm.el.hidden = true; return true; }
    if (selectedRegionId != null) { setSelected(null); return true; }
    return false;
  }

  // --- input --------------------------------------------------------------------
  function onTap(sx, sy, wx, wy) {
    tutorial.notify('tap');
    const regionId = regionAt(wx, wy);
    if (regionId == null) {
      if (selectedRegionId != null) setSelected(null);
      return;
    }
    if (regionId === selectedRegionId) { setSelected(null); return; }
    sfx.play('click', { volume: 0.5 });
    setSelected(regionId);
  }

  function onHover(sx, sy, wx, wy) {
    const id = regionAt(wx, wy);
    hoveredRegionId = id != null && (derived.revealed[id] || services.devRevealAll) ? id : null;
    renderer.canvas.style.cursor = id != null ? 'pointer' : '';
  }

  function onKey(key) {
    if (key === 'Escape') closeTopPanel();
  }

  function installHandlers() {
    const h = input.handlers;
    for (const k of Object.keys(h)) delete h[k];
    h.onTap = onTap;
    h.onHover = onHover;
    h.onCancel = () => { closeTopPanel(); };
    h.onKey = onKey;
  }

  // --- framing ------------------------------------------------------------------
  /** Frame every owned region plus its nearest frontier regions, centred in the free screen area. */
  function realmTarget() {
    const { state, world } = container.get();
    const phone = services.isPhone();
    const W = renderer.cssWidth;
    const H = renderer.cssHeight;
    const rect = freeRect(W, H);
    const opts = { padding: phone ? 18 : 30, maxZoom: phone ? 22 : 32 };
    const bounds = realmFraming(state, world, camera, rect, { minReadable: phone ? 12 : 19, ...opts });
    return frameInRect(camera, bounds, rect, opts);
  }

  function flyToRealm(ms) {
    camera.flyTo(realmTarget(), ms);
  }

  function applyCameraLimits() {
    const { world } = container.get();
    openCameraLimits(camera);
    const fit = camera.fitZoom(world.bounds, 40);
    const maxZoom = services.isPhone() ? WORLD_SCENE.maxZoomPhone : WORLD_SCENE.maxZoomDesktop;
    camera.setZoomLimits(fit * WORLD_SCENE.minZoomFactor, maxZoom);
    camera.setBounds(world.bounds, WORLD_SCENE.panPaddingWorld);
  }

  // --- scene lifecycle ------------------------------------------------------------
  function enter(payload = {}) {
    const { state, world } = container.get();
    if (state.battle && !payload.skipResume && !payload.cameFromBattle) {
      goto.battle({ resume: true });
      return;
    }
    ensureWorldCaches();
    // Ambient life is off while a battle is on (time stands still: caravans resume where they were).
    renderer.ambient.setEnabled(true);
    renderer.ambient.setHiddenMask((regionId) => !isVisibleRegion(regionId)); // nothing over fog
    nextCelebrationMs = performance.now() + 900; // let the camera settle before the first "prospers!"
    input.setEnabled(true);
    installHandlers();
    services.hideAllPanels();
    ui.hud.el.hidden = false;
    enteredAtMs = performance.now();
    services.pendingIdlePop = null;
    // Starting neighbours are not a "first contact": mark them met silently (new realm, new dynasty, or a
    // save from before leaders existed), so a leader never speaks late, after the tutorial.
    if (!state.metFactions || !state.metFactions.length) seedContacts(state, world);
    contactCheckAtMs = enteredAtMs + 1500;
    markDirty();
    refreshDerived(enteredAtMs);

    applyCameraLimits();
    if (payload.cameFromBattle) {
      fogAlpha = 1;
      // Finishing the first battle skips whatever battle hints were left.
      const tut = state.tutorial;
      if (!tut.done && state.stats.battlesWon >= 1 && tut.step >= 3 && tut.step < 6) tut.step = 6;
      if (payload.conquered) {
        // Continue after a victory: pull back, part the mists, coins to the counter, new frontier pulses.
        const c = payload.conquered;
        selectedRegionId = null; // a clean map for the reveal: the conquered region is simply ours now
        applyConquestVisuals(c.regionId, c.beforeRevealed, c.bounty, { oldOwner: c.oldOwner, fromBattle: true, frontierBefore: c.frontierBefore });
      } else {
        flyToRealm(VICTORY.pullBackMs); // defeat / retreat / back to map
      }
    } else {
      fogAlpha = 0; // the mists roll in over the undiscovered regions
      const target = realmTarget();
      if (payload.newWorld) {
        camera.x = world.bounds.maxX * 0.5; camera.y = world.bounds.maxY * 0.5;
        camera.zoom = camera.fitZoom(world.bounds, 40);
      }
      camera.flyTo(target, payload.freshRealm ? 1500 : 1200);
    }

    if (payload.freshRealm) setSelected(null);
    else if (selectedRegionId != null) setSelected(selectedRegionId);
    else ui.regionCard.dock.hidden = true;
    hoveredRegionId = null;

    if (!payload.cameFromBattle && services.pendingWelcome) {
      const w = services.pendingWelcome;
      services.pendingWelcome = null;
      showWelcome(w);
    }
    updateHud(enteredAtMs, { force: true });
    coachSig = '';
  }

  function exit() {
    ui.hud.el.hidden = true;
    ui.regionCard.dock.hidden = true;
    ui.council.el.hidden = true;
    ui.realm.el.hidden = true;
    ui.welcome.el.hidden = true;
    ui.coach.update({ visible: false });
    renderer.canvas.style.cursor = '';
  }

  // --- tutorial anchors -----------------------------------------------------------
  function resolveAnchor(anchorKey) {
    const { state, world } = container.get();
    if (anchorKey === 'gold') return { el: ui.hud.el.querySelector('.hud-gold-block') };
    if (anchorKey === 'council') return { el: ui.hud.el.querySelector('.hud-btn[aria-label="War Council"]') };
    // Short landscape screens have no room beside the card for the bubble; the button speaks for itself.
    if (anchorKey === 'attack' && renderer.cssHeight < 520) return null;
    if (anchorKey === 'attack' && !ui.regionCard.dock.hidden) {
      const btn = ui.regionCard.el.querySelector('.region-card-action:not([hidden])');
      if (btn) {
        // A point near the button's right end: the coach ring is sized to its target and a
        // full-width button would get a card-sized circle.
        const r = btn.getBoundingClientRect();
        if (services.isPhone()) {
          // Bottom sheet: point at the sheet's top edge so the bubble sits ABOVE the card
          // instead of covering its numbers.
          const d = ui.regionCard.dock.getBoundingClientRect();
          return { x: Math.min(renderer.cssWidth - 60, d.left + d.width * 0.75), y: d.top - 2, side: 'up' };
        }
        // The bubble hangs 26 px under this point, which would land inside the card's bottom padding: push it clear of the card's edge.
        const card = ui.regionCard.el.getBoundingClientRect();
        const gap = Math.max(0, Math.round(card.bottom + 12 - (r.top + r.height / 2 + 26)));
        return { x: r.right - 44, y: r.top + r.height / 2, gap };
      }
    }
    if (anchorKey === 'frontier' || anchorKey === 'attack') {
      const ids = derived.frontier;
      if (ids.length === 0) return null;
      let best = ids[0];
      let bestRatio = -Infinity;
      for (const id of ids) {
        const d = difficulty(state, world, id);
        if (d.ratio > bestRatio) { bestRatio = d.ratio; best = id; }
      }
      const a = anchors[best];
      const p = camera.worldToScreen(a.x, a.y);
      return { x: p.x, y: p.y };
    }
    return null;
  }

  function updateCoach(nowMs) {
    let def = tutorial.currentStepDef();
    // Step 2 ("Attack!") only makes sense with a region card open; without one, keep
    // nudging toward a frontier region instead.
    if (def && def.id === 2 && ui.regionCard.dock.hidden) def = TUTORIAL_STEPS[1];
    // A hint anchored to the card waits for its slide-in to finish (about 0.3 s): no half-second of bubble over a moving card.
    const cardSettling = def && def.id === 2 && nowMs - cardOpenedAtMs < CARD_SETTLE_MS;
    const calm = ui.welcome.el.hidden && ui.settings.el.hidden && !camera.isMoving() && nowMs - enteredAtMs > 900 && !cardSettling;
    // Only steps that make sense on the map show here (3-5 belong to battle).
    const mapStep = def && (def.id <= 2 || def.id === 6);
    // The council hint points at the top-right HUD, where the region card sits: it waits for the card to close.
    const blockedByPanel = def && def.id === 6 && (!ui.council.el.hidden || !ui.realm.el.hidden || !ui.regionCard.dock.hidden);
    if (!def || !mapStep || !calm || blockedByPanel || (def.id <= 1 && !ui.council.el.hidden)) {
      if (coachSig !== 'off') { coachSig = 'off'; ui.coach.update({ visible: false }); }
      return;
    }
    const target = resolveAnchor(def.anchor);
    // A hint pointing at something off-screen or under the HUD bar would only confuse.
    const offscreen = target && target.x != null
      && (target.x < 16 || target.x > renderer.cssWidth - 16 || target.y < 96 || target.y > renderer.cssHeight - 16);
    if (!target || offscreen) {
      if (coachSig !== 'off') { coachSig = 'off'; ui.coach.update({ visible: false }); }
      return;
    }
    // Step 2 says "Attack!": if the card in front of the player offers a surrender instead, say that.
    const surrenderHint = def.id === 2 && cardOffersSurrender;
    const text = surrenderHint ? SURRENDER_HINT : def.text;
    const sig = `${target.el ? `${def.id}|el` : `${def.id}|${Math.round(target.x)},${Math.round(target.y)},${target.gap || 0}`}${surrenderHint ? '|s' : ''}`;
    if (sig === coachSig && nowMs - coachAt < 400) return;
    coachSig = sig;
    coachAt = nowMs;
    ui.coach.update({ visible: true, text, target });
  }

  // --- frame ----------------------------------------------------------------------
  function frame(dt, t, nowMs) {
    camera.update(dt);
    ensureWorldCaches();
    refreshDerived(nowMs);
    const { state, world } = container.get();
    const { ctx } = renderer;
    const fx = renderer.fx;

    if (fogAlpha < 1) fogAlpha = Math.min(1, fogAlpha + dt / FOG_FADE_SEC);

    // Territory as the player should currently SEE it: a region mid-flood still
    // shows its old owner underneath the live flood overlay.
    if (visualOwners.length !== state.owner.length) { visualOwners = new Array(state.owner.length); visualLevels = new Array(state.owner.length).fill(0); }
    const showAll = services.devRevealAll;
    for (let i = 0; i < visualOwners.length; i++) {
      // Fogged regions carry no territory at all: a rival's tint and borders must not show
      // through the clouds. (A region whose clouds are still parting counts as revealed.)
      visualOwners[i] = showAll || derived.revealed[i] || renderer.clouds.isRevealing(i) ? state.owner[i] : -1;
      // Prosperity decor is baked into the terrain: fog and a region mid-flood show level 0. state.prosperity holds the
      // CREDITED level, so the map, the income and the celebration always agree.
      visualLevels[i] = visualOwners[i] === PLAYER_FACTION ? (state.prosperity ? state.prosperity[i] | 0 : 0) : 0;
    }
    if (flood) { visualOwners[flood.regionId] = flood.oldOwner; visualLevels[flood.regionId] = 0; }

    renderer.beginFrame(camera, fx.shakeOffset());
    renderer.terrain.draw(ctx, camera, visualOwners, visualLevels);
    renderer.terrain.drawGlints(ctx, camera, t);
    if (hoveredRegionId != null && hoveredRegionId !== selectedRegionId) renderer.overlays.drawHover(ctx, camera, hoveredRegionId);
    let boosts = null;
    if (newFrontier.size) {
      boosts = new Map();
      for (const [id, startMs] of newFrontier) {
        const k = 1 - (nowMs - startMs) / 2400;
        if (k <= 0 && nowMs > startMs) newFrontier.delete(id);
        else boosts.set(id, nowMs < startMs ? -1 : k);
      }
    }
    renderer.overlays.drawFrontierPulse(ctx, camera, derived.frontier.filter((id) => id !== selectedRegionId && (boosts?.get(id) ?? 0) >= 0), t, boosts);
    if (selectedRegionId != null) renderer.overlays.drawSelected(ctx, camera, selectedRegionId, t);
    renderer.clouds.drawShadows(ctx, camera, t);
    drawFlood(ctx, nowMs);
    // The living layers. Ground life (caravans, boats) sits above territory and shadows but BELOW settlements; air life
    // (smoke, windmill sails, birds) above settlements and banners. The ambient never reads game state during a frame.
    const ambient = renderer.ambient;
    if (nowMs - lastAmbientMs > 300) {
      lastAmbientMs = nowMs;
      // The VISUAL owners, so the conquest flood and the fog agree with what is drawn.
      ambient.rebuild({ owner: visualOwners, prosperity: state.prosperity });
    }
    const vb = camera.visibleBounds(2);
    ambient.update(dt);
    ambient.drawGround(ctx, camera, vb);
    siteDrawer.draw(ctx, renderer, camera, state.owner, t, isVisibleRegion, { hideHamlets: camera.zoom < 12 });
    drawIntelMarks(ctx, state, t);
    ambient.drawAir(ctx, camera, vb);
    celebrateProspering(nowMs);

    if (services.pendingIdlePop) {
      const pop = services.pendingIdlePop;
      services.pendingIdlePop = null;
      const region = world.regions[pop.regionId];
      if (region && camera.zoom > 7) {
        const tile = world.tiles[world.settlements[region.keep].tile];
        fx.spawn('floatText', tile.x, tile.y - 0.6, { text: `+${shortNumber(pop.gold)}`, color: ACCENTS.gold, size: 0.42 });
        sfx.play('coin', { volume: 0.16 });
      }
    }
    fx.update(dt);
    fx.draw(ctx, camera);

    renderer.clouds.draw(ctx, camera, services.devRevealAll ? [] : derived.hidden, t, nowMs, fogAlpha);
    for (const d of derived.labels) d.priority = d.regionId === selectedRegionId ? 0 : d.kind;
    drawRegionLabels(ctx, camera, derived.labels, {
      fade: Math.min(1, fogAlpha * 1.5), time: state.settings.reduceMotion ? undefined : t,
    });

    updateHud(nowMs);
    checkFirstContacts(nowMs);
    if (!ui.council.el.hidden && nowMs - lastCouncilMs > 250) { lastCouncilMs = nowMs; updateCouncil(); }
    if (!ui.realm.el.hidden && nowMs - lastRealmMs > 1000) { lastRealmMs = nowMs; updateRealm(); }
    if (selectedRegionId != null) refreshRegionCardThrottled(nowMs);
    updateCoach(nowMs);
  }

  /**
   * A rival leader speaks the first time one of their regions is on your frontier. `markMet` only when the
   * line was really shown, so a contact blocked by a hint or the 15 s gap stays pending and is offered again.
   */
  function checkFirstContacts(nowMs) {
    if (nowMs < contactCheckAtMs) return;
    contactCheckAtMs = nowMs + CONTACT_RETRY_MS;
    if (camera.isMoving() || !ui.welcome.el.hidden) return;
    const { state, world } = container.get();
    const pending = newContacts(state, world);
    if (!pending.length) return;
    const entry = pending[0];
    if (services.speak('firstContact', entry.faction, entry.regionId, entry.faction)) markMet(state, entry.faction);
  }

  /** Drains services.pendingProsperity, one region per 0.7 s so twelve level-ups after a long absence do not shout at once. */
  function celebrateProspering(nowMs) {
    const queue = services.pendingProsperity;
    if (!queue || queue.length === 0 || nowMs < nextCelebrationMs) return;
    const { world } = container.get();
    const u = queue.shift();
    const region = world.regions[u.regionId];
    if (!region) return;
    nextCelebrationMs = nowMs + 700;
    const keep = world.tiles[world.settlements[region.keep].tile];
    const fx = renderer.fx;
    fx.spawn('floatText', keep.x, keep.y - 1.4, { text: `${region.name} prospers!`, color: ACCENTS.gold, size: 0.5 });
    fx.spawn('burst', keep.x, keep.y - 0.3, { color: ACCENTS.goldSoft, flashSize: 1.4, sparkleCount: 8 }); // the soft shimmer
    sfx.play('upgrade', { volume: 0.3 }); // quiet
    // The map re-bakes underneath by itself (the level is part of the chunk signature): the burst and the new
    // orchards, haystacks, cottages or paving arrive together.
  }

  /** Scouted regions wear their garrison badges; only the SELECTED one also gets the weak-point ring. */
  function drawIntelMarks(ctx, state, t) {
    for (const { id, report } of derived.scouted) {
      drawScoutedGarrisons(ctx, camera, report.sites, state.owner[id], camera.zoom, {
        // A phone's overview sits below the badge fade zoom: still show the selected region's garrisons.
        force: id === selectedRegionId && services.isPhone(),
        alpha: fogAlpha,
      });
      if (id === selectedRegionId) {
        const weak = report.sites.find((s) => s.id === report.weakPoint);
        drawWeakPointMarker(ctx, camera, weak, camera.zoom, t, { reduceMotion: state.settings.reduceMotion });
      }
    }
  }

  let lastCardMs = 0;
  function refreshRegionCardThrottled(nowMs) {
    if (nowMs - lastCardMs < 1000) return;
    lastCardMs = nowMs;
    // The card's numbers move with upgrades bought in the council etc.
    if (!ui.regionCard.dock.hidden) refreshRegionCard();
  }

  // --- dev hooks --------------------------------------------------------------------
  function devConquerRegion(id) {
    const { state, world } = container.get();
    if (state.owner[id] === PLAYER_FACTION) return false;
    conquer(state, world, id, Date.now());
    markDirty();
    return true;
  }

  function devConquer(n) {
    const { state, world } = container.get();
    let done = 0;
    for (let i = 0; i < n; i++) {
      const ids = frontier(state, world);
      if (!ids.length) break;
      // Sweep outward: lowest tier first, then the region nearest the start.
      ids.sort((a, b) => world.regions[a].tier - world.regions[b].tier || a - b);
      devConquerRegion(ids[0]);
      done++;
    }
    return done;
  }

  function devFlyToRegion(id, zoom, ms = 600) {
    const a = anchors[id];
    if (!a) return;
    camera.flyTo({ x: a.x, y: a.y, zoom: zoom ?? camera.zoom }, ms);
  }

  return {
    enter,
    exit,
    frame,
    onResize() { if (sceneIsActive()) applyCameraLimits(); },
    selectRegion(id) { setSelected(id); },
    onCouncilOpen,
    onCouncilClose() { ui.council.el.hidden = true; },
    onRealmOpen,
    onRealmClose() { ui.realm.el.hidden = true; },
    onAttack,
    onSurrender,
    onScout,
    onSabotage,
    onBuy,
    onBuyMax,
    onFoundDynasty,
    onWelcomeCollect,
    showWelcome,
    regionScreenPos(id) {
      const a = anchors[id];
      return a ? camera.worldToScreen(a.x, a.y) : null;
    },
    devConquer,
    devConquerRegion,
    devSurrender(id) { onSurrender(id); },
    devFlyToRegion,
    /** Re-pushes the open card's data (what the 1 s refresh and every gold-dependent change does). */
    devRefreshCard() { refreshRegionCard(); },
  };

  function sceneIsActive() { return !ui.hud.el.hidden; }
}
