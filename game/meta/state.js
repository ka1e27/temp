// The save file. Pure: no DOM, no Date.now, no Math.random, no storage globals.
// See docs/ARCHITECTURE.md §5 for the exact GameState contract this module
// implements.

import { createChronicle } from './chronicleState.js';
import { defaultFrontier } from './frontierState.js';
import { defaultGenerals } from './generalsState.js';
import { defaultRenown } from './renownState.js';
import { defaultBoons } from './featuresState.js';
import { defaultWorldEvents } from './eventsState.js'; // (a cycle frontierState -> state is safe: it only reads PLAYER_FACTION inside functions)
import { defaultBounties } from './bountiesState.js';
import { defaultStreak } from './streak.js';
import { defaultGrudges, defaultTrophies } from './grudges.js'; // (the same safe cycle: grudges reads PLAYER_FACTION inside functions)
import { deedBonuses } from './deeds.js';
import { earnRenown } from './renownState.js';
import { edictMods, defaultEdict } from './edicts.js'; // the leaf (PLAN-PHASE5): Patronage and Old Roads at a dynasty's start
import { PROSPERITY } from '../config/prosperity.js';
import { defaultBoons2, defaultRelics } from './boonsState.js'; // Phase 7 (PLAN-PHASE7): Boons and Relics, per dynasty
import { placeRelics } from './relics.js';
import { defaultUnrest } from './unrestState.js'; // PLAN-PHASE11b: Unrest, per continent

/** Faction id that always identifies the player's own realm (see FACTIONS). */
export const PLAYER_FACTION = 0;

/**
 * @typedef {Object} GameStats
 * @property {number} battlesWon
 * @property {number} battlesLost
 * @property {number} regionsConquered
 * @property {number} goldEarned
 * @property {number} troopsSent
 * @property {number} settlementsTaken
 * @property {number|null} bestBattleSec
 * @property {number} playSec
 * @property {number} surrenders
 * @property {number} crownsEarned        lifetime battle crowns (DESIGN §4.8); survives dynasties
 */

/**
 * @typedef {Object} GameSettings
 * @property {boolean} sound
 * @property {boolean} reduceMotion      starts from the OS prefers-reduced-motion until the player chooses (reduceMotionSet)
 * @property {boolean} reduceMotionSet    the player has flipped the switch themselves: the OS preference no longer decides
 * @property {boolean} hints
 * @property {0.5|1|2|3} speed          battle speed; 0.5 is an assist (DESIGN §7.5a)
 * @property {boolean} leaderVoices       rival leaders speak short lines (DESIGN §3.6)
 * @property {boolean} slowBattles        Settings > Slow battles: the battle speed button also offers 0.5x (DESIGN 7.5a); off, it cycles 1x, 2x, 3x
 * @property {boolean} music              the generative score on/off (master `sound` still mutes everything)
 * @property {number} musicVolume         0..1, the score's own volume under the master
 * @property {number} sfxVolume           0..1, the sound effects' own volume under the master
 */

/**
 * Crowns a region was conquered with (DESIGN §4.8). Fixed once stored.
 * @typedef {Object} RegionCrowns
 * @property {boolean} victory
 * @property {boolean} swift
 * @property {boolean} unbroken
 */

