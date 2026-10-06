// Combat math: troop strength, progressive fight resolution, tower volleys and squad
// interception/engagement. Pure: no DOM, no Math.random, no Date.now. See docs/DESIGN.md
// §4.4 and docs/ARCHITECTURE.md §6.
import { BATTLE, SITE_TYPES, POWERS, CAMP_VOLLEY } from '../config/battle.js';
import { worldDist, hexRadiusToWorld } from './geom.js';
import { squadPosition } from './position.js';
import { PLAYER_OWNER, FREE_FOLK_OWNER } from './owner.js';
import { towerRangeMult } from './features.js';
import { towerIntervalMult, towerIgnores, onArrow, towerRangeBoonMult } from './boons.js';

export { PLAYER_OWNER, FREE_FOLK_OWNER };

/** Baseline stats for Free Folk hamlets that appear as neutrals inside a rival's region. */
const FREE_FOLK_BASE = Object.freeze({ atk: 1, def: 1, growth: 1, speed: 1 });

/** Troops below this count are considered dead / removed from play (DESIGN/ARCHITECTURE). */
export const DEATH_THRESHOLD = 0.5;

/**
 * Resolves the {atk, def, growth, speed} stat block for whichever owner controls a site or
 * squad. `enemy` is the arena's single rival EnemyStats; Free Folk get their own baseline
 * only when they are NOT the arena's primary enemy (i.e. neutral hamlets inside a rival's
 * region) — when the arena's target faction IS the Free Folk, `enemy` already models them.
 */
export function ownerStats(owner, player, enemyFaction, enemy) {
  if (owner === PLAYER_OWNER) return player;
  if (owner === enemyFaction) return enemy;
  if (owner === FREE_FOLK_OWNER) {
    return { ...FREE_FOLK_BASE, growth: FREE_FOLK_BASE.growth * BATTLE.freeFolkGrowthMult };
  }
  // Unknown/unmodeled owner: treat as a neutral so the sim never throws mid-battle.
  return FREE_FOLK_BASE;
}

/**
 * Effective troop cap for a site: type base, plus the player's cap bonus while they own it; any other owner
 * gets the base times the site's own `capMult` (depth, capital and Free Folk scaling stamped by buildArena).
 * `playerCapMult` scales the player's cap on a site that carries one (a defended region's militia sites, DESIGN §10.4,
 * stamped `pCapMult` by buildDefenseArena); attack arenas never stamp it, so it is 1 there.
 */
export function effectiveCap(type, owner, player, capMult = 1, playerCapMult = 1) {
  const base = SITE_TYPES[type].cap;
  return owner === PLAYER_OWNER ? (base + player.capBonus) * playerCapMult : base * capMult;
}

/** Effective troops/sec growth for a site: type base × current owner's growth stat. */
export function effectiveGrowth(type, owner, player, enemyFaction, enemy) {
  const base = SITE_TYPES[type].growth;
  // Barracks next door (Region Works, DESIGN §5.8): the player's War Camp grows faster
  const camp = type === 'camp' && owner === PLAYER_OWNER ? (player.campGrowthMult ?? 1) : 1;
  return base * camp * ownerStats(owner, player, enemyFaction, enemy).growth;
}

/**
 * Per-troop strength for a squad on the march or assaulting (no site multiplier). `field` is true for a squad-against-squad clash
 * in the open: the player's squads then also carry `player.fieldStrengthMult` (Stables next door, DESIGN §5.8: a cavalry charge).
 */
export function squadPerTroopStrength(owner, player, enemyFaction, enemy, field = false) {
  const s = ownerStats(owner, player, enemyFaction, enemy);
  const charge = field && owner === PLAYER_OWNER ? (player.fieldStrengthMult ?? 1) : 1;
  // a commander's passive (DESIGN §10.11, the Champion): the player's squads hit harder when they assault a settlement
  const assault = !field && owner === PLAYER_OWNER ? (player.assaultMult ?? 1) : 1;
  return s.atk * s.def * charge * assault;
}

