# Phase 8 (§8C, more to find): hookup for integration

Source: `docs/PLAN-PHASE8.md` §8C. Written by the sim/meta engineer; integration applies it. Same rules as Phase 7
(`docs/briefs/phase7-hookup.md`): every number and line of copy is in config, `boonMods(state)` is the one modifier source, the
meta and sim functions read it themselves, **the UI does no maths**. Nothing in the Phase 7 API changed shape.

| File | What changed |
|---|---|
| `game/config/boons.js` | +8 Boons (`BOON_LIST` 32), +2 Duos (`DUO_LIST` 6), new `BOON_NEUTRAL` keys |
| `game/config/relics.js` | +4 Relics (`RELIC_LIST` 12); still `RELICS.perContinent` 4 |
| `game/config/events.js` | 2 new event kinds (`deserters`, `harvest`), their numbers and copy |
| `game/config/leaders.js`, `leadersAshen.js` | 2 new leader triggers (`deserters`, `harvest`) for all 5 rivals |
| `game/config/chronicle.js` | 2 new Chronicle kinds (`deserters`, `harvest`), recorded by `acceptEvent` itself |

---

## 1. The new Boons (they show up in drafts by themselves: `pendingBoons` / `ownedBoons` / `allBoons`)

| id | Name | Rarity | Icon wanted | Effect (text from `boonInfo`) | Where |
|---|---|---|---|---|---|
| `vanguard` | Vanguard | common | **spear** | the first squad of every battle +50% troops | sim |
| `supplyWagons` | Supply Wagons | common | **wagon** | supply-line squads carry +25% extra troops | sim |
| `rearguard` | Rearguard | common | **retreat** | a retreat from an attack keeps the Conquest Streak | meta (`onStreakBroken`) |
| `warDrums` | War Drums | common | **drum** | every power cast: squads march +15% faster for 6 s | sim |
| `towerSappers` | Tower Sappers | rare | **pick** | enemy towers within 3 hexes of a site you hold shoot 30% shorter | sim |
| `spoilsOfWar` | Spoils of War | rare | **sack** | a three-crown win starts the region at Prosperity I | meta (`awardCrowns`) |
| `lastStand` | Last Stand | rare | **keep** | in a defense your keep defends +40% below 25% of its cap | sim |
| `cartographer` | Cartographer | rare | **compass** | Quick Conquest also takes regions labelled Fair | meta (`canQuickConquer`) |

Duos (the reveal comes from `pickBoon(...).duo` as before; `duoInfo` lists 6):

| id | Name | Parts | Icon | Effect |
|---|---|---|---|---|
| `thunderCharge` | Thunder Charge | vanguard + warDrums | drum | the first squad after each power cast +25% troops |
| `siegeTrain` | Siege Train | supplyWagons + towerSappers | wagon | supply-line squads ride through enemy arrows |

`requires` (a Boon stays out of drafts where it can do nothing): War Drums `powers`, Last Stand `raids`, Cartographer `quick`
(the Quick Conquest Legacy is owned), Rearguard `streak` (not under Bounty Hunters).

**Rearguard and the streak toast:** `onStreakBroken(state, 'retreat')` with Rearguard returns `{ was: 0, reason, kept: true }`, so
`goals.js streakEnded` shows nothing. Optional: a small toast "Rearguard: the streak holds" when `kept`.

**Spoils of War:** `awardCrowns` returns `spoils: 1` (the level granted) on a three-crown win with the Boon. The level-up itself is
reported by the next `updateProsperity` like any other (the celebration and the Chronicle line come for free).

**Cartographer:** `canQuickConquer` now says `ok` for a Fair region with the Boon (`QUICK.cartographerLabels`). The refusal copy
`QUICK.copy.refusals.label` ("Only for regions labelled Easy") is unchanged; it is only shown when the region is not allowed.

## 2. New `boonTriggered` ids (battle events, same payload as Phase 7: `{ boon, x, y, site?, squad?, count?, until? }`)

| `boon` | When | Payload extras | Show |
|---|---|---|---|
| `vanguard` | the battle's first player squad | `squad`, `count` (troops added), `site` | `+count` pop at the source |
| `thunderCharge` | the first squad after a cast | `squad`, `count`, `site` | `+count` pop |
| `supplyWagons` | a supply-line squad (throttled: once per 2 s per source) | `squad`, `count`, `site` | small `+count` |
| `warDrums` | a power cast with War Drums | `until` (battle s), x/y at the War Camp | a drum pulse; optional speed tint on squads until `until` |
| `towerSappers` | an enemy tower is sapped (once per tower per battle) | `site` (the tower) | a pick icon on the tower; optionally draw its shorter ring |
| `lastStand` | the keep first drops below the line in a defense (once) | `site` | a keep/shield pop |

Siege Train has no event of its own (its squads simply take no arrows: `squad.noArrows`, the flag raid squads already use).
Live state added to `battle.boonFx` (plain JSON, saved): `vanguard`, `drumCharge`, `sapped: { [siteId]: true }`, `lastStand`;
`battle.effects.drumsUntil`.

