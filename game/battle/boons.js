// Boons and Relics in the sim (docs/PLAN-PHASE7.md §7A/§7B). The numbers ride in `battle.player.boons` (meta/boonsState.js
// boonSimStats, folded into PlayerStats by playerBattleStats; only non-neutral keys, absent with none), the live state in
// `battle.boonFx` (plain JSON, saved with the battle, created lazily). Called from inside step() (sim, resolve, powers, squads,
// movement, combat), so a command log replays it exactly. Pure: no DOM, no Math.random, no Date.now.
//
//   battle.boonFx = { scorch: [{ x, y, r, until, dps }], sent, secondWind, martyrUntil, martyrDone, recharge, gap: { [key]: t } }
//   squad.burn = { until, dps }      (Fire Arrows: a squad set ablaze)
//
// Event: boonTriggered { boon, x, y, site?, squad?, count?, until?, radius? } where the UI should show something small. `boon` is a
// Boon, Duo or Relic id (config/boons.js, config/relics.js).
import { BOONS } from '../config/boons.js';
import { PLAYER_OWNER } from './owner.js';
import { tileAt } from './runtime.js';
import { squadPosition } from './position.js';
import { worldDist, hexRadiusToWorld } from './geom.js';
import { twistOf } from './features.js';

const NONE = Object.freeze({});
const ROUGH = new Set(['forest', 'pine', 'marsh']);

/** The battle's Boon numbers (an empty object with none). */
export function boonsOf(battle) {
  return (battle && battle.player && battle.player.boons) || NONE;
}

export function boonFx(battle) {
  if (!battle.boonFx || typeof battle.boonFx !== 'object') {
    battle.boonFx = { scorch: [], sent: 0, secondWind: false, martyrUntil: 0, martyrDone: false, recharge: false, gap: {} };
  }
  const fx = battle.boonFx;
  if (!Array.isArray(fx.scorch)) fx.scorch = [];
  if (!fx.gap || typeof fx.gap !== 'object') fx.gap = {};
  return fx;
}

function at(battle, site) {
  const p = site ? tileAt(battle, site.tile) : null;
  return p ? { x: p.x, y: p.y } : { x: 0, y: 0 };
}

/** Pushes a boonTriggered event; `gapKey` throttles a repeating one to once per BOONS.eventGapSec. */
function trigger(battle, t, ev, gapKey = null) {
  if (gapKey) {
    const fx = boonFx(battle);
    if (fx.gap[gapKey] != null && t < fx.gap[gapKey] + BOONS.eventGapSec - 1e-9) return;
    fx.gap[gapKey] = t;
  }
  battle.events.push({ type: 'boonTriggered', ...ev });
}

// --- Squads ------------------------------------------------------------------------------------------------------------------------

/**
 * A squad the player just sent (squads.js sendFromSite; `opts.auto`: a supply line sent it). In order: Vanguard (the battle's first
 * squad), Thunder Charge (the first after a power cast), Supply Wagons and Siege Train (a supply squad), Warlord's Mark (every Nth
 * doubled). Returns the extra troops added.
 */
export function onPlayerSend(battle, squad, opts = null) {
  const b = boonsOf(battle);
  if (b === NONE || squad.owner !== PLAYER_OWNER) return 0;
  const fx = boonFx(battle);
  const before = squad.count;
  const pop = (boon, extra) => trigger(battle, battle.t, { boon, squad: squad.id, count: Math.round(extra), site: squad.from, ...at(battle, battle.sites[squad.from]) });
  if (b.vanguardMult > 1 && !fx.vanguard) {
    fx.vanguard = true;
    const extra = squad.count * (b.vanguardMult - 1);
    squad.count += extra;
    pop('vanguard', extra);
  }
  if (b.drumVanguardMult > 1 && fx.drumCharge) {
    fx.drumCharge = false;
    const extra = squad.count * (b.drumVanguardMult - 1);
    squad.count += extra;
    pop('thunderCharge', extra);
  }
  if (opts && opts.auto) {
    if (b.supplyBonus > 0) {
      const extra = squad.count * b.supplyBonus;
      squad.count += extra;
      trigger(battle, battle.t, { boon: 'supplyWagons', squad: squad.id, count: Math.round(extra), site: squad.from, ...at(battle, battle.sites[squad.from]) }, `sw${squad.from}`);
    }
    if (b.supplyNoArrows) squad.noArrows = true; // Siege Train: the raid skill's flag (combat.js resolveTowerVolleys skips it)
  }
  const n = b.warlordEvery;
  if (n > 0) {
    fx.sent += 1;
    if (fx.sent % n === 0) {
      const extra = squad.count;
      squad.count += extra;
      pop('warlordsMark', extra);
    }
  }
  return squad.count - before;
}

