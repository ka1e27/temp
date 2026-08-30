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
  // HOW LONG THE EMPIRE KEEPS EARNING WITHOUT YOU. It rides the world-map
  // header beside the treasury it fills, because that header is the last thing
  // a player reads before closing the tab. The away banner already explains the
  // cap AFTER it has bitten (see `IDLE.awayCapped`); nothing said what it was
  // BEFORE, so a player who never opened the shop sat at the eight-hour floor
  // forever — measured at roughly 55 million crowns discarded on one missed day
  // at full conquest.
  offlineCap: 'Away cap',
  // ...AND WHAT THAT LABEL MEANS, WHICH IT NEVER SAID. Two words is a heading,
  // not an explanation, and this is the number the entire idle half of the game
  // rests on. Measured by a first-session critic: no `title` anywhere up its DOM
  // ancestor chain, while on the SAME screen the locked Incursions button
  // correctly explains itself on hover — so the pattern existed and had not been
  // applied to the one figure that most needs it. It names the upgrade, because
  // that is the whole reason a player would want the number to be bigger.
  offlineCapHint: 'How long your empire keeps earning after you close the tab.'
    + ' Treasury in Upgrades adds 2h a level, from 8h up to a 24h ceiling.',
  // THE SAME MISSING-EXPLANATION SHAPE, on the pair a player most confuses.
  // "Hard cap" was developer jargon sitting one row under "Typical length" on
  // the loadout brief, with no title anywhere — and the two numbers mean
  // opposite things: one is a promise, the other ENDS the battle. A passive
  // first battle is measured as a twenty-minute stall finishing on copy that
  // reads as a clock problem rather than as "you never attacked", which is
  // exactly the reading an unexplained cap invites. Titled on BOTH halves for
  // the reason `offlineCapHint` is: a player hovers whichever their pointer is
  // over, so a title on one of two is a coin flip.
  timeLimit: 'Time limit',
  timeLimitHint: 'The battle ends here whatever is happening — this is not a'
    + ' target, it is the wall. If you are ahead on territory when it lands you'
    + ' still get paid for the ground you hold, but the region is not taken.',
  typicalLengthHint: 'How long this region takes to WIN, measured over battles'
    + ' that were won. It is a guide, not a deadline — the time limit below is'
    + ' the one that ends the fight.',
  relics: 'Relics',
  worldMap: 'World Map',
  shop: 'Upgrades',
  boosters: 'Boosters',
  doctrine: 'Doctrine',
  doctrineHint: 'One choice, this battle only. Every doctrine trades something '
    + 'away for what it gives you.',
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
  frontierTitle: 'The Frontier',
  frontierLocked: 'Take four regions to open the frontier.',
  frontierHint: 'One enormous map, and no end to it but the one you choose. The'
    + ' country gets harder the further out you walk — push on for the deep'
    + ' ground, or withdraw and bank what you hold.',
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
  // HONOURS — see content/milestones.data.js. Named goals over the same
  // counters, and the reason the drawer is worth opening in the back half of a
  // campaign whose last unlock arrives at region 8 of 24.
  honoursTitle: 'Honours',
  honoursEarned: 'Earned:',
  honoursAll: 'Every honour earned. There is nothing left to prove.',
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
  // ...AND THE SAME CLAIM IN TEXT, because the ring was the only cue a SIGHTED
  // player got and it carries no words at all. `suggestedSuffix` above rides a
  // button's aria-label, so a screen-reader user has always been told which row
  // is the cheapest and everyone else saw a pulsing border and had to guess what
  // it meant. Meanwhile "bigger army" is the single most intuitive first buy in
  // a strategy game and is measured at 2% against cheapest-first's 33% (n=48,
  // and independently reproduced at 79% vs 2% vs 0% on kaldan) — so the one
  // purchase the UI most needs to argue against was argued against in a channel
  // most players cannot hear.
  //
  // It teaches the RULE rather than pointing, because pointing does not survive
  // the row moving: a player who learns "cheapest first" needs the beacon once,
  // and a player who only learns "buy the glowing one" needs it forever.
  suggestedTag: 'Buy this next — cheapest first beats saving up',
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

/**
 * The offline payout banner — the payoff for the whole idle half of the game.
 *
 * THIS BLOCK HAD NO READER FOR ITS ENTIRE LIFE, and the banner in
 * `screens/worldmap.js` hardcoded its own copy beside it. Two costs, and the
 * second is the one that mattered: the copy here went stale unnoticed (it named
 * a "Granary" upgrade that stopped existing when twenty-six upgrades collapsed
 * into six endless lines), and the LIVE banner never grew the one line this
 * block already had written for it — that the treasury filled up.
 *
 * `applyOfflineProgress` has returned `cappedOut` all along and nothing has
 * ever read it. So a player who idles past the cap loses every crown after it,
 * silently, and is never told that the Treasury line is what raises it — which
 * is the one moment in the game where that upgrade sells itself.
 */
export const IDLE = Object.freeze({
  awayCrowns: (crowns) => `+${crowns} crowns`,
  awayBody: (span) => ` earned while you were away (${span}).`,
  awayCapped: (cap) => `Your treasury filled after ${cap} — anything past that was lost.`
    + ' The Treasury line raises the cap.',
  awayDismiss: 'Dismiss',
  awayDismissLabel: 'Dismiss the offline income notice',
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

// The tutorial beats and the results copy live in strings.battle.js — see the
// note at the top of that file. Re-exported so every existing
// `import { COACH, RESULTS } from './strings.js'` keeps working.
export { COACH, RESULTS } from './strings.battle.js';
