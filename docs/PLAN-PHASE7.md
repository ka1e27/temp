# Phase 7: Boons and Relics (design + contract)

Status: **in progress, 2026-10-04.** Lead: the Claude session. Engineers: **sim/meta** and **integration**.

Pace (from the user): build until playable, one QA pass at the end, then the user playtests.

**Why this phase.** The first two items of the original diagnosis (PROGRESSION-PLANS.md §1) are still open:
1. Between battles the only decision is a flat-percentage War Council upgrade, and "Best value" tells you which one to buy.
2. Rewards are numbers, not new toys.

Phases 1–6 added goals, rivals and rule-changing dynasties, but a single conquest still ends in "+gold". Phase 7 makes most conquests end in a **meaningful pick** that changes *how* you fight. Some regions hold **Relics**, unique legendary items that you can see before you commit. This is Plan A from the brainstorm, adapted to what now exists.

**War Council stays.** Flat upgrades remain the steady gold sink. Boons are the exciting layer on top; they don't replace the War Council.

---

## 7A. Boons (choose 1 of 3)

**When:**
- After every conquest won **in battle** (not Quick Conquest, not surrender), the result card offers **3 Boons**, and you pick 1.
- If you skip the pick, the offer waits in a "Boon pending" chip until you choose. You can't stack more than one pending offer: a new conquest with one pending makes the new offer replace it, with a gentle "you missed a pick" note.
- **Not in the tutorial.** Boons unlock after the first ring, the same moment as the Bounty Board.

**Scope:**
- Boons last the **dynasty**, and stack.
- The draft is seeded `(seed, dynasty, draws)`, so it's deterministic.
- **Rarities:** Common 65%, Rare 28%, Legendary 7%.
- **Cursed** Boons (marked) carry a big upside and a real drawback.
- Rerolling a draft costs 1 Renown.
- **The Champion's eye:** once per dynasty, after a Vendetta win, a **guaranteed Rare-or-better** draft.

**The pool:** about 24 Boons. Final list and numbers in `game/config/boons.js`; each must change behaviour, not just add a percentage.

| Boon | Rarity | Effect |
|---|---|---|
| **Scorched Earth** | Rare | Firestorm leaves burning ground for 6 s that damages enemy squads crossing it |
| **Turncoats** | Rare | settlements you capture keep 30% of their defenders as yours |
| **Hit and Run** | Common | squads march +40% faster for 5 s after a capture |
| **Engineers** | Common | towers you capture fire twice as fast |
| **War Chest** | Common | +1% income per 1K unspent gold (max +25%) |
| **Rally Horns** | Common | Rally's squads hit +20% harder |
| **Blood Price** | Cursed | squads +25% strength; every capture costs 3 troops |
| **Iron Rations** | Common | your settlements keep growing while besieged (+50% growth under assault) |
| **Ambushers** | Rare | squads attacked on a road deal +30% damage |
| **Night Raiders** | Common | in Night battles, enemy towers do not fire at your squads |
| **Siegecraft** | Rare | Gates take double damage; the keep's Gate falls faster |
| **Dragonbane** | Rare | +50% damage to the Dragon; its breath telegraph lasts 1 s longer |
| **Gravebreaker** | Rare | in Ashen fights The Fallen Rise is halved |
| **Tithe** | Common | +1 Renown every 3 conquests |
| **Fortune Favours** | Cursed | bounty ×1.5; a lost battle costs 10% of your gold |
| **Banner Bearer** | Common | your commander's ability recharges once per battle after 60 s |
| **Second Wind** | Rare | the first time a settlement of yours would fall in a battle, it holds with 1 troop and gains +10 |
| **Pathfinder** | Common | squads ignore forest and marsh slowdown |
| **Plunderers** | Common | each settlement captured pays gold equal to 10 s of income |
| **Warlord's Mark** | Legendary | every 4th squad you send is doubled |
| **Phalanx** | Rare | squads of 50+ troops take 20% less damage |
| **Kingslayer** | Legendary | the enemy keep's garrison starts 20% lower in every battle |
| **Oathkeeper** | Legendary | Vendettas against you have no Champion, and Trophies give double |
| **Martyr's Crown** | Cursed | when your camp falls you don't lose the battle for 10 s; all your settlements gain +30% troops instantly |

**Duo Boons** (Hades-style; 4 to start). Holding both parts unlocks a free bonus effect with a reveal moment:
- **Fire Arrows** = Scorched Earth + Engineers: towers you hold set squads ablaze (damage over time).
- **Ghost Legion** = Turncoats + Gravebreaker: captured Ashen settlements keep 50% as yours.
- **Lightning War** = Hit and Run + Pathfinder: captures also refresh Forced March's cooldown by 5 s.
- **Gilded Banners** = War Chest + Plunderers: Plunderers' gold also counts for War Chest at ×2.

