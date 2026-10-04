# Integration notes — what each module actually exports and the gotchas

Collected by the lead from the module engineers' final reports, then corrected by the integration
engineer against the running game. Where this file and `ARCHITECTURE.md` disagree, this file
describes the code as built; fix the code or this file, never leave them disagreeing.

## World (`game/world/generate.js`, `game/core/*`)
- `generateWorld(seed, opts?) → World` (ARCHITECTURE §4). ~70–100 ms for 48×36.
- `tile.cost` is FINAL: terrain cost, + river penalty, replaced by road cost on road tiles
  (bridges). Nothing downstream adds river/road logic.
- `region.faction` is the ORIGINAL owner; live ownership is `state.owner[regionId]`.
- `hexDistance(q1, r1, q2, r2)` takes four scalars. `lineBetween(a, b)` takes `{q, r}`.
- `core/format.js`: `formatNum` (3 significant digits: 950, 1.23K, 12.3K, 123K, 1.20M),
  `formatRate`, `formatDuration`, `formatPct`. `core/rng.js`: `createRng`, `hash32`.
- Round 2 added `game/world/{connectivity,rivers,lakes,perks}.js`. Inland lakes are
  `terrain: 'shallows'`, `land: false`, inside the landmass. Only rival sectors are guaranteed
  contiguous (the Free Folk may not be).
- **`tile.height` on WATER tiles is plain noise, not depth.** Never shade the sea from it (see
  "Water" below).

## Camera (`game/render/camera.js`)
- `createCamera({minZoom, maxZoom})`; fields `x, y, zoom, viewW, viewH, shakeX, shakeY`.
- `resize, worldToScreen, screenToWorld, visibleBounds(margin), panBy, zoomAt(factor, sx, sy),
  setBounds(bounds|null, padding), setZoomLimits, fitZoom(bounds, paddingPx),
  flyTo({x,y,zoom}|{bounds,padding}, ms, ease) → Promise<{cancelled}>, fitTo, cancelFlight,
  fling, isMoving, update(dt)`.
- Pointerdown / pan / zoom cancels an in-flight `flyTo` (always resolves, never rejects).
- **`camera.resize(w, h)` must be called whenever the canvas size changes and before anything asks
  `fitZoom`** (`main.js` does it in `doResize`, and `renderer.beginFrame` re-syncs it every frame).
- **`fitZoom` TRAP:** it clamps its result to the CURRENT zoom limits. A scene entering with the
  previous scene's limits still active gets a wrong "fit". Every scene first calls
  `openCameraLimits(camera)` (`scenes/worldLayers.js`: `setBounds(null)` + limits 0.05..200), asks for
  the fit, then sets its own limits. `flyTo` also clamps its target zoom to the limits.
- **Shake: use `fx.shake()` / `fx.shakeOffset()` (canonical, has per-event duration).
  Ignore `camera.shake`.** `renderer.beginFrame(camera, fx.shakeOffset())` translates all following
  drawing; never feed the offset into hit testing.
- Derive zoom limits from the framing at scene entry (world: `0.85 × fitZoom(world.bounds)`; battle:
  0.75× / 1.3× the arena framing, capped 70 desktop / 50 phone).

## Input (`game/input/pointer.js`, `game/input/clock.js`)
- `createInput(canvas, camera, handlers) → { setEnabled, destroy }`. The `handlers` object is
  captured by reference: scenes rebuild its keys on enter (`main.js` exposes it as `input.handlers`).
- Handlers: `onHover(sx,sy,wx,wy)` · `onTap(sx,sy,wx,wy,{button,shift,pointerType})` ·
  `onLongPress(...)` · `canStartDrag(wx,wy,{pointerType,button,shift,ctrl,alt}) →
  'send'|'lasso'|'pan'` (falsy = pan) · `onDragStart(kind, sx,sy,wx,wy)` (ORIGINAL down point) ·
  `onDragMove(kind, sx,sy,wx,wy)` · `onDragEnd(kind, sx,sy,wx,wy,{cancelled})` · `onCancel()` ·
  `onKey(key, event)`. 'pan' drags are handled by the input layer itself (with fling).
- Two fingers always become pan/pinch and cancel a send/lasso (`cancelled: true`).
- `createClock().tick(nowMs) → dt` (clamped 0.25 s); `createFixedStepper(step, cap=12)
  .advance(dt, speed, stepFn) → alpha`. `alpha` is the fraction of the NEXT tick already elapsed.
- **Hit-test settlements in SCREEN space**: project the anchor with `worldToScreen`, then
  test the click against the sprite's screen box (extended upward for tall sprites) with a
  zoom-independent tolerance (`max(minWorld, 26px / zoom)`). Pass anchors lifted by the tile's
  elevation (`y - elevOffset(tile, 1)`), because that is where the sprite is drawn.
- Tile picking on the world map must honour raised tops: `scenes/worldLayers.js pickLandTile`
  tries the cell under the pointer and the cells whose raised face could cover it; the frontmost
  (largest row) wins, matching draw order.

## Art (`game/render/palette.js`, `tiles.js`, `sprites.js`, `clouds.js`)
- **Elevation contract:** everything except the tile-taking terrain calls is elevation-
  agnostic. For tints, edges, settlements, banners, badges, squads, rings, pass
  `topY = cy - elevOffset(tile, s)` (in world units: `elevOffset(tile, 1)`). `drawCoastFoam` is
  drawn at the unshifted baseline `cy`.
- Per-frame order: blit chunks → `drawWaterGlints` on visible water tiles (sparse) → territory →
  cloud shadows → settlements → banners → squads → fx → cloud puffs → labels.
- Settlements: `drawSettlement(ctx, type, cx, topY, s, faction, {highlight, selected, dim})` —
  cache the plain sprite per (type, faction, s-bucket). `drawSettlement` draws NO flag: draw
  `drawBanner(ctx, x + BANNER_ANCHOR[type].dx*s, topY + BANNER_ANCHOR[type].dy*s, s*0.46, faction,
  t, {phase})`. **Always pass a STABLE `phase`** (site id / tile index): without it drawBanner
  derives its flutter from the banner's SCREEN position and flags shimmer while the camera pans.
  `drawSquad(..., dirX, dirY, {phase})` takes the same option. The integration layer renders site
  banners from baked 36-frame strips (`render/sites.js`) instead of redrawing them each frame.
- `drawTroopBadge(ctx, x, y, count, faction, s, {pulse})`, `drawDragArrow(ctx, x1, y1, x2, y2,
  color, t)`, `drawRangeCircle`, `drawEmblem`, `drawSelectionRing`.
- Hills' colour is deliberately overridden to `#7e9450` (DESIGN's swatch was lighter than grass).
  `drawHexTint` blends with 'overlay' — which only works against real terrain pixels (see
  Territory: it is baked INTO the terrain chunk, or blitted with 'overlay' when live).
- Clouds: `makeCloudField(seed, bounds) → puffs`, `getPuffSprite(radiusPx, seed) →
  {canvas, size, radius}` (cheap blits), `drawCloudPuff` for a few hero puffs, `drawCloudShadow`.
  The sprite's baked size is `size`, its puff radius `radius` px: draw it at
  `size * wantedRadius / radius`.
- Bake cost: ~26 ms / 2000 tiles at s=14, ~30 ms at s=36.

### Terrain chunks: the PARTITION recipe (`render/terrainCache.js`)
The original "one canvas per 8×8-tile block, each starting with an opaque ocean base and a margin"
recipe is WRONG: a later chunk's opaque margin paints ocean over its neighbour's land and raised
mountain tops get clipped, leaving dark blocks along chunk borders. What ships:
1. The chunk grid is a rectangular partition of the WORLD PLANE (8 tiles wide/high, plus `SEA_PAD` = 8
   units of open sea on every side of the tile grid).
2. A chunk bakes EVERY tile whose drawing can touch its rect (reach: 1.3 sideways, 2.7 up, 1.3 down),
   in global row-major order, onto a canvas of the rect plus a 2 px overscan. Every pixel therefore
   comes from the same draw sequence a single whole-world render would use; neighbours overlap by
   a few identical pixels, so there are no seams.
3. Per chunk: sea (see Water) → land tiles: `drawTileBase` → `drawCoastFoam` → `drawRiver` →
   `drawRoad` → `drawFarmFields` (land tiles next to a hamlet/village/town) → `drawTileDecor` →
   territory (tint, bands, borders: `render/territory.js`).
4. Buckets are DEVICE px per world unit (8, 11, 16, 22, 32, 45, 64, 90 = `BUCKETS`), so DPR 2 gets a sharp
   bake. A chunk is blitted at the exact zoom (`zoom / bucket`); rebakes to a new bucket only happen
   once the zoom has been still for 0.16 s, time-boxed (7 ms/frame); ownership-change rebakes are
   time-boxed too (9 ms, at least one chunk/frame). An LRU pixel budget (~46 MP) evicts old chunks.
5. `terrain.draw(ctx, camera, owners)`: `owners` is region id → faction (`-1`/missing = no
   territory). Territory is baked into chunks keyed by an owner signature. Fogged regions and the
   region under attack are passed as `-1`.

### Water (`render/seaField.js`; `tiles-water.js` is no longer used for the baked sea)
`drawWaterSplat` shades from `tile.height`, which on water is noise (unrelated to the coast), and
overlapping radial splats leave a faint honeycomb (coverage differs between tile centres and
corners). `seaField.js` instead gives every water tile a depth from its hex distance to land
(turquoise shallows with a surf band hugging every shore → deep blue offshore, plus the world's own
noise as gentle variation), on an extended grid so the depth keeps deepening past the map edge,
smooths it over a global 6-samples/unit lattice and paints each chunk's slice as a small image scaled
with bilinear smoothing. It is a function of WORLD position only, so chunks agree exactly and the open sea outside the
world (`renderer.beginFrame` fills the same vertical gradient) is indistinguishable from the sea inside.

