# Phase 6 (The Ashen Host + rival rotation): hookup for integration

Source: `docs/PLAN-PHASE6.md` (§6A–6C and the Contract). Written by the sim/meta engineer; integration applies it.
Everything below is pure and deterministic; every number and line of copy lives in config. **Integration does no maths.**

| File | What |
|---|---|
| `game/config/world.js` | `FACTIONS[5]` = the Ashen Host (`personality: 'undying'`, `emblem: 'skullCrown'`). **Colour fields are placeholders: integration edits only `color`, `colorDark`, `colorLight`.** |
| `game/config/ashen.js` | `ASHEN` (faction id, The Fallen Rise, war-band growth, the Barrow Keep Rising, copy), `RIVALS` (the rotation) |
| `game/meta/rivals.js` | `rivalsFor`, `rivalsOf`, `rivalsInWorld`, `isRivalPresent`, `ashenOnFrontier`, `fallenLine` |
| `game/battle/fallen.js` | the sim side (called by `step()` itself; nothing to call from the UI) |
| `game/config/generals.js` | the Gravewarden kind (`gravewarden`), its ability `raiseFallen`, skills, names, recruit line |
| `game/config/leaders.js` | `LEADERS[5]` (the Pale Margrave) and `LEADER_LINES[5]` (every trigger) |

---

## 1. State

| Field | Lifetime | Shape |
|---|---|---|
| `state.rivals` | per dynasty (set by `foundDynasty`) | `number[3]`: the faction holding rival sector 0, 1, 2 |

- `createGame` sets `[2, 3, 4]`. A save without it (or with junk) sanitises to `[2, 3, 4]`, so **an in-progress D2+ save keeps its
  classic rivals** (the world is regenerated from the seed on every load, so the rivals must be stored, not re-derived).
- `foundDynasty(...)` sets `next.rivals = rivalsFor(newSeed, next.dynasty.level)`. Nothing for integration to do.

## 2. World generation: nothing new to pass

`worldOptsFor(state)` (meta/edicts.js) now also returns `rivals` whenever they are not the classic three. `stateContainer.js` already
calls `generateWorld(seed, worldOptsFor(state))` at boot, founding and import, so **no change is needed there.**

- Dynasty 1 (and any classic line-up) is byte-identical to before (`world.factions` still has 5 entries; a test proves it).
- With the Ashen present, `world.factions` has 6 entries (index = faction id). A rival that is **not** on this continent keeps its
  entry with `capitalRegion: -1` and `absent: true`; it owns no region. Never assume `world.factions[2..4]` are all on the map: use
  `rivalsInWorld(world)` (ids of the rivals that hold land, in id order) or `isRivalPresent(world, id)`.
- Map shapes are unchanged: only which faction holds each of the 3 sectors changes.

## 3. The Ashen Host on the map and the card

```js
import { ASHEN } from '../config/ashen.js';
import { ashenOnFrontier, fallenLine } from '../meta/rivals.js';
const d = difficulty(state, world, regionId, { commander });   // unchanged call
d.mechanic        // 'fallen' for a region held by an 'undying' faction (else undefined)
fallenLine(state, world, regionId)  // the card line, e.g. "The Fallen Rise: 20% of your losses join their garrison" (null otherwise)
ashenOnFrontier(state, world)       // a frontier region held by the Ashen, or null: the tutorial hint's trigger
ASHEN.copy.hint                     // "The Fallen Rise: your losses join them. Strike decisively, or burn the dead with Firestorm."
```

The card's win chance already includes The Fallen Rise (the `undying` personality factor is measured from bot fights in which the
mechanic is live). The label is honest without any extra UI maths.

## 4. Battle events (read them from the manager's `'events'` stream, like every other battle event)

| Event | Payload | Show |
|---|---|---|
| `fallenRose` | `{ site, count, owner, x, y, kind }` | wisps rising from the fallen into `site`'s garrison and a "+N risen" pop on its badge. `kind`: `'fallen'` (your losses joined an Ashen settlement), `'warBand'` (an Ashen war band grew from defenders it killed; `site` is the assault's site, the troops joined the assaulting squads), `'gravewarden'` (the Gravewarden passive: enemy dead joined YOUR settlement, `owner: 0`) |
| `fallenBurned` | `{ site, count, x, y }` | ember wisps instead: Firestorm burned the dead (no rise) |
| `rising` | `{ site, at, x, y, radius }` | the Barrow Keep's ash-ring telegraph around `site` (the keep), `at` = battle time the squad emerges (3 s later), `radius` in hexes |
| `risingCancelled` | `{ site, x, y }` | Firestorm on the keep cancelled this Rising: snuff the ring |
| `send` with `rising: true` | the usual `send` payload | the risen squad emerging from the keep (an ordinary enemy squad from then on) |
| `ability` with `ability: 'raiseFallen'` | `{ target: siteId, count }` + the usual fields | the Gravewarden's effect at `target` (the troops have already joined that site) |

`count` is a whole number. Events fire once a whole troop has risen at a site, so a long assault produces a steady trickle of pops.

The Firestorm exception: none rise from troops killed at a settlement inside a Firestorm's area for `ASHEN.fallen.burnSec` seconds
after it lands (the burning ground). The UI may draw that lingering burn using the `firestorm` event it already receives
(`{x, y, radius}`) plus `ASHEN.fallen.burnSec`.

Battle state (plain JSON, saved with the battle, created lazily): `battle.fallen = { acc, burns, losses, rising }`. `save.js` keeps
it as-is (battles are saved whole); nothing to sanitise beyond what already happens to `battle`.

## 5. The Gravewarden

- Recruited through the existing capital-topple path: conquering the Barrow Keep returns `result.recruited = 'champion:5'`, exactly
  like the other champions. Show the existing recruitment card; the line is `GENERALS.copy.recruitLines.gravewarden`.
- `kind: 'gravewarden'`, `title: 'Gravewarden'`, `style: 'stalwart'`, emblem key = the kind. `passiveText` / `abilityText` /
  `skillText` already produce its copy; `abilityState(battle)` reports `{ id: 'raiseFallen', needsTarget: false }`: the HUD button
  issues `{ type: 'ability', owner: 0, ability: 'raiseFallen' }` with no target.
- If the Ashen are not on this continent their General can't be recruited this dynasty (no Barrow Keep to topple). The roster persists.

## 6. The Pale Margrave

`leaderFor(seed, dynasty, 5)` → `{ title: 'Margrave', name: 'Osric', fullName: 'Margrave Osric the Pale' }` (the epithet rides only in
`fullName`). Every trigger has lines; speak them through the existing `services.speak(trigger, 5, ...)` calls, which are generic.
Vendetta: `championTitle(faction)` (meta/leaders.js) gives the Champion's name for the Vendetta banner: `'Barrow Knight'` for the
Ashen, `'Champion'` for the others.

## 7. QA pointers

- Meet the Ashen in D2: `__hd.completeRealm()` then found. `rivalsFor(seed, 2)` always contains 5.
- Force a quick look in the console: `generateWorld(seed, { dynasty: 2, rivals: [5, 3, 4] })`.
- A rise: attack an Ashen region and over-send into a big garrison. A Firestorm on that settlement just before the assault lands:
  `fallenBurned` instead of `fallenRose`.
