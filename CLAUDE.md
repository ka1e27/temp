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

**`ROADMAP.md` is the companion to this file and they must not be confused.** This one is
the INVENTORY — what is true, what is broken, and what every measurement cost to learn.
That one is the ORDERING — which of the open items to spend the next session on, and what
each is priced at. Facts live here and are referenced there; when the two disagree, this
file wins, because it is the one maintained in the same commit as the code.

## Where to start, by what you're touching

This file is read end to end at least once, but it is 1800+ lines and gets opened
under time pressure after that. If you already know the shape of your change:

- **A balance number** → `Tuning`, then whichever pass section covers your region
  (harness-bot upgrades, starting-footprint, uphill-raid, Tier 5, Tier 6, the castle
  gate). **Every win rate in those pass sections is PROVENANCE, not today's number** —
  the campaign has been re-tuned twice since most of them were written, most recently
  against the finished battle layer. `src/content/regions.data.js` is the only current
  answer, and `npm run sim` is how to check it. What the pass sections are still good
  for is the *reasoning*: which lever moved what, and why.
- **The simulation** (`src/battle/`) → Architecture → The four invariants → Simulation
  model, then the mechanic-specific section (Free movement, The yard and the wall,
  Building on the ground you took, Two-stage capture, Region shapes, Fog of war).
- **The renderer** (`src/render/`) → Rendering, the fog "Drawing it" subsection, and
  the Gotchas entries on `h(tag, props, ...children)` and the doubled unit-colour table.
- **The meta layer** (shop, idle, save, prestige, relics) → Abdication, Relics, The
  Crown tier, and the Gotchas entries on `state.rules` and the two `localStorage` keys.
- **Tooling or CI** → Commands, then Deployment.
- **This file itself** → read "Gotchas" first, then verify a claim against the code or
  a fresh measurement before repeating it — a claim here has gone stale silently more
  than once (`castleGateFrac` outliving the pass that made it the actual win condition,
  an inert enemy Marshal documented as real). A wrong correction is worse than leaving
  a claim unverified.

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
node tools/simrunner.js --all --n=96 --noconstruct  # ...and the one that could not build
node tools/simrunner.js --region=gallowmoor --weights=halberds:0.3   # field a specialist
node tools/simrunner.js --incursion=1-14 --n=32     # the endless ladder, by rung
node tools/simrunner.js --incursion=40,55 --idle=600  # ...for a player who has idled
node tools/simrunner.js --all --n=32 --legacy=27    # the campaign on a SECOND run
node tools/simrunner.js --region=gallowmoor --relics=14   # ...spending its relics on troops
npm run mobile             # phone-width layout audit — needs `npm start` running
node tools/mobile.mjs --w=844 --h=390                # a phone in landscape
node tools/smoke.mjs       # browser smoke test — needs `npm start` running first
node tools/shapeshot.mjs   # one screenshot per region SILHOUETTE — needs `npm start`
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
`simrunner.js`←`simladder.js`, `simplayer.js`←`simshop.js`/`simbuild.js`,
`sim.js`←`arrivals.js`, `store.js`←`refund.js`, `ai.js`←`aicore.js`/`aihome.js`/
`aiadapt.js`, `regions.rules.js`←`regions.fallback.js`, `core/hex.js`→`mapgen.js`
(the offset↔axial arithmetic lives in core and mapgen re-exports it, because
`contract.js` has to ask "is this hex on the board" and the seam may not import
map generation).

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
`document`, `window`, `localStorage`, `sessionStorage`, `Math.random`, `Date.now`,
`performance`, `fetch`, `requestAnimationFrame`, or `getComputedStyle`. Inject the
dependency instead of reaching for a global. `tools/checkpure.js` enforces this
mechanically. This is what lets the whole simulation run headless with zero mocking.

**2. `battle/` and `meta/` never import each other** — except through
`src/battle/contract.js`, and `src/screens/battle.js` is the only broker.
`meta/modifiers.js → BattleConfig → battle/state.js`, and
`battle/outcome.js → BattleOutcome → meta/rewards.js`. Both directions are validated at
runtime by `assertBattleConfig` / `assertBattleOutcome`. Changing a field means bumping
`CONTRACT_VERSION` (currently **10**) — which is also what makes `meta/resume.js` discard a
mid-battle blob whose shape the current engine would step wrongly.

**v10 is the squad rewrite, and it is v8's lesson a THIRD time.** A squad carries
the `path` it walks, its `to` is nullable (a march onto bare ground), and it may be
`camped` on a hex it is holding. No CONFIG field moved — again — because the blob that
breaks is state: a v9 squad has no path, so `squadHexOf` finds it nowhere. It draws
nothing, fogs nothing, and the towers that shoot at positions cannot see it, while
still arriving on schedule. A board this engine steps wrongly while looking healthy.

**v9 is fog of war's foundation** — `SITE_KINDS` gained `watchtower` and state gained
the `vision`/`seen` pair nothing before this had a use for. Same lesson as v8 a second
time: no CONFIG field changed, but a resumed v8 blob is missing both, and `canSee`
reads the missing map through optional chaining as `false` for every hex — not "no
fog", but a blackout neither side was playing with. Full story at "Fog of war" below.

**v8 changed NO FIELD AT ALL, and that is the point of it.** The site kinds split
(`trainingGround` is new; `stronghold` stopped training and became a wall), so a blob
written under v7 is a board where the player's strongholds *are* their army's
production. Resume it here and those buildings quietly stop producing, mid-siege, with
no event and no explanation. The rule everybody checks is "changing a field requires a
bump" and this slips straight past it — **the version tracks what the engine will DO
with a blob, not the blob's field list.**

**v7 is `FactionMods.unitMult` — the per-troop attack/defence multipliers the relic
lines buy.** It is the one shop feature in this project's history that could not ride a
field the contract already had, and the reason is the feature itself: `unitAtkMult` is one
number for the whole stack, and the entire point is that militia and rams stop sharing it.
Sparse — `{}` for every battle the balance table was measured with — so it costs nothing
to carry and cannot be mistaken for a live field.

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
- **Squads store no position, but they do store a ROUTE.** `arriveTick` is computed once
  at spawn and nothing is written per tick; `movement.js squadHexOf` reads a place off
  the squad's own `path` as a pure function of `state.tick`. The invariant was never "a
  squad has no hex field", it is "nothing recomputes position per tick" — see the battle
  redesign section below.

### The battle redesign: a squad walks a real path

Five requested changes landed together, and the first one is the keystone the other four
were blocked on.

**A SQUAD CARRIES THE PATH IT WALKS.** It used to store `from`/`to` site ids and
`squadHex` lerped a straight line between them — so a column routing around a mountain
range was drawn, fogged and hit-tested marching straight over it. Every consumer of a
squad's position was reading a place the army was not. Storing the path the A* already
produced costs one array per squad and makes the position true. Determinism, replay and
the O(arrivals) tick are all exactly as they were.

**A DESTINATION MAY BE BARE GROUND.** `to` is nullable; a squad that arrives with no site
to resolve against **camps** and stays in `state.squads`, so every existing consumer sees
it without learning a new container. `MOVE_SQUAD` re-tasks it — its own verb rather than
a branch of `SEND`, because the two validate nothing alike and folding them together
means every garrison check growing an "unless it is camped" arm. It also closed a hole:
`resolveArrival` answers a missing destination with a bare `return`, by which point the
squads are off `state.squads`, so an army whose target was razed mid-flight **ceased to
exist** with no event. Camping covers every way a site can vanish under an order.

**A DRAG CHAINS THROUGH TILES** (`screens/battle-waypoints.js`). `pathThrough` stitches a
leg of A* per stop, and consecutive stops are adjacent hexes, so the route walked is the
line drawn — and `ticksAlong` prices it, so a detour costs what it costs. Three calls
worth keeping: waypoints only ride an order when the drag was meaningfully longer than
the straight line (a straight pull is *pointing*, and pinning the army to its incidental
hexes would refuse the order if one were occupied); the trail is deduped as collected
(pointermove fires far faster than a finger crosses a hex); and over the cap it is
subsampled, never truncated, because truncating marches the army to the middle of the
gesture and stops. **A drag that WIGGLES is not a detour** — in hex space a diagonal step
still closes the distance, so an S-curve is exactly as long as the straight line.

**BUILDINGS SHOOT** (`battle/towers.js`, `content/balance.towers.js`). Stronghold range 1,
watchtower range 2 — the two kinds that earn nothing, because arming a farm would make the
economic buildings the military ones and undo the yard/wall split. Two rules carry it:

- **A building never fires on the column whose destination it is.** The field battle and
  the siege already resolve an assault; letting the target also whittle the approach
  charges twice, and not by a little — measured, a short hop spending its whole flight
  inside a stronghold's reach lost **43%** of the force before the fight started, which
  would make the siege decorative.
- **The sub-body remainder CARRIES on the squad.** Damage is a fraction of a body per
  tick, so a `Math.floor` anywhere makes the whole feature inert while every event and
  draw call still looks live — one line from this project's most-repeated failure.

**AND THE TOWERS BROKE THE PREVIEW, silently.** The pre-commit preview is a guarantee
because it calls the same functions the sim runs. A column that walks past a wall arrives
smaller, and the DEFENDER's power is a function of the attacker's composition (`counters`
scale by the share of the foe that is the countered type). Measured: 30 militia and 6
raiders lost ONE body on the approach, which moved the raider share from 16.7% to 17.1%,
which moved the defending spearwall's counter, which moved `defPower` by 1% — and the
preview promised the other number. `projectMarchLosses` projects the attacker forward
exactly as `projectGarrison` already projects the defender's training; both are
deterministic, both known at commit time. `tests/towers.test.js` runs the projection and
the simulation over the same march and demands the same survivors, body for body.

### Free movement, and the four bounds the site graph was supplying by accident

An army marches anywhere it can find a hex path to. **A building denies exactly the hex
it stands on, to everyone but its owner** — `battle/occupancy.js`, a sparse plain-JSON
`hexKey → owner` map rebuilt beside `recomputeInfluence`. One ring per building instead
of one hex was measured and rejected: it seals the late maps outright (riverfen 78% of
the board denied; gallowmoor, thanescar and widowsgate **100%**, which is a battle where
nothing can move). Per hex the same maps deny 3–16%.

