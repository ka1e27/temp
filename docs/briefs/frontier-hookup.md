# Living Frontier, Phase 1: hookup for integration

Sources: DESIGN §10 and ARCHITECTURE §10. The sim/meta engineer wrote this; integration applies it.
Everything below is pure and deterministic. You pass time in (`nowMs`, active seconds), and randomness comes from
`state.frontier.rng`.

## 1. New modules

| Module | What it is |
|---|---|
| `game/config/frontier.js` | `FRONTIER` (scheduler, siege, war band, militia, rewards, away rules, estimate fit, raid AI), `FORTS` / `FORT_TYPES`, `STEWARD` (style tables). Every number is here. |
| `game/battle/defenseArena.js` | `buildDefenseArena`, `canBuildDefenseArena`, `busyKey(world, settlementId)`, `normalizeBusy` |
| `game/battle/steward.js` | `stewardDecide(battle, t, memo, style)`, `stewardThink(battle, t, memo, params)`, `stewardStyle` |
| `game/battle/fortSites.js` | `fortEffects(list)`, `fortTowerTiles(world, regionId, count)`: where an Arrow Tower stands (shared by the arena and the map) |
| `game/battle/defenseEstimate.js` | `defenseStrengths`, `defenseWinChance`, `defenseLabel`: the closed form behind `estimateDefense` |
| `game/meta/frontier.js` | `tickFrontier`, `defenseRunFor`, `defenseReward`, `occupy`, `retake`, `resolveAway`, `awayReportText`, `estimateDefense`, `attackArenaOpts`, `busyFromState`, `raidEnemyStats`, `raidDepth`, `borderingRivals`, `raidRate`, `inGrace`, `activeDefenses`, and everything re-exported from `frontierState.js` |
| `game/meta/frontierState.js` | the leaf: `defaultFrontier`, `ensureFrontier`, `ensureOccupation`, `occupationOf`, `occupiedBy`, `occupy`, `retake`, `resetFrontier`, `sanitizeFrontier`, `sanitizeOccupation` |
| `game/meta/forts.js` (+ the `fortsEffects.js` leaf) | costs, `buildFort` / `upgradeFort` / `demolishFort` (+ refusals), `fortsPanelData`, `fortsMarksData`, `fortEffectText`, `fortName`, `fortsToast`, `fortSlots`, `fortsOf`, `sanitizeForts`, `resetForts` |
| `game/meta/militia.js` | `militiaGarrisons`, `militiaFill`, `drainMilitia`, `refillMilitia`, `defenseLossFraction`, `sanitizeMilitia`, `resetMilitia` |

Changed by sim/meta (already applied):
- `arena.js`: `buildArena(..., opts)` takes `opts.busy` and `opts.forts`, and its errors carry `err.code`.
- `sim.js`, `resolve.js`: defense mode.
- `combat.js`: `siteDefence(site)`, Walls, the tower overrides, `effectiveCap(..., playerCapMult)`.
- `ai.js`: raid tuning in defense battles.
- `bot.js`: `decideDefense`, for the tools.
- `progression.js`:
  - `conquer` calls `retake`, pays a share of the bounty and records the provocation.
  - `enemyBattleStats` and `difficulty` read the occupation and the captured forts.
  - `foundDynasty` resets the four new fields and keeps your `battles: []`.

## 2. State: defaults, sanitisers, resets

Add these fields to `createGame` (via `resetRegions`) and carry each one in `save.js withDefaults` with its sanitiser:

| Field | Default | Sanitiser (save.js) | Notes |
|---|---|---|---|
| `frontier` | `defaultFrontier()` | `sanitizeFrontier(src.frontier)` | `{ seq, rng, activeSec, nextCheckAt, cooldown, incoming, lastAwayReport, provoked, stats }`. `incoming` raids keep `{ id, faction, fromRegionId, toRegionId, announcedAt, arriveAt, strength, depth, first }`. |
| `occupation` | `{}` | `sanitizeOccupation(src.occupation)` | `{ [regionId]: { by, at, prosperity, tenureMs, forts, works, militia } }`. While occupied, `owner[id]` is the occupier and `conqueredAt[id]` is null. |
| `forts` | `{}` | `sanitizeForts(src.forts)` | `{ [regionId]: [{ type: 'tower'\|'walls'\|'hall'\|'beacon', level }] }` |
| `militia` | `{}` | `sanitizeMilitia(src.militia)` | `{ [regionId]: { fill: 0..1, at: ms } }`. A missing entry means full. |

Additions to `resetRegions(state, world, now)`, which a new realm or dynasty goes through:

```js
state.frontier = defaultFrontier();   // the raid clock, cooldowns and grace start over
state.occupation = {};
state.forts = {};
state.militia = {};
```

