// A small, hand-built World-contract fixture (ARCHITECTURE §4) for battle module tests and
// tools/balance.mjs's synthetic fallback. Not generated (game/world/generate.js has its own
// tests for real worldgen); this is deliberately tiny, fully deterministic, and exercises:
// two adjacent regions, all settlement types, a mountain (impassable), a cheap road corridor,
// and a river crossing on a slower route — enough to test that pathfinding actually prefers
// the cheap route and that a river crossing costs more than the plain terrain alongside it.
//
// Hand-authored in AXIAL (q, r) for readability; offset col/row and world-unit x/y are
// derived with the exact ARCHITECTURE §3 formulas (reproduced locally — see game/battle/geom.js
// for the canonical versions used by the battle module itself).
import { FACTIONS, TERRAIN_COST, ROAD_COST } from '../../config/world.js';

const Q_RANGE = [0, 1, 2, 3, 4, 5, 6];
const R_RANGE = [0, 1, 2, 3, 4];
const HOME_Q = new Set([0, 1, 2]);
const TARGET_Q = new Set([3, 4, 5, 6]);

function axialToOffset(q, r) {
  return { col: q + (r - (r & 1)) / 2, row: r };
}
function offsetToAxial(col, row) {
  return { q: col - (row - (row & 1)) / 2, r: row };
}
function axialToPixel(q, r) {
  return { x: Math.sqrt(3) * (q + r / 2), y: 1.5 * r };
}

// Per-tile overrides keyed by "q,r": terrain/elev/road/river deviations from plain grass.
// Road tiles get cost = ROAD_COST directly (ARCHITECTURE §4: cost has "road already
// applied" — a single scalar per tile, not per edge). The river sits on the (2,1)-(3,1)
// edge only, deliberately NOT on the road corridor, so a squad crossing there alone (instead
// of via the road at r=2) pays the river penalty on top of plain grass cost.
const OVERRIDES = new Map([
  ['4,1', { terrain: 'mountain', elev: 3 }], // impassable, forces routing around
  ['5,1', { terrain: 'hills', elev: 2 }],
  ['1,0', { terrain: 'forest', elev: 1 }],
  ['3,2', { terrain: 'grass', elev: 1, cost: ROAD_COST, road: 0b001001 }], // road E + W
  ['4,2', { terrain: 'hills', elev: 2, cost: ROAD_COST, road: 0b001001 }], // road E + W
  ['2,1', { terrain: 'grass', elev: 1, river: 0b000001 }], // river to E (dir 0)
  ['3,1', { terrain: 'grass', elev: 1, river: 0b001000 }], // river to W (dir 3), reciprocal
]);

// Settlements: [q, r, type, name]. One keep per region (world contract guarantee).
const SETTLEMENTS = [
  [1, 2, 'keep', 'Home Keep'],
  [2, 3, 'village', 'Bordervale'],
  [5, 2, 'keep', 'Crimson Keep'],
  [3, 0, 'hamlet', 'Reedcroft'],
  [4, 4, 'village', 'Ashford'],
  [6, 0, 'fort', 'Ironwall'],
  [6, 4, 'tower', 'Lookout Spire'],
];

