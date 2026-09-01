// WHO YOU ARE FIGHTING. Names for the enemy's regional commanders.
//
// MEASURED, and it is the finding that justifies the file: over a ~315-minute
// campaign nobody in this game is named, nobody speaks, and nobody is
// remembered. The enemy Marshal — the one thing the enemy does that a player
// has to answer — was a `banner` field and an anonymous "the host".
//
// PURE DATA, AND PURE DECORATION. Nothing here reaches `battle/`, nothing
// crosses `contract.js`, and no number in content/regions.data.js can move
// because of it: a name is resolved by meta/marshals.js from `(regionId,
// resets)` and handed to a SCREEN as a string. `tests/marshalname.test.js`
// asserts that against the source, because "this is only flavour" is a claim a
// fixture cannot demonstrate.
//
// TWO TITLES, AND THE DIFFERENCE IS REAL RATHER THAN FLAVOUR.
// `ENEMY_MARSHALS_BY_TIER` is [0,0,0,1,1,2], so a region below tier 4 fields no
// marshal at all — its throne is held by a CASTELLAN, and its garrison fights
// at face value. From tier 4 a MARSHAL holds it, the banner is real (+25% to
// the stack, +40% training), and the title is the player's warning that this
// throne refills faster than the last one. A single title for both would make
// the word mean nothing exactly where it has to mean something.
export const COMMANDER_TITLES = Object.freeze({
  marshal: 'Marshal',
  castellan: 'Castellan',
});

/**
 * Given names and houses, drawn separately.
 *
 * There are more houses than there are regions ON PURPOSE: the draw is a
 * rotation over one seeded shuffle (meta/marshals.js), the same construction
 * `campaignTwistPlan` uses, so within a single campaign no two regions can
 * share a house. Independent samples would collide, and a player reads two
 * "Marshal Vane"s as a bug rather than as a coincidence.
 *
 * No pronouns anywhere, here or in the copy that renders these: the table is a
 * mix, the game never needs to say which, and inventing one per row would be
 * both pointless and a thing to get wrong. Every string that talks about a
 * commander names them or says "the Marshal".
 */
export const MARSHAL_NAMES = Object.freeze({
  given: Object.freeze([
    'Aldric', 'Sera', 'Corvin', 'Maelis', 'Rowan', 'Ysolde', 'Bran', 'Alix',
    'Torvald', 'Neve', 'Garrick', 'Ilsa', 'Emeric', 'Wren', 'Doran', 'Sabine',
  ]),
  house: Object.freeze([
    'Vane', 'Harrow', 'Blackwood', 'Ferris', 'Marlowe', 'Ashgrave', 'Cole',
    'Redmayne', 'Thorn', 'Kestrel', 'Wyndham', 'Osric', 'Falke', 'Greave',
    'Aldemar', 'Rooke', 'Vasska', 'Merrow', 'Stannic', 'Locke', 'Draye',
    'Halloway', 'Orwin', 'Cadwal', 'Brenne', 'Sallow', 'Ivenne', 'Quell',
  ]),
});

/** The shuffle's seed. A constant, so a name is a pure function of the region
 *  and the number of abdications — see meta/marshals.js `commanderFor`. */
export const NAME_SEED = 0x4d41525348;
