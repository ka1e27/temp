// All player-facing copy outside the region table. PURE DATA.
//
// Kept in one file so a tone pass, a typo fix, or a future localisation is a
// single diff and never touches logic. Region names and flavour live in
// regions.data.js next to the numbers they describe; unit and upgrade copy lives
// in upgrades.data.js for the same reason.
//
// Rule for every string here: state the RULE, not the flavour. "Walls repair
// faster than you break them" teaches the game; "The siege falters!" does not.

export const UI = Object.freeze({
  gameTitle: 'HEX DOMINION',
  tagline: 'Two clocks, one empire.',
  crowns: 'Crowns',
  crownsPerSec: '/s',
  income: 'Income',
  treasury: 'Treasury',
  worldMap: 'World Map',
  shop: 'Upgrades',
  boosters: 'Boosters',
  expedition: 'Expedition',
  attack: 'Attack',
  raid: 'Raid',
  locked: 'Locked',
  conquered: 'Conquered',
  cooldown: 'Recovering',
  back: 'Back',
  close: 'Close',
  maxed: 'MAX',
  buy: 'Buy',
  cannotAfford: 'Not enough crowns',
  retry: 'Retry',
  continue: 'Continue',
});

/**
 * The five troop types, in the player's words.
 *
 * `name` is the FULL name — nothing in the game may abbreviate a unit to three
 * letters again, because "RAI E" tells a new player nothing at all. `role` is
 * the two-word job, and `desc` is the hover copy.
 *
 * Every number in `desc` is read straight off UNITS in balance.js and is meant
 * to STAY read off it: tests/unitcopy.test.js re-derives the counter bonuses,
 * the terrain multipliers, the spear bulwark and the marshal's banner from the
 * tuning table and fails if the copy stops matching. Retune a unit and this
 * text has to move with it — which is the point. A tooltip that lies about the
 * multiplier is worse than no tooltip.
 */
export const UNITS_UI = Object.freeze({
  militia: Object.freeze({
    name: 'Militia',
    role: 'Cheap line infantry',
    desc: 'The cheapest body you can field, trained two at a time, and the only '
      + 'troop the ground never touches — x1.00 on every hex. Hits up to 75% '
      + 'harder the more of the enemy is spearmen. The safe answer when you '
      + 'cannot read the map.',
  }),
  spearmen: Object.freeze({
    name: 'Spearmen',
    role: 'Holds what you hold',
    desc: 'Defends at x1.75 on a site you already own, and up to 75% harder '
      + 'against raiders. Braced uphill (x1.20 highland), broken up in the '
      + 'water (x0.85 river). Garrison them — marching them out throws the '
      + 'bulwark away.',
  }),
  raiders: Object.freeze({
    name: 'Raiders',
    role: 'Fast attacker',
    desc: 'Nearly twice the marching speed of militia and the hardest hitter '
      + 'you can field in numbers, but soft when defending. Up to +60% against '
      + 'militia and +100% against rams. x1.20 at a river, x0.70 in highland. '
      + 'Half of them escape a failed assault.',
  }),
  rams: Object.freeze({
    name: 'Rams',
    role: 'Breaks walls',
    desc: 'Siege 12 against a wall — twenty times a militia — and the only '
      + 'reliable way to out-pace a stronghold repairing itself. Worth x0.40 '
      + 'of a normal unit in the field unless it is spearmen in the way (up to '
      + '+260%). Slowest thing you own: x0.65 highland, x0.75 river.',
  }),
  outriders: Object.freeze({
    name: 'Outriders',
    role: 'Takes ground first',
    desc: 'Three times a militia’s march — the fastest thing in the game by a '
      + 'wide margin. A region is mostly unclaimed when you land, and this is '
      + 'the unit that gets there first. Soft in a stand-up fight, but 60% of '
      + 'a failed grab rides home. Up to +90% against rams. x1.25 river, '
      + 'x0.75 highland.',
  }),
  halberds: Object.freeze({
    name: 'Halberds',
    role: 'Cracks fortifications',
    desc: 'Cuts the defender’s SITE bonus in half — the one advantage no '
      + 'amount of militia answers, because a castle defends at x1.60 before '
      + 'its walls are counted. Scaled by how much of your force they are, so '
      + 'bring them properly or not at all. Up to +50% against raiders. '
      + 'x1.10 highland, x0.90 river.',
  }),
  sappers: Object.freeze({
    name: 'Sappers',
    role: 'Makes a site unbreakable',
    desc: 'Nearly doubles the repair rate of whatever they garrison. A '
      + 'besieger whose damage cannot out-pace repair never breaches at all, '
      + 'however long they sit there — so a site you hold with sappers needs '
      + 'engines to take, not numbers. x1.15 highland, x0.95 river.',
  }),
  marshal: Object.freeze({
    name: 'Marshal',
    role: 'Commander',
    desc: 'One per site. Every troop standing with it fights 25% harder and '
      + 'the stronghold it sits in trains 40% faster. One rides free with '
      + 'every expedition once unlocked; commission more in battle for gold.',
  }),
});

