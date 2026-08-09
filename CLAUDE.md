# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Hex Dominion** — a browser game combining idle income with real-time territorial
conquest. You take hex regions one at a time; conquered regions pay crowns per second
whether or not you are playing; crowns buy upgrades that crack the next, harder region.

**Zero dependencies, no build step, no `node_modules`.** Vanilla ES modules served
straight to the browser. Adding a dependency breaks the core promise of the project —
don't, without asking.

## Commands

```bash
npm start                  # dev server on :8080 (tools/serve.js)
npm test                   # node's built-in runner
npm run watch              # tests in watch mode
npm run check              # file-size + purity gates
npm run verify             # check + test
npm run sim                # headless balance harness

node --test tests/combat.test.js          # one file
node --test --test-name-pattern="siege"   # one test by name
node tools/simrunner.js --region=kaldan --n=50
node tools/simrunner.js --all --n=96 --noupgrades   # the pre-upgrade-ladder bot
node tools/smoke.mjs       # browser smoke test — needs `npm start` running first
```

`npm test` needs the glob quoted (`"tests/**/*.test.js"`); `node --test tests/` does not
recurse and silently runs nothing.

**ES modules cannot load from `file://`.** Opening `index.html` directly will never work.

## Architecture

Two loops that feed each other. **Battles** are real-time: farms make gold, strongholds
spend gold to train soldiers, you drag squads between sites. **Meta** is idle: regions pay
crowns, crowns buy permanent upgrades.

```
src/core/      pure: hex math, seeded RNG, fixed-timestep loop, event bus, state store
src/battle/    pure: the simulation — combat, siege, rally, movement, economy, AI
src/meta/      pure: world map, idle income, upgrades, save/load
src/content/   pure data: all tuning numbers, regions, units, strings
src/render/    canvas 2D
src/screens/   DOM scenes
src/ui/        DOM helpers, formatting, coach marks, dev overlay
```

Several files are split purely for the 400-line cap and re-exported from their original
home, so an import never has to know: `balance.js`←`ai.data.js`, `regions.data.js`←
`regions.rules.js`, `sim.js`←`rally.js`, `commands.js`←`boosters.js`,
`battle-panel.js`←`battle-actions.js`/`battle-upgrade.js`, `mainmenu.js`←
`mainmenu-settings.js`.

### The four invariants

Everything else is negotiable. These are not.

**1. Directory-level purity.** `core`, `battle`, `meta`, `content` may never touch
`document`, `window`, `localStorage`, `Math.random`, `Date.now`, `performance`, `fetch`,
`requestAnimationFrame`, or `getComputedStyle`. Inject the dependency instead of reaching
for a global. `tools/checkpure.js` enforces this mechanically. This is what lets the whole
simulation run headless with zero mocking.

**2. `battle/` and `meta/` never import each other** — except through
`src/battle/contract.js`, and `src/screens/battle.js` is the only broker.
`meta/modifiers.js → BattleConfig → battle/state.js`, and
`battle/outcome.js → BattleOutcome → meta/rewards.js`. Both directions are validated at
runtime by `assertBattleConfig` / `assertBattleOutcome`. Changing a field means bumping
`CONTRACT_VERSION` (currently **5**) — which is also what makes `meta/resume.js` discard a
mid-battle blob whose shape the current engine would step wrongly.

**3. Zero randomness in combat.** The pre-commit outcome preview calls the *same function*
the simulation runs, so it is a guarantee, not an estimate. Map generation uses seeded RNG
from `core/rng.js`; combat resolution uses none at all.

**4. 400-line cap** on every file in `src/`, `tools/`, `tests/`, enforced by
`tools/checksize.js`. Split rather than accommodate.

### Simulation model

- **Fixed timestep at 10 Hz** (`TICK_HZ` in `core/loop.js`), decoupled from rAF rendering
  via an interpolation alpha. Speed control multiplies sim ticks and must never scale the
  idle economy — idle accrues on **wall-clock** ms, or 4× speed becomes a money printer.
- **The sim never emits on the bus.** It pushes to `state.events[]`, which is drained
  after the tick by `screens/battle.js`. `step()` clears the array at the top.
- **Presentation never mutates sim state.** Input appends command objects to
  `state.commands[]`; the sim drains them.
- **Squads store no position.** `arriveTick` is computed once at spawn; renderers derive
  position from `tick` and interpolation alpha.

### Two-stage capture

