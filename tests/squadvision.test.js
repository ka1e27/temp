// FIVE FOG CHANGES, ALL FROM THE SAME PASS — split out of tests/vision.test.js
// purely for the 400-line cap, the same way fogleaks/fogrender/fogpanel
// already split the fog suite by concern rather than by file size alone.
//
// 1. A marching or camped squad now grants its owner a small sight radius of
//    its own, answered by `canSee` rather than baked into `state.vision`.
// 2. ...and what it sees is WRITTEN DOWN (`recordSquadSightings`), or the
//    sight creates no memory and the board flickers as the column passes.
// 3. A watchtower hides its OWNER's squads from the other side —
//    counter-intelligence, checked in `perceivedSquads`.
// 4. A failed assault leaves a stale garrison count behind — the one
//    deliberate, narrow relaxation of "a ghost carries nothing that changes".
// 5. A site this faction has NEVER SEEN is not on its board at all
//    (`siteKnown`) — the difference between a ghost and a blank.
//
// Same discipline as the rest of this suite: every claim carries a negative
// control, because a fixture that is silently empty passes a "must hide X"
// assertion for free and proves nothing.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  recomputeVision, canSee, squadHex, perceivedSite, perceivedSquads,
  recordFailedAssault, lastKnownGarrison, siteKnown,
} from '../src/battle/vision.js';
import { VISION_RADIUS, SQUAD_VISION_RADIUS } from '../src/content/balance.js';
import { beliefFor } from '../src/battle/belief.js';
import { startBattle, step } from '../src/battle/sim.js';
import { generateBattleMap } from '../src/battle/mapgen.js';
import { distance } from '../src/core/hex.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { createState } from '../src/core/store.js';
import { markConquered, refreshUnlocks } from '../src/meta/world.js';
import { REGIONS } from '../src/content/regions.data.js';
import { total } from '../src/battle/combat.js';

/** A real battle, on the real path — same helper as tests/vision.test.js. */
function battleFor(id = 'gallowmoor', { quiet = true, gold = 200000 } = {}) {
  const state = createState({ seed: 1, now: 0 });
  const i = REGIONS.findIndex((r) => r.id === id);
  for (const p of REGIONS.slice(0, i)) markConquered(state.meta, p.id, { now: 0, durationMs: 0 });
  refreshUnlocks(state.meta, null);
  const b = startBattle(buildBattleConfig(state.meta, id, [], generateBattleMap, { seed: 5 }));
  b.factions.player.goldCg = gold;
  if (quiet) b.ai.nextThinkTick = 1e9;
  return b;
}

// A grid generously larger than any VISION_RADIUS, with the test site planted
// well clear of every edge — same fixture shape as tests/vision.test.js.
const BIG_GRID = { cols: 41, rows: 41, blocked: [] };
const HEX = [18, 18];

// ---------------------------------------------------------------------------
// A marching or camped squad now grants its OWNER a small sight radius of
// its own — answered by canSee(), never baked into state.vision (see the
// vision.js file header for the cost model this rests on)
// ---------------------------------------------------------------------------

