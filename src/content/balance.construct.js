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
 * SUPERSEDED — `battle/construct.js buildBlocker` no longer reads this.
 *
 * The ground rule used to be "within this many hexes of a site you hold",
 * which drew a fixed ring around each building instead of answering "is this
 * my country". It is now "wherever `state.influence` already says is yours" —
 * the same flood the board paints — so a player with sites clustered around a
 * gap can build in that gap even though no single site's own ring reaches it.
 * See `buildBlocker`'s own comment for the reasoning.
 *
 * Left defined, unused, rather than deleted: `content/balance.js` re-exports
 * it by name (`export { BUILD_COSTS, BUILDABLE_KINDS, BUILD_RANGE_HEXES,
 * BUILD_MIN_SEPARATION } from './balance.construct.js'`) and that file is
 * frozen mid a concurrent rewrite, so deleting the export here would break
 * every module that loads through the front door for a line nothing reads any
 * more. Safe to remove the day that re-export is edited anyway.
 */
export const BUILD_RANGE_HEXES = 4;

/**
 * HOW MANY BUILDS A FACTION MAY HAVE GOING UP AT ONCE.
 *
 * One at a time kept the spend rate honest but also meant a treasury sitting
 * on a surplus behind two separate frontiers could only ever act on one of
 * them — the other simply waited its turn for no reason connected to gold or
 * risk. Two is still a real cap (a battle treasury cannot turn itself into a
 * skyline in one tick), but it lets a player answer two separate needs at
 * once — a farm at home and a yard at the front — instead of queueing the
 * second behind the first out of a rule that was never about affordability.
 */
export const BUILD_MAX_CONCURRENT = 2;

/**
 * How far a BUILT site must sit from every existing one.
 *
 * Looser than `MAPGEN.minSeparation` (3), which is a LEGIBILITY rule for a
 * generator scattering sites nobody chose: it keeps a fresh map from reading
 * as a clump. A player placing one building on purpose has already made that
 * judgement, and holding them to the generator's spacing is what makes the
 * verb unusable exactly where it matters.
 *
 * IT MUST NOT EXCEED WHAT THE LEGAL AREA CAN AFFORD, and that stopped being
 * true at 2 the moment the ground rule became TERRITORY rather than a radius
 * from one site (see `buildBlocker`). A radius-4 ring around every site you
 * hold is generous; the player's actual territory flood on a fresh three- or
 * four-site beachhead can be thin — often little more than a one-hex shell
 * around a tight cluster — and separation 2 discards exactly that shell.
 * Measured, at 2: `ironcrown` and `gravenreach` had ZERO legal build hexes at
 * tick 0, on boards where the OLD range rule had given them 11 and 3. Neither
 * recovers with ordinary play either — 5 simulated minutes with nobody acting
 * changes nothing (territory only moves on a capture), and capturing the
 * single nearest neutral site does not open one either, because that site's
 * own shell is exactly as thin as the beachhead's. At 1, the same 24 regions
 * read 17–27.
 *
 * THE COST: at 1, `d < BUILD_MIN_SEPARATION` can only ever be true for d = 0,
 * which `buildBlocker` already returns `'occupied'` for one line earlier — so
 * `'too-close'` is provably unreachable by distance alone at this value.
 * Left in rather than deleted, because "keep the separation rule" survives as
 * a real, if currently redundant, floor: raising this constant a single step
 * in a future balance pass (once a bigger empire's territory has room to
 * spare it) makes the branch reachable again with no code change, and
 * `'too-close'` stays the honest name for what it would refuse.
 */
export const BUILD_MIN_SEPARATION = 1;
