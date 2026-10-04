# Phase 4 (Goals and Rivals): hookup for integration

Source: `docs/PLAN-PHASE4.md` (§4A to §4E and the Contract). The sim/meta engineer wrote this; integration applies it. Everything
here is pure and deterministic. Every number and every line of copy lives in config:

| File | What |
|---|---|
| `game/config/bounties.js` | `BOUNTIES`: the board, contract kinds, rewards, reroll, copy |
| `game/config/streak.js` | `STREAK`: window, multipliers, copy |
| `game/config/deeds.js` | `DEEDS`, `DEED_TIERS`, `DEED_CAPS`, `DEED_COPY` |
| `game/config/grudges.js` | `GRUDGES`: gains, decay, the Vendetta, the Champion, Trophies |
| `game/config/leaders.js` | 8 new voice triggers (section 7) |

Times are ACTIVE seconds (`state.frontier.activeSec`, the clock `tickFrontier` advances) unless a name ends in `Ms`.

**Deviation from the written contract (one):** the Deeds' functions take the game `state` (there is no separate `meta` object).
The Deeds live at `state.generals.deeds`, inside the Generals record, so they travel through `foundDynasty` AND New Realm
(`stateContainer.carryRoster` spreads `prev.generals`) with no integration change. Settings > Reset (`keepGenerals: false`) wipes
them with the roster.

---

## 1. State (all sanitised by `save.js`; old saves load with fresh empty records)

| Field | Lifetime | Shape |
|---|---|---|
| `state.bounties` | per dynasty | `{ v:1, slots:[Contract\|null x3], draws, freeRerollAt, completed, unlocked, extraFree }` |
| `state.streak` | per dynasty | `{ v:1, count, lastAt, best }` |
| `state.grudges` | per dynasty | `{ v:1, at, news:[...], [faction]: { value, warnedAt, vendettaAt, orphanSince } }` |
| `state.trophies` | per dynasty | `{ v:1, [faction]: n }` (n <= 3) |
| `state.generals.deeds` | LIFETIME | `{ v:1, progress:{[key]:n}, earned:{[deedId]:tiers}, news:[...] }` |

`Contract = { id, kind, params, progress, goal, reward:{ gold, renown, xp }, done }`. Text is the UI's: `bountyText(c, world, state)`.

`createGame`, `resetRegions` and `foundDynasty` reset bounties, streak, grudges and trophies; the deeds are kept.
Runs: a defense run may carry `run.vendetta = { faction, leader }`; an attack run may carry `run.labelAtAttack` (see 2.1).
Both survive save/load (`sanitizeBattles`). Raids in `state.frontier.incoming` may carry `vendetta` too.

---

## 2. The Bounty Board (`game/meta/bounties.js`)

```js
import * as Bounties from '../meta/bounties.js';
ensureBounties(state, world)                         // -> state.bounties. Opens the board once 2 regions are held (never in the
                                                     //    tutorial), fills empty slots, re-prices gold. Call every frontier tick
                                                     //    (cheap) or at least on open and after each claim.
bountiesUnlocked(state) -> boolean                   // show the HUD button only when true
bountyText(contract, world, state) -> string         // "Conquer a Gold Mine", "Win a battle commanded by Marshal Edric"
bountyProgress(state, world, contract) -> { progress, goal }   // "1/2"
rerollInfo(state) -> { free, cost: 'free'|1, freeInSec, extraFree }   // the Reroll label (BOUNTIES.copy.rerollFree / rerollCost)
rerollBounty(state, world, slotIndex) -> { ok, cost?, reason?: 'locked'|'empty'|'renown'|'none', contract? }

// progress hooks: each returns Completed[] = [{ slot, contract, commander? }]
onBattleEnd(state, world, run, result, summary)     // EVERY finished attack or defense (Duels count for nothing)
onConquest(state, world, regionId, conquerResult)   // after EVERY conquer() (battle won, surrender, retake)
onProsperity(state, world, levelUps)                // after updateProsperity returns ups; after a Festival pass
                                                    //   [{ regionId, level: res.level, from: res.level - 1 }]
onFortBuilt(state, world, regionId, type)           // after buildFort / upgradeFort / a Merchant fortification deal
onScout(state, world, regionId)                     // after a PAID scout (returns [] : it only remembers the region)

claimCompleted(state, world, completed, nowMs)
  -> { gold, renown, xp, replaced:[slotIndex], claimed:[Contract], general: id|null }
```

**Rule:** whenever an `on*` returns a non-empty list, call `claimCompleted` with it at once. It pays gold (added to `state.gold`
and `stats.goldEarned`), Renown, the XP bundle (to `completed[i].commander`), records the Contractor deed, and draws a replacement
into the slot. Then toast `BOUNTIES.copy.completed` with the seal-stamp, and write a Chronicle line.

