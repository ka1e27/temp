// Small shared readouts over a battle: sites, army counts, rally fields.
//
// Split out of ./state.js for the line budget and re-exported from there, so
// `import { siteById } from '../battle/state.js'` keeps resolving — same
// arrangement as ./occupancy.js, whose three exports state.js already
// imports-then-re-exports for the same reason.
// PURE.
import {
  SITE_UPGRADE, BUILD_COSTS, RALLY_KEEP, UNIT_IDS,
} from '../content/balance.js';
import { TICK_HZ } from '../core/loop.js';

const sec = (s) => Math.round(s * TICK_HZ);

export const siteById = (state, id) => state.sites.find((s) => s.id === id);

export const hexKey = (hex) => `${hex[0]},${hex[1]}`;

const bodies = (c) => (c ? UNIT_IDS.reduce((a, u) => a + (c[u] || 0), 0) : 0);

/**
 * WHERE A FACTION'S ARMY IS, not merely how big it is.
 *
 * `{ total, standing, marching }`. The split is ARRIVED versus IN TRANSIT,
 * because that is the question the number is worth asking: CLAUDE.md's own
 * harness analysis found the bot commanding 1,092 bodies with 239 of them
 * standing anywhere — 78% permanently walking — and treated it as a
 * first-order balance problem. No surface ever showed a player the same thing.
 *
 * FOUR BUCKETS, AND THE FOURTH IS WHY THIS FUNCTION EXISTS RATHER THAN A
 * SECOND LOOP. `armySize` counted garrisons, sieges and squads, and its own
 * docstring promised "anywhere" — but a column at a site it is assaulting is
 * off `state.squads` for `MELEE.seconds` and lives in `site.melee` (contract
 * v12), a bucket that did not exist when that sentence was written. So the
 * total dipped for six seconds every time anyone attacked anything. As a peak
 * statistic that is nearly invisible (a peak is a max over every tick, and
 * some other tick catches it); as a readout a player watches, a total that
 * falls when you commit to an assault is simply wrong.
 *
 * A CAMPED SQUAD IS STANDING, NOT MARCHING. It is on `state.squads` like a
 * column in flight and is holding ground like a garrison, so the `camped` flag
 * the sim already keys off is what separates them. Counting it as marching
 * would make "park a force on a hex" read as indecision.
 */
export function armyCensus(state, faction) {
  let standing = 0;
  let marching = 0;
  for (const s of state.sites) {
    if (s.owner === faction) standing += bodies(s.garrison);
    if (s.siege?.owner === faction) standing += bodies(s.siege.comp);
    if (s.melee?.owner === faction) standing += bodies(s.melee.comp);
  }
  for (const sq of state.squads) {
    if (sq.owner !== faction) continue;
    if (sq.camped) standing += bodies(sq.comp);
    else marching += bodies(sq.comp);
  }
  return { total: standing + marching, standing, marching };
}

/** Total units a faction has anywhere: garrisons, sieges, melees, squads.
 *  Expressed against `armyCensus` so there is exactly one fold and the total
 *  can never disagree with its own parts. */
export function armySize(state, faction) {
  return armyCensus(state, faction).total;
}

export function sitesOwned(state, faction) {
  return state.sites.filter((s) => s.owner === faction);
}

/** Fraction of the region's non-castle sites `faction` currently owns. This
 *  is the territory half of the castle gate (see `castleSealed`): a SITE
 *  count, not painted hexes, so it cannot be nudged by influence radius or
 *  contested bands — you either hold the place or you do not. */
export function siteControlFraction(state, faction) {
  const rest = state.sites.filter((s) => s.kind !== 'castle');
  if (!rest.length) return 1;
  return rest.filter((s) => s.owner === faction).length / rest.length;
}

/**
 * Is `castle` currently sealed against whoever is besieging it — i.e. its HP
 * cannot reach 0 no matter how long the siege runs, the same shape as
 * `breachSeconds() === Infinity` for an under-strength siege against a
 * stronghold (see battle/combat.js). A region with no gate (`castleGateFrac`
 * 0, the default) never seals; a castle with no active siege is never
 * "sealed" either, since the question does not apply.
 */
export function castleSealed(state, castle) {
  if (castle.kind !== 'castle' || !castle.siege) return false;
  const need = state.rules.castleGateFrac ?? 0;
  if (need <= 0) return false;
  return siteControlFraction(state, castle.siege.owner) < need;
}

/** Effective per-level spec for a site, accounting for an in-progress upgrade
 *  (which produces at the OLD level until it completes). */
export function effectiveLevel(site) {
  return site.upgradeTicksLeft > 0 ? Math.max(1, site.level - 1) : site.level;
}

/**
 * How far an in-progress site upgrade has got, 0..1 — and 0 when nothing is
 * building.
 *
 * The DENOMINATOR is the interesting part and it is why this is a function
 * rather than a division at each call site: the site only stores ticks
 * REMAINING, and `cmdUpgrade` raises `site.level` at the moment it *starts*
 * the build, so the step being paid for is always `SITE_UPGRADE[level - 2]`.
 * Two surfaces draw this (the panel bar and the board's build ring) and a
 * second copy of that off-by-two is exactly the kind of thing that goes
 * wrong once the ladder is extended — which it already has been.
 */
export function upgradeProgress(site) {
  const left = site?.upgradeTicksLeft ?? 0;
  if (left <= 0) return 0;
  const spec = SITE_UPGRADE[site.level - 2];
  const total = spec ? sec(spec.sec) : 0;
  return total > 0 ? Math.max(0, Math.min(1, 1 - left / total)) : 0;
}

/** How far a BUILD has got, 0..1 — 0 once nothing is going up. Same shape as
 *  `upgradeProgress`: the denominator (`BUILD_COSTS[kind].sec`) lives in
 *  content, not on the site, so this stays the one place it is divided. */
export function buildProgress(site) {
  const left = site?.buildTicksLeft ?? 0;
  if (left <= 0) return 0;
  const spec = BUILD_COSTS[site?.kind];
  const total = spec ? sec(spec.sec) : 0;
  return total > 0 ? Math.max(0, Math.min(1, 1 - left / total)) : 0;
}

/**
 * Coerce a rally hold-back to a legal value: a whole number inside the
 * RALLY_KEEP band. A missing value — a site resumed from a save written before
 * the field existed — falls back to the default, which is the old global, so
 * an old battle picks up exactly where it left off.
 */
export function clampRallyKeep(n) {
  if (n === null || n === undefined) return RALLY_KEEP.default;
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return RALLY_KEEP.default;
  return Math.min(RALLY_KEEP.max, Math.max(RALLY_KEEP.min, v));
}

/** How many troops a rallied site keeps at home before forwarding the rest. */
export const rallyKeepOf = (site) => clampRallyKeep(site.rallyKeep);

/**
 * A site's rally destinations, as an array, whatever shape it is stored in.
 *
 * Tolerant of the single-`rallyTarget` shape this replaced. A resume blob from
 * the older contract is discarded rather than migrated (meta/resume.js), so this
 * is not load-bearing for saves — it is here so that a hand-built test fixture
 * or an older snapshot reads as a one-target rally instead of as no rally at
 * all, which would fail silently rather than loudly.
 */
export function rallyTargetsOf(site) {
  if (Array.isArray(site?.rallyTargets)) return site.rallyTargets;
  return site?.rallyTarget ? [site.rallyTarget] : [];
}

/** Is `id` one of this site's rally destinations? */
export const ralliesTo = (site, id) => rallyTargetsOf(site).includes(id);
