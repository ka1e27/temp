// The seam's field-level validators — split out of ./contract.js for the
// line budget. Nothing outside contract.js calls these directly (they were
// never exported), so there is nothing to re-export: `assertBattleConfig`
// stays the one front door and simply imports what it needs from here.
// PURE.
import { UNIT_IDS } from '../content/balance.js';

/**
 * A faction's mods object. `numericMods`/`featureIds` are passed in rather
 * than imported, because both are derived from `DEFAULT_MODS`/`FEATURE_IDS`
 * in contract.js and importing them back would be a cycle — this file
 * depends on contract.js for nothing, which is what lets contract.js depend
 * on this one for its validation.
 */
export function checkMods(m, path, errs, numericMods, featureIds) {
  if (!m || typeof m !== 'object') { errs.push(`${path}: missing`); return; }
  for (const k of numericMods) {
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
        if (!featureIds.includes(f)) errs.push(`${path}.features: unknown feature "${f}"`);
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
export function checkRivers(c, errs) {
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
