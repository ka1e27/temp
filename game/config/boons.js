// Phase 7 (docs/PLAN-PHASE7.md §7A): Boons, a pick of 1 of 3 after every conquest won in battle. They last the dynasty and stack.
// Every number lives here; read by game/meta/boonsState.js (boonMods: the ONE modifier source of Boons and Relics), game/meta/boons.js
// (the draft, picks, rerolls, copy) and game/battle/boons.js (the sim side, through PlayerStats.boons).
//
// A Boon's `mods` override BOON_NEUTRAL. Keys ending in `Mult` multiply; booleans are switched ON by any source; keys in
// BOON_MAX_KEYS take the largest value; BOON_MINPOS_KEYS take the smallest non-zero value; every other number adds.
// Keys listed in BOON_SIM_KEYS are copied into PlayerStats.boons for the sim (only the non-neutral ones).
//
// Copy templates (meta/boons.js boonInfo): `{key}` -> the number, `{pct:key}` -> the size as a percentage ("40%", for a Mult the
// distance from 1). The text is built from these numbers, never typed twice.

export const BOON_NEUTRAL = Object.freeze({
  // --- Meta (read by the meta functions themselves) ---
  atkMult: 1,               // the player's attack in every battle (playerBattleStats; the card counts it)
  campTroopsMult: 1,        // the War Camp's starting troops (playerBattleStats; the card counts it)
  bountyMult: 1,            // the conquest bounty (progression.conquestBounty)
  lossGoldShare: 0,         // a lost battle costs this share of the gold in hand (meta/boons.js boonBattleEnd)
  titheEvery: 0,            // +titheRenown Renown every this many conquests (conquer)
  titheRenown: 0,
  plunderSec: 0,            // each settlement captured in battle pays this many seconds of income (boonBattleEnd)
  hoardStepSec: 0,          // +hoardStep income for every this many seconds of income held unspent (economy.incomePerSec) ...
  hoardStep: 0,
  hoardMax: 0,              // ... up to this much
  enemyKeepTroopMult: 1,    // the enemy keep's starting garrison in attack battles (enemyBattleStats.keepTroopMult; the card counts it)
  noChampion: false,        // Vendettas come without their Champion (frontier.defenseRunFor)
  trophyMult: 1,            // a Trophy's attack bonus x this (grudges.trophyBonus)
  freeFolkSurrender: 0,     // Free Folk regions surrender from this card ratio (0 = ECONOMY.surrenderRatio); the lowest source wins
  scoutAll: false,          // every region counts as scouted (intel.isScoutedOrFree, the card's Night reading)
  raidTroopMult: 1,         // incoming war bands (frontier.raidEnemyStats)
  // Phase 8 (PLAN-PHASE8 §8C), meta:
  quickFair: false,         // Cartographer: Quick Conquest also takes regions whose card reads Fair (quick.canQuickConquer)
  rearguard: false,         // Rearguard: retreating from an attack keeps the Conquest Streak alive (streak.onStreakBroken)
  crownProsperity: 0,       // Spoils of War: a three-crown win starts the region at this Prosperity level (crowns.awardCrowns)
  merchantPriceMult: 1,     // Relic: the Merchant's deals cost x this (events.js)
  siegeSecMult: 1,          // Relic: a raid defense's siege timer x this (frontier.defenseRunFor / estimateDefense)
  swiftParAdd: 0,           // Relic: Swift's par + this many seconds (crowns.parFor)
  // --- Sim (copied into PlayerStats.boons; read by game/battle/*) ---
  scorchSec: 0,             // Firestorm leaves burning ground this long ...
  scorchDps: 0,             // ... burning this many troops a second from every enemy squad standing in it
  turncoatShare: 0,         // a settlement you capture keeps this share of the defenders it lost in that assault, as yours
  hitRunSec: 0,             // after a capture your squads march hitRunMult faster for this long
  hitRunMult: 1,
  towerRateMult: 1,         // towers you hold loose arrows this much more often (x the volley interval)
  rallyPowerMult: 1,        // Rally's squads hit this much harder (squad power)
  captureBleed: 0,          // each capture of yours costs this share of the troops in every site you hold
  besiegedGrowthMult: 1,    // your settlements under assault grow at this x their rate (in a defense too, where they normally stop)
  roadStrengthMult: 1,      // your squads clashing on a road tile fight this much stronger
  nightRaiders: false,      // Night battles: enemy towers do not shoot your squads
  gateDefMult: 1,           // an enemy Gate's garrison defends at this x
  dragonDmgMult: 1,         // assaults on the Dragon's perch hurt it this much more
  dragonTelegraphAdd: 0,    // the Dragon's breath telegraph lasts this many seconds longer
  fallenMult: 1,            // The Fallen Rise (Ashen) x this
  abilityRechargeSec: 0,    // your commander's ability is ready again this long after its last use, once per battle
  secondWindTroops: 0,      // the first time one of your settlements would fall it holds and gains max(this, campShare x camp troops)
  secondWindCampShare: 0,
  pathfinder: false,        // your squads march through forest and marsh at open-ground cost
  plunder: false,           // the sim shows a gold pop at each capture (the gold itself is meta: plunderSec)
  warlordEvery: 0,          // every this-many-th squad you send is doubled
  phalanxMin: 0,            // your squads of at least this many troops ...
  phalanxDmgMult: 1,            // ... take this share of the damage (towers, clashes and assaults)
  martyrSurge: 0,           // when your War Camp falls, every site you hold gains this share of its troops ...
  martyrAtkMult: 1,         // ... and your squads hit this much harder ...
  martyrSec: 0,             // ... for this long
  fireArrowsDps: 0,         // Duo: an arrow from a tower you hold sets the squad ablaze, this many troops a second ...
  fireArrowsSec: 0,         // ... for this long
  ghostShare: 0,            // Duo: Turncoats keep this share instead against an 'undying' (Ashen) foe
  lightningWarSec: 0,       // Duo: each capture takes this many seconds off Forced March's cooldown
  firestormMult: 1,         // Relic: Firestorm damage
  rallyCdMult: 1,           // Relic: Rally's cooldown
  sundial: false,           // Relic: power cooldowns tick while the battle is paused and during the entry flight (battle/boons.js)
  lanternRadius: 0,         // Relic: no Fallen rise at settlements within this many hexes of your War Camp
  // Phase 8 (PLAN-PHASE8 §8C), sim:
  vanguardMult: 1,          // Vanguard: the first squad you send in a battle carries x this troops
  supplyBonus: 0,           // Supply Wagons: a squad your supply line sends carries +this share of extra troops
  sapperHexes: 0,           // Tower Sappers: an enemy tower within this many hexes of a site you hold ...
  sapperRangeMult: 1,       // ... shoots this much as far
  drumsSec: 0,              // War Drums: every power you cast makes your squads march drumsMult faster for this long
  drumsMult: 1,
  lastStandShare: 0,        // Last Stand: in a defense, your keep below this share of its cap ...
  lastStandDefMult: 1,      // ... defends this much harder
  drumVanguardMult: 1,      // Duo (Thunder Charge): the first squad you send after each power cast carries x this troops
  supplyNoArrows: false,    // Duo (Siege Train): squads your supply lines send ride through enemy arrows
  risingIntervalMult: 1,    // Relic: the Barrow Keep's Rising comes this much less often (x its interval)
});

