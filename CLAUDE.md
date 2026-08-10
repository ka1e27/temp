# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Hex Dominion** — a browser game combining idle income with real-time territorial
conquest. You take hex regions one at a time; conquered regions pay crowns per second
whether or not you are playing; crowns buy upgrades that crack the next, harder region.

Twenty-four regions in six tiers, and then three endgame loops that do not end: an
**incursion ladder** (one battle per rung, escalating forever), the **Crown** shop tier
that pays for it, and **abdication**, which trades a finished empire for a permanent
multiplier and starts the campaign again.

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
node tools/simrunner.js --region=gallowmoor --weights=halberds:0.3   # field a specialist
node tools/simrunner.js --incursion=1-14 --n=32     # the endless ladder, by rung
node tools/simrunner.js --incursion=40,55 --idle=600  # ...for a player who has idled
npm run mobile             # phone-width layout audit — needs `npm start` running
node tools/mobile.mjs --w=844 --h=390                # a phone in landscape
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
`mainmenu-settings.js`/`mainmenu-legacy.js`, `modifiers.js`←`marshals.js`,
`simrunner.js`←`simladder.js`.

**`regions.rules.js` now also holds the two load-bearing rules of the region table**
(a region's step must be the size of the player's step into it; the player's step
includes the mechanics the harness actually plays). They moved out of the table's own
header when tier 6 needed the budget, and they belong there: both are claims about
every row.

The endgame layer is `content/incursion.data.js` + `meta/incursion.js` (the ladder),
`content/legacy.data.js` + `meta/legacy.js` (abdication), and `screens/incursion.js` +
`screens/mainmenu-legacy.js` for the two surfaces.

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
`CONTRACT_VERSION` (currently **6**) — which is also what makes `meta/resume.js` discard a
mid-battle blob whose shape the current engine would step wrongly.

