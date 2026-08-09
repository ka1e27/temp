// THE TERRITORY FLOOD — and the half of it that was missing for the project's
// whole life.
//
// `recomputeInfluence` skipped every site whose owner was not player or enemy,
// so a NEUTRAL site projected nothing at all and the hexes around it were
// painted for whichever faction reached them first. The faction that reached
// first was almost always the player, because the camp carries the biggest
// radius on the map (INFLUENCE_RADIUS.camp = 3). The board therefore read as an
// even split no matter what the region table said:
//
//     region        sites P/E/N     board: player / enemy
//     riverfen      3/5/3             42%      43%
//     nightharrow   13/17/18          46%      42%     <- player ahead
//
// The site table said the player owned 27% of nightharrow. The thing a player
// actually looks at said 46%, in the deepest region of the enemy's homeland.
// Only the site table had ever been asserted — which is this project's signature
// failure (dead boosters, an unclickable UI) wearing another coat.
//
// There was no test file for influence at all before this one; only
// tests/movement.test.js touched `territoryAt`, and only for march speed.
import test from 'node:test';
import assert from 'node:assert/strict';

import { recomputeInfluence, territoryAt, speedMultiplierFor } from '../src/battle/influence.js';
import { generateBattleMap } from '../src/battle/mapgen.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { startBattle } from '../src/battle/sim.js';
import { computeOwners } from '../src/render/hexRenderer.js';
import { PLAYER, ENEMY } from '../src/render/hexGeom.js';
import { REGIONS, REGION_IDS } from '../src/content/regions.data.js';
import { TERRITORY_SPEED } from '../src/content/balance.js';
import { metaFor } from '../tools/simplayer.js';

/**
 * A hand-built board shaped like the real bug: the player's CAMP (radius 3, the
 * widest on the map) with a neutral farm standing inside its reach, and an enemy
 * farm out of range. Without the neutral site projecting, the camp swallows that
 * hex — which is exactly how a 27% site share painted a 46% board.
 */
function line({ neutral = true } = {}) {
  const sites = [
    { id: 'mine', kind: 'camp', owner: 'player', hex: [2, 4], level: 1 },
    { id: 'mid', kind: 'farm', owner: 'neutral', hex: [4, 4], level: 1 },
    { id: 'theirs', kind: 'farm', owner: 'enemy', hex: [10, 4], level: 1 },
  ].filter((s) => neutral || s.owner !== 'neutral');
  return { grid: { cols: 13, rows: 9, blocked: [] }, sites, influence: {} };
}

const at = (s, q, r) => territoryAt(s, { q, r });

// ===========================================================================
// 1. Unowned ground belongs to nobody
// ===========================================================================

test('influence: a neutral site holds its own hex instead of donating it', () => {
  const s = line();
  recomputeInfluence(s);
  assert.equal(at(s, 4, 4), 'neutral', 'the neutral farm is standing on somebody else’s colour');
  assert.equal(at(s, 2, 4), 'player');
  assert.equal(at(s, 10, 4), 'enemy');
});

test('influence: NEGATIVE CONTROL — take the neutral site away and the ground flips', () => {
  // The assertion above is only meaningful if that hex would otherwise have
  // been claimed. Without the neutral farm the same coordinate is unpainted or
  // taken by a faction; with it, it is neutral BECAUSE the site is there.
  const withNeutral = line();
  const without = line({ neutral: false });
  recomputeInfluence(withNeutral);
  recomputeInfluence(without);
  assert.equal(at(withNeutral, 4, 4), 'neutral');
  assert.equal(at(without, 4, 4), 'player',
    'the fixture is wrong: that hex must be inside the camp reach, or the'
    + ' control proves nothing');
});

test('influence: neutral ground is OMITTED, not stored — the save does not grow', () => {
  // `territoryAt` reads an absent key as 'neutral', so a neutral-won hex needs
  // no entry. This is what let the fix ship without touching CONTRACT_VERSION,
  // and it is worth pinning: storing them would bloat a blob written every 5s.
  const s = line();
  recomputeInfluence(s);
  assert.ok(!('4,4' in s.influence), 'a neutral-won hex was written into the map');
  for (const v of Object.values(s.influence)) {
    assert.ok(['player', 'enemy', 'contested'].includes(v),
      `influence stored an unexpected value: ${v}`);
  }
});

