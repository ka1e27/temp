// THE FRONTIER, MEASURED. `node tools/simrunner.js --frontier --n=8`
//
// Split out of simrunner.js for the same reason simladder.js was: that file is
// the campaign's instrument, and a frontier run is not a region. What differs is
// what a ROW is and what SUCCESS is.
//
// WHY THERE IS NO WIN RATE HERE. A campaign region is won by taking a throne, so
// "win%" is the whole readout. The frontier has no throne to take — it has no
// end at all, which is the point of it — so every run ends the same way, on the
// clock, and a win rate would read 0% forever while telling you nothing. What
// varies run to run is HOW FAR OUT the player got before the country stopped
// them, so depth is the number and `content/endless.data.js FRONTIER.maxRing`
// is what it is measured against.
//
// It plays a player with the whole campaign behind them by default, because the
// interesting question is where the wall is for a fully-equipped empire.
// `--conquered=N` walks that back: the frontier opens at four regions
// (`FRONTIER_UNLOCK_REGIONS`), so the honest range is 4..24 and the shape of
// depth against empire size is what says whether the mode is worth opening
// early.
import { playOne } from './simplayer.js';
import { REGION_IDS } from '../src/content/regions.data.js';
import { FRONTIER_ID, FRONTIER, FRONTIER_UNLOCK_REGIONS } from '../src/content/endless.data.js';
import { deepestRing, heldRings } from '../src/battle/frontier.js';
import { TICK_HZ } from '../src/core/loop.js';

const median = (a) => (a.length
  ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
  : NaN);

/**
 * `--conquered=6,12,24` — one row per empire size. A bare `--frontier` measures
 * the finished campaign alone.
 */
export function parseEmpires(spec) {
  if (spec === true || spec === '' || spec == null) return [REGION_IDS.length];
  const out = [];
  for (const part of String(spec).split(',')) {
    if (/^\d+$/.test(part)) out.push(Math.max(0, Math.min(REGION_IDS.length, Number(part))));
  }
  return out.length ? out : [REGION_IDS.length];
}

export function runFrontier(spec, { n = 8, idleMin = 30, weights = null, upgrades = true,
  construct = true, richYards = false } = {}) {
  const empires = parseEmpires(spec);
  console.log(`\n  regions   n   deepest ring        core  sites held   minutes`);
  console.log(`  ${'-'.repeat(66)}`);

  const rows = [];
  for (const conquered of empires) {
    const before = REGION_IDS.slice(0, conquered);
    const depths = [];
    const cores = [];
    const held = [];
    const mins = [];
    for (let i = 0; i < n; i++) {
      // `observe` rather than a wider `playOne` return: depth is a fact about
      // the finished board that means nothing on a campaign map, so the column
      // is read here instead of every region growing one.
      let depth = 0;
      let core = 0;
      const r = playOne(FRONTIER_ID, 1000 + i * 7919, before, idleMin, {
        upgrades, construct, weights, richYards,
        observe: (battle) => {
          depth = deepestRing(battle);
          core = median(heldRings(battle));
        },
      });
      depths.push(depth);
      cores.push(Number.isNaN(core) ? 0 : core);
      held.push(r.mineN);
      mins.push(r.ticks / TICK_HZ / 60);
    }
    // THE `core` COLUMN IS THE ONE THAT MEANS ANYTHING, and finding that out
    // cost a table. `deepest` is a MAX, so one farm grabbed by one column at
    // the edge of the board sets it — measured across empires of 4, 8, 16 and
    // 24 regions it read 8.0 every single time, and the gradient line below
    // printed DOES NOT HOLD for a mode whose `sites held` column was climbing
    // 79 -> 90 -> 87 -> 112 on the same runs. A bounded board cannot have an
    // unbounded max, so the max says nothing once anyone reaches the edge.
    //
    // `core` is the MEDIAN ring over every site the player finished holding —
    // where the weight of the empire actually sits — which is the quantity
    // `meta/endless.js frontierReward` pays on, and it is not bounded by one
    // lucky column.
    const lo = Math.min(...depths);
    const hi = Math.max(...depths);
    console.log(`  ${String(conquered).padStart(7)} ${String(n).padStart(3)}`
      + `   ${String(lo).padStart(2)}..${String(hi).padEnd(2)} of ${FRONTIER.maxRing}`
      + `        ${median(cores).toFixed(1).padStart(4)}`
      + `  ${median(held).toFixed(0).padStart(10)}`
      + `  ${median(mins).toFixed(1).padStart(8)}m`);
    rows.push({ conquered, depths, held, median: median(cores) });
  }

  // The one claim the mode makes, stated as a number rather than left to the
  // reader: a bigger empire must reach further out, or the frontier is not a
  // difficulty gradient at all and the rings are decoration.
  if (rows.length > 1) {
    const first = rows[0];
    const last = rows.at(-1);
    console.log('');
    console.log(`  ${first.conquered} regions hold to ring ${first.median.toFixed(1)}`
      + ` (${median(first.held).toFixed(0)} sites),`
      + ` ${last.conquered} hold to ${last.median.toFixed(1)}`
      + ` (${median(last.held).toFixed(0)} sites)`
      + ` — the gradient ${last.median > first.median ? 'holds' : 'DOES NOT HOLD'}`);
  }
  console.log(`\n  opens at ${FRONTIER_UNLOCK_REGIONS} regions;`
    + ` the country stops scaling past ring ${FRONTIER.maxRing}\n`);
  return rows;
}
