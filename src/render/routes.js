// Everything that travels between sites: marching squads, the live drag arc,
// rally lines and the box-select rectangle.
//
// Split out of battleView.js to keep both files under the 400-line cap; the
// seam is natural, because this is the only layer that has to INVENT position.
// Squads store no coordinates at all — the sim gives them a `spawnTick` and an
// `arriveTick` computed once and never integrates movement, which kills an
// entire class of drift bug. The renderer interpolates against the current
// tick plus the loop's `alpha`, and that lives here.
//
// This file answers WHERE a squad is; formation.js answers WHAT AN ARMY OF
// THAT SIZE LOOKS LIKE. The split is what keeps both under the line cap and it
// is a real seam: nothing in formation.js knows an arc exists.
//
// Allocation-free: scratch vectors are module-scope, dash arrays are mutated
// in place, and the per-piece buffer is preallocated over in formation.js.
import { UNIT_IDS } from '../content/balance.js';
import { numStr } from '../ui/format.js';
import {
  pieceCount, formationFiles, formationRanks, planUnits, wobble,
  beginPieces, addPiece, flushPieces, ownerIndex,
} from './formation.js';
import { loadStops, legSpan, routeAt, tracePolyline } from './routePath.js';

const _a = { x: 0, y: 0 };
const _b = { x: 0, y: 0 };
const _c = { x: 0, y: 0 };
const _d = { x: 0, y: 0 };
const DASH = [0, 0];
const NO_DASH = [];

/**
 * Point along a bowed quadratic route. `bow` picks which side the arc leans,
 * so two squads crossing the same link in opposite directions never overlap.
 * PURE — unit tested.
 */
export function arcPoint(ax, ay, bx, by, bow, t, out) {
  const dx = bx - ax;
  const dy = by - ay;
  const cx = (ax + bx) * 0.5 - dy * 0.13 * bow;
  const cy = (ay + by) * 0.5 + dx * 0.13 * bow;
  const u = 1 - t;
  out.x = u * u * ax + 2 * u * t * cx + t * t * bx;
  out.y = u * u * ay + 2 * u * t * cy + t * t * by;
  return out;
}

/**
 * Unit tangent of that same bowed quadratic: which way a piece standing at `t`
 * is facing. Analytic (the Bézier derivative) rather than a finite difference,
 * so the front rank still faces forward at t=0, where a backward sample would
 * fall off the end of the curve. PURE — unit tested.
 */
export function arcHeading(ax, ay, bx, by, bow, t, out) {
  const dx = bx - ax;
  const dy = by - ay;
  const cx = (ax + bx) * 0.5 - dy * 0.13 * bow;
  const cy = (ay + by) * 0.5 + dx * 0.13 * bow;
  const u = 1 - t;
  const hx = u * (cx - ax) + t * (bx - cx);
  const hy = u * (cy - ay) + t * (by - cy);
  const m = Math.sqrt(hx * hx + hy * hy);
  if (m < 1e-9) { out.x = 1; out.y = 0; return out; }
  out.x = hx / m;
  out.y = hy / m;
  return out;
}

/** Fraction of the journey completed at tick-with-alpha `t`. */
export function squadProgress(sq, t) {
  const span = Math.max(1, sq.arriveTick - sq.spawnTick);
  const f = (t - sq.spawnTick) / span;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

export const squadBow = (sq) => (sq.id % 2 ? 1 : -1);

export function arcPath(ctx, ax, ay, bx, by, bow) {
  const dx = bx - ax;
  const dy = by - ay;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.quadraticCurveTo((ax + bx) * 0.5 - dy * 0.13 * bow,
    (ay + by) * 0.5 + dx * 0.13 * bow, bx, by);
}

/** Squad glyph: a chevron pointing along its route, area proportional to unit
 *  count so a 30-stack reads as a threat from across the map. */
export function chevron(ctx, x, y, ang, size, color, hollow = 0) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const L = size;
  const W = size * 0.72;
  ctx.beginPath();
  ctx.moveTo(x + L * c, y + L * s);
  ctx.lineTo(x + (-L * 0.72) * c - W * s, y + (-L * 0.72) * s + W * c);
  ctx.lineTo(x + (-L * 0.3) * c, y + (-L * 0.3) * s);
  ctx.lineTo(x + (-L * 0.72) * c + W * s, y + (-L * 0.72) * s - W * c);
  ctx.closePath();
  if (hollow) {
    ctx.strokeStyle = color;
    ctx.lineWidth = hollow;
    ctx.stroke();
  } else {
    ctx.fillStyle = color;
    ctx.fill();
  }
}