## 7B. Relics (legendary items on special regions)

- **Where:** about 4 per continent, placed on **Ruins** first, then on other deep regions without a type. The Relic shows on the map, as a glinting chest, and on the card **before you commit**: route choice.
- **Duration:** conquering the region claims the Relic for the **dynasty**.
- **Collection:** a **Reliquary** in the Realm panel lists every Relic you've ever found, kept across dynasties, so collecting them becomes a goal. Each newly found Relic is also a Deed step: a "Reliquarian" deed.

| Relic | Effect |
|---|---|
| **Dragon Banner** | your War Camp starts every battle with double troops |
| **Crown of the Reeve** | Free Folk regions surrender at 2× instead of 3× |
| **Sundial** | power cooldowns tick during battle pause and the battle-entry flight |
| **Horn of Ages** | Rally cooldown −40% |
| **Seer's Lens** | every region is scouted for free |
| **Black Pennant** | enemy raids on you are 25% smaller |
| **Ember Heart** | Firestorm +40% damage |
| **Gravewarden's Lantern** | (Ashen continents only) The Fallen Rise never happens near your camp |

Eight in the pool; 4 placed per continent, seeded.

## 7C. Rough edges carried from Phase 6

- A live check for the Gravewarden's Raise the Fallen (integration).
- Restore the Firestorm burning ground after a save and reload (integration, via sim state if needed).
- Re-measure Ashen Easy honesty (it read 78% on one sweep) and adjust if it's consistently low (sim/meta).

---

## Contract (sim/meta ↔ integration)

**State:**
- `state.boons2 = { v:1, owned:[boonId], pending: {choices:[boonId,boonId,boonId], source} | null, draws, champEyeUsed }`. Per dynasty. The name avoids the existing `state.boons`, which holds Dragonscale.
- `state.relics = { v:1, placed: {[regionId]: relicId}, owned: [relicId] }`. Per dynasty.
- `state.generals.reliquary = { v:1, found: [relicId] }`. Lasting.
- Save sanitizers and `foundDynasty` resets.

**`game/meta/boons.js`:**
- `boonInfo(id)` returns `{ id, name, rarity, cursed, icon, text }`, with text built from config.
- `offerBoons(state, world, source) -> choices | null`. Called by `conquer()` for battle wins after unlock; sets `pending`.
- `pickBoon(state, id) -> { ok, duo? }`
- `rerollBoons(state) -> { ok, cost }`
- `ownedBoons(state)` and `duoInfo(state)`
- **Effects:** all Boon and Relic effects flow through one `boonMods(state)`, folded into the existing paths (`playerBattleStats`, economy, powers, sim, frontier) next to `edictMods`. One modifier source each; the UI does no maths.
- **Sim:** Boon effects that change sim behaviour (Scorched Earth ground, Turncoats, Engineers, Second Wind, Warlord's Mark, …) get sim support through battle stats or flags, and emit events where the UI should show something (`boonTriggered {boon, site}`).

**`game/meta/relics.js`:**
- `placeRelics(state, world)`, seeded, at world creation / `resetRegions`. Ruins first.
- `relicAt(state, regionId)`, `relicInfo(id)`, `claimRelic` (called inside `conquer()`), and `reliquary(state)`.

**The campaign:** the bot picks Boons with a simple heuristic (highest rarity, avoiding cursed ones unless the bot is ahead). Relics are claimed when it conquers.

**Pacing guard:** D1–D3, 12 seeds:
- D1 median 1.1–1.6 h; Boons will speed it up, so retune as needed, keeping the War Council relevant.
- Waits over 40 min on at most 2 of 12 seeds per dynasty.
- No single Boon makes battles trivial: report win rate and battle time per Boon over the campaign.

**Integration:**
- **The Boon draft on the result card:** 3 cards with rarity frames (Common bronze, Rare silver-blue, Legendary gold, Cursed crimson-violet), name, icon, text, pick and reroll. Plus the "Boon pending" chip.
- **The Duo reveal moment.**
- **An owned Boons strip:** compact icons in the War Council or Realm panel, with tooltips.
- **Relic visuals:** the map glint, the card line, the claim moment, and the Reliquary grid in the Realm panel.
- **`boonTriggered` visuals in battle**, kept small and readable.
- **Tutorial:** one hint at the first draft and one at the first Relic on the frontier.
- **QA:** one final pass with a Phase 7 check section, plus a `screenshots/phase7/` gallery.
- Run the **full** `check.mjs` and `--base=temp` at the end, as CI does.
