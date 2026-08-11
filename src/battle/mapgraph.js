// The SITE GRAPH: which sites you can send troops between.
//
// Split out of ./mapgen.js purely for the 400-line cap, the same way
// ./rally.js came out of ./sim.js, and re-exported from there — so
// `import { buildAdjacency } from './mapgen.js'` keeps working and mapgen stays
// the one front door for map generation. The division of labour: mapgen decides
// WHERE the sites are; this file decides which of them are neighbours.
//
// PURE. Deterministic given the site list — no RNG reaches this far, because a
// map that is reproducible everywhere except its adjacency is not reproducible.
import { distance, toPixel } from '../core/hex.js';
import { MAPGEN } from '../content/balance.js';

const segKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** 2D orientation sign; used to test whether two graph edges cross. */
const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

function crosses(e1, e2, pix) {
  const [a, b] = e1;
  const [c, d] = e2;
  if (a === c || a === d || b === c || b === d) return false;
  const p = pix[a]; const q = pix[b]; const r = pix[c]; const s = pix[d];
  const d1 = Math.sign(cross(p, q, r));
  const d2 = Math.sign(cross(p, q, s));
  const d3 = Math.sign(cross(r, s, p));
  const d4 = Math.sign(cross(r, s, q));
  return d1 !== d2 && d3 !== d4;
}

function components(ids, edges) {
  const adj = Object.fromEntries(ids.map((id) => [id, []]));
  for (const [a, b] of edges) { adj[a].push(b); adj[b].push(a); }
  const seen = {};
  const groups = [];
  for (const id of ids) {
    if (seen[id]) continue;
    const stack = [id];
    const group = [];
    seen[id] = true;
    while (stack.length) {
      const cur = stack.pop();
      group.push(cur);
      for (const n of adj[cur]) if (!seen[n]) { seen[n] = true; stack.push(n); }
    }
    groups.push(group.sort());
  }
  return groups;
}

/**
 * Connect each site to its nearest neighbours, then FORCE connectivity, then
 * top up to the target average degree. Edges that would cross an existing edge
 * are skipped unless connectivity depends on them — a planar-ish graph makes
 * drag targets unambiguous.
 */
export function buildAdjacency(sites) {
  const { minDegree, maxDegree, targetAvgDegree } = MAPGEN.adjacency;
  const ids = sites.map((s) => s.id);
  const pix = Object.fromEntries(sites.map((s) => [s.id, toPixel({ q: s.hex[0], r: s.hex[1] }, 1)]));
  const hexOf = Object.fromEntries(sites.map((s) => [s.id, { q: s.hex[0], r: s.hex[1] }]));

  const pairs = [];
  for (let i = 0; i < sites.length; i++) {
    for (let j = i + 1; j < sites.length; j++) {
      pairs.push({ a: ids[i], b: ids[j], d: distance(hexOf[ids[i]], hexOf[ids[j]]) });
    }
  }
  pairs.sort((x, y) => x.d - y.d || segKey(x.a, x.b).localeCompare(segKey(y.a, y.b)));

  const deg = Object.fromEntries(ids.map((id) => [id, 0]));
  const edges = [];
  const taken = new Set();
  const add = (a, b) => {
    taken.add(segKey(a, b)); edges.push([a, b]); deg[a]++; deg[b]++;
  };

  for (const { a, b } of pairs) {
    if (taken.has(segKey(a, b))) continue;
    if (deg[a] >= maxDegree || deg[b] >= maxDegree) continue;
    if (deg[a] >= minDegree && deg[b] >= minDegree) continue;
    if (edges.some((e) => crosses([a, b], e, pix))) continue;
    add(a, b);
  }

  // Connectivity beats planarity and beats the degree cap: an isolated cluster
  // is an unplayable map, a crossed line is only ugly.
  let guard = 0;
  while (components(ids, edges).length > 1 && guard++ < ids.length * 4) {
    const groups = components(ids, edges);
    const home = new Map();
    groups.forEach((g, gi) => g.forEach((id) => home.set(id, gi)));
    const best = pairs.find((p) => home.get(p.a) !== home.get(p.b) && !taken.has(segKey(p.a, p.b)));
    if (!best) break;
    add(best.a, best.b);
  }

  for (const { a, b } of pairs) {
    if (edges.length * 2 >= ids.length * targetAvgDegree) break;
    if (taken.has(segKey(a, b))) continue;
    if (deg[a] >= maxDegree || deg[b] >= maxDegree) continue;
    if (edges.some((e) => crosses([a, b], e, pix))) continue;
    add(a, b);
  }

  guaranteeSoftOpening(sites, edges, add, taken, pairs);

  edges.sort((x, y) => segKey(x[0], x[1]).localeCompare(segKey(y[0], y[1])));
  return edges;
}

/**
 * Every home base must border at least one FARM it does not own.
 *
 * Without this, a camp can generate boxed in behind a stronghold — 250 HP
 * repairing at 4/s, against an 8-unit expedition doing 4.8 siege damage. The
 * opening move is then technically legal and practically impossible, and the
 * whole battle stalls before it starts. A farm (100 HP, 2/s) is the soft target
 * that makes the first move exist.
 */
function guaranteeSoftOpening(sites, edges, add, taken, pairs) {
  const byId = Object.fromEntries(sites.map((s) => [s.id, s]));
  for (const home of sites.filter((s) => s.kind === 'camp' || s.kind === 'castle')) {
    const neighbours = edges
      .filter((e) => e[0] === home.id || e[1] === home.id)
      .map(([a, b]) => byId[a === home.id ? b : a]);
    if (neighbours.some((n) => n.kind === 'farm' && n.owner !== home.owner)) continue;

    // Nearest farm this base does not already own. `pairs` is distance-sorted,
    // so the first match is the closest one.
    const link = pairs.find((p) => {
      if (taken.has(segKey(p.a, p.b))) return false;
      const other = p.a === home.id ? byId[p.b] : p.b === home.id ? byId[p.a] : null;
      return other && other.kind === 'farm' && other.owner !== home.owner;
    });
    if (link) add(link.a, link.b);
  }
}
