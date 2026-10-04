# Making progression fun: diagnosis, lessons from other games, and four plans

Status: **decided 2026-10-02.** The user picked **Plans B and C**, plus counterattacks, fortifications that change hands, concurrent battles with a Steward AI, and a Renown currency. See DESIGN.md §10 and docs/PLAN-FRONTIER.md.

## 1. Why it feels like "fight the next area, then upgrade"

The loop works, but it has no peaks and almost no decisions:

1. **Between battles there's nothing to decide.**
   - Upgrades are small flat percentages ("+3% attack").
   - The "Best value" tag tells you which one to buy.
   - Everyone ends up with the same stats, so nothing is a choice.
2. **Every region is the same kind of fight.** Take the keep, against more troops, with a
   different flag. Personalities change the numbers more than the experience.
3. **Rewards are only numbers.** Gold and percentages. There are no "new toy" moments, the
   points where you get something that changes how you play.
4. **The curve is smooth by design.** We tuned out walls, but we also tuned out spikes. There
   are no bosses beyond capitals, no surprises, no tense moments, and no power-fantasy
   payoffs after them.
5. **Choosing the next region is solved.** You pick the one labelled Easy. Routes don't
   differ in what they give you.
6. **Prestige is "again, a bit bigger".** Stars are +3% income. A dynasty doesn't change the
   rules.
7. **No goals between "this battle" and "this continent".** No medium-term objectives,
   collections or milestones.

## 2. How other games keep progression interesting

| Technique | Who does it well | Why it works |
|---|---|---|
| **Choose 1 of 3** random offers after each step | Slay the Spire, Hades, Vampire Survivors, Balatro | A real decision every few minutes; runs differ; you build an identity |
| **Synergies that stack multiplicatively** | Balatro jokers, Hades duo boons, Vampire Survivors evolutions | The joy of discovering a "broken" combo; players theorise and plan |
| **Unlocks that add verbs, not percentages** | Metroidvanias, Into the Breach, Factorio, Kittens Game | Every unlock changes *how* you play; curiosity drives you forward |
| **Route choice with typed rewards** | Slay the Spire map (elite, shop, event, treasure), FTL sectors | Picking the next node is a risk/reward plan, not "the easiest one" |
| **Distinct encounters and rule twists** | Into the Breach maps, Kingdom Rush stage gimmicks, Mario levels | Each fight asks a new question, so mastery stays fresh |
| **Bosses and elites as peaks** | Hades, Kingdom Rush, Slay the Spire | Tension, then payoff: a memorable spike and a big reward |
| **Random events with trade-offs** | FTL, Reigns, Crusader Kings, Northgard | Stories emerge; surprise; small choices with consequences |
| **Heroes who level and specialise** | Kingdom Rush heroes, Warcraft III, XCOM soldiers | Attachment; a second, slower progression track; build identity |
| **Branching tech trees with exclusive picks** | Civilization, Northgard clans, Path of Exile (extreme) | Long-term planning; replay with a different branch |
| **Prestige that changes the rules** | Antimatter Dimensions, Realm Grinder, Universal Paperclips phases | Each layer feels like a new game; the long game stays fresh |
| **Challenges for permanent unlocks** | Antimatter Dimensions challenges, Hades Heat, StS Ascension | Self-chosen difficulty and mastery goals for engaged players |
| **Collections and milestones with small bonuses** | Achievements done right, Pokédex, Stardew bundles | Medium-term goals, completionism, a sense of "almost there" |
| **Automation as a reward** | Idle games, Factorio | The boring part goes away exactly when you've mastered it |

**Common thread:** fun progression = **frequent meaningful choices + new toys + variety + peaks**.
Numbers going up is the floor, not the fun.

## 3. Four plans (they combine; each stands alone)

### Plan A: Boons and Relics (a roguelite choice layer). Highest fun per effort.
**Pitch:** after every conquest you choose **1 of 3 Boons**, battle-changing perks that stack
and combo. Special regions on the map hold **Relics**, unique legendary items you can see
before you commit.