/**
 * @typedef {Object} GameState
 * @property {1} version
 * @property {number} seed                world seed for the current dynasty
 * @property {{ level: number, stars: number }} dynasty
 * @property {number} gold
 * @property {number[]} owner             owner faction id per region id
 * @property {(number|null)[]} conqueredAt ms timestamp per region id, null if never player-conquered
 * @property {(RegionCrowns|null)[]} crowns  per region id, null until conquered with crowns (this dynasty only)
 * @property {number[]} metFactions       faction ids whose leader has already made first contact (this dynasty only)
 * @property {Object<string, {scouted: boolean, sabotage: number}>} intel  per region id, only regions the player paid to scout or sabotage (meta/intelState.js; this dynasty only)
 * @property {{ idleSec: number, target: number|null, thin: Object<string, number>, toasted: boolean }} [unrest]  PLAN-PHASE11b: Unrest (meta/unrestState.js; this continent only)
 * @property {number[]} prosperity        per region id, 0..3 prosperity level last reported (meta/prosperity.js; this dynasty only)
 * @property {Object<string, {type: string, level: number}[]>} works  per region id, this dynasty only (meta/worksEffects.js)
 * @property {Object<string, number>} upgrades  levels, missing = 0
 * @property {GameStats} stats
 * @property {GameSettings} settings
 * @property {import('./chronicleState.js').Chronicle} chronicle  the realm's story: this dynasty's chapter plus lifetime highlights (meta/chronicle.js); lifetime state, kept by Found a Dynasty
 * @property {{ seen: Object<string, boolean>, done: boolean }} tutorial  the tutorial steps the player has seen or done (ids like 'W0', 'B1'; see
 *   scenes/timing.js TUTORIAL_STEPS); `done` switches every hint off. Saves from before this shape ({ step, done }) are migrated by save.js.
 * @property {number} saveSeq             rises with every write of the save: two tabs of the same origin must not overwrite each other (app/autosave.js)
 * @property {number} lastSeen            ms timestamp of last save
 * @property {object[]} battles         every running battle (BattleRun[], ARCHITECTURE 10.2), for resume; replaces `battle`
 */

/** @returns {GameStats} */
export function defaultStats() {
  return {
    battlesWon: 0,
    battlesLost: 0,
    regionsConquered: 0,
    goldEarned: 0,
    troopsSent: 0,
    settlementsTaken: 0,
    bestBattleSec: null,
    playSec: 0,
    surrenders: 0,
    crownsEarned: 0,
  };
}

/** @returns {GameSettings} */
export function defaultSettings() {
  return {
    sound: true, reduceMotion: false, reduceMotionSet: false, hints: true, speed: 1, slowBattles: false, leaderVoices: true, music: true, musicVolume: 0.4, sfxVolume: 1,
  };
}

/**
 * (Re)initialise region ownership from a freshly generated World. This is
 * what createGame uses internally; it is also exported on its own so that
 * whoever wires up progression.js's foundDynasty (which only takes
 * `(state, newSeed)` per the architecture contract, before a new World
 * exists) can populate `owner`/`conqueredAt` once the new continent has been
 * generated: `resetRegions(state, newWorld, now)`.
 * @param {GameState} state
 * @param {import('../world/generate.js').World} world
 * @param {number} now
 * @returns {GameState}
 */
