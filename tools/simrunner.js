// Headless balance harness. Plays N battles per region with a scripted player
// and reports win rate and duration against the region's target length.
//
// Balance becomes measurable instead of vibes:
//   node tools/simrunner.js                 # the vertical slice
//   node tools/simrunner.js --region=kaldan --n=50
//   node tools/simrunner.js --all           # every shipped region
//   node tools/simrunner.js --all --sighted=ai    # measure the fog off the AI alone
//   node tools/simrunner.js --all --sighted=bot   # ...and off the harness bot alone
//   node tools/simrunner.js --all --noscout       # the bot with no answer to fog
//   node tools/simrunner.js --all --noreinforce   # ...one that never relieves a stalled siege
//   node tools/simrunner.js --all --nomicrosend   # ...one held to the blanket 5-body floor
//   node tools/simrunner.js --all --nothrone      # ...one that will not commit to the last gate
//   node tools/simrunner.js --all --pool          # ...one that CAN mass several sites at once
//   node tools/simrunner.js --all --richyards     # ...one that builds YARDS when it cannot spend
//
// The scripted player itself lives in tools/simplayer.js so tests can drive it.
import { playOne } from './simplayer.js';
import { REGIONS, REGION_BY_ID, REGION_IDS } from '../src/content/regions.data.js';
import { DEFAULT_COMPOSITION_WEIGHTS } from '../src/content/upgrades.data.js';
import { TICK_HZ } from '../src/core/loop.js';
import { runLadder } from './simladder.js';

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
 * `--weights=outriders:0.3` — field a specialist, at a weight added to the
 * default spread. Omitted, the bot lands `DEFAULT_COMPOSITION_WEIGHTS`, which is
 * the army every number in regions.data.js is measured against.
 *
 * This exists because the specialists could not previously be MEASURED at all:
 * they have no default weight by design, so the only army the harness could
 * field was one that contained none of them, and the three "they make the bot
 * worse" columns in CLAUDE.md had to be taken with a throwaway script. A number
 * you cannot re-take is a number nobody will re-take.
 *
 * The weights are ratios, not counts — `buildBattleConfig` runs them through
 * `fitComposition` against whatever budget the empire granted — so the same flag
 * means the same army at every tier.
 */
function loadoutWeights(spec) {
  if (!spec || spec === true) return null;
  const out = { ...DEFAULT_COMPOSITION_WEIGHTS };
  for (const pair of String(spec).split(',')) {
    const [unit, w] = pair.split(':');
    if (!(unit in out)) throw new RangeError(`--weights: unknown unit "${unit}"`);
    out[unit] = Number(w ?? 0.3);
  }
  return out;
}
const WEIGHTS = loadoutWeights(args.weights);

/**
 * `--sighted`, `--sighted=ai`, `--sighted=bot` or `--sighted=ai,bot` (equivalent
 * to plain `--sighted`) — the measurement escape hatch for fog of war, exactly
 * the shape `--noupgrades`/`--noconstruct` already are: real balance numbers
 * never set either half, so the four-way table (nobody blind / AI blind only /
 * bot blind only / both blind) stays a flag flip instead of a git operation.
 * Omitted, BOTH sides are blind — the shipped behaviour.
 */
function sightedFlags(spec) {
  if (!spec) return { ai: false, bot: false };
  if (spec === true || spec === 'both') return { ai: true, bot: true };
  const parts = String(spec).split(',');
  return { ai: parts.includes('ai'), bot: parts.includes('bot') };
}
const SIGHTED = sightedFlags(args.sighted);

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
// Tier 6's floor is 18 and NOT lower, and the constraint is a sample size rather
// than taste: tests/campaignplay.test.js proves each region is winnable by
// playing fixed seeds, and at an 18% true rate a 24-seed sample comes up empty
// 1% of the time. A band that floors at 12 would need 40 seeds a region to tell
// "hard" from "broken", which is the distinction that assertion exists to make.
const WIN_BAND = [[78, 92], [66, 84], [50, 72], [34, 56], [22, 42], [18, 36]];

// `--incursion=1-12` measures the ENDLESS LADDER instead of the campaign: rungs
// rather than regions, and a shape rather than a per-tier band. tools/simladder.js
// says why a rung has no WIN_BAND.
if (args.incursion) {
  runLadder(args.incursion, {
    n: N, idleMin: Number(args.idle ?? 30), weights: WEIGHTS, upgrades: !args.noupgrades,
    construct: !args.noconstruct,
  });
  process.exit(0);
}

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
  // --noupgrades reverts to the bot that never touched SITE_LEVELS, and
  // --noconstruct to the one that never raised a building, so BOTH deltas stay
  // measurable rather than remembered. Construction measured at n=40:
  // karrowmere 83% -> 95%, widowsgate 18% -> 23%, gallowmoor 98% -> 93%. A real
  // option rather than a dominant one, which is the shape a verb should have.
  // --noscout reverts to the bot with no answer to fog at all (simbuild.js
  // `scoutTurn`) — same reason: the cost of teaching it to look stays a flag
  // flip rather than something remembered.
  // --noreinforce and --nomicrosend revert the two assault-scan escape
  // hatches in simtactics.js `bestAssaultTarget` independently, so a stalled
  // siege getting reinforced and a below-floor send getting through a thin
  // target stay two separately re-measurable deltas rather than one bundled
  // "and now it works". --nothrone is the third: it puts the castle back under
  // the flat 90-second siege budget every other target gets, which is the bot
  // that would rather time out ahead than commit to the last gate.
  // `--legacy=30` measures a SECOND RUN — the same campaign for a player who has
  // abdicated once. Zero, and therefore absent from the table, unless asked for.
  // `--relics=40` measures a player who has been paid for the ground they took
  // and spent it on troop lines — the one lever the harness cannot earn on its
  // own, and therefore the one the measured table says nothing about.
  // `--pool` OPTS IN to tools/simpool.js, and the opt-in direction is
  // deliberate — see that file's header. Massing measured as a wash with a
  // defect (its target scan is not throne-weighted, so it competes with
  // consolidation), and every number in this project was taken without it, so
  // the default stays where the table is.
  const opts = {
    upgrades: !args.noupgrades, construct: !args.noconstruct, scout: !args.noscout,
    reinforce: !args.noreinforce, microsend: !args.nomicrosend,
    throne: !args.nothrone, pool: !!args.pool, richYards: !!args.richyards,
    weights: WEIGHTS, legacy: Number(args.legacy ?? 0),
    relics: Number(args.relics ?? 0),
    sightedAi: SIGHTED.ai, sightedBot: SIGHTED.bot,
  };
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
