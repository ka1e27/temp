// RAISING A BUILDING MID-BATTLE.
//
// Split out of ./commands.js for the line budget and re-exported from there, so
// `HANDLERS.BUILD` is the only thing that has to know this file exists — same
// arrangement as ./boosters.js.
//
// The map used to be the map you were dealt: you could take ground but never
// make any, and every economic decision in a battle was "which of these existing
// sites do I level". This is the other half — you choose WHERE your production
// and your walls go, on ground you have taken, which is what makes a captured
// countryside worth something beyond its own output.
//
// Modelled on `cmdUpgrade` throughout, because it is the same shape of purchase:
// spend gold now, wait out a timer, get a stronger board. The differences are
// the two that matter — it needs a place to stand, and it makes a site that did
// not exist, which is a thing nothing in this engine had ever done.
// PURE.
import { distance } from '../core/hex.js';
import { inGrid } from './mapgen.js';
import {
  BUILD_COSTS, BUILD_MIN_SEPARATION, SITES, CENTIGOLD, RALLY_KEEP,
} from '../content/balance.js';
// BUILD_MAX_CONCURRENT is new and cannot yet ride balance.js's own re-export —
// that file is frozen mid a concurrent rewrite (see balance.construct.js's own
// comment on BUILD_RANGE_HEXES for the same constraint). Imported straight off
// its home module until it can join BUILD_COSTS et al above; every OTHER name
// here still comes through the front door as it always has.
import { BUILD_MAX_CONCURRENT } from '../content/balance.construct.js';
// `buildTicksLeft` and `brownout` aside, the shape below is exactly what
// state.js `createBattleState` builds. A built site that were missing a field
// would work until the one tick something read it.
import { TICK_HZ } from '../core/loop.js';
import { goldOf, applyGold } from './economy.js';
import { isBlocked, recomputeReach, clampRallyKeep } from './state.js';
import { recomputeOccupancy } from './occupancy.js';
import { recomputeInfluence, territoryAt } from './influence.js';
import { recomputeVision } from './vision.js';
import { siteMaxHp, emptyComp } from './combat.js';
import { trainableUnit } from './training.js';

const sec = (s) => Math.max(1, Math.round(s * TICK_HZ));

// Scratch for `buildBlocker`'s separation scan, reused rather than allocated per
// site — the same discipline ./vision.js `canSee` holds itself to at `_q`, and
// for the same reason: this is on a PER-FRAME READ PATH even though it lives in
// a pure sim module. `render/buildTargets.js` asks `buildBlocker` once per board
// hex for as long as a build is armed, so an `{q, r}` literal per site per call
// is cols x rows x sites objects a frame — ~18,500 on widowsgate, sixty times a
// second, which is exactly the allocation the render budget forbids and the
// hardest kind to notice, because the file paying it is not the file spending
// it. It cannot escape: `distance` reads two fields and returns a number.
const _s = { q: 0, r: 0 };

/** Sites a faction has under construction right now. Exported because both the
 *  command and the UI need the same answer and two implementations of "am I
 *  already building" would drift the moment one of them grew a special case. */
export const buildingFor = (state, faction) => state.sites
  .filter((s) => s.owner === faction && s.buildTicksLeft > 0);

/**
 * Why this hex cannot be built on, or null when it can.
 *
 * READ-ONLY and exported, so `render/buildTargets.js` can paint a legal hex
 * green while the player is still choosing rather than rejecting them after the
 * click. A build preview that disagreed with the command would be the same
 * class of bug as a battle preview that disagrees with the simulation.
 *
 * THE GROUND RULE IS YOUR TERRITORY, not a radius from one site. It used to be
 * "within `BUILD_RANGE_HEXES` of a site you hold", which drew a fixed ring
 * around each building rather than answering "is this my country" — a player
 * whose sites ringed a gap between them could not build IN that gap if it sat
 * one hex past every ring, even though the ground was plainly theirs and the
 * board already painted it that way. `state.influence` (battle/influence.js
 * `recomputeInfluence`) is the flood that already answers "whose ground is
 * this" for the board's own colouring, castle-gate math and march speed, and
 * it is recomputed on every ownership change — so reading it back here is
 * cheap, always current, and can never disagree with what the player sees.
 *
 * @param {object} state @param {string} faction @param {{q,r}} at
 */
export function buildBlocker(state, faction, at) {
  if (!inGrid(state.grid, at)) return 'off-map';
  if (isBlocked(state, at.q, at.r)) return 'blocked-ground';
  // Every existing site at once: a build has to clear both "is something
  // standing HERE" and "is something too close", against every site on the
  // board regardless of owner — one pass, because a site is both.
  for (const s of state.sites) {
    _s.q = s.hex[0];
    _s.r = s.hex[1];
    const d = distance(_s, at);
    if (d === 0) return 'occupied';
    if (d < BUILD_MIN_SEPARATION) return 'too-close';
  }
  // ...and it has to be YOUR ground — read off the same flood the board
  // paints, not re-derived from distance.
  if (territoryAt(state, at) !== faction) return 'no-ground';
  return null;
}

