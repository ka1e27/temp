// Squad movement: advancing along cached paths, arrivals (assault/reinforce), and merging
// co-located friendly squads. Split out of sim.js to keep files under the line budget.
import { BATTLE, POWERS } from '../config/battle.js';
import { ownerStats } from './combat.js';
import { getRuntime } from './runtime.js';
import { PLAYER_OWNER } from './owner.js';
import { marchSpeedMult } from './features.js';
import { squadPosition } from './position.js';

function squadSpeed(battle, squad, t) {
  const stats = ownerStats(squad.owner, battle.player, battle.arena.enemyFaction, battle.enemy);
  const marchActive = squad.owner === PLAYER_OWNER && t < battle.effects.marchUntil;
  // Charge squads march faster; Foresight slows every enemy squad for a while (DESIGN §10.11, battle/abilities.js)
  const slowed = squad.owner !== PLAYER_OWNER && t < (battle.effects.slowUntil ?? 0) ? 1 - (battle.effects.slow ?? 0) : 1;
  return BATTLE.baseSpeed * stats.speed * (marchActive ? POWERS.march.mult : 1) * (squad.speedMult ?? 1) * slowed * marchSpeedMult(battle);
}

/** A squad arriving at a site owned by someone else starts or joins an assault; arriving
 * at a friendly site reinforces it. Handles the rare case where a different owner is
 * already assaulting the same site (see the final report for the rationale). */
function handleArrival(battle, squad, toRemove) {
  const toSite = battle.sites[squad.to];
  if (!toSite) {
    toRemove.add(squad.id);
    return;
  }
  if (toSite.owner === squad.owner) {
    toSite.troops += squad.count;
    toRemove.add(squad.id);
    return;
  }
  if (!toSite.assault) {
    toSite.assault = { owner: squad.owner, squads: [squad.id] };
    squad.state = 'assault';
    battle.events.push({ type: 'assault', site: toSite.id, owner: squad.owner });
  } else if (toSite.assault.owner === squad.owner) {
    toSite.assault.squads.push(squad.id);
    squad.state = 'assault';
  } else {
    // A third owner is already assaulting this site (only possible around a Free Folk
    // neutral inside a rival's region). The newcomer collides with the lowest-id squad
    // currently leading that assault instead of joining a three-sided fight on the site.
    const foeId = Math.min(...toSite.assault.squads);
    const foe = battle.squads.find((s) => s.id === foeId);
    if (!foe) {
      toRemove.add(squad.id);
      return;
    }
    toSite.assault.squads = toSite.assault.squads.filter((id) => id !== foeId);
    if (toSite.assault.squads.length === 0) toSite.assault = null;
    squad.state = 'fight';
    squad.foe = foe.id;
    foe.state = 'fight';
    foe.foe = squad.id;
    const pos = squadPosition(battle, squad);
    battle.events.push({ type: 'clash', x: pos.x, y: pos.y, a: squad.id, b: foe.id });
  }
}

/** Advances every unblocked marching squad by `speed * dt` (in cost-1.0-hex-equivalents),
 * consuming as many path segments as the tick's budget allows, then handles arrivals. */
export function advanceMovement(battle, dt, t, blocked) {
  const runtime = getRuntime(battle);
  const toRemove = new Set();

  for (const squad of battle.squads) {
    if (squad.state !== 'march' || blocked.has(squad.id)) continue;
    let remaining = squadSpeed(battle, squad, t) * dt;
    while (remaining > 0 && squad.seg < squad.path.length) {
      const tile = runtime.byIndex.get(squad.path[squad.seg]);
      const cost = tile.cost;
      const need = (1 - squad.prog) * cost;
      if (remaining >= need) {
        remaining -= need;
        squad.seg += 1;
        squad.prog = 0;
      } else {
        squad.prog += remaining / cost;
        remaining = 0;
      }
    }
    if (squad.seg >= squad.path.length) handleArrival(battle, squad, toRemove);
  }

  if (toRemove.size) battle.squads = battle.squads.filter((s) => !toRemove.has(s.id));
}

/** Nice-to-have: two marching squads of the same owner, heading to the same site, that are
 * entering the exact same tile at nearly the same progress are "effectively co-located" and
 * merge into the lower-id squad. Deterministic, O(n^2) over a small squad count. */
export function mergeSquads(battle) {
  const EPS = 0.02;
  const squads = battle.squads;
  const merged = new Set();
  for (let i = 0; i < squads.length; i++) {
    const a = squads[i];
    if (merged.has(a.id) || a.state !== 'march' || a.seg >= a.path.length) continue;
    for (let j = i + 1; j < squads.length; j++) {
      const b = squads[j];
      if (merged.has(b.id) || b.state !== 'march' || b.seg >= b.path.length) continue;
      if (b.owner !== a.owner || b.to !== a.to) continue;
      if (a.path[a.seg] !== b.path[b.seg]) continue;
      if (Math.abs(a.prog - b.prog) > EPS) continue;
      if ((a.power ?? 1) !== (b.power ?? 1) || (a.speedMult ?? 1) !== (b.speedMult ?? 1) || !!a.noArrows !== !!b.noArrows) continue; // a Charge or Raid squad keeps its own traits
      if (a.champion || b.champion) continue; // a Vendetta's Champion is always its own squad (battle/champion.js)
      a.count += b.count;
      merged.add(b.id);
    }
  }
  if (merged.size) battle.squads = battle.squads.filter((s) => !merged.has(s.id));
}
