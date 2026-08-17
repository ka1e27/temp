// CONCENTRATING FORCE: one drag off a multi-selection commits every source.
//
// The AI has pooled up to `AI.maxSources` sites into a single assault since
// free movement shipped, and the whole balance argument for free movement rests
// on concentration — but the player had no equivalent, and the cost scaled with
// exactly the late maps where it matters most. SEND was the last member of a
// family to learn this: `setRally` and `retreatSelection` had walked the
// selection for releases.
//
// The interesting half is the PREVIEW, and it is interesting because of what it
// refuses to say. Invariant 3 is that the pre-commit preview is a GUARANTEE, so
// a multi-source drag — whose columns are at different distances and therefore
// arrive as separate waves — does not claim a combined outcome at all. Summing
// the comps and calling `resolveField` once would produce a plausible,
// confident, wrong number, which is the exact class of defect this codebase
// keeps finding. The tests below pin the withholding as deliberate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattleState } from '../src/battle/state.js';
import { clearPathCache } from '../src/battle/movement.js';
import { emptyComp } from '../src/battle/combat.js';
import { makeMods, CONTRACT_VERSION } from '../src/battle/contract.js';
import { computePreview, computeMultiPreview } from '../src/screens/battle-preview.js';
import { resolveDrag } from '../src/screens/battle-drag.js';

let n = 0;

/** Three of the player's sites at different distances from one enemy farm, so
 *  the arrival SPREAD is a real number rather than a degenerate one. */
function board(enemyHex = [11, 0]) {
  clearPathCache();
  return createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: `multi-${n++}`,
    seed: 3,
    grid: { cols: 15, rows: 11, blocked: [] },
    sites: [
      { id: 'a', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 20 }, hp: 600, hpMax: 600 },
      { id: 'b', kind: 'stronghold', hex: [3, 0], owner: 'player', garrison: { militia: 12 }, hp: 340, hpMax: 340 },
      { id: 'c', kind: 'farm', hex: [6, 0], owner: 'player', garrison: { militia: 8 }, hp: 100, hpMax: 100 },
      { id: 'x', kind: 'farm', hex: enemyHex, owner: 'enemy', garrison: { militia: 4 }, hp: 100, hpMax: 100 },
      { id: 'e', kind: 'farm', hex: [13, 0], owner: 'enemy', garrison: {}, hp: 100, hpMax: 100 },
    ],
    adjacency: [['a', 'b'], ['b', 'c'], ['c', 'x'], ['x', 'e']],
    player: makeMods({ expedition: emptyComp() }),
    enemy: makeMods({ expedition: emptyComp() }),
    boosters: [],
    rules: { victory: 'capture-castle', hardCapMs: 600000, aiTier: 1 },
  });
}

// ---------------------------------------------------------------------------
// The preview claims less, on purpose
// ---------------------------------------------------------------------------

test('a multi-source preview reports columns, bodies and an arrival SPREAD', () => {
  const s = board();
  const pv = computeMultiPreview(s, ['a', 'b', 'c'], 'x', { fraction: 0.5 });

  assert.equal(pv.kind, 'multi');
  assert.equal(pv.columns, 3);
  assert.equal(pv.sendN, 10 + 6 + 4, 'half of each garrison, summed');
  assert.ok(pv.etaMax > pv.etaMin, 'three different distances is three different ETAs');
  assert.match(pv.line, /3 columns/);
  assert.match(pv.line, /20 troops/);
});

test('...and claims NO OUTCOME, which is how it keeps invariant 3', () => {
  const s = board();
  const pv = computeMultiPreview(s, ['a', 'b', 'c'], 'x', { fraction: 0.5 });

  // The single-source preview promises all of these because it calls the same
  // functions the simulation runs. A multi-source one cannot, because the
  // columns land as separate waves — so it must promise none of them rather
  // than promise them approximately.
  assert.equal(pv.win, undefined, 'no win/lose claim');
  assert.equal(pv.verdict, undefined, 'no verdict');
  assert.equal(pv.defSurvivors, undefined, 'no survivor count');
  assert.equal(pv.insufficient, undefined, 'no siege claim');
});

