// The upgrade shop. PURE DATA — meta/upgrades.js contains the arithmetic and
// none of the numbers.
//
// Cost model, one line for every upgrade in the game:
//     cost(level) = round(base * rate ^ level)        // level = levels ALREADY owned
// so the first purchase costs `base` and every level after it is strictly more
// expensive. Single-purchase items use rate 1 and maxLevel 1.
//
// Effect model. Each level contributes entries into exactly one of four buckets,
// and meta/modifiers.js consumes those buckets in ONE fixed stacking order:
//   'add'     -> summed into a single additive bonus:  x (1 + sum)
//   'mult'    -> multiplied together:                  x prod
//   'flat'    -> summed as a raw number (gold, troops, ms, garrison slots)
//   'unlock'  -> a unit id, booster id, or feature flag
// Nothing is allowed to invent a fifth bucket; see modifiers.js STACKING_ORDER.

export const UPGRADE_GROUPS = Object.freeze([
  { id: 'economy', name: 'Economy', blurb: 'Crowns per second, and how long you can be away.' },
  { id: 'military', name: 'Military', blurb: 'The size and quality of the army you land with.' },
  { id: 'siege', name: 'Siege', blurb: 'How fast walls come down, and how fast yours go back up.' },
  { id: 'unlocks', name: 'Unlocks', blurb: 'New units. Militia and spearmen are free from the start.' },
  { id: 'utility', name: 'Utility', blurb: 'Information and convenience.' },
  { id: 'boosters', name: 'Boosters', blurb: 'Unlock a booster once; buy its charges per use.' },
]);

/** Offline accrual. Base cap 8h, +4h per Granary level, so 24h fully upgraded. */
export const OFFLINE = Object.freeze({
  baseCapMs: 8 * 60 * 60 * 1000,
  hardMaxCapMs: 24 * 60 * 60 * 1000,
});

const H4 = 4 * 60 * 60 * 1000;

const U = (id, group, name, maxLevel, base, rate, effects, desc) =>
  ({ id, group, name, maxLevel, cost: { base, rate }, effects, desc });

const add = (key, value) => ({ bucket: 'add', key, value });
const mult = (key, value) => ({ bucket: 'mult', key, value });
const flat = (key, value) => ({ bucket: 'flat', key, value });
const unlock = (key, value) => ({ bucket: 'unlock', key, value });

