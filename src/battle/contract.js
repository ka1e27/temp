// ============================================================================
// THE SEAM between the meta layer and the battle engine.
//   meta/modifiers.js  --BattleConfig-->  battle/state.js
//   battle/outcome.js  --BattleOutcome--> meta/rewards.js
//
// battle/* must NEVER import meta/*, and meta/* must NEVER import battle/*
// except for this one file. screens/battle.js is the only broker.
//
// FROZEN. Changing a field requires bumping CONTRACT_VERSION.
// ============================================================================
// PURE.
import { fnv1a, stableStringify } from '../core/hash.js';
import { UNIT_IDS } from '../content/balance.js';

// v2: FactionMods gained `features` (shop unlocks that change battle or HUD
// behaviour), and `boosters` is now validated. Before v2, five purchasable
// upgrades crossed no seam at all and therefore did nothing.
//
// v3: `grid.rivers` — the second half of the terrain layer. `grid.blocked` was
// always mountains and only ever obstructed pathing; rivers are PASSABLE and
// exist purely to modify what happens on a hex (see battle/terrain.js). They
// have to cross the seam because a battle must be reproducible from its config
// alone, and terrain now changes combat, siege and income.
//
// v4: `rules.castleGateFrac` — the territory gate on whether a siege of the
// castle can actually complete (see battle/state.js `castleSealed`). It has to
// cross the seam because meta owns the per-region dial (content/regions.data.js)
// and battle owns the siege math that reads it; OPTIONAL, so a config that omits
// it (every hand-built fixture) is a region with no gate, not an invalid one.
//
// v5: two changes, one shape and one field.
//   - a site's `rallyTarget` became `rallyTargets[]` plus a sim-owned
//     `rallyCursor`, so one site can feed several neighbours in turn. That is a
//     BATTLE STATE shape rather than a config one, and the version is what makes
//     meta/resume.js discard a mid-battle blob the current engine would step
//     with the wrong shape.
//   - `rules.rallyKeepDefault` — the player's standing preference for how many
//     troops a rallied site holds back. Meta owns the preference and battle owns
//     the per-site field it seeds, so it has to cross. OPTIONAL, like the two
//     before it: absent means the RALLY_KEEP default.
//
// v6: `rules.incursion` — `{depth, mutators[]}`, the identity of one rung of the
// endless ladder (content/incursion.data.js). OPTIONAL, like the three fields
// before it: absent means an ordinary battle.
//
// It carries the rung's IDENTITY and not its effects, which is the whole reason
// the ladder needed no other contract change. Every mutator is applied on the
// meta side through a field that already crosses this seam — a FactionMods
// multiplier, a generation input, or `castleGateFrac` — so the engine steps an
// incursion with no knowledge that one exists. What the field is FOR is the three
// consumers that must tell one rung from another: meta/rewards.js (an incursion
// pays a depth-scaled lump and must never be mistaken for a raid on the same
// region), the results screen, and the HUD.
export const CONTRACT_VERSION = 7;

/** Booster ids the battle engine knows how to run. */
export const BOOSTER_IDS = ['rally', 'march', 'bombard', 'fortify', 'tithe'];

/**
 * Shop unlocks that have to reach the battle layer or its HUD.
 *
 * There used to be four, and three of them were fiction. `hasMod` is called in
 * exactly one place in the whole of `src/` — screens/battle-speed.js, for
 * `doubleSpeed` — so Field Manual, Scout Report and Standing Orders crossed this
 * seam, were validated by `assertBattleConfig`, and were then read by nobody.
 * Worse, Field Manual charged 150 crowns for exact preview numbers that
 * screens/battle-preview.js already shows to everyone unconditionally.
 *
 * tests/seam.test.js only ever guarded the SOLD -> DECLARED direction, which is
 * how three inert features shipped green. The list is now the features that
 * actually do something, and the test guards both directions.
 */
export const FEATURE_IDS = [
  'doubleSpeed',    // Tactician — battle speeds past 2x
];

/** @typedef {'farm'|'stronghold'|'camp'|'castle'} SiteKind */
/** @typedef {'player'|'enemy'|'neutral'} Faction */
/** @typedef {'militia'|'spearmen'|'raiders'|'rams'|'marshal'} UnitId */
/** @typedef {Record<UnitId, number>} Composition */

