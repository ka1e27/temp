// The Living Frontier's live loop (DESIGN 10.1, ARCHITECTURE 10.5): runs the raid scheduler on ACTIVE play time, tells the player a war band is coming
// (a toast with Go and a countdown; the band marches on the map), and starts the defense battle when it arrives. Browser side (no pure-module rules), but
// it owns no game rules: those are meta/frontier.js (tickFrontier, defenseRunFor, estimateDefense) and the battle manager.
//
//   const frontier = createFrontierLoop({ getState, getWorld, manager, ui, services, isActive });
//   frontier.tick(dtSec)          // every frame from main.js
//
// "Active" is the game open on the map or in a battle, not paused and with no dialog open: the raid clock then stands still as the battles do.
import { FEATURES } from './features.js';
import { FRONTIER } from '../config/frontier.js';
import { nearestFreeGeneral, freeGenerals } from '../meta/generals.js';
import { commanderFor as edictCommander } from '../meta/edicts.js';
import { playerBattleStats } from '../meta/progression.js';
import { tickFrontier, defenseRunFor, estimateDefense, borderingRivals, raidDepth, raidEnemyStats, ensureFrontier } from '../meta/frontier.js';

/** "the Crimson Legion" */
export function factionTitle(world, factionId) {
  const f = world.factions[factionId];
  if (!f) return 'the enemy';
  return /^the /i.test(f.name) ? f.name : `the ${f.name}`;
}

/**
 * @param {{ getState: () => object, getWorld: () => object, manager: object, ui: object, services: object, isActive: () => boolean }} deps
 */
