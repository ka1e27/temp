// HONOURS — the named goals of the back half of the campaign.
//
// WHY THIS EXISTS, measured rather than assumed. Modelling the shop screen's own
// `spendAll` for a player who plays back to back, all ELEVEN one-off unlocks are
// bought by REGION 8, at 64 cumulative minutes of a 297-minute campaign. So for
// 233 minutes — 78% of the running time — there is nothing NEW to acquire, only
// larger numbers on things already owned. That is the strongest structural
// answer this project has to "what is there to look forward to", and it is the
// gap these fill.
//
// THEY ARE RECOGNITION, NOT POWER, AND THAT IS A DECISION RATHER THAN A
// SHORTCUT. Nothing in `battle/` or `meta/modifiers.js` reads this file, so an
// honour cannot move a win rate and this table needed no measurement to ship —
// which is the whole reason it could land after the re-tune instead of inside
// it. The obvious extension is to pay relics, and relics are genuinely outside
// the measured table (the harness earns zero, so `regions.data.js` describes a
// player who has none). But `--relics=78` is worth +25 points on gallowmoor, so
// paying them would widen the already-recorded gap between the table and the
// shipped game. Deliberately left as a separate, measurable decision.
//
// NOTHING IS STORED. An honour is `stats[stat] >= need` and nothing else, so
// there is no persisted field to migrate, no second copy to fall out of step
// with the counters, and no way for the drawer to claim something the record
// itself contradicts. Same rule as the incursion ladder's `cleared`: one number,
// derived, so the two cannot disagree.
//
// EVERY `stat` NAMED HERE IS ONE OF `createStats()`'s THIRTEEN, and every one
// has a live writer — the audit is in meta/record.js's header and is enforced by
// tests/milestones.test.js rather than trusted. A rung over a counter nobody
// increments would be the "sold and did nothing" failure with a friendlier face.
//
// THE THRESHOLDS ARE MEASURED, NOT ROUND NUMBERS THAT LOOKED RIGHT. Modelling a
// player who fights each region at its own shipped win rate — so a region won
// 30% of the time costs three sittings, not one — a full campaign is 685
// minutes, 47 battles, 78 relics, ~4,700 kills and ~46M crowns earned. What a
// player HOLDS entering each region:
//
//     region        min  battles  relics   crownsEarned   killed
//      9 emberholt    91     10      12          88,952      997
//     12 vaelstrand  157     15      20         549,802    1,447
//     15 thanescar   226     19      29       1,597,260    1,922
//     18 obsidian    296     25      41       3,636,474    2,447
//     21 nightharrow 422     33      55      11,335,622    3,249
//     24 widowsgate  627     44      72      35,441,732    4,417
//
// So every ladder's FIRST rung lands around region 8-10 — exactly where the
// unlocks stop — its second around region 18-20, and its third at or past the
// end of the campaign, where the endless loops take over. `relicsEarned: 78` is
// the one exact figure: it is the whole campaign's first-clear payout to the
// crown, so that honour means "you have taken all twenty-four", stated in the
// currency rather than in a region count.
// PURE DATA.

/** Hours as milliseconds — `playMs` is the one counter not denominated in things. */
const h = (n) => n * 3600 * 1000;

/**
 * The ladders, in the order they are shown. Grouped by `stat` and ascending in
 * `need` within a group; `tests/milestones.test.js` asserts both, because the
 * "next rung" logic takes the first unearned row of a group and would silently
 * offer the wrong one against an unsorted table.
 */
export const HONOURS = Object.freeze([
  { id: 'blooded', stat: 'battles', need: 10,
    title: 'Blooded', note: 'Fight ten battles.' },
  { id: 'campaigner', stat: 'battles', need: 25,
    title: 'Campaigner', note: 'Fight twenty-five. About what the campaign costs.' },
  { id: 'warlord', stat: 'battles', need: 50,
    title: 'Warlord', note: 'Fight fifty. More war than the campaign contains.' },

  { id: 'firstThousand', stat: 'unitsKilled', need: 1000,
    title: 'The First Thousand', note: 'Kill a thousand of the enemy.' },
  { id: 'reaper', stat: 'unitsKilled', need: 3000,
    title: 'Reaper of Hosts', note: 'Three thousand. Roughly the enemy heartland.' },
  { id: 'tenThousand', stat: 'unitsKilled', need: 10000,
    title: 'Ten Thousand Dead', note: 'Twice what taking every region costs.' },

  { id: 'reliquary', stat: 'relicsEarned', need: 10,
    title: 'Reliquary', note: 'Earn ten relics. Only ground you have BEATEN pays them.' },
  { id: 'hoarder', stat: 'relicsEarned', need: 40,
    title: 'Keeper of the Hoard', note: 'Forty. Past the halfway mark of the campaign.' },
  { id: 'wholeHoard', stat: 'relicsEarned', need: 78,
    title: 'The Whole Hoard', note: 'Seventy-eight — every region in the campaign, once.' },

  { id: 'solvent', stat: 'crownsEarned', need: 100000,
    title: 'Solvent', note: 'Earn a hundred thousand crowns.' },
  { id: 'treasurer', stat: 'crownsEarned', need: 5000000,
    title: 'Treasurer', note: 'Five million. The empire compounds faster than you spend.' },
  { id: 'mint', stat: 'crownsEarned', need: 50000000,
    title: 'Mint of the Realm', note: 'Fifty million, earned awake or asleep.' },

  { id: 'afternoon', stat: 'playMs', need: h(2),
    title: 'An Afternoon', note: 'Two hours in the game itself.' },
  { id: 'longWatch', stat: 'playMs', need: h(6),
    title: 'A Long Watch', note: 'Six hours. Time away does not count toward this one.' },
  { id: 'longWar', stat: 'playMs', need: h(12),
    title: 'The Long War', note: 'Twelve hours — longer than the whole campaign takes.' },

  { id: 'descend', stat: 'incursions', need: 1,
    title: 'Down the Ladder', note: 'Clear an incursion rung. The ladder has no top.' },
  { id: 'tenRungs', stat: 'incursions', need: 10,
    title: 'Ten Rungs Deep', note: 'Ten cleared. Each one is harder than the last, forever.' },
  { id: 'thirtyRungs', stat: 'incursions', need: 30,
    title: 'Thirty and Climbing', note: 'Thirty. Past where the ladder stops being fair.' },

  { id: 'backForMore', stat: 'raids', need: 1,
    title: 'Back for More', note: 'Raid a region you already hold.' },
  { id: 'tithe', stat: 'raids', need: 10,
    title: 'Tithe-Taker', note: 'Ten raids. A conquered region keeps paying.' },
]);

/** How a rung's numbers are rendered. `count` is a plain tally, `crowns` gets the
 *  compact K/M treatment, `hours` is milliseconds. The screen switches on this
 *  rather than on the stat name, so a new ladder needs no change there. */
export const HONOUR_FORMAT = Object.freeze({
  battles: 'count', unitsKilled: 'count', relicsEarned: 'count',
  crownsEarned: 'crowns', playMs: 'hours', incursions: 'count', raids: 'count',
});
