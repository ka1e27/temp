// Headless balance harness. Plays N battles per region with a scripted player
// and reports win rate and duration against the region's target length.
//
// Balance becomes measurable instead of vibes:
//   node tools/simrunner.js                 # the vertical slice
//   node tools/simrunner.js --region=kaldan --n=50
//   node tools/simrunner.js --all           # every shipped region
//
// The scripted player itself lives in tools/simplayer.js so tests can drive it.
import { playOne } from './simplayer.js';
import { REGIONS, REGION_BY_ID, REGION_IDS } from '../src/content/regions.data.js';
import { TICK_HZ } from '../src/core/loop.js';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]),
);
const N = Number(args.n ?? 12);
const SLICE = ['riverfen', 'ashford', 'ironwood', 'saltmere', 'kaldan'];
const regionIds = args.region ? String(args.region).split(',')
  : (args.all ? REGIONS.map((r) => r.id) : SLICE);

/**
 * What the player has already taken when they attack `id`: every region that
 * comes before it in campaign order.
 *
 * This used to be `SLICE.slice(0, SLICE.indexOf(id))`, which is [] for any id
 * outside the five-region slice — so `--all` simulated a player with ZERO
 * conquests, zero idle income and a base-19-slot expedition against tier-3 and
 * tier-4 maps, and reported all thirteen of them as 0% TOO HARD. Regions 6-18
 * had therefore never actually been balance-tested.
 */
const conqueredBefore = (id) => REGION_IDS.slice(0, REGIONS.findIndex((r) => r.id === id));

console.log(`\n  region        n   win%   median   target    verdict`);
console.log(`  ${'-'.repeat(58)}`);

let anyBad = false;
for (const id of regionIds) {
  const region = REGION_BY_ID[id];
  if (!region) { console.log(`  unknown region "${id}"`); continue; }
  const before = conqueredBefore(id);

  const runs = [];
  const idleMin = Number(args.idle ?? 10);
  for (let i = 0; i < N; i++) runs.push(playOne(id, 1000 + i * 7919, before, idleMin));

  const wins = runs.filter((r) => r.status === 'win');
  const losses = runs.filter((r) => r.status === 'loss').length;
  const ahead = runs.filter((r) => r.status === 'timeout' && r.mineN > r.foeN).length;
  const behind = runs.filter((r) => r.status === 'timeout' && r.mineN <= r.foeN).length;
  const mins = runs.map((r) => r.ticks / TICK_HZ / 60).sort((a, b) => a - b);
  const median = mins[Math.floor(mins.length / 2)];
  const winPct = Math.round((wins.length / runs.length) * 100);
  const target = region.targetLengthMin;

  // A region is healthy when a competent player usually wins, in roughly the
  // advertised time. Too fast is as wrong as too slow.
  const lengthOk = median >= target * 0.5 && median <= target * 1.6;
  const winOk = winPct >= 55;
  const verdict = winOk && lengthOk ? 'ok'
    : !winOk ? 'TOO HARD'
      : median > target * 1.6 ? 'TOO SLOW' : 'TOO FAST';
  if (verdict !== 'ok') anyBad = true;

  console.log(`  ${id.padEnd(12)} ${String(N).padStart(2)}  ${String(winPct).padStart(4)}%`
    + `  ${median.toFixed(1).padStart(5)}m  ${String(target).padStart(5)}m    ${verdict.padEnd(9)}`
    + `  losses=${losses} timeout(ahead=${ahead},behind=${behind})`);
}

console.log('');
if (anyBad) console.log('  Some regions are outside their target band — tune content/balance.js.\n');
