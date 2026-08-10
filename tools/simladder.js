// THE ENDLESS LADDER, MEASURED. `node tools/simrunner.js --incursion=1-14 --n=32`
//
// Split out of simrunner.js so that file stays the campaign's instrument and this
// one is the ladder's. They share the bot, the seeds and the medians; what differs
// is what a row IS — a region against a per-tier band there, a rung against a
// property here.
//
// WHY THERE IS NO `WIN_BAND` FOR A RUNG. A region is a designed fight with a
// target win rate; a rung is a point on a curve that is supposed to run from
// "trivial" to "impossible" and pay proportionally on the way. So what this tool
// reports is the SHAPE: where the ladder stops being a formality, where it walls
// the player out, and whether the two are far enough apart to be a ladder rather
// than a cliff. `content/incursion.data.js` `perDepth` is the knob.
//
// It plays a player who has taken every region and idled, which is the only
// player who can reach the ladder at all (meta/incursion.js `campaignComplete`).
import { playOne } from './simplayer.js';
import { REGION_IDS } from '../src/content/regions.data.js';
import { planFor, MUTATOR_BY_ID } from '../src/meta/incursion.js';
import { TICK_HZ } from '../src/core/loop.js';

/** `--incursion=1-12`, `--incursion=1,5,9` or `--incursion=7`. */
export function parseDepths(spec) {
  const out = [];
  for (const part of String(spec).split(',')) {
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) {
      const lo = Number(range[1]);
      const hi = Number(range[2]);
      for (let d = lo; d <= hi; d++) out.push(d);
    } else if (/^\d+$/.test(part)) out.push(Number(part));
  }
  if (!out.length) throw new RangeError(`--incursion: cannot read "${spec}"`);
  return out;
}

export function runLadder(spec, { n = 12, idleMin = 30, weights = null, upgrades = true } = {}) {
  const depths = parseDepths(spec);
  console.log('\n  depth  ground        dial  mutators                       win%   win-med');
  console.log(`  ${'-'.repeat(76)}`);

  const rows = [];
  for (const depth of depths) {
    const plan = planFor(depth);
    const runs = [];
    for (let i = 0; i < n; i++) {
      // The whole campaign, every time: the ladder is gated on it, so a rung
      // measured against a smaller empire would be measuring a player who cannot
      // legally be standing there.
      runs.push(playOne(plan.regionId, 1000 + i * 7919, REGION_IDS, idleMin, {
        upgrades, weights, incursion: depth,
      }));
    }
    const wins = runs.filter((r) => r.status === 'win');
    const winPct = Math.round((wins.length / runs.length) * 100);
    const med = wins.length
      ? wins.map((r) => r.ticks / TICK_HZ / 60).sort((a, b) => a - b)[Math.floor(wins.length / 2)]
      : NaN;
    const names = plan.mutators.map((id) => MUTATOR_BY_ID[id].name).join(', ') || '—';
    console.log(`  ${String(depth).padStart(5)}  ${plan.regionId.padEnd(12)}`
      + ` ${plan.enemyMult.toFixed(2).padStart(5)}  ${names.padEnd(30)}`
      + ` ${String(winPct).padStart(4)}%  ${(Number.isNaN(med) ? '  --' : med.toFixed(1)).padStart(5)}m`);
    rows.push({ depth, winPct });
  }

  // The two facts worth naming, because they are the ladder's whole design: a
  // player should clear the opening rungs and should eventually be stopped.
  const first = rows.find((r) => r.winPct < 50);
  const wall = rows.find((r) => r.winPct < 10);
  console.log('');
  console.log(`  coin-flip at depth ${first ? first.depth : '> ' + rows.at(-1).depth}`
    + `, wall at depth ${wall ? wall.depth : '> ' + rows.at(-1).depth}`);
  console.log('');
  return rows;
}
