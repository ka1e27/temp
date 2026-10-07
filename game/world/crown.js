// The Crown of Ages continent (docs/PLAN-PHASE13.md §13A). Pure and seeded from hashes only (no shared RNG stream is consumed), so it
// never touches another world kind: generate.js calls these only when opts.crownOfAges is set.
//
// The continent is generated as usual (its three rival sectors go to two classic factions and the Ashen Host, crownRivals); then:
//   1. the Usurper (7) takes the centre: the rival region nearest the middle of the land (tier >= CROWN.minCentreTier) is the Throne of
//      Ages, and CROWN.usurperRegions regions around it are his domain;
//   2. the Sea Kings (6) take a stretch of coast: CROWN.seaRegions regions grown from the most sea-facing rival region far from home;
//   3. every rival is left in one piece (a stranded fragment joins its neighbour), and every faction's capital is (re)chosen.
// Both run before settlements (each region gets its new owner's settlement mix). After roads, crownIslands cuts the Sea Kings' coast
// into 1-2 islands (world/archipelago.js applyIslands): a partial archipelago, the mainland is island 0.
//
//   crownRivals(seed) -> factionId[3]    the three sector rivals (two classic + the Ashen Host), seeded
//   applyCrownFactions(seed, tiles, regions, sectorFactions, rivals) -> { factions, crown }   (MUTATES regions)
//   crownIslands(seed, tiles, regions, settlements, crown, cols, rows) -> archipelago record | null   (MUTATES tiles, settlements)
import { hash32 } from '../core/rng.js';
import { FACTIONS } from '../config/world.js';
import { CROWN, USURPER_FACTION } from '../config/crown.js';
import { ASHEN_FACTION } from '../config/ashen.js';
import { SEA_FACTION } from '../config/sea.js';
import { touchesOpenSea, applyIslands } from './archipelago.js';

const h = (seed, ...parts) => hash32(seed >>> 0, 'crown', ...parts);

/** The Crown of Ages' three sector rivals: two of the classic three (seeded) and the Ashen Host, in a seeded sector order. */
export function crownRivals(seed) {
  const classic = [...CROWN.classic].sort((a, b) => h(seed, 'classic', a) - h(seed, 'classic', b) || a - b).slice(0, 2).sort((a, b) => a - b);
  const out = [...classic];
  out.splice(h(seed, 'ashenSector') % 3, 0, ASHEN_FACTION);
  return out;
}

function centroid(tiles, region) {
  let x = 0;
  let y = 0;
  for (const i of region.tiles) { x += tiles[i].x; y += tiles[i].y; }
  return { x: x / region.tiles.length, y: y / region.tiles.length };
}

/** Grows a domain of up to `size` regions from `seed` over `allowed` regions, best `score` first (ties by hash). */
function grow(regions, start, size, allowed, score, onAdd) {
  const out = [start];
  const inSet = new Set(out);
  onAdd(start);
  while (out.length < size) {
    let best = null;
    for (const id of out) {
      for (const nb of regions[id].neighbors) {
        if (inSet.has(nb) || !allowed(nb)) continue;
        const s = score(nb);
        if (!best || s > best.s || (s === best.s && nb < best.id)) best = { id: nb, s };
      }
    }
    if (!best) break;
    out.push(best.id);
    inSet.add(best.id);
    onAdd(best.id);
  }
  return out;
}

/** Connected pieces of the regions owned by `f` in `owner`, largest first. */
function pieces(regions, owner, f) {
  const seen = new Set();
  const out = [];
  for (const r of regions) {
    if (owner[r.id] !== f || seen.has(r.id)) continue;
    const comp = [r.id];
    seen.add(r.id);
    for (let k = 0; k < comp.length; k++) {
      for (const nb of regions[comp[k]].neighbors) if (owner[nb] === f && !seen.has(nb)) { seen.add(nb); comp.push(nb); }
    }
    out.push(comp);
  }
  return out.sort((a, b) => b.length - a.length || a[0] - b[0]);
}

