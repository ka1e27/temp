# CLAUDE.md

Guidance for Claude Code in this repository.

## What this is

**Hex Dominion 2** — idle conquest on a living, procedurally generated hex continent.
Conquer regions in fast (60–150 s) deterministic real-time battles fought on the world map
itself; conquered regions pay gold forever (also offline); gold buys upgrades and battle
powers. Runs as a static site on GitHub Pages: zero dependencies, no build step.

- `docs/DESIGN.md` — what the game is and why (source of truth for gameplay and art).
- `docs/ARCHITECTURE.md` — module layout, data contracts, rules (source of truth for code).
- `docs/legacy/` — the v1 design docs. v1 code still sits in `src/`, `tests/` and old
  `tools/` scripts for reference only (tag `v1-final`). Never import from it or edit it.

## Commands

```bash
npm start                 # static dev server → http://localhost:8080/
npm test                  # node --test "game/tests/**/*.test.js"
npm run world -- --seed=7 # ASCII world preview + stats
npm run balance           # headless battle harness
npm run shots             # screenshot tour of the running game (needs npm start)
```

Browser tools use `tools/cdp.js` (Chrome DevTools protocol, no deps). On this machine:
`CHROME_PATH="/c/Program Files/Google/Chrome/Application/chrome.exe"`.

## Rules that matter

- All new code under `game/`. Vanilla ES modules, relative paths only (GitHub Pages serves
  the site from `/temp/`).
- `game/core`, `game/world`, `game/battle`, `game/meta` are pure: no DOM, no `window`, no
  `Math.random`, no `Date.now`, no `performance`, no storage. Inject them.
- Battles are deterministic; battle/game state is plain JSON (saved to localStorage).
- Every tuning number lives in `game/config/*.js`.
- Do not add dependencies.
