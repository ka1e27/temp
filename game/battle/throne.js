// The Throne of Ages in the sim (PLAN-PHASE13 §13A): the three phases, the borrowing and the Usurper's hero squad. Pure: no DOM, no
// Math.random, no Date.now. Numbers in config/crown.js THRONE; the arena side is throneArena.js. step() calls processThrone (before
// combat) and afterThrone (last, with the Usurper's squad object taken before the step, as champion.js does).
//
//   battle.throne = { phase: 1|2|3, at: { gate, field, fell }, warded, champions, fallen: siteId[],
//                     borrow: { next, n, warned, tideUntil, tideN, plagueUntil },
//                     usurper: { fielded, troops, maxTroops, power, squad, site, fell, hp, maxHp, nextLook } }
//   Phase 1: the Gate (and the Champions' posts that harden it). Phase 2 (the Gate fell): every THRONE.borrow.everySec the Usurper
//   borrows a rival's signature in turn (Rising, Tide, Plague), each telegraphed; the keep is WARDED (it cannot fall below the field mark)
//   until THRONE.wardBorrows have struck. Phase 3 (the keep under 40% under assault once the ward is down, or taken): the Usurper takes the
//   field as a hero squad (sized from the keep's cap and the army you have there); the battle is won when he has fallen and you hold the keep.
// Events: throneChampion { site, kind, name, left, x, y } · thronePhase { phase, x, y } · usurperBorrow { kind, stage, ... } ·
//         usurperField { squad, hp, maxHp, x, y } · usurperHit { hp, maxHp } · usurperFell { x, y, fled? } · tideHit (borrowed: true) ·
//         send (rising: true, borrowed: true)
import { THRONE } from '../config/crown.js';
import { ASHEN } from '../config/ashen.js';
import { PLAYER_OWNER } from './owner.js';
import { tileAt } from './runtime.js';
import { routeFor, routeCost } from './routing.js';
import { isDead } from './combat.js';
import { squadTile } from './sea.js';
import { squadPosition } from './position.js';

const B = THRONE.borrow;
const EPS = 1e-9;

/** The battle's Throne record for an arena that has one (createBattle calls this). */
export function initialThrone(arena) {
  const a = arena.throne;
  const troops = a.usurper.troops;
  return {
    phase: a.gate >= 0 ? 1 : 2,
    at: { gate: a.gate >= 0 ? null : 0, field: null, fell: null }, // battle seconds: the Gate fell, he took the field, he fell (results, tools)
    champions: a.champions.length,
    fallen: [],
    borrow: { next: a.gate >= 0 ? null : B.firstSec, n: 0, warned: false, tideUntil: -1, tideN: 0, plagueUntil: -1 },
    usurper: {
      fielded: false, troops, maxTroops: troops, power: a.usurper.power, squad: null, site: null, fell: false,
      hp: troops * a.usurper.power, maxHp: troops * a.usurper.power, nextLook: 0,
    },
  };
}

function pos(battle, siteId) {
  const s = battle.sites[siteId];
  const t = s ? tileAt(battle, s.tile) : null;
  return t ? { x: t.x, y: t.y } : { x: 0, y: 0 };
}

function interval(battle) {
  const q = battle.enemy && battle.enemy.hazardIntervalMult > 0 ? battle.enemy.hazardIntervalMult : 1; // Quickening (Ascension 9)
  return B.everySec * q;
}

/** The site the Usurper's side acts from: the keep while it holds it, else its site nearest the keep (null when it holds none). */
function homeSite(battle) {
  const foe = battle.arena.enemyFaction;
  const keep = battle.sites[battle.arena.throne.keep];
  if (keep && keep.owner === foe) return keep;
  const kt = keep ? tileAt(battle, keep.tile) : null;
  let best = null;
  for (const s of battle.sites) {
    if (s.owner !== foe) continue;
    const t = tileAt(battle, s.tile);
    const d = kt && t ? Math.hypot(t.x - kt.x, t.y - kt.y) : 0;
    if (!best || d < best.d - EPS) best = { s, d };
  }
  return best ? best.s : null;
}