- **Boons** (seeded per dynasty; three rarities; some cursed, with big upside and a real
  drawback). Examples:
  - *Scorched Earth:* Firestorm leaves burning ground for 6 s.
  - *Turncoats:* captured settlements keep 30% of their garrison as yours.
  - *Hit and Run:* squads move 40% faster for 5 s after a capture.
  - *Engineers:* towers you capture fire twice as fast.
  - *War Chest:* +1% income per 1K unspent gold (max 25%).
  - *Blood Price* (cursed): your squads are 25% stronger, but every capture costs 3 troops.
  - *Rally Horns:* Rally also gives +20% strength to the squads it sends.
  - **Duo boons** unlock when you hold two matching ones (Hades-style): Scorched Earth +
    Engineers → *Fire Arrows*, where towers set squads ablaze.
- **Relics** (≈ 6 per continent, shown as an icon on the region). Examples:
  - *Dragon Banner:* your War Camp starts every battle at double troops.
  - *Crown of the Reeve:* Free Folk regions surrender at 2× instead of 3×.
  - *Sundial:* power cooldowns tick during the battle-entry flight and the pause.

  The region you target next is now a decision: the Relic region is Hard, the safe one is
  Easy.
- **What it replaces:** most of the flat Army upgrades (keep a slim War Council for the
  economy). Boons reset each dynasty, and the **pool of possible boons grows** as meta
  progression (unlock new boons by defeating factions or with crowns).
- **Why it fixes the loop:** every conquest ends in a meaningful pick, builds diverge, and
  "this run I went full fire" becomes a story.
- **Effort:** 1 design pass and 2–3 engineer rounds (a boon system in the sim with ~30
  boons, the draft UI, relic regions, balance). **Risk:** balance (some combos *should* feel
  strong), and keeping text short and readable.

### Plan B: A varied, eventful map (encounters and events)
**Pitch:** regions stop being interchangeable. Each has a **type**, some carry a **battle
twist**, and the world throws **events** at you.

- **Region types:**
  - *Gold Mine:* huge bounty.
  - *Ancient Ruins:* holds a Relic, if Plan A is built.
  - *Monastery:* reveals the map and gives a free scout.
  - *Bandit Hold:* an elite fight with an extra reward.
  - *Wonder Site:* lets you build one unique structure.
  - *Dragon's Lair:* a once-per-dynasty boss region with its own mechanics.
- **Battle twists:**
  - *Night:* towers see half as far; enemy counts hidden until scouted.
  - *Blizzard:* marches 30% slower; Firestorm stronger.
  - *Flooded:* rivers can't be crossed.
  - *Holy Ground:* no powers.
  - *Siege:* the keep has walls you must breach first. This also fixes the long capital
    fights from the backlog.
  - *Raid:* win by capturing 3 shrines instead of the keep.
- **Events** every ~10–15 min, always opt-in, never punishing absence:
  - "The Crimson Legion masses at Ashford: hold the border for 90 s" (a *defend* battle)
    for a reward.
  - "A merchant offers a rare boon for 2K gold."
  - "Plague in Violet lands: their regions are −20% for 10 min."
  - "A rival leader challenges you to a duel battle (no powers)."
  - Each comes with a leader-voice line and a Chronicle entry.
- **Why:** variety and surprise. Each battle asks a different question, and the map
  generates stories.
- **Effort:** 2–3 engineer rounds (types and twists in world-gen and the sim, an events
  system, UI). **Risk:** tutorial load; introduce twists gradually after the first ring.

### Plan C: Generals (heroes who level up)
**Pitch:** your War Camp is led by a named **General** with a portrait-emblem, a passive, an
active ability, and a skill tree.

- **Starting general:** *Sir Aldric* (Shield Wall: Bulwark on the camp for free once per
  battle). Each toppled rival capital lets you recruit that faction's general:
  - the Khan's *Outrider* (cavalry squads)
  - the Seer's *Oracle* (sees enemy plans; intent lines everywhere)
  - the Warlord's *Butcher* (captures cost the enemy extra)
