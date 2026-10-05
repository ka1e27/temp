// Phase 9 (docs/PLAN-PHASE9.md §9A, §9C): the challenge modes (the Daily, Scenarios) and the lasting record's cosmetics. Every number
// lives here with its reason; read by game/meta/challenges.js (the sandboxed game), meta/daily.js (the seed), meta/challengesState.js
// (the record, streaks, banners, the main-game reward). Scenarios themselves are in config/scenarios.js.
//
// NOTE the name: config/edicts.js already has CHALLENGE_LIST / CHALLENGES (the Phase 5 founding Challenges). This file's exports are
// CHALLENGE_MODE, DAILY, BANNERS so the two never clash.

export const CHALLENGE_MODE = Object.freeze({
  saveKey: 'hexdominion.v2.challenge',   // the running challenge game (never the realm's 'hexdominion.v2'); the app layer stores it
  recordKey: 'hexdominion.v2.record',    // the lasting record (daily results, scenario stars, banners)
  // A small continent (PLAN §9A "about 10 regions"): 30x24 with 10 requested regions gives 10-13 (worldgen fills the land).
  world: Object.freeze({ cols: 30, rows: 24, regionCount: 10, ladderSpan: 1.2 }),
  // ladderSpan: the enemy depth ladder of a small continent runs 1..1+span (2 left capitals 25-60 min away for the bot; 1.2 = 2-15 min) (the realm's runs 1..7 over 28+ regions): a Daily is a
  // short, even climb, not the whole late game squeezed into ten regions (progression.js enemyDepth reads world.ladderSpan)
  minRegions: 9, maxRegions: 13,         // a daily world outside this is skipped for the next candidate seed
  minRivalRegions: 3,                    // ... and one with fewer rival regions than this (a 0-rival continent was seen)
  conquerMinPlainRivals: 3,              // a conquer Daily skips worlds with fewer non-capital rival regions (the bot's 43-min outliers had 0-1)
  seedTries: 40,                         // candidate worlds per date before falling back to the last one tried (never seen beyond 6)
  maxActiveSec: 3600,                    // a challenge that runs an hour of active play has failed (no score); keeps records sane
  logMax: 60,                            // battles kept in the challenge's battle log (the share text shows at most shareMax)
  shareMax: 12,                          // battle marks in a share line
  // The calm of a sandbox: no random raids (only the scripted ones), no Bounty Board, no world events. Folded by edictMods (hook).
  baseMods: Object.freeze({ raids: false }),
  unlockConquests: 1,                    // the Challenges open after the first conquest beyond the home region (PLAN §9A), or in any later dynasty
  telegraphSec: 20,                      // a scripted raid's warning (FRONTIER.telegraphSec is the realm's; a challenge reads this)
});

/** The goal tracker's progress line for a one-target goal (Phase 10B: "0/1 taken" read like a counter). */
export const GOAL_PROGRESS_TEXT = Object.freeze({
  capital: Object.freeze({ open: 'Capital: not yet taken', done: 'Capital taken' }),
  region: Object.freeze({ open: 'Not yet taken', done: 'Taken' }),
});

/** Goal kinds, the text templates the UI shows ({n}, {max}, {sec}, {region}, {faction}). Built by meta/challenges.js goalText. */
export const GOAL_TEXT = Object.freeze({
  conquer: 'Conquer the continent',
  capital: 'Topple {faction}\'s capital, {region}',
  region: 'Take {region}',
  regions: 'Take {n} regions: {list}',
  wins: 'Win {n} battles with at most {max} lost',
  holdout: 'Hold out against {n} raids without losing a region',
  survive: 'Hold every region for {min} minutes',
  gold: 'Earn as much gold as you can in {min} minutes',
});

