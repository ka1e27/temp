// THE REGION TABLE'S PROVENANCE — split out of ./regions.data.js purely for the
// 400-line cap (tools/checksize.js), the same reason regions.rules.js exists.
// The seam is prose vs table: regions.data.js is `T(...)` rows and short
// pointers, this file is the reasoning and the measurements behind them, per
// tier and per region where a row needed one of its own.
//
// NOT IMPORTED BY ANYTHING, DELIBERATELY. There is no data here for code to
// read — every number a battle or a test needs already lives on the row in
// regions.data.js. This file exists to be READ, the same job a comment
// sitting next to that row would otherwise do, moved here only because the
// row ran out of room. If you are changing a dial, read the section below for
// the region first: per this project's own house rule, the comment is the
// specification, and a lot of what follows is provenance rather than today's
// number — CLAUDE.md and a fresh `npm run sim` are the tie-breaker.
//
// PURE PROSE. No logic reads a number that is not defined in regions.data.js
// or balance.js.

// ============================================================================
// TIERS 1-2 (9) — RE-TUNED AGAINST THE MELEE LAYER, at n>=96. This is the
// current answer; everything below it in this section is provenance.
// ============================================================================
//
// The screen that opened this pass was n=24/n=12 and was wrong in BOTH
// directions, which is worth more than the numbers: highmarch read 67% and is
// 84%, thornmoor read 67% and is 82% — both within two points of their CEILING,
// where the screen put them comfortably mid-band. Moving a dial to "fix" those
// 67s would have pushed two healthy rows through the floor.
//
//     region     n=12   n=96  n=240   band     dial            measured
//     riverfen     83     80     83   78-92    1.86  held      80/83
//     ashford     100     94     95   78-92    2.70 -> 2.76    90
//     ironwood    100     92     93   78-92    3.19  held      92/93
//     saltmere     83     83     82   78-92    3.19  held      83/82
//     kaldan      100     92      -   66-84    3.23 -> 3.60    70
//     highmarch    67     84      -   66-84    3.39 -> 3.60    77
//     greywater    75     86      -   66-84    3.39 -> 3.60    73
//     thornmoor    67     82      -   66-84    3.56 -> 3.77    82
//     emberholt    92     90      -   66-84    3.67 -> 3.88    82
//
// All nine read `ok` on the shipped dials. Two of the moves are NOT justified by
// a measured gain: thornmoor read 82% at both 3.56 and 3.77, and it rises only
// because greywater rose to 3.60 and `enemyMult` must be non-decreasing.
//
// ⚠ THE SLOPE CONSTANT DOES NOT WORK HERE. CLAUDE.md's "~1.8 points per 0.01 on
// the small maps" predicted -12 points for kaldan's first +0.21; it bought ONE.
// Bracketed at n=96 the row has a 0.21-wide plateau and then a cliff:
//
//     dial   3.23   3.44   3.60   4.10   4.70
//     win%     92     91     70     30     11
//              0.05   1.31   0.80   0.32     <- local slope, pts per 0.01
//
// Every shipped value above was MEASURED at that value, never interpolated.
//
// Battle lengths are healthy across both tiers and there is NO length ramp in
// them: all nine win in 8.2-10.2 minutes while advertising 6.5 to 10, so the
// promise varies by 54% across a real spread of 13%. That is the
// `targetLengthMin` pass's problem, not the dial's, and it is deliberately NOT
// fixed here — the column derives `hardCapMs`, so re-authoring it changes the
// battle and every row above would need re-confirming.

