// THE HARNESS COULD NOT MASS FORCE, AND THAT LOOKED LIKE A DIFFICULTY READING.
//
// simplayer.js's assault loop handed ONE garrison at a time to
// `bestAssaultTarget`, judged against `ATTACK_MARGIN` 1.5 alone — while the
// enemy AI pools up to `AI.maxSources` neighbouring sites into a single strike
// (`aicore.js adjacentSources`) and the player can now pool their whole
// selection by hand. Against a Marshal'd castle (never attacked, so it trains
// against zero attrition) no ONE rear garrison could ever clear the margin,
// which read as "this region is too hard" rather than "the bot cannot play
// this shape of target". See CLAUDE.md, "The harness bot cannot concentrate
// force".
//
// `tools/simpool.js pooledAssaultTurn` is the fix, modelled on this file the
// way `tests/throne.test.js` and `tests/scout.test.js` are: a hand-built board
// that sits in the exact window the rule is about, plus the negative controls
// that are the half that matters — `bestAssaultTarget` itself is UNTOUCHED,
// `--nopool` must reproduce the old bot exactly, and riders must never be
// welded into a pooled wave's synchronized arrival.
import test from 'node:test';
import assert from 'node:assert/strict';

import { pooledAssaultTurn, POOL_FILTER } from '../tools/simpool.js';
import { bestAssaultTarget, RIDERS } from '../tools/simtactics.js';
import { startRun, playerTurn } from '../tools/simplayer.js';

// Pooling is OPT-IN (`--pool`), inverting the `--noX` house pattern on purpose
// — see tools/simpool.js's header for the measurement and the defect that
// decided it. Every test that wants a pooled strike has to say so, which is
// also what makes the default test below mean something.
const ON = Object.freeze({ pool: true });
import { step } from '../src/battle/sim.js';
import { emptyComp } from '../src/battle/combat.js';
import { filterComp } from '../src/battle/commands.js';
import { SITES, SITE_LEVELS } from '../src/content/balance.js';
import { TICK_HZ } from '../src/core/loop.js';
import { REGIONS, REGION_IDS } from '../src/content/regions.data.js';

const comp = (x) => ({ ...emptyComp(), ...x });
const before = (id) => REGION_IDS.slice(0, REGIONS.findIndex((r) => r.id === id));

/**
 * Three modest player garrisons around one strong castle, none of which can
 * clear `ATTACK_MARGIN` alone — the exact shape CLAUDE.md traces to a
 * Marshal'd tier-4+ throne. `riders` optionally salts one source with fast
 * troops that should never end up in a pooled wave.
 *
 * Hand-built rather than generated, same reason as `throne.test.js`'s board:
 * the question is one function's decision on one target, and a generated map
 * cannot be pinned in this exact window on purpose.
 */
function board({ each = 200, defenders = 220, riders = 0 } = {}) {
  const src = (id, hex, extra = {}) => ({
    id, kind: 'stronghold', owner: 'player', hex, level: 1, adj: ['e1'],
    garrison: comp({ militia: each, ...extra }), hp: 300, hpMax: 300,
  });
  const castle = {
    id: 'e1', kind: 'castle', owner: 'enemy', hex: [4, 4], level: 4, adj: ['p1', 'p2', 'p3'],
    garrison: comp({ militia: defenders }),
    hp: SITES.castle.hp * SITE_LEVELS[3].hp, hpMax: SITES.castle.hp * SITE_LEVELS[3].hp,
  };
  return {
    tick: 0,
    sites: [
      src('p1', [2, 2], riders ? { outriders: riders } : {}),
      src('p2', [2, 4]),
      src('p3', [2, 6]),
      castle,
    ],
    squads: [],
    influence: {},
    grid: { cols: 9, rows: 9, blocked: [], rivers: [] },
    rules: { castleGateFrac: 0, hardCapTicks: 60 * 60 * TICK_HZ },
    mods: {},
  };
}

