// Phase 5 (docs/PLAN-PHASE5.md §5A, §5C): Edicts (one chosen at each founding, lasting the dynasty) and Challenges (opt-in at
// founding). Every number lives here; read by game/meta/edicts.js (edictMods: the ONE modifier source), game/world/regionFeatures.js
// (the world-generation edicts) and the copy builders. A mod key's meaning and its neutral value are in EDICT_NEUTRAL below.
//
// Copy templates: `{pct:key}` -> the size of a multiplier as a percentage ("15%"), `{x:key}` -> "×2", `{n:key}` -> the number,
// `{share:key}` -> "half" / "a third" / "N%". Text is built from these numbers by meta/edicts.js edictInfo, never typed twice.

/**
 * Every modifier `edictMods(state)` returns, at its neutral value (no Edict, no Legacy, no Challenge). Keys ending in `Mult`
 * multiply; booleans that are neutral `true` (raids, streak) are switched OFF by any source; other booleans are switched ON by any
 * source; the keys in EDICT_MAX_KEYS take the largest value; every other number adds.
 */
export const EDICT_NEUTRAL = Object.freeze({
  // --- Edicts (PLAN-PHASE5 §5A contract) ---
  atkMult: 1,               // the player's attack in every battle (playerBattleStats)
  incomeMult: 1,            // gold per second (economy.incomePerSec)
  bountyMult: 1,            // the conquest bounty (progression.conquestBounty)
  enemyFortTroopMult: 1,    // enemy towers and forts start with this x their troops (arena via EnemyStats.fortTroopMult)
  blizzardShare: 0,         // world generation: the share of regions beyond the first ring that get Blizzard (regionFeatures)
  blizzardRenown: 0,        // + Renown for each Blizzard region conquered
  renownMult: 1,            // every Renown earned (renownState.earnRenown; fractions carry over)
  raidRateMult: 1,          // raids per active second (frontier.raidRate)
  raids: true,              // false: no raids and no Vendettas at all (tickFrontier, resolveAway)
  defenseRewardMult: 1,     // a won defense's gold AND Renown (frontier.defenseReward)
  dragonCount: 1,           // world generation: Dragon's Lairs on the continent (regionFeatures)
  dragonscaleAtk: 0,        // + attack while the Dragonscale boon is held
  dragonHpMult: 1,          // the Dragon's health (arena via EnemyStats.dragonHpMult)
  dragonRewardMult: 1,      // a Lair's bounty and Renown
  bountySlots: 3,           // Bounty Board slots (BOUNTIES.slots is the base; an Edict sets more; Scribes adds bountySlotsAdd)
  bountyRewardMult: 1,      // a contract's gold and Renown
  streak: true,             // false: no Conquest Streak (streak.js multiplies nothing and counts nothing)
  festivalCostMult: 1,      // a Festival's Renown cost (renown.festivalCost)
  prosperityRateMult: 1,    // natural prosperity growth speed (prosperity.js: tenure counts x this)
  abilityUses: 1,           // a General's ability: uses per battle (battle/abilities.js reads ability.uses)
  powerCooldownMult: 1,     // every power's cooldown (folded into PlayerStats.cooldownMult)
  freeScout: false,         // scouting costs nothing (intel.scoutCost)
  noNight: false,           // world generation: no Night twist (regionFeatures)
  enemyGarrisonMult: 1,     // enemy garrisons in attack battles (enemyBattleStats.troopMult)
  // --- Legacy (§5B) ---
  campTroopsMult: 1,        // Veteran Camp: the War Camp's starting troops
  speedMult: 1,             // Swift Banners: march speed
  xpMult: 1,                // Drillmasters: General XP (generals.settleCommander, with the Mentor deed)
  warChestLevels: 0,        // War Chest: free levels of the cheapest Army upgrade at each founding
  treasuryGoldSec: 0,       // Royal Treasury: start gold = this many seconds of the start region's income x the dynasty level
  fortFirstLevelMult: 1,    // Masons: a region's FIRST fortification (level I, none there yet) costs x this
  freeFolkSurrender: 0,     // Old Alliances: Free Folk regions surrender from this card ratio (0 = ECONOMY.surrenderRatio)
  edictChoicesAdd: 0,       // Heralds: more Edicts to choose from
  bountySlotsAdd: 0,        // Scribes: more Bounty Board slots (on top of bountySlots)
  startRenown: 0,           // Patronage: Renown at the start of each dynasty
  freeScouts: 0,            // Spymaster: scouts per dynasty that cost nothing
  capitalGateTroopMult: 1,  // Kingmaker: a rival capital's Gate garrison
  quickConquest: false,     // the Quick Conquest node (meta/quick.js)
  startProsperity: 0,       // Old Roads: the start region begins at this prosperity level
  // --- Challenges (§5C) ---
  raidTroopMult: 1,         // Overrun: war bands too (raidEnemyStats)
  noPowers: false,          // Iron Will: powers refused in battle (PlayerStats.powersBlocked)
  noAbility: false,         // Lone Banner: no General abilities
  forceCaptain: false,      // Lone Banner: the Militia Captain commands every battle
});

/** Numbers that take the largest value instead of adding (a source SETS them). */
export const EDICT_MAX_KEYS = Object.freeze(['dragonCount', 'bountySlots', 'abilityUses', 'startProsperity', 'freeFolkSurrender']);

