# Hex Dominion 2 — Design

Owner: lead designer. This document is the source of truth for **what** the game is and
**why**. `docs/ARCHITECTURE.md` is the source of truth for **how** it is built. When a
decision is not covered here, pick the option that is simpler, more readable for the player,
and more satisfying to look at — in that order.

---

## 0. Why a redesign (critique of v1)

v1 (tag `v1-final`, still in `src/` for reference only — do not import from it) had a
finished-feeling engine and an unfinished-feeling game:

1. **No visual identity.** Flat slate hexes, thin line icons, tiny monospace labels. It read
   as a dashboard, not a world. The world map was a grid of identical `???` hexes.
2. **Wall of UI on minute one.** The first battle showed 8 troop types, 5 boosters, a
   garrison-% selector, a drag-mode toggle and a speed slider before the player had sent a
   single squad.
3. **Too slow for an idle game.** Battles ran 7–15 minutes. There was nothing to do in a
   two-minute visit.
4. **Choices without consequences.** 8 unit types collapsed into one dominant answer
   (militia-only won 98% where the default loadout won 56%). Six upgrade lines, three
   endgame loops and four currencies, yet the layer around each battle had one right answer.
5. **No sense of place or progress.** You never *saw* your empire grow; you saw a number.

**The v2 thesis:** one beautiful persistent hex continent that you literally paint in your
colour, region by region, with 60–150 second battles that are readable at a glance, and a
small number of choices that each change how the next battle plays.

---

## 1. The pitch

> A living hex continent under drifting clouds. Your banner holds one small corner. Every
> region you conquer pays you gold forever — even while you are away — and that gold buys the
> upgrades and battle powers that crack the next, harder region. Battles are fast, tactile
> and fully deterministic: drag armies between settlements, intercept marches in the field,
> call down fire, and take the enemy keep. Conquer the whole continent, then found a dynasty
> and do it again, stronger, on a new world.

Premise kept from v1: idle conquest of a hex world, one region at a time; conquered regions
pay passive income; income buys upgrades; real-time battles; deterministic combat; runs as a
static site on GitHub Pages with zero dependencies and no build step.

---

## 2. Core loop

```
      ┌──────────────── idle gold (per second, also offline) ────────────────┐
      │                                                                       ▼
 Conquer region ──► +income, +perk, bounty ──► War Council upgrades & powers ──► pick next
      ▲                                                                   frontier region
      └──────────────────────── 60–150 s real-time battle ◄───────────────────┘
```

A two-minute visit: collect offline gold, buy two upgrades, win one battle, watch the region
flood with your colour. A long session: chain battles, push into a rival faction, topple its
capital.

---

## 3. The world

### 3.1 The continent
- One procedurally generated continent per dynasty (seeded, deterministic). Default grid
  **48 × 36** offset hexes (pointy-top, "odd-r"), ~50% land, surrounded by ocean.
- Biomes from elevation + moisture + latitude: ocean, shallows, beach, grassland, meadow,
  forest, pine forest (cold), hills, mountains (impassable), snow (far north), desert/savanna
  (far south), marsh. Rivers run from high ground to the sea. Roads link settlements.
- Only the largest landmass is playable. Small islets are decorative.

### 3.2 Regions
- ~28 regions (dynasty 1), organic shapes from terrain-weighted flood fill.
- **Region size grows with distance from the player's start**: near-start regions ~18–25 land
  tiles and 3–4 settlements; far regions ~35–50 tiles and 6–8 settlements.
- Each region has: a generated name, one **keep** (its capital), 2–7 other settlements, a
  **tier** (graph distance from the start region), an owner, income, bounty, and a **perk**.

### 3.3 Owners (factions)
| id | name | colour | emblem | personality |
|---|---|---|---|---|
| 0 | **You** (player realm) | Azure `#3d7ef0` | star | — |
| 1 | **Free Folk** | Stone `#a19c92` | wheat | passive: never attacks, grows slowly, reinforces |
| 2 | **Crimson Legion** | Crimson `#c63932` | sword | aggressive: attacks early and often, commits big |
| 3 | **Violet Covenant** | Violet `#6d1b99` | eye | defensive: extra forts & towers, counterattacks when you overextend |
| 4 | **Amber Horde** | Amber `#f29e38` | sun | swarm: fast growth, many small attacks, fast marches |

