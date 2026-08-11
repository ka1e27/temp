// Battle state factory and the canonical state shape.
//
// State is PURE DATA: plain objects and arrays only. No classes, no functions,
// no Sets/Maps, no DOM refs. JSON.stringify(state) is a complete snapshot,
// which is what gives us instant retry, mid-battle resume, and byte-comparable
// determinism tests.
// PURE.
import {
  SITES, SITE_LEVELS, SITE_UPGRADE, BOOSTERS, UNIT_IDS, RALLY_KEEP, MOVEMENT,
} from '../content/balance.js';
import { distance } from '../core/hex.js';
import { emptyComp, addComp } from './combat.js';
import { TICK_HZ } from '../core/loop.js';

/**
 * @typedef {object} Site
 * @property {string} id
 * @property {'farm'|'stronghold'|'camp'|'castle'} kind
 * @property {[number,number]} hex
 * @property {'player'|'enemy'|'neutral'} owner
 * @property {number} level                1..3
 * @property {Record<string,number>} garrison   units inside, belonging to owner
 * @property {number} hp                   structure integrity
 * @property {number} hpMax
 * @property {string} trainType            unit id this site trains
 * @property {number} trainProgress        0..1
 * @property {number} upgradeTicksLeft     >0 while building (produces at OLD level)
 * @property {?{owner:string, comp:Object}} siege  hostile force grinding hp down
 * @property {number} shieldTicks          Emergency Fortify
 * @property {string[]} rallyTargets       auto-send destinations, fed in turn
 * @property {number} rallyCursor          which of them is next; sim-owned
 * @property {number} rallyKeep            troops the rally leaves at home
 * @property {string[]} adj                sites within MOVEMENT.reachHexes — see recomputeReach
 */

/**
 * @typedef {object} Squad
 * @property {number} id
 * @property {'player'|'enemy'} owner
 * @property {string} from
 * @property {string} to
 * @property {Record<string,number>} comp
 * @property {number} spawnTick
 * @property {number} arriveTick   computed ONCE at spawn; movement is never integrated
 * @property {boolean} retreating  retreating forces do not fight and cannot be intercepted
 */

const sec = (s) => Math.round(s * TICK_HZ);
/** `[q,r]` -> `{q,r}`. Local so ./influence.js need not be imported here. */
const asHexT = (h) => ({ q: h[0], r: h[1] });

function makeFaction() {
  return {
    goldCg: 0,
    trainBoostTicks: 0,
    unitsLost: 0,
    unitsKilled: 0,
    peakArmy: 0,
    goldEarnedCg: 0,
    // unit id -> the tick a commission of it is allowed again. Faction-wide and
    // sim-owned, so it survives a resume and replays from a command log; a
    // cooldown parked in the HUD would do neither.
    recruitReadyTick: {},
  };
}

/**
 * The contract delivers boosters as an ARRAY of {id, charges} — that is what
 * meta/boosters.js `toConfigBoosters` produces, and sorting it keeps the
 * configHash stable. This once read `available[id]` against that array, which
 * silently yields undefined for every id, so no battle ever had a single
 * booster charge. Be permissive here (a plain map is also accepted) and strict
 * in `assertBattleConfig`, so a malformed producer fails loudly at the seam
 * rather than quietly losing the player's purchases.
 */
function makeBoosters(available) {
  const granted = new Map();
  if (Array.isArray(available)) {
    for (const entry of available) {
      if (!entry) continue;
      const id = typeof entry === 'string' ? entry : entry.id;
      const n = typeof entry === 'string' ? 1 : entry.charges;
      if (id && n > 0) granted.set(id, (granted.get(id) ?? 0) + n);
    }
  } else if (available && typeof available === 'object') {
    for (const [id, n] of Object.entries(available)) if (n > 0) granted.set(id, n);
  }

  const out = {};
  for (const [id, spec] of Object.entries(BOOSTERS)) {
    const n = granted.get(id) ?? 0;
    if (!n) continue;
    out[id] = { charges: n, max: n, used: 0, cdTicks: 0, cdMax: sec(spec.cooldownSec) };
  }
  return out;
}

/**
 * REACH: which sites are near enough to be each other's business.
 *
 * `adj` was an authored graph and a send was legal only along an edge of it.
 * Armies march freely now, so a fixed graph would be a fiction — but DELETING
 * the field would be worse than a fiction, because ~30 consumers read it and
 * every one fails SILENTLY on an empty array: an AI with no neighbours emits no
 * orders, a bot with no neighbours never attacks, and every test still passes.
 *
 * So the field survives and its meaning changes: every site within
 * `MOVEMENT.reachHexes`, straight-line. That is what the AI and the bot always
 * wanted — "what is near me" — and it needs no pathfinding, so it is cheap to
 * recompute whenever the site list changes. Legality moved to where free
 * movement makes it interesting: `cmdSend` asks whether a PATH exists.
 *
 * Sorted, because AI iteration must not depend on placement order.
 */
