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
  SITES, SITE_UPGRADE, UNIT_IDS, UNITS, CENTIGOLD, RECRUIT,
} from '../content/balance.js';
import { emptyComp, addComp, scaleComp, total } from './combat.js';
import { siteById, clampRallyKeep, rallyTargetsOf, ralliesTo } from './state.js';
import { spawnSquad, retreatTarget, reverseSquad } from './movement.js';
import { isTrainable } from './training.js';
import { applyGold, goldOf } from './economy.js';
import { pushEvent, EVENTS } from './events.js';
import { BOOST } from './boosters.js';

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

/**
 * Validate an optional chain of intermediate stops for a SEND.
 *
 * Sends are adjacency-only, which is the rule that makes the site graph mean
 * something. A chain does not break it — it just lets one order express several
 * legal hops instead of making the player issue them one at a time and babysit
 * each arrival. So EVERY leg must still be adjacent, and every stop in between
 * must be ground the sender already holds: you may march THROUGH your own
 * territory, never through someone else's.
 *
 * @returns {string[]|string|null} the via list, a rejection reason, or null.
 */
function checkVia(state, cmd, from, to, by) {
  const via = cmd.via;
  if (via === undefined || via === null) return null;
  if (!Array.isArray(via) || !via.length) return 'malformed';

  const stops = [from.id, ...via, to.id];
  const seen = new Set();
  for (let i = 0; i < stops.length; i++) {
    // A repeated stop is a route that doubles back on itself — always a misdrag.
    // It is also what bounds the chain: no repeats means no route can be longer
    // than the site count, so no arbitrary MAX_CHAIN constant is needed.
    if (seen.has(stops[i])) return 'chain-repeats';
    seen.add(stops[i]);
    if (i === 0) continue;
    const prev = siteById(state, stops[i - 1]);
    const cur = siteById(state, stops[i]);
    if (!cur) return 'unknown-site';
    if (!prev.adj.includes(cur.id)) return 'not-adjacent';
    // The final stop is the objective and may be hostile; everything the
    // column merely passes through has to be ours.
    if (i < stops.length - 1 && cur.owner !== by) return 'chain-not-yours';
  }
  return via;
}

