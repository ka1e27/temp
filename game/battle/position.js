// Squad world-position interpolation. Split out from sim.js so combat.js (interception,
// tower targeting) can depend on it without a circular import on sim.js.
import { getRuntime } from './runtime.js';

/**
 * World-unit position of a squad along its path.
 * @param {object} battle
 * @param {object} squad
 * @param {number} [alpha] overrides the fractional progress (0..1) through the squad's
 *   current segment instead of using its stored `prog` — for a renderer interpolating
 *   between fixed simulation ticks. Omit it to get the authoritative tick position.
 * @returns {{x:number, y:number}}
 */
export function squadPosition(battle, squad, alpha) {
  const runtime = getRuntime(battle);
  const path = squad.path;
  const origin = battle.sites[squad.from];
  if (!path || path.length === 0) {
    const tile = origin && runtime.byIndex.get(origin.tile);
    return tile ? { x: tile.x, y: tile.y } : { x: 0, y: 0 };
  }
  const seg = Math.min(squad.seg, path.length - 1);
  const fromTileIndex = seg === 0 ? origin.tile : path[seg - 1];
  const fromTile = runtime.byIndex.get(fromTileIndex);
  const toTile = runtime.byIndex.get(path[seg]);
  if (!fromTile && !toTile) return { x: 0, y: 0 };
  if (!fromTile) return { x: toTile.x, y: toTile.y };
  if (!toTile) return { x: fromTile.x, y: fromTile.y };
  const arrived = squad.seg >= path.length;
  const prog = arrived ? 1 : Math.max(0, Math.min(1, alpha === undefined ? squad.prog : alpha));
  return {
    x: fromTile.x + (toTile.x - fromTile.x) * prog,
    y: fromTile.y + (toTile.y - fromTile.y) * prog,
  };
}
