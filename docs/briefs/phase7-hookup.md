# Phase 7 (Boons and Relics): hookup for integration

Source: `docs/PLAN-PHASE7.md` (§7A, §7B, §7C and the Contract). Written by the sim/meta engineer; integration applies it.
Everything below is pure and deterministic; every number and line of copy lives in config. **Integration does no maths:**
`boonMods(state)` is read by the meta and sim functions themselves (battle stats, the card, income, bounty, raids, scouting, Vendettas).

| File | What |
|---|---|
| `game/config/boons.js` | `BOON_NEUTRAL` (every modifier, documented), `BOON_LIST` (24), `DUO_LIST` (4), `BOONS` (draft numbers, frames, copy) |
| `game/config/relics.js` | `RELIC_LIST` (8), `RELICS` (placement numbers, copy) |
| `game/meta/boonsState.js` | the leaf: records, sanitizers, `boonMods`, `boonSimStats` |
| `game/meta/boons.js` | the draft, picks, rerolls, info and copy |
| `game/meta/relics.js` | placement, claim, the Reliquary, map and card helpers |
| `game/battle/boons.js` | the sim side (called by `step()` itself), plus `pausedCooldownTick` for the Sundial |

---

## 1. State (sanitised by `save.js`; an old save loads with no Boons, no Relics owned, an empty Reliquary)

| Field | Lifetime | Shape |
|---|---|---|
| `state.boons2` | per dynasty | `{ v:1, owned: [boonId], pending: { choices: [boonId x1-3], source: 'battle'\|'champion', missed? } \| null, draws, champEyeUsed, conquests }` |
| `state.relics` | per dynasty | `{ v:1, seed, placed: { [regionId]: relicId }, owned: [relicId] }` |
| `state.generals.reliquary` | LIFETIME (rides with the roster, like the Deeds) | `{ v:1, found: [relicId] }` |