export function recomputeReach(sites) {
  for (const s of sites) s.adj = [];
  for (let i = 0; i < sites.length; i++) {
    for (let j = i + 1; j < sites.length; j++) {
      const a = sites[i];
      const b = sites[j];
      if (distance(asHexT(a.hex), asHexT(b.hex)) > MOVEMENT.reachHexes) continue;
      a.adj.push(b.id);
      b.adj.push(a.id);
    }
  }
  for (const s of sites) s.adj.sort();
  return sites;
}

/**
 * Build a live battle from a validated BattleConfig.
 * @param {object} config
 */
export function createBattleState(config) {
  const sites = config.sites.map((s) => {
    const spec = SITES[s.kind];
    const lvl = s.level ?? 1;
    const hpMax = spec.hp * SITE_LEVELS[lvl - 1].hp;
    return {
      id: s.id,
      kind: s.kind,
      hex: [...s.hex],
      owner: s.owner,
      level: lvl,
      garrison: { ...emptyComp(), ...(s.garrison ?? {}) },
      hp: s.hp ?? hpMax,
      hpMax,
      trainType: s.trainType ?? 'militia',
      trainProgress: 0,
      upgradeTicksLeft: 0,
      siege: null,
      shieldTicks: 0,
      // A LIST, because one site may feed several neighbours in turn — see
      // battle/rally.js. `rallyCursor` is which one is next and belongs to the
      // sim, never to the view, or a replay desynchronises from its log.
      rallyTargets: [],
      rallyCursor: 0,
      // Per-site, because the right hold-back differs by role. The player's
      // standing preference crosses the seam in `rules.rallyKeepDefault`, so
      // "leave nothing behind" is a setting rather than forty clicks a battle.
      rallyKeep: clampRallyKeep(config.rules?.rallyKeepDefault ?? RALLY_KEEP.default),
      adj: [],
    };
  });

  recomputeReach(sites);

  const factions = { player: makeFaction(), enemy: makeFaction() };
  factions.player.goldCg = Math.round(config.player.startGold * 100);
  factions.enemy.goldCg = Math.round(config.enemy.startGold * 100);

  // Deploy each side's expeditionary force into its home site. This is the
  // meta layer's answer to the enemy starting with more land: your standing
  // army grows with every region you hold.
  for (const faction of ['player', 'enemy']) {
    const homeKind = faction === 'player' ? 'camp' : 'castle';
    const home = sites.find((s) => s.kind === homeKind && s.owner === faction);
    if (home) home.garrison = addComp(home.garrison, config[faction].expedition ?? emptyComp());
  }

  return {
    contractVersion: config.contractVersion,
    battleId: config.battleId,
    configHash: config.configHash ?? null,
    regionId: config.region?.id ?? null,
    seed: config.seed,
    rngState: config.seed >>> 0,

    tick: 0,
    status: 'running',

    grid: {
      cols: config.grid.cols,
      rows: config.grid.rows,
      blocked: (config.grid.blocked ?? []).map(([q, r]) => `${q},${r}`),
    },

    sites,
    squads: [],
    nextSquadId: 1,

    factions,
    mods: { player: config.player, enemy: config.enemy },

    /** hexKey -> 'player' | 'enemy' | 'neutral' | 'contested'. Recomputed only
     *  on ownership change, never per frame. */
    influence: {},
    /** hexKey -> owner faction of the site standing there (./occupancy.js).
     *  What makes "you cannot march through a base" a rule the pathfinder can
     *  answer in O(1) instead of a scan of every site per hex per expansion. */
    occupancy: {},
    /** Bumped whenever a per-hex map is rebuilt. Read by the path cache and by
     *  the renderer's `signature()` — which declared it long before anything
     *  wrote it. */
    influenceVersion: 0,

    /** UI writes intents here; the sim drains them at the top of each tick.
     *  Presentation can therefore never corrupt the simulation. */
    commands: [],
    /** The sim pushes notifications here; main.js emits them AFTER the tick,
     *  so a listener can never mutate state mid-iteration. */
    events: [],

    ai: { nextThinkTick: 0, activeAttacks: [], srcCooldown: {}, seenPlayerComp: emptyComp() },
    boosters: makeBoosters(config.boosters),

    rules: {
      victory: config.rules.victory ?? 'capture-castle',
      hardCapTicks: Math.round(config.rules.hardCapMs / (1000 / TICK_HZ)),
      aiTier: config.rules.aiTier ?? 1,
      // The fraction of the region's non-castle sites a faction must hold
      // before its siege of the castle can actually complete — see
      // `castleSealed` below and sim.js `siegePhase`. 0 (the default) means
      // "no gate", which is exactly today's behaviour.
      castleGateFrac: config.rules.castleGateFrac ?? 0,
      /**
       * The player's standing hold-back, carried so that CAPTURED sites get it
       * too — `sim.js capture()` reads it from here.
       *
       * It was missing, and the bug it caused is the reason this object is worth
       * a comment: `state.rules` is a hand-picked subset of `config.rules`, not
       * a copy, so a field that both ends use only works if someone remembers to
       * list it. Site creation above reads `config.rules` directly and was
       * correct; capture reads `state.rules` and silently fell back to
       * RALLY_KEEP.default. A player who set "leave nothing behind" got it on
       * the three sites they landed with and 8 on every site they took, which is
       * exactly backwards — the ones you take are the ones you have not had time
       * to configure.
       */
      rallyKeepDefault: clampRallyKeep(config.rules.rallyKeepDefault ?? RALLY_KEEP.default),
      /**
       * WHICH RUNG OF THE ENDLESS LADDER THIS IS, or null for an ordinary battle
       * — `{depth, mutators[]}`, straight off the config (contract v6).
       *
       * The sim does not read it and must not: every mutator's EFFECT is already
       * baked into the mods, the sites and the gate by meta/incursion.js, so an
       * engine branch on `incursion` would be a second place that decides what a
       * mutator does. It is listed here — rather than left off the subset above,
       * which is the trap this object's other comment is about — because the HUD
       * and the dev overlay have to be able to NAME the fight they are drawing,
       * and they only ever see `state`.
       */
      incursion: config.rules.incursion
        ? { depth: config.rules.incursion.depth, mutators: [...config.rules.incursion.mutators] }
        : null,
    },

    meta: { lastFlipTick: 0, attritionStage: 0 },
  };
}