/** War Drums and Thunder Charge (powers.js applyPower, after a cast took effect). */
export function onPowerCast(battle, owner, t) {
  const b = boonsOf(battle);
  if (b === NONE || owner !== PLAYER_OWNER) return;
  if (b.drumVanguardMult > 1) boonFx(battle).drumCharge = true;
  if (b.drumsSec > 0 && b.drumsMult > 1) {
    battle.effects.drumsUntil = t + b.drumsSec;
    const camp = battle.sites.find((s) => s.type === 'camp' && s.owner === PLAYER_OWNER);
    trigger(battle, t, { boon: 'warDrums', until: battle.effects.drumsUntil, ...at(battle, camp) });
  }
}

/** A player squad's strength multiplier from Boons in a fight: Phalanx (a big squad), Ambushers (a clash on a road), Martyr's Crown. */
export function squadStrengthMult(battle, squad, t, clash) {
  const b = boonsOf(battle);
  if (b === NONE || squad.owner !== PLAYER_OWNER) return 1;
  let k = 1;
  if (b.phalanxMin > 0 && squad.count >= b.phalanxMin) k /= b.phalanxDmgMult;
  if (clash && b.roadStrengthMult > 1 && onRoad(battle, squad)) k *= b.roadStrengthMult;
  if (b.martyrAtkMult > 1 && t < boonFx(battle).martyrUntil) k *= b.martyrAtkMult;
  return k;
}

/** The player's assaulting troops' strength multiplier (Phalanx when the assault is big; Martyr's Crown). */
export function assaultStrengthMult(battle, owner, troops, t) {
  const b = boonsOf(battle);
  if (b === NONE || owner !== PLAYER_OWNER) return 1;
  let k = 1;
  if (b.phalanxMin > 0 && troops >= b.phalanxMin) k /= b.phalanxDmgMult;
  if (b.martyrAtkMult > 1 && t < boonFx(battle).martyrUntil) k *= b.martyrAtkMult;
  return k;
}

/** A road tile costs less than open ground (world/generate.js: roads replace the base cost with ROAD_COST). */
function onRoad(battle, squad) {
  const idx = squad.path[Math.min(squad.seg, squad.path.length - 1)];
  const tile = idx != null ? tileAt(battle, idx) : null;
  return !!tile && tile.cost < 1;
}

/** Pathfinder (movement.js): the cost a player squad pays to cross `tile`. */
export function moveCost(battle, squad, tile) {
  if (squad.owner !== PLAYER_OWNER) return tile.cost;
  const b = boonsOf(battle);
  if (b.pathfinder && ROUGH.has(tile.terrain)) return Math.min(tile.cost, 1);
  if (tile.ford && b.fordCostMult > 0 && b.fordCostMult !== 1) return tile.cost * b.fordCostMult; // Navigator (PLAN-PHASE12): fords x1.5, not x2.5
  if (tile.sea && b.laneCostMult > 0 && b.laneCostMult !== 1) return tile.cost * b.laneCostMult; // the Astrolabe (PLAN-PHASE12): lanes x0.4, not x0.6
  return tile.cost;
}