### Territory (`render/territory.js`)
- Player and rivals: moderate 'overlay' tint (weaker on mountain/snow so rock does not turn purple)
  plus a whisper of flat colour (overlay alone turns azure-on-grass teal), an inner BAND about 0.38 hex
  deep along every edge facing another owner or the sea (owner's light colour, fading inward), and a
  3 px border with a dark hairline. Rivals get a slightly weaker band. Free Folk: 2 px border only.
  Same-owner region seams: thin dashed light lines.
- Live (battle) territory uses the same code through `drawTerritory(target, world, tiles, ownerOf, ...)`
  into two transparent canvases (`tint` blitted with 'overlay', `over` normally): `render/arenaLayer.js`.
- **Fog hides territory:** the world scene passes `-1` for every region that is not revealed (unless its
  clouds are still parting), so no border or tint shows through the mists.

### Frontier / selection overlays (`render/overlays.js`)
- Region outlines are continuous closed loops in a cached `Path2D` (world units, on the raised tops).
- Frontier regions: a soft cream-gold glow BAND ~0.36 hex deep inside the border (never a fill; gold
  alone vanishes on sand and collides with the Amber Horde), a dark casing and a dashed cream core,
  baked once per region and bucket into a small bitmap; the pulse (0.35 ↔ 0.85, 2.2 s) is just the
  `drawImage` alpha. Doing this live (clipped wide strokes over a many-segment path) cost ~10 ms per
  frame on a hi-dpi GPU. The selected region is drawn live in gold with a light fill.
- **Region outline states (all intentional; one state per look, so a colour tells you which):** frontier = cream-gold dashed
  band, pulsing; **selected** = bright gold outline (`#ffe9a6`, breathing) with a soft gold inner glow, drawn live;
  **hover (desktop mouse only)** = `drawHover`: a +8% white tint (`WORLD_SCENE.hoverBrighten`) and a thin CREAM-WHITE rim
  (`rgba(255,250,235,0.9)`, 2 px over a dark casing). A plain white outline on a region with no card open is therefore the
  hover rim, not a bug: the pointer is resting on it (touch has no hover). The `hook3-living-level3.png` frame showed it
  on Thistlefield because the screenshot tour clicked the region twice (select, deselect) and left the mouse there; the
  tour now parks the pointer over the sea before that frame. No other region state draws a white tint or outline (the conquest
  flood and a just-conquered region are the owner tint and border).

### Fog (`render/cloudLayer.js`)
Hidden regions get a milky haze over their silhouette plus a dense bank of puff sprites, composed
at HALF resolution into an offscreen buffer and blitted once (fog is soft; this is a third of the fill
cost on hi-dpi). Reveal: puffs scale ×1.6 and fade over 1.4 s, staggered.

## FX + audio (`game/render/fx.js`, `game/audio/sfx.js`)
- `createFx({maxParticles, reduceMotion}) → { spawn(kind, x, y, opts), update(dt),
  draw(ctx, cam), shake(strength, duration), shakeOffset(), setReduceMotion, clear, count }`.
  World units in; `cam` needs `worldToScreen` and `zoom`.
- Kinds: dust, sparks, burst, shockwave, floatText, coins (`opts.toScreen`), embers, smoke,
  scorch, arrow (`opts.to`), fireball (`opts.delay`, self-explodes), confetti, ripple, levy,
  shield (`opts.duration`), rally (`opts.to`), and (round 2) `telegraph`, `fireBloom`, `flood`.
- Round-2 options: `telegraph` is auto-spawned with every `fireball` unless `opts.telegraph:
  false`; `fireball` takes `radius` and `telegraphColor`; `burst` takes `flashSize`, `ringGrowth`,
  `sparkleCount`; `sparks` takes `dustCount`, `dustColor`; `floatText` `size` is a true multiplier;
  `shockwave` takes `growth`, `duration`, `thickness0/1`, `alpha`.
- Deterministic FX QA: stub `requestAnimationFrame`, spawn into a fresh fx instance, `update(0.05)`
  N times, draw once, screenshot.
- `createSfx() → { unlock(), play(name, {volume, pitch, pan}), setMuted, isMuted, setVolume }`.
  Cues: send clash capture lost arrow fireball rally bulwark march levy coin upgrade click
  hover victory defeat reveal error. Call `unlock()` on the first pointerdown.
- Event mapping: send → dust at source (+`send` sfx for the player only); clash → sparks
  (+ small shake if the player is involved) + `clash`; capture → burst (new owner colour) +
  shockwave + floatText + shake + `capture`/`lost`; arrow → arrow fx + `arrow`; power rally →
  rally fx from each player site to the target + `rally`; bulwark → shield + `bulwark`;
  march → `march`; levy → levy fx on each player site + `levy`; firestorm → fireball at
  (x, y) with delay + `fireball`; surrender → staggered burst + shockwave per site;
  end win → confetti + `victory`; end lose → `defeat`.

## Meta (`game/meta/*`)
- `state.js`: `createGame(seed, world, now)`, `resetRegions`, `PLAYER_FACTION`.
- `economy.js`: `regionIncome`, `incomePerSec(state, world)`, `tickIncome(state, world, dt)`,
  `offlineEarnings(state, world, now)` — **mutates** (adds gold, advances `lastSeen`) and
  returns `{seconds, gold}`; `bounty`.
- `upgrades.js`: `UPGRADES`, `UPGRADE_TABS`, `POWER_IDS`, `upgradesByTab`, `levelOf`,
  `upgradeCost`, `canBuy`, `buy`, `buyMax`.
- `progression.js`: `playerBattleStats`, `enemyBattleStats`, `frontier`, `revealed`,
  `conquer(state, world, id, now) → {bounty, perk, decapitated?}` (does NOT touch battle
  counters — the integration layer updates battlesWon/Lost, surrenders, settlementsTaken,
  troopsSent), `difficulty`, `perkTotals`, `canFoundDynasty`,
  `foundDynasty(state, newSeed, world?)`.
- `save.js`: `serialize, deserialize, exportCode, importCode, saveTo(storage, state),
  loadFrom(storage), hasValidOwnerTable`, key `'hexdominion.v2'`. **`deserialize`, `importCode` and
  `loadFrom` return `null` for anything that is not JSON, not an object or has no valid owner table**
  (a non-empty array of non-negative integers) — never a blank default state. Missing OPTIONAL
  fields still migrate to defaults; `migrate(raw)` itself stays tolerant.
  **Every top-level state field must be carried by `withDefaults`** or it is silently dropped on save/load
  (this is what turned 4 round-trip tests red when `crowns`/`metFactions` landed). It now carries
  `crowns` (per region: null or three booleans), `metFactions` (unique non-negative ints), `intel`
  (`sanitizeIntel`) and `prosperity` (small non-negative ints, junk becomes 0), each with junk-proofing
  tests in meta.save.test.js; `resetRegions` gives a new realm/dynasty `intel: {}` and `prosperity: []`.
  Adding a field means: default in `state.js`, sanitiser in `save.js`, a round-trip test.

## UI (`game/ui/*`, `game/styles/main.css`)
- Link `game/styles/main.css` (then `game/app/app.css`, the integration layer's own positioning:
  region-card dock, title scrim, battle extras); needs `<div id="ui">` (CSS makes it fixed, inset
  0, pointer-events none; children opt in). `.reduce-motion` class on `<html>`.
- `base.css`: `:where(#ui *) { pointer-events: auto }` is a ZERO-specificity default so a component's
  own `pointer-events: none` (`.coach`, `.tooltip`, ...) wins; `.passthrough, .battle-hud, .toasts,
  .coach-ring` are declared `none` there. A global `[hidden] { display: none !important }` lives there too
  (the kit shows/hides panels with the `hidden` attribute).
- Components: `createHud({onCouncil,onRealm,onSettings})`, `createRegionCard({onAttack,
  onSurrender})`, `createCouncil({onBuy,onBuyMax,onClose})`, `createBattleHud({onSendFraction,
  onPower,onPauseToggle,onSpeed,onRetreat})`, `createResults({onContinue,onRetry,
  onBackToMap})`, `createTitle({onContinue,onNewRealm,onSettings})`, `createModal`,
  `createToasts()` (each `update` pushes a toast), `createSettings({...})`,
  `createRealm({onFoundDynasty,onClose})`, `createCoach({onDismiss})` (`update({visible,
  text, target:{x,y}|{el}})`), `createWelcome({onCollect})`, `createDevPanel({...})`,
  `createTooltip()`. All return `{ el, update(data), destroy() }`; exact data shapes are in
  each file's JSDoc.
- **THE CLICK RULE (found three times: region card, intel panel, battle HUD).** A real press is pointerdown then
  pointerup 60-150 ms later. If a UI refresh REPLACES the element under the pointer in between (a button, or the icon
  or text node inside it), the browser fires no click at all: the press just does nothing. Anything a player can press
  must survive refreshes: build once, then patch (`if (el.textContent !== t) el.textContent = t`; swap an icon only when
  its NAME changes, e.g. the `setIcon` helper in battleHud.js / regionCard.js). The battle HUD used to rebuild every
  power button's icon and the pause icon every 66 ms, so most real presses on Rally, Firestorm and Pause were lost
  (`element.click()` in a test still worked, which is why nothing caught it). tools/check.mjs has `pressAudit`:
  N presses held 130 ms while the game refreshes, muted handlers, and every press must arrive as a click.
- **Region card is built once and patched in place** (`regionCard.js`): the world scene refreshes it about
  once a second, and anything that recreated its buttons could land between pointerdown and pointerup and
  swallow the click (Attack included: the click then targets the container). Text/styles change only when
  they differ, the buttons and mounted child components (crown row; later the intel panel) are never
  recreated, an update whose data is identical to the last does nothing, and Attack / Accept Surrender are
  two persistent buttons whose `hidden` flips (query `.region-card-action:not([hidden])`). check.mjs holds
  the press 150 ms with a forced refresh in the middle and asserts the button node survived.
- Crowns and leaders (docs/briefs/crowns-leaders-hookup.md, wired): `results.js` takes `crowns, parSec,
  crownBonus, bonusPct, firstVictory` (crown row + one static caption on the FIRST victory card only, no coach
  z-index games); the frontier card shows three open medals on desktop and one "Par 1:00 · crowns +N% bounty
  each" line on the phone sheet (both in the DOM, CSS picks; N is NEVER typed: `game/app/crownCopy.js` derives `CROWN_BONUS_PCT` from
  `BOUNTY_FRACTION_PER_CROWN` in `game/config/crowns.js`, the scenes hand it to the cards as `crownBonusPct` / `bonusPct`, `ui.crowncopy.test.js`
  guards against a typed number and `tools/check.mjs` reads the same config value from the page and compares it with the desktop label, the phone
  line and every earned medal tag); owned cards show the earned crowns (no row when
  the region has no crowns record); the Realm panel has "Crowns, lifetime" and "Dynasty crowns"; labels wear
  pips (0.72 x label font, 11-16 px, travel with their label in the collision pass). `services.speak(trigger,
  factionId, regionId, scope)` is the one gate for leader lines (setting, hint on screen, once per battle,
  15 s gap; `keepLost`/`decapitation` are gap-exempt) and returns the line or null; `ui.coach.update` is
  wrapped so a hint hides a banner, and the banner is hidden on every scene change (it is placed under the
  chrome of the scene it spoke in). Starting neighbours are seeded as met on entering the world.
  `coach.update({ avoid })` and a point target's `side: 'up'|'down'` keep bubbles off what they would cover.
- Scout and Sabotage (docs/briefs/intel-hookup.md, wired): `regionCard` mounts `intelPanel` under the difficulty bar
  (frontier only; data `intelPanelData`, callbacks `onScout`/`onSabotage` on `worldScene`). The panel patches its own
  DOM; its button labels/costs are rebuilt only when the value changes (a rebuild between pointerdown and pointerup
  would swallow the click, same trap as the card). World scene: `derived.scouted` (300 ms refresh) feeds
  `drawScoutedGarrisons` (badges, zoom fade 8 to 11; a phone forces them for the SELECTED region) and the
  weak-point ring (selected scouted region only); `labels.js` draws the torch right of a sabotaged region's name
  (reserved in the collision box, flickers unless Reduce Motion). Toasts on scout/sabotage; the `scouted` leader
  line speaks on purchase, `sabotaged` speaks at the BATTLE START and replaces `battleStart`/`capitalBattleStart`,
  with a "Your agents weakened the garrisons (-N%)" toast when the fight goes live (not on resume). Intel clears on
  conquest: `clearRegionIntel` is called in `world.onSurrender` and `battle.onResultsContinue` right after
  `conquer()` (progression.js untouched; harmless if balance later calls it inside `conquer`), and on a new realm or
  dynasty through `resetRegions`. The difficulty bar does not move after a sabotage until balance applies
  `sabotageTroopMult` in `enemyBattleStats`. After every purchase the camera nudges the region clear of the (taller) card.
- Region card layout budget (phone sheet, 390 x 844): the owner chip sits in the header row (name, owner, tier),
  income and bounty share one wrapping row, rows use an 8 px gap below 640 px, bar labels read "Your power / Their
  strength" (weighted power, not troop counts), and the dock scrolls under its cap. Measured: unscouted 40 %,
  scouted about 50 %, maxed sabotage about 48 % of the screen height.
- Results: zero stats ("0 lost", "0 killed") are muted neutral, never red (`.results-stat.is-zero`). The phone Realm
  panel sits under the HUD bar and scrolls its body (it used to cover the HUD).
- Battle HUD: power buttons take `shortName` (phones, CSS at <= 640 px, show Rally / Storm / Bulwark /
  March / Levy instead of an ellipsis); below 840 px the region pill drops under the button cluster in a
  compact two-line form, and up to 960 px the Retreat button loses its word (they collided at 640-800 px).
- Round-2 additions: `battleHud.update()` `powers[i]` also takes `name`, `cooldownSec` (remaining
  seconds) and `armed` (target-picking pulse); `hud.update()` takes `pulse` (big gold flash; also
  automatic on ≥ 5 % jumps) and `quiet` (idle drift: no pulse or flash at all; tiny changes apply
  directly, a running roll is re-aimed instead of restarted — feed it every few hundred ms);
  new `lock` icon; `ui/format.js` `shortNumber` delegates to `core/format.js` `formatNum`; the UI
  gallery has `?bare=1&mode=<kit|composition|battle|title>` for chrome-free shots.
