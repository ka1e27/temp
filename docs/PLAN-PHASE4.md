# Phase 4: Goals and Rivals (design + contract)

Status: **in progress, 2026-10-03.** Lead: the Claude session. Engineers:
- **sim/meta** (pure modules, config, tests, campaign)
- **integration** (UI, loops, tutorial, checks)

**Why this phase.** After Phases 1–3 the map is varied and alive, but the original complaint still holds between battles: there is no goal between "this battle" and "this continent". Phase 4 adds four kinds of goal:
- **medium-term goals:** the Bounty Board
- **momentum:** the Conquest Streak
- **long-term goals that persist:** Deeds
- **a personal antagonist:** Rival Vendettas

It also clears the Phase 3 rough edges.

Pace (user, 2026-10-03): build until playable; one QA pass at the end; the user playtests.

---

## 4A. The Bounty Board (3 contracts at a time)

**How it works:**
- Three optional **contracts** are always on offer, each with a reward.
- Complete one and it pays out at once: a toast, a Chronicle line, and a new contract drawn into its slot.
- Contracts are seeded per dynasty from `(seed, dynasty, drawCount)`, so they're deterministic.
- **Reroll** one contract: free once per 20 active minutes, otherwise 1 Renown.
- No time limits; contracts wait for you. Never in the tutorial: the board unlocks after the first conquest beyond the home region.
- **Drawing:**
  - Only contracts that are currently possible are drawn. "Conquer a Gold Mine" needs an attackable Gold Mine on the frontier, or one within 2 steps of it.
  - The three never share a kind.
  - A contract's reward scales with the realm: gold = income/s × `minutes` × 60, plus Renown.

**Contract kinds** (config: `game/config/bounties.js`; each is measured from data the game already produces):

| Kind | Text | Measured from |
|---|---|---|
| `noPowers` | Win a battle without using a power | battle events (`power` cast by the player) |
| `forts` | Capture N forts or towers in one battle (N = 2–3) | `capture` events by site type |
| `swiftHard` | Win Swift on a Hard or Deadly region | crowns + the label at attack time |
| `cleanDefense` | Hold a defense without losing a settlement | the defense result + tracker |
| `typed` | Conquer a {Gold Mine / Monastery / Bandit Hold / Ruins} | `conquer().type` |
| `twist` | Win a battle under {Night / Blizzard / Flooded / Holy Ground / Siege / Raid} | arena twist + win |
| `chain` | Win 2 conquests within 10 active minutes | conquest timestamps (active seconds) |
| `general` | Win a battle commanded by {General} | `run.commander` |
| `ability` | Use {General}'s ability in a won battle | `ability` event |
| `prosper` | Raise any region to Prosperity {II / III} | the prosperity level-up hook |
| `fortify` | Build N fortification levels (N = 2–4) | the forts build hook |
| `retake` | Retake an occupied region | `conquer().retake` |
| `scout` | Scout a region, then conquer it | the intel state |

**Rewards.** Gold for every contract, Renown on harder ones (1–3), and on some a General XP bundle (+150 XP to the commander of that win). Every number lives in config.

**UI:**
- a **Bounties** HUD button (scroll-with-seal icon) with a dot when a contract is done
- or a compact board in the Regions panel; integration picks whichever reads best on phone and records the choice
- each contract row shows the text, progress (e.g. 1/2), the reward, and Reroll
- completion gives a toast with a seal-stamp animation

## 4B. The Conquest Streak (momentum)

- Each conquest within `windowSec` (8 active minutes) of the previous one raises the streak by 1. The streak multiplies conquest bounty: 1 → ×1.0, 2 → ×1.1, 3 → ×1.2, 4 → ×1.3, 5+ → ×1.5.
- A **won defense keeps the streak alive**: it refreshes the window but doesn't add to the streak. A lost attack or the window running out resets it to 0.
- **Retreat:** a retreat also resets the streak. The UI warns about this on the Retreat confirm.
- **HUD:** a flame chip beside gold, "×1.2 · 3", with a ring that drains as the window runs out. It's hidden at 0–1.
- **Reduce Motion:** no flicker; just the static flame.
- Renown is not multiplied, only gold.

## 4C. Deeds (persistent milestones)

- About 24 Deeds in bronze, silver and gold tiers.
- They **persist across dynasties**, stored with the Generals roster outside the per-dynasty state.
- Each earned Deed grants a small **permanent** bonus, capped in config so the sum stays modest. The pacing budget is +10% power-equivalent at most once all are earned.
- They're shown in the Realm panel as a grid: icon, name, progress bar, and the reward line. An earned Deed gets a toast and a Chronicle line.

