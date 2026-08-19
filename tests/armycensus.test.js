// WHERE YOUR ARMY IS, WHICH NOTHING ANYWHERE ANSWERED.
//
// Gold carries a running total AND a rate; troops carried neither. A
// readability pass enumerated the whole HUD from source and found no number
// for how many bodies you command, how many are standing versus marching, or
// how many orders are in flight — while CLAUDE.md writes that exact blind spot
// up at length for the HARNESS BOT (1,092 bodies with 239 standing, 78%
// permanently in transit) and treats it as a first-order balance concern.
//
// Fixing it turned up a real omission underneath: `armySize` promised "anywhere"
// and did not count a column in a field battle, so a faction's total DIPPED for
// `MELEE.seconds` every time it attacked anything.
import test from 'node:test';
import assert from 'node:assert/strict';
import { armyCensus, armySize } from '../src/battle/siteinfo.js';

/** Only the fields the census reads — it is a fold over sites and squads. */
const world = (sites, squads = []) => ({ sites, squads });

test('a garrison is standing', () => {
  const c = armyCensus(world([
    { owner: 'player', garrison: { militia: 10, rams: 2 } },
    { owner: 'enemy', garrison: { militia: 99 } },
  ]), 'player');
  assert.deepEqual(c, { total: 12, standing: 12, marching: 0 });
});

test('a column in flight is marching', () => {
  const c = armyCensus(world(
    [{ owner: 'player', garrison: { militia: 4 } }],
    [{ owner: 'player', comp: { militia: 6 }, camped: false }],
  ), 'player');
  assert.deepEqual(c, { total: 10, standing: 4, marching: 6 });
});

test('...but a CAMPED force is standing, not marching', () => {
  // It is on `state.squads` like a column in flight and holding ground like a
  // garrison. Counting it as marching would make "park a force on a hex" read
  // as indecision, which is the opposite of what the order is for.
  const c = armyCensus(world([], [
    { owner: 'player', comp: { militia: 6 }, camped: true },
    { owner: 'player', comp: { militia: 3 }, camped: false },
  ]), 'player');
  assert.deepEqual(c, { total: 9, standing: 6, marching: 3 });
});

test('besiegers are standing', () => {
  const c = armyCensus(world([
    { owner: 'enemy', garrison: {}, siege: { owner: 'player', comp: { rams: 5 } } },
  ]), 'player');
  assert.deepEqual(c, { total: 5, standing: 5, marching: 0 });
});

test('AND A COLUMN IN A FIELD BATTLE IS COUNTED AT ALL — the omission', () => {
  // The bug this file exists for. For `MELEE.seconds` an assaulting column is
  // off `state.squads` and lives in `site.melee` (contract v12), a bucket that
  // did not exist when `armySize` was written. Before this, a 40-body assault
  // made 40 bodies vanish from the total for six seconds and come back.
  const c = armyCensus(world([
    { owner: 'enemy', garrison: { militia: 3 }, melee: { owner: 'player', comp: { militia: 40 } } },
  ]), 'player');
  assert.equal(c.total, 40, 'the assaulting column must not vanish');
  assert.equal(c.standing, 40);
});

test('an army does not change size by attacking', () => {
  // The property the bug broke, stated as the invariant rather than as a count:
  // the same 20 bodies marching, then in a melee, then besieging, are 20 bodies
  // throughout. Only WHERE they are changes.
  const comp = { militia: 20 };
  const marching = armyCensus(world([], [{ owner: 'player', comp, camped: false }]), 'player');
  const fighting = armyCensus(world([
    { owner: 'enemy', garrison: {}, melee: { owner: 'player', comp } },
  ]), 'player');
  const besieging = armyCensus(world([
    { owner: 'enemy', garrison: {}, siege: { owner: 'player', comp } },
  ]), 'player');
  assert.equal(marching.total, 20);
  assert.equal(fighting.total, 20);
  assert.equal(besieging.total, 20);
  assert.equal(marching.marching, 20, 'and only the marching one is in transit');
  assert.equal(fighting.marching, 0);
  assert.equal(besieging.marching, 0);
});

test('the total is always its own parts', () => {
  // `armySize` is expressed against the census so there is exactly one fold.
  // Two implementations of "count a comp" is how the melee bucket got missed by
  // one of them in the first place.
  const w = world([
    { owner: 'player', garrison: { militia: 7 } },
    { owner: 'enemy', garrison: { militia: 2 }, siege: { owner: 'player', comp: { rams: 3 } } },
    { owner: 'enemy', garrison: {}, melee: { owner: 'player', comp: { spearmen: 5 } } },
  ], [
    { owner: 'player', comp: { militia: 11 }, camped: false },
    { owner: 'player', comp: { militia: 2 }, camped: true },
    { owner: 'enemy', comp: { militia: 50 }, camped: false },
  ]);
  const c = armyCensus(w, 'player');
  assert.equal(c.standing + c.marching, c.total);
  assert.equal(armySize(w, 'player'), c.total);
  assert.equal(c.total, 28);
  assert.equal(c.marching, 11);
});

test('an empty faction is zero, not NaN', () => {
  // The readout is hidden on a falsy total, so a NaN here would render the row
  // rather than collapsing it — and `NaN` is truthy nowhere but is not 0 either.
  const c = armyCensus(world([{ owner: 'enemy', garrison: { militia: 3 } }]), 'player');
  assert.deepEqual(c, { total: 0, standing: 0, marching: 0 });
});

test('a missing comp counts as nothing rather than throwing', () => {
  // `site.garrison` is always present in real state, but a site mid-capture and
  // the hand-built fixtures ~25 tests use are not guaranteed to be, and this is
  // read on every HUD refresh.
  const c = armyCensus(world([{ owner: 'player' }], [{ owner: 'player' }]), 'player');
  assert.equal(c.total, 0);
});
