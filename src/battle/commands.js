// Order validation and application.
//
// PRESENTATION NEVER MUTATES SIM STATE. A click appends a command object to
// state.commands[]; this module validates and applies it at the top of the next
// tick. That gives us free input buffering, a replayable command log, and a UI
// that structurally cannot corrupt the simulation.
//
// Invalid orders are rejected SILENTLY as far as the sim is concerned — they
// only leave a `command-rejected` event for the HUD to blip.
// PURE.
import { TICK_HZ } from '../core/loop.js';
import {
  SITES, SITE_UPGRADE, BOOSTERS, UNIT_IDS, CENTIGOLD,
} from '../content/balance.js';
import { emptyComp, addComp, scaleComp, total } from './combat.js';
import { siteById } from './state.js';
import { spawnSquad, retreatTarget, reverseSquad, travelTicks } from './movement.js';
import { applyGold, goldOf } from './economy.js';
import { pushEvent, EVENTS } from './events.js';

const sec = (s) => Math.round(s * TICK_HZ);

/** a minus b, never below zero. */
export function subComp(a, b) {
  const out = emptyComp();
  for (const u of UNIT_IDS) out[u] = Math.max(0, (a[u] || 0) - (b[u] || 0));
  return out;
}

/** Keep only the unit ids in `filter` (the HUD's Q-W-E-R-T chips). */
export function filterComp(comp, filter) {
  if (!Array.isArray(filter) || !filter.length) return addComp(emptyComp(), comp);
  const out = emptyComp();
  for (const u of UNIT_IDS) if (filter.includes(u)) out[u] = comp[u] || 0;
  return out;
}

// --- individual orders -----------------------------------------------------

function cmdSend(state, cmd, by) {
  const from = siteById(state, cmd.from);
  const to = siteById(state, cmd.to);
  if (!from || !to) return 'unknown-site';
  if (from.owner !== by) return 'not-your-site';
  if (!from.adj.includes(to.id)) return 'not-adjacent';
  const frac = Math.min(1, Math.max(0, Number(cmd.fraction ?? 1)));
  if (!(frac > 0)) return 'bad-fraction';

  const send = scaleComp(filterComp(from.garrison, cmd.filter), frac);
  if (total(send) === 0) return 'empty-send';

  from.garrison = subComp(from.garrison, send);
  const squad = spawnSquad(state, {
    owner: by, from: from.id, to: to.id, comp: send, arriveTick: cmd.arriveTick | 0,
  });
  pushEvent(state, EVENTS.SQUAD_SENT, {
    squadId: squad.id, owner: by, from: from.id, to: to.id, arriveTick: squad.arriveTick,
  });
  return null;
}

function cmdTrain(state, cmd, by) {
  const site = siteById(state, cmd.site);
  if (!site) return 'unknown-site';
  if (site.owner !== by) return 'not-your-site';
  if (!SITES[site.kind].train) return 'site-cannot-train';
  if (!UNIT_IDS.includes(cmd.unit)) return 'unknown-unit';
  if (!state.mods[by].unlockedUnits.includes(cmd.unit)) return 'unit-locked';
  site.trainType = cmd.unit; // progress deliberately kept
  return null;
}

function cmdUpgrade(state, cmd, by) {
  const site = siteById(state, cmd.site);
  if (!site) return 'unknown-site';
  if (site.owner !== by) return 'not-your-site';
  if (site.upgradeTicksLeft > 0) return 'already-upgrading';
  const spec = SITE_UPGRADE[site.level - 1];
  if (!spec) return 'max-level';
  const costCg = spec.gold * CENTIGOLD;
  if (goldOf(state.factions[by]) < costCg) return 'insufficient-gold';
  applyGold(state.factions[by], -costCg);
  site.level += 1;                       // effectiveLevel() keeps it producing
  site.upgradeTicksLeft = sec(spec.sec); // at the OLD rate until it completes
  return null;
}

