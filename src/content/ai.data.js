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
 *
 * ---------------------------------------------------------------------------
 * TIERS 3-5 CUT AGAIN (0.58/0.66/0.72 -> 0.42/0.55/0.62) WHEN THE PLAYER'S
 * STARTING FOOTPRINT CAME DOWN, and this is one of the two knobs that paid.
 *
 * The campaign had been buying its late difficulty with `siteCounts.player`,
 * which left the player starting tier 5 owning MORE of the enemy's homeland
 * than the enemy did (see regions.data.js, tier 3 header). Cutting that back to
 * a raider's ~27% costs 30-55 points a region. `enemyMult`, the obvious answer,
 * is BLOCKED: tier 3 would need about 2.60 against tier 2's 2.88 and the dial is
 * required non-decreasing — a contradiction, not a tuning problem, exactly like
 * the tier-2 seven-site knot documented in regions.data.js.
 *
 * Two other levers were measured and REJECTED, which is worth recording so the
 * next pass does not re-derive them:
 *
 *   - The WARM-UP bought ~0. Extending it 90s -> 165s at tier 3 moved gallowmoor
 *     16% -> 10% and thanescar 9% -> 15%, which is noise at n=48. The player was
 *     not losing the opening, so buying more of it changed nothing. (The per-tier
 *     `warmupSec` field it added is kept — it is the right shape and costs
 *     nothing — but it is not what carries the tier.)
 *   - `castleGateFrac` is STILL not a difficulty knob, and this was the obvious
 *     place to expect it to have become one: swept 0.65 -> 0.38 on thanescar it
 *     moved the win rate ONE point, even with the player starting on a third of
 *     the ground it used to. It buys the guarantee against a rush. That is all.
 *
 * What they ruled out is what makes this the right knob: at 27% of the sites
 * against the enemy's 41-45% the player loses on PRODUCTION, and `economyMult`
 * is the one number that says how much the enemy's ground is worth to it. It is
 * also smooth where `enemyMult` is violently non-linear — measured on gallowmoor
 * before the expedition surge landed, 0.50 -> 13%, 0.42 -> 35%, 0.34 -> 63%,
 * about three points per 0.01.
 *
 * The other half is content/balance.js `perRegionSurge`, and the two are a PAIR:
 * solved separately, 0.34 here plus the surge put tier 3 at 73-96%, and 0.50
 * put it at 23-79%. Neither is a tier-3 problem — the expedition moved and this
 * had to be re-solved against it.
 *
 * THE LADDER IS NOT MONOTONIC AND NEVER HAS TO BE (0.53 at tier 2, 0.42 at tier
 * 3). It is a per-tier handicap that exists to make each tier's fight right, not
 * an advertised difficulty. It does mean the enemy's ABSOLUTE opening income
 * dips across that boundary — measured, emberholt 24.8 gold/s to gallowmoor 19.1
 * — which is real and is the price of the seam. Two smaller dips already existed
 * for unrelated reasons (kaldan -> highmarch, blackspire -> ironcrown). What is
 * pinned instead is the property that actually bites, and it is comfortable:
 * tests/campaign.test.js caps the enemy at 4x the player's opening income, and
 * the worst region in the campaign is nightharrow at 1.51x.
 */
/**
 * `adaptComposition: boolean` became `counterShare: number` — the share of the
 * enemy's STRONGHOLDS that retrain onto the answer to whatever the player fields
 * most (battle/ai.js `adapt`). Same reasoning as `staging` above, and a much
 * bigger number: measured at n=96, switching counter-training off was worth +17
 * points of win rate on gallowmoor and +32 on karrowmere, which made it the
 * largest single difficulty step anywhere in the campaign — and it was an
 * unadvertised flag flipping between region 9 and region 10.
 *
 * That is what made the middle of the campaign unfixable from the region table.
 * Every dial in content/regions.data.js is required to be non-decreasing, so the
 * first tier-3 region can never be tuned EASIER than the last tier-2 one; with a
 * ~25-point AI cliff sitting on that boundary, either tier 2 stayed a walkover
 * (emberholt at 94%) or tier 3 fell through the harness floor. As a ladder —
 * nothing, nothing, a fifth, two fifths — the boundary is a step the per-region
 * dial can absorb. Tier 4 keeps exactly the 0.40 it always effectively ran at,
 * so the endgame's counter-training behaviour is unchanged.
 *
 * It also, finally, makes duskfell's "the enemy counter-trains here for the
 * first time" less of a lie: at tier 3 only a fifth of the walls answer you.
 */
/**
 * `aggression` IS GONE, and it never did anything.
 *
 * It was a per-tier multiplier applied at exactly one place — battle/ai.js, on a
 * candidate score that is only ever SORTED. There is no score threshold anywhere
 * in the file, so multiplying every candidate by 0.60 or by 1.20 cannot change
 * the ordering, cannot change how many attacks launch, and cannot change which
 * one goes first. The 0.60 / 0.75 / 1.00 / 1.20 ladder bought precisely nothing,
 * and it read like the main difficulty dial.
 *
 * Deleting it changes no behaviour by construction. What actually varies the
 * enemy's appetite is `commitRatio`, `safetyMargin` and `concurrent` — and, from
 * this build, how long the battle has been running (see `AI.warmup`).
 */
