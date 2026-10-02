# Region Works: hookup guide (integration and balance)

DESIGN §5.8 (Works), §5.6 (Prosperity opens the slots), §5.7 (the Watchtower scouts for free), PLAYFEEL step M3. Written
against the code as it stood on 2026-09-30 (`scenes/world.js regionCardData`, `ui/regionCard.js`, `meta/progression.js
playerBattleStats`, `meta/economy.js incomePerSec`, `meta/intel.js intelPanelData`). Function names are the anchor; if a line
moved, search for the function.

Everything new is self-contained and tested. **Nothing in `state.js`, `save.js`, `progression.js`, `economy.js` or `intel.js`
was edited**; the exact patches are below, split by owner.

## 0. What ships

| file | what |
|---|---|
| `game/config/works.js` | every number, each with its reason (costs, per-level effects, caps, marks, copy) |
| `game/meta/worksEffects.js` | **leaf** (imports only `config/works.js` and `state.js`): `state.works` access, slots, `worksBattleEffects`, `worksIncomeMult`, `worksScoutedFree`, reset, sanitise |
| `game/meta/works.js` | re-exports the leaf, plus costs, `buildWork` / `upgradeWork` / `demolishWork`, panel data, map-mark data, tutorial helpers |
| `game/ui/worksPanel.js`, `worksChooser.js`, `worksIcons.js` | the owned-card section, the picker, five SVG icons |
| `game/styles/components/works.css` | styles, phone rules, Reduce Motion |
| `game/render/worksMarks.js` | the five buildings by each keep, elevation-aware, fading with zoom |
| `tools/gallery/works.html` (+ `.js`, `works-check.mjs`) | every state in the real card, icons, map; real-Chrome assertions |

**Import rule (important).** `works.js` imports `progression.js` (for `enemyDepth`), so `progression.js`, `economy.js`,
`upgrades.js`, `perks.js` and `prosperity.js` must import from **`./worksEffects.js`**, never from `./works.js`, or they form a
cycle. A test (`meta.works.test.js`, "import graph") fails if they do. Everything else (scenes, UI, tools, tests) imports from
`meta/works.js`, which re-exports the leaf. (This is the same split as `intelState.js` / `intel.js`.)

APIs:

```js
// meta/works.js (re-exports meta/worksEffects.js)
workSlots(state, regionId) -> 0..3                      // 0 unless owned; 1 + one per prosperity milestone (II, III)
workCost(state, world, regionId, type, level) -> gold   // cost to REACH that level (1 = build); Infinity if invalid
canBuild / buildWork(state, world, regionId, type)      -> false | { slot, cost, work }     // MUTATES gold + state.works
canUpgrade / upgradeWork(state, world, regionId, slotIdx) -> false | { slot, cost, level, type }
canDemolish / demolishWork(state, world, regionId, slotIdx) -> false | { refund, type, level }   // refund = WORKS.demolishRefund (50 %) of the
                                                        // gold spent on that Work across all its levels; later Works move up a slot
demolishRefundFor(state, world, regionId, slotIdx) -> gold
buildRefusal(...) / upgradeRefusal(...)                 -> null | 'notOwned' | 'noSlot' | 'duplicate' | 'maxed' | 'gold'
worksBattleEffects(state, world, targetRegionId) -> { campTroops, speedMult, cooldownMult, campVolleyLevel }
worksIncomeMult(state, regionId) -> 1 + 0.08 x Market level
worksScoutedFree(state, world, regionId) -> boolean     // a Watchtower next door
resetWorks(state)   clearRegionWorks(state, regionId)   sanitizeWorks(raw)   ensureWorks(state)
worksPanelData(state, world, regionId, now?) -> WorksPanelData      // feeds ui/worksPanel.js
worksMarksData(state, world) -> WorksMark[]                          // feeds render/worksMarks.js
worksTutorialDue(state) -> boolean    worksTutorialRegion(state, world) -> regionId | -1
workName(type)  workEffectText(type, level)  workBlurb(type)  worksToast(kind, {work, region, level})
```