export const WORLD = Object.freeze({
  gateHint: 'You may only attack a region that touches your empire.',
  lockedHint: 'Take an adjacent region first.',
  raidHint: 'Already yours. A raid pays a one-time lump — never permanent income.',
  raidHarder: 'Each clear makes this region 15% harder and 10% richer.',
  cooldownHint: 'This region is still recovering. Raid again in',
  rewardPermanent: 'Conquering this region permanently raises your income by',
  rewardLump: 'A successful raid pays',
  frontOpened: 'A new front has opened:',
  expeditionHint: 'You land with an army sized by the regions you already hold.',
  firstRegion: 'Riverfen is the only region you can reach with an empire of zero.',
});

/**
 * The endless ladder and the reset. Same rule as everything else here: state the
 * RULE. A player deciding whether to abdicate is deciding about numbers, so the
 * copy says what is kept and what is lost rather than dressing it up as a story.
 */
export const ENDGAME = Object.freeze({
  incursionTitle: 'Incursions',
  incursionLocked: 'Take every region to open the endless ladder.',
  incursionHint: 'One battle per rung, on ground you already hold. Win and the next'
    + ' rung is harder; lose and nothing changes but the boosters you fired.',
  incursionDepth: (n) => `Depth ${n}`,
  incursionCleared: (n) => (n > 0 ? `Deepest cleared: ${n}` : 'Nothing cleared yet'),
  incursionGo: 'Begin incursion',
  mutatorsNone: 'No complications at this depth.',
  mutatorsTitle: 'Complications',
  abdicateTitle: 'Abdicate',
  abdicateLocked: 'Available once you have taken every region.',
  abdicateHint: 'End this empire. Crowns, upgrades, boosters and every region go back'
    + ' to nothing — you keep your legacy, your records and the ladder you have climbed.',
  abdicateGo: 'Abdicate and begin again',
  abdicateConfirm: 'This cannot be undone. Abdicate?',
  legacyTitle: 'Legacy',
  legacyNone: 'No legacy yet. Finish a campaign and abdicate to earn some.',
  legacyHeld: (n) => `${n} legacy`,
  legacyWorth: 'Every point is permanent, applies to every run, and is never spent.',
});

export const SHOP = Object.freeze({
  header: 'Spend crowns on things you will feel next battle.',
  economyFirst: 'Economy-first starves the enemy and wins slowly.',
  militaryFirst: 'Veterancy and raiders win by burning farms fast. Both clear tier 2.',
  standingArmyNote: 'The most directly felt purchase in the game.',
  affordIn: 'Affordable in',
  chargeLabel: 'charges',
  boosterLocked: 'Unlock this booster before buying charges.',
  boosterFull: 'Stock full.',
});

export const IDLE = Object.freeze({
  awayTitle: 'While you were away',
  awayBody: (crowns, duration) => `You earned ${crowns} crowns over ${duration}.`,
  awayCapped: (cap) => `Your treasury filled up after ${cap}. Granary raises that cap.`,
  awayNothing: 'Conquer a region to start earning while you are away.',
  capLabel: 'Offline cap',
});

export const SAVE = Object.freeze({
  saved: 'Saved',
  exported: 'Save copied as text. Keep it somewhere safe.',
  imported: 'Save imported.',
  refusedTitle: 'This save could not be loaded',
  refusedBody: 'Nothing has been deleted. Your file is exactly as it was.',
  reasons: Object.freeze({
    corrupt: 'The file is not readable JSON.',
    'future-version': 'It was written by a newer version of the game. Update, or open the tab you saved it in.',
    'unknown-version': 'It carries a version this build has no migration for.',
    'migration-failed': 'A migration step failed. The original file is untouched.',
    'not-an-object': 'The file is not in the expected shape.',
    'no-version': 'The file carries no version number.',
    'write-failed': 'Storage refused the write — it may be full or disabled.',
  }),
  restoreBackup: 'Restore the previous save',
  autosaveOff: 'Autosave is off so your existing file is not overwritten.',
});

export const COACH = Object.freeze({
  drag: 'Drag from your camp to the grey farm.',
  fieldWon: "You've beaten the defenders — now hold position while your troops break the walls.",
  captured: 'Farms fund your army.',
  gold100: 'Strongholds turn gold into soldiers, and take more troops to crack.',
  strongholdTaken: 'Pick what this stronghold trains. Switching keeps its progress.',
  buildRams: 'Build rams, then take the castle.',
  siegeStalled: 'Walls repair faster than you break them. Send more, or pull out.',
  retreat: 'Retreat pulls a force home. It cannot be intercepted — you only lose the ground.',
  firstIncome: 'That region now pays you whether or not you are playing.',
});

export const RESULTS = Object.freeze({
  win: 'Region conquered',
  loss: 'Defeat',
  timeout: 'Time expired',
  retreat: 'Withdrawn',
  lossBody: 'Nothing was lost but time. Change your expedition and try again.',
  timeoutBody: 'Decided on territory when the hard cap ran out.',
  retreatBody: 'You withdrew. The region is unchanged.',
  incomeNow: 'Income now',
  bestTime: 'Best time',
});