// The Daily (§9A). Deterministic from the date: every pick below is a seeded hash of (date, purpose).
export const DAILY = Object.freeze({
  epoch: 20261001,                       // Daily #1 (share text "Hex Dominion Daily #N"); dates before it still play, numbered <= 0
  // The Edict pool: every Edict that means something on a small continent with no Bounty Board, Festivals or dynasty (Bounty
  // Hunters and Grand Festival would be blank days). Standard rules ('none') is one more entry.
  edicts: Object.freeze(['none', 'ageOfIron', 'merchantPrinces', 'longWinter', 'ironFrontier', 'ageOfDragons', 'warriorKings', 'openRoads']),
  // Boons that always do something in a short sandbox (no streak, no Quick Conquest, no random raids, no economy-only ones).
  boons: Object.freeze(['hitAndRun', 'engineers', 'rallyHorns', 'ironRations', 'bannerBearer', 'pathfinder', 'scorchedEarth',
    'turncoats', 'ambushers', 'siegecraft', 'secondWind', 'phalanx', 'vanguard', 'supplyWagons', 'warDrums', 'towerSappers']),
  boonCount: Object.freeze([2, 3]),      // 2 or 3 fixed Boons (PLAN §9A), chosen by the date
  relicChance: 0.4,                      // "sometimes a Relic"
  relics: Object.freeze(['dragonBanner', 'hornOfAges', 'emberHeart', 'sundial', 'twinCrowns']),
  generals: Object.freeze(['marshal', 'crimson', 'violet', 'amber']),
  generalLevel: 4,                       // the preset General: level 4 (two skill picks, option by the date)
  // Goals and their weights. A goal is always reachable: the world check below guarantees the target exists and is attackable.
  goals: Object.freeze([
    Object.freeze({ kind: 'conquer', weight: 3 }),
    Object.freeze({ kind: 'capital', weight: 3 }),
    Object.freeze({ kind: 'wins', weight: 2, n: 8, max: 1 }),
    Object.freeze({ kind: 'holdout', weight: 2, n: 4 }),
  ]),
  // The start (PLAN contract "start troops"): a War Council already bought, so the day is about the battles, not the waiting.
  // Tuned with tools/challengeBot.mjs so the bot clears every goal in roughly 6-15 minutes of active play.
  start: Object.freeze({
    gold: 400,
    upgrades: Object.freeze({ recruitment: 8, steel: 8, armour: 8, muster: 8, logistics: 3, rally: 3, firestorm: 2, bulwark: 1 }),
  }),
  // a conquer day takes all three rival capitals: their Gates hold half the garrison (edictMods capitalGateTroopMult, the Kingmaker
  // Legacy key), so the day stays near 10-15 minutes (full Gates left the bot 25-45 minute outliers)
  conquerMods: Object.freeze({ capitalGateTroopMult: 0.5 }),
  // holdout: the scripted raids (first at firstSec of active play, then every everySec), against the player's border regions
  holdout: Object.freeze({ firstSec: 45, everySec: 70, mult: 0.8 }),
  wins: Object.freeze({ firstRaidSec: 90, everySec: 120, raids: 3 }), // a 'wins' day also sends a few raids (defenses count as battles)
});

// Scoring (PLAN §9A): time is the score (lower is better), crowns the tiebreak. `crownRating` (the share line's crowns) is the crowns
// earned per battle won, rounded, 0..3.
export const SCORING = Object.freeze({
  secPerCrown: 0,                        // crowns never buy time: a pure tiebreak (kept as a knob for a later "crowns are worth N s")
});

// The record (§9A history, §9C cosmetics).
export const RECORD = Object.freeze({
  historyMax: 400,                       // daily results kept (a year and a bit; the calendar shows past days)
  rewardRenown: 1,                       // a daily completed: +1 Renown to the current dynasty, at most once per date (PLAN §9A)
  rewardedMax: 60,                       // reward dates remembered (only "today" can be claimed, so a short list is enough)
});

// Realm banner styles (§9C). `unlock`: how each is earned. Purely visual (the integration engineer draws them).
export const BANNERS = Object.freeze([
  Object.freeze({ id: 'plain', name: 'Plain', unlock: Object.freeze({ kind: 'always' }), text: 'Always yours' }),
  Object.freeze({ id: 'ember', name: 'Ember', unlock: Object.freeze({ kind: 'streak', n: 7 }), text: 'A 7-day Daily streak' }),
  Object.freeze({ id: 'frost', name: 'Frost', unlock: Object.freeze({ kind: 'streak', n: 30 }), text: 'A 30-day Daily streak' }),
  Object.freeze({ id: 'gilded', name: 'Gilded', unlock: Object.freeze({ kind: 'stars', n: 18 }), text: 'All 18 scenario stars' }),
  Object.freeze({ id: 'ashenBone', name: 'Ashen Bone', unlock: Object.freeze({ kind: 'deedGold', n: 1 }), text: 'A Deed at its gold tier' }),
]);
