// THE PREVIEW ADMITS WHAT IT CANNOT KNOW.
//
// Invariant 3 says the pre-commit preview calls the same functions the
// simulation runs, so it is a guarantee. That was always true of the ARITHMETIC
// and never true of the WORLD: the enemy can dispatch a column while the
// player's is in the air, and no determinism makes that knowable. The old
// preview handled it by not mentioning it, which turns every attack in the game
// into a solved sum whose answer is already on screen — no read, no risk, no
// gamble.
//
// Two things close it, and they are opposite halves of one rule.
//
//   A column the player CAN see is reported, and a win it contradicts is not
//   claimed. It is reported rather than folded into the sum, because a relief
//   landing mid-melee does not resolve as though both sides had been present
//   from the start — `reprojectDefender` banks casualties and re-projects, so
//   `resolveField(send, garrison + inbound)` is a different fight. Withhold a
//   number you cannot keep; do not soften one.
//
//   A column that does not exist yet is what `margin` is for: "you win, unless
//   twenty more arrive". Everything about the twenty is exact — it is the same
//   `resolveField` solved for the breakeven — and whether they come is a
//   judgement about the board that belongs to the player.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattleState } from '../src/battle/state.js';
import { spawnSquad, clearPathCache } from '../src/battle/movement.js';
import { computePreview } from '../src/screens/battle-preview.js';
import { emptyComp } from '../src/battle/combat.js';
import { makeMods, CONTRACT_VERSION } from '../src/battle/contract.js';

const comp = (o) => ({ ...emptyComp(), ...o });
let n = 0;

/** `sighted` is the fog switch: with it off the player sees nothing but their
 *  own ground, which is what the negative control needs. */
function board({ sighted = true } = {}) {
  clearPathCache();
  const s = createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: `bet-${n++}`,
    seed: 3,
    grid: { cols: 15, rows: 11, blocked: [] },
    sites: [
      { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 60 }, hp: 600, hpMax: 600 },
      { id: 'farm', kind: 'farm', hex: [3, 0], owner: 'enemy', garrison: { militia: 20 }, hp: 100, hpMax: 100 },
      { id: 'ey', kind: 'trainingGround', hex: [6, 0], owner: 'enemy', garrison: { militia: 40 }, hp: 180, hpMax: 180 },
      { id: 'castle', kind: 'castle', hex: [12, 0], owner: 'enemy', garrison: { militia: 5 }, hp: 900, hpMax: 900 },
    ],
    adjacency: [],
    player: makeMods({ expedition: emptyComp() }),
    enemy: makeMods({ expedition: emptyComp() }),
    boosters: [],
    rules: { victory: 'capture-castle', hardCapMs: 600000, aiTier: 1 },
  });
  s.ai.nextThinkTick = Infinity;
  if (sighted) {
    for (const site of s.sites) s.seen.player[site.id] = site.owner;
    for (let q = -8; q < 16; q++) for (let r = 0; r < 11; r++) s.vision.player[`${q},${r}`] = 1;
  }
  return s;
}

const pv = (s) => computePreview(s, 'camp', 'farm', { fraction: 0.5 });
const relief = (s, militia) => spawnSquad(s, {
  owner: 'enemy', from: 'ey', to: 'farm', comp: comp({ militia }),
});

// ---------------------------------------------------------------------------
// The bet
// ---------------------------------------------------------------------------

test('preview: a winnable assault says how much would flip it', () => {
  const p = pv(board());
  assert.equal(p.win, true, 'premise: this one is won');
  assert.ok(p.margin > 0, 'a win with no stated margin is the old solved sum');
  assert.match(p.line, /unless \+\d+ arrive/);
});

test('preview: the margin is EXACT, not a rule of thumb', () => {
  // One body under it still wins and one body on it does not — which is the
  // whole claim, since the number comes off the same `resolveField` the
  // simulation resolves with rather than off a heuristic.
  const base = board();
  const m = pv(base).margin;
  const at = (extra) => {
    const s = board();
    s.sites[1].garrison.militia += extra;
    return computePreview(s, 'camp', 'farm', { fraction: 0.5 }).win;
  };
  assert.equal(at(m - 1), true, `+${m - 1} should still be won`);
  assert.equal(at(m), false, `+${m} should not be`);
});

test('preview: a losing assault states no margin', () => {
  // Telling somebody already losing how much worse it could get is noise, and
  // the decision it informs only exists on the other side.
  const s = board();
  s.sites[1].garrison.militia = 400;
  const p = pv(s);
  assert.equal(p.win, false);
  assert.equal(p.margin, null);
  assert.doesNotMatch(p.line, /unless/);
});

// ---------------------------------------------------------------------------
// ...and what is already coming
// ---------------------------------------------------------------------------

test('preview: a visible relief that crosses the margin withholds the win', () => {
  const s = board();
  const m = pv(s).margin;
  relief(s, m + 5);
  const p = pv(s);
  assert.equal(p.contested, true);
  assert.equal(p.verdict, 'CONTESTED');
  assert.ok(p.inboundN >= m, 'premise: the relief has to be big enough to matter');
  // A contested fight claims no survivor count and no breach time, for the same
  // reason a multi-source send claims no verdict.
  assert.doesNotMatch(p.line, /survive/);
  assert.doesNotMatch(p.line, /BREACH/);
  assert.match(p.line, /\d+ inbound/);
});

test('preview: a visible relief BELOW the margin changes nothing', () => {
  // The control on the threshold. Withholding the verdict for any column at all
  // would make every preview in a busy battle useless.
  const s = board();
  const m = pv(s).margin;
  relief(s, Math.max(1, m - 5));
  const p = pv(s);
  assert.equal(p.contested, false);
  assert.equal(p.verdict, 'WIN FIELD');
  assert.match(p.line, /inbound/, 'it is still reported, just not decisive');
});

test('preview: a relief the player CANNOT SEE is not counted', () => {
  // THE ONE THAT MATTERS. Folding in a column outside vision would leak the
  // position of every enemy army in the game through an arithmetic side
  // channel — and it is precisely the uncertainty `margin` exists to report.
  //
  // The fixture is the interesting part: the player must see the TARGET and not
  // the ROAD, because a wholly blind state never reaches this code at all — it
  // takes the `unscouted` branch and withholds everything, which would make
  // this test pass while asserting nothing. Vision is lit one ring around the
  // farm and nowhere else; the relief spawns six hexes out, in the dark.
  const blind = board({ sighted: false });
  for (let dq = -1; dq <= 1; dq++) for (let dr = -1; dr <= 1; dr++) {
    blind.vision.player[`${3 + dq},${0 + dr}`] = 1;
  }
  blind.seen.player.farm = 'enemy';
  const before = computePreview(blind, 'camp', 'farm', { fraction: 0.5 });
  assert.equal(before.kind, 'assault', 'premise: the TARGET has to be visible');

  relief(blind, 500);
  const after = computePreview(blind, 'camp', 'farm', { fraction: 0.5 });
  assert.equal(after.inboundN, 0, 'an unseen column reached the preview');
  assert.equal(after.contested, false);
  assert.equal(after.verdict, before.verdict);
  assert.equal(after.margin, before.margin, 'and it moved nothing else either');
});

test('preview: an ordinary assault with nothing inbound is unchanged', () => {
  // The regression control: everything above must be inert on the common case.
  const p = pv(board());
  assert.equal(p.inboundN, 0);
  assert.equal(p.contested, false);
  assert.equal(p.verdict, 'WIN FIELD');
  assert.match(p.line, /WIN FIELD · \d+ survive/);
});
