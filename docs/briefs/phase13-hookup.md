# Phase 13 (The Crown of Ages): hookup for integration

Source: `docs/PLAN-PHASE13.md` (§13A-§13C and the Contract). Written by the sim/meta engineer; integration applies it.
Everything below is pure and deterministic; every number and line of copy lives in config. **Integration does no maths.**

| File | What |
|---|---|
| `game/config/crown.js` | `USURPER_FACTION` (7), `CROWN` (the continent + copy), `USURPER_AI`, `THRONE` (the battle's numbers), `ENDING` (scroll copy, credits) |
| `game/config/ascension.js` | `ASCENSION`: the ladder (10 levels, `name`, `icon`, `mods`, `text`), the Legacy reward, copy |
| `game/config/leadersUsurper.js` | `LEADERS[7]` (the Usurper-King), `LEADER_LINES[7]` (every trigger) and `THRONE_LINES` (the battle's own moments) |
| `game/config/world.js` | `FACTIONS[7]` = the Usurper (`personality: 'usurper'`, `emblem: 'crownChains'`). Integration owns `color`, `colorDark`, `colorLight` |
| `game/world/crown.js` | generation: `crownRivals`, `applyCrownFactions`, `crownIslands` (nothing to call: `generateWorld` does it) |
| `game/battle/throne.js` | the Throne of Ages in the sim (nothing to call: `buildArena` / `createBattle` / `step` do it) |
| `game/meta/crown.js` | `crownOfAgesAvailable`, `isThrone`, `throneLines`, `usurperOnFrontier`, `endingRecord`, `crownLine`, `ascensionInfo` |
| `game/meta/ascension.js` | `ascensionMods`, `ascensionLevel`, `ascensionHighest`, `isCrowned`, `maxAscensionChoice`, `ascensionLegacyMult` |

---

## 1. State

| Field | Lifetime | Shape |
|---|---|---|
| `state.crownOfAges` | per dynasty (set by `foundDynasty`) | `boolean`; `createGame` sets `false`; a save without it sanitises to `false` |
| `state.ascension` | per dynasty (set by `foundDynasty`) | `0..10` (0 = none) |
| `state.generals.crowned` | lifetime | `{ v:1, year, dynasty, t, times }` or absent: the FIRST crowning (Year, dynasty, ms), `times` = Thrones toppled |
| `state.generals.ascension` | lifetime | `{ v:1, highest }` or absent: the highest Ascension level cleared |
| `state.generals.reign` | lifetime | `{ v:1, edicts: [{ d, id }] }`: every dynasty's Edict (the ending scroll lists them; older dynasties of an old save are unknown) |

- `worldOptsFor(state)` adds `crownOfAges: true` (and the stored `rivals`), so `generateWorld(seed, worldOptsFor(state))` in
  `stateContainer.js` needs **no change**.
- The founding: `foundDynasty(state, newSeed, world, currentWorld, { edict, challenges, legacyBuys, crownOfAges, ascension })`.
  - `crownOfAges: true` is honoured only when `crownOfAgesAvailable(state)` (the founding makes dynasty 7 or later, not in a challenge).
  - `ascension: n` is clamped to `0..maxAscensionChoice(state)` (0 until the first crowning; then up to one above the highest cleared).
  - `next.founding` (the non-saved report) gains `crownOfAges` and `ascension` (what was actually applied).

## 2. The ceremony

```js
import { crownOfAgesAvailable, ascensionInfo } from '../meta/crown.js';
import { CROWN } from '../config/crown.js';
crownOfAgesAvailable(state)   // show the extra choice "Seek the Crown of Ages" (CROWN.copy.choice, CROWN.copy.choiceText)
ascensionInfo(state)          // { unlocked, level, highest, maxChoice, legacyMult, mods, ladder: [{ level, name, icon, text, cleared, current, open }], copy }
```
- The picker offers 0..`maxChoice` (only when `unlocked`). `ASCENSION.copy.locked` while locked.
- Ceremony line when the new world has `world.crown`: `CROWN.copy.ceremony` (`{house}`).
- Founding after an Ascension dynasty pays `legacyMult` x the Legacy points (already inside `legacyPointsForFounding`, so the
  ceremony's Legacy preview is right with no extra maths).

## 3. The Crown of Ages continent

`world.crown = { throne, usurper: regionId[], seaKings: regionId[] }` (absent on every other world; every other world kind is
byte-identical, proved by `tools/_p13digest.mjs` and a test). On the Crown continent:
- `world.factions` has 8 entries (index = id). Rivals on the map: two classic factions, the Ashen Host (5), the Sea Kings (6), the
  Usurper (7). Use `rivalsInWorld(world)` as always. `world.rivals` = the three sector rivals (two classic + 5).
- `world.archipelago` is set (the Sea Kings' coast is cut into 1-2 islands; island 0 is the mainland): everything Phase 12 draws
  (fords, harbours, lanes, landing raids, Shipwrecks) works unchanged.
- `region.throne === true` on the Throne of Ages (also `region.isCapital`, twist `siege`).
- Card: `difficulty(...).mechanic === 'throne'` for a Usurper region; `throneLines(state, world, regionId)` -> string[] (the Throne's
  line first, then the Usurper's habit). Intel: `INTEL.personalityLines.usurper`.
- Hint: `usurperOnFrontier(state, world)` -> regionId|null; text `CROWN.copy.hint`.

## 4. The Throne of Ages battle

`arena.throne` (attack arena of the Throne only):
```js
arena.throne = {
  keep, gate,                        // site ids
  champions: [{ site, kind, name }], // kind: 'barrowKnight' | 'reaverCaptain' | 'champion'; name for the banner
  tide: number[],                    // tile indices the borrowed Tide floods (draw the telegraph ring on exactly these)
  keepTroops, usurper: { troops, power },
};
```
Champion posts are sites with `type: 'bandit'` (a veteran post), `feature: 'champion'` and `throneChampion: kind`. While a Champion
stands the Gate defends +15% (all three: +45%): draw one banner per standing Champion on the Gate.

`battle.throne` (plain JSON, saved with the battle):
```js
battle.throne = {
  phase: 1 | 2 | 3,
  at: { gate, field, fell },         // battle seconds (null until it happens): results screen
  warded: boolean,                   // phase 2: the keep cannot fall below the field mark until 3 borrows have struck (draw a ward)
  champions: number,                 // still standing
  borrow: { next, kind, at, warned, n, tideUntil, plagueUntil },
  usurper: { fielded, troops, maxTroops, power, squad, site, fell, hp, maxHp },  // hp = troops x power (the health bar)
};
```

| Event | Payload | Show |
|---|---|---|
| `throneChampion` | `{ site, kind, name, left, x, y }` | a Champion's post fell (`left` still standing); the Gate's banner loses one |
| `thronePhase` | `{ phase, x, y }` | phase 2: the Gate fell, the borrowing begins; phase 3: the Usurper takes the field |
| `usurperBorrow` | `{ kind, stage, at, until?, tiles?, site?, x, y, radius? }` | `kind`: `'rising'` / `'tide'` / `'plague'`. `stage`: `'telegraph'` (`at` = strike time, 4 s ahead), `'strike'`, `'end'` (tide ebbs / plague lifts) |
| `send` with `rising: true, borrowed: true` | the usual `send` payload | the borrowed Rising's squad leaving the keep |
| `tideHit` | `{ squad, owner, lost, x, y, borrowed: true }` | a squad caught by the borrowed Tide |
| `usurperField` | `{ squad, hp, maxHp, x, y }` | the Usurper takes the field (show his hero squad + health bar) |
| `usurperHit` | `{ hp, maxHp }` | at each 1/20 of his health |
| `usurperFell` | `{ x, y, fled? }` | he falls (the win follows when you hold the keep) |

His squad: `squad.usurper === true` (never merges, worth `power` per troop); a site he holds has `site.usurper === true`. His health
is set when he takes the field (from the keep's cap and the army you have there): read `hp` / `maxHp` from `usurperField` and
`battle.throne.usurper`. **Win:** take the keep with the Usurper fallen (the keep taken while he lives does not end it; he marches on it).
Battle state survives save and reload (plain JSON on the battle; tested through `serialize` / `deserialize`).

## 5. The ending

```js
import { endingRecord, crownLine } from '../meta/crown.js';
const r = conquer(state, world, throneId, now, ...);
r.crowned      // { first, crowned: { year, dynasty, times }, deeds, ascension } when the Throne fell: play the ending (first) or a short one
               // after it the player may found anew at once (canFoundDynasty is true once the Throne is yours) or play on
endingRecord(state, { challengeRecord })  // the scroll: { title, crowned, dynasties, stars, edicts, generals, relics, vendettasWon,
                                          //   dragonsSlain, capitalsToppled, bestDaily, regionsConquered, battlesWon, crownsEarned,
                                          //   ascension, highlights (ChronicleEntry[]: render with chronicleText), lines: string[], credits }
crownLine(state)   // 'Crowned in Year N' (title screen), null before
```
`ENDING.cinematicStops` and `ENDING.credits` (`{ title, line: 'made with Claude' }`).

## 6. Ascension

- `ascensionInfo(state)` (above) for the Realm panel ladder; banner crown pips = `ascensionHighest(state)`.
- Modifiers are folded into `edictMods(state)`; integration reads nothing new. Keys: `raidGraceMult`, `gateTroopMult`,
  `unrestIdleAdd`, `boonHardOnly`, `vendettaGrudgeMult`, `throneHpMult`, `hazardIntervalMult`, `enemySpeedMult` (+ existing
  `enemyGarrisonMult`, `dragonHpMult`, `bountyMult`).
- Clearing: completing the continent (the last region taken) or toppling the Throne at level L clears L (`conquer` does it:
  `result.ascension = { level, highest, newHighest: true, deeds }`, present only the first time a level above the highest is cleared:
  toast it once). The +25% Legacy per level is paid at the founding that leaves the dynasty.
- Deeds: `crownOfAges` (1 tier) and `ascendant` (Ascension 1 / 5 / 10).

## 7. Icons wanted

`crownChains` (the Usurper's emblem, the Crown of Ages deed), `barrowKnight`, `reaverCaptain`, `champion` (Champion banners),
`borrowRising`, `borrowTide`, `borrowPlague` (telegraphs), `usurper` (the hero squad), the Ascension ladder icons in
`ASCENSION.ladder[].icon` (`shield`, `warband`, `gate`, `unrest`, `boon`, `grudge`, `dragon`, `coin`, `tide`, `crown`: reuse where they
exist), a crown pip.

## 8. QA pointers

- Force the continent: `generateWorld(seed, { dynasty: 7, crownOfAges: true })`. In a save: `state.crownOfAges = true;
  state.rivals = crownRivals(state.seed)` at dynasty 7+ and reload.
- The Throne: `world.crown.throne`. Phase 2 starts when the Gate falls; phase 3 when the keep drops under 40% while you assault it.
- Ascension 1 founding: set `state.generals.crowned = { v: 1, year: 1, dynasty: 7, t: 0, times: 1 }`, then found with `{ ascension: 1 }`.
