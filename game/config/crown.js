// The Crown of Ages (docs/PLAN-PHASE13.md §13A, §13B): the final continent, the Usurper (faction 7), the Throne of Ages and the ending.
// Every number the feature uses lives here, with its reason. Read by game/world/crown.js (generation), game/battle/throne.js (the
// three-phase battle), game/meta/crown.js (availability, the ending record, the crowned marker) and the tools. Ascension has its own
// file (config/ascension.js); the Usurper-King's lines are in config/leadersUsurper.js.

export const USURPER_FACTION = 7;

export const CROWN = Object.freeze({
  // PLAN 13A: offered at the founding of dynasty 7 or later (optional: the ceremony's extra choice)
  fromDynasty: 7,
  // "The largest map (about 34 regions)": at least this many, or the dynasty's own count when that is larger (DYNASTY.regionsPerDynasty).
  // A normal dynasty 7 continent already has 34 (28 + 6), so the Crown continent is never smaller than the continent it replaces.
  regionCount: 34,
  // Every rival kind (PLAN 13A): the three rival sectors go to two classic factions (seeded from the three) and the Ashen Host; the Sea
  // Kings and the Usurper are carved out of them afterwards (world/crown.js)
  classic: Object.freeze([2, 3, 4]),
  // The Usurper holds the centre: the region nearest the middle of the land (beyond the Free Folk rings) is the Throne of Ages, and its
  // domain is this many regions around it (graph order). 5 of 34: about a third of a classic sector, enough for the finale to be a march.
  usurperRegions: 5,
  // The Sea Kings hold a stretch of coast cut into islands (the partial archipelago): this many regions grown from the most sea-facing
  // rival region far from the start. Islands of 3+ regions read as places to conquer (ARCHIPELAGO.minIslandRegions).
  seaRegions: 5,
  seaIslandSplitFrom: 6,  // a Sea Kings domain of at least this many regions is cut into two islands, else it is one
  minSector: 2,           // a carve that would leave any rival with fewer regions is retried smaller (never a one-region faction)
  minCentreTier: 3,       // the Throne sits beyond the Free Folk rings (tiers 1-2) so it is never the second fight of a dynasty
  copy: Object.freeze({
    choice: 'Seek the Crown of Ages',
    choiceText: 'The final continent: every rival, the Usurper on the Throne of Ages at its heart. Topple him to end the tale.',
    ceremony: 'The House of {house} sails for the Crown of Ages. The Usurper waits on the Throne.',
    cardThrone: 'The Throne of Ages: a Gate held by three Champions, then the Usurper himself',
    cardUsurper: 'The Usurper: he borrows every rival\'s weapon',
    hint: 'The Throne of Ages: break the Gate, weather what he borrows, then bring down the Usurper himself.',
  }),
});

// The 'usurper' AI (game/battle/ai.js PERSONALITY.usurper): a blend of every rival it has subjugated. It guards its keep like the
// Violet Covenant and strikes in two waves like the Crimson Legion: mixed garrisons, no single habit to exploit.
export const USURPER_AI = Object.freeze({
  tuning: Object.freeze({
    reserve: 0.3, keepGuard: 1.1, margin: 1.15, maxCommit: 0.85, waves: 2, thinkMult: 0.85, open: 6,
    extend: 2.5, softOnly: false, neutrals: true, losing: 0.4, sources: 3,
  }),
});

