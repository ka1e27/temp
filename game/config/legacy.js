// Phase 5 (docs/PLAN-PHASE5.md §5B, §5D): the Legacy tree (persists across dynasties, lives with the Deeds in
// state.generals.legacy) and Quick Conquest. Every number lives here; read by game/meta/legacy.js and game/meta/quick.js. A node's
// `mods` are EDICT_NEUTRAL keys (config/edicts.js): meta/edicts.js edictMods folds them in, so Legacy, Edicts and Challenges are ONE
// modifier source. `effect` is the card line (the same templates as config/edicts.js).
//
// Budget (PLAN-PHASE5 §5B): points = stars earned at each founding (DYNASTY.starBase + the level completed: 4, 5, 6, ...), so after
// three dynasties a player holds 15 points: the five cheapest nodes (2+2+2+3+3 = 12) or about 5-6 nodes, so choices matter.
export const LEGACY_BRANCHES = Object.freeze([
  Object.freeze({
    id: 'war', name: 'War', icon: 'swords',
    nodes: Object.freeze([
      Object.freeze({ id: 'veteranCamp', name: 'Veteran Camp', cost: 2, mods: Object.freeze({ campTroopsMult: 1.15 }), effect: 'War Camp starts every battle with +{pct:campTroopsMult} troops' }),
      Object.freeze({ id: 'swiftBanners', name: 'Swift Banners', cost: 3, mods: Object.freeze({ speedMult: 1.08 }), effect: 'Squads march +{pct:speedMult} faster' }),
      Object.freeze({ id: 'drillmasters', name: 'Drillmasters', cost: 4, mods: Object.freeze({ xpMult: 1.25 }), effect: 'Generals gain +{pct:xpMult} XP' }),
      Object.freeze({ id: 'warChest', name: 'War Chest', cost: 5, mods: Object.freeze({ warChestLevels: 2 }), effect: 'Start each dynasty with {n:warChestLevels} free levels of the cheapest Army upgrade' }),
      // Powers have no per-battle uses in this game (they run on cooldowns), so Warlord takes PLAN-PHASE5's "otherwise" branch
      Object.freeze({ id: 'warlord', name: 'Warlord', cost: 6, mods: Object.freeze({ powerCooldownMult: 0.85 }), effect: 'Power cooldowns −{pct:powerCooldownMult}' }),
    ]),
  }),
  Object.freeze({
    id: 'realm', name: 'Realm', icon: 'castle',
    nodes: Object.freeze([
      Object.freeze({ id: 'oldRoads', name: 'Old Roads', cost: 2, mods: Object.freeze({ startProsperity: 2 }), effect: 'Your starting region begins at Prosperity II' }),
      Object.freeze({ id: 'masons', name: 'Masons', cost: 3, mods: Object.freeze({ fortFirstLevelMult: 0.5 }), effect: 'The first fortification in each region is half price' }),
      // 120 s of the start region's income (ECONOMY.startRegionIncome 1.82 g/s: 218 gold) x the new dynasty's level: about 2-3 Army
      // upgrades at dynasty 2, a head start, not a skip
      Object.freeze({ id: 'royalTreasury', name: 'Royal Treasury', cost: 4, mods: Object.freeze({ treasuryGoldSec: 120 }), effect: 'Start each dynasty with gold: 2 minutes of your first income x the dynasty level' }),
      Object.freeze({ id: 'quickConquest', name: 'Quick Conquest', cost: 5, mods: Object.freeze({ quickConquest: true }), effect: 'Auto-resolve regions labelled Easy' }),
      // ECONOMY.surrenderRatio is 3.0: 2.4 makes a Free Folk region surrender about one army upgrade-tier sooner
      Object.freeze({ id: 'oldAlliances', name: 'Old Alliances', cost: 6, mods: Object.freeze({ freeFolkSurrender: 2.4 }), effect: 'Free Folk regions surrender sooner' }),
    ]),
  }),
  Object.freeze({
    id: 'court', name: 'Court', icon: 'scroll',
    nodes: Object.freeze([
      Object.freeze({ id: 'heralds', name: 'Heralds', cost: 2, mods: Object.freeze({ edictChoicesAdd: 1 }), effect: 'One more Edict to choose from' }),
      Object.freeze({ id: 'scribes', name: 'Scribes', cost: 3, mods: Object.freeze({ bountySlotsAdd: 1 }), effect: 'The Bounty Board gets one more slot' }),
      Object.freeze({ id: 'patronage', name: 'Patronage', cost: 4, mods: Object.freeze({ startRenown: 2 }), effect: '+{n:startRenown} Renown at the start of each dynasty' }),
      Object.freeze({ id: 'spymaster', name: 'Spymaster', cost: 5, mods: Object.freeze({ freeScouts: 3 }), effect: '{n:freeScouts} free scouts each dynasty' }),
      Object.freeze({ id: 'kingmaker', name: 'Kingmaker', cost: 6, mods: Object.freeze({ capitalGateTroopMult: 0.75 }), effect: "Rival capitals' Gates start with {pct:capitalGateTroopMult} fewer troops" }),
    ]),
  }),
]);

export const LEGACY = Object.freeze({
  copy: Object.freeze({
    locked: 'Requires {node}',
    points: '{n} Legacy',
  }),
});

// Quick Conquest (§5D): an Easy region resolved headless by the card's commander (the Steward), Victory crown only, part bounty.
export const QUICK = Object.freeze({
  bountyShare: 0.75,               // the bounty a Quick Conquest pays (no Swift or Unbroken crowns either)
  label: 'Easy',                   // only regions whose card reads this
  excludedTypes: Object.freeze(['bandit', 'dragon']), // Bandit Holds and the Dragon's Lair are peaks: fought by hand
  excludeCapitals: true,           // so are the throne rooms
  captainStyle: 'stalwart',       // the Steward style with no General (only with driver 'steward')
  // Who plays the player's side. The Steward (stewardDecide) is a DEFENDER: from campaign states (tools/quickcheck.mjs, seeds 1-3) it
  // won only 65-81% of Easy regions, timing out on most losses even with a 600 s cap. 'bot' is the campaign's own attacker
  // (battle/bot.js decide, a good human at a 3 s cadence, with the commander's passive and abilityAdvice): 37/37.
  driver: 'bot',
  // x the campaign player's patience (config/battle.js patienceFor) before the commander retreats: nobody waits on a simulated fight.
  // tools/quickcheck.mjs (seeds 1-12, dynasties 1-2, every 2nd conquest, every region canQuickConquer allows): x1 won 262/270 (97.0%,
  // most losses were retreats at the cap), x2 won 264/265 (99.6%). PLAN-PHASE5 wants >= 95%.
  patienceMult: 2,
  maxSimSec: 600,                  // a hard stop well past any patience cap
  copy: Object.freeze({
    button: 'Quick Conquest',
    marching: 'Your commander marches on {region}…',
    refusals: Object.freeze({
      locked: 'Needs the Quick Conquest Legacy',
      label: 'Only for regions labelled Easy',
      type: 'Not for Bandit Holds or the Dragon',
      capital: 'Not for capitals',
      busy: 'A battle is already under way here',
      owned: 'Already yours',
      attack: 'Cannot be attacked from here',
    }),
  }),
});