/**
 * Per-faction tuning. Meta computes these from region tier + purchased upgrades.
 * Battle applies them blindly and never asks why. 1.0 == baseline.
 * @typedef {object} FactionMods
 * @property {number} startGold
 * @property {Composition} expedition  deployed at the home site on tick 0
 * @property {number} goldRateMult
 * @property {number} trainSpeedMult
 * @property {number} trainCostMult
 * @property {number} unitAtkMult
 * @property {number} unitDefMult
 * @property {number} marchSpeedMult
 * @property {number} farmYieldMult
 * @property {number} garrisonCapBonus
 * @property {number} siegeDmgMult
 * @property {number} structureRegenMult
 * @property {Record<string,number>} unitMult  per-troop atk/def, sparse
 * @property {UnitId[]} unlockedUnits  non-empty
 */

/**
 * Everything a battle needs. Fully JSON-serializable: no functions, no
 * undefined, no class instances. That is what makes battles replayable,
 * headless-testable, and independent of the meta layer.
 * @typedef {object} BattleConfig
 */

/**
 * Facts about what happened. Contains NO economy decisions — battle reports
 * observations, meta/rewards.js turns them into crowns. Keeps economy math in
 * exactly one place.
 * @typedef {object} BattleOutcome
 */

export const DEFAULT_MODS = Object.freeze({
  startGold: 300,
  expedition: { militia: 8, spearmen: 0, raiders: 0, rams: 0, marshal: 0 },
  goldRateMult: 1,
  trainSpeedMult: 1,
  trainCostMult: 1,
  unitAtkMult: 1,
  unitDefMult: 1,
  marchSpeedMult: 1,
  farmYieldMult: 1,
  garrisonCapBonus: 0,
  siegeDmgMult: 1,
  structureRegenMult: 1,
  ramImpactHp: 0,
  /**
   * v7. PER-TROOP attack/defence multipliers — unit id -> multiplier — applied
   * inside battle/combat.js `power` per unit, on top of the stack-wide
   * `unitAtkMult`/`unitDefMult`.
   *
   * SPARSE, and that is load-bearing rather than tidiness. Empty means "no
   * troop has one", which is every battle content/regions.data.js was measured
   * with, so the field costs nothing to carry and cannot be mistaken for a live
   * one. A map of eight 1.0s would be a dead seam field wearing a live field's
   * clothes — this project has refunded four upgrades for exactly that.
   */
  unitMult: {},
  unlockedUnits: ['militia', 'spearmen'],
  /** Shop unlocks. Without this field a purchased upgrade cannot influence a
   *  battle at all — which is how five of them shipped doing nothing. */
  features: [],
});

/** @param {Partial<FactionMods>} [o] @returns {FactionMods} */
export const makeMods = (o = {}) => ({
  ...DEFAULT_MODS,
  ...o,
  expedition: { ...DEFAULT_MODS.expedition, ...(o.expedition ?? {}) },
  unitMult: { ...(o.unitMult ?? {}) },
  unlockedUnits: o.unlockedUnits ?? [...DEFAULT_MODS.unlockedUnits],
  features: o.features ?? [],
});

/** Does this faction have a given shop unlock? */
export const hasMod = (mods, feature) => (mods?.features ?? []).includes(feature);

/** Stable hash over the sim-relevant parts of a config. */
export function hashBattleConfig(cfg) {
  return fnv1a(stableStringify(cfg));
}

// --------------------------------------------------------------------------
// Validation. Runs at the seam in dev. Throws with a field path so the error
// names the module at fault instead of surfacing 40 frames later.
// --------------------------------------------------------------------------

const SITE_KINDS = ['farm', 'stronghold', 'camp', 'castle'];
const FACTIONS = ['player', 'enemy', 'neutral'];
const NUMERIC_MODS = Object.keys(DEFAULT_MODS).filter(
  (k) => typeof DEFAULT_MODS[k] === 'number',
);

