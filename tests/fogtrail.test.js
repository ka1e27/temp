// THE SMOKE CLOSES BACK IN BEHIND A MARCHING COLUMN, and stays open around one
// that is standing still.
//
// The sim rule was already right: `canSee` grants any squad — camped or
// marching — sight of its own hex and the ring around it. What was wrong was
// what the player SAW. The veil is painted on the background canvas, which
// repaints only when `signature()` moves, and a marching squad deliberately
// never bumped `influenceVersion` (the per-tick repaint that would cause is the
// regression bgcache.js once measured at 60fps -> 31). So `computeVeil` folded
// squad sight in perfectly and then sat frozen: fog neither opened ahead of a
// march nor closed behind it, and lagged by however long since some unrelated
// capture forced a repaint.
//
// `squadSightSig` is the fix, and this file pins the two halves that make it
// affordable AND correct: it moves when a column crosses a HEX (a couple of
// times a second, not ten), and it does NOT move for a force standing still —
// which is exactly why a camped army keeps its ring lit for free.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattleState } from '../src/battle/state.js';
import { spawnSquad, clearPathCache, squadHexOf } from '../src/battle/movement.js';
import { canSee } from '../src/battle/vision.js';
import { emptyComp } from '../src/battle/combat.js';
import { makeMods, CONTRACT_VERSION } from '../src/battle/contract.js';
import { computeVeil } from '../src/render/fog.js';
import { squadSightSig } from '../src/render/battleViewSig.js';
import { SQUAD_VISION_RADIUS } from '../src/content/balance.js';

const comp = (o) => ({ ...emptyComp(), ...o });
let n = 0;

/** A long empty corridor with the player's camp at one end, so a column's
 *  march crosses ground NOTHING else can see — the only way to tell squad
 *  sight from a building's. */
function corridor() {
  clearPathCache();
  return createBattleState({
    contractVersion: CONTRACT_VERSION,
    battleId: `fogtrail-${n++}`,
    seed: 9,
    grid: { cols: 20, rows: 9, blocked: [] },
    sites: [
      { id: 'camp', kind: 'camp', hex: [0, 0], owner: 'player', garrison: { militia: 30 }, hp: 600, hpMax: 600 },
      { id: 'far', kind: 'farm', hex: [16, 0], owner: 'enemy', garrison: { militia: 2 }, hp: 100, hpMax: 100 },
    ],
    adjacency: [['camp', 'far']],
    player: makeMods({ expedition: emptyComp() }),
    enemy: makeMods({ expedition: emptyComp() }),
    boosters: [],
    rules: { victory: 'capture-castle', hardCapMs: 600000, aiTier: 1 },
  });
}

const march = (s) => spawnSquad(s, {
  owner: 'player', from: 'camp', to: 'far', comp: comp({ militia: 10 }),
});

// ---------------------------------------------------------------------------
// The sim rule: a squad lights the ring it stands on, moving or not
// ---------------------------------------------------------------------------

test('a MARCHING column sees its own hex and every hex adjacent to it', () => {
  const s = corridor();
  const sq = march(s);
  s.tick = Math.floor((sq.spawnTick + sq.arriveTick) / 2); // mid-march
  const at = squadHexOf(s, sq);

  assert.equal(canSee(s, 'player', at.q, at.r), true, 'the hex it is on');
  for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]]) {
    assert.equal(canSee(s, 'player', at.q + dq, at.r + dr), true,
      `the adjacent hex ${dq},${dr}`);
  }
  // ...and no further, or the column would be scouting for free — that is what
  // the watchtower is for.
  assert.equal(SQUAD_VISION_RADIUS, 1, 'a doorstep, not a sightline');
  assert.equal(canSee(s, 'player', at.q + 2, at.r), false, 'two hexes off is dark');
});

test('a CAMPED force sees exactly the same ring, indefinitely', () => {
  const s = corridor();
  const sq = march(s);
  s.tick = sq.arriveTick;
  sq.camped = true;
  sq.hex = { q: 8, r: 0 };
  sq.path = [{ q: 8, r: 0 }];

  for (const t of [sq.arriveTick, sq.arriveTick + 500, sq.arriveTick + 5000]) {
    s.tick = t;
    assert.equal(canSee(s, 'player', 8, 0), true, `own hex at tick ${t}`);
    assert.equal(canSee(s, 'player', 9, 0), true, `ring at tick ${t}`);
  }
});

// ---------------------------------------------------------------------------
// The smoke closes back in
// ---------------------------------------------------------------------------