### 2.1 Building the battle summary
The crown tracker now also counts `powersUsed`, `capturesByType` and `abilityUsed`, so a reload mid-battle keeps them. **Feed the
tracker for every run, defenses included** (`trackBattle(trackerOf(run.battle), run.battle)` after each step), then:

```js
import { battleSummaryFor, trackerOf } from '../meta/crowns.js';
const summary = battleSummaryFor(trackerOf(run.battle), run.battle, run, world, state);
// -> { kind, won, regionId, powersUsed, capturesByType, twist, labelAtAttack, commander, abilityUsed, crowns, playerSitesLost,
//      durationSec, vendetta }
const done = Bounties.onBattleEnd(state, world, run, result, summary);
if (done.length) Bounties.claimCompleted(state, world, done, nowMs);
```
When an ATTACK starts, set `run.labelAtAttack = difficulty(state, world, regionId, { commander }).label` (the swiftHard contract
needs the label the card showed). `crowns` in the summary are computed for you for a won attack.

### 2.2 UI choice
PLAN lets integration choose a Bounties HUD button or a board in the Regions panel; record the choice. A dot when a slot is
`done` (normally never visible, since claims are immediate).

---

## 3. The Conquest Streak (`game/meta/streak.js`)

```js
streakInfo(state) -> { count, mult, remainingSec, windowSec, best, visible }   // the flame chip "x1.2 · 3" (STREAK.copy.chip);
                                                                               // hide when !visible (0-1); ring = remainingSec/windowSec
streakMultiplier(state) -> number            // the live multiplier
projectedStreakMultiplier(state) -> number   // what the NEXT win gets (conquestBounty already includes it)
onStreakBroken(state, 'lost' | 'retreat') -> { was, reason }    // INTEGRATION calls this on an ATTACK lost or retreated
```
Already wired in meta, do not call them yourself:
- `conquer()` raises the streak and returns `result.streak = { count, mult }`.
- `conquestBounty` (the card and the results card) and `conquer()` pay gold x the multiplier. Renown is never multiplied.
- `defenseReward` on a win refreshes the window.
- `tickFrontier` expires it and returns `streakEnded: { was, reason:'expired' } | null`.

Retreat confirm: show `STREAK.copy.retreatWarning` when `streakInfo(state).count >= 1`. Reduce Motion: a static flame.

---

## 4. Deeds (`game/meta/deeds.js`)

```js
deedProgress(state) -> [{ id, name, icon, tier, tiers, tierName, next, progress, goal, reward, done }]   // the Realm panel grid
drainDeedNews(state) -> [{ id, name, icon, tier, tierName, reward }]   // poll each frame or tick: toast DEED_COPY.earned + a
                                                                        // Chronicle line for each, then they are gone
deedBonuses(state)  // already folded in by meta (income, bounty, garrison defence, attack vs a toppled faction, fortification
                    // cost, Festival cost, General XP, streak window, Renown per Duel, vs Vendettas, rerolls, Dragonslayer Renown)
```
Integration records nothing: the meta functions record progress themselves (conquer, awardCrowns, defenseReward, buildFort /
upgradeFort, claimCompleted, the streak, updateProsperity, festival, settleCommander, train, duelReward).
Icons named in `DEEDS[].icon`: banner, shield, crown, dragon, throne, scroll, flame, wheat, laurel, tower, swords, skull.

---

## 5. Grudges, Vendettas and Trophies (`game/meta/grudges.js`, `game/meta/frontier.js`)

```js
grudgeInfo(state, faction, world) -> { value, max: 100, warned, broken, sworn }   // the meter "Grudge 72/100" on the leader
                                                                                   // portrait and region cards (pass world for broken)
drainGrudgeNews(state) -> [{ kind: 'warn', faction, value }]   // poll: play the `grudge` voice for each
trophyCount(state, faction) -> 0..3;  trophyBonus(state, faction) -> 1 + 0.05 x n    // the Trophy wall in the Realm panel
```
Grudges rise inside meta (no integration calls): `conquer` (+16, capital +40; GRUDGES.gains), `defenseReward` on a won raid (+8), `sabotage`
(+6), `declineEvent` on a Duel (+10), `duelReward` on a win (+5). They cool in `tickFrontier` (-1 per 2 active minutes). Results
carry `grudge: { faction, value, crossed }` where useful.

