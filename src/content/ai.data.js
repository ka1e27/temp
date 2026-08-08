// The enemy commander's numbers: the per-tier ladder and the knobs that are the
// same at every tier.
//
// Split out of content/balance.js purely for the 400-line budget — this is the
// same PURE DATA under the same rule, and balance.js re-exports both names, so
// every existing `import { AI, AI_TIERS } from '../content/balance.js'` still
// resolves and a balance pass is still one diff across two files.
// PURE DATA.
/**
 * `staging: boolean` became two numbers, `stagingRatio` and `stagingKeep`.
 *
 * The old boolean was the single biggest exploit in the game. Tiers 1 and 2 had
 * it OFF, and sends are adjacency-only, so everything an interior stronghold
 * trained was stranded where it stood forever: measured on kaldan, a mean of 67
 * enemy troops — more than HALF of everything the AI owned — sat two or more
 * hops behind its own front line, and the player only ever met the skin of it.
 * "I only win when I fully make use of the dumb NPC" is that number.
 *
 * Turning it on is not the fix on its own: at n=240 kaldan went 60% -> 8%,
 * because a region's `enemyMult` had been implicitly tuned against an AI that
 * wasted half its production. So tier 2 releases the rear army AND has its
 * `economyMult` cut to pay for it. The force you fight is about the same size;
 * the difference is that all of it now turns up. Measured at n=240:
 *
 *      staging off, economy 0.85   60% / 20.3m   (~40% of runs hit the cap)
 *      staging on,  economy 0.85    8% / 12.4m
 *      staging on,  economy 0.84   44% / 20.4m
 *      staging on,  economy 0.82   57% / 18.0m
 *      staging on,  economy 0.80   66% / 16.6m   <- shipped
 *
 * Those figures are in the OLD units, when the handicap was applied three times
 * over (see the block below): 0.80 there is 0.512 here. Kaldan now reads 65% /
 * 17.2m at n=240, restored deliberately — removing the triple application cost
 * the tier-2 enemy castle a fifth of its income and took kaldan from 59% to 71%
 * at n=96, so 0.512 was re-tuned to 0.544, which is the value that puts the
 * enemy's TOTAL opening income back on the number it used to earn. Kaldan's
 * `enemyMult` of 1.85 is pinned by tests/world.test.js and was not touched.
 *
 * 0.80 over 0.82 for the MEDIAN, not the win rate: kaldan's length sits on a
 * cliff (about 40% of runs used to grind all the way to the hard cap) and 16.6m
 * against a 14m advertised length is the first time this region has finished
 * anywhere near what it promises.
 *
 * `stagingKeep` is the share of its CAP a rear site holds back. Tiers 3-4 keep
 * almost nothing, which is exactly the drain-to-the-floor behaviour they always
 * had; tier 2 keeps a third, so what moves forward is the overflow a site was
 * wasting rather than its whole garrison.
 */
/**
 * `economyMult` IS NOW APPLIED EXACTLY ONCE, in battle/economy.js
 * `siteGoldPerSec`. It used to ride the multiplicative bucket in
 * meta/modifiers.js `enemyMods` as well, on BOTH goldRateMult and farmYieldMult,
 * so an enemy farm felt it three times over and a castle twice. The values below
 * are therefore the CUBES of the old ones for tiers 1 and 2, which reproduces
 * what the balance-frozen regions 1-5 actually fought, to the last centigold on
 * every farm:
 *
 *      tier 1   0.65^3 = 0.2746        tier 3   was 1.05^3 = 1.1576
 *      tier 2   0.80^3 = 0.5120        tier 4   was 1.35^3 = 2.4604
 *
 * Tier 2 then ships at 0.5300 rather than 0.5120. Farms are exact at the cube;
 * a CASTLE only felt the old handicap twice, so the cube costs it a fifth of
 * its income, and on kaldan — which sits on a cliff — that alone was worth
 * twelve points of win rate (59% -> 71% at n=96). Re-tuned against the harness
 * rather than against the algebra, because kaldan's `enemyMult` of 1.85 is
 * pinned by tests/world.test.js and is not available:
 *
 *      0.5120   71% / 16.2m      0.5440   59% / 17.5m
 *      0.5300   67% / 17.1m   <- shipped  0.5800   50% / 19.0m
 *
 * against a pre-change baseline of 59% / 17.2m at the same n=96 and the 66% /
 * 16.6m at n=240 recorded above. 0.5440 restores the baseline exactly and 0.5300
 * restores the DOCUMENTED value with margin at every sample size, which matters
 * because the twelve seeds `simrunner --all` uses by default put kaldan at 50%
 * on the first and 75% on the second.
 *
 * Tiers 3 and 4 are NOT the old cubes, because the old cubes were the whole
 * reason the endgame ran away: obsidian's enemy earned 537 gold/s against the
 * player's 30. Their economy now comes from the ground they hold — a tier-4
 * region is `develop`-4 country, so its farms are already on SITE_LEVELS x2.75
 * gold and its strongholds on x2.19 training — rather than from a hidden dial
 * that the region description never mentions. Taking a farm off the enemy is
 * worth proportionally what it looks like it is worth.
 */
