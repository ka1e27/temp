#!/usr/bin/env node
// ASCII preview + stats for a generated world. A dev tool, not part of the
// game itself, so — unlike game/world/* — it is free to use Date.now() and
// console.log directly.
//
// Usage:
//   node tools/worldcli.mjs --seed=7 [--regions]
//   node tools/worldcli.mjs --seed=7 --cols=30 --rows=24 --regionCount=12
//
// --regions swaps each land tile's terrain glyph for its region's letter
// (a..z, then A..Z); settlements always show as one of K/T/V/h/F/^
// regardless of mode.

import { generateWorld } from '../game/world/generate.js';
import { neighborIndices } from '../game/world/terrain.js';

function parseArgs(argv) {
  const opts = {};
  for (const arg of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!m) continue;
    opts[m[1]] = m[2] === undefined ? true : m[2];
  }
  return opts;
}

const TERRAIN_GLYPH = {
  deep: '~', ocean: '-', shallows: '_', beach: '.',
  grass: ',', meadow: '"', forest: 'f', pine: 'p', hills: 'r',
  mountain: 'A', snow: '*', savanna: ';', desert: 'd', marsh: 'm',
};

const SETTLEMENT_GLYPH = {
  keep: 'K', town: 'T', village: 'V', hamlet: 'h', fort: 'F', tower: '^',
};

function regionLetter(id) {
  if (id < 26) return String.fromCharCode(97 + id); // a..z
  if (id < 52) return String.fromCharCode(65 + (id - 26)); // A..Z
  return '#'; // exhausted the alphabet twice over; shouldn't happen at maxRegions=46
}

function renderMap(world, showRegions) {
  const lines = [];
  for (let row = 0; row < world.rows; row++) {
    let line = row % 2 === 1 ? ' ' : '';
    for (let col = 0; col < world.cols; col++) {
      const t = world.tiles[row * world.cols + col];
      let glyph;
      if (t.settlement !== -1) {
        glyph = SETTLEMENT_GLYPH[world.settlements[t.settlement].type] ?? '?';
      } else if (t.river !== 0 && t.land) {
        glyph = '≈'; // ≈ — rivers always show, in both terrain and region view
      } else if (showRegions && t.region !== -1) {
        glyph = regionLetter(t.region);
      } else {
        glyph = TERRAIN_GLYPH[t.terrain] ?? '?';
      }
      line += glyph;
    }
    lines.push(line);
  }
  return lines.join('\n');
}

function printLegend(showRegions) {
  console.log(
    'Terrain: ~deep -ocean _shallows .beach ,grass "meadow fforest ppine rhills'
    + ' Amountain *snow ;savanna ddesert mmarsh',
  );
  console.log('Settlements: K=keep T=town V=village h=hamlet F=fort ^=tower   Rivers: ≈');
  if (showRegions) console.log('Regions: a-z, A-Z = region id (land outside any region keeps its terrain glyph)');
  console.log();
}

function fmt1(n) {
  return Math.round(n * 10) / 10;
}

/** Water tiles form small isolated components inland (lakes) vs. one huge connected sea. */
function countLakeTiles(world) {
  const { cols, rows, tiles } = world;
  const seen = new Uint8Array(tiles.length);
  let lakeTotal = 0;
  for (let start = 0; start < tiles.length; start++) {
    if (tiles[start].land || seen[start]) continue;
    const comp = [start];
    seen[start] = 1;
    let head = 0;
    while (head < comp.length) {
      const cur = comp[head++];
      for (const { index: nb } of neighborIndices(cur, cols, rows)) {
        if (!tiles[nb].land && !seen[nb]) {
          seen[nb] = 1;
          comp.push(nb);
        }
      }
    }
    if (comp.length < 20) lakeTotal += comp.length; // the sea is always much bigger than this
  }
  return lakeTotal;
}

function printStats(world, generationMs) {
  const landTiles = world.tiles.filter((t) => t.land).length;
  const maxTier = Math.max(...world.regions.map((r) => r.tier));

  console.log(`Seed ${world.seed} — ${world.cols}x${world.rows}, generated in ${generationMs}ms`);
  console.log(`Land tiles: ${landTiles} / ${world.tiles.length} (${fmt1((landTiles / world.tiles.length) * 100)}%)`);
  console.log(`Regions: ${world.regions.length}  Settlements: ${world.settlements.length}`);
  console.log(`Start region: ${world.regions[world.startRegion].name} (id ${world.startRegion})`);
  console.log();

  console.log('-- Biome mix (share of land tiles) --');
  const biomeCounts = new Map();
  for (const t of world.tiles) if (t.land) biomeCounts.set(t.terrain, (biomeCounts.get(t.terrain) ?? 0) + 1);
  const biomeOrder = ['grass', 'meadow', 'forest', 'pine', 'hills', 'mountain', 'beach', 'marsh', 'savanna', 'desert', 'snow'];
  console.log(biomeOrder.map((b) => `${b} ${fmt1(((biomeCounts.get(b) ?? 0) / landTiles) * 100)}%`).join('  '));
  const riverTiles = world.tiles.filter((t) => t.river !== 0 && t.land).length;
  console.log(`River tiles: ${riverTiles}   Inland lake tiles: ${countLakeTiles(world)}`);
  console.log();

  console.log('-- Regions by tier --');
  for (let tier = 0; tier <= maxTier; tier++) {
    const regions = world.regions.filter((r) => r.tier === tier).sort((a, b) => a.id - b.id);
    if (regions.length === 0) continue;
    console.log(`Tier ${tier}:`);
    for (const r of regions) {
      const faction = world.factions[r.faction];
      const cap = r.isCapital ? ' [CAPITAL]' : '';
      console.log(
        `  ${regionLetter(r.id)} ${r.name.padEnd(14)} `
        + `${String(r.tiles.length).padStart(3)} tiles  `
        + `${String(r.settlements.length).padStart(2)} settlements  `
        + `${faction.name} (${r.biome}/${r.perk})${cap}`,
      );
    }
  }
  console.log();

  console.log('-- Faction sectors --');
  for (const faction of world.factions) {
    const regions = world.regions.filter((r) => r.faction === faction.id);
    const tiles = regions.reduce((sum, r) => sum + r.tiles.length, 0);
    const capitals = regions.filter((r) => r.isCapital).map((r) => `${r.name} (id ${r.id})`);
    const capitalText = faction.capitalRegion === -1 ? '' : `  capital: ${capitals[0] ?? faction.capitalRegion}`;
    console.log(`  ${faction.name.padEnd(16)} ${String(regions.length).padStart(2)} regions  ${String(tiles).padStart(4)} tiles${capitalText}`);
  }
  console.log();

  console.log('-- Perks --');
  const perkCounts = new Map();
  for (const r of world.regions) perkCounts.set(r.perk, (perkCounts.get(r.perk) ?? 0) + 1);
  for (const [perk, count] of [...perkCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${perk.padEnd(10)} ${count}`);
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const seed = Number(opts.seed ?? 1);
  const genOpts = {};
  if (opts.cols !== undefined) genOpts.cols = Number(opts.cols);
  if (opts.rows !== undefined) genOpts.rows = Number(opts.rows);
  if (opts.regionCount !== undefined) genOpts.regionCount = Number(opts.regionCount);
  if (opts.dynasty !== undefined) genOpts.dynasty = Number(opts.dynasty);

  const start = Date.now();
  const world = generateWorld(seed, genOpts);
  const generationMs = Date.now() - start;

  const showRegions = Boolean(opts.regions);
  printLegend(showRegions);
  console.log(renderMap(world, showRegions));
  console.log();
  printStats(world, generationMs);
}

main();
