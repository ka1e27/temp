// Battle scene (DESIGN §4, PLAYFEEL §3): the fight on the real terrain. Orchestrates the enter
// choreography, the fixed-step sim, drag/tap/lasso orders, powers, enemy-intent and threat readouts,
// the victory sequence (hit-stop, surrender cascade, tile flood, fanfare, card) and the defeat /
// retreat cards. The look of the arena itself lives in render/arenaLayer.js (live territory + soft
// dim) and render/units.js (squads, intent lines); who-owns-what timing in scenes/arenaOwnership.js.
import { hexDistance } from '../core/hex.js';
import { elevOffset } from '../render/tiles.js';
import { drawDragArrow } from '../render/sprites.js';
import { factionColor, ACCENTS } from '../render/palette.js';
import { hitTestSites } from '../render/sites.js';
import { buildArena } from '../battle/arena.js';
import {
  createBattle, step, issue, previewSend,
} from '../battle/sim.js';
import { think } from '../battle/ai.js';
import { tileAt } from '../battle/runtime.js';
import { PLAYER_OWNER } from '../battle/owner.js';
import { createFixedStepper } from '../input/clock.js';
import { hexRadiusToWorld } from '../battle/geom.js';
import {
  playerBattleStats, enemyBattleStats, conquer, revealed, frontier,
} from '../meta/progression.js';
import { PLAYER_FACTION } from '../meta/state.js';
import { POWER_IDS, UPGRADES } from '../meta/upgrades.js';
import { bounty } from '../meta/economy.js';
import {
  trackerOf, trackBattle, evaluateBattle, awardCrowns, crownBonus,
} from '../meta/crowns.js';
import { CROWN_BONUS_PCT } from '../app/crownCopy.js';
import { sabotageBattleNote, sabotageLevel, clearRegionIntel } from '../meta/intel.js';
import { battleIntensity, battleAssault } from '../audio/musicIntensity.js';
import { TICK_SEC, POWERS } from '../config/battle.js';
import { perkDisplay } from '../app/perkInfo.js';
import { effectiveRegionIncome } from '../app/income.js';
import { createModal } from '../ui/modal.js';
import { h } from '../ui/dom.js';
import { BATTLE_ENTER, VICTORY, DEFEAT, DRAG_ARROW, STUCK_HINT } from './timing.js';
import { stuckHintDue } from './stuckHint.js';
import { createArenaOwnership } from './arenaOwnership.js';
import { computeThreats } from './battleThreat.js';
import {
  frameInRect, openCameraLimits, pickLandTile,
} from './worldLayers.js';

const THREAT_HZ_MS = 250; // threat chips recompute at ~4 Hz
const HUD_HZ_MS = 66; // battle HUD refresh (~15 Hz)
const MAX_DIM = 1 - BATTLE_ENTER.dimBrightness;
// Phone-width labels for the power buttons (UI copy): short enough that nothing is ellipsised.
const SHORT_POWER_NAMES = { rally: 'Rally', firestorm: 'Storm', bulwark: 'Bulwark', march: 'March', levy: 'Levy' };

/**
 * @param {object} services shared instances from main.js.
 */