`buildAdjacency` and the authored edge list are **gone**. `site.adj` kept its name and
its ~30 consumers and changed meaning: **every site within `MOVEMENT.reachHexes` (4)**.
That is a scan bound for the AI and the harness, not a promise to anybody — `cmdSend`
requires only that a path exists, and the board no longer draws the graph (deleting the
lines was the point: they advertised a rule the engine had given up enforcing, and a
screenshot found it because every one of them still drew correctly).

**The old graph ran at `targetAvgDegree` 2.8, and four separate mechanics were
calibrated against that number without anyone writing it down.** Reach-4 gives 4.7 on
the smallest map and 8.8 on the biggest, so all four came off at once and the campaign
read 100% at tiers 1–2 and **ZERO** from gallowmoor on. The tell was that *no AI knob
moved gallowmoor at all* — not `concurrent`, not `commitRatio`, not `economyMult`, not
the region dial. That is what says a collapse is structural rather than difficulty.

| Bound | Where | What was holding it |
|---|---|---|
| `AI.maxSources` (3) | `aicore.js adjacentSources` | the graph's degree — one assault drew from 3× the ground |
| `AI.freeLunchHexes` (3) | `ai.js freeLunch` | that phase spends no concurrency slot ON PURPOSE (free ground is free), so the doorstep was the only bound. A tier whose `concurrent` is 2 opened at **five** targets |
| `advanceDistance` | `tools/simplayer.js` | hops-to-the-front happened to point at the enemy |
| `PRIORITY` | `tools/simplayer.js` | half the time there was no farm in reach, so the bot took the wall in front of it |

The two bot ones were both it **quietly declining to play**, and the cleanest measurement
was with the enemy AI switched off entirely: it took 19 of 28 sites, held a site TWO
HEXES from the castle with a clear route from every site it owned, and never attacked it
once in seventeen minutes — seven of its sites scored an identical `frontDistance`, so
"forward" pointed nowhere and a 128-man army sat in nineteen piles. It also finished on
thirteen farms and two training sites with **17,000 unspent gold** against a 15 gold/s
training bill; farms have `train: 0`, so it had optimised itself into an economy with
nothing to spend on. Flipping `PRIORITY` is worth 0% → 75% on gallowmoor and 8% → 50% on
thanescar.

**`frontDistance` and `advanceDistance` answer different questions and must stay
separate.** "Where is the fighting" is LOCAL and is right for deciding where you feel
safe enough to build. "Which way is the war" is GLOBAL and needs one sink or an army
diffuses instead of massing; `victory: capture-castle` means that sink is not a heuristic.

**`PRIORITY` was first written as a condition and the condition never once went the other
way** — instrumented over whole battles on four regions it was true on every think of
every one: 1,091 thinks, zero on the other branch. A landing force arrives with a
shop-fed treasury and no yards running, and from there the reserve is never binding. Both
orders shipping would have been unreachable code wearing the clothes of a decision.

**A site off the map is now a contract error.** Four hand-built fixtures sat outside their
own declared grid and every one passed, because a send was legal on an authored EDGE and
`travelTicks` fell back to raw hex distance when pathing failed. Free movement has no
edges to lie with. `grid` is an OFFSET rectangle, so a 9×9 grid holds no negative `r` at
all — reading it as "q and r both 0..8" is the mistake all four made.

### The yard and the wall

`stronghold` used to be the only thing that trained and, apart from the two thrones, the
only thing that defended — so there was never a decision on the map: whatever you took
for one reason you got the other for free.

```
kind             gold  train   cap   hp   regen  defMult  garrisonMult
farm             2.0   0        30   100   2.0    1.00     -
trainingGround   0     1.30     45   180   3.0    1.05     -
stronghold       0     0        60   340   5.5    1.55     1.30
camp / castle    4.0   1.25     80   480   5.0    1.40 / 1.60
```

**`garrisonMult` is the one defensive term `sunder` cannot strip**, and that separation
is the whole reason a stronghold is a different building rather than a farm with a bigger
`defMult`. Halberds cut a wall out from under its garrison; they do nothing about a
garrison that is dug in. So the wall has an answer — bodies, and engines to out-pace its
regen — and it is not the answer that already works on everything else. `terrain.js
garrisonMultOf` is its one source, mirroring `siteDefMultOf`, and terrain deliberately
does NOT apply to it: mountains make a wall harder to storm, not its garrison braver.

Measured breach times, and the ladder they make (`breachSeconds`, level 1):

```
                4 militia   12    20    40   1 ram   2 rams
farm               250s     19s   10s    5s    10s      5s
trainingGround    never     43s   20s    9s    20s      9s
stronghold        never    200s   52s   18s    52s     18s
castle            never    218s   69s   25s    69s     25s
```

**`mapgen.js planSites` now shapes the enemy's country**: a ring of war around the throne
and farmland beyond it. Walls and yards take the narrow `holdBandFrac` beside the castle
AND stay inside `holdRadius` of it; farms are pushed OUTSIDE that ring and sweep from its
edge out to `farmBandFrac`. **A band alone could not do this** — a band is a vertical
STRIPE, so on a 16-wide board a 30% band is five columns by twelve rows and a site in it
can sit eight hexes from a castle in the same one. Measured before the radius existed:
gallowmoor's holds landed at 3/5/6/8 hexes while its farms averaged *closer*. The ring is
what makes it true by construction rather than on average.

**`fortsAmong` guarantees at least one yard wherever there are holds at all.** Not
fussiness: rounding alone gave riverfen's enemy one hold and made it a fort, so the
tier-1 enemy would have fought the campaign opener on castle production alone and nothing
would have failed.

**The campaign is UNTUNED against all of this** and that is deliberate — the map redesign
re-authors `siteCounts` for every row, so tuning before it lands is thrown away. The
enemy also lost half its production to the split, so everything got easier. Battle
lengths roughly halved campaign-wide (gallowmoor 3.9m against a 7m advertised length),
because an army marches straight at the throne instead of chaining through the
countryside: **`targetLengthMin` needs re-authoring too, not just `enemyMult`.**

### Building on the ground you took

`battle/construct.js` — `cmdBuild`, one verb, modelled on `cmdUpgrade` throughout
because it is the same shape of purchase: spend gold now, wait out a timer, get a
stronger board. Two things make it different, and both are the point.

**It needs a place to stand.** `buildBlocker(state, faction, hex)` returns the reason
or null, and it is exported so the board can paint a legal hex while the player is
still choosing — a build preview that disagreed with the command would be the same
class of bug as a battle preview that disagrees with the simulation. The rule is a
hex within `BUILD_RANGE_HEXES` (4) of a site you hold and at least
`BUILD_MIN_SEPARATION` (2) from every site on the map.

**Those two numbers have an ordering constraint, and it is not a margin.** The range
must be ≥ the separation or there is no legal hex anywhere: below it you are asking
for a hex simultaneously within 2 of your farm and at least 3 from it. Set to 2
against `MAPGEN.minSeparation`'s 3 first, and all 192 hexes of gallowmoor were
refused with nothing failing. The separation is also deliberately *looser* than the
generator's — 3 is a legibility rule for a scatter nobody chose, and holding a
deliberate placement to it is what made the verb unusable exactly where it matters.

```
kind             gold  sec
farm              200   25
trainingGround    350   35
stronghold        500   50
```

Priced against the upgrade ladder, which is the only other thing battle gold buys
(`SITE_UPGRADE[0]` is 150g/20s). `camp` and `castle` are absent by rule: being able
to raise either would mean building your way out of losing one.

**A site goes up at 1 HP, produces nothing, and does not repair itself** — that
fragility IS the risk the purchase carries, so building forward is a bet and
building at home is slow. Left regenerating it healed out of being a soft target on
its own (measured: 1.57 HP two ticks after it was paid for).

**A new site invalidates THREE derived maps, not two.** `cmdBuild` recomputed reach
and occupancy and not influence, so a farm you raised painted no territory at all
until some unrelated capture elsewhere re-triggered the flood — the board simply did
not show the ground you had just paid for. The comment above the call even said
"both derived per-site maps" and fixed two of three. They are invalidated by exactly
the same events and belong at the same call sites; `sim.js siegePhase` runs the same
trio on a flip. This matters beyond the one bug because the vision layer is a fourth
map on the same hook, aimed squarely at a building whose entire purpose is to see.

**Scaffolding you seize is RUBBLE.** `buildTicksLeft` is a timer on the site, not on
its owner, so before `razedByCapture` the enemy could walk onto a half-dug yard and
have `timersPhase` finish it for them — observed on gallowmoor, 0 HP under an enemy
siege and out the far side at 180/180. Razing rather than cancelling, because
cancelling leaves them a real building at 1 HP that simply regenerates. Two knock-ons
the removal needs: an army in the air toward it is **turned around** first, while its
target still exists (`resolveArrival` returns early on a missing site and the squads
are already off the board by then, so they would cease to exist with no event), and
the removal happens **after** the site loop, never during it.

**The interaction is ARM then TARGET, not click-a-site.** A build is the only order
in the game aimed at a HEX rather than at a site — that is the whole point of it —
so the panel's three buttons set `view.armedBuild` and the next board click resolves
the world point through `core/hex.js fromPixel` (which had existed and been unused
since the day it was written). Escape cancels; pressing the same kind again cancels.
An armed booster still outranks an armed build, because a one-shot aim beats a
standing mode — the same precedence rally mode already follows.

While it is armed the legal hexes are tinted (`render/buildTargets.js`, on the
per-frame canvas), and the tint is `buildBlocker` itself rather than a re-derivation:
a build preview that disagreed with the command would be the same class of bug as a
battle preview that disagrees with the simulation. `buildProgress()` sits beside
`upgradeProgress()` in `state.js` for the same reason that one is a function — the
denominator lives in exactly one place, because a renderer that re-derived it drew a
perfectly plausible wrong bar once already.

**The harness plays it** — `tools/simbuild.js constructTurn`, `--noconstruct` to
revert. Same lesson as `upgradeTurn` one release later: a mechanic the harness cannot
play is a mechanic nobody has measured. Four rules — the yard first and only while
short of one, behind the line on the same `rearOf` gradient, out of the same surplus
`upgradeTurn` reasons about and never in the same turn, and nearest the throne among
the legal hexes. Measured at n=40: **karrowmere 83% → 95%, widowsgate 18% → 23%,
gallowmoor 98% → 93%.** A real option rather than a dominant one, which is the shape
a verb should have. (n=16 read +13 / +12 / −6 — same signs, and widowsgate's was
half noise, which is the usual reason to re-take a number before writing it down.)

