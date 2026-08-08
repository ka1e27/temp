// What an army of N troops LOOKS like.
//
// Split from routes.js along a real seam: routes.js owns ROUTE geometry (where
// a squad is at tick t), this owns FORMATION geometry (how many pieces a body
// of troops is drawn with, where each one stands inside the block, and how they
// all reach the screen). Nothing in here knows what an arc is.
//
// Allocation-free, because every line of it runs on every frame: the piece
// buffer is a bank of module-scope typed arrays sized once at load, and the
// flush walks it in place.
import { UNIT_IDS } from '../content/balance.js';

// --- how many pieces --------------------------------------------------------

/**
 * One piece per troop while a squad is small enough to COUNT, then one more
 * piece per GROUP troops, to a hard ceiling.
 *
 * The two halves answer different questions. Below SOLO the player wants the
 * exact number and gets it without reading one: five darts IS five troops.
 * Above it nobody counts anyway — numerosity estimation is roughly logarithmic
 * — so the pieces only have to preserve ORDER, and compressing is what lets a
 * 70-stack stay a legible formation instead of becoming a blob. The count label
 * carries the exact figure at every size, which is what makes the compression
 * safe: nothing is lost, only the reading effort moves.
 *
 *   1 -> 1    5 -> 5    10 -> 10    20 -> 14    40 -> 20    70+ -> 30
 */
export const SOLO = 10;
export const GROUP = 3;
export const MAX_PIECES = 30;
export const MAX_FILES = 5;

export function pieceCount(troops) {
  const t = Math.max(1, Math.round(troops));
  if (t <= SOLO) return t;
  return Math.min(MAX_PIECES, SOLO + Math.ceil((t - SOLO) / GROUP));
}

/** Width of the block. Grows as sqrt of the piece count but is capped, so a
 *  formation is always deeper than it is wide — a column on a road, not a
 *  parade square. PURE. */
export function formationFiles(pieces) {
  return Math.min(MAX_FILES, Math.max(1, Math.ceil(Math.sqrt(pieces * 0.62))));
}

export const formationRanks = (pieces, files) => Math.ceil(pieces / files);

/**
 * Width of a CAMPED block — a besieging stack, which is standing still.
 *
 * Deliberately the inverse silhouette of a marching column: roughly two files
 * to every rank, so a dug-in stack is wide and shallow where a column is deep
 * and narrow. That difference survives all the way down to a four-pixel piece,
 * which a subtler cue would not.
 *
 * WIDTH is the quantity that is solved for, not depth. Picking the rows first
 * and dividing looks equivalent and is not: every time the row count steps up,
 * `ceil(pieces / rows)` steps DOWN, so a five-man camp came out narrower than a
 * four-man one. Width is the loud cue at a glance and it must never shrink as
 * an army grows; depth is quiet and is allowed to wobble by a row. PURE.
 */
export const MAX_CAMP_FILES = 8;
export const campFiles = (pieces) => Math.min(
  MAX_CAMP_FILES, Math.max(1, Math.min(pieces, Math.ceil(Math.sqrt(pieces * 2.2)))),
);

/** Rows in a camped block, derived from its width. Never more than
 *  ceil(MAX_PIECES / MAX_CAMP_FILES). PURE. */
export const CAMP_RANKS = Math.ceil(MAX_PIECES / MAX_CAMP_FILES);
export const campRanks = (pieces) => Math.ceil(pieces / campFiles(pieces));

/** Deterministic per-piece wobble in [-0.5, 0.5). Hashed from ids rather than
 *  drawn from Math.random, because a random offset would be resampled every
 *  frame and the whole formation would boil. PURE. */
export function wobble(a, b, axis) {
  let h = (a * 374761393 + b * 668265263 + axis * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) & 1023) / 1024 - 0.5;
}

// --- which unit each piece stands for ---------------------------------------

const NU = UNIT_IDS.length;
const WANT = new Int32Array(NU);
const IDEAL = new Float32Array(NU);
const UNIT_OF = new Uint8Array(MAX_PIECES);

