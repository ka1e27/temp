// The seam's field-level validators — split out of ./contract.js for the
// line budget. Nothing outside contract.js calls these directly (they were
// never exported), so there is nothing to re-export: `assertBattleConfig`
// stays the one front door and simply imports what it needs from here.
// PURE.
import { UNIT_IDS, SITE_LEVELS } from '../content/balance.js';
import { inGrid } from '../core/hex.js';

/**
 * A grid must be a real OFFSET rectangle, and this is checked FIRST because
 * everything else about a map is checked against it.
 *
 * `core/hex.js inGrid` reads `grid.rows`/`grid.cols` straight off the object, so
 * a config with no `grid` at all threw an uncaught `TypeError: reading 'rows'`
 * out of the middle of the site loop — which is the one failure mode this whole
 * file exists to prevent. The seam's job is to name the producer at fault and
 * list every fault at once; a raw TypeError from two files away does neither, and
 * `meta/resume.js steppable()` catches it as a bare `false` so a hand-editable
 * blob became "unsteppable, reason unknown".
 *
 * The BOUNDS are the other half, and they are the same asymmetry `expedition`
 * had. `cols: "9"` passed every `>` comparison in the codebase by coercion and
 * then reached the renderer as a string; `cols: 1e9` passed too, and the first
 * thing to walk the board — `verifyReachable`, the veil, `mapshape` — would try
 * to allocate 1e18 hexes. `MAX_GRID_SIDE` is generous rather than tuned: the
 * biggest authored region is 21x16, so 512 cannot refuse a map the game makes
 * while still refusing every map it cannot draw.
 *
 * @returns {boolean} whether the grid is safe to hand to `inGrid`
 */
export const MAX_GRID_SIDE = 512;

export function checkGrid(c, errs) {
  const g = c.grid;
  if (!g || typeof g !== 'object' || Array.isArray(g)) {
    errs.push('grid: must be an object of {cols, rows, blocked?, rivers?}');
    return false;
  }
  let ok = true;
  for (const k of ['cols', 'rows']) {
    if (!Number.isInteger(g[k]) || g[k] < 1 || g[k] > MAX_GRID_SIDE) {
      errs.push(`grid.${k}: expected an integer in [1, ${MAX_GRID_SIDE}], got ${g[k]}`);
      ok = false;
    }
  }
  return ok;
}

/**
 * A site's build level, which is OPTIONAL — absent means level 1, which is what
 * every hand-built fixture and the golden config rely on.
 *
 * Present and out of range is not survivable: `battle/state.js` indexes
 * `SITE_LEVELS[lvl - 1]` to derive `hpMax`, so 0 or 99 threw a raw
 * `TypeError: reading 'hp'` deep inside `createBattleState` — after the seam had
 * already declared the config valid, which is precisely the inversion the seam
 * exists to prevent. The ladder's length is stated in exactly one place
 * (`SITE_LEVELS.length`, see content/balance.js), so this reads it rather than
 * repeating a 5.
 */
export function checkSiteLevel(s, errs) {
  if (s.level === undefined) return;
  if (!Number.isInteger(s.level) || s.level < 1 || s.level > SITE_LEVELS.length) {
    errs.push(`sites[${s.id}].level: expected an integer in [1, ${SITE_LEVELS.length}]`
      + `, got ${s.level}`);
  }
}

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
  // THE ARMY, and until now it was the least-validated field on the object.
  //
  // The asymmetry was the tell: `unitMult` below is optional and cosmetic — a
  // sparse map of per-troop multipliers — and it checks every key against
  // `UNIT_IDS` and every value for finiteness. `expedition` is the force that
  // lands on tick 0, and it got `typeof === 'object'`. So
  // `{militia: 'lots'}` crossed the seam, `battle/state.js` added it to a
  // garrison with `+=`, and the live sim held the STRING "0lots" as a headcount:
  // every comparison against it is false, every arithmetic result NaN, and the
  // board draws a garrison that cannot fight and cannot be killed. `{militia:
  // -50}` was accepted as readily and lands a negative garrison, which is a site
  // that can be captured by nobody and reinforced forever.
  //
  // Integers, not merely finite numbers: a fractional body is not a thing the
  // simulation can kill (`resolveField` integerizes by largest remainder over
  // whole bodies) and every producer already floors — meta/composition.js
  // `distributeExpedition`, `withFreeMarshal`, and the `thinned` mutator in
  // meta/incursion.js all emit whole numbers.
  checkComposition(m.expedition, `${path}.expedition`, errs);
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
 * A composition: unit id -> whole non-negative body count. Sparse is fine (an
 * absent unit is none of it), an unknown key is not — a typo'd id in a
 * hand-edited blob is silently zero troops, which is a battle the player loses
 * for a reason nothing anywhere reports.
 */
