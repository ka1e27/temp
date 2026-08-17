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
  relics: 'Relics',
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
    desc: 'Siege 12, and the only siege that never stops counting: past 40 '
      + 'ordinary troops at one wall the rest queue, engines do not. Worth '
      + 'x0.40 of a normal unit in the field unless it is spearmen in the way '
      + '(up to +260%). Slowest thing you own: x0.65 highland, x0.75 river.',
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
  archers: Object.freeze({
    name: 'Archers',
    role: 'Shoots from behind',
    desc: 'Fights a battle one tile away without standing in it: park them '
      + 'beside a fight and they add their attack to it and take none of the '
      + 'casualties. March them INTO the line and that is thrown away — they '
      + 'are the softest thing you can field. x1.15 highland, x0.85 river.',
  }),
  marshal: Object.freeze({
    name: 'Marshal',
    role: 'Commander',
    desc: 'One per site. Every troop standing with it fights 25% harder and '
      + 'the site he stands in trains 40% faster. One rides free with '
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
  // Adjacency lets you reach a region long before your empire can take it —
  // see meta/world.js `campaignGap`. Names the cost and leaves the choice.
  aheadOfSchedule: 'This lies deeper than your empire has reached. Expect to be'
    + ' badly outmatched — take the regions behind it first, or bring everything.',
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
  abdicateHint: 'End this empire. Crowns, upgrades and boosters go back to nothing — you'
    + ' keep your legacy, your records and the ladder you have climbed, and the next'
    + ' campaign opens with ground you no longer have to take twice.',
  abdicateGo: 'Abdicate and begin again',
  abdicateConfirm: 'This cannot be undone. Abdicate?',
  legacyTitle: 'Legacy',
  legacyNone: 'No legacy yet. Finish a campaign and abdicate to earn some.',
  legacyHeld: (n) => `${n} legacy`,
  legacyWorth: 'Every point is permanent, applies to every run, and is never spent.',
});

/** The lifetime record drawer (screens/mainmenu-record.js). Labels only — every
 *  number behind them comes from meta/record.js, which is where the arithmetic
 *  is documented and tested. */
export const RECORD = Object.freeze({
  title: 'Record',
  hint: 'Every battle you have fought, on this empire and every one before it.',
  empty: 'Nothing to show yet — fight a battle and this fills in.',
  survives: 'Records are kept through abdication. They are the one thing a new'
    + ' campaign never takes back.',
  warTitle: 'War',
  winRate: 'Win rate',
  battles: 'Battles fought',
  wins: 'Won',
  losses: 'Lost',
  withdrawals: 'Withdrawn from',
  raids: 'Regions re-raided',
  incursions: 'Incursion rungs cleared',
  troopsTitle: 'Troops',
  killRatio: 'Killed per lost',
  killed: 'Enemy troops killed',
  lost: 'Own troops lost',
  timeTitle: 'Time',
  // Named as a share of TIME, because that is what is counted — see
  // meta/record.js `awayShare` on why this is not an income share.
  awayShare: 'Earned while away',
  played: 'Time in the game',
  away: 'Time credited away',
  purseTitle: 'Purse',
  crownsEarned: 'Crowns earned',
  crownsSpent: 'Crowns spent',
  relicsEarned: 'Relics earned',
  relicsSpent: 'Relics spent',
});

export const SHOP = Object.freeze({
  header: 'Spend crowns on things you will feel next battle.',
  affordIn: 'Affordable in',
  /** Relics cannot be waited for, so the tooltip names the two places they come
   *  from instead of counting down to a moment that never arrives. */
  relicsFrom: 'Relics come from first conquests and incursion rungs',
  chargeLabel: 'charges',
  boosterLocked: 'Unlock this booster before buying charges.',
  boosterFull: 'Stock full.',
  // The bulk-buy controls (meta/upgrades.js `spendAll`/`buyN`) and the
  // suggested-buy ring. "Spend all" states the rule rather than a slogan, for
  // the same reason the header above does — it is the one thing a player
  // presses without reading the six rows underneath it.
  spendAll: 'Spend all',
  spendAllHint: 'Buys every affordable crown line below, cheapest first, until'
    + ' nothing is left.',
  nothingToSpend: 'Nothing you can afford yet.',
  buyTen: '×10',
  buyTenHint: (name) => `Buy ${name} up to ten times, cheapest levels first.`,
  // Appended to a buy button's own aria-label — not a separate announcement,
  // so a screen-reader user hears "Buy Treasury for 45 crowns, cheapest
  // option right now" rather than a second element to tab past.
  suggestedSuffix: ', cheapest option right now',
  // THE CROWN TIER'S OWN BADGE AND GATE NOTE — see screens/shop.js for the rest
  // of the section treatment (a rank-hued header and top edge, not the accent
  // every other group shares). The badge shows whether the section is locked or
  // not, so it earns its place next to the group's own name at all times; the
  // gate note is the one fact worth stating that a locked row's own "Locked"
  // tag does not already carry — that finishing the campaign a SECOND time is
  // not required to keep it open.
  crownBadge: 'Endgame',
  crownGateNote: 'Opens once you finish the campaign, and stays open after you abdicate.',
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
  restored: 'Previous save restored.',
  noBackup: 'There is no previous save to fall back to.',
  exportFirst: 'Export save copies the unreadable file out as text. Keep a copy'
    + ' before starting a new campaign — a new campaign overwrites it.',
  autosaveOff: 'Autosave is off so your existing file is not overwritten.',
});

export const COACH = Object.freeze({
  drag: 'Drag from your camp across the map. Your troops march the road you draw.',
  fieldWon: "You've beaten the defenders — now hold position while your troops break the walls.",
  captured: 'Farms fund your army.',
  gold100: 'Strongholds turn gold into soldiers, and take more troops to crack.',
  strongholdTaken: 'Pick what this training ground builds. Switching keeps its progress.',
  buildRams: 'Build rams, then take the castle.',
  siegeStalled: 'Walls repair faster than you break them. Send more, or pull out.',
  retreat: 'Retreat pulls a force home. It cannot be intercepted — you only lose the ground.',
  firstIncome: 'That region now pays you crowns every second — whether or not the'
    + ' tab is open. Crowns buy permanent upgrades, and upgrades take the next one.',
  // Moved out of coach.js COACH_EXTRA, where it was parked with a comment saying
  // it belonged here. It also gained the half that mattered: the old line said
  // "Take the castle to win the region" and never mentioned the gate, so the
  // assault it told the player to make bounced off a SEALED castle they had
  // never heard of.
  takeCastle: 'The castle wins the region — but its gate holds until you own most'
    + ' of the map. Take the countryside first, then the throne.',
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