/**
 * Every in-flight squad, drawn as the army it is.
 *
 * A squad is a BODY OF TROOPS, not an arrow: formation.js turns its head-count
 * into N pieces, and this lays those pieces out in staggered ranks trailing
 * back along the route. Size is therefore legible without reading a number,
 * which is the whole point — a five-man raid and a fifty-man assault used to be
 * the same chevron at 3x the scale.
 *
 * Ranks are spaced along the ROUTE PARAMETER rather than in a straight line
 * behind the head, so a column BENDS through the bow and holds together through
 * the curve instead of shearing off it. That costs two arc evaluations per
 * RANK, never one per piece — a formation is at most six ranks deep, so the
 * curve costs twelve evaluations for a 30-piece army.
 *
 * @param {object} g geometry bundle {pos(site,out), byId(id), hexSize, palette}
 */
export function drawSquads(ctx, state, t, px, g) {
  const hs = g.hexSize;
  // One piece is one soldier, so a piece is the SAME size at every stack size
  // and mass is the only thing that changes. The floors are in screen pixels,
  // so a column still resolves with the camera pulled all the way out; the
  // ceilings stop a formation swelling past a hex when it is pulled further.
  const len = Math.max(hs * 0.1, px * 2.2);
  const fileGap = Math.min(hs * 0.28, Math.max(hs * 0.165, px * 4.6));
  const rankGap = Math.min(hs * 0.32, Math.max(hs * 0.2, px * 5.4));

  beginPieces();
  for (let i = 0; i < state.squads.length; i++) {
    const sq = state.squads[i];
    const from = g.byId(sq.from);
    const to = g.byId(sq.to);
    if (!from || !to) continue;
    let troops = 0;
    for (let k = 0; k < UNIT_IDS.length; k++) troops += sq.comp[UNIT_IDS[k]] || 0;
    if (troops <= 0) continue;

    const f = squadProgress(sq, t);
    const bow = squadBow(sq);
    // loadStops() fills the shared scratch with the squad's two endpoints.
    const stops = loadStops(sq, g);
    if (!stops) continue;

    const pieces = pieceCount(troops);
    const files = formationFiles(pieces);
    const ranks = formationRanks(pieces, files);
    planUnits(sq.comp, troops, pieces);
    const owner = ownerIndex(sq.owner);
    const ret = sq.retreating ? 1 : 0;
    // A retreat marches loose and wide. Combined with the hollow pieces that
    // reads as a rout rather than a push, before any colour is decoded.
    const fg = ret ? fileGap * 1.4 : fileGap;
    const rg = ret ? rankGap * 1.25 : rankGap;

    // Rank spacing in route-parameter terms, capped so a very short link is
    // never wholly swallowed by a very deep column. A trip is one leg now, so
    // its own pixel length converts a global progress fraction directly — no
    // per-leg parameter span to normalise through, the way a multi-stop chain
    // needed.
    const span = legSpan();
    const dt = Math.min(rg / span, 0.44 / (ranks > 1 ? ranks - 1 : 1));

    let slot = 0;
    for (let r = 0; r < ranks; r++) {
      const at = f - r * dt;
      const tr = at > 0 ? at : 0;
      routeAt(sq, stops, tr, bow, _c, _d);
      // Ranks that have not cleared the gate yet queue up in a straight line
      // BEHIND it instead of piling onto t=0. Without this a large army looks
      // small for the first quarter of its journey, which is precisely the
      // thing this whole change exists to stop.
      const lag = at < 0 ? at * span : 0;
      // The rear rank carries the remainder, so a column is always square at
      // the front and ragged at the back — the shape a marching body has.
      const w = r === ranks - 1 ? pieces - slot : files;
      // Half-file stagger: ranks interlock into a block instead of stacking
      // into a grid of dots.
      const base = (r & 1 ? 0.25 : -0.25) * fg - (w - 1) * 0.5 * fg;
      for (let k = 0; k < w; k++) {
        const across = base + k * fg + wobble(sq.id, slot, 1) * fg * 0.26;
        const along = lag + wobble(sq.id, slot, 2) * rg * 0.3;
        addPiece(_c.x - _d.y * across + _d.x * along,
          _c.y + _d.x * across + _d.y * along,
          _d.x, _d.y, len, slot, owner, ret);
        slot++;
      }
    }
  }
  flushPieces(ctx, px, g.palette);
}