- `coach.update()` is safe to call every frame (it only swaps text/target; the placement loop starts
  and stops with visibility). A screen POINT target gets a fixed-size ring, an element target a ring
  sized to it — point at a full-width button by point, not element. `update({ avoid: el })` lifts the
  bubble clear of an element it would cover (the battle's Rally hint keeps off the send-fraction bar).
- battleHud owns keys 1–4 and the power hotkeys (Q W E R T) on a `window` keydown listener that is live in
  EVERY scene: the battle scene's callbacks must guard for "no battle active". battleHud/settings/realm
  append their own confirm modals to `document.body`.

## Battle (`game/battle/*`)
- Contract: ARCHITECTURE §6 (`buildArena`, `createBattle`, `step`, `issue`, `squadPosition`,
  `previewSend`, `estimateDifficulty`). Read `game/battle/sim.js` for the final export list and event
  payloads. `sim.js` never calls the AI: each tick `issue()` the commands `think(battle, battle.t)` returns,
  then `step()` at `TICK_SEC`.
- **`squadPosition(battle, squad, alpha)`: `alpha` OVERRIDES the squad's progress along its current
  segment. It is NOT a tick-interpolation factor.** `render/units.js` snapshots positions before each
  step and lerps "then" → "now" by the stepper's alpha itself.
- `battle.events` is cleared and refilled by every `step()`: send, clash, clashEnd, assault, capture
  (`{site, from, to, x, y}`), arrow, power, firestorm, surrender (`{sites}`), end. On a win the same
  step emits capture (keep) → surrender → end, and the sim has ALREADY flipped every site: the scene keeps
  a per-site owner snapshot from just before the tick to stage the cascade and flood.
- Squads carry `to` (site id) and `path` (tile indices): enemy intent lines follow the remaining path.

## Integration layer (`game/main.js`, `game/app/*`, `game/scenes/*`, `game/render/*Layer|sites|units|labels`)
- `main.js` builds every service once and wires scenes; `scenes/flow.js` sequences enter/exit.
  Scenes: `title` (clear continent, drifting camera, ambient clouds), `world`, `battle`.
- **State container** (`app/stateContainer.js`): `boot()` loads or creates; `newRealm(seed?)`, `restart()`
  (fresh game on the CURRENT world), `tryFoundDynasty()`, `replaceState(state)`. A world change means
  `services.applyWorld()` (rebuilds render caches and prebakes chunks).
- **Autosave** (`app/autosave.js`): every 5 s + on `visibilitychange`/`pagehide`, gated by `canSave` so an
  untouched realm shown behind the title never overwrites or creates a save. Idle income ticks on the
  UNCLAMPED wall-clock gap (≤ 2 s); longer gaps (tab hidden) are settled by `offlineEarnings` on
  `visibilitychange`.
- **World scene**: derived data (revealed/frontier/labels/difficulty) refreshes on a 300 ms timer or when
  marked dirty. Framing (`scenes/worldLayers.js`): `freeRect(w, h)` = the screen minus the HUD and, on
  desktop, the region-card column; `realmFraming` = owned regions + the nearest frontier regions that keep
  the zoom readable; `frameInRect` centres bounds in the rect. Labels (`render/labels.js`) are placed
  greedily by priority (selected > frontier > rival capital > owned > rest), nudging up to half their
  height before skipping.
- **Conquest choreography**: an instant surrender plays the flood + coins + clouds in the world scene;
  after a real battle the flood/cascade already happened on the arena, so `Continue` calls `conquer()`
  and enters the world with `{cameFromBattle, conquered}`: pull back, mists part (staggered), coins to the
  HUD counter (bounty credited when the first coin lands), newly attackable regions pulse extra bright.
- **Battle scene**: `battleThreat.js` (pure) predicts each threatened player site's fate like
  `previewSend` — APPROXIMATION: every incoming squad is assumed to arrive with the first; garrison growth
  and Bulwark ARE projected; `−14 · holds` / `falls, 6 short` chips under the badge, recomputed at ~4 Hz.
  `arenaOwnership.js` (pure): nearest-site Voronoi owner per tile, capture ripple, surrender cascade, victory flood.
  `render/arenaLayer.js`: live territory + a soft hex-outline dim mask baked once per battle.
  Enemy squads draw a dashed route to their target (`units.drawIntent`).
- **Dev hooks** (`?dev=1[&seed=N]` → `window.__hd`): `state, world, camera, renderer, scene, frameMs, perf,
  perfSample(ms), selectRegion, startBattle, winBattle, loseBattle, screenPosOfSite, siteInfo, battle,
  battlePhase, regionScreenPos, conquerRegions(n), conquerRegion(id), surrender(id), flyToRegion,
  grantGold, revealMap, reseed, startNewRealm, openCouncil, openSettings, hideUI, hideDev`.

## Living map and prosperity (docs/briefs/living-map-hookup.md, wired)
- **Terrain bake split** (`render/terrainCache.js`): per land tile, after `drawTileDecor`, `drawProsperityGround` (level I: haystacks,
  orchards, hedgerows on the existing farmland, so it takes the territory tint); then `drawChunkTerritory`; then a SECOND loop
  `drawProsperityStructures` (levels II-III: cottages, windmills, paving, market), so structures keep their natural colours.
  `drawFarmFields(ctx, x, y, s, seed, tile)` gets the tile so roads and rivers repaint over the plots. The level is part of the chunk
  signature (`owner:level,`): a level-up re-bakes exactly the chunks that hold the region through the existing time-boxed ownership
  path. `terrain.draw(ctx, camera, owners, levels)` / `prebakeAll(devScale, owners, levels)`; omitted levels keep the last ones (the
  battle scene draws without them). `terrain.plan` is shared with the ambient layer.
- **Levels** (`meta/prosperity.js`): the world scene draws `visualLevels` (level of the VISUAL owner: 0 under fog and for a region
  mid-flood or not yours), from `state.prosperity` (the CREDITED level). main.js runs `updateProsperity` every 5 s on every scene
  except the title (wall-clock, like income); level-ups go to `services.pendingProsperity`, and ONLY the world scene celebrates
  (one region per 0.7 s: "<Region> prospers!" float text, a soft shimmer, a quiet chime). Boot and return-from-absence run, in
  this order: `baselineProsperity` at departure (silent), `offlineEarnings` (paid with the levels at departure: conservative),
  `updateProsperity` (levels gained while away, reported once). They go on the welcome card ("X and N other regions prospered
  while you were away") when there is a card, else to the celebration queue.
- **Ambient** (`render/ambient.js`, one per world, created in `renderer.setWorld`): world scene frame order is terrain, glints,
  overlays, shadows, flood, `ambient.update(dt)`, `drawGround` (caravans, boats: below settlements), settlements, intel marks,
  `drawAir` (smoke, sails, birds: above settlements and banners), fx, fog, labels. `rebuild({ owner: visualOwners, prosperity })` runs
  on the 300 ms timer; `setHiddenMask` = "not visible" so nothing draws over fog; `setEnabled(false)` in battle (time stands still)
  and true again on world `enter`; Reduce Motion through `renderer.setReduceMotion`; adaptive quality in main.js (frame EMA
  > 24 ms thins it, < 17.5 ms restores it, 2 s hold); `applyWorld` pre-populates the roads and prewarms the framing zoom bucket.
- Region card (owned): "Prosperity II · +10% income · next in 5h 29m" (ticks with the 1 s refresh). `app/income.js` (the display twin)
  multiplies by `prosperityIncomeMult`; `meta/economy.js` gets the same factor from balance, so until that lands the card can
  show a few percent more than the HUD credits.
- Dev hooks: `__hd.advanceTenure(hours)` (moves every held region's conquest time back, runs the clock, queues the level-ups),
  `__hd.lockAmbientQuality(q|null)`, `renderer.ambient.stats()`. `tools/shots.mjs --only=living` produces the hook3 frames.

## First-hint and top-stack rules
- The first frame at 390x844 fits home + the nearest frontier region whole: `realmFraming` adds `HEX_MARGIN` (1.4 world units: a
  region's bbox is its tile centres) on every side; checked on 8 seeds at 390x844.
- A hint anchored to the region card waits for the card's slide-in (`CARD_SETTLE_MS`, 520 ms) and the camera nudge.
- A NEW hint never appears sooner than 1.5 s after the previous hint first appeared (`COACH_MIN_SHOW_MS` in main.js's `ui.coach.update`
  wrapper; the same hint re-showing is exempt, hiding is immediate). Only what is drawn waits, the player is never blocked.
- On a phone (< 768 px) at most one top overlay: a toast that fires while a leader banner is up is queued until the banner hides
  (`ui.toasts.update` wrapper; queued toasts older than 9 s are dropped). Callers therefore call `speak` BEFORE `toasts.update`.
- The tutorial battle (measured on seeds 7, 11, 23, 42 in the real game, real clicks): the **War Camp starts at ~30.5 troops**; the player's
  own other sites inside the arena hold only a border garrison (`garrisonShare`): a keep 4.3, a village 2 to 2.1, which is where an early
  "4 vs 6" reading came from, not the camp. The enemy side is keep ~51, village 17.5, hamlet 11.6 to 11.7 (one seed also has a fort at 32).
  Step 3's arrow and coach both start at the camp. `tutorialArrowTarget()` (battle scene; `__hd.tutorialArrow()` returns {from, to} site ids)
  picks the nearest settlement the camp can take with room to spare (a capture leaving >= 20% of the sent troops, else any capture, else
  anything): a default 50% send (15) takes the hamlet with ~5.7 left but the 17.5 village with only ~1 left, so the hamlet is pointed at when
  there is one. Seeds whose only soft target is the village (23, 42) still point at it: the prediction says capture, and 75% or 100% is safe.
- **The send arrow is bold** (`drawDragArrow` in render/sprites.js): a solid shaft about 4.6 px at the usual battle zoom (it scales gently with `opts.zoom`, 3.6 to 6.2 px) in saturated
  green (capture, `#2bd46b`), red (not enough, `#ff4545`) or gold (over no target, reinforcing), inside a dark casing with a soft shadow, light dashes flowing toward the target and a big outlined
  head. The colours live in `DRAG_ARROW` (scenes/timing.js; check.mjs reads them from there). Checked over the game's own grass, forest, pine, snow, savanna, hills, mountain, beach and sea tiles at
  desktop (zoom 64) and phone (zoom 34) scale. The tutorial's step-3 arrow (gold) is the same bold arrow.
- **"Stuck?" coach hint** (`scenes/stuckHint.js`, config in `STUCK_HINT`, timing.js): once per battle, hints on, never while the tutorial is in a battle step (3 to 5): after 60 s of battle time
  without a capture of ours (a capture restarts the clock and hides it), with Firestorm and/or Rally unlocked AND ready, the coach points at that power's button (Firestorm first) and says
  "Stuck? Firestorm their strongest site, or Rally everything at once." (only the ready ones are named); it leaves after 9 s and its × dismisses just this hint (the coach takes a per-update
  `onDismiss`; the default × still skips the tutorial step). Probed in the real game: never shown during a real tutorial battle, shown at t = 61 s otherwise, not with hints off.
- **"Best value"** (`game/app/bestValue.js`): the one Army-tab upgrade that raises Army Power the most per gold. Army Power is the region card's "Your power" (`difficulty().power`, built
  from `playerBattleStats`), averaged over the frontier regions, recomputed with the upgrade one level higher; the scene recomputes on open and purchase and at most once a second while the
  council is open, and passes the council a `bestValue` flag per card (the UI kit stays pure).
- **Intent lines** (render/units.js `intentWorthDrawing`): only hostile squads marching on a site that is not their owner's (ours: a threat; neutral: a race). An enemy reinforcing its own site is not drawn.
- Dynasty copy never promises "larger" (the generator realises the requested region count only roughly): the modal, the toast and the Realm text say "A new continent awaits, with tougher enemies".
  The step-2 hint says "Attack! Battles take a minute or two." and its bubble hangs clear of the card's bottom edge (`gap` on a coach point target).
- Step 3's wording is "Drag from your War Camp to a settlement. The arrow tells you if you'll take it." (lead decision: teach the preview, not the
  troop arithmetic, since strength includes attack and defence; the send stays 50% and 75% / 100% is the natural adjustment). It is literally true:
  while a send drag is held over a target the arrow is GREEN for a predicted capture, RED for "not enough", gold otherwise (`dragArrowColor`), and the
  tooltip says the same in words. `__hd.dragInfo()` returns {outcome, color} mid-drag and `tools/check.mjs` asserts both against `previewSend`.
  (docs/PLAYFEEL.md §4 row 3 and DESIGN §6 still quote the older wording.)
- Perk and dynasty-star card copy is derived, never typed: `game/app/perkInfo.js` builds each perk line by asking `perkAccumulate` (game/meta/perks.js,
  where the magnitudes live privately) what one owned region with that perk grants, and `dynastyStarText()` reads `DYNASTY` (game/config/meta.js); the
  Realm panel takes it as `dynasty.starText`. `ui.bonuscopy.test.js` compares every line with `perkMultipliers`, and `ui.crowncopy.test.js` fails on any
  typed "+N%" string in game/ui, game/scenes or game/app. (The shrine line now reads "−6%"; it used to say "−06%".) A star effect tuned to zero is
  left out (`starEffectsText`: "+3% income, +3% bounty", never "+0% attack/defence").
- Crown hints come from `CROWN_TEXT` (game/config/crowns.js) and reach the UI kit as DATA, because game/ui imports nothing from the game
  (`ui.features.test.js` holds that): the shell passes `crownTexts: CROWN_TEXTS` (game/app/crownCopy.js) to `createResults` and `createRegionCard`, which hand
  it to `createCrownRow({ texts })`; with no texts the row shows the names and no hint. Unbroken reads "...a settlement you started the battle with".
- The welcome-back card shows the REAL absence (`awaySec`, taken before `offlineEarnings` advances `lastSeen`; `offlineEarnings().seconds` is only the paid,
  capped part) and, when the absence ran past the cap, "Your treasury pays for up to N h away. Treasury upgrades raise it." with N from
  `offlineCapHours(state)` (game/app/income.js: `ECONOMY.offlineCapHours` + one per Treasury level). The Treasury line of the War Council reads the same
  config (`upgrades.js` `effectText`; it used to type a base of 8 h). `ui.bonuscopy.test.js` ties both to `offlineEarnings`.

## Tutorial hints: placement, steps and icon buttons (PLAYFEEL §4; round of 2026-09-30)
- **Placement is geometry, checked every frame** (`game/ui/coach.js`). `placeHint(bubbleSize, targetBox, viewport, { prefer, obstacles })` is pure and unit-tested
  (`game/tests/ui.hints.test.js`): it tries below / above / right / left of the target (the `prefer` side first), puts the tail on the bubble edge facing the
  target (it slides along the edge, clear of the rounded corners), keeps the tail tip `TIP_GAP` = 4 px from the target box (contract: 8), never overlaps the target,
  keeps the bubble fully on screen (8 px margin) and, when a pressable control sits between bubble and target (the send-size row above a power button), holds the
  bubble back and lengthens the tail (`REACH_STEPS`, up to 68 px more) instead of covering the control. Obstacles are soft (overlap x 1000 in the score) so a hint is
  always placed; the bubble width is squeezed (280 / 232 / 190 / 156) before anything is overlapped. Along the target's edge the bubble tries centred first, then slid as far either way as the
  tail can still reach the box, so it can step aside from a toast or panel beside its target (the C3 hint beside an arriving toast at 768 px).
- **Targets are live.** A hint's `target` is a function, never a snapshot: `{ el }`, `{ find }` (look the element up again each frame), `{ get }` (a box in screen px,
  e.g. a settlement's on-screen box from the camera), `{ find, get }` (a group: `get` for the box, `find` for the covered test) or `{ x, y }`. The coach re-reads it in
  `tick()`, which main.js calls at the END of every frame (after `sceneManager.frame`, `selfTick: false`), so a pan, a zoom or a camera flight is followed with no lag.
  While the target is off screen (< 50% visible) or something other than the map or the target itself is on top of its centre (a panel, the council), the hint is hidden
  and comes back when it is visible again. `card: true` is a small pointer-less card for hints about the map itself (pan/zoom). `avoid: [el | () => box]` adds more
  things to stay off (B1 passes the gold arrow and its destination settlement). Panels listed in main.js `obstacles` (HUD buttons, region card, send bar, council,
  realm, toasts with content, the leader banner while showing) are avoided; a panel that HOLDS the target is expanded into its other pressable controls.
- **Shared target boxes** live in `game/app/hintTargets.js` (`siteBox`, `regionLabelBox`, `unionBox`, `distPointBox`, `overlapArea`, `visibleFraction`); the game and the
  monitor import the same maths, but the monitor resolves WHAT a hint points at independently, from the hint's text (`tools/hintMonitor.js expectedFor`).
- **One hint at a time, new hint waits >= 1.5 s** (`COACH_MIN_SHOW_MS`, unchanged main.js wrapper). `tutorial.pick` returns one step; the coach shows one bubble.
- **The check** (`tools/hints.mjs`): plays a fresh profile at 1280x720, 1440x900, 1920x1080, 1339x863 (mouse), 390x844, 844x390, 768x1024 (touch) with REAL input
  (pan, pinch/wheel zoom, region tap, Attack, War Camp drag, send size, multi-select, Rally aim, pause, Firestorm, council, scouting, selection clear, dynasty), and
  `tools/hintMonitor.js` measures after EVERY game frame (`__hd.afterFrame`): tip within 8 px of the target box, bubble not over its target, not over another
  control (> 25% of it), not over the B1 arrow destination, fully on screen, one coach, hidden while the target is off screen or covered. Any violation exits 1. A run prints
  one line per distinct hint with frames measured and the worst tip distance (about 4 px everywhere); screenshots `screenshots/game/hints-<tag>-<viewport>-NN-*.png`
  (`--tag=before` runs against an older build without failing). `tools/check.mjs` runs the same monitor over the desktop and phone tutorial and fails on a miss.
- **Landscape phones (844x390)**: the battle camera band was 94 px tall, so the gold-arrow target could end up under the timer strip. `frameRect()` (scenes/battle.js) now
  returns `y0 = 78, y1 = H - 128` when `H < 520` (the timer strip is ~70 px, the send bar + powers ~125 px); the region card's Attack row is sticky at the bottom of the
  scrolling card (`.region-card-action`, regioncard.css) so W3 can always point at it.
- **Tutorial state is a set** (`state.tutorial = { seen: { W0: true, ... }, done }`; `game/meta/state.js` typedef, `save.js` `migrateTutorial`): an old `{ step, done }`
  save migrates to "every old step before `step` seen" (`OLD_ORDER` in `migrateTutorial`: [W0, W1], [W2], [W3], [B1], [B3], [B5], [M1]; an old `done` marks all of them), so a veteran
  is shown only the NEW steps (B2, B4, C*, P*, M2-M4) when their moment comes, and `done` becomes false again. Unknown ids and non-true values are dropped on load. `Settings > Replay tutorial` clears `seen`, `done` and turns hints on (`tutorial.replay()`; main.js `onReplayTutorial`).
- **Steps** (`TUTORIAL_STEPS` in scenes/timing.js: id, scene, anchor, text/textTouch/textAim, `after`, `needs`, `seenOn`, `timeoutSec`, `activeOnly`; conditions in
  `game/app/tutorialRules.js` `RULES`, pure functions of the scene's facts): W0 realm/gold, W1 pan+zoom, W2 glowing region, W3 Attack, B1 War Camp drag, B2 send size,
  B3 multi-select / lasso (`activeOnly`: shown only while the player has two or more sites), B4 Rally (button, then aiming), B5 keep, C1 supply lines, C2 blocked (front line),
  C3 pause/speed, P1 Firestorm, P2 clear selection, M1 council, M2 scout, M3 Region Works, M4 Found a Dynasty. `seenOn` lists the events that mark a step seen when the
  player does the thing: tap, panAndZoom, regionSelected, battleStart, send, sizeChanged, capture, multiSend, rally, supplyCreated, noRouteSeen, pauseOrSpeed, firestorm,
  selectionCleared, councilOpened, scouted, workBuilt, realmOpened (`tutorial.notify(event)`). Steps whose feature is not built are gated by `needs` in
  `game/app/features.js` (`FEATURES.supply`, `FEATURES.works`).
- **The `?` controls card** (`game/ui/controls.js`, data `CONTROLS`, `showControls()`): mouse/keyboard and touch columns for every control (drag to send, Ctrl-drag and
  long-press supply lines, Shift-drag lasso, A select all, 1-4 send size, Space pause, speed, Q/W/E/R/T powers, right-click/Esc cancel, pan, wheel/pinch zoom), reachable from the
  battle HUD (`?`) and Settings > Controls.
- **Touch targets and page zoom.** The viewport stays user-scalable (accessibility). On a coarse pointer the small x buttons (`.coach-dismiss` 24x14, `.toast-close` 20x20) keep their look but get a 44 px hit area (an invisible
  `::after`, overlays.css); `tools/iconMetrics.js` probes the REAL hit size with `elementFromPoint` and `iconcheck` fails under 44 px on touch. `#ui` and modal backdrops are `touch-action: pan-x pan-y` (sliders `pan-y`), so a
  pinch that starts on the HUD, a card, a panel, a modal or a toast no longer zooms the page (it did: `visualViewport.scale` went to 5) while every panel still scrolls; the map zooms from the canvas (`touch-action: none`).
  `check.mjs` (phone) pinches over the HUD and an open council and asserts `visualViewport.scale === 1`, and taps 17 px off a toast x to dismiss it.
- **Icon-only buttons are centred by CSS, not by luck** (`game/styles/base.css` `.btn-icon`): `display: inline-flex; align-items/justify-content: center; line-height: 1;
  padding: 0`, the glyph `svg` is `display: block` with a `viewBox`. The HUD gear/close x/pause used a bare `<button class="btn-icon">` that was not flex, so the svg sat on the
  left (12-13 px off). `tools/iconcheck.mjs` opens the HUD, council, realm, settings, a modal, a toast, a hint and a battle at 1440x900, 390x844 and 844x390, and measures
  the SVG content's `getBBox` centre (through the viewBox) against the button's centre (<= 1 px), plus "the gear circle lies inside the HUD bar". `tools/check.mjs` measures the same thing in place (`tools/iconMetrics.js`) at desktop and phone.

## Supply lines, front lines and Region Works in the scenes (DESIGN §4.3, §4.4, §5.8; round of 2026-09-30)
- **Drag feedback** (`scenes/battle.js`): while a send is dragged, `drawReach` rings every settlement the drag could reach (soft gold breathing ring, stronger on the one under the pointer) and greys the
  ones with no route (a dark disc, dashed ring and a cross: `render/supplyLines.js` `drawReachGlow` / `drawNoRoute`). The arrow is green / red / gold by `previewSend().outcome` as before and **grey
  (`DRAG_ARROW.blocked`) for `'noRoute'`**, with the tooltip `NO_ROUTE_TEXT` ("No route: take a closer settlement first", one constant in `scenes/timing.js`); in a multi-source drag each source that cannot
  reach the target draws its own grey arrow while the others show the outcome, and the tooltip adds "(N cannot reach)". Letting go on such a target issues the send anyway: the sim answers with a
  `refused` event (`owner` = the player) and `onRefused` shakes the target (a 420 ms decaying wobble, off under Reduce Motion), plays the error cue and shows the same tooltip over the target for 2.6 s,
  and tells the tutorial (`noRouteSeen` fact).
- **Supply lines**: a **Ctrl-drag (or Alt-drag)** from a settlement (desktop), a **long press, then drag** (touch: after 450 ms the source shows a dashed ring and a hint tooltip; the drag that follows is the SAME
  press), or the **Auto toggle** in the battle HUD (`.battle-auto`, left of the send size: icon `supply`, the words "Auto" and "On"/"Off", gold when on, `aria-pressed`, key **S**). With Auto on, plain drags AND the
  tap-select-then-tap-target flow make lines; with Auto on, Ctrl/long-press gives the one-off send instead (the gestures flip the mode). The supply drag wears the player's colour (grey without a route) and its
  tooltip reads "Supply line: 50% every 3 s" (from `SUPPLY`) or "Remove supply line". `orderSupply(from, to)` issues `{type:'supply'}`, or `{type:'unsupply'}` when EVERY source already has a line to that target
  (the repeated gesture undoes it). Remove also by **right-click on the source** (a `pointerdown` listener on the canvas: pointer.js passes no position to `onCancel`) or, on touch, a **long press and let go without
  dragging** on a source that has a line (dragging on redirects it). The first line shows a one-time toast saying what it does and how to remove it.
- **Drawing the lines** (`drawSupplyLines`, before the units and intent lines, after the land): every line in `battle.supply` (the AI's too, when balance gives it any) as flowing chevrons
  (`render/supplyLines.js drawSupplyLine`) along `routeFor(...).points` (lifted by each tile's elevation like the settlements), in the owner's faction colour, on a faint dark track, inset from both settlements,
  about half the weight of the send arrow (chevron stroke ~2 px against the arrow's ~4.6 px shaft). A line whose route is cut by a moved front draws nothing (the sim keeps it). `send` events with `auto: true`
  spawn a 3-particle dust puff and play no `send` cue. `arrow` sfx is throttled to one per 140 ms (War Camp volleys from Watchtower Works share the cue).
- **A line that cannot fire WAITS, visibly.** The sim keeps a line whose route has closed (the front moved); `drawWaitingLines` (over the settlements, from `drawOverlays`) draws a short grey dashed stub from the
  source toward the target ending in a pale pause badge (`render/supplyLines.js drawWaitingLine`). It never spans the land in between, so no frame shows troops or chevrons crossing enemy land; when the route
  reopens the chevrons return by themselves. A very short hop between neighbouring settlements still gets its chevrons (the gaps shrink with the route; under 12 px nothing is drawn).
- **The tutorial's gold arrow (B1) never points at a settlement with no route** (`tutorialArrowTarget` skips `previewSend(...).outcome === 'noRoute'`; its arrival time reads 0, which used to win the ranking and aim it at an
  unreachable keep). `check.mjs` asserts `canRoute(camp, arrow target)`. `tools/supplyshots.mjs` photographs the whole supply UI with real input (`supply-desk-*`, `supply-phone-*`: the drag glow, a standing line with
  NO drag in progress along a corridor route, Auto, the grey no-route drag, the refusal, and a waiting line); the arenas are picked by scanning real ones with the sim's functions.
- **Display ownership is the simulation's own** (`scenes/arenaOwnership.js`): `tileOwner` asks `battle/territory.js tileOwner` for every tile the arena knows, so what is drawn as yours is exactly the land you may
  cross; the file keeps only the TIMING (capture ripple, surrender cascade, victory flood). Border-march corridors (`tile.link`, DESIGN §4.4) get no owner from the sim, are never in a settlement's ripple cell or
  the flood schedule (`own.linkTiles`), and `renderer.arena.setCorridors` / `drawCorridors` (render/arenaLayer.js) draws only a subtle dashed edge around them.
  A strip that crosses a mountain ridge (arena tiles `pass: true`, `terrain: 'hills'`; the world tile stays `mountain`) is the second argument: `drawPass` lays
  a pale, untinted stone fill over the pass tiles. The third argument is the ROADS (`battle.js stripRoads()`): for every settlement the camp can route to at the
  start, the part of its `routeFor` route that runs over `link` tiles, from the camp tile to the first tile of the settlement's land; routes leaving the strip at
  the same tile share one road. Each road is drawn as a sandy dashed track ending at the edge of that land with a small cream arrowhead pointing at the nearest
  settlement it leads to, so a strip that serves two targets shows two roads with two arrows (never a road to nowhere). Proof frames:
  `screenshots/playtest-fix-after/mountain-pass-*.png` (seed 7, own 16 and 25, attack Wrenglen, region 21: the only seed-7 targets that need a pass are 21 and 11). Intent lines stay threat-only
  (`intentWorthDrawing` unchanged).
- **Tutorial C1 / C2** are on (`FEATURES.supply = true`): C1 points at the Auto toggle and is seen by the `supplyCreated` event (the sim's `supply` event, so a refused line never counts); C2 ("You can only attack
  where your land touches theirs...") shows on the first refusal or 20 s in, pointing at the blocked settlement nearest the camp, only while one exists (`hasBlocked` fact), and leaves after 6 s
  or on ×. `window.__hd.dragInfo()` now also returns `{ supply, unroutable }`, `__hd.supplyInfo()` returns `{ auto, lines, armed, refused }`.
- **Region Works** (`docs/briefs/works-hookup.md`, all sections wired): `state.works` + `save.js sanitizeWorks` together (round trips in `meta.save.test.js`); `works.css` imported; the owned card's last row is
  `createWorksPanel` (built once, patched in place; callbacks `onBuildWork / onUpgradeWork / onDemolishWork` from main.js to the world scene, which sounds, toasts (`worksToast`, `workName`) and runs
  `afterWorksChange`: `markDirty`, card refresh, HUD, autosave; `tutorial.notify('workBuilt')` on a build); `worksPanelData(state, world, id, Date.now())` rides in `regionCardData`; map marks
  (`derived.worksMarks = worksMarksData(...)` in `refreshDerived`, `drawWorksMarks` right after the settlements and before the garrison badges, clouds, fx and labels, hidden in fog, steady under Reduce Motion);
  `startBattle` calls `playerBattleStats(state, world, regionId)` and `app/income.js effectiveRegionIncome` multiplies by `worksIncomeMult`, so the fight and the card show what `incomePerSec` pays.
- **Works copy is derived, not typed** (`meta/works.js` `EFFECT_LINES`, `workEffectText`, `workBlurb`): one line of words per effect with `{n}`/`{level}` placeholders, the numbers read from `WORKS.effects`
  (Barracks: camp troops and camp growth; Stables: march speed, supply time and field-clash strength; Shrine; Watchtower; Market). `meta.works.test.js` fails when a numeric effect in `config/works.js` has no line, when a
  line's number is not the config's (every level), when a line outgrows a row, and when ANY string in `meta/works.js` (or a Works number in a scene, app or `ui/works*` file) contains a typed number.
  The battle's supply tooltips and toasts show the interval as this battle plays it (`supplySec()`: `SUPPLY.intervalSec` x `battle.player.supplyIntervalMult`, shorter with Stables next door).
  `tools/gallery/works.js` now uses the region card's own Works panel (`card.works`) instead of mounting a second one.
- **Watchtower free scout**: `meta/intel.js` now exports `isScoutedOrFree` (`intelOf(...).scouted || worksScoutedFree(...)`), used by `canScout`, `canSabotage` and `intelPanelData` (which adds
  `scoutedBy: 'watchtower'`; the panel shows a "Watchtower" tag beside the leader line); the world scene's garrison badges (`derived.scouted`) use the same predicate over the frontier.
- **M3** (`FEATURES.works = true`): after the third conquest, while no Work is standing (`worksTutorialDue`), pointing at the label of `worksTutorialRegion` (an owned region with a free slot bordering
  hostile land); once an OWNED card is open it follows `ui.regionCard.works.buildButton()` ("Tap Build to raise a Work here."), and with the chooser open `chooserRow('barracks')` ("Barracks add troops
  to your camp in the fights next door."); a card with no free slot has no target, so the hint hides. Completed by `workBuilt`; the monitor (`tools/hintMonitor.js`) resolves all three stages on its own.

## Music (`game/audio/music*.js`, docs/MUSIC.md; wired in main.js and battle.js)
- `createMusic(sfx, { seed, reverb })` in main.js (`?dev=1&music=noreverb` drops the convolver); it shares the
  sfx context and master gain, so master Sound mutes music too. `applyMusicSettings` sets volume 0 when
  `settings.music` is off; `music.setSeed(state.seed)` runs in `applyWorld()` (boot, import, reset, new dynasty);
  `visibilitychange`/`pagehide`/`pageshow` pause it; the three `goto` wrappers set the scene (title bed only
  plays if the first gesture leaves you on the title; a Continue click goes straight to the world bed).
- Battle scene: `music.setIntensity(battleIntensity(battle))` and `setAssault(battleAssault(battle))` every live
  frame (pure helpers in audio/musicIntensity.js), `stinger('victory', { resolveInSec })` armed when the
  sequence starts so the resolve lands on the existing `victory` fanfare (`victory.endMs`; Skip fires the fanfare
  early, the resolve still lands at its original time), `stinger('defeat')` beside `sfx.play('defeat')`, a retreat
  crossfades to the world bed, Retry sets the battle scene itself (it does not go through `goto.battle`).
- **Audio unlock on touch:** a touch is a user activation only when it ENDS, so a one-shot `pointerdown` listener
  never unlocked audio on phones. main.js offers every gesture (pointerdown, pointerup, touchend, click, keydown)
  to `sfx.unlock()` until the context is actually `running`. check.mjs asserts music voices > 0 after the first
  click at desktop and phone size.
- Settings: Music toggle + volume slider (live while dragging, saved on release); defaults `music: true,
  musicVolume: 0.4` in `defaultSettings()`. Dev hook `__hd.music` (`getDebug()`: started, scene, pending, layers,
  activeVoices, errors).

## Accessibility, robustness, Keepsakes and the playtest fixes (rounds of 2026-10-01; DESIGN 7.5a)
**Dialogs and the keyboard** (`ui/dialogs.js`, `ui/live.js`, `styles/components/a11y.css`)
- Every panel that takes the screen is a *dialog*: `watchDialog(el)` (Settings, council, Realm, Regions, welcome, results) or `openDialog` (`createModal`). Opening moves focus in (the
  `data-autofocus` element, else the first action, else the close button), makes everything else `inert` (except `[data-keep-live]`: the toasts), sets `<html data-dialog>`, traps Tab, owns
  Escape (capture phase, topmost dialog only) and restores focus to the opener on close. `onDialogChange(count)` is how the battle pauses itself while a dialog is open.
- `data-dialog` is also what `input/pointer.js` and the global M-mute handler check: **no map shortcut fires inside a dialog or on a focused button/input** (Space and Enter on a
  button activate it, they never also pause). Letter shortcuts use `event.code`.
- A mouse or touch press blurs the button it pressed (`click.detail > 0`, `main.js`), so Space (pause) never re-presses "Speed"; keyboard activation keeps focus.
- Live regions: each toast message is its own polite status; `announce(text)` writes to one global polite region (the map cursor, the battle cursor, hints, results, import and copy
  messages); the gold counter is deliberately NOT live. Reduce Motion follows the OS until the player chooses (`reduceMotionSet`), cuts the camera (`camera.instant`) and stills every loop.
- `tools/a11ycheck.mjs [--only=desktop|phone|motion|keyboard]`: the browser's own accessibility tree (CDP `Accessibility.getFullAXTree`): no unnamed controls, dialogs trap and restore focus,
  touch targets >= 44 px on a phone, Reduce Motion under `prefers-reduced-motion`, and the **keyboard-only game**: New Realm, the map cursor, the Regions list, a card, Attack, a
  keyboard send, a win, Continue (about 30 assertions).

**The keyboard on the maps (B1, B2)**
- World: the `#world` canvas is `role=group aria-roledescription=map`, a tab stop only while the world scene is up (`tabIndex` 0/-1 in `enter`/`exit`). Arrow keys move a ring
  (`overlays.drawCursor`) to the revealed region that lies most nearly that way (neighbours preferred, 65 degree cone); `[` `]` cycle the regions you can attack (the list's order), Enter/Space
  open the card and put focus on its action, `+` `-` zoom, Shift+arrows pan; Escape from the card returns focus to the map. Every move is said through `announce` with the same sentence the
  Regions list uses (`app/regionsList.js regionSummary`). Enter and Space act only once the cursor has been used from the keyboard (a mouse player's Space does nothing new).
- **Regions list** (`ui/regionsPanel.js`, HUD button "Regions"): every revealed region as one button named by a sentence; frontier first (easiest first, walled-off last), then yours.
  Choosing a row closes the panel and opens the card exactly like a map click. `world.js` keeps it fresh once a second while open.
- Battle: arrows move a ring between settlements (`battle.js moveSiteCursor`), Enter selects/deselects one of yours or sends to another from the selection (or from the War Camp when nothing is
  selected; Auto turns it into a supply line), an armed power targets the cursor site; the live region says what Enter would do (`previewSend` words). `activateSite` is the one function a click
  and Enter share. Dev hooks: `__hd.mapCursor()`, `__hd.siteCursor()`, `__hd.regionHintBox(id)`, `__hd.hintOutline()`.
- The send arrow is shape-coded (`render/sprites.js drawDragArrow`): solid + check + "Capture" (green), dashed + cross + "Not enough" (red), dotted + "No route" (grey); on touch the tooltip sits
  84 px above the finger. `dragInfo()` reports `shape`, `mark`, `word`.

**Colour-blind-safe factions** (`config/world.js`, `core/colorDistance.js`, `tests/ui.a11y.test.js`)
- CIEDE2000 under protanopia, deuteranopia and tritanopia (Machado 2009, severity 1) between every pair of faction colours must be >= 15 (a test fails below that) and >= 20 normally.
  Colours: azure `#3d7ef0` (you, unchanged), Free Folk `#a19c92` (was `#9a927f`), Crimson `#c63932` (was `#d8433f`), Violet `#6d1b99` (was `#9b5de5`: azure and violet were 1.9 apart for
  deuteranopes), amber `#f29e38` (unchanged). Minimums: normal 24.5, deutan 19.3, protan 22.5, tritan 22.8. Violet got a dark and a light variant (`#3b1058`, `#d3b5ff`); banners and
  emblems are about 25% bigger with a dark under-stroke, so the emblem (all five differ) carries as much as the colour.

**Robustness** (unit tests in `tests/robust.test.js`, real-browser assertions in `tools/robustChecks.mjs`, run by `check.mjs`)
- `scenes/flow.js`: a scene whose `enter` throws is exited and the previous scene entered again (`reverted: true`); `main.js` toasts it. Attack is also guarded by `attackable` and the card shows
  "No passable border: conquer a neighbour first" (`attackBlock`); the tutorial picks only among `attackableFrontier`.
- `app/stateContainer.js` keeps an `epoch` (boot, new realm, restart, dynasty, import): a pending welcome, prosperity cheer or idle pop carries its epoch and is dropped when it no longer matches.
  Settings survive New Realm and restart. An untouched realm behind the title never "earns" (the visibility handler returns while `!sessionStarted`); a save with `lastSeen <= 0` counts as seen now.
- `app/autosave.js`: every write carries a rising `saveSeq`; before writing, a tab reads the stored one and, if another tab has written since, stops for good and shows a persistent banner with
  Reload (the `storage` event tells an idle tab at once); a tab that never entered a session never writes. A failed write toasts once.
- `meta/save.js`: `plausibleBattle` (version, arrays, arena region, tiles) decides whether a saved battle is kept; the resume path is wrapped (clears it and toasts "That saved battle couldn't be
  resumed" on any throw); a battle for an already-owned region is dropped. Every field is sanitised on load (finite, clamped, integer levels within their maximum, known upgrade ids,
  owner ids below the number of factions, settings whitelisted, dynasty level capped); `importCode` refuses more than 256 KB. `ui/format.js`, `renderer.js` (no 2D context) and the boot
  fallback (`textContent`, never `innerHTML`) are guarded.
- `sw.js` (cache `hexdominion-v2-5`): deletes only `hexdominion-*` caches (the origin is shared with the owner's other Pages projects), serves the cached copy for a 5xx, a slow network (3.5 s) or a
  captive portal's HTML (content type against destination), awaits and catches every cache write. `tools/serve.js --hooks` adds `?__respond=NNN` and `?__portal=1` for the real-browser check; the unit
  test (`tests/sw.test.js`) runs the worker in `vm` against a fake CacheStorage.

**Keepsakes wiring** (docs/briefs/keepsakes-hookup.md): `state.chronicle` (`createChronicle` in `createGame`, `sanitizeChronicle` in `withDefaults`, both imported from `meta/chronicleState.js`);
`chronicleOnConquest` in `battle.js onResultsContinue` and `world.js onSurrender`, `chronicleOnProsperity` through `main.js runProsperity` (every prosperity tick), `chronicleOnDynasty` in
`stateContainer.tryFoundDynasty`, each guarded so the story can never block a conquest; the Realm panel mounts the Chronicle, "Save the map" and the same button in the Found a Dynasty
confirmation; phones get a two-column stats grid below 480 px. `tools/keepsakeChecks.mjs` plays it for real on desktop and phone.

**Playtest fixes (2026-10-01)**
- Hint placement (PLAYFEEL 4): a hint about a REGION keeps clear of the region's whole on-screen extent (`app/hintTargets.js regionHintBox`, capped at 55% of the viewport), the region is outlined
  on the map (`overlays.drawHintRegion`, a bright pulsing outline; still under Reduce Motion), the coach's ring is off for it (`noRing`), and the bubble never takes a click (only its x does).
  `tools/hintMonitor.js` measures against the same box and also fails a bubble that covers card information (the "Attack!" bubble sits in a slot the card opens above its button:
  `regionCard.setHintSpace`; on a short screen it goes beside the card instead).
- Region card: header, a body that scrolls inside, and a footer holding Attack/Accept Surrender (never over a row); compact below 420 px height; the bar is the CHANCE of winning with words
  ("about 1 in 5", `app/chanceWords.js`), power and strength as small print. Battle timer pill: "0:31 - Swift 0:43", dimmed and worded once missed (`crowns.swiftDeadlineSec`). Speed cycle
  1x/2x/3x, plus 0.5x with Settings > Slow battles (`settings.slowBattles`). Orders given while paused wait: ghost arrows and one toast. Phones zoom at most 28 px per unit.
- Smaller: the C1 supply hint waits for the first capture of that battle; the scout panel prints what "weak point" means; Works says "Helps battles in the regions next to this one"; the welcome
  card says "(capped at N h)" beside the figure; owned-region labels have a heavier outline; War Camp tents are about a third larger and tagged in the first battle; the landscape title is two
  columns; Settings > Copy says "Copied"; the council hint names the Best value buy; toasts pause while hovered or focused; a tap on anything that has only a `title` shows it in a toast; refused
  actions show a toast and shake the button; Effects volume slider and the M mute key; map chips and power names are at least 11 px.
- `tools/playtestChecks.mjs` (run by `check.mjs`, plain mode) asserts all of it with real input on desktop, phone and landscape phone.
- **No toast over an open dialog** (`ui/toasts.js setHeld`, wired in main.js to `onDialogChange`): while any modal dialog is open, new toasts wait in a queue (same
  id or same words merge, at most 4, oldest dropped) and toasts already on screen step back into it (those with more than 1.2 s left); they come out one by one
  250 ms after the last dialog closes. Feedback for actions taken INSIDE a dialog is shown inside it: the council's polite status line under its header
  (`council.setStatus`: "Bought Steel, level 3", warnings in amber) plus the bought card's flash, Settings' Copied / Import lines, and "Map saved" beside the
  Save the map button that was pressed (`realm.setSaveStatus`, in the Realm panel or the Found a Dynasty confirmation). `tools/hintMonitor.js` fails any frame in
  which a toast overlaps an open `[aria-modal]` dialog (so `check.mjs` and `hints.mjs` both catch it); `check.mjs` also asserts the council status line.
- **An armed power never turns a send drag into a pan** (`battle.js canStartDrag`): a drag that starts on one of your settlements while Rally/Firestorm/Bulwark waits
  for its target stands the power down (a short toast) and sends. Before, every drag while a power was armed was a map pan; on a phone a hint's x button sat on the
  enemy keep, ate the Rally target tap, and the battle could no longer be played (the RC2 playtest stall). Edge positions were measured with real touch at x = 40,
  20, 8, 2 and a camp half off screen: the hit test and the 10 px touch slop behave the same at the edge (no pan). `check.mjs` arms Rally and drags from the camp.
- **Battle hints keep off the enemy keep(s)** (soft obstacles added to every battle hint's `avoid`), and `hintMonitor` fails a bubble over an enemy keep.
- **Touch drag word**: on touch, while the drag tooltip is showing (it already states the outcome, 84 px above the finger), the canvas outcome word is not drawn;
  the shaft style and the check/cross stay. `dragInfo()` adds `wordDrawn` and `tooltip`; `check.mjs` asserts both cases.
- **Realm with the continent won**: the Dynasty section moves to the top of the Realm body (`.is-dynasty-ready`), so Found a Dynasty is on screen on a phone.
- **W2 framing** (`world.js frameForW2`): when hint W2 starts and its region is not comfortably in the free part of the screen (label outside, or under 70% of its
  extent inside), the camera flies (700 ms, instant under Reduce Motion) to frame the home region and it; the hint waits for the flight.
- Council effect lines stay on one line: when "+0 War Camp troops → +2 War Camp troops" does not fit, the current value keeps only its number (`.is-compact`).
- **Power names are never ellipsised** (`ui/battleHud.js fitNames`): a full name that overflows its box gets `.is-short` (the short form: "March"); if the
  visible form STILL overflows (phones always show the short form: "BULWARK" was 1 px too wide for its 58 px column at 390 px) it also gets `.is-tight`
  (letter-spacing -0.03em); phones use no extra tracking. `check.mjs` asserts no `.power-name` overflows in the desktop and phone battles.

## Deployment: the project subpath (https://ka1e27.github.io/temp/)
- The site is NEVER served from "/". `node tools/serve.js --base=/temp/` (also `--root=<dir>`, `--port=`) serves the repo
  under that prefix with nothing at "/" (404) and a 301 from `/temp` to `/temp/`, like Pages. In Git Bash write
  `--base=temp` or let the tools cope: MSYS rewrites `/temp/` into `C:/Program Files/Git/temp/`, and both serve.js and
  check.mjs read a drive-letter path as its last segment.
- `node tools/check.mjs --base=temp` runs the whole suite against that server (service worker registered via `?sw=1`,
  which index.html honours on localhost only) and then the deploy checks: every same-origin request resolves under the
  prefix with the right MIME type, the worker's scope and script, exactly one cache, every file the first load used is in
  it, manifest `start_url` / `scope` / icons (and their pixel sizes), `classic.html` boots the v1 game, and an OFFLINE
  reload straight after the FIRST visit boots the game from the cache and enters the world. "Offline" means the check STOPS
  its server: CDP's offline emulation covers only the page, not the worker's own fetch, so it passes even for a worker that
  cached nothing (verified: the previous worker, with no precache, fails this step). CI runs it as a second step.
- **sw.js**: network-first with a cache fallback, relative to its scope. A worker never controls the page that registered
  it, so nothing the FIRST load fetched was cached and an offline reload right after a first visit failed. Now the shell is
  cached at install and index.html posts the page's own resource list to the worker (a 'precache' message) once it is ready.
- All shipped references are relative and case-exact (checked: 1106 relative references in js, css, html and the manifest;
  GitHub Pages is case-sensitive, Windows is not).

## Tooling
- `tools/pageshot.mjs` screenshots any served page; `tools/shots.mjs` is the tour of the real game;
  `tools/check.mjs` is the CI smoke test (real pointer/touch input, fresh profile). It asserts that a fresh
  realm's first frontier card offers Attack (a surrender is never offered before the first victory), presses
  Attack SLOWLY (150 ms between pointerdown and pointerup, with gold ticking and a forced card refresh in the
  middle: the button node must survive and the battle must start), checks the crown UI on the cards, the victory
  card and in the save, that music unlocked on the first gesture and follows the scenes, accepts a real-click
  surrender once one is on offer (growing the realm through the upgrade table if needed) and drives the
  music-volume slider and Leader-voices toggle. `tools/shots.mjs --only=battle` plays the battle frames (start,
  fight, capture, firestorm, victory, reveal, a rival fight with intent + threat chips, defeat) and
  `--only=hook` the crowns / leader banners / Realm / Settings frames, all with real input.
- `tools/playtest.mjs --variant=desktop|phone` plays a first session as a new player with real input (tutorial hints in order, first
  battle, victory and crowns, council shopping with "ECON" / "SHOP" lines (gold vs prices, scout and sabotage affordability), battles 2 and 3,
  3 h away and the welcome-back card past the cap, then the Found a Dynasty flow and the first D2 battle; `--dynasty=off` skips the last). Its
  bot reads the drag preview like a player (it sends only what `previewSend` says captures, and waits for the camp to refill otherwise) and prints a
  timeline of every panel that appeared, overlaps between panels, panels leaving the viewport, clipped text and console
  errors, with screenshots (`--prefix=qa`). It is read, not asserted; it is how the first-session bugs below were found.
- First-session rules found by it: a timed tutorial hint (step 0: 5 s, step 4: 10 s) counts down only while it is ON SCREEN
  (`main.js` calls `tutorial.update` only when the coach is visible; it used to run on the title screen, so step 0 was never
  seen); the welcome-back gold is credited at once but the HUD holds it back (`creditHold`, welcome flavour) until Collect
  sends the coins up (Escape or a scene change releases it); the Skip button of the victory sequence sits bottom-centre
  (top-centre belongs to the leader banner).
- `tools/shots.mjs --only=rc` writes the release-candidate gallery `screenshots/game/rc-*.png` (desktop, and `rc-phone-*`): title, first screen and first
  hint, frontier card, the tutorial battle with its arrow and a drag held over the soft target (green arrow), a fight, the victory card with its
  crowns, the next region's scouted card and a mid-game realm with prosperity III. The README's `docs/img/realm.jpg` and `battle.jpg` (1200x750 JPEGs)
  come from `tools/docshots.mjs` (since RC2): a mid-game realm with an owned card showing prosperity and Works, and a battle with no tutorial
  arrow and a held 100 % drag over a capturable settlement (the solid green "Capture" arrow); PNG copies go to `screenshots/game/doc-*.png`.
- **Launch assets** (`tools/launch-assets.mjs`, `tools/launch/launchArt.js`): `og.png` (1200x630), `icon-192.png`, `icon-512.png`,
  `icon-maskable-512.png`, `apple-touch-icon.png` (180), `favicon-32.png` and `favicon.svg` are rendered from the live game, never
  drawn separately. The icon composes `drawTileBase` (an island hex), `drawSettlement` (keep), `drawBanner` (player banner) and
  the real sea colour field (`seaRGB`), each size at its own resolution (vector drawing, so 48 px is crisp, not downscaled).
  Three kinds (`KINDS` in launchArt.js): `any` (rounded corners) and `apple` (full-bleed, opaque) have no safe zone to respect,
  so the island hex fills ~85% of the canvas height with a big keep and banner; `maskable` is full-bleed with everything inside
  the 80% safe circle, hence its small hex (contact sheet: `screenshots/game/launch-icons.png`). **`mini`** (`favicon-32.png`
  and the 64 px PNG inside `favicon.svg`, which keeps its name) is a simplified mark for 32 px and below: a deep-azure hex, the
  player banner as large as the hex allows with a cream halo (the azure cloth would melt into an azure hex without it), and
  the keep cut to a plain stone silhouette. Readability beats detail there. `og.png` is a real frame: `startNewRealm`, `conquerRegions(10)`, `advanceTenure(9)`, ambient at full
  quality, the camera on the lushest keep-and-windmill corner (`pickHero` scores owned regions), UI hidden, rendered at DPR 2
  and downscaled in page, with an HTML wordmark over it. `--seed` / `--zoom` / `--dx` / `--dy` / `--x` / `--y` reframe it;
  the committed card is seed 6. `--out` and `--preview` write elsewhere (a run with no `--out` overwrites the repo-root assets).
  `tools/shellcards.mjs` (the v1 generator, it would overwrite all of these with v1 art) is disabled unless `--v1` is passed.
  `docs/img/realm.jpg` and `battle.jpg` (README) live in `docs/` because `screenshots/` is git-ignored; retake them with `node tools/docshots.mjs`
  whenever the look changes (last retaken for RC2, after the colour-blind-safe faction colours). The service worker cache name was bumped (`hexdominion-v2-4`) and the shell now also precaches the maskable
  and apple icons.
- **`tools/cdp.js` launches Chrome with `--disable-gpu`: canvas work is rasterised on the CPU.** Frame
  times measured through it (shots.mjs, pageshot) are software-raster numbers and far worse than
  a real GPU (~2× at 1440×900); never use them as a pass/fail criterion. For real-GPU timings
  launch headless Chrome without `--disable-gpu` (e.g. `--use-angle=d3d11 --enable-gpu-rasterization`).
- The Browser-pane preview does not run rAF while the pane is hidden. Pane screenshots come back
  cropped at DPR 1.75; prefer pageshot for full-resolution captures.
- In Git Bash never start a path with "/" (MSYS rewrites it); Node's own `fs` calls resolve `/tmp` to
  `C:\tmp`, while shell arguments are translated — pass scripts by path rather than reading `/tmp` from Node.


## The Living Frontier, integration side (round 4, Phase 1; ARCHITECTURE 10.1, 10.2, 10.5)
**The battle manager** (`game/app/battles.js`, `createBattleManager({ getState, getWorld, services })`, one in `main.js` as `services.battles`, dev `__hd.battles`)
- Owns every running battle: `state.battles` (BattleRun[]: `{ id, kind: 'attack'|'defense', regionId, battle, commander, auto, startedAt }` plus, for a defense,
  `fromRegionId, attackerFaction, raidId, first`). `main.js` calls `manager.tick(dt)` every frame BEFORE the scene, whatever scene is up, never behind the title.
  Each run has its own fixed stepper (interpolation: `alphaOf(id)`); speed and pause are global (`setSpeed`, `setPaused`), and any open dialog holds every
  battle (`setDialogHold`, wired to `onDialogChange` in main.js).
- Per step and run: `beforeStep` (the view snapshots units and owners), the enemy `think()`, the steward for a run nobody watches or set to Auto
  (`battle/steward.js stewardDecide(battle, t, undefined, run.commander ? 'stalwart' : 'captain')`; its memo rides in `battle.steward`, so a resumed battle
  resumes its steward; `setStewardDecide(fn)` swaps it), `step()`, the crown tracker. Events go out per tick as `'events' (runId, events)`; the battle view plays
  fx/sfx only for its own run. `setGate(id, fn)`: the view holds its run while its fly-in, a hit-stop or its end sequence plays (exactly the old phase gate).
- A decided run emits `'ended'` once. The WATCHED run is finished by the view (its victory sequence / results card call `recordResult` then `finish`); an
  unwatched one is recorded and finished at once and emits `'remoteEnded' (id, { kind, regionId, result }, out)` (main.js: a toast; a won attack plays its
  conquest on the map where it is, `worldScene.onRemoteConquest`). `finish(id, { crownResult })`: an attack won -> `conquer` (which retakes an occupied
  region) + crowns + chronicle, moved here from the scene; an attack lost or retreated -> nothing; a defense won -> `defenseReward` (gold, militia drain,
  cooldown); a defense lost or RETREATED -> `occupy`. `recordResult` keeps the lifetime stats once per run. `busy()` is `meta/frontier.js busyFromState`.
- `start(spec)` refuses a fourth battle (`MAX_BATTLES` = 3) or a second battle on a region; it keeps a defense run's own id (drawn from `state.frontier.seq`).
- **Save** (`meta/save.js sanitizeBattles`): a legacy `state.battle` migrates into a one-element list (an attack, id 1). A run is kept only if `plausibleBattle`,
  its `regionId` matches its arena, an attack's region is still the enemy's and a defense's still yours; one run per region; at most 3; unique ids. `withDefaults`
  also sanitises `frontier`, `occupation`, `forts`, `militia` with the sim side's own sanitisers; `createGame` starts them empty (`defaultFrontier()`).

**The battle scene is a view** of `manager.focused()`: `switchTo(id)` (a camera flight, no intro; only while live, never mid end-sequence), `onMap` (the HUD's
**Map** button: the battle keeps running under its Captain; never offered in the very first battle), `enter({ runId })` opens a running battle from the map,
`enter({ resume })` the focused or first saved run. **Tab** on the battle map switches to the next battle (Shift+Tab the previous) and never wraps: from the
last one Tab moves focus on, so the keyboard is never trapped.
- **Defense runs:** site 0 is the ENEMY war-band camp (`campSite()` checks the owner, so the camp helpers, the tutorial arrow and the camp tag skip it);
  the timer pill shows `Hold m:ss` (the siege left) instead of Swift; Retreat asks "Abandon Fenwall?" (a retreat from a defense is a loss); the end has no
  conquest choreography: a fanfare and the **Defended** card (the reward it will pay on Continue) or the defeat cue and **Region lost** ("occupied by ...;
  retake it from the map", Back to Map only, no Retry). Walls draw a stone ring round the keep / forts in battle (`site.defMult > 1`). Attack arenas get
  `attackArenaOpts(state, world, regionId, manager.busy())` (busy sites and an occupier's captured fortifications).

**The tray** (`ui/battleTray.js`, `ui.tray`): one chip per run (kind icon and word, region, clock, a bar of your share of the troops, a red pulse when a settlement
of yours is outnumbered by what marches at it; still under Reduce Motion), built once per run and patched in place; the chip's name says everything. Beside it
the **Captain** toggle (`setAuto`; not called "Auto": the battle HUD's Auto is the supply-line switch). Shown on the map with one or more battles, in a battle
with two or more. `main.js updateTray()` feeds it 4x a second.

**On the map:** crossed swords over every region being fought over (`render/battleMarkers.js`); incoming war bands marching keep to keep with their
strength (`render/warBands.js`, from `state.frontier.incoming`); occupied regions hatched in the occupier's colour (`render/occupation.js`) with a hatched
badge by the name (`labels.js occupied`); fortifications as structures (`render/fortMarks.js` from `fortsMarksData`). Region card: an owned region under
threat says "The X arrive in N s (Fair to hold)" with **Go**, or "Under attack: your Captain holds it" with **Watch**; an occupied one says "Occupied by the X:
retake it to restore its income, Prosperity II and 2 buildings" and its button reads **Retake**; a region already being fought "Watch the battle".

**The frontier loop** (`app/frontierLoop.js`, `services.frontier`): `tickFrontier` on ACTIVE time (the map or a battle up, the tab visible, no global pause, no
dialog). Announced raid -> a warning toast with **Go** and a live countdown (in place, once a second; on a phone the in-place update never waits behind a
leader banner), then the leader line. **Go** before arrival flies the map to the region and opens its card; the defense opens itself on arrival. Arrived ->
`defenseRunFor(state, world, raid, undefined, { nowMs, busy: manager.busy() })` + `manager.start`; unless Go was pressed, a toast "under attack: your
Captain holds it [Go]". Dev/checks: `__hd.raid(toRegionId, { sec, first, mult })`.
**Fortifications panel:** the Works panel itself, parameterised (`createWorksPanel({ copy, iconFor })`, `createWorksChooser({ iconFor, listLabel })`), fed
`fortsPanelData`; callbacks `onBuildFort / onUpgradeFort / onDemolishFort` -> `meta/forts.js` + `fortsToast`. **Away report:** `resolveAway` after
`offlineEarnings` (boot and tab return), `awayReportText` on the welcome card (`.welcome-away`, a red rim when a region was lost; the card also shows for a
report alone). **Toasts** take one `action` button (`{ label, ariaLabel, onClick }`) and queue while a dialog is open (RC2).
**Tutorial:** F1 (map) / F2 (in a battle): "A war band is coming! Press Go to defend it yourself, or let your Captain hold it." on the raid toast's Go; F3: "Two
battles at once: press Tab or pick one in the tray" on the chip of the battle you are not watching; F4: "Fortify your border..." on the raided region, then
its Fortifications Build, then the Arrow Tower row. `FEATURES.frontier` gates F1, F2, F4 and the whole loop. `hintMonitor` resolves all four on its own and
also fails a bubble over an enemy keep and a toast over an open dialog.
**Checks:** `check.mjs --only=frontier` (`tools/frontierChecks.mjs`, `tools/defenseChecks.mjs`), desktop and phone, real input: Map leaves a battle running and its
clock moves, a second attack, switching by chip and by Tab (never trapped), the unwatched battle steps, save and resume with two battles, the phone tray; a raid
toast with a countdown and Go, the defense opening on arrival with the enemy camp at site 0 and "Hold", the Captain commanding it unwatched, a defense won and
its reward, a defense lost -> occupied (forts, works, frozen prosperity moved), retaken with all of it back.

## Generals and Renown, integration side (round 4, Phase 2; DESIGN 10.11, 10.12; docs/briefs/phase2-hookup.md)
- **State:** `createGame` adds `generals` (`defaultGenerals(seed)`: the Marshal) and `renown`; `resetRegions` resets `renown` only; `save.js` sanitises both
  (`sanitizeGenerals(src.generals, seed)`, `sanitizeRenown`). The roster also survives New Realm and restart (`stateContainer.carryRoster`, regionId cleared);
  Settings > Reset wipes it (`newRealm(undefined, { keepGenerals: false })`).
- **Commanders:** an attack's commander is the card's pick (`world.js commanderPick`, a native select on the frontier card: the free Generals + the Militia
  Captain), else `bestFreeGeneral`; `goto.battle({ regionId, commander })` -> `battle.js startBattle` -> `playerBattleStats(..., { commander })` and
  `manager.start({ ..., commander })`; Retry keeps it if still free. A defense gets `nearestFreeGeneral` at the announcement (`frontierLoop commanderFor`,
  in memory), re-checked at arrival. The tray row has a commander select: `assign(run, id, state, world, playerBattleStats)` mid-battle. The steward of an
  unwatched or Captain run is `stewardDecide(b, t, undefined, commanderStyle(g) ?? 'captain')`.
- **Endings:** `manager.finish` calls `settleCommander` for every decided run (`out.commander`, event `commanderSettled`); main.js `onDeeds(out)` (on every
  `'finished'`, and from a surrender) toasts the Renown (`crownAward.renown + result.renown + reward.renown`), level-ups and wounds, and shows the recruitment
  card when `result.recruited` (a modal with the champion's emblem, title, a line; a Chronicle entry of kind `recruit` with `data.text`).
- **UI:** HUD: a Renown laurel on the gold's second line (shown once Renown or a win exists) and a **Generals** button with a dot when a skill waits;
  `ui/generalsPanel.js` (dialog; cards built once per General: emblem, level and XP bar, passive, ability, status with Watch, skill picks with a confirm step,
  Train / Heal / Respec with costs and refusal words, Hire). Owned card: "Festival · N Renown" on the prosperity row (`festival` + `updateProsperity`, confetti),
  "Muster · 1" on a militia row. Battle HUD: the ability button (key **G**, spent after use; a Raid arms target mode and a tap on an enemy settlement fires it;
  fx on the `ability` event: a gold shockwave, its name, a burst on every shielded settlement); Foresight reveals every enemy march's intent line.
- **Tutorial:** G1 (battle, the ability button, after the first battle), G2 (the Generals button while a skill waits), R1 (a region whose Festival Renown can pay,
  then its Festival button). `hintMonitor` resolves them.
- **Checks:** `check.mjs --only=generals` (`tools/generalsChecks.mjs`), desktop and phone: the card's commander (default, keyboard change), Attack under it,
  the ability by press (and G on desktop), save/resume with the commander and the used ability, the tray picker changing the commander mid-battle (the used
  ability stays used), a skill pick with its confirm, Train, a Festival, a capital's champion recruited (card, roster, Chronicle), Found a Dynasty keeps the
  roster and resets Renown. Gallery: `tools/phase2shots.mjs` -> `screenshots/phase2/`.

## A varied map, integration side (round 4, Phase 3; DESIGN 10.13; docs/briefs/phase3-hookup.md)
- **State and callers (§3.3, §6, §7):** `createGame` / `resetRegions` add `boons` (`defaultBoons`) and `worldEvents` (`defaultWorldEvents`); `save.js`
  sanitises both. `canFoundDynasty(state, world)` at both world.js callers (the Lair is optional), `foundDynasty(state, seed, undefined, world)` in
  `stateContainer.tryFoundDynasty`. `app/income.js effectiveRegionIncome` multiplies by `typeIncomeMult(region)` (the card shows what a Gold Mine pays). The
  attack card's label and chance pass the card's commander: `difficulty(state, world, id, { commander })`.
- **Map:** `render/featureGlyphs.js` draws the type icons (pickaxe, bell tower, skull banner, broken arch, dragon head, in a round dark badge) and the twist
  glyphs (moon, snowflake, wave, haloed sun, gate, shrine). `labels.js` places the type badge left of the name (left of a capital's crown) and the twist glyph at
  the front of the frontier chip, inside the label's collision box. The label datum gets `type` (revealed regions) and `twist` (not owned). A plagued
  rival's revealed regions get a sickly yellow-green wash with dark hatching (`occupation.js tint`, a slow pulse unless Reduce Motion) and a plague mark
  beside their names (`featureGlyphs.drawPlagueMark`, label datum `plague`) while `plagueMult < 1`.
- **Card:** `regionCard.js` `features` rows (the map's own glyph on a 20 px canvas + name + one line): type (`typeText`; an owned region says what it still
  does, derived from `FEATURES.rewards`), twist (`twistText`, attack cards only), and "Boss: the dragon must fall" on a Lair. Realm panel: a boon line with
  `FEATURES.copy.dragonscale` while `state.boons.dragonscale`.
- **Battle:** `scenes/battleFeatures.js` (controller) + `render/battleFeatures.js` (drawing). Sprites for `bandit`, `gate`, `shrine` and the Ruins' tower
  (`spriteType`: `ancientTower` when `site.feature === 'ancientTower'`) in `sprites-buildings.js`. Night: a vignette, each tower's halved reach as a dashed ring,
  enemy badges read "?" until `isScoutedOrFree` or a neighbouring tile is yours (`drawTroopBadge` takes a string). Blizzard: a snow layer (sparse and still
  under Reduce Motion), Firestorm's pip reads "+50%". Flooded: high water over the region's river ribbons (one path per layer), planks where a road crosses.
  Holy Ground: every power button greyed with a lock (`is-holy`, aria "cannot be used on Holy Ground"); a press, or a `refused { reason: 'holy' }`, toasts why.
  Siege: the Gate is a gatehouse (curtain walls, portcullis, torches) with a "Gate" tag under it, and the keep it shuts wears a padlock
  (`drawTags`, after the badges); the keep's no-route words are "No route: take the Gate first"; the Gate's capture plays a "The Gate falls!" shockwave
  and the HUD line turns to "Gate breached: storm the keep!". Raid: a ring round each Shrine in its holder's colour, filling with the shared hold once all three are yours. Dragon: drawn perched (folded wings)
  or flying (a ground shadow, an arcing path), a health bar over it, a hit flash on `dragonHit`, the warning circle from `battle.dragon.breath` (fills as it
  nears, a countdown arc), a flame stream + fire bloom on `dragonBreath`, a fall (or flight) on `dragonFall`. The HUD's feature line under the timer: "Hold all 3
  Shrines · 2/3" (a bar; "hold N s" once all held), "Dragon" with its health bar ("fire incoming!" during a warning), "Siege: take the Gate first" / "the Gate is
  down", or the twist's name and effect.
- **World events:** `app/eventsLoop.js` ticks `tickEvents` after the frontier loop on the same active clock (not before the first won battle). An offer is a
  toast with a countdown, a primary button (Merchant "See deals", Duel "Accept"; the Plague, news already applied, just "OK") and a quieter "Decline"
  (`toasts.js` `secondary`, `has(id)`, `className: 'is-event'`: a wider toast with the buttons under the words, stacked below a leader line when one
  is up); a toast closed with its x stops re-opening. The Merchant opens a dialog with both deals (Renown for gold; a fortification
  level with region and type pickers and its `merchantFortPrice`), a refusal says so in the dialog. A Duel accepted builds `duelRunFor` (the free General
  nearest the region) and `manager.start`s it, then opens it. Chronicle entries (kind `event`, `data.text`) for every offer and outcome; the Duel speaks the
  rival's `battleStart` line. `manager.finish` has a Duel branch: `duelReward`, `out = { kind: 'duel', won, renown }`, never occupies, and a Duel lost settles
  no commander (no wound). The battle scene treats a Duel like a defense (Hold timer, "Yield the duel?") with its own result card (`duelWon` / `duelLost`).
- **Deeds:** `onDeeds` also toasts Dragonscale (and a highlighted Chronicle line) when `result.dragonscale`, and writes the Duel's Chronicle line.
- **Tutorial:** V1 (a typed or twisted frontier region), V2 (the first Siege: the Gate), V3 (the first Raid: a Shrine; the hold from the config), V4 (the Dragon's
  warning: the Bulwark button), V5 (a world event's toast). `hintMonitor` resolves them.
- **Checks:** `check.mjs --only=variety` (`tools/varietyChecks.mjs`, seed 9), desktop and phone; `game/tests/integration.phase3.test.js` (save round-trip,
  card income parity, the manager's Duel branch, the steps). Gallery: `tools/phase3shots.mjs` -> `screenshots/phase3/`. Dev hooks: `__hd.offerEvent(kind)`,
  `__hd.events`, `__hd.featureInfo()`.

## Goals and Rivals, integration side (round 4, Phase 4; docs/PLAN-PHASE4.md; docs/briefs/phase4-hookup.md)
- **One glue file:** `app/goals.js createGoals({ getState, getWorld, ui, services })` (as `services.goals`) owns no rules. `tick(dt)` runs every frame after the
  frontier loop (throttled to 400 ms): `tickStreak`, `drainDeedNews` (a stamped toast + a Chronicle line per tier; held back while a battle is on screen),
  `drainGrudgeNews` (the `grudge` voice) and `ensureBounties` every 2 s. The battle manager's `'finished'` event calls `goals.onFinished(snapshot, out)`:
  `onBattleEnd` with `snapshot.summary` (`battles.js finish` builds it with `battleSummaryFor`), the streak, a Vendetta's end (Trophy toast, voice lines),
  a Duel's voice line. `main.js onDeeds` calls `goals.onConquest` for every conquest (a surrender too); the world scene calls `onProsperity` (Festivals),
  `onFortBuilt`, `onScout`. **Rule:** every hook's completions go straight to `claim()` (`claimCompleted` + a seal-stamped toast + a Chronicle line).
- **The streak breaks only on an ATTACK lost or retreated** (Phase 5 §5E): a retreat from a defense already costs the region, so it costs no streak, and the
  defense's "Abandon?" confirm carries no streak warning. The attack's Retreat confirm adds `goals.retreatWarning()` while a streak is alive.
- **UI choice (§2.2): the Bounty Board is the top of the Regions panel** (`regionsPanel.js` board, one row per slot, built once per slot and patched; the
  Reroll press survives refreshes). The HUD's Regions button carries a dot while a contract on the board is unseen (`hudData().boardNews`; opening the panel
  calls `markBoardSeen`). Rival rows (met leaders, a Grudge meter each, `ui/grudgeMeter.js`) sit under the board; a rival's region card has the same meter.
- **HUD tabs** hang under the bar's left edge (`hud.tabsEl`): the streak's flame chip ("×1.2 · 3", a ring that drains with the window; static under Reduce
  Motion) and the envelope pip that reopens a closed world-event offer.
- **Realm panel:** `ui/deedsPanel.js` `createDeedsSection` (the grid: medal, pips per tier, a bar, "what the next tier asks · what it grants" from
  `app/goalsCopy.js deedGoalText`) and `createTrophySection` (a banner per Vendetta beaten, shown once a rival is met).
- **Vendettas:** the frontier loop's raid toast gets `className: 'is-vendetta'` (a red banner with the leader's pennant); the battle draws the Champion with
  the leader's pennant and plays "{Leader}'s champion has fallen!" (`battleHud.showChampionBanner`) on `championFell`.
- **Tutorial:** Q1 (the board has opened: the Regions button), Q2 (a Vendetta's Go). **Checks:** `check.mjs --only=goals` (`tools/goalsChecks.mjs`);
  gallery `tools/phase4shots.mjs` -> `screenshots/phase4/`. Dev hooks: `__hd.vendetta(faction, opts)`, `__hd.bounty(kind)`, `__hd.goals`,
  `__hd.conquerRegion(id, { hooks: true })`.

## Dynasties that change the rules, integration side (round 4, Phase 5; docs/PLAN-PHASE5.md; docs/briefs/phase5-hookup.md)
- **Worlds:** every `generateWorld` for a state goes through `worldOptsFor(state)` (`stateContainer` boot, found, import): Long Winter, Age of Dragons and
  Open Roads shape the continent, and a reload must regenerate the same one. `newRealm` keeps the plain call (a new realm has no Edict).
- **Glue:** `app/dynasty.js createDynasty(...)` (as `services.dynasty`) builds the ceremony's data, the Realm panel's `dynastyRules` (Edict, laurels) and
  `legacy` (the tree view: `legacyTreeText` + `legacyInfo`, states owned / affordable / short / locked with a reason), and `ui()` (the few UI facts:
  Iron Will, Lone Banner, ability uses, streak, raids, Bounty slots, Quick Conquest). It maps the config's icon names to the UI's own: an Edict crest per
  Edict (`edictIron` ... `edictRoads`), a medallion per Legacy branch (`legacyWar/Realm/Court`), a mark per Challenge (`challengeIronWill/Overrun/LoneBanner`,
  drawn inside the laurel). Legacy points use the `tree` icon.
- **The founding ceremony** (`ui/ceremony.js`, replaced the old confirm; `world.js onFoundDynasty`): a five-page stepper over the live map (a veil, a
  gold-rimmed panel; full screen below 600 px): summary (stats, stars, Legacy earned, the "Save the map" keepsake moved here from the old confirm), the
  Legacy tree, the Edict cards (a radio group; Next is refused until one is picked), the Challenge toggles (the "harder" warning lights when one is ticked),
  and "Found the House of {name}" with a recap. The House is named after the home region of the continent being left. **The seed is drawn when the
  ceremony opens** (`container.nextSeed()`): the Edicts are drawn for it and the new continent is made from it.
- **Ceremony Legacy is bought on a PREVIEW** (`dynasty.beginSession(seed)`: the real record + `legacyPointsForFounding`), because the points the founding
  grants exist only on the state `foundDynasty` returns. Heralds bought there redraws the Edicts (the preview's nodes). "Found" passes the buys as
  `legacyBuys` (`foundDynasty` applies them before the dynasty-start effects, so War Chest / Royal Treasury count at once); the container also buys any
  that did not land, in order. Closing the ceremony (×, Escape) discards the preview: nothing is spent.
- **Realm panel** (`ui/dynastyPanel.js`): the Edict (crest, name, gain and price lines) and the laurels at the TOP of the body; the Legacy tree (branch tabs,
  spend any time, `onBuyLegacy(id, 'realm')`) under the stats, once a founding has granted Legacy. Results are said under the tree, never as a toast.
- **Quick Conquest** (`app/quickConquest.js` as `services.quick`; `ui/quickOverlay.js`): `meta/quick.js` is imported lazily (no button until it loads).
  The card's `quick` datum is `cardData(regionId, commander)` (null = no button; greyed with a reason while the region is busy); the button sits beside
  Attack (`.region-card-actions-row`; icon-only on a phone). A press: `createQuickConquest` with the card's commander, then `stepQuickConquest(job, 600)`
  per animation frame (a hidden tab falls back to a 16 ms timer) while the overlay's bar fills over at least 1.1 s (0.5 s with Reduce Motion), then
  `finishQuickConquest` (ALL the meta bookkeeping, the Bounty Board included). The world scene then clears the region's intel, writes the Chronicle line,
  calls `onDeeds({ quick: true, ... })` (Renown, level-ups, a recruit; `quick` stops a second `goals.onConquest`), plays the conquest choreography, toasts
  "{region} is yours: Victory crown, +N gold" and celebrates any claimed contracts (`goals.celebrateClaims`). A loss shows a small card with "Attack it".
- **Rules in the UI:** Iron Will: every power button locked with "No powers: Iron Will" (`powers[i].blocked`, drawn like Holy Ground) and a press or a
  sim `refused { reason: 'ironWill' }` toasts it. Lone Banner: `commanderFor` (meta/edicts.js) at every commander choice (card, battle start, defense
  auto-assign, tray); the pickers offer only the Militia Captain; no ability button (the sim gives none). Warrior Kings: the ability button reads
  "{name} · 2" and counts down (`abilityState().uses/left`). Bounty Hunters: no flame chip and no streak words on Retreat. Peace of the Crowns: no Grudge
  meters (card, rival rows); raids never fire. The Bounty Board renders however many slots the state has.
- **Tutorial:** D1, the first ceremony: drawn INSIDE the ceremony over the Edict cards (`ceremony.setEdictHint`; the coach layer is under dialogs), seen
  when an Edict is picked (its rule is always false, so the coach never picks it). D2: the card's Quick Conquest button, after M1, last in the table,
  12 s; it carries `afterDone: true`, a new step flag the controller honours (founding a dynasty sets `tutorial.done`, which silences ordinary steps).
- **Streak (§5E):** see the Phase 4 section: only an attack lost or retreated breaks it.
- **Checks:** `check.mjs --only=phase5` (`tools/phase5Checks.mjs`, desktop and phone, seed 7). Gallery: `tools/phase5shots.mjs` -> `screenshots/phase5/`.
  Dev hooks: `__hd.completeRealm()`, `__hd.grantLegacy(n)`, `__hd.dynasty` (`buy(id, 'realm')`, `realmData()`, `session`).

## Phase 6: the Ashen Host (2026-10-04)
Spec: `docs/PLAN-PHASE6.md`. Pure API: `docs/briefs/phase6-hookup.md`.

**Faction look**
- The Ashen Host is `FACTIONS[5]`: slate `#5c5b64`, dark `#2c2b33`, glow `#a9dfd6`, with bone `#e6dcc4` on the emblem and FX. CIEDE2000 separation is checked by `ui.a11y.test.js`.
- Its territory wash is drawn 1.9× stronger in `render/territory.js`, because slate disappears into the terrain otherwise.
- The emblem is `skullCrown` in `ui/icons.js`, and the same shape in `render/sprites.js` `drawEmblem`.
- Rotation: everything faction-indexed reads `world.factions`. Absent rivals have `absent: true`; never assume ids 2–4.

**Battle effects:** `scenes/battleAshen.js` (a controller wired into `scenes/battle.js`) draws with `render/ashenFx.js`.

| Event | What it shows |
|---|---|
| `fallenRose` | pale wisps and "+N risen". War band growth reads "+N join the Host"; a Gravewarden rise is drawn in your blue. |
| `fallenBurned` | ember wisps and "N burned". A Firestorm in an Ashen battle also draws its burning ground for `ASHEN.fallen.burnSec`. |
| `rising` | a 3 s ash-ring telegraph ("The dead stir…"). It is redrawn when a battle resumes mid-telegraph. |
| the rising `send` | a shockwave and "The dead rise! +N" |
| `risingCancelled` | "The Rising burns!" |
| `raiseFallen` | the Gravewarden's ability: wisps and "+N raised", on top of the shared ability effect |

Under Reduce Motion there are fewer wisps and no tails. Wisps are capped per site so the additive glow never blows out to white.

**Text and hints**
- An Ashen region card has a row from `fallenLine()`, so its number comes from config. A capital adds the Barrow Keep line.
- The Vendetta banner uses `championTitle()`, which gives "Barrow Knight" for the Ashen.
- Tutorial A1 (`ASHEN.copy.hint`) comes after M1 with `afterDone`. It points at the lowest-tier Ashen frontier region and is marked seen on `ashenCardOpened`.

**Checks and dev hooks**
- `tools/phase6Checks.mjs` runs as `check.mjs --only=phase6`.
- Dev hooks: `__hd.ashenInfo()` and `__hd.hintFacts()`.

**Known gaps** (both closed in Phase 7, §7C)
- ~~No live check exercises Raise the Fallen.~~ `phase6Checks` step 7: the Gravewarden commands an attack, troops fall, a real press on the ability raises them.
- ~~The burning ground isn't restored after a save and reload.~~ `battleAshen.js` now draws it from the sim's own `battle.fallen.burns`.

## Phase 7: Boons and Relics (2026-10-04)
Spec: `docs/PLAN-PHASE7.md`. Pure API: `docs/briefs/phase7-hookup.md`.

**Glue:** `app/boons.js createBoons(...)` (as `services.boons`) owns no rules. It maps every Boon, Duo and Relic id to its own icon in `ui/icons.js`
(`BOON_ICONS`, `RELIC_ICONS`; config icon names are only keys, unknown ids fall back to `boonCard` / `chest`; `ui.phase7.test.js` holds the mapping),
builds the plain data (`hudData` -> the chip, `realmData` -> the strip and the Reliquary, `relicCard` -> the card line, `relicMarks` -> the chests), and
drives the three moments (`ui.boonDraft`, `ui.duoReveal`, `ui.relicClaim`, all mounted in main.js's `ui`).

**The manager (`app/battles.js`):** attack wins call `conquer(..., { viaBattle: true, labelAtAttack: run.labelAtAttack })` (only Fair-or-harder, typed
or capital wins draft); every finished attack or defense calls `boonBattleEnd` (the result rides on the `'finished'` snapshot as `boons`; main.js toasts
Plunderers / Fortune Favours); `pausedCooldownTick` runs while paused or gated (the Sundial). `stateContainer` calls `syncRelics` on load and import.

**After a watched win (`battle.js onResultsContinue`):** Continue applies the win AT ONCE (`manager.finish`, so the offer exists), then
`boons.afterBattle({ before, regionName }, go)` plays the post-battle moments **one at a time, in this order**: the Relic claim (if the region held one)
-> held moments (a capital's recruit card: `battle.js` calls `boons.beginSequence()` before `finish`, and main.js `onDeeds` routes `showRecruit` through
`boons.holdMoment(fn(done))`) -> the Boon draft (if this battle made a new offer: `offerSig` before/after) -> `go()` (the fade and the map's conquest
choreography). Nothing is ever stacked. Off screen (a surrender, a Quick Conquest, a battle nobody watched) `boons.tick(scene)` gives a new offer one
toast and the chip, and plays a new Relic's claim on the map once no dialog is open.

**The draft (`ui/boonDraft.js`):** built once and patched; frames by `data-rarity` = common | rare | legendary | cursed (cursed wins over rarity, the
word says both); `.is-champion-eye` frame; Reroll shows its Renown price; "Decide later" / × / Escape leave it pending (the HUD's `.hud-boon-chip`
reopens it, so does the strip's "Choose your Boon"); a replaced offer shows `BOONS.copy.missed`. On a phone the cards become rows. A pick plays
`celebrate` (~0.6 s, instant under Reduce Motion), then the Duo reveal when `pickBoon` returns `duo`.

**The strip and the Reliquary (`ui/boonsPanel.js`, Realm panel):** the strip sits under the Edict line (the War Council on a 360 px phone has no room);
Boons, active Duos (round teal) and held Relics (round gold); a tap/hover/focus shows the line under it. The Reliquary: 8 slots, found ones lit, the
ones held this dynasty ringed, unknown ones a dim chest.

**Map and card:** `render/relicMarks.js` draws a chest by the keep of every revealed region holding a Relic (24-44 px, gold halo, a steady spark
and a flash every ~2.6 s; still under Reduce Motion); `relicMarkPos` gives its screen point. The region card's features hold a `.region-card-relic`
line ("Relic: Sundial. ...") on the frontier.

**Battle:** `scenes/battleBoons.js` turns `boonTriggered` into small icon pops (at most 6, merged per place, 1.5 s) and draws Scorched Earth's ground
from `battle.boonFx.scorch` (so it survives a reload); Banner Bearer pulses the ability button.

**Tutorial:** K1 is a static line inside the first draft (rule always false, seen on `boonPicked`); L1 (R1 was taken by the Festival) points at the
lowest-tier frontier region holding a Relic, after M1, `afterDone`, 12 s, seen on `relicCardOpened`.

**Checks:** `check.mjs --only=phase7` (`tools/phase7Checks.mjs`, desktop and phone); gallery `screenshots/phase7/`. Under `check.mjs` and `hints.mjs`
(`?dev=1` only) `window.__HD_TEST_NO_BOON_MOMENTS` makes the claim and the post-battle draft wait on the chip, so the older flows' "Continue -> map"
still holds; phase7Checks turns it off. Dev hooks: `__hd.boons`, `offerBoons(ids | 'champion', source)`, `grantBoons(ids)`, `placeRelic(regionId,
relicId)`, `boonFxInfo()`.
