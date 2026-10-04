# Phase 5: Dynasties that change the rules (design + contract)

Status: **in progress, 2026-10-03.** Lead: the Claude session. Engineers:
- **sim/meta:** pure modules, config, tests, campaign
- **integration:** UI, the founding ceremony, checks

Pace (from the user): build until playable, one QA pass at the end, then the user playtests.

**Why this phase.** Founding a dynasty today gives you "the same game, slightly bigger": stars add +3% income each. Phase 5 makes each dynasty a different game:
- an **Edict** chosen at founding changes the rules for that dynasty
- a **Legacy** tree turns your dynasties into unlocks that add new options, not just percentages
- **Challenges** let engaged players raise the stakes for more Legacy
- **Quick Conquest** removes the boring part (easy regions) once you've mastered it

Based on Plan D in PROGRESSION-PLANS.md, trimmed: no new rival factions yet.

---

## 5A. Edicts (choose 1 of 3 when founding a dynasty; lasts the dynasty)

- **The draw:** 3 Edicts drawn from the pool, seeded from `(seed, dynasty level)`. The Heralds legacy node adds a 4th choice.
- **The first dynasty:** no Edict; it is the "standard rules" game.
- **What an Edict is:** a **trade-off**. A real upside, a real cost, and it changes how you play, not only a number.
- **Where it shows:** the Realm panel (name, crest icon, two lines) and the new-dynasty ceremony.

