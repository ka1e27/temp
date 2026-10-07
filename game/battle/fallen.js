// The Ashen Host in the sim (PLAN-PHASE6 §6B): The Fallen Rise, the Firestorm exception, war-band growth, the Gravewarden's passive,
// the losses log Raise the Fallen reads, and the Barrow Keep's Rising. Pure: no DOM, no Math.random, no Date.now. Every number is in
// config/ashen.js (and config/generals.js for the Gravewarden). Called from inside step() (resolve.js, powers.js, sim.js), so a
// command log replays it exactly; the UI only reads the events.
//
//   battle.fallen = { acc: { [siteId]: { rose, burned } }, burns: [{ x, y, r, until }], losses: [[sec, troops]], rising }
//
// Events: fallenRose { site, count, owner, x, y, kind: 'fallen'|'warBand'|'gravewarden' }, fallenBurned { site, count, x, y },
//         rising { site, at, x, y, radius }, risingCancelled { site, x, y }, and a `send` with `rising: true` for the risen squad.
import { ASHEN } from '../config/ashen.js';
import { PLAYER_OWNER } from './owner.js';
import { tileAt } from './runtime.js';
import { worldDist, hexRadiusToWorld } from './geom.js';
import { routeFor, routeCost } from './routing.js';

const LOSS_WINDOW_MAX = 60; // seconds of the losses log kept (Raise the Fallen reads at most its window, 20-40 s with skills)

export function fallenState(battle) {
  if (!battle.fallen || typeof battle.fallen !== 'object') battle.fallen = { acc: {}, burns: [], losses: [], rising: null };
  return battle.fallen;
}

/** True when the arena's enemy is an 'undying' faction (the Ashen Host): The Fallen Rise is live at its settlements. */
export function isUndying(battle) {
  return !!battle.enemy && battle.enemy.personality === 'undying';
}

function pos(battle, site) {
  const t = tileAt(battle, site.tile);
  return t ? { x: t.x, y: t.y } : { x: 0, y: 0 };
}

/** True while `site` stands in burning ground (a Firestorm landed on it less than ASHEN.fallen.burnSec ago). */
export function isBurning(battle, site, t) {
  const f = battle.fallen;
  if (!f || !f.burns.length) return false;
  const p = tileAt(battle, site.tile);
  if (!p) return false;
  return f.burns.some((b) => t <= b.until + 1e-9 && worldDist(p, b) <= b.r);
}

/** Accumulates fractional risers at a site and emits a whole-number event once ASHEN.fallen.eventMin has gathered. */
function gather(battle, site, key, amount, make) {
  const f = fallenState(battle);
  const acc = f.acc[site.id] || (f.acc[site.id] = { rose: 0, burned: 0 });
  acc[key] += amount;
  if (acc[key] + 1e-9 < ASHEN.fallen.eventMin) return;
  const count = Math.floor(acc[key] + 1e-9);
  acc[key] -= count;
  battle.events.push({ ...make(count), ...pos(battle, site) });
}

/** Records the player's losses (troops) at time `t`, for Raise the Fallen. */
export function noteLoss(battle, t, troops) {
  if (!(troops > 0)) return;
  const f = fallenState(battle);
  const sec = Math.floor(t);
  const last = f.losses[f.losses.length - 1];
  if (last && last[0] === sec) last[1] += troops;
  else f.losses.push([sec, troops]);
  while (f.losses.length && f.losses[0][0] < sec - LOSS_WINDOW_MAX) f.losses.shift();
}

/** Troops the player lost in the last `windowSec` seconds (up to `t`). */
export function recentLosses(battle, t, windowSec) {
  const f = battle.fallen;
  if (!f) return 0;
  let n = 0;
  for (const [sec, troops] of f.losses) if (sec > t - windowSec - 1e-9) n += troops;
  return n;
}