**v6 is `rules.incursion` — `{depth, mutators[]}` — and it carries a rung's IDENTITY,
not its effects.** Every incursion mutator is applied on the meta side through a field
that already crossed the seam (a FactionMods multiplier, a generation input,
`castleGateFrac`), so the engine steps a rung with no knowledge that the ladder exists.
The field is there for the three consumers that must tell one rung from another:
`meta/rewards.js` (a rung must never be paid as a raid on the same ground), the results
screen, and the HUD.

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
`WIN_BAND` in `tools/simrunner.js`:
`[[78,92], [66,84], [50,72], [34,56], [22,42], [18,36]]`. It used
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
tier 2   80 70 72 78 72     tier 5   22 23 36    (34 on nightharrow at n=240)
tier 3   55 69 53 59 69     tier 6   36 27 19    (21 25 21 at n=240)
```

n=64 with the band edges confirmed at n=240. All twenty-four report `ok` against their
tier's band *and* their advertised length. Nothing is frozen any more: the expedition
re-base changed regions 1–5 by construction, so they were solved with the rest. What
replaced the freeze is the per-tier `WIN_BAND`.

**Tiers 1–5 are byte-for-byte what they were before tier 6 shipped**, which is a
guarantee rather than a happy result — see the fourth expedition segment below.

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

## Tier 6, and the fourth expedition segment that paid for it

Three regions east of the homeland — **Stormhalt**, **Cinderwatch**, **The Widow's Gate**
at hexes `[6,-1]`, `[6,0]`, `[6,1]`. The premise is the one thing the campaign had never
shown: an enemy that has already lost, digging into ground it has burned itself.

**Nothing about the tier is a new unit**, for the reason tier 5 documents — a unit is a
cliff and the dial is a slope, and `ENEMY_UNITS_BY_TIER` simply repeats itself again.
Three things carry it: `AI_TIERS[5]` (five concurrent attacks, the thinnest
`safetyMargin` in the game at 1.02, `warmupSec` 255); the ground (20×15 and 21×16, the
biggest boards, `develop` 2.9–3.3); and a **second enemy Marshal**.

**`ENEMY_MARSHALS_BY_TIER` is `[0,0,0,1,1,2]`.** Tiers 4–5 read 1, which is exactly what
they shipped, so the count table cannot move a measured region — pinned as a negative
control in `tests/enemymarshal.test.js`. Tier 6's second banner goes into the
best-defended stronghold, chosen deterministically (level, then garrison, then id),
because `banner` is stack-local: it makes ONE line of the countryside expensive instead
of making the whole map slightly harder.

**The fourth expedition segment is the interesting part, and it exists because the
obvious lever was unavailable.** Tier 6 first measured 16 / 6 / 16 against an 18–36 band.
The documented answer to a hard tier is `EXPEDITION.perRegionSurge` — but that rate
applies from the ninth conquest, so raising it would re-tune all sixteen regions from
gallowmoor on. `finalAfter: 20` cannot reach a region before the twenty-second **by
construction**, because region 21 is attacked with twenty conquests. That is the same
argument `taperAfter` makes for the opening, one end of the campaign later.
`tests/campaign.test.js` asserts both halves: the segment must miss every earlier region
*and* must actually land on the tier-6 opener.

It is violently non-linear, as the surge was: `finalBonus 210 / perRegionFinal 30`
(+240 slots) took stormhalt from 16% to **66%**; `52 / 8` (+60) put it at 23%.

**Three measured facts from the tune:**

- **The castle rung is worth ~20 points here.** stormhalt read 46% at develop 2.9 / dial
  4.41 and 26% at develop 3.1 / dial 4.37. It is spent on the tier OPENER, which is also
  where the player takes the biggest step they ever take (+60 slots) — rule 2 of the
  region table.
- **The dial has almost nowhere to go inside the tier**: 4.37 → 4.48 across three
  regions, boxed in by nightharrow's 4.36 below. The ground carries tier 6, not the dial.
- **n=32 and n=96 disagreed by 10 points on stormhalt, and n=96 and n=240 by 5.** Every
  tier-6 number in the table is an n=240 number, including the advertised lengths:
  widowsgate read a 16.0m win median at n=48 and 9.6m at n=240, so a table tuned on the
  small sample would have told the player a region takes half again as long as it does.

## The endless ladder: incursions

`content/incursion.data.js` + `meta/incursion.js`. One battle per **rung**: a fixed
arena, a dial that compounds with depth, and one to three **mutators** that change which
answer is correct. Win and the ladder advances; lose and nothing happens at all except
the boosters you fired. There is no cooldown and there does not need to be one — you
cannot re-fight a rung you have cleared, so what bounds the loop is winnability, exactly
as it is for raids.

**`cleared` is the only stored number.** The rung in front of the player is `cleared + 1`,
derived, so the two cannot disagree. A rung is otherwise a **pure function of its depth**
— the mutator draw is seeded off the depth alone — which is what makes a retry the same
battle, and lets a plan be shown before it is fought without being stored.

**The ladder used to rotate through the nine late regions and that could not work.**
Measured at n=16: depth 15 on ravensmarch (dial 5.05, two mutators) won 63% while depth
10 on widowsgate (dial 5.08, two mutators) won **6%**. Fifty-seven points at the same
dial — the ground was the difficulty, not the depth. On a ladder that is fatal in a way
it is not for a campaign, because **rungs cannot be skipped**: a player who cleared depth
9 would meet an unwinnable depth 10 and stop there, at a rung that is not even the hard
one. So the arena is fixed (`widowsgate`) and depth is the only thing that moves; variety
comes from the layout, since `seed` includes the depth. Rotation is not impossible, it is
*uncalibrated* — it needs a measured per-region ladder dial, which is a balance pass with
nine binary searches in it.

**The curve, `--incursion=... --n=16`, for a player who has just taken the last region
and idled half an hour:**

```
depth      1    5   10   20   30   40   55
win%      94   88   75   38   19    0    0
win-med  2.7  4.6  5.8  9.7 11.0    —    —
```

**...and the same player after ten hours of idling — the only table that justifies the
word "endless":**

```
depth     40   55
win%      75   44
```

The wall RECEDES rather than moving. If a future pass makes the ladder feel finite, that
second table is the one to re-take: a `perDepth` that outruns the shop's own curve turns
the ladder back into a wall with extra steps.

**The mutators own verbs where they can** (`ironwall` is the first thing in the game that
makes sappers-versus-engines a question on the attacking side; `sealed` makes the
countryside mandatory; `thinned` makes the loadout matter more than the budget), and two
of the eight are plain multipliers on purpose — three mutators drawn from six verbs would
collide constantly. Each is applied through a field that **already** crossed the seam,
which is why the whole ladder needed one optional `rules` field and no engine change.

**A rung must never touch the region record.** `clears` is the raid ladder's difficulty
*and* its price, so advancing it from an incursion would make every future raid on the
arena harder because of a fight that was never a raid. `tests/incursion.test.js` pins it.

## Abdication: the prestige loop

`content/legacy.data.js` + `meta/legacy.js`. `meta.legacy` had been sitting in
`core/store.js` unread since long before, commented "reserved so prestige can land later
with no migration" — and it did: nothing about the persisted shape changed.

- **You may only abdicate from a finished campaign.** That single rule is what removes
  the farm-a-cheap-reset exploit without a cooldown or a diminishing return: the price of
  a payout is the whole campaign.
- **Legacy is never spent.** It is a multiplier, not a currency — a prestige shop would be
  a second economy to balance and a second place for a number to be wrong. `points = 1
  per region + 1 per 2 rungs cleared`, so pushing the ladder before ending a run is worth
  something.
- **The bonus rides the shop's own four buckets** (`legacyEffects` is folded in as the
  last step of `upgradeEffects`), so a point reaches idle income, the offline cap and both
  battle multipliers down exactly the channels an upgrade does. There is no second
  stacking order to drift.
- **It is a no-op at zero points**, which is every battle the balance table was measured
  with. `tests/legacy.test.js` asserts that as an identity, not as "small".
- **What survives**: legacy, lifetime stats, preferences, the tutorial flag, and the
  incursion ladder — the ladder is a record of what the player has beaten, not something
  they own, and it is half of what a run pays.
- `atk`/`def` are deliberately the *smallest* grants (1.5% a point). They are the two
  channels the campaign's curve is measured against, so a generous legacy there would not
  make a second run faster, it would make every measured region a walkover.

## The Crown tier: four more endless lines, gated

`exchequer`, `grandArmy`, `warCollege`, `citadels` — endless, based at 200–350k, priced
for an incursion economy where one rung pays millions. They exist because the six Empire
lines are the campaign's sink and the ladder needed its own.

**The gate is the whole reason they could ship without re-tuning anything.**
`requires: 'endgame'` means `endgameOpen`: the campaign has been finished at least once
(the "at least once" half matters — a gate that only asked "is the campaign complete"
would take the tier away from a player the moment they abdicated, on the run where they
were relying on it). It is enforced in **`canBuy`, not in the shop screen**, because
`tools/simplayer.js` never opens a screen — it calls `buy` directly, cheapest-affordable-
first. `tests/crownshop.test.js` drives the bot's own shopping routine at every stage of
the campaign with a 10¹² budget and asserts it buys none of them, *and* that it does buy
them once everything has fallen — the two together prove the gate is the campaign rather
than a constant `false`.

An unknown `requires` value is treated as UNMET rather than ignored, so content asking
for a gate `meta/upgrades.js` does not implement cannot go on sale by default.

## Three specialists, each owning a verb

The roster was five units: a rock-paper-scissors of stats plus a siege engine. A sixth set
of stats would only have moved which column of the same table you read, so the three added
instead each own a **verb** — a hook in the simulation, not a bigger number on an existing
one.

| Unit | Slots | Verb | Why it matters |
|---|---|---|---|
| **Outriders** | 2 | `skirmish`, speed 165 | 3× a militia's march, over legs that are 0.9–1.7s to begin with — see the speed note below before pricing this as the opening |
| **Halberds** | 4 | `sunder` 0.50 | Halves the defender's `siteDefMult` — the one term no amount of militia answers (a castle defends at ×1.60 before walls) |
| **Sappers** | 3 | `repair` 1.9 | `breachSeconds()` returns `Infinity` the moment repair out-paces siege damage, so a wall they garrison is *arithmetically* uncrackable without engines |

All three are share-scaled like `counters`: a token escort strips nothing, so committing to
the answer is what buys the answer.

**Speed is a much weaker stat than the roster implies, and this was measured.**
`MOVEMENT.hexSecondsPerSpeed` is 38, so a leg between adjacent sites is a **median 1.7s on
riverfen and 0.9s on nightharrow** for a militia column, against 0.6s and 0.3s for
outriders. The bot re-thinks every 2s, which is longer than either. Handing the player
*infinite* march speed — the absolute ceiling on what the stat can ever be worth — buys 13
to 15 points; 3× buys 7 to 10, and only for the squads that actually get it. Any claim that
begins "outriders win the race for neutral ground" has to clear that ceiling first.

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

## The harness can play the specialists now, and they still lose

This section used to say the harness could not demonstrate the three, that the numbers
below measured the bot rather than the units, and that teaching it to field them was a
balance pass waiting to happen. **The first claim was true and is now fixed. The second was
half true at most, and knowing which half is worth more than the fix.**

`tools/simtactics.js` is the new file; `tools/simrunner.js --weights=sappers:0.3` is the new
flag. Before it, `playOne` could only ever field `distributeExpedition`'s default spread, so
a specialist could not be measured *at all* and the table below had to be taken with a
throwaway script. A number nobody can re-take is a number nobody will re-take.

**Two real bugs turned up on the way, and both failed silently.**

- **Riders were welded to the baggage train.** `movement.js slowestSpeed` is a MIN over the
  stack, so one militia drops a 165-speed outrider to 55. The bot sent `filter: UNIT_IDS`
  every time, so it never once moved an outrider at outrider speed — the entire verb was
  cancelled before the squad left the gate, and the old `+outriders` column measured that
  and nothing else.
- **A named loadout was silently discarded.** `fitComposition` drops any unit missing from
  `unlocked`, and the bot shops cheapest-affordable-first — so it bought the 400-crown
  outriders and the 1200-crown halberds but never the 1800-crown sappers. A sapper run
  landed **zero sappers** and reported the default army's win rate under their name. Named
  unlocks are now bought first, which is also what a player who decided to bring them does.

**The intuitive fix for the other two is a sunk-cost error worth ~50 points.** Per slot a
halberd really is a worse line unit than militia (atk 12 over 4 slots against 4 over 1) and
a sapper really does nothing in a field, so the first version of `simtactics.js` held
halberds back from unfortified targets and kept sappers out of assaults entirely. Measured:

```
region        default   +halberds   +sappers     (hold-back rules — WRONG)
gallowmoor      58%         6%         17%
thanescar       50%         8%         13%
```

On thanescar the halberds did not join a single assault in a whole battle. **The slots are
already spent.** At the site panel the question is never "halberd or four militia" — that
was decided at the loadout screen and cannot be unwound — it is "does this body march", and
standing still is worth nothing at any exchange rate. Benching a third of the army also
drags every remaining assault under `ATTACK_MARGIN` until the bot stops attacking at all.
That is the 6%.

**So only one verb was ever unexercised.** `sunder` lives inside `resolveField` and `repair`
inside `breachSeconds` — both of which the bot's own target scan already calls on every
candidate — so a halberd-carrying army sees fortified targets get cheaper and takes them,
with no special case. Speed was the only one the game itself threw away. What survives in
`simtactics.js` is one rule: **riders get first refusal, then ride along.** A detachment
that can take something alone goes alone at 165; what it turns down joins the column, which
is free, because a MIN cannot be raised by adding a faster unit.

**With the bot's real defects fixed, all three are still a net cost** (n=48, gallowmoor,
default 58%):

```
unit          w=0.08         w=0.15         w=0.30
outriders   58% (7% bud)   44% (13% bud)  48% (23% bud)
halberds    42% (14% bud)  33% (23% bud)  33% (37% bud)
sappers     50% (11% bud)  38% (18% bud)  29% (31% bud)
```

A token outrider detachment is free and everything else costs, monotonically in share. That
is **not** a verdict that the units are bad, and it is important not to read it as one: this
bot wins by sweeping adjacent sites with overwhelming force, and it *avoids* by construction
every situation the specialists answer — `breachSeconds > 90` makes it walk away from the
wall a sapper would hold or a halberd would crack. It never gets into the trouble they
solve. The levers themselves stay proven in `tests/units.test.js` against the real sim paths
with negative controls (3× march, exact half-bonus strip, `breachSeconds` → `Infinity`).

**What this licenses, and what it does not.** No specialist should get a
`DEFAULT_COMPOSITION_WEIGHT` on the strength of these numbers — that much is unchanged, and
now measured rather than assumed. What is retired is the excuse: the harness *can* field
them, so any future claim about a specialist is a `--weights` run away from being checked.

**The default army is byte-identical, and that is verified rather than argued.** 80 runs
across five regions produce the same status, tick count, site counts and top level as the
pre-tactics bot; `tests/tactics.test.js` pins it per-send with a negative control, since the
inertness test would otherwise pass just as happily if every filter were dead code.

## You bring five troop types, and only five

`LOADOUT_TYPES_MAX` in `content/balance.js` is **5**. The roster reached eight and the
loadout screen became a spreadsheet: with everything available at once the interesting
question — *which answers am I bringing to this map* — collapses into "a bit of
everything", which is both the dullest army and, because the specialists are share-scaled
like `counters`, the weakest one. A token halberd escort strips almost nothing.

**Five and not four**, because the default spread is already four (militia, spearmen,
raiders, rams). A cap of four would mean any specialist at all required dropping a staple
before you could even try one; five leaves exactly one discretionary slot on top of the
default, which is the decision the cap exists to create.

The rule lives in `meta/composition.js`, not in the screen, so `distributeExpedition` /
`fitComposition` / `carryComposition` / `nudgeComposition` all land on the same ceiling —
a hand-edited params object, a save written before the cap, and a `--weights` harness run
included. Two properties are load-bearing and neither is obvious:

- **The default spread does not move.** It is four types and every win rate in
  `regions.data.js` is measured against it. A cap that trimmed it would silently re-tune
  all twenty-one regions.
- **The budget stays spendable.** Leftovers normally go to militia, and an army at the cap
  that has no militia cannot take any without minting a sixth type — so `ballastFor` falls
  back to the cheapest type already present. A cap that quietly ate your spare slots would
  be worse than no cap.

Only the FIRST of a troop you do not already field is refused; more of one you do is always
allowed. Trimming a carried loadout keeps the types with the most SLOTS committed, not the
most bodies — 30 militia and 6 rams are both 30 slots, and the rams are obviously a choice.

**The Marshal is not a train option any more.** `TRAINABLE_UNITS` in `battle/training.js`
is derived from `maxPerSite`, because the two halves are one rule: a unit you may only have
one of is commissioned with `RECRUIT`, and a unit you may have any number of is trained.
Offering him on the fan cost a wall's whole output for forty seconds to duplicate a body
every landing already grants free, and then kept building them until you noticed.
`cmdTrain` rejects it with `unit-not-trainable` rather than trusting the picker.

### The HUD has two layouts, and JS decides which

`battle-parts.js placeRails` owns it, sets `.is-railed` / `.is-docked` on `<html>`, and the
stylesheets follow. **It is deliberately not a media query**: the same condition picks where
the rails are *reparented* and CSS cannot move a node, so a breakpoint meant the condition
written twice in two languages with nothing checking they agreed — and they did not.

- **Railed** (`min-width: 721px` **and** `min-height: 561px`): troop types down the left,
  boosters down the right, mounted *inside* the corner plates so a tall column and a
  top-anchored stack cannot both claim the same edge. The bottom keeps the three things you
  change constantly — send strength, what a drag does, speed.
- **Docked**: both rails are reparented into the dock, which is one horizontally scrolling
  row, and `display: contents` dissolves the wrapper so their cards become direct flex items
  of it.

**Both axes, and the second one was learned the hard way.** Width alone put the rails on the
sides of a phone in **landscape** — 844px wide so "not a phone", 390px tall so no room for a
column at all — and board share fell to 52%.

**Four cards along the bottom was the original complaint**, and the two that moved are the
two you touch least: the troop filter is a preference you set once, a booster is fired a
handful of times a battle.

### Gestures and controls

- **A drag can set a rally, not just send.** `view.rallyMode`, toggled by the **Drag does:
  Send / Rally** control. Rally had exactly one input and it was a RIGHT-drag — which does
  not exist on a touchscreen, and on a trackpad is a two-finger click held through a drag,
  which is not dependably reported as button 2. The two-finger-tap fallback only ever
  covered the *click* form of `setRally`, so the drag — and with it the chain and the
  toggle — was unreachable on both of the devices this is actually played on. The mode
  routes a plain drag down the exact same branch as the right-drag, so it inherits the chain
  and the toggle rather than reimplementing either. An armed booster outranks it: a one-shot
  aim beats a standing mode. Pinned in `tests/tapsend.test.js` (with a negative control) and
  end-to-end in `tools/smoke.mjs`, which asserts the left drag sets the rally **and sends no
  squads**.
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

## The phone pass, and the audit that missed the only thing wrong

`npm run mobile` drives the real game at real device metrics and reports four things.
Three of them — horizontal overflow, off-screen controls, tap targets under 44px — it had
from the start, and **at 390x844 it reported a clean bill of health on a layout that was
unplayable.** `.hud-dock` is `flex-wrap: wrap`, which is right on a desktop; at phone width
every group is wider than the viewport on its own, so the dock folded to five stacked rows,
the HUD took ~85% of the screen and the board was a 200px band. Nothing overflowed, nothing
errored, every tap target was a comfortable 44px. A screenshot found it in one look.

So the tool now measures **how much of the screen the board actually gets**, as plate
COVERAGE over a grid of points. Below `MIN_BOARD_PCT` (55) it fails. Battle only — "how much
of a shop is not shop" is not a question, and asking it produced a 0% and a false alarm.

**It hit-tested at first, and that was wrong in the one direction that matters.** `#hud` is
`pointer-events: none` and only the *controls* opt back in, so a plate's own opaque
background is not interactive: every point over the body of a panel fell straight through to
the canvas and counted as a clear view. It scored a layout with two full-height rails
covering both flanks at **84%**. Coverage over the plates' rectangles answers what is
actually painted, and using a grid rather than summing areas is what makes two overlapping
plates count once instead of twice.