const mineOf = (v) => v.sites.filter((s) => s.owner === 'player');

test('pool: the fixture sits in the window this rule is about — nobody can take it alone', () => {
  // WITHOUT THIS THE WHOLE FILE IS VACUOUS: if one source's own share already
  // cleared the margin, pooling would never be exercised and every assertion
  // below would pass for the trivial reason that nothing was ever refused.
  const v = board();
  const solo = bestAssaultTarget(v, { adj: ['e1'] }, comp({ militia: 150 }));
  assert.equal(solo, null, 'one source alone has to fail ATTACK_MARGIN, or this fixture is not '
    + 'the shape the diagnosis is about');

  // ...and the combined force of all three (the fraction `pooledAssaultTurn`
  // itself will compute) DOES clear it, so the window is real in both
  // directions.
  const combined = bestAssaultTarget(v, { adj: ['e1'] }, comp({ militia: 450 }));
  assert.equal(combined?.id, 'e1', 'three garrisons together have to clear the margin, or '
    + 'pooling has nothing to prove');
});

test('pool: three garrisons none of which can take the castle alone, mass and take it', () => {
  const v = board();
  const cmds = pooledAssaultTurn(v, mineOf(v), new Set(), new Set(), new Set(), ON);

  assert.equal(cmds.length, 3, 'expected one real SEND per contributing site — the sim has no '
    + 'multi-source order, so a pooled strike has to be issued as three ordinary sends');
  assert.deepEqual(new Set(cmds.map((c) => c.from)), new Set(['p1', 'p2', 'p3']));
  assert.ok(cmds.every((c) => c.t === 'SEND' && c.to === 'e1'));

  // ONE SYNCHRONIZED WAVE, `launch`'s own rule: `bestAssaultTarget` scored the
  // combined force as if it struck at once, so the real squads have to.
  const arrivals = new Set(cmds.map((c) => c.arriveTick));
  assert.equal(arrivals.size, 1, 'a pooled strike must share ONE arriveTick or the evaluation '
    + 'was a preview of a battle that never happens');
});

test('pool: OFF is the default, and that is the whole switch', () => {
  // THE NEGATIVE CONTROL. Without it this file would pass just as happily if
  // `pooledAssaultTurn` pooled unconditionally and `opts.pool` did nothing.
  const v = board();
  // Massing measured as a wash with a defect (its target scan is not
  // throne-weighted, so it competes with consolidation — see simpool.js), and
  // every number in this project was taken without it. So `opts.pool` must be
  // TRUE to pool: an absent flag, a false flag and a junk flag are all the old
  // bot, exactly.
  for (const opts of [{}, { pool: false }, { pool: 'yes' }, undefined]) {
    assert.deepEqual(pooledAssaultTurn(v, mineOf(v), new Set(), new Set(), new Set(), opts), [],
      'anything but `pool: true` must reproduce the bot that could not mass');
  }
  const cmds = pooledAssaultTurn(v, mineOf(v), new Set(), new Set(), new Set(), { pool: false });
  assert.deepEqual(cmds, [], 'the explicit revert must reproduce the bot that could not mass, or the '
    + 'delta stops being re-takeable');
});

test('pool: a source already spoken for this think cannot be double-spent', () => {
  // Mirrors the per-source loop having already used p2 and p3 (e.g. on
  // easier targets) THIS think — only p1 is left, and one source alone is
  // the ordinary path's job, not this one.
  const v = board();
  const cmds = pooledAssaultTurn(v, mineOf(v), new Set(), new Set(['p2', 'p3']), new Set(), {});
  assert.deepEqual(cmds, [], 'a single leftover source pooled with nobody is not pooling');
});