export const AI_TIERS = [
  { reactionTicks: 45, commitRatio: 0.45, safetyMargin: 1.60,
    economyMult: 0.2746, concurrent: 1, retreatDiscipline: 0.10, counterShare: 0,
    ramAppetite: 0.1, stagingRatio: 0, stagingKeep: 1.0, warmupSec: 90 },
  { reactionTicks: 32, commitRatio: 0.50, safetyMargin: 1.50,
    economyMult: 0.5300, concurrent: 1, retreatDiscipline: 0.35, counterShare: 0,
    ramAppetite: 0.4, stagingRatio: 0.70, stagingKeep: 0.35, warmupSec: 90 },
  { reactionTicks: 26, commitRatio: 0.70, safetyMargin: 1.25,
    economyMult: 0.4200, concurrent: 2, retreatDiscipline: 0.65, counterShare: 0.20,
    ramAppetite: 0.8, stagingRatio: 0.70, stagingKeep: 0.05, warmupSec: 165 },
  { reactionTicks: 19, commitRatio: 0.80, safetyMargin: 1.15,
    economyMult: 0.5500, concurrent: 3, retreatDiscipline: 0.90, counterShare: 0.40,
    ramAppetite: 1.0, stagingRatio: 0.80, stagingKeep: 0.05, warmupSec: 195 },
  // Tier 5. Every knob that was already at its ceiling stays there — `ramAppetite`
  // is 1.0 at tier 4 and there is no 1.1 — so what separates this commander is
  // TEMPO, not appetite: it thinks about a third more often, commits on a
  // thinner margin, and runs a fourth simultaneous attack. `concurrent` is the
  // one that is felt, because the player's answer to two threats is to shuttle
  // one relief force and the answer to four is that they cannot.
  //
  // `counterShare` 0.50 is the first setting where HALF the walls answer your
  // army — and it is deliberately not higher, because the spear backbone in
  // battle/ai.js `adapt` reserves one stronghold before either share spends
  // anything, and a share that eats the rest is how the enemy disarmed itself
  // the first time (see tests/campaign.test.js, "never disarms itself").
  { reactionTicks: 15, commitRatio: 0.85, safetyMargin: 1.08,
    economyMult: 0.6200, concurrent: 4, retreatDiscipline: 0.95, counterShare: 0.50,
    ramAppetite: 1.0, stagingRatio: 0.85, stagingKeep: 0.05, warmupSec: 225 },
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
  // ...and the share that answers your army is PER TIER (`counterShare` above),
  // because it is a difficulty ladder rather than a constant of the engine.
  stagingCapMult: 2,        // how far over a garrison cap the AI will mass to strike
  thinkJitter: 0.2,

  /**
   * THE OPENING IS QUIETER THAN THE MIDDLE.
   *
   * You are raiding a region the enemy already owns outright, and you land with
   * a fraction of what it has. Before this, the AI was exactly as aggressive on
   * tick 0 as at minute ten — it thought on the very first tick and committed
   * immediately — so the smaller landing force this build ships would simply be
   * met at the beach and rolled over. Nothing about that is an interesting
   * fight; it is a coin flip decided before either side has an economy.
   *
   * So the enemy spends the first `rampSec` consolidating rather than pressing:
   * a higher `safetyMargin` (it wants a bigger edge before it will commit), a
   * lower `commit` (it sends less when it does) and one fewer concurrent attack.
   * Each eases linearly to the tier's real value, and every one of them is a
   * knob that PROVABLY bites, unlike the `aggression` this replaces.
   *
   * `reactionTicks` is deliberately NOT ramped: tests/ai.test.js pins the think
   * jitter as a fixed band off it, and a moving think interval would make the
   * AI's cadence — not its judgement — the thing that changes.
   *
   * This is a difficulty knob AND a pacing one. It buys the player the first
   * ninety seconds to take neutral ground and get farms running, which is the
   * opening the whole "land small, grow into it" shape needs in order to exist.
   */
  warmup: {
    // Per-tier via `AI_TIERS[].warmupSec`; this is the fallback and the tier-1/2
    // value. It rises steeply from tier 3 (165/195/225s) because THE PLAYER NO
    // LONGER STARTS OWNING THE COUNTRY. A landing that holds a raider's ~27% of
    // a 48-site region has to go and take the neutral pool before it has an
    // economy at all, and measured at n=64 it was being rolled up before it
    // could: tiers 3-5 lost in an all-runs median of 2.0-3.6 minutes. The
    // warm-up is the window that conversion happens in, so it has to scale with
    // how much there is to convert.
    rampSec: 90,        // fully aggressive after this long
    safetyMult: 1.45,   // x this on safetyMargin at tick 0, easing to x1
    commitMult: 0.55,   // x this on commitRatio at tick 0, easing to x1
    holdConcurrent: 1,  // this many fewer simultaneous attacks at tick 0
  },

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