Rules the code enforces (all tested): one Work per type per region (a three-slot region holds three different Works); a
refused `buildWork` / `upgradeWork` / `demolishWork` returns `false` and changes nothing (like `buy()`); effects only count regions the player
owns; `state.works` is created on demand, so old saves and fixtures work untouched.

## 1. Integration: state and save (the exact patch)

`state.works = { [regionId]: [{ type, level }] }`, one list per region, list index = slot index; missing = no Works.

**`game/meta/state.js`**

```js
 * @property {Object<string, {type: string, level: number}[]>} works  per region id, this dynasty only (meta/worksEffects.js)
```
```js
// in resetRegions(), next to state.intel = {} / state.prosperity = []
  state.works = {};
```

**`game/meta/save.js`** (`withDefaults`; `sanitizeWorks` accepts junk, arrays and the object form, never throws)

```js
import { sanitizeWorks } from './worksEffects.js';
...
    works: sanitizeWorks(src.works),
```

A dynasty needs nothing else: `container.tryFoundDynasty` already calls `resetRegions`, which now empties `works`. (Optional
hygiene in `foundDynasty`'s `next` literal: `works: {}`. Balance's file; `resetRegions` covers it.) **Apply the two patches together.**
With `state.works = {}` in `resetRegions` but no line in `withDefaults`, the `meta.save` round-trip tests go red (the same
thing `crowns` did), and in the game a built Work would be lost on reload. After both, add one round-trip test
(`state.works = { 1: [{type:'market', level:2}] }` survives `deserialize(serialize(state))`).

Legacy saves: `sanitizeWorks(undefined)` is `{}`, nothing to migrate.

**If a region is ever lost** (nothing does that today): call `clearRegionWorks(state, regionId)` where ownership flips away. The
Works are destroyed with the region, no refund; a region retaken later starts over with one slot. `worksBattleEffects`,
`worksIncomeMult` and `worksScoutedFree` ignore unowned regions anyway, so a missed call is harmless.

## 2. Integration: style sheet

`game/styles/main.css`, with the other component imports:

```css
@import url('./components/works.css');
```

## 3. Integration: the owned region card

**Data.** `scenes/world.js regionCardData()`, owned branch, add one field:

```js
import { worksPanelData } from '../meta/works.js';
...
        works: worksPanelData(state, world, regionId, Date.now()),
```

It is cheap (a few array reads per slot and a handful of `enemyDepth` lookups, cached per world), so the card's existing 1 s
refresh is fine. Pass `Date.now()` so locked slots can say "in 1h 35m".

**Mount.** `game/ui/regionCard.js`:

```js
import { createWorksPanel } from './worksPanel.js';

// createRegionCard({ ..., onBuildWork, onUpgradeWork, onDemolishWork })
const worksPanel = createWorksPanel({
  onBuild: (regionId, slot, type) => onBuildWork?.(regionId, slot, type),
  onUpgrade: (regionId, slot) => onUpgradeWork?.(regionId, slot),
  onDemolish: (regionId, slot) => onDemolishWork?.(regionId, slot),   // already confirmed by the panel's own Keep / Demolish step
});

// setMode('owned'): the Works panel is the LAST row (the interactive part), after the crowns
bodyEl.replaceChildren(perkEl, ownedProsperity, ownedRewards, ownedCrowns, worksPanel.el);

// patchOwned(data):
if (data.works) worksPanel.update(data.works);
worksPanel.el.hidden = !data.works;

// expose it for the tutorial coach and the scene
return { el, update, destroy, works: worksPanel };
```

The panel is BUILT ONCE and patched in place (every write is skipped when its value did not change; buttons are never recreated,
so a refresh between pointerdown and pointerup cannot swallow a tap; the gallery check proves it with real mouse events). Add
`works` to the `RegionCardData` typedef. The panel hides itself for a region the player does not own.

