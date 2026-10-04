// The Dragon of a Dragon's Lair (DESIGN §10.13): a boss in the sim. Pure and deterministic; its state rides in `battle.dragon`
// (plain JSON, saved with the battle). Numbers: FEATURES.dragon in config/features.js.
//
//   battle.dragon = { hp, maxHp, perch, flight: null | { from, to, landAt }, nextFlyAt, nextBreathAt, breath: null | { at, x, y,
//                     radius, target }, damage, dead }
//   - it perches on an enemy site (that site defends x perchDef while it does) and flies to another every flySec, or at once when
//     its perch falls; a flight takes flightSec, with no perch and no breath
//   - every breathSec it picks the player's strongest point within breathRange of its perch (a site or a squad, by the troops of
//     the player's sites and squads within breathRadius of it), telegraphs it for telegraphSec, then burns breathShare of the troops
//     (+ breathDamage) of every player site and squad in the flames (a Bulwarked site takes bulwarkCut of it)
//   - troops assaulting its perch damage it (resolve.js calls damageDragon with the strength the assault traded); at 0 hp it
//     falls and the region surrenders
// Events: dragonFly { from, to, x1, y1, x2, y2, landAt } · dragonLand { site } · dragonTelegraph { x, y, radius, at, target } ·
//         dragonBreath { x, y, radius, hits } · dragonHit { hp, maxHp } · dragonFall { x, y }
import { FEATURES } from '../config/features.js';
import { PLAYER_OWNER } from './owner.js';
import { tileAt } from './runtime.js';
import { squadPosition } from './position.js';
import { worldDist, hexRadiusToWorld } from './geom.js';

const D = FEATURES.dragon;

/** The battle's starting dragon from the arena's template (`arena.dragon = { hp }`): perched on the keep. */
export function initialDragon(arena) {
  const keep = arena.sites.find((s) => s.type === 'keep' && s.owner !== PLAYER_OWNER) || arena.sites.find((s) => s.owner !== PLAYER_OWNER);
  return {
    hp: arena.dragon.hp, maxHp: arena.dragon.hp, perch: keep ? keep.id : -1, flight: null,
    nextFlyAt: D.flySec, nextBreathAt: D.breathSec * 0.5, breath: null, damage: 0, dead: false,
  };
}

function setPerch(battle, siteId) {
  for (const s of battle.sites) if (s.dragonDef) delete s.dragonDef;
  battle.dragon.perch = siteId;
  if (siteId >= 0 && battle.sites[siteId]) battle.sites[siteId].dragonDef = D.perchDef;
}

/** Where it flies next: the enemy site nearest the player's strongest site (to breathe on it), not where it is. -1 for none. */
function nextPerch(battle, from) {
  const foe = battle.sites.filter((s) => s.owner !== PLAYER_OWNER && s.id !== from);
  if (!foe.length) return -1;
  const mine = battle.sites.filter((s) => s.owner === PLAYER_OWNER);
  const strong = mine.reduce((a, s) => (!a || s.troops > a.troops ? s : a), null);
  if (!strong) return foe[0].id;
  const at = tileAt(battle, strong.tile);
  let best = null;
  for (const s of foe) {
    const d = worldDist(tileAt(battle, s.tile), at);
    if (!best || d < best.d - 1e-9) best = { s, d };
  }
  return best.s.id;
}

function startFlight(battle, t) {
  const dr = battle.dragon;
  const from = dr.perch;
  const to = nextPerch(battle, from);
  if (to < 0) {
    if (from >= 0 && battle.sites[from] && battle.sites[from].owner !== PLAYER_OWNER) { dr.nextFlyAt = t + D.flySec; return; } // it stays
    // nowhere left to perch: the Dragon is driven off, and the region is yours (sim.js / resolve.js end the battle)
    dr.dead = true;
    dr.hp = 0;
    setPerch(battle, -1);
    battle.events.push({ type: 'dragonFall', x: 0, y: 0, t, fled: true });
    return;
  }
  const a = from >= 0 ? tileAt(battle, battle.sites[from].tile) : tileAt(battle, battle.sites[to].tile);
  const b = tileAt(battle, battle.sites[to].tile);
  setPerch(battle, -1);
  dr.flight = { from, to, landAt: t + D.flightSec };
  dr.breath = null;
  battle.events.push({ type: 'dragonFly', from, to, x1: a.x, y1: a.y, x2: b.x, y2: b.y, landAt: dr.flight.landAt });
}