`foundDynasty` already does the same. Every module also creates its field on demand (`ensureFrontier`, `ensureForts`,
`ensureMilitia`), so an old save or a test fixture without the fields works.

Round-trip tests to add in `meta.save.test.js`, one per field:
- a sanitised value survives `serialize` and `deserialize` unchanged
- junk (strings, negative ids, unknown types, Free Folk raids) is dropped

`sanitizeFrontier(sanitizeFrontier(x))` equals `sanitizeFrontier(x)`; a test already covers this.

## 3. What to call, and when

### 3.1 Every frame of active play: `tickFrontier`
```js
const { announced, arrived } = tickFrontier(state, world, Date.now(), realDtSec);
```
- `realDtSec` is wall-clock seconds, not scaled by battle speed. Call it only while the game is visible.
- Hidden or closed time is settled by `resolveAway` (§3.5). The scheduler checks only once per `FRONTIER.checkSec` (20 s), so a
  per-frame call is cheap: about 0.002 ms.
- `announced` (each raid is now in `state.frontier.incoming`):
  - toast: "The {faction} marches on {region}: arrives in {s} s [Go]", with `s = raid.arriveAt - state.frontier.activeSec`,
    counted in ACTIVE seconds
  - the marching war band on the map, at progress `(activeSec - announcedAt) / (arriveAt - announcedAt)` from `fromRegionId`
    to `toRegionId`
  - a leader line
  - `raid.first` marks the realm's first raid. It is already weak (×0.6); the tutorial can script it.
- `arrived`: for each raid,
  ```js
  const run = defenseRunFor(state, world, raid, playerBattleStats(state, world, raid.toRegionId), { nowMs: Date.now(), busy: manager.busy() });
  manager.start(run);
  ```
  - `run` is a full BattleRun: `{ id, kind: 'defense', regionId, fromRegionId, attackerFaction, battle, commander: null, auto: false,
    startedAt, raidId, first }`.
  - `defenseRunFor` throws (with `err.code`) only for an impossible defense. That should not happen, because `tickFrontier`
    holds a raid at the border while 3 battles run, while its region is in another battle, or while its keep is busy.
    If it does throw, drop the raid.
- Caps the scheduler already respects:
  - at most 2 raids incoming or being fought
  - 3 battles in total
  - a 15-minute cooldown per region, counted from arrival
  - grace: the first 20 active minutes of a realm or dynasty, and fewer than 4 regions held
- `tickFrontier` reads `state.battles` to count defenses and busy regions, so keep `state.battles` in sync with the manager.
- The tutorial: do not call `tickFrontier` while the scripted tutorial must stay calm. The active clock simply does not advance.

### 3.2 Who commands a defense
In Phase 1, every unfocused or auto run uses `stewardDecide(battle, t, memo, 'captain')`, the Militia Captain.
- Pass `memo = run.battle.steward` (or `null`, which uses `battle.steward`), so it is saved with the battle.
- `'stalwart'` is the strong default for Generals in Phase 2.
- The steward never issues `retreat`.

### 3.3 When a battle ends (`'ended'`), for `run.kind === 'defense'`
| `run.battle.result` | Meaning | Call |
|---|---|---|
| `'win'` | the siege timer ran out with the keep held, or every attacker is gone (no sites, no squads) | `defenseReward(state, world, run, 'win', Date.now())` → `{ gold, renown }` |
| `'lose'` | the attacker took the keep; the region's other sites surrendered to it (the `surrender` event carries `to: attackerFaction`) | `occupy(state, world, run.regionId, run.attackerFaction, Date.now())` |
| `'retreat'` | the player abandoned the defense | the same as `'lose'`: `occupy(...)`. Hiding Retreat in defenses is recommended. |

- `defenseReward` adds the gold to `state.gold` and `stats.goldEarned` itself, drains the militia by what the siege cost, and
  counts the win. Renown is always 0 in Phase 1.
- `occupy` handles the rest of the fall:
  - moves forts, Works and the militia into `state.occupation[id]`
  - freezes prosperity (level and tenure)
  - sets the owner, nulls `conqueredAt`
  - cancels raids still marching on the region
  - restarts its cooldown
- The battle counters (`battlesWon` / `battlesLost`) are yours, as for attacks.
- For an attack win, keep calling `conquer`. When the region was occupied, the result has `retaken: true` and `renown`; the
  bounty is already the retake share; `stats.regionsConquered` is not raised; prosperity, forts, Works and a thin militia are
  restored. Crowns: call `awardCrowns` as usual (it does not re-award a region that already has crowns).

