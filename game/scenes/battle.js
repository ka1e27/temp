// Battle scene (DESIGN §4, PLAYFEEL §3): the fight on the real terrain. Orchestrates the enter
// choreography, the fixed-step sim, drag/tap/lasso orders, powers, enemy-intent and threat readouts,
// the victory sequence (hit-stop, surrender cascade, tile flood, fanfare, card) and the defeat /
// retreat cards. The look of the arena itself lives in render/arenaLayer.js (live territory + soft
// dim) and render/units.js (squads, intent lines); who-owns-what timing in scenes/arenaOwnership.js.
import { edictMods, commanderFor as edictCommander } from '../meta/edicts.js';
import { hexDistance } from '../core/hex.js';
import { elevOffset } from '../render/tiles.js';
import { drawDragArrow } from '../render/sprites.js';
import { factionColor, factionColorLight, ACCENTS } from '../render/palette.js';
import { hitTestSites } from '../render/sites.js';
import {
  drawSupplyLine, drawWaitingLine, drawReachGlow, drawNoRoute, drawArmedRing,
} from '../render/supplyLines.js';
import { buildArena } from '../battle/arena.js';
import {
  createBattle, issue, previewSend, canRoute, routeFor,
} from '../battle/sim.js';
import { tileAt } from '../battle/runtime.js';
import { PLAYER_OWNER, FREE_FOLK_OWNER } from '../battle/owner.js';
import { hexRadiusToWorld } from '../battle/geom.js';
import {
  playerBattleStats, enemyBattleStats, revealed, conquestBounty, crownsPayable, difficulty
} from '../meta/progression.js';
import { PLAYER_FACTION } from '../meta/state.js';
import { plausibleBattle } from '../meta/save.js';
import { announce } from '../ui/live.js';
import { icon } from '../ui/icons.js';
import { POWER_IDS, UPGRADES } from '../meta/upgrades.js';
import { bounty } from '../meta/economy.js';
import {
  trackerOf, evaluateBattle, crownBonus, swiftDeadlineSec,
} from '../meta/crowns.js';
import { CROWN_BONUS_PCT } from '../app/crownCopy.js';
import { sabotageBattleNote, sabotageLevel } from '../meta/intel.js';
import { calmUnrest } from '../meta/unrest.js';
import { battleIntensity, battleAssault } from '../audio/musicIntensity.js';
import { POWERS, SUPPLY } from '../config/battle.js';
import { FRONTIER } from '../config/frontier.js';
import { EVENTS } from '../config/events.js';
import { attackArenaOpts } from '../meta/frontier.js';
import { bestFreeGeneral, freeGenerals, generalById, abilityText } from '../meta/generals.js';
import { abilityState } from '../battle/sim.js';
import { GENERALS } from '../config/generals.js';
import { generalEmblem } from '../ui/generalsPanel.js';
import { perkDisplay } from '../app/perkInfo.js';
import { effectiveRegionIncome } from '../app/income.js';
import { createModal } from '../ui/modal.js';
import { h } from '../ui/dom.js';
import {
  BATTLE_ENTER, VICTORY, DEFEAT, DRAG_ARROW, STUCK_HINT, NO_ROUTE_TEXT,
} from './timing.js';
import { stuckHintDue } from './stuckHint.js';
import { showControls } from '../ui/controls.js';
import { onDialogChange, dialogCount } from '../ui/dialogs.js';
import { siteBox, unionBox, boxOfRect } from '../app/hintTargets.js';
import { FEATURES } from '../app/features.js';
import { createArenaOwnership } from './arenaOwnership.js';
import { createBattleFeatures } from './battleFeatures.js';
import { createBattleAshen } from './battleAshen.js';
import { createBattleSea } from './battleSea.js';
import { createBattleThrone } from './battleThrone.js'; // PLAN-PHASE13: the Throne of Ages
import { drawSeaLane } from '../render/seaMarks.js';
import { createBattleBoons } from './battleBoons.js';
import { championTitle } from '../meta/leaders.js';
import { computeThreats } from './battleThreat.js';
import { matches, bindingOf, actionFor } from '../ui/keymap.js';
import {
  frameInRect, openCameraLimits, pickLandTile,
} from './worldLayers.js';

const THREAT_HZ_MS = 250; // threat chips recompute at ~4 Hz
const HUD_HZ_MS = 66; // battle HUD refresh (~15 Hz)
const MAX_DIM = 1 - BATTLE_ENTER.dimBrightness;
// Phone-width labels for the power buttons (UI copy): short enough that nothing is ellipsised.
const SHORT_POWER_NAMES = { rally: 'Rally', firestorm: 'Storm', bulwark: 'Bulwark', march: 'March', levy: 'Levy' };

/** A saved battle that can really be resumed: the right shape (meta/save.js plausibleBattle) and a region the player has not already taken. */
function resumable(b, state, world, kind = 'attack') {
  if (!plausibleBattle(b, state.owner.length) || !world.regions[b.arena.regionId]) return false;
  // an attack on a region already won would be a ghost fight; a DEFENSE is fought in a region that is still yours
  return kind === 'defense' || kind === 'duel' ? state.owner[b.arena.regionId] === PLAYER_FACTION : state.owner[b.arena.regionId] !== PLAYER_FACTION; // a Duel too is fought in a region of yours
}

/**
 * @param {object} services shared instances from main.js.
 */
