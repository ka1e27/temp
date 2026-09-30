// Where ambient life happens (DESIGN §7.7), decided from the world alone. PURE: deterministic, no
// DOM, no clock, no Math.random. render/ambient.js turns these places into drifting boats, chimney
// plumes and bird flocks and decides at draw time which of them the player may see.
import { DIRS } from '../core/hex.js';
import { hash32 } from '../core/rng.js';
import { AMBIENT } from '../config/ambient.js';

function tileAt(world, q, r) {
  const col = q + (r - (r & 1)) / 2;
  if (col < 0 || col >= world.cols || r < 0 || r >= world.rows) return null;
  return world.tiles[r * world.cols + col];
}

const unit = (seed, salt) => hash32(seed, salt) / 4294967296;

/**
 * Chimney anchors of every settlement type that has smoke, in world units (elevation lift applied,
 * so `camera.worldToScreen(x, y)` lands on the roof).
 * `index` is the chimney's number within its settlement (0 = the first).
 * @returns {{ id: number, settlement: number, region: number, type: string, index: number, x: number, y: number, phase: number }[]}
 */
export function collectChimneys(world) {
  const out = [];
  for (const s of world.settlements) {
    const defs = AMBIENT.smoke.chimneys[s.type];
    if (!defs) continue;
    const t = world.tiles[s.tile];
    const lift = AMBIENT.elevLift[t.elev] ?? 0;
    defs.forEach((c, k) => {
      out.push({
        id: out.length, settlement: s.id, region: s.region, type: s.type, index: k,
        x: t.x + c.dx, y: t.y - lift + c.dy,
        phase: unit(hash32(world.seed, 'smoke', s.id), k),
      });
    });
  }
  return out;
}

/** Water tiles connected to the map edge (the open sea, not inland lakes). */
export function seaTiles(world) {
  const { cols, rows, tiles } = world;
  const sea = new Uint8Array(tiles.length);
  const queue = [];
  for (const t of tiles) {
    if (t.land) continue;
    if (t.col === 0 || t.row === 0 || t.col === cols - 1 || t.row === rows - 1) {
      sea[t.i] = 1;
      queue.push(t.i);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const t = tiles[queue[head]];
    for (const d of DIRS) {
      const n = tileAt(world, t.q + d.q, t.r + d.r);
      if (n && !n.land && !sea[n.i]) { sea[n.i] = 1; queue.push(n.i); }
    }
  }
  return sea;
}

/** Chaikin corner cutting (open polyline), `iters` rounds. Points are [x, y] pairs. */
function chaikin(points, iters) {
  let pts = points;
  for (let it = 0; it < iters; it++) {
    const next = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      next.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25]);
      next.push([ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }
  return pts;
}

/**
 * @typedef {Object} BoatLane
 * @property {number} region     the Harbour region the boat belongs to
 * @property {number} seed       stable per-boat uint32
 * @property {number[]} tiles    water tile indices the lane passes over
 * @property {Float32Array} pts  x0,y0,x1,y1,... smoothed world-space path
 * @property {Float32Array} cum  cumulative length per point
 * @property {number} length
 */

/**
 * One or two drifting lanes per Harbour region, over open-sea water tiles within two hexes of that
 * region's coast. Boats ping-pong along a lane; ambient.js decides their sail colour and visibility.
 * @param {import('./generate.js').World} world
 * @returns {BoatLane[]}
 */
export function buildBoatLanes(world) {
  const sea = seaTiles(world);
  const lanes = [];
  const [minLen, maxLen] = AMBIENT.boats.laneTiles;
  const [minBoats, maxBoats] = AMBIENT.boats.perHarbour;
  for (const region of world.regions) {
    if (region.perk !== 'harbour') continue;
    const shore = new Set(); // sea tiles touching this region's coast
    let coastTiles = 0;
    for (const ti of region.tiles) {
      const t = world.tiles[ti];
      if (!t.coast) continue;
      coastTiles++;
      for (let d = 0; d < 6; d++) {
        if (!(t.coast & (1 << d))) continue;
        const n = tileAt(world, t.q + DIRS[d].q, t.r + DIRS[d].r);
        if (n && sea[n.i]) shore.add(n.i);
      }
    }
    if (!shore.size) continue;
    const shoreList = [...shore].sort((a, b) => a - b);
    // Lane water: the shore ring plus the next ring out (open enough to sail, close enough to be "off the coast").
    const lane = new Set(shoreList);
    for (const i of shoreList) {
      const t = world.tiles[i];
      for (const d of DIRS) {
        const n = tileAt(world, t.q + d.q, t.r + d.r);
        if (n && sea[n.i]) lane.add(n.i);
      }
    }
    const boats = coastTiles >= 9 ? maxBoats : minBoats;
    for (let b = 0; b < boats; b++) {
      const seed = hash32(world.seed, 'boat', region.id * 8 + b);
      const start = shoreList[Math.floor(unit(seed, 'start') * shoreList.length)];
      const len = minLen + Math.floor(unit(seed, 'len') * (maxLen - minLen + 1));
      const chain = [start];
      let heading = Math.floor(unit(seed, 'dir') * 6);
      for (let k = 1; k < len; k++) {
        const cur = world.tiles[chain[chain.length - 1]];
        let picked = -1;
        // Keep going roughly straight; turn by +/- 60 degrees when blocked.
        const wobble = unit(seed, k * 17) < 0.3 ? (unit(seed, k * 31) < 0.5 ? 1 : 5) : 0;
        for (const turn of [wobble, 1, 5, 0, 2, 4]) {
          const d = (heading + turn) % 6;
          const n = tileAt(world, cur.q + DIRS[d].q, cur.r + DIRS[d].r);
          if (n && lane.has(n.i) && !chain.includes(n.i)) { picked = n.i; heading = d; break; }
        }
        if (picked < 0) break;
        chain.push(picked);
      }
      if (chain.length < 2) continue;
      const raw = chain.map((i) => [world.tiles[i].x, world.tiles[i].y]);
      const smooth = chaikin(raw, 2);
      const pts = new Float32Array(smooth.length * 2);
      const cum = new Float32Array(smooth.length);
      smooth.forEach(([x, y], i) => {
        pts[i * 2] = x;
        pts[i * 2 + 1] = y;
        if (i > 0) cum[i] = cum[i - 1] + Math.hypot(x - smooth[i - 1][0], y - smooth[i - 1][1]);
      });
      lanes.push({ region: region.id, seed, tiles: chain, pts, cum, length: cum[cum.length - 1] });
    }
  }
  return lanes;
}

/**
 * Forest and pine tiles (bird flocks fly over them), flattened: parallel arrays of world x, y and
 * region id, in tile order.
 */
export function forestSpots(world) {
  const xs = [];
  const ys = [];
  const regions = [];
  for (const t of world.tiles) {
    if (t.terrain !== 'forest' && t.terrain !== 'pine') continue;
    if (t.region < 0) continue;
    xs.push(t.x);
    ys.push(t.y - (AMBIENT.elevLift[t.elev] ?? 0));
    regions.push(t.region);
  }
  return { xs: Float32Array.from(xs), ys: Float32Array.from(ys), regions: Int16Array.from(regions), count: xs.length };
}

