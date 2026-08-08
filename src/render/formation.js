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
  ctx.lineWidth = px * 1.25;
  ctx.lineJoin = 'round';
  for (let o = 0; o < OWNERS.length; o++) {
    let any = false;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (!BRET[i] || BOWN[i] !== o) continue;
      any = true;
      dart(ctx, i, BLEN[i] + rimOf(i, rimPx));
    }
    if (any) { ctx.strokeStyle = p.owner[OWNERS[o]]; ctx.stroke(); }
  }
  ctx.lineJoin = 'miter';
}