### Two-stage capture

Taking a site is a field battle (proportional attrition, largest-remainder
integerization) followed by a **siege** against structure HP that regenerates.
`breachSeconds()` returns `Infinity` when siege damage cannot out-pace repair — that one
mechanism is what makes "a few troops genuinely cannot take a stronghold" and "a real army
grinds one down in half a minute" both true, without an arbitrary minimum-troops rule.
Sieges are interruptible, so relief forces matter.

An in-progress upgrade shows as a **bar**, in both places: `bar-build` in the site panel
and a second thin fill under the site on the board (`render/siteBuild.js`), stacked below
the training bar it deliberately mirrors. The denominator is the interesting half and it
lives in one place — `battle/state.js upgradeProgress()` — because `cmdUpgrade` raises
`site.level` as it *starts* the build, so the step being paid for is
`SITE_UPGRADE[level - 2]`, and a renderer that re-derived that off-by-two would draw a
perfectly plausible wrong bar. Moving the build out of `statusLine` also un-masked a real
bug: a site besieged *while* it built used to report "building · 12s left" and never once
say UNDER SIEGE, because the build branch returned first.

### Region shapes

A region is not a rectangle. `content/regions.rules.js` `SHAPE_RULE` + `battle/mapshape.js`:
five silhouettes (`open`, `narrow`, `choke`, `split`, `branch`) chosen per row in the region
table, generated as a MASK of out-of-play hexes on their own seeded stream. The mask joins
`grid.blocked`, so the renderer draws it as a massif, pathing walks round it and
`verifyReachable` treats it as wall — the whole feature needed one region column and **no
change to movement, combat, the AI, the contract or the save format.**

Three properties are load-bearing:

- **The mask arrives connected.** `pruneIslands` keeps only the largest open component,
  because `repairConnectivity` fixes a walled-off site by *deleting* rock and would
  otherwise drill straight through the silhouette. It is explicitly forbidden from clearing
  shape rock.
- **It is spent inside the rock budget, not on top of it** — `mapgen.js` seeds `blocked`
  with the mask, so `scatterMountains` stops early. A `narrow` valley spends the whole
  budget and the silhouette *is* the terrain; a `split` rift spends a third and the scatter
  still lays texture around the crossings.
- **`open` is byte-identical to the pre-shape generator**, verified against HEAD on four
  seeds for all six open regions and pinned intrinsically in `tests/mapshape.test.js`. That
  is what let eighteen regions be reshaped without touching the other six.

The assignment rule is a design rule, not a balance one: **a shape says what the region
already claimed.** Nine rows of flavour text described maps the generator never made —
Ironwood's "single-file passes", Saltmere's "lagoon splits the field", the Sunder's "two
bridges", Obsidian's "three fronts" — in exactly the way Ironcrown's Marshal was decoration
over an empty throne. Reaching for a shape *because* a region needs to be harder is
forbidden; that is how `siteCounts.player` crept to 48% of the board with every difficulty
number passing.

**A shape is NOT a dial, and that cost three full n=96 sweeps to establish.** It does not
apply a tax a smaller carve scales down — it *re-rolls where the sites land*, and a late
region's win rate is a steep function of layout. The first cut (`SQUEEZE` neck 0.52 / keep
0.76 / trunk 0.34) moved eighteen regions by −29 to +9 and put eight outside `WIN_BAND`.
Softening all three by ~40% did **not** shrink each delta toward zero — it scattered them
again by −17 to +22: duskfell went −14 → +8 and thanescar +2 → −17 on the same softening.
Expect to re-measure, not to interpolate.

It is also violently size-dependent — the same `choke` is worth **+5 on a 13×10 board and
−16 on a 21×16 one**. Four regions still needed the dial after softening, and three of them
had room: `gallowmoor 3.26→3.12`, `karrowmere 3.82→3.68`, `blackspire 3.92→3.84` (with
`thanescar 3.85→3.80` to keep `enemyMult` non-decreasing).

**THE SHAPES WERE NEVER CALIBRATED AGAINST EACH OTHER, and that is what a
per-shape reading of the campaign re-tune found.** Grouping every region's win rate by
its silhouette, as points against the MIDDLE of its own tier's `WIN_BAND` (so tiers are
comparable), on the sweep that closed the re-tune:

```
shape     n   avg vs band-mid
open      9        -2.0
choke     6        -1.3
split     3        -6.0     (saltmere -6, sunder -6, gravenreach -6 — all three)
branch    5       -11.0     (thornmoor -12, duskfell -12, obsidian -16, ravensmarch -16,
                             thanescar +1)
narrow    1       -11.0
```

`branch` was costing about eleven points and `split` a startlingly uniform six, while
`open` and `choke` sat near zero. **Four of the five regions the sweep reported out of
band were `branch`** — the shape column had become an unadvertised difficulty column.
`branchTrunk` 0.50 → **0.62** (a later fork means shorter arms, and the arms are the
whole cost) put duskfell, obsidian and ravensmarch back in band in one number.

It behaved exactly as the warning at `SQUEEZE` says it would, which is worth knowing
before reaching for it again: **thanescar went DOWN on the same softening** (46 → 44).
A shape re-rolls the layout; it does not scale a tax. Three of five moved the way the
change intended and one moved against it, so the softening still had to be measured
region by region rather than assumed. `split` has no `SQUEEZE` knob at all — its −6 is
recorded here as an open observation, not something that was fixed.

**Tier 6 ships unshaped, deliberately.** It was the one tier with no dial headroom —
4.37/4.44/4.48 against nightharrow's 4.36 at the time of this pass — so there was nothing
to pay a shape with, and
widowsgate is additionally the incursion arena, where a `choke` took the ladder from
94/88/75/38/19 to 81/56/50/13/0 across depths 1–30. Reverting the three restored their
**exact** pre-shape win rates (26/29/26) and the ladder to 94/88/75/38/19 with the same
win-medians, verified after the fact. If a future pass wants tier 6 shaped, the prerequisite
is dial headroom, not a gentler mask. (The campaign re-tune since moved both dials again —
tier 6 and nightharrow now ship on the same flat 5.40 — so the headroom argument still
holds, on updated numbers; see `regions.data.js` rather than the figures above.)

*(One pre-existing miss surfaced and was fixed on the way: `highmarch` read 65% against a
66% floor — on the unshaped baseline too, and stably so at n=240, so not noise. `enemyMult`
had 0.01 of room (kaldan 2.75, highmarch 2.76), so the answer was `develop` 1.35 → 1.25,
the one column with headroom between kaldan's 1 and greywater's 1.5. 73% at n=96, 68% at
n=240.)*

### Rendering

Two canvases. `#board-bg` repaints only when `signature(state)` changes (ownership, level,
influence version); `#board-fx` every frame. Draw paths allocate nothing per frame, batch
by colour, and never use `shadowBlur` (10–50× a plain fill). `battleView.js` owns the
frame; `siteGlyphs`/`siteShapes`/`terrain`/`hexGeom`/`formation`/`routes` are its parts.

Army size is always drawn as **individual troop pieces**, never a size-scaled glyph —
marching columns and dug-in siege crescents use the same per-piece length so the two are
directly comparable.

**The link graph is gone, and a screenshot is what found it.** `drawLinks` drew one line
per `site.adj` entry, and its own comment said why: *"sends go to adjacent sites only, so
the graph is drawn explicitly — the rule should never be something the player has to
infer from a rejection."* That rule stopped existing with free movement, and `adj` became
reach — so at reach-4 a late map drew forty-odd lines into a cobweb connecting nearly
everything to nearly everything, advertising a constraint the engine had given up
enforcing. No test could catch it: every line still drew correctly. What replaces it is
the ground, which was always already on screen — mountains, the shape mask, and the bases
that deny their own hex.

**Five site shapes, chosen to differ in the two things the eye resolves first at 20px:
outline profile and area.** farm = small circle, `trainingGround` = low gabled hut,
`stronghold` = shield, camp = peaked tent, castle = crenellated keep. Camp and castle are
a matched pair at twice a farm's radius because "take the castle, don't lose the camp" is
the whole win condition and both ends should be findable without searching.

### Tuning

**The campaign was re-tuned end to end against the finished battle layer** — free
movement, the yard/wall split, construction, towers, the slower march, fog, squad sight
and the site-existence gate. Read the re-tune section below (`Still open` → the closed
entry) for the numbers and the method; what belongs here are the four facts a future
tuner needs before touching a dial.

**THE CURVE INVERTED, and that was the whole shape of the pass.** The redesign made
early regions harder and late ones easier — a slower board hurts whoever is trying to
EXPAND and helps whoever is trying to SURVIVE, and which of those the player is flips
partway up the campaign. So tiers 1–2 and 4–5 moved in OPPOSITE directions: riverfen's
dial came down 2.02 → 1.82 while thanescar's went up 4.78 → 5.20.

**THE SLOPE IS ABOUT 1 POINT OF WIN RATE PER 0.01 OF DIAL, campaign-wide — except on
the small maps, where it is nearly twice that.** Measured across all 24 regions over
five sweeps: riverfen and kaldan both run ~1.8 pts/0.01 (11×9 and 15×11), while the
17×13-and-up regions sit near 1.0. A dial step that is a nudge at tier 4 is a
correction at tier 1. This supersedes the older per-region figures further down, which
were taken before free movement.

**AND THE DOMINANT LOADOUT CHANGED SHAPE ON THE SAME CHANGE.** `slowestSpeed` is a MIN
over the stack, so the default spread marches at the pace of its rams, and doubling the
march doubled that penalty in absolute seconds:

```
default spread   2.53 s/hex   (dragged to rams, speed 30)
mono spearmen    1.69         1.5x faster
mono militia     1.38         1.8x faster
mono raiders     0.72         3.5x faster
```

The answer is no longer "bring militia", it is **"leave the rams at home"** — a wider
hole, and it compounds the already-recorded finding that rams are a straight loss because
`breachSeconds` stopped binding. `tests/loadoutdominance.test.js` pins it as arithmetic
rather than as a win rate: the speed table is exact, where a win rate is a claim about
whatever dial the table happens to ship today.

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
dominate, and they come apart exactly where the campaign gets hard. Measured at n=64
(the `advertised` column below predates the later `targetLengthMin` re-authoring — see
"Still open" → "THE CAMPAIGN RE-TUNE" — and no longer matches `regions.data.js`; the
win%/median shape is what this table is illustrating, not the current promise):

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
force, an enemy warm-up, and a shop with no ceiling). **The curve as measured for the
region-shape pass** (n=96, re-taken end to end when that pass changed eighteen of the
twenty-four maps; band edges confirmed at n=240):