/** Hit and Run (movement.js): the player's march multiplier right now. */
export function marchBoonMult(battle, squad, t) {
  if (squad.owner !== PLAYER_OWNER) return 1;
  const b = boonsOf(battle);
  const fx = battle.effects || {};
  const hit = b.hitRunMult > 1 && t < (fx.hitRunUntil || 0) ? b.hitRunMult : 1;
  const drums = b.drumsMult > 1 && t < (fx.drumsUntil || 0) ? b.drumsMult : 1; // War Drums (PLAN-PHASE8)
  // Harbour Chain (PLAN-PHASE12): +10% a port held, up to +30%; the Admiral's laneFast skill (PlayerStats.laneSpeedMult)
  const chain = squad.lane ? (b.laneSpeedMult > 1 ? b.laneSpeedMult : 1) * (battle.player && battle.player.laneSpeedMult > 1 ? battle.player.laneSpeedMult : 1) : 1;
  return hit * drums * chain;
}

// --- Towers ------------------------------------------------------------------------------------------------------------------------

/** Engineers: a tower the player holds looses arrows at this x its interval. */
export function towerIntervalMult(battle, site) {
  const b = boonsOf(battle);
  return site.owner === PLAYER_OWNER && b.towerRateMult ? b.towerRateMult : 1;
}

/** Night Raiders: in a Night battle an enemy tower does not shoot the player's squads. */
export function towerIgnores(battle, site, squad) {
  if (squad.owner !== PLAYER_OWNER || site.owner === PLAYER_OWNER) return false;
  if (squad.lane && battle.player && battle.player.laneShield) return true; // the Admiral's passive (PLAN-PHASE12): lane squads take no tower fire
  return !!boonsOf(battle).nightRaiders && twistOf(battle) === 'night';
}

/**
 * Tower Sappers (combat.js resolveTowerVolleys): an enemy tower within sapperHexes of a site the player holds shoots sapperRangeMult as
 * far. The first time a tower is sapped in a battle, a boonTriggered pops on it. Returns the range multiplier.
 */
export function towerRangeBoonMult(battle, site, t) {
  const b = boonsOf(battle);
  if (!(b.sapperHexes > 0) || site.type !== 'tower' || site.owner === PLAYER_OWNER) return 1;
  const p = tileAt(battle, site.tile);
  if (!p) return 1;
  const reach = hexRadiusToWorld(b.sapperHexes);
  let near = false;
  for (const s of battle.sites) {
    if (s.owner !== PLAYER_OWNER) continue;
    const q = tileAt(battle, s.tile);
    if (q && worldDist(p, q) <= reach) { near = true; break; }
  }
  if (!near) return 1;
  const fx = boonFx(battle);
  if (!fx.sapped) fx.sapped = {};
  if (!fx.sapped[site.id]) { fx.sapped[site.id] = true; trigger(battle, t, { boon: 'towerSappers', site: site.id, x: p.x, y: p.y }); }
  return b.sapperRangeMult;
}

/**
 * A garrison's defence multiplier from Boons (resolve.js, per assault step): Last Stand, the player's keep in a defense below
 * lastStandShare of its cap (a boonTriggered the first time it holds the line).
 */
export function garrisonBoonMult(battle, site, t) {
  const b = boonsOf(battle);
  if (!(b.lastStandShare > 0) || battle.mode !== 'defense' || site.owner !== PLAYER_OWNER) return 1;
  if (site.id !== battle.arena.keepSite || !(site.troops < b.lastStandShare * site.cap)) return 1;
  const fx = boonFx(battle);
  if (!fx.lastStand) { fx.lastStand = true; trigger(battle, t, { boon: 'lastStand', site: site.id, ...at(battle, site) }); }
  return b.lastStandDefMult;
}

/** Tower arrows: Phalanx cuts the kills on a big player squad; Fire Arrows sets an enemy squad hit by a player tower ablaze. */
export function onArrow(battle, site, squad, kills, t) {
  const b = boonsOf(battle);
  if (b === NONE) return kills;
  if (squad.owner === PLAYER_OWNER && b.phalanxMin > 0 && squad.count >= b.phalanxMin) return kills * b.phalanxDmgMult;
  if (site.owner === PLAYER_OWNER && squad.owner !== PLAYER_OWNER && b.fireArrowsDps > 0) {
    squad.burn = { until: t + b.fireArrowsSec, dps: b.fireArrowsDps };
    trigger(battle, t, { boon: 'fireArrows', site: site.id, squad: squad.id, ...at(battle, site) }, `fa${site.id}`);
  }
  return kills;
}