- **Levelling:** generals gain XP from battles. Each level is **1 of 2 skill picks**
  (exclusive), building a specialised commander.
- **Choice:** pick which general leads each battle, to counter the enemy's personality.
  Generals **persist across dynasties**, which is a reason to keep playing.
- **Why:** attachment, a second progression track, identity, and it ties the leader voices
  and factions into what you earn.
- **Effort:** 2 rounds. **Risk:** another screen; keep it to one roster panel plus a pick on
  the region card.

### Plan D: Dynasties that change the rules (long-term)
**Pitch:** each new dynasty is a *different game*, not a bigger one.

- **Edicts:** pick 1 of 3 when founding. Examples:
  - *Age of Iron:* +attack, −income.
  - *Merchant Princes:* bounties ×2, enemy forts stronger.
  - *Long Winter:* snow everywhere; supply lines fire faster.
  - *Nomads:* no Works, but a free extra boon pick.
- **A Legacy tree** bought with stars instead of +3% income. Unlocks new starting powers,
  start with a Relic, an extra boon choice, Generals start at level 3, and new region types.
- **New rivals in later dynasties:**
  - *Dynasty 3:* the **Ashen Host**, which raises fallen squads as its own.
  - *Dynasty 5:* the **Sea Kings**, an archipelago continent with ford tiles.
- **Challenge dynasties** (opt-in): no powers, or enemies ×2. They pay out unique cosmetic
  banners and Legacy points (Hades Heat / StS Ascension style).
- **Automation as a reward:** from dynasty 2, auto-resolve Easy regions.
- **Why:** the long game stays fresh; it's the main reason idle players return for weeks.
- **Effort:** 2–3 rounds, best after A or B exist (edicts and legacy have more to modify).

### Quick wins (small; any time)
- **Bounty board:** 3 optional objectives at a time (e.g. "win without powers",
  "take 2 forts in one battle", "chain 3 conquests within 10 min") for gold or a boon reroll.
- **Rival grudges:** a faction you've beaten swears revenge, and its leader shows up later
  with a special challenge battle. It uses the existing voices.
- **Conquest streak:** chaining conquests quickly builds a streak multiplier on bounty
  (visible flame on the HUD).
- **Milestones / achievements** with small permanent bonuses, shown in the Realm panel.

## 4. Lead's recommendation

1. **Start with Plan A (Boons and Relics).** It attacks the core complaint directly. The
   moment after each victory becomes the most exciting decision in the game, and relic
   regions make route choice matter. Fold the bounty board in as part of it.
2. **Then Plan B's region types and battle twists**, including *Siege*, which also fixes
   capital-fight length. Events come with it.
3. **Then Plan D**, so dynasties change the rules and use what A and B added.
4. **Plan C is optional flavour.** It's great for attachment, but less urgent than choices
   and variety.

Also worth deciding: lean the identity **away from "idle" and toward "short-session
roguelite strategy on a living map"**. Keep the offline income, but stop treating waiting as
the gate. The playtester felt the idle half was thin; boons and events make each visit
eventful instead.

### A sample 10 minutes under A + B
1. Win Greenreach with all three crowns.
2. The draft offers *Turncoats* (rare), *War Chest* or *Rally Horns*; you take *Turncoats*.
3. On the map, Ashmoor (Hard) shows a Relic icon and Brindle (Easy) is a Gold Mine. You take
   the Gold Mine to afford a reroll, scout Ashmoor, and see it's a **Night** battle (towers
   half range, perfect for a Firestorm opener).
4. An event pops: "The Amber Horde raids your border: hold Fenwall for 60 s for a rare
   boon." You accept, win a short defend fight, and draft *Hit and Run*, which combos with
   *Turncoats* into a fast snowball.
5. Now you take Ashmoor at night and claim the *Dragon Banner*.

Every step was a choice with a story.
