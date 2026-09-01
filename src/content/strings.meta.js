// THE ENDGAME LOOPS AND THE LIFETIME RECORD: every string the main menu's
// drawers and the two endless entries render.
//
// Split out of ./strings.js at the 400-line cap, along the seam ./strings.battle.js
// already uses — that file is what the BATTLE says, this is what the meta
// screens say about a finished campaign, and what is left there is the shell:
// the HUD's own labels, the units, the world map, the shop, the idle banner and
// the save recovery.
//
// Re-exported from ./strings.js, so every existing
// `import { ENDGAME, RECORD } from './strings.js'` keeps working. PURE DATA,
// and the same rule holds: state the RULE, not the flavour.

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
  /** THE OTHER HALF OF ABDICATING, and it is real rather than decorative: a
   *  commander is a pure function of `(region, resets)` (meta/marshals.js
   *  `commanderFor`), so ending a run genuinely retires every officer who beat
   *  you and the next campaign is fought against a different set of names.
   *  Stated on the drawer because a change nobody is told about is a change
   *  nobody notices. */
  abdicateOfficers: 'Their officers retire with you. The next campaign is held by'
    + ' a different generation.',
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
