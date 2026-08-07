# Hex Dominion

A minimalist idle conquest game. Zero dependencies, no build step, no `node_modules`.

Conquer a hex world one region at a time. Each region you take raises your passive
income; that income buys the upgrades that crack the next, harder region.

## Run it

```bash
npm start          # → http://localhost:8080
```

**ES modules cannot load from `file://`** — opening `index.html` directly will never
work (the page will tell you so). You need the local server. `python3 -m http.server 8080`
works as a fallback.

## Develop

```bash
npm test           # unit tests — node's built-in runner, no deps
npm run check      # file-size + purity gates
npm run verify     # both of the above
npm run sim        # headless balance harness
```

## How it fits together

The game is two loops that feed each other. **Battles** are real-time: farms make
gold, strongholds spend gold to train soldiers, and you drag squads between sites to
take territory. **The meta layer** is idle: conquered regions pay crowns per second
whether or not you're playing, and crowns buy permanent upgrades.

Taking a site has two stages. First you beat its garrison in a field battle. Then you
*besiege* it — your surviving force grinds down the structure's HP while it repairs
itself. Because repair has to be out-paced before you make any progress at all, a
handful of troops genuinely cannot take a stronghold, while a real army grinds one
down in half a minute. Sieges are interruptible, so relief forces matter.

Combat contains **no randomness at all**. The outcome preview you see before
committing is not an estimate — it is the same function the simulation runs, so it is
exactly what will happen.

### Layout

```
src/core/      pure: hex math, seeded RNG, fixed-timestep loop, event bus, state store
src/battle/    pure: the battle simulation — combat, siege, movement, economy, AI
src/meta/      pure: world map, idle income, upgrades, save/load
src/content/   pure data: all tuning numbers, regions, units, strings
src/render/    canvas 2D — the hex map and territory flood
src/screens/   DOM scenes — world map, shop, battle HUD
src/ui/        DOM helpers and formatting
```

`src/core`, `src/battle`, `src/meta`, and `src/content` are **pure**: no DOM, no
`Date.now`, no `Math.random`. `npm run check` enforces it. That is what lets the whole
simulation run headless in tests and stay deterministic.

`src/battle` and `src/meta` never import each other. They communicate only through
`src/battle/contract.js`, which is validated at runtime in both directions.

All tuning numbers live in `src/content/balance.js` — a balance pass is a one-file diff.
