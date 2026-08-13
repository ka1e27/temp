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
import { DIRS } from '../core/hex.js';
import { recomputeInfluence } from '../battle/influence.js';
import { perceivedSite, canSee, lastKnownGarrison } from '../battle/vision.js';
import { numStr } from '../ui/format.js';
import { garrisonLabelY } from './siteGlyphs.js';
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

// --- effects -----------------------------------------------------------------

/**
 * Does a sim event reach `faction`'s screen at all?
 *
 * THE EFFECT LAYER WAS THE SECOND LEAK, and it was the bigger one: measured on
 * gallowmoor over a whole battle, **85% of all combat and economy effects fired
 * on ground the player cannot see** — 385 gold "+N" floats over enemy training
 * grounds alone, plus every siege, every field battle and every capture. Hiding
 * a site on the board buys nothing while its yard announces each batch of
 * troops it finishes; that is a live readout of the enemy's whole economy and
 * it tells you exactly where to look. It also defeats `state.seen`, whose one
 * job is that you learn an owner by LOOKING and not before.
 *
 * Two ways through, and the second is not a leak but the opposite:
 *
 * - the hex is in sight, which is the ordinary case; or
 * - **the faction is a participant** — its own men training, its own column
 *   arriving, its own site changing hands. You always know what your own army
 *   is doing, wherever it is, and a player whose distant farm fell silently
 *   would be reading a bug rather than fog. That is why this reads the event's
 *   own actor fields (`owner` / `attacker` / `from` / `to`) instead of asking
 *   who owns the site NOW: by the time events are drained the capture has
 *   already happened, so the site the player just lost belongs to the enemy and
 *   "is it mine" answers no to the one event they most need.
 */