Taking a site is a field battle (proportional attrition, largest-remainder
integerization) followed by a **siege** against structure HP that regenerates.
`breachSeconds()` returns `Infinity` when siege damage cannot out-pace repair — that one
mechanism is what makes "a few troops genuinely cannot take a stronghold" and "a real army
grinds one down in half a minute" both true, without an arbitrary minimum-troops rule.
Sieges are interruptible, so relief forces matter.

### Rendering

Two canvases. `#board-bg` repaints only when `signature(state)` changes (ownership, level,
influence version); `#board-fx` every frame. Draw paths allocate nothing per frame, batch
by colour, and never use `shadowBlur` (10–50× a plain fill). `battleView.js` owns the
frame; `siteGlyphs`/`siteShapes`/`terrain`/`hexGeom`/`formation`/`routes` are its parts.

Army size is always drawn as **individual troop pieces**, never a size-scaled glyph —
marching columns and dug-in siege crescents use the same per-piece length so the two are
directly comparable.

### Tuning

All of it lives in `src/content/balance.js`. A balance pass should be a one-file diff.
`npm run sim` reports win rate and median duration per region against the target band; a
presentation change must leave those numbers **identical**.

**The verdict gate is PER TIER, and it has a ceiling as well as a floor** —
`WIN_BAND` in `tools/simrunner.js`: `[[78,92], [66,84], [50,72], [34,56]]`. It used to be a
single 55% floor, which stopped being usable once the endgame was meant to be a genuine
wall: a region designed to cost you two or three attempts reads as TOO HARD against a
number chosen when every region was a probable win. The ceiling is the half that never
existed and mattered more — most of this project's real mis-tunes were regions that were
too EASY, and a walkover reports "ok" against a floor right up until someone plays it.

**`n=12` (the CLI default) is far too noisy to tune on, and has hidden real mis-tunes three
separate times.** Kaldan's long-standing "58% ok" was an n=12 artefact; one build measured
52% at n=120 and 57% at n=240; `ironcrown` read 54% at n=48 and 57% at n=240. Tune at
**n≥96**, confirm anything within ~8 points of a band edge at **n=240**, and use
`--all` at low n only as a smoke check. Some medians sit on a cliff — kaldan pegs the hard
cap in ~40% of runs — so a median can jump discontinuously between sample sizes.

**The difficulty dial must rise in the same steps the PLAYER does.** The shop buys
cheapest-affordable-first and crowns compound ~1.3× a region, so combat multipliers arrive
in lumps every second region (+15.4% into greywater, +14.3% into emberholt, 0% into
highmarch/thornmoor/gallowmoor/thanescar/obsidian). A smooth `enemyMult` ramp against that
produces a 27-point sawtooth. Check the player's `unitAtkMult × unitDefMult` step off real
`buildBattleConfig` output before blaming a region.

**The player's step includes the mechanics the harness actually plays**, which is the
expensive lesson of the section below: for most of this project's life it did not play the
site-upgrade ladder at all, and every region was priced against a player who ignored it.
When a mechanic is added, check the bot exercises it *before* trusting the next table.

Two related traps in the same area: `develop` is quantised on the **castle**, because
`developLevels` promotes best-first and the best fort is the throne — one castle level is
worth ~26 points, so where the fraction lands matters more than how big it is. And a unit
unlock can make the landing force *smaller* (rams cost 5 slots a body: 54 → 48 into
thornmoor), so the player's step into that region is negative.

## The harness bot upgrades sites, and the campaign is tuned against that

**This was an open work item for a long time and it is now closed. Read it before
trusting any balance number, because every number older than this pass is measured
against a different player.**

`tools/simplayer.js` used to issue no in-battle `UPGRADE` command — ever. So `SITE_LEVELS`
(5 rungs) and all four `SITE_UPGRADE` steps were unexercised by every measurement the
project had taken, while the enemy got that same ladder **free at mapgen** through each
region's `develop`. Levelling was tuned in for the defender and tuned out for the attacker.
It was never an affordability problem: the bot sat on 800–7,000 spare gold it never spent.

`upgradeTurn` in `tools/simplayer.js` now buys it. **What an ordinary player upgrades was a
design decision, not a flag**, and the five rules that encode it are documented at the
function — rear sites only, one build at a time, out of a training-cost reserve, cheapest
step first, and **stopping short of the L4→L5 step** (2200g/65s is a solver's purchase, not
an ordinary one). Max-levelling every safe site is optimal play; pricing the campaign
against optimal play ships an endgame nobody clears.

