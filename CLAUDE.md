# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Hex Dominion** — a browser game combining idle income with real-time territorial
conquest. You take hex regions one at a time; conquered regions pay crowns per second
whether or not you are playing; crowns buy upgrades that crack the next, harder region.

Twenty-four regions in six tiers, and then four endgame loops that do not end: an
**incursion ladder** (one battle per rung, escalating forever), **the Frontier** (one
1,280-hex map that gets harder the further out you walk — push for the deep country or
bank what you hold), the **Crown** shop tier that pays for both, and **abdication**,
which trades a finished empire for a permanent multiplier and starts the campaign again.

The Frontier opens after the first tier rather than after the campaign, so it is the one
endgame loop most players will actually see.

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
- **The endless mode** (`content/endless.data.js`, `battle/frontier.js`,
  `meta/endless.js`) → The Frontier, then the Gotchas entry on `REGION_BY_ID` — the one
  thing that reliably breaks around it is code that treats that map as the campaign.
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
node tools/simrunner.js --frontier --n=8            # the endless MAP, by how far out
node tools/simrunner.js --frontier --conquered=4,24 # ...for two sizes of empire
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
`battle-panel.js`←`battle-actions.js`/`battle-upgrade.js`/`battle-status.js`,
`battle-input.js`←`battle-drag.js`, `battle-orders.js`←`battle-select.js`, `mainmenu.js`←
`mainmenu-settings.js`/`mainmenu-legacy.js`, `modifiers.js`←`marshals.js`,
`simrunner.js`←`simladder.js`/`simfrontier.js`, `simplayer.js`←`simshop.js`/`simbuild.js`,
`sim.js`←`arrivals.js`, `store.js`←`refund.js`/`sanitize.js`, `ai.js`←`aicore.js`/`aihome.js`/
`aiadapt.js`, `regions.rules.js`←`regions.fallback.js`, `movement.js`←`retreat.js`,
`smoke.mjs`←`smoke-helpers`/`-battle`/`-orders`/`-checks`/`-meta`, `core/hex.js`→`mapgen.js`
(the offset↔axial arithmetic lives in core and mapgen re-exports it, because
`contract.js` has to ask "is this hex on the board" and the seam may not import
map generation).

**"Re-exported" is true of most of that list and NOT of all of it, so check before you
assume an import path.** `rally.js`, `refund.js` and `retreat.js` are imported DIRECTLY by
their consumers rather than re-exported from the parent, because in each case the parent
imports from the child and a re-export back would make the pair a cycle — for `retreat.js`
that cycle would put `movement.js`'s `const resolve` in its own temporal dead zone.
`movement.js`←`retreat.js` is the seam between "where is this squad and how long does the
trip take", which is pure geometry, and "where should it go instead", which has to know who
owns what.

**`battle/fightaid.js` is the same shape and exists for the same reason.** `arrivals.js`
and `meleephase.js` both need `recordCasualties`, `skirmishHome`, `modOf` and `vetOf`, and
`arrivals.js` imports `openSiteMelee` from `meleephase.js` — so leaving the helpers where
they were made the pair a cycle. A third file both import is the house fix. Copying the
four would have been two implementations of the lifetime record and of the raider escape.
`melee.js` (the projection and its interpolation) is separate from `meleephase.js` (the
tick phase) along the same line `movement.js`/`retreat.js` uses: arithmetic that knows
nothing about the board, versus the pass that walks it.

**`regions.rules.js` now also holds the two load-bearing rules of the region table**
(a region's step must be the size of the player's step into it; the player's step
includes the mechanics the harness actually plays). They moved out of the table's own
header when tier 6 needed the budget, and they belong there: both are claims about
every row.

The endgame layer is `content/incursion.data.js` + `meta/incursion.js` (the ladder),
`content/legacy.data.js` + `meta/legacy.js` (abdication), `content/endless.data.js` +
`battle/frontier.js` + `meta/endless.js` (the Frontier), and `screens/incursion.js` +
`screens/mainmenu-legacy.js` + `screens/endgate.js` for the surfaces.

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
`CONTRACT_VERSION` (currently **12**) — which is also what makes `meta/resume.js` discard a
mid-battle blob whose shape the current engine would step wrongly. **Read the version off
`contract.js`, not off this line**: it said 10 for a whole release after v11 shipped, which
is the same staleness this file warns about at "Still open".

**v12 is the v8 lesson a FOURTH time, and by now that is the pattern rather than the
exception.** A field battle takes `MELEE.seconds` (see "A fight takes time" below), so a
site carries a `melee` record and so does a squad — and no CONFIG field moved. A v11 blob
resumed here is a board mid-assault whose fights are simply not happening: no melee record,
so nothing steps toward an outcome, and both stacks stand there intact forever while every
other phase runs normally.

**v11 is three fog changes travelling together, and only one of them is a field.** Squad
sight and a watchtower's counter-intelligence need no new state — both are answered fresh
from `path`/`arriveTick`/`camped`/`hex`, which have crossed the seam since v10. What is
new is `lastKnownGarrison`, the remembered size of a garrison that beat back a real lost
assault. A v10 blob reads `undefined` for every site, which is the RIGHT default ("never
fought here") rather than a wrong-looking one — and the bump is still required, because
the rule is "state shape changed", not "and it happened to fail safe this time".

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

**AND THE ARROW IS THAT ROUTE.** The drag previewed as a bowed arc from source to target,
which was honest while a send was *aimed* and became a lie the moment waypoints shipped:
the army walks hexes around mountains and bases, and the arc drew straight over all of it,
so a player choosing the long way round a wall that shoots at passers-by could not see
whether the road they drew was the road they got. `battle-waypoints.js previewPath` builds
the same `stops` array `cmdSend` builds and hands it to the same `pathThrough` — the
`resolveField` discipline, one layer up — and the renderer strokes those hexes. It is
recomputed only when the finger crosses into a new hex or the snap flips, because
pointermove fires far faster than either and the path costs an A* leg per waypoint. No
legal route falls back to the dashed arc, which is honest: `cmdSend` would refuse it too.

**THE SNAP MAGNET WAS EATING THE ROUTE, and that is why a road could not be drawn past
your own gate.** `snapTarget` pulled to any known site within **2.4 hexes** — nearly three
tiles, so every hex you might route *through* beside a building was inside its reach, and
a drag that went round one was captured and reissued as a send AT it. It is `SNAP_HEXES`
0.85 now, under a single hex, and a **drawn route turns it off entirely**: a player who
curved a road has already said where the army goes, and `board.siteAt` still fires, so
ending a drawn route on a building works — it just has to be *on* the building.

**Chaining through your own buildings was never a sim rule** — `passableFor` has always
let a faction cross its own hexes, and a waypoint on your own yard routes fine. The magnet
was the whole obstacle. What the shrink DID expose is a real hole: `passableFor` gives the
GOAL hex a free pass so an army can path onto a site it means to assault, which made a
bare-ground order naming an enemy base's own tile an order to CAMP inside it — and
`arrivals.js` obliges, because a camped squad never consults occupancy again. Both march
verbs now refuse it (`occupied-hex`); your own ground stays legal, which is the half the
feature is for.

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

### Concentrating force, and a preview that keeps its promise by saying less

The AI has pooled up to `AI.maxSources` sites into one assault since free movement
shipped, and the whole balance argument for free movement rests on concentration — the
player had no equivalent, and the cost scaled with exactly the late maps where it
matters. **SEND was the last member of a family to learn this**: `setRally` and
`retreatSelection` had walked `view.selection` for releases.

The rule is one line: **a drag that STARTS on a site already in the selection commits
every source in it**; a drag that starts anywhere else is exactly one send. That is
what keeps it from being a surprise — pull from one of three selected and you meant all
three, pull from a fourth and you meant that one. No source cap, because `AI.maxSources`
bounds the AI's *search* rather than stating a rule of the game.

**THE PREVIEW CLAIMS LESS, AND THAT IS THE FEATURE.** Invariant 3 says the pre-commit
preview is a guarantee because it calls the same functions the sim runs. A multi-source
send cannot honour that with a combined outcome: `travelTicks` differs per source, so
the columns arrive as SEPARATE WAVES, and since the melee layer a later wave reinforces
a fight already under way rather than joining one simultaneous one. Summing the comps
and calling `resolveField` once would produce a plausible, confident, WRONG number —
precisely the class of defect this project keeps finding. `computeMultiPreview` reports
columns, total bodies and the arrival SPREAD (first and last ETA, off the same
`travelSecondsFor` the single-source preview already wraps) and claims no `win`, no
`verdict`, no survivor count. **The way to keep "the preview never lies" is to withhold
a number you cannot keep, not to soften one.**

Worth knowing before reading a missing verdict as a regression: a SINGLE-source preview
withholds its outcome too when the target is unscouted (`kind: 'unscouted'`). Same
silence, different reason — fog rather than arithmetic. `tests/multisend.test.js` pins
both, and its negative control is that an ordinary one-source drag is untouched.

### Troops on a tile behave like troops in a building

**`MOVE_SQUAD` was in the engine, documented in four places as the way a camped army
is re-tasked, and NOTHING in the game could issue one.** The only caller in the whole
tree was a fixture in `tests/vision.test.js`. So the rule the squad rewrite was built to
buy — stop on open ground and you keep your options — was true of the simulation and
false of the game. Same shape as the four refunded upgrades and the inert archer: built,
described in comments as working, unreachable.

Two halves were missing, and both are the *garrison* rule applied to a field.

**THE ORDER DIVIDES.** `cmdMoveSquad` takes `fraction` and `filter`, meaning exactly
what they mean on a send, and **what is not ordered anywhere stays put** — same hex,
still camped. A camped force used to be the one body of troops on the board that could
not be split: the whole army went or none of it did. The whole-force case keeps its own
branch (`marchCamped`, re-tasking in place) rather than being folded into the split,
because a squad that spawned a sibling and then emptied itself would leave a
zero-strength camp on the board that every consumer would have to learn to ignore. The
route is validated **before** anything leaves the camp, for the reason `cmdSend` debits
a garrison last: `spawnSquad` answers an impossible route with a straight line rather
than a refusal, so ordering first and asking later produces a column walking through a
mountain and a camp that has already paid for it.

**THE GESTURE RESOLVES.** `battle-input.js onDown` took its drag source from
`board.siteAt` alone, so a press on open ground meant one thing — start a box select.
A camped force is checked first now, because a press that lands on an army plainly means
that army; empty ground still boxes. It reuses the same `squadAt` the tap path already
calls, so an army you can select is an army you can drag and both stay fog-gated for
free.

**No contract bump.** No field moved and nothing about how a blob is stepped changed —
a split just puts a second ordinary squad on the board.

`battle-drag.js` is new and holds the whole answer to "which of the four march orders
did that drag mean" (camped or garrison × site or bare ground). One function, so a
camped force and a garrison cannot drift into two different answers to the same gesture;
`battle-input.js` recognises the gesture, `battle-orders.js` turns intent into a command,
and this is the piece between them. `battle-select.js` came off the same pass —
selection, and the three orders that address a selection rather than one site, which
were written one at a time, which is how SEND came to be the only one missing.

**Verified in the real game, not only in a fake DOM**: a 5-troop camped force dragged at
the default 50% left 2 camped on the same hex and marched 3 off as a new column.
`tests/campedmove.test.js` pins both halves, and its negative controls are the point —
a split that quietly moved everything, or a camped branch that intercepted an ordinary
send, would both look perfectly healthy from outside.

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

### A fight takes time, a tile can be contested, and archers reach a hex

Three requested changes, shipped together because they are one mechanic seen three
ways: a force that meets a hostile force is no longer deleted on the tick they touch.
`battle/melee.js` (the projection and its interpolation), `battle/meleephase.js` (the
tick phase), `battle/fightaid.js` (the helpers both it and `arrivals.js` need).

**`resolveField` IS UNCHANGED AND IS NOW READ AS THE PROJECTION**, and that one
decision is what made the whole layer affordable. The sim interpolates both sides
toward the outcome `resolveField` already computes, over `MELEE.seconds`, and
re-projects when either side changes. Three properties fall out of it that a per-tick
Lanchester exchange would not have had:

- **The pre-commit preview is still a guarantee** (invariant 3). The preview shows the
  projection and an uninterrupted fight lands exactly there — pinned in
  `tests/melee.test.js` body for body, because a second implementation of "where does
  this end" is the class of bug this project keeps finding.
- **It is balance-neutral where nothing interrupts.** Same inputs, same outcome, later.
- **The AI and the harness need no new model.** Both decide by asking `resolveField`
  whether an attack wins, and that answer is still true.

**A REINFORCEMENT CHANGES WHERE A FIGHT IS GOING, NOT HOW LONG IT LASTS**, and getting
that wrong did not look like a bug — it looked like a slow campaign. The first cut
restarted the clock on every arrival, so a steady trickle of columns held a melee open
indefinitely: measured on gallowmoor, one assault ran **eighty ticks against a
sixty-tick clock** and had still resolved nothing, and the harness read the region as
`losses=0` with thirty-one timeouts *while ahead*. Nothing failed and no test could see
it — the fight was progressing, it simply never arrived. `melee.js meleeTicksLeft`
carries the remaining clock across a re-projection. Worth **+13 points on gallowmoor
and 3.3× the harness's throughput** (a five-region n=48 sweep went 41 min → 12.4).

**And a re-projection BANKS the casualties taken so far** before it throws its baseline
away. The lifetime record is fed by differencing `comp0`/`garrison0` against the
survivors, so re-baselining without paying out first loses every casualty from before
the reinforcement — silently, and only on fights that were joined.

**The staleness test is an ID SET, not a headcount.** Keyed on the opposing headcount,
every tick of an ordinary fight looks like a new arrival, because casualties change it
— so the melee re-projected every tick, reset its own clock, and neither side ever
finished dying. Instrumented, that read as a `field-battle` event every six ticks
forever.

**ON A HEX, NEITHER SIDE OWNS THE GROUND**, so `openHexMelee` deliberately does not
call `resolveField` at all: that function takes an attacker and a defender, and on a
bare tile there is no such distinction to make. It is decided by power alone, no site
multiplier and no bulwark, and the losing side's ratio is uniform, so each squad's
endpoint is its own comp scaled. A marching squad that walks onto a contested tile is
halted and joins in — that is the whole of "you cannot walk through an army", and the
negative control that two FRIENDLY columns on a hex do *not* fight is what stops the
rule being "any two squads", which would have armies killing their own reinforcements
at every rally point.

**ARCHERS ARE A SEPARATE COMP, NEVER PART OF THE STACK**, and that is load-bearing
rather than a convenience. `resolveField` returns survivors by SCALING the comp it was
handed, so archers folded into the fighting stack would take casualties as though they
were in it — which is exactly what reach buys them out of. Kept apart, they raise the
side's power and are never in the casualty pool. `reach: 1` — a tile back, per the
brief — from a squad that is CAMPED and not itself engaged, so walking the bowmen into
the line throws the reach away. `tests/melee.test.js` pins it with three negative
controls, including that **exactly one unit has `reach`**.

**YOU CAN BREAK OFF, and that half was simply refused.** Reinforcing a melee was the
easy direction; the opposite one answered `nothing-to-retreat` on an assault you could
watch losing, because a force in `site.melee` is in neither of the two places `cmdRetreat`
knew about (a siege, a garrison). It is **not** a free look at the projection —
`meleeStep` writes the survivors to `m.comp` every tick, so a commander who breaks off at
the halfway mark leaves with what is left at the halfway mark, which is the same bargain
the siege-abandon branch already strikes. No UI changed: `R` was already sending `RETREAT`
at a site.

**A FIGHT IS DRAWN WHEREVER IT HAPPENS, and both halves of that were missing.** At a
site the attacking column is off `state.squads` for six seconds and lives in
`site.melee` — so `battleView.js`, which drew only sieges, made an assault VANISH and
reappear as besiegers, hiding exactly the opening the layer exists to create. It draws
through the same `drawSiteStack` a siege does, at the same piece size, because "is this
enough to hold?" is the question both states are asking. The panel says `FIELD BATTLE`,
above the shield and the rally for the reason `UNDER SIEGE` is.

**...and on open ground it was a FIFTH FOG LEAK, of the worst shape: inaudible-visible
inverted.** A hex clash names no `siteId`, and the event drain in `screens/battle.js`
read "no site id" as "not a positional claim, let it through" — so a fight anywhere on
the map played its sound through fog while `fxFromEvent` drew nothing, having no
position to draw at. The event carries `hex` now, `fxVisible` answers it with `canSee`,
and `locateHex` places the burst. `tests/fogleaks.test.js` pins it with both controls —
a lit tile plays, and your own column fighting in the dark still reaches you.

**Contract v12, and it is the v8 lesson a FOURTH time: no CONFIG field moved.** A site
carries `melee` and so does a squad, so a v11 blob resumed here is a board mid-assault
whose fights are not happening — no melee record, nothing steps toward an outcome, and
both stacks stand there intact forever.

**RE-TAKEN ON THE FIXED ENGINE, n=48** — this is the current table; everything below
it is the provenance that produced it.

```
region        win%  win-med  all-med  target   verdict     was (buggy engine)
riverfen       90%    8.0m     8.5m    9.5m   ok          96% TOO EASY
kaldan         73%    9.7m    11.1m    8.5m   ok          77% ok
gallowmoor     17%   13.5m    17.0m    6.5m   TOO SLOW    23% TOO SLOW
thanescar       6%   12.8m    20.0m    6.5m   TOO HARD     2% TOO HARD
ravensmarch     2%   23.7m    24.0m      7m   TOO HARD     4% TOO HARD
```

**The five state fixes moved the campaign without a single dial being touched**, which
is the point: riverfen came back inside its band from TOO EASY. Two rows got harder and
two easier, so this was not a uniform buff; it is what happens when reinforcement,
retreat and training start working for both sides. Tiers 3–5 are still out of band and
the re-tune is still owed.

**ONE OF THE TWO UNWINNABLE REGIONS WAS A BUG AND THE OTHER IS REAL, and that
separation is the useful part.** Re-run with `campaignplay`'s own seeds and `playOnce`:

```
nightharrow   0/48 FAIL  →  1/24 PASS      the state bugs were the whole problem
stormhalt     0/48 FAIL  →  0/48 FAIL      genuinely unwinnable; the re-tune owns it
```

So `campaignplay` is still red, on ONE row rather than two, and that row is now known
to be a balance problem rather than a defect wearing balance's clothes. That is worth
more than either number alone: had the campaign been re-tuned before these fixes
landed, a session would have been spent moving dials to compensate for defenders
silently dropping half the orders given to them — and then spent again undoing it.

**AND STORMHALT IS TOO HARD, NOT TOO SLOW — the third correction in this area, and it
reverses the two above it.** Diagnosed on the fixed engine with the cap lifted to sixty
minutes:

```
seed  8919   LOSS    @  8m    3 sites v 49    crushed in the opening
seed 16838   LOSS    @  6m    1 site  v 53    crushed in the opening
seed 24757   timeout @ 60m   47 sites v 56    contested; the throne is never touched
```

Two of three are **outright defeats inside eight minutes**, holding one to three sites
— the opposite of the `losses=0, timeout while ahead` signature the whole "it is a
clock problem" reading was built on. The fixes cut both ways: the ENEMY's defenders can
now be reinforced too, and on the hardest board in the game that is what a tier-6
opening does with it. The castle sits at full HP and unbesieged in all three runs, so
the bot is not failing to close — it never arrives.

**So stormhalt's first lever is difficulty (`enemyMult`, `develop`, the ground, the AI
tier), NOT `targetLengthMin` and not `HARD_CAP_MIN_BY_TIER`.** Every earlier note in
this section pointing at the clock was measuring either the buggy engine or the wrong
region; this is the one taken on the shipped code, and it is where the re-tune should
start on that row.