| Edict | Upside | Cost |
|---|---|---|
| **Age of Iron** | +15% attack | −15% income |
| **Merchant Princes** | conquest bounty ×2 | enemy towers and forts start with +30% troops |
| **Long Winter** | Blizzard on about half the regions beyond the first ring; +1 Renown per Blizzard win | marches slower in those fights (Blizzard's own rule) |
| **Iron Frontier** | defenses won pay ×2 gold and ×2 Renown | raids come twice as often |
| **Peace of the Crowns** | no raids or Vendettas at all (a calm dynasty) | Renown earned ×0.5 |
| **Age of Dragons** | two Dragon's Lairs; Dragonscale also gives +10% attack; Dragon rewards ×2 | the Dragon has +25% health |
| **Bounty Hunters** | 4 contract slots; contracts pay ×2 | no Conquest Streak |
| **Grand Festival** | Festivals cost half | natural prosperity growth is half as fast |
| **Warrior Kings** | a General's ability can be used twice per battle | power cooldowns +50% |
| **Open Roads** | scouting is free; Night never appears | enemy garrisons +10% |

**Implementation.** One pure source: `edictMods(state)` returns a flat modifier object, read by the existing code paths. Integration does no maths.

## 5B. Legacy (a tree that persists across dynasties)

- **Points:** founding a dynasty grants **Legacy points** equal to the stars it earns (`starBase + level`). Stars keep their existing +3% income/bounty effect, and Legacy points are spent separately.
- **Persistence:** Legacy lives with the Deeds, in `state.generals.legacy`, which survives New Realm and founding a dynasty.
- **Spending:** spend any time in the Realm panel, or during the founding ceremony. Nodes are permanent; a node requires the one before it in its branch.

| Branch | Node (cost) | Effect |
|---|---|---|
| **War** | Veteran Camp (2) | War Camp starts every battle with +15% troops |
| | Swift Banners (3) | squads march +8% faster |
| | Drillmasters (4) | Generals gain +25% XP |
| | War Chest (5) | start each dynasty with 2 free levels of the cheapest Army upgrade |
| | Warlord (6) | +1 use of every power in each battle (where powers have uses); otherwise −15% power cooldowns |
| **Realm** | Old Roads (2) | your starting region begins at Prosperity II |
| | Masons (3) | the first fortification level in each region is half price |
| | Royal Treasury (4) | start each dynasty with gold = 2 minutes of the first income × the dynasty level, as a flat sum from config |
| | **Quick Conquest** (5) | auto-resolve Easy regions (§5D) |
| | Old Alliances (6) | Free Folk regions surrender at a lower ratio (config) |
| **Court** | **Heralds** (2) | one extra Edict to choose from (4) |
| | Scribes (3) | the Bounty Board gets one more slot (stacks with Bounty Hunters: 5) |
| | Patronage (4) | +2 Renown at the start of each dynasty |
| | Spymaster (5) | 3 free scouts per dynasty |
| | Kingmaker (6) | rival capitals' Gates start with 25% fewer troops |

Costs and numbers live in `game/config/legacy.js`, and sim/meta tunes them. **Budget:** after 3 dynasties a player can afford about 5–6 nodes, so choices matter.

## 5C. Challenges (opt-in at founding; the stakes are yours to choose)

You can tick any number at the founding ceremony. Each one ticked adds **+50% Legacy points** to the *next* founding, provided the dynasty is completed with it on, and puts a laurel badge in the Realm panel.

| Challenge | Rule |
|---|---|
| **Iron Will** | no powers in battle (General abilities allowed) |
| **Overrun** | enemy troops ×1.4 everywhere |
| **Lone Banner** | no Generals: the Militia Captain commands every battle, and there are no abilities |

The ceremony shows a short "harder" warning; challenges can't be removed mid-dynasty.

## 5D. Quick Conquest (automation as a reward; Legacy node)

- **The button:** on a region card labelled **Easy**, a "Quick Conquest" button sits beside Attack.
- **How it resolves:** the battle runs headless with the player's side commanded by the card's commander, using the steward. Deterministic, as in the campaign.
- **While it runs:** a short "Your commander marches on {region}…" overlay with a progress bar, a second or two at most. The overlay is time-sliced so the page never freezes.
- **Win:** the region is conquered with the **Victory** crown only (no Swift or Unbroken) at **75% of the bounty**. Contracts and Deeds count it as a normal win except contracts that need you to watch: `noPowers` counts, `ability` doesn't.
- **Loss:** a normal loss, which a well-labelled Easy fight rarely is.
- **Limits:** not on Bandit Holds, the Dragon's Lair or capitals. No Quick Conquest while the region's battle slot is busy.

## 5E. Open items from Phase 4

- **Swarm calibration (sim):** Fair fights against the Amber Horde were won 98%; the test ceiling is temporarily 0.99. Make the label honest again and restore the ceiling to 0.92.
- **Streak (integration):** only a lost or retreated **attack** breaks the streak. Retreating from a defense already costs you the fight, so it doesn't also cost the streak.
- **Docs (integration):** add Phase 4 and Phase 5 sections to `docs/INTEGRATION-NOTES.md`.

---

## Contract (sim/meta ↔ integration)

All of this is pure; mutating functions take `(state, world, …)` and mutate in place, like the existing meta modules.

**State:**
- `state.edict = { v:1, id|null, challenges: string[] }`: per dynasty, reset by `foundDynasty`
- `state.generals.legacy = { v:1, points, spent, nodes:{[nodeId]:true}, pendingBonus }`: persists, like the deeds
- the challenges ticked for the current dynasty live in `state.edict.challenges`
- `save.js` sanitizers for both, with round-trip, junk and old-save tests

**`game/meta/edicts.js`:**
- `edictChoices(state, nextSeed) -> Edict[]` (3, or 4 with Heralds): seeded and deterministic
- `edictInfo(id) -> {id, name, icon, upside, cost}`, with text built from config numbers
- `edictMods(state) -> {atkMult, incomeMult, bountyMult, enemyFortTroopMult, blizzardShare, renownMult, raidRateMult, raids:false?, defenseRewardMult, dragonCount, dragonscaleAtk, dragonHpMult, dragonRewardMult, bountySlots, bountyRewardMult, streak:false?, festivalCostMult, prosperityRateMult, abilityUses, powerCooldownMult, freeScout, noNight, enemyGarrisonMult}`. Defaults are neutral, and legacy and challenge mods are folded in here too, so there is **one** modifier source.
- **Founding:** `foundDynasty(state, newSeed, newWorld, currentWorld, { edict, challenges })` applies the choice. The world generation that edicts affect (Long Winter's blizzard share, Age of Dragons' second Lair, Open Roads' no Night) goes through `generateWorld(seed, { edict })` or a post-pass in `regionFeatures`, keeping existing seeds byte-identical when there is no edict.

**`game/meta/legacy.js`:**
- `legacyTree() -> branches with nodes {id, name, cost, effectText, requires}`
- `legacyInfo(state) -> {points, spent, available, nodes}`
- `buyLegacy(state, nodeId) -> {ok, reason?}`
- `legacyPointsForFounding(state) -> number`: stars earned × (1 + 0.5 × challenges completed)
- `foundDynasty` adds the points

**`game/meta/quick.js` (Quick Conquest), pure and incremental:**
- `canQuickConquer(state, world, regionId) -> {ok, reason?}`
- `createQuickConquest(state, world, regionId, { commander }) -> job`: a plain object
- `stepQuickConquest(job, maxSimSteps) -> { done, progress:0..1 }`
- `finishQuickConquest(state, world, job, now) -> { won, conquerResult?, crowns, summary }`: applies the conquest at 75% bounty, Victory only, and runs the same deed and bounty hooks as `battleSummaryFor`; a `quick: true` flag stops the `ability` kind from counting
- integration time-slices `stepQuickConquest` across animation frames

**Challenges:** enforced inside the sim and meta from `state.edict.challenges`:
- Iron Will: powers are refused
- Overrun: enemy troop multiplier
- Lone Banner: the commander is forced to the Militia Captain and abilities are refused

**Integration:**
- **The founding ceremony**, replacing today's confirm:
  1. a dynasty summary (stats, stars and Legacy points earned)
  2. the Legacy tree (spend)
  3. the Edict cards (choose one)
  4. the Challenge toggles
  5. "Found the House of {name}", then the new continent

  It must fit a 360 px phone: a stepper of 3 short pages is fine.
- **Realm panel:** the current Edict and Challenges, plus the Legacy tree (spend any time).
- **The region card:** the Quick Conquest button and overlay.
- **Dev hook:** `__hd.completeRealm()` (own every region) to test founding.

**Pacing guard (sim/meta).** 12 seeds × 3 dynasties, the campaign choosing the first Edict offered and buying Legacy nodes greedily:
- D2 and D3 medians at 0.9–1.5× D1
- no Edict pushes D2 outside 0.75–1.7× D1, measured per Edict over 12 seeds with that Edict forced
- waits over 40 min on at most 2 of 12 seeds per dynasty
- Quick Conquest wins at least 95% of Easy regions in the campaign states
