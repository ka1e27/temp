// WHAT AN UPGRADE'S EFFECT KEYS ARE CALLED, and how a player reads their size.
//
// PURE DATA. The upgrade table (upgrades.data.js) says what a line does PER
// LEVEL, in a sentence; this says what one of its effect keys is called and in
// what unit, so the shop can state what the levels already bought ADD UP TO.
//
// IT IS A VOCABULARY, NOT A SECOND DESCRIPTION, and that distinction is what
// keeps it from drifting. The numbers are always computed from the upgrade's
// own `effects` array times its own level (meta/upgrades.js `ownedEffects`), so
// this file cannot make a row claim a value the engine does not apply — the
// worst it can do is call something by the wrong name, which is visible on
// sight. tests/shopowned.test.js asserts every key any upgrade uses has an
// entry here, because the failure mode of a missing one is a row that silently
// omits a bonus the player has paid for.
//
// `kind` is the UNIT, not the formatting: `ui/format.js` owns how a percentage
// or a duration is rendered, and content may not.
//   pct       a fraction to be shown as a percentage         (+72% income)
//   flat      an absolute count, shown as-is                 (+15 slots)
//   hours     milliseconds, to be read in hours              (+12h away cap)
//   discount  a multiplier BELOW 1, shown as the saving      (-21% cost)
export const EFFECT_LABELS = Object.freeze({
  income: { label: 'income', kind: 'pct' },
  goldRate: { label: 'battle gold', kind: 'pct' },
  farmYield: { label: 'farm yield', kind: 'pct' },
  atk: { label: 'attack', kind: 'pct' },
  def: { label: 'defence', kind: 'pct' },
  march: { label: 'march speed', kind: 'pct' },
  trainSpeed: { label: 'training speed', kind: 'pct' },
  siegeDmg: { label: 'siege damage', kind: 'pct' },
  structureRegen: { label: 'wall repair', kind: 'pct' },
  trainCost: { label: 'training cost', kind: 'discount' },
  startGold: { label: 'starting gold', kind: 'flat' },
  expedition: { label: 'expedition slots', kind: 'flat' },
  garrisonCap: { label: 'garrison cap', kind: 'flat' },
  offlineCapMs: { label: 'away cap', kind: 'hours' },
});

/** A per-troop line: the key IS the unit id, and every one of them buys the
 *  same pair. Kept out of the table above so adding a ninth troop needs no
 *  entry here — the roster is the only place a unit should have to be listed. */
export const UNIT_EFFECT = Object.freeze({ label: 'attack and defence', kind: 'pct' });
