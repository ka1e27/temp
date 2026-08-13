// FOG OF WAR — the foundation. Nothing renders this yet and the AI does not
// read it yet; this file defines the SHAPE both of those will consume.
//
// BUILDINGS SEE. SQUADS DO NOT. Vision comes from what you HOLD, not from
// what you are moving — an army marching through open country is blind for
// the whole march, and that is the mechanic, not a bug. It is also the whole
// reason this is cheap: a squad's position changes every tick, but a site's
// ownership changes only on capture or construction, which are exactly the
// events `recomputeInfluence` and `recomputeOccupancy` already key off.
// Vision is a third derived map invalidated by the same events and rebuilt at
// the same three call sites — sim.js `startBattle`, sim.js `siegePhase`'s
// flip branch, and construct.js `cmdBuild` — never touched per tick or per
// frame.
//
// Modelled on ./influence.js and ./occupancy.js in every respect that
// matters: a sparse plain-JSON record on state, rebuilt only when ownership
// or the site list changes.
//
// THE SITE GRAPH IS COMMON KNOWLEDGE, ITS CONTENTS ARE NOT. A site's
// position, kind and `adj` are known to both sides from tick 0 (see
// `perceivedSite` below) — what fog hides is the live half: current owner,
// garrison, HP, siege, training, and squads.
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
// everything else keeps whatever was already recorded.
//
// PERCEIVED views. The canvas renderer and the DOM panel/preview would
// otherwise each resolve `state.sites.find(...)` independently, so hiding a
// glyph on the board would still leave the same site fully inspectable by
// clicking it — one bug fixed on the board and left live in the panel.
// `perceivedSite`/`perceivedSquads` are the ONE resolver both are meant to
// call, so there is one bug to find instead of three.
// PURE.
import { round, withinRadius } from '../core/hex.js';
import { VISION_RADIUS } from '../content/balance.js';
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

/** Does `faction` currently see hex `(q, r)`? */
export function canSee(state, faction, q, r) {
  return !!state.vision?.[faction]?.[`${q},${r}`];
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
 * Every squad `faction` gets to know about right now: its own, unconditionally
 * (an army always knows where it is), plus any of the enemy's currently
 * standing on a hex it can see.
 *
 * A squad that leaves vision drops out immediately and without a trace — no
 * ghost, deliberately: a remembered army is worse than no information,
 * because the player would act on a position that is certainly stale.
 *
 * @returns {object[]}
 */
export function perceivedSquads(state, faction) {
  const out = [];
  for (const sq of state.squads) {
    if (sq.owner === faction) { out.push(sq); continue; }
    const hex = squadHexOf(state, sq);
    if (hex && canSee(state, faction, hex.q, hex.r)) out.push(sq);
  }
  return out;
}
