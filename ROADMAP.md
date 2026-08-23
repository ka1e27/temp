# Hex Dominion — what to build next, and why

**This file is the ORDERING. `CLAUDE.md` is the inventory.** Every defect, measurement
and scar lives there under "Still open, and why"; this file says which of them to spend
the next session on and what each one costs. When the two disagree, CLAUDE.md is right —
it is the one maintained in the same commit as the code.

Nothing here is a wish. Every claim is either measured (with the command to re-take it)
or explicitly flagged as an opinion.

---

## ⇒ THE FUN PASS IS CLOSED. THE RE-TUNE IS THE ONLY THING LEFT.

**All eight critic items (C1-C8) are done or struck**, each with its measurement. Six
shipped, one was already shipped and got the guard it lacked (C4), and one was STRUCK on
evidence (C6 — its premise was five minutes of income wearing six figures' clothes).

**⚠ READ THIS BEFORE TRUSTING ANY TIER 3-6 NUMBER IN EITHER FILE.** `--richyards` was
turned ON by default on 2026-08-20, and it moved four rows from 5-14 points BELOW their
floors to 2-14 ABOVE their ceilings (gallowmoor 38 → 75, thanescar 29 → 58, ravensmarch
17 → 54, widowsgate 4 → 50, all n=24). Confirmed independently while closing C5:
gallowmoor at n=12 with this session's two new mechanics switched off reads **83%, TOO
EASY**, against the 38% its own re-tune table below still records. **Every "tiers 3-6 are
too hard" statement in this file and in CLAUDE.md predates that flip.** The re-tune's job
changed shape with it: correcting downward from a competent bot is a dial job, where
correcting upward from an incompetent one was the structural search that ate two sessions.

**What this session added that the next sweep must account for**, each with its own
control flag so the delta stays re-takeable rather than remembered:

| Change | Direction | Flag |
|---|---|---|
| The muster (C7) — one enemy set-piece per battle | HARDER | `--nomuster` |
| The bot's answer to it (C7) | easier, and inert without a muster | `--noanswer` |
| Doctrines (C3) — a player trade, dealt three at a time | measured as a wash, unconfirmed | `--nodoctrine` |
| `--notwist` reaching the campaign at all | **it never did before** | `--notwist` |

That last row is the one to be careful of: `--notwist` was wired only into the
`--frontier` branch, where `campaignTwistPlan` returns null regardless, so **every sweep
taken since C1 shipped ran with the twists on whatever the flag said.** It works now, so
a `--notwist` reading taken after this session is not comparable to one taken before it.

## ⇒⇒ WHERE TO RESUME THE RE-TUNE — READ THIS FIRST

**Measured state of all 24 rows.** Tiers 1-2 are SHIPPED and confirmed; the rest is
screened but not moved.

**THE RE-TUNE IS DONE: 22 OF 24 ROWS IN BAND** (twelve were out). Only ironcrown and
obsidian remain, and their gap is measured to be in the GENERATED MAP rather than in any
authored column — see below. That is a design decision, not a tuning one.

```
tier 1  78-92   riverfen 80   ashford 90   ironwood 92   saltmere 83      SHIPPED  ok
tier 2  66-84   kaldan 70   highmarch 77   greywater 73
                thornmoor 82   emberholt 82                              SHIPPED  ok
tier 3  50-72   gallowmoor 60  sunder 60  vaelstrand 67
                duskfell 71  karrowmere 54                               SHIPPED  ok
tier 4  34-56   thanescar 54   blackspire 54                             SHIPPED  ok
                ironcrown 67   obsidian 67                               STILL OVER
tier 5  22-42   ravensmarch 29  gravenreach 33  nightharrow ~30          SHIPPED  ok
tier 6  18-36   stormhalt 25   cinderwatch 31   widowsgate 31            SHIPPED  ok
```

**The five rows still out, and what is known about each:**

- **ironcrown, obsidian** — ⚠ **A DIAGNOSIS WAS PUBLISHED HERE AND THEN FALSIFIED BY ITS
  OWN EXPERIMENT. Read the correction under the table before the table.** Tier 4's four
  rows are IDENTICAL in every column — 17x13, enemy 14, player 4, mix [2,4,7], gate 0.60,
  develop within 0.06, and even the same two silhouettes — except the dial and `neutral`:

  ```
  region        dial   neutral   slope   win%
  thanescar     4.90      15      0.38     54   ok
  blackspire    4.95      15      0.46     54   ok
  ironcrown     5.00      19      0.24     67   over
  obsidian      5.05      20      0.15     67   over
  ```

  That pattern is monotone and it is a CORRELATION ACROSS FOUR ROWS AT n=24, where the
  standard error is about ten points. It read as "more neutral makes a row easier and
  less responsive", and the direct experiment says the opposite.

  **THE EXPERIMENT: ironcrown's neutral 19 -> 15, dial held at 5.00, n=24 — 67% -> 75%.**
  Cutting the pool made it EASIER, so **more neutral is HARDER**, which is what CLAUDE.md
  said all along. The cross-sectional reading was backwards, and publishing it before
  running the one-line test that checks it was the mistake.

  **What the pooled evidence actually supports is SATURATION.** Everything measured on
  ironcrown, by (neutral, dial):

  ```
  neutral   dial    win%
     15     5.00     75
     19     5.00     67      <- shipped
     19     4.73     71
     23     4.73     71      <- +4 sites bought NOTHING
  ```

  So the pool is worth roughly two points a site between 15 and 19 and **nothing at all
  above 19**. That still closes the lever — ironcrown already sits on the flat part, so
  there is no room to make it harder this way — but it closes it for the opposite reason
  to the one written here first, and it leaves CLAUDE.md's tier-2 sign intact.

  **⇒ AND THE REAL ANSWER IS THAT THE GAP IS NOT IN THE TABLE AT ALL. It is the
  GENERATED LAYOUT, and there is a clean same-dial measurement at n=48 that shows it:**

  ```
  region       dial    n     win%
  blackspire   5.45    48      38
  ironcrown    5.45    48      54     <- SAME dial, 16 points apart, ~2.3 SEM
  ```

  At identical dials, on the same 17x13 board, the same mix [2,4,7], the same enemy and
  player counts, the same gate and the same `choke` silhouette, ironcrown is sixteen
  points easier than blackspire. With neutral then controlled at 15 the gap is 21 points
  the same way. **Every authored column is matched, so what differs is the map** — the
  shape MASK and the site scatter are rolled per region from its own seed, and CLAUDE.md
  already records that a silhouette "re-rolls where the sites land" and is worth up to
  sixteen points. ironcrown's `choke` happens to be kind; blackspire's happens to be cruel.

  **So there is no column left to turn, and that is the finding.** The one knob that
  would move it is `shape` — and this project explicitly forbids using it as a difficulty
  dial ("reaching for a shape BECAUSE a region needs to be harder is forbidden; a shape
  says what the region already claimed"). The honest options are therefore a DESIGN call,
  not a tuning one:

  1. **Accept both rows ~11 points over** and say so — they are the only two, and the
     campaign is 19/24 in band with them.
  2. **Re-author what those regions ARE** (flavour and silhouette together), which is the
     one route the shape rule permits.
  3. **Revisit the shape rule deliberately**, with the cost written down.

  Do NOT spend another dial, neutral site, mix or board column here; all four are
  measured.

  Three other levers are measured dead here and should not be re-spent: the dial (0.24
  and 0.15 pts/0.01, so they need +0.75 and +1.07, which ravensmarch's floor forbids),
  the BOARD (ironcrown at 18x13 read 67%, identical to its 17x13), and `enemyMix`
  was the most promising and is the most decisively dead, because it fails in BOTH
  directions (n=24, dial untouched, against ironcrown's 67% baseline):

  ```
  forts/grounds/farms      win%
  2 / 4 / 7  (shipped)      67
  4 / 6 / 3  military       71    <- EASIER
  1 / 2 / 10 farm-heavy     79    <- EASIER STILL
  ```

  Fewer farms starves the enemy's gold; more farms leaves it rich with only two training
  grounds to spend through — the same conversion failure `--richyards` fixed in the
  harness bot. **The shipped mix is already near its own optimum.** Untried: the BOARD
  (both are 17x13 against ravensmarch's 18x13, so each has one column of room under the
  non-decreasing grid rule) and the AI TIER (`AI_TIERS[3]` moves all four tier-4 rows at
  once — thanescar and blackspire sit at 54% with twenty points of floor beneath them,
  so they can absorb it).
- ~~**stormhalt, cinderwatch, widowsgate**~~ **SHIPPED.** Tier 6 is the one tier free to
  rise (nothing sits above it), so it took a real bracket rather than a cascade:
  stormhalt read 50% at 4.94, **25% at 5.60** and 6% at 6.20 — slope 0.38, with 6.20
  decisively past the band. Its tier-mates went to 5.65 and 5.70 at that slope and both
  landed at 31%. `widowsgate` is the incursion arena, but a rung OVERRIDES `enemyMult`
  with `INCURSION.baseDial` and inherits only `siteCounts`, the board, `castleGateFrac`
  and `targetLengthMin` — none of which moved.

  **⚠ THEY ARE IN BAND AND STILL CLOCK-BOUND.** cinderwatch and widowsgate record ZERO
  losses in 16 apiece at the shipped dial, with all-medians on their caps. The band is
  satisfied; the failure mode is not fixed, and no dial fixes it.

**The measured per-row slopes, for whoever sizes the next move** (points of win rate per
0.01 of dial): karrowmere 0.67, ravensmarch 0.53, gallowmoor 0.47, blackspire 0.46,
kaldan 0.41 (over its cliff), thanescar 0.38, vaelstrand 0.29, sunder 0.26, ironcrown
0.24, duskfell 0.20, obsidian 0.15. **Threefold spread, and adjacent rows differ by
2x** — no constant sizes a move, and kaldan additionally has a 0.21-wide plateau before
its cliff.

**⚠ AND THE HEADLINE IS NOT A WIN RATE. THE BACK HALF BARELY LOSES AT ALL: EIGHT DEFEATS
IN 216 BATTLES.**

```
                   battles   wins   TIMEOUTS   losses
tier 5 (n=48 x3)      144      53       84        7
tier 6 (n=24 x3)       72      35       36        1
                      216      88      120        8   <- 3.7% of all battles
```

cinderwatch, widowsgate and nightharrow record **ZERO losses** across 96 battles between
them, and every single all-median in both tiers sits EXACTLY on its hard cap (30.1/30.4,
32.3/32.3, 34.2/34.2). Twelve of widowsgate's twenty-four runs end with the player AHEAD
on territory when the clock stops.

So `WIN_BAND` on these rows is not measuring "how often does the player win" — it is
measuring "how often does the battle FINISH", and this is that finding stated over the
whole back half rather than one row. **Before spending another dial on tiers 5-6, decide
whether those regions should be able to beat the player at all, and if so, with what.**
The dial is not it: thanescar's bracket converted six timeouts into four losses while
holding the win rate flat.

**Tier 6 is the same clock story as tier 5**: stormhalt's all-median is 30.1m against a
30.4m cap and cinderwatch's is 32.3m against 32.3m — both pinned to the wall, cinderwatch
with **zero losses in 24**. Tier 6 is the one tier free to rise as far as it likes
(nothing sits above it), so it is the easiest to move and the least informative to move,
for the same reason: the dial there buys failure mode, not win rate.

**THE THREE THINGS THAT CONSTRAIN EVERY REMAINING MOVE.**

1. **Tier 5 is already in band, so it caps how far tiers 3-4 can be pushed.**
   `enemyMult` is non-decreasing, and tier 5 sits at 4.80-4.94. Any tier-4 value above
   roughly 5.1-5.2 drags ravensmarch down through its floor. **Aim tiers 3-4 at their
   CEILING, never mid-band.**
2. **The slope varies 3x WITHIN a tier** (0.15 on obsidian to 0.47 on gallowmoor), so no
   constant sizes a move. Bracket the row, bisect, and ship only measured values.
3. **obsidian and ironcrown cannot be fixed by the dial at all** — at 0.15 and 0.24
   pts/0.01 they need +1.07 and +0.75, which breaks tier 5 by construction. They need
   `siteCounts.neutral` (~-4 points a site, measured on ironcrown), and that is bounded
   by the non-decreasing TOTAL: ironcrown 37, obsidian 38, ravensmarch 38, so obsidian
   cannot grow until ravensmarch does.

**THE NEXT THREE ACTIONS, in order.**

1. ~~Measure ravensmarch's slope.~~ **DONE, and it settles the ceiling.** n=24:
   **4.80 -> 42%, 5.20 -> 21% (TOO HARD, floor 22)** — slope 0.53, the steepest row
   measured in this pass. ravensmarch therefore cannot exceed about **5.15**, and with
   n=24's ~10-point SEM the safe working ceiling is **5.05**. Since `enemyMult` is
   non-decreasing, **that is tier 4's ceiling too**, and at 5.05 ironcrown and obsidian
   are predicted at 63% and 65% against a 56 ceiling. **Their unfixability by the dial is
   now measured rather than inferred.**
2. **Then author tiers 3-4 as one curve** against that ceiling, using the per-row slopes
   already measured (gallowmoor 0.47, sunder 0.26, vaelstrand 0.29, thanescar 0.38,
   blackspire 0.46, ironcrown 0.24, obsidian 0.15). Expect two or three rows to miss and
   need bisecting; expect ironcrown and obsidian to need the neutral lever.
3. ~~Then re-author `targetLengthMin`~~ **DONE, AND `battlelength` PASSES 4/4** — it was
   the last failing test in the fast suite. Tier 3 went from promising 19-20 minutes for
   a 12.7-18.0 minute battle to 15 / 18 / 13 / 14.5 / 16, authored from its measured win
   medians, and gallowmoor's hard cap fell from **38 minutes to 28.5**. cinderwatch moved
   17 -> 18.5 for a second reason: the test compares tier MAXIMA and tier 3's max (sunder,
   18.0) would otherwise have TIED tier 6's; rounding cinderwatch's 18.4 median up breaks
   that honestly where shading sunder down would not.

   Tiers 1-2, 4 and 5 were deliberately left alone — their promises sit within about a
   minute of measured, and moving them changes caps on rows just shipped for no gain.

   **⚠ THE SIX MOVED ROWS ARE PLAYING AGAINST NEW CLOCKS AND ARE BEING RE-SWEPT.**
   `targetLengthMin` derives `hardCapMs`, so their measured 60/60/67/71/54/31 will move;
   vaelstrand is the one to watch, at a 22.9m all-run median against a new 24.7m cap. If
   a row falls out, the fix is its dial, not its promise — the promise is now the honest
   number.

   The dataset that fed this, for reference — win medians at the shipped dials — win median against what the row
   currently promises:

   ```
   gallowmoor  14.7 / 20     thanescar   11.6 / 16     ravensmarch 16.4 / 16
   sunder      18.0 / 20     blackspire  11.9 / 16     gravenreach 11.9 / 17
   vaelstrand  12.7 / 20     ironcrown   14.3 / 16     nightharrow ~18  / 18
   duskfell    14.4 / 19     obsidian    10.8 / 16     stormhalt   20.3 / 16
   karrowmere  16.2 / 19                               cinderwatch 17.8 / 17
                                                       widowsgate  12.5 / 18
   ```

   **⇒ ITS BLOCKER IS NOW CLEARED — tier 6 is shipped, so it can hold the strict
   maximum.** Win medians AT THE SHIPPED DIALS, against what each row promises:

   ```
   tier 1   8.9 / 8.8 / 8.6 / 8.4        v 9.5 / 10 / 9.5 / 7.5    roughly honest
   tier 2   9.5 / 9.6 / 8.8 / 8.8 / 9.4  v 8.5 / 9 / 8 / 6.5 / 8   thornmoor +35%
   tier 3  14.7 / 18.0 / 12.7 / 14.4 / 16.2  v 20 / 20 / 20 / 19 / 19   BIG overclaim
   tier 4  11.9 / 13.6 / ? / ?           v 16 each                 overclaim
   tier 5  16.4 / 11.9 / ?               v 16 / 17 / 18            roughly honest
   tier 6  16.1 / 18.4 / 15.0            v 16 / 17 / 18            roughly honest
   ```

   **Tier 3 is the whole defect** — it promises 19-20 for a 12.7-18.0 minute battle.
   And there is one arithmetic trap in making the test pass: it compares tier MAXIMA, so
   tier 3's max (sunder, 18.0 -> 18) must not TIE tier 6's. Rounding cinderwatch's 18.4
   up to 19 breaks the tie honestly; shading sunder down to 17 would not.

   **⚠ AND IT CHANGES THE BATTLES IT DESCRIBES, so it is not a free edit.** The column
   derives `hardCapMs`: gallowmoor's cap falls from `max(17, 20 x 1.9)` = 38 minutes to
   `max(17, 15 x 1.9)` = 28.5, and its all-run median is 24.4m — so some slower wins
   become timeouts and the 60% just shipped will move. **Budget a re-confirmation sweep
   of tiers 3-4 as part of this item, not as an optional extra**, and do not start it
   without the time to finish that sweep — a half-authored length column leaves the
   whole table unverified.

**VERIFIED AFTER SHIPPING TIERS 1-5:** 130 test files, **1,332 of 1,333 tests pass**. The
single failure is `battlelength`'s tier-3 bulge — item #108 above, deferred on purpose.
`npm run check` clean, and `tools/smoke.mjs` passes all 24 steps in a real browser against
the shipped table.

**AND ONE THING THAT IS NOT A DIAL PROBLEM AT ALL.** Tier 5 is in band because battles
run out of CLOCK, not because the enemy wins: every all-median sits exactly on the hard
cap and **nightharrow takes zero losses in 48 battles**, timing out 31 times with the
player ahead in 24 of them. stormhalt is the same shape (all-median 30.1m against a
30.4m cap). Tuning those rows on `enemyMult` moves who-beats-you, not how-often — see
thanescar's bracket, where 5.00 to 5.50 held the win rate flat while converting six
timeouts into four losses. **Decide what those rows should DO before tuning them.**

---

## ⇒ THIS SESSION: `campaignplay` DIAGNOSED AND FIXED, TIER 1 CONFIRMED AT n=96

**`campaignplay` was never indeterminate-because-loaded. It was 1,056 battles with no
short-circuit**, and the entry below calling it INDETERMINATE is superseded. Measured on
an IDLE box (load 0.19), one battle through its own `playOnce`: riverfen 0.4s, duskfell
2.1s, **widowsgate 132.8s** — the last going the full 20,520-tick cap at 6.5ms a tick.
Test 1 played 24 seeds a region unconditionally for an assertion that is a FLOOR
(`wins > 0`), so every seed after the first win could not change the outcome.

Fixed (`wonWithin`), with equivalence PROVEN over 200,000 synthetic win/loss patterns
rather than argued — same verdict, same `attempted` count, **zero mismatches, 81.8% of
test 1's battles saved**. The saving is a curve (96% at a healthy win rate, 0% on a
region that is never won), so it cannot hide a broken region by sampling it less.

**And a declared `{ timeout: N }` does nothing on a synchronous test body** — proven with
a test that declares 100ms, spins for two seconds and passes. All five in `tests/` are on
synchronous bodies, so none of them bounds anything; only an OS-level `timeout` does.

**TIER 1 CONFIRMED AT n=96, and the censoring warning below was right to insist on it:**

```
region      n=12   n=96   band     verdict
riverfen      83     80   78-92    ok
ashford      100     94   78-92    2 over the ceiling
ironwood     100     92   78-92    ok, exactly ON the ceiling
saltmere      83     83   78-92    ok
```

Both censored rows came back at or near band — **n=12 overstated how easy tier 1 is**, so
a dial moved from that table would have over-corrected. Confirmed at n=240, which agrees
with n=96 to within 1-3 points on every row (so n=96 is a trustworthy instrument here):

```
region      n=12   n=96  n=240   band     verdict at n=240
riverfen      83     80     83   78-92    ok
ashford      100     94     95   78-92    +3 over  <- the only real miss
ironwood     100     92     93   78-92    +1 over, inside n=240's own 1.6pt SEM
saltmere      83     83     82   78-92    ok
```

**TIER 2 AT n=96 IS THE SHARPER LESSON, because n=12 was wrong in BOTH directions:**

```
region      n=12   n=96   band     verdict
kaldan       100     92   66-84    +8 over   (censored, as predicted)
highmarch     67     84   66-84    ok        <- n=12 was SEVENTEEN POINTS LOW
greywater     75     86   66-84    +2 over
thornmoor     67     82   66-84    ok        <- n=12 was FIFTEEN POINTS LOW
emberholt     92     90   66-84    +6 over
```

So the n=12 screen was not merely censored at the top — it was noisy throughout, exactly
as the ±10-point SEM warning says. **Two rows it reported as comfortably in band are
within 2 points of their ceiling**, and a dial moved to "fix" the 67s would have pushed
two healthy rows straight through the floor. The whole tier is bunched at 82-92 against a
66-84 band: it is one uniformly-easy tier, not three bad rows. Battle lengths are healthy
there (all-median 9.1-9.5m against win-median 8.7-9.3m), so none of tier 2 is clock-bound.

**AND THE BACK HALF'S SHAPE IS STRUCTURAL, not fifteen independent rows.** Read off real
`buildBattleConfig` output, the player's landing power over the enemy's standing power:

```
region        0      8      9     14     18     23
P/E        0.20   0.90   1.59   1.87   1.84   2.42
```

The player crosses parity at region 9 — where `EXPEDITION.surgeAfter: 8` fires and bodies
jump 105 → 243 — and by tier 6 lands with **2.4x** the enemy's standing power, on a dial
that rises only 4.01 → 5.07 across those fifteen regions. This is a STANDING property of
the table rather than a regression: it was previously masked by a bot that could not
spend its own gold, and `--richyards` unmasked it. It is the reason the back half reads
uniformly easy instead of row by row, and it says the lever is the expedition curve or
the enemy's scaling, not fifteen separate `enemyMult` edits.

### The method for the remaining rows, and the commands in flight

**BRACKET, THEN BISECT — never slope-scale.** Every unfixed row sits at 82-95% on the
sigmoid's HIGH SHOULDER, which is exactly where CLAUDE.md records `enemyMult` moving
+0.30 and thanescar not moving at all. A per-row correction sized off a campaign-wide
slope constant is what ate two earlier sessions.

Probing is done in a **detached worktree**, never against the live table, because four
sweeps run in parallel here and a balance-sensitive job started after an edit would
measure somebody's in-flight probe:

```bash
git worktree add --detach /tmp/probe HEAD
# patch one region's enemyMult in /tmp/probe/src/content/regions.data.js, then:
(cd /tmp/probe && node tools/simrunner.js --region=kaldan --n=96)
```

The control point must reproduce the main tree before any probe reading is trusted —
kaldan at its shipped 3.23 read 92% in both, which is what licensed the rest.

**⚠ TWO OPERATIONAL RULES FOR THESE SWEEPS, both learned the expensive way here.**

**Never pipe a long sweep through `tail`.** `simrunner` prints its table at the end, so
`... | tail -20` buffers everything: a job killed by its own `timeout` produces
**nothing at all**, and two hours of CPU is simply lost. Let it stream.

**And an out-of-band campaign is EXPENSIVE TO MEASURE, which is a feedback loop worth
knowing about.** A tuned row resolves its battles; an untuned one runs every seed to the
hard cap, and gallowmoor's cap is 38 minutes of game time. Tier 3 at n=96 (480 battles)
burned over two CPU-hours here and still had not landed. **Screen at n=48 first** — the
SEM there is ~7 points, which is ample to tell an 83% row from a 72% ceiling, and it is
half the price. Save n>=96 for confirming a row you are about to ship.

**IN FLIGHT AS OF THIS WRITING** (re-run any that did not land):

```bash
node tools/simrunner.js --region=gallowmoor,sunder,vaelstrand,duskfell,karrowmere --n=48
node tools/simrunner.js --region=ravensmarch,gravenreach,nightharrow --n=48
node --test tests/campaignplay.test.js          # first run since the short-circuit
# tier-4 candidate: thanescar 5.20 / blackspire 5.45 / ironcrown 5.45 / obsidian 5.50
```

**THANESCAR IS BRACKETED AND THE RESULT IS A WARNING, not a value.** n=48:

```
dial      4.60    5.00    5.20    5.50
win%        63      44      40      48
timeouts     -      23      22      17
losses       -       4       7       8
all-med      -   28.1m   27.5m   22.4m
```

Anything from 5.00 to 5.50 reads `ok`. But the win rate is FLAT across that range within
noise, and what actually moves is the failure mode — timeouts down, losses up. **The dial
on this row buys who-beats-you, not how-often.** Pick the value for the outcome
breakdown, not the percentage, and record which one you bought.

**STILL UNTAKEN:** tiers 5 and 6. At ~100-133s a battle, n=96 is ~3.5 HOURS PER ROW and
is not affordable here; take them at n=24-48 and label them a screen. They already read
50-58% at n=12 against ceilings of 36-42, which is >2 SEM even at n=24, so the direction
is not in doubt — what is missing is the step size, and that wants a bracket on ONE row
(stormhalt) rather than a sweep of all six.

**THE PLANNED MOVES, all feasible within the non-decreasing constraint** — sizes pending
the bracket, and note that three rows must NOT move because they are already in band:

```
ashford   2.70 -> ?   (-3)        ironwood 3.19, saltmere 3.19  HOLD
kaldan    3.23 -> ?   (-8)        highmarch 3.39                HOLD (at its ceiling)
greywater 3.39 -> ?   (-2)        thornmoor 3.56                HOLD
emberholt 3.67 -> ?   (-6)        gallowmoor 4.01 sits above it
```

---

**A STALENESS AUDIT OF CLAUDE.md's "Still open" FOUND THREE IN EIGHT WRONG** — the
garrison seam (validated all along), the install affordance (built, wired, smoke-tested)
and the bot's farm-building (attempted, measured at -25 and -12, rejected with the
mechanism recorded). All three are now closed in place. Five others were checked and
hold. **Check a "still open" claim against the code before spending a session on it.**

---

### ⚠ THE COMPUTED TABLE BELOW IS FALSIFIED: THE SLOPE VARIES 3x WITHIN ONE TIER

Measured, n=48, each row moved from its shipped dial to the candidate:

```
region        dial          win%      slope     verdict at the candidate
thanescar   4.60 -> 5.20   63 -> 40    0.38     ok
blackspire  4.73 -> 5.45   71 -> 38    0.46     ok
ironcrown   4.73 -> 5.45   71 -> 54    0.24     ok, barely
obsidian    4.78 -> 5.50   69 -> 58    0.15     STILL TOO EASY
gallowmoor  4.01 -> 4.39   78 -> 60    0.47     ok
sunder      4.08 -> 4.39   68 -> 60    0.26     ok
```

**0.15 to 0.47 — and the two shallowest rows are adjacent to the two steepest.** The
table below assumed a uniform 0.47 and is therefore wrong for ironcrown and obsidian; do
not ship it as computed. This is the third independent demonstration in this pass that a
slope constant cannot size a per-row move (kaldan's plateau and thanescar's flat shoulder
being the first two), and it is the most decisive, because here the variation is *within
a single tier measured in a single run*.

**AND IT MAKES OBSIDIAN UNFIXABLE BY THE DIAL, which is a structural finding rather than
a tuning problem.** At 0.15 pts/0.01 obsidian needs about **+1.07** to reach 53% — dial
5.85 — and `enemyMult` is non-decreasing, so that forces ravensmarch from 4.80 past 5.85
and takes a row currently at 42% to somewhere near zero. ironcrown at 0.24 is the same
problem one step smaller. **Tier 4's last two rows have to be moved by something other
than the dial**, and the candidate is `siteCounts.neutral`, which CLAUDE.md measured on
ironcrown itself at roughly -4 points per site (15 -> 19 moved it 58% -> 42%).

The neutral lever is bounded by the non-decreasing TOTAL, and the chain is tight:
ironcrown is 37 against obsidian's 38, and obsidian's 38 equals ravensmarch's, so
obsidian cannot grow unless ravensmarch does first. ravensmarch is AT its ceiling (42%
in a 22-42 band) and more neutral makes a row harder, so growing it is safe — but that
is three coupled unverified estimates and wants measuring, not assuming.

This is the same shape as the already-recorded tier-2 contradiction: *"the dial tier 2
needed overtook the dial tier 3 wanted, and enemyMult is required non-decreasing, so that
is a contradiction rather than a tuning problem."* It was resolved there by a site-count
change, and that is where this should start too.

---

### ⇒ THE CANDIDATE TABLE FOR TIERS 3-5 (SUPERSEDED — see above; kept for its method)

**The slope is now measured on two rows at two tiers and it agrees: ~0.47 pts/0.01.**
gallowmoor 4.01 -> 4.39 read 78% -> 60% (0.47); thanescar 4.60 -> 5.00 read 63% -> 44%
(0.48). That is enough to size a table, PROVIDED every value is re-measured before it
ships — kaldan's plateau is why.

Solving for the **smallest monotone dial that puts every row 3 points inside its own
ceiling** (aiming at the ceiling, not mid-band, is what keeps the cascade survivable for
tier 5):

```
region        from     to   predicted   band     margin
gallowmoor    4.01   4.20      69       50-72     +3
sunder        4.08   4.20      62       50-72    +10
vaelstrand    4.38   4.57      69       50-72     +3
duskfell      4.45   4.66      69       50-72     +3
karrowmere    4.58   4.66      68       50-72     +4
thanescar     4.60   4.81      53       34-56     +3
blackspire    4.73   5.11      53       34-56     +3
ironcrown     4.73   5.11      53       34-56     +3
obsidian      4.78   5.12      53       34-56     +3
ravensmarch   4.80   5.12      27       22-42     +5
gravenreach   4.93   5.12      24       22-42     +2   <- the tightest row
nightharrow   4.94   5.12      27       22-42     +5
```

**Every row lands in band, so `enemyMult` alone IS sufficient** — the neutral-pool and
`develop` levers are not needed here, which is worth knowing because both are bounded by
the non-decreasing TOTAL-sites rule and obsidian in particular has no neutral room at all
(its 38 equals ravensmarch's).

**Three caveats, and the first is the one that will bite.** The predictions assume a
uniform 0.47 slope, and rows have PLATEAUS — kaldan moved one point across a 0.21 step
before falling twenty-one across the next. Expect one or two rows to miss and need
bisecting. **gravenreach has only two points of margin** above its floor, so if tier 4
lands harder than predicted, ease tier 4 rather than tier 5. And tier 6 is excluded
because it was still being screened when this was computed; it sits above all of this
and can move freely, so it does not constrain the rows here.

---

### ⚠ TIER 5 IS ALREADY IN BAND, AND THAT BREAKS THE PLAN ABOVE

```
region       win%  band    all-med   cap    wins  timeouts(ahead)  losses
ravensmarch    42  22-42    30.4m   30.4     20     25 (16)          3
gravenreach    33  22-42    32.3m   32.3     16     28 (23)          4
nightharrow    35  22-42    34.2m   34.2     17     31 (24)          0
```

All three read `ok`, so **"the whole back half is too easy" was wrong** — it is tiers 3
and 4 that are out, not 3 through 6. That assumption came from an n=12 screen and is
now retired.

**BUT THEY ARE IN BAND FOR THE WRONG REASON.** Every all-median sits EXACTLY on the hard
cap, and **nightharrow records zero losses in forty-eight battles** — 31 timeouts, 24 of
them with the player AHEAD on territory. This tier is not a fight the enemy wins 65% of
the time; it is a fight that runs out of clock 65% of the time. That is this file's own
"`WIN_BAND` measures what fraction FINISHES" finding, in the one tier where it is total.

**AND `enemyMult` MUST BE NON-DECREASING, SO THIS BOUNDS TIERS 3-4 FROM ABOVE.** The
candidate now in flight (tier 3 to 4.39-4.85, tier 4 to 5.20-5.50) would force
ravensmarch from 4.80 to >= 5.50 — about -31 points on a row currently at 42%, i.e.
**11%, far under its 22 floor.** Aiming tiers 3-4 at MID-band breaks tier 5.

**THE RESOLUTION IS TO AIM AT THE CEILING, NOT THE MIDDLE.** Tiers 3-4 are 6-15 points
over, not 20-30:

```
              now   ceiling   needs        proposed dial   cascade
gallowmoor     78      72      -8          4.01 -> ~4.19
sunder         68      72       0 (rises with gallowmoor)  4.08 -> ~4.19
vaelstrand     78      72      -8          4.38 -> ~4.56
duskfell       79      72      -9          4.45 -> ~4.65
karrowmere     72      72      -4          4.58 -> ~4.67
thanescar      63      56      -19         4.60 -> ~5.00
blackspire     71      56      -15         4.73 -> ~5.00
ironcrown      71      56      -15         4.73 -> ~5.00
obsidian       69      56      -13         4.78 -> ~5.00
ravensmarch    42      42       0          4.80 -> 5.00  (-9, lands ~33, still ok)
gravenreach    33      42       0          4.93 -> 5.00  (-3, lands ~30, still ok)
nightharrow    35      42       0          4.94 -> 5.00  (-3, lands ~32, still ok)
```

Tier 5 ABSORBS a cascade to 5.00 and stays in band; it cannot absorb 5.50. **The two
in-flight candidates are therefore too aggressive and will not ship as measured** — but
they are not wasted, because what they buy is the SLOPE at tiers 3 and 4, which is the
one number needed to size the gentler table above.

---

### TIER 3 AT n=96 — and it hands #108 its numbers

```
region        win%   band     win-med   ADVERTISED
gallowmoor      78   50-72     14.2m       20m     TOO EASY
sunder          68   50-72     13.6m       20m     ok
vaelstrand      78   50-72     12.8m       20m     TOO EASY
duskfell        79   50-72     12.0m       19m     TOO EASY
karrowmere      72   50-72     15.5m       19m     ok, exactly at the ceiling
```

**THE REAL LENGTH RAMP EXISTS AND THE ADVERTISED ONE IS FICTION.** Measured win medians
by tier, against what each tier promises:

```
tier    measured win-med    advertised
  1        8.4 - 8.8         7.5 - 10
  2        8.8 - 10.2        6.5 - 9
  3       12.0 - 15.5         19 - 20      <- promises 19-20, plays 12-15.5
  4       12.6 - 16.7           16
```

So the game DOES get longer — about 8.6 to 9.4 to 13.6 to 14 minutes — and the promise
column simply does not track it. Authoring tier 3 at ~14 puts it BELOW tier 4's 16 and
**fixes the inverted ramp `battlelength.test.js` fails on**, in one column, with no
difficulty change. It also drops gallowmoor's hard cap from `max(17, 20 x 1.9)` = **38
minutes** to `max(17, 14 x 1.9)` = 26.6.

**⚠ BUT IT MUST LAND AFTER THE DIALS, NOT BEFORE.** Raising a dial makes a battle
LONGER, so a length authored from today's medians would be stale the moment tier 3-6
moves. Order: dials, re-measure, then author `targetLengthMin` from the new win medians,
then re-confirm — because the column derives `hardCapMs` and so changes the battle it
describes.

---

### TIER 4 SCREENED AT n=48 — all four over, and the back half needs a STEEPER RAMP

```
region       n=12   n=48   band     win-med / advertised
thanescar      42     63   34-56    13.2m / 16m
blackspire     75     71   34-56    16.7m / 16m
ironcrown      75     71   34-56    13.2m / 16m
obsidian       75     69   34-56    12.6m / 16m
```

Seven to fifteen points over the ceiling, needing roughly **-20 points each** to reach
mid-band. Two useful cross-checks: today's thanescar reads 63% at dial 4.60 against the
**65% CLAUDE.md already records at that exact dial**, so the bracket in that file
(4.60 → 65%, 4.90 → 65% SHOULDER, 5.20 → 40%) is probably still live and says this row
wants roughly 5.20. And tier 4's advertised 16 minutes is roughly honest against
12.6-16.7m measured — unlike tier 3's 19-20.

**MONOTONICITY COUPLES THE WHOLE BACK HALF, so these cannot be authored row by row.**
Tier 4 at ~5.2-5.4 forces tier 5 above it, and tier 5 needs its own ~-20; tier 6 the
same again. The dial currently spans 4.01 → 5.07 across regions 9-23 (+1.06) and would
need roughly 4.2 → 6.3 (+2.1) — **doubling the back-half ramp.**

That is the same conclusion the P/E measurement reached from the other direction: the
player's landing power doubles across those fifteen regions while the dial rises 26%. A
structural finding and an empirical one agreeing is the strongest signal this pass has
produced, and it says the back half was never a set of fifteen independent mis-tunes.

---

### The deploy gate was mis-attributed, and the real one is already fixed here

**Checked against the workflow runs, not inferred.** Both files say the Pages deploy is
gated on `campaignplay` being red. The last run on `main` (2026-08-13, `df05b2cd`) says
otherwise:

```
verify   SUCCESS   npm test 10m49s, then npm run check
browser  FAILURE   SMOKE FAILED: build did not land at [7,0]: null   (15s in)
deploy   skipped
```

The unit suite PASSES in CI — `campaignplay` included, inside eleven minutes, on a commit
titled "24 of 24 in band". So that file's cost AND its redness are both functions of how
well-tuned the table is: a tuned campaign resolves its battles, an out-of-band one runs
every seed to the hard cap. It is behaving exactly as an acceptance test should.

**The real blocker was `smoke.mjs`'s build step, and it does not reproduce here** — driven
against the current tree, all 24 steps pass (`build: armed Farm, clicked [0,0],
buildTicksLeft=242`). **But the workflow triggers only on `main`, so nothing on this
branch has ever been through CI.** Before claiming the deploy is unblocked, it has to
actually run.

---

**VERIFICATION, STATED HONESTLY.** 135/135 test files ran. `battlelength` is the
inherited tier-3-advertises-20-minutes failure the re-tune owns. **`scout` now PASSES
3/3** where CLAUDE.md records it red, most likely the same `--richyards` flip. Of the other four,
**`tactics` and `loadoutdominance` are genuinely RED with the inherited failures** — but
only visible at a 2400s budget, because at 900s each printed `TAP version 13` and nothing
else. Their real durations are 1,032s and 1,795s. `harness` and `campaignplay` remain
**INDETERMINATE, not red**, never having completed a test here.

`loadoutdominance`'s refusal is itself the most useful number this session produced about
the table: it will not report a loadout gap off an out-of-band baseline, and it names
`kaldan 100% (band 66-84)` and `gallowmoor 75% (band 50-72)`. A third independent
confirmation that tiers 2-3 now read too EASY. Browser smoke PASSED including the new doctrine step, and the
phone audit is clean except one unexplained finding recorded above.

**Neither C5 nor C6 can move a win rate.** C5 pays a timeout that was led and leaves
`result` alone, and every measured number is `status === 'win'`; C6 changed no code.

---

## ⇒ CLOSED: the phone audit's last complaint was the box, not the layout

`npm run mobile` step 6 reported `button.train-chip "MIL" 26.4x26.4` — two tap targets
at 60% of the 44px minimum. **It does not reproduce on an idle machine: the whole audit
now reports "No layout problems found."** Every part of it was a load artefact, and the
diagnosis took three passes because two of the three suspects were real bugs in the tool
that had to be fixed before the third became visible:

1. The tool printed `Math.round`, so a 43.55px button read as "44" under the words
   "under 44px" and every finding looked like a tool bug. One decimal now.
2. The shop step audited straight off the click while every other step slept, catching
   `hd-rise` mid-flight. It waits now, and the audit emulates `prefers-reduced-motion`.
3. What was left was the training fan, and a probe of step 6 at the exact audit moment
   shows the fan OPEN with both chips at `--sc: 1` and a full **44px** — the screenshot
   the audit takes agrees. So the layout was never wrong; at load ~20 the 500ms wait was
   not enough for the chips to finish scaling from `--sc: 0.6`.

**The lesson is the session's most repeated one, arriving in a fourth place**: a loaded
box does not report as slow, it reports as broken, and in a different vocabulary each
time — a truncated TAP stream, a boot that "could not reach a battle", a bare
`TAP version 13`, and here a tap target that is the wrong size.

---

## ⇒ THE RE-TUNE'S STARTING STATE, MEASURED: 14 TOO EASY, 10 ok, ZERO too hard

The first complete screen of the campaign since `--richyards` was defaulted on.
`node tools/simrunner.js --all --n=12`, every row, one run:

```
tier 1   riverfen    83 ok       ashford    100 EASY   ironwood  100 EASY   saltmere 83 ok
tier 2   kaldan     100 EASY     highmarch   67 ok     greywater  75 ok
         thornmoor   67 ok       emberholt   92 EASY
tier 3   gallowmoor  67 ok       sunder      67 ok     vaelstrand 83 EASY
         duskfell    83 EASY     karrowmere  83 EASY
tier 4   thanescar   42 ok       blackspire  75 EASY   ironcrown  75 EASY   obsidian 75 EASY
tier 5   ravensmarch 25 ok       gravenreach 50 EASY   nightharrow 33 ok
tier 6   stormhalt   58 EASY     cinderwatch 50 EASY   widowsgate  50 EASY
```

**This is the complete reversal of the state above**, which recorded eleven of fifteen
tier 3-6 rows BELOW their floors. Not one row now reads too hard, and none reads TOO
SLOW either. Everything under this heading that describes tiers 3-6 as too hard is
provenance, not today's number.

**⚠ THE FOUR ROWS AT 100% ARE CENSORED AND MUST NOT BE TUNED FROM THIS TABLE.** At
n=12, `12/12` has a 95% lower bound of **74%** — which does not even establish that a
tier-1 row is above its own FLOOR of 78, let alone over its 92 ceiling. They are
candidates, not findings. The uncensored rows (83/75/50) carry real signal; the 100s
carry none beyond "look here". Re-take at n>=96 before a dial moves for them.

**AND TWO "ok" ROWS ARE ok FOR THE WRONG REASON.** `thanescar` reads 42% in band with
an all-run median of **30.4m against a 16m advertised length**, and `ravensmarch` 25%
with the same 30.4m; `nightharrow` is 34.2m against 18m, `widowsgate` 34.2m against 18m.
Those rows are pinned at their hard cap, so the band is measuring what fraction FINISHES
rather than what fraction is won — which is the finding this file already carries about
`WIN_BAND` generally, now visible in a single table. A dial will not fix a row whose
problem is the clock.

**The honest order of work from here**: confirm the censored rows at n>=96; treat the
uncensored TOO EASY rows as the real dial work; and handle the four clock-bound rows as
a length question rather than a difficulty one. `enemyMult` is required non-decreasing,
so any move has to be planned across the whole table rather than row by row.

---

## ⇒ THE RE-TUNE: two levers measured, one confirmed and one killed

**STATE for item #70.** This is the resume point for the campaign re-tune; the detailed
history is further down under "Do this first".

**`siteCounts.neutral` IS NOT THE LEVER, AND THE CORRELATION THAT SAID IT WAS IS
CONFOUNDED.** Reading the tier 3-6 rows against the last sweep's win rates shows a clean
monotonic pattern at tier 4 — same mix, same board, and the neutral pool tracking the win
rate even against a HIGHER dial:

```
region        dial  develop  neutral  total   win%
thanescar     4.55    2.10      15      33     29
blackspire    4.55    2.12      15      33     29
ironcrown     4.60    2.14      19      37     38
obsidian      4.60    2.16      20      38     42
```

and the same shape at tier 5 (ravensmarch 18 → 17%, gravenreach 22 → 42%, on an identical
dial). That is a ~6-points-per-site slope, which would have been the cheapest lever in the
table.

**Measured directly on thanescar, in a detached worktree, n=16 matched seeds:**

```
neutral   15    19    23
win%      25    25    19
```

Flat, then worse. **So whatever makes ironcrown and obsidian easier than thanescar, it is
not their neutral pool** — and a correlation across four rows that differ in five columns
is not a lever. Verified the change reaches the board rather than trusting the edit (15 →
15 neutral sites, 23 → 23), because "the weights stopped reaching the battle" is this
project's signature failure and would look exactly like a flat result.

Two things follow. The tier-4 split recorded as an open question is still open — the cause
is one of the other columns, or noise at n=24. And **`siteCounts.neutral` should be struck
from the recommended lever list** for tiers 3-6; the previous session's "reach for
`siteCounts.neutral`" advice is now measured and wrong at this end of the campaign. (It is
a real lever at tier 2, where `regions.provenance.js` records greywater moving 66% → 54%
on 7 → 9 neutral. The sign genuinely differs by tier, which is worth knowing and is not
what either note assumed.)

**`--richyards` WAS THE LEVER, IT IS FLIPPED ON, AND THE CAMPAIGN INVERTED.** Measured at
n=24 across four rows spanning tiers 3-6 (the recorded figure was n=8 and overstated it at
+62, exactly as this project's own sample-size rule predicts):

```
region        band     off    on     delta
gallowmoor   50-72     38%    75%     +37
thanescar    34-56     29%    58%     +29
ravensmarch  22-42     17%    54%     +37
widowsgate   18-36      4%    50%     +46
```

Flipped ON. A full 24-region sweep then read **nineteen of twenty-four rows TOO EASY and
not one below its floor**, where the previous sweep had eleven of fifteen below. Nineteen
dials were raised against that, sized off each row's overshoot and made non-decreasing by
running maximum.

**⚠ AND THE CONFIRMING SWEEP IS WHERE THIS PASS STOPS BEING TRUSTWORTHY, WHICH IS THE
MOST IMPORTANT THING ON THIS PAGE.** Re-swept at the same n=24, six rows moved the WRONG
WAY and the implied slopes ranged from +4.25 to −2.00 points per 0.01. That is noise: the
standard error at n=24 near 50% is ~10 points, so a +0.05 move predicting −5 is invisible.
Confirmed directly — thanescar re-taken at **n=48 on an unchanged dial read 65% against
the 58% the n=24 sweep had just reported**.

So: **the direction of the dial pass is sound and every individual size in it is a
guess.** Nineteen of twenty-four rows on one side of their bands is far beyond noise; no
single row's correction is. The table is still too easy, so the error is an undershoot,
which is the safe direction.

**WHAT THE NEXT SESSION MUST DO, in order.**

0. **⚠ THE GATE THE WHOLE RE-TUNE IS AIMED AT IS MEASURING THE WRONG THING. 93% OF
   EVERY NON-WIN IN THE CAMPAIGN IS A TIMEOUT, NOT A DEFEAT.** Counted off the full
   24-region sweep this pass already took (n=24 a row, 576 battles): **401 wins, 12
   defeats, 163 timeouts** — and 102 of those timeouts end AHEAD on territory. Eleven of
   the twenty-four rows record zero defeats. So `WIN_BAND` is not a difficulty gate, it
   is a DURATION gate wearing one's clothes, and "tune this row to 45%" currently means
   "make 45% of attempts finish before the clock". Being beaten and running out of time
   are not the same promise to a player, and this file already records the second one
   reading as the game being broken. **Answer this before another dial moves:** should a
   region be able to beat the player at all, and if so, what does it? **Defeat IS
   available and was measured rather than assumed** — thanescar at n=32 reads 0 losses at
   the shipped 4.60, 1 at 5.20, and **11 at 8.50**. So this is a choice the dial is
   making by accident, not a limit of the engine. Full write-up and the caveats in
   CLAUDE.md.
0b. **TAKE THE OUTCOME SIGNATURE BEFORE TOUCHING A DIAL.** thanescar at n=32: dial 4.60 reads 19 win / 13 timeout / **0 loss**, dial
   5.20 reads 14 / 17 / **1 loss** — thirty-one non-wins across two settings and one of
   them is a defeat, with every timeout pinned to the cap. The enemy does not beat this
   bot at any dial in the band; a stronger enemy only makes it slower until it stops
   finishing. So `enemyMult` here is a CLOCK knob wearing a difficulty knob's clothes,
   and the win rate being tuned is measuring "what fraction FINISH" rather than "what
   fraction are won". `losses=0` means the dial is not the lever whatever the win rate
   says — the candidates are `targetLengthMin`, the Marshal'd-throne stalemate already
   diagnosed under item #70, and the bot's conversion rate.
1. **Do not size another dial move at n=24.** This is now demonstrated twice, and CLAUDE.md
   carries the demonstration. n≥96 for a tune, n=240 near a band edge.
2. ~~**Get a real slope first.**~~ **DONE, AND THERE IS NO SUCH NUMBER — the response is an
   S-CURVE.** thanescar, n=48 a point, each point run twice from identical seeds with
   byte-identical results:

   ```
   dial    4.60    4.90    5.20    6.80
   win%     65%     65%     40%      6%
   slope        0.00    0.83    0.21     pts per 0.01, per segment
   ```

   A flat shoulder, a cliff, then a long tail. **`enemyMult` moved +0.30 and thanescar did
   not move at all**, and the next +0.30 was worth twenty-five points. So the recorded
   "~1 pt/0.01 campaign-wide" is an average over twenty-four rows on twenty-four different
   curves, locally wrong by more than 4×, and it is the real mechanism behind "six rows
   moved the WRONG way" above — not only noise, but six rows on six different parts of six
   different curves. Full write-up in CLAUDE.md under Tuning.

   **The method that follows is BISECTION, not slope-scaling.** Bracket wide enough to
   contain a real change (±0.6 on thanescar, not ±0.05), measure the midpoint, halve —
   four or five n=48 points a row, every one a measurement. A row on its shoulder cannot
   be tuned by a small step at ANY sample size, because no n rescues a derivative of zero.
   This retires the standing "steps of ≤0.05 late and re-measure" advice for any row that
   is sitting on a plateau.
3. **Then re-size the corrections from that number and re-sweep at n≥96.**
4. **IRONWOOD is knowingly out of band** at 96% against a 92% ceiling, and it is blocked
   rather than forgotten: near-immune to `enemyMult` in this range, its working lever is
   `neutral`, and raising that breaks the non-decreasing total-sites invariant against
   saltmere, which is itself at 79% against a 78% floor. It needs saltmere moved first or a
   third column.
5. **The incursion ladder is downstream of all of this** — see item 4 below.

## ⇒ THE CRITIC'S PASS: this game is engineered beautifully and is not fun yet

**Everything in this section was measured today, on the shipped build, with the command
to re-take it. Nothing here is taste.** The engineering in this project is genuinely
better than most shipped commercial games — the invariants, the measurement culture, the
scar-tissue documentation. It has been pointed almost entirely at making the SIMULATION
correct rather than at making the GAME worth five hours. The result is a technically
immaculate campaign whose last four and a half hours contain no new content, in which
the player essentially cannot lose, and where waiting overnight is worth 16%.

The five findings below are ranked by what they cost a real player. The features under
them are ranked by fun per line of code.

### 1. YOU CANNOT LOSE — AND THEREFORE YOU CANNOT WIN

576 battles across the campaign: **401 wins, 12 defeats, 163 timeouts**, and 102 of
those timeouts end AHEAD on territory. 93% of every failure in this game is a stopwatch.
Being beaten is a story a player tells; running out of time reads as the game being
broken. This is written up in full in CLAUDE.md — what belongs here is the consequence:
**a game with no defeat state has no stakes**, and no amount of dial-tuning creates one,
because defeat only starts appearing at `enemyMult` 8.50 against a shipped 4.60.

### 2. THE PRE-COMMIT PREVIEW DELETES EVERY GAMBLE IN THE GAME

Invariant 3 makes combat deterministic and the preview "a guarantee, not an estimate".
So **every attack you will ever make is a solved arithmetic problem whose answer the
game has already shown you.** No read, no risk, no lucky break, no heartbreak. The
player is not deciding, they are executing a checkable procedure.

Determinism is not the problem — Into the Breach is deterministic and superb. But it is
a PUZZLE, where finding the one line that works is the game. Here the resolution is
"bigger number wins" and the game tells you which number is bigger. Determinism plus a
trivial decision space is not elegance, it is the absence of a game.

**Do NOT fix this with dice.** It would break invariant 3, replay, and the harness. Fix
it with the uncertainty that is already real — see feature B.

### 3. THE CONTENT IS OVER AT REGION 8 OF 24 — MEASURED

Modelling a player who plays back to back and never idles extra (`/tmp/cliff.mjs`
pattern: `metaFor(before, cumulativeAdvertisedMinutes)`):

```
region  8  thornmoor    62m    LAST NEW THING IN THE GAME (unlockMarshal)
region  9..24                  261 MINUTES — 4h21m — OF ZERO NEW CONTENT
```

Three of eleven unlocks — outriders, halberds, sappers, i.e. **every specialist** — are
never bought at all on that curve. The enemy's own roster completes at region 10. And
from region 15 to 24 the difficulty dial moves 4.60 → 5.07 (**10% across the last ten
regions**) while the board grows 17×13 → 21×16 (**+15%**). Ten regions of nothing.

**AND EIGHT VARIETY MECHANICS ARE ALREADY BUILT, TESTED, AND NEVER SHOWN TO A FIRST-RUN
PLAYER.** `content/incursion.data.js` ships `ironwall, warhost, bulwark, scorched,
levies, thinned, sealed, entrenched` — every one applied through a field that already
crosses the seam, so they cost no engine change. `campaignReplayPlan` returns `null` for
every region on `resets: 0`, verified today. They appear only on the endless ladder and
on post-abdication replays, which is to say: **almost nobody will ever see one.**

### 4. THE IDLE HALF STOPS PAYING AFTER ONE EVENING — MEASURED

Army power against idle time, region 12, off real `buildBattleConfig` output:

```
idled      1h      8h     24h    1 week   1 month
power    x2.39   x3.46   x4.02   x5.21    x6.19
bodies    273     284     293     305      312
```

**One hour to one MONTH — 720x the wait — buys x2.6.** 8h → 24h buys 16%. And the only
figure a player can actually see, the size of the landing force, is FLAT: 273 → 312
bodies. For a game whose pitch is that your empire pays out while you are away, there is
no reason to come back tomorrow. `SAFE_MAX_LEVEL` and the log-curve are doing exactly
what they were designed to do, and what they were designed to do is remove the reward.

### 5. THE BATTLE IS A CONVEYOR BELT, NOT A WAR

Already in CLAUDE.md and it belongs in the fun list: 1,150 field battles in one
20-minute gallowmoor battle — about one a second — with the enemy sending 2,114 columns
at a **median size of two**. 78% of the bot's army is permanently in transit. Nothing
that happens is decisive, so nothing is worth watching, so the 8–20 minutes of real-time
attention the game asks for are not repaid.

### ...and the first two minutes actively punish a new player — MEASURED

Cold boot (`Storage.clearDataForOrigin`, not `localStorage.clear()`), no input, sampled:

```
t=      0s     30s     60s     90s    120s
gold   294     244     194     145      95      monotonically DOWN
sites  3v5     3v6     3v7     3v7     3v7
```

The biggest, brightest number on the screen is red and falling from tick one
(`GOLD 294 / -1.7/s`). The board is 85% black with nothing to aim at. The objective says
`TAKE THE CASTLE` and no castle is visible. Five booster buttons all read `–`, because a
fresh save has no relics and relics only come from beating a region — so **five of the
game's most interesting controls are dead on arrival for the entire first battle**. Of four BUILD buttons two are
affordable (farm 200, watchtower 120) — an earlier draft of this said three were
out of reach, which was wrong and is corrected here rather than quietly dropped.

**And the endgame screenshot is worse.** Widowsgate, three minutes in, passive:
`SITES 4 v 40`, `GOLD 0 · +0.0/s`, `110 troops · 0 marching`, objective reading
`HOLD 7% OF 60%`, ~95% of a 336-hex board black, every booster still `–`, every build
button still unaffordable. That is the climax of a five-hour campaign.

*(One concrete bug found on the way: the booster rail overflows its plate at the default
1440x760 — `scrollHeight` 315 against `clientHeight` 303 — so TITHE draws clipped. All
five still hit-test, so it is cosmetic, but it is visible on the default desktop size.)*

---

## ⇒ HOW THIS PASS IS BEING RUN, so a session that dies loses one task at most

**Read this before picking anything up.** The C-list below is being worked one item per
commit. The rules exist because the failure this pass is most likely to hit is not a bug,
it is a session ending with three items of work living only in a chat transcript.

1. **One item, one commit, pushed immediately.** Never batch. A usage limit costs at most
   the item in flight.
2. **The box is ticked in the same commit as the code.** A ticked box with no commit and
   a commit with no tick are both lies about state.
3. **A measurement is written to `CLAUDE.md` before it is acted on.** The scratchpad is
   not the repository and does not survive; this file and that one do.
4. **Subagents never hold a result.** They report, and the result is transcribed into
   this file or CLAUDE.md and committed in the SAME turn it arrives. An agent's reply is
   not storage.
5. **Stage explicit paths.** Several sessions share this tree — `git add -A` has already
   swept another engineer's in-flight edits into an unrelated commit once.
6. **Balance-affecting items land BEFORE the re-tune, not after.** This inverts the
   caution written when the C-list was drafted, and the inversion is the important part:
   C1, C3, C5 and C7 all change what a late region IS, so a re-tune run before them is a
   re-tune that has to be thrown away. Do the content, then tune once. Item #70's sweep
   is the LAST thing this pass does, not the first.

**Ordering, and why.** C1 first because it is mostly plumbing that already exists and it
is the one that fixes fifteen identical regions. C8 next because it is cheap and it is
the first thing every player sees. Then C4 and C2, which are what make a battle worth
watching and a decision worth making. C3, C7, C6 are new systems. C5 needs a design call
and is deliberately last of the features. The re-tune closes the pass.

## ⇒ WHAT WOULD ACTUALLY MAKE IT FUN, ranked by fun per line

- [x] ~~**C1. PUT THE EIGHT EXISTING MUTATORS ON LATE CAMPAIGN REGIONS.**~~ **DONE** — `campaignTwistPlan`, `CAMPAIGN_TWIST`, `--notwist`. Balance delta measuring; see CLAUDE.md. The single
      highest fun-per-line change available in this codebase, and most of it is already
      written. `incursionMods`/`incursionRegionInputs` already apply a hand through
      fields that cross the seam; `campaignReplayPlan` already computes a seeded draw
      from `(region id, resets)`. Give regions 10+ a hand drawn from `(region id, clears)`
      instead of `null`, one mutator from tier 3, two from tier 5. **This makes fifteen
      identical regions stop being identical for roughly the cost of one function.**
      **THE DESIGN IS DECIDED — the implementation is execution.** Recorded here so a
      session that dies does not have to re-argue it:

      - **From region 10 (tier 3).** That is exactly where the content stops: the last
        unlock is region 8 and the enemy roster completes at region 10.
      - **One mutator at tiers 3-4, two at tiers 5-6.** The COUNT matters less than the
        DRAW: even one gives each of fifteen regions its own identity, because the hand
        differs per region. Conservative on purpose — every mutator is a difficulty
        increase, so this can be raised after a measurement and cannot easily be undone.
      - **Seeded on `(region id, clears)`, and that pair is the whole trick.** On a first
        conquest `clears` is 0, so the hand is a pure function of the region — Gallowmoor
        is always the Iron Wall region, a player can learn it, plan for it and talk about
        it. On a RAID `clears` is higher, so the hand rotates and the replay is not the
        same fight. Identity on the way up, variety on the way back.
      - **`sealed` excluded** — 0.72 exceeds `GATE_CLAMP`'s 0.60 ceiling outright, and
        that ceiling cost a whole pass to establish.
      - **Never stamps `rules.incursion`.** A mutated campaign region is a first conquest
        or a raid and must be paid as one; `meta/rewards.js` branches a whole payout path
        on that field.
      - **Computed at config-build time, never stored on the region row**, or the
        incursion ladder inherits it through `REGION_BY_ID[INCURSION.regionId]` and
        silently double-mutates. See CLAUDE.md.
      - **Visible before it is fought**, in both places a region is inspected: the world
        map detail panel (`worldmap-detail.js`'s `rows` array) and the loadout brief
        (`prebattle-brief.js`, which already renders `replayMutators`).

      Balance: it does NOT have to be paid for. All eight mutators are difficulty
      increases and the campaign reads too easy from tier 3 on, so this pushes the way
      the table already needed to go — which is why it lands BEFORE the re-tune sweep
      rather than after (protocol rule 6).

- [x] ~~**C2. MAKE THE PREVIEW SHOW A RANGE WHENEVER THE TARGET CAN BE REINFORCED.**~~
      **SHIPPED.** `battle-preview.js` gained two helpers. `reinforceMargin` binary-searches
      the smallest reinforcement that flips the outcome, by re-running the SAME
      `resolveField` call the send itself will make — so `unless +59 arrive` is a
      guarantee about the sim, not a heuristic. `inboundDefenders` counts enemy columns
      already aimed at the target and arriving inside the ETA, fog-gated through
      `perceivedSquads`, so a relief you cannot see does not leak into the readout.

      **The inbound count is REPORTED, never ABSORBED, and that is the whole
      invariant-3 argument.** The first cut folded the relief into the `resolveField`
      call, which is a plausible, confident, WRONG number: a column landing mid-melee
      does not resolve as though both sides stood there from the first tick —
      `reprojectDefender` banks casualties and re-projects against a fresh baseline. So
      when `inboundN >= margin` the verdict becomes `CONTESTED` and the survivor count
      and BREACH time are WITHHELD, exactly as a multi-source send withholds its
      verdict. Confirmed in a real browser at both ends:
      `WIN FIELD - 58 survive - BREACH 4.6s - unless +59 arrive` and
      `CONTESTED - unless +59 arrive - 90 inbound`.

      Original item text below. Restores the gamble without touching invariant 3, because the uncertainty is
      already REAL: `projectGarrison` projects training, but a defender can also be
      reinforced by a column in flight that the player cannot see. Today the preview
      quietly assumes that will not happen and prints a single confident number. Show
      `you win — unless 12+ arrive first` and the player is making a bet again, on true
      information, with the simulation still deterministic and the replay still exact.
      The precedent is already here: a multi-source send WITHHOLDS its verdict rather
      than softening it, and an unscouted target returns `kind: 'unscouted'`.

- [x] ~~**C3. GIVE THE PLAYER A CHOICE BEFORE THEY LAND — three commanders, pick one.**~~
      **SHIPPED as DOCTRINES**, and the rename is not cosmetic: `marshal`'s player-facing
      `role` is already the word "Commander", so a second thing by that name would have
      been two different objects sharing a label on the same screen. A doctrine is a plan
      you commit to, not a person on the board.

      Six in the pool (`content/doctrine.data.js`), three dealt per battle, one preselected
      so Enter still launches. **Every one is a TRADE — one field up, one field down, on
      different phases of the battle** — because a table of pure buffs collapses the choice
      into "which number is biggest" AND re-tunes twenty-four regions at once. Each owns a
      different axis: offence, defence, treasury, production, siege, mobility.

      **It is content, not engine.** Every field was fact-checked as having a live,
      SYMMETRIC reader (`modOf(state, site.owner, ...)`) before a number was written — not
      assumed from the fact that `contract.js` declares it. No CONTRACT field moved and
      `CONTRACT_VERSION` stays at 12; a doctrine is a `player` FactionMods transform, the
      same shape as an incursion mutator of kind `playerMult`, and nothing branches on its
      identity the way `rewards.js` branches on `rules.incursion`.

      **The hand is a pure function of (region, attempt), so a retry deals the same three**
      — re-rolling on retry would make the choice free, since backing out and re-entering
      costs nothing. A raid steps the rotation by a stride coprime to the pool, so repeated
      clears of one region walk all six.

      **The harness plays it** (`--doctrine=<id>`, `--nodoctrine`), because the shipped
      screen forces a pick from region 2 on and a bot that took none would measure a player
      who does not exist. Fixed on the way: **`--notwist` was wired to `runFrontier` only**
      — the one branch where `campaignTwistPlan` returns null regardless — and missing from
      the fifteen campaign rows it exists for, so it parsed, ran, and changed nothing.

      Three defects found by driving it, none of which a test could have seen: the panel
      was a fourth child of a three-column grid and **wrapped entirely below the fold**
      (`elementFromPoint` on its own middle card returned null at 1440x761); the pick
      callback called `render()` where the scene's function is `paint()`, so **every click
      threw and the card never changed** while focus still moved, which looks exactly like
      it working; and `termLabel` took its sign from the gain/cost SLOT, printing the
      Drillmaster's `trainCostMult: 1.30` as "-30% training cost" — reading as cheaper, the
      opposite of the term, on a card whose entire job is comparison.

      Original item text below.

      **C3. GIVE THE PLAYER A CHOICE BEFORE THEY LAND — three commanders, pick one.**
      Not a new unit (a unit is a cliff, and this file says so). A one-off, per-battle
      modifier chosen on the loadout screen from three seeded options: "your camp trains
      at 2x for the first 90 seconds", "your first assault takes no losses", "+50% build
      speed, -25% income". It rides `FactionMods`, which already crosses the seam, so it
      is content rather than engine. It creates the thing the campaign most lacks: **a
      decision made before you see the map, that makes two runs of the same region
      different.**

- [x] ~~**C4. LET A BOOSTER BE FIRED INTO A FIGHT THAT IS ALREADY HAPPENING.**~~ **ALREADY SHIPPED — struck with the measurement that killed it.** `reprojectDefender` names BOMBARD in its own docblock as one of the five things the melee layer fixed, and `siteMelees` re-projects whenever `site.garrison` differs from what the phase last wrote. Measured: a bombard into an open melee cuts the defence 30 -> 20 and leaves 5 standing where an untouched assault leaves 8. **What it was NOT is guarded** — nothing in the suite fired a booster into an open fight, so the ID-set staleness test that makes it work could be refactored away with every test green and the charge spent for nothing. `tests/meleebooster.test.js` is the actual deliverable. Original item text below. The melee
      layer gives every fight a six-second window and the player can currently only
      reinforce it or run away. Bombard/fortify landing ON an open melee turns that
      window into the tensest six seconds in the game, and the layer is already built —
      `site.melee` carries the record, `meleeStep` already re-projects when either side
      changes. **This is the cheapest way to make combat worth WATCHING**, which is the
      whole problem with #5.

- [x] ~~**C5. KILL THE TIMEOUT AS THE FAILURE MODE.**~~
      **SHIPPED as (b), and the decision the item asked for was already half-made in the
      engine.** `battle/sim.js endPhase` has computed the territorial verdict into
      `state.meta.timeoutWinner` for that mechanic's entire life, and **nothing has ever
      read it** — the game decided who was ahead when the clock ran out and threw the
      answer away. So a player who held most of a map for twenty minutes was told "Time
      expired", paid nothing, and left with the region no further along. That is the
      DOMINANT failure message in this game: 93% of non-wins are timeouts and 63% of
      those end ahead.

      `HELD_FIELD` (content/payout.data.js) + `heldFieldPay` (meta/rewards.js). A timeout
      the player LED pays a fraction of what taking that ground would have paid — priced
      off the conquest bounty, the raid lump or the rung's own lump, so there is no fourth
      price table to drift. Scaled by how much was held, with a floor so a technical lead
      pays nothing.

      **IT PAYS, IT DOES NOT WIN, and that is what keeps it out of the balance table.**
      `result` stays `timeout`, nothing is conquered, `clears` does not move, a rung's
      `cleared` does not move, and no relics are paid — a relic is for ground you have
      BEATEN. Every measured win rate is `status === 'win'`, so this is provably outside
      the measured set rather than merely near it. Not farmable either: a timeout costs
      the FULL hard cap where a raid pays its whole lump for a win on a ten-minute
      cooldown.

      **The verdict is CARRIED, never re-derived.** `outcome.timeoutWinner` crosses the
      seam rather than rewards.js computing a site share off `stats` — and a browser probe
      proved why that matters: a board where the player holds 10 of 11 sites can still
      read `timeoutWinner: 'enemy'` when influence says otherwise. Two implementations of
      "who was winning" would disagree on exactly the close battles this feature is for.
      No contract bump: the outcome is produced and consumed inside one call and is never
      persisted, so no stale blob can be stepped wrongly by it.

      One defect only the browser found: the headline read **"You held the field"** over a
      stat block with **no Crowns row**, because that row sat inside `result === 'win'`.
      It is gated on the payout now — the same rule the headline follows.

      (a) is not taken and is now less pressing: it wanted the last three minutes to be
      decisive, and the muster (C7) is a forced decisive engagement in the middle of the
      battle instead. Whether the timeout SHARE has actually moved is a sweep, not an
      argument.

      Original item text below.

      **C5. KILL THE TIMEOUT AS THE FAILURE MODE.** Two candidates, and this needs a
      decision rather than a patch. (a) Make the last three minutes DECISIVE — the
      attrition ladder already exists, already bites hard, and is currently a slow
      squeeze nobody notices; turn its last rung into a real clock the player can feel.
      (b) Resolve on territory with a graded payout instead of binary win/lose, so a
      contested 20-minute battle pays something and reads as a hard-fought draw rather
      than as the game giving up. Either beats 93% of failures being a stopwatch.

- [x] ~~**C6. GIVE THE PLAYER SOMETHING TO SPEND SIX FIGURES ON DURING THE CAMPAIGN.**~~
      **STRUCK — the premise does not survive measurement, and that is worth more than the
      feature would have been.** Re-taken off the real `metaFor`/`shopListing` pipeline for
      a player who plays back to back:

      ```
      region        banked   income/s   banked AS income   next empire level
      thanescar      70,304        376         3.1 min           4.7 min
      ravensmarch   254,660        938         4.5 min           5.4 min
      stormhalt     671,208      1,849         6.0 min           6.1 min
      widowsgate    965,526      2,906         5.5 min           6.6 min
      ```

      **The 691,468 this item was written against is FIVE MINUTES OF INCOME.** Over the
      last ten regions the treasury runs 0.9–6.0 minutes of income while the next Empire
      level costs 4.7–7.1 — so the player is permanently about one level away, which is
      the logarithmic curve working exactly as designed rather than a dead economy. Six
      figures simply stopped being a large number by region 20; income compounds ~1.3x a
      region and reaches 2,906/s.

      **AND THE REAL FINDING IS THE OPPOSITE OF THE ONE THIS ITEM ASSUMED.** 200,000
      crowns — the cheapest Crown line — is **0.8 hours of idling at region 9** and about
      six minutes at region 13. So the Crown tier's PRICE gates nothing whatsoever for
      anyone who leaves the tab open one evening, and `requires: 'endgame'` is not a
      belt-and-braces flag on top of an endgame price: **it is the only thing holding the
      tier back at all.** That corrects CLAUDE.md's own claim that those lines are "priced
      for an incursion economy where one rung pays millions" — they are, against an
      incursion economy, and they are pocket change against a mid-campaign one.

      **What that retires, and what it leaves.** Opening the tier mid-campaign was the
      obvious cheap fix and it is dead: three of the four lines are direct battle power
      (+18 expedition slots, +5/5/6%, +20% siege), so it hands a player who idled one
      evening at region 9 an endgame army at tier 2 — the exact exploit the flag exists to
      stop. What survives is a real design question for the re-tune rather than a feature:
      **the shop's most interesting tier is unreachable for the whole campaign, and making
      it reachable is a repricing, not a gate change.**

      Original item text below.

      **C6. GIVE THE PLAYER SOMETHING TO SPEND SIX FIGURES ON DURING THE CAMPAIGN.**
      Measured above: 691,468 crowns banked at region 23 with nothing to buy, because the
      Crown tier is gated on FINISHING. Candidates: a standing garrison you pay to keep
      (a conquered region that keeps paying more, and can be RAIDED BACK), or an offline
      expedition that runs while you are away and returns loot — which would also fix #4,
      because it makes tomorrow's login mean something specific rather than a slightly
      larger multiplier.

- [x] ~~**C7. GIVE THE ENEMY ONE SET-PIECE PER BATTLE.**~~
      **SHIPPED as THE MUSTER.** Once per battle, inside a window derived from the
      region's own `hardCapTicks`, the enemy stops grinding and commits: it draws the
      spare from up to twelve sites into ONE synchronized wave aimed at the player's
      camp, and announces it with both numbers that make it answerable — how many are
      coming and how many seconds out.

      **Aiming it at the camp is three decisions at once.** It is the lose condition, so
      it is the one target a player cannot choose to ignore. It is a site the player
      OWNS, so the alert names ground they can already see — fog-safe by construction
      rather than by a check, which matters because `screens/battle.js` emits the event
      bus **regardless of fog** and `fxVisible` gates only the burst and the sound. And
      it is the one site `attack()` will essentially never pick on its own, since that
      phase scores by `AI.siteValue` and reach.

      **The warning is the travel time, not a scripted countdown** — `launch()` already
      holds every squad in a wave to the slowest contributor, so the ETA is a real
      number the sim computes. Two honest answers, and the second is why this is a
      decision rather than a chore: march home and meet it, or notice the enemy has
      just emptied its own country and go and take it. The second is not scripted; it
      falls out of `launch()` debiting every source, and `tests/setpiece.test.js` pins
      it as a measured drop in enemy garrisons rather than as a claim.

      **AND THE HARNESS COULD NOT ANSWER IT, WHICH WOULD HAVE MADE THE MEASUREMENT
      MEANINGLESS.** The bot keeps a standing `HOME_FLOOR` at the camp and had never
      once reacted to a threat, so a run of the muster would have measured a player who
      watches a host walk into their camp and does nothing — the `upgradeTurn` lesson a
      fourth time, with the twist that *answering* is as much a part of playing as
      attacking is. `tools/simdefend.js` marches the nearest garrisons home when a wave
      is inbound and the camp cannot hold. Provably inert without a muster: the enemy
      never aimed a wave at the camp before this pass, so its first `if` was false on
      every think of every measured number. `--nomuster` and `--noanswer` keep both
      halves separately re-takeable.

      **Contract v13**, and it is the v8 lesson a fifth time: no CONFIG field moved.
      `state.ai` gained `musterTick`, and a v12 blob resumed after its muster landed
      reads the latch as undefined, sits inside the window, and raises a SECOND host.
      The new `ENEMY_MUSTER` event costs nothing — nothing in `battle/` or `tools/`
      reads `state.events` at all.

      Confirmed in real Chrome on a live gallowmoor board: `THE HOST MARCHES — 190
      closing on your camp, 32s out. Their country is thin behind it.`

      **The balance screen is not yet taken** — the box was saturated when this landed.
      It is a real difficulty increase and it lands mid-re-tune, so `--nomuster` is the
      control and the number belongs to whoever runs the next sweep. Worth knowing
      before reading it: 93% of this campaign's non-wins are TIMEOUTS, and a forced
      decisive engagement is exactly what a permanent grinder lacks — so it may well
      read as C1's twists did, harder on paper and *faster* in practice.

      Original item text below.

      **C7. GIVE THE ENEMY ONE SET-PIECE PER BATTLE.** The AI grinds; it never does
      anything you have to ANSWER. A named event — a raid aimed at your camp at minute
      five, a relief column visibly marching for the throne, a supply convoy you can
      intercept for a lump of gold — creates the moment the conveyor belt never produces.
      `aicore.js adjacentSources` already pools; this is a trigger and a target, not a
      planner.

- [x] ~~**C8. FIX THE OPENING BEAT: do not show a new player a falling red number.**~~ **DONE** — the drain alarm now fires on RUNNING OUT rather than on spending (a rule of the whole game, not a first-battle concession), and a genuine first battle lands with one `march` charge. See CLAUDE.md. The
      first battle should not open on `GOLD 294 / -1.7/s` with three of four build
      options unaffordable and five dead booster buttons. Either start the first region
      cash-positive, or hide the training deficit until the player has captured
      something. **And give the first battle one free booster charge** — five controls
      that read `–` through the entire tutorial region is the "sold and did nothing"
      failure this project has already refunded four upgrades for, wearing a different hat.

## ⇒ START HERE: the fun pass, live work list

**This section is the one piece of this file that carries STATE, and it exists so a
session that dies mid-pass loses nothing.** Everything below it is reference. If you are
picking this up cold: read this section, take the first unchecked item, do it, tick it,
commit. Do not re-derive the list.

**The protocol, and it is the whole point of the section:**

1. One item per commit. Tick the box **in the same commit** as the work.
2. If an item turns out to be wrong, or a measurement kills it, **strike it through and
   write why** rather than deleting it. A deleted item gets proposed again in three
   weeks; a struck one is an argument nobody has to have twice.
3. Anything a measurement establishes goes to `CLAUDE.md` — this file keeps the ordering,
   that one keeps the facts. Do not record numbers here.
4. `npm run verify` before every commit. `node tools/smoke.mjs` and `node tools/mobile.mjs`
   before any commit that touches a screen (both need `npm start` running).

### ⇒ THE FUN-AND-PLAYABILITY PASS — live, and this is the resume point

**STATE. If you are picking this up cold, start here, not at the Blocking section.**
A six-specialist critique of the shipped game is in flight or landed: game feel,
difficulty and failure, hours 2-10, board readability, the idle half, and input and
accessibility. Each writes a report to the scratchpad
(`crit-feel.md`, `crit-difficulty.md`, `crit-retention.md`, `crit-readability.md`,
`crit-idle.md`, `crit-input.md`) and each finding is reproduced against the real game
before it is believed.

**The protocol for this pass, on top of the four rules above:**

5. **Findings land in THIS list before any of them is worked.** A finding that is only
   in a scratchpad report is lost the moment the session ends — the scratchpad is not
   the repository and does not survive. Transcribe first, fix second.
6. **Every item carries its own evidence**, so it can be executed without re-reading the
   report it came from: what was measured, on what, and what the number was.
7. **A finding that turns out to be false is struck through with the check that killed
   it**, not deleted — the last pass had one ("Spend All wastes relics") that was wrong
   on a two-minute source read, and recording that is worth more than deleting it.
8. **Rank by cost to a real player, not by ease of fix.** Cheap-and-cosmetic goes last
   even when it is tempting to clear it first.

**Status of the intake:** see the checklist immediately below. Nothing is worked until
its own box exists here.

- [x] ~~**Transcribe the six specialist reports into ranked items below.**~~ Done for the
      two that survived. **FOUR OF THE SIX DIED TO A SESSION LIMIT BEFORE WRITING
      ANYTHING** — see the warning below.
- [x] ~~**Make the bot build yards, not farms, when it is rich.**~~ **DONE, and it is the
      biggest single number this pass produced.** `--richyards` is worth **+62 on
      gallowmoor (38% -> 100%) and +38 on thanescar (25% -> 63%)** at n=8 with matched
      seeds, with the all-run medians falling as far as the win rates (38.0m -> 22.5m,
      30.4m -> 20.3m). It **ships OFF**, and not out of doubt: gallowmoor at 100% is
      twenty-eight points above its tier ceiling, so turning it on does not improve the
      table, it invalidates it the other way. **The re-tune should re-base with it ON
      before spending another dial** — see CLAUDE.md for the numbers and the argument.

- [x] ~~**Add an endless mode, and lay the groundwork for more stages.**~~ **DONE.**
      `The Frontier` — one 40x32 board of 1,280 hexes, difficulty measured in rings out
      from your own camp, no end but the one you choose. It is a `mapGen` swap and
      nothing else: `battle/frontier.js` supplies a `plan` that `mapgen.js` accepts in
      place of `planSites`, and every line below that hook is the campaign's own. No
      contract field moved. It resolves through `REGION_BY_ID` and is absent from
      `REGIONS`, so it appears in none of the campaign's invariants or sweeps.
      `content/tiers.js` is the stage groundwork — the five per-tier tables now index
      through one clamped accessor, so adding a seventh tier is a bounded job rather
      than a hunt. Numbers, and the gate correction the measurement forced, in CLAUDE.md.

- [ ] **THE INSTRUMENT FOR THE #1 PROBLEM IS ANCHORED TO A REGION THAT IS MID-RETUNE.**
      `tests/loadoutdominance.test.js` measures gallowmoor alone and currently reports a
      0-point gap, which reads as "somebody fixed the dominant loadout" and is not that:
      the DEFAULT spread collapsed to gallowmoor's out-of-band win rate.

      **⚠ AND THE SECOND REGION THE CRITIC PROPOSED IS THE WRONG ONE — corrected here
      before anyone spends a session on it.** They reported kaldan reproducing the
      exploit at default 58% -> mono 83%, +25. Re-measured with the harness's own seeds:
      **+12 at n=24 and +8 at n=48** (73% -> 81%). That +8 is not a weak reproduction of
      the exploit, it is kaldan's RECORDED VALUE AS THE CONTROL — the dominant-loadout
      table in this file already lists kaldan at `+0 / +8` with the note *"kaldan is the
      control, so this is a late-campaign hole, not a global one"*. Pinning the exploit
      to the region that documents its absence would encode the opposite of the defect.

      **AND MEASURING THE LATE ROWS SHOWED THE INSTRUMENT'S REAL DEFECT, WHICH IS NOT
      THE REGION COUNT — DONE.** n=24, matched seeds, on the mid-retune table:

      ```
      region        band     default   mono   gap    medians          tempo ratio
      kaldan       66-84       73%      81%    +8    9.7m -> 8.2m        0.85
      gallowmoor   50-72       38%      38%     0   24.6m -> 13.7m       0.56
      thanescar    34-56       29%      33%    +4   17.3m -> 14.0m       0.81
      ravensmarch  22-42       17%      13%    -4   26.2m -> 10.2m       0.39
      ```

      Every mid and late DEFAULT is below its own floor, so **not one of those gaps is
      readable** — a gap is a difference between two numbers and says nothing when one
      of them is broken. Adding a second region would have added a second unreadable
      number.

      The test now measures kaldan (the only in-band row, and the control) plus
      gallowmoor (the historical one), asserts DIRECTION on every in-band row — mono
      must not be worse and must not be slower, since an inversion is a bigger event
      than a fix — and asserts MAGNITUDE only where a baseline is healthy AND is not the
      control. Today that leaves the magnitude claim with nowhere to live, and it logs
      that loudly rather than passing quietly. The tempo half is reported rather than
      pinned because it varies by row: ravensmarch 0.39 and gallowmoor 0.56 still delete
      the battle, thanescar 0.81 and kaldan 0.91 do not.
      `WIN_BAND` moved to `tools/winband.js` so a test can read it without importing
      `simrunner.js`, which runs its CLI on import.

- [x] ~~**RE-RUN THE FOUR CRITICS THAT NEVER REPORTED: game feel, hours 2-10, board
      readability, input and accessibility.**~~ **DONE, plus two more lenses.** Kept
      rather than deleted because the BRIEF is the reusable part, and because four of
      these died to a session limit having written nothing the first time round: drive
      the REAL game through `tools/cdp.js` at
      `localhost:8080/?dev=1`, reproduce every finding with a probe or a screenshot,
      distinguish measured from reasoned, rank by cost to a real player, include a "what
      already works" section, stay READ-ONLY on the repo, and write to
      `scratchpad/crit-<lens>.md`. **Transcribe each into this list the moment it lands** —
      the scratchpad does not survive a session, which is exactly how these four were lost.

      **ALL FOUR HAVE NOW LANDED and are transcribed below**, and two further lenses
      were run on top of them — **tactical depth** and **the first session** — whose
      sections sit at the end of the transcribed run. This item is closed as intake;
      what is left of it is the unticked findings themselves.

### From the game-feel critic

Driven live through `tools/cdp.js`; every finding reproduced with a probe or a
screenshot, and the report separates measured from reasoned throughout.

- [x] ~~**THE MOST-REPEATED REWARD BEAT IN THE GAME NEVER ESCALATED WITH STAKES.**~~
      **FIXED.** `site-captured` has carried `kind` since the event was written and
      `fxFromEvent` never read it — proven by calling the shipped function with two
      events differing ONLY in `kind` and screenshotting both, which came out
      indistinguishable. Taking an undefended farm and breaking the enemy's throne fired
      pixel-identical bursts, rings and `TAKEN` text. Magnitude now derives from
      `siteTier` (which already means "how much attention does this kind deserve"), the
      objective gets a second, delayed ring rather than a bigger one, and `delay` is
      implemented rather than being a silently-ignored spawn field. Pinned by
      `tests/captureweight.test.js`, five of whose eight tests fail against the previous
      commit while the three negative controls pass.

- [x] ~~**A FIGHT OPENED LOUDLY AND ENDED IN SILENCE.**~~ **FIXED.** `FIELD_BATTLE`
      fires when a melee starts or is reinforced; six seconds later the ONLY
      resolution that announced anything was the one that opens a siege. So a column
      of your troops being wiped out simply stopped being on the board, and a
      garrison of yours HOLDING — the one piece of good news the melee layer can give
      a player — was invisible. Both silent outcomes are the ones a player would act
      on. `FIELD_BATTLE_ENDED` now fires on every resolution and the board draws a
      beat SIZED BY WHAT IT COST, drawing nothing under three casualties (fights
      resolve about once a second late on, so a flat effect would be a strobe) and
      capped at forty (an uncapped one would black out the board it informs).
      Provably inert on balance: nothing in `battle/` or `tools/` reads
      `state.events` at all except the clear at the top of `step`.

- [x] ~~**A WRONG-WAY SEND COSTS A FULL ROUND TRIP, NOT A REDIRECT, AND THERE IS NO ORDER
      THAT FIXES IT.**~~ **DONE.** `MOVE_SQUAD` re-tasks a column in flight now, and the
      decision the item asked for went the forgiving way because the cost of not doing it
      was measured and the cost of doing it was zero: nothing in `tools/` or
      `battle/ai*.js` issues `MOVE_SQUAD` at all, and 16 matched runs are byte-identical
      against the parent commit. **The interesting part is what it took to land: ONE RULE
      LIVED IN THREE PLACES**, and with only the sim and the hit-test relaxed the gesture
      evaporated silently in `issueMove` one layer above the simulation — pressed,
      dragged, previewed, released, `resolveDrag` returning true, and nothing pushed. Two
      unit suites and a source read all said it worked; a real browser found it. Full
      write-up in CLAUDE.md.

      *The original item, kept for its evidence:* Source-confirmed and then measured: `MOVE_SQUAD` refuses any squad
      that is not `camped` (`'squad-in-transit'`), and `RETREAT_SQUAD` takes no
      destination — it only ever aims at the nearest friendly site. So correcting a
      mistaken march is structurally three legs (out, back, then a fresh send) with no
      way to cut across. Measured on one real trial: a squad corrected 2.7s into a 6.7s
      wrong-way march was back at its start tile at **5.9s**, having accomplished
      nothing, with a **fourth** action still needed to go where it was meant to.
      The correction command itself registers in ≤101ms, so this is not latency — it is
      the absence of a verb. Given the design centre (free movement, cheap sends, "both
      sides shuttle tiny columns"), misdirected sends are a predictable byproduct of
      playing as designed rather than a rare misclick.
      **The obvious fix — let `MOVE_SQUAD` re-task a marching squad — is a SIM change and
      therefore a balance change**, so it needs the harness before it needs the UI: the
      bot never issues `MOVE_SQUAD` at all today, so nothing measured would move, but the
      shipped game would get materially more forgiving. Decide which of those is wanted.

- [ ] **DEAD AIR CAN EAT MOST OF A BATTLE.** Two independent methods agree: a live
      passive playthrough held **2 sites v 7 for 3m44s** with nothing changing on screen
      but two garrison numbers, and a recovered harness run of the same scenario shows
      the stall holding for **~16 of an 18-minute cap** (89% of the battle). Partly
      mitigated already — the stalemate alert this pass shipped fires at three minutes —
      but the alert is a message about stasis, not an escape from it. Ranked highest by
      the critic because it reads as "the game is broken" to a new player in their first
      session, before they have learned Withdraw or a better opening.
      Related to, and probably the same problem as, the "zero known targets at tick 0"
      item above.

- [ ] **SUCCESS IS SILENT AND FAILURE IS LOUD.** An accepted order produces no HUD
      acknowledgement at all — only a quiet 90ms whoosh and the squad's own departure —
      while a rejected one lights the alert strip amber/red (and, for boosters, shakes
      the button). Defensible as "don't nag on success", but it means a new player's
      first sends are confirmed only by peripheral cues at exactly the moment they are
      deciding whether they trust the interface. Latency itself is excellent and is not
      the problem: measured 15-125ms typical, which is one sim tick, exactly what the
      10Hz-plus-decoupled-renderer model predicts.

- [ ] **THE ONE-LINE ALERT CHANNEL DROPS MORE MESSAGES THE FASTER YOU PLAY.** `show()`
      replaces whatever is displayed — no queue, no counter, no history — and its hold is
      a fixed number of wall-clock ms, while event rate scales roughly linearly with sim
      speed (measured 2 -> 5 -> 12 events per 3s at 1x/4x/8x in one sample, 8 -> 21 at
      1x/4x in another). So at 4x, several alert-worthy events can arrive and be
      overwritten before the first could be read. The renderer stays crisp throughout —
      this is an information-channel failure, not a legibility one. Lowest-ranked of the
      five because it only bites players running above the free 2x tier.

### From the hours-2-to-10 critic

Measured by headless simulation over the game's own pure functions
(`meta/upgrades.js`, `meta/idle.js`, `core/store.js`), plus live browser probes
against a freshly wiped save and `simrunner` spot-checks.

- [x] ~~**TWO OF THE THREE ENDGAME LOOPS ARE INVISIBLE UNTIL THEY UNLOCK.**~~
      **FIXED** — both are shown locked now, with their own copy, through one
      shared `screens/endgate.js` so the two cannot drift into one showing what is
      coming and the other not. Verified on a freshly wiped save in a real browser:
      Incursions and Abdicate both present, disabled, `data-locked`, dashed at 0.55
      opacity, each carrying its own explanation as title AND accessible name.
      `tests/endgate.test.js` adds the guard that would have caught it — every
      `*Locked` string in `ENDGAME` must reach a screen, the same check
      `offlinenotice.test.js` applies to `IDLE`. Original:

      **TWO OF THE THREE ENDGAME LOOPS ARE INVISIBLE UNTIL THEY UNLOCK, AND THE
      GAME ALREADY PROVED THE OPPOSITE PATTERN.** Source-confirmed: the Incursions
      button (`screens/worldmap.js`) and the Abdicate entry (`screens/mainmenu.js`)
      are absent from the DOM entirely until the campaign is finished — not
      shown-disabled, not shown-locked. Their own explanatory copy is therefore
      unreachable dead text, which is the same "sold and did nothing" shape this
      project has refunded four upgrades for. Meanwhile the Crown shop tier is
      displayed locked, WITH its price and its unlock condition, from a region-1
      save — verified live. So the fix is not a new pattern, it is applying the one
      already built and proven, to the two systems that most answer "is there
      anything to look forward to".

- [ ] **THE UPGRADE CADENCE FALLS OFF A CLIFF, ~10x.** Measured against the real
      cost/income formulas: roughly one purchase a minute in hour one, one every
      6-12 minutes by tier 5-6. Prices compound and effects add, so power grows
      with the log of crowns spent — that is the intended shape and it is not
      broken, but the deceleration lands squarely inside the window this review
      covers. Recorded rather than actioned: changing it is a balance pass.

- [ ] **EVERY UNLOCK IN THE GAME IS BOUGHT BY REGION 8 OF 24**, about ninety
      minutes in, under simple cheapest-first shopping. So for the remaining
      sixteen regions and the majority of playtime there is nothing NEW to
      acquire — only larger numbers on things already owned. This compounds with
      the cadence item above and is the strongest structural answer to "what is
      there to look forward to".

- [ ] **BATTLE LENGTH ROUGHLY DOUBLES AT EXACTLY REGION 10**, the tier 2-to-3
      boundary: 6.5-10 minutes advertised through tier 2, then 16-20 with 30-38
      minute caps for the 63% of the campaign that follows. Confirmed in the table
      AND live on the world map. Same underlying item as the advertised-length
      entry from my own pass; recorded here because the critic independently
      reached it from the retention side, which is evidence it matters to a player
      rather than only to a test.

- [ ] **TIER 3-6 IS WHERE A REAL PLAYER CLOSES THE TAB, and a failed attempt costs
      up to a 30-38 minute sitting.** Independently measured this session
      (`gallowmoor n=8`: 38%, all-run median 38.0m — i.e. half of all runs hit the
      full cap), matching the in-repo n=24 sweep. Not a new finding, but the
      retention framing is: this is not "a hard region", it is half an hour spent
      on a battle that was going to time out from the first minute. **The
      already-measured `--richyards` conversion fix is the single biggest lever on
      this** — see CLAUDE.md.

### From the input-and-accessibility critic

Driven live through CDP with real pointer and key events and a real AX-tree
dump; every finding reproduced before it was believed.

- [x] ~~**"CANCEL BY DRAGGING BACK TO THE SOURCE" SILENTLY AND PERMANENTLY
      DESTROYED TROOPS.**~~ **FIXED.** `updateDragPreview` nulls `view.dragTo`
      when the snap target resolves back to the drag's own origin — right for a
      rally, which is what that line was written for — and for a SEND it made a
      returning drag indistinguishable from a release on open ground, so it
      marched a share of the garrison onto the tile it was already standing on.
      Measured with real pointer events: squads-from-camp went 0 to 1, a new
      `{to: null, camped: true}` squad appeared having marched nowhere, and
      repeating the "safe" gesture peeled off another share; the detachment then
      sits on its own site's hex where `siteAt` wins every hit-test, so it can
      never be selected or reabsorbed. `resolveDrag`'s own comment already said
      this was a cancel — the comment was the specification and the code had
      drifted. Fixed in all three branches (garrison, multi-source, camped), the
      camped one being worse because `cmdMoveSquad` takes a fraction and so SPLIT
      the force rather than merely re-tasking it.

- [~] **THE BOARD IS A NAMELESS CANVAS.** **PARTLY FIXED**: it now carries
      `role="img"` and a live-built name ("Battle map. You hold 4 sites, the enemy
      12. 21 troops, 0 marching. 2 sites under attack."), the composition bar's own
      pattern one level up, with `#board-bg` hidden so the duplicate underneath is
      not announced. Deliberately NOT a live region (the treasury measured 3.0
      announcements a second and drowned the queue) and NOT focusable (a stop that
      activates nothing is the mistake the comp bar fix reversed). **What is left is
      the real gap**: a summary is not spatial information. Where things ARE, and
      the ability to act on them, still need the keyboard path below. Original:

      **THE BOARD IS A NAMELESS CANVAS — a screen-reader user gets zero spatial
      information for an entire battle.** Confirmed from a live
      `Accessibility.getFullAXTree`, not inferred. Already known in outline (the
      ten-specialist review recorded "the DOM layer is good and the canvas has
      nothing"), but this is the first time it has been dumped rather than
      reasoned about. Categorically absent rather than degraded.

- [ ] **THERE IS NO KEYBOARD PATH TO THE CORE VERB.** A keyboard-only player can
      pause and change speed and nothing else: every verb that changes the
      battle's state needs a mouse gesture to have happened first, and the site
      panel cannot be opened without one. The panel's own controls ARE proper
      keyboard-operable buttons once it is open — which is what makes this a
      reachability gap rather than a rewrite.

- [x] ~~**THE DRAG PREVIEW DRAWS A CONFIDENT ROUTE ONTO A MOUNTAIN THAT THE ORDER
      THEN REFUSES.**~~ **FIXED, and the critic's untested extension turned out to be
      a SIM bug worth more than the preview one.** `marchBlocker` is now one
      predicate with three consumers; and `routeBlocker` extends it to every stop on
      a drawn route, because `passableFor` waives the terrain check for each A* leg's
      GOAL — so only the final hex was ever validated and a road drawn deliberately
      through a mountain was ACCEPTED, producing a squad whose path stood on blocked
      rock. Provably inert on balance: `waypoints` appears nowhere in `tools/` or
      `battle/ai*.js`. Original:

      **THE DRAG PREVIEW DRAWS A CONFIDENT ROUTE ONTO A MOUNTAIN THAT THE ORDER
      THEN REFUSES.** A reproducible counter-example to "the preview never lies",
      softened by a clear worded rejection and no lost troops — but it is the one
      invariant this project treats as load-bearing, so it should either be fixed
      or the invariant's scope written down honestly.

- [ ] **SITE HIT-TARGETS FALL TO 34px (farm) / 31px (watchtower) AT THE DEFAULT
      ZOOM ON THE BIGGEST MAPS** — under the 44px guideline on exactly the boards
      that carry the most simultaneous action. Player-fixable by zooming, but the
      default state is the one that matters. Related to the readability critic's
      independent finding that widowsgate renders at 34.9 px/hex against
      riverfen's 65.8.

- [ ] **SEVERAL FREQUENTLY-USED HUD BUTTONS ARE 32px TALL ON A DESKTOP SESSION.**
      The coarse-pointer media query is verified working, which is why the phone
      audit passes — it simply does not apply to a mouse or trackpad.

### From the board-readability critic

- [ ] **AMONG THE COLUMNS A PLAYER CAN ACTUALLY SEE, NOTHING DISTINGUISHES A NUISANCE
      FROM AN ASSAULT.** Every inbound force is the same red pennant at the same opacity;
      the only signal is a numeral, and the pennants overlap and stop being individually
      countable above ~4-5. Contrast measured off the rendered pixels rather than off the
      tokens: enemy pennant red against owned-territory green is **2.24:1** — below
      WCAG's 3:1 bar for graphical objects, and *less* contrast than a friendly marker
      gets against the same fill (3.83:1). Enemy red against the danger-alert red is
      **1.23:1**, so "whose troops" and "how urgent" share one hue almost exactly.
      Meanwhile the alert names a site (`ATTACKED — training ground will fall`) that the
      board gives no visual priority to whatsoever: the player must find it among 3-6
      similar glyphs and trust the text over the picture. On one gallowmoor screenshot,
      five enemy counts (5, 7, 8, 7, 6) sat within a screen-width of the player's own
      green counts (56, 1, 4) at nearly the same size — "7 8" beside "56" close enough to
      misread as one run of digits.

- [x] ~~**Decide: fewer, larger enemy columns, or a board that tells threat from
      traffic.**~~ **DECIDED — the board, not the balance**, and the critic's own
      measurement is what decides it. `canSee` grants sight from three sources only
      (the per-site vision map, a fight you are yourself party to, and a radius-1 bubble
      around your own squads), so the documented ~106 columns/minute overwhelmingly
      happen where the player cannot perceive them at all. Reproduced twice: the enemy
      reached and fought a neutral garrison at hex-distance 2 and 5 from the player's
      camp with `state.vision.player` false at that hex both times, and the screen pixel
      there sampled flat `rgb(16,20,26)` — identical to unrelated fog. So "too many
      columns" is largely not a player-facing problem, and re-tuning `concurrent` /
      `freeLunchHexes` would spend a campaign-wide balance change on traffic nobody sees.
      The player-facing problem is the narrower one above, and it is render-only.

- [ ] **NOTHING DISTINGUISHES "UNSCOUTED" FROM "NOTHING IS THERE".** 85-90% of the frame
      is flat near-black on both screenshots taken, which matches the documented opening
      and does not stop being true mid-battle on a beachhead-sized empire. A new player
      has no way to tell fog from empty ground, and most of the frame is therefore not
      information but the absence of it. Cheap partial answer: the board already knows
      the shape mask and the grid, so out-of-play rock and merely-unlit ground could read
      differently without revealing anything.

- [x] ~~**The alert names a site the board gives no priority to.**~~ **FIXED** — one
      decision (`alarmSite`), two surfaces, four red corner brackets on the named site.
      Verified in a real browser: 137 red pixels with the mark on, zero with it off.

- [x] ~~**THERE IS NO ARMY CENSUS ANYWHERE IN THE HUD, and this is the same blind spot
      the project already diagnosed for the BOT.**~~ **FIXED** — `N troops · M marching`
      under the income breakdown, and it turned up a real omission underneath:
      `armySize` promised "anywhere" and never counted a column in a field battle, so a
      faction's total dipped for six seconds every time it attacked anything.
      Superseded detail below, kept for the reasoning.

      **THERE IS NO ARMY CENSUS ANYWHERE IN THE HUD.** Gold gets a running total *and* a
      rate; troops get neither. Enumerated from source across `buildReadouts`/
      `buildFrame`/`battle-panel`/`battle-econ`: there is no number for how many bodies
      you command, how many are standing in a garrison versus marching, or how many
      orders are in flight. CLAUDE.md writes that exact blind spot up at length on the
      harness side — *"1,092 bodies and only 239 of them are standing anywhere"*, 78%
      permanently in transit — and treats it as a first-order balance concern. The human
      player has the identical visibility problem and no readout to notice it by.
      A single `N marching / M garrisoned` figure beside GOLD answers it, and it is the
      cheapest item in this section: the tally beside it (`SITES 3 v 5`) is the exact
      shape and the exact place.

- [ ] **THE HUD IS GOOD AT SINGLE FACTS AND HAS NOTHING THAT AGGREGATES.**
      **PARTLY ANSWERED** — the army census landed, and the board now marks EVERY
      live threat rather than the most recent, so "several threats at once" is
      answered positionally instead of by a count (which is better: it says where).
      What is left of this item is the alert strip itself, which is still
      last-write-wins, and `STALLED` still competing for the same line as a rejected
      click.

      Original: The critic's
      own summing-up, and it is the thread through three of its five sections: one gold
      number, one site count, one alert. The moment the game produces several
      simultaneous facts of the same kind — several threats, several fronts, an army
      spread over dozens of columns — nothing is built to rank or total them. The alert
      strip cannot say "3 sites under attack"; it can only narrate the most recent
      event, and `STALLED` competes for the same single line as a rejected click.
      Worth deciding as one question rather than three, because a threat COUNT, an army
      census and an alert queue are the same missing affordance seen from three angles.

- [x] ~~**THE CASTLE GATE IS BURIED ONCE THE BATTLE STARTS.**~~ **FIXED** — the
      objective line, which was one fixed sentence for the whole battle, now carries
      `hold N% of M%` and turns the player hue the moment the gate clears. A region
      with no gate still gets the plain sentence, because five ship `castleGateFrac: 0`
      and this project has already shipped a coach line describing a gate that was not
      there. Original:

      **THE CASTLE GATE IS BURIED ONCE THE BATTLE STARTS.** It was surfaced on the world
      map and the pre-battle brief by an earlier pass, but in battle it appears only
      inside the castle's own site panel, and only once a siege is already active. Over a
      10-20 minute fight a player has nowhere to re-check "am I clear to besiege the
      throne yet" without knowing to click that one building.

- [ ] **TERRITORY FILL IS NEAR-ISOLUMINANT AND THE WEAVE IS DOING MORE FOR A TEST THAN
      FOR A GLANCE.** Measured off real pixels: player fill `rgb(34,70,63)` against enemy
      `rgb(84,41,44)` is **1.175:1**, deep in "identical grey" territory under
      desaturation. The `ownerWeave` fix does inject a genuine hue-independent signal —
      independently re-verified here by a directional-gradient measure that reverses sign
      between the two factions (0.68 vs 1.50) — but it is subtle enough that it protects
      an automated check more than a five-second look. `ownerDash`'s solid/dashed/dotted
      site outlines are the robust channel and they only cover building glyphs, not the
      ground fill that is most of the screen. **Recorded rather than actioned**: the
      weave was measured and shipped deliberately, so this is a request to re-judge its
      strength, not a claim that it is broken.

- [ ] **SCALE IS UNDIFFERENTIATED, AND IT MAY BE CORRECT.** The camera auto-fits the
      whole grid once, so a bigger board is not panned into, it is shrunk to match:
      riverfen renders at **65.8 screen-px per hex-distance and widowsgate at 34.9**, a
      1.89x ratio against the 1.84x that "fit the area" predicts — so the fit is doing
      exactly what it says. Numbers stay legible (`LABEL_PX` is genuinely zoom-invariant,
      confirmed in source and in a matched crop); what shrinks is the silhouette that
      says *what kind of building* and the room between glyphs. Net effect: a
      1-site-left, camp-under-siege moment on the biggest map in the game is visually
      almost indistinguishable in complexity from an ordinary opening on the smallest.
      **Filed as a judgement call, not a defect** — the alternatives are a comically
      small starting cluster or making a new player pan before they can read anything.

- [x] ~~**A STATIONARY CLICK ON BARE BOARD DOES NOT CLEAR THE SITE PANEL.**~~
      **FALSE, on both the mechanism and the symptom — struck rather than deleted,
      per rule 7.** The claim was that `view.selection` is reset only by `boxSelect`
      and a zero-distance click is a no-op. `battle-input.js tap` has always ended
      `!hit` with `ord.selectOnly(null)`. Checked in the real browser with real
      pointer events, at a point asserted to hit-test to `#board-fx`: clicking a
      player site gives `selection: ["camp"]`, clicking bare board gives
      `selection: []`, and the panel settles at `opacity: 0`, `visibility: hidden`,
      with a hit-test at its own centre landing on the canvas behind it.
      **What made it look true is worth keeping**: the panel fades rather than
      un-mounting, so a sample taken 250ms after the click reads `display: flex`
      and a 217x82 box — opacity does not collapse layout — while the opacity at
      that instant was 0.000156. A probe that measures a box mid-transition will
      report a dismissed panel as a live one.

**WHAT THIS PASS SHIPPED, so a resume does not redo it:** the empty-booster false
affordance; the results screen's two false claims (the no-gate territorial claim and
"nothing was lost but time"); the stalemate signal; the castle gate shown before the
fight; the why-line's visual priority; the empire readout during a battle; and the
battle-length guard (`tests/battlelength.test.js`, which fails on purpose — it is the
re-tune's acceptance test). Findings LOGGED but deliberately not acted on: the enemy's
column throughput, the opening's zero visible targets, and the advertised-length drift,
all three of which are balance or design decisions rather than defects.

**From my own pass** (hands-on, before the specialists landed):

- [x] ~~**An empty booster armed itself and told the player to aim it.**~~ **FIXED.**
      A fresh save brings no charges (relics buy them, and relics are paid only for a
      region you have BEATEN), so battle one shows five live controls all reading a dash.
      Measured live: pressing one ARMED it, the alert read `AIMING RALLY — click a site ·
      Esc cancels`, and the refusal came on the SECOND click — after the player had done
      what the game told them. `boosterBlocker` is now one predicate shared by the HUD
      and `cmdBooster`, the `buildBlocker` pattern.

- [ ] **THE GAME NOW PROMISES A 16-20 MINUTE BATTLE FOR FIFTEEN OF TWENTY-FOUR REGIONS,
      AND THE DESIGN DOCS STILL SAY 7-15.** Read straight off `regions.data.js` with the
      hard cap derived the way `HARD_CAP_MIN_BY_TIER`/`HARD_CAP_RATIO` derive it:

      ```
      tier 1   7.5 - 10 min   (cap 14-19)
      tier 2   6.5 - 9        (cap 14-17)
      tier 3   19 - 20        (cap 36-38)   <- and this is the LONGEST tier
      tier 4   16             (cap 30)
      tier 5   16 - 18        (cap 30-34)
      tier 6   16 - 18        (cap 30-34)
      ```

      Three separate problems, and only the first is the retune's:
      1. **The lengths are mid-binary-search** — the in-flight retune raised them off a
         stale pre-melee promise precisely so `hardCapMs` would stop pinning battles to a
         clock they cannot resolve inside. So the VALUES are provisional. Say so before
         quoting them.
      2. **The SHAPE is wrong whatever the values settle to.** Tier 3 promises longer than
         tiers 4, 5 and 6. A player who has just spent twenty minutes on gallowmoor is
         told the tier-6 opener is a sixteen-minute fight. Nothing in the game explains
         that, because it is not explicable — it is an artifact.
      3. **Nothing asserts anything about this column.** `tests/campaign.test.js` pins
         `enemyMult` non-decreasing, total sites non-decreasing, the opening ratio, the
         gate ceiling — and says nothing at all about advertised length, which is why it
         could drift from 6-9 to 16-20 without a single test noticing.

      **This is a FUN problem before it is a balance one.** Both `CLAUDE.md` and this
      file state the premise as "a battle is 7-15 undistracted minutes", and this file's
      own "Sessions you can actually fit into a day" section is built on it. A
      twenty-minute advertised fight with a thirty-eight-minute cap is a different
      product from the one those sections describe. **Somebody has to decide which one
      this is** — and then the guard is cheap: a ceiling and a shape test beside the
      other campaign invariants.
      *Do not fix the numbers here* — that is the retune's job and it is mid-search.
      What is safe to land now is the guard and the corrected premise.

- [ ] **AT TICK 0 THERE ARE ZERO KNOWN ENEMY OR NEUTRAL SITES, SO THE ENTIRE
      "SELECT THAT BUILDING AND ATTACK IT" VOCABULARY HAS NOTHING TO OPERATE ON.**
      Measured off the real `buildBattleConfig`/`startBattle` pipeline, riverfen, seeds
      1/7/42/99 — every one reads `sites 11 · mine 3 · seen 3 · known non-player sites 0`.
      Not "few". Zero, on every seed.

      Driven in the browser it is worse than the number sounds. A policy that plays the
      way an RTS player thinks — pick my biggest garrison, pick the nearest building I
      can see, drag between them — issued **zero orders in 340 seconds of in-game time**
      while the enemy grew 5 sites to 8, because its target set never became non-empty.
      The only legal opening move in the game is a march onto BARE GROUND.

      This is the deliberate fog rule working as designed, and `COACH.drag` was already
      rewritten to teach the ground rather than a building for exactly this reason — so
      this is **not** a bug and the fix is not "show the buildings". What it is, is the
      single largest departure from genre convention in the product, it is TOTAL rather
      than partial, and it compounds with the open item below about the objective naming
      a castle that is not on the board. Together they mean the first thirty seconds ask
      the player to unlearn the genre with one line of text as the only guidance.
      **Worth a deliberate decision rather than an inherited one.** Cheapest honest
      options, none of which reopens the fog rule: a second coach beat that fires if no
      order has been given by ~20s; the beachhead's own sight radius raised by one so the
      opening lights a neighbour or two; or the bearing marker proposed for the castle,
      which would at least give the first drag a direction.

- [ ] **THE ENEMY LAUNCHES A HUNDRED COLUMNS A MINUTE AND THE MEDIAN ONE IS TWO TROOPS.
      THE BOARD IS WEATHER, NOT AN OPPONENT.** Instrumented over real battles
      (`startRun`/`playerTurn`/`step`, seed 1000, the shipped bot as the player):

      ```
                  minutes   enemy columns   per minute   median size   field battles
      riverfen      13.6              78          5.7             2              73
      gallowmoor    20.0           2,114        105.7             2           1,150
      ```

      From region 1 to region 10 the enemy's column count rises **27x** while the median
      column stays at **two troops**. It is not making bigger decisions as the game gets
      harder; it is making vastly more, equally tiny ones.

      **1,150 field battles in one twenty-minute battle is roughly one per second**, and
      a melee runs for `MELEE.seconds` (6), so something like six fights are open at any
      instant, permanently. Nothing at that rate can read as an event: every combat
      flash, every casualty number, every capture is firing continuously.

      **It is the configuration, not a bug.** Tier 3 is `reactionTicks 26, concurrent 2`
      with `AI.maxSources 3` and `AI.freeLunchHexes 3`, so 462 thinks x up to 9 squads is
      a ceiling of 4,154 columns — the measured 2,114 is the AI running at about half its
      own permitted throughput, continuously. Most of it is the free-lunch phase, which
      by design spends no concurrency slot.

      **And BOTH sides do it.** CLAUDE.md already records the harness bot with 78% of its
      army permanently in transit and 1,092 bodies of which 239 are standing. So this is
      a systemic property of the design — free movement plus cheap sends plus a
      free-lunch phase — rather than one actor's defect, and it is very likely upstream
      of the tier 3-6 tuning trouble: a permanent grinder is hard to tune because nothing
      in it is decisive.
      **The alert strip already rescues the WORDS** (`ATTACKED — farm will fall`,
      `UNDER SIEGE — farm` both fire correctly and name the real threat), so what is
      missing is on the BOARD: an incoming two-troop free-lunch grab and an incoming
      assault look identical. Two directions, and they are not exclusive — make the
      enemy commit fewer, larger columns (a floor on column size, or spending a
      concurrency slot on free lunches), or make the board distinguish a threat from
      traffic. The first is a balance change and needs the re-tune; the second does not.

**⚠ FOUR OF THE SIX SPECIALISTS DIED TO A SESSION LIMIT BEFORE WRITING ANYTHING.**
`crit-difficulty.md` and `crit-idle.md` landed and are transcribed below. **Game feel,
hours 2-10, board readability, and input/accessibility were never reported** — those four
lenses are still unexamined and are the first thing to re-run. Do not go looking for
their files; they do not exist.

### From the difficulty-and-failure critic

- [x] ~~**THE "WHY" LINE CLAIMS THE COUNTRYSIDE WAS YOURS WHEN IT WAS NOT — and it is a
      bug in the branch whose own comment says it must make no claim.** `resultReason`'s
      `need <= 0` arm returns `RESULTS.whyClockOnly`, whose text is *"The countryside was
      yours and the gate was open — the throne simply outlasted the clock."* That is a
      positive territorial claim, and the comment two lines above it says the opposite is
      intended (*"there is no territory claim to make, so make none"*). Five regions ship
      `castleGateFrac: 0` — all of tier 1 plus kaldan — so on those, ANY timeout prints
      it regardless of the ground held. Reproduced twice: riverfen held **3/11 (27%)**
      and kaldan **2/18 (12%)**, both told the countryside was theirs. The `whyGateHeld`
      branch is fine and the mechanism is fine; the fallback needs its own string.**~~
      **FIXED** — `RESULTS.whyNoGate`. The test that should have caught it had encoded
      the defect (it asserted the branch equalled a named constant, and the constant was
      the wrong one); it asserts the PROPERTY now, with the cleared-gate line as the
      negative control.
- [x] ~~**"NOTHING WAS LOST BUT TIME" IS FALSE IF YOU FIRED A BOOSTER.**~~ **FIXED.** `applyOutcome`
      calls `consumeBoosters` unconditionally, before the win/loss branch, and
      `boosters.js consume()` has no loss refund. A charge costs 1-3 RELICS, the scarce
      currency you cannot grind. So a player who spends relics trying to save a battle
      they lose is told nothing was lost — two lines above the stat row that correctly
      reports the charges spent. **Invisible to every measurement this project has, by
      construction: the harness always launches with `boosters: []`.** The copy branches
      on `applied.boostersConsumed` — what was actually deducted from the player's stock
      rather than what the battle fired — so the headline and the "Charges spent" row now
      agree by construction.
- [ ] **A TIMED-OUT BATTLE IS OFTEN INFORMATIONALLY DEAD FOR MOST OF ITS RUN, AND THE
      PLAYER PAYS THE WHOLE CLOCK.** `endPhase` only assigns `timeout` at
      `hardCapTicks`, so every timeout runs the full advertised cap. Traced tick by tick:
      **widowsgate locks at 7 v 48 by minute 9 and does not move a single site for the
      remaining 25 minutes** (74% of a 34.2-minute battle); gallowmoor locks at 44 v 26
      by minute 26 and sits for 12 more — and that one had already cleared its gate, the
      throne siege simply never finished. Duskfell is the counter-example and shows the
      mechanism is not always bad: genuinely contested to the wire, decided in the last
      5% of the clock. **This is a property of hard-cap-as-verdict, not of today's dial**,
      so the re-tune does not fix it.
- [x] ~~**NOTHING SIGNALS A STALEMATE, SO THE FREE ESCAPE HATCH NEEDS THE PLAYER TO
      SELF-DIAGNOSE.**~~ **FIXED** — `battle-alert.js stalemateCheck`, a pure fold over
      the site tally with the thresholds injectable. Three minutes of a board that has
      not moved raises `STALLED — no ground has changed hands in N minutes. Withdraw
      costs nothing but the time already spent.`, repeating no oftener than every two.
      It WARNS and does not act, because a still tally is not proof of a lost battle —
      duskfell, measured, was contested to the wire. Live: fired at 249s and again at
      370s on a frozen board. Withdraw is always visible and genuinely free (`stats.losses` is
      not incremented for a retreat), so the tool to cut a 34-minute frozen loss to a
      9-minute one already exists. Nothing measures or surfaces "territory has not moved
      in N minutes". In the widowsgate trace a player had a 25-minute window to make that
      call entirely unaided.
- [~] **THE PRE-FIGHT READOUT CANNOT DISTINGUISH REGIONS WITH DOUBLE THE WIN RATE, AND
      NEVER SHOWS THE GATE.** ~~The gate half is FIXED~~ — `Throne holds until: you hold
      N% of the map` on both the world map and the loadout brief, omitted entirely where
      there is no gate (five regions ship one of 0, and "0%" reads as a requirement
      rather than as its absence). It shows the CLAMPED campaign figure, and on an
      incursion it asks `incursionRules` so a `sealed` rung advertises its own raised
      gate (72% against the arena's 60%) rather than the arena's.
      **STILL OPEN: the in-battle half**, which is the harder one — a live "you hold X%
      of the Y% needed" needs the total site count as a denominator, and fog hides how
      many sites exist. And the identical-display problem is untouched: `duskfell 4.45`, `karrowmere 4.48`, `vaelstrand 4.38` all
      render as "x4.4"/"x4.5" on an identical layout; the project's own in-flight n=24
      screen reads karrowmere 38% against vaelstrand and duskfell at 17%. `castleGateFrac`
      is never shown before the fight — and in-battle it appears ONLY inside the castle's
      own panel and ONLY once the throne is already under siege, because `castleSealed`
      requires an active siege. So a player correctly securing the countryside for 25
      minutes has no ambient way to know whether they are 2 points short of the gate or
      47. (The dial figures are mid-retune; the identical-display fact is not.)
- [ ] **THE TWO LOSS BRANCHES EXPLAIN THE MECHANISM, NEVER THE CAUSE.** "Your camp fell"
      and "Nothing of yours was left on the board" are both true and both better than the
      old bare stat rows, but neither says whether the camp was overrun or simply left
      empty — and the sim records nothing `resultReason` could read to tell them apart.

      **⚠ THE EVIDENCE FOR THIS ONE DID NOT REPRODUCE, AND THAT IS WHY IT IS STILL
      UNBUILT.** The report's supporting number — *"7 of 13 sampled battles ended this
      way"*, with vaelstrand losing both its sampled seeds to the camp falling inside ten
      minutes — was checked before spending a CONTRACT BUMP on it. Re-run through
      `startRun`/`playerTurn`/`step` at the harness's own defaults (`idleMinutes` 10, the
      real `before` list), **the camp did not fall in EIGHT of eight vaelstrand seeds** —
      four arbitrary (0/1/2/3) and four of the harness's own (1000/8919/16838/24757).
      Seven timed out and one was won, ending on 10 to 68 sites.
      The likeliest explanation is a harness setup difference — `idleMinutes: 0` or an
      empty `conquered` list makes a far poorer player who loses fast — which is exactly
      the trap this project already records for `--weights` and for the seed prefix.
      **So the DESIGN point may well stand for a human, who plays worse than the bot; the
      MEASUREMENT behind it does not.** Anyone picking this up should re-establish the
      frequency first, because the fix costs a `CONTRACT_VERSION` bump (the sim would have
      to record the camp's garrison at the moment it changed hands) and that is not a
      price to pay for a number nobody can reproduce.
- [x] ~~**The why-line has no visual priority over the flavour line above it.**~~
      **FIXED** — it outranks the flavour line on two channels now rather than one:
      14px against 12px, and `--c-text` against `--c-text-dim`. Colour alone was not
      enough separation at 12px, which is what the review's own screenshot showed. Still
      not tinted by result and still not bold: the point is that the eye lands there
      first, not that the game is shouting.

### From the idle-half critic

*Its headline verdict is worth keeping: the idle ECONOMY is genuinely well-built —
honest caps, provably seamless online/offline math, prestige legible before you commit —
but **the only infinite, ever-escalating system in the game (the incursion ladder) is
the one an idle player can never touch**, because auto-resolve is restricted to raids.
The idle half is a well-made finite game; "endless" lives entirely in the RTS half.*

- [x] ~~**A PLAYER WHO NEVER OPENS THE SHOP IS CAPPED AT EIGHT OFFLINE HOURS FOREVER.**~~
      **FIXED.**
      The offline cap is gated entirely on Treasury levels. At full conquest that is
      roughly **55 million crowns silently discarded on one missed day**, for a play
      style this genre's audience plainly contains (engage with the RTS, ignore the
      meta-shop). The away banner now explains it after the fact — which is most of the
      fix and shipped this session — but nothing warns before the cap binds, and nothing
      on the world map says "your cap is still at the floor".
- [x] ~~**THE IDLE ECONOMY IS INVISIBLE FOR THE ENTIRE LENGTH OF A BATTLE.**~~ **FIXED.** Code search:
      **zero** UI surface under `src/screens/battle*` reads crowns or income. For a game
      whose one-line pitch is idle income married to real-time conquest, the two halves
      never appear on screen together — for 8-20 minutes at a stretch, which is most of a
      session's wall clock. `EMPIRE · 12K crowns · +15.0/s` under the objective now, gold
      hue so it cannot be read as the battle treasury, and HIDDEN until there is something
      to show: during battle one both figures are zero and a row of zeros in the most
      crowded minute of onboarding teaches less than the results screen already does. It
      first appears in battle two, which makes it a reveal rather than a readout.
- [ ] **Four of twenty-four shop waypoints miss the project's own ~180s
      time-to-next-purchase pacing target** (up to 316s), clustered at the tier 3→6
      transition. Never felt in practice because the next battle absorbs it — flagged
      only because it is a target the codebase states explicitly and measurably misses.
- [ ] **No auto-spend toggle**, though "Spend all" and per-line "x10" already remove most
      of the tedium. Low cost; listed for completeness.

<!-- MORE FINDINGS GO HERE as the four unreported lenses are re-run. -->

### From the tactical-depth critic

**The lens: is there a real game of decisions in the battle layer, or is it "bring more
troops and click"?** Driven from a clean detached worktree (`git worktree add --detach`)
because this tree is edited by concurrent sessions — worth copying, and worth knowing
that a balance number taken off a dirty tree is somebody else's in-flight probe.

- [ ] **THE HARNESS ISSUES 4 OF THE ENGINE'S 12 VERBS, and eight have never been through
      this project's own stated test of legitimacy.** Verified by grep, both directions:
      `HANDLERS` in `src/battle/commands.js` binds `SEND MOVE_SQUAD TRAIN RECRUIT UPGRADE
      BUILD RALLY RALLY_KEEP BOOSTER RETREAT RETREAT_SQUAD WITHDRAW`, and every
      `t: '…'` literal anywhere under `tools/` is one of exactly four: `SEND`, `TRAIN`,
      `UPGRADE`, `BUILD`. So `MOVE_SQUAD`, `RECRUIT`, `RALLY`, `RALLY_KEEP`, `BOOSTER`,
      `RETREAT`, `RETREAT_SQUAD` and `WITHDRAW` are measured by nothing at all — against
      a rule this file and CLAUDE.md both state about six times over ("a mechanic the
      harness cannot play is a mechanic nobody has measured"). **This is the finding to
      act on before the other four**, because it is the one that makes the others
      checkable.

      Two of the eight are known to matter and are known to be unmeasured for opposite
      reasons: `RETREAT` mid-melee is the one genuinely two-sided dilemma in the battle
      layer (`melee.js meleeStep` interpolates linearly toward a known outcome, so
      breaking off provably keeps proportionally more troops the earlier you do it) and
      the bot's 1.5x `ATTACK_MARGIN` keeps it out of every situation that would pose the
      question; and `MOVE_SQUAD` was shipped, documented in four places, and had exactly
      one caller in the whole tree (a test fixture) until this session's own camped-drag
      pass.

- [x] ~~**`ATTRITION` changes real numbers with no on-screen cause.**~~ **DONE —
      surfaced, not deleted.** The finding held with one correction: the only mention
      outside `battle/` and `content/` was a COMMENT in `battle-econ.js` (the critic said
      zero), and that comment is right about the HUD including the ladder in its income
      figure — which is not the same as telling anyone. `EVENTS.ATTRITION_STAGE` had been
      pushed since the phase was written and had never had a consumer.

      `RESULTS.attrition` is one line per rung, each naming what THAT rung does rather
      than warning in the abstract, and each saying it applies to both sides — which is
      what makes pressing the answer and waiting not. Stage 0 is silence on purpose: the
      ladder retiring means ground just changed hands, and "the country has recovered" is
      a message nobody needs while they are busy taking the thing that recovered it.
      Confirmed live at 4x with nobody giving orders: rung 1 at 259s, rung 2 at 323s,
      correct text, danger tone.

      **The harness half of the finding is still open** and is the more interesting one:
      `tools/` never reacts to attrition either, so the bot plays through a ladder it
      cannot see any more than the player could.

- [ ] **The bot never builds a defensive structure, and `TRAIN` never reads the enemy.**
      Both confirmed still true in current code. `constructTurn` is a binary
      yard-or-farm branch that cannot produce a stronghold at any pressure; `TRAIN` is a
      binary rams-or-militia branch that never consults the enemy's composition, in a
      game that ships a full counters table for exactly that read-and-react loop. The
      first half is already an open item below; the second is new. Until both exist, no
      measured number can tell real depth from unused scaffolding.

- [ ] **Tower fire is paid-for complexity with almost no reachable audience.** `findPath`
      has no danger weighting, and neither the enemy AI nor the harness has ever issued a
      waypoint-routed order — zero hits for "waypoint" anywhere in `battle/ai*.js` or
      `tools/`. So the only actor who can ever answer "route around the wall" is a human
      who independently discovered a gesture no `COACH` line mentions. Teach it or cut
      it.

- [ ] **Don't anchor the project's #1 problem to a single region's test.** See the
      warning immediately below — the canonical regression test for the dominant loadout
      is pinned to gallowmoor alone, and gallowmoor is mid-retune. Pin it to two.

**⚠ AND THE HEADLINE IS A WARNING ABOUT A TEST, NOT A FIX.** The critic found
`tests/loadoutdominance.test.js` FAILING on a clean HEAD worktree — `mono-militia beat
the default spread by only 0 points (38% -> 38%)` at n=24 on gallowmoor — and its own
independent n=12 probe read default 42% / mono 25%, i.e. mono *worse*. Both contradict the
`+27 to +44` this file and CLAUDE.md carry.

**Do not read that as the exploit being fixed.** The gap closed because the DEFAULT SPREAD
collapsed to gallowmoor's out-of-band 17-38%, not because mono got weaker — which is
exactly the failure mode that test's own message warns about, and exactly the shape of
"the harness declining to play read as a balance win" this project has hit twice. The
underlying phenomenon reproduces cleanly on a region the re-tune has NOT touched: kaldan,
default 58% -> mono 83%, **+25**, matching the historical pattern. **The exploit is real
and the instrument is anchored to the wrong region.**

**⚠ THE KALDAN NUMBER IS WRONG AND THE CONCLUSION DRAWN FROM IT IS BACKWARDS.**
Re-measured with the harness's own matched seeds: **+12 at n=24, +8 at n=48** (73% ->
81%), not +25. And +8 is not a weak reproduction — it is kaldan's recorded value as the
CONTROL, which the dominant-loadout table further down this file already lists as
`+0 / +8` beside the note that kaldan is what says this is a late-campaign hole rather
than a global one. So the critic's structural point stands (one region is not enough to
carry the project's #1 problem) and their proposed fix would have pinned the exploit to
the row that documents its absence. The n=48 figure landing exactly on the recorded one
is the strongest evidence available that kaldan is behaving as it always has.

**What already works, from this lens:** the four-invariant discipline is real and rare —
`projectMarchLosses`/`projectGarrison` genuinely match the sim, so "the preview is a
guarantee" is a guarantee. The base five-unit RPS plus slot pricing is internally coherent
and independently verified (`tests/units.test.js`, 11/11, confirms each specialist is the
objectively correct narrow answer to a narrow problem — sappers make a garrisoned wall
arithmetically unbreachable against a force that cracks the same wall without them). The
siege frontage is clean, sharp, well-tested design. The melee retreat maths is exactly
right on paper.

**A methodology note the critic flagged against itself, worth copying:** passing
`{weights: {halberds: 0.3}}` straight to `playOne` BYPASSES `meta/composition.js
fitComposition`'s merge with `DEFAULT_COMPOSITION_WEIGHTS`, which `tools/simrunner.js
--weights=` performs — so a probe written that way measures a near-MONO specialist army
and reports it as "the default spread plus halberds". A near-mono-sapper army (atk 3, the
lowest offence in the game) collapsed to 0% wins in 21 seconds, which is a vivid
confirmation that sappers cannot carry an attack and no evidence at all about the
question that was asked.

### From the first-session critic

**The lens: the first twenty minutes, played cold.** Driven through CDP against a
genuinely wiped save. **The wipe itself is a finding worth keeping:** `localStorage.clear()`
is silently undone by a save-on-unload handler re-persisting the in-memory state, so a
"fresh save" probe has to go through browser-level `Storage.clearDataForOrigin`. Every
"fresh save" script in this repo should be checked against that.

- [ ] **A brand-new visitor is dropped into a live, already-ticking battle.** Wiped twice
      independently, with and without `?dev=1`: `document.body.dataset.scene` is `battle`
      on load, gold already draining at -1.0/s from tick 1. No title screen, no New Game,
      no settings. The actual title screen ("HEX DOMINION" / "Two clocks, one empire.")
      exists only behind a Menu tab on the world map, reachable only *after* the first
      battle is finished or abandoned. This is `worldmap.js bootRoute` working exactly as
      designed — the design is the finding.
- [x] ~~**The loadout screen hides part of the player's own army, with no cue.**~~
      **DONE, and the mechanism is not the one filed.** `.pb-body` has always been a
      scroll container (`overflow-y: auto`), so the rows are reachable — but the platform
      draws an OVERLAY scrollbar, measured at **0px wide**, so nothing whatsoever
      indicated them. Re-measured across three viewports at a nine-unit roster: at
      1440x900 (`innerHeight` 761) the last row's bottom is 753, eight pixels of margin;
      at 1440x800 two rows are past the edge and at 1440x720 four are, with **210 pixels
      of expedition hidden** in the 800 case.

      `.pb-body.has-more` masks the bottom edge, toggled from `prebattle.js` on paint,
      scroll and resize — resize because the panel fits at 900 and clips at 800, so a
      window a player drags crosses the boundary with nothing re-rendering. Plus a stable
      gutter and a styled thin rail. `moreBelow()` is the rule as a pure function so the
      off-by-one is pinned rather than eyeballed, and the negative control is the one
      that matters: a fade on a panel that fits says there is more when there is not.
- [x] ~~**The one coach mark does not advance even when followed correctly.**~~
      **HALF FALSE, HALF WORSE — DONE.** The advance itself works: measured on a fresh
      save in a real browser, the strip retires within two seconds of a legal march. The
      critic was reading `data-beat` and `textContent`, and `hide()` cleared neither, so
      a hidden element still named the last beat SHOWN — the same probe artefact
      CLAUDE.md already records for the site panel reporting `display: flex` at opacity
      0.00016. `hide()` clears `data-beat` now.

      **The substantive complaint was real and bigger than filed.** After `drag` retires,
      every remaining beat waits on a siege or a capture — and `COACH.drag` instructs a
      march across the map, which causes neither. So a player who did exactly what they
      were told was taught one thing and then left in silence for the rest of the
      battle. That is the same quit point the `until` rewrite was added to close, one
      rung further along, and it opened when `drag` was rewritten to teach the GROUND
      after unscouted neutrals stopped being visible to point at. `COACH.tookGround`
      is the missing rung; it holds until they attack something rather than on a timer.
      Pinned as a property (the beat after a march must name a target and must not
      expire on a clock), not as a beat list, so a future rewrite cannot reopen it.

      **A probe warning worth keeping:** a drag that is refused leaves the coach
      correctly still asking for it, and a probe that does not check reports that as
      "the coach never advances". Mine did exactly that twice — once on an off-grid
      destination (`grid` is an OFFSET rectangle) and once on a swallowed gesture.
- [x] ~~**Nothing marks which glyph is your camp.**~~ **DONE.** `render/coachmark.js`
      floats a chevron over the building the coach line names, for as long as that line
      is up. A beat carries a KIND (`mark: 'camp'`); `screens/battle.js` resolves the site
      off the live battle, so the sentence and the mark cannot name different buildings —
      the rule `battle-alert.js alarmSite` already follows for the danger mark.

      **Two decisions a screenshot made, neither of which a test would have.** A wedge
      rather than a ring or brackets: the board already draws four rings and `alarm.js`
      has taken corner brackets to mean "in trouble", in the danger colour. And it is the
      COACH's accent blue, not the player's green — the first cut used `owner.player` and
      the camp is green, on green territory, under a green flood, so the mark was a shape
      to hunt for. `RISE` came down 2.9 → 2.35 for the same reason: measured, the first
      value put it 95-105 screen pixels above the glyph centre, about three times the
      glyph's own height, reading as something floating nearby rather than a mark on it.
- [x] ~~**"Away cap" — the number the entire idle pitch rests on — is explained
      nowhere.**~~ **DONE.** `UI.offlineCapHint` titles both halves of the pair (a player
      hovers whichever their pointer is over, so a title on one of two is a coin flip)
      and names the Treasury line, because wanting the number to be bigger is the whole
      reason to explain it. No `aria-label`: the label precedes the value in DOM order,
      so a screen reader already reads "Away cap, 8h".

      `IDLE.awayCapped` was already saying what happened AFTER a capped absence; this is
      the same claim before it bites, and it is guarded by the same test that guards that
      one. `worldmap.js` hit the line cap on the way, so the header — four figures, four
      ways off the screen — moved to `worldmap-header.js`.
- [ ] **Passive play ends on undefined developer jargon.** The "Time expired" screen is
      legible, correctly styled and carries accurate stats, but never states the
      actionable lesson, and "hard cap" appears on both it and the loadout screen with no
      tooltip anywhere. (This corroborates the already-recorded finding that a passive
      first battle is a twenty-minute stall ending on copy that reads as a clock problem
      rather than as "you never attacked".)
- [x] ~~**An empty booster gives no feedback at all** — no message, no shake — where the
      BUILD buttons in the same rail at least say "Not enough gold".~~ **STRUCK — FALSE
      against current code.** Reproduced on a fresh save in a real browser: the first
      booster in the rail is `booster is-empty`, a real pointer press hit-tests to it, and
      the alert strip reads **`RALLY: You did not bring that booster.`** immediately. That
      is the `boosterBlocker` fix CLAUDE.md already records; the critic's reading predates
      it or missed the strip.

      One true residual, recorded rather than fixed because it is worth almost nothing: the
      control itself does not shake. The shake rides `battle:command-rejected`, and this
      refusal happens in `boosterBlocker` BEFORE a command is issued, so the message
      appears and the button the player pressed does not acknowledge.
- [x] ~~**The unit tooltips are genuinely good and 100% hover-gated**, with no affordance
      suggesting they exist and no path to them on touch at all.~~ **STRUCK — the touch
      half is FALSE, and the real residual is a different bug.** Driven at 390x844 with
      `Emulation.setTouchEmulationEnabled` and a real `Input.dispatchTouchEvent`: the card
      opens on `touchStart` and is still open after `touchEnd`, carrying the full
      description. `attach` binds `pointerenter` and `click` as well as `focus`, and
      pointer events fire for touch.

      **What IS true and was not filed: tapping a chip to read it also flips the filter**
      (`militia: true -> false`, `chip is-on -> is-off`). On desktop hover reads and click
      acts, two gestures; on touch there is one gesture doing both. Recoverable in one tap
      and the card stays up, so it is minor — left alone rather than answered with a
      long-press, which would be a new gesture needing its own tests to save a state
      change the player can undo by repeating what they just did.

      The affordance half stands: nothing suggests the cards exist. Note the chips already
      carry a short version as their accessible name (`aria-label` reads "Militia — Cheap
      line infantry."), so a screen-reader user is not in the dark; a sighted one is.

      **A probe note that cost two runs:** the dock scrolls HORIZONTALLY at phone width, so
      the first `.chip` reported a centre at x=636 on a 390-wide viewport and every touch
      landed on nothing. Scroll it into view before hit-testing anything in that rail.
- [x] ~~**The Withdraw confirmation silently expires**~~ **HALF FALSE, HALF REAL —
      DONE.** It does not expire silently: `sync(0)` puts the label back to "Withdraw" and
      closes the hint, both visible. What was real is the WINDOW. `holdMs` was 4,000ms
      against a 95-character hint — "This gives up the region. Just closing the tab keeps
      it — the battle resumes." — which is about three and a half seconds of reading before
      the player has even decided, so the confirm could close while they were reading the
      thing it asked them to read. 8,000ms now, pinned against the length of its own copy
      rather than as a constant, with the disarm itself pinned as the half that must not
      be traded away: a confirm that stays armed turns a forgotten click into a withdrawal
      minutes later.

**What already works, from this lens:** the failure screens are well designed — amber for
a neutral Withdraw, red for Defeat, and the Defeat copy re-teaches the lose rule at the
moment it matters ("Your camp fell. Hold it: losing it ends the region however well the
rest is going."). The Withdraw confirmation pre-empts a real fear ("Just closing the tab
keeps it — the battle resumes."). The loadout screen is good at low unit counts, and its
booster panel explains *why* a booster is unusable better than the in-battle HUD does for
the identical state. The shop is clear, with a "Buy this next — cheapest first beats
saving up" recommendation. The alert strip names real threats promptly. Fog is honestly
rendered, and the always-visible terrain is what keeps an 85-90% dark opener from reading
as broken.


### Blocking — the deploy is red until this is done

> **⚠ IT IS FIVE TEST FILES NOW.** `tests/battlelength.test.js` joined the four below
> during the fun pass, and it is the same standing: an acceptance test for the re-tune,
> not separate work. Three of its four tests pass; the one that fails says the longest
> advertised battle in the campaign is in TIER 3 (gallowmoor/sunder/vaelstrand at 20
> minutes) rather than in the final tier (16-18). A later region promising a shorter
> fight than an earlier one is not something a player can be told. Full write-up in the
> fun-pass list above.
>
> **⚠ IT IS FOUR TEST FILES, NOT ONE, AND THEY ARE ONE ROOT CAUSE.** Everything below
> says `campaignplay` is the single red row. Measured against a pristine checkout of
> `da4ca6b`, running each long harness file alone (they need ≥180s each and the runner
> truncates when several sessions share the box):
>
> ```
> harness            11 pass  0 fail   ok
> scout               2 pass  1 fail   "never completed a single watchtower across
>                                        twelve tier-5/6 battles"
> tactics             9 pass  1 fail   "only 6 squads carried a rider at all"
> loadoutdominance    2 pass  1 fail   "mono-militia beat the default spread by only
>                                        8 points (17% -> 25%)"
> campaignplay        4 pass  1 fail   the documented stormhalt row
> ```
>
> All four are downstream of the campaign being out of band against the melee layer —
> three of them run real battles on tiers 5–6, which is exactly where the table no
> longer holds. **None is an independent defect, and two of them read like one.**
>
> **`loadoutdominance` is the dangerous one.** Its failure message offers two readings
> and invites you to take the wrong one: *"Either somebody FIXED the dominant loadout —
> in which case re-take these numbers, retire this framing and close the bullet in
> CLAUDE.md — or the weights stopped reaching the battle."* Neither happened. Read the
> figures: default **17%**, mono **25%**. The gap collapsed because the DEFAULT SPREAD
> fell to gallowmoor's out-of-band 17%, not because mono got worse. Do not retire that
> bullet. Re-take all four *after* the re-tune lands; they are its acceptance test, not
> separate work.

> **✅ RESOLVED, AND THE ANSWER IS NO — the block below was the top-ranked thing
> to do before moving another dial, it was BUILT (`tools/simpool.js`, `--pool`),
> and the hypothesis did not reproduce.** n=48, and the implementation is proven
> to reach the battle (the real-battle test groups commands by target and
> arrival tick and demands a wave drawing from two or more distinct sites, so a
> silent discard could not have produced this):
>
> ```
> gallowmoor   pooled 25%   unpooled 33%
> thanescar    pooled 27%   unpooled 23%
> ```
>
> Opposite signs, both inside the noise band. **So massing is not what the eleven
> below-floor rows are measuring, and the dial question is back on the table.**
>
> The per-seed evidence is worth more than the aggregate, because it is a
> different finding rather than a null: `simpool.js`'s target scan is ID-ordered
> over any reachable site and is **not weighted toward the throne**, so a pooled
> strike COMPETES with the bot's own "push the rear army forward" consolidation
> instead of reinforcing it. On thanescar seed 1000 it turned a clean 18-minute
> win into a 30-minute timeout, with all nine of its synchronized strikes
> landing on secondary sites and none ever aimed at the castle. Meanwhile pooled
> gallowmoor times out `ahead=31` against unpooled's `22` — more countryside,
> no closer to winning.
>
> **Both readings point the same way: the THRONE is the bottleneck, not the
> approach to it.** That is where the next look belongs — and the cheap version
> of it is to weight `simpool.js`'s scan toward the castle and re-measure, which
> is the one change that would justify flipping `--pool` on.
>
> It ships OFF, inverting the `--noX` house pattern deliberately: a wash with a
> known defect must not silently become the baseline every future number is
> measured against, least of all mid-retune. Proven inert where it is off —
> gallowmoor n=8 reads identically with the change present and with a clean
> worktree at the parent commit.
>
> *The original diagnosis is kept below, struck through in spirit rather than
> deleted, because the REASONING was sound and only the conclusion was wrong —
> and because a deleted item gets proposed again in three weeks.*
>
> **⚠⚠ ORIGINAL ENTRY — THE HYPOTHESIS, NOW DISPROVED. THE HARNESS BOT CANNOT
> CONCENTRATE FORCE, AND THAT IS ALMOST CERTAINLY WHAT THE ELEVEN BELOW-FLOOR
> ROWS ARE MEASURING.** The re-tune below diagnosed the stall correctly — a Marshal'd castle
> is never attacked, so it trains against zero attrition, and no rear site can mass a
> legal first strike — and then read it as a difficulty lever. It is an INSTRUMENT
> fault. Checked in the source, not inferred:
>
> - `tools/simplayer.js:138` is `for (const src of mine)`, and each source is handed
>   to `simtactics.js bestAssaultTarget(view, src, send)` **alone**. Every assault the
>   bot makes comes from ONE garrison, judged against `ATTACK_MARGIN` 1.5.
> - The enemy AI pools up to `AI.maxSources` (3) sites into one assault
>   (`aicore.js adjacentSources`).
> - The PLAYER now pools the whole selection (multi-site send, shipped this session).
>
> So the measuring instrument is the only actor on the board that cannot mass — against
> the one target that punishes not massing. Measured by the re-tune's own probe:
> thanescar's castle runs 96–241 troops while the biggest player site beside it never
> exceeds 11–30. No single garrison can ever clear 1.5×, so **no siege is ever opened**,
> which is exactly the "87% territory, castle at full HP, never besieged" signature.
>
> **This is the THIRD instance of a class CLAUDE.md already records twice** — the 90s
> siege budget that made mono-militia read 94% → 25% ("the harness declining to play…
> and it broke TOWARD the result somebody wanted"), and the `PRIORITY`/`advanceDistance`
> collapse worth 0% → 75% on gallowmoor. Both had the same tell the re-tune reports
> here: **no AI knob moves the region at all**, and further `enemyMult` cuts moved
> gallowmoor and thanescar the WRONG way twice.
>
> **So the next step is a harness change, not a dial.** Let an assault draw from several
> adjacent sources the way the AI's does, behind its own switch (`--nopool`) so the delta
> stays re-measurable — the house pattern `--noupgrades`/`--noconstruct`/`--noscout`
> already follow — then re-take one stuck row before touching `enemyMult` again. If the
> row moves, every number in the table below was measured against a bot that could not
> play the shipped game, and the re-tune restarts from there. If it does not move, the
> difficulty reading stands and this note costs one measurement.
>
> *(It did not move. It cost one measurement, which is exactly what this paragraph
> priced it at — and it bought a sharper question in exchange. The switch shipped as
> `--pool` rather than `--nopool`; see the resolution above for why the default went the
> other way.)*

- [ ] **The campaign re-tune against the melee layer.** Full brief in the section below
      (`Do this first`). **IN PROGRESS, substantial but not closed** — see CLAUDE.md
      ("Still open" -> the campaign re-tune, third pass) for the full, current write-up.
      Tier 1-2 (nine regions) are re-measured at n=48 and all read `ok`; three needed a
      dial change (ironwood, emberholt, greywater). Tiers 3-6 (fifteen regions) have a
      DIAGNOSED lever — a Marshal'd castle that is never attacked for a whole battle
      out-trains any one rear site's ability to mass a legal first strike, traced with a
      direct probe rather than inferred — and a `develop` cut applied against it. The n=24
      screen is now COMPLETE for all fifteen rows (`widowsgate` landed just as this was
      being written — the biggest board in the game, and this environment spent over
      ninety CPU-minutes on it before it produced a number):
      ```
      tier 3   gallowmoor 38  sunder 25  vaelstrand 17  duskfell 17  karrowmere 38
      tier 4   thanescar 29  blackspire 29  ironcrown 38 ok  obsidian 42 ok
      tier 5   ravensmarch 17  gravenreach 42 ok  nightharrow 29 ok
      tier 6   stormhalt 8  cinderwatch 13  widowsgate 4
      ```
      Every row improved from its pre-session reading. Four already clear their own band
      (ironcrown, obsidian, gravenreach, nightharrow) on the SAME cut applied to every row
      in their tier, so the lever is real. Eleven are still below floor: all five of tier 3,
      half of tier 4 (thanescar/blackspire), ravensmarch, and all of tier 6.
      **Three shapes only visible once the sweep filled in:** tier 4 SPLITS exactly down the
      middle on an otherwise-uniform cut (thanescar/blackspire below, ironcrown/obsidian
      comfortably above) — worth understanding before another blanket tier-4 move;
      ravensmarch is tier 5's one bad row by a wide margin (17% against 42%/29%), matching
      what an inherited n=8 quickscreen already hinted; and **widowsgate (4%) is now the
      single worst row in the table**, worse than stormhalt (8%), on the SMALLEST
      proportional `enemyMult` cut this pass applied to any tier-4-6 row — worth the next
      look ahead of stormhalt, which this pass already had a real-difficulty diagnosis for.
      Treat every number here as n=24
      (±10pt noise) — `tests/scout.test.js`/`tactics`/`loadoutdominance`/`campaignplay`
      were NOT re-run (each needs >=180s alone and the table is still unsettled).
      Do not re-spend `enemyMult` on the Marshal-affected rows — it moved gallowmoor and
      thanescar the WRONG direction at n=24 twice, consistent with noise once the
      `develop` cut was already in, which itself is consistent with the diagnosis
      (a consolidation race, not a power ratio). `siteCounts.neutral` is a confirmed,
      cheap, bounded lever in BOTH directions (this session, both signs measured).
      Next session: (1) re-take all fifteen rows at n>=96 before moving the dial again;
      (2) understand the tier-4 split and the ravensmarch/widowsgate outlier gaps;
      (3) re-run the five acceptance files one at a time from a clean worktree.
      For provenance, the OLDER n=48 table (immediately below, pre-this-session) was:
      riverfen 90 ok, kaldan 73 ok, gallowmoor 17 TOO SLOW, thanescar 6, ravensmarch 2 —
      riverfen's 90 already matches this session's fresh re-take (unchanged dial), so that
      part of the historical table is still good; the rest is superseded above.
      **⚠ `targetLengthMin` is NOT the binding lever on those two rows**, though it is
      everywhere else: the cap is a MAX against a per-tier floor
      (`HARD_CAP_MIN_BY_TIER = [12,14,17,20,24,28]`, ratio 1.9), and both are pinned to
      the FLOOR (nightharrow `max(24, 12.4)`, stormhalt `max(28, 17.1)`). Raising either
      promise moves nothing until it passes 12.6m / 14.7m. So the first decision is
      whether tiers 5–6 get a bigger floor or a faster battle.
      **Mind the order:** those rows have no wins, so there is no win-median to author a
      promise from. Lift the caps, get medians, then set promises from them and
      re-confirm.
      **⇒ STORMHALT'S LEVER IS DIFFICULTY, NOT THE CLOCK — measured on the shipped
      code, cap lifted to 60m: two seeds of three are outright LOSSES at 6–8 minutes
      holding one to three sites, and the third is contested 47 v 56 with the castle at
      full HP, never besieged. It is not failing to close, it never arrives. So reach
      for `enemyMult` / `develop` / the ground / the AI tier on that row, and ignore the
      `targetLengthMin` and `HARD_CAP_MIN_BY_TIER` advice below for it — that was
      derived from the buggy engine and from nightharrow, which has since fixed itself.
      **⚠⚠ AND RE-TAKE EVERY NUMBER ABOVE BEFORE ACTING ON IT.** They were measured on a
      build with five simulation bugs in it (defender reinforcement doing nothing, a
      rally printing troops, a retreat cloning a garrison, bombard and training
      discarded — all fixed since). That changed how battles RESOLVE: a nightharrow seed
      unwinnable in ninety minutes on the old engine wins in fourteen on the fixed one.
      Two lessons kept because they outlive the figures: **lift the cap before concluding
      a region is slow rather than stalemated** (with the cap at 90m those two still won
      0 of 12, so "slow" was wrong), and a long background measurement reports the code
      as it was when it STARTED, not as it is when it prints.

### The fun pass — findings from the specialist review

*(Filled in as the review team reports. Each item carries its own evidence so it can be
executed without re-reading the review. Measured numbers here are the REVIEW's, at the
sample size stated — anything that survives into a shipped change gets re-taken at the
project's own n and written up in `CLAUDE.md`.)*

**Meta / progression / retention.** All five confirmed against the real game or the real
harness by the reviewer.

- [x] ~~**The world map lets a new player walk into a region they cannot win, and says
      nothing.**~~ **FIXED** — `meta/world.js campaignGap` + a warn-styled hint, threshold
      measured at gap 2 (gap 1 is 56% and playable, gap 2 is 0 of 16). Told, not blocked.
      Original evidence: `meta/world.js touchesEmpire`/`isAttackable` gate on hex adjacency
      ALONE — no tier gate, no conquest-count gate. Ashford's `adjacentTo` includes
      Kaldan (tier 2), so at two regions conquered the map offers Kaldan with the same
      green Attack button as its tier-1 neighbours. Measured, n=16 each: **rushing it at
      2 conquered wins 0 of 16; arriving on schedule at 4 wins 69%** (win-med 9.7m). The
      first fork (Riverfen→Ironwood, 1 vs 2 conquered) is 88% vs 94%, so tier 1 is
      forgiving and the cliff is specifically the tier-1→2 boundary. **Fix:** not a hard
      gate — that contradicts the free-movement philosophy. Compare the region's index in
      `REGION_IDS` against `regionsConquered(meta)` (both already computed) and render an
      inline warning in `worldmap.js renderDetail` past a slack. **Cost S.**
- [x] ~~**No bulk buy: an idle payout costs 40–150 identical clicks to spend.**~~ **FIXED**
      — `meta/upgrades.js spendAll`, the one cheapest-affordable-first loop shared with
      `tools/simshop.js` rather than reimplemented, behind a header "Spend all" and a
      per-line "×10" (`buyN`). Original evidence: Measured
      clicks-to-fully-spend through the real `shopListing`/`buy`: 1k crowns → 10 clicks,
      100k → 66, 1M → 96, 50M → 146. Each re-renders the whole 25–34 row list
      (`screens/shop.js:140`). The return banner itself is good and honest; the PAYOFF is
      a chore, which is the exact opposite of what an idle game's return moment is for.
      **Fix:** `tools/simshop.js spendPurse` already implements spend-everything-
      cheapest-first — port it to the shop screen as a "Spend all" (and/or ×10).
      **Cost S.**
- [x] ~~**The shop hides a 33-point decision and its own copy sells the losing move.**~~
      **FIXED** — `meta/upgrades.js suggestedBuy`: a passive ring on the cheapest-affordable
      Empire line, recomputed on every purchase and kept live between them by the shop's own
      250ms tick (no second render, so it cannot steal keyboard focus). The Standing Army
      line in `upgrades.data.js` no longer reads as an instruction. Original evidence:
      Holding region, conquest count, idle budget and army composition constant and
      varying ONLY allocation, n=48 each: cheapest-first **33%**, "power rush"
      (Standing Army first) **2%**, "income rush" (Treasury first) **0%**. Both intuitive
      human strategies are catastrophic, and `upgrades.data.js:148` labels Standing Army
      *"The most directly felt purchase"* — which reads as "buy this repeatedly". **Fix:**
      a passive suggested-buy ring on the cheapest affordable Empire line (teaches
      cheapest-first by demonstration, adds no screen and no number to read), plus soften
      that line. **Cost S.**
- [x] ~~**The Crown tier is a reskin of the Empire six, and the meta never ramps.**~~
      **FIXED** — (a) `screens/shop.js` gives the Crown section its own rank-hued header,
      top edge and an "Endgame" badge (`scenes.css`), shown whether the tier is locked or
      open, plus a note that the gate survives abdication. `upgrades.data.js`'s group
      `blurb` and all four `desc` strings now name what a rung IS (a fresh landing, a
      payout priced off this empire's own income, a dial that never stops climbing)
      instead of restating the Empire bucket each one maps onto. No number moved, and
      `tests/crownshop.test.js`/`tests/upgrades.test.js` pass untouched. (b)
      `meta/specialists.js` `specialistCallouts` derives up to three advisory lines
      straight off `siteCounts.enemyMix`/`develop` (wall country → halberds and sappers)
      and `siteCounts.neutral`'s share of the board (open ground → outriders), rendered
      on the pre-battle brief (`prebattle.js`/`prebattle-brief.js`). Computed live against
      the region table rather than authored per row: as it stands here, the wall pair
      fires on 13 of 24 regions and outriders on 7 of 24, never below tier 3, and 11
      regions fire nothing at all — a real split, not a callout that talks on every map.
      Archers have no authored per-region signal (their value is where a squad is
      STANDING mid-fight, not a fact a region's table states) and are deliberately never
      one of the three. Gated on the unlock but not suppressed by it: a player who has
      not bought the unit still gets the callout, worded as a nudge at the shop rather
      than silence. `tests/specialists.test.js` pins the derivation against the real
      table (never a hand-built fixture), both unlock directions, and that every number
      quoted in the copy is read off `content/balance.js` rather than retyped.
      Original evidence: The battle layer ramps hard (`AI_TIERS` concurrent 1→5, reaction 45→13 ticks, boards
      13×10→17×13, marshals from tier 4). The layer the player TOUCHES between battles is
      the same six lines bought the same way from region 1 to 24 — and the post-campaign
      reward tier maps one-to-one onto the same four buckets (`upgrades.data.js` 213–224
      against 140–157): Exchequer=Treasury, Grand Army=Standing Army,
      War College=Arms+Drill, Citadels=Siegeworks+Drill. This is precisely the "same six
      buttons at bigger numbers" outcome this file worried about. **Fix:** not a sixth
      bucket (`STACKING_ORDER` forbids it and it was already rejected) — (a) make the
      Crown section READ as a different tier, **S**; (b) surface `siteCounts.enemyMix`
      on the pre-battle screen as a contextual specialist callout ("this region is
      wall-heavy: halberds halve `siteDefMult`"), turning an ignorable layer situational.
      Advisory text only, zero balance risk. **S/M.**
- [x] ~~**The three endgame loops do not compound.** A raid is a timer with a lump at the
      end, and `harderPerClear: 0.15` compounds forever but is never surfaced as its own
      stat — it is folded silently into the same "Enemy strength" figure a fresh attack
      shows. Abdication's replay is 81–100% by run 2 BY DESIGN (`prestige.js` says so),
      so its content evaporates after the first reset. **Fix (the reviewer's pick, and I
      agree it is the best value):** apply incursion-style mutators to REPLAYED campaign
      regions on run 2+. The wiring is a generalisation of `meta/incursion.js`, which
      already rides fields that cross the seam. **Cost M, and it needs a measurement pass**
      — it touches the region table, so it cannot ship unmeasured.~~ **FIXED, AND THE
      MEASUREMENT PASS TURNED OUT NOT TO BE NEEDED.** `meta/incursion.js
      campaignReplayPlan` + `content/incursion.data.js CAMPAIGN_REPLAY` generalise the
      ladder's draw to any region at `(region id, resets)`; applied through the exact same
      `incursionMods`/`incursionRegionInputs` the ladder uses, never through
      `incursionRules` (so `rules.incursion` never crosses and a mutated replay is still
      paid as an ordinary conquest or raid). It touches no field `regions.data.js` owns and
      no contract field, and it is gated on `legacyResets(meta) > 0`, which `metaFor` never
      sets — proven, not asserted: a `git worktree` checkout of the pre-change code, given
      the identical (mid-retune) `regions.data.js`, produced byte-for-byte identical
      `BattleConfig`s across all 24 regions, three idle times, three seeds, three raids and
      four incursion battles. `sealed` (the gate mutator) is excluded — the campaign's own
      `GATE_CLAMP` plateau is already the measured safety ceiling, and every region a
      replay actually revisits (tier 4–6) already ships AT it, so clamping the mutator
      there would be inert and not clamping it would be unmeasured risk. Visible on the
      pre-battle brief before the loadout is chosen, same markup as an incursion's list.
      `harderPerClear` now has its own "Raid escalation" row alongside the folded
      difficulty figure. `tests/campaignreplay.test.js`, 13 tests. Full writeup in
      `CLAUDE.md` → "A replayed campaign region carries a hand of its own".
- [x] ~~**Short-session lever: auto-resolve a RAID only.** Combat is deterministic
      (invariant 3) and the bot that plays every measured battle already exists headless.
      A raid is documented as a rerun with no new tactical content, so resolving one in
      the background is not cheapening the core promise — first conquests and incursions
      are explicitly excluded, because those are where the real-time battle IS the
      content. **Cost M.**~~ **SHIPPED AND DRIVEN END TO END.** A previous pass built the
      seam (`meta/autobattle.js` + `tools/autoresolve.js` + `worldmap-autobattle.js`) and
      left it unproven; this pass drove a real raid through it in a real browser — win,
      loss and cancel — and added `tests/autobattle.test.js` (gate both directions,
      determinism, one payout path, honest loss, cancel mutates nothing). Full writeup
      and the measured wall clock (single-digit seconds, chunked; up to a minute
      unchunked on the heaviest tier-6 board) in `CLAUDE.md` → "Auto-resolving a raid".
      *Rejected on the reviewer's own recommendation and mine: login streaks / daily
      bonuses. A hook, not a decision, and against this project's stated principles.*

**Simulation-state defects in the melee layer.** Found by the bug hunt, every one
reproduced with a runnable probe before being believed.

- [x] ~~**`site.garrison` was owned by one system and assumed by five.**~~ **FIXED** —
      `meleephase.js reprojectDefender`, pinned by `tests/meleestate.test.js`. A rally on
      a site under assault turned 300 troops into 10,084; defender reinforcement, retreat,
      bombard and finished training were all silently reverted. One mechanism for all five.
- [x] ~~**ARCHERS ARE DEAD EVERYWHERE THAT MATTERS — sold and doing nothing.**~~
      **FIXED** — `resolveField` takes `attSupport`/`defSupport`; wired into the site
      melee, `fightStack` and `computePreview`. Provably inert on the measured campaign
      (zero archer bodies in 4000 ticks each on gallowmoor and thanescar), so no dial
      moved. The test that was missing now drives a real site assault instead of calling
      the helper directly.
      Original evidence:
      `reachSupport`/`sidePower` are called ONLY from `openHexMelee`. `openSiteMelee`,
      `fightStack` and `computePreview` never call either, so the unit's whole selling
      point works only when two mobile squads collide on bare ground and never for
      attacking or defending a farm, yard, stronghold, camp or castle — which is nearly
      all of this game's combat. Reproduced: 10 v 9 at a farm with and without 40 archers
      one hex away is **byte-identical**. `tests/melee.test.js` only calls `reachSupport`
      directly, so nothing catches it. **Fix:** thread it into `openSiteMelee` (both
      sides) and `fightStack`, AND into `computePreview`'s assault branch or the preview
      stops being a guarantee. **Cost S/M.**
- [x] ~~**Fog ghosts your own live battle.**~~ **FIXED** — `vision.js siteFightSight`; the
      perceived view moved to `perceive.js` at the cap. Original evidence:
      A squad absorbed into `site.melee` leaves
      `state.squads`, so it stops being a sight source — the site you are actively
      fighting at becomes a ghost on the very tick the melee opens
      (`melee=true, ghost=true` measured on consecutive ticks). `battleView.js:309` skips
      ghosts *before* `drawSiteStack`, so the assault vanishes anyway — defeating the fix
      shipped for exactly that — and the panel returns early with `UNSCOUTED`, never
      reaching `FIELD BATTLE`. Hits essentially every assault onto ground you have no
      vision infrastructure over, i.e. the norm on an 85–90% dark board. **Fix:** a
      faction party to a site's melee/siege sees that site's hex — its army is standing
      there. **Cost M.**

**Battle feel — what a fight tells you while you are in it.** All reproduced live in a
real browser or against an instrumented headless battle.

- [x] ~~**A SIXTH FOG LEAK, in the rejection copy.**~~ **FIXED** — `rejectionText` takes
      state and answers "something blocks the way there" for a building this faction has
      never seen. `bad-hex` (the one reason with no entry in a table of 26, leaking
      `Order refused (bad-hex).`) got its text at the same time.
- [x] ~~**A won fight looks exactly like a lost one, and neither is announced.**~~
      **FIXED** — `battle-alert.js fightAlert` + `wireAlerts`, pinned by
      `tests/alerts.test.js` (mostly negative controls, because the hard part is what it
      REFUSES to say: 73–929 of these fire per battle and the strip has no queue). It
      speaks for two outcomes only — my assault losing, and my site about to fall.
      **It shipped broken once and that is worth knowing**: `getState()` is cleared on
      teardown but an event can still drain into a live listener, `siteOf` did a bare
      `state.sites.find`, and the throw escaped `bus.emit` and killed every later event
      in the battle. Green suite; surfaced only as a smoke step three stages downstream.
      `battle-hud.js:266-292` wires three bus listeners; `field-battle` has NO alert
      listener at all, and `siege-begun` only alerts when the ENEMY is attacking you. FX
      and sound fire identically regardless of `ev.win`. Reproduced both directions: a
      500-militia curb-stomp (`win:true`, attPower 2799 v 63) and a 5-militia wipeout
      (`win:false`) both left `.hud-alert` empty at every sample. Riverfen fires 87
      `field-battle` events in one battle. The melee layer's whole premise is a window the
      player can act inside — and nothing tells them the window is open. **Fix:** two more
      branches in the listener block that already exists; the payload already carries
      `attacker`/`win`/`siteId`, and the `good`/`danger` tone system is already built.
      **Cost S.**
- [x] ~~**Tower fire has zero player-facing feedback.**~~ **FIXED** — a throttled spark
      (one per column per 650ms) plus the longest gap in the sound cue table, player's
      own columns only. Original evidence: `EVENTS.TOWER_FIRED` is pushed with everything needed
      (`squadId, owner, siteId, kind, hex, lost`) and grepping `render/`, `ui/`, `screens/`
      finds **no consumer at all**. Volume, measured: riverfen 347 events / 94 squads;
      duskfell 1012 / 233; ravensmarch 1408 / 280. Troop counts just quietly shrink on the
      march. **Fix:** an `fx.js` case and a `sound.js` cue — but **throttled/aggregated**
      (one flash per squad per second, not per tick); that design is the actual work.
      **Cost M.**
- [x] ~~**Your own army's size vanishes the instant it starts fighting.**~~ **FIXED** —
      `battleLabels.js drawSiteStackLabels`, with the stack geometry shared rather than
      re-derived. Original evidence: `drawSquadLabels`
      only iterates MARCHING squads; once a column opens a melee or siege it lives in
      `site.melee.comp`/`site.siege.comp` and `drawSiteStack` draws pieces with no label.
      `formation.js` compresses above ~10 and caps at 30 pieces, so a 71-troop and a
      700-troop siege draw identically — and `formation.js`'s own comment says compression
      is safe *because* "the count label carries the exact figure at every size". That
      promise breaks exactly when it matters. **Fix:** label `site.melee.comp` /
      `site.siege.comp` in `battleLabels.js`'s site loop. **Cost M** (needs the
      `siteHeadYAt` offset, which currently lives only in `battleView.js`).
- [x] ~~**Nothing tells you who is winning.**~~ **FIXED** — a `Sites N v M` tally and the
      hard cap on the clock, both RAILED-ONLY because every phone placement cost board
      share against a floor that layout is already failing. Original evidence: No screen imports `sitesOwned`/`armySize`
      (they exist and are used only by the sim/AI); no minimap; the HUD clock counts UP
      with the cap shown once, on the pre-battle brief. On a 20×15 board over 7–24
      minutes, "am I winning?" can only be answered by panning and adding up. Related:
      a winning riverfen run goes quiet for minutes at a stretch in its last third, with
      no signal whether quiet means converging or stalled. **Fix:** a persistent
      mine/enemy readout beside the gold panel; show remaining time, not just elapsed.
      **Cost M** (data exists; it is new surface plus a design call).
- [x] ~~**Two comp-bar segments are focusable at 15px tall.**~~ **FIXED** — the segments
      leave the tab order permanently and the BAR names its own composition instead
      (`role="img"` plus a live `aria-label`), so the breakdown is announced without any
      interaction. Better than what it removed, because the old stops announced nothing:
      the hover card they opened carries a permanent `aria-hidden`, so `aria-describedby`
      resolved to nothing and a screen reader got five silent undersized stops. That is
      fixed too — `battle-tip.js` toggles `aria-hidden` with `is-open`, which is what
      `attach`'s own promise ("reachable from the keyboard rather than being a mouse-only
      secret") always claimed. Original evidence: `battle-bars.js:91` sets
      `tabIndex = 0` on a segment that holds troops, so it is a keyboard-reachable
      target well under the 44px minimum — `tools/mobile.mjs` flags it now that the
      audit distinguishes controls from tooltip anchors. Either make them non-focusable
      (they duplicate the garrison plaque's information) or give the bar a real height.
      **Cost S**, and it is a genuine a11y item rather than a cosmetic one.
- [x] ~~**The site panel eats the board on a phone.**~~ **FIXED at 390x844: 54% → 62%,
      and the whole audit reports no problems.** The panel's height is CAPPED with a
      scrolling middle rather than trimmed — head and actions stay put, econ and context
      scroll — because the panel's height is content-dependent and unbounded, so a trim
      fixes one screenshot and a cap fixes the class. The coach-mark overlap was a
      separate one-line z-order fix: advice must never cover a control. Original
      evidence: Step 6 of the audit reads
      **54%** against its own 55% floor with a site panel open (76% with nothing
      selected), and the reviewer additionally screenshotted the first-run coach mark
      sitting on top of the panel's own Upgrade button. Both are the same squeeze.
      **Cost M** — a layout call, not a patch.
- [x] ~~**...and in LANDSCAPE the same step reads 47%, and it is the DOCK, not the
      panel.**~~ **FIXED — 45–47% → 59%, and the whole landscape audit is clean.** At
      short heights the dock's groups lie DOWN: the label moves beside its controls
      instead of above them, which halves each group (95px → 54px) and costs no words.
      Worth 7 points on its own; hiding the labels outright measured the same 54% and
      would have paid the same price for strictly less — `% OF GARRISON` is what makes
      25/50/75/100 mean anything and `.hud-speeds.is-capped`'s label carries a live
      state. The treasury's third line (the income/training breakdown) folds away at the
      same breakpoint for the last 3 points. Original evidence:
      Measured at 844x390 with the cap on and off: 47% with, 45% without — so the panel
      fix helped by two points and the floor is still eight points away. Hiding the dock's
      six groups takes the same frame to **60%**. On a 390px-tall screen `.is-docked`
      applies and all six groups sit in a 100px band across the bottom, which is 26% of
      the viewport on its own. So the lever is the docked layout at short heights (fewer
      groups, a shorter strip, or a rail that works when the screen is wide and short),
      not the panel. **Cost M**, and it wants a design call rather than a number.
- [x] ~~**Concentrating force costs one drag per site, always.**~~ **FIXED** — a drag
      that STARTS on a site already in the selection commits every source in it; one
      that starts anywhere else is exactly one send, unchanged. The interesting half is
      the preview, and it claims LESS on purpose: a multi-source drag's columns are at
      different distances, so they arrive as separate waves and a later one reinforces
      a fight already under way — summing the comps and calling `resolveField` once
      would be a plausible, confident, wrong number. `computeMultiPreview` reports what
      is honestly knowable at commit time (columns, bodies, the arrival spread) and
      nothing else, which is how the gesture keeps invariant 3 rather than softening
      it. `tests/multisend.test.js` pins the withholding as deliberate, plus the
      control that a single-source preview still promises everything it always did.
      Original evidence: `battle-input.js onDown`
      takes `view.dragFrom` from the single site under the pointer, never from
      `view.selection`; no `sendFromSelection` exists. The AI pools up to `AI.maxSources`
      (3) sites into one assault automatically and the free-movement balance argument
      rests on concentration — the player has no equivalent, and the cost scales with
      exactly the late maps where it matters. **Cost L** — changes core drag semantics and
      needs real interaction design, not plumbing.

**Open thread, NOT a finding (n=10, below this project's own trust threshold):** mono
militia scored 20% at incursion depth 3 under the `sealed` mutator against the ladder's
documented ~90% at shallow depths. If that survives n≥48 it would make the incursion
mutators the one place in the game that forces loadout diversity — which is directly
relevant to the dominant-loadout problem below. Worth a measured look.

---

## The senior-review pass — findings, and what is left of them

*Four reviewers ran end to end against the real game — a first-hour playthrough with
real pointer events, a "does this pose a decision" audit driving the real engine, a
comment/code drift audit, and a harness-concentration measurement — plus a hands-on
pass of my own. **Ten items were fixed in the same pass and are struck through with
the evidence kept.** What remains is below them, ranked.*

*Read the fixed ones too. Six of the ten are the same defect class this file keeps
recording — **built, wired, tested, and permanently inert** — and two of those six
were shipped BY the reviews' own session, which is the point: the class is not
historical.*

### Fixed in this pass

- [x] ~~**The `SITES` tally drew its label and nothing else.**~~ `el.tallyBox` was built
      from `el.tally` ten lines before `el.tally` was declared, and `h()` skips an
      undefined child rather than throwing — so the box mounted its label alone, the
      value span was never in the document, and `bindText` wrote every update into a
      detached node. Shipped blank by the pass that added it; found by probing the live
      HUD, not by any test. Now reads `Sites 3 v 5`.
- [x] ~~**The troop rail offered nine chips to a two-troop expedition.**~~ `battleRoster`
      narrows the sim's roster to what the landing force carries, and the rail was built
      from `UNIT_IDS` — so seven chips filtered a troop the army cannot contain and
      cannot train (`cmdTrain` answers `unit-locked` on the same field). The KEYBOARD
      half was worse: pressing `U` in a battle with no halberds flipped an invisible flag
      and left it flipped, armed to exclude the troop silently if one were ever captured
      in. Fixed at the list; `battle-keys.js filterUnits` is the one answer both ask.
- [x] ~~**...and so did the training fan, one layer over.**~~ Eight chips, six locked for
      the whole battle, in the first second of the first thing a new player selects — one
      of them behind the coach bubble teaching the drag. A chip that can never unlock in
      THIS battle is furniture, not a preview.
- [x] ~~**Nothing ever told the player the treasury had filled.**~~ `applyOfflineProgress`
      has returned `cappedOut` since it was written and nothing ever read it, while
      `strings.js IDLE` carried five copy strings with NO reader at all — the world map
      hardcoded its own beside them. So a player who idled past the cap lost every crown
      after it in silence, and the Treasury line, the upgrade that raises exactly that
      cap, was never named at the one moment it sells itself. The unread copy had also
      gone stale unnoticed: it advertised a "Granary" that stopped existing when
      twenty-six upgrades collapsed into six. `tests/offlinenotice.test.js` pins the
      class — every key in `IDLE` must reach a screen — as well as the instance.
- [x] ~~**The tutorial taught a rule the opening region does not have.**~~ `BEATS.takeCastle`
      fired on castle reach everywhere and described the gate holding the throne;
      Riverfen ships `castleGateFrac: 0`, and the panel readout that would have
      contradicted it only renders when the gate is real. Split into a pair on one
      signal, so a first-timer still hears that the throne ends the region.
- [x] ~~**The first refusal a new player meets explained nothing.**~~ At tick 0 a fresh
      save has seen no site but its own three, so following the tutorial's one
      instruction and dragging at the nearest building — the only visually distinct thing
      on a dark board — is refused. It said "Something blocks the way there."; it says
      "Something unscouted is standing there. March beside it." now, which discloses
      nothing the refusal had not already disclosed and names the rule.
- [x] ~~**`tools/` code ships to the browser and the purity gate did not cover it.**~~
      `src/meta/autobattle.js` imports `tools/autoresolve.js` on purpose, and that drags
      `simplayer`, `simtactics`, `simbuild` and `simshop` into the bundle — five files
      free to reach `Date.now` or `Math.random` with nothing stopping them, in the one
      feature whose test pins byte-identical determinism. `checkpure` walks the import
      closure out of the pure directories now. Proved both ways: a planted `Date.now` in
      `simtactics.js` fails the gate, and the eight browser-driving scripts that
      legitimately use banned globals still pass.
- [x] ~~**A safety comment written this session was false.**~~ `battleViewSig.js` justified
      folding squad positions into the repaint signature partly on `markBgDirty` being
      throttled to 8/s; `battleView.js` calls `markDirty(true)`, and `force` exists to
      skip that gate. The behaviour is fine (60.1 fps, 56 columns, widowsgate) — the
      stated REASON was wrong, which is how a future change ships an unthrottled repaint
      storm on a comment's authority.
- [x] ~~**Nine dead exports, four claiming a caller that does not exist.**~~ `drawTrainRing`
      and `drawGarrisonBar` each said "the name battleView currently imports" (it imports
      the originals); `strokeHex` said "used for hover and selection highlights"
      (`siteCursor.js` does that); `hasMutator` said "exposed for screens and tests"
      (neither). Also `canReach`, `toCube`, `shopEntry`, `resetPalette`, and a
      `tools/autoresolve.js` header claiming a grep result that does not reproduce. On
      this codebase the comment is usually the specification, so a stale one is worse
      than none.
- [x] ~~**`meleeOver` was dead beside a reimplementation of itself.**~~ Kept and wired
      rather than deleted — `meleephase.js` wrote the same two comparisons out again, and
      that is how an invariant ends up owned by nobody. Proven inert (gallowmoor n=8,
      clean worktree, identical with and without).

### Open — ranked

- [ ] **PASSIVE PLAY DOES NOT FAIL FAST, AND CLAUDE.md SAYS IT DOES.** Measured on a
      fresh save with no input at all: the region plateaus at 2 sites around **t≈237s**
      and then sits there for the rest of the ~18-minute cap, camp never broken,
      accumulating **142,000 unspent battle gold**, ending on *"Time expired · Decided on
      territory when the hard cap ran out"*. CLAUDE.md's claim — *"a Riverfen battle with
      no input is down to two sites inside two minutes"* — is wrong on the timing and
      wrong on the shape: it is not a fast loss, it is a twenty-minute stall that ends on
      copy reading as a clock problem rather than "you never attacked".
      **Correct the record first** (that claim is load-bearing for the argument that the
      idle half cannot be used to skip the real-time half — an argument that survives,
      since the player still loses; only "fast" is false). Then decide whether a
      no-orders battle should concede. Cheapest honest fix is the results copy, not the
      simulation.
- [x] ~~**THE HARNESS-CANNOT-MASS HYPOTHESIS DID NOT REPRODUCE.**~~ **CLOSED — built,
      measured, shipped OFF.** Full write-up at the top of this file. The short version:
      `gallowmoor 25% pooled / 33% unpooled`, `thanescar 27% / 23%` at n=48, opposite
      signs and inside the noise band; the implementation IS proven to reach the battle
      (the real-battle test groups commands by target and arrival tick and demands a wave
      from two or more distinct sites); and it ships behind `--pool` rather than on,
      because a wash with a known defect must not become the baseline mid-retune.
      **What it bought is a sharper question, not a null:** `simpool.js`'s target scan is
      not throne-weighted, so it competes with consolidation — on thanescar seed 1000 it
      converted a clean win into a timeout without ever aiming at the castle. Both that
      and pooled gallowmoor's `ahead=31` say the same thing.
- [x] ~~**THE THRONE IS THE BOTTLENECK — WEIGHT THE POOLED SCAN AT IT AND RE-MEASURE.**~~
      **MEASURED, AND THE ANSWER KILLS THE WHOLE LINE OF ATTACK.** Instrumented on
      thanescar seed 1000 — the exact seed the original diagnosis was traced on — over a
      full 30-minute battle, 912 thinks:

      ```
      castle within reach of a player site          823 of 912 thinks  (90%)
      ...of TWO OR MORE player sites                385 of 912 thinks  (42%)
      most sites ever in reach of it at once        19
      thinks where the castle is a LEGAL pooled target, by source cap:
          cap 3      0
          cap 6      0
          cap 12     0
          cap 99     0        <- every site in reach, committed at 100%
      best force ratio EVER achieved                1.02x   (41 bodies v 40)
      ```

      So it is not reach (90% of the battle), not scan order (`castle` sorts first
      anyway), not `POOL_MAX_SOURCES` (unlimited changes nothing), and not the 50%
      fraction (committing everything peaks at 1.02x against `ATTACK_MARGIN` 1.5).
      **The force never exists.** At its single best moment the bot holds seven sites in
      reach of the throne with forty-one bodies between them, against a castle that
      trains against zero attrition.
      One seed, one region — but this is a RATIO, not a win rate, so it is far more
      informative at n=1 than a win rate would be, and it should be re-taken on
      ravensmarch and widowsgate before it is generalised past "the Marshal'd rows".
- [ ] **THE BOTTLENECK IS CHURN AND CONVERSION — 78% OF THE BOT'S ARMY IS IN THE AIR AND
      IT IS SITTING ON SIX FIGURES OF GOLD.** The same probe killed "production near the
      front" too. Same battle, every five minutes:

      ```
      min   sites   garrisoned   MARCHING   near throne   castle   gold unspent
        5      19          63        299      1 site/13      125         12,610
       10      34          93        452      5 sites/32      24         52,680
       15      54         239        853     18 sites/170    124        118,303
      ```

      At fifteen minutes it commands **1,092 bodies** and 239 of them are standing
      anywhere. It is not short of troops and not short of ground (54 sites) — it is
      short of troops that have ARRIVED. Every think sends a share of every garrison
      somewhere, so the army shuttles instead of accumulating; the 170 bodies actually
      near the throne make 1.37x against a 124-body castle, under the 1.5 margin, while
      eight hundred of their fellows are walking. And 118,303 unspent gold is the
      `PRIORITY` signature this project already recorded once at 17,000.
      **THE CONVERSION HALF IS NOW MEASURED TOO, and it is the `PRIORITY` failure
      again.** Same battle, what the bot actually holds:

      ```
      min   sites   farms   yards   walls   sites that TRAIN   train bill   gold unspent
        5      19      13       3       1                  4      5.1/s         12,610
       10      34      28       3       1                  4      5.1/s         52,680
       15      54      41       8       3                  9     11.7/s        118,303
      ```

      Seventy-six percent farms, nine places in the world to turn gold into a body, and
      **2.8 hours of training banked** in a battle with fifteen minutes left on its cap.
      That is verbatim the shape recorded for `PRIORITY` at 17,000 gold, an order of
      magnitude larger — so flipping `PRIORITY` fixed the symptom on small maps and not
      the behaviour on big ones. **This makes the already-open "the bot builds farms
      while it is losing" item the top harness fix rather than a curiosity**:
      `constructTurn` raises a farm past its third yard while the treasury runs to six
      figures.
      **Still unmeasured — the churn half:** what share of sends re-task troops already
      heading somewhere useful, `advanceDistance`'s gradient re-pointing every 2s being
      the obvious suspect. **Do not reach for `enemyMult`**: it moved gallowmoor and
      thanescar the wrong way twice, the same tell all three instances of the
      harness-cannot-play class produced.
- [ ] **THE LOADOUT IS A TRAP AND IT LOCKS FOR THE WHOLE BATTLE.** Known; what the review
      adds is the second clause, read out of `battleRoster`/`cmdTrain`: the five types
      chosen at the briefing are the only five you can ever TRAIN, including out of a
      captured enemy yard. So the dominant answer is not merely available, it is
      irreversible from the moment the battle starts, and a player who guesses wrong
      cannot correct it with anything they capture. Everything already in
      "The one problem worth ranking above everything else" still applies; this is why it
      deserves to stay there.
- [ ] **THE SHOP'S MOST INTUITIVE FIRST BUY IS A MEASURED TRAP AND THE GAME NEVER SAYS SO.**
      `upgrades.data.js`'s own comment on `standingArmy`: *"Standing-Army-first wins 2%
      against cheapest-affordable-first's 33% at matched region/conquest/idle-budget/
      composition (n=48 each)."* Independently reproduced this pass on a different region
      (kaldan, n=48): cheapest-first **79%**, standingArmy-rush **2%**, treasury-rush
      **0%** — and the mechanism isolated, which is new: a monoline rush leaves **15-36%
      of the identical crown lump unspent**, because one exponential price curve outruns
      a fixed budget faster than six curves sharing it do, and Treasury's income and
      offline-cap terms are worth exactly ZERO to the battle they are scored against.
      "Bigger army" is the single most intuitive first purchase in a strategy game and is
      one of the two worst in the shop. The only counter-signal is an unlabeled pulsing
      border whose explanatory text (`", cheapest option right now"`) is **aria-only and
      never rendered for a sighted player**. Cheapest fix by far: render that string.
- [ ] **RESULTS NEVER SAY WHY.** Win and loss screens show the same four to seven stat
      rows — duration, sites held, units lost, enemy losses — and nothing causal. No
      "your siege stalled", no "the castle gate needed more territory", no "you were
      out-fought at the wall". Every one of those facts is already in the battle state at
      the moment it ends. This is the single biggest gap between "the game is deep" and
      "the player can tell that it is".
- [ ] **THE OBJECTIVE NAMES A BUILDING THAT IS NOT ON THE BOARD AND GIVES NO BEARING.**
      Verified on the campaign opener: `Take the Castle.` with `castleSeenByPlayer: null`
      and the throne five hexes away on an 11x9 board — no marker, no compass, nothing.
      On widowsgate (21x16) it is far worse. The site-existence gate is right as a FOG
      rule, but the win condition is not intelligence, it is the brief. Two candidate
      fixes, and the first is one line: seed the enemy castle into `state.seen` at battle
      start (garrison and level stay hidden; **provably balance-neutral, because
      `beliefFor` already hands the AI and the harness a ghost for every site**), or draw
      an edge-of-board bearing marker, which discloses strictly less than a ghost.
- [ ] **THE LOADOUT SCREEN'S ADVERTISED DECISION IS NOT LIVE FOR THE FIRST FEW REGIONS.**
      Its own copy, read off the DOM at region 2: `2 / 5 TROOP TYPES · every troop you
      have unlocked is already in this army`, with all five boosters LOCKED or NO
      CHARGES. The screen built to be "the decision point the campaign was missing" is a
      confirm-and-continue for a real stretch of a first session. Not broken; worth
      knowing before anyone measures onboarding against it.
- [x] ~~**THE "SPEND ALL" BUTTON SPENDS RELICS ON TROOPS YOU DO NOT FIELD.**~~ **FALSE —
      checked, not built.** The review flagged this as reasoned-from-source rather than
      simulated, and reading the source settles it the other way: `screens/shop.js:71`
      calls `spendAll(meta(), 'crowns', ctx.bus)` and the comment two lines above says
      why — *"Relics are the player's deliberate choice of which troop to level, and this
      button must not make that choice for them."* The button has never touched relics.
      Kept struck through rather than deleted, per this file's own rule: a deleted item
      gets proposed again. **Worth more than the finding: a "reasoned from source" item
      needs the source read before it is worked, and this one took two minutes.**
- [ ] **THE INCURSION LADDER'S OPENING RUNG MAY HAVE DRIFTED.** Depth 1 is documented as a
      ~94-98% victory lap and read 33% (n=3), 50% (n=8), 25% with `--nopool` (n=4) this
      pass. Every sample is far below trust threshold and the campaign dial has been
      moving underneath the arena all session, so this is a FLAG, not a finding — but
      `incursion.data.js`'s own comments already warn its numbers are unremeasured, and a
      first rung that is not a victory lap breaks the one loop that cannot be skipped.
      Re-take at n>=48 from a clean worktree.
- [ ] **`hexMelees` DISCOVERS "ONE SIDE IS EMPTY" A TICK LATE.** Reproduced against real
      code: 6-vs-1 militia on one hex, the loser leaves `state.squads` at tick 32 (the
      clock is 60), and the winner's `sq.melee` does not clear until tick 33 — because
      the rule is found next tick via an empty-array check rather than evaluated. Harmless
      today, and the same invariant is now owned by `meleeOver` on the site path. Left as
      an observation because closing it changes sim behaviour for no measured benefit.
- [ ] **`site.garrison` IS STILL UNVALIDATED AT THE SEAM.** Re-confirmed by probe:
      `assertBattleConfig` accepts `{militia: 'lots'}` and negative counts on a site,
      which is the exact hole `checkComposition` was written to close for `expedition`.
      Same file, same fix, and `resume.js` runs that assertion deliberately as the shield
      over a hand-editable `localStorage` key.

---

## Where the game actually stands

**The engine is finished and the measurement culture is the real asset.** Deterministic
combat with an honest pre-commit preview, fog of war, free movement, in-battle
construction, a yard/wall split, an AI with a belief model, an idle layer that pays out
absences, three endgame loops — and ~80 test files plus a headless harness that can play
any region, loadout, tier of idling, legacy or relic budget. Six previously-inert
features and four sold-but-dead upgrades were found *by measurement* rather than by a
bug report. That is unusual and it is what makes everything below tractable.

**The campaign has been tuned twice against the finished battle layer — and is out of
band again, on purpose.** It was deliberately left untuned through the redesign (tuning
between two structural changes is work thrown away) and then re-tuned end to end once
free movement, the yard/wall split, construction, towers, the slower march, fog, squad
sight and the site-existence gate had landed; every `enemyMult` and every advertised
length moved, and the method plus its four transferable findings are in `CLAUDE.md`
(`Still open` → the closed re-tune entry). The melee layer has since moved the ground
under all of it, knowingly, and that third pass is the top item below.

**Siege binds again, and a ram is a purchase.** `SIEGE_FRONTAGE` caps how much structure
damage ordinary bodies can do at one wall and exempts engines, closing the oldest measured
defect in the file — "`breachSeconds` stopped binding around region 8". `UNIT_SLOTS.rams`
5 → 3 then re-priced what a ram COSTS to match what the frontage made it worth. Together
they halve the cheapest half of the loadout exploit below and make engines strictly right
at the last gate; they do not close it. The campaign and the ladder were re-tuned against
both and every region reports `ok` at n=240.

The one thing to carry forward: **the table describes a bot that earns no relics, idles
far less than a real player, brings the default four-type spread, and still knows where
every enemy building is.** Each of those gaps is now a flag away from being measured
(`--relics`, `--idle`, `--weights`), and the last one is new — see the site-existence
note in `CLAUDE.md`'s fog section.

**What is missing is not content. It is a REASON TO KEEP DECIDING.** The moment-to-moment
tactics of a battle stay rich for a long time — fog, sieges, rally timing, relief forces,
where to build. The layer *around* each battle has one right answer, and once found it
stays right to the last battle in the game.

---

## Do this first: re-tune the campaign against the melee layer

A field battle now takes `MELEE.seconds` rather than a tick, a hostile tile is contested,
and archers shoot into a fight from a hex away. That shipped with the campaign
**knowingly out of band** — the scope call was mechanics and tests now, tuning as its own
pass — so this is a debt with a due date rather than an idea. n=48:

| region | win% | win-med | all-med | target | verdict |
|---|---|---|---|---|---|
| riverfen | 96% | 8.9m | 8.9m | 9.5m | TOO EASY |
| kaldan | 77% | 9.0m | 9.9m | 8.5m | ok |
| gallowmoor | 23% | 14.2m | 17.0m | 6.5m | TOO SLOW |
| thanescar | 2% | 7.3m | 20.0m | 6.5m | TOO HARD |
| ravensmarch | 4% | 15.2m | 24.0m | 7m | TOO HARD |

**`campaignplay.test.js` IS RED, so the Pages deploy is gated until this pass lands.**
Two regions are won 0 times in 48 seeds — the floor that exists to catch "not a hard
region, a broken one":

| | first 24 | escalated | verdict |
|---|---|---|---|
| gallowmoor / thanescar / ravensmarch / gravenreach / cinderwatch | 1–2 wins | — | pass, on a knife edge |
| widowsgate | 0 | 1/48 | pass, only via escalation |
| **nightharrow** | 0 | **0/48** | **FAIL** |
| **stormhalt** | 0 | **0/48** | **FAIL** |

(Eight regions measured — the ones plausibly at risk, at ~20 min each. The other
sixteen are untaken.)

**Start from the signature, not the win rate.** Every one of those rows is `losses=0` or
close to it with a large timeout-*ahead* count — gallowmoor times out 31 times in 48 while
winning on territory. The two failures are the same thing at the limit: every seed ends
`timeout` at exactly the hard cap, not one is a defeat, and several end ahead (nightharrow
62 sites v 15, 53 v 26, 45 v 28). They are **unfinishable, not unwinnable**. So the first
lever is `targetLengthMin` (which derives `hardCapMs`, so the promise and the cap are the
same number), not `enemyMult`.

**And mind the order, because the usual procedure has no input here.** Authoring
`targetLengthMin` from measured win-medians is the house method, and those two regions
have no wins to take a median of. Lift the caps first, get win-medians, then set the
promises from them and re-confirm.

**Two things are already measured; do not re-spend them.** `MELEE.seconds` is worth ~2
points a second (2s versus 6s is six points on gallowmoor and eight on thanescar, with
the all-run median pinned at the hard cap either way), so it is not the lever. And a
clock-reset bug that read exactly like balance cost — every reinforcement restarting the
melee clock, so a trickle of columns held a fight open forever — is fixed, and was worth
+13 points on gallowmoor and 3.3× the harness's throughput on its own.

**The open question is fight COUNT.** Interception creates fights that did not exist
before; nobody has measured how many, and that is the first thing to instrument.

**⏳ UPDATE, a session against this brief: tier 1-2 done, tier 3-6 fully
screened at n=24 — full write-up in CLAUDE.md ("Still open" -> the campaign
re-tune, third pass).** Short version: all nine tier 1-2 rows are re-measured at
n=48 and read `ok` (riverfen's 96%-TOO-EASY figure above turned out to already be
stale — a fresh n=48 take on unmodified riverfen reads 90% ok, matching CLAUDE.md's
OTHER table). Tiers 3-6 got a diagnosed fix rather than a guessed one: a Marshal'd
castle that is never attacked for a whole battle out-trains what any one rear site
can mass for the required first-strike margin, confirmed with a direct probe
(thanescar's castle garrison ranges 96-241 over twenty minutes; the biggest
adjacent player site never tops 30). `develop` was cut for tiers 4-6 against that
finding. n=24 re-screen, now complete for all fifteen rows (`widowsgate` landed
just as this was being written — the biggest board in the game, >90 CPU-minutes
before it produced a number):
gallowmoor 38%, sunder 25%, vaelstrand 17%, duskfell 17%, karrowmere 38%,
thanescar 29%, blackspire 29%, ravensmarch 17%, stormhalt 8%, cinderwatch 13%,
widowsgate 4% (all improved, all still below floor); ironcrown 38%, obsidian 42%,
gravenreach 42%, nightharrow 29% already clear their own band. Three shapes worth
a closer look: tier 4 splits exactly down the middle on an otherwise-uniform cut;
ravensmarch is tier 5's one bad row by a wide margin (matching what an inherited
n=8 quickscreen already hinted); and widowsgate at 4% is now the single WORST row
in the table, worse than stormhalt, and NOT explained by `enemyMult` (its cut,
5.10->4.90, was one of the biggest of the three tier-6 rows, not the smallest —
the likelier suspects are its board, the biggest in the game, and its site
count, the highest fort count of the three). **Do not re-spend `enemyMult`
on the Marshal rows**: a further cut moved gallowmoor and thanescar the WRONG way at
n=24 (twice), which at that n is consistent with noise once the `develop` cut already
did the real work — and is itself consistent with the diagnosis (a consolidation race,
not a power ratio, so a power lever should not be expected to bite reliably).

---

## The one problem worth ranking above everything else

### The loadout has a dominant answer, and it scales with difficulty

Re-measured against the finished battle layer, the closed re-tune and the siege
frontage, n=48, matched seeds:

| region | default | **no rams** | militia only |
|---|---|---|---|
| kaldan (tier 2) | 75% | 75% | 83% |
| gallowmoor (tier 3) | 71% | **85%** | **98%**, a 6.5-minute region won in 3.2 |
| thanescar (tier 4) | 48% | **65%** | **92%** |
| ravensmarch (tier 5) | 42% | **63%** | **85%** |
| widowsgate (tier 6, the incursion arena) | 48% | 44% | **81%** |

**The cheapest half used to be one click — don't bring rams — and the RAM SLOT REPRICE
halved it.** `UNIT_SLOTS.rams` 5 → 3 took that gap from +23/+25/+25/+30 down to
+14/+17/+21 and turned it NEGATIVE at tier 6: bringing engines is now strictly right at
the last gate. The full mono-militia version is unfixed at +27 to +44, and it does not
merely win more often — it deletes the battle, finishing in half the advertised time.
Kaldan is the control at +0/+8: this is a late-campaign hole. Pinned by
`tests/loadoutdominance.test.js`.

**This is the reason the specialists, the relic troop lines, and most of the strategic
layer are dead content.** Nobody re-opens a screen that already wins everything.

**The obvious fix is measured to make it worse.** Three probes (gallowmoor, n=24, matched
seeds), default → mono, and the gap between them:

```
baseline                       54% -> 100%   gap 46
counters.spearmen 0.75 -> 0    29% ->  83%   gap 54
atk 4->3 and def 3->2.25       38% ->  88%   gap 50
```

Every nerf widens the gap, because the mixed army sits on the steep part of the win curve
and the mono army on its flat top. A militia re-tune costs a full campaign sweep and
leaves the game worse in both directions.

**The mechanism is tempo.** One slot budget buys 471 militia or 240 mixed bodies, 32%
more field power, at *equal* siege output — the spread's 23 rams make 276 siege DPS and
471 militia make 283. Rams buy siege the militia already had for a third of the field.

**Siege scarcity was the standing prime suspect. It has now been built, and it is
spent.** `SIEGE_FRONTAGE` caps how much structure damage ordinary bodies can do at one
wall (engines exempt), which fixed `breachSeconds` outright and re-priced rams by a
factor of twelve — a crowd now does 24 structure dps against the default spread's 276.
The mono gap did not move: +8 / +36 / +61 / +63 on the four rows the re-tune left alone,
against a pre-frontage +10 / +40 / +65 / +67. **A change that removed siege from the
question entirely moved nothing**, which is a far stronger statement than the fix would
have been: whatever mono-militia wins with, it is field power and tempo, full stop.

**And the measurement nearly said the opposite — read this before trusting the next
one.** The first pass looked like the frontage closed the exploit at tier 6 (widowsgate
mono 94% → 25%). It had not: `simtactics.js` walks away from any siege over 90 seconds, a
rule that had never bound at a castle because a crowd used to break any throne in about
five, and the frontage put widowsgate's throne at 128s — so the bot stopped assaulting it
at all and timed out **35 sites ahead** with the region won everywhere but the gate.
Teaching it to commit put mono back at 92%. A harness that declines to play is the same
defect as one that cannot, and this one broke *toward the result somebody wanted*.
`--nothrone` and `tests/throne.test.js` keep the delta re-takeable.

**And the CONCENTRATION lever — the one this file ranked top — is spent as well, because
its premise is measurably false.** "Scale `battle/aiadapt.js` `counterShare` by how
dominant the dominant unit is" was ranked first for one property: it would bite a mono
army and leave the default spread untouched *by construction*, so it could ship without
re-tuning 24 regions. Read straight off the enemy's own `learnedPlayerComp`:

```
share of the player's army that is MILITIA, as the enemy sees it
               t=1m   t=2m   t=5m
default        80%    95%    95%
mono militia   99%    99%    99%
```

**Both loadouts are the same army by minute two.** The 46% this file used to quote is the
LANDING FORCE, which the enemy never sees as such — the player captures yards and trains
militia in them. A dominance-scaled share sees 95% against 99%. Built anyway in its
strongest form (share → 1.0 above 98% dominance *and* the spear backbone released, which
breaks a pinned invariant): gaps +36/+38/+61 → +36/+33/+57, noise, and the default spread
paid for it. Reverted.

**That retires a class, not a knob: nothing keyed on what the player FIELDS can work**,
because the two armies are identical from two minutes in. The gap is created entirely in
the opening, by the landing force — which is where the one lever that HAS worked acts.

**The ram's slot price is the fix that landed.** `UNIT_SLOTS.rams` 5 → 3: the frontage
re-priced what a ram *does* and nothing re-priced what it *costs*. It has exactly the
property the counter-pick was ranked for and did not have — a mono army brings no rams,
so `distributeExpedition` returns a byte-identical force and the exploit cannot be helped
by construction. Two things about it are worth more than the win rates. It is a
**threshold, not a slope**: cost 4 is inert, cost 3 bites, because what matters is whether
the extra line troops carry an assault over `ATTACK_MARGIN`. And it is
**region-dependent** — engines matter in proportion to how much wall a region has, so the
same reprice was worth +14 to duskfell and +3 to karrowmere on the identical dial. That is
why it cost a full re-tune of tiers 3–6 and a ladder re-tune rather than a one-number
change: it re-weights the campaign's relative difficulty, not just its level.

**Five things NOT to try, because they have been built and measured.** Two militia nerfs
(both *widen* the gap — the mixed army sits on the steep part of the win curve and the
mono army on its flat top). A per-type slot-share cap (69%/56%, default spread
byte-identical, reverted — it contradicts the `carryComposition` contract ten tests
encode). **Share-scaled march speed**: replacing `slowestSpeed`'s hard `Math.min` with the
slot-weighted harmonic mean makes the default spread 1.6× faster and provably cannot help
a one-type army — it bought a net **+1 point** across five regions and left the gap
fractionally wider, which is what says the ram's cost is entirely its SLOTS. Siege
scarcity, above. And the concentration counter-pick. Anything proposed next should say
which of those shapes it is not, before it is built.

---

## Near-term — each is one file or one flag

**1. Give `stronghold` and `watchtower` a harness policy, off by default.**
`tools/simbuild.js constructTurn` picks a kind on one rule — a yard while it holds fewer
than three, a farm after that — and never builds a wall or a tower at all. By this
project's own repeatedly-paid-for standard ("a mechanic the harness cannot play is a
mechanic nobody has measured"), two of four buildable kinds are unmeasured *today*. Ship
it behind a flag next to `--noupgrades` / `--noconstruct` / `--noscout` / `--nothrone` so
the delta stays re-takeable, exactly as `upgradeTurn` and `scoutTurn` did. Related and
already recorded: the bot builds farms while it is losing — seven raised and seven razed
on a run it lost. The frontage pass is the freshest argument for ranking this at all: a
bot that declines a mechanic reads exactly like a mechanic that works.

**2. `counterShare` is a difficulty ladder that mostly cannot be climbed — decide
whether that is wanted.** The yard/wall split moved counter-training's pool from every
stronghold to `trainingGround` only, which instruments at **one or two buildings**
mid-campaign, and `adapt` reserves a spear backbone before either share spends anything.
So at gallowmoor `counterShare` 0.20 and 1.00 buy the identical single yard. Re-measured
with it off at every tier (n=48): gallowmoor 60→65, karrowmere 60→63, ravensmarch 33→40 —
five to seven points, where `ai.data.js` still records the +17/+32 it was worth before the
split. The comment is corrected; the ladder is not. The honest lever is the enemy's YARD
COUNT (`mapgen.js fortsAmong`), not this share, and moving it re-tunes tiers 3–6 — so
this is a balance pass to schedule, not a bug. Ranked here because a tier priced against
a knob that does nothing is how difficulty ends up somewhere nobody put it.

**3. Calibrate `split`, or record that it cannot be.** The campaign re-tune found the
silhouettes were never calibrated against each other: grouped by shape against the middle
of each region's own band, `branch` ran −11 and `split` a startlingly uniform −6 (all
three regions), while `open` and `choke` sat near zero. `branchTrunk` 0.50 → 0.62 fixed
the branch regions. **`split` has no `SQUEEZE` knob at all**, so its −6 is currently an
open observation. Either give it one or write down why it should not have one.

**4. ~~Pull the incursion mutator onset forward~~ — MEASURED, AND THE ANSWER IS NO.
What the measurement found instead is that THE LADDER HAS REGRESSED, and that is a
bigger item than the one it was checking.**

The proposal was that `mutatorsAt: [3, 9, 18]` leaves depths 1–2 as "dial-only reruns of
one map". Two things are wrong with that premise, and the second one matters.

**The layouts already differ.** The DEPTH is part of the map seed (`meta/modifiers.js`,
whose own comment says "the rung after it is a different map on the same ground"), so
depths 1 and 2 are different boards at different dials. What they lack is a mutator, not
variety.

**And they are not formalities.** Measured, `--incursion=1,2,3,4,5 --n=16`:

```
depth   dial   mutators        win%   win-med
    1   4.42   —                38%    14.6m
    2   4.48   —                31%    11.3m
    3   4.54   Sealed Throne    25%    26.8m
    4   4.60   Entrenched       13%    11.5m
    5   4.66   War Host         19%    17.5m
```

`simladder.js`'s own summary line reads **"coin-flip at depth 1, wall at depth > 5"** —
its two design facts are that a player should clear the opening rungs and should
eventually be stopped, and on this table both happen at once, on rung one.

against the table recorded in `content/incursion.data.js` itself, `96 at depth 1 and 81
at depth 5`. **Depth 1 is a 38% fight where its own file says 96%, and depth 5 is 19%
where it says 81%.** Adding a mutator at depth 2
would make an already-far-too-hard opening worse, so the item is struck rather than done.

**⚠ AND THE CAUSE IS THE CAMPAIGN RE-TUNE LEAKING INTO THE ARENA — FOR THE SECOND
TIME.** `meta/incursion.js incursionRegionInputs` overrides `develop` only, and only when
a mutator asks; the plan overrides `enemyMult`. **Everything else the rung is fought with
comes straight off widowsgate's own campaign row** — `siteCounts`, the 21×16 board,
`castleGateFrac`, and `targetLengthMin`, which derives the hard cap. The mid-flight
re-tune moved several of those (widowsgate now reads `develop` 2.32 and
`targetLengthMin` 18 against the tier-6 figures the ladder was last calibrated on). This
is the exact accident CLAUDE.md already records once — *"the widowsgate arena's own dial
shifted underneath it during the campaign re-tune (a shared-tree accident, since rebuilt)
— so `baseDial` was moved 3.65 → 4.38 to restore this shape"* — happening again, and
nothing noticed because no test walks the ladder.

**So the ladder is now downstream of item 1** and must be re-based after the campaign is
back in band, not before. Two things worth doing when it is: re-take the whole shape at
n≥48 and re-author `baseDial` from it, and consider whether a rung should inherit its
arena's row at all — a ladder whose difficulty silently tracks a campaign region it is
not otherwise part of is the same class of coupling as the `REGION_BY_ID` trap.

---

## What a game like this needs to hold someone for twenty hours

Three things, in the order they bite. The first is above; these are the other two.

### A visible long-term goal structure — and the data is already being collected

`meta.stats` tracks **thirteen lifetime counters** — battles, wins, losses, raids,
incursion rungs, units lost and killed, crowns and relics earned and spent, time played,
and time claimed while away. They are written on every battle and carried through
abdication, and until recently **no screen showed a single one of them.**

**That half is DONE**: `meta/record.js` derives and `screens/mainmenu-record.js` renders,
behind a Record button on the menu. The derived figures are the reason to open it — win
rate, kill/loss ratio, and how much of the elapsed time was credited while away, which is
the idle half of the game made visible. Pure UI, zero balance risk, and the arithmetic is
a module so it is tested rather than squinted at.

**The next step is MILESTONES**, and it is now cheap for the same reason: a small, fixed,
non-random set of named achievements over counters that already exist *and are already
displayed*. It is the standard answer to "why open this again tomorrow" for a game with
no server, no accounts and no live-ops, and it costs no balance work at all. The record
drawer is where they would live, and `recordView` is already the one place that knows
what every figure means.

### Sessions you can actually fit into a day

A battle is 7–15 undistracted minutes, and passive play loses on purpose (verified: a
Riverfen battle with zero input is down to two sites inside two minutes). That is
*correct* — it is what stops the idle half being used to skip the real-time half, which
is the whole differentiator. But it means the repeatable unit of play is one full sitting.

Half of this was already built and simply unadvertised, and is now fixed: the battle
autosaves every four seconds and resumes for twelve hours, so closing the tab costs
nothing — but Withdraw was the only *labelled* exit and it gives up the region. The
control now says so.

What is still open is the shape of a short session. There is currently nothing to do in
ninety seconds except collect idle income and buy an upgrade. A raid is a whole battle; an
incursion rung is a whole battle. **This is the least-explored axis in the design and the
one most likely to decide whether someone plays for twenty hours or five.** It does not
obviously need a new mechanic — the shop, the loadout screen and the world map are all
places a two-minute visit could be made worth making.

---

## Explicitly rejected, with the reason

- **New units or regions**, for either problem. Content is not cheap here: a unit is a
  cliff and the dial is a slope, one castle promotion via `develop` is worth 25–40 points,
  and `enemyMult` is violently non-linear past tier 2. Every addition is a full re-tune.
- **Rotating the incursion ladder across regions.** Tried, measured, rejected: 63% vs 6%
  at the identical dial. Re-opening it needs a per-region ladder dial — nine binary
  searches.
- **Any randomness in combat, rewards or events.** Breaks invariant 3 and contradicts what
  every screen promises: the number on the tooltip is the number you get.
- **Multiplayer, leaderboards, accounts, monetisation, energy systems, push
  notifications, cosmetics, seasons.** All need a server this project deliberately does not
  have. The offline cap (8h base, 24h with Treasury) already creates a "check in about
  daily" cadence without any of them.
- **A second, deeper upgrade tree.** The inverse of work already done: 26 capped upgrades
  were collapsed into 6 endless lines *because* they were a wall of reading, six of them
  exact duplicates.

---

## How to verify anything in this file

```bash
npm run verify                                   # size + purity gates, full suite
node tools/simrunner.js --all --n=96             # the campaign; n=240 near a band edge
node tools/simrunner.js --incursion=1-30 --n=48  # the endless ladder
node tools/simrunner.js --region=gallowmoor --n=48 --weights=spearmen:0,raiders:0,rams:0
node tools/simrunner.js --region=widowsgate --n=48 --nothrone   # the bot that won't commit
npm start & node tools/smoke.mjs                 # real pointer events, hit-tested
node tools/mobile.mjs && node tools/mobile.mjs --w=844 --h=390
```

`n=12` is far too noisy to tune on and has hidden real mis-tunes three separate times.
Tune at n≥96 and confirm within ~8 points of a band edge at n=240.
