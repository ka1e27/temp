// World-generation statistics across seeds: islets, beach shares, start-region composition.
//
//   node tools/worldstats.mjs [--seeds=1-30] [--root=.] [--csv]
//
// `--root` is a directory that contains a `game/` tree (default: this repo), so the same script can
// measure a saved copy of the pre-change code ("before") and the working tree ("after").
// An "islet" is a land component that is not the main landmass; `small` = under 4 tiles (removed by the
// generator), `kept` = 4 or more (decorative islands, which must not be pure beach).
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
  const [k, ...v] = a.slice(2).split('=');
  return [k, v.join('=') || 'true'];
}));
const ROOT = resolve(flags.root || fileURLToPath(new URL('..', import.meta.url)));
const { generateWorld } = await import(pathToFileURL(`${ROOT}/game/world/generate.js`).href);

function seedsOf(spec) {
  const out = [];
  for (const part of String(spec || '1-30').split(',')) {
    const m = part.match(/^(\d+)-(\d+)$/);
    if (m) for (let i = Number(m[1]); i <= Number(m[2]); i++) out.push(i);
    else out.push(Number(part));
  }
  return out;
}

const GREEN = new Set(['grass', 'meadow', 'forest', 'pine']);
const pct = (v) => `${(v * 100).toFixed(0)}%`;

function neighbors(w, t) {
  const out = [];
  const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  for (const [dq, dr] of dirs) {
    const r = t.r + dr;
    const col = t.q + dq + (r - (r & 1)) / 2;
    if (col >= 0 && col < w.cols && r >= 0 && r < w.rows) out.push(w.tiles[r * w.cols + col]);
  }
  return out;
}

function islets(w) {
  const main = new Set();
  for (const t of w.tiles) if (t.region >= 0) main.add(t.i);
  const seen = new Set();
  const out = [];
  for (const t of w.tiles) {
    if (!t.land || main.has(t.i) || seen.has(t.i)) continue;
    const comp = [];
    const queue = [t];
    seen.add(t.i);
    while (queue.length) {
      const cur = queue.pop();
      comp.push(cur);
      for (const nb of neighbors(w, cur)) if (nb.land && !main.has(nb.i) && !seen.has(nb.i)) { seen.add(nb.i); queue.push(nb); }
    }
    out.push(comp);
  }
  return out;
}

const rows = [];
const totals = { seeds: 0, smallIslets: 0, keptIslets: 0, keptPure: 0 };
for (const seed of seedsOf(flags.seeds)) {
  const t0 = performance.now();
  const w = generateWorld(seed);
  const ms = performance.now() - t0;
  const landTiles = w.tiles.filter((t) => t.land);
  const regionLand = w.tiles.filter((t) => t.region >= 0);
  const beach = regionLand.filter((t) => t.terrain === 'beach').length;
  const ise = islets(w);
  const small = ise.filter((c) => c.length < 4);
  const kept = ise.filter((c) => c.length >= 4);
  const pure = kept.filter((c) => c.every((t) => t.terrain === 'beach'));
  const greenless = kept.filter((c) => !c.some((t) => GREEN.has(t.terrain)));
  const start = w.regions[w.startRegion];
  const st = start.tiles.map((i) => w.tiles[i]);
  const mix = {};
  for (const t of st) mix[t.terrain] = (mix[t.terrain] || 0) + 1;
  const startBeach = (mix.beach || 0) / st.length;
  const startGreen = st.filter((t) => GREEN.has(t.terrain)).length / st.length;
  const regionShares = w.regions.map((r) => r.tiles.filter((i) => w.tiles[i].terrain === 'beach').length / r.tiles.length);
  const overCap = regionShares.filter((v) => v > 0.35 + 1e-9).length;
  rows.push({
    seed, regions: w.regions.length, ms,
    small: small.length, smallTiles: small.reduce((n, c) => n + c.length, 0), kept: kept.length, pure: pure.length, greenless: greenless.length,
    beachShare: beach / regionLand.length, landTiles: landTiles.length,
    startTiles: st.length, startBeach, startGreen,
    mix: Object.entries(mix).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v / st.length)}`).join(', '),
    maxRegionBeach: Math.max(...regionShares), overCap, startCoastal: start.coastal,
  });
  totals.seeds++;
  totals.smallIslets += small.length;
  totals.keptIslets += kept.length;
  totals.keptPure += pure.length;
}

if (flags.csv) {
  console.log('seed,regions,ms,smallIslets,smallTiles,keptIslets,keptPure,keptGreenless,beachShare,startTiles,startBeach,startGreen,maxRegionBeach,regionsOverCap');
  for (const r of rows) console.log([r.seed, r.regions, r.ms.toFixed(0), r.small, r.smallTiles, r.kept, r.pure, r.greenless, r.beachShare.toFixed(3), r.startTiles, r.startBeach.toFixed(3), r.startGreen.toFixed(3), r.maxRegionBeach.toFixed(3), r.overCap].join(','));
} else {
  console.log('| seed | regions | islets <4 | islets 4+ (pure beach / no green) | world beach | start tiles | start beach | start green | max region beach | regions >35% | start biome mix |');
  console.log('|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|');
  for (const r of rows) {
    console.log(`| ${r.seed} | ${r.regions} | ${r.small} | ${r.kept} (${r.pure} / ${r.greenless}) | ${pct(r.beachShare)} | ${r.startTiles} | ${pct(r.startBeach)} | ${pct(r.startGreen)} | ${pct(r.maxRegionBeach)} | ${r.overCap} | ${r.mix} |`);
  }
  const avg = (f) => rows.reduce((n, r) => n + f(r), 0) / rows.length;
  console.log('');
  console.log(`seeds ${rows.length}: islets <4 removed-or-present ${totals.smallIslets}; islets 4+ ${totals.keptIslets} (pure beach ${totals.keptPure}); mean world beach ${pct(avg((r) => r.beachShare))}; mean start beach ${pct(avg((r) => r.startBeach))}, worst ${pct(Math.max(...rows.map((r) => r.startBeach)))}; mean start green ${pct(avg((r) => r.startGreen))}, worst ${pct(Math.min(...rows.map((r) => r.startGreen)))}; regions over 35% beach: ${rows.reduce((n, r) => n + r.overCap, 0)}; max gen ${Math.max(...rows.map((r) => r.ms)).toFixed(0)} ms`);
}
