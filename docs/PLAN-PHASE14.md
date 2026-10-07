# Phase 14: The long road, and play your way (late-game pacing + accessibility and options)

Status: **in progress, 2026-10-06.** Lead: the Claude session. Two independent tracks, two engineers: **balance (sim/meta)** and **options (integration)**.

Pace (from the user): build until playable, one QA pass at the end (the full deploy gate), then the user playtests.

---

## 14A. Late-game pacing (balance engineer)

**The problem (measured in Phase 13).** Phase 11 tuned the first hour, but later dynasties have outliers:
- seed 12's normal D7 continent takes about **7.5 h**, and its Crown continent about **14 h**; seed 8's Crown continent about 7.8 h
- Ascension 1 had a **105-minute** wait on one seed

Nobody has looked at D2–D7 at a *human* pace.

**Do:**
1. **Extend the human policy** (`tools/campaign.mjs --policy=human`) to whole dynasties D1–D7 and the Crown, with realistic Legacy and Edict choices and the human shopper.
   - Report per dynasty: the median continent time, the longest single wait, the share of minutes with an Easy/Fair target, and the worst seeds.
2. **Find what makes the late walls.** Candidates: the ladder's top end, capital or Gate scaling with dynasty level, rival personality stacking, archipelago fords, Unrest's caps late, and income vs cost curves at high levels.
3. **Fix with the gentlest levers.** Targets, human policy, 12+ seeds:
   - **No dynasty median above 2.0 h** for D2–D7.
   - **No single wait over 30 min** on more than 1 of 12 seeds per dynasty, with none over 60.
   - **The Crown continent median 2.5 h or less.**
   - **Ascension:** A1 no worse than A0 plus 15%; A10 clearly harder but with no wait over 60 min.
   - **Guards:** D1 human pace unchanged (26 battles, 89%, 4.9 min idle); the optimal campaign stays sane (D1 1.0–1.6 h).
4. **Results:** a before/after table per dynasty.

## 14B. Play your way: accessibility and options (integration engineer)

**Do:**
1. **Colour-vision presets** in Settings: *Default*, *Deuteranopia/Protanopia friendly* and *Tritanopia friendly*.
   - Each preset remaps faction colours, plus the player blue, for the chosen vision. Keep each faction's identity, so emblems and patterns stay the same.
   - Add an optional **pattern overlay** on territory (stripes, dots or cross-hatch per faction) for any preset.
   - **Verify** with the existing CIEDE2000 tooling: under each preset, every pair of the 8 factions clears **25** for the targeted vision.
2. **Text size:** Normal, Large and Larger (rem scaling across HUD, panels, cards and toasts). Layouts must still fit a 360 px phone at Large; at Larger, panels may scroll but nothing clips.
3. **High-contrast UI:** stronger panel borders, opaque backdrops, and a minimum 7:1 contrast for body text.
4. **Motion and effects:** keep Reduce Motion, and add an **Effects** slider (Full / Reduced / Minimal) that scales particles, wisps, screen shake and pop counts. Minimal must stay readable.
5. **Controls:**
   - a **rebindable keyboard** map (powers 1–5, send sizes, pause, speed, G for the ability, and others), with conflict detection and a reset
   - a **"hold to confirm" option** for Retreat and other irreversible actions
6. **Audio:** separate Music / Effects / Voices volume sliders, and mute when the tab is hidden (on by default).
7. **Persistence:** all options are saved and apply live. The Codex gets an "Options" topic.

**QA (both tracks), one final pass, exactly the deploy gate:**
- `npm test`
- the full `node tools/check.mjs` (in `--only` groups if needed)
- `node tools/check.mjs --base=temp`
- a new `--only=options` section: each preset applied, the CIEDE2000 assertion per preset, text sizes fit at 360 px, a rebind works, hold-to-confirm, the volume sliders
- `hints.mjs`, `iconcheck` and `perf.mjs` (Effects: Minimal should only be faster)

Gallery: `screenshots/phase14/`.
