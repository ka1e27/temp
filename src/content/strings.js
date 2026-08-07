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
