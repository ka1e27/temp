// The archipelago's harbours and sea lanes on the WORLD map (PLAN-PHASE12 §12A), built once per world from world.archipelago. Browser
// canvas only; reads the state it is handed, never mutates it.
//
//   const sea = createSeaLayer(world)          null on a land continent
//   sea.drawHarbours(ctx, camera, { ownerOf, visible, t })      piers and moored boats (below the settlements)
//   sea.drawLanes(ctx, camera, { usable, visible, color, t })   dotted coastal arcs: bright when `usable(lane)`, faint when only seen
//   sea.lanes / sea.harbours                                    the precomputed geometry (world units), for the checks
import { drawHarbour, drawSeaLane } from './seaMarks.js';
import { elevOffset } from './tiles.js';
import { factionColor, rgba } from './palette.js';


function offsetNeighbors(world, i) {
  const { cols, rows, tiles } = world;
  const t = tiles[i];
  const out = [];
  for (const [dq, dr] of [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]) {
    const r = t.r + dr;
    const col = (t.q + dq) + (r - (r & 1)) / 2;
    if (col < 0 || col >= cols || r < 0 || r >= rows) continue;
    out.push(tiles[r * cols + col]);
  }
  return out;
}

/** Chaikin smoothing of a polyline (world units), keeping its ends. */
function smooth(pts, passes = 2) {
  let p = pts;
  for (let k = 0; k < passes; k++) {
    if (p.length < 3) return p;
    const out = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i]; const b = p[i + 1];
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

export function createSeaLayer(world) {
  const arch = world && world.archipelago;
  if (!arch) return null;
  const tiles = world.tiles;
  // each harbour: its settlement's tile and the direction of the open sea its boats put out on
  const harbours = (arch.harbours || []).map((sid) => {
    const st = world.settlements[sid];
    const t = tiles[st.tile];
    let dx = 0; let dy = 0;
    for (const n of offsetNeighbors(world, st.tile)) if (n && !n.land && !n.ford) { dx += n.x - t.x; dy += n.y - t.y; }
    const len = Math.hypot(dx, dy) || 1;
    return { settlement: sid, regionId: st.region ?? t.region, tile: st.tile, x: t.x, y: t.y - elevOffset(t, 1), dx: dx / len, dy: dy / len };
  });
  const byId = new Map(harbours.map((h) => [h.settlement, h]));
  // each lane: harbour a -> its sea tiles -> harbour b, smoothed into an arc that hugs the coast
  const lanes = (arch.seaLanes || []).map((l) => {
    const ha = byId.get(l.a); const hb = byId.get(l.b);
    const mid = (l.tiles || []).map((i) => ({ x: tiles[i].x, y: tiles[i].y }));
    const pts = smooth([ha ? { x: ha.x + ha.dx * 0.6, y: ha.y + ha.dy * 0.5 } : mid[0], ...mid, hb ? { x: hb.x + hb.dx * 0.6, y: hb.y + hb.dy * 0.5 } : mid[mid.length - 1]].filter(Boolean));
    return { id: l.id, a: l.a, b: l.b, regionA: ha ? ha.regionId : -1, regionB: hb ? hb.regionId : -1, pts };
  });

  function drawHarbours(ctx, camera, { ownerOf, visible, t } = {}) {
    if (camera.zoom < 7) return; // a pier is a few px at continent zoom: the lanes and the settlement say enough
    const vb = camera.visibleBounds(2);
    const s = camera.zoom;
    for (const h of harbours) {
      if (h.x < vb.minX || h.x > vb.maxX || h.y < vb.minY || h.y > vb.maxY) continue;
      if (visible && !visible(h.regionId)) continue;
      const p = camera.worldToScreen(h.x + h.dx * 0.72, h.y + h.dy * 0.62); // from the shore, out over the sea (the town covers its own hex)
      const owner = ownerOf ? ownerOf(h.regionId) : 1;
      drawHarbour(ctx, p.x, p.y, s * 1.35, h.dx, h.dy, factionColor(owner), t, { boats: 2 });
    }
  }

  function drawLanes(ctx, camera, { usable, visible, color, t } = {}) {
    for (const l of lanes) {
      if (visible && !(visible(l.regionA) && visible(l.regionB))) continue;
      const on = usable ? usable(l) : false;
      const pts = l.pts.map((q) => camera.worldToScreen(q.x, q.y));
      drawSeaLane(ctx, pts, on ? color : rgba('#d8eef2', 0.9), on ? t : undefined, { dim: !on, width: on ? 2.6 : 1.8, alpha: on ? 1 : 0.8 });
    }
  }

  return { harbours, lanes, drawHarbours, drawLanes };
}
