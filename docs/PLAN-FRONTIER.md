# Plan: the Living Frontier (round 4)

The user chose Plans B and C from `docs/PROGRESSION-PLANS.md` and added counterattacks,
fortifications that change hands, several battles at once with switching and a Steward AI, and
a second currency for faster prosperity.
- **Design:** DESIGN.md §10.
- **Contract:** ARCHITECTURE.md §10.
- **Team:** Opus 5.5 engineers; the lead does design calls and reviews.

## Phase 1: hold your land (the core loop change)
**Goal:** your regions get attacked while you play; you defend, fortify, juggle up to 3 battles
and switch between them; losses are occupied and can be retaken; a gentle trickle while away.

| Engineer | Owns |
|---|---|
| **Sim/meta** (opus55-engineer, new) | `buildDefenseArena` + defense mode in the sim, `steward.js`, `meta/frontier.js` (scheduler, occupy and retake, away resolver), `meta/forts.js` (+ the `fortsEffects` leaf), `meta/militia.js`, `estimateDefense`; `campaign.mjs` modelling raids, defenses and occupation; tuning rates and strengths; tests |
| **Integration** (opus55-engineer, the RC2 QA engineer) | `app/battles.js` manager; refactoring the battle scene into a view; battle tray, Tab switching, map markers and marching war bands, incoming toasts; occupied visuals and card; Fortifications panel; away report; save migration; tutorial steps; checks |

**Order:**
1. Integration refactors to the manager first using today's attack battles: no behaviour
   change, all checks green.
2. Meanwhile, sim/meta builds defense mode, the steward and frontier meta against the
   contract.
3. Wire the two together, then tune.

**Done when:** live raids happen; you can defend in person or leave it to the steward; two
battles can run while you switch; a loss is occupied and you can retake it; fortifications get
captured with the region and come back on retake; the away trickle works within its limits;
pacing still has short waits and a fair early game; all checks are green; the lead plays it.

## Phase 2: Generals and Renown
- Generals: roster, recruitment from toppled capitals, passives, actives, steward styles,
  levels with 1-of-2 skills, wounds, persistence across dynasties, assignment on the region
  card and in the tray.
- Renown: earned from crowns, defenses and retakes; spent on Festivals (a prosperity level),
  General training, mercenaries and Muster.
- HUD laurel, Realm and Chronicle hooks.

## Phase 3: a varied map
- Region types: Gold Mine, Monastery, Bandit Hold, Ruins, Dragon's Lair.
- Battle twists: Night, Blizzard, Flooded, Holy Ground, Siege (also capitals), Raid.
- Opt-in world events.

**After each phase:** a balance pass, the full QA suite, a fresh-eyes playtest, and then the
user plays. Publishing to `main` only on the user's say-so.
