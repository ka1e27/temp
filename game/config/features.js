// A varied map (DESIGN §10.13): region types, battle twists, the Dragon and their rewards. Every number lives here; read by
// game/world/regionFeatures.js, game/battle/{arena,features,dragon}.js, game/meta/{progression,economy,features}.js. Balance notes
// sit on the lines.

export const REGION_TYPES = Object.freeze(['goldmine', 'monastery', 'bandit', 'ruins', 'dragon']);
export const TWISTS = Object.freeze(['night', 'blizzard', 'flooded', 'holy', 'siege', 'raid']);

export const FEATURES = Object.freeze({
  // --- Assignment (game/world/regionFeatures.js; seeded per world, never on the start region or the first ring) -------------
  minTier: 2,                  // types and twists only from this tier (DESIGN: none on the tutorial region or first ring)
  typeShare: 0.25,             // about 1 region in 4 beyond the first ring gets a type ...
  typeWeights: Object.freeze({ goldmine: 0.3, monastery: 0.25, bandit: 0.25, ruins: 0.2 }), // ... picked with these weights
  dragonFromTierShare: 0.75,   // the one Dragon's Lair: a non-capital region at least this deep (share of the deepest tier)
  twistShare: 0.33,            // about 1 region in 3 beyond the first ring gets a twist ...
  twistWeights: Object.freeze({ night: 1, blizzard: 1, flooded: 1, holy: 1, siege: 0.6, raid: 1 }), // ... with these weights
  capitalTwist: 'siege',       // every rival capital has a Gate before its keep (DESIGN §10.13)

  // --- Types in battle ------------------------------------------------------------------------------------------------------
  bandit: Object.freeze({
    vet: 1.3,                  // veteran troops: +30% attack AND defence (x1.69 strength), at the camp and in the squads it sends
    troops: 30,                // the Bandit Camp's garrison, x the region's troop multiplier
  }),
  ancientTower: Object.freeze({
    range: 4, volleySec: 0.35, kills: 2,   // a strong tower: further, faster, harder than a plain one (SITE_TYPES.tower)
    troops: 20,                // garrison, x the region's troop multiplier
  }),
  gate: Object.freeze({ troops: 18 }),     // the Gate's garrison (26 made Siege capitals of later dynasties a 45-60 min wait), x the region's troop multiplier (SITE_TYPES.gate has its defence)
  shrine: Object.freeze({
    count: 3, troops: 8,       // three Shrines, each this garrison x the troop multiplier
    holdSec: 10,               // hold all of them this long to win (DESIGN §10.13)
    minGap: 3,                 // hexes between Shrines and from the region's settlements
  }),

  // --- Twists in battle -----------------------------------------------------------------------------------------------------
  night: Object.freeze({ towerRange: 0.5 }),           // towers (and the camp's arrows) reach half as far, both sides
  blizzard: Object.freeze({ speed: 0.7, firestorm: 1.5 }), // marches -30% both sides; Firestorm +50%
  // Holy Ground takes the player's powers away, most of a late army's worth on the card: its garrisons and settlement caps shrink by
  // garrison / (1 + the card's power bonus) so it changes how the fight plays, not how hard it is (with a flat x0.6 a late Holy
  // region still read Hard for three hours on seed 7). floor: never below this share
  // startCap (PLAN-PHASE14): a Holy Ground garrison starts at no more than this x its cap (the card's DIFFICULTY.overCapCredit, so the card
  // is unchanged). Late garrisons start 10-25x over their caps; with no Bulwark or Levy to weather that opening rush a player holding one
  // or two border sites lost in 30-60 s, and Holy Ground fights read Easy were won 12 of 20 (3 of 14 at Ascension 10; tools/_p14pace.mjs).
  holy: Object.freeze({ garrison: 0.8, floor: 0.08, startCap: 2 }),

  // --- The Dragon (game/battle/dragon.js) -------------------------------------------------------------------------------------
  dragon: Object.freeze({
    hp: 250,                   // health, x the region's troop multiplier (strength units: troops x atk x def traded at its perch)
    perchDef: 1.4,             // the site it perches on defends x this
    breathSec: 12,             // a breath every this many seconds ...
    telegraphSec: 1.5,         // ... telegraphed this long before it lands
    breathRange: 7,            // hexes from its perch it can reach
    breathRadius: 1.4,         // hexes the flames cover
    breathShare: 0.35,         // each site and squad in the flames loses this share of its troops (the player's armies do not grow
                               // with the enemy's depth, so a flat burn x the troop multiplier wiped a camp at a time)
    breathDamage: 5,           // ... and this many troops more
    bulwarkCut: 0.4,           // a Bulwarked site takes this share of the damage (the counterplay)
    perchLoss: 0.25,           // taking the site it perches on costs it this share of its full health (four perches fell it), so a
                               // strong army that keeps winning ground ends the fight (without it later dynasties timed out at 12 min)
    flySec: 26,                // it changes perch this often ...
    flightSec: 3,              // ... and the flight takes this long (no perch, no breath)
  }),

  // --- Rewards (meta) ---------------------------------------------------------------------------------------------------------
  rewards: Object.freeze({
    goldmine: Object.freeze({ bounty: 3, income: 0.25, renown: 0 }),
    monastery: Object.freeze({ bounty: 1, renown: 3, scoutHops: 2 }),
    bandit: Object.freeze({ bounty: 2, renown: 2 }),
    ruins: Object.freeze({ bounty: 1, renown: 5 }),
    dragon: Object.freeze({ bounty: 1, renown: 10 }),   // and the Dragonscale boon: every fortification counts one level higher
  }),

  // --- The difficulty card (progression.js difficulty, battle/difficulty.js) --------------------------------------------------
  // Strength x this per twist / type, fitted by tools/balance.mjs --twist sweeps so the labels stay honest. Night counts only
  // while the region is not scouted. The extra sites (Bandit Camp, Ancient Tower, Gate, Shrines) are also counted as sites.
  difficulty: Object.freeze({
    // measured against plain regions of tier 2+ (balance.mjs --feature=X, seeds 1-12, ratio for a 60% win): Night x0.78 (the halved
    // towers help the attacker; the hidden garrisons only hurt a person, so unscouted it reads as a plain fight), Blizzard x0.94,
    // Holy Ground x0.93 (its powers already taken out of Army Power), Siege x0.88 (the Gate is also counted as a site), Raid x0.72 (a
    // second way to win), Bandit Hold x1.10, Ruins x1.31; Flooded had too few fights to measure (32) and reads a little easier
    night: 0.86, nightUnscouted: 0.92, blizzard: 0.94, flooded: 0.9, holy: 0.98, siege: 0.75, raid: 0.68, // siege 0.88 -> 0.75 once the AI stopped refilling the Gate (sweep x0.97; campaign Fair Siege capitals then won 10 of 10)
    bandit: 1.1, ruins: 1.31, dragon: 1.3, // the Lair (with its health also counted below): won 70% at card ratios 1.55-2 before this
    dragonHpWeight: 0.3,       // the Dragon's health counts this much as garrison strength (0.5 read later dynasties' Lairs Deadly for hours; 0.15 read D1's Fair at 17%)
  }),

  copy: Object.freeze({
    typeNames: Object.freeze({ goldmine: 'Gold Mine', monastery: 'Monastery', bandit: 'Bandit Hold', ruins: 'Ruins', dragon: "Dragon's Lair" }),
    twistNames: Object.freeze({ night: 'Night', blizzard: 'Blizzard', flooded: 'Flooded', holy: 'Holy Ground', siege: 'Siege', raid: 'Raid' }),
    typeText: Object.freeze({
      goldmine: 'Bounty x3; +25% income while held',
      monastery: '+3 Renown; scouts regions within 2 while held',
      bandit: 'Veteran Bandit Camp; bounty x2, +2 Renown',
      ruins: 'An Ancient Tower defends it; +5 Renown',
      dragon: 'A Dragon guards it; +10 Renown and Dragonscale',
    }),
    twistText: Object.freeze({
      night: 'Towers see half as far; garrisons hidden until scouted',
      blizzard: 'Marches 30% slower; Firestorm +50%',
      flooded: 'Rivers can only be crossed on road bridges',
      holy: 'Powers cannot be used (abilities can)',
      siege: 'A Gate stands before the keep',
      raid: 'Hold all 3 Shrines for 10 s to win',
    }),
    dragonscale: 'Dragonscale: every fortification counts one level higher',
    siteNames: Object.freeze({ bandit: 'Bandit Camp', ancientTower: 'Ancient Tower', gate: 'Gate', shrine: 'Shrine' }),
  }),
});