**Demolish.** A built row has a small "..." at the end of its name line (44 px hit area on touch screens, without making the row
taller). Tapping it turns the row into a confirm step in the same space: "Demolish Barracks? Refund 190 gold" with **Keep** (the
default focus) and **Demolish**; nothing is destroyed by a single tap. The prompt cancels itself on Keep, Escape, a region change,
the chooser opening, the Work disappearing, or after 6 s. Only the confirmed press calls `onDemolish(regionId, slot)`. The refund
is 50 % of everything spent on that Work (levels I up to its level: `WORKS.demolishRefund`), so build + demolish always loses gold.
The text comes from `WorksPanelData` (`refund`, `demolishPrompt` on each built slot), not from the UI. Because the list closes up
(slot i + 1 becomes slot i), the panel needs no extra bookkeeping: the next `update` shows the new layout. For the coach,
`panel.demolishButton(slot)` returns the "..." button.

Mount it **only** in the owned branch (the frontier card keeps Scout / Sabotage). `main.js`:

```js
regionCard: createRegionCard({
  ...,
  onBuildWork: (id, slot, type) => worldScene.onBuildWork(id, slot, type),
  onUpgradeWork: (id, slot) => worldScene.onUpgradeWork(id, slot),
  onDemolishWork: (id, slot) => worldScene.onDemolishWork(id, slot),
}),
```

**Phone budget (measured with the real card at 390 x 844, `tools/gallery/works.html`, asserted by `works-check.mjs`):**

| owned card state | height | share of 844 |
|---|---|---|
| one slot empty, two locked | 370 px | 44 % |
| Stables II + a free slot | 382 px | 45 % |
| three Works, mixed (also with a Demolish confirm open: the row keeps its height) | 400 px | 47 % |
| chooser open, everything affordable | 371 px | 44 % |
| chooser open, one already built, some too dear | 384 px | 46 % |
| chooser open, nothing affordable | 371 px | 44 % |

While the chooser is open on a phone, works.css hides the card's perk, prosperity, income and crowns rows with `:has()` so the
chooser gets the room. Touch targets are at least 44 px. The card is inside the 50 % budget in every state; it still has
`max-height: 62vh` scrolling as a backstop.

## 4. Integration: handlers (`scenes/world.js`)

```js
import { buildWork, upgradeWork, demolishWork, worksToast, workName } from '../meta/works.js';

function onBuildWork(regionId, slot, type) {
  const { state, world } = container.get();
  const res = buildWork(state, world, regionId, type);
  if (!res) { sfx.play('error'); return; }                 // refused: nothing changed
  sfx.play('upgrade');
  ui.toasts.update({ type: 'success', icon: 'castle',
    message: worksToast('built', { work: workName(type), region: world.regions[regionId].name }) });
  afterWorksChange(regionId);
  tutorial.notify('workBuilt');                            // M3 advances
}

function onUpgradeWork(regionId, slot) {
  const { state, world } = container.get();
  const res = upgradeWork(state, world, regionId, slot);
  if (!res) { sfx.play('error'); return; }
  sfx.play('upgrade', { pitch: 1 + 0.12 * (res.level - 1) });   // a little higher at level III
  ui.toasts.update({ type: 'success', icon: 'star',
    message: worksToast('upgraded', { work: workName(res.type), region: world.regions[regionId].name, level: res.level }) });
  afterWorksChange(regionId);
}

function onDemolishWork(regionId, slot) {
  const { state, world } = container.get();
  const res = demolishWork(state, world, regionId, slot);   // the panel already asked "Demolish Barracks? Refund 190 gold"
  if (!res) { sfx.play('error'); return; }
  sfx.play('coin', { volume: 0.5 });                        // the refund comes back as gold: the coin cue, quietly
  ui.toasts.update({ icon: 'coin',
    message: worksToast('demolished', { work: workName(res.type), region: world.regions[regionId].name, refund: res.refund }) });
  afterWorksChange(regionId);
}

function afterWorksChange(regionId) {
  markDirty();                      // rebuilds derived.worksMarks and, through difficulty(), every frontier chip
  refreshRegionCard();              // panel shows the new level and price at once
  updateHud(performance.now(), { force: true });   // gold went down
  services.autosave.save();
}
```