/** A site's own defence multiplier: type defence x its Walls (a fortification, DESIGN §10.3: `site.defMult`, default 1). */
export function siteDefence(site) {
  return SITE_TYPES[site.type].def * (site.defMult ?? 1) * (site.dragonDef ?? 1); // a Dragon perched on it guards it (DESIGN §10.13)
}

/** Per-troop strength for a garrison sitting in a site (site defence × Walls × Bulwark included). */
export function garrisonPerTroopStrength(site, owner, player, enemyFaction, enemy, t) {
  const s = ownerStats(owner, player, enemyFaction, enemy);
  const bulwark = t < site.bulwarkUntil ? POWERS.bulwark.mult : 1;
  // a commander's passive (DESIGN §10.11, the Marshal): the player's garrisons defend harder
  const held = owner === PLAYER_OWNER ? (player.garrisonMult ?? 1) : 1;
  return s.atk * s.def * siteDefence(site) * bulwark * held;
}

/**
 * Symmetric progressive strength trade (DESIGN §4.4): both sides lose equal STRENGTH per
 * instant, so `attackerStrength - defenderStrength` is invariant until the smaller side
 * reaches zero — which is exactly why the discretised result always matches the instant
 * "30 vs 20 leaves 10" rule regardless of tick size, and why a mid-fight reinforcement
 * (which changes one side's strength) changes the outcome.
 *
 * @returns {{ defTroops:number, atkTroops:number }}
 */
export function applyStrengthTrade({ defTroops, defPerTroop, atkTroops, atkPerTroop, dt }) {
  const defStrength = defTroops * defPerTroop;
  const atkStrength = atkTroops * atkPerTroop;
  const smaller = Math.min(defStrength, atkStrength);
  const rate = Math.max(BATTLE.fightRateMin, BATTLE.fightRateFrac * smaller);
  let traded = Math.min(rate * dt, defStrength, atkStrength);

  // A tick's rate-limited trade only zeroes the losing side out exactly when it happens to
  // cover that side's entire remaining strength. Otherwise the loser is left with an
  // uncollected sliver that isDead() (below) would then discard for free next tick, letting
  // the winner keep troops it should have paid for — a real, if small, breach of "outcome
  // equals the instant rule" (DESIGN §4.4). So: if this tick's trade would already leave a
  // side in the dead zone without finishing it, finish it now in the same tick instead.
  const peekDef = defPerTroop > 0 ? defTroops - traded / defPerTroop : defTroops;
  const peekAtk = atkPerTroop > 0 ? atkTroops - traded / atkPerTroop : atkTroops;
  if (peekDef > 0 && peekDef < DEATH_THRESHOLD) traded = defStrength;
  else if (peekAtk > 0 && peekAtk < DEATH_THRESHOLD) traded = atkStrength;

  const nextDef = defPerTroop > 0 ? defTroops - traded / defPerTroop : defTroops;
  const nextAtk = atkPerTroop > 0 ? atkTroops - traded / atkPerTroop : atkTroops;
  return { defTroops: nextDef, atkTroops: nextAtk };
}

/** True if a troop count (squad or garrison) counts as dead. */
export function isDead(count) {
  return count < DEATH_THRESHOLD;
}

/**
 * Fires tower volleys: any site of type 'tower' whose owner still lives shoots the nearest
 * hostile squad within range every `volleySec`, dealing `volleyKills * ownerAtk` troops.
 * Mutates sites/squads in place and pushes `arrow` events. `t` is the battle's new time.
 */
