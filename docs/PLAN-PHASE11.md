# Phase 11: Early flow (there should always be a fight worth taking)

Status: **planned 2026-10-05**, to start when Phase 10's tweaks are in. Lead: the Claude session. Engineer: **balance (sim/meta)**, plus small UI touches if needed.

Pace (from the user): build until playable, one QA pass at the end (the full deploy gate), then the user playtests.

## The problem (measured)

**What the audit saw.** Phase 10's first-hour audit (`tools/firstHour.mjs`, seed 7) played a human-paced new player for 60 minutes:
- **The player:** it attacks the best Easy or Fair region, tries Hard after 2 minutes with nothing better, and shops every 3 minutes.
- **The result:** **only 9 battles in the hour.** After about minute 5 every frontier region read Hard or Deadly, so the player fought roughly once every 9–10 minutes and waited in between. Battles came at about minutes 1, 4, 9, 18, 26, 35, 40 and so on.

**Why it matters:** that is the original playtest complaint ("fight the next area, then upgrade", boring) coming back in a new form: fight, then **wait**.

**Why the tuning missed it:** the campaign simulator (`tools/campaign.mjs`) plays optimally. It buys the best-value upgrade at once, and its D1 median of about 1.27 h means a conquest roughly every 3 minutes. A person progresses at about half that rate. Two upgrade-cost raises (×1.2 in Phase 6, ×1.5 in Phase 7) were tuned against the optimal bot, which likely widened the gap for real players.

## Targets (human-paced first-hour bot, several seeds)

- **At least 18 battles in the first hour** (median over at least 6 seeds), up from 9.
- An Easy or Fair frontier region is available in **at least 75% of the minutes** after minute 3.
- The **longest stretch with nothing worth attacking** in the first hour is at most **4 minutes**.
- **The optimal campaign:** D1 median stays within **1.0–1.6 h**. A floor slightly lower than before is fine; the human pace is what matters. Waits over 40 min on at most 2 of 12 seeds, and D2 and D3 within the existing ratios.
- **Labels stay honest:** the label and win-chance tests pass.

## Levers (measure each; prefer the gentlest that works)

1. **The early cost curve.** Make the early War Council levels cheaper and keep late ones dear: for example, a ramp on `UPGRADE_COST_MULT` from about 1.0 at low levels to 1.5 at high levels, instead of a flat ×1.5.
2. **The early income curve.** Raise income from the first few regions slightly, so the first upgrades come sooner.
3. **The early difficulty ladder.** Soften tiers 2–3 slightly, so the second ring isn't a wall right after the first.
4. **What the bot is willing to fight.** Check whether "Hard" is genuinely winnable early with powers. If a Hard fight is often a fine fight, the label bands may be too pessimistic for the player's actual tools. Keep the labels honest: change the fights, not the words.
5. **Bounty and crown payouts** in the first ring, if gold is the bottleneck.

## Deliverables

- **The tool:** a multi-seed mode for `tools/firstHour.mjs`, or a faster headless equivalent driven by the campaign machinery with a "human" policy (shop every 3 minutes, fight Easy and Fair, Hard after 2 minutes idle). The point is to measure the targets cheaply across seeds.
- **The tuning:** changes in config, each with its reason written beside it.
- **The results:** a before/after table (battles per first hour, Easy/Fair availability, longest idle stretch, the optimal campaign's D1/D2/D3).
- **QA:** the full deploy gate (`npm test`, the full `check.mjs` (in `--only` groups if needed), `--base=temp`), plus `firstHour.mjs` on seed 7.