// The Edicts. `mods` overrides EDICT_NEUTRAL; `upside` / `cost` are the two card lines (templates, see the header).
// Balance (tools/campaign.mjs, PLAN-PHASE5 pacing guard: each Edict forced on 12 seeds for dynasty 2 must stay within 0.75-1.7x D1).
export const EDICT_LIST = Object.freeze([
  Object.freeze({
    id: 'ageOfIron', name: 'Age of Iron', icon: 'swords',
    mods: Object.freeze({ atkMult: 1.15, incomeMult: 0.85 }),
    upside: '+{pct:atkMult} attack', cost: '−{pct:incomeMult} income',
  }),
  Object.freeze({
    id: 'merchantPrinces', name: 'Merchant Princes', icon: 'coin',
    mods: Object.freeze({ bountyMult: 2, enemyFortTroopMult: 1.3 }),
    upside: 'Conquest bounty {x:bountyMult}', cost: 'Enemy towers and forts start with +{pct:enemyFortTroopMult} troops',
  }),
  Object.freeze({
    id: 'longWinter', name: 'Long Winter', icon: 'snowflake',
    mods: Object.freeze({ blizzardShare: 0.5, blizzardRenown: 1 }),
    upside: '+{n:blizzardRenown} Renown for every Blizzard region won', cost: 'Blizzard on {share:blizzardShare} the regions beyond the first ring (marches 30% slower)',
  }),
  Object.freeze({
    id: 'ironFrontier', name: 'Iron Frontier', icon: 'shield',
    mods: Object.freeze({ defenseRewardMult: 2, raidRateMult: 2 }),
    upside: 'Defenses won pay {x:defenseRewardMult} gold and Renown', cost: 'Raids come twice as often',
  }),
  Object.freeze({
    id: 'peaceOfCrowns', name: 'Peace of the Crowns', icon: 'crown',
    mods: Object.freeze({ raids: false, renownMult: 0.5 }),
    upside: 'No raids or Vendettas: a calm dynasty', cost: 'Renown earned {x:renownMult}',
  }),
  Object.freeze({
    id: 'ageOfDragons', name: 'Age of Dragons', icon: 'dragon',
    mods: Object.freeze({ dragonCount: 2, dragonscaleAtk: 0.1, dragonRewardMult: 2, dragonHpMult: 1.25 }),
    upside: "Two Dragon's Lairs; Dragonscale also gives +{pct:dragonscaleAtk} attack; Dragon rewards {x:dragonRewardMult}", cost: 'Dragons have +{pct:dragonHpMult} health',
  }),
  Object.freeze({
    id: 'bountyHunters', name: 'Bounty Hunters', icon: 'scroll',
    mods: Object.freeze({ bountySlots: 4, bountyRewardMult: 2, streak: false }),
    upside: '{n:bountySlots} contract slots; contracts pay {x:bountyRewardMult}', cost: 'No Conquest Streak',
  }),
  Object.freeze({
    id: 'grandFestival', name: 'Grand Festival', icon: 'wheat',
    mods: Object.freeze({ festivalCostMult: 0.5, prosperityRateMult: 0.5 }),
    upside: 'Festivals cost half', cost: 'Prosperity grows on its own half as fast',
  }),
  Object.freeze({
    id: 'warriorKings', name: 'Warrior Kings', icon: 'banner',
    mods: Object.freeze({ abilityUses: 2, powerCooldownMult: 1.35 }), // 1.5 measured D2 1.37x of D1 (the slowest Edict); eased to 1.35
    upside: "A General's ability can be used twice per battle", cost: 'Power cooldowns +{pct:powerCooldownMult}',
  }),
  Object.freeze({
    id: 'openRoads', name: 'Open Roads', icon: 'road',
    mods: Object.freeze({ freeScout: true, noNight: true, enemyGarrisonMult: 1.1 }),
    upside: 'Scouting is free; Night never falls', cost: 'Enemy garrisons +{pct:enemyGarrisonMult}',
  }),
]);

export const EDICTS = Object.freeze({
  choices: 3,                  // Edicts offered at a founding (the Heralds Legacy node adds edictChoicesAdd)
  firstDynasty: null,          // the first dynasty plays by the standard rules: no Edict
  copy: Object.freeze({
    none: 'Standard rules',
    noneLine: 'No Edict: the realm keeps the old laws.',
  }),
});

// Challenges (§5C): any number ticked at a founding, fixed for the dynasty. Each one completed adds `legacyBonus` x the stars to the
// NEXT founding's Legacy points.
export const CHALLENGE_LIST = Object.freeze([
  Object.freeze({
    id: 'ironWill', name: 'Iron Will', icon: 'fist',
    mods: Object.freeze({ noPowers: true }),
    text: 'No powers in battle (General abilities allowed)',
  }),
  Object.freeze({
    id: 'overrun', name: 'Overrun', icon: 'horde',
    mods: Object.freeze({ enemyGarrisonMult: 1.4, raidTroopMult: 1.4 }),
    text: 'Enemy troops {x:enemyGarrisonMult} everywhere',
  }),
  Object.freeze({
    id: 'loneBanner', name: 'Lone Banner', icon: 'flag',
    mods: Object.freeze({ forceCaptain: true, noAbility: true }),
    text: 'No Generals: the Militia Captain commands every battle, and there are no abilities',
  }),
]);

export const CHALLENGES = Object.freeze({
  legacyBonus: 0.5,            // +50% Legacy points per Challenge completed (PLAN-PHASE5 §5C)
  copy: Object.freeze({
    warning: 'Harder: Challenges cannot be removed until the next dynasty.',
    bonus: '+{pct}% Legacy at the next founding',
  }),
});
