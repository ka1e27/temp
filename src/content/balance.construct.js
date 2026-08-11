// Construction: what a player may raise mid-battle, what it costs, and where it
// may stand.
//
// Split out of ./balance.js for the 400-line cap and re-exported from there —
// same arrangement as ./ai.data.js and ./balance.engine.js, so every existing
// `import { BUILD_COSTS } from '../content/balance.js'` still resolves and a
// balance pass is still one diff across the same front door.
// PURE DATA.

/**
 * WHAT YOU CAN BUILD MID-BATTLE, and what it costs.
 *
 * A kind absent from this table cannot be built at all, and the two absences
 * are the rule rather than an oversight: a `camp` is where you landed and a
 * `castle` is the win condition. Being able to raise either would mean building
 * your way out of losing one.
 *
 * PRICED AGAINST THE UPGRADE LADDER, which is the only other thing battle gold
 * buys — `SITE_UPGRADE[0]` is 150 gold for 20 seconds. A new farm has to cost
 * more than levelling one you already hold, because it is a whole extra site
 * AND it extends your influence onto ground you did not have to fight for. The
 * yard is where it gets expensive: it is the one purchase that makes more army,
 * and at 350 it is a real commitment against a battle treasury that opens at
 * 300 and earns 10-80 a second.
 *
 * `sec` is deliberately long. A building that appears in five seconds is a
 * spell; one that takes half a minute is a decision you make behind your own
 * line and then have to defend, which is the whole reason it goes on the board
 * as a bar rather than a puff of smoke.
 */
export const BUILD_COSTS = Object.freeze({
  farm:           { gold: 200, sec: 25 },
  trainingGround: { gold: 350, sec: 35 },
  stronghold:     { gold: 500, sec: 50 },
  // Cheapest thing on the menu, on purpose: the point of a watchtower is
  // putting one where you want to see, which means an ordinary player has to
  // be able to afford it on a whim rather than save for it.
  watchtower:     { gold: 120, sec: 15 },
});

/** Kinds a faction may raise. Derived, so the table above is the one statement
 *  of it and a kind cannot be priced without becoming buildable. */
export const BUILDABLE_KINDS = Object.freeze(Object.keys(BUILD_COSTS));

/**
 * How far from your own ground you may build, in hexes.
 *
 * NOT a free-placement rule: you raise buildings inside the country you hold,
 * so a hex has to be within this of a site you own.
 *
 * IT MUST BE AT LEAST `MAPGEN.minSeparation`, AND THAT IS NOT A MARGIN — it is
 * the difference between the rule working and there being no legal hex on the
 * board at all. A new site has to sit 3 or more hexes from EVERY existing one,
 * including the one it is being built near, so a range below 3 asks for a hex
 * that is simultaneously within 2 of your farm and at least 3 from it. Set to 2
 * first, and every hex of a 192-hex gallowmoor was refused.
 *
 * 4 leaves a ring one hex deep — distances 3 and 4 — around each site you hold.
 * That is enough to extend the frontier by a step rather than only infill, and
 * narrow enough that where your country ends is still somewhere you can see.
 */
export const BUILD_RANGE_HEXES = 4;

/**
 * How far a BUILT site must sit from every existing one.
 *
 * Deliberately looser than `MAPGEN.minSeparation` (3), which is a LEGIBILITY
 * rule for a generator scattering sites nobody chose: it keeps a fresh map from
 * reading as a clump. A player placing one building on purpose has already made
 * that judgement, and holding them to the generator's spacing is what makes the
 * verb unusable exactly where it matters — measured on gallowmoor, a 16x12 board
 * carrying 28 sites and a `narrow` rock mask, the whole map offered ONE legal
 * hex at separation 3.
 */
export const BUILD_MIN_SEPARATION = 2;