- Faction colours are chosen so that every pair is ≥ 15 CIEDE2000 apart under deuteranopia,
  protanopia and tritanopia (≥ 20 normally); a unit test enforces this. Emblems carry identity too,
  so banners are large with a dark under-stroke.
- The player starts in one coastal region near an edge. Tier 1–2 regions around it belong
  to the Free Folk (a gentle start). The rest of the map is split into three contiguous
  sectors, one per rival faction, each with a **capital region** deepest in its sector.
- **Decapitation:** conquering a faction's capital reduces the strength of all its
  remaining regions by 30%. Going for the throne early is a real strategic option.

### 3.4 Fog of the unknown
Regions that are neither owned nor adjacent to owned territory are hidden under soft,
drifting clouds. Conquering a region parts the clouds over its neighbours — exploration is a
reward you can see.

### 3.5 Region perks
Each region carries one perk chosen by its dominant biome; capitals carry a stronger unique
perk. Perks stack additively and are shown with an icon on the map and the region card.

| perk | from biome | effect |
|---|---|---|
| Fertile Plains | grassland/meadow | +12% gold income |
| Timberland | forest/pine | +6% troop growth |
| Iron Hills | hills | +5% attack |
| Stone Quarry | mountains-adjacent | +5% defence |
| Horse Pastures | savanna/meadow | +6% march speed |
| Harbour | coastal | +20% conquest bounty |
| Old Shrine | marsh/snow | −6% power cooldowns |
| Throne (capital) | — | +15% of one stat (faction-specific) and +25% income |

This makes the choice of *which* frontier region to attack next meaningful.

### 3.6 Rival leaders
Each faction has a leader with a seeded name (new per dynasty) and a fixed title:
- Crimson Legion: *Warlord*
- Violet Covenant: *High Seer*
- Amber Horde: *Khan*
- Free Folk: *Reeve*

Leaders speak one short line at key moments, shown in a small banner with their emblem that
never blocks input. The trigger moments:
- first contact (their land becomes your frontier)
- battle start (a different line at their capital)
- their keep under assault
- their keep lost
- surrender offer
- decapitation
- your defeat
- your retreat
- being scouted
- being sabotaged (§5.7)

Voice follows personality:
- Crimson boasts and threatens.
- Violet warns and speaks in omens.
- Amber jeers and taunts.
- Free Folk grumble like put-upon farmers.

Limits:
- Lines are at most about 70 characters.
- At most one line per trigger per battle, and at least 15 s between lines.
- Never at the same time as a tutorial hint.
- A "Leader voices" setting turns them off.

All writing is original.

---

## 4. Battles

Battles happen **on the world map itself**: the camera flies into the target region, the rest
of the world dims, and the fight plays out on the real terrain. Winning floods the region
with your colour in place.

### 4.1 The arena
- The target region's tiles, plus your own tiles within 4 hexes of it.
- Your forces: a **War Camp** (always placed on your side of the border, nearest the enemy
  keep) holding your expedition army, plus any of your own settlements inside the arena
  (with a partial garrison).
- Enemy forces: every settlement in the target region. In rival regions, hamlets start as
  Free Folk (neutral, capturable).

### 4.2 Settlements
| type | grows/s | cap | defence | role |
|---|---|---|---|---|
| hamlet | 0.35 | 20 | 1.0 | small, usually neutral |
| village | 0.7 | 40 | 1.0 | bread and butter |
| town | 1.0 | 60 | 1.1 | strong producer |
| fort | 0.45 | 60 | 1.8 | walls: hard to take, slow to grow |
| tower | 0.2 | 25 | 1.4 | shoots arrows at enemy squads within 2.6 hexes |
| keep | 1.2 | 90 | 1.6 | region capital — **take it to win** |
| camp | 0.8 | 80 | 1.2 | your War Camp (player only) |

The table shows the design's starting proportions. Live caps and rates are tuned in
`game/config/battle.js`: caps are roughly double these, and enemy caps scale with depth
(§4.6). Growth only happens below cap; above cap a garrison slowly bleeds back down. Growth, attack,
defence and speed are multiplied by the owner's stats (upgrades for you; tier scaling for
the enemy).