### 5.1 The Vendetta is a frontier raid
- `tickFrontier` swears it when a Grudge hits 100 (leader not broken; a free `maxDefenses` slot; never the home region; never
  away). It comes back in `announced` like any raid, with `raid.vendetta = { faction, leader }`, `arriveAt` 90 s out (+ Beacon),
  and a x1.5 war band.
  - Red banner: "{leader} swears vengeance: {region}, in 1:30".
  - Voice trigger `vendetta` (with `{region}`).
- On arrival, `defenseRunFor(state, world, raid, stats, opts)` builds it as usual. `run.vendetta` is set and the arena carries
  the Champion.
- **Call `defenseReward(state, world, run, result, nowMs)` for EVERY finished defense, won or lost.** On a lost Vendetta it
  settles the Grudge (to 30) and returns `{ gold:0, renown:0, vendetta:{ won:false, faction, trophy } }`. Then call
  `occupy(...)` as before.
  - On a win it returns `{ gold, renown, vendetta: { won: true, faction, trophy } }`: +4 Renown inside `renown`, a Trophy, the
    Grudge back to 0.
  - Voice: `vendettaWon` (player won) / `vendettaLost` (player lost, `{region}`).
  - If a lost or retreated defense never reaches `defenseReward`, `tickGrudges` calls the Vendetta off after 30 s anyway.
- `estimateDefense` counts the Champion when given the raid.

### 5.2 The Champion (sim, `game/battle/champion.js`)
- `battle.champion = { owner, troops, power, from, to, launchAt, launched, squad, site, fellAt }`.
- 6 s in, a squad with `champion: true` (and `power` 1.5) marches from the war-band camp on your keep. Draw it with the
  leader's pennant; it never merges with other squads.
- If it takes a site, that site carries `champion: true` while it holds it.
- **Event** `{ type: 'championFell', owner, x, y, leader }` when its squad dies or its site falls. Toast
  "{leader}'s champion has fallen!". From then on the war band's attack is x0.8 (already applied to `battle.enemy.atk`).
- The champion's `send` event carries `champion: true`.

---

## 6. Other results that changed
- `conquer()` adds `streak` and maybe `grudge` (and records deeds).
- `defenseReward` adds `vendetta` / `grudge` and accepts a lost result.
- `sabotage()` adds `grudge`. `declineEvent()` returns the event with `ev.grudge` for a Duel. `duelReward()` adds `grudge` on a win.
- `tickFrontier()` returns `streakEnded` as well.
- `festival()` is unchanged: pass its level-up to `onProsperity` yourself.

---

## 7. Leader voices (`game/config/leaders.js`)
Eight new triggers, 4 lines per faction each, within `maxLineChars`. Placeholders: `{name}`, and `{region}` where noted.

| Trigger | When | Speaker |
|---|---|---|
| `grudge` | `drainGrudgeNews` item | that faction's leader |
| `vendetta` | a Vendetta announced (`{region}` = target) | that leader |
| `vendettaWon` | the player won the Vendetta | that leader (defeated taunt) |
| `vendettaLost` | the player lost it (`{region}` = the region occupied) | that leader (gloat) |
| `plague` | a Plague offered | the plagued faction's leader |
| `merchant` | a Merchant offered | any bordering rival leader |
| `duelWon` | the player won the Duel | the challenger |
| `duelLost` | the player lost the Duel | the challenger |

Mind the gap rule (`VOICE.minGapSec`). Consider adding `vendetta` to `gapExempt` (lead's call).

---

## 8. Where to call what (summary)

| Moment | Call |
|---|---|
| Frontier loop (active play) | `tickFrontier` (already); then `ensureBounties`; poll `drainDeedNews`, `drainGrudgeNews`; read `streakInfo` for the HUD |
| Attack starts | `run.labelAtAttack = difficulty(...).label` |
| Every battle step | `trackBattle(trackerOf(run.battle), run.battle)` (defenses too) |
| Battle ended | `summary = battleSummaryFor(...)`; `onBattleEnd`, then `claimCompleted` |
| Attack won | `conquer` (as now), then `onConquest` + `claimCompleted` |
| Attack lost or retreated | `onStreakBroken(state, result === 'retreat' ? 'retreat' : 'lost')` |
| Defense ended (win or loss) | `defenseReward(state, world, run, result, nowMs)`; on a loss also `occupy` |
| Surrender accepted | `conquer` then `onConquest` + `claimCompleted` |
| `updateProsperity` returned ups | `onProsperity` + `claimCompleted` |
| Festival | `onProsperity(state, world, [{ regionId, level, from: level - 1 }])` + `claimCompleted` |
| Fortification built or upgraded (incl. Merchant) | `onFortBuilt` + `claimCompleted` |
| Paid scout | `onScout` |
| Plague, Merchant, Duel result | voice `plague`, `merchant`, `duelWon` / `duelLost` |