export function createFrontierLoop({ getState, getWorld, manager, ui, services, isActive }) {
  const goFor = new Set(); // raid ids the player pressed Go for: their defense opens on arrival
  const commanderFor = new Map(); // raid id -> the General assigned when it was announced (DESIGN 10.11: the free one nearest the region)
  let lastToastSec = -1;

  const secondsLeft = (raid) => Math.max(0, Math.ceil(raid.arriveAt - (getState().frontier ? getState().frontier.activeSec : 0)));

  function raidText(raid) {
    const world = getWorld();
    const to = world.regions[raid.toRegionId];
    const left = secondsLeft(raid);
    const go = goFor.has(raid.id);
    const who = factionTitle(world, raid.faction);
    return `${who.charAt(0).toUpperCase()}${who.slice(1)} marches on ${to ? to.name : 'your land'}: arrives in ${left} s${go ? '. You will be taken there.' : ''}`;
  }

  /** Go on an incoming raid: the map flies to the region now (when the map is up), and the defense opens when the band arrives. */
  function go(raidId) {
    const state = getState();
    const raid = (state.frontier && state.frontier.incoming || []).find((r) => r.id === raidId);
    if (raid) {
      goFor.add(raidId);
      services.focusRegion?.(raid.toRegionId);
      services.tutorial?.notify('raidGo');
      return;
    }
    // already arrived: open its defense
    const run = manager.list().find((r) => r.raidId === raidId);
    if (run) services.switchToBattle?.(run.id);
  }

  /** "Khan Bokbek swears vengeance: Ashford, in 1:30" (PLAN-PHASE4 §4D) */
  function vendettaText(raid) {
    const world = getWorld();
    const to = world.regions[raid.toRegionId];
    const left = secondsLeft(raid);
    const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    return `${raid.vendetta.leader || 'A rival leader'} swears vengeance: ${to ? to.name : 'your land'}, in ${clock}${goFor.has(raid.id) ? '. You will be taken there.' : ''}`;
  }

  function toastRaid(raid, { fresh = false } = {}) {
    if (raid.vendetta) {
      const f = getWorld().factions[raid.vendetta.faction];
      ui.toasts.update({
        id: `raid-${raid.id}`, type: 'warning', icon: 'pennant', className: 'is-vendetta', accent: f ? f.color : undefined,
        message: vendettaText(raid), duration: (secondsLeft(raid) + 2) * 1000,
        action: { label: 'Go', ariaLabel: `Go to ${getWorld().regions[raid.toRegionId]?.name || 'the region'} to meet the Vendetta`, onClick: () => { services.tutorial?.notify('vendettaGo'); go(raid.id); } },
      });
      if (fresh) services.tutorial?.notify('vendettaAnnounced');
      return;
    }
    ui.toasts.update({
      id: `raid-${raid.id}`, type: 'warning', icon: 'sword', message: raidText(raid), duration: (secondsLeft(raid) + 2) * 1000,
      action: { label: 'Go', ariaLabel: `Go to ${getWorld().regions[raid.toRegionId]?.name || 'the region'}`, onClick: () => go(raid.id) },
    });
    if (fresh) services.tutorial?.notify('raidAnnounced');
  }

  function onAnnounce(raid) {
    services.pacer?.introduce(raid.vendetta ? 'vendetta' : 'raids'); // Phase 10A: urgent, never waits; the next new system waits behind it
    const world = getWorld();
    try {
      const reserved = new Set(commanderFor.values());
      const g = nearestFreeGeneral(getState(), world, raid.toRegionId, Date.now());
      if (g && !reserved.has(g.id || g)) commanderFor.set(raid.id, g.id || g);
    } catch { /* no General: the Militia Captain */ }
    const to = world.regions[raid.toRegionId];
    // the warning first (on a phone a toast waits while a leader banner shows; the banner slides in under a toast already up), then the leader's line
    toastRaid(raid, { fresh: true });
    if (raid.vendetta) {
      services.sfx?.play('horn', { volume: 0.9 });
      services.goals?.onVendettaSworn(raid);
    } else {
      try { services.speak?.('battleStart', raid.faction, raid.fromRegionId); } catch { /* a leader line is a nicety */ }
    }
    services.onRaidAnnounced?.(raid, to);
  }

  function onArrive(raid) {
    const state = getState();
    const world = getWorld();
    let run = null;
    try {
      // the General assigned at the announcement, if still free; else the nearest free one now; else the Militia Captain
      const want = commanderFor.get(raid.id);
      commanderFor.delete(raid.id);
      const free = freeGenerals(state, Date.now());
      let commander = want && free.some((g) => g.id === want) ? want : null;
      if (!commander) { const g = nearestFreeGeneral(state, world, raid.toRegionId, Date.now()); commander = g ? (g.id || g) : null; }
      commander = edictCommander(state, commander); // Lone Banner: the Militia Captain holds every defense
      const player = playerBattleStats(state, world, raid.toRegionId, { commander });
      run = defenseRunFor(state, world, raid, player, { nowMs: Date.now(), busy: manager.busy() });
      run.commander = commander;
    } catch (err) {
      console.warn('[frontier] the defense could not start:', err && (err.code || err.message));
      return;
    }
    const started = manager.start(run);
    if (!started) return;
    const name = world.regions[raid.toRegionId] ? world.regions[raid.toRegionId].name : 'your region';
    if (goFor.has(raid.id)) {
      goFor.delete(raid.id);
      ui.toasts.dismissId?.(`raid-${raid.id}`); // the countdown is over: the defense itself is the news now
      services.switchToBattle?.(started.id);
    } else {
      ui.toasts.update({
        id: `raid-${raid.id}`, type: 'warning', icon: 'shield',
        message: `${name} is under attack: your Captain holds it. Go to command it yourself.`, duration: 9000,
        action: { label: 'Go', ariaLabel: `Go to the defense of ${name}`, onClick: () => services.switchToBattle?.(started.id) },
      });
    }
    services.tutorial?.notify('defenseStarted');
    services.onDefenseStarted?.(started);
  }

  /** @param {number} dtSec */
  function tick(dtSec) {
    if (!FEATURES.frontier) return;
    if (!isActive()) return;
    const state = getState();
    const world = getWorld();
    // Phase 10A: the first Vendetta is a new system: it does not set out until the pacer gives it its turn (app/pacer.js). The first raid is core
    // gameplay (lead decision): it comes on its own grace and only restarts the pacer's clock (onAnnounce)
    const p = services.pacer;
    const hold = (name) => !!p && !p.known(name) && !p.ready(name);
    const res = tickFrontier(state, world, Date.now(), dtSec, { holdVendettas: hold('vendetta') });
    const { announced, arrived } = res;
    for (const raid of announced) onAnnounce(raid);
    for (const raid of arrived) onArrive(raid);
    if (res.streakEnded) services.goals?.onStreakEnded(res.streakEnded); // PLAN-PHASE4 §4B: the window ran out
    // the countdown in each incoming toast, once a second
    const sec = Math.floor(state.frontier ? state.frontier.activeSec : 0);
    if (sec !== lastToastSec) {
      lastToastSec = sec;
      for (const raid of (state.frontier && state.frontier.incoming) || []) toastRaid(raid);
    }
  }

  /** The incoming raid on a region (for its card), or null: { raid, secondsLeft, text, estimate }. */
  function incomingOn(regionId) {
    const state = getState();
    const raid = ((state.frontier && state.frontier.incoming) || []).find((r) => r.toRegionId === regionId);
    if (!raid) return null;
    let estimate = null;
    try { estimate = estimateDefense(state, getWorld(), regionId, raid, { commander: 'captain', nowMs: Date.now() }); } catch { estimate = null; }
    return { raid, secondsLeft: secondsLeft(raid), byName: factionTitle(getWorld(), raid.faction), estimate };
  }

  /**
   * Dev / checks only: a war band sets out NOW against one of your regions (the one given, else the first a rival borders), arriving in `sec` active
   * seconds; `first` makes it the weak, forgiving first raid; `mult` scales its strength (meta/frontier.js raidEnemyStats honours it). Returns the raid or null.
   */
  function devRaid(toRegionId, { sec = 20, first = false, mult } = {}) {
    const state = getState();
    const world = getWorld();
    const rivals = borderingRivals(state, world);
    let pair = null;
    let faction = null;
    for (const r of rivals) {
      const p = r.pairs.find((x) => toRegionId == null || x.to === toRegionId);
      if (p) { pair = p; faction = r.faction; break; }
    }
    if (!pair) return null;
    const f = ensureFrontier(state);
    const raid = {
      id: f.seq++, faction, fromRegionId: pair.from, toRegionId: pair.to, announcedAt: f.activeSec, arriveAt: f.activeSec + sec,
      strength: 0, depth: raidDepth(state, world, pair.to), first,
    };
    if (Number.isFinite(mult)) raid.mult = mult;
    raid.strength = Math.round(raidEnemyStats(state, world, raid).campTroops);
    f.incoming.push(raid);
    f.stats.raids += 1;
    onAnnounce(raid);
    return raid;
  }

  /**
   * Dev / checks only: `faction` swears a Vendetta now (its Grudge is set to the maximum and the scheduler is asked at once), arriving in `sec` active
   * seconds (default: the config's telegraph). Returns the raid or null (no target, no free defense slot, a broken leader).
   */
  function devVendetta(faction, { sec } = {}) {
    const state = getState();
    const world = getWorld();
    const f = ensureFrontier(state);
    if (faction == null) {
      const rivals = borderingRivals(state, world).filter((r) => r.faction > 1);
      faction = rivals.length ? rivals[0].faction : null;
    }
    if (faction == null) return null;
    if (f.activeSec < FRONTIER.graceSec) f.activeSec = FRONTIER.graceSec; // past the opening grace (dev only)
    if (!state.grudges || typeof state.grudges !== 'object') state.grudges = { v: 1, at: f.activeSec, news: [] };
    state.grudges.at = f.activeSec; // no cooling for the jump
    const key = String(faction);
    state.grudges[key] = { ...(state.grudges[key] || {}), value: 100, warnedAt: f.activeSec, vendettaAt: null, orphanSince: null };
    f.nextCheckAt = f.activeSec; // the next tick checks (and swears) at once
    const before = f.incoming.length;
    const res = tickFrontier(state, world, Date.now(), 0);
    for (const raid of res.announced) onAnnounce(raid);
    for (const raid of res.arrived) onArrive(raid);
    const raid = f.incoming.slice(before).find((r) => r.vendetta && r.vendetta.faction === faction) || f.incoming.find((r) => r.vendetta && r.vendetta.faction === faction) || null;
    if (raid && Number.isFinite(sec)) { raid.arriveAt = f.activeSec + sec; toastRaid(raid); }
    return raid;
  }

  return { tick, go, incomingOn, secondsLeft, devRaid, devVendetta, commanderOf: (raidId) => commanderFor.get(raidId) ?? null, reset: () => { goFor.clear(); commanderFor.clear(); lastToastSec = -1; } };
}