test('ground a column has MARCHED PAST goes dark again behind it', () => {
  const s = corridor();
  const sq = march(s);

  // Early in the march, then late. Nothing else on this board can see the
  // middle of the corridor, so any sight there is the column's own.
  s.tick = sq.spawnTick + Math.max(1, Math.floor((sq.arriveTick - sq.spawnTick) * 0.25));
  const early = squadHexOf(s, sq);
  assert.equal(canSee(s, 'player', early.q, early.r), true, 'lit while it stands there');

  s.tick = sq.spawnTick + Math.floor((sq.arriveTick - sq.spawnTick) * 0.9);
  const late = squadHexOf(s, sq);
  assert.notDeepEqual({ q: late.q, r: late.r }, { q: early.q, r: early.r },
    'the column has genuinely moved on');
  assert.equal(canSee(s, 'player', early.q, early.r), false,
    'and the ground it left is dark again — the smoke closed back in');
});

test('the VEIL agrees, hex for hex, rather than only `canSee`', () => {
  const s = corridor();
  const sq = march(s);
  const { cols, rows } = s.grid;
  const idx = (q, r) => r * cols + (q + Math.floor(r / 2));

  s.tick = sq.spawnTick + Math.max(1, Math.floor((sq.arriveTick - sq.spawnTick) * 0.25));
  const early = squadHexOf(s, sq);
  let veil = computeVeil(s, 'player', cols, rows, null);
  assert.equal(veil[idx(early.q, early.r)], 0, 'clear where the column is');

  s.tick = sq.spawnTick + Math.floor((sq.arriveTick - sq.spawnTick) * 0.9);
  veil = computeVeil(s, 'player', cols, rows, veil);
  assert.equal(veil[idx(early.q, early.r)], 1, 'fogged again once it has gone');
});

// ---------------------------------------------------------------------------
// ...and the repaint trigger that makes any of it visible
// ---------------------------------------------------------------------------

test('the signature moves when a column crosses a hex, and not per tick', () => {
  const s = corridor();
  const sq = march(s);
  const span = sq.arriveTick - sq.spawnTick;

  const seen = new Set();
  let sameHexStreak = 0;
  let prevHex = null;
  let prevSig = null;
  let ticksWithoutChange = 0;
  for (let t = sq.spawnTick; t <= sq.arriveTick; t++) {
    s.tick = t;
    const at = squadHexOf(s, sq);
    const sig = squadSightSig(s, 'player');
    seen.add(sig);
    const key = `${at.q},${at.r}`;
    if (prevHex !== null) {
      // The load-bearing claim: the hash changes EXACTLY when the hex does.
      assert.equal(sig !== prevSig, key !== prevHex,
        `tick ${t}: hash and hex must move together`);
      if (key === prevHex) { sameHexStreak++; ticksWithoutChange++; }
    }
    prevHex = key;
    prevSig = sig;
  }
  assert.ok(seen.size > 1, 'it does move as the column marches');
  assert.ok(seen.size < span,
    `and far less often than per tick (${seen.size} changes over ${span} ticks)`);
  assert.ok(sameHexStreak > 0, 'there are ticks where nothing repaints');
});

test('a force STANDING STILL forces no repaints at all', () => {
  const s = corridor();
  const sq = march(s);
  s.tick = sq.arriveTick;
  sq.camped = true;
  sq.hex = { q: 8, r: 0 };
  sq.path = [{ q: 8, r: 0 }];

  const first = squadSightSig(s, 'player');
  // The bound is captured FIRST: the body assigns `s.tick`, so `s.tick + 200`
  // as the condition is a loop that outruns itself forever.
  const from = s.tick;
  for (let t = from; t < from + 200; t++) {
    s.tick = t;
    assert.equal(squadSightSig(s, 'player'), first,
      'a camped army must never dirty the background');
  }
});

test("an ENEMY column moving changes nothing about the player's signature", () => {
  const s = corridor();
  const theirs = spawnSquad(s, {
    owner: 'enemy', from: 'far', to: 'camp', comp: comp({ militia: 5 }),
  });
  const at0 = squadSightSig(s, 'player');
  s.tick = Math.floor((theirs.spawnTick + theirs.arriveTick) / 2);
  assert.equal(squadSightSig(s, 'player'), at0,
    'the player repaints for their own armies, not the enemy’s');
});

test('squadHexOf writes into a scratch object and allocates nothing', () => {
  // The reason the signature can run per frame at all. A regression here is
  // invisible — it would just quietly allocate on the draw path.
  const s = corridor();
  const sq = march(s);
  s.tick = Math.floor((sq.spawnTick + sq.arriveTick) / 2);
  const out = { q: -99, r: -99 };
  const got = squadHexOf(s, sq, out);
  assert.equal(got, out, 'the scratch is returned, not a fresh object');
  const fresh = squadHexOf(s, sq);
  assert.deepEqual({ q: got.q, r: got.r }, { q: fresh.q, r: fresh.r },
    'and it holds exactly what the allocating form returns');
});