// The Throne of Ages (PLAN 13A): the Usurper's capital, a three-phase boss battle (game/battle/throne.js).
export const THRONE = Object.freeze({
  // The finale sits on the top rung of the ladder whatever its tier (progression.js enemyDepth): the centre of the map is often only
  // mid-depth, and the last fight of the long game must be the hardest one
  topRung: true,
  // --- Phase 1: the Gate and its three Champions ---
  gateTroops: 30,         // the Gate's garrison x the troop multiplier (a Siege Gate is FEATURES.gate.troops 18: this one is the realm's last wall)
  champions: Object.freeze([
    Object.freeze({ kind: 'barrowKnight', faction: 5, name: 'Barrow Knight' }),
    Object.freeze({ kind: 'reaverCaptain', faction: 6, name: 'Reaver Captain' }),
    Object.freeze({ kind: 'champion', faction: 0, name: 'Champion' }), // faction 0 = the first classic faction on the continent
  ]),
  championTroops: 14,     // each Champion's post: this garrison x the troop multiplier (a village's 12, but veterans) ...
  championVet: 1.3,       // ... +30% attack AND defence, at the post and in the squads it sends (as a Bandit Camp: x1.69 strength)
  championGateDef: 0.15,  // the Gate defends +15% for each Champion still standing (all three: +45%): take them first, or pay at the Gate
  championGap: 2,         // hexes between a Champion's post and the Gate / the region's settlements (placement)
  championRing: 4,        // ... and at most this far from the Gate
  // --- Phase 2: the borrowing (once the Gate falls) ---
  borrow: Object.freeze({
    firstSec: 10,         // the first borrow comes this long after the Gate falls (time to regroup)
    everySec: 30,         // PLAN 13A: every 30 s (Ascension 9: x hazardIntervalMult)
    telegraphSec: 4,      // each is announced this long before it strikes (the Tide's 4 s)
    order: Object.freeze(['rising', 'tide', 'plague']), // PLAN 13A: the Ashen's Rising, the Sea Kings' Tide, then a Plague, in turn
    // the Rising: a free squad of this share of the keep's starting garrison marches on the player's nearest site (the Barrow Keep's 5%,
    // a little more: it comes every 90 s, not every 20)
    risingShare: 0.08,
    risingMin: 5,
    // the Tide on the approach routes: tiles on the cheapest paths from every other site to the keep within routeRadius hexes of it, plus
    // keepShore of the keep (seaArena.js's rule without the shore requirement: he borrows the tide, he does not need a sea)
    tideRouteRadius: 5,
    tideKeepShore: 2,
    tideMaxTiles: 28,     // nearest to the keep first: a ring across the approach, not a flooded region
    tideFloodSec: 8,
    tideLoss: 0.25,       // squads caught on the flooded tiles lose this share (the Tide Fortress's 30%, a little less: no ford to avoid)
    plagueSec: 10,        // PLAN 13A: a Plague-like weakness on your sites ...
    plagueDefMult: 0.85,  // ... -15% defence for 10 s
  }),
  // Phase 2 lasts at least the whole borrowing cycle: the keep is WARDED (it cannot drop below the field mark, battle.throne.warded) until
  // this many borrows have struck. Late keeps otherwise fell within 20-40 s of the Gate and the borrowing never showed.
  wardBorrows: 3,
  // --- Phase 3: the Usurper takes the field ---
  fieldAt: 0.4,           // PLAN 13A: when the keep drops below 40% (of its starting garrison, or its cap if lower) while you assault it
  // Every Usurper site of the Throne (the Gate, the posts, the keep, its settlements) holds this x a capital's cap. Late garrisons start far
  // above their caps (35 x the troop multiplier against 180 x the cap multiplier) and bleed down to them within two or three minutes, so
  // a late battle is really fought at cap scale: this is the lever on how hard the Throne is once the bleeding is done (the card counts it:
  // progression.js estimateStrength).
  capMult: 3,
  // His squad: this share of the Throne keep's (Throne-sized) cap (and at least usurperArmyShare x the troops the player has in the battle,
  // 0 = off), x throneHpMult (Ascension 7). Sized from the CAP, not the troop multiplier: late garrisons start far above
  // their caps and bleed down to them within two minutes, so the battle is really fought at cap scale. At 28 x the troop multiplier (the
  // keep's own start) he was 5-10x the player's whole army and phase 3 a fixed 4-8 minute grind against one garrison (a trade runs at the
  // smaller side's rate) that no power shortened; at 1 x the cap he fell to Firestorms in 20-40 s; sized from the army in the battle
  // (usurperArmyShare) more power only made him bigger (a phase-3 timeout). 6 x the cap: phase 3 lasts 1.5-5 minutes
  // in the D7 campaign replays.
  usurperCapShare: 6,
  usurperArmyShare: 0,
  usurperPower: 2.5,      // ... each worth this many (as a Champion's 2.0): a hero, not an army
  hitStep: 20,            // a usurperHit event at every 1/20 of his health (the Dragon's step)
  retargetSec: 1,         // with no target in reach he holds where he stands and looks again this often
  // The card (progression.js estimateStrength): the Throne's Gate (capMult), the three posts and the Usurper's health are counted as sites
  // (his health at usurperWeight of a garrison's worth, as the Dragon's dragonHpWeight), then the whole is x factor. Measured on the 12
  // D7 campaign Thrones with the enemy scaled (scratch sweep, see the Phase 13 report): at factor 1 the card read Deadly (3-6%) for fights
  // the bot won 12/12 in 7 minutes, and the bot still won 79% with the Throne 4x as strong. A late fight is bleed- and structure-bound, so
  // the honest factor (about 0.1) makes the bot attack at the margin, where fights run 12-15 minutes. 0.35 keeps the card on the safe side
  // (12 seeds: attacks at Fair 60-80%, 12 of 14 won, median 8.3 min, 2 timeouts; 0.45 stalled 1 seed of 12 after a lost Throne).
  // PLAN-PHASE14: 0.25. A person (tools/campaign.mjs --policy=human) attacks at Hard; at 0.35 it attacked every Throne the moment the card
  // first read Hard (35-36%) and won 6 of 6 in 5-10 minutes, after waiting up to 4.6 h with nothing else left on the continent. At 0.25
  // (12 seeds) it attacks at 35-67% right after the last other region falls and wins 12 of 12 (median 8.9 min); the optimal campaign attacks
  // at Fair or Easy and wins 12 of 12 (median 9.2 min). 0.2 also won every fight (cards 39-83%), but 0.25 stays on the safe side.
  card: Object.freeze({ usurperWeight: 0, factor: 0.25 }),
  // The tools' patience for the Throne (patienceFor): a fight still going after this long counts as a timeout. PLAN 13A wants a median
  // of 6-9 minutes, so 15 minutes is well past a slow win and short of a stalemate.
  patienceSec: 900,
});