/**
 * Deal `pieces` pieces out to the unit types in proportion to `comp`, writing
 * each piece's type into the shared UNIT_OF table.
 *
 * Blocks are CONTIGUOUS and in UNIT_IDS order, so a column reads as a battle
 * order — militia screening the front, the marshal in the rear — instead of a
 * scatter of confetti.
 *
 * Two rules survive the rounding, and they are the ones a player would notice
 * breaking: a type that is PRESENT keeps at least one piece (the lone marshal
 * inside a 90-stack is the single most important thing in it), and the slack is
 * always taken off whichever block is most OVER-represented rather than off the
 * largest — otherwise a 100-militia stack with one marshal loses its militia.
 */
export function planUnits(comp, troops, pieces) {
  let used = 0;
  for (let u = 0; u < NU; u++) {
    const c = comp[UNIT_IDS[u]] || 0;
    IDEAL[u] = (c * pieces) / troops;
    WANT[u] = c > 0 ? Math.max(1, Math.round(IDEAL[u])) : 0;
    used += WANT[u];
  }
  while (used > pieces) {
    // Prefer blocks that can spare a piece without vanishing; only break the
    // floor if nothing else is left, which needs more types than pieces.
    let b = pick(1, 1);
    if (b < 0) b = pick(0, 1);
    if (b < 0) break;
    WANT[b]--; used--;
  }
  while (used < pieces) {
    const b = pick(0, -1);
    if (b < 0) { WANT[0] = pieces; break; }
    WANT[b]++; used++;
  }
  let i = 0;
  for (let u = 0; u < NU; u++) {
    for (let k = 0; k < WANT[u] && i < pieces; k++) UNIT_OF[i++] = u;
  }
  while (i < pieces) UNIT_OF[i++] = 0;
}

/** The most (`dir` 1) or least (`dir` -1) over-allocated block holding more
 *  than `floor` pieces, or -1 if there is none. */
function pick(floor, dir) {
  let b = -1;
  for (let u = 0; u < NU; u++) {
    if (dir > 0 ? WANT[u] <= floor : IDEAL[u] <= 0) continue;
    if (b < 0 || (WANT[u] - IDEAL[u] - (WANT[b] - IDEAL[b])) * dir > 0) b = u;
  }
  return b;
}

/** The type index planUnits assigned to a slot. PURE (reads the shared table). */
export const unitOfPiece = (slot) => UNIT_OF[slot];

// --- the piece buffer -------------------------------------------------------

/** Forty squads at the ceiling is 1200 pieces. The buffer holds well past that
 *  and silently drops the overflow rather than growing inside a frame; the
 *  count labels still carry every number, so the failure mode is thinner
 *  formations, never a wrong one. */
const CAP = 4096;
const BX = new Float32Array(CAP);
const BY = new Float32Array(CAP);
const BHX = new Float32Array(CAP);
const BHY = new Float32Array(CAP);
const BLEN = new Float32Array(CAP);
const BUNIT = new Uint8Array(CAP);
const BOWN = new Uint8Array(CAP);
const BRET = new Uint8Array(CAP);
let n = 0;

const OWNERS = ['player', 'enemy', 'neutral'];

export const ownerIndex = (owner) => (owner === 'player' ? 0 : owner === 'enemy' ? 1 : 2);

export function beginPieces() { n = 0; }

/**
 * @param {number} x     where the piece stands
 * @param {number} y
 * @param {number} hx    unit heading — which way it faces
 * @param {number} hy
 * @param {number} len   nose length in world units
 * @param {number} slot  index within its squad, i.e. into UNIT_OF
 * @param {number} owner index from ownerIndex()
 * @param {number} ret   1 if the squad is retreating
 */
export function addPiece(x, y, hx, hy, len, slot, owner, ret) {
  if (n >= CAP) return;
  BX[n] = x; BY[n] = y; BHX[n] = hx; BHY[n] = hy; BLEN[n] = len;
  BUNIT[n] = UNIT_OF[slot]; BOWN[n] = owner; BRET[n] = ret;
  n++;
}

/** How far the owner rim stands proud of piece `i`'s body. */
const rimOf = (i, rimPx) => (BLEN[i] * 0.42 > rimPx ? BLEN[i] * 0.42 : rimPx);

/** One soldier: a dart facing (hx,hy). Vertices are computed directly — no
 *  save/rotate/restore in a loop that runs a thousand times a frame. */