export const BOON_MAX_KEYS = Object.freeze(['scorchSec', 'scorchDps', 'hitRunSec', 'hitRunMult', 'abilityRechargeSec', 'secondWindTroops',
  'secondWindCampShare', 'warlordEvery', 'phalanxMin', 'martyrSurge', 'martyrSec', 'fireArrowsDps', 'fireArrowsSec', 'ghostShare',
  'lightningWarSec', 'lanternRadius', 'titheEvery', 'titheRenown', 'plunderSec', 'hoardStepSec', 'hoardStep', 'hoardMax', 'turncoatShare',
  'captureBleed', 'lossGoldShare', 'dragonTelegraphAdd', 'crownProsperity', 'supplyBonus', 'sapperHexes', 'drumsSec', 'lastStandShare']);
export const BOON_MINPOS_KEYS = Object.freeze(['freeFolkSurrender']);
export const BOON_SIM_KEYS = Object.freeze(Object.keys(BOON_NEUTRAL).slice(Object.keys(BOON_NEUTRAL).indexOf('scorchSec')));

// The pool (PLAN-PHASE7 §7A table). `requires` keeps a Boon out of a draft where it could do nothing this dynasty:
//   powers (not Iron Will) · ability (a General may command: not Lone Banner) · raids (raids happen) · ashen (the Ashen hold land)
//   night / siege / dragon (an unconquered region with that twist / a Lair still stands) · quick (Quick Conquest is unlocked) · streak (the Conquest Streak exists)
// Deviations from the PLAN table (see docs/briefs/phase7-hookup.md): War Chest is "Royal Hoard" (the Legacy tree already has a War
// Chest node) and is measured in seconds of income, not 1K gold (gold grows 100x over three dynasties); Blood Price bleeds a share of
// every site instead of 3 troops (3 troops is no drawback past the first ring); Martyr's Crown's drawback is a smaller War Camp.
export const BOON_LIST = Object.freeze([
  // --- Common ---
  { id: 'hitAndRun', name: 'Hit and Run', rarity: 'common', icon: 'boot', mods: { hitRunSec: 5, hitRunMult: 1.4 },
    text: 'After each capture your squads march +{pct:hitRunMult} faster for {hitRunSec} s' },
  { id: 'engineers', name: 'Engineers', rarity: 'common', icon: 'tower', mods: { towerRateMult: 0.5 },
    text: 'Towers you capture loose arrows twice as fast' },
  { id: 'hoard', name: 'Royal Hoard', rarity: 'common', icon: 'coin', mods: { hoardStepSec: 60, hoardStep: 0.01, hoardMax: 0.2 },
    text: '+{pct:hoardStep} income for every minute of income you hold unspent (up to +{pct:hoardMax})' },
  { id: 'rallyHorns', name: 'Rally Horns', rarity: 'common', icon: 'horn', mods: { rallyPowerMult: 1.2 }, requires: 'powers',
    text: "Rally's squads hit +{pct:rallyPowerMult} harder" },
  { id: 'ironRations', name: 'Iron Rations', rarity: 'common', icon: 'wheat', mods: { besiegedGrowthMult: 1.5 },
    text: 'Your settlements keep growing under assault, +{pct:besiegedGrowthMult} faster' },
  { id: 'nightRaiders', name: 'Night Raiders', rarity: 'common', icon: 'moon', mods: { nightRaiders: true }, requires: 'night',
    text: 'In Night battles enemy towers do not shoot your squads' },
  { id: 'tithe', name: 'Tithe', rarity: 'common', icon: 'laurel', mods: { titheEvery: 3, titheRenown: 1 },
    text: '+{titheRenown} Renown every {titheEvery} conquests' },
  { id: 'bannerBearer', name: 'Banner Bearer', rarity: 'common', icon: 'banner', mods: { abilityRechargeSec: 60 }, requires: 'ability',
    text: "Your commander's ability recharges once per battle, {abilityRechargeSec} s after use" },
  { id: 'pathfinder', name: 'Pathfinder', rarity: 'common', icon: 'map', mods: { pathfinder: true },
    text: 'Your squads ignore forest and marsh slowdown' },
  { id: 'plunderers', name: 'Plunderers', rarity: 'common', icon: 'chest', mods: { plunderSec: 5, plunder: true }, // 10 s: D1 -11% alone (the campaign's per-Boon sweep)
    text: 'Each settlement you capture in battle pays {plunderSec} s of income' },
  { id: 'fortuneFavours', name: 'Fortune Favours', rarity: 'common', cursed: true, icon: 'dice', mods: { bountyMult: 1.4, lossGoldShare: 0.15 }, // x1.5 / 10%: D1 -10% alone, the drawback barely bit
    text: 'Conquest bounty +{pct:bountyMult}; a lost battle costs {pct:lossGoldShare} of your gold' },
  // --- Rare ---
  { id: 'scorchedEarth', name: 'Scorched Earth', rarity: 'rare', icon: 'flame', mods: { scorchSec: 6, scorchDps: 2 }, requires: 'powers', // 3/s: D1 -7% alone
    text: 'Firestorm leaves burning ground for {scorchSec} s that burns {scorchDps} troops a second from enemy squads in it' },
  { id: 'turncoats', name: 'Turncoats', rarity: 'rare', icon: 'flag', mods: { turncoatShare: 0.3 },
    text: 'Settlements you capture keep {pct:turncoatShare} of their fallen defenders as yours' },
  { id: 'ambushers', name: 'Ambushers', rarity: 'rare', icon: 'swords', mods: { roadStrengthMult: 1.3 },
    text: 'Your squads fight +{pct:roadStrengthMult} harder in clashes on a road' },
  { id: 'siegecraft', name: 'Siegecraft', rarity: 'rare', icon: 'castle', mods: { gateDefMult: 0.5 }, requires: 'siege',
    text: 'Gates take double damage: the keep is open sooner' },
  { id: 'dragonbane', name: 'Dragonbane', rarity: 'rare', icon: 'dragon', mods: { dragonDmgMult: 1.5, dragonTelegraphAdd: 1 }, requires: 'dragon',
    text: '+{pct:dragonDmgMult} damage to the Dragon; its breath is telegraphed {dragonTelegraphAdd} s longer' },
  { id: 'gravebreaker', name: 'Gravebreaker', rarity: 'rare', icon: 'skull', mods: { fallenMult: 0.5 }, requires: 'ashen',
    text: 'In Ashen fights The Fallen Rise is halved' },
  { id: 'secondWind', name: 'Second Wind', rarity: 'rare', icon: 'heart', mods: { secondWindTroops: 10, secondWindCampShare: 0.15 },
    text: 'Once per battle, a settlement of yours that would fall holds and gains fresh troops' },
  { id: 'phalanx', name: 'Phalanx', rarity: 'rare', icon: 'shield', mods: { phalanxMin: 40, phalanxDmgMult: 0.8 },
    text: 'Your squads of {phalanxMin}+ troops take {pct:phalanxDmgMult} less damage' },
  { id: 'bloodPrice', name: 'Blood Price', rarity: 'rare', cursed: true, icon: 'drop', mods: { atkMult: 1.15, captureBleed: 0.08 }, // +25% / 5%: D1 -28% alone (the card counts the attack, not the bleed)
    text: 'Attack +{pct:atkMult}; every capture bleeds {pct:captureBleed} of the troops in each site you hold' },
  { id: 'martyrsCrown', name: "Martyr's Crown", rarity: 'rare', cursed: true, icon: 'crown',
    mods: { campTroopsMult: 0.9, martyrSurge: 0.3, martyrAtkMult: 1.25, martyrSec: 15 }, // camp x0.8: D1 +15% alone, a net loss
    text: 'Your War Camp starts {pct:campTroopsMult} smaller; when it falls every site you hold gains {pct:martyrSurge} troops and your squads hit +{pct:martyrAtkMult} harder for {martyrSec} s' },
  // --- Legendary ---
  { id: 'warlordsMark', name: "Warlord's Mark", rarity: 'legendary', icon: 'star', mods: { warlordEvery: 5 }, // every 4th: D1 -10% alone and the best win rate of all (86%)
    text: 'Every {warlordEvery}th squad you send is doubled' },
  { id: 'kingslayer', name: 'Kingslayer', rarity: 'legendary', icon: 'throne', mods: { enemyKeepTroopMult: 0.8 },
    text: "The enemy keep's garrison starts {pct:enemyKeepTroopMult} lower in every battle" },
  { id: 'oathkeeper', name: 'Oathkeeper', rarity: 'legendary', icon: 'trophy', mods: { noChampion: true, trophyMult: 2 }, requires: 'raids',
    text: 'Vendettas against you come without their Champion, and Trophies give double' },
  // --- Phase 8 (PLAN-PHASE8 §8C): eight more, each a new rule. Deviations from the PLAN ideas (docs/briefs/phase8-hookup.md):
  //   Supply Wagons ADDS troops to a supply squad (a bigger share sent would only empty the source sooner); Rearguard keeps the
  //   streak (a retreat leaves no troops "in the field" to keep: battles start fresh); Spoils of War grants Prosperity I on a
  //   three-crown win (crowns already pay Renown, so +1 Renown a crown would be a flat number); Tower Sappers reads "near"
  //   (sapperHexes) for "adjacent" (sites are not a graph).
  { id: 'vanguard', name: 'Vanguard', rarity: 'common', icon: 'spear', mods: { vanguardMult: 1.5 },
    text: 'The first squad you send in every battle carries +{pct:vanguardMult} troops' },
  { id: 'supplyWagons', name: 'Supply Wagons', rarity: 'common', icon: 'wagon', mods: { supplyBonus: 0.25 },
    text: 'Squads your supply lines send carry +{pct:supplyBonus} extra troops' },
  { id: 'rearguard', name: 'Rearguard', rarity: 'common', icon: 'retreat', mods: { rearguard: true }, requires: 'streak',
    text: 'Retreating from an attack no longer breaks your Conquest Streak' },
  { id: 'warDrums', name: 'War Drums', rarity: 'common', icon: 'drum', mods: { drumsSec: 6, drumsMult: 1.15 }, requires: 'powers', // coordinator: +10% for 5 s was too mild to feel
    text: 'Every power you cast makes your squads march +{pct:drumsMult} faster for {drumsSec} s' },
  { id: 'towerSappers', name: 'Tower Sappers', rarity: 'rare', icon: 'pick', mods: { sapperHexes: 3, sapperRangeMult: 0.7 },
    text: 'Enemy towers within {sapperHexes} hexes of a site you hold shoot {pct:sapperRangeMult} shorter' },
  { id: 'spoilsOfWar', name: 'Spoils of War', rarity: 'rare', icon: 'sack', mods: { crownProsperity: 1 },
    text: 'A three-crown victory starts the region at Prosperity I' },
  { id: 'lastStand', name: 'Last Stand', rarity: 'rare', icon: 'keep', mods: { lastStandShare: 0.25, lastStandDefMult: 1.4 }, requires: 'raids',
    text: 'In a defense your keep defends +{pct:lastStandDefMult} harder below {pct:lastStandShare} of its troops' },
  { id: 'cartographer', name: 'Cartographer', rarity: 'rare', icon: 'compass', mods: { quickFair: true }, requires: 'quick',
    text: 'Quick Conquest also takes regions labelled Fair' },
].map((b) => Object.freeze({ cursed: false, requires: null, ...b, mods: Object.freeze(b.mods) })));