```
tier 1   88 85 86 83        tier 4   56 40 42 40
tier 2   82 73 75 74 76     tier 5   24 23 30
tier 3   67 53 54 66 53     tier 6   26 29 26
```

All twenty-four reported `ok` against their tier's band *and* their advertised length, at
that dial. **This table is superseded twice over** — by the first campaign re-tune and
then by the second, against the finished battle layer. Every `enemyMult` has moved since,
several by more than a full point. Treat the percentages above as provenance, not as
today's win rate; `src/content/regions.data.js` is the only current answer, and
`npm run sim --all --n=96` is how to check it.

**Tier 6 was byte-for-byte what it shipped as, twice over**, through the fourth
expedition segment below and the region-shape pass — but the retune above moved its dial
too, onto the same 5.40 plateau as nightharrow. The *reasoning* in both sections (why a
fourth expedition segment was needed, why the tier stayed unshaped) is unchanged; only
the specific dial figures are not.

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

That forced a **third expedition segment** (`surgeAfter: 8`, `perRegionSurge: 23` at
first): the campaign needs +3 slots a region at tier 2 and +23 at tier 5, and one rate
for both either starves the endgame or hands tier 2 a walkover (measured — the uniform
rate that cleared thanescar put emberholt at 85%, one point past its ceiling).

**That single rate did not survive its own knock-on effect (next bullet) and was split
again, one commit later.** `EXPEDITION` now reads `surgeAfter: 8, surgeBonus: 232,
perRegionSurge: 14` — a one-time step at the tier-3 boundary (the LEVEL a beachhead
needs to contest the neutral pool at all) plus a gentler ongoing rate (the SLOPE),
because one number tried to set both, which is exactly what steepened tier 3 below.
The tier-3 slope figure in the next bullet describes the pre-split, single-rate shape
and is due a re-measure against the current constants — same as everything downstream
of `regions.data.js` while the campaign retune (see "Still open") is in flight.

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
- **`castleGateFrac` is not a difficulty knob** — swept 0.30→0.60 on emberholt it moved the
  win rate *one point*, because this bot already sweeps the countryside when winning. It
  buys the guarantee against a rush strategy, and that is all it buys.
  **⚠ That was true at tiers 1–3 and became FALSE at 4–6, and the ladder is now capped at
  0.60 because of it — see the gate section below.** The claim is kept here because the
  *reason* it stopped being true is the useful part.
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

**The commission is on a cooldown, and it is FACTION-WIDE rather than per site**
(`RECRUIT.marshal.cooldownSec`, 90). `maxPerSite: 1` was the whole brake, and it stops
braking the moment gold stops being scarce — 250 is a rounding error against a treasury
that funds a 700-slot landing, so a late-game player simply bought one for every stronghold
on the board. A faction-wide timer makes it a decision about *when and where* instead of a
purchase you repeat until you notice. It lives in **sim state**
(`faction.recruitReadyTick`), so it survives a resume and replays identically from a command
log; a cooldown parked in the HUD would do neither. `battle-actions.js` counts it down in
the button's own label, and reads `recruitReadyTick()` off the sim rather than recomputing
it — a countdown derived independently is a second implementation of the rule. The harness
never recruits, so this cannot have moved a balance number.

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
`AI_TIERS[4]` (the fastest-thinking commander yet — `reactionTicks` 15, 1.5s between
thinks against tier 4's 1.9s, still short of once a second — commits under a 1.10
margin, and runs **four** simultaneous attacks — `concurrent` is the knob the player
feels, because the answer to two threats is one relief force and the answer to four is
that there is no reserve); the ground (19×15, `develop` 2.6→3.1); and the marshal on a
level-4 castle.

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

## The castle gate stopped being a guarantee and became the win condition

`castleGateFrac` is the share of a region's **non-castle** sites you must hold before a
siege of the throne can complete. Every note ever written about it — in this file, in
`regions.data.js`, at `GATE_CLAMP` — said the same three things: it is not a difficulty
knob, it is worth about a point, and all it buys is the guarantee against a rush. Every
one of those was measured, and every one was true when measured.

**They stopped being true, and nothing noticed because nothing ever re-asked.** The
beachhead pass put a large *neutral* pool on every board, and `castleSealed` counts
non-castle sites — so every one of those neutrals landed in the denominator. Free movement
changed what a bot can sweep, and the map redesign re-authored where sites land. The gate
column never moved; the thing it measures moved underneath it.

Re-measured, splitting runs by **outcome** — which is the only honest way to ask, because
peak control on a run the player *lost* is low by definition and says nothing about
whether the gate was reachable:

```
region        gate   timeouts below gate   control on wins
nightharrow   0.80        8 of 8           0.80 0.81 0.80 0.80
stormhalt     0.82        6 of 6           0.83 0.82 0.82 0.82
cinderwatch   0.84        8 of 8           0.85 0.85
widowsgate    0.85        9 of 9           (no wins in 12)
```

**Thirty-seven of thirty-seven timeouts sat below the gate, and every win landed on it.**
That is not a rush guarantee — it means the gate *was* the win condition. The battle was
decided by whether the last few percent of countryside could be scraped up, and the throne
fell as a formality the moment it opened. Widowsgate could not be won at all.

The ladder now rises through tiers 2–3 and **plateaus at 0.60** for the whole back half,
and `GATE_CLAMP`'s ceiling came down 0.85 → 0.60 to meet it. 0.60 is high enough that a
late region still cannot be ended by beelining the throne — the whole and only thing this
column was meant to buy — and low enough that the castle assault is a fight again rather
than a lap of honour. Difficulty goes back to `enemyMult`, `develop`, the ground and the
AI tier.

**The clamp is a hard ceiling rather than a note on purpose.** The old 0.85 was *also*
documented as a safety limit — "a region whose gate rounds up to all of them is unwinnable
at any skill" — and the table walked straight up to it anyway, one region at a time, each
step defensible on its own.

*Two process notes, both of which cost time here.* The first probe measured peak control
across all runs and reported three gates "unreachable on every seed" — wrong, because it
was mostly measuring runs the bot lost. Split by outcome or do not bother. And the reason
this was worth chasing at all is that `state.rules` is a hand-picked subset of
`config.rules`: the first hypothesis was that the gate had never crossed the seam and was
dead code, which is exactly the shape of bug this project has shipped before
(`rallyKeepDefault`). It is wired correctly — checked before any of the above was trusted.

## Fog of war: buildings see, and a column sees its own doorstep

**The rule used to be absolute — sight came from what you HELD, never from what you were
moving — and the reason was never design, it was COST.** A squad's position changed every
tick, so it could not follow `recomputeInfluence`'s rebuild-on-ownership-change pattern;
a site's owner changes only on capture or construction, which are exactly the events
influence and occupancy already key off. So vision is a **third derived per-hex map**
rebuilt beside the other two, sparse plain JSON, never touched per tick or per frame.

**That objection died with the squad-path change** (see the battle redesign section):
`squadHexOf` reads a position off the `path` a squad carries as a pure function of
`state.tick`, so a query can ask "where is it right now" for the price of a lookup and
the answer never has to be written down. So the squad half of sight lives **entirely in
`canSee`, never in `state.vision`** — the sparse map is checked first (O(1), the answer
for almost every hex) and only on a miss does it scan that faction's own live squads for
one within `SQUAD_VISION_RADIUS`. Nothing is stored, so there is no map to keep in step
and no event that has to remember to invalidate one.

**`SQUAD_VISION_RADIUS` is 1 — an ordinary building's own doorstep, and deliberately not
a new number.** A column lights the ground it is crossing and nothing beyond it. The
watchtower sees four times as far and is the one building that exists to answer "I want
to see"; a marching army that scouted for free would take that away.

**AND WHAT A COLUMN SEES IS WRITTEN DOWN — that half was missing, and it looked complete
because the SCREEN was right.** `recomputeVision` builds `state.seen` out of the
site-only map at its four ownership-shaped events, and squad sight is in none of that,
so a column could march past an enemy stronghold, light it, show it to the player, and
record nothing. Measured on gallowmoor: **56 tick-site pairs visible from the march,
zero remembered.** The instant the column moved on, the board went back to saying nobody
had ever looked — sight that creates no memory does not read as fog, it reads as a
flicker, which is the exact failure `state.seen` exists to prevent. `recordSquadSightings`
is a per-tick pass (O(squads × sites), ~1.2k comparisons a tick on the biggest board) that
**bumps `influenceVersion` only on a genuinely NEW site id** — a few dozen times in a whole
battle, and precisely the moment a building has to appear on the board, so the affordable
condition and the correct one are the same condition.

It is not free: giving both commanders memory of what their columns saw moved the campaign
**+6 to +11 points across tier 4** and had to be paid for in the dial.

**A marching squad NEVER bumps `influenceVersion`, and that is the one accepted cost.**
That counter is what marks the background canvas dirty, so bumping it per tick would
force a full repaint per tick — the exact regression `bgcache.js` already measured once
(60fps → 31 from a cheaper trigger). `computeVeil` calls `canSee` per hex, so the veil
*does* pick up squad sight — but only as of the last repaint something else caused. The
per-frame layer (squads, live site detail) has no such lag; it calls `canSee` fresh.

**A watchtower also DENIES sight, and only of squads.** `COUNTER_INTEL_RADIUS` reads
`VISION_RADIUS.watchtower` rather than minting a second number at the same value: one
bubble, two directions — what the tower grants its own side and what it denies the other.
A radius wider than the tower's own sight would hide an army its owner could not see from
there, which is not counter-intelligence, it is a blind spot with a name. It lives in
`perceivedSquads`, not in `canSee`, because it does not answer "can I see this HEX" — the
ground is plainly visible and the column standing on it simply is not handed over — and
it is checked from `beliefFor` too, or the enemy AI would target what its own doctrine
says it cannot see, which is a behavioural bug wearing fog's clothes. **Squads only,
never sites**: a site's position and kind are common knowledge regardless, so there is
nothing there for counter-intelligence to hide.