// The ending (PLAN 13B): the cinematic's pacing hints and the Chronicle scroll's copy. endingRecord (meta/crown.js) fills the numbers.
export const ENDING = Object.freeze({
  credits: Object.freeze({ title: 'Hex Dominion 2', line: 'made with Claude' }),
  crownLine: 'Crowned in Year {year}',             // the title screen's lasting Crown ({year}, {dynasty} available)
  crownLineFull: 'Crowned in Year {year} of the {ordinal} dynasty',
  scrollTitle: 'The Chronicle of Your Reign',
  cinematicStops: 5,     // the cinematic's camera visits at most this many regions (the conquered capitals first)
  highlights: 8,         // the scroll shows at most this many lifetime Chronicle highlights (the latest)
  // the scroll's ready-made lines (endingRecord().lines), in order; a line whose number is 0 or unknown is left out
  lines: Object.freeze({
    dynasties: 'Founded {n} dynasties',
    edicts: 'Ruled by {list}',
    generals: 'Led by {list}',
    relics: 'Found {n} of {total} Relics',
    vendettas: 'Won {n} Vendettas',
    vendetta1: 'Won a Vendetta',
    dragons: 'Slew the Dragon {n} times',
    dragon1: 'Slew the Dragon',
    capitals: 'Toppled {n} rival capitals',
    daily: 'Best Daily: {time}, {crowns} crowns',
    regions: 'Conquered {n} regions in all',
    battles: 'Won {n} battles',
    ascension: 'Reached Ascension {n}',
  }),
});
