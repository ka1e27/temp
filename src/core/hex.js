// Axial hex coordinates (q, r), pointy-top layout.
// Shared by the world map and the battle map — the highest-reuse module here.
// PURE: no DOM, no Math.random, no Date.now.

/** @typedef {{q:number, r:number}} Hex */

/** Neighbour directions in axial space, clockwise from east. */
export const DIRS = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

export const key = (q, r) => `${q},${r}`;
export const parseKey = (k) => {
  const [q, r] = k.split(',');
  return { q: +q, r: +r };
};

export const add = (a, b) => ({ q: a.q + b.q, r: a.r + b.r });
export const equals = (a, b) => a.q === b.q && a.r === b.r;

/** Axial -> cube. Cube's third axis is implied: s = -q - r. */
export const toCube = ({ q, r }) => ({ x: q, y: -q - r, z: r });

/** Hex distance: half the Manhattan distance in cube space. */
export function distance(a, b) {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

export function neighbors(h) {
  return DIRS.map((d) => add(h, d));
}

/** All hexes within `radius` of centre, including centre itself. */
export function withinRadius(centre, radius) {
  const out = [];
  for (let dq = -radius; dq <= radius; dq++) {
    const lo = Math.max(-radius, -dq - radius);
    const hi = Math.min(radius, -dq + radius);
    for (let dr = lo; dr <= hi; dr++) out.push({ q: centre.q + dq, r: centre.r + dr });
  }
  return out;
}

/**
 * Axial -> pixel centre, pointy-top.
 * @param {Hex} h @param {number} size circumradius in px
 */
export function toPixel(h, size) {
  return {
    x: size * Math.sqrt(3) * (h.q + h.r / 2),
    y: size * 1.5 * h.r,
  };
}

/** Pixel -> nearest hex, pointy-top. Inverse of toPixel, then rounded in cube space. */
export function fromPixel(x, y, size) {
  const r = (2 / 3) * (y / size);
  const q = (Math.sqrt(3) / 3) * (x / size) - r / 2;
  return round({ q, r });
}

/** Round fractional axial coords to the nearest hex (via cube rounding). */
export function round(frac) {
  let x = frac.q;
  let z = frac.r;
  let y = -x - z;
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const dx = Math.abs(rx - x);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - z);
  // Discard whichever axis drifted most, recompute it from the other two.
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}

/** The six corner points of a pointy-top hex, for canvas paths. */
export function corners(centre, size) {
  const { x, y } = toPixel(centre, size);
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push({ x: x + size * Math.cos(a), y: y + size * Math.sin(a) });
  }
  return pts;
}

/**
 * A* over a hex grid. Deterministic: the open set is kept sorted by (f, then key)
 * so equal-cost paths always resolve identically across runs and engines.
 * @param {Hex} start @param {Hex} goal
 * @param {(h:Hex)=>boolean} passable
 * @returns {Hex[]|null} inclusive path start..goal, or null if unreachable
 */
export function findPath(start, goal, passable) {
  if (equals(start, goal)) return [start];

  const startK = key(start.q, start.r);
  const goalK = key(goal.q, goal.r);
  const cameFrom = new Map();
  const g = new Map([[startK, 0]]);
  const open = [{ h: start, f: distance(start, goal), k: startK }];

  while (open.length) {
    // Sorted pop: cheapest f wins, key breaks ties deterministically.
    open.sort((a, b) => a.f - b.f || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
    const cur = open.shift();
    if (cur.k === goalK) {
      const path = [cur.h];
      let k = cur.k;
      while (cameFrom.has(k)) {
        k = cameFrom.get(k);
        path.push(parseKey(k));
      }
      return path.reverse();
    }

    for (const nb of neighbors(cur.h)) {
      if (!passable(nb)) continue;
      const nk = key(nb.q, nb.r);
      const tentative = g.get(cur.k) + 1;
      if (tentative < (g.get(nk) ?? Infinity)) {
        cameFrom.set(nk, cur.k);
        g.set(nk, tentative);
        const f = tentative + distance(nb, goal);
        const existing = open.find((o) => o.k === nk);
        if (existing) existing.f = f;
        else open.push({ h: nb, f, k: nk });
      }
    }
  }
  return null;
}