test('vision: a camped squad lights its own hex within a SMALL radius, and no further', () => {
  const FAR = { q: 30, r: 30 }; // clear of the one site's own radius-1 sight
  const s = {
    grid: BIG_GRID,
    sites: [{ id: 'x', kind: 'farm', owner: 'player', hex: HEX }],
    squads: [],
  };
  recomputeVision(s);
  assert.equal(canSee(s, 'player', FAR.q, FAR.r), false,
    'sanity: nothing but a squad could light this hex — this proves nothing');

  // Add the camped squad and re-derive: canSee reads squads live, on every
  // call, so nothing needs to be rebuilt for this to take effect.
  s.squads.push({
    id: 1, owner: 'player', from: null, to: null, spawnTick: 0, arriveTick: 0,
    comp: { militia: 10 }, retreating: false, camped: true, hex: FAR,
  });
  assert.equal(canSee(s, 'player', FAR.q, FAR.r), true,
    'a camped column did not light the ground it is standing on');

  // NEGATIVE CONTROL 1: radius is SMALL — a hex just outside
  // SQUAD_VISION_RADIUS must stay dark, or a column is scouting for free
  // (the watchtower's whole reason to exist).
  const justOutside = { q: FAR.q + SQUAD_VISION_RADIUS + 1, r: FAR.r };
  assert.ok(distance(FAR, justOutside) > SQUAD_VISION_RADIUS, 'fixture arithmetic is wrong, not the code');
  assert.equal(canSee(s, 'player', justOutside.q, justOutside.r), false,
    'a small radius lit ground well beyond it');

  // NEGATIVE CONTROL 2: state.vision itself — the SITE-only sparse map — must
  // stay squad-free. This is the entire cost argument: canSee answers the
  // squad question live, on a miss, rather than this map growing an entry
  // that would then need inventing an event to invalidate.
  assert.equal(s.vision.player[`${FAR.q},${FAR.r}`], undefined,
    'the squad leaked into the site-only map — it must only ever answer through canSee');

  // NEGATIVE CONTROL 3: the OTHER faction gets nothing from a squad that is
  // not theirs.
  assert.equal(canSee(s, 'enemy', FAR.q, FAR.r), false);

  // A marching (not camped) squad works the same way — read off `path`
  // exactly as `squadHexOf` already does for towers.js and the renderer.
  const marching = {
    grid: BIG_GRID,
    sites: [{ id: 'x', kind: 'farm', owner: 'player', hex: HEX }],
    tick: 5,
    squads: [{
      id: 2, owner: 'player', from: null, to: null, spawnTick: 0, arriveTick: 10,
      comp: { militia: 10 }, retreating: false, camped: false, hex: null,
      path: Array.from({ length: 11 }, (_, i) => ({ q: 30 + i, r: 30 })),
    }],
  };
  recomputeVision(marching);
  // At tick 5 of a 10-tick march the column sits at (35,30).
  assert.equal(canSee(marching, 'player', 35, 30), true,
    'a marching column did not light the hex it is currently crossing');
  assert.equal(canSee(marching, 'player', 30, 30), false,
    'a marching column lit ground it has already left — this is not a trail, it is a torch');
});

test('vision: SQUAD_VISION_RADIUS stays small — materially short of the watchtower it must not compete with', () => {
  assert.ok(SQUAD_VISION_RADIUS < VISION_RADIUS.watchtower,
    'a marching column sees as far as a watchtower — the watchtower has nothing left to sell');
});

test('vision: a real battle — a marching column un-ghosts what it currently stands beside', () => {
  const b = battleFor();
  const home = b.sites.find((s) => s.kind === 'camp');
  const castle = b.sites.find((s) => s.kind === 'castle');
  b.commands.push({ t: 'SEND', from: home.id, to: castle.id, fraction: 1 });
  step(b);
  const sq = b.squads.find((s) => s.owner === 'player');
  assert.ok(sq, 'nothing marched — this proves nothing');
  assert.ok(sq.arriveTick - b.tick > 3, 'the march was one hop — too short to say anything about open country');
  step(b); // one real tick along the path, so squadHexOf reads a genuine mid-march position

  const at = squadHex(b, sq);
  assert.ok(at, 'a marching squad must always have a position to read');
  assert.equal(canSee(b, 'player', at.q, at.r), true,
    "a marching column's own current hex must be lit — the mechanic this whole file is about");
});

// ---------------------------------------------------------------------------
// A watchtower hides ITS OWNER'S squads from the other side — counter-
// intelligence, not sight, and it is squads only: a site is unaffected
// ---------------------------------------------------------------------------