function cmdRally(state, cmd, by) {
  const site = siteById(state, cmd.site ?? cmd.from);
  if (!site) return 'unknown-site';
  if (site.owner !== by) return 'not-your-site';
  const targetId = cmd.target !== undefined ? cmd.target : (cmd.to ?? null);
  if (targetId == null) { site.rallyTarget = null; return null; }
  const target = siteById(state, targetId);
  if (!target) return 'unknown-target';
  if (!site.adj.includes(target.id)) return 'not-adjacent';
  site.rallyTarget = target.id;
  return null;
}

function cmdRetreat(state, cmd, by) {
  // Tolerant reader: the HUD may address a squad through the same verb.
  const squadRef = cmd.squadId ?? cmd.squad;
  if (squadRef != null) {
    const id = typeof squadRef === 'object' ? squadRef.id : squadRef;
    return cmdRetreatSquad(state, { ...cmd, squadId: id }, by);
  }
  const site = siteById(state, cmd.site ?? cmd.from);
  if (!site) return 'unknown-site';

  if (site.siege && site.siege.owner === by && total(site.siege.comp) > 0) {
    const target = retreatTarget(state, site, by);
    if (!target) return 'nowhere-to-retreat';
    const comp = site.siege.comp;
    site.siege = null;
    const squad = spawnSquad(state, {
      owner: by, from: site.id, to: target.id, comp, retreating: true,
    });
    pushEvent(state, EVENTS.SIEGE_ABANDONED, {
      siteId: site.id, owner: by, to: target.id, squadId: squad.id,
    });
    return null;
  }

  if (site.owner === by && total(site.garrison) > 0) {
    const target = retreatTarget(state, site, by);
    if (!target) return 'nowhere-to-retreat';
    const comp = site.garrison;
    site.garrison = emptyComp();
    const squad = spawnSquad(state, {
      owner: by, from: site.id, to: target.id, comp, retreating: true,
    });
    pushEvent(state, EVENTS.GARRISON_RETREATED, {
      siteId: site.id, owner: by, to: target.id, squadId: squad.id,
    });
    return null;
  }
  return 'nothing-to-retreat';
}

function cmdRetreatSquad(state, cmd, by) {
  const ref = cmd.squadId ?? cmd.squad;
  const id = typeof ref === 'object' && ref ? ref.id : ref;
  const squad = state.squads.find((s) => s.id === id);
  if (!squad) return 'unknown-squad';
  if (squad.owner !== by) return 'not-your-squad';
  if (squad.retreating) return 'already-retreating';
  if (!reverseSquad(state, squad)) return 'nowhere-to-retreat';
  pushEvent(state, EVENTS.SQUAD_RETREATED, {
    squadId: squad.id, owner: by, to: squad.to, arriveTick: squad.arriveTick,
  });
  return null;
}

function cmdWithdraw(state, cmd, by) {
  if (by !== 'player') return 'not-your-battle';
  state.status = 'retreat';
  pushEvent(state, EVENTS.BATTLE_ENDED, { result: 'retreat' });
  return null;
}

// --- boosters --------------------------------------------------------------
// All five resolve HERE, in the order-drain phase, before arrivals — so
// bombard-then-strike is a legal, learnable combo.

function hopsFrom(state, origin, radius) {
  const out = [];
  const seen = { [origin.id]: true };
  let frontier = [origin];
  for (let d = 0; d < radius && frontier.length; d++) {
    const next = [];
    for (const s of frontier) {
      for (const id of s.adj) {
        if (seen[id]) continue;
        seen[id] = true;
        const n = siteById(state, id);
        if (n) { out.push(n); next.push(n); }
      }
    }
    frontier = next;
  }
  return out;
}