export function resolveTowerVolleys(battle, runtime, t) {
  const { player, enemy, arena } = battle;
  for (const site of battle.sites) {
    if (isDead(site.troops)) continue;
    let cfg;
    if (site.type === 'tower') {
      // an Arrow Tower fortification (DESIGN §10.3) carries its own range and volley rate by level
      cfg = site.range || site.volleySec || site.volleyKills
        ? { range: site.range ?? SITE_TYPES.tower.range, volleySec: site.volleySec ?? SITE_TYPES.tower.volleySec, volleyKills: site.volleyKills ?? SITE_TYPES.tower.volleyKills }
        : SITE_TYPES.tower;
    }
    else if (site.type === 'camp' && site.owner === PLAYER_OWNER && player.campVolleyLevel > 0) {
      // Watchtowers next door (DESIGN §5.8): the player's War Camp shoots like a tower, more often at a higher level
      const level = Math.min(Math.floor(player.campVolleyLevel), CAMP_VOLLEY.volleySec.length);
      cfg = { range: CAMP_VOLLEY.range, volleySec: CAMP_VOLLEY.volleySec[level - 1], volleyKills: CAMP_VOLLEY.kills };
    } else continue;
    if (site.nextVolley === undefined) site.nextVolley = 0;
    if (t < site.nextVolley) continue;
    const towerTile = runtime.byIndex.get(site.tile);
    if (!towerTile) continue;
    const rangeWorld = hexRadiusToWorld(cfg.range * towerRangeMult(battle) * towerRangeBoonMult(battle, site, t)); // Night: half as far (DESIGN §10.13); Tower Sappers (PLAN-PHASE8)
    let best = null;
    let bestDist = Infinity;
    for (const squad of battle.squads) {
      if (squad.owner === site.owner || isDead(squad.count) || squad.noArrows) continue; // Raid squads with the skill ride through arrows
      if (towerIgnores(battle, site, squad)) continue; // Night Raiders (PLAN-PHASE7)
      const pos = squadPosition(battle, squad);
      const d = worldDist(towerTile, pos);
      if (d <= rangeWorld && d < bestDist) {
        bestDist = d;
        best = squad;
      }
    }
    site.nextVolley = t + cfg.volleySec * towerIntervalMult(battle, site); // Engineers (PLAN-PHASE7): towers you hold, twice as fast
    if (!best) continue;
    const stats = ownerStats(site.owner, player, arena.enemyFaction, enemy);
    const kills = onArrow(battle, site, best, cfg.volleyKills * stats.atk, t); // Phalanx cuts it; Fire Arrows ignite (PLAN-PHASE7)
    best.count = Math.max(0, best.count - kills);
    const pos = squadPosition(battle, best);
    battle.events.push({
      type: 'arrow', site: site.id, squad: best.id,
      x1: towerTile.x, y1: towerTile.y, x2: pos.x, y2: pos.y,
    });
  }
}

/**
 * Finds opposing squads within intercept radius and pairs them into fights, and blocks
 * marching squads that stray within radius of an ongoing fight until it resolves. Simple,
 * deterministic (id order), matches DESIGN §4.4's "keep it simple" note.
 * @returns {Set<number>} ids of squads that are blocked (near an active fight) this tick.
 */
export function resolveEngagements(battle) {
  const marching = battle.squads.filter((s) => s.state === 'march' && !s.lane).sort((a, b) => a.id - b.id); // a lane squad is at sea (PLAN-PHASE12)
  const fighting = battle.squads.filter((s) => s.state === 'fight');
  const radius = hexRadiusToWorld(BATTLE.interceptRadius);
  const blocked = new Set();
  const claimed = new Set();

  // Marching squads that wander near an existing fight involving a hostile owner wait.
  for (const squad of marching) {
    const pos = squadPosition(battle, squad);
    for (const foe of fighting) {
      if (foe.owner === squad.owner) continue;
      const foePos = squadPosition(battle, foe);
      if (worldDist(pos, foePos) <= radius) {
        blocked.add(squad.id);
        break;
      }
    }
  }

  // Pair up unclaimed, unblocked marching squads of opposing owners within radius.
  for (const squad of marching) {
    if (blocked.has(squad.id) || claimed.has(squad.id)) continue;
    const pos = squadPosition(battle, squad);
    let foe = null;
    for (const other of marching) {
      if (other.id === squad.id || claimed.has(other.id) || blocked.has(other.id)) continue;
      if (other.owner === squad.owner) continue;
      const otherPos = squadPosition(battle, other);
      if (worldDist(pos, otherPos) <= radius) {
        foe = other;
        break;
      }
    }
    if (foe) {
      squad.state = 'fight';
      squad.foe = foe.id;
      foe.state = 'fight';
      foe.foe = squad.id;
      claimed.add(squad.id);
      claimed.add(foe.id);
      battle.events.push({ type: 'clash', x: pos.x, y: pos.y, a: squad.id, b: foe.id });
    }
  }
  return blocked;
}