function checkMods(m, path, errs) {
  if (!m || typeof m !== 'object') { errs.push(`${path}: missing`); return; }
  for (const k of NUMERIC_MODS) {
    if (typeof m[k] !== 'number' || !Number.isFinite(m[k]) || m[k] < 0) {
      errs.push(`${path}.${k}: expected finite number >= 0, got ${m[k]}`);
    }
  }
  if (!Array.isArray(m.unlockedUnits) || m.unlockedUnits.length === 0) {
    errs.push(`${path}.unlockedUnits: must be a non-empty array`);
  }
  if (m.features !== undefined) {
    if (!Array.isArray(m.features)) {
      errs.push(`${path}.features: must be an array of feature ids`);
    } else {
      for (const f of m.features) {
        if (!FEATURE_IDS.includes(f)) errs.push(`${path}.features: unknown feature "${f}"`);
      }
    }
  }
  if (!m.expedition || typeof m.expedition !== 'object') {
    errs.push(`${path}.expedition: must be a composition object`);
  }
  // OPTIONAL and sparse. Absent is the normal case, so the check is on the
  // CONTENTS rather than on the field existing — a mods object from before v7
  // is a faction with no per-troop levels, not an invalid one.
  if (m.unitMult !== undefined) {
    if (!m.unitMult || typeof m.unitMult !== 'object' || Array.isArray(m.unitMult)) {
      errs.push(`${path}.unitMult: must be an object of unit id -> multiplier`);
    } else {
      for (const [id, v] of Object.entries(m.unitMult)) {
        if (!UNIT_IDS.includes(id)) errs.push(`${path}.unitMult: unknown unit "${id}"`);
        else if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
          errs.push(`${path}.unitMult.${id}: expected finite number >= 0, got ${v}`);
        }
      }
    }
  }
}

/**
 * v3 terrain. OPTIONAL — a config without it is a map with no watercourses, not
 * an invalid one, which is what lets the golden fixture and every hand-built
 * test config stay exactly as they are.
 *
 * The one rule that is NOT optional: a river hex may never also be a blocked
 * hex. Rivers are passable and mountains are not, so an overlap is a hex whose
 * own terrain contradicts itself — pathing would refuse it while the renderer
 * painted water over it and the sim handed out a river bonus for standing in a
 * mountain. Catch it at the seam, where the message can still name the producer.
 */
function checkRivers(c, errs) {
  const rivers = c.grid?.rivers;
  if (rivers === undefined) return;
  if (!Array.isArray(rivers)) {
    errs.push('grid.rivers: must be an array of [q,r] pairs');
    return;
  }
  const blocked = new Set((c.grid?.blocked ?? []).map((p) => `${p?.[0]},${p?.[1]}`));
  const seen = new Set();
  for (const h of rivers) {
    if (!Array.isArray(h) || h.length !== 2
      || !Number.isInteger(h[0]) || !Number.isInteger(h[1])) {
      errs.push(`grid.rivers: expected [q,r] integer pairs, got ${JSON.stringify(h)}`);
      continue;
    }
    const key = `${h[0]},${h[1]}`;
    if (seen.has(key)) errs.push(`grid.rivers: duplicate hex ${key}`);
    seen.add(key);
    if (blocked.has(key)) {
      errs.push(`grid.rivers: ${key} is also blocked — a river must stay passable`);
    }
  }
}

