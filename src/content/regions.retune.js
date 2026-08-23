// THE CAMPAIGN'S CURRENT DIALS AND HOW THEY WERE MEASURED — this pass's answer,
// split out of ./regions.provenance.js at the 400-line cap along the seam that
// matters: that file is HOW EACH TIER GOT ITS COLUMNS over the project's life,
// this one is WHAT THE TABLE READS TODAY and what it cost to find out.
//
// NOT IMPORTED BY ANYTHING, DELIBERATELY, exactly like its sibling. Every number
// a battle or a test needs lives on the row in ./regions.data.js. This exists to
// be READ before a dial moves.
//
// PURE PROSE. No logic reads a number that is not defined in regions.data.js
// or balance.js.

// ============================================================================
// TIERS 1-2 (9) — RE-TUNED AGAINST THE MELEE LAYER, at n>=96. This is the
// current answer; everything below it in this section is provenance.
// ============================================================================
//
// The n=12 screen that opened this pass was wrong in BOTH directions, which is
// worth more than the numbers: highmarch read 67% and is 84%, thornmoor 67% and
// is 82% — both within two points of their CEILING. "Fixing" those 67s would
// have pushed two healthy rows through the floor.
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
// ⚠ THE SLOPE CONSTANT DOES NOT WORK. CLAUDE.md's "~1.8 per 0.01 on the small
// maps" predicted -12 for kaldan's first +0.21; it bought ONE. The row has a
// 0.21-wide plateau and then a cliff:
//
//     dial   3.23   3.44   3.60   4.10   4.70
//     win%     92     91     70     30     11
//              0.05   1.31   0.80   0.32     <- local slope, pts per 0.01
//
// Every shipped value above was MEASURED at that value, never interpolated.
//
// Lengths are healthy in both tiers and there is NO ramp: all nine win in
// 8.2-10.2 minutes while advertising 6.5 to 10. That is the `targetLengthMin`
// pass's problem — the column derives `hardCapMs`, so re-authoring it changes
// the battle and every row above would need re-confirming.

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
//     nightharrow  4.94   5.05         -      22-42    monotonicity only
//     stormhalt    4.94   5.60        25      18-36    ok
//     cinderwatch  5.06   5.65        31      18-36    ok
//     widowsgate   5.07   5.70        31      18-36    ok
//
// TIER 6 IS FREE TO RISE (nothing sits above it) so it took a real bracket, not
// a cascade: stormhalt read 50% at 4.94, 25% at 5.60, 6% at 6.20 — slope 0.38.
// `widowsgate` is the incursion arena, but a rung OVERRIDES `enemyMult` with
// INCURSION.baseDial, so the ladder does not inherit this.
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
// ⚠ AND EVERY OTHER LEVER IS MEASURED SPENT: `siteCounts.neutral` SATURATES
// (ironcrown 15/19/23 -> 75/67/71 — worth ~2 a site below the knee, zero above,
// against the "-4 a site" recorded below), `enemyMix` is already near its own
// optimum (4/6/3 -> 71%, 1/2/10 -> 79%, against 2/4/7's 67% — BOTH directions
// easier), and the board does nothing (18x13 read 67%, same as 17x13). At
// identical dial 5.45 blackspire reads 38% and ironcrown 54%, on matched
// columns — so the gap is the GENERATED MAP, not the table. See ROADMAP.md.
//
// ⚠ TIERS 5-6 SIT IN BAND BECAUSE BATTLES RUN OUT OF CLOCK — eight defeats in
// 216 battles, every all-run median on its cap. Full write-up in CLAUDE.md.

