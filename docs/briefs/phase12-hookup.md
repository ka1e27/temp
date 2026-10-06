# Phase 12 (The Sea Kings): hookup for integration

Source: `docs/PLAN-PHASE12.md` (§12A-§12C and the Contract). Written by the sim/meta engineer; integration applies it.
Everything below is pure and deterministic; every number and line of copy lives in config. **Integration does no maths.**

| File | What |
|---|---|
| `game/config/sea.js` | every Phase 12 number: `SEA_FACTION` (6), `ARCHIPELAGO`, `FORD`, `HARBOUR`, `LANE`, `TIDE`, `BROADSIDE`, `RAIDER_AI`, `SEA.copy` |
| `game/config/world.js` | `FACTIONS[6]` = the Sea Kings (`personality: 'raider'`, `emblem: 'trident'`). **Colours are placeholders: integration edits only `color`, `colorDark`, `colorLight`** (check them with the a11y tooling) |
| `game/world/archipelago.js` | `archipelagoFor`, `applyArchipelago` (generation), `isOpenSea`, `touchesOpenSea`, `seaPath`, `quayTile`, `regionHarbours` |
| `game/meta/rivals.js` | `rivalsFor(seed, level, { archipelago })`, `archipelagoFor`, `seaLines`, `laneLine`, `fordsOnFrontier` |
| `game/battle/seaArena.js` | the arena side: coastal sites, harbours, quays, lanes, the Tide's tiles (nothing to call: buildArena / buildDefenseArena do it) |
| `game/battle/sea.js` | the sim side: lane routes, the Tide, sea reinforcements, Broadside (called by `step()` itself) |
| `game/config/generals.js` | the Admiral kind (`admiral`), its ability `broadside`, skills, names, recruit line |
| `game/config/leadersSea.js` | `LEADERS[6]` (the Sea Queen) and `LEADER_LINES[6]` (every trigger), folded into `config/leaders.js` |

---

## 1. State

| Field | Lifetime | Shape |
|---|---|---|
| `state.archipelago` | per dynasty (set by `foundDynasty`) | `boolean`; `createGame` sets `false`, a save without it sanitises to `false` |

