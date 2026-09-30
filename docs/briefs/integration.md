# Brief — lead integration engineer

(Issued by the lead designer on 2026-09-29. A first engineer started this on Sonnet 5 and
left partial work on disk: `game/app/{autosave,devhooks,idle,perkInfo,stateContainer,tutorial}.js`,
`game/render/{renderer,terrainCache,territory,sites,units,labels,cloudLayer,overlays}.js`,
`game/scenes/timing.js`, possibly more. Review what exists, keep what is good, finish the rest.)

You are the lead integration engineer on the Hex Dominion 2 team. Six engineers have built
the modules (world generation, battle sim, art, fx/audio, camera/input, meta + UI kit). Your
job: wire them into ONE polished, playable game in the browser that honours the lead
designer's play-feel spec. This is the most important job on the team — the whole brief is
that v2 must look far better and play far better than v1.

## Read first (completely)
1. `docs/DESIGN.md` — what the game is.
2. `docs/ARCHITECTURE.md` — layout, contracts, rules.
3. `docs/PLAYFEEL.md` — scene flow, camera behaviour, battle/victory choreography, tutorial,
   perf budget. Implement it.
4. `docs/INTEGRATION-NOTES.md` — what every module ACTUALLY exports and the gotchas
   (elevation contract, terrain chunk recipe, water splats, territory policy, shake, hit
   testing, fx/sfx event mapping, meta mutation semantics, UI component signatures).
5. `CLAUDE.md`, `index.html` (already written by the lead: `<canvas id="world">`,
   `<div id="ui">`, `#boot` splash, fonts, main.css, SW registration), and skim each
   module's source for exact signatures: `game/world/generate.js`,
   `game/render/{camera,tiles,sprites,clouds,palette,fx}.js`, `game/input/{pointer,clock}.js`,
   `game/audio/sfx.js`, `game/meta/*.js`, `game/ui/*.js`, `game/battle/sim.js` (+ `arena.js`,
   `ai.js`, `powers.js`), `game/config/*.js`. Also look at the galleries under
   `tools/gallery/` — `art.js` is the reference for correct terrain/territory/settlement
   drawing with elevation.

## Battle API facts (from the battle engineer)
- `sim.js` never calls the AI: each frame, `issue()` the commands returned by
  `think(battle, battle.t)` (`game/battle/ai.js`) yourself, then `step()` at `TICK_SEC`.
- `battle.events` is cleared and refilled by every `step()`: send, clash, clashEnd, assault,
  capture, arrow, power, firestorm, surrender, end — positions in world units.
- `squadPosition(battle, squad, alpha?)`; `battle.cooldowns[p]` = absolute `battle.t` when
  power p is ready; locked = `player.powers[p] < 1`; site `assault` is `{owner, squads[]}` or
  null. Troop counts are floats — floor only when drawing.

## Environment
- Repo `C:\Users\kyleg\Projects\temp`, Windows, Bash tool (Git Bash), Node 24. Branch
  `redesign`.
- Dev server normally at http://localhost:8080/ (check
  `curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/index.html`; if down, start
  `node tools/serve.js` in the background).
- Screenshots: `node tools/pageshot.mjs index.html screenshots/game/x.png --w=1440 --h=900
  --wait=2500 --eval="..."` (never start a path with "/" in Git Bash; it prints page console
  errors). Read the PNGs and critique them honestly. `tools/cdp.js` drives real mouse/touch
  input for automated checks.
- Other engineers may work in parallel (e.g. balance tuning in `game/battle/ai.js` and
  `game/config/*`). Never edit files outside your ownership; if a module blocks you, work
  around it in your own glue code and list the issue in your report. Never delete/move
  files; never run git commands that change state. Keep each tool call short (run long
  checks in the background) so you never stall.

## You own
`game/main.js`, `game/app/*`, `game/scenes/*`, `game/render/renderer.js`,
`game/render/terrainCache.js`, `game/render/territory.js`, `game/render/sites.js`,
`game/render/units.js`, `game/render/labels.js`, `game/render/cloudLayer.js`,
`game/render/overlays.js`, `index.html` (small edits only), `tools/shots.mjs`,
`tools/check.mjs`, `game/tests/integration.*.test.js`.

## Build order
### Phase A — the living world (do this first, completely)
1. **Boot** (`main.js`): load save via `loadFrom(localStorage)` (wrap storage access in
   try/catch — it can throw), else prepare a new game on New Realm (seed from
   `Date.now()`/crypto). `generateWorld(state.seed, {dynasty})`. Create camera, renderer,
   input, fx, sfx, UI root. Remove `#boot` (add class `gone`, then remove) once the first
   frame is drawn. rAF loop per ARCHITECTURE §9 with `createClock`. DPR capped at 2. Resize.
2. **Renderer**: terrain chunk cache per INTEGRATION-NOTES (8×8-tile chunks, quantised zoom
   buckets — e.g. s ∈ {8, 11, 16, 22, 32, 45, 64} px per unit — baked lazily, blitted scaled
   to the exact zoom; re-bake the visible chunks at the new bucket after zooming settles,
   keep showing the old bucket scaled meanwhile). Territory layer cached per chunk and
   invalidated on ownership change. Water glints, cloud shadows, settlements from a sprite
   cache (per type × owner × s-bucket), banners every frame at `BANNER_ANCHOR`, clouds over
   hidden regions (puff sprites from `getPuffSprite`, drifting; puffs part when a region is
   revealed: scale ×1.6 + fade over 1.4 s), region labels (Cinzel, cream with dark stroke;
   fade out past ~28 px/unit; difficulty chip under frontier regions; crown glyph on rival
   capitals). Frontier pulse outlines, hover highlight, selected-region gold animated
   outline. Must hold 60 fps at 1440×900 — measure frame time, show it in the dev overlay.