test('perceivedSquads: a watchtower covers its owner\'s squads, never a site, and reaches belief.js too', () => {
  // The enemy's OWN farm sits one hex from the tower — close enough that its
  // ordinary radius-1 sight already reaches the tower's hex, so anything
  // hidden there is the tower's doing, not a plain sightline gap.
  const playerTower = { id: 'tower', kind: 'watchtower', hex: [0, 0], owner: 'player', adj: [] };
  const enemyFarm = {
    id: 'ef', kind: 'farm', hex: [0, 1], owner: 'enemy', adj: [],
    garrison: { militia: 4 }, hp: 100, hpMax: 100,
  };
  const hidden = {
    id: 1, owner: 'player', from: null, to: null, spawnTick: 0, arriveTick: 0,
    comp: { militia: 30 }, retreating: false, camped: true, hex: { q: 0, r: 0 },
  };
  const s = {
    grid: BIG_GRID,
    tick: 0, sites: [playerTower, enemyFarm], squads: [hidden], seen: { player: {}, enemy: {} },
  };
  recomputeVision(s);

  assert.equal(canSee(s, 'enemy', 0, 0), true,
    'sanity: the enemy already sees this ground by ordinary means — this proves nothing');
  assert.equal(perceivedSite(s, 'enemy', playerTower).ghost, undefined,
    'a SITE on tower-covered ground must stay exactly as visible as ordinary fog says — '
    + 'counter-intelligence is squads only, never sites (the owner asked about "troops and movements")');
  assert.equal(perceivedSquads(s, 'enemy').some((sq) => sq.id === 1), false,
    'a squad on the SAME visible ground, under its own tower\'s cover, was handed to the other side');

  // It has to reach the AI, or it is a graphical trick rather than a
  // mechanic — belief.js beliefFor calls perceivedSquads for exactly this.
  assert.equal(beliefFor(s, 'enemy').squads.some((sq) => sq.id === 1), false,
    'the enemy commander\'s own belief leaked a covered squad');

  // NEGATIVE CONTROL: move the tower away — the identical squad, on the
  // identical visible ground, is handed over normally. Proves the exclusion
  // above is the TOWER's doing and not some blanket "hide the player" rule.
  playerTower.hex = [35, 0];
  assert.equal(perceivedSquads(s, 'enemy').some((sq) => sq.id === 1), true,
    'a squad with no tower of its own nearby must be visible on ground the other side can see');
  assert.equal(beliefFor(s, 'enemy').squads.some((sq) => sq.id === 1), true);
});

// ---------------------------------------------------------------------------
// A failed assault leaves a memory — the one deliberate, narrow relaxation
// of "a ghost carries nothing that changes"
// ---------------------------------------------------------------------------

test('vision: a failed assault records the garrison it fought, and only a failed one', () => {
  const b = battleFor();
  const home = b.sites.find((s) => s.kind === 'camp');
  // A FARM specifically — `SITES.farm.train` is 0, so nothing reinforces it
  // while the slow probe below is still in the air, and the number this test
  // predicts cannot drift out from under it before the fight happens.
  const target = b.sites.find((s) => s.owner === 'enemy' && s.kind === 'farm' && total(s.garrison) > 2);
  assert.ok(target, 'no defended enemy farm to attack — this proves nothing');
  assert.equal(lastKnownGarrison(b, 'player', target.id), undefined,
    'a memory existed before any assault ever happened');

  // STACK THE DEFENCE rather than shrink the probe. TWO things have to be true
  // at once here — the column must SURVIVE the march (`battle/towers.js` shoots
  // what passes within reach of a wall, and a 2% probe was wiped out before it
  // arrived; the loop below exits when the squad leaves `state.squads`, which
  // "shot to nothing en route" satisfies exactly as well as "arrived and
  // fought") and it must then LOSE. One send fraction cannot be tuned to
  // satisfy both against a generated map: 2% died on the way and 12% won.
  // Fixing the garrison instead makes the loss arithmetic rather than a guess,
  // and a farm trains nothing, so the number cannot drift while the probe is
  // still in the air.
  target.garrison = { ...target.garrison, militia: (target.garrison.militia ?? 0) + 400 };
  const defenders = total(target.garrison);
  b.commands.push({ t: 'SEND', from: home.id, to: target.id, fraction: 0.12 });
  step(b);
  const sq = b.squads.find((s) => s.owner === 'player' && s.to === target.id);
  assert.ok(sq, 'the probe never marched — this proves nothing');
  let fought = null;
  for (let i = 0; i < 2000 && b.squads.some((x) => x.id === sq.id); i++) {
    step(b);
    fought = fought ?? b.events.find((e) => e.attPower !== undefined && e.siteId === target.id);
  }
  // ASSERT THE FIGHT, not the disappearance. This is the whole difference
  // between the two ways a squad can leave the board.
  assert.ok(fought, 'the probe never fought — it died on the way, so this proves nothing');
  assert.equal(fought.win, false, 'the probe was meant to LOSE; it won');

  assert.equal(lastKnownGarrison(b, 'player', target.id), defenders,
    'a failed assault must remember exactly the garrison it fought, not the survivors after it');

  // The ghost's strict contract is unbroken: the count is never smuggled
  // onto the object perceivedSite hands back — it is a deliberately separate,
  // narrower fact a caller asks for on purpose.
  const ghost = perceivedSite(b, 'player', target);
  assert.equal(ghost.garrison, undefined, 'the stale count leaked onto the ghost object itself');

  // NEGATIVE CONTROL 1: a different enemy site the player never attacked has
  // no memory — this is not populated for every enemy site by construction.
  const untouched = b.sites.find((s) => s.owner === 'enemy' && s.id !== target.id);
  if (untouched) assert.equal(lastKnownGarrison(b, 'player', untouched.id), undefined);

  // NEGATIVE CONTROL 2: the DEFENDER's own memory of the site it already
  // owns is untouched — this is the ATTACKER's stale intelligence, not a
  // general "garrison changed" log.
  assert.equal(lastKnownGarrison(b, 'enemy', target.id), undefined);
});