**Examples** (final list in `game/config/deeds.js`):

| Deed | Tiers | Reward per tier |
|---|---|---|
| Conqueror | conquer 10 / 50 / 200 regions (lifetime) | +1% income |
| Warden | win 5 / 25 / 100 defenses | +2% settlement defence |
| Crowned | earn 25 / 100 / 300 crowns | +1% bounty |
| Dragonslayer | slay a Dragon | +1 Renown at each dynasty start |
| Kingbreaker | topple each rival capital (3) | +3% attack vs that faction's regions |
| Contractor | complete 10 / 40 / 120 bounties | +1 free reroll per dynasty |
| Unstoppable | reach a 3 / 5 / 8 streak | streak window +30 s |
| Patron | hold a region at Prosperity III / IV | +5% Festival discount |
| Mentor | a General reaches level 5 / 10 | +5% General XP |
| Builder | build 10 / 40 fortification levels (lifetime) | −3% fortification cost |
| Duellist | win 1 / 5 Duels | +1 Renown per Duel won |
| Nemesis | defeat 1 / 3 Vendettas | +5% vs Vendetta war bands |

## 4D. Rival Vendettas (a personal antagonist)

**Grudge.** Each rival leader keeps a **Grudge** of 0–100 against you. It rises when you:
- take one of their regions: +12, a capital +40
- beat one of their raids: +8
- sabotage them: +6
- decline their Duel: +10
- win a Duel against them: +5

It falls slowly with active time (−1 per 2 active minutes) and never while you're away.

**Grudge thresholds:**
- **At 50:** the leader voices a warning (a new `grudge` trigger).
- **At 100:** they swear a **Vendetta**.

**The Vendetta** is a special raid, led **by the leader in person**:
- **Warning:** 90 s (double a raid's), with a red banner: "Khan Bokbek swears vengeance: Ashford, in 1:30".
- **Target:** one of your regions bordering them. It prefers the one you took from them most recently, never the home region.
- **Force:** the war band is ×1.5 a normal raid's, plus a **Champion** squad shown with the leader's banner. The Champion is a distinct squad flagged in the sim. When it dies the war band's attack falls by 20%, and its death shows "{Leader}'s champion has fallen!"
- **Rules:** it can't stack with another raid on the same region. It takes one of the `maxDefenses` slots; if none is free it waits at the border, just like a raid.
- **Win:**
  - +4 Renown and a **Trophy**: their banner hung in the Realm panel, giving +5% attack against that faction for the rest of the dynasty, stacking to 3.
  - Grudge resets to 0, and a defeated-taunt voice line plays.
- **Lose:** the region is occupied as normal; Grudge resets to 30 and the leader gloats.
- **Capital:** once you hold their capital, the leader can't swear Vendettas (they're broken; the Champion joined you as a General).
- **Away:** never during away time; Vendettas only happen live.

**UI:**
- a small grudge meter on each rival's leader portrait in the Regions panel and on the hover/card of their regions ("Grudge 72/100")
- the Vendetta banner and the champion's squad sprite with a leader pennant
- the Trophy wall in the Realm panel

## 4E. Phase 3 rough edges

- **Leader lines:**
  - triggers for `plague` (the plagued leader complains), `merchant` (any neighbour grumbles about the caravan), `duelWon` and `duelLost`
  - the new `grudge`, `vendetta`, `vendettaWon` and `vendettaLost` triggers
  - lines for every faction, in config/leaders.js style, within `maxLineChars`
- **A dismissed world-event offer can be reopened** until it expires: a small envelope pip on the HUD while an offer is pending.
- Re-shoot the Phase 3 gallery frames that changed (siege gate, plague, duel toast) during the final pass only.

---

## Contract (sim/meta ↔ integration)

All modules are pure. Every mutating function is `(state, world, …, now?)` → a result object, and mutates `state` in place, as the existing meta modules do. Times are **active seconds** (`state.frontier.activeSec`) unless named `Ms`.

**State and save**
- `state.bounties = { v:1, slots:[Contract,Contract,Contract], draws, freeRerollAt, completed }`
  - `Contract = { id, kind, params, progress, goal, reward:{gold,renown,xp}, text }`
  - Rendering text is the UI's job via `bountyText(contract, world)`; `text` may be omitted.
- `state.streak = { v:1, count, lastAt, best }`
- `state.grudges = { v:1, [faction]: { value, warnedAt, vendettaAt } }`
- `state.trophies = { v:1, [faction]: n }` (per dynasty)
- **Deeds persist:** `meta.deeds = { v:1, progress:{[deedId]:number}, earned:{[deedId]:tier} }`, stored next to the Generals roster, which survives a new dynasty.
- `save.js` gets sanitizers for all of these. `foundDynasty` resets `bounties`, `streak`, `grudges` and `trophies`, and keeps the deeds.

