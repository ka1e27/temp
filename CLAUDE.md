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
src/battle/    pure: the simulation — combat, siege, movement, economy, AI
src/meta/      pure: world map, idle income, upgrades, save/load
src/content/   pure data: all tuning numbers, regions, units, strings
src/render/    canvas 2D
src/screens/   DOM scenes
src/ui/        DOM helpers, formatting, coach marks, dev overlay
```

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
`CONTRACT_VERSION` (currently 2).

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

**`n=12` (the CLI default) is far too noisy to tune on, and has hidden real mis-tunes three
separate times.** Kaldan's long-standing "58% ok" was an n=12 artefact; one build measured
52% at n=120 and 57% at n=240; `ironcrown` read 54% at n=48 and 57% at n=240. Tune at
**n≥96**, confirm anything within ~8 points of the 55% bar at **n=240**, and use
`--all` at low n only as a smoke check. Some medians sit on a cliff — kaldan pegs the hard
cap in ~40% of runs — so a median can jump discontinuously between sample sizes.

**The difficulty dial must rise in the same steps the PLAYER does.** The shop buys
cheapest-affordable-first and crowns compound ~1.3× a region, so combat multipliers arrive
in lumps every second region (+15.4% into greywater, +14.3% into emberholt, 0% into
highmarch/thornmoor/gallowmoor/thanescar/obsidian). A smooth `enemyMult` ramp against that
produces a 27-point sawtooth. Check the player's `unitAtkMult × unitDefMult` step off real
`buildBattleConfig` output before blaming a region.

Two related traps in the same area: `develop` is quantised on the **castle**, because
`developLevels` promotes best-first and the best fort is the throne — one castle level is
worth ~26 points, so where the fraction lands matters more than how big it is. And a unit
unlock can make the landing force *smaller* (rams cost 5 slots a body: 54 → 48 into
thornmoor), so the player's step into that region is negative.

## OPEN WORK ITEM: the harness never upgrades sites, and it is worth 27–38 points

**Every balance number in this project is measured against a player who ignores a whole
mechanic.** Read this before trusting any win rate, and before doing another balance pass.

`tools/simplayer.js` issues no in-battle `UPGRADE` command — ever. (It *does* buy meta
shop upgrades via `shopListing`/`buy`; those are a different system.) Confirmed
behaviourally, not just by grep: instrumented battles across riverfen / kaldan /
gallowmoor / obsidian, 8 seeds each, reached **level 1 in 32 of 32 runs**. `ai.js`,
`aicore.js` and `aihome.js` never upgrade either.

So `SITE_LEVELS` (5 rungs) and all four `SITE_UPGRADE` steps are unexercised by every
measurement this project has ever taken.

**It is not an affordability problem.** Total gold earned across a whole battle: riverfen
5.4k, kaldan 16.5k, gallowmoor 13.4k, obsidian 44.5k. Maxing one site L1→L5 costs 3.7k —
8% of an obsidian battle. The bot sits on a mean **800–7,000 spare gold** it never spends.

**Measured cost of the gap.** A forked bot with a modest policy (upgrade a safe rear site,
cheapest step first, only with 400 gold spare), n=48:

| region | no upgrades | upgrading | Δ |
|---|---|---|---|
| kaldan | 73% | 100% | **+27** |
| gallowmoor | 71% | 94% | **+23** |
| karrowmere | 58% | 94% | **+36** |
| ironcrown | 54% | 92% | **+38** |
| obsidian | 65% | 92% | **+27** |
| greywater | 92% | 98% | +6 (ceiling) |
| saltmere | 100% | 92% | **−8** |

Two things follow. Every shipped win rate is a **lower bound on real player power**, and
the gap **widens toward the endgame** (+6 at region 7 vs +38 at region 17) — so the back
half of the campaign is more over-tuned than the front. And that `saltmere −8` is the
warning: a *naive* policy makes the bot worse, so a bad policy is its own distortion.

**Why it was deferred rather than fixed.** Turning it on flattens the whole campaign to
92–100%. Restoring a curve from there means re-tuning the five deliberately frozen opening
regions, and choosing *what an ordinary player upgrades* is a design decision — max-levelling
every safe site is optimal play, not ordinary play — whose answer moves the whole table by
27–38 points. That is a bigger call than a balance pass.

**Related asymmetry, same ladder.** The enemy already gets site levels free at mapgen via
each region's `develop`, worth ~50 win-rate points per whole level (see `mapgen.js`
`developLevels`). So enemy levelling is tuned in and player levelling is tuned out.
Teaching the AI to upgrade too would *double-count* the same ladder — the likely right
shape is to price the player's ladder (`SITE_UPGRADE` gold) rather than hand the AI a
matching button.

**Also inert, found while measuring this:** the enemy's `marshal` unlock does nothing. No
`MAPGEN.trainType` produces one and `counterPick` never picks one — removing marshal from
the tier-4 roster changed thanescar's win rate by exactly 0 points. Ironcrown's flavour
text ("The enemy fields a Marshal") is currently false.

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
