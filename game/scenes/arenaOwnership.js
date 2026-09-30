// Who owns what, as the PLAYER should currently SEE it inside a battle arena (DESIGN §7.3, PLAYFEEL §3).
// Pure bookkeeping (no DOM, no clock: callers pass `nowMs`), so the timing of the capture ripple,
// the victory surrender cascade and the tile flood is unit-testable.
//
//  * Inside the target region every land tile (including impassable rock) belongs to its NEAREST
//    settlement of that region, so the land itself recolours as settlements flip.
//  * A capture ripples outward from the settlement: each tile of its cell flips a moment after the
//    one before it (ripple), so the change spreads instead of popping.
//  * On victory the whole region floods to the player tile by tile outward from the keep, and every
//    remaining enemy settlement flips one by one (cascade); until its turn each still DISPLAYS its
//    old owner even though the simulation already flipped it.
import { hexDistance } from '../core/hex.js';

/**
 * @param {import('../world/generate.js').World} world
 * @param {object} battle BattleState (its sites are read live)
 * @param {number} regionId the target region
 * @param {number[]} worldOwners region id -> faction for everything OUTSIDE the target region
 */
export function createArenaOwnership(world, battle, regionId, worldOwners) {
  const region = world.regions[regionId];
  const regionTiles = region.tiles.map((i) => world.tiles[i]).filter((t) => t.land);
  const targetSites = battle.sites.filter((s) => world.tiles[s.tile]?.region === regionId);

  // Voronoi over every land tile of the region (rock included): nearest target-region site by hex
  // distance, ties to the lower site id.
  const voronoi = new Map(); // tile index -> site id
  const cells = new Map(); // site id -> tiles
  for (const t of regionTiles) {
    let best = null;
    let bestD = Infinity;
    for (const s of targetSites) {
      const st = world.tiles[s.tile];
      const d = hexDistance(t.q, t.r, st.q, st.r);
      if (d < bestD || (d === bestD && best != null && s.id < best)) { bestD = d; best = s.id; }
    }
    if (best != null) {
      voronoi.set(t.i, best);
      if (!cells.has(best)) cells.set(best, []);
      cells.get(best).push(t);
    }
  }

  const tileOverride = new Map(); // tile index -> { owner, until }
  const siteOverride = new Map(); // site id -> { owner, until }

  /** Owner a site DISPLAYS at `nowMs` (its real owner unless a cascade is still holding the old one). */
  function siteOwner(siteId, nowMs) {
    const o = siteOverride.get(siteId);
    if (o && nowMs < o.until) return o.owner;
    const site = battle.sites[siteId];
    return site ? site.owner : -1;
  }

  /** Owner the land of `tile` DISPLAYS at `nowMs` (-1 = none). Works for any world tile. */
  function tileOwner(tile, nowMs) {
    if (!tile || !tile.land || tile.region < 0) return -1;
    if (tile.region === regionId) {
      const o = tileOverride.get(tile.i);
      if (o && nowMs < o.until) return o.owner;
      const sid = voronoi.get(tile.i);
      const site = sid == null ? null : battle.sites[sid];
      return site ? site.owner : -1;
    }
    const w = worldOwners[tile.region];
    return w == null ? -1 : w;
  }

  /** A string that changes whenever any tile of the region would display a different owner. */
  function signature(nowMs) {
    let sig = '';
    for (const t of regionTiles) sig += `${tileOwner(t, nowMs)},`;
    return sig;
  }

  /**
   * A settlement changed hands: its cell recolours outward from it over `rippleMs`.
   * @returns {number} how many tiles will ripple
   */
  function onCapture(siteId, prevOwner, nowMs, rippleMs = 250) {
    const cell = cells.get(siteId);
    if (!cell) return 0;
    const st = world.tiles[battle.sites[siteId].tile];
    let maxD = 1;
    const dists = cell.map((t) => {
      const d = hexDistance(t.q, t.r, st.q, st.r);
      if (d > maxD) maxD = d;
      return d;
    });
    cell.forEach((t, i) => tileOverride.set(t.i, { owner: prevOwner, until: nowMs + (rippleMs * dists[i]) / maxD }));
    return cell.length;
  }

  /**
   * Victory flood: every region tile keeps showing what it showed BEFORE the winning tick until its
   * turn, `msPerHex` per hex of distance from the keep, starting at `startMs`. (By the time the
   * scene hears about the win the sim has already flipped every site, so the "before" colour comes
   * from `prevSiteOwner`, unless a capture ripple is still holding an older one.)
   * @param {(siteId: number) => number} prevSiteOwner owner of a site before the winning tick
   * @returns {{ schedule: { tile: object, at: number }[], endMs: number }} flip schedule sorted by
   *   time (the scene spawns the shimmer at each `at`); `endMs` is when the last tile has flipped.
   */
  function startFlood(nowMs, startMs, msPerHex, keepTile, prevSiteOwner) {
    const schedule = regionTiles.map((tile) => ({
      tile,
      at: startMs + hexDistance(tile.q, tile.r, keepTile.q, keepTile.r) * msPerHex,
    }));
    for (const { tile, at } of schedule) {
      const held = tileOverride.get(tile.i);
      const sid = voronoi.get(tile.i);
      const before = held && nowMs < held.until ? held.owner : (sid == null ? -1 : prevSiteOwner(sid));
      tileOverride.set(tile.i, { owner: before, until: at });
    }
    schedule.sort((a, b) => a.at - b.at);
    return { schedule, endMs: schedule.length ? schedule[schedule.length - 1].at : startMs };
  }

  /** Surrender cascade: each listed site keeps displaying `prevOwner(id)` until its stagger slot. */
  function startCascade(siteIds, prevOwner, startMs, staggerMs) {
    const slots = [];
    siteIds.forEach((id, i) => {
      const at = startMs + i * staggerMs;
      siteOverride.set(id, { owner: prevOwner(id), until: at });
      slots.push({ siteId: id, at });
    });
    return slots;
  }

  /** Forget every pending recolour (Skip, or leaving the battle). */
  function settle() {
    tileOverride.clear();
    siteOverride.clear();
  }

  return {
    regionTiles, voronoi, cells, siteOwner, tileOwner, signature, onCapture, startFlood, startCascade, settle,
  };
}
