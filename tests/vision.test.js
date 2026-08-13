// FOG OF WAR — the sight half (battle/vision.js) and the memory half it feeds.
//
// Zero coverage existed before this file, apart from the one build-completes-
// and-suddenly-sees assertion construct.test.js already carries. This project's
// signature failure is a test that only checks the true branch, or a fixture
// that quietly encodes the bug (dead boosters, an unclickable UI, both shipped
// behind a green suite) — so every claim below is paired with a control that
// would fail if the rule it is pinning were simply deleted.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  recomputeVision, canSee, squadHex, perceivedSite, perceivedSquads,
} from '../src/battle/vision.js';
import { VISION_RADIUS } from '../src/content/balance.js';
import { startBattle, step } from '../src/battle/sim.js';
import { buildBlocker } from '../src/battle/commands.js';
import { generateBattleMap, gridHexes } from '../src/battle/mapgen.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { createState } from '../src/core/store.js';
import { markConquered, refreshUnlocks } from '../src/meta/world.js';
import { REGIONS } from '../src/content/regions.data.js';
import { total } from '../src/battle/combat.js';

/** A real battle, on the real path — copied from tests/construct.test.js:
 *  createState -> markConquered the earlier regions -> refreshUnlocks ->
 *  buildBattleConfig -> startBattle. The AI is held off by default because
 *  most of what follows is about SIGHT, not about surviving contact. */
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

const legalHexes = (b, faction = 'player') => gridHexes(b.grid.cols, b.grid.rows)
  .filter((h) => !buildBlocker(b, faction, h));

// A grid generously larger than any VISION_RADIUS, with the test site planted
// well clear of every edge — these fixtures are about the RULE, not about
// `inGrid` clipping, which mapgen.test.js already owns.
const BIG_GRID = { cols: 41, rows: 41, blocked: [] };
const HEX = [18, 18];

// ---------------------------------------------------------------------------
// Buildings see; a squad now ALSO sees, but through canSee, never through
// state.vision — see the file header of battle/vision.js for the cost model.
// ---------------------------------------------------------------------------

test('vision: state.vision (the SITE map) still never counts a marching army', () => {
  // THIS TEST USED TO BE TITLED "grants its owner no sight at all" — that
  // headline claim is gone (see tests/squadvision.test.js: a squad now
  // grants a small radius of its own). What survives, and is still worth
  // pinning on its own, is narrower and just as load-bearing: the SITE-only
  // sparse map `recomputeVision` builds must stay exactly what it always
  // was, rebuilt only on ownership/build/timer events (sim.js startBattle /
  // siegePhase's flip branch / timersPhase, construct.js cmdBuild) and never
  // per tick. A squad in flight must not be baked into it, however far it
  // marches — that is the entire cost argument this feature rests on.
  const b = battleFor();
  const before = JSON.parse(JSON.stringify(b.vision));
  const home = b.sites.find((s) => s.kind === 'camp');
  const castle = b.sites.find((s) => s.kind === 'castle');
  b.commands.push({ t: 'SEND', from: home.id, to: castle.id, fraction: 1 });
  step(b);
  const sq = b.squads.find((s) => s.owner === 'player');
  assert.ok(sq, 'nothing marched — this proves nothing');
  const arrive = sq.arriveTick; // a fixed target tick, never a countdown
  assert.ok(arrive - b.tick > 3, 'the march was one hop — too short to say anything about open country');
  while (b.tick < arrive - 1) step(b);
  assert.ok(b.squads.includes(sq), 'it already arrived — narrow the window');
  assert.deepEqual(b.vision, before,
    'the sight map changed with no site changing hands, being built, or opening — '
    + 'a marching army must not be a source of vision');

  // ...AND THE STRONGER FORM, which the assertion above does not make on its
  // own. All that one proves is that nothing REBUILT the map during the march,
  // which is a claim about the call schedule rather than about squads. Force a
  // rebuild while the column is still in the field: the map must come back
  // identical.
  //
  // This is not hypothetical tidiness. Mutation-tested: adding squads as a
  // vision source INSIDE `recomputeVision`, and leaving all four call sites
  // alone, inverts the headline rule of this whole file and leaves it green
  // without these two lines — the leak would then surface at the next
  // unrelated capture, mid-march, which is precisely the bug nobody would
  // reproduce from a report.
  recomputeVision(b);
  assert.deepEqual(b.vision, before,
    'a rebuild taken mid-march counted the marching army — buildings see, squads do not');

  // NEGATIVE CONTROL, same battle: raising an actual building — not a body of
  // moving troops — DOES change the sight map, so "nothing ever changes vision"
  // is not what the assertion above actually proved.
  const at = legalHexes(b).find((h) => !canSee(b, 'player', h.q, h.r));
  assert.ok(at, 'nowhere legal to build is currently dark — this proves nothing');
  b.commands.push({ t: 'BUILD', kind: 'farm', hex: [at.q, at.r] });
  step(b);
  const site = b.sites.find((s) => s.hex[0] === at.q && s.hex[1] === at.r);
  const buildTotal = site.buildTicksLeft; // read once — it counts down
  for (let i = 0; i < buildTotal + 2; i++) step(b);
  assert.equal(canSee(b, 'player', at.q, at.r), true,
    'a finished farm did not light its own hex — the control above proves nothing');
});