// Duo Boons: holding both parts unlocks a free bonus (a reveal moment: pickBoon returns `duo`).
export const DUO_LIST = Object.freeze([
  { id: 'fireArrows', name: 'Fire Arrows', parts: ['scorchedEarth', 'engineers'], icon: 'flame', mods: { fireArrowsDps: 1, fireArrowsSec: 4 },
    text: 'Arrows from towers you hold set squads ablaze: {fireArrowsDps} troop a second for {fireArrowsSec} s' },
  { id: 'ghostLegion', name: 'Ghost Legion', parts: ['turncoats', 'gravebreaker'], icon: 'skull', mods: { ghostShare: 0.5 },
    text: 'Ashen settlements you capture keep {pct:ghostShare} of their fallen defenders as yours' },
  { id: 'lightningWar', name: 'Lightning War', parts: ['hitAndRun', 'pathfinder'], icon: 'bolt', mods: { lightningWarSec: 5 },
    text: "Each capture takes {lightningWarSec} s off Forced March's cooldown" },
  // PLAN: "Plunderers' gold also counts for War Chest at x2". The Hoard reads gold in hand, so the spirit is kept more simply:
  { id: 'gildedBanners', name: 'Gilded Banners', parts: ['hoard', 'plunderers'], icon: 'coin', mods: { plunderSec: 10, hoardMax: 0.3 },
    text: 'Plunderers pay {plunderSec} s of income per capture, and the Hoard rises to +{pct:hoardMax}' },
  // Phase 8 (PLAN-PHASE8 §8C):
  { id: 'thunderCharge', name: 'Thunder Charge', parts: ['vanguard', 'warDrums'], icon: 'drum', mods: { drumVanguardMult: 1.25 },
    text: 'The first squad you send after each power you cast carries +{pct:drumVanguardMult} troops' },
  { id: 'siegeTrain', name: 'Siege Train', parts: ['supplyWagons', 'towerSappers'], icon: 'wagon', mods: { supplyNoArrows: true },
    text: 'Squads your supply lines send ride through enemy arrows' },
].map((d) => Object.freeze({ ...d, parts: Object.freeze(d.parts), mods: Object.freeze(d.mods) })));

