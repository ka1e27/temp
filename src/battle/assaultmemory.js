// A FAILED ASSAULT LEAVES A MEMORY — the one deliberate relaxation of "a ghost
// carries nothing that changes".
//
// Split out of ./vision.js for the 400-line cap when squad sight and
// `siteKnown` landed, and re-exported from there, so `import
// { recordFailedAssault } from './vision.js'` keeps resolving and no caller
// has to learn a second front door. It is the cleanest cut available: this is
// the one thing in that file that is a MEMORY rather than a derivation, it
// shares no helper with the sight half, and it writes its own map rather than
// `state.seen`.
//
// `state.seen`'s rule is strict on purpose: a remembered garrison would be fog
// leaking the one number that matters, wrong the moment it goes stale. THAT
// OBJECTION IS ABOUT A NUMBER NOBODY EVER CONFIRMED. Ordinary fog can go stale
// the instant vision drops, with no way for the player to tell how stale —
// which is exactly why owner is the one field kept, and why a garrison never
// was.
//
// A FAILED ASSAULT IS A DIFFERENT CLAIM: your own army stood on that ground and
// fought that garrison, so the count is not a guess or a snapshot skimmed off a
// passing sightline — it is the size of the force that just beat you, witnessed
// at the moment it mattered most. Presenting it plainly as a STALE, past-tense
// figure (never re-derived, never assumed current) is the same honesty
// `state.seen` already trades in for owner; this is that same trade, narrowed
// to the one moment a player unambiguously learned a number instead of merely
// glimpsing a flag.
//
// The narrowness is the safeguard: `recordFailedAssault` has exactly one caller
// (battle/arrivals.js `resolveArrival`, the direct-assault-on-a-garrison
// branch, only when the attacker LOST), so the count can never drift from "what
// a real engagement just showed you" into "something fog half-remembers". It
// does not live inside `state.seen` — a separate map, so the strict rule above
// stays exactly as strict for owner as it always was.
// PURE.

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
 * The stale count `recordFailedAssault` left behind for `faction` at `siteId`,
 * or `undefined` if that faction has never attacked it and lost.
 *
 * Deliberately NOT folded into `perceivedSite`'s ghost shape — a ghost's
 * contract is "nothing that changes" (tests/vision.test.js pins the exact key
 * list), and this is the one narrow exception to it, so it stays a call a
 * renderer makes on purpose rather than a field that shows up unannounced.
 */
export function lastKnownGarrison(state, faction, siteId) {
  return state.lastKnownGarrison?.[faction]?.[siteId];
}