- Additions to the written contract: `boons2.conquests` (Tithe's counter), `relics.seed` (the world seed the Relics were placed for).
- `createGame` / `resetRegions` / `foundDynasty` reset `boons2` and `relics` and **place the Relics**; the Reliquary is kept.
  Settings > Reset (`keepGenerals: false`) wipes the Reliquary with the roster.
- **On load / import, call `syncRelics(state, world)` once after the world is generated** (stateContainer lines ~40 and ~128). It
  places the Relics for a save from before Phase 7 (only on regions not yet owned) and does nothing otherwise. `conquer` also calls it,
  so forgetting it only delays the map glints.

## 2. The conquest and the draft

```js
import { conquer } from '../meta/progression.js';
const result = conquer(state, world, regionId, Date.now(), { viaBattle: true, labelAtAttack: run.labelAtAttack });   // battles.js finish, attack WON in battle
```

- **Pass `{ viaBattle: true, labelAtAttack: run.labelAtAttack }` from `app/battles.js` (line ~259) for an attack won in battle.**
  Only wins that matter draft (`BOONS.draftLabels` etc., `winDrafts(region, label)` in meta/boons.js): the card read Fair, Hard or
  Deadly when the attack began, or the region is typed (Gold Mine, Monastery, Bandit Hold, Ruins, the Lair) or a capital. An Easy win
  drafts nothing. Without `labelAtAttack`, `conquer` falls back to the card's label at the moment of the win. Nothing else drafts: a surrender, a
  Quick Conquest (`meta/quick.js` never passes it) and a retake-by-surrender do not. Boons unlock from the win after the first conquest
  (the Bounty Board's moment, never the tutorial fight) and from the first win in any later dynasty: `boonsUnlocked(state)`.
- New fields on the result:
  - `boonOffer: boonId[]` a draft was made (state.boons2.pending is set). `boonMissed: true` when it replaced an unpicked offer:
    toast `BOONS.copy.missed`.
  - `relic: { id, name, icon, text, newFind, renown, deeds }` the Relic in that region was claimed (also on a surrender or a Quick
    Conquest). `newFind`: first time ever (the Reliquary moment). `deeds`: Reliquarian tiers newly earned (they are also queued for
    `drainDeedNews` as usual).
  - `tithe: n` Renown from Tithe (already added into `result.renown`, like the Relic's).
- `defenseReward(...)` of a **Vendetta win** may return `boonOffer` too: the Champion's eye (once per dynasty, Rare or better).

```js
import { pendingBoons, pickBoon, rerollBoons, rerollBoonsInfo, boonInfo, ownedBoons, duoInfo, boonsUnlocked, allBoons } from '../meta/boons.js';
pendingBoons(state)       // -> { choices: BoonInfo[], source: 'battle'|'champion', missed } | null   (the draft cards and the "Boon pending" chip)
// BoonInfo = { id, name, rarity: 'common'|'rare'|'legendary', cursed, icon, text, frame: 'bronze'|'silver'|'gold'|'crimson' }
pickBoon(state, id)       // -> { ok: true, boon: BoonInfo, duo?: DuoInfo } | { ok: false, reason: 'none'|'notOffered' }
                          //    `duo` = a Duo this pick completed: the reveal moment (BOONS.copy.duo)
rerollBoonsInfo(state)    // -> { cost, can }   the button: BOONS.copy.reroll with {cost}
rerollBoons(state, world) // -> { ok: true, cost, choices } | { ok: false, cost, reason: 'none'|'renown'|'empty' }   (spends the Renown)
ownedBoons(state)         // -> BoonInfo[] in pick order (the owned strip)
duoInfo(state)            // -> [{ id, name, icon, parts: [boonId, boonId], text, active, have: [boonId] }]   all 4, for tooltips
```

- `rerollBoons` takes `world` (an addition to the contract's `rerollBoons(state)`) so Boons that cannot matter on this continent stay
  out (no Night Raiders without a Night region left, no Gravebreaker without the Ashen, ...).
- The skip: leave `pending` as it is; the chip reopens it (`pendingBoons`). A pending offer survives save and reload.
- The frame key (`frame`) is chosen for you: cursed Boons get `'crimson'` whatever their rarity (show the rarity word too:
  `BOONS.copy.rarity[rarity]`, and `BOONS.copy.cursed`).
- Icons named in config (new ones in **bold**): **boot**, tower, coin, **horn**, wheat, **moon**, laurel, banner, map, **chest**,
  **dice**, flame, flag, swords, castle, dragon, skull, **heart**, shield, **drop**, crown, star, throne, trophy, **bolt**; Relics add
  **clock** (exists), **eye**, **lantern**. Map any you already have under another name; the names are only keys.

## 3. Every battle that ends: `boonBattleEnd`

```js
import { boonBattleEnd } from '../meta/boons.js';
const { plunder, goldLost } = boonBattleEnd(state, world, run.battle, result);  // result: 'win' | 'lose' | 'retreat'
```

Call it **once for every run that ends** (attack or defense, win, loss or retreat), in `battles.js` next to `conquer` / `defenseReward`.
Plunderers pay gold per settlement captured (`battle.stats.captured`); Fortune Favours takes a share of the gold after a loss or a
retreat. Toast `+N gold (Plunderers)` / `−N gold (Fortune Favours)` when non-zero. `finishQuickConquest` already calls it
(`out.boons`).

## 4. Relics on the map and the card

```js
import { relicsOnMap, relicAt, relicInfo, relicLine, reliquary, ownedRelics, relicOnFrontier, syncRelics } from '../meta/relics.js';
relicsOnMap(state)          // -> [{ regionId, relicId }]   the glinting chests (unclaimed only)
relicAt(state, regionId)    // -> relicId | null
relicInfo(id)               // -> { id, name, icon, text }
relicLine(state, regionId)  // -> "Relic: Sundial. Power cooldowns keep ticking ..." | null   (the region card, before you commit)
reliquary(state)            // -> { found, total, items: [{ id, name, icon, text, found, owned }] }   the Realm panel grid
                            //    (an unfound item: show RELICS.copy.unknown and a silhouette; RELICS.copy.found with {n} {total})
ownedRelics(state)          // -> RelicInfo[] held this dynasty (next to the owned Boons strip)
relicOnFrontier(state, world) // -> regionId | null   the tutorial hint "a Relic on the frontier"
```

Relics are placed only on regions of tier 2+ (never the tutorial ring), Ruins first, never a capital or the Lair. Placement prefers
Relics not yet in the Reliquary. The Gravewarden's Lantern only appears where the Ashen hold land; the Black Pennant not under Peace of
the Crowns.

## 5. Battle events (from the manager's `'events'` stream)

| Event | Payload | Show |
|---|---|---|
| `boonTriggered` | `{ boon, x, y, site?, squad?, count?, until?, radius?, sites? }` | a small icon pop (the Boon's `icon` from `boonInfo` / `duoInfo` / `relicInfo`) at x, y, with `+count` where given |

`boon` values that fire: `warlordsMark` (count = troops added, at the source), `turncoats` / `ghostLegion` (count joined the captured
site), `hitAndRun` (until), `lightningWar`, `bloodPrice` (count bled across your sites), `plunderers` (at the captured site; the gold is
paid at the end, §3), `secondWind` (count), `scorchedEarth` (x, y, radius in hexes, until: draw the burning ground like the Firestorm's),
`fireArrows` (throttled to once per 2 s per tower), `martyrsCrown` (sites, until), `bannerBearer` (the ability is ready again: pulse the
ability button). Events are kept small on purpose: no per-tick spam.

Battle state (plain JSON, saved with the battle, created lazily): `battle.boonFx = { scorch: [{ x, y, r, until, dps }], sent,
secondWind, martyrUntil, martyrDone, recharge, gap }` and `squad.burn = { until, dps }` on a burning squad. **The Boon numbers ride in
`battle.player.boons`** (only the non-neutral keys; absent with no Boons), so a battle resumes with exactly the Boons it started with.

- `abilityState(battle)` already counts Banner Bearer's recharge (`ready` turns true again 60 s after the last use; `uses` / `left`
  include it once it is ready).

## 6. The Sundial Relic (the one thing the manager must drive)

```js
import { pausedCooldownTick } from '../battle/boons.js';
// in battles.js tick(dtSec) while `paused` (or while a battle-entry camera flight runs), for each run:
pausedCooldownTick(run.battle, dtSec * speed);   // no-op (returns false) unless battle.player.boons.sundial
```

## 7. §7C: Firestorm burning ground after a reload (already in battle state)

Nothing new is needed from sim/meta: the Ashen burning ground is **already saved** in `battle.fallen.burns = [{ x, y, r, until }]`
(`r` in world units, `until` in battle seconds; `battle/fallen.js` creates it on every player Firestorm, Ashen or not). After a reload,
redraw each entry with `until > battle.t`. Scorched Earth's ground is `battle.boonFx.scorch` (same shape plus `dps`).

## 8. Where to call what (summary)

| Moment | Call |
|---|---|
| Load / import | `syncRelics(state, world)` after `generateWorld` |
| Attack won in battle | `conquer(state, world, regionId, now, { viaBattle: true, labelAtAttack: run.labelAtAttack })`; read `boonOffer`, `boonMissed`, `relic`, `tithe` |
| Any run ends | `boonBattleEnd(state, world, run.battle, result)` |
| Vendetta won | `defenseReward(...)` may carry `boonOffer` (the Champion's eye) |
| Result card / chip | `pendingBoons`, `pickBoon` (duo reveal), `rerollBoonsInfo`, `rerollBoons(state, world)` |
| War Council / Realm strip | `ownedBoons`, `duoInfo`, `ownedRelics` |
| Map / card | `relicsOnMap`, `relicLine`; the claim moment from `result.relic` |
| Realm panel | `reliquary(state)`; the Reliquarian deed is in `deedProgress` like the others |
| Battle events | `boonTriggered` |
| Paused / entry flight | `pausedCooldownTick(run.battle, dt)` |
| Tutorial | first `result.boonOffer`; `relicOnFrontier(state, world)` |

## 9. Tools (sim/meta)

- `node tools/campaign.mjs --dynasties=3` picks Boons heuristically (highest rarity; Cursed only after 5 straight wins; never
  rerolls; `--boons=off` skips drafts), prefers regions holding a Relic (x1.4 value) and claims them by conquering (`--relics=off`
  clears them: the pre-Phase-7 baseline). `--boonForce=<id>` grants one Boon at each dynasty start (the per-Boon sweep);
  `--boonReport` prints win rate and battle time with / without each Boon.
- Pacing (12 seeds, D1-D3): D1 1.13 h, D2 1.39 h, D3 1.24 h, no wait over 40 min. To get there `UPGRADE_COST_MULT` went 1.2 -> 1.5
  (config/meta.js): upgrade prices in the War Council are 25% higher than in Phase 6 (any UI copy quoting prices is read from config).
