# Phase 5 (Dynasties that change the rules): hookup for integration

Source: `docs/PLAN-PHASE5.md` (§5A to §5E and the Contract). The sim/meta engineer wrote this; integration applies it. Everything here
is pure and deterministic, and every number and line of copy lives in config:

| File | What |
|---|---|
| `game/config/edicts.js` | `EDICT_NEUTRAL` (every modifier, documented), `EDICT_LIST`, `EDICTS`, `CHALLENGE_LIST`, `CHALLENGES` |
| `game/config/legacy.js` | `LEGACY_BRANCHES` (15 nodes), `LEGACY`, `QUICK` (Quick Conquest numbers and copy) |

**Rule:** integration does no maths. `edictMods(state)` is read by the meta and sim functions themselves (income, attack, bounties,
raids, Renown, prosperity, Festivals, scouting, fortification cost, battle stats). You only show text and call the functions below.

---

## 1. State (sanitised by `save.js`; an old save loads with "standard rules" and an empty Legacy)

| Field | Lifetime | Shape |
|---|---|---|
| `state.edict` | per dynasty (set by `foundDynasty`) | `{ v:1, id: string\|null, challenges: string[], scoutsUsed }` |
| `state.generals.legacy` | LIFETIME (rides with the Deeds) | `{ v:1, points, spent, nodes: {[nodeId]: true}, pendingBonus }` |

- `createGame` gives `state.edict = { v:1, id:null, challenges:[], scoutsUsed:0 }` (the first dynasty: no Edict).
- `state.generals.legacy` travels through `foundDynasty` and New Realm exactly like the Deeds (`carryRoster` spreads `prev.generals`).
  Settings > Reset (`keepGenerals: false`) wipes it with the roster.
- `scoutsUsed` is an addition to the written contract: the Spymaster node's free scouts are counted there (reset each dynasty).

## 2. World generation: ALWAYS pass the Edict

Long Winter (Blizzard on half the regions), Age of Dragons (a second Lair) and Open Roads (no Night) change the continent, and the
world is regenerated from the seed on every load. So **every** `generateWorld` for a state must use:

```js
import { worldOptsFor } from '../meta/edicts.js';
world = generateWorld(state.seed >>> 0, worldOptsFor(state));   // -> { dynasty, edict? }
```

`stateContainer.js` lines 39, 98 and 115 call `generateWorld(seed, { dynasty })` today: switch all three to `worldOptsFor(...)`
(for the founding, `worldOptsFor(next)` on the state `foundDynasty` returned). With no Edict the world is byte-identical to today's
(a test proves it). `world.edict` is set only when an Edict shaped the world.

## 3. Founding a dynasty

```js
import { foundDynasty, canFoundDynasty } from '../meta/progression.js';
import { edictChoices, allChallenges, challengeInfo } from '../meta/edicts.js';
import { legacyPointsForFounding, legacyInfo, buyLegacy } from '../meta/legacy.js';

const seed = randomSeed();                         // pick the next seed FIRST: the Edict draw is seeded from it
const offered = edictChoices(state, seed);         // 3 (4 with Heralds) x { id, name, icon, upside, cost }
const earned = legacyPointsForFounding(state);     // what founding now pays (stars x the Challenge bonus) -> the summary page
// ... the ceremony: summary, Legacy tree (buyLegacy may be called on the OLD state: points already held), Edict cards, Challenges
const next = foundDynasty(state, seed, undefined, world, { edict: chosenId, challenges: ['ironWill', ...] });
world = generateWorld(seed, worldOptsFor(next));
state = resetRegions(next, world, now());
```

- **Ceremony purchases (approved addition):** pass `legacyBuys: nodeId[]` in the 5th argument. Inside `foundDynasty` the order is:
  (1) the founding's Legacy points are credited, (2) the buys are applied in order with the normal `buyLegacy` rules (a refused one
  is skipped), (3) the dynasty-start effects run (War Chest, Royal Treasury, Patronage; Old Roads in `resetRegions`), so nodes bought
  in the ceremony count for this dynasty. The returned state carries a NON-enumerable (never saved) report:
  `next.founding = { legacyEarned, bought: [nodeId], refused: [{ id, reason }] }`.
- **Preview draw:** `edictChoices(state, seed, { legacyNodes })` draws from a preview Legacy record's nodes (e.g.
  `{ ...legacyInfo-owned, heralds: true }`) without touching state, so Heralds bought on the preview shows the 4th card. The draw is
  seeded, so the first 3 cards stay the same when Heralds adds a 4th.
- The old call forms still work: `foundDynasty(state, seed)`, `(state, seed, newWorld)`, `(state, seed, newWorld, currentWorld)`.
  No 5th argument = no Edict, no Challenges. An unknown Edict id or Challenge id is ignored.
