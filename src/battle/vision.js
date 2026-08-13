// FOG OF WAR — buildings see, and now a marching or camped column sees its
// own doorstep too.
//
// THE OLD RULE WAS ABSOLUTE: sight came from what you HELD, never from what you
// were MOVING, and the reason was cost — a squad's position changed every tick,
// so it could never follow `recomputeInfluence`'s rebuild-only-on-ownership-
// change pattern the way a site can. That objection is gone. `squadHexOf`
// (battle/movement.js, contract v10) reads a squad's position off the `path` it
// carries as a pure function of `state.tick` — nothing integrated, nothing
// stored — so a query can ask "where is it RIGHT NOW" for the cost of a lookup
// and the answer never has to be baked into a map somebody must invalidate.
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
// (render/battleView.js `signature()`), and bumping it every tick a squad moves
// would force that repaint every tick too — the exact shape of regression
// render/bgcache.js already measured once (60fps -> 31 from a much cheaper
// per-frame trigger). `computeVeil` (render/fog.js) calls `canSee` per hex, so
// the veil DOES pick up squad sight — but only as of the LAST repaint something
// else caused. The per-frame layer calls `canSee` fresh and has no such lag.
//
// Radius is deliberately SMALL (`SQUAD_VISION_RADIUS`, equal to an ordinary
// building's own): a column lights its surroundings, it does not scout for
// free. The watchtower sees four times as far and has to stay worth building.
//
// TWO DIFFERENT QUESTIONS, TWO FUNCTIONS, and keeping them apart is what let
// site existence be fogged at all. `perceivedSite` answers "what do I KNOW
// about this site" and always describes every site on the map, because
// battle/belief.js hands it to the enemy commander and the harness bot, whose
// planners are pure whole-map geometry. `siteKnown` answers "is it on my SCREEN
// at all" and is the one predicate the board, the panel and the hit-test share.
// What fog hides from a planner is still only the live half — owner, garrison,
// HP, siege, training, squads.
//
// COUNTER-INTELLIGENCE. A watchtower does not only grant its owner sight — it
// denies the OTHER side sight of that owner's OWN squads nearby (see
// `perceivedSquads`'s `hiddenByOwnTower` below). Squads only, never sites, and
// `siteKnown` is the reason that is still coherent: what a site's existence is
// or is not hidden by is one rule, kept in one place. It has to live in
// `perceivedSquads` rather than in `canSee`, because it does not answer "can I
// see this HEX" — the ground is plainly visible and the column standing on it
// is simply not handed over — and it has to be checked from `beliefFor` too
// (battle/belief.js), or the enemy AI would target what its own doctrine says
// it cannot see: a behavioural bug wearing fog's clothes.
//
// LAST-KNOWN OWNER. `state.seen` remembers exactly one fact about a site once
// it has been observed: who held it the last time either side actually looked.
// Nothing else — a remembered garrison count or HP bar would be fog leaking the
// one number that matters, and both would be wrong the moment they went stale.
// Owner is different: "it was theirs last time I looked" is a true statement a
// player can act on, which is why it is the one field whose staleness is
// informative rather than misleading. Without it the board's ownership colour
// would flicker on and off as vision comes and goes — worse than fog, it is
// noise.
//
// Unlike vision/influence/occupancy, `state.seen` is NOT rebuilt from scratch
// every call: it only ever GAINS an entry or updates one already there, because
// its whole purpose is to remember what fog has since hidden. A site currently
// in sight, currently owned, or currently UNCLAIMED (see `recomputeVision` for
// why unclaimed ground is common knowledge) gets its true owner written in;
// everything else keeps whatever was already recorded. Squad sight feeds it too
// — `recordSquadSightings`, per tick, or a marching column would see without
// remembering.
//
// PERCEIVED views. The canvas renderer and the DOM panel/preview would
// otherwise each resolve `state.sites.find(...)` independently, so hiding a
// glyph on the board would leave the same site fully inspectable by clicking
// it. `perceivedSite`/`perceivedSquads`/`siteKnown` are the ONE resolver all of
// them call, so there is one bug to find instead of three.
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
    // nothing. Vision is the WHOLE of what a watchtower produces, so leaving
    // this ungated makes its 15-second timer decorative: 120 gold would buy an
    // instant reveal and the build bar would be a formality. Occupancy is
    // deliberately NOT gated this way, and the difference is the point — a
    // half-dug foundation is physically in the way from the moment it is paid
    // for. Presence is not production.
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
  //
  // UNCLAIMED GROUND IS COMMON KNOWLEDGE, and that clause is what keeps the
  // opening land grab playable now that `siteKnown` hides a building nobody has
  // looked at. Measured on the campaign OPENER, all twelve seeds: without it the
  // player's board holds their own three sites and nothing else — no neutral
  // farm anywhere on it — while the tutorial's very first line says "drag from
  // your camp to the grey farm". An instruction pointing at something that is
  // not on the board is the failure this project keeps paying for, one step
  // worse than the half-written coach beats that reached no player at all.
  //
  // It is also the honest reading of what was asked for: the thing to hide is
  // where the ENEMY's buildings are. A farm nobody holds is not intelligence —
  // nobody is garrisoning it, nobody is hiding it, and the opening race for it
  // is the whole shape of the first two minutes.
  //
  // Recorded into `seen` rather than special-cased inside `siteKnown` so that
  // capturing one does not make it BLINK OUT: the moment the enemy takes a
  // neutral farm the player never approached, `seen` still says "neutral", which
  // is a true past-tense statement of exactly the kind this map exists to carry.
  const prev = state.seen ?? { player: {}, enemy: {} };
  const seen = {};
  for (const faction of FACTIONS) {
    const merged = { ...prev[faction] };
    for (const site of state.sites) {
      const visible = site.owner === faction
        || site.owner === 'neutral'
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
 * WHAT A MARCHING COLUMN LEARNS, written down — the missing half of squad
 * sight, and it was missing in the way this project's bugs usually are: the
 * feature looked complete because the screen was right.
 *
 * `recomputeVision` builds `state.seen` out of the SITE-only `vision` map, at
 * its four ownership-shaped events. Squad sight is answered live by `canSee`
 * and is in none of that, so a column could march past an enemy stronghold,
 * light it, show it to the player — and record nothing. MEASURED on gallowmoor:
 * 56 tick-site pairs where a marching column could see an enemy site, and
 * ZERO of them in `state.seen`. The moment the column moved on, the board went
 * back to saying nobody had ever looked. Sight that creates no memory is worse
 * than no sight: it flickers, which is the exact failure `seen` exists to stop.
 *
 * O(squads x sites) per tick with a distance check first — on the biggest board
 * that is ~1.2k comparisons a tick, against a `canSee` that already scans every
 * squad per query. It APPENDS, exactly as `recomputeVision`'s own merge does,
 * so nothing here can lose a fact.
 *
 * IT BUMPS `influenceVersion` ONLY ON A GENUINELY NEW SITE, and that
 * distinction is the whole reason this is affordable. Bumping per tick would
 * force a background repaint per tick — the regression the file header refuses
 * for exactly this feature. A first sighting happens at most once per site per
 * faction per battle (a few dozen times in total), and it is precisely the
 * moment a building has to appear on the board, so the two conditions are the
 * same condition.
 */
export function recordSquadSightings(state) {
  const squads = state.squads;
  if (!squads || !squads.length || !state.seen) return;
  let discovered = false;
  for (const sq of squads) {
    const bucket = state.seen[sq.owner];
    if (!bucket) continue;
    const at = squadHexOf(state, sq);
    if (!at) continue;
    for (const site of state.sites) {
      if (distance(asHex(site.hex), at) > SQUAD_VISION_RADIUS) continue;
      if (bucket[site.id] === undefined) discovered = true;
      bucket[site.id] = site.owner;
    }
  }
  if (discovered) state.influenceVersion = (state.influenceVersion || 0) + 1;
}

/**
 * HAS `faction` EVER LAID EYES ON THIS SITE? Owns it, sees it now, or `seen`
 * carries a last-known owner for it.
 *
 * The ONE predicate every player-facing surface asks, so that hiding a
 * building on the board and hiding it in the panel can never come apart — the
 * same reason `perceivedSite` is one resolver rather than three. It is
 * deliberately NOT folded into `perceivedSite`: that function answers "what do
 * I know about this site", which the AI and the harness bot both need over the
 * WHOLE map (their planners are pure whole-map geometry — see battle/belief.js),
 * and this one answers "is it on my screen at all", which is a rendering
 * question. Wiring the two together would fog site EXISTENCE from the
 * commander as well, and a planner reasoning about a map with holes in it is a
 * different feature with a balance pass attached.
 */
export function siteKnown(state, faction, site) {
  if (site.owner === faction) return true;
  const [q, r] = site.hex;
  if (canSee(state, faction, q, r)) return true;
  return state.seen?.[faction]?.[site.id] !== undefined;
}

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

// A FAILED ASSAULT'S MEMORY lives in ./assaultmemory.js — split for the
// 400-line cap when squad sight landed, and re-exported here so every existing
// `from './vision.js'` keeps resolving. A bare re-export does not bind the
// names locally, which is correct: nothing in this file calls either of them.
export { recordFailedAssault, lastKnownGarrison } from './assaultmemory.js';
