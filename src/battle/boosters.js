// The five boosters, and the shared hop-search they use.
//
// Split out of ./commands.js for the line budget; `cmdBooster` still lives there
// because charge accounting and rejection are order-drain concerns. All five
// resolve in the ORDER-DRAIN PHASE, before arrivals — so bombard-then-strike is
// a legal, learnable combo rather than an accident of tick order.
// PURE.
import { BOOSTERS, UNIT_IDS, CENTIGOLD } from '../content/balance.js';
import { TICK_HZ } from '../core/loop.js';
import { emptyComp, scaleComp, total } from './combat.js';
import { siteById } from './state.js';
import { spawnSquad, travelTicks } from './movement.js';
import { applyGold } from './economy.js';

const sec = (s) => Math.round(s * TICK_HZ);

/** a minus b, never below zero. Re-declared here rather than imported from
 *  ./commands.js, which imports THIS file — a cycle would be worse than four
 *  lines. */
function subComp(a, b) {
  const out = emptyComp();
  for (const u of UNIT_IDS) out[u] = Math.max(0, (a[u] || 0) - (b[u] || 0));
  return out;
}

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

export const BOOST = {
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