### 4.3 Orders
- **Drag** from one of your settlements to any settlement: sends a share of its garrison
  (default 50%; 25/50/75/100% selectable with the HUD or keys 1–4).
- **Tap/click** your settlements to select several, then tap a target to send from all of
  them. Shift-drag (desktop) lassos. `A` selects all. Right-click / Esc clears.
- Sending to your own settlement reinforces it.
- **Supply lines (auto-send):** a standing order from one of your settlements to any
  settlement. While it stands, the source automatically sends half its troops along its
  route whenever it holds at least about 10 (checked every few seconds; numbers in config).
  - **Create:** Ctrl-drag (desktop), long-press then drag (touch), or switch on **Auto** in
    the battle HUD so that drags make supply lines instead of one-off sends.
  - **Rules:** one line per source, and a new one replaces it. Repeating the gesture on the
    same target, or right-clicking / long-pressing the source, removes it.
  - **Capture and loss:** a line survives its target being captured (it then reinforces it)
    and ends if the source falls.
  - **Look:** drawn as flowing chevrons in your colour. Saved with the battle.
  - **Why:** turns a battle from constant dragging into setting up flows and reacting.

### 4.4 Movement and combat (deterministic — no dice anywhere)
- Squads march along the cheapest hex path. Terrain costs: road 0.55, grassland 1.0,
  beach/savanna 1.1, hills 1.5, forest 1.6, snow 1.4, marsh 1.8; crossing a river +0.8;
  mountains and water impassable. Base speed 1.1 hexes/s on cost 1.0.
- **Strength** of one troop = attack × defence of its owner (the defender at a settlement
  also multiplies by the settlement's defence). Fights trade strength 1:1:
  `30 vs 20` at equal stats leaves `10`. This is the rule players can do in their heads.
- Fights resolve **progressively** over roughly half a second to two seconds (for visual
  impact), but the outcome is identical to the instant rule unless reinforcements arrive
  mid-fight — which is exactly the tactical opening a player should be able to exploit.
- **Front lines (no marching through enemy land):** every arena tile belongs to someone.
  Tiles of the target region belong to their nearest settlement's owner (they recolour live
  as settlements flip), and your own land is yours.
  - **The rule:** a squad marches only through its own side's land, neutral land (e.g. Free
    Folk hamlets inside a rival region), and the tiles of the settlement it is attacking.
    So you can attack a settlement only where its land touches land you can cross. Take the
    near settlements to open a path to the keep. The same rule binds the enemy.
  - **Routes:** a route is fixed when the squad sets out. A send with no legal route is
    refused. While dragging, reachable targets glow and unreachable ones read "No route:
    take a closer settlement first".
  - **Rally:** sends only from settlements that have a route.
  - **Border marches:** where a region would otherwise leave you no soft target (only the keep
    reachable, or villages walled in behind it), the battle opens a short strip of **neutral
    no-man's-land** (drawn untinted with a dashed edge) so that at least one ordinary
    settlement can be attacked first. It is neutral in the rules too, so no squad ever
    crosses enemy land.
  - **Border marches stay short:** at most 3 tiles, the shortest strip to the nearest soft
    site, and never along the keep. They exist only to open a first target. They never link
    your own settlements together; a settlement cut off from the War Camp fights from where
    it stands.
- **Interception:** opposing squads that meet in the field stop and fight. You can catch a
  march before it reaches your village.
- **Towers** loose an arrow volley every 0.5 s at the nearest enemy squad in range.
- **Win:** capture the enemy keep — every remaining enemy settlement in the region
  surrenders and flips to you in a cascade. **Lose:** you have no settlements and no squads
  left in the arena. **Retreat** is always available and costs nothing but the attempt.

### 4.5 Powers (active abilities)
Bought and levelled in the War Council; used in battle with cooldowns. Each is a big,
readable, satisfying moment.

| power | target | effect (level 1) | cooldown |
|---|---|---|---|
| **Rally** (horn) | any settlement | every settlement you own sends 50% toward it at once | 30 s |
| **Firestorm** (flame) | any hex | after 0.8 s, blast radius 1.3 hexes: −10 troops from each enemy squad and garrison inside | 25 s |
| **Bulwark** (shield) | your settlement | defence ×2.5 for 8 s | 30 s |
| **Forced March** (boot) | global | your squads move ×2 for 6 s | 35 s |
| **Levy** (bell) | global | +8 troops at every settlement you own | 45 s |