The fix is one rule: below 720px the dock stops wrapping and becomes **one horizontally
scrollable row**, with the unit names dropped from the chips (the colour and the key letter
are what you read mid-battle; the name is still in the tooltip and the `aria-label`). Board
share went 15% → 95%.

**Three more things only a real device size showed:**

- **The world map opened with the one region you can attack half off the bottom edge.**
  `worldmap.js` centres exactly once, on first render — and on a phone the detail panel's
  `max-height: 46vh` has not applied yet, so the porthole then shrank under it. `refit()`
  re-clamped the stale pan instead of re-centring. There is now an `onAutoRefit` callback,
  gated on a `moved` flag that is the sibling of `chosen`: recentre on every resize until
  the player pans or pinches, then never again.
- **A phone in landscape is wide and short**, so not one width-based rule fired and every
  problem was still there — at 844x390 the Attack button sat at y=596. The world map rules
  are `(max-width: 720px), (max-height: 560px)` for that reason.
- **Dropping the chip labels made them 34px wide.** Tall enough, too narrow, and a
  height-only minimum would have called it fine.

Two audit rules exist so the tool does not argue its own fixes back out: content inside a
**scroll container** (the dock) or a **pannable porthole** (`overflow: hidden` +
`touch-action: none`, which is the world map) is reachable, not stranded. Both are detected
by signature rather than by class name.

