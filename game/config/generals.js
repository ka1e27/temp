// Generals (DESIGN §10.8, §10.11): the roster, passives, actives, levels, skills, wounds and the steward each one makes.
// Every number the feature uses lives here. Read by game/meta/generals.js, game/meta/generalsState.js, game/battle/abilities.js
// and game/battle/steward.js (through the commander's style object). Balance notes sit on the lines.
//
// Measured (tools/balance.mjs, seeds 1-8 attacks / 9-20 raids, the bots using the ability as a person would):
//   commanding in person, Army Power vs no General   level 1: Marshal x1.09, Champion x1.07, Oracle x1.07, Outrider x1.05
//                                                    level 10 (skills option 0): x1.16, x1.20, x1.20, x1.15
//   holding a raid unattended, no forts (Captain 55%) level 1: Marshal 81%, Champion 66%, Oracle 74%, Outrider 68%
//                                                    level 10: 89%, 73%, 84%, 73%
// DESIGN's starting values that moved: the Champion's assault passive +15% -> +4% (+15% made it x1.17 at level 1), the Raid 15% ->
// 45% of the camp (x1.03), +2% passive a level read as a share of the passive (two points a level: a level-10 Marshal held 98%).

const MIN_MS = 60 * 1000;

/** The four kinds of General plus mercenaries. Champions join when their faction's capital falls (faction id -> kind). */
export const CHAMPION_OF_FACTION = Object.freeze({ 2: 'crimson', 3: 'violet', 4: 'amber', 5: 'gravewarden' }); // 5: the Ashen Host (PLAN-PHASE6)

