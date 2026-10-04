// Generals (DESIGN §10.8, §10.11): assignment, settling a battle's commander (XP, wounds), and the roster panel's data. Pure: no
// DOM, no Date.now, no Math.random, no storage. The roster's state, levels, skills and battle effects live in ./generalsState.js
// (the leaf progression.js imports); everything there is re-exported here.
import { edictMods } from './edicts.js'; // the leaf (PLAN-PHASE5): Drillmasters
import { GENERALS } from '../config/generals.js';
import { RENOWN } from '../config/renown.js';
import {
  ensureGenerals, generalById, isWounded, addXp, wound, passiveOf, abilityOf, pendingPicks, nextPickOptions, xpToNext, recordGeneralLevels,
} from './generalsState.js';
import { deedBonuses } from './deeds.js';

export * from './generalsState.js';

/** Ids of the Generals commanding a running battle (from `state.battles`, ARCHITECTURE §10.2). */
export function busyGeneralIds(state) {
  const out = new Set();
  for (const run of Array.isArray(state.battles) ? state.battles : []) {
    if (run && run.commander && !(run.battle && run.battle.result)) out.add(run.commander);
  }
  return out;
}

/** Generals free to command at `nowMs`: not wounded and not commanding a running battle. */
export function freeGenerals(state, nowMs) {
  const busy = busyGeneralIds(state);
  return ensureGenerals(state).roster.filter((g) => !busy.has(g.id) && !isWounded(g, nowMs));
}

// How well a General suits a kind of battle: attackers for attacks, the Marshal (and Stalwarts) for defenses.
const SUIT = Object.freeze({
  attack: Object.freeze({ crimson: 0.6, amber: 0.5, violet: 0.4, gravewarden: 0.3, mercenary: 0.2, marshal: 0 }),
  defense: Object.freeze({ marshal: 0.6, gravewarden: 0.5, violet: 0.3, mercenary: 0.2, amber: 0.1, crimson: 0 }),
});

/**
 * The best free General for a battle (the region card's default, DESIGN §10.11): the highest level, ties broken by how well the
 * kind suits the battle, then by roster order. null when none is free (the Militia Captain commands).
 * @param {'attack'|'defense'} kind
 */
export function bestFreeGeneral(state, world, regionId, kind, nowMs) {
  void world; void regionId;
  const suit = SUIT[kind] || SUIT.attack;
  let best = null;
  let bestScore = -Infinity;
  for (const g of freeGenerals(state, nowMs)) {
    const score = g.level + (suit[g.kind] ?? 0);
    if (score > bestScore) { best = g; bestScore = score; }
  }
  return best;
}

function centroidDist(world, a, b) {
  const ra = world.regions[a];
  const rb = world.regions[b];
  if (!ra || !rb) return Infinity;
  return Math.hypot(ra.centroid.x - rb.centroid.x, ra.centroid.y - rb.centroid.y);
}

/**
 * The free General nearest the region (a defense's commander when the raid is announced, DESIGN §10.11): by the distance from
 * where each last fought (the start region if it has not), ties to the higher level. null when none is free.
 */
export function nearestFreeGeneral(state, world, regionId, nowMs) {
  let best = null;
  let bestKey = null;
  for (const g of freeGenerals(state, nowMs)) {
    const from = g.regionId != null && world.regions[g.regionId] ? g.regionId : world.startRegion ?? 0;
    const key = [centroidDist(world, from, regionId), -g.level];
    if (!bestKey || key[0] < bestKey[0] - 1e-9 || (Math.abs(key[0] - bestKey[0]) <= 1e-9 && key[1] < bestKey[1])) { best = g; bestKey = key; }
  }
  return best;
}

/**
 * Puts a General in command of a run (ARCHITECTURE §10.1 `run.commander`), or clears it (null: the Militia Captain). MUTATES the run.
 * When `state` and `world` are given and the battle is already built, the battle's player stats are re-folded with the new
 * commander's passive and ability (an ability already used stays used).
 * @returns {object} the run
 */
export function assign(run, generalId, state = null, world = null, statsFn = null) {
  run.commander = generalId || null;
  if (state && world && typeof statsFn === 'function' && run.battle && run.battle.player) {
    const fresh = statsFn(state, world, run.regionId, { commander: run.commander });
    const p = run.battle.player;
    const beacon = run.battle.arena && run.battle.arena.playerSpeedMult ? run.battle.arena.playerSpeedMult : 1;
    p.speed = fresh.speed * beacon;
    p.cooldownMult = fresh.cooldownMult;
    p.garrisonMult = fresh.garrisonMult;
    p.assaultMult = fresh.assaultMult;
    p.reclaim = fresh.reclaim;
    p.ability = fresh.ability ? { ...fresh.ability } : null;
    p.commander = fresh.commander;
  }
  return run;
}

/**
 * Settles a finished battle for its commander (DESIGN §10.11): XP (100 an attack won, 80 a defense won, 40 a loss or retreat), a
 * wound on a loss, and where it last fought. MUTATES the General. Returns null when the Militia Captain commanded.
 * @param {object} run a finished BattleRun
 * @param {'win'|'lose'|'retreat'} result
 * @returns {{ id:string, xp:number, levels:number, level:number, wounded:boolean, picks:number }|null}
 */
export function settleCommander(state, run, result, nowMs) {
  const g = generalById(state, run && run.commander);
  if (!g) return null;
  const outcome = result === 'win' ? (run.kind === 'defense' ? 'defenseWon' : 'win') : 'loss';
  const gain = addXp(g, outcome, deedBonuses(state).xpMult * edictMods(state).xpMult); // the Mentor deed x Drillmasters (PLAN-PHASE5)
  recordGeneralLevels(state);
  const lost = result !== 'win';
  if (lost) wound(g, nowMs);
  if (Number.isInteger(run.regionId)) g.regionId = run.regionId;
  return { id: g.id, ...gain, wounded: lost, picks: pendingPicks(g) };
}

