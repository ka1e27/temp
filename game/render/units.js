// Battle squad rendering (DESIGN §7.2): squads interpolated between fixed simulation ticks, standing
// on the raised tile tops, facing along their path, plus the enemy INTENT lines (faint dashed
// route to each hostile squad's target). Browser only; no game/battle mutation.
import { drawSquad } from './sprites.js';
import { squadPosition } from '../battle/sim.js';
import { tileAt } from '../battle/runtime.js';
import { PLAYER_OWNER } from '../battle/owner.js';
import { elevOffset } from './tiles.js';
import { factionColor, rgba } from './palette.js';

const SQUAD_SIZE_FACTOR = 0.8; // × camera.zoom, matching the settlement/tile scale

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
  return { lift, dx: toTile.x - fromTile.x, dy: toTile.y - fromTile.y };
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
    if (!before) return { x: cur.x, y: cur.y, lift: info.lift, dx: info.dx, dy: info.dy };
    const a = Math.max(0, Math.min(1, alpha));
    return {
      x: before.x + (cur.x - before.x) * a,
      y: before.y + (cur.y - before.y) * a,
      lift: before.lift + (info.lift - before.lift) * a,
      dx: info.dx,
      dy: info.dy,
    };
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} camera
   * @param {object} battle BattleState
   * @param {number} alpha fixed-step interpolation alpha (0..1)
   * @param {number} t seconds, for the marching bob / banner flutter
   */
  function draw(ctx, camera, battle, alpha, t) {
    // Back to front so nearer squads overlap farther ones.
    const list = battle.squads.map((sq) => ({ sq, p: interpolated(battle, sq, alpha) }));
    list.sort((a, b) => a.p.y - b.p.y);
    const s = camera.zoom * SQUAD_SIZE_FACTOR;
    for (const { sq, p } of list) {
      const screen = camera.worldToScreen(p.x, p.y - p.lift);
      drawSquad(ctx, screen.x, screen.y, sq.count, sq.owner, s, t, p.dx, p.dy, { phase: sq.id * 1.7 });
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
      if (!intentWorthDrawing(battle, sq)) continue;
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

  return { snapshot, draw, drawIntent, reset };
}
