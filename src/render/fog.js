// FOG OF WAR, drawn — the DRAWN flood and the veil that sits over it.
//
// battle/vision.js is the engine: `perceivedSite`/`perceivedSquads` are the
// one resolver every surface is meant to call. This file is the renderer's
// own half — the two things that are not simply "hide this object", because
// there is no single object to hide.
//
// THE FLOOD IS THE LEAK NOBODY WOULD LOOK FOR. `state.influence` is computed
// from EVERY site regardless of who has ever looked at it (battle/influence.js
// `recomputeInfluence`), because the sim needs the TRUE front line for the
// castle gate, territory score and march speed. Painting that straight onto
// the board colours in the enemy's whole country from tick 0 — the same class
// of miss CLAUDE.md already records for neutral sites (a 27% share painting a
// 46% board), except here it is not a rounding error, it is every site the
// player has not earned the right to see.
//
// So `perceivedInfluence` re-runs the SAME algorithm — reusing
// `recomputeInfluence` itself rather than re-deriving its radius/weight/
// contest maths a second time in a second place, which is exactly the kind of
// duplication that has drifted apart in this project before (siteGlyphs.js
// `builtLevel` mirrors battle/state.js `effectiveLevel` on purpose, and a test
// pins the two together for that reason) — against a site list resolved
// through `perceivedSite` first. A site nobody has scouted contributes
// NOTHING: its perceived owner is `null`, and `recomputeInfluence` already
// skips any owner that is not player/enemy/neutral, so that ground never
// gets a field entry at all, exactly as if nobody had ever settled it.
//
// Applied to a THROWAWAY object, never to `state` itself, so the sim's real
// `state.influence` is never touched.
import { recomputeInfluence } from '../battle/influence.js';
import { perceivedSite } from '../battle/vision.js';
import {
  hexIndex, hexRow, hexQ, hexCx, hexCy, traceHex,
} from './hexGeom.js';

/**
 * @param {object} state @param {'player'|'enemy'} faction
 * @returns {Record<string,string>} same shape as state.influence
 */
export function perceivedInfluence(state, faction) {
  const sites = state.sites.map((site) => {
    const seen = perceivedSite(state, faction, site);
    // A ghost never carries a level — battle/vision.js remembers only the
    // owner — so it projects at the BASE weight. Painting today's true level
    // over a stale sighting would leak an upgrade back in through the
    // flood's own strength, which is exactly the sort of number a ghost
    // exists to hide.
    return seen.ghost
      ? { id: seen.id, owner: seen.owner, kind: seen.kind, hex: seen.hex, level: 1 }
      : site;
  });
  return recomputeInfluence({ sites, grid: state.grid });
}

// --- the veil ----------------------------------------------------------------

/** How much a remembered site fades against a live one — the "ghost
 *  treatment" the fog design leaves to the implementer. Reduced alpha rather
 *  than a second silhouette: a site nobody can currently verify should read
 *  as seen through haze, not as a different kind of object. */
export const GHOST_ALPHA = 0.42;

/**
 * Which hexes are OUTSIDE `faction`'s current sight, as a dense buffer — the
 * same Uint8Array-reuse shape hexRenderer.js `computeOwners` already
 * established, and for the same reason: `state.vision` only changes at the
 * events `recomputeVision` documents (a capture, a construction finishing, a
 * watchtower opening), and every one of those already bumps
 * `influenceVersion` — the same counter that marks the background dirty. So
 * this needs recomputing only whenever the background does, never once for
 * the sixty frames a second the veil itself is redrawn on.
 * @returns {Uint8Array} 1 where the hex is fogged, 0 where it is in sight
 */
export function computeVeil(state, faction, cols, rows, buf) {
  const out = buf && buf.length === cols * rows ? buf : new Uint8Array(cols * rows);
  out.fill(1);
  const vis = state.vision?.[faction];
  if (!vis) return out;
  for (const key in vis) {
    const c = key.indexOf(',');
    const i = hexIndex(+key.slice(0, c), +key.slice(c + 1), cols, rows);
    if (i >= 0) out[i] = 0;
  }
  return out;
}

/**
 * The veil itself: one dark fill over every hex the buffer marks fogged, no
 * matter how much of the board that is — the same batching `drawFlood` uses,
 * because a path per hex, sixty times a second, is exactly the per-frame
 * allocation the render budget forbids.
 *
 * Drawn EARLY on `#board-fx`, ahead of rallies, routes, sites and squads: it
 * sits over the background's own ghost silhouettes (already dimmed there,
 * see GHOST_ALPHA) but under everything this frame draws for real, the same
 * way any fog-of-war convention keeps your own army lit while the ground
 * under it goes dark.
 */
export function drawVeil(ctx, veil, cols, rows, size, palette) {
  const n = cols * rows;
  let any = false;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    if (!veil[i]) continue;
    any = true;
    const r = hexRow(i, cols);
    const q = hexQ(i, cols);
    traceHex(ctx, hexCx(q, r, size), hexCy(q, r, size), size * 0.985);
  }
  if (!any) return;
  ctx.fillStyle = palette.fogVeil;
  ctx.fill();
}