function dart(ctx, i, len) {
  const hx = BHX[i];
  const hy = BHY[i];
  const w = len * 0.66;
  const tx = BX[i] - hx * len * 0.8;
  const ty = BY[i] - hy * len * 0.8;
  ctx.moveTo(BX[i] + hx * len, BY[i] + hy * len);
  ctx.lineTo(tx - hy * w, ty + hx * w);
  ctx.lineTo(tx + hy * w, ty - hx * w);
  ctx.closePath();
}

/**
 * Every piece on the board, in at most nine fills no matter how many squads are
 * marching. Canvas 2D is dominated by state changes, so the buffer is walked
 * once per COLOUR rather than once per squad.
 *
 * Three passes, and their order is the whole design:
 *
 *   1. an owner-coloured rim under every advancing piece — so as you zoom out
 *      the rims thicken relative to the bodies and a column collapses into a
 *      single faction-coloured mass;
 *   2. the unit-coloured bodies on top — so as you zoom in the same column
 *      resolves into its composition, and a ram block never looks like a
 *      militia swarm;
 *   3. retreating squads outlined and never filled. A force that cannot fight
 *      and cannot be intercepted must not read as an attack, and hollow is the
 *      word this renderer already uses for "not a threat".
 */
export function flushPieces(ctx, px, p) {
  if (!n) return;
  // Proportional OR a constant screen pixel, whichever is larger: the fraction
  // keeps friend and foe apart when zoomed right in (a spearman's green is one
  // shade off the player's own), the pixel floor keeps the rim from vanishing
  // when zoomed right out.
  const rimPx = px * 1.3;
  for (let o = 0; o < OWNERS.length; o++) {
    let any = false;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (BRET[i] || BOWN[i] !== o) continue;
      any = true;
      dart(ctx, i, BLEN[i] + rimOf(i, rimPx));
    }
    if (any) { ctx.fillStyle = p.owner[OWNERS[o]]; ctx.fill(); }
  }
  for (let u = 0; u < NU; u++) {
    let any = false;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (BRET[i] || BUNIT[i] !== u) continue;
      any = true;
      dart(ctx, i, BLEN[i]);
    }
    if (any) { ctx.fillStyle = p.units[UNIT_IDS[u]]; ctx.fill(); }
  }
  // Stroke state is touched ONLY if something is actually hollow. This flush
  // now also runs inside battleView's per-site loop (a camped siege stack), and
  // silently leaving a changed lineWidth behind there would bleed into whatever
  // the next site draws.
  let stroked = false;
  for (let o = 0; o < OWNERS.length; o++) {
    let any = false;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (!BRET[i] || BOWN[i] !== o) continue;
      any = true;
      dart(ctx, i, BLEN[i] + rimOf(i, rimPx));
    }
    if (!any) continue;
    ctx.lineWidth = px * 1.25;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = p.owner[OWNERS[o]];
    ctx.stroke();
    stroked = true;
  }
  if (stroked) ctx.lineJoin = 'miter';
}

// --- a stack that is standing still -----------------------------------------

/** How far the wings of a camp trail behind its centre, in rank spacings. */
const CAMP_BOW = 0.55;
/** How far the outermost piece turns to face outward along the line, radians. */
const CAMP_FAN = 0.34;
/** Piece spacing derived from piece size, so a camped soldier keeps exactly the
 *  proportions of a marching one. Matches drawSquads' gaps at hexSize scale. */
const GAP_ACROSS = 1.65;
const GAP_DEEP = 2.0;