// ============================================================================
// TIER 2 (5) — the first real wall. Kaldan proves the upgrade layer matters.
// ============================================================================
//
// TWO TRAPS IN `develop`, BOTH PAID FOR HERE. It is QUANTISED — greywater
// measured 63% at 1.5 and again at 1.25, then 69% at 1.2, because nothing
// crossed a promotion threshold between. And the assertion that binds is on
// the REALISED mean fort level, not this column: thornmoor has two forts to
// greywater's one, so the same 1.2 spreads thinner and realises 1.167 against
// 1.200 — an inversion tests/campaign.test.js catches and the raw column does
// not. 1.25 is the smallest value that realises 1.333 and clears it.
//
// Highmarch is 15x12 rather than 15x11 because at develop 1.2 it read 85%
// against an 84% ceiling, and its `choke` is the lever: a choke costs MORE on
// a bigger board (+5 on 13x10, -16 on 21x16 — battle/mapshape.js).
//
// AND `siteCounts.neutral` IS NOT THE FREE LEVER IT LOOKS LIKE, twice over.
// It moves the WRONG way — greywater at 7 neutral reads 66%, at 9 it reads
// **54%**, because unclaimed ground is a race and the enemy starts closer to
// more of it with an economy already running. And while the column itself has
// no non-decreasing constraint, TOTAL sites does, so a region's neutral pool
// can never exceed nextRegion.total - (thisRegion.enemy + player). Thanescar
// is capped at 15 by blackspire, i.e. at what it already ships.

// ============================================================================
// TIERS 3-6 — RE-TUNED AGAINST THE MELEE LAYER. Current answer at the top;
// everything below this block is provenance.
// ============================================================================
//
//     region        was    now     measured   band     verdict
//     gallowmoor   4.01   4.39        60      50-72    ok
//     sunder       4.08   4.39        60      50-72    ok
//     vaelstrand   4.38   4.76        67      50-72    ok
//     duskfell     4.45   4.85        71      50-72    ok  (1 under the ceiling)
//     karrowmere   4.58   4.85        54      50-72    ok
//     thanescar    4.60   4.90        54      34-56    ok
//     blackspire   4.73   4.95        54      34-56    ok
//     ironcrown    4.73   5.00        67      34-56    STILL OVER — see below
//     obsidian     4.78   5.05        67      34-56    STILL OVER — see below
//     ravensmarch  4.80   5.05        29      22-42    ok
//     gravenreach  4.93   5.05        33      22-42    ok
//     nightharrow / stormhalt  -> 5.05, monotonicity only, unmeasured there
//
// ⚠ THE PER-ROW SLOPE VARIES THREEFOLD, so no constant sizes a move. Points of
// win rate per 0.01: karrowmere 0.67, ravensmarch 0.53, gallowmoor 0.47,
// blackspire 0.46, thanescar 0.38, vaelstrand 0.29, sunder 0.26, ironcrown
// 0.24, duskfell 0.20, obsidian 0.15. Every value above was measured AT it.
//
// ⚠ IRONCROWN AND OBSIDIAN CANNOT BE FIXED BY THE DIAL. At 0.24 and 0.15 they
// need about +0.75 and +1.07 to reach band; `enemyMult` is non-decreasing, and
// ravensmarch brackets at 4.80 -> 42% / 5.20 -> 21% against a 22 FLOOR, so
// anything past ~5.05 pushes tier 5 out the bottom. They are boxed in.
//
// ⚠ AND THE NAMED FALLBACK IS DEAD. `siteCounts.neutral` is recorded below at
// "-4 points a site", measured on ironcrown itself. Re-measured there at n=24
// with the dial untouched, 19 -> 23 neutral read **71% before, 71% after**
// (obsidian 20 -> 24: 69% -> 67%; ravensmarch 18 -> 22: 42% -> 38%). It is now
// 0 to -1 a site — the old figure predates `--richyards`. Untried levers for
// those two rows: `enemyMix` (ravensmarch's [2,5,8] against their [2,4,7], the
// move that fixed ravensmarch once), the board, the AI tier. None measured.
//
// ⚠ TIERS 5-6 SIT IN BAND BECAUSE BATTLES RUN OUT OF CLOCK: eight defeats in
// 216 battles, every all-run median exactly on its hard cap. The dial there
// moves who beats you, not how often — thanescar at 5.00/5.20/5.50 held 44/40/48
// while timeouts fell 23 -> 17 and losses rose 4 -> 8. See CLAUDE.md.