// --- Captures, Firestorm, the last stand ------------------------------------------------------------------------------------------

/**
 * A site changed hands (resolve.js, after the capture is applied). For a player capture: Turncoats (and Ghost Legion against the Ashen)
 * keep a share of the defenders lost in the assault (`defLost`), Hit and Run, Lightning War, Blood Price's bleed, Plunderers' pop.
 */
export function onCapture(battle, site, defLost, t) {
  const b = boonsOf(battle);
  if (b === NONE || site.owner !== PLAYER_OWNER) return;
  const pos = at(battle, site);
  const share = b.ghostShare > 0 && battle.enemy && battle.enemy.personality === 'undying' ? Math.max(b.ghostShare, b.turncoatShare || 0) : b.turncoatShare || 0;
  if (share > 0 && defLost > 0) {
    const count = defLost * share;
    site.troops += count;
    trigger(battle, t, { boon: b.ghostShare > 0 && share === b.ghostShare ? 'ghostLegion' : 'turncoats', site: site.id, count: Math.round(count), ...pos });
  }
  if (b.hitRunSec > 0) {
    battle.effects.hitRunUntil = t + b.hitRunSec;
    trigger(battle, t, { boon: 'hitAndRun', site: site.id, until: battle.effects.hitRunUntil, ...pos });
  }
  if (b.lightningWarSec > 0 && battle.cooldowns && battle.cooldowns.march > t) {
    battle.cooldowns.march = Math.max(t, battle.cooldowns.march - b.lightningWarSec);
    trigger(battle, t, { boon: 'lightningWar', site: site.id, ...pos });
  }
  if (b.captureBleed > 0) {
    let lost = 0;
    for (const s of battle.sites) {
      if (s.owner !== PLAYER_OWNER || s.id === site.id) continue;
      const take = s.troops * b.captureBleed;
      s.troops -= take;
      lost += take;
    }
    if (lost >= 1) trigger(battle, t, { boon: 'bloodPrice', site: site.id, count: Math.round(lost), ...pos });
  }
  if (b.plunder) trigger(battle, t, { boon: 'plunderers', site: site.id, ...pos });
}

/**
 * Second Wind (resolve.js): the first time one of the player's settlements would fall in a battle, it holds with fresh troops instead.
 * Returns true when it held (the caller keeps the site and the assault goes on).
 */
export function secondWind(battle, site, t) {
  const b = boonsOf(battle);
  if (!(b.secondWindTroops > 0) || site.owner !== PLAYER_OWNER || site.type === 'camp') return false;
  const fx = boonFx(battle);
  if (fx.secondWind) return false;
  fx.secondWind = true;
  const gain = Math.max(b.secondWindTroops, (b.secondWindCampShare || 0) * (battle.player.campTroops || 0));
  site.troops = 1 + gain;
  trigger(battle, t, { boon: 'secondWind', site: site.id, count: Math.round(gain), ...at(battle, site) });
  return true;
}

/** Scorched Earth (powers.js processPending): the player's Firestorm leaves burning ground. */
export function onFirestorm(battle, p, t) {
  const b = boonsOf(battle);
  if (p.owner !== PLAYER_OWNER || !(b.scorchSec > 0)) return;
  const fx = boonFx(battle);
  const r = hexRadiusToWorld(p.radius);
  fx.scorch = fx.scorch.filter((z) => z.until > t);
  fx.scorch.push({ x: p.x, y: p.y, r, until: t + b.scorchSec, dps: b.scorchDps });
  trigger(battle, t, { boon: 'scorchedEarth', x: p.x, y: p.y, radius: p.radius, until: t + b.scorchSec });
}

/** Firestorm's damage multiplier (the Ember Heart Relic). */
export function firestormBoonMult(battle) {
  return boonsOf(battle).firestormMult || 1;
}

/** A power's cooldown multiplier from Relics (the Horn of Ages: Rally). */
export function powerCooldownBoonMult(battle, power) {
  const b = boonsOf(battle);
  return power === 'rally' && b.rallyCdMult ? b.rallyCdMult : 1;
}