/** Builds a fresh, deterministic World-contract fixture. */
export function buildTestWorld() {
  const real = new Map(); // "col,row" -> {q, r}
  for (const q of Q_RANGE) {
    for (const r of R_RANGE) {
      const { col, row } = axialToOffset(q, r);
      real.set(`${col},${row}`, { q, r });
    }
  }
  const cols = Math.max(...[...real.keys()].map((k) => Number(k.split(',')[0]))) + 1;
  const rows = R_RANGE.length;

  const settlementAt = new Map(); // "q,r" -> settlement index
  SETTLEMENTS.forEach(([q, r], idx) => settlementAt.set(`${q},${r}`, idx));

  const tiles = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      const key = `${col},${row}`;
      const hit = real.get(key);
      if (!hit) {
        const { q, r } = offsetToAxial(col, row);
        const { x, y } = axialToPixel(q, r);
        tiles.push({
          i, col, row, q, r, x, y, terrain: 'ocean', elev: 0, height: 0.1, moisture: 0.8,
          land: false, passable: false, cost: Infinity, road: 0, river: 0, coast: 0,
          region: -1, settlement: -1, jitter: stableJitter(col, row),
        });
        continue;
      }
      const { q, r } = hit;
      const { x, y } = axialToPixel(q, r);
      const ov = OVERRIDES.get(`${q},${r}`) || {};
      const terrain = ov.terrain || 'grass';
      const elev = ov.elev ?? 1;
      const passable = terrain !== 'mountain';
      const cost = ov.cost ?? (passable ? (TERRAIN_COST[terrain] ?? 1.0) : Infinity);
      const region = HOME_Q.has(q) ? 0 : 1;
      const sIdx = settlementAt.has(`${q},${r}`) ? settlementAt.get(`${q},${r}`) : -1;
      tiles.push({
        i, col, row, q, r, x, y, terrain, elev, height: elev / 3, moisture: 0.5,
        land: true, passable, cost, road: ov.road ?? 0, river: ov.river ?? 0, coast: 0,
        region, settlement: sIdx, jitter: stableJitter(col, row),
      });
    }
  }

  const settlements = SETTLEMENTS.map(([q, r, type, name], id) => {
    const { col, row } = axialToOffset(q, r);
    const tile = tiles[row * cols + col];
    return { id, tile: tile.i, region: tile.region, type, name };
  });

  const regionTiles = (regionId) => tiles.filter((t) => t.region === regionId).map((t) => t.i);
  const regionSettlements = (regionId) => settlements.filter((s) => s.region === regionId).map((s) => s.id);
  const centroidOf = (tileIds) => {
    const pts = tileIds.map((i) => tiles[i]);
    const x = pts.reduce((s, t) => s + t.x, 0) / pts.length;
    const y = pts.reduce((s, t) => s + t.y, 0) / pts.length;
    return { x, y };
  };
  const bboxOf = (tileIds) => {
    const pts = tileIds.map((i) => tiles[i]);
    return {
      minX: Math.min(...pts.map((t) => t.x)), maxX: Math.max(...pts.map((t) => t.x)),
      minY: Math.min(...pts.map((t) => t.y)), maxY: Math.max(...pts.map((t) => t.y)),
    };
  };

  const homeTiles = regionTiles(0);
  const targetTiles = regionTiles(1);
  const regions = [
    {
      id: 0, name: 'Home', tiles: homeTiles, neighbors: [1], centroid: centroidOf(homeTiles),
      bbox: bboxOf(homeTiles), keep: 0, settlements: regionSettlements(0), tier: 0,
      faction: 0, isCapital: false, biome: 'grass', perk: 'fertile', coastal: false,
    },
    {
      id: 1, name: 'Target', tiles: targetTiles, neighbors: [0], centroid: centroidOf(targetTiles),
      bbox: bboxOf(targetTiles), keep: 2, settlements: regionSettlements(1), tier: 1,
      faction: 2, isCapital: false, biome: 'hills', perk: 'iron', coastal: false,
    },
  ];

  const land = tiles.filter((t) => t.land);
  const bounds = {
    minX: Math.min(...land.map((t) => t.x)), maxX: Math.max(...land.map((t) => t.x)),
    minY: Math.min(...land.map((t) => t.y)), maxY: Math.max(...land.map((t) => t.y)),
  };

  return {
    seed: 1, cols, rows, tiles, regions, settlements,
    factions: FACTIONS.map((f) => ({ ...f })),
    startRegion: 0,
    bounds,
  };
}

function stableJitter(col, row) {
  return ((col * 31 + row * 17) % 100) / 100;
}

// Convenience ids for tests, matching the construction above.
export const HOME_REGION = 0;
export const TARGET_REGION = 1;
export const SETTLEMENT = {
  HOME_KEEP: 0, HOME_VILLAGE: 1, TARGET_KEEP: 2, TARGET_HAMLET: 3,
  TARGET_VILLAGE: 4, TARGET_FORT: 5, TARGET_TOWER: 6,
};
/** owners[regionId]: current owner faction id, separate from World.regions[].faction
 * (the ORIGINAL owner) — buildArena takes this as a live parameter (ARCHITECTURE §6). */
export const DEFAULT_OWNERS = [0, 2];
