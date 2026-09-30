// Faction ownership: start region (0), Free Folk (1, tier 1 + ~70% of tier 2),
// and three contiguous rival sectors grown from far-apart high-tier anchors,
// each capitaled at its sector's deepest region (DESIGN §3.3).

const FREE_FOLK_TIER2_SHARE = 0.7;
const RIVAL_COUNT = 3;

/** Connected components of `remaining`, over the region graph restricted to `remaining` itself. */
function remainingComponents(remaining, regions) {
  const remainingSet = new Set(remaining);
  const seen = new Set();
  const components = [];
  for (const start of remaining) {
    if (seen.has(start)) continue;
    const comp = [];
    const queue = [start];
    seen.add(start);
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++];
      comp.push(cur);
      for (const nb of regions[cur].neighbors) {
        if (remainingSet.has(nb) && !seen.has(nb)) {
          seen.add(nb);
          queue.push(nb);
        }
      }
    }
    components.push(comp);
  }
  return components.sort((a, b) => b.length - a.length);
}

/** BFS distance (in region-graph hops) from `from` to every region. */
function graphDistances(regions, from) {
  const dist = new Array(regions.length).fill(-1);
  dist[from] = 0;
  const queue = [from];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    for (const nb of regions[cur].neighbors) {
      if (dist[nb] === -1) {
        dist[nb] = dist[cur] + 1;
        queue.push(nb);
      }
    }
  }
  return dist;
}

/** The bordering sector label (in the FULL region graph) most common among `pocket`'s neighbours. */
function bestBorderingSector(pocket, sector, regions) {
  const votes = new Map();
  for (const id of pocket) {
    for (const nb of regions[id].neighbors) {
      const s = sector[nb];
      if (s === sector[id] || s == null) continue;
      votes.set(s, (votes.get(s) ?? 0) + 1);
    }
  }
  let best = null, bestVotes = -1;
  for (const [s, count] of votes) if (count > bestVotes) { best = s; bestVotes = count; }
  return best;
}

/** Connected components of `sector` labels restricted to a single label, over the region graph. */
function sectorComponents(sector, label, regions) {
  const seen = new Set();
  const components = [];
  for (const start of Object.keys(sector)) {
    const startId = Number(start);
    if (sector[startId] !== label || seen.has(startId)) continue;
    const comp = [];
    const queue = [startId];
    seen.add(startId);
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++];
      comp.push(cur);
      for (const nb of regions[cur].neighbors) {
        if (sector[nb] === label && !seen.has(nb)) {
          seen.add(nb);
          queue.push(nb);
        }
      }
    }
    components.push(comp);
  }
  return components;
}

/** Ensures each of the 3 sectors is one connected piece of the region graph. */
function fixSectorContiguity(sector, regions) {
  for (let guard = 0; guard < 8; guard++) {
    let changed = false;
    for (const label of [0, 1, 2]) {
      const comps = sectorComponents(sector, label, regions);
      if (comps.length <= 1) continue;
      let largest = 0;
      for (let c = 1; c < comps.length; c++) if (comps[c].length > comps[largest].length) largest = c;
      for (let c = 0; c < comps.length; c++) {
        if (c === largest) continue;
        const dest = bestBorderingSector(comps[c], sector, regions);
        if (dest == null) {
          // Boxed in by Free Folk on every side (no rival sector actually
          // touches it): there is nowhere contiguous to reassign it TO, so
          // fold it into Free Folk instead of leaving a stray fragment.
          for (const id of comps[c]) delete sector[id];
        } else {
          for (const id of comps[c]) sector[id] = dest;
        }
        changed = true;
      }
    }
    if (!changed) return;
  }
}

/** Is `ids` a single connected piece of the region graph (empty counts as connected)? */
function isConnected(ids, regions) {
  if (ids.length === 0) return true;
  const set = new Set(ids);
  const seen = new Set([ids[0]]);
  const queue = [ids[0]];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    for (const nb of regions[cur].neighbors) {
      if (set.has(nb) && !seen.has(nb)) {
        seen.add(nb);
        queue.push(nb);
      }
    }
  }
  return seen.size === ids.length;
}

/**
 * Transfers border regions from a larger rival sector to a smaller one,
 * until every sector is within 2 regions of the others or no more transfers
 * are legal. Considers every (donor, recipient) PAIR with a big enough gap,
 * largest gap first — not just the single globally largest/smallest sector,
 * because those two may not even share a border (seen in practice: sector A
 * only touched the middle sector, never the biggest one, so a plain
 * biggest->smallest transfer never found a single legal move). Moving
 * through an intermediate sector still narrows the overall spread. A
 * transfer never breaks the RECIPIENT's contiguity (the tile taken always
 * already borders it); the donor's contiguity is checked explicitly. Good
 * anchor placement and balanced growth get most maps close on their own,
 * but "close" is topology-dependent — an anchor can still end up with only
 * one or two ways out of its own starting region no matter how the other
 * two are chosen (see the growth comment above). This backstop is what
 * makes "rival sectors within +/- 2 regions" hold generally, not only on
 * favourable geography.
 */