/** The player's site nearest `from` by the route its owner may march (the keep first when the player holds it). */
function targetFrom(battle, from) {
  const foe = battle.arena.enemyFaction;
  const keep = battle.sites[battle.arena.throne.keep];
  if (keep && keep.owner === PLAYER_OWNER && Number.isFinite(routeCost(battle, foe, from.id, keep.id))) return keep;
  let best = null;
  for (const s of battle.sites) {
    if (s.owner !== PLAYER_OWNER) continue;
    const c = routeCost(battle, foe, from.id, s.id);
    if (Number.isFinite(c) && (!best || c < best.c - EPS)) best = { s, c };
  }
  return best ? best.s : null;
}

function launch(battle, from, to, count, extra) {
  const route = routeFor(battle, battle.arena.enemyFaction, from.id, to.id);
  if (!route || !(count >= 1)) return null;
  const squad = {
    id: battle.nextId++, owner: battle.arena.enemyFaction, count, from: from.id, to: to.id, path: route.tiles.slice(), seg: 0, prog: 0,
    state: 'march', foe: null, ...extra,
  };
  battle.squads.push(squad);
  return squad;
}

// --- Phase 2: the borrowing ------------------------------------------------------------------------------------------------------

function telegraph(battle, kind, at) {
  const keep = battle.arena.throne.keep;
  const ev = { type: 'usurperBorrow', kind, stage: 'telegraph', at, site: keep, ...pos(battle, keep) };
  if (kind === 'rising') ev.radius = ASHEN.rising.radius;
  if (kind === 'tide') ev.tiles = battle.arena.throne.tide.slice();
  if (kind === 'plague') ev.sites = battle.sites.filter((s) => s.owner === PLAYER_OWNER).map((s) => s.id);
  battle.events.push(ev);
}

function strike(battle, kind, t) {
  const th = battle.throne;
  const keep = battle.arena.throne.keep;
  if (kind === 'rising') {
    const from = homeSite(battle);
    const to = from ? targetFrom(battle, from) : null;
    const count = Math.max(B.risingMin, Math.round(B.risingShare * (battle.arena.throne.keepTroops || 0)));
    const squad = from && to ? launch(battle, from, to, count, { risen: true, borrowed: true }) : null;
    battle.events.push({ type: 'usurperBorrow', kind, stage: 'strike', site: from ? from.id : keep, ...pos(battle, from ? from.id : keep) });
    if (squad) battle.events.push({ type: 'send', owner: squad.owner, from: from.id, to: to.id, count, squad: squad.id, rising: true, borrowed: true });
  } else if (kind === 'tide') {
    th.borrow.tideUntil = t + B.tideFloodSec;
    th.borrow.tideN += 1;
    battle.events.push({ type: 'usurperBorrow', kind, stage: 'strike', until: th.borrow.tideUntil, tiles: battle.arena.throne.tide.slice(), site: keep, ...pos(battle, keep) });
  } else {
    th.borrow.plagueUntil = t + B.plagueSec;
    battle.events.push({ type: 'usurperBorrow', kind, stage: 'strike', until: th.borrow.plagueUntil, site: keep, ...pos(battle, keep),
      sites: battle.sites.filter((s) => s.owner === PLAYER_OWNER).map((s) => s.id) });
  }
}

function processTide(battle, t) {
  const b = battle.throne.borrow;
  if (b.tideUntil < 0) return;
  if (t + EPS >= b.tideUntil) {
    b.tideUntil = -1;
    battle.events.push({ type: 'usurperBorrow', kind: 'tide', stage: 'end', site: battle.arena.throne.keep, ...pos(battle, battle.arena.throne.keep) });
    return;
  }
  const flooded = new Set(battle.arena.throne.tide);
  const foe = battle.arena.enemyFaction;
  for (const q of battle.squads) {
    if (q.owner === foe || q.lane || q.state === 'assault' || q.btide === b.tideN) continue;
    const at = squadTile(battle, q);
    if (at == null || !flooded.has(at)) continue;
    const lost = q.count * B.tideLoss;
    q.count -= lost;
    q.btide = b.tideN;
    const p = tileAt(battle, at);
    battle.events.push({ type: 'tideHit', squad: q.id, owner: q.owner, lost: Math.round(lost), x: p ? p.x : 0, y: p ? p.y : 0, borrowed: true });
  }
}

