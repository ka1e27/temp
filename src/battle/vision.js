// FOG OF WAR — buildings see, and now a marching or camped column sees its
// own doorstep too.
//
// THE OLD RULE WAS ABSOLUTE: sight came from what you HELD, never from what
// you were MOVING, and the reason was cost — a squad's position changed every
// tick, so it could never follow `recomputeInfluence`'s rebuild-only-on-
// ownership-change pattern the way a site can. That objection is gone.
// `squadHexOf` (battle/movement.js, contract v10) reads a squad's position off
// the `path` it carries as a pure function of `state.tick` — nothing is
// integrated, nothing is stored — so a query can always ask "where is it
// RIGHT NOW" for the cost of a lookup, and the answer never needs to be baked
// into a map that then has to be invalidated.
//
// SO THE SQUAD HALF OF SIGHT LIVES ENTIRELY IN `canSee`, NEVER IN
// `state.vision`. `state.vision` stays exactly what it always was — a sparse,
// site-only map, rebuilt at the same four events as before (battle start, a
// capture, a watchtower finishing, `cmdBuild`) and untouched by a squad simply
// marching. `canSee` answers "does `faction` see this hex" by checking that
// map FIRST (O(1), the cheap, common case) and, only if it misses, scanning
// `faction`'s own live squads (O(squads) — a battle has at most a few dozen,
// never hundreds) for one within `SQUAD_VISION_RADIUS` of the hex asked
// about. Nothing is written down: every call re-derives the answer from
// wherever the squads happen to be AT THAT TICK, so there is no map to keep in
// step and no event that has to remember to invalidate one.
//
// THIS IS WHY `state.influenceVersion` IS NEVER BUMPED FOR A MARCHING SQUAD.
// That counter is what tells the BACKGROUND canvas to repaint
// (render/battleView.js `signature()`), and bumping it every tick a squad
// moves would force that repaint every tick too — the exact shape of
// regression `render/bgcache.js` already measured once (60fps -> 31 from a
// much cheaper per-frame trigger). `computeVeil` (render/fog.js) now calls
// `canSee` per hex rather than reading `state.vision` directly, so the veil
// DOES pick up squad-granted sight — but only as of the LAST time something
// else caused a background repaint, exactly the staleness every other
// background-only fact already carries. The per-frame layer (squads, site
// detail) has no such lag, because it calls `canSee` fresh every frame
// regardless of any of this.
//
// Radius is deliberately SMALL (content/balance.engine.js
// `SQUAD_VISION_RADIUS`, currently equal to an ordinary building's own
// VISION_RADIUS): a column should light its immediate surroundings, not scout
// for free. The watchtower is the one building that exists to answer "I want
// to see", at four times this, and it has to stay worth building.
//
// THE SITE GRAPH IS COMMON KNOWLEDGE, ITS CONTENTS ARE NOT. A site's
// position, kind and `adj` are known to both sides from tick 0 (see
// `perceivedSite` below) — what fog hides is the live half: current owner,
// garrison, HP, siege, training, and squads.
//
// COUNTER-INTELLIGENCE. A watchtower does not only grant its owner sight — it
// denies the OTHER side sight of that owner's OWN squads nearby (see
// `perceivedSquads`'s `hiddenByOwnTower` below). Squads only, never sites: the
// owner asked specifically about "troops and movements", and a site's
// position/kind are common knowledge regardless (decision above), so there is
// nothing there for counter-intelligence to hide. It has to live in
// `perceivedSquads` rather than in `canSee`, because it does not answer "can I
// see this HEX" — a player can see the ground perfectly well and simply not
// be shown the column standing on it — and it has to be checked from
// `beliefFor` too (battle/belief.js), or the enemy AI would target what its
// own doctrine says it cannot see, which is a behavioural bug wearing fog's
// clothes rather than fog itself.
//
// LAST-KNOWN OWNER. `state.seen` remembers exactly one fact about a site once
// it has been observed: who held it the last time either side actually
// looked. Nothing else — a remembered garrison count or HP bar would be fog
// leaking the one number that matters, and both would be wrong the moment
// they went stale. Owner is different: "it was theirs last time I looked" is
// a true statement a player can act on, which is why it is the one field
// whose staleness is informative rather than misleading. Without it the
// board's ownership colouring would flicker on and off as vision comes and
// goes, which is worse than fog — it is noise.
//
// Unlike vision/influence/occupancy, `state.seen` is NOT rebuilt from scratch
// every call: it only ever GAINS an entry or updates one already there,
// because its whole purpose is to remember what fog has since hidden. A site
// currently in sight — or currently owned — gets its true owner written in;
// everything else keeps whatever was already recorded. Squad-granted sight
// does NOT feed `seen` — see `recordFailedAssault` below for the one, much
// narrower exception to "a ghost carries nothing that changes".
//
// PERCEIVED views. The canvas renderer and the DOM panel/preview would
// otherwise each resolve `state.sites.find(...)` independently, so hiding a
// glyph on the board would still leave the same site fully inspectable by
// clicking it — one bug fixed on the board and left live in the panel.
// `perceivedSite`/`perceivedSquads` are the ONE resolver both are meant to
// call, so there is one bug to find instead of three.
// PURE.
import { round, withinRadius, distance } from '../core/hex.js';
import { VISION_RADIUS, SQUAD_VISION_RADIUS } from '../content/balance.js';
import { COUNTER_INTEL_RADIUS } from '../content/balance.towers.js';
import { asHex } from './influence.js';
import { inGrid } from './mapgen.js';
// ...from its REAL home rather than through state.js's re-export, because
// `createBattleState` has to build the vision map itself (see the comment at
// the end of state.js) and importing it back through the front door would
// close a cycle. ./occupancy.js and ./influence.js touch state.js for exactly
// the same reason: not at all.
import { siteById } from './siteinfo.js';
import { squadHexOf } from './movement.js';