**A FAILED ASSAULT LEAVES A MEMORY, and it is the one deliberate relaxation of "a ghost
carries nothing that changes".** The objection to a remembered garrison is that it is a
number nobody ever confirmed — skimmed off a passing sightline and wrong the instant it
goes stale. A lost assault is a different claim: your own army stood on that ground and
fought that garrison, so the count is what just beat you, witnessed at the moment it
mattered. `recordFailedAssault` has **exactly one caller** (`arrivals.js resolveArrival`,
the direct-assault branch, only on a loss) and that narrowness is the safeguard — it can
never drift from "what an engagement showed you" into "what fog half-remembers". It is
its own map rather than a field on `state.seen`, so the strict rule stays exactly as
strict for owner as it always was. The count is read **before `resolveField` mutates
anything**: "the garrison that was there" is not whatever survived.

On the board it draws as a dark red wash one ring around the site (`fog.js
drawAssaultWash`, on `#board-bg` beside the veil and the flood, because it is a wash over
GROUND) plus the stale headcount hung off `garrisonLabelY` — the *same* expression the
live count uses, so scouting the site mid-battle swaps one figure for the other with no
jump. **Only a ghost gets it**: the moment the site is visible again, live information
supersedes the memory. The site panel says `UNSCOUTED · last seen: enemy · lost ~N troops
here`.

**The ground is always visible; the people are not.** Terrain, rivers, the shape mask and
the grid draw everywhere from tick 0. Hiding the terrain too was rejected: it turns the
opening into an exploration phase, and this is a ten-minute real-time battle whose opening
is already a land grab — it would also make the pre-battle preview a lie.

**BUT AN ENEMY BUILDING YOU HAVE NEVER LOOKED AT IS NOT ON YOUR BOARD, and that is the
one place the player and the commander are told different things on purpose.** Site
position and kind used to be common knowledge from tick 0 for both sides, so the player
could read the enemy's entire economy and defence layout at a glance and pick the soft
targets before moving. `siteKnown(state, faction, site)` — owns it, sees it now, or
`state.seen` carries a last-known owner — is the ONE predicate the board, the panel and
the hit-test all ask, so an unscouted building cannot be invisible on the canvas and
still selectable with the cursor. That symmetry is the point: a thing that draws nothing
and still answers a click is a worse tell than drawing it, because the player finds it by
sweeping empty dark.

**UNCLAIMED GROUND IS COMMON KNOWLEDGE, and leaving it out was a shipping bug caught by
one measurement.** With only the rule above, the campaign OPENER measured — on all twelve
seeds — a player board holding their own three sites and **nothing else**: no neutral farm
anywhere on it, while `COACH.drag`, the first line a new player is ever shown, says *"Drag
from your camp to the grey farm."* An instruction pointing at something not on the board.
So `recomputeVision` records a site whose owner is `neutral` into BOTH factions' `seen`.
It is the honest reading of the ask (the thing to hide is where the ENEMY's buildings
are), it keeps the opening land grab legible, and it goes in `seen` rather than being a
live "is it neutral right now?" test in `siteKnown` — otherwise a farm the enemy captured
while you were elsewhere would BLINK OUT, where the ghost should say "nobody's, last I
knew". Riverfen now opens at 6 sites known of 11, gallowmoor 16 of 28, widowsgate 37 of
55, and **zero enemy buildings on any of them.**

**It is provably balance-neutral rather than merely within noise**: with the dial fixed,
the n=96 sweep before and after is *identical region by region* from gallowmoor to
widowsgate. Nothing in `ai.js`, `aihome.js` or the harness branches on the difference
between a ghost owned by `null` and one owned by `neutral` — both are "not the foe".

**`beliefFor` deliberately does NOT ask it.** `perceivedSite` keeps handing the enemy AI
and the harness bot a ghost for every site on the map, because `aicore.js frontDistance`
and `aihome.js reach` are pure whole-map geometry and fogging site EXISTENCE from them
would force a planner that reasons about a map with holes in it — measured once already,
in the shape of a bot that swept the countryside for a whole battle, sent 1,741 orders and
never once attacked a castle it could not see. So the two functions answer two different
questions: `perceivedSite` is "what do I know about this site", `siteKnown` is "is it on
my screen at all". **The cost is stated rather than hidden**: the balance table therefore
describes a bot that still knows where every building is, so it understates the shipped
game for a human. Same shape as the `--idle` and `--relics` gaps recorded below.

One accepted leak: `buildBlocker` requires `BUILD_MIN_SEPARATION` from *every* site, so
while a build is armed the legal-hex tint has a 2-hex hole around an unknown one. Narrow
(only within build range of ground you already hold) and arguably correct — builders two
hexes from a fort would notice it. Both alternatives are worse: gating the tint on
knowledge makes the preview disagree with the command, and gating `buildBlocker` itself
changes a sim rule the harness plays.

**`state.seen` is the memory half, and it is the one derived map NOT rebuilt from
scratch** — it only ever gains an entry or updates one, because its whole purpose is to
remember what fog has since hidden. It records exactly one fact per site per faction: who
held it the last time that side actually looked. Nothing else. A remembered garrison or HP
bar would be fog leaking the only numbers that matter, and both are simply *wrong* once
stale rather than uncertain. Owner is the single field whose staleness is INFORMATIVE —
"it was theirs last time I looked" is a true statement a player can act on. Without it the
board's ownership colouring flickers on and off as vision comes and goes, which is worse
than fog: it is noise. Rejected alongside it — a timestamp, a confidence value, a frozen
snapshot — each is a second thing to keep correct and none earns its keep.

**SCAFFOLDING IS BLIND**, for the same reason it earns no gold and trains nothing. Vision
is the *whole* of what a watchtower produces, so leaving it ungated makes the 15-second
timer decorative: 120 gold buys an instant reveal and the build bar is a formality.
Occupancy is deliberately NOT gated the same way and the contrast is the point — a
half-dug foundation is physically in the way from the moment it is paid for. **Presence is
not production.**

**That gate creates a FOURTH invalidation event, and the other three do not cover it.**
`startBattle`, `siegePhase`'s flip branch and `cmdBuild` all key off the site list or its
ownership changing. A build finishing is a timer running out: nothing appears, nothing
changes hands. Miss it and the one building bought purely for sight grants none of it,
ever. Two more holes of the same shape were closed with it:

- **`createBattleState` builds the map itself**, exactly as it already does for occupancy —
  and the empty default fails in a *more convincing* way than occupancy's did. `canSee`
  reads a missing `state.vision` through optional chaining and returns false for every hex,
  so every enemy site resolves to a ghost and every enemy squad vanishes. That reads like
  fog working perfectly rather than like fog missing. `vision.js` takes `siteById` from its
  real home in `siteinfo.js` so the import back does not close a cycle; `occupancy.js` and
  `influence.js` touch `state.js` for the same reason: not at all.
- **`recomputeVision` bumps `influenceVersion`.** `signature()` notices a per-hex map moving
  only when a SITE moved — an owner flipped, a level rose, the list grew. A watchtower
  opening moves none of those, so the background would go on drawing the country as it
  looked before the tower opened.

**One resolver, three consumers.** The canvas renderer and the DOM panel/preview each
resolved `state.sites.find(...)` independently, so hiding a glyph on the board would still
leave the same site fully inspectable by clicking it — one bug fixed and two left live.
`perceivedSite` / `perceivedSquads` are the one resolver all of them call.
`squadHex` is exported for the same reason: squads store no position, so "is this army
visible" needs the derivation from `spawnTick`/`arriveTick`, and two copies of it disagree
about exactly which tick a marching column appears — a bug nobody will ever reproduce from
a report.

**The watchtower ships here and not one release earlier.** It is a building that does
nothing until fog exists, which is precisely the "sold and did nothing" mistake this
project has already refunded four upgrades for.

```
kind         gold  train  cap  hp   regen  defMult  vision
watchtower   0     0      15   120   2.5    1.10      4
farm         2.0   0      30   100   2.0    1.00      1
```

Cheapest thing on the build menu, useless in a fight, and the only thing on the board that
sees past its own doorstep. `VISION_RADIUS` is deliberately **not** a read of
`INFLUENCE_RADIUS` — that would silently hand a camp a 3-hex sightline and a farm 1.

**Contract v9, and it is v8's lesson a second time: no CROWN-line field changed.**
`SITE_KINDS` gained a kind and state gained the `vision`/`seen` pair, so a v8 blob resumed
here is a board both sides could see all of, handed a fog it was never played with.

### Drawing it, and the three surfaces that kept talking

**The territory flood was the leak nobody would look for.** `state.influence` is computed
from every site regardless of who has ever looked at it, because the sim needs the TRUE
front line for the castle gate, territory score and march speed — so painting it straight
onto the board colours in the enemy's whole country from tick 0. `render/fog.js`
`perceivedInfluence` re-runs the *same* algorithm against a site list resolved through
`perceivedSite` first, on a **throwaway object**, so the sim's own influence is never
touched. Unscouted ground contributes nothing by construction: a ghost's owner is `null`
and `recomputeInfluence` already skips any owner that is not player/enemy/neutral. A ghost
also projects at the BASE weight — painting today's true level over a stale sighting would
leak an upgrade back in through the flood's own strength.

**Fog on the canvas is worth nothing while some other surface goes on narrating**, and
three did. All three were found by review rather than by a failing test, and they share a
shape: a surface that never asked about vision because, before fog, there was nothing to
ask.

- **The effect layer was the big one.** Measured on gallowmoor over a whole battle,
  **85% of all combat and economy effects fired on ground the player cannot see** — 385
  gold `+N` floats over the enemy's training grounds alone, plus every siege, field battle
  and capture. That is a live readout of the enemy's whole economy and it tells you exactly
  where to look; it also defeats `state.seen`, whose one job is that you learn an owner by
  LOOKING. Sound went through the same gate, because hearing a battle you cannot see is the
  same claim as drawing it. After: 427 suppressed, 80 played.

  **`fxVisible` reads the event's own ACTOR fields, not the site's current owner**, and
  that is the half the obvious implementation gets wrong: by the time events are drained
  the capture has already happened, so a site you have just *lost* belongs to the enemy and
  a gate asking "is this mine" answers no to the one event you most need. You always know
  what your own men are doing, wherever they are. The **bus stays outside the gate** — it
  feeds game logic, not the screen, and starving a coach beat of the fact that something
  happened is a different bug from drawing it. An event naming no site is not a positional
  claim and passes through untouched.