// ---------------------------------------------------------------------------
// Who gets to see, and how far
// ---------------------------------------------------------------------------

test('vision: a neutral site grants nobody sight — there is no neutral CLAIM', () => {
  // Unlike the territory flood (influence.js), where a neutral site projects
  // its OWN colour, vision has nothing to project on an unclaimed site's
  // behalf: no watcher means no watching, for either faction.
  const s = { grid: BIG_GRID, sites: [{ id: 'n', kind: 'farm', owner: 'neutral', hex: HEX }] };
  recomputeVision(s);
  assert.equal(canSee(s, 'player', HEX[0], HEX[1]), false);
  assert.equal(canSee(s, 'enemy', HEX[0], HEX[1]), false);
  assert.deepEqual(s.vision.player, {}, 'a neutral farm painted a partial claim');

  // BUT ITS EXISTENCE IS COMMON KNOWLEDGE, and that is a different fact from
  // sight — which is exactly why they are two maps. `vision` is "what ground
  // can I watch"; `seen` is "what do I know is out there". An unclaimed farm
  // is watched by nobody and hidden by nobody: no garrison is holding it, no
  // fog is covering it, and the race for it is the whole shape of a battle's
  // opening. Without this, `siteKnown` measured the campaign OPENER at three
  // sites on the player's board and zero neutral farms — while the first line
  // of the tutorial says to drag from the camp to the grey farm.
  assert.equal(s.seen.player.n, 'neutral', 'unclaimed ground must be common knowledge');
  assert.equal(s.seen.enemy.n, 'neutral', '...to both sides, or it is a player-side freebie');

  // NEGATIVE CONTROL 1: the identical site and hex, OWNED, grants sight — so
  // the darkness above is the neutral rule, not a fixture dark regardless.
  s.sites[0].owner = 'player';
  recomputeVision(s);
  assert.equal(canSee(s, 'player', HEX[0], HEX[1]), true);
  assert.equal(s.seen.player.n, 'player');

  // NEGATIVE CONTROL 2: an ENEMY site nobody is watching is remembered by
  // nobody. This is the half that makes the clause above narrow rather than
  // "record everything" — enemy buildings are the thing being hidden.
  const t = { grid: BIG_GRID, sites: [{ id: 'e', kind: 'farm', owner: 'enemy', hex: HEX }] };
  recomputeVision(t);
  assert.equal(t.seen.player.e, undefined,
    'an unwatched enemy building was handed to the player for free');
});