## Gotchas that have already cost time

- **`h(tag, props, ...children)`** — the second argument is *always* props. Passing an
  element there silently drops it. Pass `{}` when there are no props.
- **`state.rules` is a hand-picked SUBSET of `config.rules`, not a copy.** A field both
  ends use only works if someone remembers to list it in `battle/state.js`. `rallyKeepDefault`
  was missing: site creation reads `config.rules` and was right, `capture()` reads
  `state.rules` and fell back to the content default — so a player who set "leave nothing
  behind" got it on the three sites they landed with and 8 on every site they took, which
  is exactly backwards.
- **A unit colour is declared TWICE** — `--c-<unit>` in `styles/tokens.css` and `FALLBACK`
  in `render/palette.js` — and the canvas silently falls back to the JS table when the
  variable is missing. The three specialists shipped with a JS hue and no CSS variable, so
  they drew correctly on the board and as plain grey text in every DOM surface that reads
  `var(--c-<unit>)`: the train chip, the loadout row. `tests/traincolour.test.js` pins the
  two tables against each other, and that every unit has a `.pb-unit[data-unit=…]` rule.
- **`#screen-root` is `pointer-events: none`.** Every scene must opt back in
  (`.screen { pointer-events: auto }`). A whole release once shipped completely
  unclickable because `tools/smoke.mjs` used synthetic `el.click()`, which bypasses hit
  testing. The smoke test now dispatches **real pointer events** and asserts
  `document.elementFromPoint` lands on the target first. Keep it that way.