- **A rally line has two ends.** The source was checked and the destination was not — and
  `byId` resolves through `perceivedSite`, so an unscouted target came back as a GHOST,
  which is **truthy**, and the bare `!o` check drew a dashed line with two arrowheads
  pointing straight at ground the player had never seen. It announced both that something
  was there and that the enemy was reinforcing toward it.

- **A squad outside vision is not drawn, so it must not be clickable.** `squadAt` scanned
  the raw list, leaving an invisible column pickable out of empty dark — a worse tell than
  drawing it would have been, because the player finds the army with the cursor. **The
  same rule now covers SITES**, via `siteKnown`: a building nobody has looked at draws
  nothing, opens no panel and answers no click. A site the player HAS seen and since lost
  to fog is still a ghost and still clickable, so aiming a blind attack at remembered
  ground remains intended — that is the whole difference between a ghost and a blank.
  (When this bullet said a site was "deliberately left alone", the build-target tint was
  not a leak because a hole in it revealed only what the silhouette already showed. Now
  that the silhouette is gone the hole IS the tell — narrow, and accepted; see the fog
  section for why closing it either way is worse.)

**A spotted column's route is drawn in FULL, including the part in fog.** That is a
deliberate call rather than an oversight: the entire value of spotting an army is knowing
where it is going, and a route clipped to visible hexes is a stub that says nothing. The
cost is that it also reveals where the column came from.

**Fog is free, and this was measured rather than assumed.** The house rule forbids
per-frame allocation, and the veil is a full-board path plus one `perceivedSquads` call
every frame — so it looked like exactly the sort of thing that had already cost this
project 60fps → 31 once. It does not:

```
region        fps    board        lit          squads
gallowmoor   59.7    192 hexes    28 (85% veiled)     6
widowsgate   59.2    336 hexes    35 (90% veiled)    38
```

against a pre-fog baseline of 59.6. The expensive half — the perceived flood and the veil
buffer — sits in the BACKGROUND path, which repaints only when `signature()` moves, and
every event that changes vision already bumps `influenceVersion`. Do not optimise the
per-frame half without a measurement showing it matters; the tick-keyed cache that suggests
itself buys nothing and adds a staleness bug of exactly the class this project keeps
hitting.

**A battle opens 85–90% dark AND with an empty map, and that is the single biggest thing
to watch in a playtest.** Every ordinary building sees radius 1 — its own doorstep,
exactly as the brief asked — so a beachhead of three or four sites lights ~28 hexes of
192, and since the site-existence gate the player no longer starts knowing where anything
is either. What keeps it from being a blank screen is the ground: terrain, rivers, the
shape mask and the grid all draw from tick 0, and a column now lights and REMEMBERS what
it walks past, so marching is itself scouting.

Two knobs if it plays too blind, in order of preference: `SQUAD_VISION_RADIUS` (currently
1 — raising it makes marching a better scout without touching buildings) and
`VISION_RADIUS` for `camp`/`castle`. Raising the latter takes differentiation away from
the watchtower, which is the one building that exists to answer this question.

**A third thing to look at, which is legibility rather than a knob:** an unclaimed farm
you have not reached yet is common knowledge but still a GHOST, so it draws at
`GHOST_ALPHA` *under* the veil — correct (you know it is there and that it is nobody's;
you cannot see what is inside) and, on a screenshot, very faint. If a playtest says the
opening race is hard to find, the answer is the neutral ghost's contrast, not more sight.

**The harness plays it** — same lesson as construction and upgrades, repeated a third
time: a mechanic the harness cannot answer is a mechanic nobody has measured. A blinded
bot with no way to convert gold into information is not a measurement of fog, it is a
measurement of a bot that cannot play the release. `tools/simbuild.js scoutTurn` builds
a watchtower when the player cannot see the enemy castle and gold allows, on a retry
cooldown; `--noscout` reverts it, joining `--noupgrades`/`--noconstruct` so the delta
stays re-takeable — `tests/scout.test.js` pins both directions off one shared
tower-counting helper, plus a longer-running check that the same answer reaches a
late-tier throne and not only an early one. `--sighted`, `--sighted=ai`, `--sighted=bot`
is a separate, purely diagnostic escape hatch in `tools/simrunner.js` (unfog one side,
both, or neither) for comparing the four-way table by hand; **omitted, both sides are
blind, which is the shipped behaviour and what every balance number in this file is
measured against.**

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

**The target shape, `--incursion=... --n=16`, for a player who has just taken the last
region and idled half an hour:**

```
depth      1    5   10   20   30   40   55
win%      94   88   75   38   19    0    0
win-med  2.7  4.6  5.8  9.7 11.0    —    —
```

**This table is now the TARGET rather than the last measurement.** The widowsgate arena's
own dial shifted underneath it during the campaign re-tune (a shared-tree accident,
since rebuilt — see "Still open" → "THE CAMPAIGN RE-TUNE"), so `baseDial` was moved
3.65 → 4.38 to restore this shape. The freshest re-measurement against the rebuilt dial
(`--incursion=1,5,10,20,30,40 --n=48`, recorded in `content/incursion.data.js`, not yet
confirmed at n≥96 the way the rest of the campaign was):

```
depth      1    5   10   20   30   40
win%      96   81   65   40   10    0
win-med  2.8  3.4  4.8  7.2 15.2    —
```

— close to the target, and "a real wall again" in the source's own words. Depth 55 was
not part of that sample; do not assume it still reads 0%.

**...and the same player after ten hours of idling — the only table that justifies the
word "endless" — has NOT been re-measured against the rebuilt dial**, and the source says
so explicitly: re-take with `node tools/simrunner.js --incursion=40,55 --idle=600 --n=16`
before trusting either number below against the current `baseDial`.

```
depth     40   55
win%      75   44
```

The wall used to RECEDE rather than move. If a future pass makes the ladder feel finite,
that second table is the one to re-take: a `perDepth` that outruns the shop's own curve
turns the ladder back into a wall with extra steps.

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
- **The reward is mostly a HEAD START, and that came out of a measurement.** `--legacy=N`
  was added to the harness to check the claim "a second run is a victory lap early and an
  ordinary fight late", and the claim was false: at 27 points (a first payout) the whole
  campaign measured 94–100%, the last region included, won in 4.3 minutes. A flat `+3
  expedition slots a point` was the worst offender — +9% on region 24's 862-slot budget
  and **+675%** on region 1's twelve — so it became a percentage; halving every grant on
  top of that moved the tail by four points. Any multiplier worth pressing the button for
  makes a replayed region trivial, because win rates at the tail are that sensitive.
  So the fix was to make the replay **shorter, not harder**: `headStartPerReset: 8`,
  `headStartMax: 15`. Run 2 opens on 8 regions and plays 16; run 3+ opens on 15 and plays
  9; tiers 5–6 are earned on every run forever. Measured, a replayed region takes 2–5
  minutes against 7–16 on the first run, and widowsgate (81%) is the only one that can
  still take it off you.
- **`meta/prestige.js` exists for one reason**: the reset has to call `recalcIncome`
  (`meta.incomePerSec` has exactly one writer), and `legacy.js` may not import `idle.js`.
  Arithmetic in `legacy.js`, the act in `prestige.js`.
- **It is a no-op at zero points**, which is every battle the balance table was measured
  with. `tests/legacy.test.js` asserts that as an identity, not as "small".
- **What survives**: legacy, lifetime stats, preferences, the tutorial flag, and the
  incursion ladder — the ladder is a record of what the player has beaten, not something
  they own, and it is half of what a run pays.
- `atk`/`def` are deliberately the *smallest* grants (1.5% a point). They are the two
  channels the campaign's curve is measured against, so a generous legacy there would not
  make a second run faster, it would make every measured region a walkover.

## Relics: the currency that does not tick, and the troop lines it buys

`meta.relics`, paid by `meta/rewards.js` and nothing else. Crowns accrue per second —
that is the idle half of the game and also why they cannot price anything that has to
stay scarce, because waiting is always an answer. Relics are paid only for ground you
have **beaten**: a region's FIRST clear pays its tier (78 across the whole campaign,
back-loaded — tier 1 pays one each), an incursion rung pays `1 + depth/5`, and a **raid
pays none**. That last omission is the design: `raidLump` exists because re-clearing has
to be worth something and must not be farmable, and a relic is the thing that must not be
farmable at all.

They buy two things. **Booster charges** — 1–3 relics each, where they used to be 25–60
crowns and therefore free from about region six forever. And **one endless line per
troop** (`vetMilitia` … `vetRams`, +6% attack and defence for that troop alone), which is
the answer to "level the troops I like": `arms` levels everything you own at once, which
is the right shape for the main ladder and the wrong shape for a decision.

**Boosters got stronger to match**, since a charge now costs something real — rally 2→3
hops and 50→65%, march 0.50→0.35, bombard ¼→⅓ of a garrison and 60→110 structure, fortify
20→26s and attackers 0.50→0.40, tithe 250→400 gold. The harness launches every run with
`boosters: []`, so none of it can have moved a measured number.

**This is the third mechanism for shipping power without re-tuning the campaign**, after
the Crown tier's `endgame` gate and the specialists' zero default weight — and it is the
cleanest of the three: **the harness earns no relics at all.** `metaFor` builds its empire
by calling `markConquered` directly and relics are paid by `applyOutcome`, so every battle
in `regions.data.js` is fought at zero. `tests/relics.test.js` drives the bot's own
shopping routine with a 10¹² crown budget at every stage and asserts it buys none of them,
*and* that it does once relics are granted.

**Contract v7 — `FactionMods.unitMult`**, sparse, applied per unit inside `combat.js
power()`. This is the one shop feature that could NOT ride an existing field, and the
reason is the feature: `unitAtkMult` is one number for the whole stack and the entire
point is that militia and rams stop sharing it. `{}` for every measured battle.

**Two things follow the currency rather than the run.** Relics survive abdication, and so
do the lines they bought (`prestige.js` keeps `meta.upgrades` entries whose currency is
relics, filtered by currency so a line added later is kept without anyone remembering).
A hard currency whose purchases evaporate every reset is a rental, and the player would
hoard it and never spend.