test('influence: unowned ground slows BOTH sides, rather than speeding whoever is near', () => {
  const s = line();
  recomputeInfluence(s);
  const hex = { q: 4, r: 4 };
  assert.equal(speedMultiplierFor(s, 'player', hex), TERRITORY_SPEED.neutral);
  assert.equal(speedMultiplierFor(s, 'enemy', hex), TERRITORY_SPEED.neutral);
  // ...and a faction's own ground is still faster, so this did not flatten the
  // mechanic that makes territory worth holding.
  assert.equal(speedMultiplierFor(s, 'player', { q: 2, r: 4 }), TERRITORY_SPEED.friendly);
  assert.equal(speedMultiplierFor(s, 'enemy', { q: 2, r: 4 }), TERRITORY_SPEED.hostile);
});

test('influence: a contested hex is still contested — neutral did not eat the front line', () => {
  // Two equal farms facing each other with nothing between them. The band where
  // they meet must still read 'contested': that is the front line drawing
  // itself, and a neutral tie-break that swallowed it would be a regression.
  const s = {
    grid: { cols: 9, rows: 7, blocked: [] },
    sites: [
      { id: 'a', kind: 'stronghold', owner: 'player', hex: [2, 3], level: 1 },
      { id: 'b', kind: 'stronghold', owner: 'enemy', hex: [6, 3], level: 1 },
    ],
    influence: {},
  };
  recomputeInfluence(s);
  assert.ok(Object.values(s.influence).includes('contested'),
    'two armies meeting produced no contested band at all');
});

// ===========================================================================
// 2. The campaign-shape claim, driven off REGIONS so no region can drift
// ===========================================================================

/** What share of the BOARD each side paints at tick 0 — what a player sees. */
function boardShare(regionIndex, seed = 4242) {
  const meta = metaFor(REGION_IDS.slice(0, regionIndex), 10, seed).meta;
  const battle = startBattle(buildBattleConfig(
    meta, REGIONS[regionIndex].id, [], generateBattleMap, { seed },
  ));
  recomputeInfluence(battle);
  const { cols, rows } = battle.grid;
  const owners = computeOwners(battle.influence, cols, rows);
  let player = 0;
  let enemy = 0;
  for (const o of owners) {
    if (o === PLAYER) player++;
    else if (o === ENEMY) enemy++;
  }
  const total = cols * rows;
  return { player: player / total, enemy: enemy / total };
}

test('influence: the enemy paints more of every region than the player does', { timeout: 300000 }, () => {
  // THE ASSERTION THAT WAS MISSING. Difficulty was measured to four decimal
  // places and the thing on screen was never checked once — so the campaign
  // shipped with the player holding more of the enemy's capital than the enemy.
  // Driven off REGIONS: a twenty-second region cannot dodge it.
  for (let i = 0; i < REGIONS.length; i++) {
    const { player, enemy } = boardShare(i);
    assert.ok(enemy > player,
      `${REGIONS[i].id}: the player paints ${(player * 100).toFixed(0)}% of the board`
      + ` against the enemy's ${(enemy * 100).toFixed(0)}% — you are supposed to be raiding`);
  }
});

test('influence: the player lands with a beachhead, and it never creeps', { timeout: 300000 }, () => {
  // A ceiling on what the map hands you before the first order is given, and a
  // floor so the fix cannot overshoot into "you own nothing and cannot start".
  // The ceiling is deliberately generous against tier 1 — small maps mean one
  // camp is a large share of them — and the CREEP check is the real guard: the
  // endgame may never hand the player a bigger opening share than tier 1 did.
  const shares = REGIONS.map((_, i) => boardShare(i).player);
  for (let i = 0; i < REGIONS.length; i++) {
    assert.ok(shares[i] <= 0.35,
      `${REGIONS[i].id}: the player opens holding ${(shares[i] * 100).toFixed(0)}% of the board`);
    assert.ok(shares[i] > 0.02,
      `${REGIONS[i].id}: the player opens with ${(shares[i] * 100).toFixed(0)}% — no beachhead at all`);
  }
  const opening = Math.max(...shares.filter((_, i) => REGIONS[i].tier === 1));
  for (let i = 0; i < REGIONS.length; i++) {
    assert.ok(shares[i] <= opening + 0.02,
      `${REGIONS[i].id} opens on ${(shares[i] * 100).toFixed(0)}% of the board against tier 1's`
      + ` ${(opening * 100).toFixed(0)}% — the raid is getting easier to start, not harder`);
  }
});