export const BOONS = Object.freeze({
  choices: 3,                  // Boons offered per draft (fewer only when the pool runs dry)
  unlockOwned: 2,              // drafts start once the player held this many regions BEFORE the win (the Bounty Board's moment: never
                               // the tutorial fight); in a later dynasty the first win already drafts
  // Which battle wins draft (coordinator, after Phase 7 QA): a draft after EVERY win had the campaign owning ~21 of 24 Boons by the end of
  // D1, so late picks meant nothing. Only wins whose card read one of draftLabels at attack time draft (an Easy win does not), plus every
  // typed region (Gold Mine, Monastery, Bandit Hold, Ruins, the Lair) and every capital, whatever the label. Target: ~10-14 by D1's end.
  draftLabels: Object.freeze(['Fair', 'Hard', 'Deadly']),
  draftTyped: true,
  draftCapitals: true,
  rarityWeights: Object.freeze({ common: 0.65, rare: 0.28, legendary: 0.07 }),   // PLAN §7A
  champEyeWeights: Object.freeze({ common: 0, rare: 0.8, legendary: 0.2 }),      // the Champion's eye: Rare or better, once per dynasty
  rerollRenown: 1,             // a reroll costs this much Renown (PLAN §7A)
  eventGapSec: 2,              // a repeating boonTriggered (Fire Arrows, Scorched Earth burns) fires at most once per this many s per site
  frames: Object.freeze({ common: 'bronze', rare: 'silver', legendary: 'gold', cursed: 'crimson' }), // the card frame key per rarity
  copy: Object.freeze({
    title: 'Choose a Boon',
    pending: 'Boon pending',
    missed: 'You missed a Boon pick: the new offer replaces it.',
    reroll: 'Reroll · {cost} Renown',
    champEye: "The Champion's eye: a Rare-or-better Boon",
    rarity: Object.freeze({ common: 'Common', rare: 'Rare', legendary: 'Legendary' }),
    cursed: 'Cursed',
    duo: 'Duo unlocked: {name}',
  }),
});