/** One carve attempt on a copy of the owners; null when a rival would be left too small. */
function carve(seed, tiles, regions, owner, rivals, usurperN, seaN, cols, rows) {
  const own = owner.slice();
  const count = {};
  for (const f of own) count[f] = (count[f] || 0) + 1;
  // a rival region may be carved only while its faction keeps more than CROWN.minSector regions
  // ... and only when what it keeps stays in one piece (a rival is never cut in two)
  const whole = (id) => { const f = own[id]; own[id] = -1; const n = pieces(regions, own, f).length; own[id] = f; return n <= 1; };
  const spare = (id) => own[id] > 1 && (rivals.includes(own[id]) ? count[own[id]] > CROWN.minSector && whole(id) : true);
  const take = (f) => (id) => { count[own[id]] -= 1; own[id] = f; count[f] = (count[f] || 0) + 1; };
  // 1. the Throne: nearest the middle of the land, beyond the Free Folk rings
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const t of tiles) if (t.land) { minX = Math.min(minX, t.x); maxX = Math.max(maxX, t.x); minY = Math.min(minY, t.y); maxY = Math.max(maxY, t.y); }
  const mid = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const cands = regions.filter((r) => spare(r.id) && r.tier >= CROWN.minCentreTier)
    .map((r) => { const c = centroid(tiles, r); return { id: r.id, d: Math.hypot(c.x - mid.x, c.y - mid.y) }; })
    .sort((a, b) => a.d - b.d || a.id - b.id);
  if (!cands.length) return null;
  // a domain smaller than CROWN.minSector is undone and the next candidate tried (the Throne nearest the middle first)
  const tryGrow = (starts, size, allowed, score, f) => {
    for (const start of starts.slice(0, 8)) {
      const saveOwn = own.slice();
      const saveCount = { ...count };
      const got = grow(regions, start, size, allowed, score, take(f));
      if (got.length >= CROWN.minSector) return got;
      own.splice(0, own.length, ...saveOwn);
      Object.assign(count, saveCount);
    }
    return null;
  };
  const usurper = tryGrow(cands.map((c) => c.id), usurperN, spare, (id) => -(h(seed, 'usurper', id) / 4294967296), USURPER_FACTION);
  if (!usurper) return null;
  const throne = usurper[0];
  // 2. the Sea Kings: the most sea-facing rival region (open-sea coast tiles + depth), grown along the coast
  const coast = (id) => regions[id].tiles.filter((i) => tiles[i].land && touchesOpenSea(tiles, i, cols, rows)).length;
  const free = (id) => spare(id) && own[id] !== USURPER_FACTION && own[id] !== SEA_FACTION;
  const seaSeeds = regions.filter((r) => free(r.id) && !usurper.some((u) => regions[u].neighbors.includes(r.id)))
    .map((r) => ({ id: r.id, s: coast(r.id) + 2 * r.tier }))
    .sort((a, b) => b.s - a.s || h(seed, 'seaSeed', a.id) - h(seed, 'seaSeed', b.id)).map((x) => x.id);
  const sea = tryGrow(seaSeeds, seaN, free, (id) => coast(id), SEA_FACTION);
  if (!sea) return null;
  // 3. every rival in one piece: a stranded fragment joins the neighbouring rival it borders most (Free Folk when it borders none)
  for (const f of rivals) {
    for (const piece of pieces(regions, own, f).slice(1)) {
      const votes = new Map();
      for (const id of piece) for (const nb of regions[id].neighbors) if (own[nb] > 1 && own[nb] !== f) votes.set(own[nb], (votes.get(own[nb]) || 0) + 1);
      const to = [...votes].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
      for (const id of piece) own[id] = to ? to[0] : 1;
    }
  }
  const counts = (f) => own.filter((x) => x === f).length;
  if ([...rivals, SEA_FACTION, USURPER_FACTION].some((f) => counts(f) < CROWN.minSector)) return null;
  // every region each holds, in the order grown (a fragment that joined them last)
  const all = (list, f) => [...list, ...own.map((x, id) => (x === f && !list.includes(id) ? id : -1)).filter((id) => id >= 0)];
  return { own, throne, usurper: all(usurper, USURPER_FACTION), sea: all(sea, SEA_FACTION) };
}