/** Squad head-counts, drawn inside the renderer's single text pass. Below the
 *  subitizing limit the pieces ARE the number, so the label would only repeat
 *  what the formation already said; above it, it is the exact figure the
 *  compressed piece count deliberately stops carrying. */
export function drawSquadLabels(ctx, state, t, px, g, owner) {
  for (let i = 0; i < state.squads.length; i++) {
    const sq = state.squads[i];
    if (sq.owner !== owner) continue;
    let n = 0;
    for (let k = 0; k < UNIT_IDS.length; k++) n += sq.comp[UNIT_IDS[k]] || 0;
    if (n < 5) continue;
    const stops = loadStops(sq, g);
    if (!stops) continue;
    routeAt(sq, stops, squadProgress(sq, t), squadBow(sq), _c, null);
    ctx.fillText(numStr(n), _c.x, _c.y - g.hexSize * 0.44);
  }
}

/**
 * The road every squad is walking, drawn faintly behind it — without it a
 * squad crossing paths with another looked like it had appeared out of
 * nowhere, with nothing tying it back to where it left from.
 */
export function drawSquadRoutes(ctx, state, px, g) {
  DASH[0] = px * 2;
  DASH[1] = px * 7;
  ctx.setLineDash(DASH);
  ctx.lineWidth = px * 1.5;
  for (let i = 0; i < state.squads.length; i++) {
    const sq = state.squads[i];
    const stops = loadStops(sq, g);
    if (!stops) continue;
    tracePolyline(ctx, stops, squadBow(sq));
    ctx.strokeStyle = g.palette.owner[sq.owner] || g.palette.link;
    ctx.globalAlpha = 0.4;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.setLineDash(NO_DASH);
}

/**
 * The live drag arc. Solid and accent-coloured once it has snapped to a
 * target, dashed and grey while it has not — so where a send would land is
 * learned by feel rather than read in a tooltip.
 * @returns {object|null} the snapped target site
 */
export function drawDragArc(ctx, from, to, pointer, px, g) {
  const p = g.palette;
  g.pos(from, _a);
  if (to) g.pos(to, _b);
  else { _b.x = pointer.x; _b.y = pointer.y; }

  arcPath(ctx, _a.x, _a.y, _b.x, _b.y, 1);
  ctx.strokeStyle = to ? p.selection : p.border.neutral;
  ctx.lineWidth = px * 3;
  ctx.lineCap = 'round';
  if (!to) { DASH[0] = px * 5; DASH[1] = px * 5; ctx.setLineDash(DASH); }
  ctx.stroke();
  ctx.setLineDash(NO_DASH);

  arcPoint(_a.x, _a.y, _b.x, _b.y, 1, 1, _c);
  arcPoint(_a.x, _a.y, _b.x, _b.y, 1, 0.94, _d);
  chevron(ctx, _c.x, _c.y, Math.atan2(_c.y - _d.y, _c.x - _d.x),
    g.hexSize * 0.3, to ? p.selection : p.border.neutral);
  return to;
}

export function drawBox(ctx, box, px, g) {
  const x = Math.min(box.x0, box.x1);
  const y = Math.min(box.y0, box.y1);
  const w = Math.abs(box.x1 - box.x0);
  const hh = Math.abs(box.y1 - box.y0);
  ctx.fillStyle = g.palette.selectionFill;
  ctx.fillRect(x, y, w, hh);
  ctx.strokeStyle = g.palette.selection;
  ctx.lineWidth = px;
  ctx.strokeRect(x, y, w, hh);
}