### 3.4 Starting an attack
```js
const opts = attackArenaOpts(state, world, regionId, manager.busy());   // { busy, forts? }
const arena = buildArena(world, state.owner, regionId, player, enemy, opts);
```
- A region that is another battle's target throws `err.code === 'busy'`; show "Busy". Its tiles are left out of other halos.
- A busy settlement (key `busyKey(world, settlementId)` = `"regionId:index in region.settlements"`) is left out.
- `opts.forts` is set for an occupied region: its captured Arrow Tower becomes an enemy tower site, its Walls harden the enemy keep.

### 3.5 Coming back: `resolveAway`
```js
const awayMs = now - state.lastSeen;              // read BEFORE offlineEarnings moves lastSeen
offlineEarnings(state, world, now);
const report = resolveAway(state, world, awayMs, now);
const line = awayReportText(report, world);       // "While you were away: 4 attacks repelled at Fenwall and Lowshire. Brindle was occupied by the Amber Horde: retake it."
```
- Call it on load and after a long hidden gap (the `visibilitychange` path that settles `offlineEarnings`).
- It also resolves the raids that were still marching when the game closed, and clears `incoming`.
- The rules (each has its own test in `meta.frontier.test.js`):
  - raids come at about one fifth of the live rate
  - a region can be lost only if the absence is longer than 3 h
  - at most 1 loss per 4 h, never two within 4 h of each other, and at most 2 per absence
  - never the home region
- `report = { awayMs, at, raids: [{ faction, fromRegionId, toRegionId, atMs, result: 'repelled'|'occupied', winChance }],
  repelled, lost: [regionIds] }`. It is also stored in `state.frontier.lastAwayReport`.

### 3.6 UI data
- Odds on the toast and the card: `estimateDefense(state, world, regionId, raid?, { nowMs, commander })`
  → `{ winChance, label, theirs, yours, ratio, inPerson, siegeSec, none? }`.
  - `commander` defaults to `'captain'`, the odds if the player does not go. `inPerson` is the odds if they defend it themselves.
  - Without a `raid`, the most likely raider is assumed. `none: true` means no rival can reach the region.
  - It costs about 0.1 ms.
  - `label` uses the attack labels' bands: Easy ≥ 85 %, Fair ≥ 60 %, Hard ≥ 35 %, else Deadly.
- Owned card, Fortifications panel: `fortsPanelData(state, world, id, now)`, with the same shape as `worksPanelData`.
  - Actions: `buildFort`, `upgradeFort`, `demolishFort`, which return the result or `false`, and mutate gold.
  - Copy comes from the config through `fortEffectText`, `fortName`, `fortsToast` and `FORTS.copy`.
- Occupied card: `occupationOf(state, id)` → `{ by }`. The text reads "Occupied by {faction}: Retake". `difficulty()` already
  counts the captured forts.
- Map:
  - `fortsMarksData(state, world)` → `[{ regionId, occupiedBy, forts, towerTile, keepTile }]`, for the tower and wall-ring
    structures, in the occupier's colour when `occupiedBy` is set
  - the marching war bands come from `state.frontier.incoming`

## 4. Things that differ from attack battles
- **Site 0 of a defense arena is the ENEMY war-band camp** (`arena.campSite === 0`, owner = the attacker).
  - There is no player camp. `arena.keepSite` is the player's keep.
  - Anything that assumes `sites[0]` is the player's camp (tutorial arrow, HUD, camera) must check `battle.mode === 'defense'`.
- `battle.mode === 'defense'` and `battle.siegeSec` are set. Show the siege countdown ("Hold 1:12") instead of Swift.
  Crowns are for attacks only.
- New site fields:
  - `defMult` (Walls). `site.def` already includes it; `scenes/battleThreat.js` should multiply by `siteDefence(site)` from
    `combat.js` instead of the type's defence.
  - `fort: 'tower'` with `range` and `volleySec` (an Arrow Tower fortification, `settlement: -1`).
  - `pCapMult` (the militia cap).
- `arena.playerSpeedMult` (a Beacon) is already applied to `battle.player.speed`.
- The `surrender` event of a lost defense has `to` (the attacker). The sim has already flipped the sites, as for a won attack.
- `battle.steward` holds the steward's memo (plain JSON).

## 5. Numbers worth knowing
All numbers live in `config/frontier.js`:

| Number | Value |
|---|---|
| Telegraph | 45 s, +20 or +40 s with a Beacon |
| Siege timer | 90–150 s by tier |
| Militia refill | empty to full in 8 min |
| Fortification slots | 2 per region, 3 at Prosperity II |
| Fortification cost | about two Works' price, by depth (FORTS.cost.base 120) |
| Defense won | 50 % of a conquest bounty |
| Retake | 50 % of a conquest bounty |
