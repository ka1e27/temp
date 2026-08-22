// THE DOCTRINE — the one decision the player makes BEFORE they see the map.
//
// The campaign's biggest structural gap, measured: the last unlock arrives at
// region 8 of 24, and the remaining 261 minutes — 68% of the running time —
// introduce no new unit, booster or ability. Difficulty rises and nothing else
// changes. A doctrine is the cheapest honest answer to that, because it makes
// two runs of the SAME region different without adding a unit (a unit is a
// cliff and the dial is a slope, which is why tiers 5 and 6 both declined to
// add one) and without adding a system the balance table has to absorb.
//
// PURE DATA. The draw and the application are in meta/doctrine.js, the same
// division of labour the region table and the mutator table both use.
//
// FOUR RULES, and the first is the one that keeps it out of the re-tune.
//
// 1. EVERY DOCTRINE IS A TRADE, NEVER A GRANT. One field up, one field down,
//    and the pair is chosen so the two land on DIFFERENT phases of a battle —
//    the Quartermaster front-loads the opening and pays for it over the whole
//    fight; the Breaker buys walls and sells the march. A table of pure buffs
//    would collapse the choice into "which number is biggest" AND re-tune all
//    twenty-four regions at once, and this project has spent whole sessions
//    undoing exactly that (see "the campaign is currently being tuned against a
//    bot with a known conversion defect" in CLAUDE.md).
//
//    It does NOT follow that a trade is worth zero. The bot attacks far more
//    than it defends, so `vanguard` reads as a buff to the harness and `warden`
//    as a cost, and a human who turtles would read them the other way round.
//    That asymmetry is the feature; the numbers below are a first cut and the
//    measured per-doctrine table lives in CLAUDE.md.
//
// 2. EVERY FIELD ALREADY CROSSES THE SEAM, so this is content rather than
//    engine — no CONTRACT field moved and CONTRACT_VERSION stays where it is.
//    That is the same discipline the incursion ladder followed and the reason
//    it needed one optional field and no engine change. Verified per field
//    rather than assumed: each is read through `modOf(state, site.owner, ...)`
//    or `state.mods[site.owner]`, so it applies to the player exactly as it
//    already applies to the enemy. A doctrine on a field only the enemy path
//    reads would be the fifth upgrade this project has had to refund.
//
// 3. NO NEGATIVE `garrisonCapBonus`, and the reason is stronger than "it would
//    be unbalanced" — the seam REFUSES it. `checks.js checkMods` requires every
//    numeric mod to be finite and >= 0, and `assertBattleConfig` runs it for
//    both factions on every config build and every battle start, so a negative
//    value does not make a hard battle, it makes a battle that will not start
//    and a resumed save that `meta/resume.js` discards. Available as a POSITIVE
//    lever; unusable as a cost, whatever a table might want.
//
// 4. THE POOL IS SIX AND THE HAND IS THREE. Six so that two neighbouring
//    regions rarely offer the same three; three because the loadout screen
//    already carries an army, a booster row and a briefing, and a fourth column
//    of anything is where that screen stopped fitting on a laptop once already.
//    Each of the six owns a DIFFERENT axis — offence, defence, treasury,
//    production, siege, mobility — so any hand of three is a real spread rather
//    than three flavours of "more attack".

/** How many of `DOCTRINES` are offered per battle. */
export const DOCTRINE_HAND = 3;

/**
 * The pool. `gain`/`cost` are both `{field, value}` over FactionMods, applied
 * multiplicatively to the player's mods and to nothing else.
 *
 * `startGold` is the one field that is a SUM rather than a multiplier
 * everywhere else in the codebase, and it is multiplied here on purpose: a flat
 * grant would be a fortune at region 1 and a rounding error at region 24, which
 * is the exact non-linearity that made `headStartPerReset` a percentage after
 * `+3 expedition slots a point` measured at +675% on region 1 and +9% on 24.
 *
 * @typedef {{field: string, value: number}} DoctrineTerm
 * @typedef {{id: string, name: string, gain: DoctrineTerm, cost: DoctrineTerm,
 *            note: string}} Doctrine
 * @type {readonly Doctrine[]}
 */
export const DOCTRINES = Object.freeze([
  {
    id: 'vanguard', name: 'The Vanguard',
    gain: { field: 'unitAtkMult', value: 1.12 },
    cost: { field: 'unitDefMult', value: 0.92 },
    note: 'Your troops attack 12% harder and defend 8% worse. Take ground fast '
      + 'enough and you never have to hold it.',
  },
  {
    id: 'warden', name: 'The Warden',
    gain: { field: 'unitDefMult', value: 1.14 },
    cost: { field: 'farmYieldMult', value: 0.80 },
    note: 'Your troops defend 14% harder and your farms yield 20% less. What '
      + 'you take, you keep — slowly.',
  },
  {
    id: 'quartermaster', name: 'The Quartermaster',
    gain: { field: 'startGold', value: 2.2 },
    cost: { field: 'goldRateMult', value: 0.82 },
    note: 'You land with more than double the treasury and earn 18% less all '
      + 'battle. Spend the opening; there is no second one.',
  },
  {
    id: 'drillmaster', name: 'The Drillmaster',
    gain: { field: 'trainSpeedMult', value: 1.30 },
    cost: { field: 'trainCostMult', value: 1.30 },
    note: 'Your yards train 30% faster and 30% dearer. Bodies stop being the '
      + 'bottleneck and gold starts being one.',
  },
  {
    id: 'breaker', name: 'The Breaker',
    gain: { field: 'siegeDmgMult', value: 1.40 },
    cost: { field: 'marchSpeedMult', value: 0.88 },
    note: 'Your sieges dig 40% faster and your columns march 12% slower. Walls '
      + 'stop mattering; distance starts to.',
  },
  {
    id: 'harrier', name: 'The Harrier',
    gain: { field: 'marchSpeedMult', value: 1.25 },
    cost: { field: 'structureRegenMult', value: 0.72 },
    note: 'Your columns march 25% faster and everything you hold repairs 28% '
      + 'slower. Be somewhere else before it matters.',
  },
]);

export const DOCTRINE_BY_ID = Object.freeze(
  Object.fromEntries(DOCTRINES.map((d) => [d.id, d])),
);

export const DOCTRINE_IDS = Object.freeze(DOCTRINES.map((d) => d.id));

/**
 * The campaign opener ships no doctrine, and that is an onboarding rule rather
 * than a balance one. A first battle already opens 85-90% dark, on a board
 * whose buildings are unscouted, with a treasury visibly draining — measured,
 * gold falls 294 -> 95 over the first two minutes with no input at all. Adding
 * a third irreversible choice to the screen in front of that is the moment a
 * new player stops reading. Region 2 on, once the loop has been seen once.
 */
export const DOCTRINE_FROM_CONQUESTS = 1;