test('vision: recordFailedAssault is the only writer — a WIN records nothing', () => {
  const b = battleFor();
  const home = b.sites.find((s) => s.kind === 'camp');
  // Overwhelm a lightly-held site so the assault WINS.
  const target = b.sites.find((s) => s.owner === 'enemy' && total(s.garrison) < 20);
  assert.ok(target, 'no lightly-held enemy site — this proves nothing');
  b.commands.push({ t: 'SEND', from: home.id, to: target.id, fraction: 1 });
  step(b);
  const sq = b.squads.find((s) => s.owner === 'player' && s.to === target.id);
  assert.ok(sq, 'nothing marched — this proves nothing');
  for (let i = 0; i < 2000 && !b.sites.some((x) => x.id === target.id && x.owner === 'player'); i++) {
    step(b);
  }
  assert.equal(b.sites.find((x) => x.id === target.id)?.owner, 'player',
    'the assault never actually won — pick a weaker target or extend the loop');
  assert.equal(lastKnownGarrison(b, 'player', target.id), undefined,
    'a WON assault left a stale-garrison memory behind — recordFailedAssault has exactly one caller and this is not it');
});

// ---------------------------------------------------------------------------
// A site this faction has never seen is not on its board at all — and sight
// from a marching column is what turns that around
// ---------------------------------------------------------------------------

test('vision: a marching column writes down what it sees, so sight becomes memory', () => {
  // THE DEFECT THIS PINS shipped one release earlier and looked complete,
  // because the SCREEN was right: `canSee` answers squad sight live, so the
  // player watched a column light an enemy farm — and `state.seen`, which is
  // built by `recomputeVision` out of the SITE-only map at four ownership-
  // shaped events, recorded none of it. Measured on this exact fixture before
  // the fix: 56 tick-site pairs visible from the march, ZERO remembered. The
  // instant the column moved on, the board went back to saying nobody had ever
  // looked.
  const b = battleFor();
  const home = b.sites.find((s) => s.kind === 'camp');
  const target = b.sites.find((s) => s.owner === 'enemy');
  assert.ok(home && target, 'no camp or no enemy site — this proves nothing');

  b.commands.push({ t: 'SEND', from: home.id, to: target.id, fraction: 0.9 });
  step(b);
  const sq = b.squads.find((s) => s.owner === 'player');
  assert.ok(sq, 'nothing marched — this proves nothing');

  const before = Object.keys(b.seen.player).length;
  let sightings = 0;
  let remembered = 0;
  for (let i = 0; i < 2000 && b.squads.some((x) => x.id === sq.id); i++) {
    step(b);
    for (const site of b.sites) {
      if (site.owner !== 'enemy') continue;
      if (!canSee(b, 'player', site.hex[0], site.hex[1])) continue;
      sightings++;
      if (b.seen.player[site.id] !== undefined) remembered++;
    }
  }
  assert.ok(sightings > 0,
    'the column never saw an enemy site on the way — this proves nothing');
  assert.equal(remembered, sightings,
    'a column saw an enemy site and did not write it down — sight without memory flickers');
  assert.ok(Object.keys(b.seen.player).length > before,
    'the march ended knowing exactly what it knew at the start');
});

