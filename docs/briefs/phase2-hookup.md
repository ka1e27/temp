# Living Frontier, Phase 2 (Generals and Renown): hookup for integration

Sources: DESIGN §10.7, §10.8, §10.11 and §10.12. The sim/meta engineer wrote this; integration applies it.
Everything is pure and deterministic, with time passed in. Every number lives in `game/config/generals.js` and
`game/config/renown.js`.

## 1. Modules

| Module | What it is |
|---|---|
| `game/meta/generalsState.js` (the leaf) | roster shape, `ensureGenerals`, `generalById`, `recruitChampion`, `addMercenary`, XP (`addXp`, `xpToNext`), skills (`pendingPicks`, `nextPickOptions`, `pickSkill`, `clearSkills`, `skillIds`), wounds (`isWounded`, `wound`), `passiveOf`, `abilityOf`, `commanderEffects`, `commanderStyle`, `sanitizeGenerals` |
| `game/meta/generals.js` | re-exports the leaf, plus `freeGenerals`, `busyGeneralIds`, `bestFreeGeneral`, `nearestFreeGeneral`, `assign`, `settleCommander`, `generalsPanelData`, `passiveText`, `abilityText`, `skillText` |
| `game/meta/renownState.js` (the leaf) | `defaultRenown`, `ensureRenown`, `renownPoints`, `earnRenown`, `spendRenown`, `sanitizeRenown` |
| `game/meta/renown.js` | the spends, each as `xRefusal` / action / cost: `festival`, `train`, `hireMercenary`, `muster`, `heal`, `respec`, plus `renownSpends`; re-exports the leaf |
| `game/battle/abilities.js` | `applyAbility` (called by `sim.js`), `abilityState(battle)`, `abilityAdvice(battle, t)`. `sim.js` re-exports `abilityState` and `abilityAdvice`. |

## 2. State

| Field | Scope | Default | Sanitiser (save.js) |
|---|---|---|---|
| `generals` | **persists across dynasties** | `defaultGenerals(state.seed)` (the Marshal) | `sanitizeGenerals(src.generals, src.seed)` |
| `renown` | per dynasty | `defaultRenown()` | `sanitizeRenown(src.renown)` |

Shapes:
- `generals`: `{ seq, roster: [{ id, kind, name, style, level, xp, skills, woundedUntil, regionId, passive? }] }`
  - `id`: `'marshal'`, `'champion:<factionId>'` or `'merc:<n>'`
  - `skills[i]`: the option (0 or 1) picked at `GENERALS.skillLevels[i]`
  - `regionId`: where the General last fought
- `renown`: `{ points, earned, spent, festivals, log: { crown, defense, retake, capital } }`

Resets:
- **`createGame`:** add both fields.
- **`resetRegions`:** reset `renown = defaultRenown()` only. **Do not touch `generals`** in `resetRegions` or in a new dynasty.
- **`foundDynasty`** already does this: `renown` is reset; `generals` is carried with levels, XP and skills kept and `regionId`
  cleared.
- **"Start a new realm" / restart:** keep `generals` too, so the roster is lifetime progress. Your call if you want a hard reset
  option.
- Every module creates its field on demand (`ensureGenerals`, `ensureRenown`), so old saves work.

Round-trip tests to add, as before: a sanitised value survives a round trip unchanged, and junk is dropped.

## 3. Call sites

### 3.1 Choosing and recording a battle's commander
- **Attack:** the region card's default is `bestFreeGeneral(state, world, regionId, 'attack', now)`, or null for the Militia
  Captain.
- **Defense:** when a raid is announced, use `nearestFreeGeneral(state, world, raid.toRegionId, now)`. Change it from the tray.
- **Building the stats:** pass the commander into the stats. Its passive and ability are folded in:
  ```js
  const player = playerBattleStats(state, world, regionId, { commander: generalId });   // old 3-argument calls still work
  ```
  For a defense, pass that `player` as `defenseRunFor(state, world, raid, player, { nowMs })`.
- **The run:** set `run.commander = generalId` (or `assign(run, generalId)`).
- **Changing commander mid-battle:**
  ```js
  assign(run, newId, state, world, playerBattleStats)
  ```
  This re-folds the passive and ability into the running battle; an ability already used stays used.
- `freeGenerals` and `busyGeneralIds` read `state.battles[].commander`, so keep `state.battles` in sync.

### 3.2 The steward of an unwatched (or Auto) run
```js
const g = generalById(state, run.commander);
stewardDecide(battle, battle.t, battle.steward ??= {}, g ? commanderStyle(g) : 'captain');
```
- `commanderStyle(g)` returns `{ style, level, skills }`. The steward's think interval and lookahead scale with level, its skills
  apply, and it uses the General's ability itself (`abilityAdvice`).
