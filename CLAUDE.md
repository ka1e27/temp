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
`WIN_BAND` in `tools/simrunner.js`: `[[78,92], [66,84], [50,72], [34,56], [22,42]]`. It used
to be a single 55% floor, which stopped being usable once the endgame was meant to be a
genuine wall: a region designed to cost you two or three attempts reads as TOO HARD against
a number chosen when every region was a probable win. The ceiling is the half that never
existed and mattered more — most of this project's real mis-tunes were regions that were
too EASY, and a walkover reports "ok" against a floor right up until someone plays it.

**Battle length is measured over WINS, not over all runs**, and that mattered more than it
sounds. `targetLengthMin` is what the world map tells the player the region costs, and what
a player means by that is how long it takes to *take* it — a loss is not a short battle, it
is one that ended early because they were being rolled up. The two only agree while wins
dominate, and they come apart exactly where the campaign gets hard. Measured at n=64:

```
region        win%   all-med  win-med   advertised
emberholt      84%     12.1     13.0       16.5
karrowmere     63%      6.5      8.4        8.5
obsidian       39%      5.1      8.0        8.5
nightharrow    34%      3.6     11.1        9
```

Emberholt barely moves; nightharrow moves by a factor of three. Gating on the all-runs
median would have forced every tier-5 region to advertise five minutes — shorter than tier
*one* — to describe a battle that actually takes eleven. Below five wins in the sample the
length gate steps aside entirely and lets the win-rate verdict speak. The same fix is in
`tests/campaignplay.test.js`.

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
tier 1   89 84 84 84        tier 4   52 34 52 47
tier 2   80 70 72 78 72     tier 5   22 23 36
tier 3   55 64 53 59 69
```

n=64 with the band edges confirmed at n=240. All twenty-one report `ok` against their
tier's band *and* their advertised length. Nothing is frozen any more: the expedition
re-base changed regions 1–5 by construction, so they were solved with the rest. What
replaced the freeze is the per-tier `WIN_BAND`.

## A raid stays a raid: the starting-footprint pass

`siteCounts.player` is the biggest difficulty lever in the region table, so every pass that
needed a region easier reached for it — and **nothing asserted where that ended up.** Share
of the board owned at tick 0, before this was pinned:

```
tier 1   player 25-29%   enemy 45-50%     reads as a raid
tier 3   player 38-39%   enemy 43-45%
tier 4   player 39-43%   enemy 41-42%     parity
tier 5   player 44-48%   enemy 38-41%     you own more than they do
```

On Nightharrow — the deepest region of the enemy's homeland — the player started holding
**23 sites to the enemy's 18.** The campaign's premise is that you are raiding country the
enemy holds outright, and the raid stopped being a raid exactly where it should be hardest.
Every difficulty number passed, because difficulty was measured and ownership never was.

It is now a flat **3–4 sites everywhere** — a beachhead, not a province — with the freed
sites turned **neutral** rather than deleted. `tests/campaign.test.js` pins the ceiling
*and* the creep.

**But the site table was never what a player looks at.** The board is coloured by
INFLUENCE, and `recomputeInfluence` skipped every site that wasn't player or enemy, so a
neutral farm sat inside whichever faction's colour reached it first — and that was almost
always the player, because the camp carries the widest radius on the map. A 27% site share
painted a 46% board:

```
region        sites P/E/N     board before      board now
riverfen      3/5/3           42% / 43%         31% / 40%, 27% unclaimed
nightharrow   13/17/18        46% / 42%          9% / 39%, 52% unclaimed
```

Difficulty was measured to four decimal places and the thing on screen was never checked
once, so the campaign shipped with the player holding more of the enemy's capital than the
enemy did. A neutral-won hex is simply OMITTED (absent already reads as `neutral`), so this
cost nothing in the save and needed no contract bump. `tests/influence.test.js` is new —
there was no influence test file at all — and pins it with a negative control.

**What paid for it — and what didn't.** Cutting the footprint costs 30–55 points a region.

| Lever | Worth | Notes |
|---|---|---|
| `EXPEDITION.perRegionSurge` | **+32 on one region** | The main payer, and *strongly non-linear* |
| `AI_TIERS[].economyMult` | ~3 pts / 0.01 | The other payer; smooth where the dial isn't |
| `enemyMult` | **blocked** | Tier 3 would need 2.60 against tier 2's 2.88, and it must be non-decreasing |
| `AI.warmup` | ~0 | 90s→165s moved gallowmoor 16%→10%. The player wasn't losing the opening |
| `castleGateFrac` | 1 pt | Swept 0.65→0.38 on thanescar. *Still* not a difficulty knob |

**The expedition is non-linear and that is the whole finding.** `perRegionLate` 5→11 bought
gallowmoor 7 points; 11→18 bought thanescar **32**. There is a threshold where the landing
force can actually contest the neutral pool, and below it more slots do almost nothing. A
starting site is an economy that compounds over ten minutes; a body in the landing stack is
a one-time deposit — they do not trade one for one until the stack is big enough to take
ground with.

That forced a **third expedition segment** (`surgeAfter: 8`, `perRegionSurge: 23`): the
campaign needs +3 slots a region at tier 2 and +23 at tier 5, and one rate for both either
starves the endgame or hands tier 2 a walkover (measured — the uniform rate that cleared
thanescar put emberholt at 85%, one point past its ceiling).

**Two knock-on effects worth knowing:**

- **The tier-3 dial ramp had to steepen to +0.21 a region** (tier 4 runs +0.08). The surge
  hands the player a bigger step than the dial's, so tier 3 sloped 23 → 79 across five
  regions — a 56-point slope inside a 22-point band.
- **Two difficulty proxies in `campaign.test.js` broke and were replaced, not relaxed.**
  `MAX_OPENING_RATIO` counted neutral ground as nobody's, so a big neutral pool read as a
  rout (`foe/mine` 3.5 on nightharrow); it now splits into a floor on `foe/mine` (you must
  be outnumbered) and a ceiling on `foe/(mine+neutral)` (it must be convertible) — which
  also retired the per-tier ladder, since one global ceiling fits again. And the
  "enemy gains on the player" headcount test now measures the two things that *are* true:
  the enemy's absolute army rises every tier, and the share of your force that comes from
  the expedition rather than handed ground goes 66% → 81%.

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
the same mechanic and silently re-tune all twenty-one regions. If that is ever wanted, it is a
balance pass, not a bug fix.

**The enemy's `marshal` unlock used to be inert, and is now real** — see the tier-5 section
below. It was listed in `ENEMY_UNITS_BY_TIER` at tier 4 for this project's whole life and
nothing produced one, so removing it changed thanescar's win rate by exactly 0 points.
Ironcrown's "The enemy fields a Marshal" was simply false. `meta/modifiers.js`
`withEnemyMarshal` now grants exactly one, into the throne, mirroring the player's
`withFreeMarshal`. `tests/marshal.test.js` pins it, negative control included.

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

## Tier 5, and the enemy Marshal that finally exists

The campaign ran to eighteen regions and ended at a capital, which is a strange place for a
war to stop — taking the enemy's capital is when you find out how much country is behind
it. Three more regions sit east of the throne at hex `[5,-1]`, `[5,0]`, `[5,1]`:
**Ravensmarch**, **Gravenreach**, **Nightharrow**. Obsidian is no longer "the last one";
it is their capital.

**The enemy Marshal is real now, and it was the tier's starting point.**
`ENEMY_UNITS_BY_TIER` listed `marshal` at tier 4 for this project's entire life and nothing
produced one — no `MAPGEN.trainType` builds it, `AI.counterPick` maps marshal→spearmen
(what to field *against* one), `BASE_GARRISON` never held one. Ironcrown's flavour text was
simply false. `meta/modifiers.js` `withEnemyMarshal` now grants **exactly one, into the
throne**, mirroring the player's `withFreeMarshal`:

- `banner` is stack-local, so where he stands decides what he buys. In the castle it is
  +25% to the garrison defending the win condition, and `trainBuff` makes the throne refill
  40% faster — a stall now feeds the wall you are hitting.
- "Until you kill it" is literally true: `battle/ai.js` filters `kind === 'castle'` out of
  the launch pool, so he cannot wander off and be farmed in a field.
- Applied **after `normalizeSites`**, deliberately. `MAPGEN.garrison` is multiplied by
  `enemyMult ^ ENEMY_SCALING.garrison` *and* the throne bonus, so a marshal placed in that
  table would be scaled into two or three on the late regions — and `maxPerSite` lives in
  `battle/training.js`, which never sees a garrison mapgen wrote.

Measured at n=96, granting it cost tier 4 **1–8 points** (thanescar 54→46, blackspire
46→45, ironcrown 45→40, obsidian 48→40). All four stayed inside `WIN_BAND` — but ironcrown
fell below `campaignplay`'s winnable floor, so tier 4's dial was walked back by roughly what
the marshal costs (ironcrown 4.0→3.9, obsidian 4.1→4.0). **Tier 4 plays as it was tuned to;
the marshal is paid for, not absorbed.**

**What makes tier 5 hard is not a new unit.** The roster runs out at tier 4, so
`ENEMY_UNITS_BY_TIER` repeats itself — a tier whose identity is a new unit is a tier that
cannot be tuned, because a unit is a cliff and the dial is a slope. Three things carry it:
`AI_TIERS[4]` (the first commander that thinks more than once a second, commits under a
1.10 margin, and runs **four** simultaneous attacks — `concurrent` is the knob the player
feels, because the answer to two threats is one relief force and the answer to four is that
there is no reserve); the ground (19×15, `develop` 2.6→3.1); and the marshal on a level-4
castle.

**Three measured facts from the tune, all of which cost time to learn:**

- **`enemyMult` is even more non-linear here than at tier 4.** Ravensmarch lost **22 points
  over +0.10** (4.15→4.25). Move it in steps of ≤0.03 at tier 5, and confirm at n=240 —
  n=64 and n=96 disagreed by 13 points on the same dial setting.
- **The level-4 castle is worth 11 points**, not the 25–40 a promotion costs at tiers 3–4
  (nightharrow: develop 3.1 → 10%, develop 2.95 → 21% at n=48). `develop` 3.05 does *not*
  promote it — `developLevels` needs `share ≥ 0.5/pool` and the fort pool is 6, so 3.1 is
  the first value that lands.
- **A player starting site is worth ~13 points at tier 5**, and it is the only lever that
  lowers the opening force ratio, because `MAPGEN.garrison.player` bodies are the only part
  of the landing force that scales with anything but `EXPEDITION`.

`MAX_OPENING_RATIO` in `tests/campaign.test.js` became a per-tier ladder for the same reason
`WIN_BAND` did. The old single 2.6 was set just clear of the worst ratio the campaign then
produced (emberholt, 2.556) when tier 4 was the end; tier 5 opens at 2.60–2.68 and is
measurably still convertible there. It is still a hard ceiling per tier, still required to
be non-decreasing, and still capped at 3× globally.

## Three specialists, and a harness that cannot play them

The roster was five units: a rock-paper-scissors of stats plus a siege engine. A sixth set
of stats would only have moved which column of the same table you read, so the three added
instead each own a **verb** — a hook in the simulation, not a bigger number on an existing
one.

| Unit | Slots | Verb | Why it matters |
|---|---|---|---|
| **Outriders** | 2 | `skirmish`, speed 165 | 3× a militia's march. Maps are 30–50% unclaimed at tick 0, so the race for neutral ground *is* the opening |
| **Halberds** | 4 | `sunder` 0.50 | Halves the defender's `siteDefMult` — the one term no amount of militia answers (a castle defends at ×1.60 before walls) |
| **Sappers** | 3 | `repair` 1.9 | `breachSeconds()` returns `Infinity` the moment repair out-paces siege damage, so a wall they garrison is *arithmetically* uncrackable without engines |

All three are share-scaled like `counters`: a token escort strips nothing, so committing to
the answer is what buys the answer.

**They are opt-in, and that is what let three ship at once.** None has a
`DEFAULT_COMPOSITION_WEIGHT` and none is in `ENEMY_UNITS_BY_TIER`, so
`distributeExpedition` — which is what the harness fields — produces a byte-identical army
and every number in `regions.data.js` still holds. Adding units did not re-tune the campaign.

**`skirmish` was hardcoded to raiders.** `skirmishHome` read `sq.comp.raiders` while pulling
the *fraction* from the spec, so the hardcoding was invisible and a second skirmisher would
have escaped nothing at all. Generalised, with a negative control.

**Four fixtures hardcoded the five-unit roster** and had to be derived from `UNIT_IDS`
instead: `emptyComp()` itself (so `{...emptyComp(), ...x}` silently omitted the new units),
the formation block map (positional — every assertion meant "index 3" rather than "rams"),
and the loadout and preview fixtures.

**THE HARNESS CANNOT DEMONSTRATE THEM, and this is the honest state.** Measured at n=48,
substituting 25–35% of the budget onto a specialist makes `simplayer.js` *worse* everywhere:

```
region        default   +outriders   +halberds   +sappers
gallowmoor      60%        44%         27%         33%
thanescar       52%        25%         25%         27%
nightharrow     40%        27%         19%         29%
```

That measures the BOT, not the units. It does not send outriders at distant neutrals, mass
halberds against a castle, or garrison sappers in a threatened wall — it plays one
undifferentiated army. The levers themselves are proven in `tests/units.test.js` against the
real sim paths with negative controls (3× march, exact half-bonus strip, `breachSeconds`
→ `Infinity`). **This is the same shape as the site-upgrade gap that went unnoticed for
years**: a mechanic the harness does not exercise is a mechanic no balance number covers.
Teaching the bot to field them is a balance pass, not a bug fix — and until it happens, no
specialist should be given a default weight on the strength of harness numbers.

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