export function checkComposition(comp, path, errs) {
  if (!comp || typeof comp !== 'object' || Array.isArray(comp)) {
    errs.push(`${path}: must be a composition object of unit id -> count`);
    return;
  }
  for (const [id, n] of Object.entries(comp)) {
    if (!UNIT_IDS.includes(id)) errs.push(`${path}: unknown unit "${id}"`);
    else if (!Number.isInteger(n) || n < 0) {
      errs.push(`${path}.${id}: expected a non-negative integer, got ${JSON.stringify(n)}`);
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

/**
 * The site list, its edges, and the two sites a battle cannot exist without —
 * split out of ./contract.js for the line budget, along the seam that file
 * already uses: `checkMods` takes its own tables as ARGUMENTS rather than
 * importing them, because contract.js imports this file and an import back
 * would put its consts in their own temporal dead zone. `siteKinds` and
 * `factions` cross the same way, for the same reason.
 *
 * @param {boolean} gridOk whether the grid is safe to hand to `inGrid`
 */
export function checkSites(c, errs, gridOk, siteKinds, factions) {
  const sites = c.sites ?? [];
  const ids = new Set();
  if (sites.length < 2) errs.push('sites: need at least 2');
  for (const s of sites) {
    if (ids.has(s.id)) errs.push(`sites: duplicate id "${s.id}"`);
    ids.add(s.id);
    if (!siteKinds.includes(s.kind)) errs.push(`sites[${s.id}].kind: unknown "${s.kind}"`);
    if (!factions.includes(s.owner)) errs.push(`sites[${s.id}].owner: unknown "${s.owner}"`);
    checkSiteLevel(s, errs);
    if (!Array.isArray(s.hex) || s.hex.length !== 2) {
      errs.push(`sites[${s.id}].hex: expected [q,r]`);
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
      errs.push(`sites[${s.id}].hex: [${s.hex}] is outside the ${c.grid?.cols}x${c.grid?.rows} grid`);
    }
    if (!(s.hp > 0) || !(s.hpMax > 0)) errs.push(`sites[${s.id}]: hp and hpMax must be > 0`);
    // A GARRISON IS AN ARMY AND WAS VALIDATED LIKE A LABEL. `expedition` was
    // tightened once already and this is the same hole one field over:
    // state.js seeds a site as `{...emptyComp(), ...(s.garrison ?? {})}`, so a
    // hand-edited blob saying `{militia: 'lots'}` overwrites the zero with the
    // STRING and every sum downstream concatenates or goes NaN. Optional,
    // because most fixtures omit it — an absent garrison is an empty one.
    if (s.garrison !== undefined) checkComposition(s.garrison, `sites[${s.id}].garrison`, errs);
  }

  for (const pair of c.adjacency ?? []) {
    const [a, b] = pair;
    if (!ids.has(a) || !ids.has(b)) errs.push(`adjacency: dangling edge ${a}->${b}`);
    if (a === b) errs.push(`adjacency: self-loop on ${a}`);
  }

  if (!sites.some((s) => s.kind === 'camp' && s.owner === 'player')) {
    errs.push('sites: player needs a starting camp');
  }
  if (!sites.some((s) => s.kind === 'castle' && s.owner === 'enemy')) {
    errs.push('sites: enemy needs a starting castle');
  }

}