function processBorrow(battle, t) {
  const th = battle.throne;
  const b = th.borrow;
  processTide(battle, t);
  if (b.plagueUntil >= 0 && t + EPS >= b.plagueUntil) {
    b.plagueUntil = -1;
    battle.events.push({ type: 'usurperBorrow', kind: 'plague', stage: 'end', site: battle.arena.throne.keep, ...pos(battle, battle.arena.throne.keep) });
  }
  if (th.usurper.fell || b.next == null) return;
  const kind = B.order[b.n % B.order.length];
  if (!b.warned && t + EPS >= b.next - B.telegraphSec) { b.warned = true; telegraph(battle, kind, b.next); }
  if (t + EPS < b.next) return;
  strike(battle, kind, t);
  b.n += 1;
  b.warned = false;
  b.next += interval(battle);
}

/** Site defence x this for the Throne (resolve.js): the Gate +15% per Champion standing; your sites x0.85 under the borrowed Plague. */
export function throneDefMult(battle, site, t) {
  const th = battle.throne;
  if (!th) return 1;
  if (site.id === battle.arena.throne.gate && site.owner === battle.arena.enemyFaction) return 1 + THRONE.championGateDef * th.champions;
  if (site.owner === PLAYER_OWNER && th.borrow.plagueUntil >= 0 && t < th.borrow.plagueUntil) return B.plagueDefMult;
  return 1;
}

// --- Phases 1 and 3, the Usurper -------------------------------------------------------------------------------------------------

function fall(battle, t, at, fled = false) {
  const u = battle.throne.usurper;
  if (u.fell) return;
  u.fell = true;
  u.fielded = true;
  battle.throne.at.fell = t;
  u.troops = 0;
  u.hp = 0;
  u.squad = null;
  if (u.site != null && battle.sites[u.site]) delete battle.sites[u.site].usurper;
  u.site = null;
  battle.events.push({ type: 'usurperFell', x: at ? at.x : 0, y: at ? at.y : 0, t, ...(fled ? { fled: true } : {}) });
}

function setTroops(battle, troops) {
  const u = battle.throne.usurper;
  const step = u.maxHp / THRONE.hitStep;
  const before = u.hp;
  u.troops = Math.max(0, troops);
  u.hp = u.troops * u.power;
  if (Math.floor(u.hp / step) < Math.floor(before / step)) battle.events.push({ type: 'usurperHit', hp: u.hp, maxHp: u.maxHp });
}

/** The Usurper marches from `from` (his troops leave the site he holds, if he holds one) on the nearest player site. */
function sortie(battle, from, t) {
  const u = battle.throne.usurper;
  const to = targetFrom(battle, from);
  if (!to) { u.nextLook = t + THRONE.retargetSec; return false; }
  const count = u.site === from.id ? Math.min(u.troops, from.troops) : u.troops;
  const squad = launch(battle, from, to, count, { power: u.power, usurper: true });
  if (!squad) { u.nextLook = t + THRONE.retargetSec; return false; }
  if (u.site === from.id) { from.troops = Math.max(0, from.troops - count); delete from.usurper; u.site = null; }
  u.squad = squad.id;
  setTroops(battle, count);
  return squad;
}

function field(battle, t) {
  const th = battle.throne;
  const u = th.usurper;
  th.phase = 3;
  th.at.field = t;
  th.warded = false;
  u.fielded = true;
  // he takes the field at least THRONE.usurperArmyShare x the army you have here now (so a strong army still has a fight on its hands)
  const army = battle.sites.reduce((n, s) => n + (s.owner === PLAYER_OWNER ? s.troops : 0), 0)
    + battle.squads.reduce((n, q) => n + (q.owner === PLAYER_OWNER ? q.count : 0), 0);
  const hpMult = battle.enemy && battle.enemy.throneHpMult > 0 ? battle.enemy.throneHpMult : 1;
  const troops = Math.max(u.maxTroops, THRONE.usurperArmyShare * army * hpMult);
  u.troops = troops;
  u.maxTroops = troops;
  u.hp = troops * u.power;
  u.maxHp = u.hp;
  const keep = battle.arena.throne.keep;
  battle.events.push({ type: 'thronePhase', phase: 3, ...pos(battle, keep) });
  const from = homeSite(battle);
  if (!from) { fall(battle, t, pos(battle, keep), true); return; } // nowhere left to stand: he flees, the Throne is yours
  const squad = sortie(battle, from, t);
  if (!squad) { u.site = from.id; from.usurper = true; } // no way out yet: he holds the keep and looks again
  const p = pos(battle, from.id);
  battle.events.push({ type: 'usurperField', squad: squad ? squad.id : null, hp: u.hp, maxHp: u.maxHp, ...p });
}

