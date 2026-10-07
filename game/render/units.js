// Battle squad rendering (DESIGN §7.2): squads interpolated between fixed simulation ticks, standing
// on the raised tile tops, facing along their path, plus the enemy INTENT lines (faint dashed
// route to each hostile squad's target). Browser only; no game/battle mutation.
import { drawSquad, drawTroopBadge } from './sprites.js';
import { drawLongboat, drawWading } from './seaMarks.js';
import { squadPosition } from '../battle/sim.js';
import { tileAt } from '../battle/runtime.js';
import { PLAYER_OWNER } from '../battle/owner.js';
import { elevOffset } from './tiles.js';
import { factionColor, rgba } from './palette.js';

const SQUAD_SIZE_FACTOR = 0.8; // × camera.zoom, matching the settlement/tile scale

/**
 * A Vendetta's Champion (PLAN-PHASE4 §4D): drawn UNDER and OVER its squad. A gold ring on the ground round the squad, and a tall lance with the leader's
 * swallow-tailed pennant in their colour (a gold crown pip at its tip), so the leader's own champion is told apart from every other squad at a glance.
 * `still` (Reduce Motion) stops the pennant's flutter and the ring's pulse.
 */
export function drawChampionMark(ctx, x, y, s, color, t, { still = false, layer = 'over' } = {}) {
  ctx.save();
  if (layer === 'under') {
    const pulse = still ? 0.5 : 0.5 + 0.5 * Math.sin((t || 0) * 3);
    ctx.globalAlpha = 0.55 + 0.25 * pulse;
    ctx.strokeStyle = '#f5c451';
    ctx.lineWidth = Math.max(1.5, s * 0.07);
    ctx.beginPath();
    ctx.ellipse(x, y + s * 0.12, s * 0.95, s * 0.45, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.18 + 0.1 * pulse;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
    return;
  }
  s *= 1.3; // the lance and pennant stand taller than any squad banner
  const px = x - s * 0.5;
  const top = y - s * 1.5;
  const base = y + s * 0.1;
  // the lance
  ctx.strokeStyle = 'rgba(20,14,8,0.9)';
  ctx.lineWidth = Math.max(2.2, s * 0.09);
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(px, base); ctx.lineTo(px, top); ctx.stroke();
  ctx.strokeStyle = '#d9b36a';
  ctx.lineWidth = Math.max(1.2, s * 0.045);
  ctx.beginPath(); ctx.moveTo(px, base); ctx.lineTo(px, top); ctx.stroke();
  // the swallow-tailed pennant, fluttering
  const w = s * 0.95;
  const hgt = s * 0.42;
  const wave = still ? 0 : Math.sin((t || 0) * 5.2) * s * 0.06;
  ctx.beginPath();
  ctx.moveTo(px, top + s * 0.04);
  ctx.quadraticCurveTo(px + w * 0.5, top + s * 0.04 + wave, px + w, top + s * 0.02 - wave * 0.6);
  ctx.lineTo(px + w * 0.74, top + hgt * 0.5 + wave * 0.3);
  ctx.lineTo(px + w, top + hgt - wave * 0.6);
  ctx.quadraticCurveTo(px + w * 0.5, top + hgt + wave, px, top + hgt);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = Math.max(2, s * 0.08);
  ctx.stroke();
  ctx.strokeStyle = '#f5c451'; // a gold hem: a leader's banner
  ctx.lineWidth = Math.max(1, s * 0.035);
  ctx.stroke();
  // a gold stripe and the gold tip: a leader's banner, not a soldier's
  ctx.strokeStyle = 'rgba(245,196,81,0.9)';
  ctx.lineWidth = Math.max(1, s * 0.04);
  ctx.beginPath(); ctx.moveTo(px + s * 0.05, top + hgt * 0.5); ctx.quadraticCurveTo(px + w * 0.35, top + hgt * 0.5 + wave * 0.5, px + w * 0.62, top + hgt * 0.5 + wave * 0.2); ctx.stroke();
  ctx.fillStyle = '#f5c451';
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.beginPath();
  ctx.moveTo(px, top - s * 0.22);
  ctx.lineTo(px + s * 0.09, top - s * 0.02);
  ctx.lineTo(px - s * 0.09, top - s * 0.02);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Elevation lift (world units) and facing of a squad's current segment. */
function segmentInfo(battle, squad) {
  const path = squad.path || [];
  if (path.length === 0) return { lift: 0, dx: 0, dy: -1 };
  const origin = battle.sites[squad.from];
  const seg = Math.min(squad.seg, path.length - 1);
  const fromTile = tileAt(battle, seg === 0 ? origin.tile : path[seg - 1]);
  const toTile = tileAt(battle, path[seg]);
  if (!fromTile || !toTile) return { lift: 0, dx: 0, dy: -1 };
  const prog = Math.max(0, Math.min(1, squad.prog));
  const lift = elevOffset(fromTile, 1) * (1 - prog) + elevOffset(toTile, 1) * prog;
  const here = prog < 0.5 ? fromTile : toTile; // PLAN-PHASE12: wading while the squad stands on a ford
  return { lift, dx: toTile.x - fromTile.x, dy: toTile.y - fromTile.y, ford: !!here.ford };
}

/**
 * @returns {{ snapshot(battle): void, draw(ctx, camera, battle, alpha, t): void,
 *   drawIntent(ctx, camera, battle, t): void, reset(): void }}
 */
/**
 * Does this squad's march deserve an intent line? Only hostile squads heading for a site that is not their owner's: ours (a threat) or a
 * neutral one (a race for it). An enemy reinforcing its own site is noise, and drawing it cluttered the first battle.
 * @param {{ sites: Array<{ owner: number }> }} battle
 * @param {{ owner: number, to: number }} sq
 */
export function intentWorthDrawing(battle, sq) {
  if (sq.owner === PLAYER_OWNER) return false;
  const target = battle.sites[sq.to];
  return !!target && target.owner !== sq.owner;
}

export function createUnitLayer() {
  let prev = new Map(); // squad id -> { x, y, lift } as of the START of the most recent sim tick

  function reset() {
    prev = new Map();
  }

  /** Call right BEFORE each battle step: remembers where every squad stood, so the frame can blend
   *  between "then" and "now" by the stepper's alpha (squadPosition's own `alpha` argument overrides
   *  segment progress, it is not a tick-interpolation factor). */
  function snapshot(battle) {
    const next = new Map();
    for (const sq of battle.squads) {
      const p = squadPosition(battle, sq);
      next.set(sq.id, { x: p.x, y: p.y, lift: segmentInfo(battle, sq).lift });
    }
    prev = next;
  }

  function interpolated(battle, sq, alpha) {
    const cur = squadPosition(battle, sq);
    const info = segmentInfo(battle, sq);
    const before = prev.get(sq.id);
    if (!before) return { x: cur.x, y: cur.y, lift: info.lift, dx: info.dx, dy: info.dy, ford: info.ford };
    const a = Math.max(0, Math.min(1, alpha));
    return {
      x: before.x + (cur.x - before.x) * a,
      y: before.y + (cur.y - before.y) * a,
      lift: before.lift + (info.lift - before.lift) * a,
      dx: info.dx,
      dy: info.dy,
      ford: info.ford,
    };
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} camera
   * @param {object} battle BattleState
   * @param {number} alpha fixed-step interpolation alpha (0..1)
   * @param {number} t seconds, for the marching bob / banner flutter
   */
  function draw(ctx, camera, battle, alpha, t, opts = {}) {
    // Back to front so nearer squads overlap farther ones.
    const list = battle.squads.map((sq) => ({ sq, p: interpolated(battle, sq, alpha) }));
    list.sort((a, b) => a.p.y - b.p.y);
    const s = camera.zoom * SQUAD_SIZE_FACTOR;
    for (const { sq, p } of list) {
      const screen = camera.worldToScreen(p.x, p.y - p.lift);
      // a Vendetta's Champion (PLAN-PHASE4 §4D) wears its leader's pennant and a gold ring
      const champ = sq.champion ? (opts.championColor || factionColor(sq.owner)) : null;
      if (champ) drawChampionMark(ctx, screen.x, screen.y, s, champ, t, { still: !!opts.still, layer: 'under' });
      // PLAN-PHASE12: a squad on a sea lane sails a small longboat (its badge rides above the sail); one on a ford wades through ripples
      if (sq.lane) {
        drawLongboat(ctx, screen.x, screen.y, s * 1.25, p.dx, p.dy, factionColor(sq.owner), opts.still ? null : t);
        drawTroopBadge(ctx, screen.x, screen.y + s * 0.55, sq.count, sq.owner, s * 0.9);
        if (champ) drawChampionMark(ctx, screen.x, screen.y, s, champ, t, { still: !!opts.still });
        continue;
      }
      if (p.ford) drawWading(ctx, screen.x, screen.y, s, opts.still ? null : t);
      drawSquad(ctx, screen.x, screen.y, sq.count, sq.owner, s, t, p.dx, p.dy, { phase: sq.id * 1.7 });
      if (champ) drawChampionMark(ctx, screen.x, screen.y, s, champ, t, { still: !!opts.still });
    }
  }

  /**
   * Faint dashed route from every hostile squad that is marching on a site that is NOT its own (ours, or a neutral one: a threat or a race;
   * see `intentWorthDrawing`) to its target (BACKLOG #1): interception is only a decision if you can see where a march is going.
   * Enemy reinforcements between their own sites are left undrawn. Drawn UNDER the squads.
   */
  function drawIntent(ctx, camera, battle, t) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineDashOffset = -(t * 22) % 26;
    const dash = Math.max(5, camera.zoom * 0.2);
    ctx.setLineDash([dash, dash * 0.9]);
    for (const sq of battle.squads) {
      // Foresight (a General's ability, DESIGN 10.11): every enemy march is revealed while it lasts, reinforcements too
      const revealed = sq.owner !== PLAYER_OWNER && battle.effects && battle.t < (battle.effects.revealUntil || 0);
      if (!revealed && !intentWorthDrawing(battle, sq)) continue;
      const path = sq.path || [];
      if (path.length === 0 || sq.seg >= path.length) continue;
      const color = factionColor(sq.owner);
      const cur = squadPosition(battle, sq);
      const info = segmentInfo(battle, sq);
      const pts = [camera.worldToScreen(cur.x, cur.y - info.lift)];
      for (let i = Math.min(sq.seg, path.length - 1); i < path.length; i++) {
        const tile = tileAt(battle, path[i]);
        if (tile) pts.push(camera.worldToScreen(tile.x, tile.y - elevOffset(tile, 1)));
      }
      if (pts.length < 2) continue;
      const trace = () => {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      };
      // dark casing so the line reads on any terrain, then the owner-colour dashes
      ctx.strokeStyle = 'rgba(8,10,14,0.42)';
      ctx.lineWidth = 4.2;
      trace();
      ctx.stroke();
      ctx.strokeStyle = rgba(color, 0.72);
      ctx.lineWidth = 2.2;
      trace();
      ctx.stroke();
      // arrowhead at the target
      const a = pts[pts.length - 2];
      const b = pts[pts.length - 1];
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const hl = Math.max(8, camera.zoom * 0.28);
      ctx.setLineDash([]);
      ctx.fillStyle = rgba(color, 0.85);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - hl * Math.cos(ang - 0.45), b.y - hl * Math.sin(ang - 0.45));
      ctx.lineTo(b.x - hl * Math.cos(ang + 0.45), b.y - hl * Math.sin(ang + 0.45));
      ctx.closePath();
      ctx.fill();
      ctx.setLineDash([dash, dash * 0.9]);
    }
    ctx.restore();
  }

  /** PLAN-PHASE13: a squad's blended world point this frame (the Usurper's hero is drawn over his squad), or null. */
  function positionOf(battle, squadId, alpha) {
    const sq = battle.squads.find((q) => q.id === squadId);
    return sq ? interpolated(battle, sq, alpha) : null;
  }

  return { snapshot, draw, drawIntent, reset, positionOf };
}
