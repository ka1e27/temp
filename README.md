# Hex Dominion

[![Hex Dominion: a lush level-III realm with keeps, windmills, banners and caravans beside the sea](og.png)](https://ka1e27.github.io/temp/)

Idle conquest on a living, procedurally generated hex continent. Your banner holds one small
corner under drifting clouds. Every region you conquer pays you gold forever, even while you are
away, and that gold buys the upgrades and battle powers that crack the next, harder region.
Battles are fast (about a minute, rarely more than three), fought on the map itself, and fully deterministic: drag armies
between settlements, intercept marches in the field, call down fire, take the enemy keep. Conquer
the whole continent, then found a dynasty and do it again on a new world.

**Play it: https://ka1e27.github.io/temp/** (desktop or phone, nothing to install). The original
v1 game is still here as [`classic.html`](https://ka1e27.github.io/temp/classic.html).

Static site, vanilla ES modules, zero dependencies, no build step.

| The realm | A battle |
|---|---|
| ![A mid-game realm: prosperous regions with windmills and caravans, and a region's card with its prosperity level](docs/img/realm.jpg) | ![The first battle: dragging from the War Camp, the arrow turns green and the tooltip says the send captures](docs/img/battle.jpg) |

## How to play

The world map is the game. Tap or click a region next to yours to open its card: its strength
against your army power (Easy / Fair / Hard / Deadly), its perk, its income and the **Attack**
button. Win the battle and the region floods with your colour and starts paying.

| | Mouse and keyboard | Touch |
|---|---|---|
| Move the map | drag | drag |
| Zoom | wheel | pinch (two fingers also pan) |
| Open a region | click it | tap it |
| Send troops (battle) | drag from one of your settlements to any settlement | drag from a settlement to a target |
| Send from several | click your settlements, then click a target; shift-drag lassos; `A` selects all | tap your settlements, then tap a target |
| Share of the garrison sent | HUD buttons or keys `1` `2` `3` `4` (25 / 50 / 75 / 100 %) | HUD buttons |
| Battle powers | HUD buttons or `Q` `W` `E` `R` `T` | HUD buttons |
| Clear selection, close a panel | `Esc` or right-click | tap the close button |
| Pause, speed | `Space`, HUD 1x / 2x / 3x | HUD buttons |

Sending to one of your own settlements reinforces it. Retreat is always available and costs nothing
but the attempt. `?dev=1` on the URL opens a developer panel (grant gold, win or lose a battle,
reseed).

## Features

- **A living continent.** Generated from a seed: rivers, lakes, mountains, coasts, roads and about 27
  regions split between you, the Free Folk and three rival factions. Regions you have not reached lie
  under fog. Caravans roll along the roads, chimneys smoke, windmill sails turn, boats sail off
  harbour regions and the odd flock of birds crosses the view.
- **Fast deterministic battles.** One troop type, settlements, terrain, towers and interception; no
  dice. Five powers (Rally, Firestorm, Bulwark, Forced March, Levy) bought and levelled in the War
  Council.
- **Crowns.** A win can earn up to three: Victory, Swift (under the region's par time) and Unbroken
  (no settlement you started the battle with is captured). Each adds 25 % of the region's bounty;
  owned regions show crown pips on their label.
- **Rival leaders.** Each faction has a seeded-name leader who speaks a short line at key moments:
  first contact, battle start, their keep under assault, their defeat, your defeat.
- **Scout and Sabotage.** Two gold actions on a frontier region: Scout reveals its settlements,
  leader and a suggested weak point; Sabotage (up to twice, after scouting) cuts its starting
  garrisons by 15 % each time.
- **Prosperity.** Regions you hold grow prosperous with real time, including while you are away
  (30 minutes, 2 hours, 8 hours: +5, +10, +15 % of that region's income). You can see it on the map:
  windmills, paved roads, orchards, market awnings.
- **Idle income.** Gold accrues per second from every region, also offline: up to two hours of income
  while you are away to begin with, more with the Treasury upgrade, and a welcome-back card when you
  return. A first continent is tuned to take on the order of an hour and a half of play; then you can
  found a dynasty: a new continent with tougher enemies and permanent stars (+3 % income and +3 % bounty each).
- **Music and sound.** The score and every sound effect are synthesised with WebAudio at run time
  (no audio files); the music follows the state of the battle. Music and sound each have a toggle in
  Settings, and music has a volume slider.
- **Installable and offline.** A PWA with a service worker: after one visit the game reloads with the
  network switched off. The save lives in `localStorage` (autosaved, an in-progress battle included)
  and can be exported and imported from Settings.

## Run it locally

```bash
npm start                  # static dev server -> http://localhost:8080/
```

ES modules cannot load from `file://`, so opening `index.html` directly will not work. Any static
server does (`python3 -m http.server 8080`). Everything is relative-pathed because the site lives
under `/temp/` on GitHub Pages.

## Develop

```bash
npm test                   # node --test "game/tests/**/*.test.js"; no browser needed
npm run world -- --seed=7  # ASCII world preview and stats
npm run balance            # headless battle harness (difficulty labels against the real AI)
npm run shots              # screenshot tour of the running game (needs npm start)
```

The browser tools drive a real headless Chrome through `tools/cdp.js` (DevTools protocol, no
dependencies). Set `CHROME_PATH` if Chrome is not found (`C:/Program Files/Google/Chrome/Application/chrome.exe`
is the default on Windows).

| Tool | What it does |
|---|---|
| `node tools/check.mjs` | The smoke gate. Boots the real game, then drives it with real pointer and touch events at 1440x900 and 390x844: New Realm, a region card, Attack, a drag-send, a win, Continue, a reload with the save intact. Fails on the first failed check or any console error. Needs `npm start`. |
| `node tools/check.mjs --base=temp` | The deployed shape: serves the repo under a `/temp/` subpath with nothing at `/` (like Pages), registers the service worker and adds the deploy checks (no 404s, MIME types, manifest and icon sizes, `classic.html` loads, a reload with the network off). It starts its own server. In Git Bash write `temp`, not `/temp/` (MSYS rewrites the latter). |
| `node tools/shots.mjs [--only=desktop\|phone\|battle\|hook\|intel\|living]` | Screenshot tour of the real game into `screenshots/game/` (git-ignored). |
| `node tools/playtest.mjs --variant=desktop\|phone` | A first-session playtest as a brand-new player using real input; prints a timeline of panels, overlaps and clipped text. Meant to be read, not a pass/fail gate. |
| `node tools/launch-assets.mjs` | Regenerates `og.png` and the app icons from the live renderer (see below). |

Other scripts in `tools/` are documented in their headers: `campaign.mjs` (a headless virtual player
for a whole continent), `musicrender.mjs` (renders the score to WAV and measures it) and
`gallery/*.html` (dev galleries for art, UI, effects, music and the living map, served by `npm start`).

### Launch assets

`og.png` (1200x630), `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`,
`favicon-32.png` and `favicon.svg` are not drawn separately: `tools/launch-assets.mjs` renders them with
the game's own renderer in headless Chrome (the tile, keep, banner and sea functions for the icon; a
real frame of a prosperous realm for the social card).

```bash
node tools/launch-assets.mjs                       # everything, into the repo root
node tools/launch-assets.mjs --only=icons          # or --only=og [--seed=6 --zoom=46]
node tools/launch-assets.mjs --out=some/dir --preview=some/dir   # write elsewhere, plus contact sheets
```

## Where things are

- `docs/DESIGN.md`: what the game is and why (source of truth for gameplay and art).
- `docs/ARCHITECTURE.md`: module layout, data contracts, rules (source of truth for code).
- `docs/INTEGRATION-NOTES.md`, `docs/MUSIC.md`, `docs/PLAYFEEL.md`: implementation notes per area.
- `game/`: the game. `game/core`, `game/world`, `game/battle` and `game/meta` are pure (no DOM, no
  clock, no `Math.random`) so the simulation runs identically in Node and the browser.
- `src/`, `tests/`, `classic.html`: the v1 game (tag `v1-final`), kept for reference and as the
  classic link. Nothing in `game/` imports from it.
