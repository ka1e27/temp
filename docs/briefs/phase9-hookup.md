# Phase 9 (Daily Challenge and Scenarios): hookup for integration

Source: `docs/PLAN-PHASE9.md` §9A, §9B, §9C. Written by the sim/meta engineer; integration applies it. Same rules as before: every
number and line of copy is in config, the meta functions do the maths, **the UI does no maths**. Dates are passed in: the pure code
never calls `Date`. The app computes the player's LOCAL date as an integer `yyyymmdd` (e.g. `20261004`).

| File | What it is |
|---|---|
| `game/config/challenges.js` | `CHALLENGE_MODE` (save keys, world size, sandbox mods), `GOAL_TEXT`, `DAILY` (the seed's pools), `RECORD`, `BANNERS` |
| `game/config/scenarios.js` | `SCENARIO_LIST` (the six), `SCENARIOS` |
| `game/meta/dates.js` | `isDate`, `dayIndex`, `fromDayIndex`, `addDays`, `daysBetween`, `dateLabel` (pure calendar maths) |
| `game/meta/daily.js` | `dailySpec(date)`, `dailyNumber(date)` |
| `game/meta/scenarios.js` | `scenarioSpec(id)`, `SCENARIO_IDS`, `scenarioUnlocked(id, seen)`, `scenarioList(record, seen)` |
| `game/meta/challenges.js` | the sandbox: `createChallengeGame`, `challengeWorld`, `challengeSpecOf`, `tickChallenge`, `recordChallengeBattle`, `noteChallengeEvents`, `serializeChallenge`, `deserializeChallenge` |
| `game/meta/challengeGoals.js` | `goalProgress`, `goalMet`, `goalFailed`, `goalText`, `starsFor`, `scoreFor`, `compareScores`, `challengeResult` |
| `game/meta/challengesState.js` | the lasting record, streaks, banners, the main-game reward, share data, the calendar |
| `game/meta/challengeSetup.js` | internal (setup rules, the meta sanitizer) |
| `tools/challengeBot.mjs` | headless player: `node tools/challengeBot.mjs --daily=20261004 --days=30`, `--scenario=all` |

Hooks in existing modules (applied; a few lines each, all inert outside a challenge): `edicts.js edictMods` folds `state.challenge.mods`;
`progression.js enemyDepth` reads `world.ladderSpan`; `boons.js boonsUnlocked` is false in a challenge (its Boons are fixed).

---

## 1. A challenge is an ordinary game state

`createChallengeGame(kind, spec, { nowMs, practice })` returns `{ state, world }`: a normal `GameState` on its own small World, plus
`state.challenge`. Every system you already run works on it unchanged (battle manager, frontier loop, crowns, Boons, the General, the
world scene). **To play a challenge, point the app's `getState()` / `getWorld()` at the challenge pair; to return, point them back.** The
main realm object is never read or written by the sandbox. Keep it in memory, do not autosave it with the challenge state, and do not
run `offlineEarnings` or `resolveAway` on a challenge.

```js
const spec = dailySpec(today);                 // or dailySpec(pastDate) for practice, or scenarioSpec(id)
const { state, world } = createChallengeGame(spec.kind, spec, { nowMs: Date.now(), practice: pastDate !== today });
storage.setItem(CHALLENGE_MODE.saveKey, serializeChallenge(state));   // autosave the challenge under ITS key
const resumed = deserializeChallenge(storage.getItem(CHALLENGE_MODE.saveKey)); // { state, world } | null (junk: start over)
```

What the sandbox already does: owners set per the spec, start gold and upgrades, fixed Edict / Boons / Relic, a preset General (the
Marshal, or the Marshal plus that day's champion), tutorial off, random raids and Vendettas off (`edictMods(state).raids === false`),
Boon drafts off. **What the app must skip while in a challenge** (they would be noise): the world-events loop (`tickEvents`), the
Bounty Board hooks, the welcome-back/away report, Found a Dynasty (hide it), the Codex unlock toasts. The Chronicle and Deeds
inside the sandbox are harmless (they stay in the sandbox).

## 2. The loop (beside what you already call)

```js
// every frame of ACTIVE play (wall-clock dt; skip while paused or hidden; same dt you give tickFrontier)
const r = tickChallenge(state, world, dt);   // { announced: Raid[], done: null|{ met, atSec }, justDone }
// r.announced: scripted raids just sent (they are in state.frontier.incoming: your incoming-raid toast/marching band shows them;
//              tickFrontier delivers them as `arrived` like any raid, defenseRunFor + manager.start as today)
// r.justDone: the goal was met or failed: show the result screen (after the watched battle's own results card, if one is up)

manager.on('ended', (id, result) => recordChallengeBattle(state, world, manager.get(id), result)); // the battle log (share marks, goals)
manager.on('events', (id, events) => noteChallengeEvents(state, events));                           // counts the Ashen risen
```

`recordChallengeBattle` may be called on `'ended'` (before `finish`) or after `finish`; it also settles the goal at once (returns the
same shape as `tickChallenge`). Any result other than `win` (lose, retreat) is logged as a loss. The timer is `state.challenge.activeSec`
(wall-clock active seconds, paused with the game; battle speed 2x/3x is allowed and simply finishes sooner); it stops at `done`.

**HUD tracker:** `goalProgress(state, world, challengeSpecOf(state))` returns `{ kind, text, value, total, met, failed, line }`:
`text` is the goal line ("Topple Crimson Legion's capital, Ashford"), `line` the short progress ("4/9 regions", "3:12 / 8:00",
"5:00 / 5:00 · 11871 gold"). Show the timer from `state.challenge.activeSec`.

## 3. The result

```js
const spec = challengeSpecOf(state);
const result = challengeResult(state, world, spec);
// { kind, id, date, practice, met, sec, crowns, gold, stars, risen, goal, battles: [{ kind, won, crowns, unbroken }], wins, losses }
```

- **Daily:** `recordDailyResult(record, result, today)` returns `{ firstAttempt, newBest, streak, attempts }`. Then
  `claimDailyReward(mainState, record, result.date, today)` returns `{ renown: 1 }` once per date (today's Daily only, not practice), or
  null. It adds Renown to the MAIN state (then autosave the main realm). Then `syncBanners(record, mainState)` returns the banner ids
  newly unlocked (toast them). Share: `shareData(result, record)` returns the pieces, and `shareText(data)` the ready line
  "Hex Dominion Daily #142 · 11:42 · 👑👑👑 · 1st try 🗡️🗡️🛡️🗡️" (`SHARE` holds the default marks; build your own from the pieces if
  you like). Copy it to the clipboard.
- **Scenario:** `recordScenarioResult(record, result)` returns `{ newBest, stars, starsBefore, firstAttempt }`. Then `syncBanners`.
- **Abandon / Retry mid-run:** record it too, with the result as it stands (it is `met: false`). It counts as an attempt, and the first
  attempt is the honest score. Retry = `createChallengeGame` again from the same spec.
- Store the record: `storage.setItem(CHALLENGE_MODE.recordKey, serializeRecord(record))`, load it with
  `deserializeRecord(storage.getItem(CHALLENGE_MODE.recordKey))` (null or junk gives a fresh record). It is separate from the realm save,
  so it survives a New Realm.

## 4. The hub

| What | Call |
|---|---|
| Open the Challenges at all? | `challengesUnlocked(mainState)` (after the first conquest, or Dynasty 2+) |
| Today's Daily card | `dailySpec(today)`: `name` ("Daily #4"), `goal` + `goalText(spec, world)` (needs the world: `challengeWorld(spec)`), `edict` (`edictInfo`), `boons` (`boonInfo`), `relic` (`relicInfo`), `general.kind`; your best: `record.daily[today]` |
| Streak | `dailyStreak(record.daily, today)`; best `record.bestStreak` |
| Calendar | `dailyCalendar(record, today, 28)`: `[{ date, number, played, met, onDay, bestSec, attempts, today, beforeEpoch }]`; a past day plays as practice |
| Scenarios | `scenarioList(record, seen)`: `[{ id, name, idea, blurb, icon, unlocked, unlockTopic, stars, best, starMarks }]`. `seen(topicId)` is your read of the MAIN save's Codex (`codexTopics.js`): Dragon Hunt needs `regionTypes`, The Fallen Rise `ashen`, Many Fronts `steward`, Kingmaker `relics`; the first two are always open |
| Star marks text | `spec.stars[i]`: `{ kind: 'met' }`, `{ kind: 'time', sec }`, `{ kind: 'risen', max }`, `{ kind: 'unbroken' }`, `{ kind: 'unbrokenShare', share }`, `{ kind: 'gold', n }`, `{ kind: 'crown', crown: 'unbroken' }` |
| Cosmetics | `bannerList(record)`: `[{ id, name, text, unlocked, selected }]`; `selectBanner(record, id)`; draw `record.banners.selected` on flags and settlements (ids `plain`, `ember`, `frost`, `gilded`, `ashenBone`). Purely visual |

## 5. Numbers (all in config) and the proofs

- A Daily: a 30x24 continent with 10-13 regions, enemy ladder depth 1..2.2 (`CHALLENGE_MODE.world.ladderSpan` 1.2), start War
  Council levels 8 (`DAILY.start`), goals conquer, capital, wins (8 with at most 1 lost) and holdout (4 scripted raids). A conquer day needs 3+ non-capital rival
  regions (else the next seed) and its capital Gates hold half the garrison (`DAILY.conquerMods`); 150 dates: all completed, slowest 19:33.
- The bot (`game/tests/meta.phase9.play.test.js`) completes 30 consecutive dates (median about 4:35, slowest about 15 min of active
  play at 1x), meets every scenario's goal with 3 stars, and misses the third star when it plays carelessly (one battle at a time, a
  weaker army).
- Scenario marks: Gatekeeper 3:00 / 2:30; Hold the Line half / all defenses unbroken; Dragon Hunt 3:00 / the Unbroken crown; Fallen
  Rise under 60 / under 30 risen; Many Fronts 4:00 / 2:00; Kingmaker 4000 / 8000 / 11000 gold in 5 minutes.

## 6. Checks for the QA section (`--only=challenges`)

A daily plays to completion through dev hooks; the share text matches `shareText(shareData(...))`; a scenario's stars are saved
(`record.scenarios[id].stars`); the main realm is byte-identical before and after (compare `serialize(mainState)`), except the +1
Renown of a claimed Daily.