/**
 * One tick of an assault traded at `site` (resolve.js): `atkLoss` troops of the attacking squads and `defLoss` of the garrison died;
 * `fell` is true when the garrison was wiped out this tick (the site changes hands: nobody rises there). `squads` are the assaulting
 * squads still alive. Applies The Fallen Rise (with the Firestorm exception), an undying war band's growth and the Gravewarden's
 * passive, and logs the player's losses.
 */
export function onAssaultTrade(battle, site, attackerOwner, squads, atkLoss, defLoss, fell, t) {
  const foe = battle.arena.enemyFaction;
  if (attackerOwner === PLAYER_OWNER) noteLoss(battle, t, atkLoss);
  else if (site.owner === PLAYER_OWNER) noteLoss(battle, t, defLoss);
  if (fell) return;
  // The Fallen Rise: the player's dead join an undying settlement's garrison, unless Firestorm burns them
  if (attackerOwner === PLAYER_OWNER && site.owner === foe && atkLoss > 0 && isUndying(battle) && !lanternGuards(battle, site)) {
    const risers = atkLoss * ASHEN.fallen.share * ((battle.player.boons && battle.player.boons.fallenMult) || 1); // Gravebreaker halves it (PLAN-PHASE7)
    if (isBurning(battle, site, t)) {
      gather(battle, site, 'burned', risers, (count) => ({ type: 'fallenBurned', site: site.id, count }));
    } else {
      site.troops += risers;
      gather(battle, site, 'rose', risers, (count) => ({ type: 'fallenRose', site: site.id, count, owner: foe, kind: 'fallen' }));
    }
    return;
  }
  // An undying war band grows by a share of the defenders it kills (the risers join the assaulting squads)
  if (attackerOwner === foe && site.owner === PLAYER_OWNER && defLoss > 0 && isUndying(battle) && squads.length) {
    const risers = defLoss * ASHEN.warBandShare;
    squads[0].count += risers / (squads[0].power ?? 1);
    gather(battle, site, 'rose', risers, (count) => ({ type: 'fallenRose', site: site.id, count, owner: foe, kind: 'warBand' }));
    return;
  }
  // The Gravewarden (config/generals.js): a share of the enemy troops killed attacking your settlement joins it
  const reclaim = battle.player && battle.player.reclaim;
  if (reclaim > 0 && attackerOwner !== PLAYER_OWNER && site.owner === PLAYER_OWNER && atkLoss > 0) {
    site.troops += atkLoss * reclaim;
    gather(battle, site, 'rose', atkLoss * reclaim, (count) => ({ type: 'fallenRose', site: site.id, count, owner: PLAYER_OWNER, kind: 'gravewarden' }));
  }
}

/** The Gravewarden's Lantern Relic (PLAN-PHASE7): no Fallen rise at a settlement within lanternRadius hexes of the player's War Camp. */
function lanternGuards(battle, site) {
  const r = battle.player && battle.player.boons && battle.player.boons.lanternRadius;
  if (!(r > 0)) return false;
  const camp = battle.sites.find((s) => s.type === 'camp' && s.owner === PLAYER_OWNER) || battle.sites.find((s) => s.type === 'camp');
  const a = camp ? tileAt(battle, camp.tile) : null;
  const b = tileAt(battle, site.tile);
  return !!a && !!b && worldDist(a, b) <= hexRadiusToWorld(r);
}

/** A squad-against-squad clash tick (resolve.js): logs the player's side of the losses. */
export function onClash(battle, t, a, beforeA, b, beforeB) {
  if (a.owner === PLAYER_OWNER) noteLoss(battle, t, beforeA - a.count);
  if (b.owner === PLAYER_OWNER) noteLoss(battle, t, beforeB - b.count);
}

/**
 * A Firestorm landed (powers.js processPending): its area burns for ASHEN.fallen.burnSec (no dead rise there), and one landing on a
 * Barrow Keep cancels the next Rising. Only the player's Firestorms burn the Ashen dead (a Dragon's breath is the enemy's own).
 */
