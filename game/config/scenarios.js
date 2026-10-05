// Phase 9 (docs/PLAN-PHASE9.md §9B): the six handcrafted scenarios. Each is a seed plus overrides on a small continent, a fixed setup and
// a goal, rated 1-3 stars. Read by game/meta/scenarios.js (scenarioSpec). Every seed was chosen with tools/challengeBot.mjs so the
// setup reads as the plan's table says (see each `why`), and the star marks were set from the bot's own runs (game/tests/meta.phase9
// proves each is completable and that 3 stars are reachable): 1 star = the goal, 3 stars = demanding.
//
// Fields: seed; world (size, rivals); edict; boons; relic; general { kind, level, skills }; start { gold, upgrades }; setup { own,
// count, relicsOnMap }; mods (edictMods keys for this sandbox); goal { kind, target, sec, count }; raids [{ atSec, faction, mult }];
// stars [cond, cond, cond] (meta/challengeGoals.js starHolds: met, time, risen, unbroken, unbrokenShare, gold, crowns, losses, crown);
// unlock: null (always open) or a Codex topic id (game/app/codexTopics.js) the player must have discovered in the main game.
const ARMY = (n, extra = {}) => Object.freeze({ recruitment: n, steel: n, armour: n, muster: n, rally: 3, ...extra });
const NO_ECONOMY = Object.freeze({ raids: false, incomeMult: 0 }); // a pure battle: no income, nothing to buy, no random raids

export const SCENARIO_LIST = Object.freeze([
  Object.freeze({
    id: 'gatekeeper', name: 'The Gatekeeper', idea: 'Siege', icon: 'castle', unlock: null,
    blurb: 'A rival capital behind its Gate. Break the Gate, then take the keep.',
    seed: 17, world: Object.freeze({ ladderSpan: 2.5 }), edict: null, boons: Object.freeze([]), relic: null,
    general: Object.freeze({ kind: 'marshal', level: 3 }),
    start: Object.freeze({ gold: 0, upgrades: ARMY(4, { firestorm: 2 }) }),
    setup: Object.freeze({ own: 'allBut' }), mods: NO_ECONOMY,
    goal: Object.freeze({ kind: 'capital', target: 'nearestCapital' }),
    raids: Object.freeze([]),
    stars: Object.freeze([{ kind: 'met' }, { kind: 'time', sec: 180 }, { kind: 'time', sec: 150 }]),
  }),
  Object.freeze({
    id: 'holdTheLine', name: 'Hold the Line', idea: 'Defense', icon: 'shield', unlock: null,
    blurb: 'Three border regions, two rivals, wave after wave. Lose nothing for eight minutes.',
    seed: 3, world: Object.freeze({}), edict: null, boons: Object.freeze([]), relic: null,
    general: Object.freeze({ kind: 'marshal', level: 3 }),
    start: Object.freeze({ gold: 0, upgrades: ARMY(6, { bulwark: 2 }) }),
    setup: Object.freeze({ own: 'border', count: 3 }), mods: NO_ECONOMY,
    goal: Object.freeze({ kind: 'survive', sec: 480 }),
    raids: Object.freeze([30, 90, 150, 210, 270, 330, 390].map((atSec, i) => Object.freeze({ atSec, mult: 1 + i * 0.08 }))),
    stars: Object.freeze([{ kind: 'met' }, { kind: 'unbrokenShare', share: 0.5 }, { kind: 'unbroken' }]),
  }),
  Object.freeze({
    id: 'dragonHunt', name: 'Dragon Hunt', idea: 'The boss', icon: 'dragon', unlock: 'regionTypes',
    blurb: "The Dragon's Lair, and a small army. Time your Bulwark to its breath.",
    seed: 8, world: Object.freeze({ ladderSpan: 3 }), edict: null, boons: Object.freeze([]), relic: null,
    general: Object.freeze({ kind: 'marshal', level: 3 }),
    start: Object.freeze({ gold: 0, upgrades: ARMY(3, { bulwark: 2, firestorm: 1 }) }),
    setup: Object.freeze({ own: 'allBut' }), mods: NO_ECONOMY,
    goal: Object.freeze({ kind: 'region', target: 'dragon' }),
    raids: Object.freeze([]),
    stars: Object.freeze([{ kind: 'met' }, { kind: 'time', sec: 180 }, { kind: 'crown', crown: 'unbroken' }]),
  }),
  Object.freeze({
    id: 'fallenRise', name: 'The Fallen Rise', idea: 'The Ashen', icon: 'skullCrown', unlock: 'ashen',
    blurb: 'The Barrow Keep raises its dead. Burn them, or be buried by them.',
    seed: 12, world: Object.freeze({ rivals: Object.freeze([5, 3, 4]) }), edict: null, boons: Object.freeze(['gravebreaker']), relic: null,
    general: Object.freeze({ kind: 'marshal', level: 3 }),
    start: Object.freeze({ gold: 0, upgrades: ARMY(10, { firestorm: 3 }) }),
    setup: Object.freeze({ own: 'allBut' }), mods: NO_ECONOMY,
    goal: Object.freeze({ kind: 'capital', target: 'ashenCapital' }),
    raids: Object.freeze([]),
    stars: Object.freeze([{ kind: 'met' }, { kind: 'risen', max: 60 }, { kind: 'risen', max: 30 }]),
  }),
  Object.freeze({
    id: 'manyFronts', name: 'Many Fronts', idea: 'Several battles at once', icon: 'swords', unlock: 'steward',
    blurb: 'Three regions to take, and a Steward to hold the ones you are not watching.',
    seed: 200, world: Object.freeze({ ladderSpan: 2 }), edict: null, boons: Object.freeze([]), relic: null,
    general: Object.freeze({ kind: 'marshal', level: 3 }),
    start: Object.freeze({ gold: 0, upgrades: ARMY(6) }),
    setup: Object.freeze({ own: 'nonRival' }), mods: NO_ECONOMY,
    goal: Object.freeze({ kind: 'regions', count: 3 }),
    raids: Object.freeze([]), botConcurrent: 3,
    stars: Object.freeze([{ kind: 'met' }, { kind: 'time', sec: 240 }, { kind: 'time', sec: 120 }]),
  }),
  Object.freeze({
    id: 'kingmaker', name: 'Kingmaker', idea: 'Economy and route choice', icon: 'coin', unlock: 'relics',
    blurb: 'Five minutes, a Gold Mine and a Relic. End with the fullest treasury you can.',
    seed: 8, world: Object.freeze({}), edict: null, boons: Object.freeze([]), relic: null,
    general: Object.freeze({ kind: 'marshal', level: 3 }),
    start: Object.freeze({ gold: 300, upgrades: ARMY(8) }),
    setup: Object.freeze({ own: 'start', relicsOnMap: true }), mods: Object.freeze({ raids: false }),
    goal: Object.freeze({ kind: 'gold', sec: 300 }),
    raids: Object.freeze([]),
    stars: Object.freeze([{ kind: 'gold', n: 4000 }, { kind: 'gold', n: 8000 }, { kind: 'gold', n: 11000 }]),
  }),
]);

export const SCENARIOS = Object.freeze({
  alwaysOpen: 2,                         // the first two in the list are always open (PLAN §9B)
  starsEach: 3,
});