/**
 * Raise a building. `cmd = { t: 'BUILD', kind, hex: [q, r] }`.
 *
 * The new site starts at ONE HP and empty, and that is the whole risk of the
 * purchase rather than an implementation detail: a half-built yard behind your
 * line is a gift to anything that reaches it, so building forward is a bet and
 * building at home is slow. It also means nothing special has to happen when the
 * enemy takes one — it is a site, and every rule that applies to a site applies
 * to it.
 *
 * AT MOST `BUILD_MAX_CONCURRENT` PER FACTION, like `cmdUpgrade`'s per-site rule
 * and for the same reason: it keeps the spend rate honest. Without a cap a
 * treasury that has been idling could convert itself into a row of
 * strongholds in a single tick; the cap being 2 rather than 1 is what lets a
 * player answer two separate needs — a farm at home and a yard at the front —
 * without an arbitrary queue between them.
 */
export function cmdBuild(state, cmd, by) {
  const spec = BUILD_COSTS[cmd?.kind];
  if (!spec) return 'not-buildable';
  const hex = cmd.hex;
  if (!Array.isArray(hex) || hex.length !== 2) return 'malformed';
  const at = { q: hex[0], r: hex[1] };

  if (buildingFor(state, by).length >= BUILD_MAX_CONCURRENT) return 'already-building';
  const why = buildBlocker(state, by, at);
  if (why) return why;

  const costCg = spec.gold * CENTIGOLD;
  if (goldOf(state.factions[by]) < costCg) return 'insufficient-gold';
  applyGold(state.factions[by], -costCg);

  const site = {
    id: nextBuildId(state, cmd.kind),
    kind: cmd.kind,
    hex: [at.q, at.r],
    owner: by,
    level: 1,
    garrison: emptyComp(),
    hp: 1,
    hpMax: siteMaxHp(cmd.kind, 1),
    adj: [],
    siege: null,
    shieldTicks: 0,
    upgradeTicksLeft: 0,
    buildTicksLeft: sec(spec.sec),
    rallyTargets: [],
    rallyCursor: 0,
    rallyKeep: clampRallyKeep(state.rules?.rallyKeepDefault ?? RALLY_KEEP.default),
    trainType: 'militia',
    trainProgress: 0,
  };
  // The roster it may actually build, not a hopeful default: `trainableUnit`
  // falls back to something the faction has unlocked, which is what stops a
  // captured — or here, a raised — yard sitting on a type it can never finish.
  if (SITES[site.kind].train) site.trainType = trainableUnit(site, state.mods[by]);
  state.sites.push(site);

  // A SITE APPEARED, so every derived per-site map is stale at once. `adj` is
  // hex reach, which nothing recomputes on its own because the site list used to
  // be fixed for the whole battle; occupancy decides what may be marched
  // through, and a building that did not deny its hex would be scenery.
  //
  // INFLUENCE WAS ONCE THE THIRD AND MISSED. The comment here said "both" and
  // fixed two of three, so a farm you raised painted no territory at all until
  // some unrelated capture elsewhere happened to re-trigger the flood — the
  // board simply did not show the ground you had just paid for. VISION IS NOW
  // A FOURTH, and the same bug aimed squarely at its flagship use: miss it
  // here and a watchtower you BUILD grants no sight until an unrelated capture
  // happens. All four are invalidated by exactly the same events and belong at
  // the same call sites; `sim.js siegePhase` runs the same set on a flip.
  recomputeReach(state.sites);
  recomputeOccupancy(state);
  recomputeInfluence(state);
  recomputeVision(state);
  return null;
}

/** `pb01`, `eb02`… — the same shape mapgen's ids have, so nothing downstream can
 *  tell a built site from a generated one by its name. Counts existing ids
 *  rather than keeping a counter on state, because a counter is one more thing a
 *  resumed battle would have to carry and get right. */
function nextBuildId(state, kind) {
  const tag = kind === 'stronghold' ? 's' : kind === 'trainingGround' ? 'y' : 'f';
  const prefix = 'b';
  let n = 1;
  const taken = new Set(state.sites.map((s) => s.id));
  let id = `${prefix}${tag}${String(n).padStart(2, '0')}`;
  while (taken.has(id)) { n++; id = `${prefix}${tag}${String(n).padStart(2, '0')}`; }
  return id;
}