- **A smoke selector that names a CONTAINER stops asserting when the layout moves.**
  `tools/smoke.mjs` looked for `.hud-dock .chip` and `.hud-dock .booster`; when both moved to
  the rails they became "not present", the step went on reporting ok, and neither control
  was hit-tested by anything any more. Selectors are on the control's own class now, and
  absent is a FAILURE rather than a note. It happened a second time and was caught by the
  same rule: the world map's shop step selected `.wm-actions button`, so the moment
  "Incursions" joined that row it would have been hit-testing the wrong control while
  still reporting the shop was fine. It is `.btn.wm-shop` now.
- **A dialog that outgrows the window has to scroll, and `.dialog` did not.** The menu
  grew a fifth action plus a drawer that itemises a payout, and past that point the title
  and Continue were simply above the viewport with no way to reach them. `max-height:
  92vh; overflow-y: auto` — and the overlay's `place-items: center` is what keeps the
  overflow from being clipped on one side only.
- **`window.__game` exposes `screens` so the smoke test can seed a finished campaign.**
  Both endgame surfaces are gated on twenty-four conquests, which a smoke test cannot
  play; it marks the region records conquered, re-enters the map, and then drives the
  incursion overlay and the abdication drawer with real pointer events like everything
  else. Skipping that would have left the two newest screens as the only ones nothing
  ever clicked — which is exactly how a release once shipped unclickable.