test('vision: a watchtower sees materially further than an ordinary building', () => {
  const s = { grid: BIG_GRID, sites: [{ id: 'x', kind: 'farm', owner: 'player', hex: HEX }] };
  recomputeVision(s);
  const farmCount = Object.keys(s.vision.player).length;

  // NEGATIVE CONTROL folded into the same fixture: only `kind` changes, at the
  // exact same hex, for the exact same owner.
  s.sites[0].kind = 'watchtower';
  recomputeVision(s);
  const towerCount = Object.keys(s.vision.player).length;

  assert.ok(VISION_RADIUS.watchtower > VISION_RADIUS.farm,
    'the balance table no longer gives the tower an edge over a farm');
  assert.ok(towerCount > farmCount * 3,
    `tower sees ${towerCount} hexes against a farm's ${farmCount} at the same hex — not "materially further"`);
});

// ---------------------------------------------------------------------------
// state.vision is REBUILT every call; state.seen only ever gains
// ---------------------------------------------------------------------------

test('vision: seen keeps the STALE owner once a site drops out of sight', () => {
  const s = { grid: BIG_GRID, sites: [{ id: 'x', kind: 'farm', owner: 'player', hex: HEX }] };
  recomputeVision(s);
  assert.equal(canSee(s, 'player', HEX[0], HEX[1]), true);
  assert.equal(s.seen.player.x, 'player');

  // The site changes hands with nobody near enough to watch it happen — the
  // same shape as a capture on the far side of the map from anything you hold.
  s.sites[0].owner = 'enemy';
  recomputeVision(s);
  assert.equal(canSee(s, 'player', HEX[0], HEX[1]), false, 'vision was not rebuilt off the new owner');
  assert.equal(s.seen.player.x, 'player',
    'LAST-KNOWN owner must survive fog — this field exists so the map does not flicker');

  // NEGATIVE CONTROL: `seen` is not simply frozen forever — the faction that
  // CAN currently see the hex (the new owner, standing on their own ground)
  // gets the truth, same tick.
  assert.equal(canSee(s, 'enemy', HEX[0], HEX[1]), true);
  assert.equal(s.seen.enemy.x, 'enemy');
});

// ---------------------------------------------------------------------------
// perceivedSite: common knowledge, a stale owner, and nothing that CHANGES
// ---------------------------------------------------------------------------

test('perceivedSite: a ghost carries only common knowledge plus a last-known owner', () => {
  const real = {
    id: 'x', kind: 'stronghold', hex: [5, 5], owner: 'enemy', adj: ['a', 'b'],
    garrison: { militia: 40 }, hp: 250, level: 3, trainType: 'spearmen',
    siege: { owner: 'player', comp: { militia: 5 } }, upgradeTicksLeft: 12,
  };
  const s = { sites: [real], seen: { player: { x: 'enemy' }, enemy: {} } }; // unseen: no state.vision at all
  const ghost = perceivedSite(s, 'player', real);

  assert.equal(ghost.ghost, true);
  assert.deepEqual(Object.keys(ghost).sort(), ['adj', 'ghost', 'hex', 'id', 'kind', 'owner']);
  assert.equal(ghost.owner, 'enemy', 'the last-known owner, read off state.seen');
  for (const key of ['garrison', 'hp', 'level', 'trainType', 'siege', 'upgradeTicksLeft']) {
    assert.ok(!(key in ghost), `a ghost carried "${key}" — fog is leaking the one number that matters`);
  }

  // NEGATIVE CONTROL: owning the site returns the REAL object, every field
  // intact — so the stripping above is fog, not a resolver that always copies.
  const owned = perceivedSite(s, 'enemy', real);
  assert.equal(owned, real);
  assert.equal(owned.hp, 250);
});

// ---------------------------------------------------------------------------
// perceivedSquads: your own always, theirs only on ground you can see
// ---------------------------------------------------------------------------