function rebalanceSectors(sector, regions, remaining, sectorCount) {
  const membersOf = (idx) => remaining.filter((id) => sector[id] === idx);
  for (let guard = 0; guard < 400; guard++) {
    const sizes = Array.from({ length: sectorCount }, (_, idx) => membersOf(idx).length);
    const pairs = [];
    for (let donor = 0; donor < sectorCount; donor++) {
      for (let recipient = 0; recipient < sectorCount; recipient++) {
        const gap = sizes[donor] - sizes[recipient];
        if (donor !== recipient && gap > 2) pairs.push([donor, recipient, gap]);
      }
    }
    if (pairs.length === 0) return;
    pairs.sort((a, b) => b[2] - a[2]);

    let movedAny = false;
    for (const [donor, recipient] of pairs) {
      const donorMembers = membersOf(donor);
      for (const id of donorMembers) {
        if (!regions[id].neighbors.some((nb) => sector[nb] === recipient)) continue;
        if (!isConnected(donorMembers.filter((m) => m !== id), regions)) continue;
        sector[id] = recipient;
        movedAny = true;
        break;
      }
      if (movedAny) break; // sizes changed; re-rank every pair fresh next round
    }
    if (!movedAny) return; // no legal transfer anywhere; accept the remaining imbalance
  }
}

/**
 * @param {import('../core/rng.js').Rng} rng forked for the 'factions' phase
 * @param {import('./regions.js').Region[]} regions mutated in place: .faction, .isCapital
 * @param {number} startRegion
 * @param {ReturnType<typeof import('../config/world.js')>['FACTIONS']} factionDefs
 * @returns {import('./generate.js').Faction[]}
 */
