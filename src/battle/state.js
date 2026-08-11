// Battle state factory and the canonical state shape.
//
// State is PURE DATA: plain objects and arrays only. No classes, no functions,
// no Sets/Maps, no DOM refs. JSON.stringify(state) is a complete snapshot,
// which is what gives us instant retry, mid-battle resume, and byte-comparable
// determinism tests.
// PURE.
import {
  SITES, SITE_LEVELS, BOOSTERS, RALLY_KEEP, MOVEMENT,
} from '../content/balance.js';
import { distance } from '../core/hex.js';
// The per-hex layer. state.js owns the SHAPE of a battle; occupancy.js owns the
// questions you ask about one hex of it, so `isBlocked` lives there now and is
// re-exported here for the consumers that have always imported it from state.
import { recomputeOccupancy, blockedSet, isBlocked } from './occupancy.js';
import { recomputeVision } from './vision.js';
export { blockedSet, isBlocked, recomputeOccupancy };
// The small readouts below (siteById, armySize, rally helpers, ...) split out
// to ./siteinfo.js for the line budget, the same way isBlocked did to
// ./occupancy.js above; re-exported so nothing that imports them from here
// has to know that file exists. `clampRallyKeep` is imported (not just
// re-exported) because `createBattleState` below calls it directly.
import {
  siteById, hexKey, armySize, sitesOwned, siteControlFraction, castleSealed,
  effectiveLevel, upgradeProgress, buildProgress, clampRallyKeep, rallyKeepOf,
  rallyTargetsOf, ralliesTo,
} from './siteinfo.js';
export {
  siteById, hexKey, armySize, sitesOwned, siteControlFraction, castleSealed,
  effectiveLevel, upgradeProgress, buildProgress, clampRallyKeep, rallyKeepOf,
  rallyTargetsOf, ralliesTo,
};
import { emptyComp, addComp } from './combat.js';
import { TICK_HZ } from '../core/loop.js';

/**
 * @typedef {object} Site
 * @property {string} id
 * @property {'farm'|'trainingGround'|'stronghold'|'camp'|'castle'} kind
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

  const state = {
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

    /** FOG OF WAR — the sight half. `{ player: {hexKey: 1, ...}, enemy: {...} }`,
     *  built by battle/vision.js `recomputeVision` at the same three events
     *  influence and occupancy above are (a site changes hands, is built, or
     *  the battle starts). Buildings see; squads do not — see that file. Left
     *  empty here rather than computed, matching `influence`'s own pattern:
     *  `createBattleState` is called directly by fixtures that never touch
     *  `startBattle`, and an empty sight map is the honest answer for a state
     *  nothing has painted yet. */
    vision: { player: {}, enemy: {} },
    /** FOG OF WAR — the memory half. `{ player: {siteId: owner}, enemy: {...} }`,
     *  the LAST-KNOWN owner of every site either side has ever actually seen.
     *  Unlike every other derived map on this object, `recomputeVision` does
     *  NOT rebuild this from scratch — it only ever adds an entry or updates
     *  one currently in sight, so a site that drops out of vision keeps
     *  whatever was last true of it instead of vanishing or flickering. */
    seen: { player: {}, enemy: {} },

    /** UI writes intents here; the sim drains them at the top of each tick.
     *  Presentation can therefore never corrupt the simulation. */
    commands: [],
    /** The sim pushes notifications here; main.js emits them AFTER the tick,
     *  so a listener can never mutate state mid-iteration. */
    events: [],

    ai: { nextThinkTick: 0, activeAttacks: [], srcCooldown: {}, learnedPlayerComp: emptyComp() },
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
  // BUILT HERE, not only in `startBattle`. Occupancy is derived from the sites
  // this function just created, and a state without it is a battle where no base
  // blocks anything — which fails silently, and did: a test fixture that called
  // this directly marched armies straight through an enemy stronghold.
  recomputeOccupancy(state);
  // Vision has the identical hazard and fails in a MORE convincing way: the
  // empty map above is a board where `canSee` is false for every hex, so every
  // enemy site resolves to a ghost and every enemy squad vanishes. That reads
  // exactly like fog working perfectly rather than like fog missing, which is
  // the sort of wrong that survives a review.
  recomputeVision(state);
  return state;
}

// The small shared readouts used across the battle modules — siteById,
// armySize, the rally helpers, and friends — live in ./siteinfo.js now; see
// the import/re-export pair at the top of this file.
