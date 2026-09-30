# Hex Dominion 2 — lead designer's improvement backlog

Ideas beyond the current DESIGN.md, ranked by impact on the v2 thesis ("looks far better and
plays far better") against cost and bloat risk. v1 died of too many systems and too much UI on
minute one, so every idea below must either add a real decision, make an existing mechanic
visible, or make the world feel more alive, and must not add a currency or a screen.
Nothing here is scheduled until the lead promotes it into DESIGN.md and a brief.

## Tier 1: fold into current work (cheap, high impact)

### 1. Enemy intent and threat readouts (battle)
- Enemy squads draw a faint dashed line to their target.
- Your settlements with incoming enemies show a chip with the predicted result
  ("−14 · holds" / "falls, 6 short"), computed the same way as `previewSend`.
- **Why:** interception (DESIGN §4.4) is only a decision if you can see where a march is
  going. A smarter AI that you can't read just feels like losing.
- **Cost:** render and glue only; squads already carry their target. Integration Phase B.

### 2. Battle crowns (promoted to DESIGN §4.8)
Each region awards up to 3 crowns on conquest:
- **Victory**
- **Swift:** under the par time, which is the DESIGN §4.7 length target for its tier.
- **Unbroken:** never lost a settlement.

Each crown adds bounty; lifetime crowns show on the Realm panel. The region card shows par
time before attacking, and crowns after conquest.
- **Why:** skill expression inside an idle game, and a reason to use powers well rather than
  just wait for upgrades.
- **Cost:** pure meta function and a results-card row. The stats are already tracked
  (`bestBattleSec`, settlements lost via battle events).

### 3. Rival leaders with a voice (promoted to DESIGN §3.6)
- Each faction gets a generated leader name and about 6 lines:
  - capital battle start
  - keep lost
  - surrender offer
  - decapitation
  - player defeat
- Shown as a short banner toast. Personality-matched: Crimson boasts, Violet warns, Amber
  jeers, Free Folk grumble.
- **Why:** the factions have personalities in the AI but none on screen. Near-zero cost,
  large character gain.
- **Cost:** text table in config, one toast call per event.

## Tier 2: next round (new modules, parallel-safe)

### 4. Generative music (in progress, see STATUS)
- **World:** a slow modal harp/lute arpeggio over a soft pad. The key is seeded per dynasty.
- **Battle:** frame drums whose density follows troops in motion, a rising string layer
  while any keep is under assault, and a resolving cadence into the victory fanfare.
- Separate music volume in settings.
- **Why:** DESIGN has sound effects only. Music is the largest single feel gap left.
- **Cost:** one new module plus an audition gallery page. It can be built while integration
  runs.

### 5. A living map that shows the empire growing (promoted to DESIGN §7.7, §5.6)
- **(a) Caravans:** they walk the roads from your settlements to your capital, so income
  becomes visible; density scales with income.
- **(b) Prosperity:** owned settlements develop with tenure (`state.conqueredAt`). Hamlets
  gain cottages, farm fields spread outward, and roads get paved. Cosmetic, or with a small
  income bonus.
- **(c) Ambient life:** chimney smoke on owned settlements, windmills in grassland, boats at
  Harbour regions, birds over forests.
- **Why:** answers v1 critique #5 directly ("you never *saw* your empire grow"). The map
  becomes the progress bar.
- **Cost:** art sprites plus `render/ambient.js`. Budget of 40 or fewer caravans, all
  sprites cached, off under Reduce Motion.

### 6. Scout and Sabotage on the region card (promoted to DESIGN §5.7)
- **Scout:** cheap and one-off; reveals exact garrisons and the enemy personality.
- **Sabotage:** pay gold to cut that region's garrisons by 15%, up to twice.
- **Why:** turns the difficulty label into a lever. It gives a choice between broad upgrades
  and a surgical push on a region that sits just past Fair, and a pressure valve for the
  "longest wait ≤ 40 min" target.
- **Cost:** meta function, `campaign.mjs` policy and region card. Balance must tune it so it
  never beats upgrading overall.

## Tier 3: replayability for dynasty 2+ (after v2 ships)

### 7. Throne powers
Toppling each rival capital unlocks that faction's signature power:
- **Crimson Warcry:** +50% attack for 6 s.
- **Violet Ward:** your towers get ×2 range for 10 s.
- **Amber Stampede:** a free fast squad from the War Camp.

Progress comes through the map itself, and it strengthens the "go for the throne early"
choice (decapitation, DESIGN §3.3).

### 8. Dynasty edicts
When founding a dynasty, pick 1 of 3 seeded edicts, for example:
- "Age of Iron": +20% attack, −15% income.
- "Merchant Princes": bounty ×2, forts ×1.3.
- "Long Winter": more snow tiles, stronger towers.

Each run plays differently, not just bigger. Every edict must pass `campaign.mjs`.

### 9. Automation as a reward
- A late Realm upgrade, **Vassalage**, auto-accepts surrenders while you're away.
- From dynasty 2, Easy regions can be auto-resolved from the region card at a bounty
  penalty.
- **Why:** the idle genre's key prestige quality-of-life feature. Dynasty 2 must not mean
  re-fighting 15 trivial battles.

### 10. Keepsakes
- **Chronicle:** a short log of notable moments (fastest battle, first capital,
  decapitations) in the Realm panel.
- **Tapestry:** at dynasty end, export a PNG of the finished continent with your banner,
  dynasty number and stats (`canvas.toBlob`, no server).
- **Why:** the map is the game's best screenshot. Let players keep it and share it.

## From balance (2026-09-30)
- **Multi-phase keep / bigger capital arenas:** capital battles run about 76 s for the bot and
  about 2 min for a person. No tuning knob lengthens them; they need arena content, e.g. an
  outer wall that must fall before the keep, or more sites.

## Small polish (any round)
- Haptics on capture/victory (`navigator.vibrate`, off under Reduce Motion).
- Par-time ghost in the battle HUD.
- Defeat tips that name the specific site that broke you.
- Colour-blind pass on faction colours and emblems in the real game.
- Frontier regions whose label changed since your last visit show an up/down arrow ("now Fair").

## Rejected, and why
- **Rivals raiding your land while you're away:** punishes absence, which is anti-idle.
- **More troop types:** the v1 lesson (DESIGN §9).
- **Naval play / islands:** high world-gen and pathing cost for little battle depth.
- **Login streaks, daily chests, random loot:** timer and gacha pressure (DESIGN §9 spirit).
- **Rivals fighting each other on the world map:** makes difficulty labels unstable, and the
  map stops being yours to paint.