const BOOST = {
  rally(state, by, site) {
    if (!site) return 'needs-target';
    const spec = BOOSTERS.rally;
    const sources = hopsFrom(state, site, spec.radius)
      .filter((s) => s.owner === by && total(s.garrison) > 0)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    if (!sources.length) return 'no-sources';
    // One shared arrival tick: the guaranteed alpha strike.
    let common = 0;
    const parts = sources.map((s) => {
      const comp = scaleComp(s.garrison, spec.fraction);
      const t = state.tick + travelTicks(state, s, site, comp, by);
      if (t > common) common = t;
      return { s, comp };
    });
    let sent = 0;
    for (const { s, comp } of parts) {
      if (total(comp) === 0) continue;
      s.garrison = subComp(s.garrison, comp);
      spawnSquad(state, { owner: by, from: s.id, to: site.id, comp, arriveTick: common });
      sent++;
    }
    return sent ? null : 'no-sources';
  },

  march(state, by) {
    const spec = BOOSTERS.march;
    let n = 0;
    for (const sq of state.squads) {
      if (sq.owner !== by) continue;
      const left = sq.arriveTick - state.tick;
      if (left <= 1) continue;
      sq.arriveTick = state.tick + Math.max(1, Math.ceil(left * spec.factor));
      n++;
    }
    return n ? null : 'nothing-in-flight';
  },

  bombard(state, by, site) {
    if (!site) return 'needs-target';
    if (site.owner === by) return 'not-a-target';
    const spec = BOOSTERS.bombard;
    const killed = scaleComp(site.garrison, spec.garrisonFrac);
    site.garrison = subComp(site.garrison, killed);
    if (state.factions[site.owner]) state.factions[site.owner].unitsLost += total(killed);
    state.factions[by].unitsKilled += total(killed);
    site.hp = Math.max(1, site.hp - spec.hp); // NEVER captures
    return null;
  },

  fortify(state, by, site) {
    if (!site) return 'needs-target';
    if (site.owner !== by) return 'not-your-site';
    const spec = BOOSTERS.fortify;
    site.hp += spec.hp;             // deliberate overheal: it is an emergency
    site.shieldTicks = sec(spec.sec);
    return null;
  },

  tithe(state, by) {
    const spec = BOOSTERS.tithe;
    applyGold(state.factions[by], spec.gold * CENTIGOLD);
    state.factions[by].goldEarnedCg += spec.gold * CENTIGOLD;
    state.factions[by].trainBoostTicks = sec(spec.sec);
    return null;
  },
};

function cmdBooster(state, cmd, by) {
  if (by !== 'player') return 'boosters-are-the-players';
  const b = state.boosters[cmd.id];
  if (!b) return 'booster-unavailable';
  if (b.charges <= 0) return 'no-charges';
  const fn = BOOST[cmd.id];
  if (!fn) return 'unknown-booster';
  const siteRef = cmd.site ?? cmd.target;
  const site = siteRef != null ? siteById(state, siteRef) : null;
  if (siteRef != null && !site) return 'unknown-site';

  const reason = fn(state, by, site);
  if (reason) return reason;

  b.charges -= 1;
  b.used = (b.used ?? 0) + 1;
  if (b.cdTicks <= 0) b.cdTicks = b.cdMax;
  pushEvent(state, EVENTS.BOOSTER_USED, { id: cmd.id, siteId: site ? site.id : null });
  return null;
}

// --- drain -----------------------------------------------------------------

// Field aliases the HUD uses are absorbed inside each handler rather than
// rejected: a cosmetic disagreement at this seam must never silently eat an
// order. The shapes documented on each handler remain canonical.
const HANDLERS = {
  SEND: cmdSend,
  TRAIN: cmdTrain,
  UPGRADE: cmdUpgrade,
  RALLY: cmdRally,
  BOOSTER: cmdBooster,
  RETREAT: cmdRetreat,
  RETREAT_SQUAD: cmdRetreatSquad,
  WITHDRAW: cmdWithdraw,
};

/** Phase 2. Apply everything queued since the last tick, in order. */
export function drainCommands(state) {
  const queue = state.commands;
  state.commands = [];
  for (const cmd of queue) {
    if (!cmd || typeof cmd !== 'object') {
      pushEvent(state, EVENTS.COMMAND_REJECTED, { reason: 'malformed', cmd: null });
      continue;
    }
    const handler = HANDLERS[cmd.t];
    if (!handler) {
      pushEvent(state, EVENTS.COMMAND_REJECTED, { reason: 'unknown-command', cmd });
      continue;
    }
    const by = cmd.by === 'enemy' ? 'enemy' : 'player';
    const reason = handler(state, cmd, by);
    if (reason) pushEvent(state, EVENTS.COMMAND_REJECTED, { reason, cmd });
  }
}
