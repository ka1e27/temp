// The meta layer's own FALLBACK map — the numbers meta/fallbackMap.js reads
// so the meta layer and its tests are never blocked on battle/mapgen.js.
//
// Split out of ./regions.rules.js purely for the line budget, the same way
// ./ai.data.js was split out of ./balance.js, and re-exported from there — so
// `import { BASE_GARRISON } from '../content/regions.rules.js'` (direct, or
// via regions.data.js's own re-export) keeps resolving.
// PURE DATA. No logic reads a number that is not defined here or in balance.js.
//
// THESE ARE DEAD ON THE REAL PATH, and that is what makes the four below one
// group rather than four constants that merely sat near each other. Real
// gameplay (screens/battle.js) and the balance harness (tools/simplayer.js)
// always inject battle/mapgen.js as the generator, whose sites already carry
// a `garrison` drawn from `MAPGEN.garrison` in content/balance.js — the LIVE
// table. So meta/fallbackMap.js `normalizeSites`'s `s.garrison ?? ...` branch,
// the only reader of BASE_GARRISON, NEUTRAL_GARRISON and PLAYER_SITE_GARRISON,
// never fires on that path; and `fallbackMapGen` itself, the only reader of
// FALLBACK_MAP, is never even called once a real generator is injected. A
// balance pass that edits any of the four below changes nothing a real player
// ever sees — only what a test, or the harness, builds when it leaves mapGen
// unset.

/** Starting garrisons the meta layer writes into a generated map, before
 *  enemy scaling. Battle never invents troops; the config says what is there. */
export const BASE_GARRISON = Object.freeze({
  castle: { spearmen: 4, militia: 4 },
  stronghold: { spearmen: 3, militia: 2 },
  trainingGround: { spearmen: 2, militia: 2 },
  farm: { militia: 3 },
  camp: {},
  watchtower: {}, // never placed by mapgen either; see balance.engine.js MAPGEN.garrison
});
/** Neutral sites are lightly held — they are the opening move, not a wall. */
export const NEUTRAL_GARRISON = Object.freeze({ militia: 2 });
/** Player-held outposts at the start of a region. */
export const PLAYER_SITE_GARRISON = Object.freeze({ militia: 2 });

/** Tuning for meta's own fallback layout, used only when battle/mapgen.js is
 *  not injected. Degree 3 keeps the site graph planar-ish with real front lines. */
export const FALLBACK_MAP = Object.freeze({ blockedFrac: 0.08, degree: 3 });