- `foundDynasty` sets `next.archipelago = archipelagoFor(newSeed, level)` (a seeded 1-in-3 from dynasty 3) and
  `next.rivals = rivalsFor(newSeed, level, { archipelago })`: **on an archipelago the Sea Kings (6) always take one sector**; a land
  continent never has them (its line-up is exactly Phase 6's).
- `worldOptsFor(state)` adds `archipelago: true` when set, so `stateContainer.js`'s existing `generateWorld(seed, worldOptsFor(state))`
  calls need **no change**.
- `world.factions` has 7 entries only when 6 is in the line-up (else Phase 6's shape). As before, use `rivalsInWorld(world)`.

## 2. The world (generate.js): what to draw

`world.archipelago` is **absent on a land continent** (every land world is byte-identical to Phase 11; a test proves it). On an archipelago:

```js
world.archipelago = {
  islands: number[][],      // region ids per island; island 0 holds the start region and is the largest
  harbours: number[],       // settlement ids of the ports (1-2 per island), ascending
  seaLanes: [{ id, a, b, tiles, cost }],  // a lane between two ports (settlement ids) of different islands
  fords: number,            // how many ford tiles
};
region.island      // its island index (archipelagos only)
settlement.harbour // true on a port
tile.ford          // true on a ford tile
```

- **Ford tiles** (`tile.ford`): the straits between islands. `terrain: 'ford'`, `land: false`, `passable: true`, `elev: 0`,
  `cost: 2.5`, `coast: 0`, and they **keep their `region`** (region adjacency and arenas are unchanged in shape). Draw them as sandbars /
  shallow water. Land tiles' `coast` masks are rebuilt, so the shoreline against a ford is a coast. A road across a strait keeps its
  `road` bits (draw a causeway, or nothing); `river` bits end at the strait. Note: `region.tiles` can now include non-land (ford) tiles.
  `TERRAIN_COST.ford` exists for any lookup by terrain.
- **Harbours**: draw a quay/boats on `settlement.harbour` settlements.
- **Sea lanes** (`world.archipelago.seaLanes`): `tiles` are open-sea tile indices from port `a`'s side to port `b`'s. Draw as dotted
  coastal arcs. `cost` is LANE.tileCost per tile.
- **Quays**: `quayTile(world, regionId)` gives the tile where a coastal region WITHOUT its own harbour gets a harbour site in battle (a
  jetty may be drawn there on the map too); null otherwise.
- `isOpenSea(tile)` (water that is not a ford) and `touchesOpenSea(world.tiles, i, world.cols, world.rows)` are the shared tests.

Ceremony line (PLAN 12A): `SEA.copy.ceremony` (`{house}`, `{n}` = `world.archipelago.islands.length`) when the new world has
`world.archipelago`.

## 3. The Sea Kings on the map and the card

```js
import { seaLines, laneLine, fordsOnFrontier } from '../meta/rivals.js';
const d = difficulty(state, world, regionId, { commander });  // unchanged call
d.mechanic              // 'sea' for a region held by a 'raider' faction (as 'fallen' is for the Ashen)
seaLines(state, world, regionId)  // string[]: fords ("Fords: 6 shallow crossings at ×2.5 march cost"), harbour, the Tide (on the
                                  // Tide Fortress), the raider line. [] on land / for your own region. Show for ANY archipelago region.
laneLine()              // "Sea lanes: your harbours sail troops at ×0.6 march cost" (Codex, the hint)
fordsOnFrontier(state, world)     // a frontier region with fords, or null: the first-fords tutorial hint's trigger
SEA.copy.hint           // the tutorial hint text
```

The card's win chance includes fords (`DIFFICULTY.fordWeight`), the quay site, the Tide Fortress (`DIFFICULTY.tideCapital`) and the
raider personality factor. Intel's personality line: `INTEL.personalityLines.raider`.

**Raids:** a raider's raid on a coastal region comes by sea: `raid.landing === true` (on `state.frontier.incoming` entries and the
announced raid). Draw boats from the sea to the region instead of a march from `fromRegionId`; the defense arena's camp stands on the
region's coast (at its harbour when it has one) and `arena.landing === true`.

## 4. Battles: what is new in the arena and the battle

Sites (on `battle.sites`, archipelagos only): `site.coastal` (touches open sea), `site.port` (a harbour: holding one opens the lanes).
A quay is a site of `type: 'harbour'` (`SITE_TYPES.harbour`), `feature: 'harbour'`, `port: true`.

Arena tiles: `tile.ford` on fords (cost 2.5 already in `tile.cost`).

`arena.sea` (absent on land):

```js
arena.sea = {
  lanes: [{ a, b, tiles, cost }],   // between two coastal sites (site ids); tiles = sea tile indices a -> b
  seaTiles: [{ i, q, r, x, y, cost, terrain: 'sea', sea: true }], // every tile a lane uses (getRuntime indexes them; NOT arena.tiles)
  tide?: { site, harbour, tiles, keepTroops },   // the Tide Fortress: keep site id, its harbour site id (or null), flooding tile indices
};
```

**Lane rule.** `routeFor(battle, owner, from, to)` returns a lane route (`route.lane === true`, `route.points` along the sea) when it is
cheaper than the land route. A lane is usable only between two sites the owner holds, while it holds a harbour; for the player both
ends must be harbours (`port`); the Sea Kings' longships sail between any two coastal sites they hold. **Drawing lanes in battle:** draw
`arena.sea.lanes` whose ends you hold (and `holdsPort`), and a send preview with `route.lane` as a dotted arc. A squad on a lane has
`squad.lane === true` (its `send` event has `lane: true`); its path tiles are sea tiles (positions come from `squadPosition` as usual).
Lane squads never clash; towers on the coast shoot them (the Admiral's passive stops that).

| Event | Payload | Show |
|---|---|---|
| `send` with `lane: true` | the usual `send` payload | a boat on the lane |
| `tideRising` | `{ site, at, tiles, x, y, radius }` | the rising-water telegraph on `tiles` (4 s ahead; `at` = flood time) |
| `tideFlood` | `{ site, until, tiles, x, y }` | the flood on `tiles` until `until` |
| `tideEbb` | `{ site }` | the water draining away |
| `tideHit` | `{ squad, owner, lost, x, y }` | a squad caught on a flooded tile lost 30% ("−N" pop, splash) |
| `seaReinforce` | `{ site, to, count, x, y }` | a boat lands `count` troops at the fortress's keep (`to`) from its harbour `site` |
| `ability` with `ability: 'broadside'` | `{ sites }` + the usual fields | cannon smoke over every coastal enemy site in `sites` |
| `broadsideHit` | `{ site, count, x, y }` | whole troops lost to Broadside (a small pop per site, once a troop has gone) |

The Tide floods `arena.sea.tide.tiles`: the tidal ground (fords, and land touching open sea or a ford) on the approach routes to the
Gate and the keep within 5 hexes of the keep, plus that within 2 hexes of it. So it lies across the attack path: draw the telegraph ring
on exactly those tiles. It floods for 10 s every 40 s (first at 40 s); the fortress's own squads and lane squads are spared; holding the fortress's
harbour site stops `seaReinforce` (a boat every 20 s brings 8 s of the keep's growth). The Tide ends when the keep falls. Battle state
(plain JSON, saved with the battle, lazy): `battle.sea = { tide, reinforceAt, broadside, drowned?, landed? }`; `drowned` (troops the
Tide took) and `landed` (troops the boats brought) are tallies a results screen may show.

## 5. The Admiral

- Recruited through the existing capital-topple path: toppling the Tide Fortress (the Sea Kings' capital) returns
  `result.recruited = 'champion:6'`. Show the existing recruitment card; line `GENERALS.copy.recruitLines.admiral`.
- `kind: 'admiral'`, `title: 'Admiral'`, `style: 'swift'`, emblem key = the kind. Passive (`laneShield`): "Your squads sailing sea lanes
  take no tower fire". `abilityState(battle)` reports `{ id: 'broadside', needsTarget: false }`: the HUD button issues
  `{ type: 'ability', owner: 0, ability: 'broadside' }`. `passiveText` / `abilityText` / `skillText` already produce its copy.
- No Sea Kings on the continent: no Tide Fortress to topple this dynasty. The roster persists.

## 6. The Sea Queen

`leaderFor(seed, dynasty, 6)` -> `{ title: 'Queen', name, fullName: 'Queen Halvor of the Grey Tide' }`. Every trigger has lines; the
existing `services.speak(trigger, 6, ...)` calls are generic. `championTitle(6)` = `'Reaver Captain'` (the Vendetta banner).

## 7. Content

- **Boons** (archipelago drafts only; `requires: 'archipelago'`): Navigator (`icon: 'helm'`), Privateers (`anchor`), Harbour Chain
  (`chain`). Privateers' gold rides on `boonBattleEnd(...)` as `out.privateers` (present only when it paid).
- **Relics** (archipelago only): the Astrolabe (`icon: 'astrolabe'`), the Drowned Crown (`drownedCrown`). The Reliquary total is now 14.
  **The Drowned Crown is never placed on the map** (`wreckOnly: true`): only a Shipwreck's search gives it up (it is the wreck's first
  find). Placed, the campaign claimed it before the Tide Fortress on 8 of 12 archipelagos and the Tide never touched anyone.
- The Admiral's skill `laneFast` sets `PlayerStats.laneSpeedMult`; Harbour Chain sets `PlayerStats.boons.laneSpeedMult` (both: lane squads only).
- **Event: Shipwreck** (archipelagos only; `EVENTS.copy.titles.shipwreck`, text `ev.text`). Accept with `{ choice: 'salvage' }` (pays
  `ev.gold`) or `{ choice: 'leave' }` (a `ev.relicChance` roll; `result.relic` is a claimRelic-shaped object or null: show the Relic
  claim card when present). Buttons: `EVENTS.copy.shipwreckSalvage`, `EVENTS.copy.shipwreckLeave`. Declining does nothing.

## 8. Icons wanted

`trident` (the faction emblem), `admiral` (the General's emblem), `broadside` (the ability button), `helm`, `anchor`, `chain` (Boons),
`astrolabe`, `drownedCrown` (Relics), `shipwreck` (the event), plus map art: sandbar fords, harbours/quays, boats on lanes, landing boats.

## 9. QA pointers

- Force an archipelago in the console: `generateWorld(seed, { dynasty: 3, archipelago: true, rivals: [2, 6, 4] })`.
- In a save: set `state.archipelago = true; state.rivals = [2, 6, 4]` at dynasty 3+ and reload (the world is regenerated from them).
- `archipelagoFor(seed, 3)` is true for about a third of seeds: scan seeds for a natural one.
- The Tide: attack the Sea Kings' capital and park a squad on a ford near the keep around t = 40 s.