export const GENERALS = Object.freeze({
  maxLevel: 10,
  // XP to go from level L to L+1 is xpPerLevel x L (250, 500, ... 2250: 11,250 XP to level 10). At 100 the Marshal reached level 9
  // in the first dynasty (tools/campaign.mjs); now about level 5-6, and the roster grows over dynasties
  xpPerLevel: 250,
  xp: Object.freeze({ win: 100, defenseWon: 80, loss: 40 }), // DESIGN §10.11
  // Each level adds this share of the passive's base value (DESIGN: "+2% to the passive": the Marshal's +15% is +17.7% at level 10;
  // read as two POINTS a level, a level-10 Marshal's +33% defence held 98% of raids unattended)
  passivePerLevel: 0.06,
  skillLevels: Object.freeze([2, 4, 6, 8, 10]), // a 1-of-2 pick at each (DESIGN §10.11)
  woundMs: 10 * MIN_MS,       // losing a battle wounds its General this long
  maxMercenaries: 2,
  // What the difficulty card credits a commander (progression.js difficulty(..., { commander })): Army Power x (1 + base + perLevel x
  // (level - 1)), the measured worth above (about x1.07 at level 1, x1.18 at level 10)
  // vs: the credit x this against a personality. Swarm (PLAN-PHASE5 §5E): campaign Fair fights against the Amber Horde were won 50/51 with
  // Generals and 43/57 without (seeds 1-12): a General (its defence passive, Shield Wall, its steward) is worth far more against the
  // swarm's waves than the flat credit says. tools/swarmcheck.mjs --probe (every swarm frontier region of campaign states fought by the
  // bot with its best General, seeds 1-12), by the card's credited label: x1 Easy 100% / Fair 89% / Hard 62% (the card read too hard);
  // x2 94 / 83 / 48 (6 seeds); x3 94% (49/52) / 71% (46/65) / 40% (14/35); x4 93 / 66 / 35 (6 seeds). The synthetic ladder has no
  // commander and is unchanged.
  // PLAN-PHASE6 §6C: with the campaign reading the credited card, vs swarm x3 made Fair swarm fights a coin flip (16 of 32 won, D1, 12 seeds)
  // and broke balance.labels' calibration (bin 1.3-1.55: 68% won vs 80% said); x1.5 restores it (75% vs 80%).
  cardCredit: Object.freeze({ base: 0.07, perLevel: 0.012, vs: Object.freeze({ swarm: 1.5 }) }),

  // --- The kinds (DESIGN §10.11 table) -------------------------------------------------------------------------------------
  // passive: { stat, value } on PlayerStats while commanding (see meta/generals.js commanderEffects):
  //   garrisonMult: your settlements' defence x (1 + value)          assaultMult: squads assaulting a settlement x (1 + value)
  //   cooldown: power cooldowns x (1 - value)                        speed: squad march speed x (1 + value)
  //   campTroops: War Camp troops x (1 + value)
  kinds: Object.freeze({
    marshal: Object.freeze({
      title: 'Marshal', style: 'stalwart', passive: Object.freeze({ stat: 'garrisonMult', value: 0.15 }), ability: 'shieldWall',
      skills: Object.freeze([
        Object.freeze(['wallLong', 'wallHeal']),
        Object.freeze(['passivePlus', 'holdForts']),
        Object.freeze(['wallLong2', 'garrisonPlus']),
        Object.freeze(['passivePlus', 'thinkFast']),
        Object.freeze(['wallLevy', 'passivePlus2']),
      ]),
    }),
    crimson: Object.freeze({
      title: 'Champion', style: 'bold', passive: Object.freeze({ stat: 'assaultMult', value: 0.04 }), ability: 'charge',
      skills: Object.freeze([
        Object.freeze(['chargeMore', 'chargeHarder']),
        Object.freeze(['passivePlus', 'counter13']),
        Object.freeze(['chargeMore', 'chargeFaster']),
        Object.freeze(['passivePlus', 'thinkFast']),
        Object.freeze(['chargeHarder', 'passivePlus2']),
      ]),
    }),
    violet: Object.freeze({
      title: 'Oracle', style: 'cunning', passive: Object.freeze({ stat: 'cooldown', value: 0.2 }), ability: 'foresight',
      skills: Object.freeze([
        Object.freeze(['foresightLong', 'foresightSlow']),
        Object.freeze(['passivePlus', 'usesFirestorm']),
        Object.freeze(['foresightLong', 'foresightSlow']),
        Object.freeze(['passivePlus', 'thinkFast']),
        Object.freeze(['foresightSlow', 'passivePlus2']),
      ]),
    }),
    amber: Object.freeze({
      title: 'Outrider', style: 'swift', passive: Object.freeze({ stat: 'speed', value: 0.2 }), ability: 'raid',
      skills: Object.freeze([
        Object.freeze(['raidTwo', 'raidNoArrows']),
        Object.freeze(['passivePlus', 'relocateFast']),
        Object.freeze(['raidBigger', 'raidNoArrows']),
        Object.freeze(['passivePlus', 'thinkFast']),
        Object.freeze(['raidBigger', 'passivePlus2']),
      ]),
    }),
    // The Gravewarden (PLAN-PHASE6 §6B), recruited by toppling the Barrow Keep. passive reclaim: a share of the enemy troops killed
    // attacking your settlements join that settlement (battle/fallen.js). Active Raise the Fallen (battle/abilities.js).
    gravewarden: Object.freeze({
      title: 'Gravewarden', style: 'stalwart', passive: Object.freeze({ stat: 'reclaim', value: 0.1 }), ability: 'raiseFallen',
      skills: Object.freeze([
        Object.freeze(['raiseLong', 'raiseBigger']),
        Object.freeze(['passivePlus', 'holdForts']),
        Object.freeze(['raiseBigger', 'raiseLong']),
        Object.freeze(['passivePlus', 'thinkFast']),
        Object.freeze(['raiseBigger', 'passivePlus2']),
      ]),
    }),
    mercenary: Object.freeze({
      title: 'Captain', style: null, passive: null, ability: 'bonus',
      skills: Object.freeze([
        Object.freeze(['bonusMore', 'passivePlus']),
        Object.freeze(['passivePlus', 'thinkFast']),
        Object.freeze(['bonusMore', 'passivePlus']),
        Object.freeze(['passivePlus', 'thinkFast']),
        Object.freeze(['bonusMore', 'passivePlus2']),
      ]),
    }),
  }),
  // A mercenary rolls one of these (seeded) on hire: a smaller passive and a steward style.
  mercenaryPassives: Object.freeze([
    Object.freeze({ stat: 'campTroops', value: 0.1 }),
    Object.freeze({ stat: 'speed', value: 0.1 }),
    Object.freeze({ stat: 'garrisonMult', value: 0.1 }),
  ]),
  mercenaryStyles: Object.freeze(['stalwart', 'bold', 'cunning', 'swift']),

  // --- Skill effects (meta/generals.js commanderEffects reads these) ----------------------------------------------------------
  skillValues: Object.freeze({
    passivePlus: 0.03,      // +3 points on the passive
    passivePlus2: 0.05,     // +5 points on the passive
    garrisonPlus: 0.05,     // Marshal: +5 points of settlement defence on top
    wallLong: 2,            // Shield Wall +2 s (DESIGN suggested 8 s; a 10-s wall held 93% of raids unattended at level 10)
    wallLong2: 1,           // and +1 s more
    wallHeal: 0.1,          // Shield Wall also heals 10% of every garrison (DESIGN example)
    wallLevy: 3,            // Shield Wall also musters this many troops at every settlement you hold
    chargeMore: 2,          // Charge covers 2 more squads
    chargeHarder: 0.15,     // Charge squads +15 points of strength
    chargeFaster: 0.25,     // Charge squads +25 points of speed
    foresightLong: 4,       // Foresight +4 s
    foresightSlow: 0.1,     // Foresight slows enemy squads 10 points more
    raidTwo: 2,             // Raid sends two squads (each the full size)
    raidBigger: 0.05,       // Raid squads +5 points of the camp's troops
    bonusMore: 0.1,         // Pay the Bonus +10 points
    counter13: 1.3,         // Bold steward: retakes at 1.3x instead of 1.5x (DESIGN example)
    holdForts: 0.15,        // Stalwart steward: reinforces its keep and forts to a margin this much higher ("never abandons a fort")
    relocateFast: 4,        // Swift steward: sees threats this many seconds further ahead
    raiseLong: 10,          // Gravewarden: Raise the Fallen reaches this many seconds further back
    raiseBigger: 0.05,      // Gravewarden: Raise the Fallen's cap +5 points of the camp's starting troops
  }),
  // What each skill says on the roster (numbers filled in from skillValues / abilities by meta/generals.js skillText).
  skillText: Object.freeze({
    passivePlus: 'Passive +{pct}', passivePlus2: 'Passive +{pct}', garrisonPlus: 'Settlements +{pct} defence',
    wallLong: 'Shield Wall lasts {n} s longer', wallLong2: 'Shield Wall lasts {n} s longer', wallHeal: 'Shield Wall heals {pct} of garrisons',
    wallLevy: 'Shield Wall adds {n} troops everywhere', chargeMore: 'Charge covers {n} more squads', chargeHarder: 'Charge hits {pct} harder',
    chargeFaster: 'Charge marches {pct} faster', foresightLong: 'Foresight lasts {n} s longer', foresightSlow: 'Foresight slows {pct} more',
    raidTwo: 'Raid sends {n} squads', raidNoArrows: 'Raid squads ignore tower fire', raidBigger: 'Raid squads {pct} bigger',
    bonusMore: 'The Bonus pays {pct} more', counter13: 'Steward retakes at {n}x odds', holdForts: 'Steward never abandons a fort',
    usesFirestorm: 'Steward calls Firestorm', raiseLong: 'Raise the Fallen reaches {n} s further back', raiseBigger: 'Raise the Fallen cap +{pct}', relocateFast: 'Steward sees {n} s further ahead', thinkFast: 'Steward thinks faster',
  }),

  // --- Actives (game/battle/abilities.js; DESIGN §10.11) -------------------------------------------------------------------------
  abilities: Object.freeze({
    shieldWall: Object.freeze({ duration: 5 }),                                     // Bulwark on every settlement you hold
    charge: Object.freeze({ squads: 3, speed: 0.5, strength: 0.3 }),                // your next 3 squads +50% speed, +30% strength
    foresight: Object.freeze({ duration: 8, slow: 0.3 }),                           // enemy squads -30% speed, targets revealed
    raid: Object.freeze({ share: 0.45, squads: 1 }),                                // a free squad of 45% of the camp's starting troops (DESIGN said 15%: the Outrider was worth x1.03)
    bonus: Object.freeze({ share: 0.2 }),                                           // +20% troops at the camp (the keep in a defense)
    raiseFallen: Object.freeze({ windowSec: 20, cap: 0.25 }),                       // the troops you lost in the last 20 s rise at your strongest site, at most 25% of the camp's starting troops (PLAN-PHASE6)
  }),

  // --- The steward a General makes (DESIGN §10.11: quality improves with level) ------------------------------------------------
  // Interpolated by level between `atLevel1` and `atLevel10` (config/frontier.js STEWARD has the style's other traits). A level-1
  // General already holds clearly better than the Militia Captain (STEWARD.captain: think 10 s, look 2 s ahead).
  // A General's steward starts from the Militia Captain's table (config/frontier.js STEWARD.captain) with its style's traits
  // (retake and attack odds, powers, reserve), and earns the Stalwart's tactics (consolidating, evacuating, a wider margin) from
  // `tacticsFromLevel`. With level 1 at think 5 s / look 5 s and the tactics from level 1 it held 89% of raids, level 10 98%.
  steward: Object.freeze({
    atLevel1: Object.freeze({ thinkSec: 9, lookahead: 2 }),
    atLevel10: Object.freeze({ thinkSec: 8, lookahead: 2.6 }),
    tacticsFromLevel: 11,
    thinkFast: 0.75,        // the 'thinkFast' skill: think interval x this
  }),

  // --- Names (seeded per kind; DESIGN §10.11 examples) ---------------------------------------------------------------------------
  names: Object.freeze({
    marshal: Object.freeze(['Edric', 'Aldwyn', 'Bertram', 'Osric', 'Leofric', 'Hadric', 'Wystan', 'Godwin']),
    crimson: Object.freeze(['Gorran Redhand', 'Brannoc Ironjaw', 'Varra the Red', 'Tarn Bloodsworn', 'Kael Crimsonhelm']),
    violet: Object.freeze(['Sister Veyl', 'Mother Ysolde', 'Brother Quill', 'Seer Ondine', 'Sister Maelis']),
    amber: Object.freeze(['Tamsin of the Steppe', 'Arik Swiftmane', 'Juna Dawnrider', 'Bator of the Long Grass', 'Saran Galeheart']),
    gravewarden: Object.freeze(['Hollow Aldric', 'Sexton Mourne', 'Wenna of the Barrows', 'Old Tallow', 'Cadoc Ashveil']),
    mercenary: Object.freeze(['Hollis Grey', 'Mags Ironpurse', 'Old Fennick', 'Dace the Hired', 'Rook Ambrel', 'Ysa Coinblade']),
  }),
  copy: Object.freeze({
    abilityNames: Object.freeze({ shieldWall: 'Shield Wall', charge: 'Charge', foresight: 'Foresight', raid: 'Raid', bonus: 'Pay the Bonus', raiseFallen: 'Raise the Fallen' }),
    styleNames: Object.freeze({ stalwart: 'Stalwart', bold: 'Bold', cunning: 'Cunning', swift: 'Swift' }),
    captainName: 'Militia Captain',
    // what a champion says when they join (the recruitment card, DESIGN 10.11); `other` for anyone else
    recruitLines: Object.freeze({
      crimson: 'Your banner beat mine fairly. My blade is yours.',
      violet: 'I foresaw this day. I will see the paths you cannot.',
      amber: 'The steppe follows strength. Point, and I ride.',
      gravewarden: 'The dead keep no banner. I will keep yours.',
      other: 'I fight for you now.',
    }),
  }),
});
