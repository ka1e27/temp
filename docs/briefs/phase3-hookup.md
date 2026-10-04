# Living Frontier, Phase 3 (a varied map): hookup for integration

Source: DESIGN §10.13. The sim/meta engineer wrote this; integration applies it. Everything is pure and deterministic.
Every number lives in `game/config/features.js` (types, twists, the Dragon, rewards, the card's factors) and
`game/config/events.js` (world events).

## 1. World data (new contract fields)
`generateWorld` now sets two fields on every region. Layouts, names and perks are unchanged, because the assignment uses
hashes only.

| Field | Values |
|---|---|
| `region.type` | `null`, `'goldmine'`, `'monastery'`, `'bandit'`, `'ruins'` or `'dragon'` |
| `region.twist` | `null`, `'night'`, `'blizzard'`, `'flooded'`, `'holy'`, `'siege'` or `'raid'` |

- The start region and the first ring get neither.
- There is one Dragon's Lair per continent, deep.
- Every rival capital has `twist: 'siege'`.

Copy and helpers:
- Names: `FEATURES.copy.typeNames` and `twistNames`. One-line card text: `typeText` and `twistText`.
- Map icons (DESIGN): pickaxe, bell tower, skull banner, broken arch, dragon.
- Tiles of the feature sites, for map structures and the region card preview, come from `game/world/regionFeatures.js`:
  - `gateTile(world, id)`
  - `banditTile(world, id)`
  - `ancientTowerTile(world, id)`
  - `shrineTiles(world, id)`, which returns 3 tiles

## 2. Battles
`buildArena` adds the features of an ATTACK on a typed or twisted region automatically. `arena.twist` and `arena.type` are
set, and they are copied into `battle.arena`. Twists do not apply to defense battles, except the Duel (§4).

### 2.1 New sites
New site types are in `SITE_TYPES`: `bandit`, `gate`, `shrine`. Each new site has `settlement: -1` and a `feature` field, and
needs a sprite. `scoutReport` names them from `FEATURES.copy.siteNames`.

| `feature` | Site type | What it is |
|---|---|---|
| `'bandit'` | `bandit` | Veterans: `defMult` 1.69, and its squads carry `power` 1.69 |
| `'ancientTower'` | `tower` | Own `range` 4, `volleySec` 0.35, `volleyKills` 2 |
| `'gate'` | `gate` | Defence 2.0 |
| `'shrine'` | `shrine` | ×3 |

### 2.2 Twists, what to draw and say

| Twist | Rule | Visuals and UI |
|---|---|---|
| **Night** | Tower and camp ranges ×0.5 | Darken the arena. Show enemy garrisons as "?" until scouted (`isScoutedOrFree`) or adjacent to your land; that part is UI only. |
| **Blizzard** | Marches ×0.7 (both sides); Firestorm ×1.5 | Snow overlay. Show the stronger Firestorm on the button. |
| **Flooded** | Arena tiles of the region carry `flood`, `river` and `road`; river edges are closed except where a road crosses (a bridge). If that would cut the camp off, the arena drops the twist (`arena.twist` is absent) | Draw high water on river edges. The no-route feedback already handles the blocks. |
| **Holy Ground** | Powers are refused with a `refused { reason: 'holy', power }` event; abilities still work | Grey out the power buttons. |
| **Siege** | `routeFor` / `canRoute` to the target keep return null for the attacker while the region's Gate is held by the keep's owner | The keep reads "No route: take the Gate first". When the Gate falls (a normal `capture` event on the gate site), play a "gate falls" fx. |
| **Raid** | Hold every Shrine for `FEATURES.shrine.holdSec` (10 s) to win; taking the keep still wins | `shrines { held, total, sec, need }` events arrive whenever the count changes, and every second while all are held; show a progress ring. The win emits `surrender` then `end`, as for a keep. |

### 2.3 The Dragon (a Dragon's Lair)
**State:** `battle.dragon = { hp, maxHp, perch, flight, nextFlyAt, nextBreathAt, breath, damage, dead }`, plain JSON.
- Draw it on `perch` (a site id), or along `flight` (`{ from, to, landAt }`).
- Show a health bar from `hp / maxHp`.
- The site it perches on carries `dragonDef` and defends ×1.4.

**Events:**

| Event | Payload | Use |
|---|---|---|
| `dragonFly` | `{ from, to, x1, y1, x2, y2, landAt }` | animate the flight |
| `dragonLand` | `{ site }` | |
| `dragonTelegraph` | `{ x, y, radius, at, target }` | the 1.5 s warning circle; `target` is a site id or null for a squad cluster |
| `dragonBreath` | `{ x, y, radius, hits }` | the fire fx |
| `dragonHit` | `{ hp, maxHp }` | every 5% of health lost |
| `dragonFall` | `{ x, y, fled? }` | |

**Rules:**
- **The Lair falls with its Dragon, not its keep.** Taking the keep does not end the battle while the Dragon lives.
- When it falls, or has nowhere left to perch, the region surrenders: `surrender` then `end { result: 'win' }`.
- The bot and the Steward Bulwark a telegraphed site. A tutorial-style hint is welcome: "Bulwark the target!".

## 3. Meta

### 3.1 Rewards
These come through `conquer`, which is already called:

| Type | Reward |
|---|---|
| Gold Mine | bounty ×3 (`conquestBounty` includes it); +25% of its income while held (`incomePerSec` includes it) |
| Monastery | +3 Renown; regions within 2 count as scouted (`isScoutedOrFree` includes it) |
| Bandit Hold | bounty ×2, +2 Renown |
| Ruins | +5 Renown |
| Dragon | +10 Renown and the **Dragonscale** boon |

- `conquer` returns `type`, `renown`, and `dragonscale: true` for the Lair.
- **Dragonscale:** `state.boons.dragonscale` (per dynasty). Every fortification counts one level higher in defenses and on
  the cards (`regionFortEffects` and `defenseRunFor` include it). Show `FEATURES.copy.dragonscale` in the Realm panel.
- **For integration:** `app/income.js effectiveRegionIncome` should multiply by `typeIncomeMult(region)` (from
  `meta/featuresState.js`) so the card shows what `incomePerSec` pays.

### 3.2 Difficulty and labels
`difficulty()` and `estimateDifficulty` include the feature sites, the Dragon's health and a factor per type and twist
(`FEATURES.difficulty`, tuned by `tools/balance.mjs --twist`). Holy Ground drops the powers' bonus from Army Power, and
Night counts only while the region is unscouted.

### 3.3 State
Add both fields to `createGame` / `resetRegions` and to `save.js` withDefaults:

| Field | Scope | Default | Sanitiser |
|---|---|---|---|
| `boons` | per dynasty | `defaultBoons()` | `sanitizeBoons` (from `meta/featuresState.js`) |
| `worldEvents` | per dynasty | `defaultWorldEvents()` | `sanitizeWorldEvents` (from `meta/eventsState.js`) |

`foundDynasty` already resets both.

## 4. World events (`game/meta/events.js`)

**Scheduler:** every frame of active play, next to `tickFrontier`:
```js
const { offered, expired } = tickEvents(state, world, Date.now(), realDtSec);
```
- About one event every 15 active minutes; none in the first 25 active minutes or before 4 regions are held; at most one
  pending. Do not call it during the scripted tutorial.
- **`offered`:** toast `offered.text` with Accept / Decline and a countdown (`expiresAt - state.worldEvents.activeSec`,
  90 s). Play a leader-voice line and add a Chronicle entry.
- **`expired`:** the offer lapsed; dismiss the toast.
- `pendingEvent(state)` returns the open offer.

**The three events:**

| Event | Accept | Notes |
|---|---|---|
| **Merchant** | `acceptEvent(state, world, { deal: 'renown' })` (gold → Renown), or `acceptEvent(state, world, { deal: 'fort', regionId, type })` (one free fortification level there for the deal's price, `merchantFortPrice(state, world, regionId, type)`) | `offered.deals` lists both. A refused choice returns false and the offer stays. |
| **Plague** | already applied when offered | `offered.faction` regions are weaker for 10 min (`plagueMult`); draw a sickly tint on their regions while `state.worldEvents.plague` is set. Accept and Decline only dismiss it. |
| **Duel** | `acceptEvent(state, world)`, then `manager.start(duelRunFor(state, world, offered, playerBattleStats(state, world, offered.regionId, { commander }), { nowMs, busy }))` | |

**The Duel's battle:**
- The run has `kind: 'duel'`. It is a 60 s, no-powers (Holy Ground) defense against the rival champion's war band.
- On end: `duelReward(state, world, run, result)` returns `{ renown }` (3 for a win). **Do not occupy on a loss**; a duel
  costs nothing.
- Decline with `declineEvent(state)`.

## 5. Tutorial notes
- No types or twists reach the first ring, so the opening is untouched.
- Events wait 25 active minutes.
- Good first-time hints:
  - the first Siege: "Take the Gate to open the keep"
  - the first Raid: "Hold all three Shrines for 10 s"
  - the first Dragon telegraph: "Bulwark the target!"

## 6. The card with a commander (Phase 2 follow-up)
`difficulty(state, world, regionId, { commander: generalId })` credits the commander at its measured worth
(`GENERALS.cardCredit`: about ×1.07 at level 1, ×1.18 at level 10). Pass the region card's chosen commander so the label and
win chance match the fight. The old 3-argument call is unchanged (no commander).

## 7. The Dragon's Lair is optional for founding a dynasty
`canFoundDynasty(state, world)` ignores an unconquered Dragon's Lair. The old one-argument form still requires every region.
`foundDynasty(state, newSeed, newWorld?, currentWorld?)` takes the continent being left as its 4th argument.

Callers to update (integration's files):

| Caller | Change |
|---|---|
| `game/scenes/world.js:478` (Realm panel `canFoundDynasty`) | `canFoundDynasty(state, world)` |
| `game/scenes/world.js:1176` (`realmComplete`) | `canFoundDynasty(state, world)` |
| `game/app/stateContainer.js:96` (`tryFoundDynasty`) | `foundDynasty(state, seed, undefined, world)`, called before `world` is replaced |
| `tools/gallery/keepsakes.js:110` | optional; it forces every region owned anyway |

Founding without slaying the Dragon only forgoes its Renown and Dragonscale. The world generator never puts the Lair where
skipping it would cut off another region.