export function resetRegions(state, world, now) {
  state.owner = world.regions.map((r) => r.faction);
  // The start region is owned from the very first frame, not "conquered" —
  // but it still needs a timestamp so UI code that keys off conqueredAt to
  // mean "owned by the player" (e.g. a "held since" display) doesn't have to
  // special-case region 0. Every other region stays null until conquer().
  state.conqueredAt = world.regions.map((r) => (r.faction === PLAYER_FACTION ? now : null));
  // Per-dynasty feature memory (crowns.js / leaders.js): a new continent starts with no crowns
  // and no leader met, so founding a dynasty must go through here too.
  state.crowns = world.regions.map(() => null);
  state.metFactions = [];
  // Scout / sabotage intel and prosperity levels belong to this continent too.
  state.intel = {};
  state.unrest = defaultUnrest(); // PLAN-PHASE11b: no Unrest on a new continent
  state.prosperity = [];
  // Region Works (DESIGN 5.8) are built on this continent's regions: a new continent starts with none.
  state.works = {};
  // the Living Frontier (ARCHITECTURE 10.2) belongs to this continent: the raid clock, cooldowns and grace start over
  state.frontier = defaultFrontier();
  state.occupation = {};
  state.forts = {};
  state.militia = {};
  // Renown belongs to the dynasty (DESIGN 10.12); the Generals do NOT reset here: they are lifetime progress
  state.renown = defaultRenown();
  // the Dragonslayer deed (PLAN-PHASE4 §4C): Renown at the start of every dynasty after the first (the deeds ride with the Generals)
  // ... and the Patronage Legacy node (PLAN-PHASE5 §5B)
  const em = edictMods(state);
  const startRenown = state.dynasty && state.dynasty.level > 1 ? deedBonuses(state).renownAtDynastyStart + em.startRenown : 0;
  if (startRenown > 0) earnRenown(state, startRenown, 'deed');
  // Old Roads (PLAN-PHASE5 §5B): the start region begins at a prosperity level, its tenure clock set to that level's threshold
  const startLevel = Math.min(PROSPERITY.maxLevel, em.startProsperity);
  if (startLevel > 0 && world.regions[world.startRegion]) {
    state.prosperity = world.regions.map(() => 0);
    state.prosperity[world.startRegion] = startLevel;
    state.conqueredAt[world.startRegion] = now - PROSPERITY.thresholdsMs[startLevel - 1] / em.prosperityRateMult;
  }
  state.boons = defaultBoons();
  state.worldEvents = defaultWorldEvents();
  // Phase 4 (PLAN-PHASE4): the Bounty Board, the Conquest Streak, the rivals' Grudges and the Trophies belong to this continent
  state.bounties = defaultBounties();
  state.streak = defaultStreak();
  state.grudges = defaultGrudges();
  state.trophies = defaultTrophies();
  // Phase 7 (PLAN-PHASE7): this continent's Boons and Relics start over (the lifetime Reliquary rides in `generals`); the Relics are placed
  state.boons2 = defaultBoons2();
  state.relics = defaultRelics();
  placeRelics(state, world);
  return state;
}

/**
 * @param {number} seed
 * @param {import('../world/generate.js').World} world
 * @param {number} now
 * @returns {GameState}
 */
export function createGame(seed, world, now) {
  const state = {
    version: 1,
    seed,
    dynasty: { level: 1, stars: 0 },
    gold: 0,
    owner: [],
    conqueredAt: [],
    // Rally is owned from the start (DESIGN §4.5); every other power starts
    // locked at level 0, represented by simply being absent from this map
    // (see ARCHITECTURE §5: "levels, missing = 0").
    upgrades: { rally: 1 },
    stats: defaultStats(),
    chronicle: createChronicle(),
    settings: defaultSettings(),
    tutorial: { seen: {}, done: false },
    saveSeq: 0,
    lastSeen: now,
    battles: [], // every running battle (ARCHITECTURE 10.2: BattleRun[]; replaces the single `battle`)
    // the Living Frontier (ARCHITECTURE 10.2): the raid clock, occupied regions, fortifications, militia
    frontier: defaultFrontier(),
    occupation: {},
    forts: {},
    militia: {},
    // Phase 2 (DESIGN 10.11, 10.12): the Generals persist across dynasties; Renown belongs to this dynasty
    generals: defaultGenerals(seed),
    renown: defaultRenown(),
    // Phase 3 (DESIGN 10.13): this dynasty's boons (Dragonscale) and world events
    boons: defaultBoons(),
    worldEvents: defaultWorldEvents(),
    // Phase 4 (PLAN-PHASE4): per dynasty; the lifetime Deeds live inside `generals` (meta/deeds.js)
    bounties: defaultBounties(),
    streak: defaultStreak(),
    grudges: defaultGrudges(),
    trophies: defaultTrophies(),
    // Phase 5 (PLAN-PHASE5): this dynasty's Edict and Challenges (the first dynasty plays by the standard rules)
    edict: defaultEdict(),
    rivals: [2, 3, 4], // PLAN-PHASE6 §6A: the rival line-up (the classic three in Dynasty 1; foundDynasty draws the next one)
  };
  return resetRegions(state, world, now);
}