/** Iron Rations (resolve.js applyGrowth): the growth multiplier of a player site under an enemy assault (0 = the default rule). */
export function besiegedGrowthMult(battle, site) {
  if (site.owner !== PLAYER_OWNER || !site.assault || site.assault.owner === PLAYER_OWNER) return 0;
  const m = boonsOf(battle).besiegedGrowthMult;
  return m > 1 ? m : 0;
}

// --- Abilities ---------------------------------------------------------------------------------------------------------------------

/** Banner Bearer (abilities.js): one extra use, ready abilityRechargeSec after the last use once every normal use is spent. */
export function abilityExtraUses(battle, baseUses, used) {
  const sec = boonsOf(battle).abilityRechargeSec;
  if (!(sec > 0)) return 0;
  if (used > baseUses) return 1;
  return used === baseUses && Number.isFinite(battle.abilityAt) && battle.t + 1e-9 >= battle.abilityAt + sec ? 1 : 0;
}

// --- Per step ----------------------------------------------------------------------------------------------------------------------

/**
 * One step of the lasting Boon effects (sim.js step, after combat): the scorched ground burns enemy squads, Fire Arrows burn, Martyr's
 * Crown rises when the War Camp falls, Banner Bearer announces the recharge. No-op without Boons.
 */
export function processBoons(battle, dt, t) {
  const b = boonsOf(battle);
  if (b === NONE || battle.result) return;
  const fx = boonFx(battle);
  if (fx.scorch.length) {
    fx.scorch = fx.scorch.filter((z) => z.until + 1e-9 >= t);
    for (const q of battle.squads) {
      if (q.owner === PLAYER_OWNER) continue;
      const p = squadPosition(battle, q);
      for (const z of fx.scorch) if (worldDist(p, z) <= z.r) q.count = Math.max(0, q.count - z.dps * dt);
    }
  }
  for (const q of battle.squads) {
    if (!q.burn) continue;
    if (t > q.burn.until) { delete q.burn; continue; }
    q.count = Math.max(0, q.count - q.burn.dps * dt);
  }
  if (fx.scorch.length || battle.squads.some((q) => q.count < 0.5)) battle.squads = battle.squads.filter((q) => q.count >= 0.5);
  if (b.martyrSurge > 0 && !fx.martyrDone) {
    const camp = battle.sites.find((s) => s.type === 'camp');
    if (camp && camp.owner !== PLAYER_OWNER) {
      fx.martyrDone = true;
      fx.martyrUntil = t + (b.martyrSec || 0);
      const ids = [];
      for (const s of battle.sites) if (s.owner === PLAYER_OWNER) { s.troops += s.troops * b.martyrSurge; ids.push(s.id); }
      trigger(battle, t, { boon: 'martyrsCrown', site: camp.id, sites: ids, until: fx.martyrUntil, ...at(battle, camp) });
    }
  }
  if (b.abilityRechargeSec > 0 && !fx.recharge && battle.player.ability) {
    const uses = Number.isInteger(battle.player.ability.uses) && battle.player.ability.uses > 1 ? battle.player.ability.uses : 1;
    const used = Number.isInteger(battle.abilityCount) ? battle.abilityCount : battle.abilityUsed ? 1 : 0;
    if (abilityExtraUses(battle, uses, used) > 0 && used === uses) {
      fx.recharge = true;
      const camp = battle.sites.find((s) => s.type === 'camp' && s.owner === PLAYER_OWNER);
      trigger(battle, t, { boon: 'bannerBearer', ...at(battle, camp) });
    }
  }
}

/**
 * The Sundial Relic: while the battle is paused (or during the flight into it) the power cooldowns keep ticking. The manager calls
 * this with the paused wall seconds (scaled like a step would be); a no-op without the Relic. Returns true when it applied.
 */
export function pausedCooldownTick(battle, dt) {
  if (!boonsOf(battle).sundial || battle.result || !(dt > 0) || !battle.cooldowns) return false;
  for (const k of Object.keys(battle.cooldowns)) {
    if (battle.cooldowns[k] > battle.t) battle.cooldowns[k] = Math.max(battle.t, battle.cooldowns[k] - dt);
  }
  return true;
}