/** @returns {BattleConfig} @throws {TypeError} */
export function assertBattleConfig(c) {
  if (!c || typeof c !== 'object') throw new TypeError('BattleConfig: not an object');
  const e = [];

  if (c.contractVersion !== CONTRACT_VERSION) {
    e.push(`contractVersion: expected ${CONTRACT_VERSION}, got ${c.contractVersion}`);
  }
  if (!c.battleId) e.push('battleId: required');
  if (!Number.isInteger(c.seed)) e.push('seed: must be an integer');

  const sites = c.sites ?? [];
  const ids = new Set();
  if (sites.length < 2) e.push('sites: need at least 2');
  for (const s of sites) {
    if (ids.has(s.id)) e.push(`sites: duplicate id "${s.id}"`);
    ids.add(s.id);
    if (!SITE_KINDS.includes(s.kind)) e.push(`sites[${s.id}].kind: unknown "${s.kind}"`);
    if (!FACTIONS.includes(s.owner)) e.push(`sites[${s.id}].owner: unknown "${s.owner}"`);
    if (!Array.isArray(s.hex) || s.hex.length !== 2) {
      e.push(`sites[${s.id}].hex: expected [q,r]`);
    }
    if (!(s.hp > 0) || !(s.hpMax > 0)) e.push(`sites[${s.id}]: hp and hpMax must be > 0`);
  }

  checkRivers(c, e);

  for (const pair of c.adjacency ?? []) {
    const [a, b] = pair;
    if (!ids.has(a) || !ids.has(b)) e.push(`adjacency: dangling edge ${a}->${b}`);
    if (a === b) e.push(`adjacency: self-loop on ${a}`);
  }

  if (!sites.some((s) => s.kind === 'camp' && s.owner === 'player')) {
    e.push('sites: player needs a starting camp');
  }
  if (!sites.some((s) => s.kind === 'castle' && s.owner === 'enemy')) {
    e.push('sites: enemy needs a starting castle');
  }

  checkMods(c.player, 'player', e);
  checkMods(c.enemy, 'enemy', e);

  // Boosters were unvalidated in v1, so a shape mismatch between the producer
  // (an array) and the consumer (an object lookup) silently dropped every
  // charge the player had bought. Nothing downstream noticed. Validate it.
  if (c.boosters !== undefined) {
    if (!Array.isArray(c.boosters)) {
      e.push('boosters: must be an array of {id, charges} — not a map');
    } else {
      for (const b of c.boosters) {
        if (!b || typeof b !== 'object') { e.push('boosters: entries must be objects'); continue; }
        if (!BOOSTER_IDS.includes(b.id)) e.push(`boosters: unknown id "${b.id}"`);
        if (!Number.isInteger(b.charges) || b.charges < 0) {
          e.push(`boosters[${b.id}].charges: expected a non-negative integer, got ${b.charges}`);
        }
      }
    }
  }

  if (!c.rules || typeof c.rules !== 'object') e.push('rules: missing');
  else {
    if (!(c.rules.hardCapMs > 0)) e.push('rules.hardCapMs: must be > 0');
    // OPTIONAL, like grid.rivers before it: absent means "no gate", not invalid.
    if (c.rules.castleGateFrac !== undefined) {
      const f = c.rules.castleGateFrac;
      if (typeof f !== 'number' || !Number.isFinite(f) || f < 0 || f > 1) {
        e.push(`rules.castleGateFrac: expected a number in [0, 1], got ${f}`);
      }
    }
    if (c.rules.rallyKeepDefault !== undefined) {
      const k = c.rules.rallyKeepDefault;
      if (!Number.isInteger(k) || k < 0) {
        e.push(`rules.rallyKeepDefault: expected a non-negative integer, got ${k}`);
      }
    }
    // v6. Validated at the seam because it is the field meta/rewards.js branches
    // the whole endless economy on: a depth of 0, or a `mutators` that is a
    // string rather than a list of them, would pay a lump for a battle that was
    // never on the ladder.
    if (c.rules.incursion !== undefined) {
      const inc = c.rules.incursion;
      if (!inc || typeof inc !== 'object') e.push('rules.incursion: must be an object');
      else {
        if (!Number.isInteger(inc.depth) || inc.depth < 1) {
          e.push(`rules.incursion.depth: expected an integer >= 1, got ${inc.depth}`);
        }
        if (!Array.isArray(inc.mutators) || inc.mutators.some((m) => typeof m !== 'string')) {
          e.push('rules.incursion.mutators: must be an array of mutator ids');
        }
      }
    }
  }

  if (e.length) throw new TypeError(`Invalid BattleConfig:\n  - ${e.join('\n  - ')}`);
  return c;
}

/** @returns {BattleOutcome} @throws {TypeError} */
export function assertBattleOutcome(o, cfg) {
  const e = [];
  if (!o || typeof o !== 'object') throw new TypeError('BattleOutcome: not an object');
  if (o.contractVersion !== CONTRACT_VERSION) e.push('contractVersion mismatch');
  if (o.battleId !== cfg.battleId) e.push('battleId does not match config');
  if (o.configHash !== hashBattleConfig(cfg)) {
    e.push('configHash mismatch (was the config mutated mid-battle?)');
  }
  if (!['win', 'loss', 'timeout', 'retreat'].includes(o.result)) {
    e.push(`result: unknown "${o.result}"`);
  }
  if (!(o.durationMs >= 0)) e.push('durationMs: must be >= 0');
  // Battle reports facts; meta computes money. Enforce it.
  if (o.rewards !== undefined) {
    e.push('rewards: battle must not set this; meta/rewards.js owns it');
  }
  if (e.length) throw new TypeError(`Invalid BattleOutcome:\n  - ${e.join('\n  - ')}`);
  return o;
}