// ============================================================================
// TIER 3 (5) — 16x12 to 17x13. Sieges are the conversation.
// ============================================================================
//
// THE TIER BOUNDARY IS THE ONE STEP THE DIAL CANNOT UNDO. Every column here
// is required to be non-decreasing, so the first region of a tier can never
// be tuned EASIER than the last region of the tier before it — whatever the
// AI ladder adds at the boundary is a floor on the drop. Counter-training
// used to arrive here as a BOOLEAN worth 17 points on gallowmoor and 32 on
// karrowmere (content/ai.data.js `counterShare`), which left one choice:
// leave tier 2 a walkover, or push tier 3 under the harness floor. It did
// the first, and emberholt shipped at 94%. As a per-tier share the boundary
// costs about nine points, which the columns below absorb.
//
// `siteCounts.player` IS THE BIGGEST LEVER IN THIS TABLE AND IT IS NO LONGER
// WHAT PAYS FOR A TIER. It measured +21 points per extra starting site on
// gallowmoor, so every pass that needed a region easier reached for it, and
// nothing asserted where that ended up: the player was starting tier 5
// holding 44-48% of the board against the enemy's 38-41% — on nightharrow,
// twenty-three sites to the enemy's eighteen, in the deepest region of the
// enemy's own homeland. The campaign's premise is that you are RAIDING
// country the enemy holds outright, and the raid stopped being a raid exactly
// where it was meant to be hardest. Every difficulty number passed, because
// difficulty was measured and ownership never was.
//
// The column is now a flat raider's share (~27%) the whole way down and
// tests/campaign.test.js pins it, ceiling and creep both. What replaced it as
// the answer to a harder tier is the EXPEDITION (balance.js
// `perRegionLate` 5 -> 11, which by construction cannot touch regions 1-5)
// and the enemy's WARM-UP (ai.data.js `AI_TIERS[].warmupSec`, 90s at tiers
// 1-2 rising to 225s at tier 5). The empire behind you buys an ARMY and the
// time to land it, not a province the map hands you before the battle starts.
// The ground it used to hand you is NEUTRAL now: still there, still takeable,
// just no longer free.
//
// The advertised length used to DROP here, from tier 2's 14-16.5 minutes, and
// that was measured rather than authored: a previous pass tried raising
// enemyMult, developing the enemy's country, garrisoning the throne, growing
// the map to 26 enemy sites on a 21x15 grid and tapering the expedition, and
// NONE of it moved a clean win past ten minutes, for a reason none of those
// levers touch — victory is capture-castle, and sites off the direct path to
// the throne were never fought over. A bigger map does not make a longer
// battle when the player can walk past most of it.
//
// `castleGateFrac` (see the comment above GATE_CLAMP) was the fix: the throne
// cannot fall below that fraction of the region's OTHER sites in play hands,
// so a clean win now costs real conquest of the countryside, not just the
// shortest road to the capital. Measured at n=240 with the gate live (on the
// PRE-melee-layer engine), every tier-3 region resolved in the neighbourhood
// of 7-8.5 minutes for a scripted player who already sweeps broadly when
// winning — the throne itself was never the long pole, the countryside
// always was, and this bot already goes and gets it. What the gate bought was
// the GUARANTEE: a rush strategy that skips the countryside now finds the
// castle sealed instead of an early win, and the regions the mechanism was
// built to fix (blackspire, ironcrown, obsidian) gained 1.2-2.0 real minutes
// at matched n. These numbers say what the regions did; see tests/world.test.js
// ("map size, site count and battle length scale together across tiers") for
// why the campaign-wide monotonic length claim is still NOT restored here.
//
// ALL OF THE ABOVE PREDATES THE MELEE LAYER, and every `targetLengthMin` in
// this tier moved because of it. Interception creates fights sieges and
// rallies used to skip straight past, and `hardCapMs = max(tier floor,
// targetLengthMin * 1.9)` means a stale 6-8.5-minute promise pins the whole
// tier to its 17-minute floor regardless of what the row says — every region
// from here to nightharrow was screened at that floor and read `losses<=2`
// with the rest `timeout AHEAD`, the same signature this file already
// flagged for nightharrow/stormhalt alone before this pass. Raised to
// 20-23m here (CLAUDE.md, "Still open" -> the campaign re-tune, third pass,
// carries the per-region numbers and the paired `enemyMult` cut that went
// with it) — the 7-8.5m figure above is provenance, not today's number.

