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

### Blocking — the deploy is red until this is done

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

- [ ] **The campaign re-tune against the melee layer.** Full brief in the section below
      (`Do this first`). `tests/campaignplay.test.js` still FAILS, but on **one** row now:
      re-run on the fixed engine, `nightharrow` went 0/48 → **1/24 PASS** (the five state
      bugs were its whole problem) while `stormhalt` is still **0/48** and is therefore a
      real balance problem rather than a defect wearing balance's clothes. Current
      campaign table (n=48, fixed engine) is in `CLAUDE.md` — riverfen 90 ok, kaldan 73
      ok, gallowmoor 17 TOO SLOW, thanescar 6, ravensmarch 2.
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
- [ ] **The three endgame loops do not compound.** A raid is a timer with a lump at the
      end, and `harderPerClear: 0.15` compounds forever but is never surfaced as its own
      stat — it is folded silently into the same "Enemy strength" figure a fresh attack
      shows. Abdication's replay is 81–100% by run 2 BY DESIGN (`prestige.js` says so),
      so its content evaporates after the first reset. **Fix (the reviewer's pick, and I
      agree it is the best value):** apply incursion-style mutators to REPLAYED campaign
      regions on run 2+. The wiring is a generalisation of `meta/incursion.js`, which
      already rides fields that cross the seam. **Cost M, and it needs a measurement pass**
      — it touches the region table, so it cannot ship unmeasured.
- [ ] **Short-session lever: auto-resolve a RAID only.** Combat is deterministic
      (invariant 3) and the bot that plays every measured battle already exists headless.
      A raid is documented as a rerun with no new tactical content, so resolving one in
      the background is not cheapening the core promise — first conquests and incursions
      are explicitly excluded, because those are where the real-time battle IS the
      content. **Cost M.**
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