Turning it on moved the campaign **+9 to +25 points** and flattened it to 76–99% at n=96 —
tier 2 played exactly as easy as tier 1. `src/content/regions.data.js` was retuned against
it; the reasoning is in that file's third load-bearing rule.

That table has since been retuned again, for the *uphill raid* pass (a smaller landing
force, an enemy warm-up, and a shop with no ceiling). **The current measured curve, n=240:**

```
tier 1   88 85 87 85
tier 2   78 74 71 80 75
tier 3   62 63 64 63 54
tier 4   52 45 45 46
```

Nothing is frozen any more: the expedition re-base changed regions 1–5 by construction, so
they were solved with the rest. What replaced the freeze is the per-tier `WIN_BAND`.

`--noupgrades` reverts `npm run sim` to the old bot, so the delta stays measurable rather
than remembered. `tests/harness.test.js` pins all of it — including a negative control, since
the original bug was precisely a mechanic nothing ever asked about.

**Three lever facts that came out of the retune**, worth more than the numbers:

- **`siteCounts.player` is the biggest lever in the table and it now compounds**, because
  every extra starting site is another site to *build*. Tier 2 shipped seven and became
  unfixable by the dial alone — solved independently, the dial tier 2 needed (emberholt
  2.54) *overtook* the dial tier 3 wanted (gallowmoor 2.43), and `enemyMult` is required
  non-decreasing, so that is a contradiction rather than a tuning problem. Cutting tier 2 to
  six resolved it and bought back the battle length the ladder had eaten (emberholt
  97%/9.8m → 81%/11.9m on that one column, against a 16.5m advertised length).
- **`castleGateFrac` is not a difficulty knob.** Swept 0.30→0.60 on emberholt it moved the
  win rate *one point*, because this bot already sweeps the countryside when winning. It
  buys the guarantee against a rush strategy. That is all it buys.
- **`enemyMult` is violently non-linear past tier 2.** Gallowmoor loses 31 points over
  +0.26; thanescar 43 over +0.50. Move it in steps of ≤0.05 late and re-measure — never
  extrapolate. A castle promotion via `develop` is worse: 25–40 points on one rung.

**Still open, same ladder.** The enemy AI deliberately does *not* get this button —
`ai.js`/`aicore.js`/`aihome.js` never upgrade, and `tests/harness.test.js` pins that. It
already receives the ladder via `develop`, so teaching it to buy upgrades would double-count
the same mechanic and silently re-tune all eighteen regions. If that is ever wanted, it is a
balance pass, not a bug fix.

**Also inert, found while measuring this:** the enemy's `marshal` unlock does nothing. No
`MAPGEN.trainType` produces one and `counterPick` never picks one — removing marshal from
the tier-4 roster changed thanescar's win rate by exactly 0 points. Ironcrown's flavour text
("The enemy fields a Marshal") is **still false**, and is the one thing from this list that
has not been fixed: the player's marshal was reworked, the enemy's was not. Giving the AI a
real one is a difficulty change and would need its own measured pass.

## The uphill-raid pass: what moved and why

You are raiding regions the enemy owns outright, and for most of this project's life the
game did not play like it. Five things changed together; each one moves the balance table,
which is why they were measured as one pass rather than five.

**You land small and grow into it.** `EXPEDITION` went from `base 19 / perRegion 12` to
`12 / 10`, and `MAPGEN.garrison.player` was thinned to match. The end-to-end ratio went
from 7.6× to 9.75×: more of your landing force is something you went and got. Note
`PLAYER_SITE_GARRISON` in `regions.rules.js` is **dead on the real path** — only
`meta/fallbackMap.js` reads it. `MAPGEN.garrison` is the live table.

**The enemy has a warm-up.** `AI.warmup` in `content/ai.data.js`, applied by `rampFor` in
`battle/aicore.js` where the per-think knobs are assembled. Over 90 seconds it eases
`safetyMargin`, `commitRatio` and `concurrent` from cautious to the tier's real values.
Landing outnumbered against an opponent that presses from tick 0 is a coin flip, not a
fight — the two changes only work as a pair. It is a function of `state.tick`, so it
replays. **Do not ramp `reactionTicks`**: `tests/ai.test.js` pins the jitter band off it.

