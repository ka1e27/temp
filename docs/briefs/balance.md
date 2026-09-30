# Brief — balance & AI engineer

(Issued by the lead designer on 2026-09-29. A first engineer started this on Sonnet 5 and may
have left partial work: `tools/campaign.mjs`, edits to `game/config/*.js`,
`game/battle/{ai,bot,difficulty}.js`, `game/meta/{progression,upgrades}.js`. Review what
exists first — run `npm test` — keep what is good, finish the rest.)

You are the balance & AI engineer on the Hex Dominion 2 team. The modules are built; your job
is to make the CAMPAIGN feel right: a smooth difficulty curve where upgrades matter, battles
last the target length, the enemy fights back intelligently, and the region card's difficulty
label tells the truth. The lead designer sets the targets below; you build the measurement
tools and tune.

## Read first
`docs/DESIGN.md` (§2, §3, §4, §5), `docs/ARCHITECTURE.md` (§4–§6),
`docs/INTEGRATION-NOTES.md`, `CLAUDE.md`, then all of `game/config/*.js`, `game/battle/*.js`
(esp. `sim.js`, `ai.js`, `bot.js`, `difficulty.js`, `arena.js`), `game/meta/*.js` (esp.
`progression.js`, `upgrades.js`, `economy.js`), and `tools/balance.mjs` (you own it).

## Environment
Repo `C:\Users\kyleg\Projects\temp`, Windows, Bash tool (Git Bash), Node 24, branch
`redesign`. An integrator may be working in the same tree (main.js, scenes, renderer — do
not touch). Never delete/move files; never run git commands that change state. Keep each tool
call short: run long sweeps in the background or in smaller batches; never let one command
run longer than ~5 minutes.

## You own
`tools/campaign.mjs`, `tools/balance.mjs`, `game/battle/ai.js`, `game/battle/bot.js`,
`game/battle/difficulty.js`, `game/config/battle.js`, `game/config/meta.js`,
`game/tests/balance.*.test.js`, and — for tuning only — the difficulty heuristic in
`game/meta/progression.js` and the cost numbers in `game/meta/upgrades.js`. First refactor:
move every upgrade's `baseCost`/`growth`/`magnitude` into a table in `game/config/meta.js`
(e.g. `UPGRADE_TUNING`) that `upgrades.js` reads (keep the `UPGRADES` export shape identical;
meta tests must stay green).

## 1. `tools/campaign.mjs` — a virtual player that plays a whole continent
Headless, deterministic per seed, fast (a full campaign in a few seconds). Loop over decision
points on a simulated wall clock:
- Idle income accrues continuously (`tickIncome`), including during battles (battles at 1×:
  battle seconds = wall seconds).
- Human-like upgrade policy: keep Steel/Armour/Recruitment/Muster roughly level (buy the
  cheapest of them), buy Taxes whenever it is the cheapest thing overall, unlock Firestorm
  after the 3rd conquest, Levy/Bulwark/March later when affordable, level powers
  occasionally. Document the policy in the file header.
- Attack when a frontier region's player-facing difficulty (`difficulty()`) is Easy or Fair;
  among those pick best value (income ÷ strength, prefer perks the player lacks); accept
  surrender when offered. Otherwise wait until the next purchase is affordable.
- Battles: full sim — `buildArena` + `createBattle`, each tick issue `think()` (enemy AI) and
  `decide()` (bot), `step()` at `TICK_SEC`, cap 8 simulated minutes (timeout = loss).
  Losses cost only time; retry after more upgrades.
- Output: per-conquest timeline (n, region, tier, faction, label at attack, ratio, result,
  battle s, wall clock, wait since previous) + summary (time to 1/5/10/20/all regions, win
  rate, median battle length by tier band, longest wait, gold by upgrade). Flags:
  `--seeds=1,2,3`, `--verbose`, `--json`.

## 2. Pacing targets (median across ≥ 5 seeds)
| milestone | target (wall clock) |
|---|---|
| first conquest | ≤ 2 min (tutorial region easy but ≥ 40 s of battle) |
| 5 regions | 12–20 min |
| 10 regions | 35–60 min |
| 20 regions | 2–3.5 h |
| whole continent (~28) | 4–7 h |
- Longest wait between conquests ≤ 40 min. Battle length: tier 1–2 45–90 s; mid tiers
  60–120 s; capitals 120–180 s. Virtual-player win rate 70–90 % (rarely two losses in a row).
- Upgrades must matter: with Army upgrades forbidden the virtual player must stall hard by
  ~region 6–8.
Knobs: `ENEMY_SCALING`, `BATTLE.enemyStart`, site stats, `ECONOMY` (incomePerTier,
bountySeconds), upgrade costs/growths/magnitudes, `PLAYER_BASE`. One inline comment per knob
moved, with the measured reason.

## 3. Make the difficulty label tell the truth
The heuristic ratio mis-predicts outcomes (the bot wins ~100 % at ratio 0.5–1.0 because it
takes settlements one at a time). Extend `tools/balance.mjs` (sweep player strength across
tiers and personalities, n ≥ 12 per cell), fit meta `difficulty().ratio` → bot win rate, then
adjust the heuristic so labels mean **Easy ≥ 85 %, Fair 60–85 %, Hard 35–60 %,
Deadly < 35 %** consistently across tiers/personalities (account for sequential capture —
e.g. weight the keep and strongest site, or scale with site count). Surrender at ratio ≥ 3 ≈
100 % wins. Add `game/tests/balance.labels.test.js` (small n, a few seeds, generous
tolerances, < 20 s).

## 4. A smarter enemy (`game/battle/ai.js`)
Concentrate force (converge 2–3 sites on one target), punish over-extension (counterattack a
player site that just emptied itself, and the War Camp when weak), reinforce threatened sites
early, don't double-commit, and when clearly losing commit everything to one counterpunch at
the player's weakest site. Keep personalities distinct (aggressive / defensive / swarm /
passive). Deterministic (no Math.random) and cheap (think() ≤ 0.5 ms). Keep battle tests
green; add tests for the new behaviours.

## Final report
The refactor; campaign summary for 5 seeds before and after tuning; label calibration table;
every config change with its reason; AI changes; the no-Army-upgrades stall result; test
summary; anything the lead should decide.
