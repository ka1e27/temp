# Hex Dominion 2 — Play-feel spec (scene flow, choreography, tutorial)

Companion to `DESIGN.md` (what) and `ARCHITECTURE.md` (how). This file pins down the
*moment-to-moment* feel the integration must deliver. Timings are targets; keep them in one
place (`game/scenes/timing.js` or similar) so they can be tuned.

---

## 1. Scene flow

```
boot ──► title ──► world ⇄ battle ──► (victory|defeat card) ──► world
                     ▲ ▲
         council / realm / settings / welcome-back are overlays on world
```

- **boot:** show the inline splash (`#boot` in index.html), load the save, regenerate the
  world from `state.seed`, build renderer caches, then fade the splash out (600 ms). Target:
  interactive in < 1.5 s on a laptop.
- **title:** the living map renders behind the title card. The camera drifts slowly across
  the continent (a lazy Lissajous path, ~0.6 world units/s, gentle zoom breathing). Buttons:
  *Continue* (if a save exists), *New Realm*, *Settings*.
- **world:** HUD on top; the map is interactive. Clicking a region selects it and opens the
  region card. If the save has an unfinished battle, resume it directly (toast "Battle
  resumed").
- **battle:** see §3.
- Returning from a battle always lands on the world scene with the camera easing back out.

## 2. World scene behaviour

- **Camera limits:** min zoom = 0.85 × the zoom that fits the whole continent; max zoom ≈ 70
  px/unit. Pan clamped to the land bounds with padding. Pan inertia on.
- **Hover (desktop):** the hovered region brightens (+8% light tint) and its border glows.
- **Selection:** selected region gets a bright gold animated outline; the region card slides
  in (right side on desktop, bottom sheet on phones).
- **Frontier invitation:** every frontier region's outline pulses softly in gold
  (alpha 0.35 ↔ 0.85, 2.2 s period), so the next move is always obvious.
- **Labels:** at world zoom, each revealed region shows its name (Cinzel, cream, dark stroke)
  at its centroid; frontier regions add a small difficulty chip (Easy/Fair/Hard/Deadly,
  coloured) under the name; rival capitals add a crown glyph. Labels fade out as the camera
  zooms past ~28 px/unit (settlement-level detail takes over).
- **Idle pops:** every 2.5–4 s pick a random owned region and float `+<gold>` (gold colour)
  up from its keep, with a very quiet `coin` sound. The HUD gold counter rolls smoothly.
- **Clouds:** hidden regions sit under drifting cloud puffs; faint cloud shadows drift over
  revealed land.

## 3. Battle choreography

### Entering (≈ 1.2 s)
1. Region card "Attack" → the card and HUD slide away (200 ms).
2. Camera flies to the arena focus bounds with padding (900 ms, in-out cubic).
3. Everything outside the arena dims to ~45% brightness (fade 400 ms). Arena tiles get a
   faint inner glow along the target region border.
4. The War Camp "drops in": tents scale from 0 with a dust puff and a `rally` horn.
5. Battle HUD slides in. The sim starts on the first frame after the flight lands.

### During
- **Drag-to-send:** from an owned settlement; an animated dashed arrow follows the pointer,
  snapping to the settlement under it. The arrow is gold while it's not over a target or for a
  reinforcement, **green when the send is predicted to capture, and red when it isn't**. A tooltip
  previews
  ("Send 24 → capture, 6 left" / "…not enough, 5 short" / "Reinforce +24"), using
  `previewSend`. Release on a settlement = send; release elsewhere = cancel.
- **Selection:** tapped owned settlements show a pulsing ring; a tap on another settlement
  sends from all selected.
- **Settlement badges** always visible; a badge pulses when its settlement is under assault.
- **Events → feedback** (see the fx/sfx table from the audio/VFX engineer):
  send → dust + whoosh (enemy sends are silent but visible); clash → sparks + thud;
  assault → small repeated sparks at the gate; capture → burst in the new owner colour +
  shockwave + the settlement's Voronoi tiles recolour in a 250 ms ripple + tiny shake
  (bigger for keeps); losing a settlement → low tone + red flash on its badge; arrows →
  visible projectiles; powers → their own effects (Firestorm: fireball falls, explodes,
  scorch mark fades over 6 s).
- **Speed:** 1×/2×/3× and pause (Space). Pausing freezes the sim and dims the HUD slightly;
  the camera stays free.

### Victory (≈ 3 s, uninterruptible except by Skip)
1. Keep captured → big shockwave, `capture` + short pause of 250 ms (hit-stop feel).
2. **Surrender cascade:** every remaining enemy settlement flips to the player one by one,
   120 ms apart, each with a burst.
3. **Flood:** the whole target region recolours to the player, tile by tile outward from
   the keep (45 ms per hex of distance), with a soft shimmer on each tile as it turns.
4. `victory` fanfare + light confetti; the VICTORY card slides up (bounty, new income, perk,
   duration, troops lost/killed).
5. **Continue** → camera pulls back to world zoom (1.1 s); newly revealed regions' clouds
   part (scale ×1.6 + fade, 1.4 s, staggered 150 ms, `reveal` sound); 10–14 coins arc from
   the keep to the HUD gold counter; the bounty is credited when the first coin lands and
   the counter rolls up; new frontier regions start pulsing.

### Defeat / retreat
- Defeat: the camp's banner falls, a sombre `defeat` sting, the card offers a tip picked
  from the situation ("Forts defend at 1.8× — soften them with Firestorm first",
  "Upgrade Muster to arrive with a bigger army", …) and *Try again* / *Back to map*.
- Retreat asks for confirmation, then shows a lighter card.

## 4. Tutorial (first realm; each hint dismissible; "Hints" setting disables; "Replay tutorial" in Settings)

### Hint placement rules (non-negotiable; a hint that points at the wrong thing is worse than none)
- A hint's pointer **ends on its target**: within 8 px of the target's on-screen box, for
  world objects (settlements, regions) and UI elements alike.
- It **follows its target every frame** as the camera pans, zooms or flies. It is never a
  position computed once.
- It **never covers its target** or the thing the player must press. It flips side to stay
  clear, and it stays fully on screen at every supported viewport (1280×720 up to 1920×1080,
  390×844 portrait, 844×390 landscape, 768×1024).
- It **hides while its target is off screen** or under another panel, and reappears when
  visible. It never points at empty map.
- **At most one hint at a time.** A new hint waits at least 1.5 s after the previous one
  appeared.

### Steps
| # | when | hint (short) | points at | advances on |
|---|---|---|---|---|
| W0 | world, first load after New Realm | "This is your realm. Its villages pay you gold every second." | gold counter | 5 s or click |
| W1 | after W0 | "Drag to move the map. Scroll (or pinch) to zoom." | map centre (no pointer, small card) | a pan and a zoom |
| W2 | after W1 | "Click a glowing region to see what it offers." | the easiest frontier region's label | region selected |
| W3 | region card open | "Attack! Battles take a minute or two." | Attack button | battle starts |
| B1 | battle 1, flight landed | "Drag from your War Camp to a settlement. The arrow turns green and says 'capture' if you'll take it." (animated hand from the camp to the comfortable target) | War Camp | first player send |
| B2 | after B1 | "Choose how much to send: press 1–4 or tap the bar." | send-size bar | size changed |
| B3 | after B2 or the first capture | "Captured settlements grow troops for you. Take their keep (the castle) to win." | enemy keep | first capture or 10 s |
| B4 | player owns ≥ 2 sites | desktop: "Click your settlements to select several (or shift-drag to lasso, A for all), then click a target." touch: "Tap your settlements to select several, then tap a target." | two of your settlements | a send from ≥ 2 sources |
| B5 | Rally ready, t ≥ 15 s | "Rally: every settlement you own sends half its troops to one place at once. Press Q or tap Rally, then pick the target." | Rally button, then the keep | Rally used |
| C1 | battle 2, landed | "Set up a supply line: Ctrl-drag (or long-press, or switch on Auto) and troops keep flowing on their own." | Auto toggle and a settlement | a supply line created |
| C2 | battle 2, first "No route" or 20 s | "You can only attack where your land touches theirs. Take the near settlements first." | a blocked settlement | 6 s or click |
| C3 | battle 2, after C1 | "Space pauses. The speed button runs the battle faster." | pause and speed buttons | pause or speed used |
| P1 | first battle with Firestorm unlocked | "Firestorm: press W (or tap it), then click where it should land. Powers recharge; watch the ring." | Firestorm button | Firestorm used |
| P2 | battle with ≥ 2 selected | "Right-click or Esc clears your selection." | selection | cleared |
| M1 | world, after the first victory | "Spend gold in the War Council to grow stronger." | Council button | council opened |
| M2 | first unscouted frontier card | "Scout a region to see its garrisons and weak point." | Scout button | scouted |
| M3 | after the 3rd conquest | "Build Works in your regions: Barracks and Stables help the battles next to them." | an owned frontier region | a Work built |
| M4 | continent conquered | "Found a Dynasty: start again, stronger, on a new continent." | Realm button | Realm opened |

The `?` button in the battle HUD shows a one-screen controls card (mouse/keyboard and touch
columns) covering every control above.

## 5. Audio mix

- Master default 70%. Player actions louder than enemy/background. Arrows and coins very
  quiet and throttled. No sound before the first user gesture (unlock on first pointerdown).
- Settings mute persists in the save.

## 6. Performance budget

- 60 fps on a mid laptop at 1440×900, DPR ≤ 2. Frame work: terrain chunk blits + ≤ 60
  squads + ≤ 600 particles + ≤ 200 cloud puffs (pre-rendered puff sprites, not live
  gradients) + labels.
- No per-frame allocation in hot paths; no full redraw of every hex per frame.
- Phones: cap DPR at 2, reduce particles by half when the frame time exceeds 20 ms for a
  second (adaptive quality).