Rally is owned from the start (the tutorial teaches it). The rest are unlocked with gold.

### 4.6 The enemy
- Rival AIs think every 1.2–2.5 s depending on tier, pick the most valuable target they can
  afford (troops needed vs. distance), converge multi-settlement attacks when one
  settlement is not enough, and reinforce settlements that are about to fall.
- Personalities change *how* they play (see 3.3), not just numbers.
- Enemy strength climbs one even step per region along a difficulty ladder (ordered by tier),
  so every conquest makes the next one a little harder, whatever the world's size.
- Deeper regions' settlements hold more: enemy settlement caps scale with depth, so late
  regions and capitals are real sieges, not just higher numbers against the same walls.
- Free Folk settlements cap lower (they are farmers, not soldiers).
- Rival AIs hold off attacking your settlements for a short opening grace (longer at shallow
  tiers), so you can read the field.
- Exact numbers live in `game/config/battle.js` and are tuned with the balance harness.

### 4.7 Length and pacing targets
- Tier 1: 45–75 s. Mid tiers: 60–120 s. Capitals: 120–180 s.
- Battle speed 1× / 2× / 3× and pause (the idle economy always runs on wall-clock time).

### 4.8 Crowns
Winning a region's battle awards up to three crowns:

| crown | condition |
|---|---|
| **Victory** | win the battle |
| **Swift** | win within the region's **par time** (battle seconds, at any speed) |
| **Unbroken** | win without the enemy capturing any settlement you held **when the battle began** (sites you capture mid-battle and lose again don't count) |

- **Par time** comes from the tier band, calibrated by the balance harness to each band's
  median winning battle, so a competent player earns Swift about half the time (the values are
  in `game/config/crowns.js`, around 1:25–1:30).
- **Reward:** each crown adds +25% of the conquest bounty, which is realm-sized (§5.1).
- **Surrender:** accepting a surrender (§5.3) awards Victory only. That makes it a real
  choice: the instant win, or fight for the full bounty.
- **In battle,** the timer shows the Swift par as a countdown ("0:31 · Swift 0:43"), so Swift
  is a goal you can chase. It dims once missed.
- Crowns are fixed once the region is conquered. Retries after a loss count only the
  winning battle.
- **Where crowns show:**
  - The region card shows par time and three empty crowns before an attack, and the earned
    crowns once the region is conquered.
  - The victory card awards them one by one.
  - Owned regions show small crown pips under their map label.
  - The Realm panel shows lifetime crowns and this dynasty's crowns against the total
    possible.
- Tuning numbers live in `game/config/crowns.js`.

---

## 5. The idle meta

### 5.1 Gold
- One currency. Earned per second from every region you own (also while the tab is closed,
  up to an offline cap), plus a one-time **bounty** for each conquest.
- Region income rises gently with depth; capitals pay extra. Exact numbers live in
  `game/config/meta.js`.
- **Bounty = about 90 s of your realm's *total* income at the moment of conquest × bounty
  multipliers** (Plunder, Harbour, dynasty stars). Tying it to the whole realm keeps the bounty,
  Plunder, Harbour and crowns (§4.8) meaningful at every stage of the campaign. The exact
  seconds are tuned in config.
- Returning after ≥ 60 s away shows a **Welcome back** card: time away and gold earned.

### 5.2 War Council (upgrades)
Three tabs, each item shows level, current → next effect, and cost (exponential):

- **Army:** Recruitment (growth), Steel (attack), Armour (defence), Logistics (march speed),
  Muster (War Camp troops).
- **Realm:** Taxes (income), Treasury (+1 h offline cap, **base 2 h**), Plunder (bounty).
- Per-level sizes are small and costs rise gently, so there is a purchase every few minutes and
  no single level decides a fight. The exact numbers are in `UPGRADE_TUNING` in
  `game/config/meta.js`, and the council shows current → next.
- Offline earnings pay in full, up to a 2 h base cap that Treasury extends (its levels are
  priced as a real mid-game purchase). Offline gold is a welcome-back boost, not the pacing
  control. The balance harness showed that a returning player's active play sets the pace, and
  only cutting offline efficiency to about 10% would stretch a dynasty to a day, which would
  break the "pays you even while you're away" promise.
- **Powers:** unlock Firestorm / Bulwark / Forced March / Levy, then level each (bigger
  effect, shorter cooldown). Rally levels here too.

No upgrade is a strict prerequisite for another. Costs rise so that later regions require
spending idle income, which is what makes the idle half matter.

### 5.3 Difficulty readout and surrender
Every region card shows your **Army Power** against the region's **Strength**, with a label:
Easy / Fair / Hard / Deadly. If you outmatch a region by ≥ 3×, it **offers surrender**:
conquer it instantly without a battle. (Makes second dynasties fast in the early game.)
Surrender is never offered before you have won your first battle, so the tutorial battle
always happens.
- **The bar shows your chance of winning**, not a raw power ratio. It's derived from the same
  calibration as the labels (e.g. "about 1 in 5"), so a Deadly region never looks like a close
  fight. Your Army Power and their Strength stay as small numbers beside it.

### 5.4 Dynasty (prestige)
When the whole continent is yours: **Found a Dynasty**. You keep dynasty stars, lifetime stats
and settings; everything else resets onto a **new continent** with tougher enemies.

**Pacing philosophy:** waits stay short (no wait over about 40 min between conquests), and
length comes from the dynasty loop, not from walls. The first continent is a fast hook of
about 1.4 h of play. Each later dynasty runs somewhat longer (about 1.3–1.4× the first:
tougher enemies), with stars and open surrenders making its early regions fast.

Each star: about +3% income and +3% bounty (one clear effect; the numbers are in config).
Stars earned = 3 + the dynasty level just completed.

### 5.5 Records
A Realm panel shows lifetime stats (battles won/lost, regions conquered, gold earned, troops
sent, settlements taken, best battle time, time played) — the numbers-go-up screen idle
players want.

### 5.6 Prosperity
Regions you hold grow prosperous over wall-clock time, including while you're away:

| level | reached after holding the region | effect |
|---|---|---|
| I | 30 min | +5% of that region's income |
| II | 2 h | +10% |
| III | 8 h | +15% |

- The level-up is visible on the map (§7.7) and celebrated with a small "Fenwall prospers!"
  pop and a chime.
- The region card of an owned region shows its level and the time to the next level.
- The welcome-back card mentions regions that prospered while you were away.
- Prosperity resets with the dynasty.
- It gives old conquests a reason to exist beyond a number, and gives idle players something
  to come back and look at.
- Tuning numbers live in `game/config/prosperity.js`.

### 5.7 Scout and Sabotage
Two gold actions on a frontier region's card. They turn the difficulty label into a lever: a
choice between broad upgrades and a surgical push on the one region you want next.

**Scout** (one-off, cheap: about 30 s of current income; free on the tutorial region).
The card starts with a single small *Scout* button under the difficulty bar. Scouting
reveals:
- **Composition:** every settlement with its type and starting garrison, forts and towers
  called out.
- **The leader and personality:** the leader's name (§3.6) and a one-line read, e.g.
  "Aggressive: will counterattack early".
- **A suggested weak point:** the site to hit first.

On the world map, a scouted region's settlements show their garrison badges. The leader may
react with a line (trigger `scouted`).

**Sabotage** (only after scouting; at most 2 times per region).
- Pay gold to cut that region's starting garrisons by 15% each time (−30% at most). Growth
  and stats are unaffected.
- The cost scales with the region's strength and is tuned so that sabotage never beats
  upgrading as a general strategy. It is a finisher for a region sitting just past Fair.
- The difficulty label and surrender check update immediately.
- A sabotaged region shows a small torch mark by its map label.
- In battle, a toast notes the sabotage, and the leader reacts (trigger `sabotaged`).

Scout and sabotage state is per region and resets with the dynasty. Tuning numbers live in
`game/config/intel.js`.

### 5.8 Region Works (upgrades per region)
- **Slots:** each region you own can build **Works**: 1 slot on conquest, +1 at Prosperity
  II, +1 at Prosperity III.
- **Building:** a Work is built and levelled (I–III) with gold from the owned region's card.
  Costs scale with the region's depth and the Work's level.
- **Effects are local.** "Next to" means the target region shares a border with the Work's
  region. Effects from several regions stack.

| Work | effect (per level) |
|---|---|
| **Barracks** | battles next to this region: your War Camp starts with more troops and grows faster |
| **Stables** | battles next to this region: your squads march faster, hit harder in field clashes (cavalry), and your supply lines send more often |
| **Shrine** | battles next to this region: power cooldowns are shorter |
| **Watchtower** | regions next to this one are scouted for free, and in battles next to it your War Camp looses arrows like a tower |
| **Market** | this region pays more income |

- **Why:** it makes *where* you conquer and build a decision. Markets suit safe inner
  regions; Barracks, Stables, Shrines and Watchtowers belong on the frontier facing your
  next target. Owned regions stay interesting after conquest.
- **On the map:** small building icons by the region's keep. The War Council keeps its
  realm-wide upgrades; Works are the local, spatial layer on top.
- Tuning numbers live in `game/config/works.js`.

### 5.9 Keepsakes: the Chronicle and the Tapestry
**Chronicle.** A running history of your realm in the Realm panel: short, dated, iconed entries
for the moments worth remembering, e.g.:
- the first conquest
- each capital toppled, and decapitation
- a triple-crown victory
- a new fastest battle
- the first Prosperity III
- surrenders accepted
- the dynasty founded

Each dynasty keeps its own chapter, of at most about 40 entries; lifetime highlights carry over.
Entries name regions and rival leaders, so the history reads like a story ("Year 2: Khan
Gashrok's Amber Horde yields Dunspire").

**Tapestry.** "Save the map" in the Realm panel, and offered on the Found a Dynasty screen,
renders your whole continent with the real renderer: your territory, banners and region names.
It's framed as a woven/parchment keepsake with the dynasty number, the date and the headline
stats (regions, battles won, crowns, time played), and downloaded as a PNG. No server; it's
balance-neutral pure delight. The map is the game's best screenshot, so let players keep it.

---

## 6. First-time experience: a tutorial that teaches every control

Principles:
- Teach **one thing at a time, when it is useful**, and advance when the player *does* it.
  Never a wall of text.
- The first battle teaches the essentials. Later battles introduce the rest, one control
  per battle.
- Every hint points exactly at what it talks about (PLAYFEEL §4 placement rules), can be
  dismissed, and "Hints" in Settings turns them off.
- "Replay tutorial" in Settings starts it again.
- The `?` controls card lists everything, with mouse/keyboard and touch columns.

Sequence (details in PLAYFEEL §4):
1. **World:** your realm pays gold. Then pan and zoom the map (drag, scroll or pinch). Then
   click a glowing region, then Attack.
2. **Battle 1 (the essentials):**
   - drag from the War Camp (green arrow = capture)
   - choose how much to send (1–4 or the bar)
   - capture to grow troops, and take the keep to win
   - send from several settlements at once (click or tap to select; shift-drag lasso; `A`
     for all)
   - **Rally**: what it does and how to aim it
3. **Battle 2:** supply lines (auto-send), front lines ("you can only attack where your land
   touches theirs"), pause and speed.
4. **Battle 3 and later, as each unlocks:** Firestorm and the other powers (hotkeys
   Q/W/E/R/T, aiming, cooldowns), clearing a selection (right-click or Esc).
5. **World, as each becomes relevant:** the War Council after the first victory, Scout on
   the first unscouted frontier card, Region Works after the third conquest, Found a Dynasty
   when the continent is yours.

---

## 7. Art direction — "tabletop diorama"

The world should look like a hand-painted board-game map someone would want to screenshot.
Everything is drawn procedurally on canvas: no image assets.

### 7.1 Terrain
- **2.5D hex tiles**: pointy-top, each land tile a top face plus a darker "skirt" below it,
  so the land reads as a raised diorama over the sea. Elevation levels: water 0, lowland 1,
  hills 2, mountains 3. Lower-right skirt faces are darker than lower-left (light from top-left).
- Rows are drawn back-to-front so nearer tiles overlap farther skirts.
- Per-tile colour jitter (±4% lightness, seeded) so fields of grass never look flat.
- Palette (top faces):
  - deep ocean `#1f4f6e`, ocean `#27668a`, shallows `#3b8fb0`, beach `#e3cf98`
  - grassland `#86b46a`, meadow `#9cc46e`, forest floor `#5f9a55`, pine floor `#4f8a5a`
  - hills `#a9b66c`, mountain rock `#8d8478` (snowcap `#f4f6f8`), snow `#e8eef2`
  - savanna `#cdb96c`, desert `#e0c07e`, marsh `#6f9a7d`
  - river `#4fa6cc`, road `#c9a66b` (edge `#9c7c4a`)
- Decorations: forests get 3–5 stylised trees (round deciduous, triangular pines in the
  cold, palms/cacti in the arid south) with soft contact shadows; hills get two shaded
  mounds; mountains get 1–2 faceted peaks (lit face / shaded face / snowcap); grassland gets
  sparse tufts; tiles next to villages get patchwork farm fields.
- Water: depth-shaded, gentle animated wave glints, white foam along coastlines.
- Clouds: large soft puffs (layered radial gradients) that drift slowly over hidden regions
  and part (expand + fade) when revealed. Faint cloud *shadows* drift over the visible land.

### 7.2 Settlements and units
- Drawn as little buildings: cream walls, roofs in the owner colour (Free Folk: warm brown),
  stone greys for forts/towers/keeps. Hamlet = 2 cottages, village = 3 + well, town = 5 +
  bell tower, fort = square wall with corner towers, tower = tall crenellated tower, keep =
  castle with towers and a big banner, camp = three tents.
- Every owned settlement flies a waving banner in its owner colour with the owner emblem
  (colour-blind safe: emblems differ, not just hues).
- Troop count: a rounded pill under the settlement, owner colour, bold white numerals with a
  dark outline. Always legible over any terrain.
- Squads: a tight cluster of little soldier dots (up to 12 drawn, count on a small pill)
  in the owner colour with a leading banner, a faint dust trail, and a gentle bob.

### 7.3 Territory
- Owned land is tinted in the owner colour; the border of each owner's territory is a crisp
  2–3 px line in the owner colour with a dark hairline outside. Region boundaries inside an
  owner's territory are thin dashed light lines.
- In battle, each tile of the target region belongs to its nearest settlement, so the land
  itself recolours as settlements flip.

### 7.4 Juice (non-negotiable)
- Send: whoosh + dust puff at the gate. Field clash: sparks and a thud. Capture: shockwave
  ring, owner-colour burst, banner raise, the surrounding tiles recolour in a ripple, and a
  gentle screen shake. Tower arrows are visible. Firestorm is a proper fireball with embers
  and a scorch that fades.
- Victory: the whole region floods with your colour tile-by-tile from the keep outward,
  coins arc from the keep to the gold counter, a banner-style **VICTORY** card.
- Idle: periodic "+gold" coin pops rise from your regions; the gold counter rolls smoothly.
- Hover: settlements and regions lift/brighten; buttons have press states.
- Honour the Reduce Motion setting: no shake, fewer particles, instant camera cuts.

### 7.5 UI
- Map-first: the world is always the background; UI floats on it in glass panels.
- Panels: `rgba(16,20,30,0.78)` with `backdrop-filter: blur(10px)`, 1 px
  `rgba(255,255,255,0.08)` border, 14 px radius, soft shadow.
- Text: cream `#f3ead7`, muted `#a3a9b6`. Gold `#f5c451`. Good `#6fcf97`. Bad `#eb5757`.
- Primary buttons: gold gradient `#f7d774 → #e0a82e`, dark text `#2a1d05`, 10 px radius,
  press-down state. Secondary: translucent with light border.
- Type: **Cinzel** (Google Fonts, 600/700) for titles, region names and banners;
  **Nunito** (600/700/800) for everything else; tabular numerals for numbers. Fallbacks:
  Georgia / system-ui.
- Icons: a small hand-made inline SVG set (coin, sword, shield, boot, horn, flame, bell,
  crown, star, clock, castle, tower, tent, gear, sound on/off).
- Numbers are formatted short: 950, 1.2K, 34.5K, 1.20M, 3.4B, then letter pairs.

### 7.5a Accessibility (requirements, not nice-to-haves)
- **Keyboard:** the whole core loop is playable without a pointer.
  - World: a **Regions** list panel in the HUD, which also serves as a realm overview for
    everyone, plus an arrow-key map cursor (Enter opens the card).
  - Battle: an arrow-key site cursor. Enter selects your site or sends to another; a power
    armed with its hotkey takes the target under the cursor.
  - Every panel and dialog: focus moves in, Tab is trapped, Escape closes, focus is restored.
  - Shortcuts never fire through a focused button or an open dialog; letter keys use physical
    key codes.
  - A battle auto-pauses while a dialog is open.
- **Screen readers:** every control has a name and state (powers: "Rally, level 1, ready";
  switches; fractions with pressed state). Toasts, hints, results and the welcome-back card
  are polite live regions. The canvas has a text summary.
- **Motion:** Reduce Motion starts from the OS `prefers-reduced-motion`. It freezes the title
  drift, makes camera flights instant, parts the clouds without animation, stills the pulses,
  and turns infinite CSS animations off.
- **Never colour alone:**
  - The send arrow's outcome is also a shape: a solid shaft with ✓ for capture, dashed with
    × for not enough, dotted for no route. The outcome word sits by the arrowhead, and on
    touch the tooltip appears above the finger.
  - Faction colours stay distinguishable under deuteranopia and protanopia (azure vs violet
    especially), with larger emblems on banners.
- **Contrast and size:**
  - Text ≥ 4.5:1 over real map backdrops: lighter muted/dim tokens, and panels about 90%
    opaque where text sits.
  - Text floor of 12 px on phones (map chips 11 px).
  - Touch targets ≥ 44 px.
  - A visible focus ring on every control.
- **Assist:** a 0.5× battle speed (Settings → "Slow battles"; when on, the speed button
  cycles 0.5×/1×/2×/3×, otherwise 1×/2×/3×); "Paused" shown as text; toasts pause while hovered or
  focused; a separate sound-effects volume and an M mute key.

### 7.6 Sound
Synthesised with WebAudio (no files): send, clash, capture, lose settlement, arrow, fireball,
rally horn, shield, levy bell, coin, upgrade sparkle, button tick, victory fanfare, defeat.
Master mute in settings, remembered. Audio starts on the first user gesture.

### 7.7 Living map
The map is the progress bar: you should *see* your empire grow and work.

- **Caravans:** little carts with cloth in your colour roll along the roads from your
  settlements to their region's keep, then keep to keep toward your home capital. Income made
  visible:
  - Density scales with income.
  - At most 40 on screen.
  - Faint dust behind them.
  - Hidden at far overview zoom; drawn as tiny dots between zooms.
- **Prosperity growth (§5.6):**
  - Level I: farm fields spread one more ring around villages and hamlets.
  - Level II: extra cottages on nearby grass and a windmill.
  - Level III: the region's roads are paved in stone and a market awning appears at the
    keep.
  These visuals are baked into the terrain chunks, so they cost nothing per frame.
- **Ambient life:**
  - chimney smoke rising from your settlements
  - windmill sails turning
  - small sailboats bobbing off Harbour regions
  - an occasional flock of birds crossing forests
- **Budget:** at most 1 ms per frame for all ambient life at 1440×900. None of it appears in
  the battle arena while a battle is on.
- **Reduce Motion:** no birds, static windmills, fewer smoke puffs, caravans still move
  (slowly).

---

## 8. Platform

- Static site on GitHub Pages at `https://ka1e27.github.io/temp/`. All paths relative.
- Zero dependencies, no build step, vanilla ES modules. Google Fonts via `<link>` with system
  fallbacks.
- Works on desktop (mouse + keyboard) and phones (touch: tap-select, drag-send, pinch-zoom,
  two-finger pan), portrait and landscape.
- Installable PWA with an offline service worker (network-first so updates always land).
- Save in `localStorage` (new key, independent of v1), autosave every 5 s and on hide; the
  in-progress battle is saved too, so a reload resumes the fight. Export/import save string
  in settings.
- `?dev=1` enables a developer panel (grant gold, reveal map, win/lose battle, speed ×8,
  reseed).

---

## 9. Explicitly out of scope
Multiplayer, accounts, servers, monetisation, energy timers, random loot. Multiple troop
types (the v1 lesson: one troop type plus settlements, terrain, towers, interception and
powers gives more real decisions than eight unit types did).
