# Hex Dominion — what to build next, and why

**This file is the ORDERING. `CLAUDE.md` is the inventory.** Every defect, measurement
and scar lives there under "Still open, and why"; this file says which of them to spend
the next session on and what each one costs. When the two disagree, CLAUDE.md is right —
it is the one maintained in the same commit as the code.

Nothing here is a wish. Every claim is either measured (with the command to re-take it)
or explicitly flagged as an opinion.

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

0. **TAKE THE OUTCOME SIGNATURE BEFORE TOUCHING A DIAL. NEW, AND IT REORDERS THE LIST
   BELOW.** thanescar at n=32: dial 4.60 reads 19 win / 13 timeout / **0 loss**, dial
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
