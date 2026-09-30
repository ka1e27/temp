// Generic A* / Dijkstra over an abstract graph of integer node ids. Used for
// hex-tile pathfinding (world roads, battle squad movement) but knows nothing
// about hexes itself — callers supply neighbours/cost/heuristic. PURE.

/**
 * Binary min-heap keyed by (f, then insertion sequence) so pops are fully
 * deterministic for equal-f entries, given deterministic push order.
 */
class BinaryHeap {
  constructor() {
    /** @type {{id: number, f: number, seq: number}[]} */
    this.items = [];
  }

  size() {
    return this.items.length;
  }

  push(item) {
    const items = this.items;
    items.push(item);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (less(items[i], items[parent])) {
        [items[i], items[parent]] = [items[parent], items[i]];
        i = parent;
      } else break;
    }
  }

  pop() {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      const n = items.length;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < n && less(items[l], items[smallest])) smallest = l;
        if (r < n && less(items[r], items[smallest])) smallest = r;
        if (smallest === i) break;
        [items[i], items[smallest]] = [items[smallest], items[i]];
        i = smallest;
      }
    }
    return top;
  }
}

function less(a, b) {
  return a.f !== b.f ? a.f < b.f : a.seq < b.seq;
}

function reconstruct(cameFrom, goal, start) {
  const path = [goal];
  let cur = goal;
  while (cur !== start) {
    cur = cameFrom.get(cur);
    path.push(cur);
  }
  path.reverse();
  return path;
}

/**
 * A* search over a graph of integer node ids.
 * @param {Object} params
 * @param {number} params.start
 * @param {number} params.goal
 * @param {(id: number) => number[]} params.neighbors
 * @param {(from: number, to: number) => number} params.cost   must be >= 0
 * @param {(id: number) => number} params.heuristic            admissible, >= 0
 * @param {number} [params.maxNodes]  safety cap on expanded nodes
 * @returns {number[] | null} node ids start..goal inclusive, or null if unreachable
 */
export function findPath({ start, goal, neighbors, cost, heuristic, maxNodes = Infinity }) {
  if (start === goal) return [start];

  const gScore = new Map([[start, 0]]);
  const cameFrom = new Map();
  const closed = new Set();
  const heap = new BinaryHeap();
  let seq = 0;
  heap.push({ id: start, f: heuristic(start), seq: seq++ });

  let expanded = 0;
  while (heap.size() > 0) {
    const cur = heap.pop();
    if (closed.has(cur.id)) continue;
    if (cur.id === goal) return reconstruct(cameFrom, goal, start);
    closed.add(cur.id);
    expanded++;
    if (expanded > maxNodes) return null;

    const g0 = gScore.get(cur.id);
    for (const nb of neighbors(cur.id)) {
      if (closed.has(nb)) continue;
      const stepCost = cost(cur.id, nb);
      if (!Number.isFinite(stepCost)) continue;
      const tentative = g0 + stepCost;
      if (tentative < (gScore.get(nb) ?? Infinity)) {
        gScore.set(nb, tentative);
        cameFrom.set(nb, cur.id);
        heap.push({ id: nb, f: tentative + heuristic(nb), seq: seq++ });
      }
    }
  }
  return null;
}

/**
 * Multi-source Dijkstra: every reachable node gets the distance to, and the
 * index (into `sources`) of, its NEAREST source. Useful for partitioning a
 * graph around a set of seed nodes (e.g. region growth from region seeds).
 * @param {Object} params
 * @param {number[]} params.sources
 * @param {(id: number) => number[]} params.neighbors
 * @param {(from: number, to: number) => number} params.cost
 * @param {number} [params.maxNodes]
 * @returns {{ dist: Map<number, number>, source: Map<number, number> }}
 */
export function dijkstraMulti({ sources, neighbors, cost, maxNodes = Infinity }) {
  const dist = new Map();
  const source = new Map();
  const heap = new BinaryHeap();
  let seq = 0;

  sources.forEach((id, idx) => {
    if (dist.has(id)) return; // duplicate source: first one wins
    dist.set(id, 0);
    source.set(id, idx);
    heap.push({ id, f: 0, seq: seq++ });
  });

  let expanded = 0;
  while (heap.size() > 0) {
    const cur = heap.pop();
    if (cur.f > dist.get(cur.id)) continue; // stale entry, already improved
    expanded++;
    if (expanded > maxNodes) break;

    for (const nb of neighbors(cur.id)) {
      const stepCost = cost(cur.id, nb);
      if (!Number.isFinite(stepCost)) continue;
      const nd = cur.f + stepCost;
      if (nd < (dist.get(nb) ?? Infinity)) {
        dist.set(nb, nd);
        source.set(nb, source.get(cur.id));
        heap.push({ id: nb, f: nd, seq: seq++ });
      }
    }
  }
  return { dist, source };
}
