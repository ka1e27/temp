// Rally auto-send: phase 6 of the tick.
//
// Split out of ./sim.js for the line budget, and because a rally is about to
// stop being a single destination — see `rallyTargets` below.
//
// A rallied site forwards everything above its hold-back to the next target in
// its list, every tick. Cascading is EMERGENT rather than modelled: if B also
// rallies, what arrives at B moves on next tick. There is no multi-hop concept
// here and there should not be one.
// PURE.
import { scaleComp, total } from './combat.js';
import { siteById, rallyKeepOf, rallyTargetsOf } from './state.js';
import { spawnSquad } from './movement.js';
import { subComp } from './commands.js';
import { pushEvent, EVENTS } from './events.js';

const FACTIONS = ['player', 'enemy'];

/**
 * Which target this site feeds THIS tick.
 *
 * One site may rally to several neighbours and it alternates between them, so
 * a stronghold behind two fronts can feed both without the player splitting the
 * garrison by hand. The cursor lives in SIM STATE, not on the view: it is read
 * during the tick, so a presentation-side counter would desynchronise a replay
 * from its command log and break determinism.
 *
 * Dangling and non-adjacent targets are dropped from the list rather than
 * skipped, which is what keeps a captured or re-routed neighbour from leaving a
 * site permanently pointing at nothing.
 *
 * @returns {?object} the site to send to, or null when there is nowhere legal
 */
export function nextRallyTarget(state, site) {
  const targets = rallyTargetsOf(site);
  if (!targets.length) return null;

  const legal = [];
  for (const id of targets) {
    const t = siteById(state, id);
    if (t && site.adj.includes(t.id)) legal.push(t);
  }
  if (legal.length !== targets.length) {
    site.rallyTargets = legal.map((t) => t.id);
  }
  if (!legal.length) { site.rallyCursor = 0; return null; }

  const cursor = Number.isInteger(site.rallyCursor) ? site.rallyCursor : 0;
  return legal[((cursor % legal.length) + legal.length) % legal.length];
}

/** Phase 6. Forward every rallied garrison above its hold-back. */
export function rallyPhase(state) {
  for (const site of state.sites) {
    if (!FACTIONS.includes(site.owner)) continue;
    const target = nextRallyTarget(state, site);
    if (!target) continue;

    const n = total(site.garrison);
    // Per-site, not one global: a back-line farm keeps almost nothing, a front
    // stronghold feeding a siege holds enough to survive the counter-attack.
    const keep = rallyKeepOf(site);
    if (n <= keep) continue;
    const send = scaleComp(site.garrison, (n - keep) / n);
    if (total(send) === 0) continue;

    site.garrison = subComp(site.garrison, send);
    const squad = spawnSquad(state, {
      owner: site.owner, from: site.id, to: target.id, comp: send,
    });
    // Advance ONLY on a send. A site that is under its hold-back has not taken
    // its turn, so the next tick that can afford to send still goes to the
    // target that was next — otherwise a starved site silently skips
    // destinations and the split stops being an even one.
    site.rallyCursor = (Number.isInteger(site.rallyCursor) ? site.rallyCursor : 0) + 1;
    pushEvent(state, EVENTS.SQUAD_SENT, {
      squadId: squad.id, owner: site.owner, from: site.id, to: target.id, rally: true,
    });
  }
}
