// The upgrade shop. PURE DATA — meta/upgrades.js contains the arithmetic and
// none of the numbers.
//
// SIX LINES THAT NEVER END, plus the handful of one-off unlocks.
//
// This used to be twenty-six capped upgrades across six groups, each with a
// paragraph of prose, and it had two problems that were really the same problem.
// It was a wall of reading — six of the entries were an "endgame tier" that
// duplicated an opening entry exactly (Royal Mint was Tithe, Armoury was
// Veterancy and Bulwark, Drillmasters was Drill Yards, War Host was Bigger
// Camp, Ordnance Yard was Sappers' Guild, Muster Field was Standing Army) — and
// it ENDED. Every upgrade in the game maxed out, which is a strange thing for
// an idle game to do to a player who idles.
//
// So each family collapsed to one line, and the line has no cap. What stops you
// is the cost curve, not a ceiling: `rate ^ level` compounds while the effects
// add, so power grows roughly with the LOGARITHM of crowns spent. Ten times the
// idling is a few more levels, not ten times the strength — which is what keeps
// a very patient player strong without making an ordinary one irrelevant.
//
// Cost model, one line for every upgrade in the game:
//     cost(level) = round(base * rate ^ level)        // level = levels ALREADY owned
// Single-purchase items use rate 1 and maxLevel 1.
//
// Effect model. Each level contributes entries into exactly one of four buckets,
// and meta/modifiers.js consumes those buckets in ONE fixed stacking order:
//   'add'     -> summed into a single additive bonus:  x (1 + sum)
//   'mult'    -> multiplied together:                  x prod
//   'flat'    -> summed as a raw number (gold, troops, ms, garrison slots)
//   'unlock'  -> a unit id, booster id, or feature flag
// Nothing is allowed to invent a fifth bucket; see modifiers.js STACKING_ORDER.

export const UPGRADE_GROUPS = Object.freeze([
  { id: 'empire', name: 'Empire', blurb: 'Six lines, no ceiling. Every level costs more than the last.' },
  { id: 'unlocks', name: 'Unlocks', blurb: 'Bought once. Militia and spearmen are free from the start.' },
  { id: 'boosters', name: 'Boosters', blurb: 'Unlock a booster once; buy its charges per use.' },
]);

/** Offline accrual. Base cap 8h, +2h per Treasury level, to a 24h ceiling. */
export const OFFLINE = Object.freeze({
  baseCapMs: 8 * 60 * 60 * 1000,
  hardMaxCapMs: 24 * 60 * 60 * 1000,
});

const H2 = 2 * 60 * 60 * 1000;

const U = (id, group, name, maxLevel, base, rate, effects, desc) =>
  ({ id, group, name, maxLevel, cost: { base, rate }, effects, desc });

const add = (key, value) => ({ bucket: 'add', key, value });
const mult = (key, value) => ({ bucket: 'mult', key, value });
const flat = (key, value) => ({ bucket: 'flat', key, value });
const unlock = (key, value) => ({ bucket: 'unlock', key, value });

/** No cap. Read it as "the price is the limit", which it is. */
const ENDLESS = Infinity;

/** @type {ReadonlyArray<object>} */
export const UPGRADES = Object.freeze([
  // --- The six endless lines ------------------------------------------------
  // One sentence each, on purpose. What a line does has to be readable in the
  // half second before you press its button; the arithmetic is in the numbers.
  U('treasury', 'empire', 'Treasury', ENDLESS, 45, 1.58,
    [add('income', 0.12), flat('offlineCapMs', H2)],
    '+12% crowns per second, and +2h of offline income (to a 24h ceiling).'),
  U('warChest', 'empire', 'War Chest', ENDLESS, 60, 1.56,
    [flat('startGold', 120), add('goldRate', 0.08), add('farmYield', 0.10)],
    '+120 starting battle gold, +8% from every site and +10% from every farm.'),
  U('standingArmy', 'empire', 'Standing Army', ENDLESS, 80, 1.60,
    [flat('expedition', 5), add('march', 0.06)],
    '+5 expedition slots and +6% march speed. The most directly felt purchase.'),
  U('arms', 'empire', 'Arms', ENDLESS, 100, 1.62,
    [add('atk', 0.06), add('def', 0.06)],
    '+6% attack and +6% defence, on every unit you field.'),
  U('drill', 'empire', 'Drill', ENDLESS, 80, 1.58,
    [add('trainSpeed', 0.08), mult('trainCost', 0.96), flat('garrisonCap', 12)],
    '+8% training speed, -4% training cost, +12 garrison capacity everywhere.'),
  U('siegeworks', 'empire', 'Siegeworks', ENDLESS, 120, 1.62,
    [add('siegeDmg', 0.12), add('structureRegen', 0.15)],
    '+12% siege damage, and +15% repair on the walls you hold.'),

  // --- Unlocks --------------------------------------------------------------
  U('unlockRaiders', 'unlocks', 'Raiders', 1, 250, 1, [unlock('unit', 'raiders')],
    'Fastest unit. Beats militia, and half of a failed attack walks home.'),
  U('unlockRams', 'unlocks', 'Rams', 1, 600, 1, [unlock('unit', 'rams')],
    '20x a militia at breaking walls. Slow: one ram halves a squad’s speed.'),
  // Worth its price now. It used to buy the RIGHT to spend 8 expedition slots on
  // one body, or to retask a stronghold for 40 seconds mid-battle; it now grants
  // one free on every landing, outside the budget, and more can be commissioned
  // for gold at any site that trains.
  U('unlockMarshal', 'unlocks', 'Marshal', 1, 4000, 1, [unlock('unit', 'marshal')],
    'One rides free with every expedition: +25% to his whole army, +40% training.'),
  // The three specialists. Each one buys a VERB rather than a stat line, and
  // each is priced where the problem it answers first appears: outriders when
  // the maps start being mostly unclaimed, halberds when castles start being
  // built, sappers when holding ground stops being automatic.
  U('unlockOutriders', 'unlocks', 'Outriders', 1, 400, 1, [unlock('unit', 'outriders')],
'Three times a militia’s march. Wins the race for unclaimed ground.'),
  U('unlockHalberds', 'unlocks', 'Halberds', 1, 1200, 1, [unlock('unit', 'halberds')],
'Halves the defender’s site bonus. The answer to a castle militia bounce off.'),
  U('unlockSappers', 'unlocks', 'Sappers', 1, 1800, 1, [unlock('unit', 'sappers')],
'Nearly doubles a site’s repair. A siege without engines never breaches it.'),
  U('tactician', 'unlocks', 'Tactician', 1, 450, 1, [unlock('feature', 'doubleSpeed')],
    'Battle speeds past 2x. Slower speeds are free, and income never changes.'),

  // --- Booster unlocks (charges are bought separately, see BOOSTER_SHOP) ----
  U('boosterRally', 'boosters', 'Rally', 1, 300, 1, [unlock('booster', 'rally')],
    'Every site within 2 hops sends 50%, all sharing one arrival tick.'),
  U('boosterTithe', 'boosters', 'War Tithe', 1, 700, 1, [unlock('booster', 'tithe')],
    'Instant battle gold plus 15s of +50% training throughput.'),
  U('boosterBombard', 'boosters', 'Bombardment', 1, 900, 1, [unlock('booster', 'bombard')],
    'Kills a quarter of a garrison and 60 structure HP. Never captures.'),
]);