// ============================================================================
// TIER 4 (4) — 17x13, 33-37 sites, develop 2.20-2.52.
// ============================================================================
//
// The endgame: the enemy's country is built, its throne is a capital with an
// army in it, it fields rams, a marshal and three concurrent attacks, AND its
// castle is gated behind the deepest territory requirement in the campaign as
// originally authored (0.65-0.72, since brought down to a flat 0.60 ceiling —
// see the castle-gate section of CLAUDE.md). A player who reaches the throne
// early sees it stay sealed (screens/battle-panel.js says so) until enough of
// the endgame map has actually changed hands.
//
// `develop` READS LOWER here than it used to (2.20-2.52 against 2.35-2.95)
// and the endgame is nonetheless harder, because the number was never the
// point — where its rounding boundaries fall is (see DEVELOP_CLAMP). Thanescar
// is where the enemy castle first reaches level 3, and that single promotion
// is worth more than the whole 2.52-to-2.95 stretch it replaces. `enemyMult`
// carried the rest, which is why it originally read 3.0+ here: the dial is
// the advertised difficulty and it should say what the region costs.
//
// Obsidian lands with SIXTEEN starting sites, three more than ironcrown. It
// is the one place the enemy site count has to cross 15 (tests/campaign.test
// pins the last region at three times the first), and 15 is where
// MAPGEN.enemyStrongholdShare rounds up a fifth stronghold — a step worth
// ~25 points on its own. The landing force is what pays for it.
//
// THANESCAR'S `develop` CARRIED ITS FRONTAGE CORRECTION, the only column that
// could: the dial was tier 4's shared 5.20 so raising it drags all four rows,
// grid and enemy count match blackspire's, and the neutral pool is capped at
// 15 by blackspire's TOTAL (tier-2 section above) — already spent. 2.20 ->
// 2.45 was the whole gap to blackspire, and read 46% against 71% at n=48 —
// BEFORE the melee-layer re-tune moved the shared dial again (5.20 ->
// 4.72-4.78) and raised `targetLengthMin` off its stale 6-7.5m promise; see
// CLAUDE.md for the current numbers.
//
// IRONCROWN'S NEUTRAL POOL IS THE LEVER THERE, and it is the tier-2 section's
// finding used deliberately rather than stumbled into. It ships on obsidian's
// exact dial and obsidian's exact enemy mix, and it measured THIRTEEN points
// easier (58% against 45% at n=96) — the whole difference between them was 15
// neutral sites against 20. Raising the dial cannot fix that: obsidian sits at
// the same value and `enemyMult` is required non-decreasing, so ironcrown can
// only rise by dragging obsidian below its own floor with it. Unclaimed ground
// is a race the enemy is better at, so widening the pool is a difficulty knob
// that costs nothing anywhere else.