const FACTIONS = ['player', 'enemy'];
const kOf = (h) => `${h.q},${h.r}`;

/**
 * Fill `state.vision` — `{ player: {hexKey: 1, ...}, enemy: {hexKey: 1, ...} }`
 * — and update `state.seen`, the last-known-owner record described above.
 *
 * NEUTRAL SITES GRANT NOBODY SIGHT, unlike the territory flood, which every
 * owner (including neutral) projects into. Vision has no such thing as a
 * neutral CLAIM: there is nothing to record on an unclaimed site's behalf.
 *
 * No falloff and no contest: a hex is either within some owned site's radius
 * or it is not, so the stored value is always exactly `1` rather than a
 * distance weight. There is no "who sees it more", only "is it seen" — which
 * is what keeps this a plain-JSON PRESENCE map instead of a second influence
 * field.
 *
 * Keys are inserted in SORTED order (see ./influence.js), because
 * `tests/sim.test.js` diffs two identical runs by `JSON.stringify(state)` and
 * an unsorted map can fail that for reasons that have nothing to do with
 * behaviour.
 *
 * @returns {Record<string, Record<string,number>>} the new `state.vision`
 */
export function recomputeVision(state) {
  const seenHex = { player: new Set(), enemy: new Set() };
  for (const site of state.sites) {
    if (site.owner !== 'player' && site.owner !== 'enemy') continue; // neutral sees nothing
    // SCAFFOLDING IS BLIND, for the same reason it earns no gold and trains
    // nothing: a site under construction produces nothing, and vision is what a
    // watchtower produces. It is the WHOLE of what one produces, so leaving this
    // ungated would have made a tower's 15-second timer decorative — 120 gold
    // buys an instant reveal and the build bar is a formality.
    //
    // Occupancy is deliberately NOT gated this way and the difference is the
    // point: a half-dug foundation is physically in the way, so it blocks a
    // march from the moment it is paid for. Presence is not production.
    if (site.buildTicksLeft > 0) continue;
    const radius = VISION_RADIUS[site.kind] ?? 1;
    const centre = asHex(site.hex);
    for (const h of withinRadius(centre, radius)) {
      if (!inGrid(state.grid, h)) continue;
      seenHex[site.owner].add(kOf(h));
    }
  }

  const vision = {};
  for (const faction of FACTIONS) {
    const field = {};
    for (const key of [...seenHex[faction]].sort()) field[key] = 1;
    vision[faction] = field;
  }
  state.vision = vision;

  // LAST-KNOWN OWNER — see the file header. `prev` carries forward every site
  // this faction has ever looked at; only a site CURRENTLY visible (in sight
  // right now, or held outright) gets overwritten with the truth.
  const prev = state.seen ?? { player: {}, enemy: {} };
  const seen = {};
  for (const faction of FACTIONS) {
    const merged = { ...prev[faction] };
    for (const site of state.sites) {
      const visible = site.owner === faction
        || vision[faction][kOf(asHex(site.hex))] !== undefined;
      if (visible) merged[site.id] = site.owner;
    }
    const sorted = {};
    for (const id of Object.keys(merged).sort()) sorted[id] = merged[id];
    seen[faction] = sorted;
  }
  state.seen = seen;

  // BUMP THE REPAINT COUNTER, for the reason ./occupancy.js documents at its own
  // bump and one step further: `signature()` catches a per-hex map moving only
  // when a SITE moved — an owner flipped, a level rose, the list grew. Three of
  // this function's four call sites do sit beside one of those. The fourth does
  // not: a watchtower finishing is a timer running out, so nothing appears and
  // nothing changes hands, and the board would go on drawing the country as it
  // looked before the tower opened. Bumping here makes that true of every caller
  // by construction rather than by each one remembering.
  state.influenceVersion = (state.influenceVersion || 0) + 1;

  return vision;
}