**`aggression` is gone, and it never did anything.** It was a per-tier multiplier on a
score that is only ever *sorted*, with no threshold anywhere — the 0.60→1.20 ladder could
not change the ordering, the launch count, or anything else. Deleting it changed no
behaviour by construction. If you need to vary the enemy's appetite, the knobs that
actually bite are `commitRatio`, `safetyMargin` and `concurrent`.

**The shop is six endless lines.** Twenty-six capped upgrades collapsed into `treasury`,
`warChest`, `standingArmy`, `arms`, `drill`, `siegeworks`, plus one-off unlocks. Six of the
old entries were an "endgame tier" that duplicated an opening entry exactly. Levels are
uncapped and prices compound while effects add, so **power grows with the logarithm of
crowns spent** — a hundred times the idling is a few more levels, not a hundred times the
strength. `SAFE_MAX_LEVEL` (64) is a floating-point ceiling, not a design one.

Four retired upgrades were *sold and did nothing*: Field Manual (150 crowns for exact
preview numbers `battle-preview.js` already showed everyone), Scout Report, Standing
Orders, and Wrecking Crew (`ramImpactHp` crossed the seam and no battle file read it).
`FEATURE_IDS` is now just `doubleSpeed`. `core/store.js` `refundRetired` pays every
retired level back at what it charged, once, on load — idempotent because the key is
deleted as it is refunded.

**The Marshal is a perk, not a purchase decision.** `maxOf('marshal')` is **0** — the
expedition budget can never buy one. Unlocking grants exactly one free per landing outside
the budget (`withFreeMarshal`), and more are commissioned in battle with the `RECRUIT`
verb: pay gold, he arrives at once, `trainType` untouched. Only units with a `maxPerSite`
are commissionable, which is what makes buying one outright safe.

### Gestures and controls

- **A tap never sends.** Tap-then-tap used to issue a send and fired by accident constantly
  — the panel sits over the board and every neighbour is a legal target. Dragging is the
  only way to send. `view.armed` survives as "last touched" for `setRally`'s fallback and
  the preview's implied origin. Pinned by `tests/tapsend.test.js`, which fails three ways
  against the old code.
- **A rally is a LIST.** `site.rallyTargets[]` plus a sim-owned `site.rallyCursor`; one
  site feeds several neighbours in strict rotation. The cursor advances **only on a send**,
  so a starved tick does not skip a destination. It must stay in sim state or command-log
  replay diverges.
- **Speed is a slider, 0.25×–4×.** Everything at or below 2× is free, past that is the
  Tactician. Slowing is never gated — it cannot win you a battle, so charging for it would
  be charging for legibility.
- **`meta.settings` persists preferences** (default rally hold-back, default speed). They
  live inside `meta`, so `fromPersisted` heals them and no migration was needed; and they
  survive a new campaign and a save import, because they are the player's, not the save's.

## Gotchas that have already cost time

- **`h(tag, props, ...children)`** — the second argument is *always* props. Passing an
  element there silently drops it. Pass `{}` when there are no props.
- **`#screen-root` is `pointer-events: none`.** Every scene must opt back in
  (`.screen { pointer-events: auto }`). A whole release once shipped completely
  unclickable because `tools/smoke.mjs` used synthetic `el.click()`, which bypasses hit
  testing. The smoke test now dispatches **real pointer events** and asserts
  `document.elementFromPoint` lands on the target first. Keep it that way.
- **Tests that assert the wrong thing** are the recurring failure mode here, not tests
  that fail. Dead boosters and an unclickable UI both passed a green suite because the
  fixtures encoded the bug. Prefer asserting against real `buildBattleConfig` output
  (`tests/seam.test.js`) over hand-built objects.
- Camera zoom set directly leaves the cached background canvas stale — go through
  `view.releaseAutoFit()` + `view.markBgDirty()`.
- `localStorage` keys are separate and independently validated: `hexdominion.save`
  (campaign) and `hexdominion.battle` (mid-battle resume). Anything stale, corrupt,
  finished, or from a different contract version is discarded rather than migrated.

## Deployment

`.github/workflows/pages.yml` deploys to GitHub Pages on every push to `main`, gated on
`npm test` and `npm run check`. Live at **https://ka1e27.github.io/temp/**
(`?dev=1` for the developer overlay).

The workflow cannot enable Pages itself — `pages: write` grants permission to deploy to a
Pages site, not to create one. That was a one-time admin action and it has been done.
