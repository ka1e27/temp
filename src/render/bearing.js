// WHICH WAY IS THE THRONE — a bearing, not a position.
//
// MEASURED: at tick 0 the campaign opener reads `sites 11 · mine 3 · seen 3 ·
// known non-player sites 0` on every seed tried (1/7/42/99). Zero, not "few".
// So the objective strip says TAKE THE CASTLE about a building that is not on
// the board, and the whole select-a-building-and-attack-it vocabulary has
// nothing to operate on — driven in a browser, a policy playing the way an RTS
// player thinks issued zero orders in 340 seconds because its target set never
// became non-empty. On widowsgate (21x16) it is far worse than on riverfen.
//
// A DIRECTION IS NOT A GHOST, AND THAT DISTINCTION IS THE WHOLE DESIGN. The
// obvious one-line fix — seed the throne into `state.seen` — was tried and
// REVERTED: it makes the castle a clickable ghost with an owner colour and its
// own influence flood, and it reverses a deliberate, tested decision. A
// previous pass fog-gated `castleTouchesPlayer` precisely so the coach could
// not announce "the throne is there, take the countryside first" about a castle
// nobody has looked at — *"the same leak as a rally line drawn into the dark,
// except this one is the GAME talking, which reads as authoritative rather than
// as a guess"* — and three tests encode it. The finding that asked for this
// says so too: the fix is not "show the buildings".
//
// So nothing here touches `state.seen`, `canSee` or `siteKnown`. The marker
// draws only while the throne is NOT known, and retires the instant it is —
// once you can see the thing, an arrow pointing at it is clutter.
//
// It discloses a heading and the fact the game already states out loud. It does
// not disclose distance, garrison, level, what surrounds it, or the route.
import { siteKnown } from '../battle/vision.js';

/**
 * How far from the CAMP the needle sits, in hexes — a compass beside your own
 * gate, not a pin on the map.
 *
 * A SCREENSHOT CAUGHT THE FIRST VERSION DOING THE OPPOSITE. It walked from the
 * camp toward the throne and clipped at the board's edge — but the throne is
 * ON the board, so the clip never bound and the marker was drawn exactly on the
 * castle. That is not "discloses strictly less than a ghost", it is a ghost
 * without the fog gate: the precise position, for free, at tick 0. Anchoring it
 * to the camp is what makes the claim true rather than merely intended.
 */
const NEEDLE_HEXES = 2.2;
/** Chevron half-height, in hexes, so it scales with the board rather than the
 *  screen — a bigger map draws it smaller, exactly as it draws everything. */
const SIZE = 0.42;

/**
 * The throne this faction is told to take, or null when there is nothing to
 * point at: no capture-castle victory, no enemy castle, or one already known.
 *
 * Exported so a test can state the retirement rule without a canvas.
 */
export function bearingTarget(state, faction) {
  if (state?.rules?.victory !== 'capture-castle') return null;
  const sites = state.sites ?? [];
  for (let i = 0; i < sites.length; i++) {
    const s = sites[i];
    if (s.kind !== 'castle' || s.owner === faction) continue;
    return siteKnown(state, faction, s) ? null : s;
  }
  return null;
}

/**
 * Draw the marker, if there is one.
 *
 * Placed on the segment from the CAMP to the throne, clipped to just inside the
 * board's own bounds — so it reads as "over there, past the edge of what you
 * can see" rather than as a pin on the map. Anchoring it to the camp rather
 * than to the viewport keeps it stable while the camera pans, which is what
 * makes it a compass instead of a cursor.
 *
 * @param {object} ctx    canvas 2D
 * @param {object} state  battle state
 * @param {string} faction viewing faction
 * @param {object} geo    { hexPos(q, r, out) }
 * @param {object} bounds { minX, minY, maxX, maxY } world extent of the board
 * @param {number} size   hex size in world units
 * @param {object} palette
 * @param {number} px     one screen pixel in world units
 */
export function drawBearing(ctx, state, faction, geo, bounds, size, palette, px) {
  const throne = bearingTarget(state, faction);
  if (!throne) return;
  const home = (state.sites ?? []).find((s) => s.owner === faction && s.kind === 'camp');
  if (!home) return;

  const a = geo.hexPos(home.hex[0], home.hex[1], { x: 0, y: 0 });
  const b = geo.hexPos(throne.hex[0], throne.hex[1], { x: 0, y: 0 });
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < size) return;          // the throne is basically on top of us
  const ux = dx / len;
  const uy = dy / len;

  // A FIXED STEP FROM THE CAMP, never a fraction of the way there: a distance
  // that scaled with the throne's would leak the distance, which is most of the
  // position on a small board. Halved only when the throne is nearer than the
  // needle itself, so the marker cannot end up beyond what it points at.
  const t = Math.min(size * NEEDLE_HEXES, len * 0.5);
  if (!(t > 0)) return;
  const x = a.x + ux * t;
  const y = a.y + uy * t;
  // Stay on the board, so the needle never floats in the margin.
  if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) return;

  // Long and narrow, so it reads as a POINTER rather than as a piece on the
  // board — the first cut was near-equilateral and looked like a unit.
  const s = size * SIZE;
  const nx = -uy;
  const ny = ux;
  ctx.beginPath();
  ctx.moveTo(x + ux * s * 1.6, y + uy * s * 1.6);
  ctx.lineTo(x - ux * s * 0.8 + nx * s * 0.62, y - uy * s * 0.8 + ny * s * 0.62);
  ctx.lineTo(x - ux * s * 0.35, y - uy * s * 0.35);
  ctx.lineTo(x - ux * s * 0.8 - nx * s * 0.62, y - uy * s * 0.8 - ny * s * 0.62);
  ctx.closePath();
  // The ENEMY's colour, because it is their throne, and semi-transparent
  // because it is a heading rather than a thing that is there.
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = palette.owner.enemy;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = px;
  ctx.strokeStyle = palette.owner.enemy;
  ctx.stroke();
}