// ============================================================================
// TIER 5 (3) — the enemy's homeland, east of the throne.
// ============================================================================
//
// The campaign used to END at a capital, which is a strange place for a war
// to stop: taking the enemy's capital is the moment you find out how much
// country is behind it. These three are that country, and they are the first
// ground in the game the enemy has ever had to defend rather than hold.
//
// WHAT MAKES TIER 5 HARD IS NOT A NEW UNIT. The roster runs out at tier 4
// (regions.rules.js ENEMY_UNITS_BY_TIER repeats itself here, on purpose — a
// tier whose identity is a new unit is a tier that cannot be tuned, because a
// unit is a cliff and the dial is a slope). Three things carry it instead:
//
//   1. THE COMMANDER. AI_TIERS[4] is the first that thinks more than once a
//      second, commits on a margin under 1.10, and runs FOUR simultaneous
//      attacks. `concurrent` is the knob the player feels, because the answer
//      to two threats is to shuttle one relief force and the answer to four
//      is that there is no such thing as a reserve.
//   2. THE GROUND. `develop` finally crosses into level-4 walls on
//      nightharrow, which is the single largest step in this column and is
//      deliberately spent on the LAST region rather than the tier opener (see
//      DEVELOP_CLAMP: a castle promotion is 25-40 points, so it is a finale,
//      not a ramp). 18x14 and 19x15 are the biggest maps in the campaign.
//   3. THE MARSHAL IN THE THRONE, which by tier 5 is standing on a level-4
//      castle: +25% to the garrison defending the win condition and +40% to
//      the rate it refills. Measured at n=96, granting it cost tier 4 between
//      1 and 8 points — that is the size of this half of the step, and it is
//      already paid for by the time a player arrives here.
//
// `castleGateFrac` is a flat 0.60 for the whole back half and is NOT doing
// the work — it is here so the last regions cannot be rushed, which is the
// only thing that column was ever meant to buy (see the gate section in
// CLAUDE.md for what happened when it drifted past that).
//
// The band is WIN_BAND[4] = [22, 42]: these are meant to cost a good player
// several attempts.
//
// RAVENSMARCH'S MIX WAS A TIER-5 MIX, and the dial could not have done it.
// It shipped with obsidian's exact mix ([2,4,7]) on a WIDER board — easier
// than the tier-4 region before it, against a band eleven points lower — and
// read 61% where its two tier-mates read 40% and 35% on the same dial.
// `enemyMult` is non-decreasing, so pulling it down alone would have needed a
// dial ABOVE gravenreach's: a contradiction, not a tuning problem. Its
// NEUTRAL pool then went 20 -> 18, the only lever left once the siege
// frontage cost the whole back half ~7 points and the dial sat on tier 4's
// own 5.20 plateau. 23% -> 32%, the middle of the band.
//
// GRAVENREACH SHIPPED WITH RAVENSMARCH'S EXACT ENEMY MIX ([2,5,8], byte-
// identical) on a bigger, MORE-DEVELOPED map, and `develop` alone (2.8
// against ravensmarch's 2.6) was enough to make it catastrophically worse:
// screened at matched settings, gravenreach read 1-ahead/15-behind against
// ravensmarch's 6-ahead/8-behind. Cut to 2.6 — still non-decreasing against
// both ravensmarch below and nightharrow above — rather than touching grid
// or neutral, which are the "the war gets bigger" columns this table has
// never walked back once shipped. (Third re-tune pass; see CLAUDE.md.)