- **Tests that assert the wrong thing** are the recurring failure mode here, not tests
  that fail. Dead boosters and an unclickable UI both passed a green suite because the
  fixtures encoded the bug. Prefer asserting against real `buildBattleConfig` output
  (`tests/seam.test.js`) over hand-built objects.
- Camera zoom set directly leaves the cached background canvas stale — go through
  `view.releaseAutoFit()` + `view.markBgDirty()`.
- `localStorage` keys are separate and independently validated: `hexdominion.save`
  (campaign) and `hexdominion.battle` (mid-battle resume). Anything stale, corrupt,
  finished, or from a different contract version is discarded rather than migrated.
  **Abdication drops the mid-battle blob explicitly**: `meta/resume.js` validates the
  CONTRACT, not the campaign, so an otherwise-valid blob would drop the player back into
  a battle for a region the new run does not hold.
- **`meta/legacy.js` must not import `meta/idle.js`.** `idle → modifiers → upgrades →
  legacy` is a real chain, so an import back would close a cycle. It does not need one:
  after a reset nothing is conquered, so income is exactly 0 by construction rather than
  by recomputation.

## Deployment

`.github/workflows/pages.yml` deploys to GitHub Pages on every push to `main`, gated on
`npm test` and `npm run check`. Live at **https://ka1e27.github.io/temp/**
(`?dev=1` for the developer overlay).

The workflow cannot enable Pages itself — `pages: write` grants permission to deploy to a
Pages site, not to create one. That was a one-time admin action and it has been done.