- Today `app/battles.js` passes `'stalwart'` for any commander; switch it to the line above.

### 3.3 The ability (battle HUD button)
- **Button state:** `abilityState(battle)` → `{ id, ready, used, needsTarget }`, or null when no General commands.
  - Names come from `GENERALS.copy.abilityNames[id]`.
  - The description is `abilityText(general)`.
- **Command:** `issue(battle, { type: 'ability', owner: 0, ability: id, target })`.
  - `target` is needed only for `raid`: an enemy site id. Reuse the drag-to-target flow.
  - A Raid with no reachable target is refused (a `refused` event) and the ability stays available.
- It works once per battle; the battle JSON stores `abilityUsed` and `abilityAt`.
- **Events:**
  - `ability { owner, ability, x, y, target, sites? }`: fx at (x, y); `sites` lists every settlement a Shield Wall covers
  - a Raid's squads also emit normal `send` events with `raid: true`
- **Battle effects for the UI:**
  - Shield Wall uses each site's `bulwarkUntil`, so the Bulwark visuals apply
  - `battle.effects.revealUntil`: Foresight; draw every enemy squad's intent line until then
  - `battle.effects.slowUntil` / `slow`: Foresight's slow
  - `battle.effects.chargeLeft`: Charge squads still to come; charged squads carry `power` and `speedMult`
  - Raid squads with the skill carry `noArrows`

### 3.4 When a battle ends
For every finished run, after your current handling (`conquer` + crowns, `defenseReward`, `occupy`):
```js
const cmd = settleCommander(state, run, result, Date.now());   // XP (100 / 80 / 40), a 10-min wound on a loss, where it fought; null for the Captain
```
- `cmd` is `{ id, xp, levels, level, wounded, picks }`. Toast level-ups. When `picks > 0`, the roster badge shows a skill pick.
- **Renown is already paid inside the existing calls.** Show the amounts:
  - `awardCrowns(...)` now returns `{ bonusGold, count, renown }` (1 per crown).
  - `defenseReward(...)` returns `{ gold, renown }` (2, +1 if no settlement fell).
  - `conquer(...)` on a retake returns `{ retaken: true, renown }` (2).
  - `conquer(...)` on a rival capital returns `{ decapitated: true, recruited: 'champion:<f>', renown: 3 }`. Announce the new
    General.
- `resolveAway` does not touch Generals or Renown.

### 3.5 Spending (the roster and the cards)
- **Data in one call:** `renownSpends(state, world, regionId, now)` →
  `{ renown, region: { festival, muster }, generals: [{ id, train, heal, respec }], hire }`.
  - Each entry is `{ kind, name, cost, can, reason }`. `reason` is display text ("Need 2 more Renown").
- **Actions** (each returns the result or `false`, and mutates):

  | Action | Returns |
  |---|---|
  | `festival(state, world, regionId, now)` | `{ cost, level }` |
  | `train(state, id)` | `{ cost, level }` |
  | `heal(state, id, now)` | `{ cost }` |
  | `respec(state, id)` | `{ cost, picks }` |
  | `hireMercenary(state)` | the new General |
  | `muster(state, world, regionId, now)` | `{ cost }` |

  - A Festival also moves `conqueredAt` so prosperity keeps growing. Call `updateProsperity` afterwards: it does not re-celebrate.
- **Skill picks:** `pickSkill(generalById(state, id), 0 | 1)`. The options are in `generalsPanelData(...).generals[i].nextPick`, or
  `skills[tier].options`.
- **Roster panel:** `generalsPanelData(state, world, now)` → `{ generals, hire, renown }`. Each General has:
  - who: `name`, `title`, `kind`, `styleName`
  - progress: `level`, `xp`, `xpNext`
  - what it does: `passive` and `active` text, `ability`
  - `skills`: tiers with `options` (`{ id, text }`), `picked`, `open`
  - state: `pendingPicks`, `wounded`, `woundedMs`, `busy`, `commandingRegion`, `commandingKind`
  - actions: `train`, `heal`, `respec`, each `{ cost, can }`

## 4. Notes
- **Tray chip:** show the commander's name, or `GENERALS.copy.captainName`.
- **The Militia Captain** has no passive and no ability; `abilityState` is null.
- **Odds on the cards:** `estimateDefense` already takes `{ commander: 'captain' | 'stalwart' | 'inPerson' }`. With a General,
  pass the General's id as `opts.general` (see §5).

## 5. Defense odds with a General
```js
estimateDefense(state, world, regionId, raid, { general: generalId, nowMs })
```
- The General's passive counts in the strength ratio.
- The win chance runs between the measured level-1 and level-10 steward curves (`FRONTIER.estimate.fit.general1` / `general10`).
- `inPerson` is still the chance if the player defends it.
- Without `general`, nothing changes from Phase 1.