/**
 * Upgrades that no longer exist, and what a level of each used to cost.
 *
 * A player who bought Field Manual, Scout Report, Standing Orders or Wrecking
 * Crew paid for something that turned out to do NOTHING — the first three had no
 * consumer anywhere in `src/` and the fourth's `ramImpactHp` was never read by
 * the battle engine. The rest were folded into the six lines above. Either way
 * the crowns were spent on a promise this build no longer keeps, so
 * core/store.js refunds them, once, on load.
 *
 * The costs are frozen COPIES rather than a reference: they have to keep
 * describing what was actually charged, whatever the live table does next.
 */
export const RETIRED_UPGRADES = Object.freeze({
  tithe: { base: 60, rate: 2.2 },
  richSoil: { base: 140, rate: 2.15 },
  granary: { base: 120, rate: 2.0 },
  drillYards: { base: 180, rate: 2.0 },
  veterancy: { base: 200, rate: 2.05 },
  bulwark: { base: 200, rate: 2.05 },
  forcedMarch: { base: 220, rate: 2.0 },
  biggerCamp: { base: 160, rate: 1.9 },
  sappers: { base: 260, rate: 2.1 },
  wreckingCrew: { base: 500, rate: 2.2 },
  entrenchment: { base: 400, rate: 2.2 },
  fieldManual: { base: 150, rate: 1 },
  scoutReport: { base: 200, rate: 1 },
  standingOrders: { base: 1500, rate: 1 },
  armoury: { base: 1200, rate: 1.8 },
  musterField: { base: 2000, rate: 1.9 },
  quartermaster: { base: 1500, rate: 1.85 },
  levyReform: { base: 1800, rate: 1.85 },
  mintage: { base: 2500, rate: 1.9 },
  ordnance: { base: 2500, rate: 1.9 },
  drillmasters: { base: 1600, rate: 1.85 },
  warHost: { base: 2200, rate: 1.85 },
});

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
 * The marshal is absent because he is never bought with slots — see
 * meta/composition.js `maxOf`.
 */
export const DEFAULT_COMPOSITION_WEIGHTS = Object.freeze({
  militia: 0.45, spearmen: 0.28, raiders: 0.17, rams: 0.10, marshal: 0,
  // THE THREE SPECIALISTS ARE ZERO ON PURPOSE, and it is not an oversight to be
  // tidied up later. A weight here is what the game picks FOR you; these are
  // units whose whole point is that you looked at the map and chose them, so
  // auto-spreading the budget across them would spend a player's slots on a
  // siege-repair detachment in a region with nothing to hold.
  //
  // It also means the default army — and therefore every balance number in
  // content/regions.data.js, all of which is measured against
  // `distributeExpedition` — is byte-identical to what it was before they
  // existed. Adding a unit did not re-tune the campaign, which is the only
  // reason three of them could ship at once.
  outriders: 0, halberds: 0, sappers: 0,
});

/**
 * The most levels of one line anyone can hold.
 *
 * Not a design cap — a floating-point one. `base * rate ^ level` passes
 * Number.MAX_SAFE_INTEGER somewhere past level 70 at these rates, and beyond
 * that a price stops being an exact integer and eventually becomes Infinity. A
 * button reading "Infinity crowns" is a bug, so the ladder is treated as
 * finished before arithmetic stops being trustworthy. At a rate of 1.65 that is
 * about 10^18 crowns for a single level: unreachable by many orders of
 * magnitude, which is the point.
 */
export const SAFE_MAX_LEVEL = 64;

/** cost(level) = round(base * rate ^ level). Level = levels already owned. */
export function upgradeCost(upgrade, level) {
  return Math.round(upgrade.cost.base * upgrade.cost.rate ** level);
}