export function assignFactions(rng, regions, startRegion, factionDefs) {
  regions[startRegion].faction = 0;

  // Free Folk membership (tier 1 + the tier-2 roll) is NOT guaranteed
  // contiguous by this — and deliberately isn't forced to be. It's an
  // emergent property of which tier-1 "petals" around the start region
  // happen to touch each other; ARCHITECTURE only requires the three RIVAL
  // sectors to be contiguous (DESIGN's "three contiguous rival sectors").
  // A tier-1/2 enclave whose only external neighbour is the start region
  // itself (a small dead-end appendage — rare, but real) has nowhere else
  // it could sensibly go, rival or otherwise, so Free Folk is left as
  // whatever tier/roll produces rather than force-relocating such a pocket.
  const remaining = [];
  for (const region of regions) {
    if (region.id === startRegion) continue;
    if (region.tier === 1) {
      region.faction = 1;
    } else if (region.tier === 2 && rng.chance(FREE_FOLK_TIER2_SHARE)) {
      region.faction = 1;
    } else {
      remaining.push(region.id);
    }
  }

  // Anchor 1: highest tier in the pool (ties -> most tiles, then lowest id).
  const maxTier = Math.max(0, ...remaining.map((id) => regions[id].tier));
  const highPool = remaining.filter((id) => regions[id].tier >= maxTier - 1);
  const pool = highPool.length >= RIVAL_COUNT ? highPool : remaining;

  /** -1 on an empty list, so a map this small never has to special-case it. */
  function best(ids, scoreFn) {
    if (ids.length === 0) return -1;
    let bestId = ids[0], bestScore = -Infinity;
    for (const id of ids) {
      const s = scoreFn(id);
      if (s > bestScore) { bestScore = s; bestId = id; }
    }
    return bestId;
  }

  // How many OTHER `remaining` regions border this one — a rough proxy for
  // "room to grow". Pure tier+distance anchor selection can otherwise plant
  // an anchor at a chokepoint with only one or two ways out (once seen: an
  // anchor whose sole two neighbours were themselves the other two
  // factions' anchors, capping it at 1 region forever no matter how the
  // growth step below is tie-broken). Folded into both scores below as a
  // secondary term — it only matters when the primary term is close, never
  // overriding a genuinely better tier or a genuinely farther spread.
  const remainingSet = new Set(remaining);
  const remainingDegree = (id) => regions[id].neighbors.filter((nb) => remainingSet.has(nb)).length;

  const tierScore = (id) => regions[id].tier * 10000 + regions[id].tiles.length - id * 1e-6 + remainingDegree(id) * 50;

  // `remaining` is usually fragmented into several pieces by the Free Folk
  // regions sitting between them. Picking anchors by tier+distance alone can
  // strand one deep in a small, mostly cut-off pocket that can never grow
  // past a handful of regions regardless of how fair the growth step below
  // is — that produced sectors like 11/8/1. Handing out the 3 anchor
  // "slots" across components PROPORTIONAL TO SIZE fixes this at the
  // source: one dominant landmass of remaining territory gets all 3 (to be
  // divided by the balanced growth below); several comparably-sized
  // components each get their own.
  const components = remainingComponents(remaining, regions);
  const slots = components.map(() => 0);
  for (let s = 0; s < RIVAL_COUNT && components.length > 0; s++) {
    let bestC = 0, bestRatio = -1;
    for (let c = 0; c < components.length; c++) {
      const ratio = components[c].length / (slots[c] + 1);
      if (ratio > bestRatio) { bestRatio = ratio; bestC = c; }
    }
    slots[bestC]++;
  }
  const componentForSlot = [];
  components.forEach((comp, c) => { for (let k = 0; k < slots[c]; k++) componentForSlot.push(c); });

  // Within that allocation, still pick each anchor by tier first (or, once
  // at least one anchor exists, farthest graph-distance from every anchor
  // chosen so far — including ones in OTHER components, so anchors spread
  // out geographically as well as by component).
  const anchors = [];
  const anchorDists = [];
  for (const c of componentForSlot) {
    const compPool = components[c].filter((id) => pool.includes(id) && !anchors.includes(id));
    const candidates = compPool.length > 0 ? compPool : components[c].filter((id) => !anchors.includes(id));
    const scoreFn = anchorDists.length === 0
      ? tierScore
      : (id) => Math.min(...anchorDists.map((d) => d[id])) * 100 + remainingDegree(id);
    const next = best(candidates, scoreFn);
    if (next === -1) continue;
    anchors.push(next);
    anchorDists.push(graphDistances(regions, next));
  }

  // Balanced round-robin growth confined to `remaining`, so sectors only
  // claim territory that isn't already Free Folk, one region at a time,
  // always letting the CURRENTLY SMALLEST sector claim next. Growth (not a
  // one-shot nearest-anchor assignment) matters here: only ever claiming a
  // tile adjacent to territory you already hold keeps every sector
  // contiguous BY CONSTRUCTION, with no separate fix-up needed. A one-shot
  // capacity-capped "nearest anchor, but this one's full" assignment was
  // tried and made things WORSE — a region assigned to its second- or
  // third-nearest anchor because the nearest was already at capacity is
  // usually not adjacent to that anchor's other territory, so
  // fixSectorContiguity ended up reassigning it (and anything past it) back
  // to whichever sector actually surrounds it, undoing the balancing.
  //
  // The one real bug in growth-by-adjacency was tie-breaking: whichever
  // sector came first in `anchors` always won a contested border tile
  // whenever sizes were equal (ties are common — every sector starts at
  // size 1), giving it a persistent first-mover edge. Shuffling the
  // processing order each round with the SAME rng stream used everywhere
  // else in this phase removes that bias without touching contiguity.
  const sector = {};
  const sectorSize = anchors.map(() => 1);
  anchors.forEach((a, idx) => { sector[a] = idx; });
  const unclaimed = new Set(remaining.filter((id) => !(id in sector)));

  let progress = true;
  while (progress && unclaimed.size > 0) {
    progress = false;
    const order = rng.shuffle(anchors.map((_a, idx) => idx))
      .sort((a, b) => sectorSize[a] - sectorSize[b]); // stable: shuffle first, THEN sort by size
    for (const idx of order) {
      let pick = -1;
      for (const id of unclaimed) {
        if (regions[id].neighbors.some((nb) => sector[nb] === idx)) { pick = id; break; }
      }
      if (pick === -1) continue; // this sector has no open frontier this round
      sector[pick] = idx;
      sectorSize[idx]++;
      unclaimed.delete(pick);
      progress = true;
    }
  }

  // Any leftover pocket the growth above couldn't reach (boxed in by Free
  // Folk on every side): fall back to nearest anchor by full-graph distance.
  // With zero anchors (see above) nothing can be assigned here, and every
  // remaining region folds to Free Folk below — the map is simply too small
  // for 3 rival sectors.
  for (const id of remaining) {
    if (id in sector || anchors.length === 0) continue;
    let bestIdx = 0, bestD = Infinity;
    anchorDists.forEach((d, idx) => { if (d[id] >= 0 && d[id] < bestD) { bestD = d[id]; bestIdx = idx; } });
    sector[id] = bestIdx;
  }

  fixSectorContiguity(sector, regions);
  if (anchors.length > 1) rebalanceSectors(sector, regions, remaining, anchors.length);

  // Anything the contiguity fix folded away (deleted from `sector`) had no
  // rival neighbour to join and becomes Free Folk instead of a stray fragment.
  for (const id of remaining) regions[id].faction = id in sector ? 2 + sector[id] : 1;

  // Capital = each sector's highest tier region (ties -> most tiles, then lowest id).
  const capitals = anchors.map((_a, idx) => {
    const members = remaining.filter((id) => sector[id] === idx);
    return members.length === 0 ? -1 : best(members, tierScore);
  });
  capitals.forEach((cap) => { if (cap !== -1) regions[cap].isCapital = true; });

  const factions = factionDefs.map((f) => ({ ...f, capitalRegion: -1 }));
  for (let idx = 0; idx < anchors.length; idx++) factions[2 + idx].capitalRegion = capitals[idx];
  return factions;
}
