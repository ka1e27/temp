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
import { inGrid } from '../core/hex.js';
import { SITE_KINDS as SITE_KIND_LIST } from '../content/balance.js';
// The two field-level validators split out to ./checks.js for the line
// budget — nothing else in this file needed to move, since neither was ever
// exported (only `assertBattleConfig` called them).
import {
  checkMods, checkRivers, checkGrid, checkSiteLevel,
} from './checks.js';

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
//
// v8: NO FIELD CHANGED AT ALL, and that is exactly why the bump is needed.
// `SITE_KINDS` gained `trainingGround` and `stronghold` stopped being the same
// building — it trained and now trains nothing. The blob shape is byte-
// identical, so "changing a field requires a bump" misses it entirely; what the
// version guards is the v5 sentence above, a blob "the current engine would step
// with the wrong shape". A v7 save is a board whose strongholds ARE the player's
// production, and resuming it here stops them mid-siege with no event and no
// explanation. THE VERSION TRACKS WHAT THE ENGINE WILL DO WITH A BLOB, NOT THE
// BLOB'S FIELD LIST.
//
// v9: fog of war's foundation. `SITE_KINDS` gained `watchtower` — a new kind
// crosses the seam through the same table every kind already does, same as
// trainingGround in v8 — and STATE gained two fields nothing before this had
// any use for: `vision` and `seen` (battle/vision.js), the sight and
// last-known-owner maps fog reads. Once more, NO CONFIG FIELD CHANGED; v8's
// lesson applies again anyway, because a resumed blob is state, not config.
// A v8 blob has neither field, and `canSee` reads a missing `state.vision`
// through optional chaining and gets `false` for every hex — not "no fog",
// but a battle where NOTHING is visible until the next capture or build
// happens to call `recomputeVision` and populate it. A v8 save was a board
// where both sides saw everything; resuming it under v9 hands them a
// blackout they were never playing with.
//
// v10: A SQUAD IS NO LONGER A LINE BETWEEN TWO BUILDINGS. It carries the `path`
// it walks, its `to` may be null (a march onto bare ground), and it may be
// `camped` on a `hex` it is holding. Again no CONFIG field moved — and again
// that is the point, because the blob that breaks is state.
//
// A v9 squad has no `path`, so `squadHexOf` returns null for it and the army is
// nowhere: it draws nothing, it fogs nothing, and the towers that shoot at
// positions cannot see it. It would still ARRIVE, because arrival is a tick
// comparison — so a resumed v9 battle is one where every column in the air is
// invisible to both sides until it lands on top of somebody. That is a board
// the current engine steps wrongly while looking entirely healthy, which is the
// v5 sentence exactly.
//
// v11: three fog changes travelling together, one of which is a real field.
// A marching or camped squad now grants its owner a small sight radius
// (battle/vision.js `canSee`) and a watchtower now hides its OWNER's squads
// from the other side within its own sight radius (`perceivedSquads`) —
// NEITHER needs a new field, because both are answered fresh from `path`/
// `arriveTick`/`camped`/`hex` (already crossing the seam since v10) and the
// existing site list; an old blob steps under the new rules exactly like any
// other, just with a commander that finally uses ground it always had.
//
// STATE gains the one field that actually is new: `lastKnownGarrison` —
// `{ player: {siteId: count}, enemy: {...} }`, `recordFailedAssault`'s
// deliberate, narrow relaxation of "a ghost carries nothing that changes" —
// the size of a garrison that just beat back a real, lost assault, kept
// alongside `seen`'s last-known owner. A v10 blob has none of it, and
// `state.lastKnownGarrison?.[faction]?.[id]` reads `undefined` for every site
// under the new engine — which happens to be the right default ("never fought
// here"), not a wrong-looking one. The bump is still required: the rule is
// "state shape changed", not "and it happened to fail safe this time".
/**
 * v12 IS THE MELEE — the v8 lesson a fourth time: NO CONFIG FIELD MOVED. State
 * did (`site.melee`, a squad's `melee`) and so did what the engine DOES with a
 * blob: a field battle resolved on the tick a column landed and now grinds
 * toward the same `resolveField` projection over `MELEE.seconds`, while two
 * hostile forces on a hex fight rather than pass through. A v11 blob resumed
 * here has fights in flight with no melee record: each silently un-happens.
 */