// ============================================================================
// TIER 6 (3) — what is left when there is nothing left to hold.
// ============================================================================
//
// Tier 5 was the enemy's homeland. This is the coast behind it, and the
// premise of the tier is the one thing the campaign had never shown: an enemy
// that has already lost. It does not surrender and it does not field anything
// new — it digs into ground it has burned itself, and the two commanders who
// survived the homeland take the field in person.
//
// WHAT CARRIES IT IS THE SAME THREE THINGS THAT CARRIED TIER 5, for the same
// reason: the roster is exhausted, and a tier whose identity is a new unit is
// a tier that cannot be tuned, because a unit is a cliff and the dial is a
// slope. So:
//
//   1. THE COMMANDER. `AI_TIERS[5]` — five simultaneous attacks against tier
//      5's four, and the first commander in the game that will commit on a
//      margin under 1.0, i.e. that trades down on purpose to keep a fifth
//      front alive. `concurrent` is the knob the player feels: the answer to
//      four threats is that there is no reserve, and the answer to five is
//      that a front you are winning gets taken back while you are elsewhere.
//   2. THE GROUND. 20x15 and 21x16 are the biggest boards in the game. The
//      ORIGINAL design statement here was `develop` reaching the rung where
//      the CASTLE promotes to level 4 on the tier OPENER rather than the
//      finale — 3.1, see DEVELOP_CLAMP — deliberately spent on stormhalt
//      because the opener is also where the player takes the biggest step
//      they will ever take (`EXPEDITION.finalBonus`, +60 slots), and rule 2
//      of this table is that a region's step must be the size of the
//      player's step into it. MEASURED AT n=96 THAT ONE RUNG COST ABOUT
//      TWENTY POINTS (46% at develop 2.9 / dial 4.41, 26% at develop 3.1 /
//      dial 4.37) and it was spent on purpose.
//
//      **THAT TRADE STOPPED BEING AFFORDABLE.** Re-measured against the
//      melee and fog layers (CLAUDE.md "A fight takes time" / "Fog of war"),
//      stormhalt was not merely hard, it was UNWINNABLE — 0 wins in 48
//      seeded attempts, cap or no cap; diagnosed with the cap manually
//      lifted to 60 minutes, two of three sampled seeds were outright routs
//      inside eight minutes and the third was contested 47v56 with the
//      castle never besieged even at 60 minutes. THE THIRD RE-TUNE PASS
//      reverted `develop` 3.1 -> 2.9 (the castle stays at level 3, matching
//      nightharrow rather than exceeding it) as one part of the fix, paired
//      with an `enemyMult` cut and a `targetLengthMin`/`hardCapMs` raise —
//      see CLAUDE.md ("Still open" -> the campaign re-tune, third pass) for
//      the current numbers and whether it was enough. The dial then has
//      almost nowhere to go inside the tier as originally authored — 4.37 to
//      4.48 across three regions, though the re-tune moved it further —
//      which is the whole reason the ground was meant to carry this tier and
//      not the dial.
//   3. THE SECOND BANNER. `ENEMY_MARSHALS_BY_TIER` grants two rather than one,
//      the second into the best-defended stronghold. It is worth 4-9 points —
//      the same order as granting the first one cost tier 4 — because `banner`
//      is stack-local: it makes ONE line of the countryside genuinely
//      expensive rather than making the whole map slightly harder.
//
// The band is WIN_BAND[5] = [18, 36]. These are the last three regions in the
// game and they are meant to cost a good player several attempts each, with
// the incursion ladder (content/incursion.data.js) waiting past them for a
// player who wants difficulty without end.
//
// NOTHING SMALLER THAN n=96 IS WORTH READING HERE: stormhalt has reported
// 16% at n=32, 23% at n=48, 26% and 23% at n=96 and 21% at n=240 on settings
// differing by less than the noise between those samples (all pre-melee-layer).
// The advertised lengths were win medians from the same runs — widowsgate read
// a 16.0m median off an n=48 sample and 9.6m at n=240, so a table tuned on the
// small sample tells the player a region takes half again as long as it does.
//
// ALL OF THAT WAS TAKEN ON THE PRE-MELEE-LAYER ENGINE, and it is now further
// superseded: the campaign re-tune the tier-3/4 sections above describe moved
// every one of `enemyMult`/`develop`/`targetLengthMin` on all three tier-6
// rows (stormhalt's own reasoning is above; cinderwatch and widowsgate took
// the same two moves — a proportionate `enemyMult` cut and a
// `targetLengthMin` raise from a 7-7.5m promise nobody could keep against the
// tier-6 hard-cap floor to 24m). CLAUDE.md ("Still open" -> the campaign
// re-tune, third pass) carries whatever was actually measured after that move
// landed; the percentages above predate it and should not be read as the
// current number for any of the three.
//
// ============================================================================
// FOURTH PASS (in progress) — tiers 3-6 dial moved again, only partly measured.
// ============================================================================
//
// Everything in the tier-3 through tier-6 sections above is PRE-MELEE-LAYER
// provenance and should be read as history, not as today's answer. CLAUDE.md
// ("Still open" -> the campaign re-tune, third pass) carries the current
// numbers and the reasoning for this pass specifically: `develop` cut for
// tiers 4-6 to minimise how far past the level-3 castle threshold those rows
// sit (the castle itself cannot drop to level 2 without violating
// non-decreasing against karrowmere, which is already there with no Marshal
// to make it matter), traced back to a Marshal'd throne that is never
// attacked for a whole battle out-training any single rear site's ability to
// mass a legal first strike. Tier 1-2 are fully re-measured at n=48 and all
// nine rows read `ok`. Tiers 3-6 are a COMPLETE n=24 screen (all fifteen rows
// have a number), which is still only a screen, not the n>=96 this project's
// own house rule requires before trusting a figure near a band edge. Eleven
// of the fifteen still read below their tier's floor. Do not treat any dial
// on those fifteen rows as settled; CLAUDE.md carries the full table and the
// two shapes (a tier-4 split, and widowsgate now reading worse than
// stormhalt) worth a closer look before the next dial move.
