// THE CAMPAIGN'S TWO BIG MOMENTS MUST NOT SHARE THEIR COPY WITH A TIER-1 FARM.
//
// Measured before this shipped: taking Obsidian — whose own flavour text calls
// it "Their capital" — and taking Widow's Gate, the literal last region of the
// twenty-four, both printed the byte-identical subline "Your empire grows, and
// so does its income." `resultCopy` had exactly three win branches (incursion,
// raid, first conquest) and nothing for the capital or for finishing, so the
// only thing that changed between an empty farm and the enemy throne was which
// noun went into "${name} is yours".
//
// The flags are computed in `meta/rewards.js` where `meta` is, not in the
// screen: a screen that re-derived "have I finished the campaign" would be a
// second implementation of the rule the endgame gates already use.
import test from 'node:test';
import assert from 'node:assert/strict';

import { resultCopy } from '../src/screens/results.js';
import { RESULTS } from '../src/content/strings.js';
import { CAPITAL_ID, REGION_IDS, REGION_BY_ID } from '../src/content/regions.data.js';
import { applyOutcome } from '../src/meta/rewards.js';
import { toOutcome } from '../src/battle/outcome.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { generateBattleMap } from '../src/battle/mapgen.js';
import { startBattle, step } from '../src/battle/sim.js';
import { createMeta } from '../src/core/store.js';
import { markConquered } from '../src/meta/world.js';

const WIN = { result: 'win' };
const region = (id) => ({ id, name: REGION_BY_ID[id].name });
const copy = (applied, id) => resultCopy(WIN, applied, region(id));

test('the capital, the finale and an ordinary region all say different things', () => {
  const ordinary = copy({ conquered: true }, 'kaldan');
  const capital = copy({ conquered: true, capital: true }, CAPITAL_ID);
  const done = copy({ conquered: true, campaignDone: true }, REGION_IDS.at(-1));

  const titles = [ordinary.title, capital.title, done.title];
  const bodies = [ordinary.body, capital.body, done.body];
  assert.equal(new Set(titles).size, 3, `titles collide: ${titles.join(' | ')}`);
  assert.equal(new Set(bodies).size, 3, `bodies collide: ${bodies.join(' | ')}`);
  assert.equal(capital.title, RESULTS.capitalTitle);
  assert.equal(done.title, RESULTS.campaignTitle);
});

test('the capital is not sold as the end of the campaign', () => {
  // Six regions sit east of it, so a line implying the war is over would be a
  // lie the player finds out about on the very next screen.
  const body = copy({ conquered: true, capital: true }, CAPITAL_ID).body;
  assert.match(body, /homeland|still|east/i,
    `the capital line must say the war continues, got: "${body}"`);
  assert.ok(REGION_IDS.indexOf(CAPITAL_ID) < REGION_IDS.length - 1,
    'the capital is the last region — this test and the copy both need rewriting');
});

test('NEGATIVE CONTROL: an ordinary conquest is untouched', () => {
  // The branch that runs for 21 of the 24 regions must be exactly what it was,
  // or this change is a rewrite of the whole campaign rather than two moments.
  const ordinary = copy({ conquered: true }, 'kaldan');
  assert.equal(ordinary.title, 'Kaldan Reach is yours');
  assert.equal(ordinary.body, 'Your empire grows, and so does its income.');
});

test('NEGATIVE CONTROL: a raid and an incursion still win their own branches', () => {
  // Both are checked BEFORE the new ones, so a raid on the capital must still
  // read as a raid — the region was already yours and nothing has fallen.
  const raid = copy({ raided: true, capital: true }, CAPITAL_ID);
  assert.match(raid.title, /raided/i, `a raid on the capital read as a conquest: "${raid.title}"`);
  const rung = copy({ incursion: { depth: 7 }, campaignDone: true }, REGION_IDS.at(-1));
  assert.match(rung.title, /Depth 7/, `a rung read as the campaign finale: "${rung.title}"`);
});

test('finishing outranks the capital if a future table ever makes them one region', () => {
  const both = copy({ conquered: true, capital: true, campaignDone: true }, CAPITAL_ID);
  assert.equal(both.title, RESULTS.campaignTitle);
});

/** Win `regionId` for real, having already taken `pre`, and hand back what
 *  applyOutcome reports. Driven through the actual pipeline rather than a
 *  hand-built summary: the copy above is only correct if these flags are the
 *  ones the meta layer really sets, and a fixture cannot tell you that. */
function winFor(pre, regionId) {
  const meta = createMeta();
  for (const r of pre) markConquered(meta, r, { now: 0, durationMs: 0 });
  const cfg = buildBattleConfig(meta, regionId, [], generateBattleMap, { seed: 7 });
  const b = startBattle(cfg);
  // End it as a win without playing it: the flags under test are meta-side and
  // do not care how the castle fell.
  for (const s of b.sites) if (s.owner === 'enemy') s.owner = 'player';
  while (b.status === 'running' && b.tick < 40) step(b);
  return applyOutcome(meta, cfg, toOutcome(b, cfg), { now: 0 });
}

test('the flags the copy branches on are the ones applyOutcome really sets', () => {
  const ci = REGION_IDS.indexOf(CAPITAL_ID);
  const cap = winFor(REGION_IDS.slice(0, ci), CAPITAL_ID);
  assert.equal(cap.won, true, 'the fixture did not actually win');
  assert.equal(cap.capital, true, 'taking the capital did not report itself');
  assert.equal(cap.campaignDone, false, 'the capital is not the end of the campaign');

  const done = winFor(REGION_IDS.slice(0, -1), REGION_IDS.at(-1));
  assert.equal(done.campaignDone, true, 'finishing all 24 did not report itself');
  assert.equal(done.capital, false);

  // NEGATIVE CONTROL: the 21 ordinary regions must set neither, or every
  // conquest in the game gets the finale's copy.
  const ordinary = winFor([REGION_IDS[0]], REGION_IDS[1]);
  assert.equal(ordinary.capital, false);
  assert.equal(ordinary.campaignDone, false);
});