// Scratch — the query hex `canSee` is asked about, reused rather than
// allocated per call: this is on the per-frame read path (perceivedSite/
// perceivedSquads run every frame), so the same "no allocation in a hot
// read" discipline render/*.js already holds itself to applies here too.
const _q = { q: 0, r: 0 };

/**
 * Does `faction` currently see hex `(q, r)`?
 *
 * TWO SOURCES, checked cheapest-first. `state.vision` is the sparse,
 * site-only map — an O(1) lookup, and the answer for almost every query,
 * because most of a board is not standing on top of a marching column. Only
 * on a miss does this scan `faction`'s own live squads for one within
 * `SQUAD_VISION_RADIUS` — see the file header for why that scan, and not a
 * second map, is the cheap half of this feature.
 */
export function canSee(state, faction, q, r) {
  if (state.vision?.[faction]?.[`${q},${r}`]) return true;
  const squads = state.squads;
  if (!squads || !squads.length) return false;
  _q.q = q;
  _q.r = r;
  for (let i = 0; i < squads.length; i++) {
    const sq = squads[i];
    if (sq.owner !== faction) continue;
    const at = squadHexOf(state, sq);
    if (at && distance(at, _q) <= SQUAD_VISION_RADIUS) return true;
  }
  return false;
}

/**
 * The hex a squad currently occupies.
 *
 * ONE IMPLEMENTATION, in movement.js, re-exported here under the name every
 * existing caller already imports. It used to live in this file and lerp
 * between the two endpoint SITES — which was wrong the moment a route bent
 * around anything, because the army was drawn and fogged and targeted at a
 * place it was not walking through. It now reads a position off the squad's
 * own stored `path`, still as a pure function of `state.tick`, so nothing is
 * integrated and a replay lands the column on the same hex.
 *
 * Battle has no `alpha` — that is a render-frame smoothing term between two
 * ticks, and this only ever asks "where is it AT this tick" — so progress is
 * measured against `state.tick` directly, the exact integer `routeAt()` is
 * fed once rendering catches up to it.
 *
 * @returns {?{q:number,r:number}} null when the squad has no route to read
 */
// IMPORTED AND re-exported, not `export ... from`: a bare re-export does NOT
// bind the name locally, and `perceivedSquads` below calls it.
export { squadHexOf as squadHex };

/**
 * The site `faction` actually gets to know about right now.
 *
 * Position, kind and `adj` are common knowledge from tick 0 (see the file
 * header) — what fog hides is the live half. Owning the site, or currently
 * seeing its hex, returns the real, live object; otherwise a GHOST carrying
 * only what is common knowledge plus the last-known owner, and nothing that
 * CHANGES (garrison, HP, siege, level, trainType) — a ghost that carried any
 * of those would be fog leaking the one number that matters.
 *
 * @returns {object} the real site, or `{id, hex, kind, adj, owner, ghost:true}`
 */
export function perceivedSite(state, faction, site) {
  const [q, r] = site.hex;
  if (site.owner === faction || canSee(state, faction, q, r)) return site;
  return {
    id: site.id,
    hex: site.hex,
    kind: site.kind,
    adj: site.adj,
    owner: state.seen?.[faction]?.[site.id] ?? null,
    ghost: true,
  };
}

/**
 * COUNTER-INTELLIGENCE: is `sq`, standing at `hex`, currently under the cover
 * of one of ITS OWNER'S OWN watchtowers? See the file header for why this is
 * squads-only and lives here rather than in `canSee`.
 *
 * O(sites), same shape as `towers.js gunsOf` and for the same reason: the
 * armed/covering kinds are a handful of buildings on the biggest board, so a
 * scan per squad costs nothing next to `canSee`'s own per-squad scan above.
 * Gated on `buildTicksLeft` for the same reason `recomputeVision` gates a
 * tower's own sight on it — SCAFFOLDING IS BLIND, so it cannot cover anyone
 * either; presence is not production.
 */
