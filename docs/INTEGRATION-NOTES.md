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
  crowns, the next region's scouted card and a mid-game realm with prosperity III. `docs/img/realm.jpg` (`rc-midgame-realm`) and `battle.jpg`
  (`rc-tutorial-drag`) are the README's 1200 px JPEG copies.
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
  `docs/img/realm.jpg` and `battle.jpg` (README) are 1200 px JPEG copies of `rc-midgame-realm.png` and `rc-tutorial-drag.png`, made once because
  `screenshots/` is git-ignored; retake them from `shots.mjs --only=rc` frames if the look changes. The service worker cache name was bumped (`hexdominion-v2-4`) and the shell now also precaches the maskable
  and apple icons.
- **`tools/cdp.js` launches Chrome with `--disable-gpu`: canvas work is rasterised on the CPU.** Frame
  times measured through it (shots.mjs, pageshot) are software-raster numbers and far worse than
  a real GPU (~2× at 1440×900); never use them as a pass/fail criterion. For real-GPU timings
  launch headless Chrome without `--disable-gpu` (e.g. `--use-angle=d3d11 --enable-gpu-rasterization`).
- The Browser-pane preview does not run rAF while the pane is hidden. Pane screenshots come back
  cropped at DPR 1.75; prefer pageshot for full-resolution captures.
- In Git Bash never start a path with "/" (MSYS rewrites it); Node's own `fs` calls resolve `/tmp` to
  `C:\tmp`, while shell arguments are translated — pass scripts by path rather than reading `/tmp` from Node.