export const AI_TIERS = [
  { reactionTicks: 45, aggression: 0.60, commitRatio: 0.45, safetyMargin: 1.60,
    economyMult: 0.2746, concurrent: 1, retreatDiscipline: 0.10, adaptComposition: false,
    ramAppetite: 0.1, stagingRatio: 0, stagingKeep: 1.0 },
  { reactionTicks: 32, aggression: 0.75, commitRatio: 0.50, safetyMargin: 1.50,
    economyMult: 0.5300, concurrent: 1, retreatDiscipline: 0.35, adaptComposition: false,
    ramAppetite: 0.4, stagingRatio: 0.70, stagingKeep: 0.35 },
  { reactionTicks: 22, aggression: 1.00, commitRatio: 0.70, safetyMargin: 1.25,
    economyMult: 0.6200, concurrent: 2, retreatDiscipline: 0.65, adaptComposition: true,
    ramAppetite: 0.8, stagingRatio: 0.70, stagingKeep: 0.05 },
  { reactionTicks: 15, aggression: 1.20, commitRatio: 0.80, safetyMargin: 1.15,
    economyMult: 0.7500, concurrent: 3, retreatDiscipline: 0.90, adaptComposition: true,
    ramAppetite: 1.0, stagingRatio: 0.80, stagingKeep: 0.05 },
];

/** AI knobs that are the SAME at every tier. Per-tier knobs live in AI_TIERS. */
export const AI = {
  freeLunchDefence: 25,     // "leave a farm on 3 militia and it will be taken"
  defendMargin: 1.10,       // reinforce to close the gap x1.1
  threatHorizonTicks: 60,
  garrisonFloor: 3,         // never strip a front site below this
  reliefMarginSec: 10,      // breach must beat relief by this much or pull out
  siteValue: { farm: 100, stronghold: 150, camp: 400, castle: 400 },
  consolidationBonus: 0.15, // per adjacent site already held
  sampleDecay: 0.7,         // exponential decay on the observed player army
  // BOTH of these are SHARES OF PRODUCTION, converged on every think — see
  // battle/ai.js `adapt`. Rolled as per-think probabilities they ratchet to
  // 100%, and since rams (def 2) and a counter-pick (raiders, def 4, no
  // bulwark) are both far worse defenders than the spearmen (def 8 x 1.75) they
  // replace, the AI used to disarm itself over the course of a long battle.
  ramTrainShare: 0.5,       // share of strongholds that take rams while sieging
  counterTrainShare: 0.40,  // ...and of everything else that answers your army
  stagingCapMult: 2,        // how far over a garrison cap the AI will mass to strike
  thinkJitter: 0.2,

  // --- surplus: press when there is army going spare ----------------------
  // "More troops than it needs to hold what it has" is measurable: reserve is
  // the garrison floor plus whatever is actually being thrown at each site, and
  // anything past that is spare. At full surplus the tier's commit and staging
  // ratios open `surplusPress` of the way to total commitment.
  surplusFullAt: 1.0,       // spare == this x the reserve is a FULL surplus
  surplusPress: 0.80,       // how far toward all-in a full surplus opens a ratio
  surplusConcurrentAt: 0.5, // ...and above this it opens a second front
  surplusConcurrent: 1,

  // --- home: the castle is the win condition ------------------------------
  // defend() only sees squads already in the air inside threatHorizonTicks —
  // six seconds. For the castle that is too late, so homeGuard reads the army
  // STANDING within homeRadius hops as well, reinforces down chained sends from
  // anywhere in its own territory, and abandons a siege of its own when the gap
  // is still this far from closed.
  // Radius 1 = "standing on the doorstep". 2 was measured and is too jumpy: on
  // a tier-1 map half the board is within two hops of the castle, so the AI
  // spent the whole battle recalling an army nobody was threatening, and the
  // COUNTRYSIDE got easier by exactly as much as the castle got harder.
  homeRadius: 1,            // hops from the castle that count as encroachment
  homeGuardMargin: 1.30,    // hold the castle against this multiple of what is near
  homeRecallRatio: 0.75,    // below this share of `need`, call the siege army home
  /** Rock-paper-scissors answer to whatever the player fields most. */
  counterPick: {
    militia: 'raiders', spearmen: 'militia', raiders: 'spearmen',
    rams: 'raiders', marshal: 'spearmen',
  },
};