function hiddenByOwnTower(state, sq, hex) {
  for (const site of state.sites) {
    if (site.owner !== sq.owner) continue;
    const radius = COUNTER_INTEL_RADIUS[site.kind];
    if (!radius) continue;
    if (site.buildTicksLeft > 0) continue;
    if (distance(asHex(site.hex), hex) <= radius) return true;
  }
  return false;
}

/**
 * Every squad `faction` gets to know about right now: its own, unconditionally
 * (an army always knows where it is), plus any of the enemy's currently
 * standing on a hex it can see AND not currently covered by one of ITS OWN
 * watchtowers (`hiddenByOwnTower` above) — counter-intelligence, not just
 * sight, and it is why a squad can be on ground `faction` can plainly see and
 * still not be handed to them.
 *
 * A squad that leaves vision (or comes under cover) drops out immediately and
 * without a trace — no ghost, deliberately: a remembered army is worse than
 * no information, because the player would act on a position that is
 * certainly stale.
 *
 * @returns {object[]}
 */
export function perceivedSquads(state, faction) {
  const out = [];
  for (const sq of state.squads) {
    if (sq.owner === faction) { out.push(sq); continue; }
    const hex = squadHexOf(state, sq);
    if (!hex || !canSee(state, faction, hex.q, hex.r)) continue;
    if (hiddenByOwnTower(state, sq, hex)) continue;
    out.push(sq);
  }
  return out;
}

// ---------------------------------------------------------------------------
// A failed assault leaves a memory — the one deliberate relaxation of "a
// ghost carries nothing that changes"
// ---------------------------------------------------------------------------
//
// `state.seen`'s rule is strict on purpose: a remembered garrison would be
// fog leaking the one number that matters, wrong the moment it goes stale.
// THAT OBJECTION IS ABOUT A NUMBER NOBODY EVER CONFIRMED. Ordinary fog can go
// stale the instant vision drops, with no way for the player to tell how
// stale — which is exactly why owner is the one field kept, and why a
// garrison never was.
//
// A FAILED ASSAULT IS A DIFFERENT CLAIM: your own army stood on that ground
// and fought that garrison, so the count is not a guess or a snapshot skimmed
// off a passing sightline — it is the size of the force that just beat you,
// witnessed at the moment it mattered most. Presenting it plainly as a STALE,
// past-tense figure (never re-derived, never assumed current) is the same
// honesty `state.seen` already trades in for owner; this is that same trade,
// narrowed to the one moment a player unambiguously learned a number instead
// of merely glimpsing a flag.
//
// The narrowness is the safeguard: `recordFailedAssault` has exactly one
// caller (battle/arrivals.js `resolveArrival`, the direct-assault-on-a-
// garrison branch, only when the attacker LOST), so the count can never drift
// from "what a real engagement just showed you" into "something fog
// half-remembers". It does not live inside `state.seen` — a separate map, so
// the strict rule above stays exactly as strict for owner as it always was.
export function recordFailedAssault(state, faction, siteId, count) {
  const store = state.lastKnownGarrison ?? { player: {}, enemy: {} };
  const bucket = { ...store[faction], [siteId]: count };
  const sorted = {};
  for (const id of Object.keys(bucket).sort()) sorted[id] = bucket[id];
  state.lastKnownGarrison = { ...store, [faction]: sorted };
  // Same reasoning as recomputeVision's own bump, one event later: a failed
  // assault changes what the board should show (a stale count, a dark red
  // wash) with no owner flip, no level change, no timer to key off — nothing
  // else marks the moment. Cheap because it fires once per LOST assault,
  // never per tick.
  state.influenceVersion = (state.influenceVersion || 0) + 1;
}

/**
 * The stale count `recordFailedAssault` left behind for `faction` at
 * `siteId`, or `undefined` if that faction has never attacked it and lost.
 * Deliberately NOT folded into `perceivedSite`'s ghost shape — a ghost's
 * contract is "nothing that changes" (tests/vision.test.js pins the exact key
 * list), and this is the one narrow exception to it, so it stays a call a
 * renderer makes on purpose rather than a field that shows up unannounced.
 */
export function lastKnownGarrison(state, faction, siteId) {
  return state.lastKnownGarrison?.[faction]?.[siteId];
}