- `foundDynasty` adds `legacyPointsForFounding(state)` to `legacy.points` BEFORE it returns, so Legacy bought during the ceremony
  can be bought on the RETURNED state too (the points earned are spendable at once). Recommended flow: compute `next` when the player
  confirms the Edict page, let them spend on `next`, then generate the world. Either order works; nodes bought on the old state
  carry over (the Legacy lives in `generals`).
- It applies the Legacy start effects that need no world: War Chest (2 free levels of the cheapest Army upgrade), Royal Treasury
  (start gold). `resetRegions` applies the ones that need the world: Old Roads (start region at Prosperity II) and Patronage
  (+2 Renown; like the Dragonslayer deed it is granted in `resetRegions`).
- `legacy.pendingBonus` = the Challenge bonus the new dynasty will pay at ITS founding (0.5 per Challenge), for the laurel badge.
- Dev hook `__hd.completeRealm()`: set every `state.owner[id] = 0` (and `conqueredAt[id] = now`), then the founding button shows.

## 4. Edicts and Challenges in the UI (`game/meta/edicts.js`)

```js
edictChoices(state, nextSeed) -> EdictInfo[]          // the founding cards; EdictInfo = { id, name, icon, upside, cost }
edictInfo(id) -> EdictInfo | null;  allEdicts() -> EdictInfo[]
allChallenges() -> [{ id, name, icon, text, bonus }]  // the toggles; bonus 0.5 = "+50% Legacy at the next founding"
currentEdict(state) -> { edict: EdictInfo|null, challenges: ChallengeInfo[] }   // the Realm panel (null = EDICTS.copy.none)
edictMods(state) -> object                            // read-only; integration needs it only for these few UI facts:
   .bountySlots     the Bounty Board's slot count (render that many; state.bounties.slots has that length once ensureBounties ran)
   .quickConquest   whether to show the Quick Conquest button at all (canQuickConquer says the rest)
   .noPowers        Iron Will: grey out the power bar ("No powers: Iron Will")
   .forceCaptain    Lone Banner: hide the commander picker, the card says "Militia Captain"
   .raids           false under Peace of the Crowns (no incoming-raid UI will ever fire; nothing to do)
freeScoutsLeft(state) -> number                       // Spymaster: "Scout (free · 2 left)"
worldOptsFor(state) -> { dynasty, edict? }            // section 2
```

Icons named in config: Edicts `swords, coin, snowflake, shield, crown, dragon, scroll, wheat, banner, road`; Challenges `fist, horde,
flag`; Legacy branches `swords, castle, scroll`. New to the icon set: **snowflake, coin, road, fist, horde, flag, castle** (if any
already exist under another name, map them; the names are only keys).

Challenges are enforced in meta and sim; integration only shows them:
- **Iron Will:** `playerBattleStats` sets `player.powersBlocked = 'ironWill'`; a power command is refused with the event
  `{ type: 'refused', reason: 'ironWill', owner, power }` (toast "No powers: Iron Will"). The difficulty card counts no powers.
- **Overrun:** enemy garrisons and war bands x1.4 (meta). Nothing to do.
- **Lone Banner:** `playerBattleStats` ignores `opts.commander` (no passive, no ability). For runs, ALSO set the commander to null so
  no General gets XP or wounds: use `commanderFor(state, generalId)` (from `meta/edicts.js`: returns null under Lone Banner, else the
  id) wherever a run's `commander` is chosen (attack card default, defense auto-assign, tray change). The steward style is then
  `'captain'` as for any commanderless run.

## 5. Legacy (`game/meta/legacy.js`, text from `game/meta/edicts.js`)

```js
legacyTreeText() -> [{ id, name, icon, nodes: [{ id, name, cost, requires: nodeId|null, effectText }] }]   // from edicts.js
legacyInfo(state) -> { points, spent, available, pendingBonus, nodes: { [id]: 'owned'|'buyable'|'locked'|'poor' } }
buyLegacy(state, nodeId) -> { ok, reason?: 'unknown'|'owned'|'locked'|'points' }    // permanent; spend any time
legacyPointsForFounding(state) -> number              // the summary page's "Legacy earned"
```

Node effects are applied inside meta (no integration call), except one thing to show: Quick Conquest (section 6).

## 6. Quick Conquest (`game/meta/quick.js`)

