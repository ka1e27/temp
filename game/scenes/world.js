// World scene (DESIGN §2-3, §5, ARCHITECTURE §9, PLAYFEEL §2): the living,
// interactive continent — HUD, region selection/attack/surrender, War Council,
// Realm, idle pops, fog of the unknown, the conquest flood, tutorial steps 0-2
// and 6.
import { hexDistance } from '../core/hex.js';
import { drawHexTint, elevOffset } from '../render/tiles.js';
import { ACCENTS, factionColor } from '../render/palette.js';
import {
  frontier, revealed, difficulty, conquer, canFoundDynasty, attackable, attackBlocker,
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
  intelPanelData, intelOf, scoutReport, scout, sabotage, intelToast, sabotagePercent, clearRegionIntel, tutorialRegionId, isScoutedOrFree,
} from '../meta/intel.js';
import {
  worksPanelData, worksMarksData, buildWork, upgradeWork, demolishWork, worksToast, workName, worksTutorialDue, worksTutorialRegion,
} from '../meta/works.js';
import { drawWorksMarks } from '../render/worksMarks.js';
import { drawScoutedGarrisons, drawWeakPointMarker } from '../render/intelMarks.js';
import { prosperityInfo } from '../meta/prosperity.js';
import { chronicleOnConquest, chroniclePanelData } from '../meta/chronicle.js';
import { saveText } from '../meta/keepsake.js';
import { chanceWords } from '../app/chanceWords.js';
import { regionsListData } from '../app/regionsList.js';
import { announce } from '../ui/live.js';
import { saveTapestry } from './worldImage.js';
import { CROWN_BONUS_PCT } from '../app/crownCopy.js';
import { shortNumber } from '../ui/format.js';
import { perkDisplay, dynastyStarText } from '../app/perkInfo.js';
import { bestValueUpgrade } from '../app/bestValue.js';
import { effectiveRegionIncome } from '../app/income.js';
import { drawRegionLabels } from '../render/labels.js';
import { WORLD_SCENE, VICTORY } from './timing.js';
import { regionHintBox } from '../app/hintTargets.js';
import { FEATURES } from '../app/features.js';
import {
  createSiteDrawer, pickLandTile, regionLabelAnchors, realmFraming, frameInRect, freeRect, openCameraLimits, unionBounds, HEX_MARGIN,
} from './worldLayers.js';