## 3. The new Relics (they place, claim and show exactly like the Phase 7 ones: `relicsOnMap`, `relicLine`, `reliquary`)

| id | Name | Icon wanted | Effect | Where |
|---|---|---|---|---|
| `merchantsScale` | Merchant's Scale | **scale** | the Merchant's deals 30% cheaper | `events.js` (both deals' prices) |
| `wardensBell` | Warden's Bell | **bell** (exists) | a defense's siege timer −20% (`requires: 'raids'`) | `frontier.defenseRunFor` / `estimateDefense` |
| `twinCrowns` | Twin Crowns | **crowns** | Swift's par +20 s | `crowns.parFor` (so `swiftDeadlineSec`, the battle timer, the card) |
| `sealOfMargrave` | Seal of the Margrave | **seal** | Ashen only: the Barrow Keep's Rising every 30 s instead of 20 s | `battle/fallen.js` (`risingEverySec(battle)`) |

- The Merchant's fortification deal is now `priceShare` 0.5 × 0.7 with the Scale: `eventsLoop.js offerText` hard-codes "half price";
  read `ev.deals[0].priceShare` instead (or drop the words).
- The Rising telegraph event (`rising`, `at`) already carries the right time; nothing to change if the UI reads `at`.

## 4. The two new world events

Both are **opt-in** offers, like the Merchant: `tickEvents` offers them (`offered.kind`), they wait `EVENTS.offerSec`, then expire.
Titles: `EVENTS.copy.titles.deserters` / `.harvest`; the offer line is `ev.text` (built from config).

### Deserters (`kind: 'deserters'`)

```js
ev = { id, kind: 'deserters', faction, leader, raidMult, text, offeredAt, expiresAt }
acceptEvent(state, world, { choice: 'raid' }, Date.now())    // -> { kind, choice: 'raid', faction, event }    that rival's next raid x0.7
acceptEvent(state, world, { choice: 'muster' }, Date.now())  // -> { kind, choice: 'muster', faction, regions, event }   every militia full
acceptEvent(state, world, {}, Date.now())                    // = 'muster' (the default, so the generic Accept button works today)
declineEvent(state)                                          // nothing happens
```

- Never offered under Peace of the Crowns (no raids, no militia needed).
- Two buttons: `EVENTS.copy.desertersRaid` ("Weaken their next raid") and `EVENTS.copy.desertersMuster` ("Muster everywhere").
- Leader line on offer: `speak('deserters', ev.faction, undefined, 'deserters-' + ev.id)` (the rival whose troops left).
- The weakened raid carries `raid.deserted = true` (saved); its announced `strength` is already the smaller one. Optional: a word on
  the raid toast ("deserters thinned it").
- Toast after 'muster': "{regions} militias stand full." Icon wanted: **flag** (or a deserter icon).

### Harvest Festival (`kind: 'harvest'`)

```js
ev = { id, kind: 'harvest', gold, durationSec: 600, mult: 3, text, offeredAt, expiresAt }
acceptEvent(state, world, {}, Date.now())   // -> { kind: 'harvest', gold, until (ms), event } | false (not enough gold: the offer stays)
harvestActive(state, Date.now())            // -> true while it runs (from meta/events.js), for a map tint or a Realm-panel line
```

- Button: `EVENTS.copy.harvestAccept` ("Hold the festival"), with the price `ev.gold`; grey it out when `state.gold < ev.gold`.
- Leader line on offer: a neighbouring rival grumbles, `speak('harvest', grumbler, ...)` (pick it as `merchantGrumbler()` does).
- Prosperity: `prosperityInfo` / `nextProsperityAt` already count it (the "next in" countdown shortens while it runs). No UI maths.
- Only one festival at a time; none is offered while one runs. Icon wanted: **wheat** (exists).

### Chronicle

`acceptEvent` records the line itself (kinds `deserters` with variant `'muster'`, and `harvest`; `CHRONICLE.kinds` gives the icons
flag / wheat). **Do not** also call `eventsLoop.js chronicle(...)` for these two kinds, or the line shows twice.

### Save

`state.worldEvents` gains `deserters: { faction } | null` and `harvests: [{ from, until, mult }]` (wall-clock ms); `log` gains the
two kinds. All sanitized in `sanitizeWorldEvents`; an old save loads with neither.

## 5. Summary: what integration wires

| Where | What |
|---|---|
| `eventsLoop.js` toast / answer | two buttons for `deserters` (`{ choice }`), one priced button for `harvest`; their icons and titles |
| `eventsLoop.js onOffered` | leader lines `deserters` / `harvest`; no `chronicle(...)` call for these two |
| battle FX | the six new `boonTriggered` ids (§2) |
| icons | spear, wagon, retreat, drum, pick, sack, keep, compass; Relics scale, crowns, seal (bell exists) |
| Codex (8B) | `allBoons()`, `duoInfo(state)`, `reliquary(state)` and `EVENTS.copy` already carry the text built from config |