**⚠ THE TABLES BELOW MEASURE A BUILD WITH FIVE SIMULATION BUGS IN IT.** The melee layer shipped with `site.garrison` written every
tick from a frozen baseline, so a defender could not be reinforced, a rally on a
besieged site printed troops, a retreat cloned a garrison, and bombard and finished
training were silently discarded (see "Nothing else may quietly overwrite the
defenders"). Fixing that changed how battles RESOLVE, not merely how they are scored:
a nightharrow seed that could not be won in ninety minutes on the old engine is won in
**fourteen** on the fixed one. So the tables below describe an engine that no longer
exists, and the same is true of the winnability table further down. Re-take before
trusting any of it; the numbers are kept because the SHAPE of the finding (a bot ahead
on territory running out of clock) is what the re-tune starts from.

**⚠ THE CAMPAIGN IS OUT OF BAND AND THIS IS THE MEASUREMENT, not an estimate.** Shipped
deliberately ahead of the re-tune, which is its own pass. n=48, after the clock fix:

```
region        win%  win-med  all-med  target   verdict     signature
riverfen       96%    8.9m     8.9m    9.5m   TOO EASY   losses=0  timeout(ahead=2)
kaldan         77%    9.0m     9.9m    8.5m   ok         losses=1  timeout(ahead=7)
gallowmoor     23%   14.2m    17.0m    6.5m   TOO SLOW   losses=0  timeout(ahead=31)
thanescar       2%    7.3m    20.0m    6.5m   TOO HARD   losses=4  timeout(ahead=24)
ravensmarch     4%   15.2m    24.0m      7m   TOO HARD   losses=7  timeout(ahead=16)
```

**Read the SIGNATURE, not the win rate.** `losses=0` with thirty-one timeouts while
*ahead* is not a bot being beaten, it is a bot running out of clock — the campaign has
become too long rather than too hard, and `targetLengthMin` derives `hardCapMs`, so the
promise and the cap are the same number.

**`MELEE.seconds` IS A WEAK KNOB, and that is the finding that matters for the re-tune.**
Tripling it costs almost nothing:

```
                gallowmoor        thanescar
2 seconds       29% / 17.0m       10% / 20.0m
6 seconds       23% / 17.0m        2% / 20.0m
```

Six points and eight, with the all-run median pinned at the hard cap either way. So the
overrun is **not** per-fight duration — it is fight COUNT, because interception creates
fights that did not previously exist. Do not reach for this constant first; it is
priced at ~2 points a second and it is the one number a player can actually learn. Six
is where a relief column one hex away is a real answer, which is the whole feature.

*(An earlier 2-second probe read gallowmoor 25% and looked like the duration mattered.
It was taken BEFORE the clock fix, so it was measuring the stuck-fight bug at a shorter
clock. The pair above is matched.)*

**AND TWO REGIONS ARE NOT MERELY OUT OF BAND, THEY ARE UNFINISHABLE — `campaignplay`
IS RED AND THE PAGES DEPLOY IS GATED.** `tests/campaignplay.test.js`'s floor is that
every region is won at least once in 24 seeds, escalating to 48 on an empty first
batch; its failure message is *"it is not a hard region, it is a broken one"*. Run
region by region with that test's own seeds and its own `playOnce`:

```
gallowmoor    2/24  pass      cinderwatch   1/24  pass
thanescar     1/24  pass      widowsgate    1/48  pass — on the ESCALATED batch
ravensmarch   1/24  pass      nightharrow   0/48  FAIL
gravenreach   2/24  pass      stormhalt     0/48  FAIL
```

*(Only the eight rows plausibly at risk were run; the other sixteen are untaken, at
roughly twenty minutes a region. `widowsgate` is the one that shows how thin this is —
zero in its first twenty-four seeds, one in the next twenty-four, so the escalation
branch is the only reason the suite has three failures rather than four.)*

**Every passing row is a knife-edge — one or two wins in twenty-four — and the two
failures are a CLOCK, not a defeat.** Every single seed of both ends `timeout` at
exactly the hard cap, and several end AHEAD on territory:

```
nightharrow (advertised 6.5m, cap 24.0m)     stormhalt (advertised 9m, cap 28.0m)
  timeout 24.0/24.0  sites 62 v 15             timeout 28.0/28.0  sites 47 v 35
  timeout 24.0/24.0  sites 53 v 26             timeout 28.0/28.0  sites 43 v 44
  timeout 24.0/24.0  sites 45 v 28             timeout 28.0/28.0  sites 29 v 39
```

Not one loss in either sample. So the late campaign is not too hard, it is **promising
a length it can no longer deliver**, and it is not a difficulty finding at all.

**...AND THAT DIAGNOSIS WAS ONLY HALF RIGHT, which is worth more than the table.**
With the cap lifted to NINETY minutes, nightharrow and stormhalt still won 0 of 12 —
eleven of twelve runs simply never resolved. So they were not slow, they were
**stalemates**, and "raise the cap" would have burned a session proving it. What that
was actually measuring is the five-bug engine described above: the same seeds on the
fixed build behave differently, one of them finishing in fourteen minutes. Two lessons
that outlive the numbers: **lift the cap before concluding a region is merely slow**,
and a long-running background measurement started before a fix is measuring the code
as it was when it STARTED, not as it is when it prints.

**⚠ BUT `targetLengthMin` IS NOT THE BINDING LEVER ON THESE TWO ROWS, and the obvious
reading of "the promise derives the cap" sends you at the wrong knob.** The derivation
is a MAX against a per-tier floor:

```
hardCapMs = max(HARD_CAP_MIN_BY_TIER[tier - 1], targetLengthMin * HARD_CAP_RATIO)
HARD_CAP_MIN_BY_TIER = [12, 14, 17, 20, 24, 28]      HARD_CAP_RATIO = 1.9
```

nightharrow is tier 5 at 6.5m advertised, so its cap is `max(24, 12.4)` = **24, the
floor** — and stormhalt tier 6 at 9m is `max(28, 17.1)` = **28, the floor again**.
Raising either promise changes the cap by nothing at all until it passes 12.6m and
14.7m respectively. The tier floor is what these two are actually hitting, so the
re-tune's first decision is whether tiers 5–6 get a bigger floor or a faster battle —
`targetLengthMin` alone cannot move them.

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

### A wall has a frontage, and that is what stopped a crowd being a siege train

`siegeDps` was **linear in headcount**, so the mechanism above quietly stopped working
around region 8: 33 militia out-pace a level-5 castle's repair, landing budgets reach 700
slots, and `breachSeconds` gated nothing late. `SIEGE_FRONTAGE` (40, in
`content/balance.engine.js`) is how many ordinary BODIES can be at a wall at once. Past
that many they are queueing rather than digging, and contribute nothing.

**ENGINES are exempt** (`engine: true`, and rams are the only one). That is the whole
statement of the rule, and it re-prices the unit that had become a straight loss:

```
                                          before      after
700 militia vs a level-5 castle              5s        385s
the default spread (23 rams) vs the same     4s          4s
4 militia vs a farm                        250s        250s
```

**THE FORTY AT THE WALL ARE THE BEST FORTY, and the first cut got that wrong in a way
that made reinforcing a siege HARMFUL.** It scaled the whole body force by
`FRONTAGE / bodies` — an average, not a queue — so ordinary troops *displaced* the
specialists instead of lining up behind them, and siege damage stopped being monotonic in
headcount. Against a level-5 castle:

```
                            before      after
40 sappers                  100.0 dps   100.0
40 sappers + 100 militia     45.7        100.0
40 sappers + 400 militia     30.9        100.0
40 halberds + 200 militia    28.0         48.0
```

Four hundred men arriving to help made the wall three times harder, and `breachSeconds`
could walk from a live countdown to **Infinity** as the relief column landed — at which
point `ai.js retreat()` reads that Infinity and abandons a siege *because it reinforced
it*. No reading of "queueing" makes help harmful. Filling the frontage best-first is
`O(kinds²)` selection over a fixed scratch pair, so the hot path still allocates nothing.

**It is provably inert where the campaign was measured.** A one-type stack is
byte-identical either way (every body is the same body, so which forty stand at the wall
cannot matter) — 700 militia read 24.0 dps under both — and the default spread moves
**0% below 60 slots and +1.9% to +3.0% at 200–700**, because rams are engines and carry
most of that stack's siege output. The loadouts that could actually move are sapper and
halberd builds, which have zero default weight and which the harness has never fielded.

**CONFIRMED AT n=240 on the two rows that ship closest to their tier ceiling** —
`gallowmoor 67%` and `duskfell 71%`, both `ok` against the tier-3 band and both inside
their advertised length (6.0m against 6.5m, 5.8m against 6.0m). Against the pre-best-first
n=240 pair (70 / 71) that is −3 and 0: the fix is inert on the campaign to within the
noise of the sample, exactly as the arithmetic above says it must be. Worth noting how the
smaller sample behaved, because it is the reverse of the usual warning: gallowmoor read
**64% at n=96 and 67% at n=240**, i.e. the seed prefix ran three points LOW here where
saltmere's ran five points HIGH. The prefix bias is per-region and has no sign you can
assume — which is the argument for n=240 rather than for a correction factor.

`tests/frontage.test.js` gained the assertion that could not be written as a single-stack
number: **monotonicity**. Its old "a mixed crowd is the share-weighted blend" assertion was
*encoding* the defect, and is now "a mixed crowd digs at the rate of its best bodies", with
the blend still pinned for the case that should blend — too few good bodies to fill the
frontage.

**Two more properties make it shippable, and both are negative controls.** It is a **hard
cap rather than a curve**, so below forty bodies *nothing changes* — every early-region
number and every small-force breach time is byte-identical, and the rule is provably
inert except on the late stacks that broke the mechanic. A saturating curve would have
shaved every assault in the game instead. And the scaling lands on the bodies' summed
**damage**, not on a body count, so a stack's MIX still matters: forty halberds out-dig
forty militia by exactly the ratio they always did.

**It inverted what terrain asks of you, and the old comment at `siegeDps` said so out
loud** — *"the answer to a mountain fastness is not more engines, it is more bodies"*.
That was true while a crowd was a siege train and is now exactly backwards. What answers
highland is BETTER bodies: 40 sappers work at 2.5 siege × 1.15 highland for 115 dps where
40 militia manage 24. The forty at the wall are a composition decision now, which is the
first time the specialists' `siege` column has meant anything.

**One number, not one per site kind.** A castle plainly has a longer perimeter than a
farm — but a farm dies to a fraction of a frontage anyway, so a per-kind table would only
change the answer where it is already a formality, at the cost of a second balance
surface nobody could tune independently of `SITES`.

`tests/frontage.test.js` pins all of it, three of its six tests as negative controls —
including that **exactly one unit is an engine**, because `engine` is a one-word opt-out
of the only thing limiting siege damage in the game and a second unit acquiring it by
accident would silently restore the defect with nothing else looking wrong.

**AND IT BROKE THE HARNESS IN A WAY THAT LOOKED LIKE A BALANCE WIN.** `simtactics.js
bestAssaultTarget` walks away from any siege it cannot finish in 90 seconds — right for
an ordinary wall, and a rule that had **never once bound at a castle** in this project's
history, because a crowd broke any throne in about five. The frontage put widowsgate's
throne at 128s for a body army, and the bot answered by never assaulting it: it timed out
**thirty-five sites ahead**, with the region won everywhere except the gate, and
mono-militia's win rate there read 94% → 25%. That is the harness declining to play, and
taken at face value it says the frontage fixed the dominant loadout. It does not:
`siegeBudget` asks the castle the question a player actually asks — *does the siege
finish before the BATTLE does* — and mono went straight back to 92%.

Three things about that fix are load-bearing. It is **the clock, not the kind**, so the
bot still refuses a two-minute siege with nine seconds left, and an ordinary wall is
still held to the flat ninety. The **territory gate is still checked first**, or the bot
would camp an unopenable throne and starve every other front. And it was **unreachable
code before the frontage**, which is what made it safe to add mid-campaign — no measured
number was ever taken with this branch live, so it cannot have re-tuned anything. Same
house pattern as the other escape hatches: `--nothrone` reverts it, `tests/throne.test.js`
pins both directions, and the negative control is the half that matters.

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
`battleLabels.js` is every string the board draws — split off at the cap along the seam
that matters, because the ONE `ctx.font` assignment per frame is a rule rather than a
tidiness, and it took the zoom-keyed font cache with it (a cache whose only consumer
lives in another file is a second writer waiting to happen).

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

**⚠ AND THAT NUMBER IS AN AVERAGE OVER AN S-CURVE, WHICH IS WORSE THAN NOISE — IT IS
LOCALLY WRONG BY MORE THAN 4×, AND USING IT TO SIZE A MOVE IS WHY TWO SESSIONS HAVE
THRASHED.** Measured on ONE row over a deliberately wide range, n=48 a point, each
point run twice from identical seeds with byte-identical results:

```
thanescar   dial    win%     local slope over the segment below it
            4.60     65%
                              0.00 pts/0.01     <- the SHOULDER
            4.90     65%
                              0.83 pts/0.01     <- the cliff
            5.20     40%
                              0.21 pts/0.01     <- the tail
            6.80      6%
```

The response is a sigmoid, not a line: a flat shoulder at the top, a cliff, then a
long flattening tail. `enemyMult` moved **+0.30 and thanescar did not move at all**,
and then the next +0.30 was worth twenty-five points. Both of those are the same
region, the same sample size, and the same afternoon.

**THREE CONSEQUENCES, and the third is the one that costs sessions.**

1. **A campaign-wide slope constant cannot size a per-row move.** The regions in a
   sweep sit at different points on their own curves, so averaging them produces a
   number that is right for nobody. This is the mechanism behind the already-recorded
   "six rows moved the WRONG way, implied slopes +4.25 to −2.00" — that was not only
   noise, it was six rows on six different parts of six different curves.
2. **A row on its shoulder cannot be tuned by a small step, at any sample size.** No
   n rescues a measurement of a derivative that is zero. Confirming a flat reading by
   re-running it just buys the same flat reading.
3. **So the method is BISECTION, not slope-scaling.** Bracket the row wide enough to
   contain a real change (on thanescar that was ±0.6, not ±0.05), measure the
   midpoint, halve. Four or five points at n=48 per row, and every one of them is a
   measurement rather than an extrapolation. The standing "move it in steps of ≤0.05
   late and re-measure" advice further down is what a shoulder makes useless: five
   consecutive nudges inside a plateau read as five noisy zeroes and cost the same as
   one honest bracket.

**And the plateau HEIGHT is a fact about the region, not about the dial.** 65% is
where thanescar stops improving however cheap the enemy gets, so whatever is capping
it is not enemy strength — read the outcome signature before reaching for the dial at
all.

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

**⚠ AND n=24 IS TOO NOISY TO TUNE ON EITHER — DEMONSTRATED, NOT ARGUED.** A full
24-region sweep was taken, nineteen dials were moved, and the campaign was re-swept at the
same n. Six rows moved the WRONG WAY, and the slope each row implied ranged from **+4.25
to −2.00 points per 0.01**:

```
region        dial+   before  after   implied slope
riverfen      +0.04     96      79        4.25
kaldan        +0.04     88      96       -2.00
greywater     +0.05     75      83       -1.60
thornmoor     +0.11     92      79        1.18
obsidian      +0.18     71      79       -0.44
gravenreach   +0.28     67      50        0.61
```

That is not a slope, it is noise: at n=24 the standard error on a win rate near 50% is
**about 10 points**, so a +0.05 move predicting −5 is invisible and even a +0.28 move is
under 3 SEM. Confirmed directly on the next measurement — thanescar re-taken at n=48 on an
UNCHANGED dial read 65% against the 58% the n=24 sweep had just reported for it.

**So a per-row dial correction sized off an n=24 sweep is a random walk**, and two sessions
of this re-tune have now spent themselves on one. What n=24 CAN carry is a claim about the
whole table — nineteen of twenty-four rows landing on the same side of their bands is far
beyond what noise produces, and that is what justified the direction of the pass above. It
cannot carry the size of any individual move.

**`n=12` (the CLI default) is far too noisy to tune on, and has hidden real mis-tunes three
separate times.** Kaldan's long-standing "58% ok" was an n=12 artefact; one build measured
52% at n=120 and 57% at n=240; `ironcrown` read 54% at n=48 and 57% at n=240. Tune at
**n≥96**, confirm anything within ~8 points of a band edge at **n=240**, and use
`--all` at low n only as a smoke check. Some medians sit on a cliff — kaldan pegs the hard
cap in ~40% of runs — so a median can jump discontinuously between sample sizes.

**AND A SMALLER SAMPLE IS A SEED PREFIX, NOT AN UNBIASED DRAW.** `--n` walks seeds
`0..n-1`, so n=96 is the *first* 96 of n=240's runs rather than a random subset of them —
which means a region whose early seeds happen to be kind reads high at every small n, and
reads high *reproducibly*. Saltmere did exactly that three times running: 82 / 88 / 88 at
n=96 against 77 / 80 / 76 at n=240 on the same three tables. Re-running at n=96 is not a
second opinion, it is the same opinion. This is the mechanism behind every "n=96 and
n=240 disagreed by 5–13 points" note in this file, and it is why the rule is a bigger
sample rather than more samples.

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

**`siteCounts.neutral` IS BOUNDED, and the column it is bounded by is not its own.**
Every note in this project — including the tier-2 header in `regions.data.js` — says
neutral is "the one site column with no non-decreasing constraint", and that is true of
the column and false of the table: `tests/campaign.test.js` requires TOTAL sites to be
non-decreasing, and neutral is a term in that total. So a region's neutral pool can never
exceed `nextRegion.total − thisRegion.(enemy + player)`. Thanescar's is capped at 15 by
blackspire, which is exactly what it already shipped — the lever looked free and was
fully spent. Cost a measurement to learn; `develop` (2.20 → 2.45, the whole gap to
blackspire) is what carried the correction instead.

## Both sides shuttle tiny columns, and the board is weather

**Measured over real battles** (`startRun`/`playerTurn`/`step`, seed 1000, the shipped
bot playing):

```
            minutes   enemy columns   per minute   median size   field battles
riverfen      13.6              78          5.7             2              73
gallowmoor    20.0           2,114        105.7             2           1,150
```

From region 1 to region 10 the enemy's column count rises **27x while the median column
stays at two troops**. It is not making bigger decisions as difficulty rises; it is
making vastly more, equally tiny ones. **1,150 field battles in a twenty-minute battle
is about one per second**, and `MELEE.seconds` is 6, so roughly six fights are open at
any instant, permanently.

**This is the configuration rather than a defect.** Tier 3 runs `reactionTicks 26,
concurrent 2` against `AI.maxSources 3` and `AI.freeLunchHexes 3`, so 462 thinks x up to
9 squads is a ceiling of **4,154** columns — the measured 2,114 is the AI running at
about half its own permitted throughput, continuously. Most of it is the free-lunch
phase, which spends no concurrency slot on purpose.

**And it is not one-sided:** the section below records the harness bot with 1,092 bodies
of which 239 are standing, 78% permanently in transit. So this is a systemic property of
free movement plus cheap sends plus an unslotted free-lunch phase, and it is a plausible
upstream cause of the tier 3-6 tuning trouble — a permanent grinder is hard to tune
because nothing that happens in it is decisive.

**What is already fine is the WORDS.** The alert strip names real threats correctly and
promptly (`ATTACKED — farm will fall` at 37.6s, `UNDER SIEGE — farm` at 43.7s, measured
on a fresh riverfen). What no surface distinguishes is on the BOARD: an incoming
two-troop free-lunch grab and an incoming assault are drawn identically.

## The harness bot CAN concentrate force now, and it changes nothing — the force is not there

**Read this instead of the section below it, which is the hypothesis this one tested.**
`tools/simpool.js` teaches the bot to pool several sources into one synchronized strike,
the way `aicore.js adjacentSources` already does for the enemy. It works — the
real-battle test groups commands by target and arrival tick and demands a wave drawn
from two or more distinct sites — and it moves nothing:

```
n=48        pooled    --pool off
gallowmoor    25%        33%
thanescar     27%        23%
```

Opposite signs, both inside the noise band. **It ships OFF (`--pool` opts in), inverting
the `--noX` house pattern deliberately**: `upgradeTurn`, `constructTurn`, `scoutTurn` and
the throne budget each shipped on because each was measured as an improvement in the pass
that added it, and this one is a wash. Every number in this file was taken without it, so
turning it on would make the whole table incomparable to fix nothing. Proven inert where
it is off — gallowmoor n=8 is identical with the change present and with a clean worktree
at the parent commit.

**AND THEN THE MECHANISM WAS MEASURED, WHICH IS WORTH MORE THAN THE WIN RATES.**
Instrumented on thanescar seed 1000 — the seed the original diagnosis was traced on —
over a full 30-minute battle, 912 thinks:

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

Not reach, not scan order, not `POOL_MAX_SOURCES`, not the send fraction. **The force
never exists.** At its single best moment the bot holds seven sites within reach of the
throne with forty-one bodies between them, against a castle that trains against zero
attrition because nothing ever attacks it.

**AND IT IS NOT PRODUCTION EITHER — 78% OF THE BOT'S ARMY IS PERMANENTLY IN THE AIR.**
That was the next hypothesis and the same probe killed it. Same battle, sampled every
five minutes:

```
min   sites   garrisoned   MARCHING   near throne   castle   biggest stack   gold unspent
  5      19          63        299      1 site/13      125              13         12,610
 10      34          93        452      5 sites/32      24              22         52,680
 15      54         239        853     18 sites/170    124             129        118,303
```

At fifteen minutes the bot commands **1,092 bodies** and only 239 of them are standing
anywhere. It is not short of troops and it is not short of ground — it holds 54 sites —
it is short of troops that have **arrived**. Every think sends a share of every garrison
somewhere, so the army shuttles instead of accumulating, and the 170 bodies that are
actually near the throne make 1.37x against a 124-body castle: still under
`ATTACK_MARGIN` 1.5, while eight hundred of their fellows are walking.

**And it is sitting on 118,303 unspent gold at minute fifteen** — the same signature this
file already records once for `PRIORITY` (*"thirteen farms and two training sites with
17,000 unspent gold against a 15 gold/s training bill"*), an order of magnitude worse. A
bot that cannot convert a six-figure treasury into bodies is not being out-produced.

**AND THE CONVERSION HALF IS MEASURED, AND IT IS THE `PRIORITY` FAILURE AGAIN.** Same
battle, same samples — what the bot actually holds:

```
min   sites   farms   yards   walls   sites that TRAIN   train bill   gold unspent
  5      19      13       3       1                  4      5.1/s         12,610
 10      34      28       3       1                  4      5.1/s         52,680
 15      54      41       8       3                  9     11.7/s        118,303
```

**Seventy-six percent farms, nine places in the world to turn gold into a body, and
118,303 gold in hand against an 11.7/s training bill — 2.8 HOURS of training banked,
in a battle with fifteen minutes left on its cap.** This is verbatim the shape this file
already records for `PRIORITY` (*"thirteen farms and two training sites with 17,000
unspent gold"*) at an order of magnitude more money, so flipping `PRIORITY` fixed the
symptom on the small maps and not the behaviour on the big ones. `constructTurn`'s own
kind rule — *a yard while it holds fewer than three, a farm after that* — is the other
half: the bot BUILDS farms past its third yard while sitting on six figures.

**So the tier 3-6 question is CHURN AND CONVERSION, not massing and not production**, and
the conversion half already has two named, already-open, one-file fixes with
`--noconstruct` and `PRIORITY` in place to keep the delta measurable. The churn half is
the one still unmeasured: what share of sends re-task troops that were already heading
somewhere useful, with `advanceDistance`'s gradient re-pointing every two seconds as the
obvious suspect.

It is a ratio and a census rather than a win rate, so n=1 is far more informative here
than it would be for a percentage — but re-take it on ravensmarch and widowsgate before
generalising past the Marshal'd rows.

**What the whole exercise cost and bought:** one measurement, which is exactly what the
ROADMAP entry proposing it priced it at. It disproved its own hypothesis and replaced it
with a narrower one. That is the shape a speculative diagnosis should have.

### ...and fixing the conversion half is worth more than any dial in the table

`--richyards` (`tools/simbuild.js cannotSpendIt`) adds `constructTurn`'s fourth rule:
past `WANT_YARDS`, build a YARD anyway when the treasury is more than `RICH_SEC` (120)
seconds of the empire's own training bill. Measured, n=8, matched seeds, nothing else
changed:

```
region        --richyards off        on          delta
gallowmoor    38%  24.6m win-med    100%  22.5m   +62
thanescar     25%  18.3m win-med     63%  12.5m   +38
```

**This is the largest harness improvement since `PRIORITY`** (0% → 75% on gallowmoor),
and it is the same defect one layer up: the bot could always build yards, it simply
chose farms while holding 2.8 hours of training money. The all-run medians move as much
as the win rates — gallowmoor 38.0m → 22.5m, thanescar 30.4m → 20.3m — so this is not a
bot squeaking over the line, it is a bot that stops running out of clock.

**Confidence, stated honestly.** n=8 is a small sample and the usual warning applies —
but gallowmoor's baseline read **38%, exactly the n=24 figure** recorded in the re-tune
screen below, which is the strongest cross-check available at this sample size. A 62-point
gap does not come out of an n=8 noise band.

**IT SHIPS OFF, and the reason is not doubt about the effect — it is that the effect is
too big to land mid-search.** Gallowmoor at 100% is twenty-eight points ABOVE its tier
ceiling, so turning this on does not improve the table, it invalidates it in the other
direction and demands the whole re-tune be re-based. Every number in `regions.data.js`
was measured without it.

**So the recommendation to the re-tune is explicit: re-base with `--richyards` ON before
spending another dial.** The campaign is currently being tuned against a bot with a
known, one-line, measured conversion defect, and eleven of the fifteen tier 3-6 rows are
below their floor. Two of those rows are worth +38 and +62 from this alone — which is
larger than every dial move that pass has made put together. Tuning `enemyMult` to
compensate for a bot that cannot spend its own money is exactly the work this file warns
about at "a session would have been spent moving dials to compensate for defenders
silently dropping half the orders given to them — and then spent again undoing it".

`tests/richyards.test.js` pins the rule and its negative controls, including that the
flag changes nothing for a bot whose economy is working. Worth knowing if you extend it:
`trainType: null` does NOT silence a site's training bill (`trainableUnit` falls back to
a buildable type), so the only faction with a zero bill is one holding nothing that
trains at all.

## The harness bot cannot concentrate force, and it is the only actor that cannot

**⚠ SUPERSEDED — this is the hypothesis, and the section above is the measurement that
disproved it. The reasoning below is sound and the conclusion is wrong; it is kept
because the reasoning is what generalises.**

**Read this before trusting any tier 4–6 number.** `tools/simplayer.js:138` loops
`for (const src of mine)` and hands each source to `simtactics.js bestAssaultTarget(view,
src, send)` **on its own**. Every assault the bot makes therefore comes from ONE garrison,
judged against `ATTACK_MARGIN` 1.5. Meanwhile the enemy AI pools up to `AI.maxSources` (3)
sites per assault (`aicore.js adjacentSources`), and the PLAYER now pools the whole
selection (see "Concentrating force" above). **The measuring instrument is the only actor
on the board that cannot mass** — against a Marshal'd castle, which is the one target that
punishes not massing, because it is never attacked and so trains against zero attrition.

Measured with a direct probe on the real `buildBattleConfig`/`startBattle` pipeline:
thanescar's castle garrison runs **96–241** over twenty minutes while the biggest site the
player holds beside it never exceeds **11–30**. No single garrison can ever clear 1.5×, so
no siege is ever opened — which is exactly the signature reported at 87% territory with the
castle at full HP, unbesieged, under a seventy-minute cap.

**THIS IS THE THIRD INSTANCE OF A CLASS RECORDED TWICE ALREADY** — the 90-second siege
budget that made mono-militia read 94% → 25%, and the `PRIORITY`/`advanceDistance` collapse
worth 0% → 75% on gallowmoor. All three share one tell: **no AI knob moves the region at
all**. The re-tune reports exactly that — further `enemyMult` cuts moved gallowmoor and
thanescar the WRONG direction, twice.

So the next move on tiers 3–6 is a HARNESS change, not a dial: let an assault draw from
several adjacent sources the way the AI's does, behind `--nopool` so the delta stays
re-measurable (the house pattern `--noupgrades`/`--noconstruct`/`--noscout` already
follow), then re-take one stuck row. **A mechanic the harness cannot play is a mechanic
nobody has measured** — the lesson `upgradeTurn`, `constructTurn` and `scoutTurn` each
taught once, arriving now for concentration.

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

It is now a flat **3–5 sites everywhere** — a beachhead, not a province — with the freed
sites turned **neutral** rather than deleted. `tests/campaign.test.js` pins the ceiling
*and* the creep.

**This paragraph said "a flat 3–4" for a long time and the table said otherwise**:
`nightharrow`, `stormhalt`, `cinderwatch` and `widowsgate` all ship **5**, bought
deliberately by the tier-5 pass ("a player starting site is worth ~13 points at tier 5,
and it is the only lever that lowers the opening force ratio"). Nothing failed, because
`campaign.test.js` enforces non-decreasing totals and a max-share ratio rather than a
3–4 ceiling. The *premise* is intact — 5 of 55 sites on widowsgate is still a beachhead,
where the old regime had the player holding 23 of 48 on nightharrow — but if you are
reaching for this column, the honest range is 3–5 and the constraint that actually binds
is the share, not the count.

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

**THE VEIL FOLLOWS A COLUMN NOW, AND CLOSES BEHIND IT.** The sim rule was always
right — `canSee` grants any squad, marching or camped, its own hex and the ring around
it — but the veil is painted on the BACKGROUND canvas, and nothing marked that dirty
when an army moved. So `computeVeil` folded squad sight in perfectly and then sat
frozen at whatever the last capture or construction happened to leave: fog neither
opened ahead of a march nor closed behind it.

`battleViewSig.js squadSightSig` folds the viewing faction's own squad POSITIONS into
the repaint signature, and the whole feature turns on one fact: **a column crosses a
HEX, not a TICK.** A leg is 0.7–2.5 seconds (see the march table under "Tuning"), so
this changes a couple of times a second per marching column rather than ten, and
`markBgDirty` is already throttled to 8/s on top. Hashing `state.tick` instead is the
regression `bgcache.js` measured at 60fps → 31.

**A CAMPED FORCE COSTS NOTHING AND KEEPS ITS RING**, and that is the same rule rather
than a second one: its hex does not change, so it forces no repaints, and `canSee` goes
on answering true around it. Fog closes behind troops moving through and stays open
around troops standing still, with neither as a special case.

Measured rather than assumed, because this is exactly the shape of change that cost
this project 60fps once: **60.1 fps with 56 columns marching on widowsgate** (336 hexes,
the board the fog table above was taken on, which recorded 59.2 before). And the
background bitmap genuinely changes — sampled during a march, 5 distinct frames in 8,
with total brightness rising and falling again as the column opens ground ahead and the
smoke closes in behind.

`squadHexOf` and `core/hex.js round` grew an optional `out` parameter for this — the
same scratch idiom `sitePos`/`worldToScreen`/`hexPos` already use — so asking where
every column is once a frame allocates nothing. Every existing caller passes nothing
and is untouched.

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

**NOTHING IS COMMON KNOWLEDGE — and unclaimed ground was the last exemption to go.**
`recomputeVision` used to record a site whose owner is `neutral` into BOTH factions'
`seen`, on the reasoning that a farm nobody holds is not intelligence: no garrison is
hiding it, and the opening race for it is the whole shape of the first two minutes. That
exemption is gone. "There is a building over there" is the fact being hidden, and who
happens to hold it does not make it less of a disclosure — a neutral farm is a place
worth marching to, which is exactly what made knowing about it for free worth something.
A site enters `seen` by being LOOKED AT, and that is now the entire rule.

**It cost the tutorial's first line, which is the thing to re-check if the opening ever
reads as a blank screen.** `COACH.drag` used to say *"Drag from your camp to the grey
farm"*, and with neutrals hidden the campaign opener puts the player's board at their own
three sites of eleven — an instruction pointing at nothing. The line now teaches the
GROUND rather than a building (*"Drag from your camp across the map. Your troops march
the road you draw."*), which needs nothing on the board to point at and is the better
lesson anyway, because a march can end on any tile.

**It is provably balance-neutral rather than merely within noise, twice over.** By
construction: `beliefFor` does not ask `siteKnown`, so the enemy commander and the harness
bot keep a ghost for every site regardless, and nothing branches on a ghost owned by
`null` versus one owned by `neutral` — both are "not the foe". And by measurement:
eighteen matched runs across riverfen, gallowmoor and widowsgate are **byte-identical**
with the clause and without it, status, tick count, site counts and top level.

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

## The Frontier: one enormous map, and no end but the one you choose

`content/endless.data.js` + `battle/frontier.js` (the board) + `meta/endless.js` (the run
and what it pays). A 40x32 board — **1,280 hexes against a campaign board's 336** — with
a camp in one corner, and country that gets harder the further out you walk.

**IT IS A `mapGen` SWAP AND NOTHING ELSE, and that is what made it affordable.**
`buildBattleConfig` already takes the generator as an argument, so `screens/battle.js` and
`tools/simplayer.js` each choose one on the region id and every rule below that line is
the campaign's own. `mapgen.js` grew exactly one line — `spec.plan ?? planSites(spec)` —
because `planSites` is shaped entirely around a throne (camp at one edge, walls ringing
the castle at the other) which is right for a raid and wrong for a frontier. Everything
after the plan is shared: terrain, rivers, massifs, `repairConnectivity`, the shape mask,
`verifyReachable`. **No CONTRACT field moved and CONTRACT_VERSION stays at 12.** No
shipped region carries a `plan`, so the hook is provably inert for the campaign.

**IT RESOLVES THROUGH `REGION_BY_ID` AND IS ABSENT FROM `REGIONS`**, and that separation
is the whole of how it stays outside every measured number. `REGIONS` is what the world
map draws, what `tests/campaign.test.js` walks for its non-decreasing invariants, what
`regionsConquered` counts and what `npm run sim --all` sweeps. The frontier is in none of
them. **The one thing that broke on it is the lesson**: `tests/idle.test.js` walked
`Object.keys(REGION_BY_ID)` as a stand-in for the campaign, which is no longer what that
map is — a fresh save has no `meta.regions.frontier` record at all, so the test threw. If
you mean the campaign, the list is `REGION_IDS`.

### Difficulty is a distance, not a dial

`ringOf(hex)` is axial distance from the player's own corner divided by
`FRONTIER.ringHexes`, and `scaleFrontier` compounds garrison by ring and steps level every
`ringsPerLevel`. Measured on seed 1000, median garrison by ring:

```
ring      0    1    2    3    4    5    6    7     8
sites     2    5   11   16   21   16   17   10     6
median    5    7   17   24   26   51   74  108   156
```

Garrison and level are kept on **separate** curves for the reason the campaign keeps
`enemyMult` and `develop` apart: bodies are produced during the battle and walls are not,
so scaling both together makes the deep rings unapproachable rather than expensive. The
player's own sites and ring 0 are never scaled, so a run opens at roughly tier-1
difficulty however deep the map goes.

**SPACING x `maxRing` MUST LAND ON THE DIAGONAL, and getting it wrong flattens rather than
fails.** On the 60x48 board this was first sized against, the far corner is 83 hexes out;
at 6 hexes a ring the clamp bit at 54 and the whole outer THIRD was one flat ring —
measured, 34 of 104 sites in ring 9, and the bot "reached the deepest ring" two-thirds of
the way out. The shipped board's diagonal is 55 (offset `(39,31)` is axial `{q:24, r:31}`)
against `6 x 9 = 54`, so the clamp bites at the far corner itself. `maxRing` is therefore
**inert on the shipped board and that is what a safety clamp should be** — ring 9 is one
corner hex and no site is ever placed there.

### The throne is gated behind the whole map, and the measurement is why

**It shipped at `castleGateFrac: 0` and the comment beside it was confidently wrong.** It
claimed the castle "sits at ring 9 behind the whole map, which is a far steeper
precondition than any territory fraction". Measured on the real pipeline: the throne lands
at **ring 7** of a board whose deepest occupied ring is 8, and a player with the whole
campaign behind them took it in **9,658 and 11,357 ticks — two runs of three WON the
endless mode in about sixteen minutes**, ending the exploration two thirds of the way
through its own clock. An infinite map that ends is not one.

At **0.85** every run goes the full thirty minutes, reaching ring 7-8 with 57-77% of the
country held — so the throne is reachable and is never routine.

**THIS IS THE DELIBERATE INVERSION OF THE CAMPAIGN'S OWN GATE FINDING.** `GATE_CLAMP` caps
every region at 0.60 because a high gate made the throne a formality and the battle a
scrape for the last few percent of countryside — a defect when a region PROMISES a fight
at a castle. The frontier promises the opposite, so a throne that can be rushed is the
thing that breaks it. `tests/frontier.test.js` pins the gate as a FLOOR (what matters is
that it requires owning the frontier, not that it is exactly 0.85) with a negative control
that no campaign region exceeds 0.60.

### What a run pays, and the exploit that was closed

Crowns are summed over the sites held AT THE END, weighted by the ring each sits in, so
the deep country is worth pushing for and the doorstep cannot be farmed. Relics are paid
**only for beating your own record**, which makes the hard currency non-farmable by
construction rather than by a cooldown. **Losing your camp pays nothing at all** — the
mode is push-your-luck or it is nothing.

**A SITE YOU BUILT DOES NOT COUNT TOWARD THE RECORD.** Measured on the first cut: the bot
reached the outermost ring by minute ten not by fighting but by laying a chain of
200-gold farms toward the throne, because `simbuild.js` scores a build hex by its distance
to the castle. `deepestRing` excludes anything whose id starts `b` (`nextBuildId`'s
prefix); `heldRings` — which the payout uses — counts everything, because holding forward
ground is worth something, it is simply not what "how far did you get" means.

A new map every run, keyed on the run COUNT rather than a stored seed, so nothing about
the board is persisted and a reload mid-run regenerates the identical country. The run
counter advances on a LOSS too — retrying the identical country is the one thing a
push-your-luck mode must not offer.

### The harness plays it, and its first readout was wrong in the informative direction

`tools/simfrontier.js`, `node tools/simrunner.js --frontier --conquered=4,8,16,24`. A
frontier run has no win rate on purpose: there is no throne to take, so every run ends on
the clock and a win% would read 0% forever while saying nothing.

**The first column it reported was `deepest ring`, and it was measuring a scouting
column.** A max over a BOUNDED board is set by one farm grabbed at the edge — it read
**8.0 for every empire size** and printed "the gradient DOES NOT HOLD" while `sites held`
was climbing 79 -> 90 -> 87 -> 112 on the same runs. The column is the **median ring over
sites HELD** now, which is what the payout weights by and what cannot be set by one lucky
column:

```
regions   n   deepest ring   core   sites held   minutes
      4   4    2..8 of 9      5.0           79      30.0m
      8   4    7..8 of 9      6.0           90      30.0m
     16   4    7..8 of 9      5.0           87      30.0m
     24   4    7..8 of 9      6.0          112      30.0m
```

`playOne` grew an optional `opts.observe(battle)` for this rather than a wider return —
depth is a fact about a finished frontier and means nothing on a campaign map, so the
column is read at the call site instead of every region growing one. Absent, nothing is
called and it is the same function every measured number was taken with.

**THE BOARD SIZE IS AN FPS NUMBER, NOT A DESIGN ONE.** Measured on the real renderer:
60x48 = 2,880 hexes ran **34.5 fps** (21.5 at 4x speed), 44x34 = 42.7, **40x32 = 53.2 and
44.0 at 4x — shipped** — 36x28 = 55. A bigger frontier is available the moment the
renderer clips its background repaint to the viewport; see the note at `bgcache.js DUTY`.

### ...and it made the background repaint gate a duty cycle

`GATE_MS` 125 was a claim about how much a repaint COSTS, and that is a property of the
board. Measured: one repaint costs **54ms on a campaign board and 168ms on a frontier**,
so 8/s asked for 1,344ms of work per second — **60.1 fps with the sim PAUSED against
28-43 fps running**, which is the tell that the per-frame layer is entirely fine at that
size and the background one is not.

The gate is `max(GATE_MS, lastCost * DUTY)` now, `DUTY` 2.3. That constant is chosen so
`54 * 2.3` is 124ms, just under the floor — **every campaign board is byte-identical** and
only a board expensive enough to saturate the gate is slowed. `bgCache.spent(ms)` is
separate from `painted()` because that one has to run BEFORE any pixel is drawn (it clears
the CSS slide transform) and this one can only be known after.

**It is a self-limiting mitigation and not the real fix.** `computeOwners`, `computeVeil`,
the flood, the plates, the rock and the grid lines all walk the WHOLE board regardless of
what the camera can see, which on a map you are meant to explore zoomed in is mostly
wasted. That is a six-function change to the renderer's hot path and wants its own pass.

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

**⚠ THE LADDER HAS REGRESSED AND ITS OWN TABLE IS STALE — MEASURED, AND THE CAUSE IS
THE CAMPAIGN RE-TUNE LEAKING INTO THE ARENA.** `--incursion=1,2,3,4,5 --n=16`:

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

Depth 1 is a 38% fight where the table above says 96%. **A rung overrides `enemyMult`
(the plan) and `develop` (only when a mutator asks) and inherits EVERYTHING ELSE from
widowsgate's own campaign row** — `siteCounts`, the 21x16 board, `castleGateFrac`, and
`targetLengthMin`, which derives the hard cap. The mid-flight re-tune moved several of
those; widowsgate now reads `develop` 2.32 and `targetLengthMin` 18 against the tier-6
figures the ladder was last calibrated against.

This is the accident recorded two paragraphs above happening a SECOND time, and nothing
noticed because no test walks the ladder. Do not re-author `baseDial` until the campaign
is back in band — the arena is a campaign region and its row is mid-search, so a dial
authored now is authored against a moving target. When it is re-based, the design
question worth asking is whether a rung should inherit its arena's row at all: a ladder
whose difficulty silently tracks a campaign region it is not otherwise part of is the
same class of coupling as the `REGION_BY_ID` trap.

**AND THE FIRST RUNGS ARE NOT "DIAL-ONLY RERUNS OF ONE MAP", which was the standing
proposal to pull `mutatorsAt` forward.** The DEPTH is part of the map seed
(`meta/modifiers.js`), so consecutive rungs are different boards at different dials —
and at 38% and 31% they are not formalities anybody needs a mutator to make interesting.
Struck rather than done; see ROADMAP.

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

## Auto-resolving a raid, and what it cost to prove

A previous pass built the whole seam and stopped short of the one thing that mattered:
nothing had ever driven a raid through it end to end. `meta/autobattle.js`
(`canAutoResolve`/`startAutoResolve`, pure) + `tools/autoresolve.js` (the bridge, kept
outside `src/` for the reason every meta↔battle bridge is) + `worldmap-autobattle.js`
(`runAutoResolve`, frame-chunked) + `worldmap-detail.js` (`raidExtras`, the one place the
button is offered). `tests/autobattle.test.js` is new; the four claims below are what it
pins, in the order they matter.

**IT IS NOT A SECOND SIMULATION, IT IS THE HARNESS BOT LOOSE ON THE REAL EMPIRE.**
`tools/autoresolve.js` imports `playerTurn` from `tools/simplayer.js` **directly** — the
exact function every win rate in `regions.data.js` is measured with — and drives it over
a config built by the real `meta/modifiers.js buildBattleConfig`, off the player's real
seed, real upgrades, real unlocked units. `grep -rn "tools/autoresolve" src/` finds one
real import, in `meta/autobattle.js`, and nothing else under `src/` touches
`tools/autoresolve.js` at all — that is the whole seam, and it is why an auto-resolved
raid's win rate is the campaign's own number by construction rather than a second figure
that could quietly drift from it. **This means loading the harness's policy into the
shipped game was deliberate, not a shortcut, and the sentence above is how to find the
seam again if anyone asks whether it still holds.**

**RAIDS ONLY, enforced in the pure layer, twice over.** `canAutoResolve` refuses a truthy
`opts.incursion` outright, and refuses anything `canRaid` would (which already excludes
an unconquered region — a first conquest can never be a raid, so it can never reach this
gate at all). Belt and suspenders: `startAutoResolve` has no `opts` parameter and
`buildRaidConfig` never sets `options.incursion`, so even a caller that got the gate
wrong could not make this seam build an incursion config — `config.rules.incursion` came
back `null` on every resolve, asserted directly rather than trusted. **The incursion
guard is currently unreached by any real caller** — no screen offers auto-resolve on a
rung today — and that is worth saying plainly so a future reader does not assume
something exercises it; it exists for the caller `buildBattleConfig`'s own header already
warns about, the one that carries a rung's depth through the wrong door.

**DETERMINISM, PINNED AS EQUALITY, NOT ASSUMED FROM INVARIANT 3.** Two independent
fixtures built from the same meta state resolve to byte-identical configs and outcomes.
More to the point: `startAutoResolve` resolving a raid and a hand-rolled loop calling
`playerTurn`/`step` directly against the *same* `buildRaidConfig` output reach the
identical `BattleOutcome` — proving "auto-resolve IS playing it out" as equality, not as
the comment that claims it.

**ONE PAYOUT PATH, checked both ways.** Neither `tools/autoresolve.js` nor
`meta/autobattle.js` contains a call to `applyOutcome(` or a direct write to
`meta.crowns`/`grantRelics`/`completeRaid`/`markConquered` — asserted against the actual
source text, not the comment above it that says so. And behaviourally: resolving a raid
to completion leaves `meta` untouched until the caller calls `applyOutcome` itself, at
which point the payout matches what the results screen shows to the crown.

**LOSING IS HONEST, and it is fast.** A riverfen raided twenty times already (`clears:
20`) has had `effectiveEnemyMult` compound 15%/clear past what a fresh landing force can
hold, and resolves to a clean `loss` in well under a second — `Defeat`, no Crowns row, no
relics, `stats.losses` up by one, the region's cooldown untouched (same as a lost battle
played by hand: trying again costs nothing). Driven for real in a browser: title
`Defeat`, body *"Nothing was lost but time."*, sites held 1/11.

**A GOTCHA THIS PASS TRIPPED ON ITSELF, worth recording so the next live-browser check
does not repeat it: `meta.crowns` (and `stats.crownsEarned`) is not frozen by anything.**
The idle ticker (`meta/idle.js accrue`, driven by the main loop's own wall clock) keeps
crediting both on real elapsed time regardless of what any battle does — that is correct,
ordinary idle-game behaviour, and it is *not* a second payout path, but a raw
before/after crowns comparison across a live resolve will drift by a fraction of a crown
per second even when the raid itself paid exactly zero. The byte-exact version of "a
loss/a cancel pays nothing" has to be pinned in a clockless test (no real loop running);
a live-browser check of the same claim needs a tolerance sized well under a real payout
(±5 crowns against payouts in the hundreds to thousands, here) rather than exact equality.

**CANCELLING MUTATES NOTHING, proven with a snapshot, not read off the comment that
claims it.** `runAutoResolve` takes its `raf`/`clock` injected, so a test can pump it by
hand: several batches run, `meta` is untouched throughout (only the resolver's own
throwaway battle object advances), and cancelling before completion leaves `meta`
byte-identical to a snapshot taken before the resolve ever started. Confirmed live too —
cancel mid-flight lands back on the ordinary raid panel with `battles`/`wins`/`losses`/
`relics`/the region record all exactly unchanged.

**MUST NOT BLOCK THE PAGE — measured, not asserted from the frame-budget comment.** Pure
compute, one blocking call, no chunking (the worst case the chunker exists to avoid):

```
region (regions conquered first)   ticks    ms      ms/tick   result
riverfen (1)                       2539     369      0.145    win
gallowmoor (8)                     7871    3313      0.421    win
thanescar (16)                     6936    4927      0.710    win
stormhalt (21)                    18240   61317      3.362    timeout
```

Late-game per-tick cost is **~23× tier 1's**, which is the whole argument for chunking
rather than a single `advance(hardCapTicks)` call — a tier-6 raid run in one blocking call
would freeze the tab for the better part of a minute. Chunked through the real screen
(`FRAME_BUDGET_MS` 8, `MICRO_TICKS` 10, real `requestAnimationFrame`) and driven in an
actual browser click-to-results: **riverfen resolved in 4.99s and 7.60s wall clock across
two runs** (variance is the shared box, not the feature), simulating 9:12–9:33 of in-game
time. Per-poll round-trip during the resolve averaged 21–35ms with a 215–224ms worst
case — nowhere near a multi-second freeze — `requestAnimationFrame` itself ticked 83–104
times while it ran, and the progress line showed 27–37 distinct strings over that wall
clock. All three are the same claim from three angles: the page kept rendering, the
resolve kept reporting fresh numbers, and neither ever stalled.

**A REAL RAID, IN A REAL BROWSER, PAID EXACTLY WHAT THE RESULTS SCREEN SAYS.** Riverfen,
conquered and off cooldown: `Riverfen raided` / *"A one-time lump. The region was already
yours."*, Crowns `+1.1K`, and `meta.crowns` gained 1097–1100 across two runs (compact
rounding accounts for the rest) — `relics` stayed at 0 (a raid pays none, by design),
`stats.battles`/`stats.wins` each advanced by exactly one, and the world map's own "Raid
available in 10:00" confirmed `completeRaid` restarted the cooldown. This is the first
time any of that had been confirmed outside a unit test.

## The away banner says when the treasury filled

`applyOfflineProgress` has returned `cappedOut` since it was written and nothing ever
read it, so a player who idled past `offlineCapMs` (base 8h, +2h a Treasury level, hard
max 24h) lost every crown after the cap in silence — and the Treasury line, which is the
upgrade that raises exactly that cap, was never named at the one moment it sells itself.

`meta/idle.js offlineNotice` is the decision and `content/strings.js IDLE` is the copy;
the screen renders one from the other. Three properties are load-bearing:

- **`capped` is gated on `shown`.** A one-second reload of a capped-out save is
  `cappedOut: true` with nothing to announce, and a caller reading `capped` alone must
  not be able to render a warning with no banner around it.
- **Both floors bind independently** (`OFFLINE.noticeMinMs` 60s, `noticeMinCrowns` 1). A
  rich empire earns a crown in well under a second and a poor one earns nothing in an
  hour, so either alone lets a page reload announce "+0 crowns … (0.3s)".
- **The decision is in `meta/`, not in the screen** — the shape `recruitOffer` and
  `buildOffer` already use on the battle side, so it is testable with no DOM.

Driven in a real browser both ways: two hours against an eight-hour cap shows the crowns
alone; eight hours against the same cap adds an amber line on its own row.

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

### A replayed campaign region carries a hand of its own

**The three endgame loops did not compound the same way.** A raid escalates forever
(`RAID.harderPerClear`) and a rung escalates forever (`INCURSION.perDepth`), but
abdication's replay was flat: the head start makes it *shorter*, nothing made it
*stranger*, and `--legacy=27` already measured every tier at 97–100% on a second run. The
fix generalises `meta/incursion.js`'s own machinery — `content/incursion.data.js`
`CAMPAIGN_REPLAY`, `meta/incursion.js` `campaignReplayPlan` — from "one arena, one depth"
to "any region, this many resets", and it needed no new `BattleConfig` field for the same
reason the ladder didn't: every mutator rides a field that already crosses the seam.
`campaignReplayPlan` returns a bare `{mutators}` and hands it to the exact same
`incursionMods`/`incursionRegionInputs` the ladder built; it is **never** passed to
`incursionRules`, because that function stamps `rules.incursion`, the field
`meta/rewards.js` branches an entire payout path on, and a replayed region is a first
conquest or a raid like any other and must be paid as one.

**Provably outside the measured set, the same way the Crown tier and the specialists'
zero default weight are.** `tools/simplayer.js metaFor` never sets `legacy.resets` above 0
unless a caller explicitly passes `--legacy=N`, and no test in the suite does. Proven
rather than argued: a `git worktree add --detach` checkout of the pre-change code, given
the *same* (currently mid-retune) `regions.data.js`, was run through `buildBattleConfig`
for all 24 regions × 3 idle times × 3 seeds, plus 3 raids and 4 incursion battles — 223
real configs — and diffed byte-for-byte against the changed code. Identical. `resets <= 0`
returns `null` from `campaignReplayPlan` by construction, so `mutation` is `null` and every
branch in `buildBattleConfig` takes the exact expression that shipped before this pass.

**Which regions, and how many — scaled by resets AND by tier, on purpose.**
`headStartFor` means a second run (`resets` 1) only ever fights region 9 on (emberholt
through widowsgate) and a third-or-later run (`resets >= 2`, the cap) fights *only* region
16 on (blackspire through widowsgate) — the same nine rows, forever. So the score a region
earns is `resets x 2 + max(0, tier - 3) x 1`, crossed against thresholds `[3, 6, 10]` for
1/2/3 mutators: a tier 1–3 region scores nothing extra and stays a clean victory lap
through the *whole* frozen head start (measured: every tier 1–3 region reads `null` at
`resets` 1, by construction), while the nine rows fought every run past the second get
measurably more seasoned as resets pile up (emberholt tier 2 at `resets` 1 → nothing;
thanescar tier 4 at `resets` 1 → one mutator; widowsgate tier 6 at `resets` 4–5 → the full
three). Seeded off `(region id, resets)` alone — nothing new is stored, and a retry within
one run draws the identical hand.

**`sealed` (the gate mutator) is excluded, and both ways of keeping it were wrong.**
Clamping it to the campaign's own `GATE_CLAMP` ceiling (0.60) makes it inert on precisely
the tier 4–6 rows a replay actually visits — every one of them already ships *at* that
plateau, the exact "the max was always the region's own" shape `sealed` shipped in on the
incursion ladder before that ladder's own ceiling existed. Letting it exceed 0.60
unmeasured risks reproducing "thirty-seven of thirty-seven timeouts sat below the gate",
the failure the castle-gate section above already spent a whole pass fixing. Excluded
rather than guessed at; the other seven mutators ship unchanged.

**Visible before it is fought, in the same place an incursion's hand already is.**
`screens/prebattle-brief.js regionBrief` resolves `campaignReplayPlan` straight off meta —
no battle has to be built first — and `brief.replayMutators` renders on the loadout screen
(`screens/prebattle.js`) as the identical `<ul class="pb-mutators">` markup the incursion
list already uses. Mutually exclusive with it by construction (a replay hand is never
computed when `depth` names an incursion).

**`harderPerClear`, surfaced.** The folded `Difficulty`/`Enemy strength` figure a fresh
attack and a tenth raid showed identically now has a sibling row, *"Raid escalation"*, that
appears only on an already-conquered, non-incursion region and reads
`x(1 + harderPerClear)^clears from N clear(s)` — the exact multiplier `effectiveEnemyMult`
was already folding in silently.

`tests/campaignreplay.test.js` (13 tests) pins all of it: the run-1 identity (both as a
direct `campaignReplayPlan` negative control and as a byte-for-byte `BattleConfig`
comparison), that a finished-and-many-times-abdicated player's incursion battles are
untouched, the victory-lap property for tiers 1–3, monotonicity in both resets and tier,
determinism and table-order of the draw, that `sealed` never appears and the castle gate
never moves, that every one of the seven allowed mutators measurably changes the config it
names, that a mutated replay is paid as an ordinary conquest or raid and never as a rung,
and that the brief shows exactly the hand the battle carries.

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

## Four specialists, each owning a verb

The roster was five units: a rock-paper-scissors of stats plus a siege engine. A sixth set
of stats would only have moved which column of the same table you read, so each one added
since owns a **verb** instead — a hook in the simulation, not a bigger number on an
existing one. Three shipped together; the archer came later, with the melee layer that
gave it something to shoot at.

| Unit | Slots | Verb | Why it matters |
|---|---|---|---|
| **Outriders** | 2 | `skirmish`, speed 165 | 3× a militia's march, over legs that are 0.9–1.7s to begin with — see the speed note below before pricing this as the opening |
| **Halberds** | 4 | `sunder` 0.50 | Halves the defender's `siteDefMult` — the one term no amount of militia answers (a castle defends at ×1.60 before walls) |
| **Sappers** | 3 | `repair` 1.9 | `breachSeconds()` returns `Infinity` the moment repair out-paces siege damage, so a wall they garrison is *arithmetically* uncrackable without engines |
| **Archers** | 3 | `reach` 1 | Adds attack to a fight **one hex away** and takes none of the casualties — the only unit whose value depends on where it is STANDING rather than what it is doing |

**The archer is the fourth, and it needed the melee layer to exist at all.** A fight used
to be one tick long, so "shoot into the fight next door" had no fight to shoot into — the
same reason the watchtower waited for fog. Its whole cost is positional: parked a tile back
it is free damage, walked into the line it is an expensive militia. See "A fight takes
time" above for why the support comp is kept out of the casualty pool.

All are share-scaled like `counters`: a token escort strips nothing, so committing to
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

`LOADOUT_TYPES_MAX` in `content/balance.js` is **5**. The roster reached nine and the
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

### The site panel is CAPPED, not trimmed — and landscape is a different problem

The audit's step 6 (a site panel open at 390x844) read **54% against its own 55% floor**,
and the panel was 339px of an 844px screen — 40%. It is now `max-height: min(52vh, 16rem)`
with head and actions pinned and the two middle groups scrolling
(`.hud-site-mid`, `display: contents` on any screen with room, so no desktop layout moved).
**62% now, and the whole audit is clean.**

**A cap rather than a trim, and the reason is the measurement's own weakness.** That 339px
was a CAMP with the shortest action list in the game; a besieged stronghold with a rally
chain is taller again, so the panel's height is content-dependent and unbounded. Trimming
two rows fixes one screenshot. Every trim was measured before it was rejected — dropping
the terrain-context row was worth 1 point, the upgrade preview 2, tighter padding 1 — and
all three together (59%) still lost to the cap.

**The wrapper is what makes the cap survivable.** Capping the panel without one scrolls the
title and the Upgrade button off instead of the readouts, which is verbatim the failure the
record drawer already documented: *"Only the middle scrolls; title and Close are always on
screen."* `min-height: 0` on the scroller is the line that actually does the work — a flex
child will not shrink below its content without it, and the cap silently does nothing.

**AND LANDSCAPE WAS NOT THE SAME BUG, which is the finding worth carrying.** At 844x390 the
same step read **47%** — measured with the cap on and off, 47 versus 45, so the panel fix
bought two points and the floor was eight away. Hiding the dock's six groups on the same
frame read **60%**. On a 390px-tall screen `.is-docked` applies and all six groups sat in a
100px band across the bottom, 26% of the viewport on its own — more than twice what the site
panel cost. **The panel was never the lever there.**

**So on a short screen the dock LIES DOWN**: `@media (max-height: 560px)` moves each
group's label beside its controls instead of above them, halving the group (95px → 54px)
and taking the frame to **54%**; folding away the treasury's third line (the
income/training breakdown behind the net rate) takes it to **59%**, and step 5 — a battle
with nothing selected — went 62% → 75%. Width is free in that layout and height is the only
thing that costs anything, because the dock already scrolls horizontally.

**Hiding the labels measured exactly the same 54% and was rejected for it**: same price,
strictly less. `% OF GARRISON` is what makes 25/50/75/100 mean anything, and
`.hud-speeds.is-capped`'s label carries a live `· capped` state rather than a caption.

Two process notes. **Every number was taken twice, alternating against the baseline** — the
same CSS read 45% and 47% in one session, because a live battle moves under the measurement
and the panel's follower lands it somewhere different each run. Compare within a run or do
not compare. And the label rule shipped with a defect **a screenshot caught and nothing
could have failed on**: a flex container trims the whitespace at the edge of each item, and
the `· capped` suffix is an `::after` and therefore its own flex item, so it came out welded
to the speed as `1x· CAPPED`.

**A phone screenshot found something no test could, for the third time:** the first-run
coach mark sat squarely over the panel's own Upgrade button. `.hint` is `pointer-events:
none`, so the button underneath still fired and nothing anywhere was broken — it was simply
illegible. Both are children of `#hud` with no z-index, so which one won was construction
order. `.hud-selection` carries `z-index: 2` now, and the rule is worth stating plainly:
**advice never covers a control.**

## The first twenty minutes, and the four things that went wrong in them

A critic drove the shipped game cold through CDP against a genuinely wiped save.
Everything below is MEASURED. Two of their findings turned out to be false and are kept
here as struck, because a false finding that reads plausibly will be refiled by the next
critic otherwise.

**WIPING THE SAVE NEEDS `Storage.clearDataForOrigin`, NOT `localStorage.clear()`.** A
save-on-unload handler re-persists the in-memory state, so the second one is silently
undone. Every "fresh save" script in this repo should be checked against that.

### The tutorial abandoned a player who did exactly what it asked

`COACH.drag` instructs a march across the map. **Marching causes no siege and no
capture**, and every remaining beat waits on one or the other — so a player who followed
the only instruction on screen was taught one thing and then left in silence for the rest
of the battle. `mine` stays at 3 sites for the whole minute in the probe.

**The hole opened when that line was rewritten.** It used to say *"Drag from your camp to
the grey farm"* and led straight into the field-then-siege beat; hiding unscouted neutrals
left nothing to point at, so it became a lesson about the GROUND — the better lesson, and
also the end of the script. `COACH.tookGround` is the rung that was never replaced, and it
holds until they attack something rather than on a timer, for the reason `drag` does: it
is an instruction, not a statement.

**Pinned as a PROPERTY, not as a beat list** — the beat after a march must name a target
and must not expire on a clock — so a rewrite with different copy cannot reopen it.

### ...and "the coach mark never advances" was a probe artefact, twice over

The advance works: measured on a fresh save in a real browser, the strip retires within
**two seconds** of a legal march. What the critic sampled was a hidden element still
holding its old attributes — `hide()` cleared neither `data-beat` nor `textContent`, and
the strip fades by class. Same shape as the site panel reporting `display: flex` at
opacity 0.00016, which this file already records. `data-beat` is cleared now; the text
stays, because it is mid-fade and clearing it would blank the line rather than fade it.

**AND A REFUSED ORDER LOOKS IDENTICAL TO A BROKEN TUTORIAL.** My own probe reproduced the
"never advances" reading twice before I noticed, both times because the march never
happened: once on an off-grid destination (`grid` is an OFFSET rectangle — the documented
gotcha, tripped over anyway) and once on a gesture that was swallowed. **A probe that does
not assert its own order landed is measuring nothing.** The coach is correctly still
asking for a march that was refused.

### Nothing marked which glyph is your camp

The opening line names the camp, the camp is the lose condition, and the three starting
buildings are similar 20-30px glyphs — a camp and a training ground differ by a small
pennant. The critic dragged from the FARM on their first attempt, going off the picture.

`render/coachmark.js` floats a chevron over the building the current coach line names. A
beat carries a KIND (`mark: 'camp'`) and `screens/battle.js` resolves the site off the live
battle, so the sentence and the mark cannot name different buildings — the rule
`battle-alert.js alarmSite` already follows for the danger mark. A kind rather than an id
because `coach.data.js` is pure data that has never seen a battle.

**Two decisions a SCREENSHOT made and no test would have.** A wedge rather than a ring or
brackets: the board already draws four rings, and `alarm.js` has taken corner brackets to
mean "this one is in trouble", in the danger colour — sharing that mark with the
friendliest moment in the game would be worse than no mark. And it is the coach strip's own
accent blue rather than the player's green: the first cut used `owner.player`, and the camp
is green, standing on green territory under a green flood, so the mark was a shape you had
to hunt for. `RISE` came down 2.9 → 2.35 on the same look — the first value floated it
95-105 screen pixels above the glyph centre, three times the glyph's own height.

### The loadout screen hid part of the player's own army

**`.pb-body` has always been a scroll container, so the rows were reachable the whole
time.** The platform draws an OVERLAY scrollbar, measured at **0px wide**, so there was no
scrollbar, no fade and no cue of any kind. Measured at a nine-unit roster:

```
viewport      innerHeight   last row bottom   hidden
1440 x 900        761             753           0     (8px of margin)
1440 x 800        661             753         210     (two rows past the edge)
1440 x 720        581             753         290     (four rows)
```

It fits at exactly one window size and clips at anything shorter, silently, on the one
screen whose entire job is "review what you are walking in with".

`.pb-body.has-more` masks the bottom edge, toggled on paint, scroll AND resize — resize on
its own, because the panel fits at 900 and clips at 800, so a window the player drags
crosses the boundary with nothing re-rendering. `moreBelow()` is the rule as a pure
function rather than three lines of DOM arithmetic inline, because both ways of getting it
wrong are silent: a fade that never appears, and one that never clears on a panel whose
content height is fractional. **Its negative control is the important half** — a fade on a
panel that fits claims there is more when there is not.

### The anti-turtle ladder did a great deal and told nobody

`attritionPhase` has cut farm income, wall repair, garrison size and training throughput
after 150/210/270 seconds without a capture ANYWHERE on the board for this feature's whole
life. **The only mention of it outside `battle/` and `content/` was a comment** in
`battle-econ.js` noting that the HUD's income figure includes the ladder — true, and not
the same as telling anyone. `EVENTS.ATTRITION_STAGE` had been pushed since the phase was
written and had never had a consumer.

That is the "sold and did nothing" shape this project has refunded four upgrades for,
inverted: a mechanic that does a great deal and is invisible. The third rung — half income,
no repair at all, training at double price and half rate — reads as the game breaking
rather than as a rule.

`RESULTS.attrition` is one line per rung, each naming what THAT rung does and each saying
it applies to both sides, which is what makes pressing the answer and waiting not. **Stage
0 is silence on purpose**: the ladder retiring means ground just changed hands, and "the
country has recovered" is a message nobody needs while they are busy taking the thing that
recovered it.

**Not fog-gated, and the event carries neither a site nor a hex so it cannot be.** Attrition
is a rule of the whole board rather than a claim about a place; gating it the way a capture
is gated would silence it outright. Measured headlessly on riverfen seed 1000 (rung 1 at
321s, rung 2 at 381s, mods matching the announced stage) and in a real browser at 4x with
nobody giving orders (259s and 323s, correct text, danger tone).

**The harness half is still open**: `tools/` never reacts to attrition either, so the bot
plays through a ladder it cannot see any more than the player could.

### "Away cap" is a heading, not an explanation

No `title` anywhere up its DOM ancestor chain, while on the SAME screen the locked
Incursions button correctly explains itself on hover — so the pattern existed and had not
been applied to the figure the entire idle half rests on. `UI.offlineCapHint` titles both
halves of the pair (a player hovers whichever their pointer is over, so a title on one of
two is a coin flip) and names the Treasury line, because wanting the number to be bigger is
the whole reason to explain it. No `aria-label`: the label precedes the value in DOM order,
so a screen reader already reads "Away cap, 8h".

### The withdraw confirm could not outlast its own warning

`holdMs` was 4,000ms against a 95-character hint, which is about three and a half seconds
of reading before the player has even decided — so the window could close while they were
reading the thing it asked them to read. **8,000ms now, and the test pins it against the
LENGTH OF ITS OWN COPY** rather than as a constant, so growing the sentence without growing
the window fails.

The critic filed this as the confirm expiring *silently*, and that half is false: `sync(0)`
puts the label back to "Withdraw" and closes the hint, both visible.

### Two findings struck as false, with the evidence

- **"An empty booster gives no feedback at all."** Reproduced on a fresh save: the first
  rail booster is `booster is-empty`, a real pointer press hit-tests to it, and the alert
  strip reads **`RALLY: You did not bring that booster.`** immediately — the
  `boosterBlocker` fix already recorded above. One true residual, left alone because it is
  worth almost nothing: the control does not shake, because the shake rides
  `battle:command-rejected` and this refusal happens before a command is issued.
- **"The coach mark never advances."** See above.

### What was NOT fixed, and why it is a product decision rather than a bug

**A brand-new visitor is dropped into a live, already-ticking battle.** Wiped twice
independently, with and without `?dev=1`: `document.body.dataset.scene` is `battle` on
load, gold already draining from tick 1, no title screen and no New Game. The title screen
exists only behind a Menu tab on the world map, reachable after the first battle is
finished or abandoned. That is `worldmap.js bootRoute` working exactly as designed and
documented — *"it owns the boot decision (menu, or straight into region 1 on a clean
save)"*. The design is the finding, so it is recorded rather than changed.

## What the results screen may claim, and the empire line beside the objective

**Three things the game said that were not true**, all found by playing it rather than
by a failing test:

- **A booster you have none of used to ARM and instruct you to aim it.** A fresh save
  carries no charges — relics buy them, and relics are paid only for a region you have
  BEATEN — so the first battle puts five live controls down the right rail, all reading a
  dash. Pressing one answered `AIMING RALLY — click a site`, and the refusal came on the
  SECOND click. `boosterBlocker` is exported from `commands.js` and `cmdBooster` is its
  other CALLER rather than a copy — the `buildBlocker` pattern.
- **`resultReason`'s no-gate branch claimed the countryside was yours.** It returned
  `whyClockOnly` ("The countryside was yours and the gate was open") in the branch whose
  own comment says to make no territorial claim. Five regions ship `castleGateFrac: 0` —
  all of tier 1 plus kaldan — so every timeout on them printed it however little was
  held; reproduced at 3 of 11 sites and 2 of 18. **The test that should have caught it
  had encoded the defect**, asserting the branch equalled a named constant when the
  constant was the wrong one. Assert the PROPERTY when the property is the point.
- **"Nothing was lost but time" is false if a charge was fired.** `applyOutcome` consumes
  boosters unconditionally with no refund, and a charge costs relics. The copy branches on
  `applied.boostersConsumed` — what was deducted from the player's stock, not what the
  battle fired — so the headline and the "Charges spent" row agree by construction.
  **Invisible to every balance number by construction: the harness launches with
  `boosters: []`.**

**A STALLED BOARD NOW SAYS SO.** `endPhase` only assigns `timeout` at `hardCapTicks`, so
every timeout runs the full cap — measured, widowsgate locks at 7 sites v 48 by minute 9
and does not move for the remaining 25 minutes, 74% of the battle. Withdraw is free and
always on screen and nothing ever said it was time to use it. `battle-alert.js
stalemateCheck` is a pure fold over the site tally with injectable thresholds: three
minutes still raises `STALLED — no ground has changed hands in N minutes`, repeating no
oftener than every two. **It warns and does not act** — duskfell, measured, was contested
to the wire, so a still tally is not proof of a lost battle.

**THE CASTLE GATE IS VISIBLE BEFORE THE FIGHT.** `castleGateFrac` appeared nowhere before
committing to a region and, in battle, only inside the castle's own panel once the throne
was already under siege (`castleSealed` needs an active siege to answer). The world map
and loadout brief now carry `Throne holds until: you hold N% of the map`, omitted where
there is none — "0%" reads as a requirement rather than its absence. On an incursion it
asks `incursionRules`, so a `sealed` rung advertises 72% rather than the arena's 60%.

**AND THE EMPIRE IS ON SCREEN DURING THE BATTLE.** A code search over
`src/screens/battle*` found zero readers of crowns or income, so the game's one-line pitch
was unobservable for the 8-20 minutes a battle lasts. `EMPIRE · 12K crowns · +15.0/s`
rides under the objective — not beside the treasury, because only one of the two pots is
spendable there — and is hidden until there is something to show, so it first appears in
battle two rather than as a row of zeros in the busiest minute of onboarding.

## What the game SAYS versus what it DOES: the fun pass

Four critics drove the shipped game — feel, board readability, hours 2-10, input
and accessibility — and every finding was reproduced with a probe or a
screenshot before it was believed. What follows is the part worth keeping: the
mechanisms, not the fixes.

**A GESTURE THAT SAID "CANCEL" DESTROYED TROOPS.** `battle-waypoints.js
updateDragPreview` nulls `view.dragTo` whenever the snap target resolves back to
the drag's own origin. That is right for a RALLY — it is the "so you can clear a
rally" pattern and it is what the line was written for — and for a SEND it made a
returning drag **indistinguishable from a release on open ground**, so
`resolveDrag` took the bare-ground branch and marched a share of the garrison
onto the tile it was already standing on. Measured with real pointer events:
squads-from-camp 0 → 1 → 2 over two "cancels", each a new `{to: null, camped:
true}` squad that had marched nowhere. The detachment then sits exactly on its
own site's hex, where `siteAt` wins every hit-test, so it can never be selected
or reabsorbed. `resolveDrag`'s own comment already called this a cancel.

**The camped branch was worse for a reason worth remembering: `cmdMoveSquad`
takes a FRACTION**, so a camped force dragged back onto itself SPLIT rather than
re-tasking in place. `battle-drag.js backAtSource`/`backAtSquad` test the last
trail hex against the origin's own hex — `dragTo` is precisely the signal that
was thrown away — and the match is EXACT, because anything fuzzier eats the
shortest legal order in the game.

**THE PREVIEW PROMISED A MARCH ONTO A MOUNTAIN, AND `passableFor` IS WHY.**
`occupancy.js passableFor` returns true for the GOAL hex *before* it consults
`isBlocked` (line 92 against 93), so a column can target a building it means to
assault. Nothing confined that to buildings: A* would happily return a route
ending on rock, `previewPath` drew it hex by hex with a chevron, and `cmdSend`
answered `bad-hex` for the same order. `marchBlocker` is now one predicate with
three consumers — and it is applied on the BARE-HEX path only, because a site is
guaranteed in-grid by `assertBattleConfig` and gating it would make the preview
STRICTER than the order, which is the same disagreement pointing the other way.

**...and the same exemption applies per LEG, which was a simulation bug.**
`pathThrough` stitches one A* leg per stop, so an intermediate waypoint got the
free pass too, and only the final `toHex` was ever validated. Measured: a route
drawn deliberately through a mountain was **accepted**, and the squad's path was
nine hexes with one standing on blocked rock. `routeBlocker` checks every stop.
Provably inert on balance — `waypoints` appears nowhere in `tools/` or
`battle/ai*.js`, and a matched gallowmoor n=8 is identical digit for digit.

**`armySize` PROMISED "ANYWHERE" AND MISSED A BUCKET.** It counted garrisons,
sieges and squads — and since contract v12 an assaulting column is off
`state.squads` for `MELEE.seconds` and lives in `site.melee`, a fourth bucket
that did not exist when the docstring was written. So a faction's total DIPPED
for six seconds every time it attacked anything. Nearly invisible as a peak
statistic (a peak is a max over every tick) and plainly wrong as a readout a
player watches. `armyCensus` is the one fold over all four and `armySize` is its
total, so the total cannot disagree with its own parts. The split it adds is
ARRIVED versus IN TRANSIT, because a camped force is on `state.squads` and is
holding ground — counting it as marching would make parking a force read as
indecision.

**EVENTS ARE A ONE-WAY STREET, AND THAT IS WHAT MAKES THEM FREE.** Nothing in
`battle/` or `tools/` reads `state.events` at all — the only reference anywhere
is the clear at the top of `step`. So adding an event type cannot move a balance
number, which is what let `FIELD_BATTLE_ENDED` ship without a re-measure. Worth
knowing before anyone hesitates over the next one.

**A FIGHT OPENED LOUDLY AND ENDED IN SILENCE.** `FIELD_BATTLE` fires when a melee
starts or is reinforced; six seconds later the only resolution that announced
anything was the one that opens a siege. So a column being wiped out was silent,
and so was a garrison HOLDING — the one piece of good news this layer can give.
The beat is sized by casualties rather than by who won, because fights resolve
about once a second late in a battle: under three bodies it draws nothing, and it
stops growing at forty.

**AND A CAPTURE NEVER ESCALATED.** `site-captured` has carried `kind` since the
event was written and `fxFromEvent` never read it, so taking an undefended farm
and breaking the enemy's throne fired pixel-identical bursts. Magnitude derives
from `siteTier`, which already means "how much attention does this kind deserve"
— a second table would be a second thing to keep in step.

**TWO FINDINGS WERE FALSE, and both failed the same way — a probe measuring the
wrong thing.** "A click on bare board does not dismiss the site panel": it does,
but the panel FADES, so a sample 250ms in reads `display: flex` and a 217x82 box
while the opacity is 0.00016. Opacity does not collapse layout. And "the enemy's
column throughput is a player-facing problem": `canSee` grants sight from three
sources only, so most of the documented ~106 columns/minute happen where the
player provably cannot perceive them — reproduced twice, with the screen pixel at
a live enemy-vs-neutral fight sampling flat fog colour.

**THE OPEN ONES, ranked by what they cost a player.** The board is a nameless
canvas with no AX node, so a screen-reader user gets nothing spatial for a whole
battle. There is no keyboard path to the core verb — the site panel's own
controls are proper buttons, but the panel cannot be opened without a mouse. Site
hit-targets fall to 34px at the default zoom on the biggest maps. And every
unlock in the game is bought by about region 8 of 24, so the back half of the
campaign has nothing new to acquire.

## Gotchas that have already cost time

- **A PROBE THAT MEASURES A BOX MID-TRANSITION REPORTS A DISMISSED PANEL AS A
  LIVE ONE.** `.hud-selection` fades rather than un-mounting, so 250ms after a
  deselect it still reports `display: flex` and a 217x82 rect — opacity does not
  collapse layout. A whole finding was filed against the game on that reading.
  Sample `getComputedStyle(...).opacity`, or wait for the transition.
- **AND A PROBE AGAINST A PAUSED SIM READS "NOT REJECTED" FOR AN ORDER NOTHING
  HAS LOOKED AT.** Commands drain at the top of a TICK, so at `setSpeed(0)` a
  pushed command sits in `state.commands` forever. The same session read a
  correctly-refused order as silently accepted for exactly this reason.
- **`markConquered` WRITES `rec.status = 'conquered'`, NOT `rec.conquered`, and a
  fresh save carries records only for regions the player has TOUCHED.** Seeding a
  finished campaign by iterating `meta.regions` therefore reaches almost none of
  them — `tools/smoke-meta.mjs` does it correctly and is the copy to steal.
- **`grid.blocked` HOLDS STRING KEYS (`"q,r"`), not arrays or `{q,r}`.** A probe
  that reads `blocked[0].q` gets `undefined` and projects to NaN screen
  coordinates, which the camera happily accepts.
- **A SPLIT THAT MOVES A CLOSURE TURNS ITS CAPTURED VARIABLES INTO FREE ONES, AND A FREE
  VARIABLE IS NOT A SYNTAX ERROR.** `createSelection` destructured four of its seven
  dependencies; the two functions the split moved had also closed over `board`,
  `getState` and a scratch point, and those became globals-that-do-not-exist. The module
  loads, `npm run check` is happy, and every path that does NOT call them stays green —
  so box-select and the rally CLICK were dead for a release. **When splitting a factory,
  diff the moved code's free identifiers against the destructured list**, and remember
  that the scratch point wants to be COPIED rather than shared: two files mutating one
  `_a` across a module boundary is a data race waiting for the first interleaved call.
- **AND A GESTURE WITH NO SMOKE STEP CAN BE DELETED BY A REFACTOR WITHOUT ANYTHING GOING
  RED.** That is the reason the above survived: `tools/smoke.mjs` drove the rally DRAG,
  which is a different function, and had never box-selected at all. `smoke-select.mjs`
  covers both now, and it needed three things that are worth copying to any new step —
  it runs FIRST among the order steps (placed last, the beachhead has shrunk and it
  reports "fewer than two player sites to box" and asserts nothing, which is
  worthless-but-green); it reads `__game.__view` like every other step, because
  `__game.screens.battle` is the SCENE and a board read off it is `undefined`, giving the
  same silent skip; and it **leaves the input state clean**, because it is the only step
  that selects several sites and a drag starting on a selected site commits the whole
  selection — three sites left selected made the camped-drag step four steps later issue
  a SEND instead of a MOVE_SQUAD, intermittently.
- **`h()` SKIPS AN UNDEFINED CHILD RATHER THAN THROWING, so a node built before the
  variable holding it is a readout that draws nothing.** `battle-hud.js` created
  `el.tallyBox` from `el.tally` ten lines before `el.tally` existed: the box mounted its
  label alone, the value span was never in the document, and `bindText` wrote every
  update into a detached node. The `SITES 3 v 5` tally shipped permanently blank, in the
  same pass that added it, and no test could see it — the writer exists, the binding
  works, the string is correct, and it lands nowhere. **Only a probe of the live DOM
  finds this class.** Declaration order in a `createXxx` builder is load-bearing.
- **A LIST THE PLAYER IS SHOWN MUST BE THE LIST THE SIM WILL HONOUR, and there are three
  of them.** `meta/composition.js battleRoster` narrows `unlockedUnits` to the five types
  the expedition carries, and `cmdTrain` gates on that field — but the filter rail, the
  filter HOTKEYS and the training fan were each built from `UNIT_IDS`. So a two-troop
  campaign opener drew nine chips and eight fan chips, of which seven and six were
  controls for a troop the army cannot contain and cannot train. The keyboard was the
  worst of the three because it left no trace: `U` with no halberds flipped
  `view.filter.halberds` false and left it flipped. `battle-keys.js filterUnits` and
  `battle-parts.js trainFanUnits` are the two answers now, and every loop over them must
  use *their* length — `UNIT_IDS.length` over a narrowed array indexes off the end.
- **THE PURITY GATE FOLLOWS THE IMPORT GRAPH, NOT THE DIRECTORY LIST.** Auto-resolve puts
  `tools/` code into the browser deliberately (`src/meta/autobattle.js` imports
  `tools/autoresolve.js`, which drags in `simplayer`/`simtactics`/`simbuild`/`simshop`),
  and `checkpure`'s `PURE` list has never covered `tools/`. `tools/checkpure.js` walks the
  closure out of the pure directories now, so anything a pure file can reach is held to
  the same rule and a new import is covered the moment it is written. It is deliberately
  NOT "also scan `tools/`": `serve.js` and `cdp.js` must use the clock and the network.
- **`bgCache.markDirty(true)` SKIPS THE 8/s THROTTLE, and `battleView.js` always passes
  `true`.** `force` exists because a signature change is real content that owes the
  current frame where a pan gesture does not. Any argument of the form "this is safe
  because `markBgDirty` is throttled" is false for signature-driven repaints — the bound
  is how often the signature can actually MOVE. (`squadSightSig` is safe because a column
  crosses a hex every 0.7–2.5s, measured at 60.1 fps with 56 columns on widowsgate.)
- **UNREAD COPY GOES STALE SILENTLY, and `content/strings.js` had a whole block of it.**
  `IDLE`'s five strings had no reader for the life of the feature while `worldmap.js`
  hardcoded its own beside them — so `IDLE.awayCapped` went on advertising a "Granary"
  upgrade that stopped existing when twenty-six upgrades collapsed into six endless lines,
  and the live banner never grew the one line that block already had written for it.
  `tests/offlinenotice.test.js` asserts every key in `IDLE` reaches a screen; the same
  guard is worth copying to any strings block that grows a second surface.
- **A COACH LINE IS A CLAIM ABOUT THE REGION IT FIRES IN.** `BEATS.takeCastle` described
  the castle gate on castle reach everywhere, and Riverfen — the opener, the one battle a
  first-timer is guaranteed to play — ships `castleGateFrac: 0`. Nothing on screen could
  contradict it, because `gateLine`'s `SEALED · holds X% of Y% needed` only renders when
  the gate is real. It is a pair now, split on one signal. `tests/coachcastle.test.js`
  asserts region 1's gate is 0 off the real config, so growing one is a failing test
  rather than a second wrong line.

- **`REGION_BY_ID` IS NOT THE CAMPAIGN, AND `REGIONS`/`REGION_IDS` ARE.** The Frontier
  resolves by id and is absent from the list, deliberately — `buildBattleConfig` looks a
  region up by id, so the map is the one place it has to exist. Anything that means "the
  campaign" and reaches for `Object.keys(REGION_BY_ID)` now includes a row with no
  `meta.regions` record at all: `tests/idle.test.js` did exactly that and threw
  `Cannot set properties of undefined`. The production consumers were all fine, which is
  the point — `idle.js` sums `conqueredIds`, `world.js` reads `startsUnlocked` through
  optional chaining, `devoverlay.js` lists `REGION_IDS` and looks up by id — so nothing
  told you until a test that had used the wrong list as a proxy fell over.
- **INJECTING A STRINGS OBJECT SILENTLY DISABLES THE GUARD THAT PROVES COPY IS READ.**
  `tests/endgate.test.js` and `tests/offlinenotice.test.js` both work by grepping the
  screen tree for `ENDGAME.<key>` / `IDLE.<key>`, because the failure they exist to catch
  is dead copy going stale with nothing failing. A helper taking `{strings}` and reading
  `strings.frontierLocked` is invisible to that — the Frontier's three strings shipped
  with nothing able to prove they were read, in the same commit that added a section about
  dead copy. The parameter also bought nothing: no caller ever varied it. **Name the key
  literally at the point of use.**

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
- **`aria-hidden` written once at construction is `aria-hidden` forever, and it silently
  cancels every `aria-describedby` pointing at it.** `battle-tip.js` — the unit hover card
  every troop chip and comp segment attaches to — was built with `'aria-hidden': 'true'`
  and never toggled, so the card was excluded from the accessibility tree even while open
  and `attach`'s own promise that "the descriptions are reachable from the keyboard rather
  than being a mouse-only secret" was false for every screen reader. It rendered
  perfectly, which is why nobody looked. `ui/dom.js bindAttr` is the missing member of the
  `bindText`/`bindClass`/`bindStyle` family and exists because of this; a null or false
  value REMOVES the attribute rather than writing `"null"`.
- **A READOUT SHOULD NOT HAVE TO BE OPERATED.** The comp bar's five segments took
  `tabIndex = 0` whenever they held troops — five keyboard stops 15px tall, a third of the
  44px minimum, that activate nothing and (per the entry above) announced nothing either.
  The fix was not to give them a bigger target: the BAR names its own composition
  (`role="img"` + a live `aria-label` built in the same pass that sizes the segments), so
  the whole breakdown is announced with no interaction at all, and the segments leave the
  tab order permanently. `tools/mobile.mjs` skips `tabIndex < 0`, so the audit stops
  crying wolf and starts meaning something.
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
- **A SMOKE STEP MUST ASSERT `document.elementFromPoint`, and skipping it cost half a
  session.** `#screen-root` is `pointer-events: none` and the HUD plates that opt back
  in sit OVER the board, so a hex can be perfectly visible, perfectly hit-testable by
  the game's own geometry, and still be under the site panel. The camped-drag step did
  not check, and failed about half its runs — always on the same hexes. Every suspect
  that could be measured came back innocent: no site stealing the press (it failed with
  and without one), the drawn position and the picker's identical, and the hit-test off
  by **0.1px against a 17px radius**. The tell, in hindsight, was that the selection was
  left exactly as the previous step set it — neither the squad branch NOR the site
  branch of `tap` had run, because the events never reached the canvas at all. The step
  now picks the first candidate hex whose screen point hit-tests to the canvas, and says
  so plainly when an army camps under a plate. This is the same rule the suite learned
  once already ("a release once shipped completely unclickable"); it is not enough to
  dispatch real pointer events if nobody checks where they land.
- **A smoke FIXTURE picked out of a live battle is the same failure one layer down.**
  `smoke-orders.mjs`'s drag step wanted a known non-player site or another friendly one
  within the camp's reach, which is a claim about a board ten seconds in — and it came up
  empty intermittently: measured, a camp whose entire reach was one UNSEEN neutral farm
  and one friendly site. The step then threw rather than passing quietly, which is the
  good half, but it blocked every later step in the run. It falls back to **bare ground**
  now, which is not a consolation prize — marching to a tile is the interaction the coach
  mark teaches, so the step asserts the shipped gesture either way. `siteScreen` only ever
  reads `.hex`, so a bare hex projects through the same camera the sites do.
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
- **`ROADMAP.md` IS A SHARED-TREE COLLISION POINT, and it is the one file every parallel
  session writes to.** The protocol says tick the item in the same commit as the work,
  which is right — but when several sessions work one tree, whoever commits first sweeps
  up everyone's in-flight ticks under their own message. Observed: a Crown-tier tick
  landed inside a commit about the phone layout. Nothing was lost and no history was
  rewritten, so the cost is only that `git log` lies about which change carried which
  tick. Same family as the `git add -A` scar recorded under the campaign re-tune, and the
  same discipline answers it — **stage explicit paths, and re-read `ROADMAP.md`
  immediately before editing it** rather than from a copy read minutes earlier.
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

## The five-layer audit, and the eleven things it found

A second sweep, one engineer per layer (battle sim, meta/save/contract, render/screens,
content tables, tooling), every finding reproduced with a runnable snippet before it was
believed. **Nine of the eleven were silent** — they broke nothing visible, passed the whole
suite, and several were contradicted by a comment sitting directly above them. The pattern
worth carrying forward is in that last clause: on this codebase, **the comment is the
specification, and where code and comment disagree the comment has usually been right and
the code has usually been the thing that drifted.** Five of these were found by reading a
docstring and then testing whether it was true.

The two biggest are written up in their own sections above (`siegeDps`'s frontage becoming
an average, and `projectMarchLosses` sampling a one-tick-shifted window). The rest:

**THE WORLD SEED NEVER REACHED MAP GENERATION, so every player got the same maps.**
`screens/battle.js` passed `ctx.state.meta` to `buildBattleConfig`, and `seed` lives on the
ROOT state, not in the `meta` slice — so `metaState?.seed` read `undefined` and fell through
to `?? 1` for the whole life of the project. Verified: two saves seeded 12345 and 999 both
produced `riverfen#0#0#e4285f2e`. `newCampaign`'s promise that "a new campaign is a new
world, not a replay of the same maps" was simply false.

The mechanism is worth more than the fix, because it is a *safety feature* misfiring:
`metaOf` accepts either the root state or the slice, deliberately, so that "passing the
wrong one is impossible rather than silently returning zeros". `seed` is the one field that
promise cannot cover, so the one place a caller could still pass the wrong object is the
one place nothing guarded. **And an existing test asserted the seed varies** — it passed the
root state, so it proved the function works when called correctly and never asked about the
caller. `tests/modifiers.test.js` now pins the trap AND asserts the call site against
source. No balance number moves: `tools/simplayer.js` always passed `seed` explicitly.

**A TWICE-CAMPED ARMY COULD NEVER RETREAT.** `reverseSquad` anchored entirely on sites, which
was sound while every column ran between two buildings and is not sound under free movement:
`marchCamped` clears `from`, and `to` is already null for a march onto bare ground, so a
column that camps, is re-tasked, and camps again has NEITHER. `retreatTarget` got
`undefined` and returned null, so Retreat answered `nowhere-to-retreat` — permanently, with
friendly ground two hexes away. A *first*-generation camped squad retreats fine, which is
why it read as working. It compounds with the towers: park such a column beside a stronghold
and it is ground down with no order that can save it. The anchor now falls back to the hex
it stands on, which is exactly what the squad-path rewrite made knowable.

**AND `siegePhase` DELETED THE ARMY ITS OWN COMMENT SAID IT SAVED.** The razing path read
`sq.arriveTick = Infinity; // nowhere to run: it holds`, and the next statement filtered on
`Number.isFinite(sq.arriveTick)` — so the sentinel meaning "keep this one" was read as
"remove it". An army vanished with no event and no body count, which is verbatim the bug the
comment block above it claims to have fixed; for the enemy's last column in flight it handed
the player an instant win through `!inFlight('enemy')`. It camps now, which is what
`arrivals.js` already does for a vanished destination. **Nothing had ever executed that
branch** — the existing test only reaches the success path, because the player still holds
their camp.

**A FOURTH FOG LEAK, in the drag magnet.** `snapTarget` calls the fog-gated `siteAt` and
then — *precisely when that returned null because the site is unscouted* — fell through to a
raw scan of `state.sites` with a reach ~2–3× wider. Dragging near a never-seen building
named it in the preview panel, and site ids encode owner and kind (`es04` = enemy
stronghold), so it disclosed the two facts the site-existence gate exists to hide. Worse, the
order *fired at the invisible building* instead of camping on open ground, while the board
drew a dashed "no target" arc — the HUD and the canvas contradicting each other, which is
the "one bug fixed and two left live" shape this file warns about at `perceivedSite`.

**THE MARCH BOOSTER TELEPORTED COLUMNS.** `squadHexOf` reads position as
`(tick - spawnTick) / (arriveTick - spawnTick)`, so shortening `arriveTick` alone does not
make an army faster, it makes it JUMP — measured, 0.50 to 0.735 of the route in one tick.
`reverseSquad` back-dates `spawnTick` for exactly this reason and the booster did not. Every
position consumer agreed with the jump, so it was a real skip past a wall rather than a
draw bug.

**`state.grid` IS A SECOND HAND-PICKED SUBSET, and it dropped `rivers`.** `startBattle`
patched it back on the next line, so production was fine and `createBattleState` — a public
export with ~25 direct callers in `tests/` — handed back a riverless board. On widowsgate
seed 42 that is three sites of eight different: a throne defending 18% harder, a farm
earning 26% less. That is `rallyKeepDefault` a third time, and the fix is where occupancy
and vision already went — into the state builder.

**THE AI WAS BLIND TO CAMPED ARMIES, INCLUDING ONE HEX FROM ITS THRONE.** `encroachment`
summed SITE garrisons only, so an army of 300 camped beside the castle scored 0 where the
same 300 in transit scored 300 — while its own docstring says the whole point is "what is
merely STANDING within `homeRadiusHexes`… waiting for it to move is waiting until it is too
late". Camping is precisely how you park a stack next door without threatening anything, so
the player could stage their entire force on the doorstep unnoticed. Balance-neutral by
construction: **the harness never issues `MOVE_SQUAD` and never camps**, so no measured
number can move — this only closes a hole a human can walk through. `threatOn` deliberately
still ignores camped squads, because it answers "what is committed at this site right now"
and a camped column is not.

**A REFUSED SAVE PLUS A LIVE BATTLE BLOB STARTED A BLANK CAMPAIGN, silently.** `loadBattle`
wins over every other boot route and validates the CONTRACT, never the campaign — so a
player mid-battle on region 21 whose save got corrupted was dropped into that battle against
a level-0 meta, and on finish `applyOutcome` paid a first-clear bonus that never persisted.
Same shape as the already-refunded "a refused save silently started a new game": an early
return above the refusal message. The resume route is now gated on `boot.blocked`, and
neither file is destroyed.

**`assertBattleConfig` was strict about the cosmetic field and lax about the army.** It
validated optional sparse `unitMult` against `UNIT_IDS` with finite non-negative values,
while `expedition` — the actual troops — got `typeof === 'object'`. So
`{militia: 'lots'}` was ACCEPTED and produced the string `"0lots"` as a live garrison;
`{militia: -50}` was accepted; `hardCapMs: Infinity` passed `> 0` and made a battle that can
never time out; a bad `site.level` threw a raw `TypeError` deep in state construction rather
than a named seam error. This is the one boundary that matters, because `resume.js` runs it
deliberately as the shield over a hand-editable `localStorage` key. **No version bump** —
tightening validation is not changing what the engine does with a blob.

Also closed on the way: `adoptCampaign` never dropped the mid-battle blob (`mainmenu-legacy`
does it for abdication with reasoning that applies verbatim); `meta.incomePerSec` had a
second writer restoring it off disk against three comments claiming one; the treasury live
region fix had landed on one of three identical surfaces, leaving the shop announcing four
times a second inside a modal with focus on Close; `buildBlocker` allocated ~18k objects per
frame while a build was armed, under a header asserting the scan allocates nothing; and
`MUTATOR_WEIGHT_TOTAL` was a dead export whose comment described a precomputation that was
not happening.

**What did NOT turn up is worth recording too.** The site-kind and unit-colour tables are
complete for all six kinds and all nine units (the doubled-colour-table gotcha has not
regressed). `enemyMult` and total sites are non-decreasing across all 24 rows and
`castleGateFrac` never exceeds 0.60. No `h(tag, props, …)` misuse in ~200 call sites. No
`shadowBlur`. `markBgDirty` is still throttled to 8/s. Every DOM screen still opts back into
pointer events. `checkpure`'s banned-global list matches this file's, and both CI jobs still
gate the deploy.

### Still open, and why

- **THE CAMPAIGN RE-TUNE (third pass), against the melee layer. TOP OF THE LIST.**
  The melee layer shipped with the campaign knowingly out of band — the scope call was
  mechanics and tests now, tuning as its own pass — and the measurement is written up in
  full at "A fight takes time" above. The short version, n=48: riverfen 96% TOO EASY,
  kaldan 77% ok, gallowmoor 23% TOO SLOW, thanescar 2%, ravensmarch 4%.

  **⏳ SUBSTANTIAL PROGRESS THIS SESSION, NOT CLOSED — tier 1–2 are done and
  confirmed, tier 3–6 have a diagnosed lever and a COMPLETE n=24 screen (all
  fifteen rows), and eleven of those fifteen are still below their tier's
  floor. Do not read this as a finished pass — n=24 is a screen, not the n≥96
  this file's own house rule requires, and read it as where the next session
  should resume.**

  **First, a correction to the line above.** Re-measured fresh at n=48 against
  today's HEAD (no dial changed yet), riverfen read **90%, ok** — not 96% —
  matching CLAUDE.md's OTHER n=48 table ("RE-TAKEN ON THE FIXED ENGINE") rather
  than the later "after the clock fix" one quoted here. Something between those
  two measurements shifted this row back down into band on its own; nothing in
  this session touched riverfen before taking that reading. Recorded so the
  next re-take does not waste time chasing a discrepancy that was already
  resolved once, silently, by an earlier fix.

  **TIER 1–2, CONFIRMED AT n=48, all nine rows read `ok`:**

  ```
  riverfen 90  ashford 85  ironwood 90  saltmere 79  kaldan 73
  highmarch 75  greywater 75  thornmoor 67  emberholt 69
  ```

  Three needed a change. **Ironwood** read 98% (ceiling 92) on its OWN unchanged
  dial and turned out nearly immune to `enemyMult` in the 3.04–3.2 range (98% at
  both ends) — a `choke` shape on the smallest board plateaus hard near the top;
  a much bigger jump (3.60, tested off-table) broke 90%, but that blows past
  kaldan's own dial and would cascade into tier 2 for no reason. Fixed with the
  OTHER tier-2 lever instead: `siteCounts.neutral` 4→5 (more neutral reads
  HARDER — this file's own words two paragraphs below have it backwards, see
  the correction there) alongside a monotonic-ceiling bump to 3.19 reads 90%.
  **Saltmere** had to follow to 3.19 to stay non-decreasing, and reads 79% —
  inside the floor but tight; wants an n=96/240 confirm before it is trusted at
  that edge. **Emberholt** (the tier-2 finale) read 54% (floor 66), unrelated to
  anything upstream: `enemyMult` 3.74→3.60 reads 69%. **Greywater** read 63%
  (floor 66, only ~1 SEM short, so this may have been noise) — eased with
  neutral 7→6 anyway since the fix cost nothing, reads 75%.

  **A CORRECTION TO THE TIER-2 HEADER'S OWN CLAIM**, found while chasing
  ironwood: "neutral is a difficulty knob that moves the WRONG way (more
  neutral reads EASIER)" is backwards. `regions.provenance.js`'s own TIER-2
  section has it right ("greywater at 7 neutral reads 66%, at 9 it reads 54%"
  — MORE neutral is HARDER), and this session's own measurements agree in both
  directions: raising ironwood's neutral 4→5 made it HARDER (98%→90%), and
  cutting greywater's 7→6 made it EASIER (63%→75%). The row comment at tier 2
  needs its own wording fixed to match its cross-reference; flagging here
  rather than editing blind, since the phrase is repeated in more than one
  place and this session did not have time to hunt every copy.

  **TIER 3–6 (fifteen rows): NOT a result. Read every dial here as a
  binary-search midpoint**, same caveat the inherited state carried into this
  session. What changed and why, so the search resumes from here:

  - `targetLengthMin` raised off its stale pre-melee promise (was 6–9m, now
    16–20m across the board) so `hardCapMs` stops pinning these battles to a
    clock that a slower, contested-tile campaign cannot resolve inside.
  - `develop` cut for tiers 4–6 (was 2.45–3.30, now 2.10–2.32) after DIAGNOSING
    — not just reproducing — the inherited "dominant position, castle never
    sieged" finding. Verified it reproduces exactly: thanescar, gate 0.05 AND
    0.6, cap forced to 70 minutes, seed 16838 — 87% territorial control,
    `castleUnderSiege: false`, HP 941/941 (full), identical result at both
    gates. **The mechanism**, traced with a direct probe against the real
    `buildBattleConfig`/`startBattle` pipeline (a hand-cloned region spec
    silently falls back to defaults and gives a WRONG pool/level answer —
    learned that the hard way mid-session; always pass `enemyMix`/`enemySites`/
    `playerSites`/`neutralSites` explicitly when cloning a region for a probe):
    a Marshal (`banner` +25% def, `trainBuff` +40% training, tier 4+) sits on a
    castle that is **never attacked for the whole battle** in these seeds, so
    it trains against zero attrition. Measured: thanescar's castle garrison
    ranges 96–241 over twenty minutes; the single biggest site the player
    holds NEXT TO that castle never exceeds 11–30 over the same span — nowhere
    close to the 1.5× first-strike margin `bestAssaultTarget` requires to even
    OPEN a siege on an unbesieged target. Contrast gallowmoor (tier 3, no
    Marshal): castle garrison stays 8–48 all battle, so raising its cap alone
    worked (6%→33%→50% as the previous session's own scratchpad found). This
    is NOT the already-fixed `--nothrone`/`siegeBudget` defect — budget was
    ample in every one of these seeds; the siege was never attempted, gate
    satisfied or not. `tools/simplayer.js`'s own `advanceDistance` comment says
    consolidation is meant to out-pace exactly this ("nothing caps the sink...
    the throne is the one target that needs more bodies than a farm can
    build"), so this reads as a race the melee layer tipped against the
    player for a Marshal'd, unattacked throne specifically — not a hard wall
    (gravenreach/nightharrow, same Marshal count, still land occasional wins),
    but a real, weak-to-`enemyMult` difficulty source distinct from clock or
    power. **`develop` cannot buy a level-2 castle for tier 4+**: karrowmere
    (tier 3's last row, no Marshal, already `develop` 2.08) rounds its OWN
    castle to level 3 today, and `develop` is non-decreasing — so tier 4+
    cannot go below that floor. What the cut still buys is fewer of the
    OTHER forts (strongholds/training grounds) riding past the castle's own
    level; isolated on thanescar alone (enemyMult unchanged), this took it
    from ~0% to 17% at n=24.
  - A further, modest `enemyMult` cut (~-0.15 to -0.20, keeping headroom over
    karrowmere's 4.48) was tried on top and read AMBIGUOUSLY: thanescar 29%→
    21%, gallowmoor 38%→25% — both moved the WRONG direction for a cut that is
    supposed to make things easier, which at n=24 (SEM ≈10 points) is
    consistent with pure noise rather than a real effect. Reverted back to the
    smaller cut (which measured better, for whatever that is worth at this n)
    rather than chase a lever that does not respond in a stable direction.
    **Do not keep spending `enemyMult` on the Marshal-affected rows** — the
    diagnosis above says the bottleneck is a consolidation race, not a power
    ratio, and the data here is consistent with that: `enemyMult` moved
    nothing predictably once the develop cut was already in.
  - Giant caps were deliberately NOT chased for the worst-affected rows: the
    inherited scratchpad already showed a 53-minute cap does nothing for
    ravensmarch that a 26.6-minute one didn't (0/8 either way), so spending
    sim wall-clock pushing `targetLengthMin` further on thanescar/ravensmarch/
    stormhalt specifically is not expected to pay off. Caps were raised to
    something real (16–20m) rather than left stale, not pushed to extremes.

  **COMPLETE re-measurement at n=24 (noisy — treat as a screen, not a
  result)**, after the develop cut and the smaller `enemyMult` cut — all
  fifteen tier 3-6 rows, `widowsgate` included (it finished just as this was
  being written; the biggest board in the game, and this environment spent
  over ninety CPU-minutes on it before it landed a number):

  ```
  tier 3   gallowmoor 38  sunder 25  vaelstrand 17  duskfell 17  karrowmere 38
  tier 4   thanescar 29  blackspire 29  ironcrown 38 ok  obsidian 42 ok
  tier 5   ravensmarch 17  gravenreach 42 ok  nightharrow 29 ok
  tier 6   stormhalt 8  cinderwatch 13  widowsgate 4
  ```

  Every row IMPROVED from its pre-session reading (thanescar 2%→29%, stormhalt
  0%→8%, gallowmoor 17-23%→38%, widowsgate presumably from the 0/48 the
  brief's own `campaignplay` floor recorded). Four rows already clear their
  own band — ironcrown, obsidian, gravenreach, nightharrow — and all four are
  `ok` entirely on the SAME `develop` cut and modest `enemyMult` cut applied to
  every row in their tiers, so the lever is real and not a fluke of one map.
  Eleven rows are still below their tier's floor: all five of tier 3
  (gallowmoor/sunder/vaelstrand/duskfell/karrowmere), half of tier 4
  (thanescar/blackspire), ravensmarch, and all of tier 6
  (stormhalt/cinderwatch/widowsgate) — **widowsgate at 4% is now the single
  worst row in the whole re-measured table**, worse than stormhalt, and NOT
  explained by `enemyMult`: its cut (5.10→4.90) is one of the LARGER cuts
  among the three tier-6 rows, not the smallest (see the tier-6 detail
  below), and all three rows carry the same two Marshals. The likelier
  suspects are its board (21×16, the biggest in the game) and its site
  count (`enemyMix` forts=3 against its tier-mates' 2).

  **Two shapes worth carrying into the next pass, both visible only once the
  sweep filled in:**

  - **Tier 4 SPLITS exactly down the middle** on an otherwise-uniform cut —
    thanescar/blackspire (15 neutral) read 29% and ironcrown/obsidian (19/20
    neutral) read 38%/42%, which is backwards from "more neutral is harder" on
    its own unless something else about those two rows is also carrying them.
    Worth a fresh look rather than another blanket tier-4 dial move.
  - **Ravensmarch is tier 5's one bad row, by a wide margin** (17% against
    gravenreach 42% / nightharrow 29%) — matching what the inherited n=8
    quickscreen already hinted (ravensmarch alone read 0/8 at BOTH a 53-minute
    and a 26.6-minute cap, where gravenreach/nightharrow landed occasional
    wins). Whatever is different about ravensmarch specifically — not
    "tier 5" generally — is where the next enemyMult-adjacent look should go,
    if one is tried at all; see the "do not re-spend enemyMult" note above.
  - **Widowsgate (4%) is now the single worst row in the table**, worse than
    stormhalt's 8% — NOT explained by the `enemyMult` cut, which was applied at
    almost the same proportion across all three tier-6 rows (stormhalt
    4.95→4.78, cinderwatch 5.05→4.85, widowsgate 5.10→4.90 — stormhalt's is
    actually the smallest of the three, both in absolute and proportional
    terms, which rules that column out as the explanation). What IS different
    about widowsgate is the biggest board and the most site count in the game
    (21×16, `siteCounts.enemyMix` forts=3 against tier 6's other two rows'
    2), plus two Marshals same as its tier-mates. If tier 6 gets another look,
    start there rather than at stormhalt, which this pass already knew was
    hard for real reasons (CLAUDE.md's own 60-minute-cap diagnostic, outright
    losses inside
    eight minutes on two of three seeds).

  **Do not treat any of this as final** — it is n=24, and this file's own
  standing rule is that n=24 has roughly a ±10-point standard error, so
  "still below floor" is a much safer read than the exact number. The four
  acceptance test files (`scout`, `tactics`, `loadoutdominance`,
  `campaignplay`) were NOT re-run this session — each needs ≥180s alone and
  several run real battles on these same tiers, so re-taking them against a
  table this unsettled would only measure today's midpoint, not tomorrow's.

  **What a future session should do, in order:** (1) re-take all fifteen
  tier 3-6 rows at n≥96 before changing the dial further — four of them may
  already be fine and the noise band at n=24 is wide enough that a couple of
  the "below floor" reads could join them, though widowsgate and stormhalt
  read too far below floor for that alone to be the explanation; (2) look at
  WHY tier 4 splits and whether ravensmarch's and widowsgate's gaps have a
  cause narrower than "their tier" before reaching for another campaign-wide
  move; (3) for rows still below floor after that, do not reach for
  `enemyMult` first — reach for `siteCounts.neutral` (a real, if bounded,
  lever both directions, confirmed this session) or accept the Marshal
  residual and say so; (4) re-run all five acceptance files one at a time,
  from a clean worktree if `regions.data.js` is dirty.

  **⚠ FOUR TEST FILES ARE RED, NOT ONE, AND THEY ARE ONE ROOT CAUSE.** Measured
  against a pristine checkout, each long harness file run alone: `harness` 11/0 ok,
  but `scout` ("never completed a single watchtower across twelve tier-5/6
  battles"), `tactics` ("only 6 squads carried a rider at all"), `loadoutdominance`
  and `campaignplay` each fail one test. All four run real battles on the tiers
  where the table no longer holds, so all four are the re-tune's acceptance test
  rather than separate work — **but two of them read like independent defects.**

  **`loadoutdominance` is the trap.** Its own failure message offers two readings and
  invites the wrong one: *"Either somebody FIXED the dominant loadout — in which case
  re-take these numbers, retire this framing and close the bullet in CLAUDE.md — or
  the weights stopped reaching the battle."* Neither happened. The figures are default
  **17%**, mono **25%**: the gap closed because the DEFAULT SPREAD collapsed to
  gallowmoor's out-of-band 17%, not because the exploit got weaker. A test that
  reports a real regression in the vocabulary of a fix is worth knowing about — this
  is the same shape as the harness declining to play and reading as a balance win.

  **And they are only visible one file at a time.** `npm test` exits 0 having printed a
  truncated TAP stream when several sessions share the machine — twice in one session,
  once with no summary at all. `for f in tests/*.test.js; do node --test "$f"; done`
  with a per-file timeout is what actually reports; the five harness files need ≥180s
  each, and balance-sensitive ones must be run from a clean worktree
  (`git worktree add --detach <dir> HEAD`) if `regions.data.js` is dirty, or they
  measure somebody's in-flight probe.

  **`campaignplay` IS RED, so the Pages deploy is gated until this lands.**
  `nightharrow` and `stormhalt` are won 0 times in 48 — but every one of those runs is
  a `timeout` at exactly the hard cap with NO defeats and several ending ahead on
  territory, so they are unfinishable rather than unwinnable. Full table and the
  per-seed evidence at "A fight takes time" above.

  **Start from the signature, not the win rate.** `losses=0` with thirty-one timeouts
  while AHEAD is a bot running out of clock, not one being beaten — so the first lever
  is `targetLengthMin` (which derives `hardCapMs`, so the promise and the cap are the
  same number), not `enemyMult`. Two things are already measured and should not be
  re-spent: `MELEE.seconds` is worth ~2 points a second (2s versus 6s is six points on
  gallowmoor and eight on thanescar, with the all-run median pinned at the cap either
  way), and the clock-reset bug that was masquerading as balance cost is fixed.

  **A warning about method, learned here.** There are no wins on those two rows, so
  there is no win-median to author `targetLengthMin` FROM — the usual procedure has no
  input. The order has to be: raise the caps first (or measure with them lifted), get
  win-medians, then set the advertised lengths from those and re-confirm. Setting a
  promise blind, from a region that has never once been finished, is a guess wearing
  a measurement's clothes.

  The honest open question is fight COUNT: interception creates fights that did not
  exist before, and that — not per-fight duration — is where the length went. Nobody has
  measured how many, which is the first thing to instrument.

- ~~**THE CAMPAIGN RE-TUNE (second pass), against the finished battle layer.**~~
  **Closed.** It reopened when the battle redesign changed the ground under every
  measured number — marches twice as long, hostile territory twice as costly, a
  corner camp, buildings that shoot, construction gated on territory — and it was
  deliberately left open through the vision work rather than tuned twice. One honest
  pass at the end, exactly as planned.

  **All twenty-four report `ok` at n=240**, against their tier's `WIN_BAND` *and* their
  advertised length, in campaign order — re-confirmed after the siege frontage:

  ```
  tier 1   riverfen 88  ashford 86  ironwood 89  saltmere 80
  tier 2   kaldan 75  highmarch 79  greywater 74  thornmoor 75  emberholt 71
  tier 3   gallowmoor 70  sunder 64  vaelstrand 63  duskfell 71  karrowmere 56
  tier 4   thanescar 44  blackspire 52  ironcrown 50  obsidian 52
  tier 5   ravensmarch 35  gravenreach 33  nightharrow 32
  tier 6   stormhalt 31  cinderwatch 24  widowsgate 30
  ```

  **Re-confirmed a second time after the RAM SLOT REPRICE** (`UNIT_SLOTS.rams` 5 → 3),
  which is where the tier-3-and-up numbers above come from. That change is worth ~+10
  across tiers 3–6 and ~0 at tiers 1–2 — a 12-slot opening budget carries no rams to
  make cheaper — so the dial rose on regions 10–24 only: gallowmoor 4.08 → 4.16 through
  widowsgate 5.48 → 5.64, plus karrowmere's neutral pool. `duskfell` (71) and
  `gallowmoor` (70) ship within two points of their tier ceiling, which is the tightest
  pair in the table; re-check them first if anything downstream moves.

  **The frontage cost four numbers and no more**, which is the useful figure: it is a
  rule that is provably inert below forty bodies, so most of the table did not notice.
  What moved was `highmarch` and `greywater`'s dials (3.38 → 3.32, 3.40 → 3.34),
  `saltmere` (3.08 → 3.05 *and* neutral 4 → 3, which nearly cancel — see
  `tests/world.test.js`), `thanescar`'s `develop` (2.20 → 2.45, the only column it had
  left) and `ravensmarch`'s neutral pool (20 → 18). The pattern is that it costs the
  regions taken with a CROWD — tier 1, where a landing force has almost no engines in
  it, and the back half, where the stacks are biggest. The incursion ladder measured
  unmoved (92/85/67/44/17/2 at n=48 against a recorded 96/81/65/40/10/0) and needed no
  `baseDial` change, because the ladder is fought with the default spread and the
  default spread brings rams.

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
- **ABDICATION DESTROYS RELIC-BOUGHT BOOSTER CHARGES, and `prestige.js` contradicts itself
  about whether it should.** `meta.boosters = {}` on reset, and every entry in
  `BOOSTER_SHOP` is `currency: 'relics'` at 1–3 relics a charge — up to ~27 relics of stock
  evaporating per reset. The file lists "booster stock" under Gone, and then eight lines
  later states the governing rule: *"relics are the PLAYER's, like the ladder they are
  half-earned from, and so is what they bought; crowns and everything crowns bought are the
  RUN's"* — which is also the exact "a hard currency whose purchases evaporate is a rental,
  and the player will hoard it and never spend" failure the same file warns against.
  `march` and `fortify` need no unlock, so their charges are pure relic value. The "booster
  stock" line looks stale relative to the crowns→relics repricing, but that is a guess:
  **this needs an intent decision, not a patch.** Left alone deliberately.
- **`site.garrison` is still unvalidated at the seam**, which is the same shape as the
  `expedition` hole the audit closed — a string count would concatenate into live sim state.
  It was not part of that pass. Same file, same fix pattern (`checkComposition`).
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
- **The loadout has a dominant answer, and after the battle redesign the biggest half
  of it is simply LEAVING THE RAMS AT HOME.**

  **⚠ READ THIS FIRST: THE EXPLOIT CANNOT CURRENTLY BE MEASURED, AND THE REASON IS THE
  CAMPAIGN RATHER THAN THE LOADOUT.** Re-taken on the mid-retune table (n=24, matched
  seeds; kaldan also at n=48):

  ```
  region        band     default   mono   gap    medians          tempo ratio
  kaldan       66-84       73%      81%    +8    9.7m -> 8.2m        0.85
  gallowmoor   50-72       38%      38%     0   24.6m -> 13.7m       0.56
  thanescar    34-56       29%      33%    +4   17.3m -> 14.0m       0.81
  ravensmarch  22-42       17%      13%    -4   26.2m -> 10.2m       0.39
  ```

  **A GAP IS A DIFFERENCE BETWEEN TWO NUMBERS AND SAYS NOTHING WHEN ONE OF THEM IS
  BROKEN.** Every mid and late row's DEFAULT spread is below its own tier floor, so not
  one of those gaps is readable — the mono army did not get worse, the honest army fell
  to where a mono army cannot beat it by much, because both are losing. Gallowmoor's
  zero and ravensmarch's MINUS FOUR are the campaign's dial reporting itself in the
  vocabulary of a loadout bug, which is the same shape as "the harness declined to play
  and it read as a balance win".

  **Kaldan is the only in-band row, and it is the CONTROL, not the pin.** A critic
  proposed pinning the exploit to it at a reported +25; it reads +12 at n=24 and **+8 at
  n=48**, landing exactly on the `+0 / +8` this section already records for it. That
  agreement is the strongest available evidence that kaldan is behaving as it always
  has — and that pinning the exploit there would encode the opposite of the defect.

  **The TEMPO half has weakened too**, which is new and is why `tests/loadoutdominance
  .test.js` no longer asserts it at a number: ravensmarch and gallowmoor still "delete
  the battle" (0.39 and 0.56 of the honest army's time) while thanescar and kaldan read
  0.81 and 0.91, where mono is merely quicker. A single threshold across those four
  would fail on the campaign's dial rather than on the loadout. That test now asserts DIRECTION on every in-band row
  (mono must not be worse, and must not be slower — an inversion is a bigger event than
  a fix) and MAGNITUDE only where a baseline is healthy and is not the control. Today
  that leaves the magnitude claim with nowhere to live, and it says so loudly rather
  than passing quietly.

  **So: re-take this whole section after the campaign re-tune, and do not read any
  number below as current.** What follows is the last measurement taken on a table that
  was in band. n=48, matched seeds:

  ```
  region        default   no rams   mono militia    no-rams gap   was
  kaldan          75%       75%        83%             +0         +0
  gallowmoor      71%       85%        98%            +14        +25
  thanescar       48%       65%        92%            +17        +25
  ravensmarch     42%       63%        85%            +21        +30
  widowsgate      48%       44%        81%             -4        +23
  ```

  **The `no rams` column is the cheapest half of the exploit and the RAM SLOT REPRICE
  halved it** (mean +20.6 → +9.6), turning it negative at tier 6 — bringing engines is
  now strictly right at the last gate. The full mono-militia exploit went +43.2 → +31.0
  mean and is NOT fixed: it is still +27 to +44 from gallowmoor on. Kaldan is the
  control at +0/+8, so this is a late-campaign hole, not a global one. Pinned by
  `tests/loadoutdominance.test.js`, which encodes it as a DEFECT and fails informatively
  in both directions.

  **Re-taken after the SIEGE FRONTAGE shipped, and it is unmoved.** The mono gaps on the
  four rows the re-tune did not touch read +8 / +36 / +61 / +63 against a pre-frontage
  +10 / +40 / +65 / +67 — noise. (Thanescar's row moved for its own reasons, so its gap
  is not comparable.) That is a much sharper negative result than it sounds, and it is
  worth more than a fix would have been: **the frontage removes SIEGE from the question
  entirely** — a crowd's structure damage is now capped at 24 dps where the default
  spread's rams do 276 — and the gap did not move at all. So the mechanism is field power
  and tempo, full stop, and "give siege a scarcity headcount cannot buy" is spent as an
  answer to the loadout. It remains the right fix for `breachSeconds`; it is simply not
  this.

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
  bodies, 32% more field power, at *equal* siege output — the spread's 23 rams made 276
  siege DPS and 471 militia made 283, so rams bought siege the militia already had for a
  third of the field. That was the same finding as "`breachSeconds` stopped binding"
  from the other end, and the frontage has since fixed both halves of it *without*
  moving the gap — so "tempo" now means field power and nothing else.
  And **nothing in the game is sensitive to concentration** — `battle/aiadapt.js`
  counter-picks by `argmax`, so the share of production it commits does not depend on how
  dominant the dominant unit is. That was recorded as the obvious gap to close; it is not,
  because there is no concentration difference left to read by the time it could act (see
  the concentration bullet below). The enemy is also down to ZERO training grounds by
  t=3min against mono — it is not out-fought, it is out-raced.

  **⚠ AND IT IS NOT MARCH SPEED EITHER — that was the third fix built, measured and
  reverted.** `slowestSpeed` is a hard `Math.min`, and it is the ONE stack-wide term in
  the game that is not share-scaled (`counters`, `sunder`, `repair`, `skirmish` all
  are), so one ram among 347 bodies imposes the whole ram penalty. Replacing it with the
  slot-weighted harmonic mean makes the default spread **1.6× faster** (2.53 → 1.59
  s/hex) and — uniquely among every candidate tried — *cannot* help the exploit, because
  a one-type stack's weighted mean is its only member. Measured at n=48 on the five
  regions above: 75/58/58/29/27 → 79/54/52/40/23, a net **+1 point**, and the mono gap
  went 43.6 → 44.8 average. Sixty percent more speed bought nothing at all.

  That is the useful half: **the ram's cost is entirely its SLOTS**, not its legs.
  Dropping rams is worth +23 to +40 even with the speed penalty weighted away — the same
  finding as the DPS arithmetic above, arriving from the other direction. The comment at
  `battle/movement.js slowestSpeed` carries the table so nobody re-spends it.

  A per-type slot-share cap was built and measured (69%/56%, default spread
  byte-identical) and then **reverted**, because it contradicts the carry contract ten
  tests encode — do not re-spend that either.

  **⚠ AND IT IS NOT SIEGE SCARCITY, which was the standing prime suspect and is now
  spent.** "Make siege scarce again" was the recommendation this file carried for a long
  time, on the reasoning that rams measure as a straight loss *because* `breachSeconds`
  stopped binding, so fixing one would fix both. Half of that is true: `SIEGE_FRONTAGE`
  fixed `breachSeconds` outright and re-priced rams by a factor of twelve. The other half
  is false. The gap did not move (see the re-take above), and it did not move under a
  change that removed siege from the question **entirely** — a crowd is now capped at 24
  structure dps against the spread's 276. Whatever mono-militia is winning with, it is
  not siege output.

  **THE MEASUREMENT NEARLY SAID OTHERWISE, and how it broke is the transferable part.**
  On the first reading the frontage looked like it closed the exploit at tier 6:
  widowsgate mono fell 94% → 25%. It had not. `simtactics.js bestAssaultTarget` walks
  away from any siege over 90 seconds, a rule that had never once bound at a castle
  because a crowd used to break any throne in about five — and the frontage put
  widowsgate's throne at 128s, so the bot simply stopped assaulting it, timing out
  **thirty-five sites ahead** with the region won everywhere but the gate. Teaching it to
  commit to a throne it can take before the clock runs out put mono back at 92%. A
  harness declining to play is the same class of defect as a harness that cannot play
  (`upgradeTurn`, `constructTurn`, `scoutTurn`) — and this one broke *toward the result
  somebody wanted*, which is the worst way for a measurement to break. `--nothrone` and
  `tests/throne.test.js` keep it re-takeable.

  **⚠ AND THE CONCENTRATION LEVER IS SPENT TOO — its premise is measurably false.**
  "Scale `counterShare` by how dominant the dominant unit is" was ranked top of the
  ROADMAP for one property: it would bite a mono army and leave the default spread
  untouched *by construction*, so it could ship without re-tuning 24 regions. That
  property does not exist. Read straight off the enemy's own `learnedPlayerComp`:

  ```
  share of the player's army that is MILITIA, as the enemy sees it
                 t=1m   t=2m   t=5m
  default        80%    95%    95%
  mono militia   99%    99%    99%
  ```

  **Both loadouts are the same army by minute two.** The 46% in the old write-up
  describes the LANDING FORCE, which the enemy never sees as such: the player captures
  yards and trains militia in them, so by the time the counter-pick has any data to act
  on, the "spread" is 95% militia. A dominance-scaled share sees 95% against 99% and
  cannot separate them. Built anyway, in its strongest defensible form (share scaling to
  1.0 above 98% dominance, *and* releasing the spear backbone at that point, which breaks
  a pinned invariant): gallowmoor 60→56 default / 96→92 mono, karrowmere 60→63 / 98→96,
  ravensmarch 33→33 / 94→90. **Gaps +36/+38/+61 → +36/+33/+57** — noise, and the default
  spread paid for it. Reverted.

  **The corollary is the useful part, and it retires a whole CLASS rather than a knob:
  no mechanic keyed on what the player FIELDS can address this**, because the two armies
  it would have to tell apart are identical from two minutes in. The gap is created
  entirely in the opening, by the landing force — which is the same conclusion "the
  mechanism is tempo" reached, arriving from a third direction.

  **⚠ THE ONE THING THAT HAS WORKED IS THE RAM'S SLOT PRICE, and it worked because it
  acts on the LANDING FORCE.** `UNIT_SLOTS.rams` 5 → 3: the frontage re-priced what a ram
  DOES and nothing re-priced what it COSTS. It is the only candidate with the property
  the concentration lever was ranked for and turned out not to have — a mono army brings
  no rams, so `distributeExpedition` returns a byte-identical force and the exploit
  cannot be helped **by construction** (verified: the `no rams` and `mono` columns above
  are identical before and after, run for run).

  Two things about it are worth more than the win rates. It is a **THRESHOLD, not a
  slope** — cost 4 is inert (75/60/46/27/31 against 75/60/46/33/29 at cost 5) and cost 3
  bites, because what matters is whether the extra line troops carry an assault over
  `ATTACK_MARGIN`. And it is a **region-dependent** knob, which is why it cost a full
  re-tune rather than a dial nudge: engines matter in proportion to how much wall a
  region has, so the same reprice was worth +14 to duskfell and +3 to karrowmere on the
  identical dial. It re-weights the campaign's relative difficulty, not just its level.

  **Seven fixes measured, five rejected, two shipped: two militia nerfs, a slot-share
  cap, share-scaled march speed, and the concentration counter-pick are dead; the siege
  frontage shipped for `breachSeconds` and the slot reprice shipped for this.** Anything
  proposed next should say which of those seven shapes it is not, and it should act on
  the landing force, because that is the only place the two armies differ.
- ~~**Ownership's second channel is half-built.**~~ **CLOSED, both halves.**
  `render/ownerDash.js` did the site STROKE (solid yours, dashed theirs, fine dotted
  for nobody's and for a fogged ghost). The other half was the territory FLOOD, which
  is most of what the board actually is: `hexRenderer.js ownerWeave` now lays a stripe
  pattern over each faction's fill, leaning opposite ways, so ownership survives
  greyscale and every colour-vision deficiency. One path and one fill per faction —
  the same batching the fills already use — on the background canvas only. Neutral is
  refused *at the point of drawing* rather than merely absent from the pattern map,
  because "nobody's" is the absence of a claim and texturing it would make unclaimed
  ground read as a third side.

  **Two things it cost, and both were measurements rather than opinions.** The first
  cut striped in BLACK, on the reasoning that darkening cannot tint — and it is
  invisible: the flood is `--a-flood` 0.2 over near-black ground and the fog veil
  halves what is left, so a dark stripe has no headroom. White has the whole dynamic
  range of a dark board. And the number that settled it was the NEGATIVE CONTROL, not
  the raw contrast: measured off a real battle screenshot, the board's own plates,
  scrub and lattice already have a grain, so faction-coloured patches lean **−0.35**
  with the weave off and **+0.40** with it on. The sign flip is the feature; the
  magnitude is how much other texture it competes with. Measuring only the "after"
  number would have reported a healthy 1.7 for a feature that was doing nothing.
- ~~**`breachSeconds` stopped binding around region 8.**~~ **CLOSED** — `SIEGE_FRONTAGE`,
  see "A wall has a frontage" above. 33 militia out-paced a level-5 castle's repair and
  landing budgets reach 703 slots, so the mechanism the whole design rests on gated
  nothing late; a crowd was a siege train and that is why rams measured as a straight
  loss. Both halves were always one defect seen from two ends. 700 militia against a
  level-5 castle now read 385s where they read 5s.
- **The harness player is poorer than any real one**, in both currencies. `metaFor` grants
  one region's worth of idle income and never raids; a player who simply plays back-to-back
  banks 2.29M crowns by region 24 against the harness's 464k. At `--idle=50` the last region
  goes from 25% to **85%**, so tiers 4–6 may be walkovers the table cannot see. Relics are
  the same gap with a smaller number and a new flag: `--relics=14` (region 10's honest
  holding) is +7 on gallowmoor, `--relics=78` is +25. Both are now re-takeable rather than
  remembered, which is the only part that was ever actionable.
- Dead seam fields with no reader: `ramImpactHp`, `rules.isRaid`, `rules.targetLengthMs`.
- ~~**`meta.stats` tracks thirteen lifetime counters and no screen shows one of them.**~~
  **CLOSED.** `meta/record.js` derives, `screens/mainmenu-record.js` renders, and the
  drawer computes nothing — a screen that derived its own win rate is a second
  implementation of the rule whose only test is squinting at a menu.

  **Three things it decided, and each one is a rule rather than a layout choice.** A
  fresh save's ratios are **null, not 0** — "0% win rate" is a claim about somebody who
  fought and lost, and a new save has not fought; the drawer renders null as an em dash.
  Win rate is over BATTLES, not over `wins + losses`, because `losses` counts a loss or a
  timeout and a WITHDRAWAL is neither — taking it over decided battles only would quietly
  flatter every player who has ever pulled out. And a flawless record reads as unknown
  rather than as `∞ : 1`, which looks like a bug rather than like a perfect record.

  **The away figure is a share of TIME and says so.** Nothing counts offline CROWNS
  separately, so an income share would have to be reconstructed from a rate that changes
  every time a region is taken — exact-looking and wrong. Time is what is recorded, so
  time is what it claims.

  Two defects a screenshot caught and no test could: `.menu-empire dd:nth-of-type(2)`
  out-specifies a bare `.menu-record dd`, so rows two and three of every group came out
  gold and green — which looked deliberate and was not. And the drawer is the first one
  tall enough to overflow a laptop window, where both obvious layouts fail: letting
  `.dialog` scroll the whole thing puts the title off the top as soon as anything lower
  is focused, and giving the drawer its own scroller nests two. Only the middle scrolls;
  title and Close are always on screen. **`tools/smoke.mjs` failed on the version where
  Close sat below the fold**, which is exactly the class of bug it exists for.
- **`split` is uncalibrated, and unlike `branch` it has no knob.** Grouped by silhouette
  against the middle of each region's own band, all three `split` regions read −6 —
  saltmere, sunder and gravenreach, identically. `branch` was −11 and was fixed by
  `branchTrunk` (see the region-shape section); `SQUEEZE` has no `split` entry at all, so
  this one is recorded rather than solved. Either give it a parameter or write down why
  it should not have one.
- **A short session has nothing to do in it.** A battle is 7–15 undistracted minutes and
  passive play loses on purpose, which is what stops the idle half being used to skip the
  real-time half.

  **⚠ THIS BULLET USED TO SAY "down to two sites inside two minutes" AND THAT IS WRONG
  ON BOTH COUNTS.** Re-measured on a fresh save with no input at all: the region reaches
  two sites at **t≈237s**, not 120, and then *plateaus there for the rest of the ~18
  minute cap* — the camp is never broken, 142,000 battle gold piles up unspent, and it
  ends on `Time expired · Decided on territory when the hard cap ran out`. So passive
  play does lose, and the argument above survives intact; what is false is "fast". It is
  a twenty-minute stall that ends on copy reading as a clock problem rather than as "you
  never attacked", which is worse for a confused new player than a quick defeat would be.
  Recorded here rather than fixed, because the cheapest honest answer is the results copy
  and not the simulation.

  But a raid is a whole battle and an incursion rung is
  a whole battle, so there is nothing a player can do in ninety seconds except collect
  income and buy an upgrade. Half of this was built and merely unadvertised and is now
  fixed (the battle autosaves and resumes for twelve hours; Withdraw now says so). The
  other half is open, and it is the least-explored axis in the design.
- **The service worker has no install affordance.** The manifest, the icons and the
  worker are all there, so the browser's own install prompt is the only route in;
  `beforeinstallprompt` is not captured, so there is no button anywhere that says the
  game can be installed.
- ~~`tools/checksize.js` does not cover `.mjs`, so `tools/smoke.mjs` is 625 lines against a
  400-line cap and `npm run check` reports ok.~~ **CLOSED.** `EXTS` gained `.mjs`, which
  meant paying the 663 lines `smoke.mjs` had reached by then: it is now a 95-line entry
  point over `smoke-helpers`/`-battle`/`-orders`/`-checks`/`-meta`, split along what it
  tests rather than at a line number, with the step list diffed before and after to prove
  the integration check is unchanged. Invariant 4 is now actually enforced everywhere it
  claims to be — `.mjs` was the only extension escaping it, and only one file was over.
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