export function fxVisible(state, faction, ev, site) {
  if (ev.owner === faction || ev.attacker === faction
    || ev.from === faction || ev.to === faction) return true;
  if (!site) return false;
  return canSee(state, faction, site.hex[0], site.hex[1]);
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
 * established.
 *
 * GOES THROUGH `canSee` NOW, per hex, rather than reading `state.vision`
 * directly — that is the one map `canSee` answers from FIRST, but it is no
 * longer the whole answer: a marching or camped squad grants a small radius
 * of its own (battle/vision.js), and `canSee` is the one place that already
 * knows how to fold the two together. Repeating that logic here instead
 * would be a second implementation of the same rule, which is exactly the
 * kind of duplication this project has watched drift before.
 *
 * The cost this adds is bounded by `cols*rows` hex lookups times however many
 * of `faction`'s squads are in the field — still a background-only cost,
 * never a per-frame one: `state.vision` only changes at the events
 * `recomputeVision` documents (a capture, a construction finishing, a
 * watchtower opening), and every one of those already bumps
 * `influenceVersion` — the same counter that marks the background dirty. So
 * this still recomputes only whenever the background does, never once for
 * the sixty frames a second the veil itself is redrawn on. What is new is
 * that a squad's OWN contribution is only as fresh as the LAST such repaint —
 * marching squads do not bump `influenceVersion` on purpose (see the vision.js
 * file header), so the veil can lag a moving column by however long it has
 * been since something else forced a repaint. The per-frame layer (squads,
 * site detail) carries none of that lag, because it calls `canSee` fresh
 * every frame regardless of this buffer.
 * @returns {Uint8Array} 1 where the hex is fogged, 0 where it is in sight
 */
export function computeVeil(state, faction, cols, rows, buf) {
  const out = buf && buf.length === cols * rows ? buf : new Uint8Array(cols * rows);
  for (let i = 0; i < out.length; i++) {
    out[i] = canSee(state, faction, hexQ(i, cols), hexRow(i, cols)) ? 0 : 1;
  }
  return out;
}

/**
 * The veil itself: one dark fill over every hex the buffer marks fogged, no
 * matter how much of the board that is — the same batching `drawFlood` uses,
 * because a path per hex, sixty times a second, is exactly the per-frame
 * allocation the render budget forbids.
 *
 * Drawn on `#board-bg`, inside `redrawBg`, AFTER the ghost silhouettes
 * (already dimmed there, see GHOST_ALPHA) — this comment used to say
 * `#board-fx`, which stopped being true the moment the veil moved to the
 * background canvas for measured performance reasons (see battleView.js's own
 * comment at the call site); a per-frame recomposite of most of a board,
 * sixty times a second, was most of a throttled frame's cost on its own.
 * Everything the per-frame canvas draws for real — squads, live site detail —
 * still lands on top of it, the same way any fog-of-war convention keeps your
 * own army lit while the ground under it goes dark.
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

// The wash reaches exactly one ring from a remembered site — deliberately
// SLIGHT, a hint to look here rather than a second territory claim — and
// fixed at that one ring on purpose: it lets the loop below read `DIRS`
// directly (a centre plus its six neighbours) instead of calling
// `withinRadius`, which allocates a fresh array and fresh hex objects per
// site. A battle has at most a handful of remembered assaults, so the saving
// is small in absolute terms, but every other draw path in this file (and
// the ones it sits beside on `#board-bg`) holds itself to the same rule, and
// a scratch hex reused in place costs nothing to keep matching it.
const _wh = { q: 0, r: 0 };

/**
 * A FAILED ASSAULT'S MEMORY, drawn — the dark red patch around a site whose
 * garrison count `battle/vision.js recordFailedAssault` remembered.
 *
 * ON THE SAME SURFACE THE OWNERSHIP COLOURING USES: `#board-bg`, batched
 * exactly like `drawVeil` above and for the same reason — this is a wash over
 * an area of GROUND, not a mark on one site, so it belongs beside the flood
 * and the veil rather than among the per-frame glyphs. It is deliberately NOT
 * a dense Uint8Array buffer the way the veil is: a battle has at most a
 * handful of failed, remembered assaults at once, so a direct per-site scan
 * (bounded by `state.sites.length`, not by board area) is cheaper than a
 * cols*rows pass would be, and there is no reuse-across-frames case to design
 * for — this runs once per background repaint, same as everything else here.
 *
 * Only a GHOST gets the wash. The moment `faction` can see the site again
 * (`perceivedSite` returns the real object), live information supersedes the
 * memory and the ground reads as whatever it truly is now — the wash is a
 * placeholder for "you do not currently know", not a permanent scar.
 */
export function drawAssaultWash(ctx, state, faction, cols, rows, size, palette) {
  let any = false;
  ctx.beginPath();
  for (const site of state.sites) {
    if (lastKnownGarrison(state, faction, site.id) == null) continue;
    if (!perceivedSite(state, faction, site).ghost) continue;
    const cq = site.hex[0];
    const cr = site.hex[1];
    for (let d = -1; d < DIRS.length; d++) {
      // d === -1 is the centre hex itself; d >= 0 walks its six neighbours.
      _wh.q = d < 0 ? cq : cq + DIRS[d].q;
      _wh.r = d < 0 ? cr : cr + DIRS[d].r;
      if (hexIndex(_wh.q, _wh.r, cols, rows) < 0) continue;
      any = true;
      traceHex(ctx, hexCx(_wh.q, _wh.r, size), hexCy(_wh.q, _wh.r, size), size * 0.985);
    }
  }
  if (!any) return;
  ctx.fillStyle = palette.assaultWash;
  ctx.fill();
}

/**
 * The stale headcount beside it — text, so it rides the per-frame canvas
 * (`drawLabels`, alongside every other garrison number) rather than the
 * background: a ghost's live counterpart already draws its digits there, and
 * putting the stale figure anywhere else would be a second place a player has
 * to know to look for the same kind of fact.
 *
 * Reuses `garrisonLabelY` — the SAME expression the live count is hung from —
 * so a stale figure sits exactly where a live one would have, and a battle
 * that scouts the site mid-frame swaps one for the other with no jump.
 */
export function drawStaleGarrisons(ctx, state, faction, sitePos, hexSize, px, palette, out) {
  ctx.fillStyle = palette.staleText;
  for (const site of state.sites) {
    const n = lastKnownGarrison(state, faction, site.id);
    if (n == null) continue;
    if (!perceivedSite(state, faction, site).ghost) continue;
    sitePos(site, out);
    ctx.fillText(numStr(n), out.x, out.y + garrisonLabelY(site.kind, hexSize, px));
  }
}