export const CONTRACT_VERSION = 12;

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

/** @typedef {'farm'|'trainingGround'|'stronghold'|'camp'|'castle'} SiteKind */
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

// DERIVED, not repeated. This was a second hand-written list of the site kinds
// and the two had to be kept in step by somebody remembering — which is the
// same shape as the unit colour declared in two tables that shipped the three
// specialists drawing correctly on the board and grey in every DOM surface.
// A kind that exists in `SITES` and not here is not a validation gap, it is a
// contract that rejects every config the game generates.
const SITE_KINDS = SITE_KIND_LIST;
const FACTIONS = ['player', 'enemy', 'neutral'];
// Passed into checkMods rather than imported by it — see ./checks.js for why.
const NUMERIC_MODS = Object.keys(DEFAULT_MODS).filter(
  (k) => typeof DEFAULT_MODS[k] === 'number',
);

/** @returns {BattleConfig} @throws {TypeError} */
export function assertBattleConfig(c) {
  if (!c || typeof c !== 'object') throw new TypeError('BattleConfig: not an object');
  const e = [];

  if (c.contractVersion !== CONTRACT_VERSION) {
    e.push(`contractVersion: expected ${CONTRACT_VERSION}, got ${c.contractVersion}`);
  }
  if (!c.battleId) e.push('battleId: required');
  if (!Number.isInteger(c.seed)) e.push('seed: must be an integer');

  // BEFORE the site loop, because every site's hex is checked against the grid
  // and `inGrid` reads it without a guard — see ./checks.js `checkGrid`.
  const gridOk = checkGrid(c, e);

  const sites = c.sites ?? [];
  const ids = new Set();
  if (sites.length < 2) e.push('sites: need at least 2');
  for (const s of sites) {
    if (ids.has(s.id)) e.push(`sites: duplicate id "${s.id}"`);
    ids.add(s.id);
    if (!SITE_KINDS.includes(s.kind)) e.push(`sites[${s.id}].kind: unknown "${s.kind}"`);
    if (!FACTIONS.includes(s.owner)) e.push(`sites[${s.id}].owner: unknown "${s.owner}"`);
    checkSiteLevel(s, e);
    if (!Array.isArray(s.hex) || s.hex.length !== 2) {
      e.push(`sites[${s.id}].hex: expected [q,r]`);
    } else if (gridOk && !inGrid(c.grid, { q: s.hex[0], r: s.hex[1] })) {
      // A SITE OFF THE MAP, which used to be survivable and is not any more.
      //
      // `grid` is an OFFSET rectangle — `axialFromOffset(col,row) = {q: col -
      // floor(row/2), r: row}` — so a 9x9 grid holds no negative `r` at all and
      // only a little negative `q`, and four hand-built fixtures in this repo
      // sat outside their own. Every one passed: a send was legal on an
      // AUTHORED EDGE and `travelTicks` fell back to raw hex distance when
      // pathing failed, so an off-map site behaved like any other. Free
      // movement has no edges to lie with. There is no path to a hex that is
      // not on the board, so the site is simply unreachable forever, and the
      // failure surfaces as a region that cannot be won rather than as an error.
      e.push(`sites[${s.id}].hex: [${s.hex}] is outside the ${c.grid?.cols}x${c.grid?.rows} grid`);
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

  checkMods(c.player, 'player', e, NUMERIC_MODS, FEATURE_IDS);
  checkMods(c.enemy, 'enemy', e, NUMERIC_MODS, FEATURE_IDS);

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
    // FINITE, and that word is doing the work: `Infinity > 0` is true, so the one
    // rule that guarantees a battle ends was satisfied by the value that means it
    // never does. A resumed blob with `hardCapMs: Infinity` runs until the tab
    // closes — no timeout event, no result, no reward, and the idle economy paying
    // out the whole time. `battle/state.js` derives `hardCapTicks` by dividing it
    // (Infinity stays Infinity through `Math.round`) and `battle/sim.js` asks
    // `state.tick >= hardCapTicks`, which is simply never true — so nothing
    // downstream can notice, and the HUD counts down from infinity.
    if (!Number.isFinite(c.rules.hardCapMs) || !(c.rules.hardCapMs > 0)) {
      e.push(`rules.hardCapMs: must be a finite number > 0, got ${c.rules.hardCapMs}`);
    }
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