export function createBattleScene(services) {
  const {
    camera, renderer, ui, input, container, sfx, tutorial, goto, music, speak, voice,
  } = services;
  const { ctx } = renderer;
  const stepper = createFixedStepper(TICK_SEC);

  let active = false;
  let world = null;
  let regionId = null;
  let battle = null;
  let own = null; // arena ownership (display owners, ripple, cascade, flood)
  let battleOwners = []; // region -> faction for the chunked terrain (target region + fog blanked)
  let hiddenIds = []; // fogged regions, kept under the dim

  let selection = new Set();
  let targeting = null; // { power, pending?: {x, y} } (pending = touch two-step firestorm)
  let hoverWorld = { x: 0, y: 0 };
  let hoverSite = null;
  let drag = null; // { kind:'send', from:[ids], target, currentWorld } | { kind:'lasso', x0,y0,x1,y1 }
  let sendFraction = 0.5;
  let paused = false;
  let speed = 1;

  let phase = 'entering'; // entering -> live -> victory | defeat -> leaving
  let enterElapsedSec = 0;
  let campDropStartMs = null;
  let dimAlpha = 0;
  let hitStopUntilMs = 0;
  let victory = null;
  let defeatAtMs = 0;
  let leaving = null;
  let resultsShown = false;
  let lastResult = null;
  let crownResult = null; // { summary, crowns, parSec } once a win is decided
  let lastOwnerSnapshot = null; // per-site owner just before the tick that just ran
  let threats = new Map();
  let lastThreatMs = -1e9;
  let lastHudMs = -1e9;
  const siteFlash = new Map(); // site id -> ms until which its badge flashes red (just lost)
  const assaultSpark = new Map(); // site id -> last ms a gate spark was spawned
  let skipBtn = null;
  let helpBtn = null;
  let coachSig = '';
  let coachAt = 0;
  // the "Stuck?" hint: once per battle, after STUCK_HINT.afterSec of battle time without one of our captures
  let stuckDone = false;
  let stuckAtMs = 0;
  let stuckCaptured = 0;
  let stuckCaptureT = 0;
  let toastedTargeting = false;
  let surrenderSites = []; // sites the last `surrender` event flipped (victory cascade)

  const reduceMotion = () => !!container.get().state.settings.reduceMotion;

  // --- geometry / helpers -------------------------------------------------------
  function siteTile(site) {
    return tileAt(battle, site.tile);
  }

  /** World position of a site's ground point (raised by its tile's elevation, like everything drawn on it). */
  function siteWorldPos(site) {
    const t = siteTile(site);
    return t ? { x: t.x, y: t.y - elevOffset(world.tiles[t.i], 1) } : { x: 0, y: 0 };
  }

  function candidatesFor(list) {
    return list.map((s) => {
      const p = siteWorldPos(s);
      return { id: s.id, x: p.x, y: p.y, type: s.type };
    });
  }

  const allSiteCandidates = () => candidatesFor(battle.sites);
  const ownSiteCandidates = () => candidatesFor(battle.sites.filter((s) => s.owner === PLAYER_OWNER));

  function ownSiteAt(sx, sy) {
    return hitTestSites(ownSiteCandidates(), camera, sx, sy);
  }

  function cooldownSeconds(id, level) {
    const cfg = POWERS[id];
    return cfg.cooldown * (POWERS.cooldownPerLevel ** (level - 1)) * battle.player.cooldownMult;
  }

  function siteScreenPos(site) {
    const p = siteWorldPos(site);
    return camera.worldToScreen(p.x, p.y);
  }

  // --- fx / sfx event routing (INTEGRATION-NOTES event mapping) ---------------------
  function handleEvent(ev, nowMs) {
    const fx = renderer.fx;
    switch (ev.type) {
      case 'send': {
        const p = siteWorldPos(battle.sites[ev.from]);
        fx.spawn('dust', p.x, p.y, {});
        if (ev.owner === PLAYER_OWNER) sfx.play('send');
        break;
      }
      case 'clash': {
        fx.spawn('sparks', ev.x, ev.y, {});
        if (squadOwnerIsPlayer(ev.a) || squadOwnerIsPlayer(ev.b)) fx.shake(0.25, 0.25);
        sfx.play('clash', { volume: 0.7 });
        break;
      }
      case 'assault': {
        // The enemy keep comes under siege: its leader reacts (before the spark throttle below).
        if (ev.owner === PLAYER_OWNER) {
          const target = battle.sites[ev.site];
          if (target && target.type === 'keep' && target.owner !== PLAYER_OWNER && siteTile(target).region === regionId) {
            speak('keepAssaulted', battle.arena.enemyFaction, regionId);
          }
        }
        const last = assaultSpark.get(ev.site) ?? 0;
        if (nowMs - last < 260) break;
        assaultSpark.set(ev.site, nowMs);
        const p = siteWorldPos(battle.sites[ev.site]);
        fx.spawn('sparks', p.x, p.y, { count: 6, flashSize: 0.12 });
        break;
      }
      case 'capture': handleCapture(ev, nowMs); break;
      case 'arrow':
        fx.spawn('arrow', ev.x1, ev.y1, { to: { x: ev.x2, y: ev.y2 } });
        sfx.play('arrow', { volume: 0.35 });
        break;
      case 'power': handlePowerEvent(ev); break;
      case 'surrender': surrenderSites = ev.sites.slice(); break;
      case 'end': beginEndSequence(ev.result, nowMs); break;
      default: break;
    }
  }

  function squadOwnerIsPlayer(squadId) {
    const s = battle.squads.find((sq) => sq.id === squadId);
    return s ? s.owner === PLAYER_OWNER : false;
  }

  function handleCapture(ev, nowMs) {
    const fx = renderer.fx;
    const site = battle.sites[ev.site];
    const isKeep = site && site.type === 'keep';
    const color = factionColor(ev.to);
    const p = site ? siteWorldPos(site) : { x: ev.x, y: ev.y };
    fx.spawn('burst', p.x, p.y, { color });
    fx.spawn('shockwave', p.x, p.y, {
      color, growth: isKeep ? 4.2 : 2.6, duration: isKeep ? 0.7 : 0.5, thickness0: isKeep ? 0.12 : 0.08, thickness1: 0.03,
    });
    fx.spawn('floatText', p.x, p.y - 0.4, { text: isKeep ? 'Keep taken!' : 'Captured!', color, size: isKeep ? 0.5 : 0.36 });
    fx.shake(isKeep ? 0.7 : 0.4, isKeep ? 0.5 : 0.3);
    own.onCapture(ev.site, ev.from, nowMs);
    if (ev.to === PLAYER_OWNER) {
      sfx.play('capture');
      tutorial.notify('capture');
    } else if (ev.from === PLAYER_OWNER) {
      sfx.play('lost');
      siteFlash.set(ev.site, nowMs + 700);
      fx.spawn('shockwave', p.x, p.y, { color: ACCENTS.bad, growth: 1.8, duration: 0.5, thickness0: 0.07 });
    }
    // The keep is the win condition: a beat of hit-stop so the moment lands.
    if (isKeep && ev.to === PLAYER_OWNER && !reduceMotion()) hitStopUntilMs = nowMs + VICTORY.captureHitstopMs;
    // ... and its leader answers: a capital falling is a decapitation, any other keep is simply lost.
    if (isKeep && ev.to === PLAYER_OWNER && site && siteTile(site).region === regionId) {
      speak(world.regions[regionId].isCapital ? 'decapitation' : 'keepLost', battle.arena.enemyFaction, regionId);
    }
  }

  function handlePowerEvent(ev) {
    const fx = renderer.fx;
    if (ev.power === 'rally') {
      const target = siteWorldPos(battle.sites[ev.target]);
      for (const s of battle.sites) {
        if (s.owner !== ev.owner || s.id === ev.target) continue;
        const from = siteWorldPos(s);
        fx.spawn('rally', from.x, from.y, { to: target });
      }
      sfx.play('rally');
      if (ev.owner === PLAYER_OWNER) tutorial.notify('powerUsed', { power: 'rally' });
    } else if (ev.power === 'firestorm') {
      fx.spawn('fireball', ev.x, ev.y, { delay: POWERS.firestorm.delay, radius: POWERS.firestorm.radius });
      sfx.play('fireball');
    } else if (ev.power === 'bulwark') {
      const level = battle.player.powers.bulwark;
      const duration = POWERS.bulwark.duration + POWERS.bulwark.durationPerLevel * (level - 1);
      fx.spawn('shield', ev.x, ev.y, { duration });
      sfx.play('bulwark');
    } else if (ev.power === 'march') {
      sfx.play('march');
    } else if (ev.power === 'levy') {
      for (const s of battle.sites) {
        if (s.owner !== ev.owner) continue;
        const p = siteWorldPos(s);
        fx.spawn('levy', p.x, p.y, {});
      }
      sfx.play('levy');
    }
  }

  // --- end sequences ---------------------------------------------------------------
  function beginEndSequence(result, nowMs) {
    lastResult = result;
    const { state } = container.get();
    state.stats.troopsSent += battle.stats.sent;
    targeting = null;
    drag = null;
    selection.clear();
    ui.tooltip.update({ visible: false });
    if (result === 'win') {
      crownResult = evaluateBattle(trackerOf(battle), battle, world, regionId, state);
      state.stats.battlesWon += 1;
      state.stats.settlementsTaken += battle.stats.captured;
      if (state.stats.bestBattleSec == null || battle.stats.durationSec < state.stats.bestBattleSec) {
        state.stats.bestBattleSec = battle.stats.durationSec;
      }
      startVictory(nowMs);
    } else {
      if (result === 'lose') {
        state.stats.battlesLost += 1;
        sfx.play('defeat');
        music.stinger('defeat');
      } else {
        music.setScene('world'); // a retreat is a plain crossfade, no stinger
      }
      speak(result === 'lose' ? 'playerDefeat' : 'playerRetreat', battle.arena.enemyFaction, regionId);
      phase = 'defeat';
      defeatAtMs = nowMs;
    }
    resultsShown = false;
    services.autosave.save();
  }

  /** PLAYFEEL §3 "Victory": hit-stop, surrender cascade, tile flood from the keep, fanfare + confetti, card. */
  function startVictory(nowMs) {
    phase = 'victory';
    const rm = reduceMotion();
    const region = world.regions[regionId];
    const keepSite = battle.sites.find((s) => s.type === 'keep' && siteTile(s).region === regionId);
    const keepTile = keepSite ? siteTile(keepSite) : world.tiles[world.settlements[region.keep].tile];
    const hit = hitStopUntilMs > nowMs ? hitStopUntilMs - nowMs : 0;
    const cascadeStart = nowMs + hit;
    const stagger = rm ? 20 : VICTORY.surrenderStaggerMs;
    const sites = surrenderSites.filter((id) => id !== keepSite?.id);
    const slots = own.startCascade(sites, (id) => (lastOwnerSnapshot ? lastOwnerSnapshot[id] : battle.arena.enemyFaction), cascadeStart, stagger);
    const floodStart = cascadeStart + slots.length * stagger + (rm ? 0 : 150);
    const prevOwner = (id) => (lastOwnerSnapshot ? lastOwnerSnapshot[id] : battle.arena.enemyFaction);
    const flood = own.startFlood(nowMs, floodStart, rm ? 8 : VICTORY.floodMsPerHex, keepTile, prevOwner);
    victory = {
      slots, nextSlot: 0, flood, nextFlood: 0, endMs: flood.endMs + (rm ? 0 : VICTORY.floodShimmerMs), fanfared: false,
    };
    // The score resolves exactly on the fanfare below (finishVictory plays `victory` at endMs).
    music.stinger('victory', { resolveInSec: Math.max(0.3, (victory.endMs - nowMs) / 1000) });
    showSkip(true);
  }

  function updateVictory(nowMs) {
    const v = victory;
    const color = factionColor(PLAYER_FACTION);
    while (v.nextSlot < v.slots.length && v.slots[v.nextSlot].at <= nowMs) {
      const site = battle.sites[v.slots[v.nextSlot].siteId];
      const p = siteWorldPos(site);
      renderer.fx.spawn('burst', p.x, p.y, { color });
      renderer.fx.spawn('shockwave', p.x, p.y, { color, growth: 1.8, duration: 0.4, thickness0: 0.06 });
      sfx.play('capture', { volume: 0.5 });
      v.nextSlot++;
    }
    while (v.nextFlood < v.flood.schedule.length && v.flood.schedule[v.nextFlood].at <= nowMs) {
      const { tile } = v.flood.schedule[v.nextFlood];
      if (!reduceMotion()) renderer.fx.spawn('flood', tile.x, tile.y - elevOffset(tile, 1), { color });
      v.nextFlood++;
    }
    if (!v.fanfared && nowMs >= v.endMs) finishVictory();
  }

  function finishVictory() {
    if (!victory || victory.fanfared) return;
    victory.fanfared = true;
    own.settle();
    sfx.play('victory');
    const f = battle.arena.focus;
    renderer.fx.spawn('confetti', (f.minX + f.maxX) / 2, (f.minY + f.maxY) / 2, {});
    showSkip(false);
    showResults();
  }

  function showSkip(on) {
    if (!skipBtn) {
      skipBtn = h('button.btn.btn-secondary.hd-skip', { onClick: () => finishVictory() }, 'Skip');
      document.getElementById('ui').appendChild(skipBtn);
    }
    skipBtn.hidden = !on;
  }

  function situationalTip() {
    const region = world.regions[regionId];
    const hasFort = region.settlements.some((id) => world.settlements[id].type === 'fort');
    if (hasFort) return 'Forts defend at 1.8× — soften them with Firestorm first.';
    if (battle.player.powers.rally >= 1 && battle.stats.sent > 0 && battle.stats.captured === 0) {
      return 'Try sending from more than one settlement at once, or use Rally to hit all at once.';
    }
    if (battle.stats.sent === 0) return 'Drag from your War Camp to a settlement to send troops — the fight will not start itself.';
    if (battle.stats.lost > battle.stats.killed * 1.4) return 'Upgrade Muster or Steel in the War Council: you are trading troops badly.';
    return undefined;
  }

  function showResults() {
    resultsShown = true;
    const { state } = container.get();
    const region = world.regions[regionId];
    if (lastResult === 'win') {
      if (!crownResult) crownResult = evaluateBattle(trackerOf(battle), battle, world, regionId, state);
      ui.results.update({
        result: 'victory',
        regionName: region.name,
        bounty: bounty(state, world, regionId),
        newIncome: effectiveRegionIncome(state, world, region),
        perk: perkDisplay(region.perk, world, region),
        durationSec: battle.stats.durationSec,
        troopsLost: battle.stats.lost,
        troopsKilled: battle.stats.killed,
        crowns: crownResult.crowns,
        parSec: crownResult.parSec,
        crownBonus: crownBonus(state, world, regionId, crownResult.crowns), // exact, pre-conquest bounty
        bonusPct: CROWN_BONUS_PCT,
        // The first victory explains crowns once, as a static line on the card (no coach z-index games).
        firstVictory: state.stats.battlesWon === 1 && state.settings.hints !== false,
      });
    } else {
      ui.results.update({
        result: lastResult === 'retreat' ? 'retreat' : 'defeat',
        regionName: region.name,
        durationSec: battle.stats.durationSec,
        troopsLost: battle.stats.lost,
        troopsKilled: battle.stats.killed,
        tip: lastResult === 'retreat' ? 'No harm done. Spend gold in the War Council and come back stronger.' : situationalTip(),
      });
    }
    ui.results.el.hidden = false;
    ui.battleHud.el.hidden = true;
    if (helpBtn) helpBtn.hidden = true;
  }

  /** Fade the dim out (300 ms) before handing over to the world scene, so nothing pops. */
  function leave(then) {
    if (leaving) return;
    ui.results.el.hidden = true;
    const ms = reduceMotion() ? 1 : 300;
    leaving = { startMs: performance.now(), ms, then, from: dimAlpha };
    phase = 'leaving';
  }

  function onResultsContinue() {
    if (lastResult !== 'win') { onBackToMap(); return; }
    const { state } = container.get();
    const beforeRevealed = revealed(state, world);
    const frontierBefore = frontier(state, world);
    const oldOwner = battle.arena.enemyFaction;
    const id = regionId;
    leave(() => {
      const result = conquer(state, world, id, Date.now());
      clearRegionIntel(state, id); // scouted / sabotaged only until the region is ours
      // Crowns pay their bonus on top of the base bounty (never repaying it); retries only count the winning battle.
      const crownAward = crownResult
        ? awardCrowns(state, world, id, crownResult.crowns, result.bounty)
        : { bonusGold: 0, count: 0 };
      state.battle = null;
      goto.world({
        cameFromBattle: true,
        conquered: {
          regionId: id, bounty: result.bounty + crownAward.bonusGold, beforeRevealed, oldOwner, frontierBefore, decapitated: !!result.decapitated,
        },
      });
      services.autosave.save();
    });
  }

  function onRetry() {
    if (leaving) return;
    const { state } = container.get();
    state.battle = null;
    startBattle(regionId, { skipIntro: true });
  }

  function onBackToMap() {
    if (leaving) return;
    leave(() => {
      const { state } = container.get();
      state.battle = null;
      goto.world({ cameFromBattle: true });
      services.autosave.save();
    });
  }

  function onRetreat() {
    if (!battle || battle.result || phase !== 'live') return;
    issue(battle, { type: 'retreat' });
  }

  // --- input ----------------------------------------------------------------------
  function firestormRadiusWorld() {
    return hexRadiusToWorld(POWERS.firestorm.radius);
  }

  function nearestArenaTile(wx, wy) {
    let best = null;
    let bestD = Infinity;
    for (const t of battle.arena.tiles) {
      const dx = t.x - wx;
      const dy = t.y - wy;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = t; }
    }
    return best;
  }

  function handleTargetTap(sx, sy, wx, wy, meta) {
    const power = targeting.power;
    if (power === 'firestorm') {
      const tile = nearestArenaTile(wx, wy) || pickLandTile(world, wx, wy);
      if (!tile) { targeting = null; return; }
      if (meta && meta.pointerType !== 'mouse') {
        // Touch has no hover to preview the blast: the first tap places the marker, a second tap on
        // (or near) it fires, a tap elsewhere moves it.
        const pend = targeting.pending;
        if (!pend || hexDistance(pend.q, pend.r, tile.q, tile.r) > 1) {
          targeting.pending = { q: tile.q, r: tile.r, x: tile.x, y: tile.y };
          ui.toasts.update({ message: 'Tap again to unleash Firestorm', duration: 1800 });
          return;
        }
      }
      issue(battle, { type: 'power', owner: PLAYER_OWNER, power: 'firestorm', target: { q: tile.q, r: tile.r } });
      targeting = null;
      return;
    }
    const siteId = hitTestSites(allSiteCandidates(), camera, sx, sy);
    if (siteId == null) { targeting = null; return; }
    const site = battle.sites[siteId];
    if (power === 'bulwark' && site.owner !== PLAYER_OWNER) { sfx.play('error'); return; }
    issue(battle, { type: 'power', owner: PLAYER_OWNER, power, target: siteId });
    targeting = null;
  }

  function onTap(sx, sy, wx, wy, meta) {
    if (phase === 'victory') { finishVictory(); return; }
    if (phase !== 'live') return;
    if (targeting) { handleTargetTap(sx, sy, wx, wy, meta); return; }
    const siteId = hitTestSites(allSiteCandidates(), camera, sx, sy);
    if (siteId == null) { selection.clear(); return; }
    const site = battle.sites[siteId];
    if (site.owner === PLAYER_OWNER) {
      if (selection.has(siteId)) selection.delete(siteId); else selection.add(siteId);
      sfx.play('click', { volume: 0.4 });
      return;
    }
    if (selection.size > 0) {
      issue(battle, {
        type: 'send', owner: PLAYER_OWNER, from: [...selection], to: siteId, fraction: sendFraction,
      });
      tutorial.notify('send');
      selection.clear();
    }
  }

  function onHover(sx, sy, wx, wy) {
    hoverWorld = { x: wx, y: wy };
    if (phase !== 'live') return;
    const id = hitTestSites(allSiteCandidates(), camera, sx, sy);
    hoverSite = id;
    renderer.canvas.style.cursor = targeting ? 'crosshair' : (id != null ? 'pointer' : '');
  }

  function canStartDrag(wx, wy, info) {
    if (phase !== 'live' || targeting) return 'pan';
    if (info.shift) return 'lasso';
    const screen = camera.worldToScreen(wx, wy);
    return ownSiteAt(screen.x, screen.y) != null ? 'send' : 'pan';
  }

  function onDragStart(kind, sx, sy, wx, wy) {
    if (kind === 'send') {
      const screen = camera.worldToScreen(wx, wy);
      const downId = ownSiteAt(screen.x, screen.y);
      const from = downId != null && selection.has(downId) && selection.size > 0 ? [...selection] : (downId != null ? [downId] : []);
      drag = { kind, from, target: null, currentWorld: { x: wx, y: wy } };
    } else if (kind === 'lasso') {
      drag = { kind, x0: sx, y0: sy, x1: sx, y1: sy };
    }
  }

  function previewText(p) {
    if (p.sending === 0) return 'Nothing to send';
    if (p.outcome === 'reinforce') return `Reinforce +${Math.round(p.sending)}`;
    if (p.outcome === 'capture') return `Send ${Math.round(p.sending)} → capture, ${Math.round(p.remaining)} left`;
    return `Send ${Math.round(p.sending)} … not enough, ${Math.round(p.remaining)} short`;
  }

  function onDragMove(kind, sx, sy, wx, wy) {
    if (!drag) return;
    if (kind === 'send') {
      drag.currentWorld = { x: wx, y: wy };
      const target = hitTestSites(allSiteCandidates(), camera, sx, sy);
      drag.target = target;
      if (target != null && drag.from.length && !drag.from.includes(target)) {
        const preview = previewSend(battle, drag.from, target, sendFraction);
        drag.outcome = preview.outcome; // the arrow turns green (capture) or red (not enough), like the tooltip says
        ui.tooltip.update({ visible: true, x: sx, y: sy, text: previewText(preview) });
      } else {
        drag.outcome = null;
        ui.tooltip.update({ visible: false });
      }
    } else if (kind === 'lasso') {
      drag.x1 = sx;
      drag.y1 = sy;
    }
  }

  function onDragEnd(kind, sx, sy, wx, wy, meta) {
    if (kind === 'send' && drag) {
      if (!meta.cancelled && drag.target != null && drag.from.length && !drag.from.includes(drag.target)) {
        issue(battle, {
          type: 'send', owner: PLAYER_OWNER, from: drag.from, to: drag.target, fraction: sendFraction,
        });
        tutorial.notify('send');
        selection.clear();
      }
      ui.tooltip.update({ visible: false });
    } else if (kind === 'lasso' && drag) {
      if (!meta.cancelled) {
        const box = {
          x0: Math.min(drag.x0, drag.x1), y0: Math.min(drag.y0, drag.y1), x1: Math.max(drag.x0, drag.x1), y1: Math.max(drag.y0, drag.y1),
        };
        const next = new Set();
        for (const s of battle.sites) {
          if (s.owner !== PLAYER_OWNER) continue;
          const p = siteScreenPos(s);
          if (p.x >= box.x0 && p.x <= box.x1 && p.y >= box.y0 && p.y <= box.y1) next.add(s.id);
        }
        selection = next;
      }
    }
    drag = null;
  }

  function onCancel() {
    selection.clear();
    targeting = null;
    hoverSite = null;
  }

  function onKey(key) {
    // Digits 1-4 and the power hotkeys (Q W E R T) belong to the battle HUD's own listener.
    if (!active) return;
    if (key === 'Escape') { onCancel(); return; }
    if (key === ' ' || key === 'Spacebar') { togglePause(); return; }
    if ((key === 'a' || key === 'A') && phase === 'live') {
      selection = new Set(battle.sites.filter((s) => s.owner === PLAYER_OWNER).map((s) => s.id));
    }
  }

  function installHandlers() {
    const hd = input.handlers;
    for (const k of Object.keys(hd)) delete hd[k];
    hd.onTap = onTap;
    hd.onHover = onHover;
    hd.canStartDrag = canStartDrag;
    hd.onDragStart = onDragStart;
    hd.onDragMove = onDragMove;
    hd.onDragEnd = onDragEnd;
    hd.onCancel = onCancel;
    hd.onKey = onKey;
  }

  // --- battle HUD / powers ---------------------------------------------------------
  function onSendFraction(f) {
    if (!active) return;
    sendFraction = f;
    ui.battleHud.update({ sendFraction: f });
  }

  function togglePause() {
    if (!active || phase !== 'live') return;
    paused = !paused;
    ui.battleHud.update({ paused });
    ui.battleHud.el.classList.toggle('is-paused', paused);
  }

  function onSpeed(next) {
    if (!active) return;
    speed = next;
    container.get().state.settings.speed = next;
    ui.battleHud.update({ speed });
  }

  function onPower(id) {
    if (!active || !battle || phase !== 'live') return;
    const level = battle.player.powers[id] || 0;
    if (level < 1) { sfx.play('error'); ui.toasts.update({ message: 'Unlock this power in the War Council', duration: 2200 }); return; }
    if (battle.t < battle.cooldowns[id]) { sfx.play('error'); return; }
    if (id === 'march' || id === 'levy') {
      issue(battle, { type: 'power', owner: PLAYER_OWNER, power: id, target: null });
      return;
    }
    if (targeting && targeting.power === id) { targeting = null; return; } // press again to cancel
    targeting = { power: id };
    if (!toastedTargeting) {
      toastedTargeting = true;
      const msg = id === 'firestorm' ? 'Pick where the fire falls' : id === 'bulwark' ? 'Pick one of your settlements' : 'Pick the settlement to rally to';
      ui.toasts.update({ message: msg, duration: 2200 });
    }
  }

  function updateBattleHud(nowMs, force = false) {
    if (!force && nowMs - lastHudMs < HUD_HZ_MS) return;
    lastHudMs = nowMs;
    const youCount = battle.sites.filter((s) => s.owner === PLAYER_OWNER).length;
    const enemyCount = battle.sites.length - youCount;
    ui.battleHud.update({
      regionName: world.regions[regionId].name,
      territory: {
        you: youCount || 0.01,
        enemy: enemyCount || 0.01,
        youColor: factionColor(PLAYER_FACTION),
        enemyColor: factionColor(battle.arena.enemyFaction),
      },
      timeSec: battle.t,
      sendFraction,
      speed,
      paused,
      powers: POWER_IDS.map((id) => {
        const level = battle.player.powers[id] || 0;
        const locked = level < 1;
        let frac = 0;
        let sec = 0;
        if (!locked) {
          const total = cooldownSeconds(id, level);
          sec = Math.max(0, battle.cooldowns[id] - battle.t);
          frac = total > 0 ? Math.max(0, Math.min(1, sec / total)) : 0;
        }
        return {
          id, icon: UPGRADES[id].icon, name: UPGRADES[id].name, shortName: SHORT_POWER_NAMES[id], level, locked, cooldownFrac: frac, cooldownSec: sec, armed: targeting?.power === id,
        };
      }),
    });
  }

  function showControls() {
    const col = (title, rows) => h('div.hd-controls-col', {}, h('h3', {}, title), ...rows.map(([k, v]) => h('p', {}, h('b', {}, k), ` ${v}`)));
    const body = h('div.hd-controls', {},
      col('Mouse', [
        ['Drag', 'from your settlement to send troops'],
        ['Click', 'settlements to select several, then click a target'],
        ['Shift-drag', 'lasso your settlements'],
        ['1–4', 'send 25 / 50 / 75 / 100%'],
        ['Q W E R T', 'powers • A select all • Space pause'],
        ['Right-click / Esc', 'cancel'],
      ]),
      col('Touch', [
        ['Drag', 'from your settlement to send troops'],
        ['Tap', 'your settlements to select, then tap a target'],
        ['Two fingers', 'pan and pinch-zoom'],
        ['Powers', 'tap a button, then tap the target'],
        ['Firestorm', 'tap twice to fire'],
      ]),
    );
    const modal = createModal({
      title: 'Controls',
      body,
      actions: [{ label: 'Got it', variant: 'primary', onClick: () => modal.destroy() }],
    }, { onDismiss: () => modal.destroy() });
    document.body.appendChild(modal.el);
  }

  function ensureHelpButton() {
    if (helpBtn) { helpBtn.hidden = false; return; }
    const cluster = ui.battleHud.el.querySelector('.battle-topright');
    if (!cluster) return;
    helpBtn = h('button.btn-icon.hd-help', { onClick: showControls, 'aria-label': 'Controls' }, '?');
    cluster.prepend(helpBtn);
  }

  // --- tutorial coach (PLAYFEEL §4 steps 3-5) ---------------------------------------
  function coachTarget(def, nowMs) {
    if (def.anchor === 'camp') {
      const camp = battle.sites.find((s) => s.type === 'camp');
      if (!camp) return null;
      const p = siteScreenPos(camp);
      return { x: p.x, y: p.y };
    }
    if (def.anchor === 'enemyKeep') {
      const keep = battle.sites.find((s) => s.type === 'keep' && s.owner !== PLAYER_OWNER);
      if (!keep) return null;
      const p = siteScreenPos(keep);
      return { x: p.x, y: p.y };
    }
    if (def.anchor === 'rally') {
      // Step 5 waits for battle time >= 20 s and Rally ready.
      if (battle.t < 20 || battle.t < battle.cooldowns.rally) return null;
      const btn = ui.battleHud.el.querySelectorAll('.power-btn')[POWER_IDS.indexOf('rally')];
      return btn ? { el: btn } : null;
    }
    void nowMs;
    return null;
  }

  function powerReady(id) {
    return battle.player.powers[id] >= 1 && battle.t >= (battle.cooldowns[id] || 0);
  }

  function hideStuckHint() {
    if (coachSig === 'stuck') { coachSig = 'off'; ui.coach.update({ visible: false }); }
  }

  /**
   * "Stuck? Firestorm their strongest site, or Rally everything at once." (hints on, once per battle, never while the tutorial is in a battle step):
   * after STUCK_HINT.afterSec of battle time with no capture of ours and a named power ready, anchored to that power's button.
   * Only unlocked, ready powers are named. Returns true while the hint is on screen.
   */
  function updateStuckHint(nowMs) {
    if (battle.stats.captured !== stuckCaptured) {
      stuckCaptured = battle.stats.captured;
      stuckCaptureT = battle.t;
      hideStuckHint(); // a capture means it is not stuck
    }
    if (coachSig === 'stuck') {
      if (phase !== 'live' || paused || nowMs - stuckAtMs > STUCK_HINT.showMs) hideStuckHint();
      else return true;
    }
    if (phase !== 'live' || paused || camera.isMoving()) return false;
    const tstep = tutorial.currentStepDef();
    const due = stuckHintDue({
      hintsOn: container.get().state.settings.hints !== false, tutorialStepId: tstep ? tstep.id : null, battleT: battle.t,
      lastCaptureT: stuckCaptureT, done: stuckDone, fireReady: powerReady('firestorm'), rallyReady: powerReady('rally'),
    });
    if (!due) return false;
    const btn = ui.battleHud.el.querySelectorAll('.power-btn')[POWER_IDS.indexOf(due.power)];
    if (!btn) return false;
    stuckDone = true;
    stuckAtMs = nowMs;
    coachSig = 'stuck';
    ui.coach.update({
      visible: true, text: due.text, target: { el: btn },
      avoid: ui.battleHud.el.querySelector('.send-fraction-selector'), onDismiss: hideStuckHint,
    });
    return true;
  }

  function updateCoach(nowMs) {
    const def = tutorial.currentStepDef();
    const inBattleStep = def && def.id >= 3 && def.id <= 5;
    if (!inBattleStep) {
      // outside the tutorial's battle steps the coach only ever says "Stuck?" (and otherwise stays hidden)
      if (!updateStuckHint(nowMs) && coachSig !== 'off') { coachSig = 'off'; ui.coach.update({ visible: false }); }
      return;
    }
    if (phase !== 'live' || camera.isMoving() || paused) {
      if (coachSig !== 'off') { coachSig = 'off'; ui.coach.update({ visible: false }); }
      return;
    }
    const target = coachTarget(def, nowMs);
    if (!target) {
      if (coachSig !== 'off') { coachSig = 'off'; ui.coach.update({ visible: false }); }
      return;
    }
    const sig = target.el ? `${def.id}|el` : `${def.id}|${Math.round(target.x)},${Math.round(target.y)}`;
    if (sig === coachSig && nowMs - coachAt < 400) return;
    coachSig = sig;
    coachAt = nowMs;
    // The Rally hint sits over the bottom row: keep its bubble clear of the send-fraction bar.
    const avoid = def.anchor === 'rally' ? ui.battleHud.el.querySelector('.send-fraction-selector') : null;
    ui.coach.update({ visible: true, text: def.text, target, avoid });
  }

  /**
   * Where the step-3 arrow points: the nearest settlement the War Camp (never another site) can take with some room to
   * spare. A capture that leaves at least a fifth of the sent troops standing ranks ahead of a photo finish (the first
   * village can be a 15-vs-17.9 win with one troop left), which ranks ahead of a fail; ties go to the soonest arrival.
   */
  function tutorialArrowTarget() {
    const camp = battle && battle.sites.find((s) => s.type === 'camp' && s.owner === PLAYER_OWNER);
    if (!camp) return null;
    let best = null;
    let bestScore = Infinity;
    for (const s of battle.sites) {
      if (s.owner === PLAYER_OWNER) continue;
      const pv = previewSend(battle, [camp.id], s.id, sendFraction);
      const roomy = pv.outcome === 'capture' && pv.remaining >= pv.sending * 0.2;
      const score = (roomy ? 0 : pv.outcome === 'capture' ? 500 : 1000) + pv.arriveSec;
      if (score < bestScore) { bestScore = score; best = s; }
    }
    return best ? { camp, target: best } : null;
  }

  /** Tutorial step 3: an animated arrow from the War Camp to the settlement tutorialArrowTarget() picked. */
  function drawTutorialHand(t) {
    const def = tutorial.currentStepDef();
    if (!def || def.id !== 3 || phase !== 'live' || camera.isMoving()) return;
    const pick = tutorialArrowTarget();
    if (!pick) return;
    const a = siteScreenPos(pick.camp);
    const b = siteScreenPos(pick.target);
    // Stop short of both settlements so the arrow sits on open ground.
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const k0 = Math.min(0.3, 36 / len);
    const k1 = 1 - Math.min(0.3, 40 / len);
    ctx.save();
    ctx.globalAlpha = 0.55 + 0.4 * Math.sin(t * 4.5);
    drawDragArrow(ctx, a.x + dx * k0, a.y + dy * k0, a.x + dx * k1, a.y + dy * k1, ACCENTS.gold, t, { zoom: camera.zoom });
    ctx.restore();
  }

  // --- sim tick -------------------------------------------------------------------------
  function runSim(dtSec, nowMs) {
    const frameEvents = [];
    const alpha = stepper.advance(dtSec, paused ? 0 : speed, () => {
      renderer.units.snapshot(battle);
      lastOwnerSnapshot = battle.sites.map((s) => s.owner);
      const cmds = think(battle, battle.t);
      for (const cmd of cmds) issue(battle, cmd);
      step(battle, TICK_SEC);
      trackBattle(trackerOf(battle), battle); // once per STEP (3x speed runs several a frame)
      for (const ev of battle.events) frameEvents.push(ev);
    });
    for (const ev of frameEvents) handleEvent(ev, nowMs);
    return alpha;
  }

  // --- drawing -------------------------------------------------------------------------
  function drawSites(t, nowMs) {
    const list = battle.sites.map((site) => ({ site, p: siteWorldPos(site) }));
    list.sort((a, b) => a.p.y - b.p.y);
    const chips = [];
    for (const { site, p } of list) {
      const sp = camera.worldToScreen(p.x, p.y);
      let s = camera.zoom;
      let bannerDrop = 0;
      if (site.type === 'camp' && campDropStartMs != null) {
        const progress = Math.max(0, Math.min(1, (nowMs - campDropStartMs) / BATTLE_ENTER.campDropMs));
        s *= 0.15 + 0.85 * progress;
      }
      if (phase === 'defeat' && site.type === 'camp') {
        bannerDrop = Math.min(1, (nowMs - defeatAtMs) / DEFEAT.bannerFallMs);
      }
      const flashUntil = siteFlash.get(site.id) || 0;
      const owner = own.siteOwner(site.id, nowMs);
      renderer.sites.drawSite(ctx, sp.x, sp.y, s, site.type, owner, Math.floor(site.troops), t, {
        selected: selection.has(site.id),
        highlight: hoverSite === site.id && phase === 'live' && (!!targeting || !!drag),
        pulse: !!site.assault,
        phase: site.id * 1.31,
        bannerDrop,
        flash: flashUntil > nowMs ? (flashUntil - nowMs) / 700 : 0,
      });
      const threat = phase === 'live' ? threats.get(site.id) : undefined;
      if (threat) chips.push({ x: sp.x, y: sp.y, s, threat });
    }
    return chips;
  }

  /** The live send arrow's colour for a preview outcome: green captures, red falls short, gold otherwise. */
  function dragArrowColor(outcome) {
    return outcome === 'capture' ? DRAG_ARROW.capture : outcome === 'fail' ? DRAG_ARROW.fail : DRAG_ARROW.neutral;
  }

  function drawOverlays(t) {
    if (drag && drag.kind === 'send') {
      const cur = drag.target != null && !drag.from.includes(drag.target)
        ? siteScreenPos(battle.sites[drag.target])
        : camera.worldToScreen(drag.currentWorld.x, drag.currentWorld.y);
      // Tutorial step 3 promises "the arrow tells you if you'll take it": green when the send would capture, red when it
      // would not, gold while it is not over a target (and for a reinforcement), always with the tooltip's words as well.
      const arrowColor = dragArrowColor(drag.outcome);
      for (const id of drag.from) {
        const o = siteScreenPos(battle.sites[id]);
        drawDragArrow(ctx, o.x, o.y, cur.x, cur.y, arrowColor, t, { zoom: camera.zoom });
      }
    } else if (drag && drag.kind === 'lasso') {
      renderer.overlays.drawLasso(ctx, drag.x0, drag.y0, drag.x1, drag.y1);
    }
    if (targeting) {
      const color = targeting.power === 'firestorm' ? ACCENTS.bad : ACCENTS.gold;
      if (targeting.power === 'firestorm') {
        const at = targeting.pending || hoverWorld;
        renderer.overlays.drawBlastRadius(ctx, camera, at.x, at.y, firestormRadiusWorld(), color);
      }
      for (const site of battle.sites) {
        if (targeting.power === 'bulwark' && site.owner !== PLAYER_OWNER) continue;
        if (targeting.power === 'firestorm') continue;
        const p = siteWorldPos(site);
        renderer.overlays.drawTargetRing(ctx, camera, p.x, p.y, color, t);
      }
    }
    drawTutorialHand(t);
  }

  function frame(dt, t, nowMs) {
    camera.update(dt);
    const fx = renderer.fx;
    const stopped = nowMs < hitStopUntilMs;

    if (phase === 'entering') {
      enterElapsedSec += dt;
      const fade = (enterElapsedSec - 0.45) / (BATTLE_ENTER.dimFadeMs / 1000);
      dimAlpha = Math.max(0, Math.min(MAX_DIM, fade * MAX_DIM));
      if (campDropStartMs == null && enterElapsedSec >= (BATTLE_ENTER.flyMs / 1000) * 0.8) {
        campDropStartMs = nowMs;
        const camp = battle.sites.find((s) => s.type === 'camp');
        if (camp) {
          const p = siteWorldPos(camp);
          fx.spawn('dust', p.x, p.y, { count: 10 });
        }
        sfx.play('rally');
      }
      if (!camera.isMoving() && enterElapsedSec >= BATTLE_ENTER.flyMs / 1000) {
        phase = 'live';
        dimAlpha = MAX_DIM;
        ui.battleHud.el.hidden = false;
        ensureHelpButton();
        updateBattleHud(nowMs, true);
        speakBattleStart();
      }
    }

    // The sim holds still during the keep-capture hit-stop; everything else keeps drawing.
    let alpha = 1;
    if (phase === 'live' && !stopped) alpha = runSim(dt, nowMs);

    if (phase === 'victory' && victory) updateVictory(nowMs);
    if (phase === 'defeat' && !resultsShown && nowMs - defeatAtMs >= DEFEAT.bannerFallMs) showResults();
    if (phase === 'leaving' && leaving) {
      const k = Math.min(1, (nowMs - leaving.startMs) / leaving.ms);
      dimAlpha = leaving.from * (1 - k);
      if (k >= 1) { const fn = leaving.then; leaving = null; fn(); return; }
    }

    if (phase === 'live') {
      // Battle energy for the score, from the shared formula (smoothed and bar-quantised inside).
      music.setIntensity(battleIntensity(battle));
      music.setAssault(battleAssault(battle));
    }

    if (phase === 'live' && nowMs - lastThreatMs >= THREAT_HZ_MS) {
      lastThreatMs = nowMs;
      threats = computeThreats(battle);
    }

    // --- draw ---
    const world0 = world;
    renderer.beginFrame(camera, fx.shakeOffset());
    renderer.terrain.draw(ctx, camera, battleOwners);
    renderer.terrain.drawGlints(ctx, camera, t);
    renderer.arena.drawTerritory(ctx, camera, (tile) => own.tileOwner(tile, nowMs), own.signature(nowMs));
    renderer.clouds.drawShadows(ctx, camera, t);
    renderer.clouds.draw(ctx, camera, hiddenIds, t, nowMs, 1);
    renderer.arena.drawDim(ctx, camera, dimAlpha);
    renderer.overlays.drawArenaGlow(ctx, camera, regionId, t);
    if (phase !== 'entering') renderer.units.drawIntent(ctx, camera, battle, t);
    const chips = drawSites(t, nowMs);
    renderer.units.draw(ctx, camera, battle, alpha, t);
    if (!stopped) fx.update(dt);
    fx.draw(ctx, camera);
    renderer.sites.drawThreatChips(ctx, chips, t); // last, so nothing covers the readout
    drawOverlays(t);
    void world0;

    if (phase === 'live') updateBattleHud(nowMs);
    updateCoach(nowMs);
  }

  // --- lifecycle -----------------------------------------------------------------------
  function frameRect() {
    const W = renderer.cssWidth;
    const H = renderer.cssHeight;
    return W <= 840
      ? { x0: 8, y0: 112, x1: W - 8, y1: H - 184 }
      : { x0: 16, y0: 104, x1: W - 16, y1: H - 156 };
  }

  function applyBattleCamera(instant) {
    const focus = battle.arena.focus;
    const rect = frameRect();
    openCameraLimits(camera);
    const phone = services.isPhone();
    const cap = phone ? 46 : 60; // comfortable framing zoom (px per hex)
    camera.setBounds(null);
    const target = frameInRect(camera, focus, rect, { padding: 10, maxZoom: cap });
    // The player may zoom out ~25% from the framing and in to the desktop/phone maximum.
    camera.setZoomLimits(target.zoom * 0.75, Math.max(phone ? 50 : 70, target.zoom * 1.3));
    camera.setBounds(focus, 3);
    camera.flyTo(target, instant || reduceMotion() ? 1 : BATTLE_ENTER.flyMs);
  }

  function setupView(opts = {}) {
    const { state } = container.get();
    active = true;
    renderer.ambient.setEnabled(false); // no caravans, smoke or birds over a fight; the world scene turns it back on
    input.setEnabled(true);
    installHandlers();
    services.hideAllPanels();
    ui.results.el.hidden = true;
    ui.tooltip.update({ visible: false });
    if (skipBtn) skipBtn.hidden = true;

    const reveal = revealed(state, world);
    battleOwners = state.owner.map((o, i) => (i === regionId || !reveal[i] ? -1 : o));
    hiddenIds = world.regions.filter((r) => !reveal[r.id]).map((r) => r.id);
    own = createArenaOwnership(world, battle, regionId, state.owner);
    const holeTiles = new Map();
    for (const t of battle.arena.tiles) holeTiles.set(t.i, world.tiles[t.i]);
    for (const t of own.regionTiles) holeTiles.set(t.i, t);
    renderer.arena.begin({ regionId, holeTiles: [...holeTiles.values()] });

    selection = new Set();
    targeting = null;
    drag = null;
    hoverSite = null;
    victory = null;
    leaving = null;
    resultsShown = false;
    lastResult = null;
    crownResult = null;
    hitStopUntilMs = 0;
    surrenderSites = [];
    threats = new Map();
    lastThreatMs = -1e9;
    siteFlash.clear();
    assaultSpark.clear();
    paused = false;
    speed = state.settings.speed || 1;
    sendFraction = 0.5;
    enterElapsedSec = 0;
    campDropStartMs = null;
    coachSig = '';
    stuckDone = false;
    stuckCaptured = 0;
    stuckCaptureT = 0;
    lastOwnerSnapshot = battle.sites.map((s) => s.owner);
    renderer.units.reset();
    renderer.units.snapshot(battle);
    ui.battleHud.el.classList.remove('is-paused');
    if (opts.skipIntro) {
      phase = 'live';
      dimAlpha = MAX_DIM;
      campDropStartMs = -1e9;
    } else {
      phase = 'entering';
      dimAlpha = 0;
    }
    applyBattleCamera(!!opts.skipIntro);
    ui.battleHud.el.hidden = !opts.skipIntro;
    if (opts.skipIntro) ensureHelpButton();
    updateBattleHud(performance.now(), true);
  }

  /**
   * The fight goes live: a sabotaged region says so in a toast ("Your agents weakened the garrisons"), and its
   * leader reacts with a `sabotaged` line INSTEAD of the usual greeting; capitals have their own greeting.
   */
  function speakBattleStart() {
    const { state } = container.get();
    const note = sabotageBattleNote(state, regionId);
    const trigger = sabotageLevel(state, regionId) > 0 ? 'sabotaged'
      : world.regions[regionId].isCapital ? 'capitalBattleStart' : 'battleStart';
    speak(trigger, battle.arena.enemyFaction, regionId); // the leader first: on a phone the toast waits for the banner
    if (note) ui.toasts.update({ type: 'warning', icon: 'flame', message: note });
  }

  function startBattle(id, opts = {}) {
    music.setScene('battle'); // Retry does not go through goto.battle
    const { state } = container.get();
    world = container.get().world;
    regionId = id;
    const player = playerBattleStats(state, world);
    const enemy = enemyBattleStats(world, state, regionId);
    const arena = buildArena(world, state.owner, regionId, player, enemy);
    battle = createBattle(arena, player, enemy);
    trackerOf(battle); // crowns tracker: plain JSON, saved with state.battle
    voice.resetBattle(); // every leader trigger may speak again
    state.battle = battle;
    setupView(opts);
    tutorial.notify('battleStart');
    if (opts.skipIntro) speakBattleStart(); // Retry lands live at once; a fresh fight speaks when the fly-in ends
  }

  function enter(payload = {}) {
    const { state } = container.get();
    world = container.get().world;
    renderer.fx.clear();
    if (payload.resume && state.battle) {
      battle = state.battle;
      regionId = battle.arena.regionId;
      setupView({ skipIntro: true });
      if (battle.result) {
        lastResult = battle.result;
        phase = battle.result === 'win' ? 'victory' : 'defeat';
        if (battle.result === 'win') {
          crownResult = evaluateBattle(trackerOf(battle), battle, world, regionId, state);
          victory = { fanfared: true, slots: [], flood: { schedule: [] }, nextSlot: 0, nextFlood: 0, endMs: 0 };
        }
        showResults();
      } else {
        ui.toasts.update({ message: 'Battle resumed' });
      }
    } else {
      startBattle(payload.regionId, {});
    }
  }

  function exit() {
    active = false;
    ui.battleHud.el.hidden = true;
    ui.results.el.hidden = true;
    ui.tooltip.update({ visible: false });
    ui.coach.update({ visible: false });
    if (skipBtn) skipBtn.hidden = true;
    renderer.canvas.style.cursor = '';
    renderer.units.reset();
    renderer.arena.end();
    if (own) own.settle();
    renderer.fx.clear();
  }

  function onResize() {
    if (active && battle) applyBattleCamera(true);
  }

  return {
    enter,
    exit,
    frame,
    onResize,
    onSendFraction,
    onPauseToggle: togglePause,
    onSpeed,
    onPower,
    onRetreat,
    onResultsContinue,
    onRetry,
    onBackToMap,
    forceWin() {
      if (!battle || battle.result || phase !== 'live') return;
      const nowMs = performance.now();
      lastOwnerSnapshot = battle.sites.map((s) => s.owner);
      const flipped = [];
      for (const site of battle.sites) {
        if (siteTile(site).region === regionId && site.owner !== PLAYER_OWNER) { site.owner = PLAYER_OWNER; flipped.push(site.id); }
      }
      battle.result = 'win';
      battle.stats.durationSec = battle.t;
      surrenderSites = flipped;
      beginEndSequence('win', nowMs);
    },
    forceLose() {
      if (!battle || battle.result || phase !== 'live') return;
      for (const site of battle.sites) if (site.owner === PLAYER_OWNER) site.owner = -1;
      battle.squads = battle.squads.filter((sq) => sq.owner !== PLAYER_OWNER);
      battle.result = 'lose';
      battle.stats.durationSec = battle.t;
      beginEndSequence('lose', performance.now());
    },
    screenPosOfSite(id) {
      if (!battle) return null;
      const site = battle.sites[id];
      return site ? siteScreenPos(site) : null;
    },
    /** Dev/automation: every site with its owner, troops and screen position. */
    siteInfo() {
      if (!battle) return [];
      return battle.sites.map((s) => {
        const p = siteScreenPos(s);
        return { id: s.id, type: s.type, owner: s.owner, troops: s.troops, x: p.x, y: p.y };
      });
    },
    /** Dev/automation: the current threat readout (what the chips say). */
    threatInfo() {
      return [...threats.values()].map((t) => ({ siteId: t.siteId, holds: t.holds, text: t.text, incoming: t.incoming, etaSec: t.etaSec }));
    },
    /** Dev/automation: whether the "Stuck?" hint is on screen, and whether it has already been used this battle. */
    stuckHint() {
      return { showing: coachSig === 'stuck', done: stuckDone, sinceCaptureSec: battle ? Math.round((battle.t - stuckCaptureT) * 10) / 10 : null };
    },
    /** Dev/automation: the step-3 tutorial arrow's endpoints as site ids ({ from: camp, to }), or null. */
    tutorialArrow() {
      const pick = tutorialArrowTarget();
      return pick ? { from: pick.camp.id, to: pick.target.id } : null;
    },
    /** Dev/automation: the send drag in progress ({ outcome, color }: what its arrow shows), or null. */
    dragInfo() {
      return drag && drag.kind === 'send' ? { outcome: drag.outcome ?? null, color: dragArrowColor(drag.outcome) } : null;
    },
    get phase() { return phase; },
    get battle() { return battle; },
  };
}