Also call `markDirty()` whenever a region is conquered (already the case) so a new owned region's marks appear. The toast text
comes from `config/works.js` (`worksToast`), never typed in the scene. Suggested sounds: the existing `upgrade` sparkle for both
(it reads as "something got better"); `coin` would sound like a purchase without a result. No new cue is needed.

**Difficulty labels move.** Once balance applies section 8, building next to a frontier region changes its Army Power, so the
label on the frontier card and map chips can change. `markDirty()` covers the chips; `refreshRegionCard()` covers the open card.

## 5. Integration: the world map marks

`scenes/world.js`, in `refreshDerived()` (it already runs on every `markDirty`):

```js
import { worksMarksData } from '../meta/works.js';
derived.worksMarks = worksMarksData(state, world);
```

and in the world frame, **after the settlements are drawn and before clouds, fx and labels** (never in the battle scene):

```js
import { drawWorksMarks } from '../render/worksMarks.js';
drawWorksMarks(ctx, camera, derived.worksMarks, camera.zoom, {
  color: factionColor(PLAYER_FACTION),                  // the realm's banner colour on barracks and watchtower flags
  t: reduceMotion ? undefined : t,                      // omit `t` under Reduce Motion: still flags and flames
  alpha: fogFade,                                       // optional: the same reveal fade the settlements use
  skip: (m) => !derived.revealed[m.regionId],           // never draw into fog
});
```

Behaviour: nothing below 8 px per world unit (a building would be a speck), ramps in to 12, full until 32, then fades out to 42
exactly like the region labels (`WORLD_SCENE.labelFade*Zoom`; a test pins the equality). Each region shows up to three small
buildings in a little yard to the lower right of its keep, with 1-3 gold pips for the level. Size is
`WORKS.marks.sizeUnits` (0.9 of a world unit) times the zoom, vector-drawn, crisp at DPR 2. Cost: a dozen `fillRect` /
`fill` calls per building, drawn only for regions in view.

Two notes for the label pass (`labels.js`): (a) the yard occupies roughly keep.x + 0.9..2.9 units by keep.y - 0.4..1.6 units, and a
region label placed near the keep can sit on it (the marks are drawn first, so the label text stays readable on top); if you
want a clean read, add those boxes to the label collision set or nudge labels down. (b) `prosperityDecor` paints the level-III
market awning AT the keep tile; Works stand beside it, so they do not collide.

## 6. Integration: Watchtower, free scouting (the intel panel)

`worksScoutedFree(state, world, regionId)` is true for a frontier region with an owned neighbour holding a Watchtower
(level >= `scoutFreeFromLevel`, 1). Treat such a region as **scouted for free**, for the report, the garrison badges and
Sabotage (which needs a scout). The intel module's own state is not touched: nothing is stored, it follows the Watchtower.