// --- Copy -----------------------------------------------------------------------------------------------------------------------

const pct = (v) => `${Math.round(v * 100)}%`;

/** One line for a passive ("Your settlements +17% defence"). */
export function passiveText(general) {
  const p = passiveOf(general);
  if (!p) return '';
  switch (p.stat) {
    case 'garrisonMult': return `Your settlements +${pct(p.value)} defence`;
    case 'assaultMult': return `Squads +${pct(p.value)} strength when assaulting`;
    case 'cooldown': return `Power cooldowns −${pct(p.value)}`;
    case 'speed': return `Squads +${pct(p.value)} march speed`;
    case 'campTroops': return `+${pct(p.value)} camp troops`;
    case 'reclaim': return `${pct(p.value)} of the enemies slain attacking your settlements join them`;
    default: return '';
  }
}

/** One line for the active ("Shield Wall: Bulwark on every settlement you hold, for 5 s"). */
export function abilityText(general) {
  const a = abilityOf(general);
  if (!a) return '';
  const name = GENERALS.copy.abilityNames[a.id];
  switch (a.id) {
    case 'shieldWall': return `${name}: Bulwark on every settlement you hold, for ${a.duration} s${a.heal ? `, heals ${pct(a.heal)}` : ''}${a.levy ? `, +${a.levy} troops each` : ''}`;
    case 'charge': return `${name}: your next ${a.squads} squads march +${pct(a.speed)} faster and hit +${pct(a.strength)} harder`;
    case 'foresight': return `${name}: enemy targets revealed, enemy squads −${pct(a.slow)} speed for ${a.duration} s`;
    case 'raid': return `${name}: ${a.squads > 1 ? `${a.squads} free squads` : 'a free squad'} of ${pct(a.share)} of the camp's troops ride to the target${a.noArrows ? ', through arrows' : ''}`;
    case 'bonus': return `${name}: +${pct(a.share)} troops at the camp`;
    case 'raiseFallen': return `${name}: the troops you lost in the last ${a.windowSec} s rise at your strongest site (up to ${pct(a.cap)} of the camp)`;
    default: return name;
  }
}

/** What a skill does, in words built from the config ("Shield Wall lasts 3 s longer"). */
export function skillText(id) {
  const t = GENERALS.skillText[id] || id;
  const v = GENERALS.skillValues[id];
  if (v == null) return t;
  return t.replace('{pct}', pct(v)).replace('{n}', String(v));
}

// --- Panel data (the Generals roster, built by the integration engineer) ------------------------------------------------------

/**
 * Everything the roster panel shows, one entry per General, plus the hire row. Cheap enough to rebuild every second.
 * @returns {{ generals: object[], hire: { cost:number, can:boolean, reason:string|null, slots:number } , renown:number }}
 */
export function generalsPanelData(state, world, nowMs) {
  const busy = busyGeneralIds(state);
  const renown = state.renown && Number.isFinite(state.renown.points) ? state.renown.points : 0;
  const roster = ensureGenerals(state).roster;
  const commanding = new Map();
  for (const run of Array.isArray(state.battles) ? state.battles : []) if (run && run.commander) commanding.set(run.commander, run);
  const generals = roster.map((g) => {
    const wounded = isWounded(g, nowMs);
    const run = commanding.get(g.id);
    const trainCost = RENOWN.cost.trainPerLevel * g.level;
    const tiers = GENERALS.kinds[g.kind].skills;
    return {
      id: g.id, kind: g.kind, name: g.name, title: GENERALS.kinds[g.kind].title,
      style: g.style, styleName: GENERALS.copy.styleNames[g.style] || '', level: g.level, maxLevel: GENERALS.maxLevel,
      xp: g.xp, xpNext: xpToNext(g.level) === Infinity ? null : xpToNext(g.level),
      passive: passiveText(g), active: abilityText(g), ability: abilityOf(g)?.id ?? null,
      skills: tiers.map((opts, i) => ({
        level: GENERALS.skillLevels[i], options: opts.map((id) => ({ id, text: skillText(id) })),
        picked: g.skills[i] ?? null, open: g.skills.length === i && g.level >= GENERALS.skillLevels[i],
      })),
      pendingPicks: pendingPicks(g), nextPick: nextPickOptions(g),
      wounded, woundedMs: wounded ? g.woundedUntil - nowMs : 0,
      busy: busy.has(g.id), commandingRegion: run ? run.regionId : null, commandingKind: run ? run.kind : null,
      train: { cost: trainCost, can: g.level < GENERALS.maxLevel && renown >= trainCost },
      heal: { cost: RENOWN.cost.heal, can: wounded && renown >= RENOWN.cost.heal },
      respec: { cost: RENOWN.cost.respec, can: g.skills.length > 0 && renown >= RENOWN.cost.respec },
    };
  });
  const mercs = roster.filter((g) => g.kind === 'mercenary').length;
  const slots = GENERALS.maxMercenaries - mercs;
  const hire = {
    cost: RENOWN.cost.mercenary, slots, can: slots > 0 && renown >= RENOWN.cost.mercenary,
    reason: slots <= 0 ? RENOWN.copy.reasons.full : renown < RENOWN.cost.mercenary
      ? RENOWN.copy.reasons.renown.replace('{n}', String(RENOWN.cost.mercenary - renown)) : null,
  };
  void world;
  return { generals, hire, renown };
}
