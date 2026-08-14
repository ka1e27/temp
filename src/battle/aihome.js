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
//    STANDING within a couple of hexes, pulls reinforcement in from anywhere in
//    its territory (not just next door), and abandons a siege of its own when
//    nothing closer can arrive in time.
// PURE.
import { AI } from '../content/balance.js';
import { distance } from '../core/hex.js';
import { asHex } from './influence.js';
import { power, total, addComp, emptyComp } from './combat.js';
import { siteById } from './state.js';
import { squadHexOf } from './movement.js';
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
 * Hex distance from `site` to every other, capped at `maxHexes`.
 *
 * This used to be a BFS over the site graph that also returned PARENT POINTERS,
 * so a reliever could be handed the chain of owned sites it had to hop along —
 * the only genuinely graph-shaped thing the AI ever did. Free movement retired
 * both halves at once: there is no graph to walk, and a relief force marches
 * straight home because nothing stops it but a base in the way, which the
 * pathfinder already routes around.
 */
function reach(state, site, maxHexes) {
  const out = {};
  const from = asHex(site.hex);
  for (const s of state.sites) {
    const d = distance(from, asHex(s.hex));
    if (d <= maxHexes) out[s.id] = d;
  }
  return out;
}

/**
 * Everything the player has aimed at this site: what is already committed
 * (siege + inbound squads) plus what is merely STANDING within
 * `AI.homeRadiusHexes` of it. The second half is the whole point — a stack
 * parked next door has not "threatened" anything yet, and waiting for it to
 * move is waiting until it is too late.
 */
export function encroachment(state, site) {
  let comp = threatOn(state, site);
  const hop = reach(state, site, AI.homeRadiusHexes);
  for (const s of state.sites) {
    if (s.owner !== FOE || s.id === site.id) continue;
    if (hop[s.id] === undefined) continue;
    comp = addComp(comp, s.garrison);
  }
  // A CAMPED ARMY IS A STACK PARKED NEXT DOOR, and it was the one form of that
  // this function could not see. It summed SITE garrisons only, so a column
  // holding open ground contributed nothing — measured, an army of 300 camped ONE
  // HEX from the throne scored `encroachment` 0, while the identical 300 in
  // transit to the throne scored 300. That is the docstring above failing on its
  // own terms: camping is precisely how you park a stack next door without
  // "threatening" anything, so `homeGuard` and `defend` never pre-positioned and
  // the player could stage their whole force on the doorstep unnoticed, then take
  // the castle inside a single one-hex hop — well under `threatHorizonTicks`.
  //
  // Measured by hex rather than through `reach`, because `reach` is a map over
  // SITE ids and a camped column is on ground that has no site on it.
  const at = asHex(site.hex);
  for (const sq of state.squads) {
    if (sq.owner !== FOE || !sq.camped || sq.retreating) continue;
    const where = squadHexOf(state, sq);
    if (!where || distance(where, at) > AI.homeRadiusHexes) continue;
    comp = addComp(comp, sq.comp);
  }
  return comp;
}

/** Sites that can spare troops for home, nearest first, over owned ground. */
function relievers(state, home, busy) {
  const hop = reach(state, home, Infinity);
  const out = [];
  for (const s of state.sites) {
    if (s.owner !== ME || s.id === home.id || busy.has(s.id)) continue;
    if (hop[s.id] === undefined) continue;
    // A site holding off its own attack keeps what it has: stripping the gate
    // to garrison the keep just loses both.
    if (total(threatOn(state, s)) > 0) continue;
    const src = sourceFrom(state, s, 1);
    if (!src) continue;
    out.push({ ...src, hops: hop[s.id] });
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