/** @type {ReadonlyArray<object>} */
export const UPGRADES = Object.freeze([
  // --- Economy -------------------------------------------------------------
  U('tithe', 'economy', 'Tithe', 5, 60, 2.2, [add('income', 0.15)],
    '+15% treasury income per level. The compounding one — buy it early.'),
  U('warChest', 'economy', 'War Chest', 5, 100, 2.0, [flat('startGold', 150)],
    '+150 starting battle gold per level. Buys your opening move outright.'),
  U('richSoil', 'economy', 'Rich Soil', 4, 140, 2.15, [add('farmYield', 0.20)],
    '+20% output from every farm you hold, in battle, per level.'),
  U('granary', 'economy', 'Granary', 4, 120, 2.0, [flat('offlineCapMs', H4)],
    '+4h offline income cap per level. 8h becomes 24h at level 4.'),

  // --- Military ------------------------------------------------------------
  U('standingArmy', 'military', 'Standing Army', 6, 120, 2.1, [flat('expedition', 4)],
    '+4 troops in every expedition, forever. The most directly felt purchase in the game.'),
  U('drillYards', 'military', 'Drill Yards', 4, 180, 2.0, [add('trainSpeed', 0.10)],
    '-10% training time per level, everywhere you own a stronghold.'),
  U('veterancy', 'military', 'Veterancy', 5, 200, 2.05, [add('atk', 0.08)],
    '+8% attack per level. Pairs with raiders for a farm-burning opening.'),
  U('bulwark', 'military', 'Bulwark', 5, 200, 2.05, [add('def', 0.08)],
    '+8% defence per level. Pairs with spearmen for an economy-first grind.'),
  U('forcedMarch', 'military', 'Forced March', 6, 220, 2.0, [add('march', 0.12)],
    '+12% squad speed per level. Relief arrives before the walls fall.'),
  U('biggerCamp', 'military', 'Bigger Camp', 6, 160, 1.9, [flat('garrisonCap', 25)],
    '+25 garrison capacity on every site you hold, per level.'),

  // --- Siege ---------------------------------------------------------------
  U('sappers', 'siege', "Sappers' Guild", 4, 260, 2.1, [add('siegeDmg', 0.15)],
    '+15% siege damage per level. Turns "walls repair faster" into a breach timer.'),
  U('wreckingCrew', 'siege', 'Wrecking Crew', 6, 500, 2.2, [flat('ramImpactHp', 20)],
    'Rams strip an extra 20 structure HP the moment they arrive, per level.'),
  U('entrenchment', 'siege', 'Entrenchment', 5, 400, 2.2, [add('structureRegen', 0.25)],
    '+25% structure regeneration on sites YOU hold, per level. Defence, not offence.'),

  // --- Unlocks -------------------------------------------------------------
  U('unlockRaiders', 'unlocks', 'Raiders', 1, 250, 1, [unlock('unit', 'raiders')],
    'Fastest unit. Beats militia, and half of a failed attack walks home.'),
  U('unlockRams', 'unlocks', 'Rams', 1, 600, 1, [unlock('unit', 'rams')],
    '20x a militia at breaking walls. Slow: one ram halves a squad’s speed.'),
  U('unlockMarshal', 'unlocks', 'Marshal', 1, 4000, 1, [unlock('unit', 'marshal')],
    '+20% to his entire army and +30% training in his site. One per site.'),

  // --- Utility -------------------------------------------------------------
  U('fieldManual', 'utility', 'Field Manual', 1, 150, 1, [unlock('feature', 'exactPreview')],
    'The preview shows exact survivor counts instead of a bar.'),
  U('scoutReport', 'utility', 'Scout Report', 1, 200, 1, [unlock('feature', 'scoutReport')],
    'See enemy garrison composition before you commit.'),
  U('tactician', 'utility', 'Tactician', 1, 450, 1, [unlock('feature', 'doubleSpeed')],
    '2x battle speed toggle. Income accrues at the same real rate either way.'),
  U('standingOrders', 'utility', 'Standing Orders', 1, 1500, 1, [unlock('feature', 'standingOrders')],
    'Rear sites auto-reinforce the front once their garrison is full.'),

  // --- Booster unlocks (charges are bought separately, see BOOSTER_SHOP) ----
  U('boosterRally', 'boosters', 'Rally', 1, 300, 1, [unlock('booster', 'rally')],
    'Every site within 2 hops sends 50%, all sharing one arrival tick.'),
  U('boosterTithe', 'boosters', 'War Tithe', 1, 700, 1, [unlock('booster', 'tithe')],
    'Instant battle gold plus 15s of +50% training throughput.'),
  U('boosterBombard', 'boosters', 'Bombardment', 1, 900, 1, [unlock('booster', 'bombard')],
    'Kills a quarter of a garrison and 60 structure HP. Never captures.'),

  // --- The long lines ------------------------------------------------------
  // Everything above is the OPENING ladder and it is balance-frozen: regions 1
  // to 5 are tuned against those exact costs, so a level was never added to one
  // of them. The problem was that the ladder ENDED — every upgrade in the game
  // maxed for 59,589 crowns, which a player at region 14 earns in about six
  // minutes of idling, and the last four regions had nothing left to buy at all.
  //
  // So the endgame is a second tier of lines rather than a taller first one.
  // Each one starts above 1,200 crowns, which is more than the entire budget a
  // player has when they reach Kaldan, and each has enough levels that the cost
  // curve — not the level cap — is what stops you. Maxing everything now costs
  // ~19.3M crowns against ~59.6k before: about eleven hours of full-conquest
  // income instead of two minutes of it.
  U('armoury', 'military', 'Armoury', 12, 1200, 1.8,
    [add('atk', 0.05), add('def', 0.05)],
    '+5% attack AND +5% defence per level, on every unit you field. '
    + 'The base-statistics line: it is still worth buying when nothing else is.'),
  U('musterField', 'military', 'Muster Field', 10, 2000, 1.9, [flat('expedition', 6)],
    '+6 expedition slots per level, on top of Standing Army. '
    + 'The endgame answer to a region that opens with nineteen sites.'),
  U('quartermaster', 'economy', 'Quartermaster', 10, 1500, 1.85, [add('goldRate', 0.10)],
    '+10% battle gold from every site you hold, per level. Trains a bigger army out of the same ground.'),
  U('levyReform', 'economy', 'Levy Reform', 10, 1800, 1.85, [mult('trainCost', 0.93)],
    '-7% training cost per level, compounding. Same treasury, more soldiers.'),
  U('mintage', 'economy', 'Royal Mint', 12, 2500, 1.9, [add('income', 0.12)],
    '+12% treasury income per level. Where a conquered empire’s crowns go.'),
  U('ordnance', 'siege', 'Ordnance Yard', 8, 2500, 1.9, [add('siegeDmg', 0.12)],
    '+12% siege damage per level, on top of the Sappers’ Guild. Late walls are thicker.'),
  // The endgame block had a line for every FactionMod channel EXCEPT the one
  // that decides a long battle. Drill Yards caps at 4 levels (+40%) and then
  // training throughput stops growing forever, while a tier-4 enemy holds
  // `develop`-3 strongholds running on SITE_LEVELS x1.75. Gold was never the
  // player's constraint late — measured on the harness, they banked 4,700
  // unspent gold while their strongholds ran flat out — SITES ARE. Quartermaster
  // and Levy Reform both buy gold you already have; this buys the thing you
  // cannot: soldiers per second out of the ground you already took.
  U('drillmasters', 'military', 'Drillmasters', 10, 1600, 1.85, [add('trainSpeed', 0.09)],
    '+9% training speed per level, on top of the Drill Yards. '
    + 'The endgame answer to a region whose walls out-produce you.'),
  U('warHost', 'military', 'War Host', 8, 2200, 1.85, [flat('garrisonCap', 30)],
    '+30 garrison capacity everywhere, per level. A front-line stronghold that '
    + 'stops training because it is full has stopped being a front line.'),
]);

