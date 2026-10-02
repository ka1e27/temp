// Region Works tuning (DESIGN §5.8). Every number the Works system uses lives here, each with its
// reason; the balance engineer tunes them later. Read by game/meta/worksEffects.js (battle effects,
// income, scouting, slots), game/meta/works.js (costs, actions, panel data) and
// game/render/worksMarks.js (map fade). The UI components receive finished strings and numbers.
//
// Scale reference (seed 7, tools/campaign.mjs, 2026-09-30): realm income 3.5 gold/s at the 1st
// conquest, 31/s at the 10th, 87/s at the 20th, 264/s at the 25th; the next core upgrade costs about
// 33 / 700 / 3300 / 18000 gold at those points; a Muster level is +2.08 War Camp troops, a
// Logistics level +6 % march speed.

// What each Work is worth (tools/balance.mjs --works=KIND1:LEVEL, the optimiser bot, seeds 1-16, 7790 battles per cell, one bordering
// region with the Work, the difficulty card crediting nothing for it): the multiplier on Army Power that gives the same win rate.
//                I       II      III
//   Barracks   x1.08   x1.15   x1.20   +3/+6/+9 camp troops and +18/+36/+54% camp growth
//   Stables    x1.03   x1.05   x1.06   +10/+20/+30% march speed (saturates), -15/-30/-45% supply interval, +25/+50/+75% squad strength in clashes
//   Shrine     x1.03   x1.06   x1.11
//   Watchtower x1.06   x1.08   x1.10   camp arrows, see CAMP_VOLLEY in config/battle.js
//   Market     income, not strength: Markets alone finish the continent about 4% sooner than the normal Works mix and 16% sooner than no Works (campaign --works=markets|normal|none, 24 seeds)
// The card credits each of them at its measured worth (config/meta.js DIFFICULTY: worksCampCredit, campGrowthCredit, cooldownCredit,
// volleyPerLevel, fieldCredit; speed and the supply interval are not credited), so a Works-heavy army reads as strong as it plays.
// Stables are the weakest Work in a fight: the bot pools its troops by hand (its own supply lines lose 1-4 points of win rate against
// that), and clashes between squads in the open are a small part of a battle, so +75% squad strength is worth only about x1.06
// (+60% measured x1.045, +90% x1.06: the effect saturates). It is the one Work whose second and third effects are real for a player
// who uses supply lines and the charge and nearly invisible to the bot.

/** The five Works, in the order the chooser lists them. */
export const WORK_TYPES = Object.freeze(['barracks', 'stables', 'shrine', 'watchtower', 'market']);