/** A faction's capital: its old one when still held, else its deepest region (most coast, then hash, then id). */
function capitalOf(seed, tiles, regions, own, f, old) {
  if (old >= 0 && own[old] === f) return old;
  const mine = regions.filter((r) => own[r.id] === f);
  mine.sort((a, b) => b.tier - a.tier || h(seed, 'capital', f, a.id) - h(seed, 'capital', f, b.id) || a.id - b.id);
  return mine.length ? mine[0].id : -1;
}

/**
 * Hands the centre to the Usurper and a coast to the Sea Kings (see the header). Runs after assignFactions + the rival rotation and
 * before settlements. MUTATES regions (.faction, .isCapital, .throne). `sectorFactions` is assignFactions' result (classic ids 2-4).
 * @returns {{ factions: object[], crown: { throne: number, usurper: number[], seaKings: number[] } }}
 */
export function applyCrownFactions(seed, tiles, regions, sectorFactions, rivals, cols, rows) {
  const owner = regions.map((r) => r.faction);
  let cut = null;
  for (let shrink = 0; !cut && shrink <= 3; shrink++) {
    cut = carve(seed, tiles, regions, owner, rivals, Math.max(3, CROWN.usurperRegions - shrink), Math.max(3, CROWN.seaRegions - shrink), cols, rows);
  }
  const factions = FACTIONS.map((f) => ({ ...f, capitalRegion: -1 }));
  for (const f of factions) if (f.id > 1 && f.id !== SEA_FACTION && f.id !== USURPER_FACTION && !rivals.includes(f.id)) f.absent = true;
  if (!cut) { // a map that cannot hold them all (never seen in tests): the rivals as dealt, no Usurper or Sea Kings
    rivals.forEach((id, k) => { factions[id].capitalRegion = sectorFactions[2 + k] ? sectorFactions[2 + k].capitalRegion : -1; });
    factions[SEA_FACTION].absent = true;
    factions[USURPER_FACTION].absent = true;
    return { factions, crown: null };
  }
  regions.forEach((r) => { r.faction = cut.own[r.id]; r.isCapital = false; });
  const oldCap = (f) => { const k = rivals.indexOf(f); return k >= 0 && sectorFactions[2 + k] ? sectorFactions[2 + k].capitalRegion : -1; };
  for (const f of [...rivals, SEA_FACTION]) factions[f].capitalRegion = capitalOf(seed, tiles, regions, cut.own, f, oldCap(f));
  factions[USURPER_FACTION].capitalRegion = cut.throne;
  for (const f of factions) if (f.capitalRegion >= 0) regions[f.capitalRegion].isCapital = true;
  regions[cut.throne].throne = true;
  return { factions, crown: { throne: cut.throne, usurper: cut.usurper, seaKings: cut.sea } };
}

/** Cuts the Sea Kings' coast into 1-2 islands off the mainland (island 0). Runs after roads. null without a crown record. */
export function crownIslands(seed, tiles, regions, settlements, crown, cols, rows) {
  if (!crown || !crown.seaKings.length) return null;
  const island = regions.map(() => 0);
  const sea = crown.seaKings;
  let split = sea.length >= CROWN.seaIslandSplitFrom ? Math.ceil(sea.length / 2) : sea.length;
  // the second island: the regions grown last (the far end of the coast), only when both halves are each in one piece
  const own = regions.map((r) => (sea.indexOf(r.id) < 0 ? 0 : sea.indexOf(r.id) < split ? 1 : 2));
  if (split < sea.length && (pieces(regions, own, 1).length !== 1 || pieces(regions, own, 2).length !== 1)) split = sea.length;
  sea.forEach((id, n) => { island[id] = n < split ? 1 : 2; });
  const k = sea.length > split ? 3 : 2;
  return applyIslands(seed, tiles, regions, settlements, island, k, cols, rows);
}
