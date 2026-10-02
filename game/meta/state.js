// The save file. Pure: no DOM, no Date.now, no Math.random, no storage globals.
// See docs/ARCHITECTURE.md §5 for the exact GameState contract this module
// implements.

import { createChronicle } from './chronicleState.js';

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
 * @property {object|null} battle         in-progress BattleState, for resume
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
  state.prosperity = [];
  // Region Works (DESIGN 5.8) are built on this continent's regions: a new continent starts with none.
  state.works = {};
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
    battle: null,
  };
  return resetRegions(state, world, now);
}