/**
 * A stationary body of troops: a besieging stack camped on the site it is
 * grinding down.
 *
 * Drawn from the same pieces, at the same scale, under the same count mapping
 * as a marching column, so the two are DIRECTLY COMPARABLE. That is the whole
 * reason this exists: a siege is exactly the moment a player weighs "is this
 * enough to hold?" against the relieving columns on their way, and until now
 * the besiegers were the last thing on the board still drawn as one chevron.
 *
 * The arrangement is the inverse of a column — wide and shallow, bowed into a
 * crescent facing `angle`, with the pieces fanned outward along the line. It
 * reads as dug in rather than as a column walking on the spot.
 *
 * SELF-CONTAINED: it resets and flushes the shared piece buffer itself, so it
 * may be called anywhere in a frame EXCEPT between beginPieces() and
 * flushPieces() — i.e. never from inside drawSquads().
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} comp  per-unit-type counts keyed by UNIT_IDS
 * @param {number} x     CENTRE of the block in world units (not its head)
 * @param {number} y
 * @param {number} angle radians, pointing FROM the camp TOWARD the thing it is
 *                       besieging. With the block hung above a site that is
 *                       `Math.PI / 2` — note this is the OPPOSITE of the angle
 *                       the old chevron took, and it matters: facing the wall
 *                       puts the militia screen against it and the marshal in
 *                       the rear, and sweeps the crescent's wings the right way
 * @param {number} len   nose length of ONE piece in world units — pass the same
 *                       value drawSquads uses, or a besieging soldier will not
 *                       be the size of a marching one and the comparison the
 *                       whole feature rests on breaks
 * @param {string} owner 'player' | 'enemy' | 'neutral'
 * @param {number} px    1 / zoom
 * @param {object} p     palette
 */
export function drawStaticFormation(ctx, comp, x, y, angle, len, owner, px, p) {
  let troops = 0;
  for (let u = 0; u < NU; u++) troops += comp[UNIT_IDS[u]] || 0;
  if (troops <= 0) return;

  const pieces = pieceCount(troops);
  const files = campFiles(pieces);
  const ranks = campRanks(pieces);
  planUnits(comp, troops, pieces);
  const own = ownerIndex(owner);

  const across = len * GAP_ACROSS;
  const deep = len * GAP_DEEP;
  const hx = Math.cos(angle);
  const hy = Math.sin(angle);
  // A camp has no head, and the caller is placing a glyph rather than a
  // vanguard, so the block is centred on (x,y).
  const mid = (ranks - 1) * deep * 0.5;
  const halfW = (files - 1) * 0.5 * across;
  // World-space seed: a camp must look the same every frame, and two sieges on
  // the same board must not look like copies of each other.
  const seed = (x * 7 + y * 13) | 0;

  beginPieces();
  let slot = 0;
  for (let r = 0; r < ranks; r++) {
    const w = r === ranks - 1 ? pieces - slot : files;
    const base = (r & 1 ? 0.25 : -0.25) * across - (w - 1) * 0.5 * across;
    for (let k = 0; k < w; k++) {
      const sx = base + k * across + wobble(seed, slot, 3) * across * 0.24;
      // Position across the line as a fraction of the half-width, CLAMPED.
      // Unclamped, the stagger and the wobble push the outermost piece past 1
      // and it gets bowed and fanned out of the block; and a one-file camp —
      // a siege ground down to its last man, which is exactly when the player
      // is staring at it — divides by a zero half-width and flies off the map.
      const u = halfW > 0 ? (sx > halfW ? 1 : (sx < -halfW ? -1 : sx / halfW)) : 0;
      const sy = mid - r * deep - CAMP_BOW * deep * u * u
        + wobble(seed, slot, 4) * deep * 0.22;
      // Each piece looks outward along the line, so the block reads as deployed
      // rather than dressed for parade. Trig per piece is at most thirty calls
      // per besieged site, which is nothing next to the fills it saves.
      const a = angle + CAMP_FAN * u;
      addPiece(x - hy * sx + hx * sy, y + hx * sx + hy * sy,
        Math.cos(a), Math.sin(a), len, slot, own, 0);
      slot++;
    }
  }
  flushPieces(ctx, px, p);
}

/**
 * Half-extents of the block drawStaticFormation() would draw, so a caller can
 * offset it clear of whatever it is sitting on instead of guessing. `out.w` is
 * measured across the line, `out.h` along `angle`. PURE.
 */
export function staticFormationExtent(troops, len, out) {
  const pieces = pieceCount(troops);
  const files = campFiles(pieces);
  const ranks = campRanks(pieces);
  // A single file has no width to bow across, so it has no bow depth either.
  const bow = files > 1 ? CAMP_BOW * 0.5 : 0;
  out.w = (files - 1) * 0.5 * len * GAP_ACROSS + len;
  out.h = ((ranks - 1) * 0.5 + bow) * len * GAP_DEEP + len;
  return out;
}