/** The point the breath aims at: the player's site or squad with the most player troops within the flames' radius. */
function breathTarget(battle) {
  const dr = battle.dragon;
  const perch = tileAt(battle, battle.sites[dr.perch].tile);
  const reach = hexRadiusToWorld(D.breathRange);
  const radius = hexRadiusToWorld(D.breathRadius);
  const points = [];
  for (const s of battle.sites) if (s.owner === PLAYER_OWNER) points.push({ p: tileAt(battle, s.tile), troops: s.troops, target: s.id });
  for (const q of battle.squads) if (q.owner === PLAYER_OWNER) points.push({ p: squadPosition(battle, q), troops: q.count, target: null });
  let best = null;
  for (const c of points) {
    if (worldDist(c.p, perch) > reach) continue;
    let sum = 0;
    for (const o of points) if (worldDist(o.p, c.p) <= radius) sum += o.troops;
    if (!best || sum > best.sum + 1e-9) best = { ...c, sum };
  }
  return best;
}

function breathe(battle, t) {
  const dr = battle.dragon;
  const { x, y, radius } = dr.breath;
  const r = hexRadiusToWorld(radius);
  const burn = (n) => n * D.breathShare + D.breathDamage;
  let hits = 0;
  for (const q of battle.squads) {
    if (q.owner !== PLAYER_OWNER) continue;
    if (worldDist(squadPosition(battle, q), { x, y }) <= r) { q.count = Math.max(0, q.count - burn(q.count)); hits += 1; }
  }
  for (const s of battle.sites) {
    if (s.owner !== PLAYER_OWNER) continue;
    if (worldDist(tileAt(battle, s.tile), { x, y }) <= r) {
      s.troops = Math.max(0, s.troops - burn(s.troops) * (t < s.bulwarkUntil ? D.bulwarkCut : 1));
      hits += 1;
    }
  }
  battle.squads = battle.squads.filter((q) => q.count >= 0.5);
  battle.events.push({ type: 'dragonBreath', x, y, radius, hits });
  dr.breath = null;
}

/** Advances the dragon by one step at time `t` (sim.js step, after the delayed effects). No-op without a dragon. */
export function processDragon(battle, t) {
  const dr = battle.dragon;
  if (!dr || dr.dead || battle.result) return;
  if (dr.flight) {
    if (t + 1e-9 < dr.flight.landAt) return;
    const to = dr.flight.to;
    dr.flight = null;
    if (battle.sites[to] && battle.sites[to].owner !== PLAYER_OWNER) {
      setPerch(battle, to);
      dr.nextFlyAt = t + D.flySec;
      dr.nextBreathAt = Math.max(dr.nextBreathAt, t + D.telegraphSec);
      battle.events.push({ type: 'dragonLand', site: to });
    } else {
      dr.perch = -1;
      startFlight(battle, t); // it landed where we now stand: off again
    }
    return;
  }
  if (dr.perch < 0 || !battle.sites[dr.perch] || battle.sites[dr.perch].owner === PLAYER_OWNER) {
    // its perch fell under it: a heavy wound (FEATURES.dragon.perchLoss), then it takes wing
    if (dr.perch >= 0 && battle.sites[dr.perch] && battle.sites[dr.perch].owner === PLAYER_OWNER && damageDragon(battle, dr.maxHp * D.perchLoss, t)) return;
    startFlight(battle, t);
    return;
  }
  if (dr.breath && t + 1e-9 >= dr.breath.at) breathe(battle, t);
  if (!dr.breath && t + 1e-9 >= dr.nextBreathAt) {
    const target = breathTarget(battle);
    dr.nextBreathAt = t + D.breathSec;
    if (target) {
      const tele = D.telegraphSec + ((battle.player && battle.player.boons && battle.player.boons.dragonTelegraphAdd) || 0); // Dragonbane (PLAN-PHASE7)
      dr.breath = { at: t + tele, x: target.p.x, y: target.p.y, radius: D.breathRadius, target: target.target };
      battle.events.push({ type: 'dragonTelegraph', x: target.p.x, y: target.p.y, radius: D.breathRadius, at: dr.breath.at, target: target.target });
    }
  }
  if (!dr.breath && t + 1e-9 >= dr.nextFlyAt) startFlight(battle, t);
}

/**
 * The assault on its perch traded `strength` (troops x atk x def x site defence): it loses that much health. Returns true when it
 * falls (the caller ends the battle and the region surrenders).
 */
export function damageDragon(battle, strength, t) {
  const dr = battle.dragon;
  if (!dr || dr.dead || !(strength > 0)) return false;
  dr.hp = Math.max(0, dr.hp - strength);
  dr.damage += strength;
  if (Math.floor(dr.hp / (dr.maxHp / 20)) !== Math.floor((dr.hp + strength) / (dr.maxHp / 20))) {
    battle.events.push({ type: 'dragonHit', hp: dr.hp, maxHp: dr.maxHp });
  }
  if (dr.hp > 0) return false;
  dr.dead = true;
  const at = dr.perch >= 0 ? tileAt(battle, battle.sites[dr.perch].tile) : { x: 0, y: 0 };
  setPerch(battle, -1);
  battle.events.push({ type: 'dragonFall', x: at.x, y: at.y, t });
  return true;
}