test('siteKnown: never looked is not the same as looked once and lost sight', () => {
  const b = battleFor();
  const dark = b.sites.find((s) => s.owner === 'enemy'
    && !canSee(b, 'player', s.hex[0], s.hex[1])
    && b.seen.player[s.id] === undefined);
  assert.ok(dark, 'no never-seen enemy site — this proves nothing');

  assert.equal(siteKnown(b, 'player', dark), false,
    'a building nobody has ever looked at is on the board');
  // ...and it IS still a ghost to `perceivedSite`, which is the whole reason
  // these are two functions. battle/belief.js hands that ghost to the enemy
  // commander and to the harness bot, whose planners are pure whole-map
  // geometry — fogging site EXISTENCE from THEM is a different feature with a
  // balance pass attached, so `siteKnown` answers only the rendering question.
  assert.equal(perceivedSite(b, 'player', dark).ghost, true,
    'the resolver the AI reads must still describe this site');

  // Look once and stop looking: known forever after, as a ghost.
  b.seen.player[dark.id] = 'enemy';
  assert.equal(siteKnown(b, 'player', dark), true,
    'a building seen once and since lost to fog fell off the board');
  assert.equal(perceivedSite(b, 'player', dark).ghost, true,
    'being remembered is not being seen');

  // NEGATIVE CONTROL: your own ground is never in question, and neither is
  // ground you are currently standing next to.
  const mine = b.sites.find((s) => s.owner === 'player');
  assert.equal(siteKnown(b, 'player', mine), true);
  assert.equal(siteKnown(b, 'enemy', mine), false,
    'the player\'s own beachhead was handed to the enemy for free');
});

test('siteKnown: NOTHING is common knowledge — an unclaimed farm hides too', () => {
  // THE RULE USED TO EXEMPT UNCLAIMED GROUND and this test used to pin that
  // exemption, so it is worth saying what changed. The argument for it was
  // legibility: the opening is a race for neutral ground and COACH.drag pointed
  // at "the grey farm". The argument against is that "there is a building over
  // there" is the fact being hidden, and who happens to hold it does not make it
  // less of a disclosure — a neutral farm is a place worth marching to, which is
  // exactly why knowing about it for free was worth something. The tutorial line
  // now teaches the GROUND, and needs nothing on the board to point at.
  const b = battleFor('riverfen');
  const neutrals = b.sites.filter((s) => s.owner === 'neutral');
  const enemies = b.sites.filter((s) => s.owner === 'enemy');
  assert.ok(neutrals.length > 0 && enemies.length > 0, 'fixture has no both — proves nothing');

  const unlit = (s2) => !canSee(b, 'player', s2.hex[0], s2.hex[1]);
  const darkN = neutrals.filter(unlit);
  const darkE = enemies.filter(unlit);
  assert.ok(darkN.length > 0 && darkE.length > 0,
    'every site is already lit on this fixture — proves nothing');
  for (const s2 of darkN.concat(darkE)) {
    assert.equal(siteKnown(b, 'player', s2), false,
      `${s2.owner} ${s2.kind} ${s2.id} is on the board without anyone having looked`);
  }

  // NEGATIVE CONTROL: the rule is about LOOKING, not ownership, so what you hold
  // and what you can see are both still known. Without this the assertion above
  // would pass just as happily if `siteKnown` returned false for everything,
  // which is a blackout rather than fog.
  const lit = b.sites.filter((s2) => !unlit(s2) || s2.owner === 'player');
  assert.ok(lit.length > 0, 'the player can see nothing at all — that is not fog');
  for (const s2 of lit) assert.equal(siteKnown(b, 'player', s2), true);

  // ...and it holds BOTH WAYS, so this cannot be read as a player-side handicap.
  for (const s2 of darkN) assert.equal(siteKnown(b, 'enemy', s2), false);
});

test('vision: a captured neutral does not blink out — seen keeps the past tense', () => {
  // WHY A LAST-KNOWN OWNER IS RECORDED IN `seen` RATHER THAN DERIVED FROM THE
  // SITE. If "who owns it RIGHT NOW" were the test, then the moment the enemy
  // took a farm the player had scouted, the building would vanish off the board
  // — a flicker, which is the exact failure `state.seen` exists to prevent for
  // owner colouring. The farm has to be SEEN first now, which is the only line
  // of this test that changed when unclaimed ground lost its exemption.
  const b = battleFor('riverfen');
  const far = b.sites.find((s) => s.owner === 'neutral'
    && !canSee(b, 'player', s.hex[0], s.hex[1]));
  assert.ok(far, 'no out-of-sight neutral site — this proves nothing');
  b.seen.player[far.id] = 'neutral';   // the player marched past it once
  assert.equal(siteKnown(b, 'player', far), true, 'sanity: it starts on the board');

  far.owner = 'enemy';   // the enemy takes it while the player is looking elsewhere
  assert.equal(siteKnown(b, 'player', far), true,
    'a farm the player knew about vanished the moment somebody else took it');
  assert.equal(perceivedSite(b, 'player', far).owner, 'neutral',
    'the ghost must report what was last TRUE, not what is true now');
});