export const WORKS = Object.freeze({
  // A Work is built (level I) and levelled to this (DESIGN §5.8: I-III).
  maxLevel: 3,

  slots: Object.freeze({
    // "1 slot on conquest, +1 at Prosperity II, +1 at III": a fresh region has this many.
    onConquest: 1,
    // Each entry opens one more slot once the region's (stored) prosperity level reaches it.
    extraAtProsperity: Object.freeze([2, 3]),
  }),

  cost: Object.freeze({
    // Gold for a level-I Work in a depth-1 region: 17 s of realm income at the 1st conquest, so the
    // first Work is a "why not" right after the third conquest (tutorial step M3), never a saving goal.
    base: 60,
    // Cost is multiplied by this per step of the region's DEPTH above 1. Depth is
    // `enemyDepth(world, region)` from progression.js: the region's rung on the one difficulty ladder,
    // which is also the order the player conquers them in (tier alone has plateaus). The realm's income
    // grows about x2.0 per rung (see the reference above); 1.7 keeps a level-I Work at roughly 5-12 s of
    // realm income all game, and cheaper late, where a few troops matter less. (Tuned with tools/campaign.mjs
    // --works=normal|heavy|none on 24 seeds, see "Balance" at the end of this file.)
    perDepth: 1.7,
    // Price of reaching level I / II / III from the level below. Front-loaded on purpose: the first level
    // of every Work is the best deal, so three different Works beat one maxed Work, and WHERE you build
    // stays the decision (DESIGN §5.8). Building all three levels costs 6x the level-I price.
    levelMult: Object.freeze([1, 1.8, 3.2]),
    // Per-type price factor. Barracks is cheap (half: +3 troops for about what a Muster level's +2.08 costs, but only next
    // door; at full price it lost to Muster early and nobody built it); Stables move squads, which the fights barely reward,
    // so they are cheap too; the Watchtower does two jobs (free scouting and camp arrows), so dearer.
    typeMult: Object.freeze({ barracks: 0.5, stables: 0.6, shrine: 0.9, watchtower: 1.3, market: 1 }),
  }),

  // Per-LEVEL strength of each Work (level n gives n x this). Effects are summed over every owned region that
  // borders the target (DESIGN §5.8: they stack), then clamped by `caps`.
  effects: Object.freeze({
    // War Camp troops at the start of a battle next door. One level = 1.4 Muster levels (+2.08 each), but local
    // and priced at about half a Muster level early, so a frontier region is worth building on.
    // It also makes the War Camp grow faster: +growthPerLevel per level on the camp's troops-per-second (1 + sum), because
    // the camp's growth, not its starting troops, carries a fight (the extra starters alone were worth about x0.97 of Army Power).
    barracks: Object.freeze({ perLevel: 3, growthPerLevel: 0.18 }),
    // Fraction added to squad march speed (1 + sum). Logistics is 6 %/level globally. Measured (tools/balance.mjs --works=stables:N):
    // speed is worth at most about x1.03 of Army Power in these fights, so this Work is a cheap tactical extra, not an economy.
    // It also makes supply lines (DESIGN §4.3) fire more often: -supplyPerLevel per level off their interval (1 - sum, never
    // below caps.supplyIntervalFloor), the synergy with auto-send; a player who sets no supply lines gets only the speed.
    // And a cavalry charge: the player's squads fight squad-against-squad clashes in the open with +fieldPerLevel per level on
    // their per-troop strength (1 + sum, at most caps.fieldStrengthMult). Assaults on a settlement are not clashes.
    stables: Object.freeze({ perLevel: 0.1, supplyPerLevel: 0.15, fieldPerLevel: 0.25 }),
    // Fraction taken off every power cooldown (1 - sum). The Old Shrine perk is 6 % per region. Measured: about x1.03 of Army
    // Power per level early on, more once powers carry the fight.
    shrine: Object.freeze({ perLevel: 0.06 }),
    // Camp volley level: the sum of Watchtower levels next door, capped below. Level L means the War Camp looses
    // arrows like a tower of strength L (see docs/briefs/works-hookup.md for suggested volley numbers).
    watchtower: Object.freeze({ perLevel: 1 }),
    // Fraction added to THIS region's own income (1 + sum). One region is about 1/27 of the realm, so a single Market is a small
    // step by design (a Market belongs in a safe, early region); a Market-only build finishes the continent about 16% sooner than no
    // Works (campaign --works=markets|none, 24 seeds). At 0.08 that was 3% (not worth a slot), at 0.20 20% (a build order).
    market: Object.freeze({ perLevel: 0.15 }),
  }),

  // Demolishing a Work gives back this fraction of the gold spent on it across ALL its levels (what building and
  // upgrading it cost). Works are local, so an inner Barracks is dead weight once the frontier moves on; half back
  // makes re-siting a real but not ruinous decision (build + demolish always loses gold, so it cannot be farmed).
  demolishRefund: 0.5,

  // Safety rails so stacking across many bordering regions cannot run away. A target rarely has more than
  // 3-4 owned neighbours, so these bind only on extreme layouts; balance may raise or drop them.
  caps: Object.freeze({
    campTroops: 20,        // at most +20 War Camp troops (a camp is 30 + Muster)
    speedMult: 1.5,        // at most +50 % march speed
    cooldownFloor: 0.6,    // power cooldowns never drop below 60 % from Shrines
    campVolleyLevel: 3,    // camp arrows level 3 at most
    campGrowthMult: 1.6,   // the War Camp grows at most 60 % faster from Barracks
    supplyIntervalFloor: 0.5, // supply lines never fire more than twice as often from Stables
    fieldStrengthMult: 1.75, // clashing squads are at most 75 % stronger from Stables
  }),

  // A Watchtower of at least this level scouts the regions next to it for free.
  scoutFreeFromLevel: 1,

  // World-map marks (render/worksMarks.js). Zooms are camera px per world unit, the same scale as the labels
  // (scenes/timing.js WORLD_SCENE.labelFade*Zoom = 32 / 42).
  marks: Object.freeze({
    fadeInStartZoom: 8,    // nothing below this: at overview zoom a building would be a speck
    fadeInFullZoom: 12,
    fadeOutStartZoom: 32,  // fades away with the labels when zoomed right in
    fadeOutEndZoom: 42,
    sizeUnits: 0.9,        // width of one building icon in world units (a hex is 1.73 wide)
    maxShown: 3,
  }),

  // Display copy. The effect lines are built in game/meta/works.js from the numbers above, so no
  // percentage is ever typed into UI or scene code.
  copy: Object.freeze({
    names: Object.freeze({
      barracks: 'Barracks', stables: 'Stables', shrine: 'Shrine', watchtower: 'Watchtower', market: 'Market',
    }),
    // Roman numerals for a Work's level; index = level.
    levels: Object.freeze(['', 'I', 'II', 'III']),
    // Shown once above the chooser: what "next door" means.
    nextDoor: 'Next door = regions that border this one.',
    lockedLabel: 'Unlocks at Prosperity',
    toasts: Object.freeze({
      built: '{work} built in {region}',
      upgraded: '{work} in {region} is now level {level}',
      demolished: '{work} demolished in {region} (+{refund} gold)',
    }),
    // The confirm step on a built row; {n} is the refund.
    demolishPrompt: 'Demolish {work}? Refund {n} gold',
    // Why a button is disabled (the amount is filled in by works.js).
    reasons: Object.freeze({
      gold: 'Need {n} more gold',
      duplicate: 'Already built here',
      maxed: 'Fully upgraded',
      noSlot: 'No free slot',
      notOwned: 'Conquer this region first',
    }),
  }),
});
