// Battle state factory and the canonical state shape.
//
// State is PURE DATA: plain objects and arrays only. No classes, no functions,
// no Sets/Maps, no DOM refs. JSON.stringify(state) is a complete snapshot,
// which is what gives us instant retry, mid-battle resume, and byte-comparable
// determinism tests.
// PURE.
import { SITES, SITE_LEVELS, BOOSTERS, UNIT_IDS, RALLY_KEEP } from '../content/balance.js';
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
 * @property {string[]} adj                adjacent site ids
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

function makeFaction() {
  return {
    goldCg: 0,
    trainBoostTicks: 0,
    unitsLost: 0,
    unitsKilled: 0,
    peakArmy: 0,
    goldEarnedCg: 0,
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

  const byId = Object.fromEntries(sites.map((s) => [s.id, s]));
  for (const [a, b] of config.adjacency) {
    if (!byId[a].adj.includes(b)) byId[a].adj.push(b);
    if (!byId[b].adj.includes(a)) byId[b].adj.push(a);
  }
  // Deterministic ordering: AI iteration must not depend on adjacency input order.
  for (const s of sites) s.adj.sort();

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
    },

    meta: { lastFlipTick: 0, attritionStage: 0 },
  };
}

// --- small shared helpers used across the battle modules ------------------

export const siteById = (state, id) => state.sites.find((s) => s.id === id);

export const hexKey = (hex) => `${hex[0]},${hex[1]}`;

export const isBlocked = (state, q, r) => state.grid.blocked.includes(`${q},${r}`);

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