**Measured, with `--relics=N` (new):** gallowmoor 67% at 0, **74% at 14** (what a real
player holds by region 10), **92% at 78** (a whole campaign banked). So the table describes
a player who does not spend them, and choosing to is worth ~7 points mid-campaign and ~25
by the end of a run. That is the feature working, not a mis-tune — but it is the same
shape as the `--idle` gap below and belongs beside it.

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

**...and the five you bring are the only five you can BUILD.** The cap capped what
you could carry and nothing capped what you could then train, so the decision it exists
to create expired the moment you captured somebody's yard: you picked five at the
briefing and built the other three out of enemy strongholds, free and unannounced.
`meta/composition.js battleRoster` narrows `unlockedUnits` to what the expedition
actually carries, `cmdTrain` already gated on that field, and nothing in the engine
changed. `trainableUnit` carries the other half — a captured yard set to an alien type
falls back to a buildable one, and *never* to the Marshal, who would sit there producing
nothing and looking busy. **Balance-neutral, measured**: the bot trains militia and rams,
mapgen seeds militia and spearmen, and all four are in the default spread.

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

- **`grid` is an OFFSET rectangle, not an axial one.** `axialFromOffset(col,row) =
  {q: col - floor(row/2), r: row}`, so a 9×9 grid holds **no negative `r` at all** and
  `q` runs from `-floor(r/2)` upward. Four hand-built fixtures read it as "q and r both
  0..8" and put sites off the map; all four passed, because a send was legal on an
  authored EDGE. `assertBattleConfig` rejects it now.
- **A site kind is not just a row in `SITES`.** It needs `INFLUENCE_RADIUS`,
  `AI.siteValue` (list it — the `?? 100` fallback silently prices a training ground as a
  farm), `MAPGEN.garrison` per faction, `BASE_GARRISON`, `mapgen KIND_TAG`, four render
  tables and `simbuild BUILD_ORDER`. `SITE_KINDS` is derived from `SITES` and
  `contract.js` imports it rather than repeating the list, which is one of the eight
  fixed. `tests/sitekinds.test.js` walks the rest.
- **A behavioural check on `kind` is usually a check on the wrong thing.** Three places
  named `stronghold` to mean "can train" and one to mean "is a real wall"; the split made
  every one of them wrong in a different direction. Ask `SITES[kind].train`,
  `site.trainType` or `hpMax` instead. `tools/mobile.mjs` was clicking a site with no
  training fan and reporting the layout fine.
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

## The ten-specialist review, and what it found

Ten specialists were run over the whole product — UI design, game feel, onboarding,
accessibility, architecture, tests, performance, game design, save integrity and
release/PWA — each driving a real browser rather than reading source. Most of what
follows is a MEASURED bug rather than an opinion, and the measurements are worth more
than the fixes.

**A refused save silently started a new game.** `bootstrapGame` hands back a blank state
when it cannot read the file, a blank state IS a fresh campaign, so `mainmenu.js` took
its early return twenty lines above the refusal message. The file was safe and autosave
was already off — but nothing said so, and the whole recovery path (`SAVE.restoreBackup`,
`SAVE.autosaveOff`, `loadBackup()`) had **zero consumers**. Now `mainmenu-recovery.js`.

**Three rendering bugs nobody could have found by reading.** The world map strobed
**pure #ffff00** on entry, because `hd-fill`'s implicit `to` is a `color-mix()` and its
`from` was a hex, so Chromium interpolated the pair in oklab and left the gamut. Every
panel in the game composited at **1.05:1** — a modal measured *darker* than the scrim it
covered — so a 1px hairline was the only thing defining a surface anywhere. And
`spin += 0.016` **per frame** ran every siege ring at double speed on a 120Hz display.

**The background canvas repainted every frame during any camera gesture.** ~54ms a
repaint, `markBgDirty` called on every pointermove: 295 repaints in a 10s pan, main
thread pinned at 994ms/s, **60fps → 31 on a desktop and 36 → 17 on a throttled phone**.
Gated to 8/s it measures 53fps. Everything else about performance is genuinely fine —
59.6fps with one dropped frame in 3,576 on the biggest board, the sim at 0.3–0.7% of a
core — so this was the only real defect in the renderer.

**Half the tutorial was written and never shown.** Five `COACH` lines had no entry in
the beat table, including the three that teach what people actually lose to (a stalled
siege, rams, pulling out). `tests/coach.test.js` could not notice: all 22 assertions
iterate `BEATS`, so it proved the wired beats worked and could never ask about the rest.
The test now derives from `COACH` itself and fails if a line reaches no player. Worse,
the one instruction a new player *did* get expired on a 6s timer and could never return —
an instruction now stays until the player does the thing.

**Accessibility: the DOM layer is good and the canvas has nothing.** Every control is
named, focus is moved into every dialog, `prefers-reduced-motion` collapses at the token,
targets pass 2.5.8 everywhere. The board is a canvas with no name, no role, no keyboard
path and one visual channel — and player-green vs enemy-red measures **ΔE 1.8 at 1.03:1
under protanopia**, i.e. one continuous field of ground (the site-stroke half of this was
answered later — see "Still open"). Fixed here: locked regions at
1.62:1, filter chips at 1.65:1, empty boosters at 1.88:1 (the *default* look of a fresh
save), a world-map focus ring that `clip-path` painted and discarded (0 of 67,344 pixels
changed on a real Tab), a treasury live region announcing 3× a second, and Space not
activating focused buttons.

### Still open, and why

- ~~**THE CAMPAIGN RE-TUNE (second pass), against the finished battle layer.**~~
  **Closed.** It reopened when the battle redesign changed the ground under every
  measured number — marches twice as long, hostile territory twice as costly, a
  corner camp, buildings that shoot, construction gated on territory — and it was
  deliberately left open through the vision work rather than tuned twice. One honest
  pass at the end, exactly as planned.

  **All twenty-four report `ok` at n=240**, against their tier's `WIN_BAND` *and* their
  advertised length, in campaign order:

  ```
  tier 1   riverfen 90  ashford 90  ironwood 88  saltmere 79
  tier 2   kaldan 75  highmarch 77  greywater 67  thornmoor 74  emberholt 74
  tier 3   gallowmoor 60  sunder 58  vaelstrand 57  duskfell 65  karrowmere 54
  tier 4   thanescar 54  blackspire 45  ironcrown 47  obsidian 47
  tier 5   ravensmarch 30  gravenreach 33  nightharrow 35
  tier 6   stormhalt 30  cinderwatch 33  widowsgate 29
  ```

  **The starting point was twelve of twenty-four out of band, in BOTH directions**,
  which is what made this different from every earlier pass. Tier 1 read too hard and
  tiers 4–5 read 15–25 points too easy, so the dial had to move down at one end and up
  at the other. It took five full sweeps (n=48 to find the slope, three at n=96, one at
  n=240 to close) and cost about two hours of wall clock at four jobs.

  **Four things are worth more than the numbers:**

  1. **The slope is ~1 point per 0.01 of dial campaign-wide, and ~1.8 on the small
     maps.** Derived by applying a deliberate first step to all 24 rows and reading the
     deltas, rather than trusting the older per-region figures — which were taken before
     free movement and would have over-corrected tier 5 into the floor.
  2. **A tier's ground has to be a tier's ground; the dial cannot rescue a row that is
     structurally in the wrong tier.** Ravensmarch shipped with obsidian's exact enemy
     mix on a wider board and read 61% against a band eleven points lower than
     obsidian's. `enemyMult` is required non-decreasing, so pulling it down alone would
     have needed a dial above its own tier-mates — a contradiction, not a tuning
     problem. Its mix became gravenreach's and it landed at 31%.
  3. **`siteCounts.neutral` is a real difficulty knob and it points the way the tier-2
     header already said it did.** Ironcrown sat on obsidian's dial reading thirteen
     points easier, and the whole difference was 15 neutral sites against 20. Widening
     it to 19 moved it 58% → 42% with nothing else touched.
  4. **`targetLengthMin` derives `hardCapMs`, so re-authoring the promise re-tunes the
     battle.** Honest lengths cut tier 2's caps by 15–32% and cost that tier 2–8 points
     — which is correct (a region should not be allowed three times the time it
     advertises) but has to be measured, not assumed, and has to land BEFORE the
     confirming sweep.

  What follows is the record of the pass that closed it the FIRST time, kept because
  the shape of it is the useful part.

- ~~**THE CAMPAIGN RE-TUNE (first pass).**~~ **Closed and confirmed end to end at the
  time.** It was the
  biggest open item in the project for a long time, waiting on free movement, the
  yard/wall split, construction, the map redesign, fog, the AI belief model and the
  castle-gate fix — because tuning between two structural changes is work thrown
  away. All twenty-four regions now report `ok` at n=96 against their tier's
  `WIN_BAND` *and* their advertised length. Band edges confirmed at n=240 where they
  were within a few points (greywater, thornmoor, highmarch). Left as a scar rather
  than deleted because the shape of the pass is the useful part:

  ```
  tier 1   riverfen 90  ashford 86  ironwood 82  saltmere 79
  tier 2   kaldan 84  highmarch 83  greywater 66  thornmoor 79  emberholt 70
  tier 3   gallowmoor 50  sunder 55  vaelstrand 54  duskfell 58  karrowmere 52
  tier 4   thanescar 44  blackspire 43  ironcrown 49  obsidian 34
  tier 5   ravensmarch 33  gravenreach 26  nightharrow 33
  tier 6   stormhalt 24  cinderwatch 21  widowsgate 27
  ```

  **The starting position was twenty-three of twenty-four reading TOO EASY** — the
  castle gate had been carrying difficulty by accident, and capping it (see the gate
  section) handed the whole job back to `enemyMult`, `develop` and the ground:

  ```
  tier 1   100  99 100  95        tier 4   93 81 90 69
  tier 2    99  98  85  90  94    tier 5   59 66 91   (n=32)
  tier 3    99  98  94  93  86    tier 6   78 66 59   (n=32)
  ```

  **Three things cost real time and are worth knowing before the next one.**

  A `git add -A` in this shared tree briefly mixed another engineer's in-flight
  `siteCounts`/`develop` edits under the measured `enemyMult` column, doubling up
  difficulty on several regions. It was traced, named, and rebuilt from the last
  known-good base rather than re-bisected to fit the contamination. **Stage explicit
  paths in a shared tree.** A residue of the same accident survived one rebuild —
  `AI_TIERS[1].economyMult` — and put kaldan at 40% against a 66% floor until it was
  found; a rebuild is only as good as the set of files it covers.

  The **first full sweep after the tune reported five regions low, and four of the
  five were `branch`-shaped.** That is the shape-calibration finding written up in the
  region-shape section: the silhouettes had never been compared to each other, only to
  the unshaped baseline, and `branch` had quietly become a second difficulty column
  worth about eleven points. One constant fixed three of them.

  And **the lengths were the bigger story, exactly as this bullet used to say.** Every
  advertised number was two to three times the real one, because an army marches
  straight at the throne instead of chaining through the countryside.
  `targetLengthMin` was re-authored campaign-wide from measured win medians rather
  than by lowering every promise — emberholt 16.5 → 9 minutes, thornmoor 16 → 9. Tier
  6 is the exception that proves the rule: a tier-6 battle SHOULD be long, so what
  moved there was the fight, not the label. `tests/campaignplay.test.js` passes on
  thornmoor again, which is what had been gating the Pages deploy.

  **What is still open in the same area, and is now the honest top of the list:** the
  table describes a bot that earns no relics, idles far less than a real player, and
  brings the default four-type spread. See the `--idle` / `--relics` bullet below and
  the dominant-loadout bullet above — the second of those is a bigger lever on the
  felt difficulty of this game than any row in `regions.data.js`.