**`game/meta/bounties.js`**
- `ensureBounties(state, world)`: draws to 3 slots when the board is unlocked; idempotent
- `bountyText(contract, world, state) -> string`
- `bountyProgress(state, world, contract) -> {progress, goal}`
- `onBattleEnd(state, world, run, result, battleSummary) -> Completed[]`: `battleSummary` includes `powersUsed`, `capturesByType`, `twist`, `labelAtAttack`, `commander`, `abilityUsed`, `kind`, `won`, `crowns`
- `onConquest(state, world, regionId, conquerResult) -> Completed[]`
- `onProsperity(state, world, levelUps) -> Completed[]`
- `onFortBuilt(state, world, regionId, type) -> Completed[]`
- `onScout(state, world, regionId)`
- `claimCompleted(state, world, completed, now) -> {gold, renown, xp, replaced:[slotIndex]}`: integration calls this right after any `on*` returns completions; the contract pays and redraws
- `rerollBounty(state, world, slotIndex) -> {ok, cost:'free'|number, reason?}`

**`game/meta/streak.js`**
- `streakMultiplier(state) -> number`
- `streakInfo(state) -> {count, mult, remainingSec, windowSec}`
- `onStreakConquest(state)`, `onStreakDefenseWon(state)`, `onStreakBroken(state, reason)`
- `tickStreak(state)`: expires the streak on the window
- `conquestBounty` / `conquer` apply the multiplier to gold, and `conquer()` returns `{ …, streak: {count, mult} }`

**`game/meta/deeds.js`**
- `deedProgress(meta, state) -> [{id, tier, next, progress, goal, reward}]`
- `recordDeed(meta, key, amount|value) -> Earned[]`
- `deedBonuses(meta) -> {incomeMult, defenceMult, bountyMult, attackVs:{[faction]:mult}, renownAtDynastyStart, freeRerolls, streakWindowSec, festivalDiscount, xpMult, fortCostMult, renownPerDuel, vsVendetta}`. Folded into `playerBattleStats`, economy, `foundDynasty`, etc. by sim/meta: one place, no UI math.

**`game/meta/grudges.js`**
- `addGrudge(state, faction, reason, now) -> {value, crossed:'warn'|'vendetta'|null}`
- `tickGrudges(state, world, activeDt)`
- `grudgeInfo(state, faction) -> {value, max, warned, broken}`
- **The Vendetta is a frontier raid:**
  - `tickFrontier` schedules it when Grudge hits 100, as a raid with `vendetta: { faction, leader }`, a longer telegraph and a stronger war band.
  - `buildDefenseArena(…, { vendetta: true })` adds the Champion squad, a squad with `champion: true`, and the sim applies the attack drop when it dies, emitting a `championFell` event.
  - `defenseReward` handles the Trophy and Renown and returns `{ vendetta: { won, trophy, faction } }`.
- `trophyBonus(state, faction) -> mult`, folded into `playerBattleStats`

**Leader voices.** New triggers in `config/leaders.js`: `grudge`, `vendetta`, `vendettaWon`, `vendettaLost`, `plague`, `merchant`, `duelWon`, `duelLost`. Each has lines for every rival faction, within `maxLineChars`, and passes the existing tests.

**Integration hooks:**
- **Battle end:** call `bounties.onBattleEnd` with a `battleSummary` built from the crown tracker plus a small new tracker field.
  - Sim/meta extends the crown tracker with `powersUsed`, `capturesByType` and `abilityUsed`, so it survives save/reload; integration doesn't keep its own counters.
- **Other hooks:** call `onConquest` / `onProsperity` / `onFortBuilt` / `onScout` and `claimCompleted`; `recordDeed` at the matching moments, or sim/meta records deeds inside the meta functions where possible (preferred).
- **Streak:** tick it in the frontier loop.
- **Grudge and Vendetta UI** as in §4D. Voice triggers on the matching moments.

**Pacing guard (sim/meta).** With streak, deeds and trophies on, the campaign (D1/D2/D3, 12 seeds) must stay within:
- **D1 median:** 1.1–1.6 h
- **Waits over 40 min:** on at most 2 of 12 seeds per dynasty

The streak and deeds may speed play up a little; that's intended, within those limits. The campaign bot reasonably takes contracts it's already meeting (no special play needed) and fights Vendettas with the steward model, like raids.