function cmdSend(state, cmd, by) {
  const from = siteById(state, cmd.from);
  const to = siteById(state, cmd.to);
  if (!from || !to) return 'unknown-site';
  if (from.owner !== by) return 'not-your-site';
  const via = checkVia(state, cmd, from, to, by);
  if (typeof via === 'string') return via;
  if (!via && !from.adj.includes(to.id)) return 'not-adjacent';
  const frac = Math.min(1, Math.max(0, Number(cmd.fraction ?? 1)));
  if (!(frac > 0)) return 'bad-fraction';

  const send = scaleComp(filterComp(from.garrison, cmd.filter), frac);
  if (total(send) === 0) return 'empty-send';

  from.garrison = subComp(from.garrison, send);
  const squad = spawnSquad(state, {
    owner: by, from: from.id, to: to.id, comp: send, arriveTick: cmd.arriveTick | 0, via,
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
  // A capped unit is COMMISSIONED, not built — see training.js TRAINABLE_UNITS.
  // Enforced here and not only in the picker, so a stale keybinding or a
  // replayed command log cannot park a stronghold on a type it can never finish.
  if (!isTrainable(cmd.unit)) return 'unit-not-trainable';
  if (!state.mods[by].unlockedUnits.includes(cmd.unit)) return 'unit-locked';
  site.trainType = cmd.unit; // progress deliberately kept
  return null;
}

/**
 * COMMISSION a single unit, paid for in gold and delivered at once.
 *
 * Deliberately NOT a training order: `trainType` is untouched, so a stronghold
 * keeps building its spearwall while its commander rides in. That is the whole
 * point — a marshal used to cost a site's entire output for forty seconds, and
 * the retasking was what made a 4,000-crown unlock not worth using.
 *
 * Only units with a `maxPerSite` are commissionable. That is not an arbitrary
 * whitelist: a cap is exactly what makes "buy it outright" safe, because there
 * is no amount of gold that turns into an army this way.
 */
function cmdRecruit(state, cmd, by) {
  const site = siteById(state, cmd.site);
  if (!site) return 'unknown-site';
  if (site.owner !== by) return 'not-your-site';
  if (!SITES[site.kind].train) return 'site-cannot-train';
  const unit = cmd.unit;
  const spec = RECRUIT[unit];
  if (!spec || !UNIT_IDS.includes(unit)) return 'not-commissionable';
  if (!state.mods[by].unlockedUnits.includes(unit)) return 'unit-locked';
  const cap = UNITS[unit].maxPerSite ?? Infinity;
  if ((site.garrison[unit] || 0) >= cap) return 'already-commissioned';
  const costCg = spec.gold * CENTIGOLD;
  if (goldOf(state.factions[by]) < costCg) return 'insufficient-gold';

  applyGold(state.factions[by], -costCg);
  site.garrison[unit] = (site.garrison[unit] || 0) + 1;
  pushEvent(state, EVENTS.UNITS_TRAINED, { siteId: site.id, owner: by, unit, count: 1 });
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

/**
 * Set, add, remove or clear a rally destination.
 *
 * A site may feed SEVERAL neighbours, taking them in turn (battle/rally.js), so
 * this is a set operation rather than an assignment. `mode`:
 *   'set'    (default) replace the list with this one target
 *   'add'    append if absent
 *   'remove' drop this target
 *   'toggle' add if absent, remove if present — what a right-drag does
 * A null target always clears the whole list, whatever the mode.
 */
function cmdRally(state, cmd, by) {
  const site = siteById(state, cmd.site ?? cmd.from);
  if (!site) return 'unknown-site';
  if (site.owner !== by) return 'not-your-site';
  const targetId = cmd.target !== undefined ? cmd.target : (cmd.to ?? null);
  if (targetId == null) { setTargets(site, []); return null; }
  const target = siteById(state, targetId);
  if (!target) return 'unknown-target';
  if (!site.adj.includes(target.id)) return 'not-adjacent';

  const current = rallyTargetsOf(site);
  const has = current.includes(target.id);
  const mode = cmd.mode ?? 'set';
  let next;
  if (mode === 'remove' || (mode === 'toggle' && has)) {
    next = current.filter((id) => id !== target.id);
  } else if (mode === 'add' || mode === 'toggle') {
    next = has ? current : [...current, target.id];
  } else {
    next = [target.id];
  }
  setTargets(site, next);

  // A pair of sites rallying INTO each other pumps troops back and forth
  // forever, burning march time and leaving both permanently under-garrisoned.
  // The newer order wins and the reciprocal link is dropped, so the loop cannot
  // exist no matter which path the orders arrived by — a drag, a rally chain,
  // or a resumed save. With lists this drops only the ONE offending link, so a
  // site feeding two neighbours keeps the innocent one.
  if (next.includes(target.id) && ralliesTo(target, site.id)) {
    setTargets(target, rallyTargetsOf(target).filter((id) => id !== site.id));
  }
  return null;
}

/** Write a target list and keep the cursor inside it. */
function setTargets(site, targets) {
  site.rallyTargets = targets;
  site.rallyCursor = targets.length ? (site.rallyCursor | 0) % targets.length : 0;
}

/**
 * How many troops a rallied site holds back. Its own verb rather than a field
 * on RALLY, because the number and the destination are set by different
 * gestures — a drag picks the target, the panel's stepper picks the hold-back —
 * and neither should have to know the other's current value to leave it alone.
 *
 * A non-integer is REFUSED (that is a caller bug); an out-of-range integer is
 * CLAMPED, because a stepper walking off the end of its range is normal use.
 */
function cmdRallyKeep(state, cmd, by) {
  const site = siteById(state, cmd.site ?? cmd.from);
  if (!site) return 'unknown-site';
  if (site.owner !== by) return 'not-your-site';
  const n = typeof cmd.keep === 'number' ? cmd.keep : NaN;
  if (!Number.isInteger(n)) return 'bad-keep';
  site.rallyKeep = clampRallyKeep(n);
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
  RECRUIT: cmdRecruit,
  UPGRADE: cmdUpgrade,
  RALLY: cmdRally,
  RALLY_KEEP: cmdRallyKeep,
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