3. **World scene**: camera limits from `fitZoom(world.bounds)`, pan clamp, inertia. Tap a
   region → select → region card (data from meta: `difficulty`, income, bounty, perk, owner
   faction); Attack → battle. Accept Surrender → `conquer` + the conquest
   flood/cloud-part/coins choreography. HUD (gold rolling, income), War Council
   (`buy`/`buyMax`, `upgrade` sfx + toast), Realm, Settings (sound, reduce motion, hints,
   export/import, reset), welcome-back card from `offlineEarnings` (≥ 60 s away), idle
   `+gold` pops, autosave every 5 s + on `visibilitychange`/`pagehide`, `state.lastSeen`.
   Idle income always on wall-clock time. `sfx.unlock()` on first pointerdown. Settings
   persisted in the save.
4. **Title scene**: living map behind the title card with the slow drifting camera;
   Continue / New Realm (confirm if a save exists) / Settings. New Realm → camera flies to
   the home region.
5. **Dev mode** `?dev=1`: `createDevPanel` wired (grant gold, reveal map, win/lose battle,
   speed ×8, reseed) and a `window.__hd` debug API (state, world, camera, scene, helpers like
   `selectRegion(id)`, `startBattle(id)`, `winBattle()`, `screenPosOfSite(id)`, `frameMs`).
6. `tools/shots.mjs`: screenshot tour of the REAL game via CDP (fresh profile): title, world
   overview after New Realm, region card open, War Council, settings, a mid-game world (use
   dev hooks to conquer ~8 regions), phone 390×844 variants. Output `screenshots/game/*.png`.

Then STOP and look hard at your screenshots: does the continent look like a premium
hand-painted board-game map? Labels legible, frontier obvious, HUD clean, no seams between
chunks, seamless water, clouds that look like clouds? Fix, re-shoot, repeat. Record frame
times.

### Phase B — battles
7. **Battle scene** per PLAYFEEL §3: `buildArena(world, state.owner, regionId,
   playerBattleStats(...), enemyBattleStats(...))`, `createBattle`, store `state.battle`
   (resumable: on load, if `state.battle` exists, resume straight into the battle), camera
   `flyTo` the arena focus, dim non-arena tiles (cheap: cached mask per chunk or one overlay
   path), per-tile Voronoi ownership inside the target region (tiles belong to their nearest
   site; recolour live on capture with a ripple), sites with badges (pulse under assault),
   squads interpolated with `squadPosition`, drag-to-send with `drawDragArrow` + tooltip from
   `previewSend`, tap-select multiple, lasso (shift-drag), `A` select all, powers (battle HUD
   buttons + Q/W/E/R/T; targeted powers enter a targeting mode: firestorm shows the blast
   radius under the pointer; bulwark only accepts own sites; rally any site), send-fraction
   1–4, pause (Space), speed 1×/2×/3×, retreat. Fixed-step sim (`TICK_SEC`) via
   `createFixedStepper`; events drained each frame → fx/sfx/UI per INTEGRATION-NOTES.
8. **Victory choreography** exactly per PLAYFEEL §3 (hit-stop, surrender cascade, tile flood
   from the keep with `flood` fx, fanfare + confetti, VICTORY card; Continue → pull back,
   clouds part, coins arc to the gold counter, bounty credited on first coin, new frontier
   pulses). `conquer()` + battle counters in `state.stats` (battlesWon, settlementsTaken,
   troopsSent, bestBattleSec…). Defeat/retreat cards with a situational tip.
9. **Tutorial** per PLAYFEEL §4 with `createCoach` (step state in `state.tutorial`; "Hints"
   setting disables).
10. Extend `tools/shots.mjs` with battle frames (start, mid-fight with squads and a capture,
    firestorm, victory card, phone battle) — real drag input where possible.
11. `tools/check.mjs` — CI smoke test with a fresh Chrome profile, exits non-zero on failure:
    no console errors during boot; canvas not blank (sample pixels); real pointer click on
    "New Realm" lands on the button (`document.elementFromPoint`); select the first frontier
    region by a real click at its keep's screen position; click Attack via real pointer;
    battle starts; a real mouse drag from the War Camp to an enemy/neutral site gives
    `battle.stats.sent > 0`; `__hd.winBattle()` → victory card → Continue → region owned;
    reload → state persisted. Also at 390×844 with touch emulation for tap-to-send. The
    GitHub workflow `.github/workflows/pages.yml` already runs `node tools/check.mjs`.

### Quality bar
Zero console errors. Smooth 60 fps on desktop. Works on phone sizes (portrait + landscape).
Everything readable; nothing overlaps. Play at least three full battles yourself via
CDP-driven input (send squads, use powers) and fix what feels wrong.

## Final report
Files; architecture of main/scenes/renderer; measured frame times (world overview, battle);
screenshots (final ones in `screenshots/game/final-*.png`); `tools/check.mjs` result; every
problem found in other engineers' modules (file, symptom, suggested fix); anything unfinished.
