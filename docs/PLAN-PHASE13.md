# Phase 13: The Crown of Ages (an ending, and Ascension after it)

Status: **in progress, 2026-10-06.** Lead: the Claude session. Engineers: **sim/meta** and **integration**.

Pace (from the user): build until playable, one QA pass at the end (the full deploy gate), then the user playtests.

**Why this phase.** Every plan from the brainstorm is built, but the long game has no **ending**: dynasties repeat forever with growing numbers. The best long-arc games give the long run a climax and a reason to go on afterwards:
- Hades: the ending, then Heat
- Slay the Spire: the Heart, then Ascension
- Antimatter Dimensions: its milestones

Phase 13 adds a **final continent with a final enemy**, a real **ending** that honours the player's history, and **Ascension**, a lasting difficulty ladder for those who want more.

---

## 13A. The Crown of Ages (the final continent)

**When it's offered:** at the founding of **dynasty 7 or later**, the ceremony offers an extra, final choice: "Seek the Crown of Ages". It's optional, so players can keep founding ordinary dynasties.

**The continent:**
- The largest map (about 34 regions).
- **Every rival kind:** two classic factions, the Ashen Host, and the Sea Kings on a partly archipelago coast. It's seeded, and the same for everyone on that seed.
- Edicts and Challenges apply as usual.

**The final enemy: the Usurper.** A unique faction (`usurper`, id 7) with a crown-and-chains emblem. Its leader, the **Usurper-King**, mocks you with lines for every trigger. Its regions use mixed garrisons.

**The Throne of Ages** is the final capital, a multi-phase boss battle:
- **Phase 1:** a Siege Gate defended by **three Champions**: Barrow Knight, Reaver Captain, and a classic Champion.
- **Phase 2**, once the Gate falls: the Usurper borrows each rival's signature in turn, every 30 s. The Ashen's Rising, a Tide on the approach routes, then a Plague-like weakness on your sites (−15% defence for 10 s). Each is telegraphed.
- **Phase 3**, when the keep drops below 40%: the Usurper takes the field as a hero squad with a health bar, as the Dragon did.
- **Win:** take the keep with the Usurper defeated.

**The Throne's tuning:**
- It reads honestly.
- It's beatable at a sensible Legacy and General level: a median of about 6–9 minutes, with timeouts under 1 in 5 in the campaign at dynasty 7.

## 13B. The ending

Toppling the Throne plays the **ending**:
1. A short cinematic of camera moves across the conquered continent.
2. **"The Chronicle of Your Reign":** a scroll that summarises your whole history across dynasties. It reads from the lasting record and Chronicle:
   - dynasties founded, Edicts chosen, Generals and their levels
   - Relics found, Vendettas won, the Dragon slain
   - your best Daily
   - total regions conquered
3. Credits: the game's name and "made with Claude".
4. A lasting **Crown** on the title screen ("Crowned in Year N"), and the Crown of Ages deed.

**After the ending:** the player continues the realm, or founds anew. **Ascension** unlocks.

## 13C. Ascension (a lasting difficulty ladder, levels 1–10)

**How it works:** after the ending, each founding can choose an **Ascension level**, up to one above your highest cleared. Clearing a level means completing that dynasty: conquering its continent, or the Crown of Ages again at that level.

**The ladder:** each level adds one cumulative modifier from config, for example:
1. Enemy garrisons +10%
2. The raid grace is halved
3. Gates +25%
4. Unrest is slower (it starts after 150 s)
5. Fewer Boon drafts (Hard or harder only)
6. Rival leaders swear Vendettas at a 75 Grudge
7. The Dragon and the Throne +25% health
8. Starting gold halved
9. The Tide and Rising every 30 s → 20 s
10. All of the above, plus enemy squads +10% speed

**Rewards for each level cleared:**
- **+25% Legacy points** for that founding
- a crown pip on your realm banner
- the Ascension deed tiers

**The record:** the Realm panel shows your highest Ascension and a small ladder.

---

## Contract (sketch; sim/meta writes the exact signatures in `docs/briefs/phase13-hookup.md`)

**sim/meta:**
- **The final continent:** `crownOfAgesAvailable(state)` and `generateWorld(seed, { ..., crownOfAges: true })` (a large map, all rival kinds, a partial archipelago coast). Land, archipelago and challenge worlds stay byte-identical.
- **The Usurper:** `FACTIONS[7]`, its AI, and its leader lines.
- **The Throne battle:** phases and events (`throneChampion`, `thronePhase`, `usurperBorrow {kind}`, `usurperField`, `usurperHit`, `usurperFell`).
- **The ending:** `endingRecord(state)` returns the summary data for the Chronicle scroll.
- **Ascension:** `ascensionMods(level)`, folded into `edictMods`, plus `ascensionInfo(state)`, the founding option `{ ascension }`, the lasting record `state.generals.ascension`, Legacy multipliers and deed tiers.
- **Campaign and tests:**
  - Campaign support for D7 with the Crown of Ages.
  - A pacing guard: the Throne fight median 6–9 min with timeouts under 1 in 5; the Crown continent median at most 2× a normal D7.
  - Ascension 1, 5 and 10 measured on D3–D4, each harder but completable.
  - Tests.

**integration:**
- **The ceremony:** the Crown of Ages choice at D7+ and the Ascension picker after the ending.
- **The Usurper:** its look (colour checked for colour-blind separation against all seven factions; with eight factions that may need care, so record the numbers).
- **The Throne:** Champion banners, phase banners, borrow telegraphs, and the Usurper hero squad with a health bar.
- **The ending:** the cinematic, the Chronicle scroll, credits, and the title-screen Crown.
- **Other UI:** the Ascension ladder in the Realm panel, banner crown pips, Codex topics, and tutorial hints (pacer-aware).
- **QA:** the full deploy gate, a `--only=phase13` section (dev hooks: the Crown continent, the Throne phases, the ending plays, Ascension 1 founding), and `screenshots/phase13/`.