export const UPGRADE_BY_ID = Object.freeze(
  Object.fromEntries(UPGRADES.map((u) => [u.id, u])),
);

/**
 * Booster inventory shop. `unlockedBy: null` means available from the start —
 * Forced March and Emergency Fortify are the two every player has, so a new
 * player still has a survive verb and an accelerate verb.
 */
export const BOOSTER_SHOP = Object.freeze({
  rally:   { unlockedBy: 'boosterRally',   chargeCost: 40, maxStock: 9 },
  march:   { unlockedBy: null,             chargeCost: 25, maxStock: 9 },
  bombard: { unlockedBy: 'boosterBombard', chargeCost: 60, maxStock: 9 },
  fortify: { unlockedBy: null,             chargeCost: 35, maxStock: 9 },
  tithe:   { unlockedBy: 'boosterTithe',   chargeCost: 45, maxStock: 9 },
});

/** Units owned before any purchase. */
export const STARTING_UNITS = Object.freeze(['militia', 'spearmen']);

/**
 * Default expedition composition weights, normalised over whatever the player
 * has unlocked. The player may override this on the pre-battle screen; this is
 * the shape a new player gets handed so the first battle is never a blank form.
 * Marshal is excluded here and granted as exactly one when unlocked (max 1/site).
 */
export const DEFAULT_COMPOSITION_WEIGHTS = Object.freeze({
  militia: 0.45, spearmen: 0.28, raiders: 0.17, rams: 0.10, marshal: 0,
});

/** cost(level) = round(base * rate ^ level). Level = levels already owned. */
export function upgradeCost(upgrade, level) {
  return Math.round(upgrade.cost.base * upgrade.cost.rate ** level);
}