/** One tick of the Throne before combat (sim.js step): the Champions, the phases, the borrowing. No-op without a Throne. */
export function processThrone(battle, dt, t) {
  const th = battle.throne;
  if (!th || battle.result) return;
  const a = battle.arena.throne;
  const foe = battle.arena.enemyFaction;
  for (const c of a.champions) {
    if (th.fallen.includes(c.site) || battle.sites[c.site].owner === foe) continue;
    th.fallen.push(c.site);
    th.champions = Math.max(0, th.champions - 1);
    battle.events.push({ type: 'throneChampion', site: c.site, kind: c.kind, name: c.name, left: th.champions, ...pos(battle, c.site) });
  }
  if (th.phase === 1 && battle.sites[a.gate].owner !== foe) {
    th.phase = 2;
    th.at.gate = t;
    th.borrow.next = t + B.firstSec;
    battle.events.push({ type: 'thronePhase', phase: 2, ...pos(battle, a.gate) });
  }
  if (th.phase >= 2) processBorrow(battle, t);
  const keep = battle.sites[a.keep];
  if (th.phase === 2 && !th.usurper.fielded) {
    const ref = Math.min(a.keepTroops || keep.cap, keep.cap);
    // the keep is warded until he has borrowed every rival's weapon (THRONE.wardBorrows strikes): it cannot fall below the field mark
    th.warded = th.borrow.n < THRONE.wardBorrows && keep.owner === foe;
    if (th.warded && keep.troops < THRONE.fieldAt * ref) keep.troops = THRONE.fieldAt * ref;
    const assaulted = keep.owner === foe && keep.assault && keep.assault.owner === PLAYER_OWNER;
    if (keep.owner === PLAYER_OWNER || (!th.warded && assaulted && keep.troops < THRONE.fieldAt * ref + 1e-6)) field(battle, t);
  }
  void dt;
}

/** True while the Usurper stands (the keep alone does not win the Throne). */
export function usurperStands(battle) {
  return !!battle.throne && !battle.throne.usurper.fell;
}

/**
 * The Usurper after the step (sim.js step calls it last, with his squad object from before the step): his health, where he settled,
 * his fall. Returns true when the battle is won now (he fell while the player holds the keep): the caller ends it.
 */
export function afterThrone(battle, t, ref) {
  const th = battle.throne;
  if (!th || battle.result || !th.usurper.fielded || th.usurper.fell) return false;
  const u = th.usurper;
  const foe = battle.arena.enemyFaction;
  if (u.squad != null) {
    const squad = battle.squads.find((s) => s.id === u.squad);
    if (squad) { setTroops(battle, squad.count); return false; }
    u.squad = null;
    const site = ref ? battle.sites[ref.to] : null;
    if (ref && !isDead(ref.count) && site && site.owner === foe) { // he took the site (or reached one of his own): he holds it
      u.site = site.id;
      site.usurper = true;
      setTroops(battle, Math.min(ref.count, site.troops));
      u.nextLook = t; // and marches on at once
    } else {
      let at = null;
      try { at = ref ? squadPosition(battle, ref) : null; } catch { at = null; }
      setTroops(battle, 0);
      fall(battle, t, at);
    }
  } else if (u.site != null) {
    const site = battle.sites[u.site];
    if (!site || site.owner !== foe) { setTroops(battle, 0); fall(battle, t, site ? pos(battle, site.id) : null); } // his site was taken under him
    else if (t + EPS >= u.nextLook) sortie(battle, site, t);
  }
  if (!u.fell) return false;
  const keep = battle.sites[battle.arena.throne.keep];
  return !!keep && keep.owner === PLAYER_OWNER;
}

/** The Usurper's squad object before a step (sim.js keeps it for afterThrone). */
export function usurperSquadRef(battle) {
  const u = battle.throne && battle.throne.usurper;
  if (!u || u.squad == null) return null;
  return battle.squads.find((s) => s.id === u.squad) || null;
}
