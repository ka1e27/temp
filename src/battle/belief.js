// THE AI'S BELIEF — a filtered, stale view of `state` that ai.js / aicore.js /
// aihome.js read INSTEAD OF state, and that tools/simplayer.js reads for the
// harness bot's own target scan and build/upgrade siting.
//
// Their scoring code does not change AT ALL — only what they are handed does
// (fog-design.md decision 5). `think()` calls `beliefFor()` once and threads
// the result through every phase in place of `state`; if a future diff to
// ai.js/aicore.js/aihome.js is anything more than that swap, the new logic
// belongs here, not there.
//
// battle/vision.js already answers "can `faction` see this" and hands back a
// GHOST for anything it cannot — `{id, hex, kind, adj, owner, ghost:true}`.
// That is exactly right for a renderer: draw the building, or do not. It is
// NOT enough for a decision-maker. `power()`, `total()` and `addComp()` all do
// arithmetic on `site.garrison`, and a ghost has none — `undefined[u]` throws
// a TypeError, which is worse than the NaN hazard it sounds like, because it
// does not even fail quietly. This file is the one place that turns "unknown"
// into a FINITE, sane, public-knowledge number instead.
// PURE.
import { emptyComp, siteMaxHp } from './combat.js';
import { SITES } from '../content/balance.js';
import { perceivedSite, perceivedSquads } from './vision.js';

/**
 * PRESUMED GARRISON, for a site the viewer has never laid eyes on.
 *
 * Two answers were on the table:
 *   (a) presume the kind's typical holding — SHIPPED. "A stronghold holds up
 *       to N" is printed on the build menu, so reasoning off a share of `cap`
 *       cannot be a cheat, and it keeps the AI cautious without paralysing it.
 *   (b) presume empty — attacks into fog and gets wiped. Measured dramatically
 *       worse (see this change's report) and is not what ships.
 *
 * Expressed as militia — balance.js's own "safe answer when you cannot read
 * the map": no ground multiplier, no counters worth naming, so a wrong guess
 * about WHAT is inside costs nothing extra on top of the guess about HOW MANY.
 *
 * 0.20, NOT A ROUNDER-LOOKING NUMBER, because `AI.freeLunchHexes` (aicore.js)
 * exists to grab a WEAKLY-HELD neighbour — "leave a farm on 3 militia and it
 * will be taken" — and that doorstep is exactly the ground a radius-1 building
 * usually cannot see (freeLunchHexes is 3, VISION_RADIUS is 1 for everything
 * but a watchtower). At 0.35 a presumed farm clears `AI.freeLunchDefence` (25)
 * on cap alone and the mechanic goes quiet against every unseen farm — not
 * fog working as designed, an accidental cancellation of an unrelated, already
 * -tuned constant. 0.20 keeps a presumed farm just under that floor while
 * still reading as real caution against an unseen fort or throne (stronghold
 * ~73, castle ~77 by the same arithmetic) — see this change's report for the
 * comparison at 0.35.
 *
 * `content/regions.rules.js BASE_GARRISON` was deliberately NOT used here.
 * That table is documented DEAD on the real path — only meta/fallbackMap.js's
 * unused-generator branch reads it — and wiring a second, LIVE reader onto it
 * from battle/ would make that comment false the moment anyone believed it.
 * `SITES[kind].cap` is the one number this file needs and it already lives in
 * balance.js, which is the file a balance pass actually edits.
 *
 * Exported so a test can state its expectation off the same number this reads
 * rather than a second copy of the fraction.
 */
export const PRESUMED_GARRISON_FRAC = 0.20;

function presumedGarrison(kind) {
  const cap = SITES[kind]?.cap ?? 0;
  return { ...emptyComp(), militia: Math.max(1, Math.round(cap * PRESUMED_GARRISON_FRAC)) };
}

/**
 * A ghost, extended with presumed numbers so arithmetic on it cannot crash —
 * see the file header. Level presumes 1, same reasoning as garrison: an
 * unseen wall is reasoned about as a fresh one, never a levelled one, and
 * `hp` presumes full health for that presumed level — there is no information
 * suggesting otherwise, and a random guess would be a second thing to defend.
 *
 * OWNER IS OTHERWISE LEFT ALONE, at whatever `perceivedSite` gave it — a real
 * last-known owner (decision 14) if this faction ever saw it, `null` if
 * neither side ever has. A stronger version of this file once presumed a
 * never-seen ghost's owner as the OPPOSING faction, on the theory that "I
 * don't know whose flag that is" should default to caution the same way the
 * garrison presumption does. MEASURED AND REVERTED: `aihome.js encroachment`
 * sums the garrison of every FOE-owned site within `homeRadiusHexes`, so that
 * one change made EVERY unscouted neighbour of the castle — including a
 * truly empty one — read as a confirmed body of troops, and `homeGuard`
 * answered by recalling an entire rear army for a phantom. See `think()` in
 * ai.js for the fix that actually shipped: `homeGuard` alone reads the TRUE
 * state, the same exception `adapt()` already had, rather than teaching every
 * ghost to lie about who holds it.
 *
 * "Otherwise", because `beliefFor` overrides this ONE field, after this
 * function returns, for the two throne kinds — see `THRONE_KINDS` below. That
 * override does not belong in this function: `believedGhost` is about
 * presumed answers to genuinely unknown questions, and a throne's occupant is
 * not one of those.
 */
