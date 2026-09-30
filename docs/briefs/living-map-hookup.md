# Living map + prosperity: hookup guide

Written by the living-map engineer, 2026-09-29. Everything below is NEW files only; nothing existing was edited. This document is the
exact list of edits the **integration** engineer (game/main.js, game/scenes/*, game/render/{renderer,terrainCache}.js, game/ui/*,
game/app/*) and the **balance** engineer (game/meta/economy.js, tools/campaign.mjs) need to make. Line numbers refer to the tree as read
on 2026-09-29; search for the quoted code if they moved.

Design: `docs/DESIGN.md` §5.6 (prosperity) and §7.7 (living map). Try everything first in the gallery:
`http://localhost:8080/tools/gallery/living.html` (see "Gallery" at the end).

## 0. The pieces

| file | what | pure? |
|---|---|---|
| `game/config/prosperity.js` | `PROSPERITY`: thresholds (30 min / 2 h / 8 h), +5 % income per level, labels | yes |
| `game/meta/prosperity.js` | levels from tenure, level-up reporting, income multiplier, "next level at" | yes (time is passed in) |
| `game/config/ambient.js` | `AMBIENT`: every number of caravans, smoke, sails, boats, birds, budget, quality, Reduce Motion | yes |
| `game/world/caravanRoutes.js` | road routes over `tile.road` bits (settlement to keep, keep to keep toward home) with smooth lifted paths | yes |
| `game/world/prosperityPlan.js` | WHERE prosperity decor goes (farmland life, cottages, windmill, paving, market) and the windmill sites | yes |
| `game/world/ambientPlaces.js` | chimney anchors, boat lanes (open sea near Harbour coasts), forest spots | yes |
| `game/render/prosperityDecor.js` | `drawProsperityGround` + `drawProsperityStructures` (baked into terrain chunks), `createProsperityPlan`, `prosperityDecorBounds`, `windmillHubs` | browser |
| `game/render/ambient.js` (+ `ambientCaravans.js`, `ambientBirds.js`, `ambientSprites.js` cache, `ambientArt.js` sprite art) | `createAmbient`: the live layers | browser |
| `tools/gallery/living.{html,js}` | gallery on the real `generateWorld(7)` terrain, with the decor hook and a benchmark | dev |
| `game/render/tiles.js` `drawFarmFields` | restyled base farmland (organic plots, see 3.3) | browser |
| tests | `meta.prosperity`, `world.caravanRoutes`, `world.livingPlaces`, `render.ambient` (all under `game/tests/`) | |

## 1. State: `prosperity` (already in the tree, verify)

`game/meta/state.js` already has the field: `@property {number[]} prosperity` and `state.prosperity = []` inside `resetRegions` (line ~109),
so `createGame` and a new dynasty both start empty. `game/meta/save.js` already persists it (`prosperity: smallIntList(src.prosperity)` in
`withDefaults`). Nothing more to add there. `[]` is a valid value everywhere: `prosperityIncomeMult` treats a missing entry as level 0 and
`updateProsperity` fills the array to one entry per region.

`resetProsperity(state, world)` exists if you want an explicit zeroing next to `resetRegions`; it is not required, because a new
dynasty's fresh `conqueredAt` makes `updateProsperity` drop stale levels silently.

## 2. Balance: the economy multiplier and the campaign clock

### 2.1 `game/meta/economy.js` (one line)

```js
import { prosperityIncomeMult } from './prosperity.js';
...
export function incomePerSec(state, world) {
  let sum = 0;
  for (const region of world.regions) {
    if (state.owner[region.id] === PLAYER_FACTION) {
      sum += regionIncome(region) * prosperityIncomeMult(state, region.id);   // <-- was: sum += regionIncome(region)
    }
  }
  ...
```

`prosperityIncomeMult(state, regionId)` = `1 + 0.05 * level` for a region the player owns, from the STORED level
(`state.prosperity[regionId]`), 1 otherwise (also when `state.prosperity` is missing, so old fixtures keep working). `regionIncome(region)`
itself must NOT change: `bounty()` uses it for regions the player does not own yet, and the ambient caravans read it as their density input.

Integration also has a display twin, `game/app/income.js` `effectiveRegionIncome` (region card, victory card). Same one-line change there:

```js
return regionIncome(region) * prosperityIncomeMult(state, region.id) * taxMult * perks.income * starMult;
```

### 2.2 Offline earnings (recommendation: levels at departure, then update)

`offlineEarnings` pays `incomePerSec * cappedSeconds` with the STORED levels, i.e. the levels the player was credited with when
they left. That is the conservative rule and needs no code in economy.js beyond 2.1: run `updateProsperity` AFTER it (section 3.2). Levels
gained while away then show on the map and on the welcome card and start paying from that moment. Worst case the player under-collects
by at most the bonus of one level over the away time (a 30 min hold that was 29 min from level I when they left is the biggest gap).

If balance would rather be exact, `nextProsperityChangeAt(state, world, now)` lets you integrate the away time in segments (the same
loop as the campaign below): `gold += incomePerSec(state, world) * (segmentMs / 1000)` per segment, calling `updateProsperity` at each
boundary. It changes offline gold by a few percent at most; I did not do it because it would make the welcome card's gold depend on
levels the player has not yet been shown.

### 2.3 `tools/campaign.mjs`: tenure on the simulated clock

`conquer(state, world, id, wallSecRef.sec * 1000)` already stamps `state.conqueredAt` in simulated milliseconds, so tenure is right
already. What is missing is calling `updateProsperity` whenever the simulated clock moves and splitting the analytic waits at level
changes (income steps up mid-wait). Replace the two places that jump the clock (`waitForNextPurchase`, and the per-battle
`tickIncome` for `battleSec`) with a helper:

```js
import { updateProsperity, nextProsperityChangeAt } from '../game/meta/prosperity.js';

/** Advances the simulated clock by `sec`, integrating income across prosperity level changes. */
function advanceClock(state, world, wallSecRef, sec) {
  let left = sec;
  while (left > 1e-9) {
    const nowMs = wallSecRef.sec * 1000;
    updateProsperity(state, world, nowMs);
    const change = nextProsperityChangeAt(state, world, nowMs);        // ms, or null
    const step = change == null ? left : Math.min(left, (change - nowMs) / 1000);
    tickIncome(state, world, step);
    wallSecRef.sec += step;
    left -= step;
  }
  updateProsperity(state, world, wallSecRef.sec * 1000);
}

/** Waits (analytically) until `cost` gold is in hand. Returns false when income is zero. */
function waitUntilAffordable(state, world, wallSecRef, cost) {
  for (let guard = 0; guard < 64 && state.gold < cost; guard++) {
    const inc = incomePerSec(state, world);
    if (inc <= 1e-9) return false;
    const need = (cost - state.gold) / inc;                              // seconds at today's rate
    const nowMs = wallSecRef.sec * 1000;
    const change = nextProsperityChangeAt(state, world, nowMs);
    advanceClock(state, world, wallSecRef, change == null ? need : Math.min(need, (change - nowMs) / 1000));
  }
  return state.gold >= cost - 1e-6;
}
```

`waitForNextPurchase` then does `if (!waitUntilAffordable(state, world, wallSecRef, cost)) return false;` instead of
`tickIncome(state, world, waitSec); wallSecRef.sec += waitSec;`, and the battle branches call
`advanceClock(state, world, wallSecRef, battleSec)`. There is a unit test proving this stepping integrates income exactly
(`meta.prosperity.test.js`, "stepping a clock from change to change ...").

Expect the whole-continent time to shrink (+15 % income on old regions after 8 h, +10 % after 2 h): re-run
`node tools/campaign.mjs --seeds=1,2,3,4,5` and re-check the pacing targets.

## 3. Integration

### 3.1 Renderer: one ambient per world

`game/render/renderer.js`:

```js
import { createAmbient } from './ambient.js';
...
let ambient = null;
function setWorld(newWorld) {
  ...
  terrain = createTerrainCache(world);
  ambient = createAmbient({ world, seed: world.seed, plan: terrain.plan, pixelRatio: dpr });   // share the plan (3.3)
  ...
}
function resize(...) { ...; if (ambient) ambient.setPixelRatio(dpr); }
// in the returned object:
get ambient() { return ambient; },
```

`createAmbient` costs about 5 ms per world (places + plan) and bakes no sprites up front. Sprites (63 per zoom bucket: loaded and empty cart
variants, smoke wisps, rotor, boats) bake lazily, at most about `AMBIENT.spriteBudgetMs` (3 ms) per draw call, and always at least one; whatever
is not baked yet is drawn from the nearest bucket that is. Crossing into a NEW zoom bucket therefore costs a few frames of 5-13 ms instead of one
big hitch. `ambient.prewarm(zoom)` bakes a bucket in one go (measured 20-50 ms): call it once for the framing zoom at boot (behind the boot
splash) if you want the first frame perfect.

`game/main.js` `applyWorld()` (line ~146) runs `renderer.setWorld(world)`; then, after `applySettings(state)`, call
`renderer.ambient.rebuild(state)` once (this pre-populates the roads, so the very first frame is already alive), optionally
`renderer.ambient.prewarm(fit * 1.25)`, and pass the levels to the terrain prebake (3.3).

### 3.2 Levels: when to call `updateProsperity`

```js
import { updateProsperity, baselineProsperity } from './meta/prosperity.js';
```

**On load / return from a long absence** (main.js boot block at line ~83 and the `visibilitychange` handler at line ~453). Order matters:

```js
// boot
if (resumed) {
  // 1. Silent sync to the levels at DEPARTURE. A save from before prosperity existed (or a never-updated fresh state)
  //    gets its levels here without any celebration; a normal save is unchanged by this call.
  baselineProsperity(bootState, bootWorld, bootState.lastSeen);
  // 2. Offline gold, paid with the levels at departure (conservative, see 2.2).
  const off = offlineEarnings(bootState, bootWorld, Date.now());
  // 3. Levels gained while away, reported ONCE, for the welcome card.
  const ups = updateProsperity(bootState, bootWorld, Date.now());
  if (off.seconds >= WORLD_SCENE.welcomeBackMinSec && off.gold > 0.05) {
    pendingWelcome = {
      timeAwaySec: off.seconds, goldEarned: off.gold,
      prospered: ups.map((u) => ({ name: bootWorld.regions[u.regionId].name, level: u.level })),
    };
  }
}
```

Do the same three lines in the `visibilitychange` handler (`off = offlineEarnings(state, world, Date.now())` at line ~455). If the away time is too short for the welcome card (`< 60 s`) the returned `ups` are still real level-ups: hand them to the celebration queue below instead of dropping them.

**While playing**, every ~5 s in the world scene frame (or next to the autosave tick): 

```js
if (nowMs - lastProsperityMs > 5000) {
  lastProsperityMs = nowMs;
  const ups = updateProsperity(state, world, Date.now());
  if (ups.length) services.pendingProsperity.push(...ups);      // celebrated by the world scene (3.4)
}
```

Keep updating during battles (it is wall-clock, like income) but only CELEBRATE in the world scene: the battle scene never touches
`pendingProsperity`, the world scene drains it on `enter` and each frame.

`updateProsperity` reports each level-up exactly once (`{ regionId, level, from }`; a long absence can skip levels, so `level - from`
can be 2 or 3) and syncs `state.prosperity`, so the next autosave stores the credited levels. It is O(regions) and allocation-light.

### 3.3 Terrain: bake the decor into the chunks (the one real render change)

Prosperity decor is split into TWO bake hooks, because some of it is terrain and some of it is not:

| hook | what | where in the chunk bake |
|---|---|---|
| `drawProsperityGround(ctx, t, x, y, s, level, info)` | level I: haystacks, small orchards (round-tree style with blossom), a hedgerow line, a scarecrow, all on the EXISTING farmland | per land tile, right after `drawTileDecor`, i.e. BEFORE the territory tint (it takes the tint like terrain) |
| `drawProsperityStructures(ctx, t, x, y, s, level, info)` | level II cottages and windmill tower; level III paving and the market stall | in a SECOND loop over the chunk's land tiles, AFTER `drawChunkTerritory` (tint, bands, borders), so they keep their natural colours |

Both take the same arguments as every tile call (`x, y` = the unraised tile centre in chunk pixels, `s` = device px per world unit) and apply the
elevation contract themselves. `level` is `levels[t.region] | 0`, `info` is `plan.info(t.i)` (null for tiles that never carry decor).

`game/render/terrainCache.js`. Four edits:

```js
import { createProsperityPlan, drawProsperityGround, drawProsperityStructures } from './prosperityDecor.js';

export function createTerrainCache(world) {
  ...
  const plan = createProsperityPlan(world);   // once per world, ~3 ms
  let levels = [];                             // region id -> prosperity level to SHOW (0 unless player-owned and revealed)

  function chunkSig(desc, owners) {
    if (!owners) return 'none';
    let sig = '';
    for (const r of desc.regions) sig += `${owners[r] ?? -1}:${levels[r] | 0},`;    // <-- level joins the signature
    return sig;
  }

  function bake(desc, bucket, owners, sig) {
    ...
    for (const t of desc.land) {
      ...
      drawRoad(ctx, t, x, y, s);
      if (t.elev === 1 && t.settlement === -1 && hasFarmSeedNeighbor(t)) {
        drawFarmFields(ctx, x, y - elevOffset(t, s), s, t.i + 1, t);   // <-- pass the tile as the 6th argument (see below)
      }
      drawTileDecor(ctx, t, x, y, s);
      const info = plan.info(t.i);                                    // <-- GROUND hook, before the territory tint
      if (info) drawProsperityGround(ctx, t, x, y, s, levels[t.region] | 0, info);
    }
    if (owners) drawChunkTerritory(ctx, world, desc.land, owners, s, ox, oy, dpr);
    for (const t of desc.land) {                                      // <-- STRUCTURES hook, AFTER the tint and the borders
      const info = plan.info(t.i);
      if (info) drawProsperityStructures(ctx, t, ox + t.x * s, oy + t.y * s, s, levels[t.region] | 0, info);
    }
  }

  function draw(ctx, camera, owners, showLevels) {
    if (showLevels) levels = showLevels;          // BEFORE the loop computes chunkSig
    ...
  }
  function prebakeAll(devScale, owners, showLevels) { if (showLevels) levels = showLevels; ... }
  return { ..., plan };                            // ambient shares it
}
```

That is all: a level-up changes the region's chunk signature, so the existing ownership-change path re-bakes exactly the chunks that
contain the region (time-boxed to 9 ms per frame, at least one per frame, at the chunk's own bucket). No explicit invalidation call is
needed. If you prefer explicit control: `prosperityDecorBounds(plan, regionId)` returns the world-unit box (`{minX,minY,maxX,maxY}`, or
null) of everything the region's decor can touch, for invalidating chunks by rectangle.

**`drawFarmFields` was restyled in place (tiles.js, this round).** It no longer splits the hex into six radial triangles: each farmland tile now
gets two to four soft-edged rounded plots (a shared orientation per tile, a crop colour per plot from a small warm palette, faint furrows, a thin hedge
edge on most), with grass left between them; deterministic per seed, inside the tile top face, same elevation contract. Its signature gained an
OPTIONAL last argument, the tile: `drawFarmFields(ctx, cx, cy, s, seed, tile)`. With it the plots repaint the tile's river and road ribbons on top,
so farmland never hides them (before this change every road through a village's farmland was painted over). Without it the function behaves as
before, minus that repair; `tools/gallery/art.js` still calls it with five arguments and works.

**What to pass as `showLevels`** (world scene `frame`, next to `visualOwners`, filled in the same loop):

```js
for (let i = 0; i < visualOwners.length; i++) {
  visualOwners[i] = showAll || derived.revealed[i] || renderer.clouds.isRevealing(i) ? state.owner[i] : -1;
  visualLevels[i] = visualOwners[i] === PLAYER_FACTION ? (state.prosperity[i] | 0) : 0;      // fog and the region mid-flood show level 0
}
renderer.terrain.draw(ctx, camera, visualOwners, visualLevels);
```

and `renderer.terrain.prebakeAll(fit * 1.25 * renderer.dpr, state.owner, levelsOf(state))` in `applyWorld`. `state.prosperity[i]` is the
CREDITED level (what `updateProsperity` reported), so the map, the income and the celebration always agree.

Bake cost: see the measured numbers in the engineer's report (the decor is a few tenths of a millisecond per decorated tile; a level-up of ONE region
re-bakes its handful of chunks over a few frames through the existing time-boxed path; nothing is paid per frame).

Notes for the art: the territory tint (overlay + a flat wash) is baked over the GROUND decor and over the terrain, which is what you want for
plots, hedges and orchards. Structures are drawn after it precisely because the tint greys cream walls toward blue; that is also why paving
crosses the dashed region seams and the territory bands without being tinted. Level 0 vs level I is meant to read at mid zoom (about 25 px per
hex): blossoming orchard clusters, golden haystacks and hedgerow lines around every village.
### 3.4 The level-up celebration (world scene)

Drain `services.pendingProsperity` in `scenes/world.js` `frame()` (and once on `enter`, staggered): 

```js
if (services.pendingProsperity.length && nowMs >= nextCelebrationMs) {
  const u = services.pendingProsperity.shift();
  const region = world.regions[u.regionId];
  const keep = world.tiles[world.settlements[region.keep].tile];
  renderer.fx.spawn('floatText', keep.x, keep.y - 1.4, { text: `${region.name} prospers!`, color: ACCENTS.gold, size: 0.5 });
  renderer.fx.spawn('burst', keep.x, keep.y - 0.3, { color: ACCENTS.goldSoft, flashSize: 1.4, sparkleCount: 8 });   // the soft shimmer
  sfx.play('upgrade', { volume: 0.3 });        // quiet; 'coin' at 0.25 also works
  nextCelebrationMs = nowMs + 700;             // one region per 0.7 s: 12 level-ups after a long absence do not shout at once
}
```

The map re-bakes underneath by itself (3.3), so the burst and the new orchards, haystacks, cottages or paving arrive together. Level-ups that came from the
welcome-back path are NOT celebrated one by one: show them as one line on the card (3.7) and skip the queue for those.
This is exactly what the gallery does (`living.js`, `main.onLevelUp`), so you can see it working there.

### 3.5 Ambient: the draw calls, the rebuild, the masks

World scene `frame()` (line ~608), the marked lines are new:

```js
renderer.beginFrame(camera, fx.shakeOffset());
renderer.terrain.draw(ctx, camera, visualOwners, visualLevels);
renderer.terrain.drawGlints(ctx, camera, t);
... hover / frontier pulse / selected ...
renderer.clouds.drawShadows(ctx, camera, t);
drawFlood(ctx, nowMs);
const vb = camera.visibleBounds(2);
ambient.update(dt);                                   // NEW  once per frame, real seconds
ambient.drawGround(ctx, camera, vb);                  // NEW  caravans + boats: above territory and shadows, BELOW settlements
siteDrawer.draw(ctx, renderer, camera, state.owner, t, isVisibleRegion, { hideHamlets: camera.zoom < 12 });
... idle pop ...
ambient.drawAir(ctx, camera, vb);                     // NEW  smoke, windmill sails, birds: ABOVE settlements and banners
fx.update(dt); fx.draw(ctx, camera);
renderer.clouds.draw(...);  drawRegionLabels(...);
```

with `const ambient = renderer.ambient;` (it changes with the world: read it from the renderer each frame or after `applyWorld`).
The ambient draws inside the same shake-translated context as everything else and never reads game state during a frame.

**`rebuild`** derives everything that depends on the realm (routes, chimneys, boat sail colours, windmills at level II+). It is cheap when
nothing changed (one `owner.join(',')` compare and a loop over the windmills), so call it from the same 300 ms timer as `refreshDerived`,
passing the VISUAL owners so the conquest flood and fog agree with what is drawn:

```js
if (nowMs - lastAmbientMs > 300) {
  lastAmbientMs = nowMs;
  ambient.rebuild({ owner: visualOwners, prosperity: state.prosperity });   // owner -1 (fog) and the region mid-flood are simply "not yours"
}
```

Roads of a newly conquered region start empty and fill within a few seconds; roads that already existed keep their carts (state is keyed
by route identity). The first `rebuild` after `createAmbient` pre-populates the roads.

**Fog mask.** Nothing may be drawn over fog-hidden regions (boats off a hidden Harbour region, birds over hidden forest, etc.). Set it
once when the world scene is created or after `applyWorld`; the function is evaluated per region per frame, so it always reflects the
live fog:

```js
renderer.ambient.setHiddenMask((regionId) => !isVisibleRegion(regionId));   // true = hidden; isVisibleRegion already honours devRevealAll and parting clouds
```

(`setHiddenMask(array)` with a truthy-means-hidden array indexed by region id also works; `setHiddenMask(null)` clears.)

### 3.6 Battle, Reduce Motion, adaptive quality

* **Battle.** `scenes/battle.js` `enter()`: `renderer.ambient.setEnabled(false)`; on exit (and in world `enter()`): `setEnabled(true)`.
  Disabled = nothing drawn and time stands still, so caravans resume where they were. (Alternative for a partial battle view:
  `setHiddenMask((r) => r === battleRegionId)`; both are supported.)
* **Reduce Motion.** In `main.js` `applySettings` (line ~132) next to `renderer.fx.setReduceMotion(...)`:
  `renderer.ambient?.setReduceMotion(!!s.settings.reduceMotion);` and once after `renderer.setWorld` (the constructor also takes
  `reduceMotion`). Effect: no birds, windmill sails stand still, half the smoke, caravans at 60 % speed. Boats still drift (they are
  slow, DESIGN says only birds/sails/smoke/caravans change).
* **Adaptive quality.** `perf.frameMs` (main.js line ~505) is already an EMA. Suggested rule in the frame loop:
  `if (perf.frameMs > 24) ambient.setQuality(0); else if (perf.frameMs < 17.5) ambient.setQuality(1);` with a 2 s hold so it does not
  flap. Quality 0 halves everything (carts thinned by a stable priority, smoke uses the sparse plume, half the boats, smaller flocks, no
  dust, no bird shadows). It is a 0..1 float: `setQuality(0.5)` is the midpoint. `setFeatures({ smoke: false })` switches whole layers off
  for profiling.

### 3.7 UI lines

**Region card** (`ui/regionCard.js`, `renderOwned`): give `regionCardData(regionId)` in `scenes/world.js` an extra field for owned
regions and render one line under the perk:

```js
import { prosperityInfo } from '../meta/prosperity.js';
// regionCardData, owned branch:
prosperity: (() => { const p = prosperityInfo(state, regionId, Date.now()); return { level: p.level, label: p.label, nextInMs: p.nextInMs, bonusPct: Math.round(p.incomeBonus * 100) }; })(),

// regionCard.js renderOwned nodes:
if (data.prosperity) {
  const p = data.prosperity;
  nodes.push(h('div.region-card-prosperity', {},
    icon('star', 16),
    h('span', {}, p.level ? `Prosperity ${p.label} · +${p.bonusPct}% income` : 'Prosperity: newly held'),
    p.nextInMs != null ? h('span.region-card-next', {}, ` · next in ${formatDurationWords(p.nextInMs / 1000)}`) : null));
}
```

e.g. "Prosperity II · +10% income · next in 1h 12m" (`formatDurationWords` from `ui/format.js`; at the top level the last span is omitted). The
card already refreshes every second (`refreshRegionCardThrottled`), so the countdown ticks. `prosperityInfo(state, regionId, now)` returns
`{ level, label, nextAt, nextInMs, incomeBonus }` and works for any region (level 0 / nulls when the player does not own it).
`PROSPERITY.blurbs[level]` has one line of flavour per level if you want a tooltip.

**Welcome-back card** (`ui/welcome.js` `update`): the data gains `prospered: { name, level }[]` (3.2). Render one line, e.g.

```js
const prospEl = h('p.welcome-prospered', {}, '');   // add to the card below the gold row
if (data.prospered) {
  const n = data.prospered.length;
  prospEl.textContent = n === 0 ? '' : n === 1 ? `${data.prospered[0].name} prospered while you were away.`
    : `${data.prospered[0].name} and ${n - 1} other ${n === 2 ? 'region' : 'regions'} prospered while you were away.`;
  prospEl.hidden = n === 0;
}
```

## 4. Public APIs (final)

### `game/meta/prosperity.js`
`prosperityLevel(state, regionId, now) -> 0..3` (owned + tenure) · `updateProsperity(state, world, now) -> [{regionId, level, from}]` (creates
`state.prosperity`, syncs it, level-ups exactly once, silent reset for lost regions / new dynasty) · `baselineProsperity(state, world, now)` (same
sync, reports nothing) · `resetProsperity(state, world)` · `prosperityIncomeMult(state, regionId)` (stored level) · `nextProsperityAt(state,
regionId, now?)` (ms or null) · `nextProsperityChangeAt(state, world, now)` (earliest future change, for clocks that jump) ·
`prosperityInfo(state, regionId, now)` · `levelForTenure(ms)`.

### `game/world/caravanRoutes.js`
`buildCaravanRoutes(world, owner, homeRegionId) -> CaravanRoute[]` (`{id, key, kind: 'local'|'trunk', regionId, toRegionId, sourceType, from, to,
tiles[], length, pts: Float32Array [x,y,...] world units with the elevation lift already in y, cum, bbox}`) · `sampleRoute(route, dist, out)` ·
`roadNeighbor`, `directionBetween`, `buildPath`. Rebuilt by `ambient.rebuild` only when ownership changes.

### `game/render/prosperityDecor.js`
`createProsperityPlan(world)` (`.info(tileIndex)`, `.windmills`, `.windmillsOf(region)`, `.regionTiles(region)`, `.boundsOf(region)`) ·
`drawProsperityGround(ctx, tile, cx, cy, s, level, info)` (level I, before the tint) · `drawProsperityStructures(ctx, tile, cx, cy, s, level, info)` (levels II-III, after the tint) · `prosperityDecorBounds(plan, regionId)` · `prosperityDecorRegions(regionId)` ·
`windmillHubs(plan, levels)` · `FEATURE_LEVEL`, `DECOR_REACH`.

### `game/render/ambient.js`
`createAmbient({ world, seed?, reduceMotion?, incomeOf?, pixelRatio?, plan? }) -> { rebuild(state), update(dt), drawGround(ctx, cam, visible?),
drawAir(ctx, cam, visible?), setReduceMotion(b), setQuality(0..1), setEnabled(b), setHiddenMask(fn|array|null), setPixelRatio(v), setFeatures({...}),
prewarm(zoom), spawnFlock(), stats(), routes, boatLanes, windmills, plan }`. `cam` needs `x, y, zoom, viewW, viewH`. `visible` (world-unit bounds) is optional;
it is derived from the camera when omitted. `stats()` returns counts (`caravans: {routes, lanes, drawn, emptyDrawn, candidates, keepProb}`, `smokeSources`,
`smokePlumesDrawn`, `windmills`, `boats`, `birdsActive`, ...) and the running average main-thread cost of the two draw calls (`groundMs`,
`airMs`, `totalMs`).

## 5. Performance and behaviour notes

* Budget: all ambient layers together, main thread, 1440x900: see the numbers in the engineer's report. The design is stateless (a cart,
  a plume, a boat is a function of a clock), sprites are baked per zoom bucket, everything is culled to the view, no per-frame
  allocation in the hot loops, plumes are looping baked strips (one blit per chimney).
* Zoom thresholds (px per world unit, `AMBIENT` in game/config/ambient.js): caravans hidden below 8, dots 8 to 19, carts from 15 (cross-fade to
  19); smoke from 12, sails from 10, boats from 11, birds from 10. At a 1440x900 overview (about 16 px per hex) you see dots, smoke, sails, boats.
* `visible`/culling uses `AMBIENT.cullMargin` (2.5 world units) beyond the given bounds.
* Smoke: the PLAYER's settlements smoke at full density (hamlet 1 chimney, village 2, town 3, keep 1); every other REVEALED owner's settlements
  (Free Folk and rivals; `owner >= 0`, so fog `-1` in `visualOwners` and anything the hidden mask hides get none) smoke at about half the rate: their
  first chimney only, with the half-density wisp. Under quality thinning the player's plumes are kept first.
* Caravans stay player-only. Each route has two streams: LOADED carts (cloth in the player colour) from the settlement to the keep and on toward the
  capital, and EMPTY return carts (bare bed, no cloth, a tan dot at overview) the other way at half the density (`AMBIENT.caravans.returnShare`).
  The 40-cart cap counts both.
* Windmill sails only where the region has reached
  level II; boats off every Harbour region, sails in the owner colour when the region is the player's, off-white otherwise; birds only cross
  forests of regions that are not hidden.
* Determinism: nothing uses `Math.random` or `Date.now`. The bird schedule is seeded (`createAmbient({ seed })`); carts, smoke and boats are pure
  functions of the ambient clock and the world.
* Changing a building sprite in `sprites-buildings.js` changes where the roofs are: the chimney anchors live in `AMBIENT.smoke.chimneys`.

## 6. Gallery

`http://localhost:8080/tools/gallery/living.html` (panel + readout). Useful URLs and hooks:

* `?bare=1` chrome-free (for `tools/pageshot.mjs`), `?mode=compare` the same village at prosperity 0 / I / II / III (2x2), `?seed=N`, `?dpr=1|2`.
* `window.__living`: `setPreset('overview'|'mid'|'close'|'village'|'keep'|'mill'|'harbour'|'phone')`, `forceAll(level)`, `forceLevel(regionId|null, level)`,
  `setHours(h)`, `reduceMotion(b)`, `fog(b)`, `battle(b)`, `quality(q)`, `enabled(b)`, `flock()`, `focusRoute(i, zoom)`, `focusBoat(i, zoom)`,
  `focusChimney(type, zoom)`, `setCamera(x, y, zoom)`, `stats()`, `bench()`, `benchLoop()`, `benchParts()`.
* Screenshots: `node tools/pageshot.mjs "tools/gallery/living.html?bare=1" screenshots/living/x.png --w=1440 --h=900 --wait=2500 --eval="(()=>{__living.forceAll(3); __living.setPreset('close'); return 1})()" --after=1500`.
  Note that `tools/cdp.js` launches Chrome with `--disable-gpu`, so the readout's ms are software-raster numbers there.