test('perceivedSquads: no ghost is ever left behind for a squad outside vision', () => {
  const sites = [
    { id: 'a', hex: [0, 0] }, { id: 'b', hex: [10, 10] },
    { id: 'c', hex: [0, 0] }, { id: 'd', hex: [4, 4] },
    { id: 'e', hex: [0, 0] }, { id: 'f', hex: [20, 20] },
  ];
  // A squad carries the PATH it walks, so these fixtures state the route rather
  // than two endpoints — the position is read off the path, not lerped between
  // sites, which is what makes a column round a mountain fog where it actually
  // is. `line` is only a straight route written out longhand.
  const line = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => ({
    q: Math.round(a[0] + (b[0] - a[0]) * (i / n)),
    r: Math.round(a[1] + (b[1] - a[1]) * (i / n)),
  }));
  const mine = {
    id: 1, owner: 'player', from: 'a', to: 'b', spawnTick: 0, arriveTick: 10,
    path: line([0, 0], [10, 10], 10), camped: false, hex: null,
  };
  // marching c -> d; at tick 5 (halfway) it sits at the midpoint, (2,2).
  const seen = {
    id: 2, owner: 'enemy', from: 'c', to: 'd', spawnTick: 0, arriveTick: 10,
    path: line([0, 0], [4, 4], 10), camped: false, hex: null,
  };
  // marching e -> f; its midpoint (10,10) is not lit by anything.
  const hidden = {
    id: 3, owner: 'enemy', from: 'e', to: 'f', spawnTick: 0, arriveTick: 10,
    path: line([0, 0], [20, 20], 10), camped: false, hex: null,
  };
  const s = {
    tick: 5, sites, squads: [mine, seen, hidden], vision: { player: { '2,2': 1 }, enemy: {} },
  };
  const out = perceivedSquads(s, 'player');

  assert.ok(out.includes(mine), 'your own squad must always be known, wherever it is');
  assert.ok(out.includes(seen), 'an enemy squad standing on ground you can see must be known');
  assert.equal(out.some((sq) => sq.id === hidden.id), false,
    'an enemy squad off in the dark leaked through as a ghost');
  assert.equal(out.length, 2, 'exactly the two that should be visible — no ghost substituted for the third');
});

// ---------------------------------------------------------------------------
// squadHex: the renderer's progress fraction, derived rather than stored
// ---------------------------------------------------------------------------

test('squadHex: origin at spawn, destination at arrival, monotonic between', () => {
  const from = { id: 'a', hex: [0, 0] };
  const to = { id: 'b', hex: [10, 0] };
  const sq = {
    from: 'a', to: 'b', spawnTick: 100, arriveTick: 110, camped: false, hex: null,
    path: Array.from({ length: 11 }, (_, i) => ({ q: i, r: 0 })),
  };
  const s = { sites: [from, to], tick: 100 };
  assert.deepEqual(squadHex(s, sq), { q: 0, r: 0 });
  s.tick = 110;
  assert.deepEqual(squadHex(s, sq), { q: 10, r: 0 });

  let lastQ = -Infinity;
  for (let t = 100; t <= 110; t++) {
    s.tick = t;
    const h = squadHex(s, sq);
    assert.ok(h.q >= lastQ, `q went backward at tick ${t} — the march is not monotonic`);
    lastQ = h.q;
  }
});

