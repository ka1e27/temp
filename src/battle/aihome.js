// Two things the enemy commander used to be free of, and both were exploits.
//
// 1. SURPLUS. Its knobs capped how much of a garrison it would ever move, so
//    once its interior stopped bordering anything it banked an army it could
//    physically never spend — measured on kaldan, more than HALF of everything
//    it owned was standing two or more hops behind its own front line. A player
//    only ever met the thin skin of it. `pressure()` measures how much army the
//    AI holds beyond what it needs to keep what it holds, and opens the commit
//    and staging ratios toward full commitment with it.
//
// 2. HOME. `defend()` reacts to squads already in the air inside a six-second
//    horizon. That is far too late for the castle, which is the whole win
//    condition: a player could mass on the doorstep unopposed and the AI would
//    spend the build-up grabbing another farm. `homeGuard()` reads the army
//    STANDING within a couple of hops, pulls reinforcement down chained sends
//    from anywhere in its territory (not just next door), and abandons a siege
//    of its own when nothing closer can arrive in time.
// PURE.
import { AI } from '../content/balance.js';
import { power, total, addComp, emptyComp } from './combat.js';
import { siteById } from './state.js';
import {
  ME, FOE, byId, floorFor, defenceOf, sourceFrom, threatOn,
} from './aicore.js';

/** The AI's seat of government, or null once it has been taken. */
export const homeOf = (state) =>
  state.sites.find((s) => s.owner === ME && s.kind === 'castle') ?? null;

// --- surplus ---------------------------------------------------------------

/** Bodies the AI must keep where they stand to hold what it already holds. */
function reserveTroops(state) {
  let n = 0;
  for (const s of state.sites) {
    if (s.owner !== ME) continue;
    n += Math.max(floorFor(s), total(threatOn(state, s)) * AI.defendMargin);
  }
  return n;
}

/**
 * How much army the AI has going spare, 0..1. 0 when every body it owns is
 * needed where it stands; 1 once it is sitting on `AI.surplusFullAt` times its
 * own reserve on top of that.
 *
 * Garrisons only — troops already in a squad or a siege are spent, and counting
 * them would make a committed attack read as a reason to commit harder.
 */
export function pressure(state) {
  let army = 0;
  for (const s of state.sites) if (s.owner === ME) army += total(s.garrison);
  const reserve = reserveTroops(state);
  if (army <= reserve) return 0;
  return Math.min(1, (army - reserve) / Math.max(1, reserve * AI.surplusFullAt));
}

/** A ratio opened toward full commitment by whatever army is going spare. */
const press = (base, p) => Math.min(1, base + (1 - base) * p * AI.surplusPress);

/** What share of a garrison the AI will put into an attack. */
export const commitFor = (knobs, p) => press(knobs.commitRatio, p);

/** ...and into moving its rear army up. 0 keeps a tier out of staging entirely. */
export const stagingFor = (knobs, p) =>
  (knobs.stagingRatio > 0 ? press(knobs.stagingRatio, p) : 0);

/** Simultaneous attacks. An army with nothing to do opens a second front. */
export const concurrentFor = (knobs, p) =>
  knobs.concurrent + (p >= AI.surplusConcurrentAt ? AI.surplusConcurrent : 0);

// --- home defence ----------------------------------------------------------

/**
 * BFS out from `site` over the site graph, recording hops and the step back
 * toward it. `ownedOnly` restricts the walk to ground the AI holds, which is
 * what makes the returned route legal for a chained SEND.
 */
function reach(state, site, maxHops, ownedOnly) {
  const hop = { [site.id]: 0 };
  const back = {};
  const queue = [site];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    if (hop[cur.id] >= maxHops) continue;
    for (const id of [...cur.adj].sort()) {
      if (hop[id] !== undefined) continue;
      const next = siteById(state, id);
      if (!next) continue;
      if (ownedOnly && next.owner !== ME) continue;
      hop[id] = hop[cur.id] + 1;
      back[id] = cur.id;
      queue.push(next);
    }
  }
  return { hop, back };
}

/**
 * Everything the player has aimed at this site: what is already committed
 * (siege + inbound squads) plus what is merely STANDING within
 * `AI.homeRadius` hops of it. The second half is the whole point — a stack
 * parked next door has not "threatened" anything yet, and waiting for it to
 * move is waiting until it is too late.
 */
export function encroachment(state, site) {
  let comp = threatOn(state, site);
  const { hop } = reach(state, site, AI.homeRadius, false);
  for (const s of state.sites) {
    if (s.owner !== FOE || s.id === site.id) continue;
    if (hop[s.id] === undefined) continue;
    comp = addComp(comp, s.garrison);
  }
  return comp;
}

/** Sites that can spare troops for home, nearest first, over owned ground. */
function relievers(state, home, busy) {
  const { hop, back } = reach(state, home, state.sites.length, true);
  const out = [];
  for (const s of state.sites) {
    if (s.owner !== ME || s.id === home.id || busy.has(s.id)) continue;
    if (hop[s.id] === undefined) continue;
    // A site holding off its own attack keeps what it has: stripping the gate
    // to garrison the keep just loses both.
    if (total(threatOn(state, s)) > 0) continue;
    const src = sourceFrom(state, s, 1);
    if (!src) continue;
    const via = [];
    for (let id = back[s.id]; id && id !== home.id; id = back[id]) via.push(id);
    out.push({ ...src, hops: hop[s.id], via });
  }
  return out.sort((a, b) => a.hops - b.hops || byId(a.site, b.site));
}

/** Abandon a siege elsewhere and march home. The same RETREAT the player has. */
function recall(state, out, busy) {
  let called = 0;
  for (const site of [...state.sites].sort(byId)) {
    if (site.siege?.owner !== ME || total(site.siege.comp) === 0) continue;
    if (busy.has(site.id)) continue;
    out.push({ t: 'RETREAT', by: ME, site: site.id });
    busy.add(site.id);
    called++;
  }
  return called;
}

/**
 * Phase 0. Holding the castle outranks taking another farm, so this runs before
 * every other phase and takes its sources off the board for the tick.
 * @returns {boolean} true when the castle needed help — `defend()` then leaves
 *   it alone rather than pulling a second, double-counted wave.
 */
export function homeGuard(state, out, busy) {
  const home = homeOf(state);
  if (!home) return false;
  const threat = encroachment(state, home);
  if (total(threat) === 0) return false;

  const need = power(threat, home.garrison,
    { statMult: state.mods[FOE]?.unitAtkMult ?? 1, unitMult: state.mods[FOE]?.unitMult })
    * AI.homeGuardMargin;
  if (defenceOf(state, home, threat) >= need) return true;

  // Nearest first, stopping the moment the gap is closed — so a build-up next
  // door pulls in one neighbour, and a whole army on the doorstep pulls in the
  // countryside.
  let held = emptyComp();
  for (const src of relievers(state, home, busy)) {
    held = addComp(held, src.avail);
    const cmd = {
      t: 'SEND', by: ME, from: src.site.id, to: home.id, fraction: src.availFrac,
    };
    if (src.via.length) cmd.via = src.via.reverse();
    out.push(cmd);
    busy.add(src.site.id);
    if (defenceOf(state, { ...home, garrison: addComp(home.garrison, held) }, threat) >= need) break;
  }

  // Still short after emptying the countryside: the army that is going to save
  // the castle is the one currently camped outside somebody else's wall.
  const bolstered = { ...home, garrison: addComp(home.garrison, held) };
  if (defenceOf(state, bolstered, threat) < need * AI.homeRecallRatio) recall(state, out, busy);
  return true;
}