export function createBattleScene(services) {
  const {
    camera, renderer, ui, input, container, sfx, tutorial, goto, music, speak, voice,
  } = services;
  const { ctx } = renderer;
  // Battles live in the manager (app/battles.js, ARCHITECTURE 10.1): it steps every run; this scene is a VIEW of the run it is focused on.
  const manager = services.battles;

  let active = false;
  let world = null;
  let regionId = null;
  let battle = null;
  let run = null; // the BattleRun this view shows (manager.focused())
  let own = null; // arena ownership (display owners, ripple, cascade, flood)
  let battleOwners = []; // region -> faction for the chunked terrain (target region + fog blanked)
  let hiddenIds = []; // fogged regions, kept under the dim

  let selection = new Set();
  let targeting = null; // { power, pending?: {x, y} } (pending = touch two-step firestorm)
  let hoverWorld = { x: 0, y: 0 };
  let hoverSite = null;
  let drag = null; // { kind:'send', from:[ids], target, currentWorld } | { kind:'lasso', x0,y0,x1,y1 }
  let sendFraction = 0.5;
  let siteCursor = -1; // the keyboard cursor: a settlement (arrow keys move it, Enter selects or sends)
  let keyboardUsed = false; // the cursor has been moved from the keyboard: it is drawn, and Enter acts
  let toldQueued = false; // "Orders go out when you resume": said once per session
  let paused = false;
  let dialogOpen = false; // any dialog (settings, council, a confirmation...) pauses the fight until the last one closes (DESIGN §7.5a)
  let speed = 1;
  // Supply lines (DESIGN 4.3) and front lines (4.4), the UI half:
  let autoMode = false; // the HUD's Auto toggle: while on, every send order becomes a supply line (kept between battles, like the speed)
  let armedSupply = null; // { siteId, atMs }: a touch long-press on one of our settlements; the drag that follows makes a supply line
  let downInfo = null; // modifier keys (ctrl, alt, shift) of the latest pointer-down
  let refusal = null; // { site, startMs, tipUntilMs }: a send with no route: the target shakes and a tooltip says why
  let toldSupply = false; // the one-time "what a supply line does" toast
  let lastArrowSfx = 0;

  let phase = 'entering'; // entering -> live -> victory | defeat -> leaving
  let enterElapsedSec = 0;
  let campDropStartMs = null;
  let dimAlpha = 0;
  let hitStopUntilMs = 0;
  let victory = null;
  let defeatAtMs = 0;
  let leaving = null;
  let resultsShown = false;
  let continuing = false; // Continue pressed on a win: the Relic moment / Boon draft play before the scene leaves
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
  let noRouteSeen = false; // a send was refused for want of a route this battle (tutorial step C2)
  let stuckAtMs = 0;
  let stuckCaptured = 0;
  let stuckCaptureT = 0;
  let toastedTargeting = false;
  let surrenderSites = []; // sites the last `surrender` event flipped (victory cascade)

  const reduceMotion = () => !!container.get().state.settings.reduceMotion;
  const isMine = (id) => active && !!run && id === run.id;
  /** The run shown is a DEFENSE of one of your regions (DESIGN 10.1): site 0 is the ENEMY's war-band camp there, the end is "Defended" or "Region lost". */
  // a Duel (DESIGN 10.13) is fought like a defense: site 0 is the champion's war band, you hold until the time runs out
  const isDefense = () => !!run && (run.kind === 'defense' || run.kind === 'duel');
  const isDuel = () => !!run && run.kind === 'duel';
  /** "the Crimson Legion": the attacker of a defense, or the defender of an attack. */
  const theAttacker = () => {
    const f = world.factions[run && run.attackerFaction != null ? run.attackerFaction : battle.arena.enemyFaction];
    return f ? (/^the /i.test(f.name) ? f.name : `the ${f.name}`) : 'the enemy';
  };
  /** The Retreat confirmation's warning while a conquest streak is alive (PLAN-PHASE4 §4B; app/goals.js), or ''. */
  const streakWarning = () => (services.goals ? services.goals.retreatWarning() : '');
  // the manager steps the run; the view snapshots the units and owners before each step and plays the events of the run it shows
  manager.on('beforeStep', (id) => {
    if (!isMine(id)) return;
    renderer.units.snapshot(battle);
    lastOwnerSnapshot = battle.sites.map((s) => s.owner);
  });
  manager.on('events', (id, events) => {
    if (!isMine(id)) return;
    const nowMs = performance.now();
    for (const ev of events) handleEvent(ev, nowMs);
  });

  // --- geometry / helpers -------------------------------------------------------
  function siteTile(site) {
    return tileAt(battle, site.tile);
  }

  /** World position of a site's ground point (raised by its tile's elevation, like everything drawn on it). */
  /**
   * The roads across a border-march strip (DESIGN 4.4), as the squads actually walk them: for every settlement the War Camp can route to at the start, the part of
   * its route that runs over the strip's no-man's-land (`link` tiles), from the camp to the first tile of the settlement's land. Routes that leave the strip at
   * the same tile share one road; its marker points at the nearest settlement it leads to (a strip can serve more than one target).
   * @returns {{ points: {x:number,y:number}[], exit: {x:number,y:number}|null, toward: {x:number,y:number}|null }[]} world units, lifted by elevation
   */
  function stripRoads() {
    const link = new Set(battle.arena.tiles.filter((t) => t.link).map((t) => t.i));
    if (!link.size) return [];
    const camp = battle.sites.find((s) => s.type === 'camp' && s.owner === PLAYER_OWNER);
    if (!camp) return [];
    const lifted = (i) => { const w = world.tiles[i]; return w ? { x: w.x, y: w.y - elevOffset(w, 1) } : null; };
    const byExit = new Map();
    for (const site of battle.sites) {
      if (site.owner === PLAYER_OWNER) continue;
      let r = null;
      try { r = routeFor(battle, PLAYER_OWNER, camp.id, site.id); } catch { r = null; }
      if (!r || !r.tiles.length) continue;
      const seq = [camp.tile];
      let k = 0;
      while (k < r.tiles.length && link.has(r.tiles[k])) seq.push(r.tiles[k++]);
      if (seq.length < 2) continue; // this route does not use the strip
      const exit = k < r.tiles.length ? r.tiles[k] : null;
      const key = `${seq.join(',')}>${exit}`;
      const steps = r.tiles.length;
      const prev = byExit.get(key);
      if (!prev || steps < prev.steps) byExit.set(key, { seq, exit, site, steps });
    }
    return [...byExit.values()].map(({ seq, exit, site }) => {
      const points = seq.map(lifted).filter(Boolean);
      const last = points[points.length - 1];
      const e = exit != null ? lifted(exit) : null;
      return { points, exit: e ? { x: (last.x + e.x) / 2, y: (last.y + e.y) / 2 } : null, toward: siteWorldPos(site) };
    });
  }

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

  // A varied map (DESIGN 10.13): twists, feature sites and the Dragon (scenes/battleFeatures.js draws and words them)
  const feat = createBattleFeatures({
    ctx, camera, renderer, sfx, ui, container, reduceMotion, tutorial, siteWorldPos, playerFaction: PLAYER_FACTION,
    ownerFaction: (owner) => (owner === PLAYER_OWNER ? PLAYER_FACTION : owner === FREE_FOLK_OWNER ? -1 : battle.arena.enemyFaction),
  });

  // The Ashen Host (PLAN-PHASE6 §6B): The Fallen Rise's wisps, Firestorm burning the dead, the Barrow Keep's Rising (scenes/battleAshen.js)
  const ashen = createBattleAshen({ ctx, camera, renderer, sfx, ui, reduceMotion, siteWorldPos });
  // Phase 7: boonTriggered pops and Scorched Earth's ground (scenes/battleBoons.js)
  const boonFx = createBattleBoons({ ctx, camera, ui, sfx, reduceMotion });
  // PLAN-PHASE12: harbours, sea lanes, the Tide Fortress's Tide and boats, the Admiral's Broadside (scenes/battleSea.js)
  const seaFx = createBattleSea({ ctx, camera, renderer, sfx, reduceMotion, siteWorldPos });
  // PLAN-PHASE13: the Throne of Ages: Champion banners, phase banners, the borrowed Rising / Tide / Plague, the Usurper-King (scenes/battleThrone.js)
  const throne = createBattleThrone({
    ctx, camera, renderer, sfx, ui, reduceMotion, siteWorldPos, tutorial, getState: () => container.get().state,
    leaderLine: (d) => services.leaderLine?.({ ...d, faction: world.factions[d.faction] }),
  });

  // --- fx / sfx event routing (INTEGRATION-NOTES event mapping) ---------------------
  function handleEvent(ev, nowMs) {
    const fx = renderer.fx;
    if (throne.onEvent(ev, nowMs)) return; // first: a borrowed tideHit is the Throne's, even on a coast
    if (ashen.onEvent(ev, nowMs)) return;
    if (seaFx.onEvent(ev, nowMs)) return;
    if (boonFx.onEvent(ev, nowMs)) return;
    if (feat.onEvent(ev, nowMs)) return;
    switch (ev.type) {
      case 'send': {
        const p = siteWorldPos(battle.sites[ev.from]);
        // a supply line's own sends (`auto`) come every few seconds per line: a small puff and no whoosh, or the field would never stop
        fx.spawn('dust', p.x, p.y, ev.auto ? { count: 3 } : {});
        if (ev.owner === PLAYER_OWNER && !ev.auto) sfx.play('send');
        break;
      }
      case 'supply': {
        if (ev.owner !== PLAYER_OWNER) break;
        const p = siteWorldPos(battle.sites[ev.from]);
        fx.spawn('floatText', p.x, p.y - 0.5, { text: 'Supply line', color: factionColor(PLAYER_FACTION), size: 0.3 });
        sfx.play('click', { volume: 0.55 });
        tutorial.notify('supplyCreated');
        if (!toldSupply) {
          toldSupply = true;
          const remove = services.isTouch() ? 'Long-press' : 'Right-click';
          ui.toasts.update({ message: `Supply line set: it sends ${Math.round(SUPPLY.fraction * 100)}% of its troops every ${supplySec()} s. ${remove} the source to remove it.`, duration: 4600 });
        }
        break;
      }
      case 'unsupply': {
        if (ev.owner !== PLAYER_OWNER) break;
        const p = siteWorldPos(battle.sites[ev.from]);
        const lost = ev.reason === 'lost';
        fx.spawn('floatText', p.x, p.y - 0.5, { text: lost ? 'Line lost' : 'Line removed', color: lost ? ACCENTS.bad : factionColor(PLAYER_FACTION), size: 0.3 });
        sfx.play(lost ? 'lost' : 'click', { volume: 0.45 });
        break;
      }
      case 'refused': if (ev.owner === PLAYER_OWNER) onRefused(ev, nowMs); break;
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
      case 'arrow': // a tower's or (Watchtower Works) the War Camp's volley: the source is in x1, y1 either way
        fx.spawn('arrow', ev.x1, ev.y1, { to: { x: ev.x2, y: ev.y2 } });
        if (nowMs - lastArrowSfx > 140) { lastArrowSfx = nowMs; sfx.play('arrow', { volume: 0.35 }); } // several sources can loose at once: one twang
        break;
      case 'power': handlePowerEvent(ev); break;
      case 'ability': handleAbilityEvent(ev); break;
      case 'championFell': handleChampionFell(ev); break;
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
      if (ev.owner === PLAYER_OWNER) tutorial.notify('rally');
    } else if (ev.power === 'firestorm') {
      fx.spawn('fireball', ev.x, ev.y, { delay: POWERS.firestorm.delay, radius: POWERS.firestorm.radius });
      sfx.play('fireball');
      if (ev.owner === PLAYER_OWNER) tutorial.notify('firestorm');
    } else if (ev.power === 'bulwark') {
      const level = battle.player.powers.bulwark;
      const duration = POWERS.bulwark.duration + POWERS.bulwark.durationPerLevel * (level - 1);
      fx.spawn('shield', ev.x, ev.y, { duration });
      sfx.play('bulwark');
      if (ev.owner === PLAYER_OWNER) tutorial.notify('bulwark');
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
  /** The end of a DEFENSE (DESIGN 10.1): no conquest choreography; a fanfare and "Defended", or the defeat cue and "Region lost". */
  function endDefense(result, nowMs) {
    targeting = null;
    drag = null;
    selection.clear();
    ui.tooltip.update({ visible: false });
    manager.recordResult(run.id);
    if (result === 'win') {
      sfx.play('victory');
      music.stinger('victory', { resolveInSec: 0.4 });
      const f = battle.arena.focus;
      if (!reduceMotion()) renderer.fx.spawn('confetti', (f.minX + f.maxX) / 2, (f.minY + f.maxY) / 2, {});
    } else {
      sfx.play('defeat');
      music.stinger('defeat');
    }
    phase = 'defeat'; // the same short pause before the card as a lost attack
    defeatAtMs = nowMs;
    resultsShown = false;
    continuing = false;
    services.autosave.save();
  }

  function beginEndSequence(result, nowMs) {
    lastResult = result;
    if (isDefense()) { endDefense(result, nowMs); return; }
    const { state } = container.get();
    targeting = null;
    drag = null;
    selection.clear();
    ui.tooltip.update({ visible: false });
    if (result === 'win') {
      crownResult = evaluateBattle(trackerOf(battle), battle, world, regionId, state);
      manager.recordResult(run.id); // lifetime stats (troops sent, battles won, settlements taken, best time): the manager's, shared with unwatched runs
      startVictory(nowMs);
    } else {
      manager.recordResult(run.id);
      if (result === 'lose') {
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
    continuing = false;
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
    // a tip never names a power the player cannot use here (Iron Will, Holy Ground, not unlocked): "soften them with Firestorm" read as a cruel joke
    const usable = (id) => (battle.player.powers[id] || 0) >= 1 && !noPowers() && !feat.powerFlags(id).holy;
    if (hasFort) return usable('firestorm') ? 'Forts defend at 1.8× — soften them with Firestorm first.' : 'Forts defend at 1.8× — take the settlements around one first, then hit it with one big send.';
    if (battle.stats.sent > 0 && battle.stats.captured === 0) {
      return usable('rally') ? 'Try sending from more than one settlement at once, or use Rally to hit all at once.' : 'Try sending from more than one settlement at once: a squad that arrives alone just feeds the garrison.';
    }
    if (battle.stats.sent === 0) return 'Drag from your War Camp to a settlement to send troops — the fight will not start itself.';
    if (battle.stats.lost > battle.stats.killed * 1.4) return 'Upgrade Muster or Steel in the War Council: you are trading troops badly.';
    return undefined;
  }

  function showResults() {
    resultsShown = true;
    const { state } = container.get();
    const region = world.regions[regionId];
    if (isDuel()) {
      // a Duel (DESIGN 10.13): its own card; the Renown is paid on Continue (app/battles.js finish -> duelReward)
      const champ = run.champion || theAttacker();
      ui.results.update({ result: lastResult === 'win' ? 'duelWon' : 'duelLost', regionName: region.name, renown: EVENTS.duel.renown, champion: champ, durationSec: battle.stats.durationSec, troopsLost: battle.stats.lost, troopsKilled: battle.stats.killed });
      ui.results.el.hidden = false;
      ui.battleHud.el.hidden = true;
      if (helpBtn) helpBtn.hidden = true;
      return;
    }
    if (isDefense()) {
      // the reward is paid on Continue (app/battles.js finish -> defenseReward); the card shows what it will be
      ui.results.update(lastResult === 'win'
        ? { result: 'defended', regionName: region.name, reward: Math.round(bounty(state, world, regionId) * FRONTIER.reward.bountyShare), durationSec: battle.stats.durationSec, troopsLost: battle.stats.lost, troopsKilled: battle.stats.killed }
        : { result: 'occupied', regionName: region.name, occupier: theAttacker(), durationSec: battle.stats.durationSec });
      ui.results.el.hidden = false;
      ui.battleHud.el.hidden = true;
      if (helpBtn) helpBtn.hidden = true;
      return;
    }
    if (lastResult === 'win') {
      if (!crownResult) crownResult = evaluateBattle(trackerOf(battle), battle, world, regionId, state);
      ui.results.update({
        result: 'victory',
        regionName: region.name,
        bounty: conquestBounty(state, world, regionId), // the payout's own function: a retake pays its share
        newIncome: effectiveRegionIncome(state, world, region),
        perk: perkDisplay(region.perk, world, region),
        durationSec: battle.stats.durationSec,
        troopsLost: battle.stats.lost,
        troopsKilled: battle.stats.killed,
        tideTook: battle.arena.sea && battle.arena.sea.tide && battle.sea ? Math.round(battle.sea.drowned || 0) : 0, // PLAN-PHASE12: the Tide Fortress's toll
        crowns: crownResult.crowns,
        parSec: crownResult.parSec,
        // exact, pre-conquest, from what conquer pays (awardCrowns multiplies the same base); a region that already holds crowns earns none again
        crownBonus: crownsPayable(state, regionId) ? crownBonus(state, world, regionId, crownResult.crowns, conquestBounty(state, world, regionId)) : 0,
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
    if (leaving || continuing) return;
    const id = run.id;
    continuing = true;
    ui.results.el.hidden = true;
    const regionName = world.regions[regionId] ? world.regions[regionId].name : '';
    // Phase 7: the win is applied NOW (conquer / defenseReward, which may claim a Relic and make a Boon offer), so the result card can hand over to the
    // Relic's moment and the Boon draft before the scene leaves (app/boons.js afterBattle); the map then plays the conquest as before
    const before = services.boons ? services.boons.snapshot() : '';
    services.boons?.beginSequence(); // a recruit card raised by the win waits its turn (Relic claim -> recruit -> draft)
    if (isDefense()) {
      const out = manager.finish(id); // defenseReward: the gold, the militia drain, the region's cooldown (a Duel: duelReward's Renown); the Champion's eye
      const go = () => leave(() => {
        continuing = false;
        goto.world({ cameFromBattle: true });
        if (out && out.kind === 'duel') { if (out.renown > 0) ui.toasts.update({ type: 'success', icon: 'laurel', message: `Duel won at ${world.regions[out.regionId].name}: +${out.renown} Renown` }); services.autosave.save(); return; }
        if (out && out.reward && out.reward.gold > 0) ui.toasts.update({ type: 'success', icon: 'coin', message: `${world.regions[out.regionId].name} held: +${Math.round(out.reward.gold)} gold` });
        services.autosave.save();
      });
      if (services.boons) services.boons.afterBattle({ before, regionName }, go); else go();
      return;
    }
    // conquer + crowns + chronicle: the manager applies a won attack (ARCHITECTURE 10.1), with the crowns this view already evaluated
    const out = manager.finish(id, { crownResult });
    const go = () => leave(() => {
      continuing = false;
      if (!out) { goto.world({ cameFromBattle: true }); return; }
      goto.world({
        cameFromBattle: true,
        conquered: {
          regionId: out.regionId, bounty: out.result.bounty + out.crownAward.bonusGold, beforeRevealed: out.beforeRevealed, oldOwner: out.oldOwner, frontierBefore: out.frontierBefore, decapitated: !!out.result.decapitated,
        },
      });
      services.autosave.save();
    });
    if (services.boons) services.boons.afterBattle({ before, regionName }, go); else go();
  }

  function onRetry() {
    if (leaving) return;
    if (run) manager.remove(run.id);
    startBattle(regionId, { skipIntro: true, commander: freeOrCaptain(lastCommander) }); // the same commander, if still free
  }

  function onBackToMap() {
    if (leaving) return;
    leave(() => {
      if (run) manager.finish(run.id); // a lost or retreated attack changes nothing; the run is removed
      goto.world({ cameFromBattle: true });
      services.autosave.save();
    });
  }

  function onRetreat() {
    if (!battle || battle.result || phase !== 'live') return;
    manager.retreat(run.id);
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
    if (power === 'ability') {
      // a Raid's target: an enemy settlement (DESIGN 10.11); a tap elsewhere cancels
      const siteId = hitTestSites(allSiteCandidates(), camera, sx, sy);
      targeting = null;
      if (siteId == null || battle.sites[siteId].owner === PLAYER_OWNER) { ui.toasts.update({ id: 'ability', message: 'Raid cancelled: pick an enemy settlement', duration: 1800 }); return; }
      useAbility(siteId);
      return;
    }
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
    if (power === 'bulwark' && site.owner !== PLAYER_OWNER) { refusedPower('Bulwark protects your own settlements.'); return; }
    issue(battle, { type: 'power', owner: PLAYER_OWNER, power, target: siteId });
    targeting = null;
  }

  function onTap(sx, sy, wx, wy, meta) {
    armedSupply = null;
    if (phase === 'victory') { finishVictory(); return; }
    if (phase !== 'live') return;
    if (targeting) { handleTargetTap(sx, sy, wx, wy, meta); return; }
    const siteId = hitTestSites(allSiteCandidates(), camera, sx, sy);
    if (siteId == null) { if (selection.size >= 2) tutorial.notify('selectionCleared'); selection.clear(); return; }
    activateSite(siteId);
  }

  /** What a click on a settlement does (and what Enter does on the keyboard cursor): select or deselect one of yours; with a selection, send it to another. */
  function activateSite(siteId, { fromCampIfNone = false } = {}) {
    const site = battle.sites[siteId];
    if (site.owner === PLAYER_OWNER) {
      if (selection.has(siteId)) selection.delete(siteId); else selection.add(siteId);
      sfx.play('click', { volume: 0.4 });
      return;
    }
    // the keyboard sends from the War Camp when nothing is selected (a mouse player would drag from it)
    if (selection.size === 0 && fromCampIfNone) { const camp = campSite(); if (camp) selection.add(camp.id); }
    if (selection.size > 0) {
      if (autoMode) {
        orderSupply([...selection], siteId); // Auto: every send order is a standing one
      } else {
        issue(battle, {
          type: 'send', owner: PLAYER_OWNER, from: [...selection], to: siteId, fraction: sendFraction,
        });
        if (selection.size >= 2) tutorial.notify('multiSend');
        tutorial.notify('send');
      }
      selection.clear();
    }
  }

  /** The seconds between a line's sends as THIS battle plays it (Stables Works next door shorten it), for every tooltip and toast. */
  function supplySec() {
    const v = SUPPLY.intervalSec * (battle && battle.player && battle.player.supplyIntervalMult != null ? battle.player.supplyIntervalMult : 1);
    return String(Math.round(v * 10) / 10);
  }

  /**
   * A supply line from each source to `to` (a standing order: the settlement keeps sending on its own). Repeating the order on the same target
   * from sources that ALL have that line already removes them instead (the "do it again to undo it" gesture).
   */
  function orderSupply(from, to) {
    if (!from.length) return;
    const mine = (battle.supply || []).filter((l) => l.owner === PLAYER_OWNER);
    const allHave = from.every((f) => mine.some((l) => l.from === f && l.to === to));
    if (allHave) issue(battle, { type: 'unsupply', owner: PLAYER_OWNER, from: [...from] });
    else issue(battle, { type: 'supply', owner: PLAYER_OWNER, from: [...from], to });
  }

  function supplyLineOf(siteId) {
    return (battle.supply || []).find((l) => l.owner === PLAYER_OWNER && l.from === siteId) || null;
  }

  /**
   * Touch: a long press on one of our settlements arms a supply line from it: a drag from there (same press) makes one. If the settlement already has
   * a line, letting go WITHOUT dragging removes it (`removes`); dragging on redirects it, or, onto the same target, toggles it off.
   */
  function onLongPress(sx, sy) {
    if (!active || phase !== 'live' || targeting || !battle) return;
    const id = ownSiteAt(sx, sy);
    if (id == null) return;
    armedSupply = { siteId: id, atMs: performance.now(), removes: !!supplyLineOf(id) };
    sfx.play('click', { volume: 0.5 });
    try { navigator.vibrate?.(12); } catch { /* no haptics here */ }
  }

  /** Desktop: right-click on one of our settlements removes its supply line (the pointer layer also cancels the selection, as it always did). */
  function onContextDown(e) {
    if (e.button !== 2 || !active || phase !== 'live' || !battle || targeting) return;
    const r = renderer.canvas.getBoundingClientRect();
    const id = ownSiteAt(e.clientX - r.left, e.clientY - r.top);
    if (id != null && supplyLineOf(id)) issue(battle, { type: 'unsupply', owner: PLAYER_OWNER, from: id });
  }
  renderer.canvas.addEventListener('pointerdown', onContextDown);
  // the long-press ring lasts as long as the finger is down (a drag from the armed settlement consumes it first)
  renderer.canvas.addEventListener('pointerup', () => {
    const armed = armedSupply;
    armedSupply = null;
    if (!armed) return;
    ui.tooltip.update({ visible: false });
    if (armed.removes && battle && phase === 'live' && supplyLineOf(armed.siteId)) issue(battle, { type: 'unsupply', owner: PLAYER_OWNER, from: armed.siteId });
  });
  renderer.canvas.addEventListener('pointercancel', () => { armedSupply = null; ui.tooltip.update({ visible: false }); });

  /** A send or supply order the front-line rule refused: the target shakes, says why, and the error cue plays. */
  function onRefused(ev, nowMs) {
    if (ev.reason === 'ironWill') { refusedPower(IRON_WILL_REFUSAL, ev.power, 4500); return; } // the sim refused a power under Iron Will (PLAN-PHASE5 §5C)
    if (ev.reason !== 'noRoute') return;
    refusal = { site: ev.to, startMs: nowMs, tipUntilMs: nowMs + 2600 };
    sfx.play('error', { volume: 0.6 });
    if (!noRouteSeen) { noRouteSeen = true; tutorial.notify('noRouteSeen'); }
  }

  function onAuto() {
    if (!active || !battle) return;
    autoMode = !autoMode;
    sfx.play('click', { volume: 0.5 });
    ui.battleHud.update({ auto: autoMode });
    ui.toasts.update({
      message: autoMode ? `Auto on: every send becomes a supply line (${Math.round(SUPPLY.fraction * 100)}% every ${supplySec()} s)` : 'Auto off: sends go once',
      duration: 2400,
    });
  }

  function onHover(sx, sy, wx, wy) {
    hoverWorld = { x: wx, y: wy };
    if (phase !== 'live') return;
    const id = hitTestSites(allSiteCandidates(), camera, sx, sy);
    hoverSite = id;
    renderer.canvas.style.cursor = targeting ? 'crosshair' : (id != null ? 'pointer' : '');
  }

  function canStartDrag(wx, wy, info) {
    downInfo = info;
    armedSupply = null; // a fresh press: the last long-press is over (the drag that follows a long-press is the SAME press and never comes through here)
    if (phase !== 'live') return 'pan';
    const screen = camera.worldToScreen(wx, wy);
    if (targeting) {
      // A power is armed (waiting for its target tap), but the player drags from one of their own settlements: they changed their mind and want to SEND.
      // This used to return 'pan' whatever was under the finger, so every send drag moved the map instead, until the power was fired or cancelled
      // (RC2 playtest: a hint's x sat on the keep, ate the Rally target tap, and the battle could not be played from then on).
      if (ownSiteAt(screen.x, screen.y) == null) return 'pan';
      targeting = null; // the armed power stands down; the HUD drops its armed ring on its next update
      ui.toasts.update({ id: 'power-cancelled', message: 'Power cancelled: sending troops instead', duration: 1600 });
    }
    if (info.shift) return 'lasso';
    return ownSiteAt(screen.x, screen.y) != null ? 'send' : 'pan';
  }

  function onDragStart(kind, sx, sy, wx, wy) {
    if (kind === 'send') {
      const screen = camera.worldToScreen(wx, wy);
      const downId = ownSiteAt(screen.x, screen.y);
      const from = downId != null && selection.has(downId) && selection.size > 0 ? [...selection] : (downId != null ? [downId] : []);
      // A supply drag is a Ctrl-drag (or Alt), or a drag after a long-press (touch); with Auto ON the same gestures make a plain one-off send instead.
      const gesture = !!(downInfo && (downInfo.ctrl || downInfo.alt)) || (!!armedSupply && downId != null && armedSupply.siteId === downId);
      armedSupply = null;
      drag = { kind, from, target: null, currentWorld: { x: wx, y: wy }, supply: autoMode !== gesture, unroutable: [] };
    } else if (kind === 'lasso') {
      drag = { kind, x0: sx, y0: sy, x1: sx, y1: sy };
    }
  }

  /** What the tooltip says while a send is held over a target. */
  function previewText(p) {
    if (p.outcome === 'noRoute') return NO_ROUTE_TEXT;
    const cut = p.unroutable && p.unroutable.length ? ` (${p.unroutable.length} cannot reach)` : '';
    return previewBody(p) + cut;
  }

  /** ... and while a supply line is being drawn. */
  function supplyPreviewText(p, from, target) {
    if (p.outcome === 'noRoute') return NO_ROUTE_TEXT;
    const mine = (battle.supply || []).filter((l) => l.owner === PLAYER_OWNER && l.to === target);
    if (from.length && from.every((f) => mine.some((l) => l.from === f))) return 'Remove supply line';
    const cut = p.unroutable && p.unroutable.length ? ` (${p.unroutable.length} cannot reach)` : '';
    return `Supply line: ${Math.round(SUPPLY.fraction * 100)}% every ${supplySec()} s${cut}`;
  }

  function previewBody(p) {
    if (p.sending === 0) return 'Nothing to send';
    if (p.outcome === 'reinforce') return `Reinforce +${Math.round(p.sending)}`;
    if (p.outcome === 'capture') return `Send ${Math.round(p.sending)} → capture, ${Math.round(p.remaining)} left`;
    return `Send ${Math.round(p.sending)} … not enough, ${Math.round(p.remaining)} short`;
  }

  function onDragMove(kind, sx, sy, wx, wy) {
    if (!drag) return;
    if (kind === 'send') {
      drag.currentWorld = { x: wx, y: wy };
      drag.sx = sx; // the last pointer position: a size key pressed mid-drag redraws the preview from it
      drag.sy = sy;
      const target = hitTestSites(allSiteCandidates(), camera, sx, sy);
      drag.target = target;
      if (target != null && drag.from.length && !drag.from.includes(target)) {
        const preview = previewSend(battle, drag.from, target, drag.supply ? SUPPLY.fraction : sendFraction);
        drag.outcome = preview.outcome; // the arrow turns green (capture), red (not enough) or grey (no route), like the tooltip says
        drag.unroutable = preview.unroutable || [];
        // on a phone the words sit about 60 px above the finger, which would otherwise cover them
        const gateText = preview.outcome === 'noRoute' ? feat.noRouteText(target) : null; // Siege: the keep is shut until its Gate falls
        ui.tooltip.update({ visible: true, x: sx, y: sy - (services.isTouch() ? 84 : 0), text: gateText || (drag.supply ? supplyPreviewText(preview, drag.from, target) : previewText(preview)) });
      } else {
        drag.outcome = null;
        drag.unroutable = [];
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
        if (drag.supply) {
          orderSupply(drag.from, drag.target);
        } else {
          issue(battle, {
            type: 'send', owner: PLAYER_OWNER, from: drag.from, to: drag.target, fraction: sendFraction,
          });
          if (drag.from.length >= 2) tutorial.notify('multiSend');
          tutorial.notify('send');
        }
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
    if (selection.size >= 2) tutorial.notify('selectionCleared');
    selection.clear();
    targeting = null;
    hoverSite = null;
  }

  // --- the keyboard site cursor (DESIGN 7.5a B2): arrows move a ring between settlements, Enter selects one of yours or sends to another, the live region says what would happen ---
  const SITE_WORDS = { keep: 'keep', fort: 'fort', tower: 'tower', town: 'town', village: 'village', hamlet: 'hamlet', camp: 'War Camp', bandit: 'Bandit Camp', gate: 'Gate', shrine: 'Shrine' };

  function describeSite(site) {
    const who = site.owner === PLAYER_OWNER ? 'yours' : site.owner === FREE_FOLK_OWNER ? 'neutral' : `held by ${(world.factions[site.owner] || { name: 'the enemy' }).name}`;
    return `${SITE_WORDS[site.type] || site.type}, ${who}, ${Math.round(site.troops)} troops`;
  }

  /** What Enter would do on this settlement, in words: the live region reads it as the cursor lands. */
  function describeAction(site) {
    if (targeting) return `Enter uses ${UPGRADES[targeting.power].name} here.`;
    if (site.owner === PLAYER_OWNER) return selection.has(site.id) ? 'Selected. Enter deselects it.' : 'Enter selects it.';
    const from = selection.size > 0 ? [...selection] : (campSite() ? [campSite().id] : []);
    if (!from.length) return '';
    const pv = previewSend(battle, from, site.id, autoMode ? SUPPLY.fraction : sendFraction);
    return `Enter sends from ${selection.size > 0 ? 'your selection' : 'the War Camp'}: ${autoMode ? supplyPreviewText(pv, from, site.id) : previewText(pv)}.`;
  }

  function say(site) { announce(`${describeSite(site)}. ${describeAction(site)}`.trim()); }

  function ensureSiteCursor() {
    if (siteCursor >= 0 && battle.sites[siteCursor]) return;
    const camp = campSite();
    siteCursor = camp ? camp.id : 0;
  }

  function moveSiteCursor(dx, dy) {
    ensureSiteCursor();
    const from = siteScreenPos(battle.sites[siteCursor]);
    let best = -1;
    let bestScore = Infinity;
    for (const s of battle.sites) {
      if (s.id === siteCursor) continue;
      const p = siteScreenPos(s);
      const vx = p.x - from.x;
      const vy = p.y - from.y;
      const d = Math.hypot(vx, vy);
      if (d < 1) continue;
      const cos = (vx * dx + vy * dy) / d;
      if (cos < 0.42) continue;
      const score = d * (1.7 - cos);
      if (score < bestScore) { bestScore = score; best = s.id; }
    }
    if (best < 0) { announce('No settlement that way.'); return; }
    siteCursor = best;
    const p = siteScreenPos(battle.sites[best]);
    if (p.x < 30 || p.y < 100 || p.x > renderer.cssWidth - 30 || p.y > renderer.cssHeight - 170) camera.flyTo({ x: siteWorldPos(battle.sites[best]).x, y: siteWorldPos(battle.sites[best]).y, zoom: camera.zoom }, 250);
    say(battle.sites[best]);
  }

  function enterOnSite() {
    ensureSiteCursor();
    const site = battle.sites[siteCursor];
    if (targeting) {
      const p = siteScreenPos(site);
      const w = siteWorldPos(site);
      handleTargetTap(p.x, p.y, w.x, w.y, { pointerType: 'mouse' });
      announce('Done.');
      return;
    }
    const queued = battle.commands.length;
    activateSite(siteCursor, { fromCampIfNone: true });
    if (site.owner === PLAYER_OWNER) announce(selection.has(siteCursor) ? `Selected. ${selection.size} selected.` : `Deselected. ${selection.size} selected.`);
    else if (battle.commands.length > queued) announce(paused || dialogOpen ? 'Order given. It goes out when you resume.' : 'Sent.');
    else announce('Nothing to send from.');
  }

  /** Arrow keys and Enter while the battle map has focus; true when the key was ours. */
  function onCursorKey(key, event) {
    const arrows = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (arrows[key]) { event.preventDefault(); keyboardUsed = true; moveSiteCursor(...arrows[key]); return true; }
    if (key === 'Enter') { event.preventDefault(); keyboardUsed = true; enterOnSite(); return true; }
    return false;
  }

  /** The ring on the cursor's settlement, only while the map has focus from the keyboard. */
  function drawSiteCursor(t) {
    if (!(keyboardUsed || services.isKeyboardUser())) return; // a ring for someone on the keyboard, not for a mouse player whose click focused the map
    if (document.activeElement !== renderer.canvas || siteCursor < 0 || !battle.sites[siteCursor]) return;
    const p = siteScreenPos(battle.sites[siteCursor]);
    const r = Math.max(26, Math.min(44, camera.zoom * 0.8));
    ctx.save();
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(6,8,16,0.9)';
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 3.4;
    ctx.strokeStyle = '#ffffff';
    ctx.setLineDash([9, 6]);
    ctx.lineDashOffset = -(reduceMotion() ? 0 : t * 22);
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function onKey(key, event) {
    // The send sizes, the powers, Auto, the ability and the speed belong to the battle HUD's own listener; pause and select-all are here. All of them
    // go through the rebindable map (ui/keymap.js, physical keys).
    if (!active) return;
    const code = event ? event.code : '';
    if (key === 'Escape') { onCancel(); return; }
    if (key === 'Tab' && event && !event.ctrlKey && !event.metaKey && !event.altKey && cycleBattle(event.shiftKey ? -1 : 1)) { event.preventDefault(); return; }
    if (event && (matches('pause', event) || (!code && (key === ' ' || key === 'Spacebar') && bindingOf('pause') === 'Space'))) { togglePause(); return; }
    const bound = event ? actionFor(event) : null;
    if (bound && bound !== 'selectAll') return; // a key the player bound to a HUD action does nothing else here
    if (event && document.activeElement === renderer.canvas && !event.ctrlKey && !event.metaKey && !event.altKey && phase === 'live' && onCursorKey(key, event)) return;
    if ((matches('selectAll', event) || (!code && bindingOf('selectAll') === 'KeyA' && (key === 'a' || key === 'A'))) && phase === 'live') {
      selection = new Set(battle.sites.filter((s) => s.owner === PLAYER_OWNER).map((s) => s.id));
    }
  }

  /**
   * Tab on the battle map switches to the next running battle (Shift+Tab the previous one), DESIGN 10.5. It never wraps: from the last battle Tab moves focus
   * on as usual (to the HUD), so the keyboard is never trapped on the map. True when it switched.
   */
  function cycleBattle(dir) {
    if (phase !== 'live' || document.activeElement !== renderer.canvas || !run) return false;
    const runs = manager.list();
    if (runs.length < 2) return false;
    const at = runs.findIndex((r) => r.id === run.id);
    const next = runs[at + dir];
    if (!next) return false;
    switchTo(next.id);
    return true;
  }

  /** Watches another running battle: the manager's focus moves, this view re-frames on it (a camera flight, no intro). */
  function switchTo(id) {
    if (!active || phase !== 'live') return false; // never in the middle of a fly-in, a victory sequence or a results card (that run's ending must play out)
    const next = manager.get(id);
    if (!next || (run && next.id === run.id)) return false;
    if (run && manager.get(run.id)) manager.setGate(run.id, null);
    renderer.units.reset();
    renderer.arena.end();
    if (own) own.settle();
    renderer.fx.clear();
    ui.results.el.hidden = true;
    if (skipBtn) skipBtn.hidden = true;
    run = next;
    battle = run.battle;
    regionId = run.regionId;
    manager.focus(run.id);
    setupView({ skipIntro: true, fly: true });
    if (battle.result) resumeEnded(); else announce(`Watching the ${run.kind === 'duel' ? 'duel at' : run.kind === 'defense' ? 'defense of' : 'attack on'} ${world.regions[regionId].name}. Battle ${manager.list().findIndex((r) => r.id === run.id) + 1} of ${manager.list().length}.`);
    tutorial.notify('battleSwitched');
    return true;
  }

  /** Back to the map with this battle still running (DESIGN 10.5): its commander holds it, the tray brings you back. */
  function leaveToMap() {
    if (!active || !run || phase !== 'live' || leaving) return;
    const name = world.regions[regionId].name;
    leave(() => {
      manager.focus(null);
      goto.world({ cameFromBattle: true, fromBattleView: true });
      ui.toasts.update({ id: 'battle-running', type: 'info', icon: 'sword', message: `The battle for ${name} goes on: your commander holds it. Pick it in the tray to return.`, duration: 3600 });
    });
  }

  /** Whether the HUD offers "Map" (leave the battle running): never in the very first battle (the tutorial fight is fought by hand). */
  function canLeave() {
    const { state } = container.get();
    return phase === 'live' && state.stats.battlesWon + state.stats.battlesLost > 0;
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
    hd.onLongPress = onLongPress;
    hd.onCancel = onCancel;
    hd.onKey = onKey;
  }

  // --- battle HUD / powers ---------------------------------------------------------
  function onSendFraction(f) {
    if (!active) return;
    sendFraction = f;
    tutorial.notify('sizeChanged');
    ui.battleHud.update({ sendFraction: f });
    // pressing 1-4 in the middle of a drag: the tooltip, the arrow colour and its shape follow at once, not at the next pointer move
    if (drag && drag.from && drag.currentWorld && drag.sx != null) onDragMove('send', drag.sx, drag.sy, drag.currentWorld.x, drag.currentWorld.y);
  }

  // The battle pauses itself while any dialog is open and resumes when the last one closes (the player's own pause is untouched).
  onDialogChange((count) => {
    dialogOpen = count > 0;
    if (active && battle && phase === 'live') ui.battleHud.update({ paused: paused || dialogOpen });
  });

  /** After a keyboard activation hides what had focus (the Attack button), focus goes to the map, so the keyboard keeps working without a Tab hunt. */
  function focusMapIfLost() {
    requestAnimationFrame(() => {
      const a = document.activeElement;
      if (!a || a === document.body || !a.getClientRects().length) renderer.canvas.focus({ preventScroll: true });
    });
  }

  function togglePause() {
    if (!active || phase !== 'live') return;
    paused = !paused;
    manager.setPaused(paused); // speed and pause are global (ARCHITECTURE 10.1)
    tutorial.notify('pauseOrSpeed');
    ui.battleHud.update({ paused: paused || dialogOpen });
    ui.battleHud.el.classList.toggle('is-paused', paused);
  }

  function onSpeed(next) {
    if (!active) return;
    speed = next;
    manager.setSpeed(next);
    tutorial.notify('pauseOrSpeed');
    container.get().state.settings.speed = next;
    ui.battleHud.update({ speed });
  }

  const IRON_WILL_TEXT = 'No powers: Iron Will';
  // what a press says: the Challenge by name, how long it lasts, and what still works (a player who ticked it at the founding took the bare
  // "No powers: Iron Will" flash for a bug: user report, 2026-10-08)
  const IRON_WILL_REFUSAL = 'Iron Will, your founding Challenge: no powers until your next founding. Your General’s ability still works.';
  const noPowers = () => { const st = container.get().state; return !!edictMods(st).noPowers || !!(battle && battle.player && battle.player.powersBlocked); };
  /** A refused power is SEEN as well as heard: a toast (in place, never a pile) and the button shakes. */
  function refusedPower(message, id, duration = 1800) {
    sfx.play('error');
    ui.toasts.update({ id: 'refused', type: 'warning', icon: 'flame', message, duration, now: true }); // it answers a press: no waiting for a leader's banner
    if (id) ui.battleHud.refuse(id);
  }

  // --- the commander's ability (DESIGN 10.11) ------------------------------------------------------------------------
  /** The HUD button's data, or null under the Militia Captain (no ability). */
  function abilityHud() {
    const st = abilityState(battle);
    if (!st) return null;
    const { state } = container.get();
    const g = run && run.commander ? generalById(state, run.commander) : null;
    return { kind: g ? g.kind : 'captain', emblem: () => generalEmblem(g ? g.kind : 'captain', 26), name: GENERALS.copy.abilityNames[st.id] || st.id, ready: st.ready && phase === 'live', used: st.used, uses: st.uses || 1, left: st.left ?? (st.ready ? 1 : 0), armed: !!(targeting && targeting.power === 'ability'), desc: g ? abilityText(g) : '' };
  }
  /** The button (or G): fires at once, or, for a Raid, waits for a target tap (press again to cancel). */
  function onAbility() {
    if (!active || !battle || phase !== 'live') return;
    const st = abilityState(battle);
    if (!st || !st.ready) { if (st) refusedPower('Your commander has used their ability this battle.'); return; }
    if (targeting && targeting.power === 'ability') { targeting = null; updateBattleHud(performance.now(), true); return; }
    if (st.needsTarget) {
      targeting = { power: 'ability' };
      ui.toasts.update({ id: 'ability', message: 'Raid: pick the enemy settlement to strike', duration: 2400 });
      updateBattleHud(performance.now(), true);
      return;
    }
    useAbility(null);
  }
  function useAbility(target) {
    const st = abilityState(battle);
    if (!st) return;
    const cmd = { type: 'ability', owner: PLAYER_OWNER, ability: st.id };
    if (target != null) cmd.target = target;
    issue(battle, cmd);
    tutorial.notify('abilityUsed');
    updateBattleHud(performance.now(), true);
  }
  /** The commanding General's emblem element, for the ability banner. */
  function commanderEmblem() {
    const g = run && run.commander ? generalById(container.get().state, run.commander) : null;
    return generalEmblem(g ? g.kind : 'captain', 20);
  }

  /** fx for the ability event at (x, y); a Shield Wall rings every settlement it covers. */
  function handleAbilityEvent(ev) {
    const fx = renderer.fx;
    const gold = ACCENTS.gold;
    if (ev.x != null) {
      fx.spawn('shockwave', ev.x, ev.y, { color: gold, growth: 3.2, duration: 0.7, thickness0: 0.1, thickness1: 0.02 });
    }
    for (const id of ev.sites || []) {
      const site = battle.sites[id];
      if (!site) continue;
      const p = siteWorldPos(site);
      fx.spawn('burst', p.x, p.y, { color: '#9cc4ff', flashSize: 1.1, sparkleCount: 6 });
    }
    if (ev.owner === PLAYER_OWNER) ui.battleHud.showAbilityBanner(GENERALS.copy.abilityNames[ev.ability] || 'Ability', commanderEmblem());
    sfx.play('rally', { pitch: 1.15 });
    if (ev.owner === PLAYER_OWNER) announce(`${GENERALS.copy.abilityNames[ev.ability] || 'The ability'} is used`);
  }

  /** A Vendetta's Champion is dead (PLAN-PHASE4 §4D): "{Leader}'s champion has fallen!", a gold shockwave where it fell, the war band's attack drops. */
  function handleChampionFell(ev) {
    const fx = renderer.fx;
    const champTitle = championTitle(run && run.vendetta ? run.vendetta.faction : battle.arena.enemyFaction); // the Ashen send a Barrow Knight (PLAN-PHASE6)
    let x = ev.x;
    let y = ev.y;
    if (x == null && ev.site != null && battle.sites[ev.site]) ({ x, y } = siteWorldPos(battle.sites[ev.site]));
    if (x != null) {
      fx.spawn('shockwave', x, y, { color: ACCENTS.gold, growth: 4, duration: 0.8, thickness0: 0.14, thickness1: 0.02 });
      fx.spawn('burst', x, y, { color: ACCENTS.gold, flashSize: 1.4, sparkleCount: 10 });
      fx.spawn('floatText', x, y - 0.8, { text: `${champTitle} slain!`, color: ACCENTS.gold, size: 0.42 });
      fx.shake(0.3, 0.3);
    }
    const leader = ev.leader || (run && run.vendetta && run.vendetta.leader) || 'The leader';
    const text = `${leader}'s ${champTitle === 'Champion' ? 'champion' : champTitle} has fallen!`;
    ui.battleHud.showChampionBanner(text, icon('pennant', 20));
    sfx.play('victory', { volume: 0.45, pitch: 1.1 });
    announce(text);
  }

  function onPower(id) {
    if (!active || !battle || phase !== 'live') return;
    const level = battle.player.powers[id] || 0;
    if (level < 1) { sfx.play('error'); ui.toasts.update({ message: 'Unlock this power in the War Council', duration: 2200 }); return; }
    if (noPowers()) { refusedPower(IRON_WILL_REFUSAL, id, 4500); return; } // Iron Will: no powers this dynasty
    if (feat.powerFlags(id).holy) { feat.onEvent({ type: 'refused', reason: 'holy', owner: PLAYER_OWNER, power: id }, performance.now()); return; } // Holy Ground (DESIGN 10.13)
    if (battle.t < battle.cooldowns[id]) {
      const left = Math.max(1, Math.ceil(battle.cooldowns[id] - battle.t));
      refusedPower(`${UPGRADES[id].name} is recharging: ${left} s.`, id);
      return;
    }
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
    ui.battleHud.update({ canLeave: canLeave() });
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
      // an attack shows the Swift countdown (it dims once missed); a defense the siege left to hold
      swiftSec: isDefense() ? undefined : swiftDeadlineSec(world, regionId, container.get().state) - battle.t,
      holdSec: isDefense() ? (battle.arena.siegeSec || battle.siegeSec || 0) - battle.t : undefined,
      retreat: isDuel()
        ? { title: 'Yield the duel?', body: 'You yield to the champion. A duel costs nothing: the region stays yours.', action: 'Yield' }
        : isDefense()
        ? { title: `Abandon ${world.regions[regionId].name}?`, body: `${world.regions[regionId].name} falls to ${theAttacker()}: it is occupied until you retake it. Its fortifications and Works fight for them meanwhile.`, action: 'Abandon it' }
        : streakWarning() ? { title: 'Retreat?', body: `Your War Camp falls back. Squads already in the field will be lost. ${streakWarning()}`, action: 'Retreat' }
        : null,
      sendFraction,
      speed,
      slowBattles: !!container.get().state.settings.slowBattles,
      paused: paused || dialogOpen,
      auto: autoMode,
      ability: abilityHud(),
      feature: throne.hud() || feat.hud(), // the Throne's phase (PLAN-PHASE13); "Hold all 3 Shrines", the Dragon's health, "take the Gate first", the twist (DESIGN 10.13)
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
          ...feat.powerFlags(id), // Holy Ground greys them all; the Blizzard's Firestorm reads stronger
          blocked: noPowers() ? IRON_WILL_TEXT : null, // Iron Will: every power locked, with the reason
        };
      }),
      // when EVERY power is locked by a rule, the bar says which rule before any press (five padlocks alone read as a bug: user report, 2026-10-08)
      powersRule: noPowers() ? 'Iron Will · no powers this dynasty' : feat.powerFlags(POWER_IDS[0]).holy ? 'Holy Ground · no powers here' : null,
    });
  }

  function ensureHelpButton() {
    if (helpBtn) { helpBtn.hidden = false; return; }
    const cluster = ui.battleHud.el.querySelector('.battle-topright');
    if (!cluster) return;
    helpBtn = h('button.btn-icon.hd-help', { onClick: showControls, 'aria-label': 'Controls' }, '?');
    cluster.prepend(helpBtn);
  }

  // --- tutorial hints (PLAYFEEL §4: B1-B5, C1-C3, P1-P2) ----------------------------------------
  // Each frame the facts go to the tutorial controller, which names the step; its anchor becomes a LIVE target the coach re-reads every frame
  // (the camera flies in, pans and zooms under it), hides while it is off screen or under a panel, and keeps the bubble off it.
  const isUp = (e) => !!e && e.isConnected && e.getClientRects().length > 0 && !e.closest('[hidden]');
  const sendBarEl = () => ui.battleHud.el.querySelector('.send-fraction-selector');
  const powerBtnEl = (id) => ui.battleHud.el.querySelectorAll('.power-btn')[POWER_IDS.indexOf(id)];
  const campSite = () => battle.sites.find((s) => s.type === 'camp' && s.owner === PLAYER_OWNER);
  const enemyKeepSite = () => battle.sites.find((s) => s.type === 'keep' && s.owner !== PLAYER_OWNER);
  const siteBoxOf = (site) => (site ? siteBox(siteScreenPos(site), camera.zoom) : null);
  const boxOfEl = (e) => (isUp(e) ? boxOfRect(e.getBoundingClientRect()) : null);

  function powerReady(id) {
    return battle.player.powers[id] >= 1 && battle.t >= (battle.cooldowns[id] || 0);
  }

  /** A settlement none of ours may send to right now (the front-line rule), the one nearest the War Camp: what step C2 points at. */
  function blockedSite() {
    if (!battle) return null;
    const mine = battle.sites.filter((s) => s.owner === PLAYER_OWNER);
    const camp = campSite();
    const cp = camp ? siteScreenPos(camp) : { x: 0, y: 0 };
    let best = null;
    let bestD = Infinity;
    for (const s of battle.sites) {
      if (s.owner === PLAYER_OWNER || mine.some((m) => canRoute(battle, PLAYER_OWNER, m.id, s.id))) continue;
      const p = siteScreenPos(s);
      const d = Math.hypot(p.x - cp.x, p.y - cp.y);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  function hintFacts() {
    const { state } = container.get();
    const own = battle.sites.filter((s) => s.owner === PLAYER_OWNER);
    return {
      scene: 'battle',
      live: phase === 'live',
      t: battle.t,
      battlesBefore: state.stats.battlesWon + state.stats.battlesLost,
      ownSites: own.length,
      enemySites: battle.sites.length - own.length,
      captured: battle.stats.captured,
      rallyReady: powerReady('rally'),
      firestormReady: powerReady('firestorm'),
      selectedCount: selection.size,
      noRouteSeen,
      hasBlocked: !!blockedSite(),
      // the Living Frontier's steps (F2, F3)
      incoming: (state.frontier && state.frontier.incoming || []).length,
      raidToast: !!raidGoButton(),
      runs: manager.list().length,
      abilityReady: !!(abilityState(battle) && abilityState(battle).ready),
      // a varied map (DESIGN 10.13): V2 the first Siege while its Gate stands, V3 the first Raid, V4 the Dragon's warning
      gateStanding: !!feat.anchors().gate,
      raid: feat.twist() === 'raid' && !!feat.anchors().shrine,
      telegraph: !!feat.anchors().telegraph,
      borrowTelegraph: !!throne.anchors().telegraph, // PLAN-PHASE13: U2, the Usurper's first borrowed weapon
      bulwarkUnlocked: (battle.player.powers.bulwark || 0) >= 1 && feat.twist() !== 'holy',
      features: FEATURES,
    };
  }

  /** The Go button of the newest incoming raid's toast (tutorial F2), or null. */
  function raidGoButton() {
    if (!ui.toasts.el.firstElementChild) return null;
    const btns = [...document.querySelectorAll('.toasts > .toast:not(.is-out) .toast-action')].filter((b) => b.getClientRects().length && /^raid-/.test(b.closest('.toast').dataset.id || ''));
    return btns.length ? btns[btns.length - 1] : null;
  }

  /** The live target for a step (and the side the bubble prefers), or null when there is nothing to point at right now. */
  function hintTarget(def) {
    switch (def.anchor) {
      case 'camp': return {
        target: { get: () => siteBoxOf(campSite()) },
        // the bubble stays off the gold arrow and the settlement it points at
        avoid: [() => { const p = tutorialArrowTarget(); return p ? unionBox(siteBoxOf(p.camp), siteBoxOf(p.target)) : null; }],
      };
      case 'sendBar': return { target: { find: sendBarEl }, prefer: 'above' };
      case 'gate': { const g = feat.anchors().gate; return g ? { target: { get: () => siteBoxOf(feat.anchors().gate) }, key: `gate${g.id}` } : null; }
      case 'shrine': { const sh = feat.anchors().shrine; return sh ? { target: { get: () => siteBoxOf(feat.anchors().shrine) }, key: `shrine${sh.id}` } : null; }
      case 'telegraph': {
        // the Dragon's warning: the Bulwark button (the counter), the ring itself out of the bubble's way
        if (!feat.anchors().telegraph) return null;
        return { target: { find: () => powerBtnEl('bulwark') }, prefer: 'above', key: 'telegraph' };
      }
      case 'enemyKeep': return { target: { get: () => siteBoxOf(enemyKeepSite()) } };
      case 'borrow': { // PLAN-PHASE13 (U2): the borrowed weapon's warning ring
        if (!throne.anchors().telegraph) return null;
        return { target: { get: () => { const p = throne.anchors().telegraph; return p ? siteBox(camera.worldToScreen(p.x, p.y), camera.zoom) : null; } }, key: 'borrow' };
      }
      case 'twoSites': {
        // the camp and the nearest other site of yours: two things to click
        return {
          target: {
            get: () => {
              const camp = campSite();
              if (!camp) return null;
              const cp = siteScreenPos(camp);
              const others = battle.sites.filter((s) => s.owner === PLAYER_OWNER && s.id !== camp.id)
                .map((s) => ({ s, d: Math.hypot(siteScreenPos(s).x - cp.x, siteScreenPos(s).y - cp.y) })).sort((a, b) => a.d - b.d);
              if (!others.length) return null;
              return unionBox(siteBoxOf(camp), siteBoxOf(others[0].s));
            },
          },
          key: 'two',
        };
      }
      case 'rally': {
        // stage 1: the Rally button; stage 2 (Rally armed): the place to send everyone
        if (targeting && targeting.power === 'rally') return { target: { get: () => siteBoxOf(enemyKeepSite()) }, key: 'aim', aim: true };
        return { target: { find: () => powerBtnEl('rally') }, prefer: 'above', key: 'button' };
      }
      case 'pauseSpeed': {
        const pause = () => ui.battleHud.el.querySelector('.battle-pause');
        const speedBtn = () => ui.battleHud.el.querySelector('.battle-speed');
        return {
          target: { find: pause, get: () => { const a = boxOfEl(pause()); const b = boxOfEl(speedBtn()); return a && b ? unionBox(a, b) : a || b; } },
          key: 'pause',
        };
      }
      case 'firestorm': return { target: { find: () => powerBtnEl('firestorm') }, prefer: 'above' };
      case 'selection': {
        return {
          target: {
            get: () => {
              const boxes = [...selection].map((id) => siteBoxOf(battle.sites[id])).filter(Boolean);
              return boxes.length ? boxes.reduce((a, b) => unionBox(a, b)) : null;
            },
          },
          key: 'sel',
        };
      }
      case 'supply': return { target: { find: () => ui.battleHud.el.querySelector('.battle-auto') }, prefer: 'above' };
      case 'blocked': return { target: { get: () => siteBoxOf(blockedSite()) }, key: 'blocked' };
      case 'ability': return ui.battleHud.abilityButton() ? { target: { find: () => ui.battleHud.abilityButton() }, prefer: 'above', key: 'ability' } : null;
      case 'raidGo': return raidGoButton() ? { target: { find: () => raidGoButton() }, prefer: 'below', key: 'raidGo' } : null;
      case 'tray': {
        // the chip of a battle you are NOT watching: that is the one to switch to
        const other = manager.list().find((r) => !run || r.id !== run.id);
        const chip = () => (other ? ui.tray.chipOf(other.id) : null);
        return chip() ? { target: { find: chip }, prefer: services.isPhone() ? 'below' : 'right', key: `tray${other.id}` } : null;
      }
      default: return null;
    }
  }

  function hideCoach() {
    if (coachSig !== 'off') { coachSig = 'off'; ui.coach.update({ visible: false }); }
  }

  function hideStuckHint() {
    if (coachSig === 'stuck') { coachSig = 'off'; ui.coach.update({ visible: false }); }
  }

  /**
   * "Stuck? Firestorm their strongest site, or Rally everything at once." (hints on, once per battle, only when no tutorial step is being shown):
   * after STUCK_HINT.afterSec of battle time with no capture of ours and a named power ready, anchored to that power's button.
   * Only unlocked, ready powers are named. Returns true while the hint is on screen.
   */
  function updateStuckHint(nowMs, tutorialHintActive) {
    if (battle.stats.captured !== stuckCaptured) {
      stuckCaptured = battle.stats.captured;
      stuckCaptureT = battle.t;
      hideStuckHint(); // a capture means it is not stuck
    }
    if (coachSig === 'stuck') {
      if (phase !== 'live' || paused || dialogOpen || nowMs - stuckAtMs > STUCK_HINT.showMs) hideStuckHint();
      else return true;
    }
    if (phase !== 'live' || paused || dialogOpen) return false;
    const due = stuckHintDue({
      hintsOn: container.get().state.settings.hints !== false, tutorialHintActive, battleT: battle.t,
      lastCaptureT: stuckCaptureT, done: stuckDone, fireReady: powerReady('firestorm'), rallyReady: powerReady('rally'),
    });
    if (!due) return false;
    const idx = POWER_IDS.indexOf(due.power);
    if (!powerBtnEl(due.power)) return false;
    stuckDone = true;
    stuckAtMs = nowMs;
    coachSig = 'stuck';
    ui.coach.update({
      visible: true, id: 'STUCK', text: due.text, target: { find: () => powerBtnEl(POWER_IDS[idx]) }, prefer: 'above', onDismiss: hideStuckHint,
    });
    return true;
  }

  function updateCoach(nowMs) {
    if (!battle) { hideCoach(); return; }
    const def = tutorial.anyPending('battle') ? tutorial.pick(hintFacts()) : null; // Phase 8 perf: no facts gathered when nothing is left to teach
    if (!def) {
      // outside the tutorial's own hints the coach only ever says "Stuck?" (and otherwise stays hidden)
      if (!updateStuckHint(nowMs, false)) hideCoach();
      return;
    }
    const res = phase === 'live' ? hintTarget(def) : null;
    if (!res) { hideCoach(); return; }
    const text = res.aim && def.textAim ? def.textAim : (services.isTouch() && def.textTouch) || def.text;
    coachSig = `${def.id}|${res.key || ''}|${text}`;
    // the bubble also keeps off the enemy keep(s): the castle is what the whole fight is about (a phone hint used to sit right on it)
    const keepBoxes = battle.sites.filter((s) => s.type === 'keep' && s.owner !== PLAYER_OWNER).map((s) => () => siteBoxOf(s));
    ui.coach.update({ visible: true, id: def.id, text, target: res.target, prefer: res.prefer, avoid: [...(res.avoid || []), ...keepBoxes] });
  }

  /**
   * Where the step-B1 arrow points: the nearest settlement the War Camp (never another site) can take with some room to
   * spare. A capture that leaves at least a fifth of the sent troops standing ranks ahead of a photo finish (the first
   * village can be a 15-vs-17.9 win with one troop left), which ranks ahead of a fail; ties go to the soonest arrival.
   */
  function tutorialArrowTarget() {
    const camp = battle && campSite();
    if (!camp) return null;
    let best = null;
    let bestScore = Infinity;
    for (const s of battle.sites) {
      if (s.owner === PLAYER_OWNER) continue;
      const pv = previewSend(battle, [camp.id], s.id, sendFraction);
      if (pv.outcome === 'noRoute') continue; // the front-line rule: the lesson never points at a settlement the camp may not attack (its arrival time reads 0, which used to win the ranking)
      const roomy = pv.outcome === 'capture' && pv.remaining >= pv.sending * 0.2;
      const score = (roomy ? 0 : pv.outcome === 'capture' ? 500 : 1000) + pv.arriveSec;
      if (score < bestScore) { bestScore = score; best = s; }
    }
    return best ? { camp, target: best } : null;
  }

  /** Tutorial step B1: an animated arrow from the War Camp to the settlement tutorialArrowTarget() picked. */
  function drawTutorialHand(t) {
    const def = tutorial.current;
    if (!def || def.id !== 'B1' || phase !== 'live' || camera.isMoving()) return;
    if (drag && drag.kind === 'send') return; // the player is drawing their own arrow: a second, gold one on top of it hid the green "Capture" feedback (RC2 gallery)
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
  /** The manager stepped the run (main.js calls `manager.tick` before the scene's frame); the view only needs its interpolation factor. */
  function runSim() {
    return manager.alphaOf(run.id);
  }

  // --- drawing -------------------------------------------------------------------------
  /** Walls round a settlement (DESIGN 10.3): a ring of stone blocks under it, in its holder's colour at the joints. */
  function drawWallRing(x, y, z, owner) {
    const r = z * 0.78;
    ctx.save();
    ctx.translate(x, y + z * 0.12);
    ctx.scale(1, 0.62); // lies on the ground
    ctx.lineWidth = Math.max(3, z * 0.13);
    ctx.strokeStyle = 'rgba(30, 26, 22, 0.75)';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([Math.max(4, z * 0.16), Math.max(2, z * 0.06)]);
    ctx.lineWidth = Math.max(2, z * 0.09);
    ctx.strokeStyle = '#c9bfa8';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = Math.max(1, z * 0.025);
    ctx.strokeStyle = owner >= 0 ? factionColor(owner) : 'rgba(255,255,255,0.4)';
    ctx.beginPath(); ctx.arc(0, 0, r + Math.max(2, z * 0.06), 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  let badges = [];
  /** The troop badges, drawn over the squads: a war band massed at its own camp used to hide the camp's number (defense battles). */
  function drawSiteBadges(t) {
    for (const b of badges) renderer.sites.drawSite(ctx, b.x, b.y, b.s, 'camp', b.owner, b.troops, t, { badgeOnly: true, pulse: b.pulse, flash: b.flash });
  }

  function drawSites(t, nowMs) {
    badges = [];
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
      if (phase === 'defeat' && site.type === 'camp' && !isDefense()) { // (in a defense the camp is the ENEMY's war band)
        bannerDrop = Math.min(1, (nowMs - defeatAtMs) / DEFEAT.bannerFallMs);
      }
      const flashUntil = siteFlash.get(site.id) || 0;
      const owner = own.siteOwner(site.id, nowMs);
      sp.x += refusalShake(site.id, nowMs);
      // fortifications (DESIGN 10.3) read on the field: Walls are a stone ring round the keep / fort, an Arrow Tower fortification wears a shield
      if ((site.defMult ?? 1) > 1) drawWallRing(sp.x, sp.y, s, owner);
      renderer.sites.drawSite(ctx, sp.x, sp.y, s, feat.spriteType(site), owner, Math.floor(site.troops), t, {
        selected: selection.has(site.id),
        highlight: hoverSite === site.id && phase === 'live' && (!!targeting || !!drag),
        pulse: !!site.assault,
        phase: site.id * 1.31,
        bannerDrop,
        flash: flashUntil > nowMs ? (flashUntil - nowMs) / 700 : 0,
        hideBadge: true, // the badges go on top of the squads (drawSiteBadges, after units.draw)
      });
      badges.push({ x: sp.x, y: sp.y, s, owner, troops: feat.badgeLabel(site) ?? Math.floor(site.troops), pulse: !!site.assault, flash: flashUntil > nowMs ? (flashUntil - nowMs) / 700 : 0 }); // Night: '?' until scouted or next to your land
      const threat = phase === 'live' ? threats.get(site.id) : undefined;
      if (threat) chips.push({ x: sp.x, y: sp.y, s, threat });
    }
    return chips;
  }

  /** The live send arrow's colour for a preview outcome: green captures, red falls short, gold otherwise. */
  function dragArrowColor(outcome) {
    if (outcome === 'noRoute') return DRAG_ARROW.blocked;
    return outcome === 'capture' ? DRAG_ARROW.capture : outcome === 'fail' ? DRAG_ARROW.fail : DRAG_ARROW.neutral;
  }

  /**
   * The arrow's SHAPE for an outcome (DESIGN 7.5a): colour is never the only cue. Capture: solid, a check in the head, the word "Capture". Not enough: dashed, a cross, "Not enough".
   * No route: dotted grey, "No route". A reinforcement and a supply line: solid.
   */
  function dragShape(d) {
    if (d.outcome === 'noRoute') return { shape: 'dotted', mark: null, word: 'No route' };
    if (d.supply) return { shape: 'solid', mark: null, word: null };
    if (d.outcome === 'capture') return { shape: 'solid', mark: 'check', word: 'Capture' };
    if (d.outcome === 'fail') return { shape: 'dashed', mark: 'cross', word: 'Not enough' };
    if (d.outcome === 'reinforce') return { shape: 'solid', mark: null, word: 'Reinforce' };
    return { shape: 'solid', mark: null, word: null };
  }

  /** A supply drag wears the player's colour (grey without a route); a plain send wears its outcome colour. */
  function dragColor(d) {
    if (d.outcome === 'noRoute') return DRAG_ARROW.blocked;
    return d.supply ? factionColor(PLAYER_FACTION) : dragArrowColor(d.outcome);
  }

  /** The shake of a refused target, in px (a short, decaying wobble). */
  function refusalShake(siteId, nowMs) {
    if (!refusal || refusal.site !== siteId || reduceMotion()) return 0;
    const age = nowMs - refusal.startMs;
    if (age < 0 || age > 420) return 0;
    return Math.sin(age / 22) * 5 * (1 - age / 420);
  }

  /** The standing supply lines, as flowing chevrons along their routes (under the units, over the land). */
  function drawSupplyLines(t) {
    const lines = battle.supply;
    if (!lines || lines.length === 0) return;
    for (const line of lines) {
      const route = routeFor(battle, line.owner, line.from, line.to);
      const from = battle.sites[line.from];
      if (!from || !route) continue; // a closed route is drawn by drawWaitingLines (on top of the settlements)
      const tiles = [from.tile, ...route.tiles];
      const pts = route.points.map((pt, i) => {
        const tile = world.tiles[tiles[i]];
        return camera.worldToScreen(pt.x, pt.y - (tile ? elevOffset(tile, 1) : 0));
      });
      const faction = line.owner === PLAYER_OWNER ? PLAYER_FACTION : battle.arena.enemyFaction;
      drawSupplyLine(ctx, pts, factionColor(faction), reduceMotion() ? 0 : t, { zoom: camera.zoom, alpha: line.owner === PLAYER_OWNER ? 1 : 0.8 }); // still chevrons under Reduce Motion
    }
  }

  /**
   * A line whose route is closed (the front moved): the sim keeps it and it WAITS. A short grey stub with a pause badge leaves the source toward the target, drawn over the
   * settlements so a neighbour cannot hide it; it never reaches across the land in between (there is no legal way over it).
   */
  function drawWaitingLines() {
    const lines = battle.supply;
    if (!lines || lines.length === 0) return;
    for (const line of lines) {
      const from = battle.sites[line.from];
      const to = battle.sites[line.to];
      if (!from || !to || routeFor(battle, line.owner, line.from, line.to)) continue;
      drawWaitingLine(ctx, siteScreenPos(from), siteScreenPos(to), line.owner === PLAYER_OWNER ? 1 : 0.7, camera.zoom);
    }
  }

  /** While a send is being dragged: every settlement it could reach glows; the ones with no route are greyed. */
  function drawReach(t, nowMs) {
    const radius = Math.max(15, Math.min(30, camera.zoom * 0.5));
    for (const site of battle.sites) {
      if (drag.from.includes(site.id)) continue;
      const p = siteScreenPos(site);
      if (p.x < -40 || p.y < -40 || p.x > renderer.cssWidth + 40 || p.y > renderer.cssHeight + 40) continue;
      if (drag.from.some((f) => canRoute(battle, PLAYER_OWNER, f, site.id))) drawReachGlow(ctx, p.x, p.y, radius, reduceMotion() ? 0 : t, site.id === drag.target);
      else drawNoRoute(ctx, p.x, p.y, radius, refusalShake(site.id, nowMs));
    }
  }

  /** Sends ordered during a pause: a faint arrow each, so the player can see what will happen when the battle resumes. */
  function drawQueuedOrders() {
    if (!(paused || dialogOpen)) return;
    for (const cmd of battle.commands) {
      if (cmd.type !== 'send' || cmd.owner !== PLAYER_OWNER) continue;
      const to = battle.sites[cmd.to];
      if (!to) continue;
      const b = siteScreenPos(to);
      const froms = Array.isArray(cmd.from) ? cmd.from : [cmd.from];
      ctx.save();
      ctx.globalAlpha = 0.5;
      for (const id of froms) {
        const from = battle.sites[id];
        if (!from || id === cmd.to) continue;
        const a = siteScreenPos(from);
        drawDragArrow(ctx, a.x, a.y, b.x, b.y, ACCENTS.gold, 0, { zoom: camera.zoom });
      }
      ctx.restore();
    }
  }

  /** "War Camp" under the camp in the very first battle: the tutorial talks about it, and nothing on the map said which tents are yours. */
  function drawCampTag() {
    const { state } = container.get();
    if (state.stats.battlesWon + state.stats.battlesLost > 0 || phase !== 'live') return;
    const camp = campSite();
    if (!camp) return;
    const p = siteScreenPos(camp);
    const half = Math.max(22, 0.62 * camera.zoom);
    ctx.save();
    ctx.font = '800 12px Nunito, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText('War Camp').width + 16;
    const x = p.x - w / 2;
    const y = p.y + half * 0.7;
    ctx.fillStyle = 'rgba(10,14,22,0.82)';
    ctx.beginPath();
    ctx.roundRect(x, y, w, 20, 10);
    ctx.fill();
    ctx.strokeStyle = factionColor(PLAYER_FACTION);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#fff6dc';
    ctx.fillText('War Camp', p.x, y + 10.5);
    ctx.restore();
  }

  function drawOverlays(t, nowMs) {
    drawWaitingLines();
    drawQueuedOrders();
    drawCampTag();
    drawSiteCursor(t);
    if (drag && drag.kind === 'send') {
      drawReach(t, nowMs);
      const cur = drag.target != null && !drag.from.includes(drag.target)
        ? siteScreenPos(battle.sites[drag.target])
        : camera.worldToScreen(drag.currentWorld.x, drag.currentWorld.y);
      // Tutorial step 3 promises "the arrow tells you if you'll take it": green when the send would capture, red when it
      // would not, gold while it is not over a target (and for a reinforcement), grey with no route, always with the tooltip's words as well.
      const arrowColor = dragColor(drag);
      const look = dragShape(drag);
      const blockedLook = { shape: 'dotted', mark: null, word: null };
      // on touch the tooltip (84 px above the finger) already says the outcome in words and sat on the canvas word: keep the shaft and the check/cross, drop the word
      const touchTip = !!downInfo && downInfo.pointerType !== 'mouse' && !ui.tooltip.el.hidden;
      let worded = touchTip;
      drag.wordDrawn = null;
      for (const id of drag.from) {
        const o = siteScreenPos(battle.sites[id]);
        // a source that cannot reach this target draws its own grey, dotted arrow while the others show the outcome; the outcome is written once, at the first
        const blocked = drag.unroutable.includes(id);
        const sayNoRoute = blocked && !worded && drag.outcome === 'noRoute'; // every source blocked: the first arrow says so
        const lk = blocked ? { ...blockedLook, word: sayNoRoute ? 'No route' : null } : { ...look, word: worded ? null : look.word };
        if (!blocked || sayNoRoute) worded = true;
        if (lk.word) drag.wordDrawn = lk.word;
        // PLAN-PHASE12: a send that would sail (route.lane: between two harbours you hold) shows its sea lane as a dotted arc under the arrow
        if (!blocked && battle.arena.sea && drag.target != null && drag.target !== id) {
          let r = null;
          try { r = routeFor(battle, PLAYER_OWNER, id, drag.target); } catch { r = null; }
          if (r && r.lane) drawSeaLane(ctx, r.points.map((q) => camera.worldToScreen(q.x, q.y)), factionColorLight(PLAYER_FACTION), t, { width: Math.max(2, camera.zoom * 0.06) });
        }
        drawDragArrow(ctx, o.x, o.y, cur.x, cur.y, blocked ? DRAG_ARROW.blocked : arrowColor, t, { zoom: camera.zoom, viewW: renderer.cssWidth, ...lk });
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
    if (armedSupply && !drag) {
      if (performance.now() - armedSupply.atMs > 8000) armedSupply = null; // safety: it normally ends with the press (pointerup below)
      else if (battle.sites[armedSupply.siteId]) {
        const a = siteScreenPos(battle.sites[armedSupply.siteId]);
        drawArmedRing(ctx, a.x, a.y, Math.max(18, Math.min(32, camera.zoom * 0.6)), t, armedSupply.removes ? ACCENTS.bad : factionColor(PLAYER_FACTION));
        ui.tooltip.update({ visible: true, x: a.x - 24, y: a.y - 70, text: armedSupply.removes ? 'Let go to remove the supply line, or drag to redirect it' : 'Drag to a settlement to set a supply line' });
      }
    }
    updateRefusalTip(nowMs);
  }

  /** The refused target's tooltip: over the target for a couple of seconds (a drag in progress owns the tooltip). */
  function updateRefusalTip(nowMs) {
    if (!refusal) return;
    if (nowMs >= refusal.tipUntilMs) { refusal = null; if (!drag) ui.tooltip.update({ visible: false }); return; }
    if (drag || !battle.sites[refusal.site]) return;
    const p = siteScreenPos(battle.sites[refusal.site]);
    ui.tooltip.update({ visible: true, x: p.x - 24, y: p.y - 4, text: feat.noRouteText(refusal.site) || NO_ROUTE_TEXT }); // Siege: "take the Gate first"
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

    // Orders given while the battle is paused (or a dialog is open) wait for the resume: said once per session, drawn as ghost arrows (drawQueuedOrders)
    if (phase === 'live' && (paused || dialogOpen) && !toldQueued && battle.commands.some((c) => c.owner === PLAYER_OWNER)) {
      toldQueued = true;
      ui.toasts.update({ id: 'orders-queued', type: 'info', icon: 'clock', message: 'Orders go out when you resume' });
    }

    // The sim holds still during the keep-capture hit-stop; everything else keeps drawing.
    let alpha = 1;
    if (phase === 'live' && !stopped) alpha = runSim();

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
    const tm = reduceMotion() ? 0 : t; // Reduce Motion: sea glints, cloud drift and the arena's breathing rim stand still
    renderer.terrain.drawGlints(ctx, camera, tm);
    renderer.arena.drawTerritory(ctx, camera, (tile) => own.tileOwner(tile, nowMs), own.signature(nowMs));
    renderer.arena.drawCorridors(ctx, camera, t);
    renderer.clouds.drawShadows(ctx, camera, tm);
    renderer.clouds.draw(ctx, camera, hiddenIds, tm, nowMs, 1);
    renderer.arena.drawDim(ctx, camera, dimAlpha);
    renderer.overlays.drawArenaGlow(ctx, camera, regionId, tm);
    if (phase !== 'entering') drawSupplyLines(t);
    if (phase !== 'entering') renderer.units.drawIntent(ctx, camera, battle, t);
    ashen.drawGround(t, nowMs); // Firestorm's burning ground, the Barrow Keep's ash ring
    seaFx.drawGround(t, nowMs); // the lanes, the piers, the Tide's rising ring and flooded fords (PLAN-PHASE12)
    boonFx.drawGround(t); // Scorched Earth's burning ground (Phase 7)
    feat.drawGround(t, nowMs); // high water, Night's tower reach, the Shrine rings, the Dragon's warning
    throne.drawGround(t, nowMs); // the borrowed Tide, the Plague's ring and aura, the Rising's ash ring (PLAN-PHASE13)
    const chips = drawSites(t, nowMs);
    renderer.units.draw(ctx, camera, battle, alpha, t, { still: reduceMotion(), championColor: run && run.vendetta ? factionColor(run.vendetta.faction) : undefined });
    if (!stopped) fx.update(dt);
    fx.draw(ctx, camera);
    feat.drawAir(t, nowMs); // the Dragon, its health and its breath
    throne.drawAir(t, nowMs, alpha); // the Champion banners on the Gate, the Usurper-King and his health bar (PLAN-PHASE13)
    ashen.drawAir(t, nowMs); // The Fallen Rise's wisps and "+N risen" pops
    seaFx.drawAir(t, nowMs); // Broadside's flashes, the Tide's and the boats' pops (PLAN-PHASE12)
    boonFx.drawAir(t, nowMs); // the Boons' small icon pops (Phase 7)
    drawSiteBadges(t); // over the squads AND the dust a busy camp kicks up: the number is always readable
    feat.drawTags(); // Siege: the Gate's tag, the padlock on the keep it shuts
    renderer.sites.drawThreatChips(ctx, chips, t); // last, so nothing covers the readout
    feat.drawWeather(t); // Night's shade, the Blizzard's snow: over the field, under the arrows and the HUD
    drawOverlays(t, nowMs);
    void world0;

    if (phase === 'live') updateBattleHud(nowMs);
    updateCoach(nowMs);
  }

  // --- lifecycle -----------------------------------------------------------------------
  function frameRect() {
    const W = renderer.cssWidth;
    const H = renderer.cssHeight;
    // a landscape phone: the timer strip is ~70 px tall and the send bar plus power buttons ~125 px, so the band between is all there is
    if (H < 520) return { x0: 16, y0: 78, x1: W - 16, y1: H - 128 };
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
    siteCursor = -1;
    keyboardUsed = false;
    renderer.canvas.tabIndex = 0; // the battle map takes keyboard focus: arrows move between settlements, Enter selects or sends
    focusMapIfLost();
    services.hideAllPanels();
    ui.results.el.hidden = true;
    ui.tooltip.update({ visible: false });
    if (skipBtn) skipBtn.hidden = true;

    const reveal = revealed(state, world);
    battleOwners = state.owner.map((o, i) => (i === regionId || !reveal[i] ? -1 : o));
    hiddenIds = world.regions.filter((r) => !reveal[r.id]).map((r) => r.id);
    own = createArenaOwnership(world, battle, regionId, state.owner);
    feat.reset(battle, world, regionId);
    ashen.reset(battle);
    seaFx.reset(battle);
    throne.reset(battle);
    boonFx.reset(battle);
    const holeTiles = new Map();
    for (const t of battle.arena.tiles) holeTiles.set(t.i, world.tiles[t.i]);
    for (const t of own.regionTiles) holeTiles.set(t.i, t);
    renderer.arena.begin({ regionId, holeTiles: [...holeTiles.values()] });
    renderer.arena.setCorridors(
      battle.arena.tiles.filter((t) => t.link).map((t) => world.tiles[t.i]).filter(Boolean),
      battle.arena.tiles.filter((t) => t.link && t.pass).map((t) => world.tiles[t.i]).filter(Boolean), // a strip across a mountain ridge: drawn as a pass
      stripRoads(), // the road drawn over it: exactly the routes squads take through the strip, each ending at a settlement's land with a marker
    );

    selection = new Set();
    targeting = null;
    drag = null;
    armedSupply = null;
    refusal = null;
    hoverSite = null;
    victory = null;
    leaving = null;
    resultsShown = false;
    continuing = false;
    lastResult = null;
    crownResult = null;
    hitStopUntilMs = 0;
    surrenderSites = [];
    threats = new Map();
    lastThreatMs = -1e9;
    siteFlash.clear();
    assaultSpark.clear();
    paused = false;
    dialogOpen = dialogCount() > 0;
    speed = state.settings.speed || 1;
    if (speed === 0.5 && !state.settings.slowBattles) speed = 1; // the half-speed setting was switched off since
    manager.setPaused(false);
    manager.setSpeed(speed);
    // the run stands still while this view plays its fly-in, a hit-stop or its end sequence (it used to step only in phase 'live', outside a hit-stop)
    const gatedId = run.id;
    manager.setGate(gatedId, () => active && !!run && run.id === gatedId && (phase !== 'live' || performance.now() < hitStopUntilMs));
    sendFraction = 0.5;
    enterElapsedSec = 0;
    campDropStartMs = null;
    coachSig = '';
    stuckDone = false;
    noRouteSeen = false;
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
    applyBattleCamera(!!opts.skipIntro && !opts.fly);
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

  /** A run whose sim has already decided: straight to its results card (a resumed save, or a switch to a battle that just ended). */
  function resumeEnded() {
    const { state } = container.get();
    lastResult = battle.result;
    phase = battle.result === 'win' ? 'victory' : 'defeat';
    if (battle.result === 'win') {
      crownResult = evaluateBattle(trackerOf(battle), battle, world, regionId, state);
      victory = { fanfared: true, slots: [], flood: { schedule: [] }, nextSlot: 0, nextFlood: 0, endMs: 0 };
    }
    manager.recordResult(run.id);
    showResults();
  }

  let lastCommander = null;
  /** A General id if that General is free now (not commanding elsewhere, not wounded), else null: the Militia Captain. */
  function freeOrCaptain(id) {
    if (!id) return null;
    const { state } = container.get();
    return freeGenerals(state, Date.now()).some((g) => g.id === id) ? id : null;
  }

  function startBattle(id, opts = {}) {
    music.setScene('battle'); // Retry does not go through goto.battle
    const { state } = container.get();
    world = container.get().world;
    regionId = id;
    // the commander (DESIGN 10.11): the card's pick, else the best free General, else the Militia Captain (null); their passive and ability fold into the stats
    // Lone Banner (PLAN-PHASE5 §5C): the Militia Captain commands, always (meta/edicts.js commanderFor)
    const commander = edictCommander(state, opts.commander !== undefined ? opts.commander : (bestFreeGeneral(state, world, regionId, 'attack', Date.now())?.id ?? null));
    lastCommander = commander;
    const player = playerBattleStats(state, world, regionId, { commander }); // with the Works next to the target (DESIGN 5.8)
    const enemy = enemyBattleStats(world, state, regionId);
    // the running battles' regions and settlements stay out of this arena; an occupier's captured fortifications fight in it (ARCHITECTURE 10.3)
    const arena = buildArena(world, state.owner, regionId, player, enemy, attackArenaOpts(state, world, regionId, manager.busy()));
    battle = createBattle(arena, player, enemy);
    // the label at attack time (the Bounty Board's "Win Swift on a Hard or Deadly region", PLAN-PHASE4 §4A): taken now, before the fight changes anything
    let labelAtAttack = null;
    try { labelAtAttack = difficulty(state, world, regionId, { commander }).label || null; } catch { labelAtAttack = null; }
    run = manager.start({ kind: 'attack', regionId, battle, commander, labelAtAttack }); // the manager owns it (state.battles); it also starts the crowns tracker
    if (!run) throw new Error('the battle could not start (too many battles, or this region is already being fought over)');
    calmUnrest(state, regionId); // PLAN-PHASE11b: attacking the region in Unrest calms it (the thinned garrisons above are what this fight meets)
    manager.focus(run.id);
    voice.resetBattle(); // every leader trigger may speak again
    setupView(opts);
    tutorial.notify('battleStart');
    if (opts.skipIntro) speakBattleStart(); // Retry lands live at once; a fresh fight speaks when the fly-in ends
  }

  function enter(payload = {}) {
    const { state } = container.get();
    world = container.get().world;
    renderer.fx.clear();
    const saved = payload.runId != null ? manager.get(payload.runId) : payload.resume ? (manager.focused() || manager.list()[0] || null) : null;
    if (saved) {
      // A saved battle that cannot be resumed (a corrupt or older shape, a region already won) must never brick Continue: drop it, tell the player, and let
      // the scene manager put them back on the map (scenes/flow.js).
      try {
        if (!resumable(saved.battle, state, world, saved.kind)) throw new Error('the saved battle is not resumable');
        run = saved;
        battle = run.battle;
        regionId = battle.arena.regionId;
        manager.focus(run.id);
        setupView({ skipIntro: true, fly: payload.runId != null });
        if (battle.result) {
          resumeEnded();
        } else if (payload.runId == null) {
          ui.toasts.update({ message: 'Battle resumed' });
        }
      } catch (err) {
        manager.remove(saved.id);
        run = null;
        battle = null;
        const e = new Error(`battle resume failed: ${err && err.message}`);
        e.userMessage = 'That saved battle couldn’t be resumed: you are back on the map.';
        throw e;
      }
      return;
    }
    startBattle(payload.regionId, { commander: payload.commander });
  }

  function exit() {
    active = false;
    if (run && manager.get(run.id)) manager.setGate(run.id, null); // a run still alive behind the map is no longer held by this view
    renderer.canvas.tabIndex = -1;
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
    onAuto,
    onPauseToggle: togglePause,
    onSpeed,
    onPower,
    onRetreat,
    onResultsContinue,
    onRetry,
    onBackToMap,
    onMap: leaveToMap,
    onAbility,
    switchTo,
    get runId() { return run ? run.id : null; },
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
    /** Dev/automation: a varied map's state as the view shows it (DESIGN 10.13): the twist and type, the HUD line, the garrisons Night hides, the Dragon. */
    featureInfo() {
      if (!battle) return null;
      return {
        twist: feat.twist(), type: (battle.arena && battle.arena.type) || null, hud: feat.hud(),
        hidden: battle.sites.filter((s) => feat.badgeLabel(s) === '?').map((s) => s.id),
        dragon: battle.dragon ? { ...battle.dragon } : null,
        powers: POWER_IDS.map((id) => ({ id, ...feat.powerFlags(id) })),
        noRoute: battle.sites.filter((s) => feat.noRouteText(s.id)).map((s) => s.id),
      };
    },
    /** Dev/automation: what the Ashen layer has shown this battle (PLAN-PHASE6): rises, burns, Risings, wisps in the air. */
    ashenInfo() { return battle ? ashen.info() : null; },
    boonInfo() { return battle ? boonFx.info() : null; },
    /** Dev/automation: what the sea layer has shown this battle (PLAN-PHASE12): lanes, ports, Tide telegraphs and floods, Broadside. */
    seaInfo() { return battle ? seaFx.info() : null; },
    /** Dev/automation (PLAN-PHASE13): the Throne's phase, Champions, borrows shown, the Usurper drawn. */
    throneInfo() { return battle ? throne.info() : null; },
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
    /** Dev/automation: the ids of the settlements currently selected. */
    selection() {
      return [...selection];
    },
    /** Dev/automation: whether the "Stuck?" hint is on screen, and whether it has already been used this battle. */
    stuckHint() {
      return { showing: coachSig === 'stuck', done: stuckDone, sinceCaptureSec: battle ? Math.round((battle.t - stuckCaptureT) * 10) / 10 : null };
    },
    /** Dev/automation: the Auto toggle and the player's standing supply lines. */
    supplyInfo() {
      return { auto: autoMode, lines: (battle?.supply || []).filter((l) => l.owner === PLAYER_OWNER).map((l) => ({ from: l.from, to: l.to })), armed: armedSupply ? armedSupply.siteId : null, refused: refusal ? refusal.site : null };
    },
    /** Dev/automation: the step-3 tutorial arrow's endpoints as site ids ({ from: camp, to }), or null. */
    tutorialArrow() {
      const pick = tutorialArrowTarget();
      return pick ? { from: pick.camp.id, to: pick.target.id } : null;
    },
    /** Dev/automation: the send drag in progress ({ outcome, color }: what its arrow shows), or null. */
    /** The keyboard cursor's settlement id (-1 before it is used): for the keyboard-only check. */
    siteCursorId() { return siteCursor; },
    dragInfo() {
      return drag && drag.kind === 'send' ? { outcome: drag.outcome ?? null, color: dragColor(drag), supply: !!drag.supply, unroutable: [...(drag.unroutable || [])], ...dragShape(drag), wordDrawn: drag.wordDrawn ?? null, tooltip: !ui.tooltip.el.hidden } : null;
    },
    get phase() { return phase; },
    get battle() { return battle; },
  };
}
