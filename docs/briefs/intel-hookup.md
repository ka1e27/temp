# Scout and Sabotage: hookup guide (integration and balance)

DESIGN §5.7. Everything below is written against the code as it stood on 2026-09-29 (`scenes/world.js`,
`scenes/battle.js`, `ui/regionCard.js`, `render/labels.js`, `main.js`). Function names are the anchors;
search for them if a line moved. Nothing in `game/battle/*` changes.

> **Wired (round 2).** What is actually in the game, and where it differs from this guide, is in
> `docs/INTEGRATION-NOTES.md` ("Scout and Sabotage" and "Region card layout budget"). Corrections to the text below:
> - §3: `regionCard.js` no longer does `clear(bodyEl)` on every update. The card is built once and patched in place
>   (so the "re-append the panel" advice and the "compare a signature" click-safety advice are both obsolete).
>   The panel data carries `gold`, which ticks, so the card's "nothing changed" skip no longer skips while gold moves;
>   that is fine because nothing is rebuilt. The panel's own cost spans (inside its buttons) are rebuilt only when the
>   value changes, for the same click-swallowing reason.
> - §7: `clearRegionIntel` is called from `world.onSurrender` and `battle.onResultsContinue` right after `conquer()`
>   (progression.js is untouched); `resetRegions` covers a new realm and a new dynasty, so the `foundDynasty` note is moot.
> - §9: a scouted phone card is 419 px (49.7% of 844) only after the header merge, the single reward row AND an 8 px
>   row gap below 640 px; the numbers in the table above are before those merges.
> - Missing from §5/§9: a purchase makes the phone sheet grow by about 100 px and can hide the selected region, so the
>   world scene nudges the camera clear of the card after every Scout / Sabotage.
> - The `scouted` line is silent while a tutorial hint is on screen (the leader gate); tours that want to see the
>   banner turn hints off first.

## Lead decisions (override anything below that disagrees)
1. **Phone card height:** do both card merges (owner chip into the header; the two reward
   lines into one) AND keep the sheet scrollable under its 62vh cap. Target: a scouted card
   ≤ ~50% of 844 px.
2. **Sabotage prices** are now `steelMult [1, 2]`, `incomeSeconds [60, 150]` in
   `game/config/intel.js` (the first pricing made the finisher policy a trap). Balance
   verifies: finisher ≈ normal (within ±10% to 20 regions), heavy clearly slower.