- **The bot builds farms while it is losing.** `constructTurn` picks its kind on one
  rule — a yard while it holds fewer than three, a farm after that — and never a
  stronghold at all. Measured on obsidian, a run it lost: seven farms raised and seven
  razed, while its army collapsed. An ordinary player under that much pressure builds a
  wall or nothing. The fix is a pressure term in the kind choice, and it wants a
  measurement rather than an opinion — `--noconstruct` is what keeps that re-takeable.
- **Nothing weighs a build against an upgrade.** `upgradeTurn` simply runs first and
  construction gets the leftovers, never in the same turn. That is defensible as
  ORDINARY play — a cheap upgrade already on the panel is what a player reaches for —
  but the other order has not been measured.
- **The ENEMY does not build**, exactly as it does not upgrade, and for the same reason:
  it already receives developed country free at mapgen through `develop`, so teaching it
  to build would double-count the same mechanic and silently re-tune every region. If
  that is ever wanted it is a balance pass, not a bug fix.
- ~~**Fog of war and watchtowers are phase 2 and untouched.**~~ **SHIPPED** — see the fog
  sections above. Left here as a scar rather than deleted, because a market-research pass
  found this bullet still claiming the feature was unbuilt *after* it had shipped, and
  a stale "still open" entry is worse than no list: it sends the next reader to build
  something twice. **If you close an item, close it here in the same commit.**
- **The loadout has a dominant answer: bring only militia.** Re-measured on the tuned
  table at n=48, matched seeds: gallowmoor **56% → 98%** (and a 5-minute region won in
  2.3), widowsgate **27% → 90%**. The exploit gets *wider* as the campaign gets harder,
  so the part meant to be a wall is the part it trivialises most. It is now pinned by
  `tests/loadoutdominance.test.js`, which encodes it as a DEFECT and fails
  informatively in both directions.

  **⚠ DO NOT FIX THIS BY NERFING MILITIA — measured, and it backfires.** Three probes,
  gallowmoor, n=24, matched seeds (default → mono, gap):

  ```
  baseline                       54% -> 100%   gap 46
  counters.spearmen 0.75 -> 0    29% ->  83%   gap 54
  atk 4->3 and def 3->2.25       38% ->  88%   gap 50
  ```

  Every nerf WIDENS the gap. The mixed army sits on the steep part of the win curve and
  the mono army on its flat top, so the same nerf costs the default spread 16–25 points
  and the exploit 12–17 — and wrecks the campaign on the way past. This retires the
  standing "re-tune `UNITS.militia.counters.spearmen`" recommendation.

  **The mechanism is TEMPO, not stats.** One slot budget buys 471 militia or 240 mixed
  bodies, 32% more field power, at *equal* siege output — the spread's 23 rams make 276
  siege DPS and 471 militia make 283, so rams buy siege the militia already had for a
  third of the field. That is the same finding as "`breachSeconds` stopped binding"
  below, from the other end. And **nothing in the game is sensitive to concentration**:
  `battle/aiadapt.js` counter-picks by `argmax`, so it answers a 46%-militia army and a
  98%-militia army with the identical share of production. Measured against mono-militia
  the enemy is down to ZERO training grounds by t=3min — it is not out-fought, it is
  out-raced before the adaptation it already has can matter.

  So the levers that could work are the ones that read CONCENTRATION rather than the
  unit: make the counter-pick scale with how dominant the dominant unit is, or give
  siege a scarcity headcount cannot buy. A per-type slot-share cap was built and
  measured (69%/56%, default spread byte-identical) and then **reverted**, because it
  contradicts the carry contract ten tests encode — do not re-spend that either.
- **Ownership's second channel is half-built.** `render/ownerDash.js` shipped the
  site-stroke half of the fix for the ΔE 1.8 measurement above: `ctx.setLineDash`
  sized off line width, solid for yours, dashed for theirs, fine dotted for nobody's
  (and for a fogged ghost, which must read as "nobody's, as far as you know" rather
  than fall through to solid). Still open: the other half of the same proposal. The
  territory FLOOD is most of what the board actually is, and it is still hue-only for
  player vs enemy — `terrain.js makeHatch` is already wired into `drawFlood`, but only
  for the CONTESTED band. A per-faction hatch under the flood itself, batched by owner
  the same way the fill already is, is the highest-value visual-accessibility gap left.
- **`breachSeconds` stopped binding around region 8.** 33 militia out-pace a level-5
  castle's repair, and landing budgets reach 703 slots, so the mechanism the whole design
  rests on no longer gates anything late. This is why rams measure as a straight loss.
- **The harness player is poorer than any real one**, in both currencies. `metaFor` grants
  one region's worth of idle income and never raids; a player who simply plays back-to-back
  banks 2.29M crowns by region 24 against the harness's 464k. At `--idle=50` the last region
  goes from 25% to **85%**, so tiers 4–6 may be walkovers the table cannot see. Relics are
  the same gap with a smaller number and a new flag: `--relics=14` (region 10's honest
  holding) is +7 on gallowmoor, `--relics=78` is +25. Both are now re-takeable rather than
  remembered, which is the only part that was ever actionable.
- Dead seam fields with no reader: `ramImpactHp`, `rules.isRaid`, `rules.targetLengthMs`.
- **`meta.stats` tracks thirteen lifetime counters and no screen shows one of them.** They
  are written on every battle and carried through abdication; a player has no way to see
  any of it. `screens/mainmenu-legacy.js` and `mainmenu-settings.js` are the pattern a
  stats drawer would follow. For an idle/strategy hybrid this is a retention gap rather
  than a nicety — "numbers that go up, which you can look at" is the genre's core loop,
  and this game collects them and hides them. The derived figures are the reason to build
  it: win rate, kill/loss ratio, and the share of all income collected *while away*,
  which is the idle half of the game made visible. See `ROADMAP.md`.
- **`split` is uncalibrated, and unlike `branch` it has no knob.** Grouped by silhouette
  against the middle of each region's own band, all three `split` regions read −6 —
  saltmere, sunder and gravenreach, identically. `branch` was −11 and was fixed by
  `branchTrunk` (see the region-shape section); `SQUEEZE` has no `split` entry at all, so
  this one is recorded rather than solved. Either give it a parameter or write down why
  it should not have one.
- **A short session has nothing to do in it.** A battle is 7–15 undistracted minutes and
  passive play loses on purpose — verified, a Riverfen battle with no input is down to
  two sites inside two minutes — which is correct, and is what stops the idle half being
  used to skip the real-time half. But a raid is a whole battle and an incursion rung is
  a whole battle, so there is nothing a player can do in ninety seconds except collect
  income and buy an upgrade. Half of this was built and merely unadvertised and is now
  fixed (the battle autosaves and resumes for twelve hours; Withdraw now says so). The
  other half is open, and it is the least-explored axis in the design.
- **The service worker has no install affordance.** The manifest, the icons and the
  worker are all there, so the browser's own install prompt is the only route in;
  `beforeinstallprompt` is not captured, so there is no button anywhere that says the
  game can be installed.
- `tools/checksize.js` does not cover `.mjs`, so `tools/smoke.mjs` is 625 lines against a
  400-line cap and `npm run check` reports ok.
- ~~Neither `tools/smoke.mjs` nor `tools/mobile.mjs` is in CI~~ — **CLOSED.** Both run in
  a `browser` job that serves the game and drives real Chrome through `tools/cdp.js`, and
  the deploy waits on it. `tools/offline.mjs` runs there too, last, because it installs a
  service worker and must not leave a cache the other two would assert against.

## Deployment

`.github/workflows/pages.yml` deploys to GitHub Pages on every push to `main`, gated on
**two** jobs. `verify` runs `npm test` and `npm run check`; `browser` serves the game and
drives real Chrome through `tools/cdp.js` for `smoke.mjs`, `mobile.mjs` and
`offline.mjs`. Live at **https://ka1e27.github.io/temp/** (`?dev=1` for the developer
overlay).

**The browser job exists because the unit suite structurally cannot catch the worst bug
this project has shipped.** `#screen-root` is `pointer-events: none` and every scene opts
back in; a release once went out with nothing clickable at all and the suite stayed green,
because a synthetic `el.click()` bypasses hit testing entirely. Only real pointer events
plus `document.elementFromPoint` find it. Chrome comes from `CHROME_PATH`, checked at the
step that sets it rather than left to fail later inside a test; the dev server is started
with `nohup` and a redirect, because a bare `npm start &` holds the step's stdout open and
dies with it often enough to be a flaky-CI generator.

**The game plays offline** (`sw.js`), which for an idle game is not a nicety: the meta
layer pays out absences, and before this a player with no connection could not open the
game to collect any of it. Runtime caching, not a precache list — there is no build step
to generate one, and a hand-maintained list would go stale silently, still working online
and failing only offline. Registration is https-only, which also keeps a worker out of the
dev server and out of `smoke.mjs`/`mobile.mjs`; `offline.mjs` opts in by hand and cleans
up after itself.

The workflow cannot enable Pages itself — `pages: write` grants permission to deploy to a
Pages site, not to create one. That was a one-time admin action and it has been done.