export function onFirestormLanded(battle, p, t) {
  if (p.owner !== PLAYER_OWNER) return;
  const r = hexRadiusToWorld(p.radius);
  const f = fallenState(battle);
  f.burns = f.burns.filter((b) => b.until >= t);
  f.burns.push({ x: p.x, y: p.y, r, until: t + ASHEN.fallen.burnSec });
  const rs = battle.arena.rising;
  if (!rs) return;
  const keep = battle.sites[rs.site];
  const rising = risingState(battle);
  if (!keep || rising.done || rising.cancelled) return;
  const kp = tileAt(battle, keep.tile);
  if (kp && worldDist(kp, p) <= r) {
    rising.cancelled = true;
    battle.events.push({ type: 'risingCancelled', site: keep.id, ...pos(battle, keep) });
  }
}

/** The Rising's interval: ASHEN.rising.everySec, x risingIntervalMult with the Seal of the Margrave Relic (PLAN-PHASE8). */
export function risingEverySec(battle) {
  const k = battle.player && battle.player.boons && battle.player.boons.risingIntervalMult;
  const q = battle.enemy && battle.enemy.hazardIntervalMult > 0 ? battle.enemy.hazardIntervalMult : 1; // Quickening (PLAN-PHASE13 Ascension 9)
  return ASHEN.rising.everySec * (k > 0 ? k : 1) * q;
}

function risingState(battle) {
  const f = fallenState(battle);
  if (!f.rising) f.rising = { nextAt: risingEverySec(battle), warned: false, cancelled: false, done: false };
  return f.rising;
}

/** The size of a Rising: ASHEN.rising.troopsShare of the keep's starting garrison (stamped by arena.js), at least minTroops. */
export function risingTroops(arenaRising) {
  return Math.max(ASHEN.rising.minTroops, Math.round(ASHEN.rising.troopsShare * (arenaRising.keepTroops || 0)));
}

/**
 * The Barrow Keep's Rising (sim.js step): every ASHEN.rising.everySec the keep's dead rise as a free squad of the keep's owner that
 * marches on the player's nearest site, telegraphed ASHEN.rising.telegraphSec before. Ends for good once the keep changes hands.
 */
export function processRising(battle, t) {
  const rs = battle.arena.rising;
  if (!rs || battle.result) return;
  const keep = battle.sites[rs.site];
  const rising = risingState(battle);
  if (rising.done) return;
  const foe = battle.arena.enemyFaction;
  if (!keep || keep.owner !== foe) { rising.done = true; return; }
  if (!rising.warned && !rising.cancelled && t + 1e-9 >= rising.nextAt - ASHEN.rising.telegraphSec) {
    rising.warned = true;
    battle.events.push({ type: 'rising', site: keep.id, at: rising.nextAt, radius: ASHEN.rising.radius, ...pos(battle, keep) });
  }
  if (t + 1e-9 < rising.nextAt) return;
  const cancelled = rising.cancelled;
  rising.nextAt += risingEverySec(battle);
  rising.warned = false;
  rising.cancelled = false;
  if (cancelled) return;
  let best = null;
  for (const s of battle.sites) {
    if (s.owner !== PLAYER_OWNER) continue;
    const c = routeCost(battle, foe, keep.id, s.id);
    if (Number.isFinite(c) && (!best || c < best.c)) best = { s, c };
  }
  if (!best) return;
  const route = routeFor(battle, foe, keep.id, best.s.id);
  if (!route) return;
  const count = risingTroops(rs);
  const squad = {
    id: battle.nextId++, owner: foe, count, from: keep.id, to: best.s.id, path: route.tiles.slice(),
    seg: 0, prog: 0, state: 'march', foe: null, risen: true,
  };
  battle.squads.push(squad);
  battle.events.push({ type: 'send', owner: foe, from: keep.id, to: best.s.id, count, squad: squad.id, rising: true });
}