function believedGhost(site) {
  const level = 1;
  const hpMax = siteMaxHp(site.kind, level);
  return {
    ...site,
    level,
    hp: hpMax,
    hpMax,
    garrison: presumedGarrison(site.kind),
    siege: null,
    trainType: null,
    upgradeTicksLeft: 0,
    buildTicksLeft: 0,
    shieldTicks: 0,
  };
}

/**
 * `faction`'s filtered, stale view of `state` — what its commander (the enemy
 * AI) or its scripted general (the harness bot) reasons about INSTEAD of the
 * truth.
 *
 * Position, kind and `adj` are common knowledge (fog-design.md decision 9) —
 * `perceivedSite` already carries them on every ghost — so whole-map geometry
 * like `frontDistance`/`advanceDistance`/`reach` keeps working unchanged over
 * the RETURNED site list; only the live fields (owner, garrison, hp, siege,
 * training, level) are stale or presumed.
 *
 * ONE EXCEPTION, and it is not spelled out by decision 9 because it is not
 * about the enemy: a site under the VIEWER'S OWN active siege is the viewer's
 * own operation, not intelligence about somebody else's — exactly the
 * principle `perceivedSquads` already applies to the viewer's own squads
 * ("its own, unconditionally"). Skipping this would silently break two things
 * that have nothing to do with rendering: `aihome.js recall` could never call
 * home a siege it cannot currently see the site of, and `ai.js activeAttacks`
 * would undercount the AI's own commitments and let it launch past its tier's
 * `concurrent` cap — a real behavioural bug wearing the clothes of "fog".
 *
 * Every other field on `state` (mods, rules, factions, grid, ai, commands,
 * events, tick, ...) passes through BY REFERENCE. That is deliberate: `mods`
 * is the shop's own multipliers, not something a sentry could ever "see" or
 * fail to; `commands` being the SAME array as `state.commands` is what lets
 * every existing `state.commands.push(...)` call site downstream keep working
 * unchanged, whether it was handed `state` or this view.
 */

// A THRONE'S ALLEGIANCE IS COMMON KNOWLEDGE — the corollary of decision 9
// that only bites once something tries to ATTACK a never-scouted castle.
// `perceivedSite`'s `owner: state.seen[...] ?? null` is the right rule for a
// farm, whose current holder is exactly the live fact fog exists to hide. It
// is the wrong rule for the two sites `sim.js endPhase` treats as the win
// condition: you are invading ground the enemy holds outright, so you
// already know whose castle that is before you have seen a single hex of
// it — the same "there is a fort on that hill" reasoning decision 9 already
// gives every OTHER site, applied to the one pair where it actually matters.
// It is not even uncertain: `endPhase` proves it by construction, because a
// RUNNING battle can never have `castle.owner !== 'enemy'` or
// `camp.owner !== 'player'` — either flip ends the battle the same tick it
// happens, so there is no tick at which fog could be hiding a different
// answer. `owner: null` on the enemy castle was not fog; it was a wrong
// answer to a question fog was never entitled to ask.
//
// Left unfixed, a target scan that filters on `site.owner === FOE` never
// finds the castle: measured on gallowmoor seed 8919, the harness bot swept
// the countryside for a whole battle, sent 1,741 orders and NONE at the
// castle, never once saw its hex, and timed out with the castle sitting at
// 672/672 — CLAUDE.md's "the bot quietly declines to play" failure mode,
// with fog as a new cause of it.
//
// The fix stays narrow ON PURPOSE: only `owner`, only these two kinds.
// Garrison, HP, siege and level stay exactly as presumed as any other
// ghost — "you know whose flag flies over the throne" is not "you know how
// many stand behind the door". `tests/belief.test.js` pins both halves with
// a negative control, because the failure this guards is the fix quietly
// growing into "the AI can see the throne".
const THRONE_KINDS = new Set(['camp', 'castle']);

export function beliefFor(state, faction) {
  const sites = state.sites.map((site) => {
    if (site.siege?.owner === faction) return site;
    const perceived = perceivedSite(state, faction, site);
    if (!perceived.ghost) return perceived;
    const ghost = believedGhost(perceived);
    if (THRONE_KINDS.has(ghost.kind)) ghost.owner = site.owner;
    return ghost;
  });
  return { ...state, sites, squads: perceivedSquads(state, faction) };
}