3. **Weak point:** keep "cheapest to take", but prefer a town when its cost is within 20% of
   the cheapest candidate (towns grow fastest, so they're worth more once held). Integration
   doesn't need to do anything; balance or the lead applies it in `game/config/intel.js` /
   `chooseWeakPoint` in the follow-up round.
4. **Free scout** stays free on the easiest tier-1 region at the start of every dynasty.
   Confirmed.
5. **Sabotage persists** through retries and retreats; only conquest or a new dynasty clears
   it. Confirmed.
6. **Weak-point ring** only for the selected scouted region; badges use the zoom fade.
   Confirmed.
7. **Rename the region card's bar labels** from "Your army 52 / Defenders 327" to "Your power
   52 / Their strength 327" (DESIGN §5.3 wording). The bar compares weighted power, not troop
   counts. Next to the scouted troop chips (which sum to 195 in the Fjordvale example),
   "Defenders 327" reads as a bug.

## 0. What ships (all new files, all tested)

| file | what it is |
|---|---|
| `game/config/intel.js` | every number and every line of copy: costs, step, weak-point weights, personality lines, toasts, map-mark tuning |
| `game/meta/intelState.js` | **leaf** (imports only the config): `state.intel` accessors, `sabotageTroopMult`, `resetIntel`, `clearRegionIntel`, `sanitizeIntel` |
| `game/meta/intel.js` | costs, `scout` / `sabotage`, `scoutReport`, `intelPanelData`; re-exports everything in `intelState.js` |
| `game/ui/intelPanel.js` + `game/styles/components/intel.css` | `createIntelPanel({ onScout, onSabotage }) -> { el, update(data), destroy() }` |
| `game/render/intelMarks.js` | `drawScoutedGarrisons`, `drawWeakPointMarker`, `drawSabotageMark` |
| `game/tests/{meta,ui,render}.intel.test.js` | 38 + 9 + 7 tests |
| `tools/gallery/intel.html` + `intel.js` | every panel state in the real card, plus the map marks over real terrain |

**Deviation from the brief's file list:** `intelState.js` is one extra new file. `progression.js` must import
`sabotageTroopMult`, and `intel.js` imports `progression.js` (for the player and enemy battle stats), so the
multiplier lives in a dependency-free leaf. Balance imports from `./intelState.js` (no cycle);
everything else can import the whole API from `./intel.js`.

State shape: `state.intel = { [regionId]: { scouted: boolean, sabotage: 0 | 1 | 2 } }`. Missing entry = nothing.

## 1. Already done by others (verify, nothing to add)

- `meta/state.js`: `intel` in the typedef, and `resetRegions()` sets `state.intel = {}` (so `createGame` and the
  `resetRegions(next, world, now)` call after `foundDynasty` both start a continent with no intel).
- `meta/save.js` `withDefaults`: `intel: sanitizeIntel(src.intel)` (import from `./intelState.js`). Old saves load with `{}`.

## 2. Style sheet

`game/styles/main.css`: add `@import url('./components/intel.css');` after `regioncard.css`.

## 3. Region card: mount and feed

The panel goes **under the difficulty bar**, i.e. right after `.region-card-matchup` in `renderFrontier`.
`renderFrontier` does `clear(bodyEl)` on every update, so follow the crown row's pattern: create the panel once,
re-append its element on each render.

`ui/regionCard.js`:

```js
import { createIntelPanel } from './intelPanel.js';
// RegionCardData gains:  @property {import('./intelPanel.js').IntelPanelData} [intel]  frontier only

export function createRegionCard({ onAttack, onSurrender, onScout, onSabotage } = {}) {
  const intelPanel = createIntelPanel({ onScout, onSabotage });
  ...
  // renderFrontier, straight after the matchup block:
  if (data.intel) { intelPanel.update(data.intel); bodyEl.appendChild(intelPanel.el); }
```

`scenes/world.js` `regionCardData`, frontier branch:

```js
import { intelPanelData } from '../meta/intel.js';
...
      difficulty: difficulty(state, world, regionId),
      intel: intelPanelData(state, world, regionId),
```

`main.js`: `createRegionCard({ onAttack, onSurrender, onScout: (id) => worldScene.onScout(id), onSabotage: (id) => worldScene.onSabotage(id) })`
and export `onScout` / `onSabotage` from the world scene next to `onSurrender`.

`intelPanelData` is cheap: the scout report is cached per (world, region, ownership, sabotage level, player and enemy
stats), so the 300 ms / 1 s card refresh may call it freely. The panel itself only touches the DOM when something
it shows changed (buttons flip on gold), so it can be fed every refresh.

**Click safety.** A card refresh that removes and re-appends a button between `pointerdown` and `pointerup` loses that
click (the existing Attack button has the same exposure). Cheap fix in `regionCard.update`: skip `renderFrontier` when
nothing but gold changed, or compare a signature (like `crownRow`) and only call `intelPanel.update(data.intel)` in that
case. The panel is safe to update while attached.

## 4. Handlers (world scene)

```js
import { scout, sabotage, intelToast, sabotagePercent } from '../meta/intel.js';

function onScout(regionId) {
  const { state, world } = container.get();
  const res = scout(state, world, regionId);            // { cost } | false; pays the gold, sets the flag
  if (!res) { sfx.play('error'); return; }
  sfx.play('click');
  ui.toasts.update({ type: 'info', icon: 'eye',
    message: intelToast('scouted', { region: world.regions[regionId].name }) });
  services.speak('scouted', state.owner[regionId], regionId, regionId);   // scope = region id, gate does the rest
  afterIntel();
}

function onSabotage(regionId) {
  const { state, world } = container.get();
  const res = sabotage(state, world, regionId);         // { cost, level } | false
  if (!res) { sfx.play('error'); return; }
  sfx.play('upgrade');
  ui.toasts.update({ type: 'warning', icon: 'flame',
    message: intelToast('sabotaged', { region: world.regions[regionId].name, pct: sabotagePercent(res.level) }) });
  afterIntel();
}

function afterIntel() {
  markDirty();                                   // labels' difficulty chips, frontier data
  refreshRegionCard();                           // new numbers: the label and the surrender check read the sabotage
  updateHud(performance.now(), { force: true }); // gold went down
  services.autosave.save();
}
```

The sabotage speaks at the **battle start**, not on purchase (DESIGN §5.7, features doc): no `speak` call in `onSabotage`.
Once Balance lands §8.1, the difficulty label and the `surrender` flag on the card update immediately, because they read
`enemyBattleStats`.

## 5. World renderer: garrison badges, weak-point ring, torch

All three are screen-space canvas drawing; the site data comes from the report (`x`, `y` = tile centre in world units,
`elev` = tile elevation, so the marks follow the elevation contract: `topY = cy - elevOffset(tile, s)`).

`scenes/world.js` `refreshDerived` (300 ms timer, not per frame): cache the reports of scouted regions.

```js
import { scoutReport, intelOf } from '../meta/intel.js';   // intelOf is re-exported from intelState.js
// in derived: scouted: []   (array of { id, report })
derived.scouted = [];
for (const [key, entry] of Object.entries(state.intel || {})) {
  const id = Number(key);
  if (!entry.scouted || state.owner[id] === PLAYER_FACTION || !isVisibleRegion(id)) continue;
  const report = scoutReport(state, world, id);
  if (report) derived.scouted.push({ id, report });
}
// and in the label datum (same loop that builds labels):  datum.sabotage = intelOf(state, region.id).sabotage;
```

`frame()`: after `siteDrawer.draw(...)` and before the fx / clouds:

```js
import { drawScoutedGarrisons, drawWeakPointMarker } from '../render/intelMarks.js';
for (const { id, report } of derived.scouted) {
  drawScoutedGarrisons(ctx, camera, report.sites, state.owner[id], camera.zoom, {
    force: id === selectedRegionId && services.isPhone(),   // phones sit below the fade zoom: show the selected one anyway
    alpha: fogAlpha,
  });
  if (id === selectedRegionId) {
    const weak = report.sites.find((s) => s.id === report.weakPoint);
    drawWeakPointMarker(ctx, camera, weak, camera.zoom, t, { reduceMotion: state.settings.reduceMotion });
  }
}
```

Badges fade in between `INTEL.marks.badgeFadeStartZoom` (8) and `badgeFullZoom` (11) px per world unit. Desktop overview
is about 15 to 17, so they show; a phone overview is about 4 to 6, so only the `force`d selected region shows badges.
The weak-point ring is drawn for the selected region only (a ring on every scouted region would be noise).

**Torch by the label**: `render/labels.js` places labels with collision avoidance, so the torch has to travel with the label.
In `drawRegionLabels`:

```js
import { drawSabotageMark } from './intelMarks.js';
// candidate loop: reserve room on the right (the capital crown takes the left)
const torchW = d.sabotage > 0 ? fontPx * 1.3 : 0;
const halfW = Math.max(nameW / 2 + (d.isCapital ? fontPx * 1.3 : 0) + torchW, chipW / 2);
// draw loop, next to the crown code (same baseline maths as the crown, mirrored to the right):
if (d.sabotage > 0) drawSabotageMark(ctx, c.x + c.nameW / 2 + fontPx * 0.8, y - fontPx * 0.32, fontPx * 1.15, opts.time);
```

The draw loop runs under the labels' `globalAlpha`, so the torch fades out with its label past `labelFadeStartZoom`.
Pass `opts.time` (seconds) for the flame flicker, or leave it undefined for a still torch (Reduce Motion).

## 6. Battle start

`scenes/battle.js`, where the battle goes live (the same place the features doc puts the `battleStart` leader line):

```js
import { sabotageBattleNote, sabotageLevel } from '../meta/intel.js';
const note = sabotageBattleNote(state, regionId);           // null unless sabotaged
if (note) ui.toasts.update({ type: 'warning', icon: 'flame', message: note });   // "Your agents weakened the garrisons (-15%)"
// leader line: 'sabotaged' REPLACES battleStart / capitalBattleStart when sabotageLevel(state, regionId) > 0
```

Sabotage is not consumed by a battle: a retry after a loss, or a retreat, keeps it (max two steps per region, for good, until the
region is conquered or the dynasty ends). The garrisons come out of `buildArena` with the multiplier already applied, and a
saved in-progress battle carries its own arena, so resuming needs nothing.

## 7. Resetting

- **Dynasty / new realm**: `resetRegions()` (state.js) already clears it. `foundDynasty(state, seed)` without a world returns
  `{ ...state }`, which briefly shares the OLD `intel` object until `resetRegions` runs; Balance may add `intel: {}` to `next`
  in `foundDynasty` as a belt and braces (§8.3).
- **Conquest**: `clearRegionIntel(state, regionId)`. Both routes (a won battle at `Continue`, an accepted surrender) call
  `conquer()`, so the single place is inside `progression.js conquer()` (§8.2). If Balance would rather not, call it in
  `onSurrender` and `onResultsContinue` right after `conquer(...)`.

## 8. Balance

### 8.1 The one line (`meta/progression.js`, `enemyBattleStats`)

```js
import { sabotageTroopMult, clearRegionIntel } from './intelState.js';   // the LEAF: importing ./intel.js would be an import cycle
...
  if (decapitated) troopMult *= ENEMY_SCALING.decapitationMult;
  troopMult *= sabotageTroopMult(state, regionId);                        // 1, 0.85, 0.70
```

This flows into `buildArena` (every enemy-owned starting garrison), `estimateStrength` (so the label and surrender check)
and nothing else. Neutral Free Folk hamlets inside rival regions are placed with `troopMult = 1` and are correctly NOT
sabotaged. Growth, atk and def are untouched, as DESIGN requires. The contract is tested
(`meta.intel.test.js`: "applying sabotageTroopMult ... cuts garrisons by 15% and 30%").

### 8.2 One line in `conquer()`: `clearRegionIntel(state, regionId);`

### 8.3 Optional: `next.intel = {}` inside `foundDynasty`'s `next` literal.

### 8.4 What one step is worth, so prices can be tuned

Measured on the 2026-09-29 snapshot with the hook applied (`difficulty()` ratio before and after):

| step | ratio gain | note |
|---|---|---|
| 1 | +5 to +8 % (capitals about +10 %) | about one Steel level, this region only, once |
| 2 | +10 to +18 % in total | |

Sabotage cuts starting troops only, and a garrison regrows and over-cap troops bleed off during a fight, so a 15 % cut is
worth less than 15 % of `strength`. Sabotaged battles are honest: 127 battles fought straight after sabotage (labelled Fair by
the sabotage-aware card, since the policy only sabotages to reach Fair) were won 86 % of the time, the top of the Fair band.

### 8.5 Prices (config/intel.js `sabotage`)

`cost(step) = max(steelMult[level] x next Steel cost, incomeSeconds[level] x income)`, defaults `[1.5, 3]` and `[90, 240]`:

- the Steel term follows the upgrade curve (2.15x per Steel level), so a finisher costs more the deeper you are;
- the income term stops the "never buy Steel, sabotage everything" exploit (Steel neglected means the Steel term collapses; the
  income floor does not);
- one step therefore costs about one to two upgrades and delivers one Steel level's worth on one region, once. Upgrading always
  wins as a general strategy; sabotage is the top-up for a region sitting just past Fair.

Example costs (real campaign states from the scratch simulation; Balance was mid-tune, so treat absolute numbers as indicative):

| state | income | next Steel | scout | sabotage 1 | sabotage 2 |
|---|---|---|---|---|---|
| start (1 region) | 1.1/s | 30 | free (tutorial region), else 34 | 101 (90 s floor) | 269 |
| about 5 regions, seed 3 (Steel L1-2) | 7.4/s | 65 to 139 | 222 | 665 (floor binds) | 1.8k |
| about 5 regions, seed 1 (Steel L7) | 12.4/s | 6.4k | 371 | 9.6k | 19.2k |
| about 15 regions, seed 3 (Steel L6-7) | 38/s | 3.0k to 6.4k | 1.1k | 4.4k to 9.6k | 9k to 19k |
| about 15 regions, seed 1 (Steel L9) | 53/s | 29.4k | 1.6k | 44.2k | 88k |

### 8.6 Campaign policy suggestion (`tools/campaign.mjs`)

Intel is a WAIT-time decision, never an every-turn one: the loop buys upgrades greedily, so gold is about zero at the top of each
iteration and "afford it now" would never fire. Hook it into the branch that runs when there is no Easy or Fair frontier region
(`candidates.length === 0`), before `waitForNextPurchase`:

```js
function planIntel(state, world, id, levels) {            // price and outcome of scout + `levels` steps, on a clone
  const c = structuredClone(state); c.gold = 1e15; let spent = 0;
  if (!I.isScouted(c, id)) { spent += I.scoutCost(c, world, id); c.intel = { ...c.intel, [id]: { scouted: true, sabotage: 0 } }; }
  for (let l = I.sabotageLevel(c, id); l < levels; l += 1) { spent += I.sabotageCost(c, world, id); c.intel[id] = { scouted: true, sabotage: l + 1 }; }
  return { spent, diff: difficulty(c, world, id) };       // needs the §8.1 line to see the effect
}
// intelWait(): among frontier regions pick the cheapest plan (k = 1 then 2) whose label becomes Easy/Fair;
//   finisher: only if plan.spent <= FIN x (cost of the cheapest upgrade in the current pool), FIN = 3
//   heavy:    always (FIN = Infinity)
// then: wait for gold instead of buying an upgrade, applyIntel (scout + sabotage), attemptConquest on that region,
//   clearRegionIntel on a win.
```

The complete working patch (about 60 lines) is what produced the numbers below; it is easy to re-derive from the sketch.

### 8.7 The dominance check (must hold after every re-tune)

Run seeds 1 to 6 with three policies (normal, finisher FIN=3, heavy) and compare time to 10 and 20 regions. Results on the
2026-09-29 snapshot, time to 20 regions, per seed (seeds 1 and 4 are seeds where the NORMAL policy is already stalled or crawling
in Balance's current tuning, so intel unsticking them says something about that tuning, not about intel):

| policy | seed 1 | 2 | 3 | 4 | 5 | 6 | median |
|---|---|---|---|---|---|---|---|
| normal | >24 h | 1.82 h | 2.05 h | 11.0 h | 37 m | 1.13 h | 2.05 h |
| finisher (FIN=3) | 21.2 h | 1.98 h | 3.02 h | 6.84 h | 42 m | 1.48 h | 3.02 h |
| heavy | >24 h | 3.63 h | 3.39 h | 6.33 h | 1.24 h | 2.28 h | 3.63 h |

- **Pass criteria**: on every seed where normal completes cleanly, heavy is not faster than normal (here about 2x slower), and
  the finisher is within about +-15 % of normal (here 9 to 46 % slower: a comfort purchase, not a speed-up).
- Intel cannot replace upgrades: with `--no-army` (no core upgrades) the campaign stalls after 2 to 6 regions with or without
  the intel policies, because two steps buy at most +18 % ratio and the policies never find a plan that reaches Fair.
- **If a policy beats normal**, in order: (1) raise `steelMult` / `incomeSeconds` by 1.25 to 1.5x, (2) cut `step` from 0.15 to 0.12,
  (3) set `maxLevel` to 1. Earlier sweep with cheaper prices, time to 20 regions median on 6 seeds (normal 2.16 h):
  `[1, 2] / [60, 150]`: heavy 2.64 h, finisher 2.52 h; `[0.75, 1.5] / [45, 120]`: heavy 2.51 h, finisher 2.36 h;
  `[0.5, 1] / [30, 90]`: heavy 2.37 h but faster than normal in 3 of 6 seeds, finisher 1.87 h. Keep the defaults, or `[1, 2]`
  if sabotage should feel like a better deal; do not go below `[0.75, 1.5]`.

## 9. Phone bottom-sheet height (measured with the real region card, `tools/gallery/intel.html`)

| card state at 390 x 844 | height | share of the screen |
|---|---|---|
| frontier card today (no intel) | 313 px | 37 % |
| + unscouted (one Scout row) | 369 px | 44 % |
| + scouted report (perk row hidden by intel.css on phones, one note) | 449 px | 53 % |
| scouted, sabotage unaffordable (adds the reason line) | 467 px | 55 % |

The unscouted state is at the budget; the scouted report is not, and cannot be while the card keeps every existing row:
the report needs about 120 px minimum (chips, personality, weak point, sabotage button). What `intel.css` already does on
phones: one note instead of two, the card's perk row steps aside (`:has()`), 44 px touch targets only on coarse pointers.
The crowns line (features doc, decision 5) adds about 26 px more. To land nearer 40 %, integration owns the remaining levers:

1. Merge the owner chip into the header row (the tier pill and the emblem chip side by side): about 38 px.
2. Merge the two reward lines into one ("+1.5/s forever - 59 gold"): about 20 px.
3. Let the sheet scroll (it already has `max-height: 62vh`, about 523 px, so a scouted card fits without scrolling).

Frame the camera so the scouted region stays visible above the sheet (`freeRect` on phones), since the point of scouting is the map.

## 10. Verify

`npm test` (the three `*.intel.test.js` files), then `tools/gallery/intel.html` (`?view=map`, `?sheet=1&only=scouted`, `?only=...`);
with the hook landed the gallery's orange banner disappears by itself and the difficulty bars show the sabotaged region.
