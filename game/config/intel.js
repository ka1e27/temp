// Scout and Sabotage tuning (DESIGN §5.7). Owned by the intel module; the balance harness
// (tools/campaign.mjs) tunes the cost numbers. Everything a designer might want to change
// without reading code lives here: costs, the sabotage step, the weak-point heuristic weights,
// the copy shown on the region card, and the map-mark tuning.

export const INTEL = Object.freeze({
  // --- Scout -----------------------------------------------------------------------------
  // One-off and cheap: about twenty seconds of income, so it is a "why not" once you can
  // afford an upgrade or two, never a decision. Free on the tutorial region (the easiest
  // frontier region while you still own only your start region) so the first card a new
  // player sees teaches the feature at no cost.
  scout: Object.freeze({
    incomeSeconds: 20,       // cost = incomePerSec x this ... (20 s: with 30 a scout cost more than the first two upgrades)
    minCost: 20,             // ... but never less than this (the very first minutes earn ~1 gold/s)
  }),

  // --- Sabotage --------------------------------------------------------------------------
  // The next step's price is  max(steelMult[level] x (cost of your NEXT Steel level),
  //                               incomeSeconds[level] x incomePerSec).
  //
  // Why these numbers (see docs/briefs/intel-hookup.md for the worked example):
  //  * One sabotage step removes 15 % of the region's starting garrisons. Because a garrison
  //    also regrows during the fight and troops above a site's cap bleed off, that moves the
  //    difficulty ratio by roughly +6..12 % (one to two Steel levels' worth) for ONE region,
  //    once. A Steel level is +5 % attack for every region, forever.
  //  * Tying the price to the next Steel level makes it follow the upgrade curve (it gets
  //    2.15x dearer with every Steel level you buy), so the deeper you are the more a
  //    finisher costs. Steel-only pricing alone could be gamed by never buying Steel, so
  //    the income term is a floor: sabotage is never cheaper than N minutes of what your
  //    realm actually earns.
  //  * 4.5x / 9x the next Steel level, 270 / 675 s income floor. Measured with tools/campaign.mjs (12 seeds, median time to 10 /
  //    20 / all regions against never sabotaging): the "finisher" policy (sabotage only when it costs at most 6x the
  //    cheapest upgrade) is +5 / -3 / +4 %, the "heavy" policy (whenever it reaches Fair) is +19 / +11 / +18 % slower.
  //    3x/6x was the brief's first choice: there heavy was only +3 % to 20 regions and the finisher +12 % to the end, so
  //    this is the nearest setting that passes both. Do not go below 0.75x/1.5x (the intel engineer's dominance floor).
  sabotage: Object.freeze({
    maxLevel: 2,
    step: 0.15,                         // each level cuts starting garrisons by this fraction
    steelMult: Object.freeze([4.5, 9]), // index = current level (cost of going level -> level+1)
    incomeSeconds: Object.freeze([270, 675]),
  }),

  // --- Weak point heuristic (game/meta/intel.js scoutReport) -----------------------------------
  // For every enemy site that is not the keep and not a neutral Free Folk hamlet:
  //   cost = ( min(cap, garrison + growth x eta) x siteDefence x enemy attack x defence
  //            + arrowLosses ) x ( 1 + campBiasPerHex x hexes from your War Camp )
  // where eta is the march time from your camp, and arrowLosses is what enemy towers shoot at your
  // squads on the way (route tiles inside a tower's range x seconds x kills/s, see routeExposure).
  // The lowest cost is the suggested first strike: cheapest to take by the time your first squad
  // arrives, not shot at on the way in, and near your camp so it is quick and safe. Unless a town
  // costs at most `townPreference` (20 %) more than that: towns grow fastest once held (DESIGN §5.7),
  // so the cheapest such town is suggested instead.
  weakPoint: Object.freeze({
    towerFightSec: 6,       // seconds a squad fights under a tower's own fire when it attacks that tower
    campBiasPerHex: 0.05,   // each hex of march from the War Camp costs 5 % more
    townPreference: 0.2,    // a town within this much of the cheapest site's cost wins (towns grow fastest once held)
  }),

  // --- Copy ---------------------------------------------------------------------------------
  siteNames: Object.freeze({
    keep: 'Keep', fort: 'Fort', tower: 'Tower', town: 'Town', village: 'Village', hamlet: 'Hamlet',
  }),
  // Display order of the composition chips (most tactically important first).
  siteOrder: Object.freeze(['keep', 'fort', 'tower', 'town', 'village', 'hamlet']),

  // One line each, written from what game/battle/ai.js actually does for that personality.
  personalityLines: Object.freeze({
    aggressive: 'Aggressive: attacks early and commits big',
    defensive: 'Defensive: strikes when you overextend',
    swarm: 'Swarm: many small, fast raids',
    passive: 'Passive: never attacks, only supports its own sites',
    undying: 'Undying: holds thickly, strikes once you have spent troops',
    raider: 'Raider: holds lightly, slips away by sea, strikes any coast',
    usurper: 'Usurper: guards his keep, strikes in waves, borrows every rival\'s weapon', // PLAN-PHASE13
  }),
  // One plain line under the weak point (shown on touch too, where there is no hover): what the words mean.
  glossary: Object.freeze({
    weakPoint: 'The settlement that falls fastest: strike it first.',
  }),
  maxNotes: 2,
  notes: Object.freeze({
    longMarchHexes: 9,      // a keep this far from your War Camp earns a "long march" note
  }),

  // {region} and {pct} are filled in by intelToast() in game/meta/intel.js.
  toasts: Object.freeze({
    scouted: 'Scouts report back from {region}',
    sabotaged: 'Saboteurs weakened {region} (−{pct}%)',
    battle: 'Your agents weakened the garrisons (−{pct}%)',
  }),

  // --- World-map marks (game/render/intelMarks.js) ---------------------------------------------
  marks: Object.freeze({
    badgeFadeStartZoom: 8,    // garrison badges fade in between these two zoom levels (px per world unit)
    badgeFullZoom: 11,
    badgeDropUnits: 0.30,     // badge centre sits this many world units below the settlement anchor
    ringPeriodSec: 1.9,       // weak-point ring pulse
    ringRadiusUnits: 0.8,      // half-width of the ring, in world units (the ring is a ground ellipse)
    ringDropUnits: 0.24,       // ring centre sits this far below the settlement anchor, around building and badge
  }),
});
