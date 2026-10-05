# Phase 10: Cohesion (the first hour, and the rough-edge sweep)

Status: **in progress, 2026-10-05.** Lead: the Claude session. One engineer owns the whole tree for this phase (cross-cutting polish).

Pace (from the user): build until playable, one QA pass at the end (the full deploy gate), then the user playtests.

**Why this phase.** Nine phases each added a system with its own unlock moment, hint, toast or dialog:
- the frontier and raids
- Generals and Renown
- region types, twists and events
- the Bounty Board, the streak, Deeds and Vendettas
- Edicts and Legacy
- the Ashen Host
- Boons and Relics
- the Codex
- Challenges

Each one was checked alone; nobody has checked them *together* from a new player's seat. Phase 10 measures the first hour as a whole, spaces it out, and clears the accumulated rough edges.

---

## 10A. The first-hour audit (measure, then pace)

1. **`tools/firstHour.mjs`** (CDP, no dependencies). A scripted new player plays the first 60 minutes of a fresh realm with real presses, at a human-ish pace: it attacks the best Easy or Fair region, accepts or dismisses offers, and picks the first Boon. It logs every interruption with a timestamp:
   - tutorial hints
   - toasts (by kind)
   - dialogs and modal moments (draft, Relic claim, recruit, events, ceremony)
   - leader lines
   - system unlocks (first time the Bounty Board, Renown, Boons, the Codex hint and Challenges appear)

   Output: a minute-by-minute table, plus a timeline of unlocks.
2. **Targets:**
   - **Interruptions:** at most **3 per minute** on average after the first 5 minutes; never more than **6 in any single minute**.
   - **Modal moments:** never **two in a row** without at least 20 s of play between them, except the fixed post-battle queue.
   - **Unlocks:** new systems arrive **one at a time**, at least about **3 minutes apart**. No minute introduces two new systems.
   - **Hints:** each tutorial hint is still shown exactly once and lands on its target, as `hints.mjs` already checks.
3. **Fixes** where the targets fail:
   - stagger unlock thresholds
   - merge or quiet low-value toasts, e.g. batch several Deed or contract completions into one toast
   - delay non-urgent hints until a calm moment, after the current battle or dialog
   - make leader banners respect a quieter rate during the first 10 minutes

   Report the before/after table.

## 10B. The rough-edge sweep (known issues, from STATUS and the Phase 6–9 reports)

- **Daily result time vs share text:** the result shows 1:37 while the share line says 1:38. Use one formatter for both.
- **Goal tracker wording:** "0/1 taken" for capital goals should read naturally, e.g. "Capital: not yet taken" / "Capital taken". If the text comes from `goalProgress`, fix it there or format it in the UI.
- **Leader banner over modal cards:** the voice banner can sit above the challenge result card and other modal cards. While a modal card is open, the banner should wait or sit behind the dimmer.
- **Phase 9 gallery:** retake `desktop-04-scenario-result.png`, which still shows the old recruit card.
- **Phase 4 gallery:** the Champion frames (`champion.png`, `champion-fallen.png`) don't show the Champion clearly. Re-shoot them with a staged fight where it lives long enough.
- **Cartographer** (the Boon that lets Quick Conquest work on Fair regions) is untested in play. Add a real-input check: own the Quick Conquest Legacy node plus Cartographer, then a Fair region shows Quick Conquest and it resolves.
- **Gravewarden's Lantern:** confirmed as intended. No dead rise near your camp, so none burn either. Add one line to its Relic text so players know Firestorm has nothing to burn there.
- **Windows-only:** the modulepreload staleness check fails in CRLF checkouts although the content is identical. Make the comparison line-ending-insensitive.
- **INTEGRATION-NOTES:** a short "how the post-battle and top-lane queues work" section, since they are now shared infrastructure.

---

**QA:** one final pass, exactly the deploy gate: `npm test`, the full `node tools/check.mjs`, `node tools/check.mjs --base=temp`. Run `tools/firstHour.mjs` before and after, plus `hints.mjs` in two batches and `iconcheck`.