// --- small shared helpers used across the battle modules ------------------

export const siteById = (state, id) => state.sites.find((s) => s.id === id);

export const hexKey = (hex) => `${hex[0]},${hex[1]}`;

/**
 * Impassable terrain — mountains and the region's shape mask.
 *
 * Backed by a Set rather than the array's own `includes`, and the reason is A*:
 * `findPath` asks this once per NEIGHBOUR per expansion, so a linear scan over a
 * few hundred strings was the inner loop of every path in the game. The cache is
 * keyed on the `blocked` ARRAY's identity, which is exactly right — mapgen
 * assigns it once and nothing mutates it in place, so a new array (a resumed
 * battle, a second battle in one process) misses and rebuilds.
 *
 * WeakMap'd rather than stored on state, because state is pure JSON: a Set on it
 * would not survive `JSON.stringify`, which is the whole save format.
 */
const blockedCache = new WeakMap();
export function blockedSet(state) {
  const list = state.grid.blocked;
  let set = blockedCache.get(list);
  if (!set) { set = new Set(list); blockedCache.set(list, set); }
  return set;
}

export const isBlocked = (state, q, r) => blockedSet(state).has(`${q},${r}`);

/** Total units a faction has anywhere: garrisons, sieges, and squads in flight. */
export function armySize(state, faction) {
  let n = 0;
  const count = (c) => UNIT_IDS.reduce((a, u) => a + (c[u] || 0), 0);
  for (const s of state.sites) {
    if (s.owner === faction) n += count(s.garrison);
    if (s.siege?.owner === faction) n += count(s.siege.comp);
  }
  for (const sq of state.squads) if (sq.owner === faction) n += count(sq.comp);
  return n;
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
 * REMAINING, and `cmdUpgrade` raises `site.level` at the moment it starts the
 * build, so the step being paid for is always `SITE_UPGRADE[level - 2]`. Two
 * surfaces draw this (the panel bar and the board's build ring) and a second
 * copy of that off-by-two is exactly the kind of thing that goes wrong once the
 * ladder is extended — which it already has been.
 */
export function upgradeProgress(site) {
  const left = site?.upgradeTicksLeft ?? 0;
  if (left <= 0) return 0;
  const spec = SITE_UPGRADE[site.level - 2];
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