test('a source with nothing to send contributes nothing and is not counted', () => {
  const s = board();
  s.sites.find((x) => x.id === 'c').garrison = emptyComp();
  const pv = computeMultiPreview(s, ['a', 'b', 'c'], 'x', { fraction: 0.5 });
  assert.equal(pv.columns, 2, 'the empty site is simply not a column');
  assert.equal(pv.sendN, 16);
});

test('a selection of nothing sendable previews nothing at all', () => {
  const s = board();
  for (const id of ['a', 'b', 'c']) s.sites.find((x) => x.id === id).garrison = emptyComp();
  assert.equal(computeMultiPreview(s, ['a', 'b', 'c'], 'x', { fraction: 0.5 }), null);
});

test('the target itself is never one of its own sources', () => {
  const s = board();
  s.sites.find((x) => x.id === 'c').owner = 'player';
  const pv = computeMultiPreview(s, ['a', 'b', 'c'], 'c', { fraction: 0.5 });
  assert.equal(pv.columns, 2, 'c cannot march on c');
});

test("an enemy site in the selection is not one of YOUR sources", () => {
  const s = board();
  const pv = computeMultiPreview(s, ['a', 'e'], 'x', { fraction: 0.5 });
  assert.equal(pv.columns, 1, 'only the site the player holds');
});

// ---------------------------------------------------------------------------
// The negative control: one source is byte-identical to before
// ---------------------------------------------------------------------------

test('a SINGLE-source preview still makes every promise it always did', () => {
  // The target has to be one the player can actually SEE. Against an unscouted
  // building the single-source preview withholds its outcome too (`kind:
  // 'unscouted'`) — which is the same principle as the multi case arriving from
  // fog rather than from arithmetic, and is worth knowing before reading a
  // missing verdict as a regression.
  const s = board([7, 0]);   // one hex off the player's farm at [6,0]
  const pv = computePreview(s, 'a', 'x', { fraction: 0.5 });
  assert.equal(pv.kind, 'assault', 'a scouted enemy site is a real assault');
  assert.equal(typeof pv.win, 'boolean', 'still a guarantee, not a shrug');
  assert.ok(pv.verdict, 'still a verdict');
});

test('...and against an UNSCOUTED site it withholds for fog, not for arithmetic', () => {
  const s = board();          // the enemy farm is eleven hexes away, unseen
  const pv = computePreview(s, 'a', 'x', { fraction: 0.5 });
  assert.equal(pv.kind, 'unscouted');
  assert.equal(pv.win, undefined, 'no outcome claim about a garrison nobody has counted');
});

// ---------------------------------------------------------------------------
// The gesture
// ---------------------------------------------------------------------------

function fakeOrders(s) {
  const issued = [];
  return {
    issued,
    squadAt: () => null,
    site: (id) => s.sites.find((x) => x.id === id) || null,
    isDrawnRoute: () => false,
    trimWaypoints: () => [],
    selectOnly: () => {},
    issueSend: (from, to, o) => { issued.push({ t: 'SEND', from: from.id, to: to?.id ?? null, ...o }); return true; },
    sendFromSelection: (to, o) => { issued.push({ t: 'MULTI', to: to?.id ?? null, ...o }); return 2; },
    issueMove: (sq, to) => { issued.push({ t: 'MOVE', squadId: sq.id, to: to?.id ?? null }); return true; },
  };
}

const dragView = (over) => ({
  dragFrom: null, dragFromSquad: null, dragTo: null,
  dragTrail: [], dragSources: null, armed: null, ...over,
});

test('a drag off a multi-selected site commits the whole selection', () => {
  const s = board();
  const ord = fakeOrders(s);
  const view = dragView({ dragFrom: 'a', dragTo: 'x', dragSources: ['a', 'b'] });

  assert.equal(resolveDrag(ord, view, s), true);
  assert.deepEqual(ord.issued.map((c) => c.t), ['MULTI']);
  assert.equal(ord.issued[0].to, 'x');
});

test('a drag off an UNSELECTED site is still exactly one send', () => {
  const s = board();
  const ord = fakeOrders(s);
  const view = dragView({ dragFrom: 'a', dragTo: 'x' });

  assert.equal(resolveDrag(ord, view, s), true);
  assert.deepEqual(ord.issued.map((c) => c.t), ['SEND'],
    'the concentration branch must not swallow an ordinary drag');
  assert.equal(ord.issued[0].from, 'a');
});
