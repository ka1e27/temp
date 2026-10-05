# Phase 9: Daily Challenge and Scenarios (design + contract)

Status: **planned 2026-10-04**, to start once Phase 8's final gate is in. Lead: the Claude session. Engineers: **sim/meta** and **integration**.

Pace (from the user): build until playable, one QA pass at the end (the full deploy gate), then the user playtests.

**Why this phase.** After Phases 1–8 the long game is deep: dynasties, Legacy, Boons, Relics, rivals. A returning player still has only one thing to do: continue the realm. Successful short-session strategy games give a reason to come back every day:
- a **shared daily puzzle** that everyone plays on the same seed
- **handcrafted scenarios** that teach and test one idea each

There is no backend, so everything is seeded, local, and shareable as text.

---

## 9A. The Daily Challenge

- **The seed:** each calendar day (the player's local date) gives a seed, so everyone playing that date gets the same challenge.
- **The setup:** a **small continent** (about 10 regions), a fixed **Edict**, 2–3 fixed **Boons**, sometimes a Relic or a twist-heavy map, and a **goal**. Example goals:
  - Conquer the continent.
  - Topple the capital.
  - Win 6 battles with at most 1 loss.
  - Hold out against 4 raids.
- **The clock:** an **active-play timer**; scored by time, and lower is better. Crowns earned are the tiebreak.
- **Isolation:** the challenge runs in its own sandboxed state and never touches the main realm or its save. Generals don't carry in; you get a preset General for the day.
- **Attempts:** unlimited retries; your **best** counts. A "first attempt" result is recorded separately (the honest score).
- **The result screen:**
  - your time, crowns and attempts
  - a **calendar streak** (days in a row completed)
  - a **share text** like Wordle's:
    "Hex Dominion Daily #142 · 11:42 · 👑👑👑 · 1st try 🗡️🗡️🛡️🗡️🗡️🗡️". Copy to clipboard, no network.
- **History:** a local calendar of past dailies with best times. Past days can be played as **practice**, which doesn't count for the streak.
- **Unlock:** after the first conquest beyond the home region, so new players learn the main game first.
- **Reward to the main game:** a small one, so it doesn't feel mandatory. Completing a daily gives +1 Renown to the current dynasty, at most once per day; that's all.

## 9B. Scenarios (handcrafted challenges)

**What they are:** about 6 scenarios. Each is a fixed map, or a seed plus overrides, a fixed setup, and a goal. Each teaches or tests one idea, and is rated with 1–3 stars against time/condition targets.

| Scenario | The idea | Setup | Goal |
|---|---|---|---|
| **The Gatekeeper** | Siege | one capital with a Gate, your camp and 3 villages | take the keep in under 3:00 |
| **Hold the Line** | defense | 3 regions, waves of raids from two rivals | survive 8 minutes without losing a region |
| **Dragon Hunt** | the boss | the Dragon's Lair and a small army | slay the Dragon, with Bulwark-timing stars |
| **The Fallen Rise** | the Ashen | an Ashen region with a Barrow Keep | win with fewer than 30 risen |
| **Many Fronts** | several battles at once | 3 battles start together, Steward available | win all 3 |
| **Kingmaker** | economy and route choice | 5 minutes, a Gold Mine and a Relic region | the most gold at the end |

- **Unlocks:** each scenario unlocks after the system it teaches has been met in the main game (Codex discovery). The first two are always open.
- **Rewards:** stars are saved locally. Getting all 18 stars gives a cosmetic: a **gilded banner** for your realm's flag.

## 9C. Light cosmetics (the reward layer for 9A/9B)

Realm banner styles: plain, gilded, ember, frost, Ashen-bone. Unlocks:
- **Daily streaks:** 7 and 30 days.
- **Scenario stars:** all 18.
- **Deeds:** the existing gold tiers.

Banner style is chosen in Settings and shown on your flags and settlements. **Purely visual.**

---

## Contract (sketch; sim/meta writes the exact signatures in `docs/briefs/phase9-hookup.md`)

**sim/meta:**
- **Sandboxed mode states:** `createChallengeGame(kind, spec)` returns its own game state (a separate save key, never the realm's). The `spec` covers:
  - world-size overrides
  - fixed Edict, Boons, Relic and General
  - the goal
  - raid scripts
  - start troops
- **Seeds:** `dailySpec(dateYYYYMMDD)` is deterministic from the date.
- **Scenarios:** `scenarioSpec(id)`.
- **Goals:** `goalProgress(state, world)` and `goalMet(...)`. Scoring is `scoreFor(...)`, using active time and crowns.
- **Streak:** `dailyStreak(history, today)`.
- **Records:** daily results, scenario stars and banner unlocks live in a small lasting record, `state.generals.challenges` or a separate key. Write sanitizers.
- **Main-game reward:** the +1 Renown daily reward, at most once per date, applied to the main realm.
- **Pure throughout:** dates are passed in by the app layer; the pure code never calls `Date`.
- **Tests:**
  - the same date gives the same spec
  - each scenario's goal can be met; prove it with the campaign bot or a scripted run
  - the streak maths

**integration:**
- A **Challenges** entry on the title screen and in the HUD menu, opening a hub:
  - Today's Daily (the goal, the Edict, the Boons, your best)
  - the Scenarios list with stars
  - the calendar
  - cosmetics
- **Playing a challenge:** a compact goal tracker on the HUD, then the result screen with share text (clipboard) and Retry / Back.
- **Return:** coming back to the main realm restores it untouched.
- **Banner styles:** in Settings, and in rendering.
- **QA:** one final pass, exactly the deploy gate, plus a `--only=challenges` section:
  - a daily plays to completion through dev hooks
  - the share text format
  - a scenario's stars are saved
  - the main realm is untouched
- **Gallery:** `screenshots/phase9/`.