`game/meta/intel.js` (the intel engineer's file; the patch is three lines):

```js
import { worksScoutedFree } from './worksEffects.js';           // the leaf, no cycle

function isScoutedOrFree(state, world, regionId) {
  return intelOf(state, regionId).scouted || worksScoutedFree(state, world, regionId);
}

// canScout: a region that is already free-scouted needs no purchase
if (isScoutedOrFree(state, world, regionId)) return false;      // (replaces `if (intelOf(state, regionId).scouted) return false;`)

// canSabotage: `const { scouted, sabotage } = intelOf(state, regionId);` becomes
const { sabotage } = intelOf(state, regionId);
if (!isScoutedOrFree(state, world, regionId) || sabotage >= INTEL.sabotage.maxLevel) return false;

// intelPanelData: `const { scouted, sabotage: level } = intelOf(state, regionId);` becomes
const { sabotage: level } = intelOf(state, regionId);
const scouted = isScoutedOrFree(state, world, regionId);
// ... and in the returned object add, so the panel can say why it needed no purchase:
//   scoutedBy: scouted && !intelOf(state, regionId).scouted ? 'watchtower' : null,
```

`sabotage()` already writes `{ scouted: true, sabotage: level }`, so a sabotaged region stays scouted if the Watchtower is ever
gone. The intel panel can show `scoutedBy === 'watchtower'` as a one-word tag ("Watchtower"); no other UI change.

The map: wherever the world scene passes scouted regions to `drawScoutedGarrisons`, use the same predicate
(`isScouted(state, id) || worksScoutedFree(state, world, id)`).

The scout report's player stats should be the target's, i.e. `scoutReport(...)` calls `playerBattleStats(state, world, regionId)`
once balance adds the third argument (section 8), so the suggested weak point accounts for the Works next door.

## 7. Integration: tutorial step M3 ("after the 3rd conquest")

PLAYFEEL M3: "Build Works in your regions: Barracks and Stables help the battles next to them." Points at an owned frontier
region; advances on a Work built. The helpers are pure and in `meta/works.js`:

```js
worksTutorialDue(state)            // regionsConquered >= 3 and no Work ever built
worksTutorialRegion(state, world)  // the owned region to point at: borders enemy land, has a free slot, borders the most such regions; -1 if none
totalWorks(state)                  // > 0 means done
```

Flow for the coach (it follows its target every frame, per the placement rules):

1. `worksTutorialDue(state)` and the hint step is M3: pointer on the **label of region `worksTutorialRegion`** (it is an owned
   region at the edge of your land). Advance to 2 when that region is selected (`setSelected`).
2. The card is open on the owned region: point at `ui.regionCard.works.buildButton()` (the first empty slot's "Build..." button;
   null while the chooser is open or no slot is free, so the coach hides instead of pointing at nothing).
3. The chooser is open: point at `ui.regionCard.works.chooserRow('barracks')` (Barracks suits the first frontier fight).
4. `tutorial.notify('workBuilt')` (section 4) completes M3. Dismissing the coach skips it as for every other step.

If the player opens a different owned region, re-target step 2 with `buildButton()` on that card; if `worksTutorialRegion` returns
-1 (nothing owned has a free slot and a hostile border) skip M3 silently.

## 8. Balance: hook the effects in

The effects API (names are final; the numbers are in `config/works.js`):

```js
worksBattleEffects(state, world, targetRegionId) -> { campTroops, speedMult, cooldownMult, campVolleyLevel }
worksIncomeMult(state, regionId) -> 1 + perLevel x Market level
```

**`meta/progression.js`: import the leaf** and let `playerBattleStats` take the target:

```js
import { worksBattleEffects, NO_WORKS_EFFECTS } from './worksEffects.js';

export function playerBattleStats(state, world, targetRegionId) {
  const w = targetRegionId == null ? NO_WORKS_EFFECTS : worksBattleEffects(state, world, targetRegionId);
  ...
    campTroops: PLAYER_BASE.campTroops + levelOf(state, 'muster') * UPGRADES.muster.magnitude + w.campTroops,
    speed: PLAYER_BASE.speed * mult('logistics') * perks.speed * w.speedMult,
    cooldownMult: perks.cooldownMult * w.cooldownMult,          // multiplicative with the Old Shrine perk (perks floor at 0.2)
    campVolleyLevel: w.campVolleyLevel,                         // NEW PlayerStats field, read by the battle sim (below)
```

Pass the target everywhere a battle is about to be fought or judged, or the label and the fight disagree:

| call site | change |
|---|---|
| `difficulty()` in progression.js (`const player = playerBattleStats(state, world)`) | `playerBattleStats(state, world, regionId)` so the Easy / Fair / Hard / Deadly label and the surrender check include the Works |
| `scenes/battle.js` (`startBattle`, ~line 1186) | `playerBattleStats(state, world, regionId)` |
| `meta/intel.js scoutReport` (line ~413) | `playerBattleStats(state, world, regionId)` |
| `tools/balance.mjs`, `tools/campaign.mjs` | same, with the region being attacked |
| `app/income.js effectiveRegionIncome`, `meta/economy.js incomePerSec` | multiply each region's income by `worksIncomeMult(state, region.id)` next to `prosperityIncomeMult` |

The Market stacks with Prosperity multiplicatively (both multiply `regionIncome`); bounty is `bountySeconds x incomePerSec`, so a
Market also raises every later bounty a little. `estimatePower` already reads `player.campTroops`, so Barracks show in the label
with no further change; Stables and Shrines are not in `estimatePower` (the harness fitted Army Power without them): if they
should move the label, add `speedMult` and `1 / cooldownMult` terms to the power estimate and refit.

**The camp volley** (`campVolleyLevel`, 0..3). The Watchtower's "War Camp looses arrows like a tower" needs the battle sim to read
`player.campVolleyLevel` and let the War Camp site fire at squads in range, reusing `resolveTowerVolleys`. A tower today is
`{ range: 2.6, volleySec: 0.5, volleyKills: 1 }` (config/battle.js `SITE_TYPES.tower`). Suggested starting camp values, a level
being one Watchtower level next door (capped at 3): range 2.6 for all; `volleySec` **1.6 / 1.1 / 0.7** for levels 1 / 2 / 3;
1 kill per volley. Level III is then 70 % of a tower's rate, from a camp that can move squads out of the way. Put the table in
`config/battle.js` as `CAMP_VOLLEY`; `worksBattleEffects` only supplies the level.

**Suggested starting magnitudes** (what `config/works.js` ships; per level, level n gives n x):

| Work | per level | what that is worth | cap |
|---|---|---|---|
| Barracks | +2 camp troops | one Muster level (+2.08), but only next door | +20 troops total |
| Stables | +5 % march speed | Logistics is +6 %/level globally | x1.5 |
| Shrine | -4 % power cooldowns | the Old Shrine perk is -6 % per region | floor 0.6 |
| Watchtower | +1 camp volley level, free scouting next door | see above | level 3 |
| Market | +8 % income in that region | 12.5 / 27 / 60 min payback (first ring) | none |

A target rarely has more than three or four owned neighbours, so the caps bind only on extreme layouts. They are rails, not targets.

**Costs** (`cost = base x perDepth^(depth-1) x levelMult[level-1] x typeMult`, depth = `enemyDepth(world, region)` floored at 1;
base 60, perDepth 1.9, levelMult 1 / 2.2 / 4.8, typeMult 1 / 0.9 / 1 / 1.3 / 1). Depth, not tier: a region's rung on the one
difficulty ladder is the order the player conquers them in, and the realm's income grows about x2.0 per rung (seed 7 campaign),
so a Work costs a steady share of income wherever it is built. Worksheet (seed 7, `tools/campaign.mjs` income and the real cost
function):

| conquest n | region depth | realm income /s | next core upgrade | Barracks I | all three levels | Barracks I in seconds of income | Market I payback |
|---|---|---|---|---|---|---|---|
| 1 | 1.00 | 3.5 | 33 | 60 | 480 | 17 s | 13 min |
| 3 | 1.50 | 6.3 | 85 | 83 | 662 | 13 s | 17 min |
| 5 | 2.25 | 12.7 | 487 | 134 | 1070 | 10 s | 20 min |
| 10 | 3.00 | 30.6 | 1336 | 217 | 1734 | 7 s | 33 min |
| 15 | 5.25 | 52.9 | 921 | 918 | 7345 | 17 s | 99 min |
| 20 | 5.50 | 87.0 | 3349 | 1078 | 8622 | 12 s | 117 min |
| 25 | 5.00 | 264 | 18332 | 782 | 6255 | 3 s | 42 min |

How to read it, and what to check in the recalibration:

- A level-I Work is about 3-17 seconds of realm income and 0.1-0.4 of the next core upgrade, so building is never a saving goal,
  but it is not free either: the third level costs 4.8x the first, and nobody maxes three Works in every border region early.
- **Dominance check to run.** One Barracks I (+2 troops, about +6 % Army Power at 30 troops) costs 0.25-0.45 of a Muster level that
  gives +2.08 globally, forever, while a Work works only on its neighbours. That 2-4x price discount is deliberate (it is local
  and dies when the frontier moves on). If campaign times drop more than the Works' pacing target allows, raise `perDepth`
  toward 2.1, or `levelMult[0]`, before touching magnitudes. Compare with sabotage, which is tied to the next Steel level: a
  full set of three Barracks next to one target is worth about as much Army Power as two sabotage steps, at a fraction of the price,
  so if Works beat sabotage by a wide margin, tie Work prices to the next Muster cost as intel ties sabotage to Steel
  (`cost = max(depth price, k x upgradeCost('muster', level))`).
- Late-game flat troops shrink in value (camp 30 + Muster levels); if Barracks stop mattering deep in a dynasty, scale
  `barracks.perLevel` by the target's depth (`worksBattleEffects` already has `world` and `targetRegionId`).
- The Market is the only Work that pays in gold, so check it against Taxes: +8 % of ONE region's income (about 1/25 of the realm)
  per level is small next to Taxes (+2.9 % of everything, 59 x 1.2^n), which is why deep Markets paying back in 1-2 hours is
  acceptable: Markets are for safe inner regions.
- Campaign policy suggestion (`tools/campaign.mjs`): after each conquest, with spare gold above the next upgrade price, build the
  cheapest level-I Work the border needs (Barracks for the next target first, a Market at home while the realm is young), and upgrade
  only when a Work's level I price is under ~5 s of income. The 20-region and whole-continent waits should fall by a few percent;
  if they fall by more than 10 %, Works are too cheap.

**Resets.** `resetRegions` (integration) zeroes `state.works`; `resetWorks(state)` is the same thing for anyone holding a state
without a world.

## 9. Open decisions for the lead

Decided by the lead (kept here so the reasons stay with the code):

1. **Demolish exists, with a 50 % refund** (`demolishRefund`), behind a confirm step. Works are local, so an inner Barracks is dead
   weight once the frontier moves on; half back makes re-siting real but not ruinous and cannot be farmed.
2. **One Work per type per region.** Keeps the choice interesting (three different Works in a three-slot region).
3. **Watchtower level I scouts.** Raising `scoutFreeFromLevel` to 2 would make the first level mostly about arrows.

Tutorial M3 (`worksTutorialDue`) counts Works STANDING, so demolishing the only Work makes it due again; the tutorial step (which
integration advances on the first build) is what stops it from repeating.

## 10. Verify

- `node --test game/tests/meta.works.test.js game/tests/ui.works.test.js game/tests/render.works.test.js` (demolish is covered in the
  first two: refund maths, list closing up, no farming, the confirm flow, auto-cancel, Escape)
- `npm start`, then `node tools/gallery/works-check.mjs` (real Chrome: build and upgrade through the real card with real clicks,
  a tap that survives a refresh between pointerdown and pointerup, the chooser round trip, Escape and focus return, Demolish through its confirm (Keep keeps; Demolish refunds half, the list closes
  up, the row keeps its height), the phone
  height budget, 44 px touch targets, overflow at 390 px, the map at three zooms, Reduce Motion).
- Gallery: `tools/gallery/works.html` (`?view=chooser|icons|map`, `?bare=1`, `?sheet=1&only=mixed` for the 50 % guide,
  `?zoom=26&focus=14` for the map, `?reduce=1`). Its map and panels use the real renderer, card and meta modules.
