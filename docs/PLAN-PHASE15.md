# Phase 15: Honest labels, robust on any device

Status: **in progress, 2026-10-07.** Lead: the Claude session. Two tracks, two engineers: **calibration (sim/meta)** and **robustness (integration)**.

Pace (from the user): build until playable, one QA pass at the end (the full deploy gate), then the user playtests.

**Why this phase.** Fourteen phases in, two kinds of debt have built up:
1. **Labels drift.** Every phase tuned the card's win chance for its own content, but measurements now show:
   - late-game **Hard** fights are won 31/31 at D3–D4, though Hard promises 35–60%
   - **Holy Ground Easy** is won only about 74%, though Easy promises 85% or more
   - the Throne reads harder than it plays

   A label the player can't trust breaks the core decision of the game: which fight to take.
2. **Slow-device bugs.** CI's slow runner found a real bug no fast machine showed: a card button moving under a tap. There are likely more, and the larger text sizes from Phase 14 haven't been audited on every panel.

---

## 15A. Label calibration (calibration engineer)

1. **Build `tools/labelAudit.mjs`.** It fights many real battles from campaign states (bot and human policy) across:
   - D1–D7, the Crown and Ascension 0/5/10
   - every rival personality: passive, aggressive, defensive, swarm, undying, raider, usurper
   - every twist and region type, capitals, the Gate and the Throne

   For each **label band** it records the win rate the card promised against the win rate achieved, as one table per slice, with sample sizes.
2. **Targets**, for slices with at least 30 fights:
   - each band's achieved rate falls inside its promised band (Easy ≥ 85%, Fair 60–85%, Hard 35–60%, Deadly < 35%), or within ±5 points of its edges
   - win chance within ±12 points of achieved (the existing test's tolerance)
3. **Fix the card, not the fights.** Use per-dynasty, per-personality and per-feature factors in `DIFFICULTY` config, each with its reason. Fights don't change, so pacing is unaffected; confirm that D1 human pace and the Phase 14 late-game tables are unchanged.
4. **Lock it in.** Extend the label tests so the table is guarded: a smaller, fast version runs in `npm test`.

## 15B. Robustness sweep (robustness engineer)

1. **Slow-device sweep.** Run **every** `check.mjs` section with `--cpu=4`, and phone sections also at `--cpu=6`. Then classify each failure:
   - **Real UX bug:** a layout shift under input, a race, a missed click, a timer drift. Fix it in the game, the way Phase 10's card-dock hold was fixed.
   - **Check staging only:** make the check robust without weakening it, using `clickReal({ stable: true })`-style aiming.

   Add regression checks for any real bug found.
2. **Large text audit.** At Large and Larger on a 360×740 phone and a 390×844 phone, open every panel and dialog the checks can reach and assert that nothing is clipped or off-screen, every button is reachable, and every text is whole. The list: Realm, Generals, War Council, Regions, Codex, Challenges hub, the founding ceremony (every page), the Boon draft, the Relic claim, the ending, the Duel and event dialogs, Settings. Fix what fails, as Phase 14 did for the Council and the battle HUD.
3. **Layout-shift guard.** Add a generic hint-monitor assertion: no interactive element under an active pointer moves more than 2 px between pointerdown and pointerup, across all check sections. That catches the whole class of the Phase 10 bug.

**QA (both), one final pass, exactly the deploy gate:**
- `npm test`
- the full `node tools/check.mjs` (in `--only` groups if needed)
- `node tools/check.mjs --base=temp`
- the `--cpu=4` sweep green
- the new label audit table
- `hints.mjs`, `iconcheck` and `perf.mjs`

Gallery: `screenshots/phase15/`, covering the Large-text panels and before/after shots of the bugs found.