```js
import { canQuickConquer, createQuickConquest, stepQuickConquest, finishQuickConquest } from '../meta/quick.js';
canQuickConquer(state, world, regionId, { busy, commander }) -> { ok, reason? }   // commander: the card's choice (its credit counts for 'Easy')
   // reason: 'locked' (no node) | 'owned' | 'attack' (not attackable) | 'label' (not Easy) | 'type' (Bandit Hold / Lair)
   //         | 'capital' | 'busy' (pass busy = manager.busy(): its `regions` Set). Copy: QUICK.copy.refusals[reason]
const job = createQuickConquest(state, world, regionId, { commander, busy, nowMs })   // commander: a generalId or null
   // plain JSON; builds the real arena and battle; commander forced to null under Lone Banner
const { done, progress } = stepQuickConquest(job, 600)  // call per animation frame with a step budget (600 steps of
   // TICK_SEC is 30 simulated seconds, a few ms); progress 0..1 for the bar
const out = finishQuickConquest(state, world, job, nowMs)
   // -> { won, regionId, conquerResult?, crowns, crownAward?, commander?, bounties: { gold, renown, xp, claimed }, summary }
```

**Who fights it (deviation from PLAN's "using the steward", lead please confirm):** the player's side is played by the campaign's
attacker, `battle/bot.js decide` (a good human at a 3 s cadence, with the commander's passive and ability), not `stewardDecide`. The
Steward is a defender: from campaign states it won only 65-81% of Easy regions (most losses were timeouts, even with a 600 s cap);
the bot wins 264/265 (99.6%, `tools/quickcheck.mjs`, patience x2). `QUICK.driver: 'steward'` switches back.

`finishQuickConquest` does ALL the meta bookkeeping a watched battle gets from `battles.js finish` + the Bounty Board wiring:
lifetime stats (troops sent, battles won/lost, settlements taken), `conquer` at `QUICK.bountyShare` of the bounty, the Victory crown
only (`awardCrowns`), `settleCommander`, `onBattleEnd` (with `summary.quick = true`: the `ability` contract does not count, `noPowers`
does), `onConquest`, `claimCompleted`, and `onStreakBroken` on a loss. Integration then: the overlay (`QUICK.copy.marching`), the
results toast, the Chronicle line (`chronicleOnConquest(state, world, regionId, { crowns: out.crowns, battleSec, decapitated })`),
the conquest fx and voice lines as for a won attack, and an autosave. The job never enters `state.battles` (it is not saved: a
reload mid-way just drops it, which is fine for a 1-2 s overlay).

## 7. Other results and APIs that changed

- `abilityState(battle)` (battle/abilities.js) -> `{ id, ready, used, needsTarget, uses, left }`: Warrior Kings gives 2 uses; `used`
  stays "used at least once" (the tracker reads it), `ready` is false once `left` is 0. Show "2" on the ability button when `uses > 1`.
- `scoutCost(state, world, regionId)` returns 0 under Open Roads or while Spymaster scouts are left; `scout()` counts the free ones.
- `festivalCost`, `fortCost`, `conquestBounty`, `incomePerSec`, `defenseReward`, `claimCompleted` already include the mods: the card
  numbers stay truthful with no change.
- `difficulty(...).surrender` uses Old Alliances' lower ratio for Free Folk regions.
- `conquer(state, world, regionId, now, opts?)`: new optional `opts.bountyShare` (Quick Conquest uses it); old calls unchanged.
- `conquer` result may carry `renown` from Long Winter (+1 per Blizzard region).
- `bountySlots(state)` (meta/bounties.js) = `edictMods(state).bountySlots`.

## 8. Where to call what (summary)

| Moment | Call |
|---|---|
| Any `generateWorld` for a state | `generateWorld(seed, worldOptsFor(state))` |
| Founding ceremony opens | `seed = randomSeed()`, `edictChoices(state, seed)`, `legacyPointsForFounding(state)`, `legacyTreeText()`, `allChallenges()` |
| Player confirms | `foundDynasty(state, seed, undefined, world, { edict, challenges, legacyBuys })`, then world + `resetRegions` |
| Legacy spend (ceremony or Realm panel) | `buyLegacy(state, nodeId)`, refresh with `legacyInfo(state)` |
| Realm panel | `currentEdict(state)`, `legacyInfo(state)`, `legacyTreeText()` |
| A run's commander is chosen | `commanderFor(state, generalId)` |
| Region card (Easy region) | if `edictMods(state).quickConquest`: `canQuickConquer(...)` decides the button state |
| Quick Conquest pressed | `createQuickConquest`, then `stepQuickConquest` per frame, then `finishQuickConquest` |
| Power refused with `reason: 'ironWill'` | toast |

## 9. Tools (sim/meta)

- `node tools/campaign.mjs --dynasties=3` now founds with an Edict (`--edict=first|none|<id>`), Challenges (`--challenges=a,b`) and
  greedy Legacy (`--legacy=off`), regenerates the world with `worldOptsFor`, and Quick-Conquers Easy regions once the node is owned
  (`--quick=off`). `--card=credited` makes the virtual player read the commander-credited card (off by default: see the report).
- `node tools/quickcheck.mjs` measures Quick Conquest's win rate from campaign states.
- `node tools/swarmcheck.mjs [--probe=1]` measures label honesty per personality (the campaign's picks, or every credited label).
