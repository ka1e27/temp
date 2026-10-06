# Phase 12: The Sea Kings (an archipelago, and a rival who comes from the water)

Status: **planned 2026-10-05**, to start after Phase 11 and the CI fix land. Lead: the Claude session. Engineers: **sim/meta** and **integration**.

Pace (from the user): build until playable, one QA pass at the end (the full deploy gate), then the user playtests.

**Why this phase.** Rival rotation (Phase 6) made the *opponent* vary from dynasty 2 on. Every continent is still one landmass, though, so the *map* never asks a new question. Phase 12 adds a **different kind of continent** and the rival who rules it. This was the last unbuilt item of Plan D in PROGRESSION-PLANS.md.

---

## 12A. Archipelago continents

- **When they appear:**
  - From **dynasty 3**, a founding has a seeded 1-in-3 chance of an **archipelago**: 3–5 islands instead of one landmass.
  - The founding ceremony's summary says so ("The House of X sets sail…").
  - The Open Roads Edict and Legacy nodes are unaffected.
- **Fords and harbours.** Islands are linked by **fords**: shallow sea tiles that squads can cross at **×2.5 march cost**, shown as sandbars. Each island has 1–2 **harbours**, coastal settlements that act as **ports**.
- **Sea lanes.** A squad sent between two islands that each have a port you hold goes by a **sea lane**: a fast path along the coast (×0.6 march cost), but exposed. Enemy towers on the coast fire at it.
- **Battle arenas:**
  - A battle in an island region uses that island's tiles plus any ford tiles touching it.
  - A region that touches the sea gets a **harbour site** in its arena: holding it lets your squads reach other coastal sites by sea lane.
- **World generation** must stay byte-identical for every non-archipelago seed (as in Phases 5 and 6), and the start region is always on the largest island.

## 12B. The Sea Kings (a sixth faction; rotates in from dynasty 3, always on archipelagos)

**Look:** sea-green and white, with a **trident** emblem. It must stay distinct from every faction under all four kinds of vision; check with the a11y tooling.

**Personality: `raider`.** It holds its land lightly and **strikes from the sea**. Its raids can target **any** of your coastal regions, not only bordering ones. The war band lands at your harbour, so a harbour of yours with fortifications matters.

**Signature mechanic: Longships.** In battle, the Sea Kings' squads can move by sea lane between coastal sites they hold, which makes them fast and slippery. Taking their **harbour sites** cuts their lanes.

**Leader:** **the Sea Queen** (seeded name, e.g. "Queen Halvor of the Grey Tide"). A full set of voice lines for every trigger: dry, salt-sharp, mocking.

**Capital boss: the Tide Fortress.**
- It has a Siege Gate, like every capital.
- **The Tide:** every 40 s, the ford tiles around the fortress flood for 10 s. Squads caught on them lose 30%. It's telegraphed by a rising-water ring 4 s ahead.
- Holding the fortress's harbour site stops the Sea Kings' reinforcements arriving by sea.

**Its General, recruited when you topple the Tide Fortress: the Admiral.**
- Style: swift.
- Passive: your squads using sea lanes take no tower fire.
- Ability, **Broadside:** for 8 s, every coastal enemy site loses 2% of its troops per second.
- A 1-of-2 skill tree like the others.

**Everything else applies to them too:** grudges, Vendettas (the Queen's Champion is a **Reaver Captain**), Duels and Plague.

## 12C. Content that fits the sea

- **+3 Boons:**
  - **Navigator:** fords cost ×1.5 instead of ×2.5.
  - **Privateers:** each enemy harbour you capture pays 20 s of income.
  - **Harbour Chain:** every port you hold gives your sea-lane squads +10%, up to +30%.
- **+2 Relics:**
  - **Astrolabe:** sea lanes are ×0.4 instead of ×0.6.
  - **The Drowned Crown:** archipelago continents only; the Tide never floods your squads.
- **+1 world event: Shipwreck.** A wreck washes up on one of your coasts. Salvage it for gold, or leave it for its Relic chance. It's opt-in.

## Balance targets

- D3+ with an archipelago: median within **0.9–1.5×** a land D3; waits over 40 min on at most 2 of 12 seeds.
- Sea Kings fights take at most **1.25×** comparable battle time.
- Labels stay honest for `raider`. The Tide Fortress reads honestly; fewer than 1 in 5 of its battles time out.
- The Phase 11 human-pace first-hour targets for **dynasty 1** are unchanged (archipelagos start at dynasty 3).

## Contract (sketch; sim/meta writes the exact signatures in `docs/briefs/phase12-hookup.md`)

**sim/meta:**
- **World:** `generateWorld(seed, { dynasty, edict, rivals, archipelago })`, with ford tiles, harbours and sea-lane edges. `archipelagoFor(seed, dynasty)`.
- **Faction:** `FACTIONS[6]` Sea Kings with personality `raider`, rotation from dynasty 3, always on archipelagos.
- **Movement and AI:** sea-lane routing (`routing.js`), fords' march cost, coastal-raid targeting, Longships in the AI.
- **The Tide Fortress:** the Tide event (`tideRising` telegraph, then `tideFlood`).
- **New content:** the Admiral, the Sea Queen's lines, the Boons, Relics and event.
- **Pacing guard and tests.**

**integration:**
- **Rendering:**
  - archipelago map rendering: fords as sandbars, harbours, sea lanes as dotted coastal arcs
  - squads crossing fords and lanes
  - the Sea Kings look (trident emblem, territory, flags)
  - the Tide telegraph and flood
- **UI:**
  - the Admiral card and the Broadside effect
  - the ceremony line for an archipelago
  - the card's sea-lane and harbour lines
  - a tutorial hint the first time fords or lanes appear
  - Codex topics
- **QA:** the full deploy gate, a `--only=phase12` section and `screenshots/phase12/`.
