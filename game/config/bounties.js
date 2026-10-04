// The Bounty Board (PLAN-PHASE4 §4A): three optional contracts at a time. Every number and every line of copy lives here; read
// by game/meta/bounties.js. Times are ACTIVE seconds (state.frontier.activeSec).
//
// Rewards scale with the realm: gold = the realm's income per second x `minutes` x 60 when the contract is shown or paid
// (re-priced by ensureBounties), plus a little Renown on the harder kinds, and on some a General XP bundle (`xp`) for the
// commander of the win. A conquest bounty is 51 s of income (config/meta.js ECONOMY.bountySeconds), so 1 minute of income is
// about 1.2 conquest bounties: contracts are worth taking, and the campaign measures what they do to pacing.

export const BOUNTIES = Object.freeze({
  slots: 3,
  unlockOwned: 2,              // the board opens once the player holds this many regions (after the first conquest: never in the tutorial)
  freeRerollSec: 20 * 60,      // one free reroll per 20 active minutes ...
  rerollRenown: 1,             // ... otherwise a reroll costs this much Renown
  reachSteps: 2,               // a typed / twist contract is drawn only for a region on the frontier or within this many steps of it
  xpBundle: 150,               // the General XP bundle (to the commander of the win that completed it)
  chainWindowSec: 10 * 60,     // `chain`: two conquests within this many active seconds

  // Per kind: draw weight, gold in minutes of income, Renown, whether it carries the XP bundle. `n` ranges are inclusive.
  kinds: Object.freeze({
    noPowers: Object.freeze({ weight: 1, minutes: 0.8, renown: 0, xp: false }),
    forts: Object.freeze({ weight: 1, minutes: 0.5, perN: true, renown: 1, xp: false, n: Object.freeze([2, 3]) }), // minutes x N
    swiftHard: Object.freeze({ weight: 0.7, minutes: 1.6, renown: 2, xp: true }),
    cleanDefense: Object.freeze({ weight: 1, minutes: 0.8, renown: 1, xp: false }),
    typed: Object.freeze({ weight: 1.2, minutes: 1.0, renown: 1, xp: false }),
    twist: Object.freeze({ weight: 1, minutes: 1.0, renown: 1, xp: true }),
    chain: Object.freeze({ weight: 1, minutes: 0.8, renown: 0, xp: false }),
    general: Object.freeze({ weight: 0.8, minutes: 0.6, renown: 0, xp: true }),
    ability: Object.freeze({ weight: 0.8, minutes: 0.6, renown: 1, xp: true }),
    prosper: Object.freeze({ weight: 0.8, minutes: 1.0, renown: 1, xp: false, levelMinutes: Object.freeze({ 2: 1.0, 3: 2.0 }) }),
    fortify: Object.freeze({ weight: 0.8, minutes: 0.3, perN: true, renown: 0, xp: false, n: Object.freeze([2, 4]) }), // minutes x N
    retake: Object.freeze({ weight: 1.5, minutes: 1.0, renown: 1, xp: false }),
    scout: Object.freeze({ weight: 0.8, minutes: 0.6, renown: 0, xp: false }),
  }),
  types: Object.freeze(['goldmine', 'monastery', 'bandit', 'ruins']),
  twists: Object.freeze(['night', 'blizzard', 'flooded', 'holy', 'siege', 'raid']),

  copy: Object.freeze({
    title: 'Bounty Board',
    text: Object.freeze({
      noPowers: 'Win a battle without using a power',
      forts: 'Capture {n} forts or towers in one battle',
      swiftHard: 'Win Swift on a Hard or Deadly region',
      cleanDefense: 'Hold a defense without losing a settlement',
      typed: 'Conquer a {type}',
      twist: 'Win a battle under {twist}',
      chain: 'Win 2 conquests within 10 minutes',
      general: 'Win a battle commanded by {general}',
      ability: "Use {general}'s ability in a won battle",
      prosper: 'Raise any region to Prosperity {level}',
      fortify: 'Build {n} fortification levels',
      retake: 'Retake an occupied region',
      scout: 'Scout a region, then conquer it',
    }),
    typeNames: Object.freeze({ goldmine: 'Gold Mine', monastery: 'Monastery', bandit: 'Bandit Hold', ruins: 'Ruins' }),
    twistNames: Object.freeze({ night: 'Night', blizzard: 'Blizzard', flooded: 'Flooded', holy: 'Holy Ground', siege: 'Siege', raid: 'Raid' }),
    levels: Object.freeze(['', 'I', 'II', 'III']),
    reroll: 'Reroll',
    rerollFree: 'Reroll (free)',
    rerollCost: 'Reroll · {n} Renown',
    reasons: Object.freeze({ renown: 'Need 1 Renown', locked: 'Not yet', empty: 'Nothing to reroll', none: 'No other contract is possible now' }),
    completed: 'Contract complete: {text}',
  }),
});