const FOG_FADE_SEC = 1.6;
const DERIVED_REFRESH_MS = 300;
const SURRENDER_HINT = 'Accept their surrender, or attack for crowns!';
// M3's later stages. On a phone the chooser fills the bottom of the screen and the bubble has to sit over the card, so it is ONE short line there (it must not cover the region name).
const M3_TEXT = {
  build: 'Tap Build to raise a Work here.', buildTouch: 'Tap Build',
  pick: 'Pick Barracks: it adds troops to your camp next door.', pickTouch: 'Pick Barracks',
};
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
  let lastRegionsMs = -1e9;
  let cursorId = -1; // the map's keyboard cursor: a region (arrow keys move it, Enter opens its card)
  let keyboardCursor = false; // the cursor has been moved from the keyboard (so Enter and Space mean "open it")
  let contactCheckAtMs = 0;
  let nextCelebrationMs = 0; // one prosperity celebration per 0.7 s
  let lastAmbientMs = -1e9;
  let visualLevels = []; // region id -> prosperity level drawn (0 under fog, mid-flood and for anything not yours)
  let coachSig = '';
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
    // A Watchtower next door scouts for free (DESIGN 5.7, 5.8): the very predicate the card uses decides who wears garrison badges.
    derived.scouted = [];
    const scoutable = new Set(Object.keys(state.intel || {}).map(Number));
    for (const id of derived.frontier) scoutable.add(id);
    for (const id of scoutable) {
      if (state.owner[id] === PLAYER_FACTION || !isVisibleRegion(id) || !isScoutedOrFree(state, world, id)) continue;
      const report = scoutReport(state, world, id);
      if (report) derived.scouted.push({ id, report });
    }
    derived.worksMarks = worksMarksData(state, world); // the buildings by each keep (render/worksMarks.js)
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
    const owner = { name: ownerFaction.name, color: ownerFaction.color, colorLight: ownerFaction.colorLight, emblem: ownerFaction.emblem };
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
        works: worksPanelData(state, world, regionId, Date.now()),
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
      chanceText: chanceWords(difficulty(state, world, regionId).winChance), // "about 1 in 5": the bar shows the chance of winning (DESIGN 5.3)
      attackBlock: (() => { const r = attackBlocker(state, world, regionId); return r === 'no-passable-border' || r === 'unbuildable' ? r : null; })(), // no arena can be built: the card says why
      intel: intelPanelData(state, world, regionId),
      parSec: parFor(world, regionId, state),
      crownBonusPct: CROWN_BONUS_PCT,
    };
  }

  let hintOutlineRegion = -1; // the region the open hint points at: it gets a bright pulsing outline
  let hintSlotPx = 84; // the room the card opens above Attack for the "Attack!" bubble (grows to the bubble's real height)
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

  // Keepsakes: the "Save the map" button's words and busy state (the picture takes about half a second to render, and a second press must not start a second render)
  let savingMap = false;
  const saveWords = () => ({ label: saveText('button'), busyLabel: saveText('busy'), busy: savingMap, hint: saveText('hint') });

  function updateRealm() {
    const { state } = container.get();
    const { world } = container.get();
    ui.realm.update({
      stats: state.stats, dynasty: { ...state.dynasty, starText: dynastyStarText() }, canFoundDynasty: canFoundDynasty(state),
      crowns: crownTotals(state, world),
      chronicle: chroniclePanelData(state, world, Date.now()),
      save: saveWords(),
    });
  }

  async function onSaveMap() {
    if (savingMap) return;
    savingMap = true;
    updateRealm();
    const { state, world } = container.get();
    const res = await saveTapestry(state, world, Date.now());
    savingMap = false;
    updateRealm();
    // pressed inside the Realm panel (or the Found a Dynasty confirmation): the result is said there, beside the button
    const message = res.ok ? saveText('done', { file: res.file }) : saveText('failed');
    if (ui.realm.setSaveStatus && !ui.realm.el.hidden) ui.realm.setSaveStatus(message, res.ok ? 'success' : 'warning');
    else ui.toasts.update({ type: res.ok ? 'success' : 'warning', icon: 'map', message });
  }

  // --- selection ----------------------------------------------------------------
  function setSelected(id) {
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
        // Reduce Motion: the mists part at once, with no stagger (the region simply stops being hidden)
        if (!state.settings.reduceMotion) renderer.clouds.revealRegion(r.id, now + 250 + i * VICTORY.cloudPartStaggerMs);
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
    const { state, world } = container.get();
    // a region whose border is only mountains has no arena (arena.js canBuildArena): the card says so instead of offering Attack; this guards every other way in
    if (!attackable(state, world, regionId)) {
      sfx.play('error');
      ui.toasts.update({ type: 'warning', icon: 'flame', message: 'No passable border: conquer a neighbour first.' });
      return;
    }
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
    try { chronicleOnConquest(state, world, regionId, { surrender: true, decapitated: !!result.decapitated }); } catch (err) { console.warn('[chronicle] surrender line skipped:', err); } // the story never blocks a conquest
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
    if (!res) { refused('Not enough gold to scout that region.'); return; }
    sfx.play('click');
    tutorial.notify('scouted');
    // The leader first, then the toast: on a phone the toast waits until the banner has gone.
    services.speak('scouted', state.owner[regionId], regionId, regionId); // the leader notices; the gate does the rest
    ui.toasts.update({ type: 'info', icon: 'eye', message: intelToast('scouted', { region: world.regions[regionId].name }) });
    afterIntel();
  }

  function onSabotage(regionId) {
    const { state, world } = container.get();
    const res = sabotage(state, world, regionId); // { cost, level } | false
    if (!res) { refused('Not enough gold to sabotage.'); return; }
    sfx.play('upgrade');
    ui.toasts.update({
      type: 'warning', icon: 'flame',
      message: intelToast('sabotaged', { region: world.regions[regionId].name, pct: sabotagePercent(res.level) }),
    });
    // The leader reacts at the BATTLE START (battle.js), not on purchase.
    afterIntel();
  }

  // --- Region Works (DESIGN 5.8) ------------------------------------------------------------------
  function afterWorksChange() {
    markDirty(); // rebuilds derived.worksMarks and, through difficulty(), every frontier chip
    refreshRegionCard(); // the panel shows the new level and price at once
    updateHud(performance.now(), { force: true }); // gold changed
    services.autosave.save();
  }

  function onBuildWork(regionId, slot, type) {
    const { state, world } = container.get();
    const res = buildWork(state, world, regionId, type);
    if (!res) { refused('Not enough gold to build that.'); return; } // refused: nothing changed
    sfx.play('upgrade');
    ui.toasts.update({ type: 'success', icon: 'castle', message: worksToast('built', { work: workName(type), region: world.regions[regionId].name }) });
    afterWorksChange();
    tutorial.notify('workBuilt');
  }

  function onUpgradeWork(regionId, slot) {
    const { state, world } = container.get();
    const res = upgradeWork(state, world, regionId, slot);
    if (!res) { refused('Not enough gold to upgrade that.'); return; }
    sfx.play('upgrade', { pitch: 1 + 0.12 * (res.level - 1) }); // a little higher at level III
    ui.toasts.update({ type: 'success', icon: 'star', message: worksToast('upgraded', { work: workName(res.type), region: world.regions[regionId].name, level: res.level }) });
    afterWorksChange();
  }

  function onDemolishWork(regionId, slot) {
    const { state, world } = container.get();
    const res = demolishWork(state, world, regionId, slot); // the panel already asked "Demolish Barracks? Refund N gold"
    if (!res) { refused('That could not be demolished.'); return; }
    sfx.play('coin', { volume: 0.5 }); // the refund comes back as gold: the coin cue, quietly
    ui.toasts.update({ icon: 'coin', message: worksToast('demolished', { work: workName(res.type), region: world.regions[regionId].name, refund: res.refund }) });
    afterWorksChange();
  }

  function onBuy(id) {
    const { state } = container.get();
    const level = buy(state, id);
    if (level) {
      sfx.play('upgrade');
      // feedback for a purchase made in the council stays IN the council (the bought card flashes; a polite status line under the header), never a toast over the dialog
      ui.council.setStatus(`Bought ${UPGRADES[id].name}, level ${level}`);
    } else {
      sfx.play('error');
      ui.council.setStatus('Not enough gold for that upgrade.', 'warning');
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
      ui.council.setStatus(`Bought ${UPGRADES[id].name} +${res.levels} ${res.levels === 1 ? 'level' : 'levels'}, now level ${res.level ?? ''}`.replace(/, now level $/, ''));
    } else {
      sfx.play('error');
      ui.council.setStatus('Not enough gold for another level.', 'warning');
    }
    markDirty();
    updateCouncil(true);
    updateHud(performance.now(), { force: true });
  }

  /** A refused action is SEEN as well as heard (the error blip is nothing with the sound off, or to a player who cannot hear it): a warning toast, updated in place so repeats never pile up. */
  function refused(message) {
    sfx.play('error');
    ui.toasts.update({ id: 'refused', type: 'warning', icon: 'flame', message, duration: 2400 });
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
    ui.regions.el.hidden = true;
    ui.realm.el.hidden = false;
    updateRealm();
    tutorial.notify('realmOpened');
  }

  // --- the Regions list: every region you can see, as buttons (a way round the map for a keyboard, a screen reader and a thumb) ----------------------------------
  function updateRegions() {
    const { state, world } = container.get();
    ui.regions.update({ rows: regionsListData(state, world, { revealAll: services.devRevealAll }) });
  }

  function onRegionsOpen() {
    setSelected(null);
    ui.council.el.hidden = true;
    ui.realm.el.hidden = true;
    updateRegions();
    ui.regions.el.hidden = false;
  }

  function onRegionsClose() {
    ui.regions.el.hidden = true;
  }

  /** A row was chosen: the panel closes, the region's card opens (exactly as a click on the map would), and focus moves to the card's action. */
  function onRegionsSelect(id) {
    ui.regions.el.hidden = true;
    sfx.play('click', { volume: 0.5 });
    openRegion(id);
  }

  /** Opens a region's card from the keyboard or the list: the cursor goes there, the camera follows if it is out of sight, focus lands on the card's action. */
  function openRegion(id) {
    cursorId = id;
    revealCursor(id);
    setSelected(id);
    queueMicrotask(() => focusCard());
  }

  function focusCard() {
    const act = cardAction() || cardScout() || ui.regionCard.el.querySelector('button:not([disabled])');
    if (act && act.focus) act.focus({ preventScroll: true });
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
    if (!ui.regions.el.hidden) { ui.regions.el.hidden = true; return true; }
    if (selectedRegionId != null) {
      const focusWasInCard = ui.regionCard.dock.contains(document.activeElement);
      setSelected(null);
      if (focusWasInCard) renderer.canvas.focus({ preventScroll: true }); // Escape from the card goes back to the map cursor
      return true;
    }
    return false;
  }

  // --- input --------------------------------------------------------------------
  function onTap(sx, sy, wx, wy) {
    keyboardCursor = false; // the mouse is in use
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

  // --- the map's keyboard cursor (DESIGN 7.5a): a canvas that takes focus, a ring on one region, arrow keys to the neighbour that way, Enter to open its card ------------------
  const seenRegion = (id) => !!(derived.revealed[id] || services.devRevealAll);
  const allRows = () => { const { state, world } = container.get(); return regionsListData(state, world, { revealAll: services.devRevealAll }); };
  const summaryOf = (id) => { const row = allRows().find((r) => r.id === id); return row ? row.summary : container.get().world.regions[id].name; };

  /** The cursor starts on the open card's region, else the region the tutorial points at, else home; it never rests on a region that is still under the mists. */
  function ensureCursor() {
    const { world } = container.get();
    if (cursorId >= 0 && seenRegion(cursorId)) return;
    const pick = selectedRegionId != null ? selectedRegionId : hintRegionId();
    cursorId = pick >= 0 && seenRegion(pick) ? pick : world.startRegion;
  }

  /** The camera follows the cursor when its region is out of sight (or under a bar). */
  function revealCursor(id) {
    const a = anchors[id];
    if (!a) return;
    const p = camera.worldToScreen(a.x, a.y);
    if (p.x < 48 || p.y < 110 || p.x > renderer.cssWidth - 48 || p.y > renderer.cssHeight - 48) camera.flyTo({ x: a.x, y: a.y, zoom: camera.zoom }, 350);
  }

  function setCursor(id) {
    cursorId = id;
    revealCursor(id);
    announce(summaryOf(id));
  }

  /** Arrow key: the revealed region whose label lies most nearly that way (neighbours preferred), within about 65 degrees of it. */
  function moveCursor(dx, dy) {
    const { world } = container.get();
    ensureCursor();
    const from = anchors[cursorId];
    const mine = world.regions[cursorId];
    let best = -1;
    let bestScore = Infinity;
    for (const region of world.regions) {
      if (region.id === cursorId || !seenRegion(region.id) || !anchors[region.id]) continue;
      const vx = anchors[region.id].x - from.x;
      const vy = anchors[region.id].y - from.y;
      const d = Math.hypot(vx, vy);
      if (d < 1e-6) continue;
      const cos = (vx * dx + vy * dy) / d;
      if (cos < 0.42) continue;
      const score = d * (1.7 - cos) * (mine.neighbors.includes(region.id) ? 0.5 : 1.6);
      if (score < bestScore) { bestScore = score; best = region.id; }
    }
    if (best < 0) { announce('No region that way.'); return; }
    setCursor(best);
  }

  /** [ and ]: the regions you can attack, in the Regions list's order (easiest first). */
  function cycleFrontier(step) {
    const ids = allRows().filter((r) => r.kind === 'frontier').map((r) => r.id);
    if (!ids.length) { announce('No region to attack.'); return; }
    ensureCursor();
    const i = ids.indexOf(cursorId);
    setCursor(ids[(i < 0 ? (step > 0 ? 0 : ids.length - 1) : (i + step + ids.length) % ids.length)]);
  }

  function onKey(key, event) {
    if (key === 'Escape') { closeTopPanel(); return; }
    // the map's own keys apply only while the MAP has focus (a focused button keeps its own keys)
    if (!event || document.activeElement !== renderer.canvas || event.ctrlKey || event.metaKey || event.altKey) return;
    const arrows = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (arrows[key]) {
      event.preventDefault();
      keyboardCursor = true;
      const [dx, dy] = arrows[key];
      if (event.shiftKey) camera.panBy(-dx * 90, -dy * 90); else moveCursor(dx, dy);
      return;
    }
    if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
      // after a mouse click the map has focus too, and Space must not surprise a mouse player: it opens the cursor's card only once the cursor is in use from the keyboard
      if (!keyboardCursor && !services.isKeyboardUser()) return;
      event.preventDefault();
      ensureCursor();
      sfx.play('click', { volume: 0.5 });
      openRegion(cursorId);
      return;
    }
    if (key === '[' || key === ']') { event.preventDefault(); keyboardCursor = true; cycleFrontier(key === ']' ? 1 : -1); return; }
    if (key === '+' || key === '=') { event.preventDefault(); camera.zoomAt(1.3, renderer.cssWidth / 2, renderer.cssHeight / 2); return; }
    if (key === '-' || key === '_') { event.preventDefault(); camera.zoomAt(1 / 1.3, renderer.cssWidth / 2, renderer.cssHeight / 2); }
  }

  /** The map takes keyboard focus: it says where the cursor is and what the keys do. */
  function onCanvasFocus() {
    if (!sceneIsActive()) return;
    ensureCursor();
    announce(`Map. ${summaryOf(cursorId)} Arrow keys move between regions, Enter opens the card, brackets cycle the regions you can attack.`);
  }
  renderer.canvas.addEventListener('focus', onCanvasFocus);

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
    renderer.canvas.tabIndex = 0; // the map is the first keyboard stop in the world
    // a keyboard activation (New Realm, a battle's Continue) hides what had focus: focus goes to the map, so the keys keep working without a Tab hunt
    requestAnimationFrame(() => { const a = document.activeElement; if (!a || a === document.body || !a.getClientRects().length) renderer.canvas.focus({ preventScroll: true }); });
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
      if (w.epoch === container.epoch) showWelcome(w); // a welcome made for a realm that was since replaced is never shown
    }
    updateHud(enteredAtMs, { force: true });
    coachSig = '';
  }

  function exit() {
    ui.hud.el.hidden = true;
    ui.regionCard.dock.hidden = true;
    ui.council.el.hidden = true;
    ui.realm.el.hidden = true;
    ui.regions.el.hidden = true;
    renderer.canvas.tabIndex = -1; // the map is a keyboard stop only while it is the world's map
    ui.welcome.el.hidden = true;
    ui.coach.update({ visible: false });
    renderer.canvas.style.cursor = '';
  }

  // --- tutorial hints (PLAYFEEL §4: W0-W3, M1-M4) -----------------------------------------
  // Each frame: the facts go to the tutorial controller, which names the step; the step's anchor becomes a LIVE target (a getter the coach
  // re-reads every frame, so the pointer follows pans, zooms and flights and hides while the target is off screen or under a panel).
  const isUp = (e) => !!e && e.isConnected && e.getClientRects().length > 0 && !e.closest('[hidden]');
  const hudBtn = (label) => ui.hud.el.querySelector(`.hud-btn[aria-label="${label}"]`);
  const cardAction = () => ui.regionCard.el.querySelector('.region-card-action:not([hidden])');
  const cardScout = () => ui.regionCard.el.querySelector('.intel-scout-btn');

  /** The region the first hints talk about: the easiest frontier region (the tutorial region while the realm is still its start region). */
  function hintRegionId() {
    const { state, world } = container.get();
    const t = tutorialRegionId(state, world);
    if (t >= 0) return t;
    let best = -1;
    let bestRatio = -Infinity;
    for (const id of derived.frontier) {
      if (!attackable(state, world, id)) continue; // never point the lesson at a region that cannot be attacked
      const d = difficulty(state, world, id);
      if (d.ratio > bestRatio) { bestRatio = d.ratio; best = id; }
    }
    return best;
  }

  function hintFacts(nowMs) {
    const { state, world } = container.get();
    const owned = state.owner.filter((o) => o === PLAYER_FACTION).length;
    const cardOpen = !ui.regionCard.dock.hidden && selectedRegionId != null;
    const action = cardOpen ? cardAction() : null;
    const scout = cardOpen ? cardScout() : null;
    return {
      scene: 'world',
      // nothing modal in the way, and the scene has had a moment (the hint waits for the mists and the first framing)
      panelsClosed: ui.welcome.el.hidden && ui.settings.el.hidden && ui.council.el.hidden && ui.realm.el.hidden && ui.regions.el.hidden && nowMs - enteredAtMs > 900,
      cardOpen,
      cardAttackable: isUp(action),
      cardUnscouted: isUp(scout) && !scout.disabled,
      frontierCount: derived.frontier.length,
      battlesWon: state.stats.battlesWon,
      conquests: Math.max(0, owned - 1),
      realmComplete: canFoundDynasty(state),
      ownedFrontierCount: world.regions.filter((r) => state.owner[r.id] === PLAYER_FACTION && r.neighbors.some((n) => state.owner[n] !== PLAYER_FACTION)).length,
      // M3 (PLAYFEEL §4): after the third conquest, while no Work has been built; it points at the owned region that borders the most enemy land
      worksDue: FEATURES.works && owned - 1 >= 3 && worksTutorialDue(state),
      worksRegion: FEATURES.works && owned - 1 >= 3 ? worksTutorialRegion(state, world) : -1,
      features: FEATURES,
    };
  }

  /** A region as a hint target: the box is its whole on-screen extent (hintTargets.regionHintBox), the label is the point that tells whether it is covered by a panel. */
  function regionTarget(id) {
    const label = () => { const a = anchors[id]; return camera.worldToScreen(a.x, a.y); };
    return {
      get: () => regionHintBox(container.get().world.regions[id].bbox, (x, y) => camera.worldToScreen(x, y), { w: renderer.cssWidth, h: renderer.cssHeight }, label()),
      probe: label,
    };
  }

  /** The live target for a step, with the side the bubble should prefer, or null when there is nothing to point at right now. */
  function hintTarget(def) {
    const phone = services.isPhone();
    switch (def.anchor) {
      case 'gold': return { target: { find: () => ui.hud.el.querySelector('.hud-gold-block') } };
      case 'mapCard': return { card: true };
      case 'region': {
        const id = hintRegionId();
        if (id < 0 || !anchors[id]) return null;
        return { target: regionTarget(id), key: `region${id}`, outline: id, noRing: true };
      }
      case 'attack': {
        // above the button, in the room the card opens for it (setHintSpace); on a short screen (a phone on its side) there is no room to spare: beside the card, over the map
        const short = renderer.cssHeight < 520;
        return { target: { find: cardAction }, prefer: short ? 'left' : 'above', slot: !short };
      }
      case 'council': {
        // names a good first buy (the council's own Best value pick), so a new player is not left to guess among nine cards
        refreshBestValue(performance.now(), false);
        const best = bestValueId && UPGRADES[bestValueId] ? bestValueId : null;
        const text = best === 'muster' ? 'Muster gives your War Camp more troops: a good first buy.'
          : best ? `${UPGRADES[best].name} is the best value right now: a good first buy.` : undefined;
        return { target: { find: () => hudBtn('War Council') }, text, key: best || 'none' };
      }
      case 'scout': {
        // on a phone the bubble sits in room the card opens above the Scout row (it would cover the strength bar otherwise); elsewhere it sits beside the card
        const room = phone && renderer.cssHeight >= 520;
        return { target: { find: cardScout }, prefer: room ? 'above' : 'left', slot: room ? 'scout' : false };
      }
      case 'realm': return { target: { find: () => hudBtn('Realm') } };
      case 'worksRegion': {
        // Three stages, each following its target: the label of the owned region at the edge of the realm; once its card is open, the Build button;
        // once the chooser is open, Barracks. A card on a region with no free slot has nothing to point at, so the hint hides.
        const { state, world } = container.get();
        const works = ui.regionCard.works;
        const ownedCard = !ui.regionCard.dock.hidden && selectedRegionId != null && state.owner[selectedRegionId] === PLAYER_FACTION;
        if (ownedCard) {
          if (works.view === 'choose') return { target: { find: () => works.chooserRow('barracks') }, prefer: phone ? 'above' : 'left', key: 'pick', text: services.isTouch() ? M3_TEXT.pickTouch : M3_TEXT.pick };
          return { target: { find: () => works.buildButton() }, prefer: phone ? 'above' : 'left', key: 'build', text: services.isTouch() ? M3_TEXT.buildTouch : M3_TEXT.build };
        }
        const id = worksTutorialRegion(state, world);
        if (id < 0 || !anchors[id]) return null;
        return { target: regionTarget(id), key: `works${id}`, outline: id, noRing: true };
      }
      default: return null;
    }
  }

  // W1 "drag to move the map, scroll or pinch to zoom": seen once the camera has been panned AND zoomed by the player (flights are the scene's own)
  let panZoom = { x: NaN, y: NaN, zoom: NaN, panned: 0, zoomed: 0 };
  function watchPanZoom() {
    if (camera._flight) { panZoom.x = camera.x; panZoom.y = camera.y; panZoom.zoom = camera.zoom; return; }
    if (Number.isFinite(panZoom.zoom)) {
      panZoom.panned += Math.hypot(camera.x - panZoom.x, camera.y - panZoom.y) * camera.zoom;
      panZoom.zoomed += Math.abs(Math.log(camera.zoom / panZoom.zoom));
      if (panZoom.panned > 24 && panZoom.zoomed > 0.05) tutorial.notify('panAndZoom'); // a modest drag and a modest pinch count (the thresholds used to be 50 px and 10%)
    }
    panZoom.x = camera.x; panZoom.y = camera.y; panZoom.zoom = camera.zoom;
  }

  /**
   * Hint W2 ("Click a glowing region") is about to start: if its region is not comfortably on screen (the W1 pan and zoom can push it away; RC2 playtest, seed 23),
   * fly gently to frame the home region and it together (instant under Reduce Motion). True while that flight runs: the hint waits for it.
   */
  let w2Framed = false;
  function frameForW2() {
    if (w2Framed) return camera.isMoving();
    w2Framed = true;
    const id = hintRegionId();
    if (id < 0) return false;
    const { state, world } = container.get();
    const W = renderer.cssWidth;
    const H = renderer.cssHeight;
    const rect = freeRect(W, H, { reserveCard: false });
    const bb = world.regions[id].bbox;
    const a = camera.worldToScreen(bb.minX - HEX_MARGIN, bb.minY - HEX_MARGIN);
    const b = camera.worldToScreen(bb.maxX + HEX_MARGIN, bb.maxY + HEX_MARGIN);
    const area = Math.max(1, (b.x - a.x) * (b.y - a.y));
    const inW = Math.max(0, Math.min(b.x, rect.x1) - Math.max(a.x, rect.x0));
    const inH = Math.max(0, Math.min(b.y, rect.y1) - Math.max(a.y, rect.y0));
    const label = anchors[id] ? camera.worldToScreen(anchors[id].x, anchors[id].y) : null;
    const labelIn = !!label && label.x > rect.x0 && label.x < rect.x1 && label.y > rect.y0 && label.y < rect.y1;
    if (labelIn && (inW * inH) / area >= 0.7) return false; // comfortably on screen: nothing to do
    const home = world.regions.filter((r) => state.owner[r.id] === PLAYER_FACTION).map((r) => r.bbox);
    const u = unionBounds([...home, bb]);
    const bounds = { minX: u.minX - HEX_MARGIN, minY: u.minY - HEX_MARGIN, maxX: u.maxX + HEX_MARGIN, maxY: u.maxY + HEX_MARGIN };
    const phone = services.isPhone();
    const target = frameInRect(camera, bounds, rect, { padding: phone ? 18 : 30, maxZoom: Math.max(camera.zoom, phone ? 22 : 32) });
    camera.flyTo(target, state.settings.reduceMotion ? 1 : 700);
    return true;
  }

  function updateCoach(nowMs) {
    watchPanZoom();
    const facts = hintFacts(nowMs);
    const def = tutorial.pick(facts);
    if (!def || def.id !== 'W2') w2Framed = false;
    else if (frameForW2()) { if (coachSig !== 'off') { coachSig = 'off'; ui.coach.update({ visible: false }); } return; }
    const off = () => {
      hintOutlineRegion = -1;
      ui.regionCard.setHintSpace(0);
      if (coachSig !== 'off') { coachSig = 'off'; ui.coach.update({ visible: false }); }
    };
    if (!def) { off(); return; }
    const res = hintTarget(def);
    if (!res) { off(); return; }
    hintOutlineRegion = res.outline ?? -1; // the region the hint is about glows on the map (drawHintRegion)
    // "Attack!" opens room for its bubble ABOVE the button, inside the card, so it covers no number the player is deciding on
    if (res.slot) {
      hintSlotPx = Math.max(hintSlotPx, Math.min(130, Math.ceil(ui.coach.bubble.offsetHeight || 0) + 28));
      ui.regionCard.setHintSpace(hintSlotPx, res.slot === 'scout' ? 'scout' : 'footer');
    } else ui.regionCard.setHintSpace(0);
    // Step W3 says "Attack!": if the card in front of the player offers a surrender instead, say that.
    const text = res.text || (def.id === 'W3' && cardOffersSurrender ? SURRENDER_HINT : (services.isTouch() && def.textTouch) || def.text);
    coachSig = `${def.id}|${res.key || ''}|${text}`;
    ui.coach.update({ visible: true, id: def.id, text, target: res.target, card: res.card, prefer: res.prefer, noRing: !!res.noRing });
  }

  // --- frame ----------------------------------------------------------------------
  function frame(dt, t, nowMs) {
    camera.update(dt);
    ensureWorldCaches();
    refreshDerived(nowMs);
    const { state, world } = container.get();
    const { ctx } = renderer;
    const fx = renderer.fx;
    // Reduce Motion: the clouds, the sea glints and the frontier and selection pulses stand still (`tm` is a frozen clock), and the mists are there at once
    const rm = !!state.settings.reduceMotion;
    const tm = rm ? 0 : t;

    if (fogAlpha < 1) fogAlpha = rm ? 1 : Math.min(1, fogAlpha + dt / FOG_FADE_SEC);

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
    renderer.terrain.drawGlints(ctx, camera, tm);
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
    renderer.overlays.drawFrontierPulse(ctx, camera, derived.frontier.filter((id) => id !== selectedRegionId && (boosts?.get(id) ?? 0) >= 0), tm, boosts);
    // the region the tutorial is pointing at: a bright pulsing outline, much louder than the regular frontier band (still, under Reduce Motion)
    if (hintOutlineRegion >= 0 && hintOutlineRegion !== selectedRegionId && !ui.coach.el.hidden) renderer.overlays.drawHintRegion(ctx, camera, hintOutlineRegion, tm);
    // the keyboard cursor: a bright dashed ring on its region, only while the map has focus from the keyboard
    if (cursorId >= 0 && document.activeElement === renderer.canvas && (keyboardCursor || services.isKeyboardUser()) && seenRegion(cursorId)) renderer.overlays.drawCursor(ctx, camera, cursorId, tm);
    if (selectedRegionId != null) renderer.overlays.drawSelected(ctx, camera, selectedRegionId, tm);
    renderer.clouds.drawShadows(ctx, camera, tm);
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
    drawWorksMarks(ctx, camera, derived.worksMarks || [], camera.zoom, {
      color: factionColor(PLAYER_FACTION), // the realm's banner colour on barracks and watchtower flags
      t: state.settings.reduceMotion ? undefined : t, // omitted under Reduce Motion: still flags and flames
      alpha: fogAlpha,
      skip: (m) => !derived.revealed[m.regionId] && !services.devRevealAll, // never draw into fog
    });
    drawIntelMarks(ctx, state, t);
    ambient.drawAir(ctx, camera, vb);
    celebrateProspering(nowMs);

    if (services.pendingIdlePop) {
      const pop = services.pendingIdlePop;
      services.pendingIdlePop = null;
      const region = pop.epoch === container.epoch ? world.regions[pop.regionId] : null;
      if (region && camera.zoom > 7) {
        const tile = world.tiles[world.settlements[region.keep].tile];
        fx.spawn('floatText', tile.x, tile.y - 0.6, { text: `+${shortNumber(pop.gold)}`, color: ACCENTS.gold, size: 0.42 });
        sfx.play('coin', { volume: 0.16 });
      }
    }
    fx.update(dt);
    fx.draw(ctx, camera);

    renderer.clouds.draw(ctx, camera, services.devRevealAll ? [] : derived.hidden, tm, nowMs, fogAlpha);
    for (const d of derived.labels) d.priority = d.regionId === selectedRegionId ? 0 : d.kind;
    drawRegionLabels(ctx, camera, derived.labels, {
      fade: Math.min(1, fogAlpha * 1.5), time: state.settings.reduceMotion ? undefined : t,
    });

    updateHud(nowMs);
    checkFirstContacts(nowMs);
    if (!ui.council.el.hidden && nowMs - lastCouncilMs > 250) { lastCouncilMs = nowMs; updateCouncil(); }
    if (!ui.realm.el.hidden && nowMs - lastRealmMs > 1000) { lastRealmMs = nowMs; updateRealm(); }
    if (!ui.regions.el.hidden && nowMs - lastRegionsMs > 1000) { lastRegionsMs = nowMs; updateRegions(); }
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
    if (u.epoch !== container.epoch) return; // queued for a realm that was since replaced
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
    onRegionsOpen,
    onRegionsClose,
    onRegionsSelect,
    onAttack,
    onSurrender,
    onScout,
    onSabotage,
    onBuildWork,
    onUpgradeWork,
    onDemolishWork,
    onBuy,
    onBuyMax,
    onFoundDynasty,
    onSaveMap,
    onWelcomeCollect,
    showWelcome,
    /** The region the open hint outlines on the map (-1: none): for the placement checks. */
    devHintOutline() { return hintOutlineRegion; },
    /** The map cursor's region id (-1 before it is used): for the keyboard-only check. */
    devMapCursor() { return cursorId; },
    /** The box a hint about this region must keep clear (hintTargets.regionHintBox), for the placement monitor. */
    regionHintBoxOf(id) {
      const { world } = container.get();
      const a = anchors[id];
      if (!a || !world.regions[id]) return null;
      return regionHintBox(world.regions[id].bbox, (x, y) => camera.worldToScreen(x, y), { w: renderer.cssWidth, h: renderer.cssHeight }, camera.worldToScreen(a.x, a.y));
    },
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
