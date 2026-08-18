# Hex Dominion — what to build next, and why

**This file is the ORDERING. `CLAUDE.md` is the inventory.** Every defect, measurement
and scar lives there under "Still open, and why"; this file says which of them to spend
the next session on and what each one costs. When the two disagree, CLAUDE.md is right —
it is the one maintained in the same commit as the code.

Nothing here is a wish. Every claim is either measured (with the command to re-take it)
or explicitly flagged as an opinion.

---

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

- [ ] **Transcribe the six specialist reports into ranked items below.** (Blocked on the
      agents finishing; partial transcription as each lands is expected and correct.)
      Findings from my own hands-on pass are already below and are NOT waiting on them.

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
      **7 of 13 sampled battles ended this way**, so it is the most common loss text in
      the game.
- [ ] **The why-line has no visual priority over the flavour line above it.** Same size,
      same weight, same colour — the single most actionable sentence on the screen reads
      as a continuation of the subtitle.

### From the idle-half critic

*Its headline verdict is worth keeping: the idle ECONOMY is genuinely well-built —
honest caps, provably seamless online/offline math, prestige legible before you commit —
but **the only infinite, ever-escalating system in the game (the incursion ladder) is
the one an idle player can never touch**, because auto-resolve is restricted to raids.
The idle half is a well-made finite game; "endless" lives entirely in the RTS half.*

- [ ] **A PLAYER WHO NEVER OPENS THE SHOP IS CAPPED AT EIGHT OFFLINE HOURS FOREVER.**
      The offline cap is gated entirely on Treasury levels. At full conquest that is
      roughly **55 million crowns silently discarded on one missed day**, for a play
      style this genre's audience plainly contains (engage with the RTS, ignore the
      meta-shop). The away banner now explains it after the fact — which is most of the
      fix and shipped this session — but nothing warns before the cap binds, and nothing
      on the world map says "your cap is still at the floor".
- [ ] **THE IDLE ECONOMY IS INVISIBLE FOR THE ENTIRE LENGTH OF A BATTLE.** Code search:
      **zero** UI surface under `src/screens/battle*` reads crowns or income. For a game
      whose one-line pitch is idle income married to real-time conquest, the two halves
      never appear on screen together — for 8-20 minutes at a stretch, which is most of a
      session's wall clock.
- [ ] **Four of twenty-four shop waypoints miss the project's own ~180s
      time-to-next-purchase pacing target** (up to 316s), clustered at the tier 3→6
      transition. Never felt in practice because the next battle absorbs it — flagged
      only because it is a target the codebase states explicitly and measurably misses.
- [ ] **No auto-spend toggle**, though "Spend all" and per-line "x10" already remove most
      of the tedium. Low cost; listed for completeness.

<!-- MORE FINDINGS GO HERE as the four unreported lenses are re-run. -->

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

**4. Pull the incursion mutator onset forward — but check it is worth it first.**
`mutatorsAt: [3, 9, 18]` means depths 1–2 draw none, so the first rungs of the endless
ladder are dial-only reruns of one map. Cheap to change (`content/incursion.data.js` is
pure data and fully harness-playable via `--incursion=`), and cheap to measure. Ranked
low deliberately: it is two rungs out of an infinite ladder, and the player is past them
in five minutes. Measure the payoff before spending the re-sweep.

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
