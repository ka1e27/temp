# Phase 6: The Ashen Host (a new rival) + an economy pass (design + contract)

Status: **planned 2026-10-04**, to start when Phase 5's final QA is in. Lead: the Claude session. Engineers: **sim/meta** and **integration**.

Pace (user): build until playable, one QA pass at the end, then the user playtests.

**Why this phase.** Every dynasty fights the same three rivals. Edicts change the rules; a new rival changes the *opponent*. From the second dynasty on, the rival line-up varies, and a fourth faction with its own mechanic, leader, capital boss and General arrives.

---

## 6A. Rival rotation

- **Dynasty 1:** always the classic three (Crimson Legion, Violet Covenant, Amber Horde), so the tutorial and first impressions stay as tuned.
- **Dynasty 2:** the **Ashen Host** always appears, replacing one of the three (seeded), so every player meets it once.
- **Dynasty 3+:** 3 rivals drawn from the 4 (seeded per dynasty).
- **World generation:** still 3 rival sectors. Only which faction holds each sector changes, so map shapes are unaffected.
- **Seeds:** existing seeds with dynasty 1 stay byte-identical.
- **Generals:** a faction's General is still recruited by toppling its capital. If the faction isn't on this continent, its General can't be recruited this dynasty. The roster persists, so nothing is lost.

## 6B. The Ashen Host

| | |
|---|---|
| **Look** | slate and bone, with a cold ember glow. The emblem is a **skull-crown**. The colour must be distinct from every existing faction for colour-blind players too; integration picks it and checks it with the existing a11y tooling. |
| **Personality** | `undying`, a new AI personality: patient and attritional. It holds its sites thickly and counterattacks after you've spent troops. |
| **Signature mechanic: The Fallen Rise** | When your squads die assaulting an Ashen settlement, **20% of your losses join that settlement's garrison** (config). Wasteful over-sending and long attrition fights feed them; precise, decisive blows don't. **Firestorm burns the dead:** none rise from troops killed inside a Firestorm, or at a settlement under a Firestorm, while it lasts. That's the counterplay, and it gives the power a new reason to exist. |
| **Raids** | its war bands also grow by 20% of the defenders they kill |
| **Leader** | **the Pale Margrave** (seeded name, e.g. "Margrave Osric the Pale"). A full voice line set for every existing trigger, including grudge, vendetta, plague, merchant, duel and capital: dry, ancient, patient. |
| **Capital boss: the Barrow Keep** | Siege (Gate) as all capitals have, plus a **Rising**: every 20 s, the fallen around the keep rise as a free Ashen squad that marches on your nearest site. A telegraphed ring of ash shows 3 s before. Firestorm on the keep cancels the next Rising. |
| **Its General (recruited when you topple the Barrow Keep)** | **the Gravewarden.** Style: stalwart. Passive: 10% of the enemy troops killed attacking your settlements join that settlement. Ability, **Raise the Fallen:** the troops you lost in the last 20 s rise as a free squad at your strongest site (capped at 25% of the camp's starting troops). It gets a 1-of-2 skill tree like the other Generals. |
| **Events and features** | everything existing applies: Plague, Duel, grudges, Vendettas (the Margrave's Champion is a **Barrow Knight**) |

**Balance targets:**
- An Ashen region's label stays honest: the card's win chance must include The Fallen Rise at the player's typical send style.
- Ashen fights take at most 1.25× a comparable region's battle time.
- **D2 with the Ashen Host:** median at 0.9–1.5× D1, waits over 40 min on at most 2 of 12 seeds.

## 6C. An economy pass (from Phase 5)

The campaign reads the card without the commander's credit, but the player sees the credited card. Switch the campaign to the credited card (what a person actually sees), then retune the economy so D1 stays at a median of 1.1–1.6 h. Today it drops to 1.04 h; nudge costs or income, with each change's reason written in config.

---

## Contract

**sim/meta:**
- `FACTIONS` gains `{ id: 5, name: 'Ashen Host', …, personality: 'undying' }`. Leave the colour fields to integration to propose; sim/meta puts a placeholder and integration edits only the colour values in config.
- `rivalsFor(seed, dynastyLevel) -> factionId[3]`. `generateWorld(seed, { dynasty, edict, rivals })` assigns sectors from it. Dynasty 1 stays byte-identical, with a test.
- **The undying AI** in `game/battle/ai.js` (or a sibling module).
- **The Fallen Rise in the sim:**
  - a `fallenRose` event `{site, count}`
  - the Firestorm exception
  - the Barrow Keep Rising: a `rising` telegraph event, then a squad
  - war band growth
- **Gravewarden:** passive, ability (`raiseFallen`) and skill tree, in `config/generals.js` and `battle/abilities.js`. Recruited through the existing capital-topple path.
- **Leader:** voice lines for the Margrave, every trigger and every faction rule, plus the existing leader tests.
- **The card estimator** (`difficulty`/`winChance`) includes The Fallen Rise.
- **Economy pass (6C)** and the pacing guard: D1–D3 with rotation, and D2 with Ashen forced.
- **Brief:** `docs/briefs/phase6-hookup.md`, written early.

**integration:**
- **Faction look:** colour, emblem (skull-crown icon), territory tint, banners and settlement flags. Check colour-blind separation from the other five.
- **The Fallen Rise:** wisps rising from fallen squads into the Ashen garrison, with a "+N risen" pop on the badge. When Firestorm burns the dead, show ember wisps instead.
- **The Rising:** the ash-ring telegraph and the squad emerging.
- **Gravewarden:** emblem and recruitment card (the existing flow), and the ability effect.
- **Tutorial:** a hint the first time an Ashen region is on your frontier: "The Fallen Rise: your losses join them. Strike decisively, or burn the dead with Firestorm."
- **The card:** an Ashen region card shows a line about the mechanic.
- **QA:** one final pass with a Phase 6 check section (meet the Ashen in D2 via `__hd.completeRealm()` + founding, attack an Ashen region, see a rise, Firestorm prevents a rise), and a `screenshots/phase6/` gallery.