test('pool: a target the per-source loop already took is not hit twice', () => {
  const v = board();
  const cmds = pooledAssaultTurn(v, mineOf(v), new Set(), new Set(), new Set(['e1']), {});
  assert.deepEqual(cmds, [], 'the castle is already `taken` this think — a second, redundant '
    + 'wave from unrelated sources is not what pooling is for');
});

test('pool: riders never contribute to a pooled wave', () => {
  // THE SPECIFIC RISK THIS SWITCH HAD TO AVOID. `slowestSpeed` is a MIN over
  // ONE squad, so a leftover rider mixed into its OWN site's ordinary column
  // cannot slow it down — but a pooled wave synchronizes EVERY contributing
  // squad to the SAME arriveTick, held back to the slowest. Folding a rider
  // source into that wave would throw its whole 165-speed reason for
  // existing away to match a militia column three sites over: exactly
  // "welding a rider to a slow column in a way the single-source path
  // avoided". `riderTurn` already had first refusal; anything left behind
  // stays home rather than joining a synchronized slow strike.
  const v = board({ riders: 50 });
  const cmds = pooledAssaultTurn(v, mineOf(v), new Set(), new Set(), new Set(), ON);
  assert.equal(cmds.length, 3, 'salting one source with outriders must not change how many '
    + 'sites contribute');

  assert.ok(RIDERS.every((u) => !POOL_FILTER.includes(u)), 'POOL_FILTER must exclude every '
    + 'rider unit, not just outriders specifically');

  const fromP1 = cmds.find((c) => c.from === 'p1');
  const p1Site = v.sites.find((s) => s.id === 'p1');
  const actuallySent = filterComp(p1Site.garrison, fromP1.filter);
  assert.equal(actuallySent.outriders, 0, 'the 50 outriders sitting in p1\'s garrison must not '
    + 'ride along in the pooled wave');
  assert.ok(actuallySent.militia > 0, 'p1 still has to contribute its ordinary bodies');
});

test('pool: a real battle on thanescar — the diagnosed, Marshal\'d region — masses force', () => {
  // Not a fixture this time: the actual bot, on the actual region the
  // diagnosis was traced on. Bounded to a modest tick budget (real per-tick
  // cost here is well under a millisecond — see CLAUDE.md's autoresolve
  // timing table) rather than played to a verdict, because the mechanism
  // firing at all is the claim, not a win rate.
  //
  // GROUPED BY (to, arriveTick), not merely counted — a plain count would
  // pass just as happily if `--weights`-style silent discard struck and every
  // "pooled" command actually carried a single, orphaned `from`. The claim
  // this pins is the one that matters: at least one real synchronized wave in
  // a real battle draws from TWO OR MORE DISTINCT sites.
  function poolGroups(opts) {
    const battle = startRun('thanescar', 8919, before('thanescar'), 10, opts);
    let nextThink = 0;
    const groups = new Map();
    while (battle.status === 'running' && battle.tick < 14400) {
      if (battle.tick >= nextThink) {
        playerTurn(battle, opts);
        for (const c of battle.commands) {
          if (c.filter !== POOL_FILTER) continue;
          const key = `${c.to}|${c.arriveTick}`;
          if (!groups.has(key)) groups.set(key, new Set());
          groups.get(key).add(c.from);
        }
        nextThink = battle.tick + 20;
      }
      step(battle);
    }
    return [...groups.values()];
  }
  const withPool = poolGroups(ON);
  assert.ok(withPool.length > 0, 'pooling never issued a single command in a real battle on '
    + 'thanescar — either nothing ever qualifies, or the wiring into playerTurn is broken');
  assert.ok(withPool.some((froms) => froms.size >= 2), 'every pooled group in a real battle '
    + 'carried only ONE site — the mechanism is firing but never actually massing, which is '
    + 'the exact silent-discard shape `--weights`/`fitComposition` and a walked-away siege '
    + 'both took once already');
  assert.equal(poolGroups({ pool: false }).length, 0, '--nopool still issued a pooled send in '
    + 'a real battle');
});
