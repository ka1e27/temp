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

/**
 * The win-rate band each TIER is aiming at, as [floor, ceiling] percentages.
 *
 * This was a single global floor of 55%, which stopped being usable the moment
 * the campaign was meant to end in a genuine wall: an endgame region designed to
 * take two or three attempts reads as TOO HARD against a number chosen when
 * every region was supposed to be a probable win.
 *
 * A CEILING matters as much as a floor, and there never was one. Most of this
 * project's real mis-tunes were regions that were too EASY — a walkover reports
 * "ok" against a floor and looks healthy right up until someone plays it.
 *
 * You are raiding regions the enemy owns outright, so the campaign descends:
 * the opening teaches, the endgame is meant to cost you attempts.
 */
const WIN_BAND = [[78, 92], [66, 84], [50, 72], [34, 56], [22, 42]];

// `win-med` is the gated one — how long it takes to TAKE the region. `all-med`
// is every run including the losses, reported so a fast-loss profile stays
// visible rather than being averaged away.
console.log(`\n  region        n   win%  win-med all-med   target    verdict`);
console.log(`  ${'-'.repeat(66)}`);

let anyBad = false;
for (const id of regionIds) {
  const region = REGION_BY_ID[id];
  if (!region) { console.log(`  unknown region "${id}"`); continue; }
  const before = conqueredBefore(id);

  const runs = [];
  const idleMin = Number(args.idle ?? 10);
  // --noupgrades reverts to the bot that never touched SITE_LEVELS, so the
  // worth of the mechanic stays measurable rather than remembered.
  const opts = { upgrades: !args.noupgrades };
  for (let i = 0; i < N; i++) runs.push(playOne(id, 1000 + i * 7919, before, idleMin, opts));

  const wins = runs.filter((r) => r.status === 'win');
  const losses = runs.filter((r) => r.status === 'loss').length;
  const ahead = runs.filter((r) => r.status === 'timeout' && r.mineN > r.foeN).length;
  const behind = runs.filter((r) => r.status === 'timeout' && r.mineN <= r.foeN).length;
  const medianOf = (a) => (a.length
    ? a.map((r) => r.ticks / TICK_HZ / 60).sort((x, y) => x - y)[Math.floor(a.length / 2)]
    : NaN);
  const allMed = medianOf(runs);
  const winMed = medianOf(wins);
  const winPct = Math.round((wins.length / runs.length) * 100);
  const target = region.targetLengthMin;

  /**
   * LENGTH IS MEASURED OVER WINS, and the median of ALL runs is reported beside
   * it rather than gated on.
   *
   * `targetLengthMin` is the number the world map shows the player, and what a
   * player means by "how long is this region" is how long it takes to TAKE it.
   * A loss is not a short battle, it is a battle that ended early because they
   * were being rolled up — the all-runs median measures how fast you die, and
   * the two quantities only look alike while wins dominate.
   *
   * They stop looking alike exactly where the campaign is supposed to get hard.
   * Measured at n=64 with the ladder live:
   *
   *     region        win%   all-med  win-med   advertised
   *     emberholt      84%     12.1     13.0       16.5
   *     karrowmere     63%      6.5      8.4        8.5
   *     obsidian       39%      5.1      8.0        8.5
   *     nightharrow    34%      3.6     11.1        9
   *
   * Emberholt barely moves; nightharrow moves by a factor of three, and its
   * advertised nine minutes goes from a 60% overstatement to accurate. Gating on
   * the all-runs median would have forced every tier-5 region to advertise five
   * minutes — shorter than tier ONE — to describe a battle that actually takes
   * eleven. That is not a tuning problem, it is the wrong instrument: it was
   * chosen when every region was a probable win and it silently stopped
   * measuring what it names somewhere around the 50% mark.
   *
   * Below `MIN_WINS_FOR_LENGTH` there is no honest win median to take, so the
   * length gate steps aside and lets the win-rate verdict speak — a region that
   * wins five times in a hundred has a difficulty problem, and reporting it as
   * TOO FAST would name the wrong one.
   */
  const MIN_WINS_FOR_LENGTH = 5;
  const gradeLength = wins.length >= MIN_WINS_FOR_LENGTH;
  const lengthOk = !gradeLength || (winMed >= target * 0.5 && winMed <= target * 1.6);
  const [lo, hi] = WIN_BAND[region.tier - 1];
  const verdict = gradeLength && winMed > target * 1.6 ? 'TOO SLOW'
    : winPct < lo ? 'TOO HARD'
      : winPct > hi ? 'TOO EASY'
        : lengthOk ? 'ok' : 'TOO FAST';
  if (verdict !== 'ok') anyBad = true;

  const fmt = (v) => (Number.isNaN(v) ? '   --' : v.toFixed(1).padStart(5));
  console.log(`  ${id.padEnd(12)} ${String(N).padStart(2)}  ${String(winPct).padStart(4)}%`
    + `  ${fmt(winMed)}m ${fmt(allMed)}m  ${String(target).padStart(5)}m    ${verdict.padEnd(9)}`
    + `  losses=${losses} timeout(ahead=${ahead},behind=${behind})`);
}

console.log('');
if (anyBad) console.log('  Some regions are outside their target band — tune content/balance.js.\n');