test('an army whose destination is RAZED loses nobody', () => {
  // Not a hand-built case: this is exactly how battle/sim.js `razedByCapture`
  // strikes a site from state.sites mid-flight.
  //
  // THE OLD ASSERTION HERE WAS `squadHex -> null`, because position was
  // resolved from the two endpoint sites and one of them no longer existed.
  // That was a symptom dressed as a property, and it stopped being true the
  // moment a squad carried its own route — it now always knows where it is.
  //
  // What is worth asserting is the thing the razing path was BUILT to protect:
  // no bodies are lost. Written as a headcount rather than as "the squad turns
  // around", because two mechanisms can now deliver it — the reversal that
  // `razedByCapture` performs, and arrivals.js camping an army whose
  // destination is gone — and the test should not care which one ran.
  const b = battleFor();
  const bodies = () => b.sites.filter((x) => x.owner === 'player')
    .reduce((n, x) => n + total(x.garrison), 0)
    + b.squads.filter((x) => x.owner === 'player').reduce((n, x) => n + total(x.comp), 0);

  const at = legalHexes(b)[0];
  b.commands.push({ t: 'BUILD', kind: 'trainingGround', hex: [at.q, at.r] });
  step(b);
  const site = b.sites.find((x) => x.hex[0] === at.q && x.hex[1] === at.r);

  const from = b.sites.find((x) => x.owner === 'player' && x.id !== site.id && total(x.garrison) > 5);
  b.commands.push({ t: 'SEND', from: from.id, to: site.id, fraction: 0.5 });
  step(b);
  const sq = b.squads.find((x) => x.to === site.id);
  assert.ok(sq, 'nothing marched at the new site — this proves nothing');
  assert.ok(squadHex(b, sq), 'a marching army always has a position to read');
  const before = bodies();

  site.siege = { owner: 'enemy', comp: { militia: 20 } };
  step(b); // 1 HP scaffolding under siege is razed, not captured, the very next tick
  assert.equal(b.sites.some((x) => x.id === site.id), false,
    'the site must be gone for this to prove anything');

  for (let i = 0; i < 400 && b.squads.some((x) => x.id === sq.id); i++) step(b);
  assert.equal(bodies(), before,
    'the destination was struck off the board and the army went with it');
});

test('an army sent to open ground arrives, holds it, and can be moved on', () => {
  // The verb the whole path rewrite exists for: ground is a destination now,
  // not only buildings.
  const b = battleFor();
  const from = b.sites.find((x) => x.owner === 'player' && total(x.garrison) > 5);
  // Somewhere empty and reachable: a hex on the path to another site, minus
  // the endpoints, is open ground by construction.
  const spot = legalHexes(b).find((h) => !b.sites.some((x) => x.hex[0] === h.q && x.hex[1] === h.r));
  assert.ok(spot, 'no open hex on this map — the fixture is wrong, not the code');

  b.commands.push({ t: 'SEND', from: from.id, toHex: [spot.q, spot.r], fraction: 0.5 });
  step(b);
  const sq = b.squads.find((x) => x.owner === 'player' && x.to === null);
  assert.ok(sq, 'a send to bare ground was refused');
  const sent = total(sq.comp);

  for (let i = 0; i < 600 && !sq.camped; i++) step(b);
  assert.equal(sq.camped, true, 'the army never made camp');
  assert.deepEqual(squadHex(b, sq), { q: spot.q, r: spot.r },
    'a camped army stands where it was sent');
  assert.equal(total(sq.comp), sent, 'camping is not a fight and costs nobody');

  // ...and it is still an army: it can be ordered on to a real site.
  const target = b.sites.find((x) => x.owner !== 'player');
  b.commands.push({ t: 'MOVE_SQUAD', squadId: sq.id, to: target.id });
  step(b);
  assert.equal(sq.camped, false, 'a camped army must be re-taskable without a building');
  assert.equal(sq.to, target.id);
  assert.ok(sq.arriveTick > b.tick, 'and it has a real march ahead of it');
});

// ---------------------------------------------------------------------------
// Plain JSON, sorted keys — what lets tests/sim.test.js diff a whole run by
// JSON.stringify
// ---------------------------------------------------------------------------

test('vision: state.vision and state.seen are sorted plain JSON, not a Set or Map in disguise', () => {
  const b = battleFor();
  const clone = JSON.parse(JSON.stringify(b));
  assert.deepEqual(clone.vision, b.vision, 'vision did not survive a JSON round trip unchanged');
  assert.deepEqual(clone.seen, b.seen, 'seen did not survive a JSON round trip unchanged');

  for (const faction of ['player', 'enemy']) {
    const visionKeys = Object.keys(b.vision[faction]);
    assert.ok(visionKeys.length > 0, `${faction}: no vision at all — nothing to check the order of`);
    assert.deepEqual(visionKeys, [...visionKeys].sort(), `${faction}'s vision keys are not sorted`);
    const seenKeys = Object.keys(b.seen[faction]);
    assert.deepEqual(seenKeys, [...seenKeys].sort(), `${faction}'s seen keys are not sorted`);
  }
});
