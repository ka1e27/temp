// Phase 12 (PLAN-PHASE12): archipelago worlds (byte-identical land worlds, islands, fords, harbours, lanes), the rotation, the state,
// coastal raids that land, the card's sea lines and the content (Boons, Relics, the Shipwreck). The sim side is in phase12.battle.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateWorld } from '../world/generate.js';
import { archipelagoFor, isOpenSea, touchesOpenSea, quayTile } from '../world/archipelago.js';
import { rivalsFor, sanitizeRivals, rivalsInWorld, seaLines, fordsOnFrontier } from '../meta/rivals.js';
import { worldOptsFor } from '../meta/edicts.js';
import { createGame } from '../meta/state.js';
import { migrate } from '../meta/save.js';
import { difficulty } from '../meta/progression.js';
import { borderingRivals } from '../meta/frontier.js';
import { buildDefenseArena, canBuildDefenseArena } from '../battle/defenseArena.js';
import { buildArena } from '../battle/arena.js';
import { playerBattleStats, enemyBattleStats } from '../meta/progression.js';
import { findPath, buildTileIndex, hexKey, hexDistance } from '../battle/geom.js';
import { TIDE } from '../config/sea.js';
import { boonRelevant } from '../meta/boons.js';
import { BOON_LIST } from '../config/boons.js';
import { placeRelics } from '../meta/relics.js';
import { acceptEvent, tickEvents, declineEvent } from '../meta/events.js';
import { ensureWorldEvents } from '../meta/eventsState.js';
import { SEA_FACTION, FORD, ARCHIPELAGO, LANE } from '../config/sea.js';
import { neighborIndices } from '../world/terrain.js';

const digest = (w) => createHash('sha1').update(JSON.stringify(w)).digest('hex').slice(0, 16);
const archWorld = (seed, rivals = [2, SEA_FACTION, 4]) => generateWorld(seed, { dynasty: 3, archipelago: true, rivals });

test('land worlds are byte-identical to Phase 11 (pinned digests, rotated line-ups included)', () => {
  // digests taken with the HEAD (Phase 11) generator: seed, dynasty, the line-up rivalsFor gives
  const pinned = { '1,3': '0821bd60a95be002', '2,3': '9b5d01fb578da21f', '5,4': 'd36c27ebc3984f8f', '9,3': '649ce56e9d1d580f',
    '11,2': '217d5cdb2f8d5f40', '4,5': '6e7fe0b4781b7159', '7,3': 'e8ea7fd747df748b' };
  for (const [k, want] of Object.entries(pinned)) {
    const [seed, dynasty] = k.split(',').map(Number);
    const rivals = rivalsFor(seed, dynasty);
    assert.ok(!rivals.includes(SEA_FACTION), 'no Sea Kings on land');
    const w = generateWorld(seed, { dynasty, rivals });
    assert.equal(digest(w), want, `seed ${seed} D${dynasty}`);
    assert.equal(digest(generateWorld(seed, { dynasty, rivals, archipelago: false })), want);
    assert.equal('archipelago' in w, false);
  }
});

test('archipelagoFor: never before dynasty 3, about one founding in three after, deterministic', () => {
  let n = 0;
  for (let seed = 1; seed <= 300; seed++) {
    assert.equal(archipelagoFor(seed, 1), false);
    assert.equal(archipelagoFor(seed, 2), false);
    if (archipelagoFor(seed, 3)) n += 1;
    assert.equal(archipelagoFor(seed, 4), archipelagoFor(seed, 4));
  }
  assert.ok(n > 300 * 0.25 && n < 300 * 0.42, `${n} of 300`);
  for (let seed = 1; seed <= 40; seed++) {
    const r = rivalsFor(seed, 3, { archipelago: true });
    assert.equal(r.filter((f) => f === SEA_FACTION).length, 1, r.join());
    assert.equal(new Set(r).size, 3);
    assert.deepEqual(sanitizeRivals(r), r);
    for (const d of [3, 5]) assert.ok(!rivalsFor(seed, d).includes(SEA_FACTION));
  }
});

test('archipelago worlds: 3-5 islands, the start island largest, fords on the straits, harbours, lanes', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const w = archWorld(seed);
    const a = w.archipelago;
    assert.ok(a, `seed ${seed} split`);
    const sizes = a.islands.map((x) => x.length);
    assert.ok(sizes.length >= 2 && sizes.length <= ARCHIPELAGO.islands[1], sizes.join('/'));
    assert.ok(sizes.every((s) => s >= ARCHIPELAGO.minIslandRegions));
    const start = w.regions[w.startRegion].island;
    assert.ok(sizes.every((s, j) => j === start || s < sizes[start]), `start island largest: ${sizes} (${start})`);
    for (const island of a.islands) { // contiguous on the region graph
      const set = new Set(island);
      const seen = new Set([island[0]]);
      const q = [island[0]];
      for (let h = 0; h < q.length; h++) for (const n of w.regions[q[h]].neighbors) if (set.has(n) && !seen.has(n)) { seen.add(n); q.push(n); }
      assert.equal(seen.size, island.length);
    }
    const fords = w.tiles.filter((t) => t.ford);
    assert.equal(fords.length, a.fords);
    for (const t of fords) {
      assert.ok(!t.land && t.passable && t.terrain === 'ford' && t.cost === FORD.baseCost * FORD.marchMult && t.region >= 0 && t.settlement === -1);
      assert.ok(neighborIndices(t.i, w.cols, w.rows).some(({ index }) => w.tiles[index].region >= 0
        && w.regions[w.tiles[index].region].island !== w.regions[t.region].island), 'a ford lies on a strait');
    }
    a.islands.forEach((island, j) => {
      const ports = a.harbours.filter((id) => w.regions[w.settlements[id].region].island === j);
      assert.ok(ports.length >= 1 && ports.length <= 2, `island ${j}: ${ports.length} harbours`);
      for (const id of ports) assert.ok(w.settlements[id].harbour && touchesOpenSea(w.tiles, w.settlements[id].tile, w.cols, w.rows));
    });
    for (const l of a.seaLanes) {
      assert.notEqual(w.regions[w.settlements[l.a].region].island, w.regions[w.settlements[l.b].region].island);
      assert.ok(l.tiles.length <= LANE.worldMaxTiles && l.tiles.every((i) => isOpenSea(w.tiles[i])));
    }
    assert.ok(a.seaLanes.length >= 1, `seed ${seed} has lanes`);
    for (const r of w.regions) {
      const q = quayTile(w, r.id);
      if (q != null) assert.ok(!w.tiles[q].ford && w.tiles[q].region === r.id && touchesOpenSea(w.tiles, q, w.cols, w.rows));
    }
    assert.deepEqual(rivalsInWorld(w).includes(SEA_FACTION), true);
    assert.equal(w.factions.length, 7);
    assert.equal(digest(archWorld(seed)), digest(w), 'deterministic');
  }
});

test('state: archipelago in createGame, the save and worldOptsFor', () => {
  const w = generateWorld(3);
  const s = createGame(3, w, 0);
  assert.equal(s.archipelago, false);
  assert.equal(worldOptsFor(s).archipelago, undefined);
  s.archipelago = true;
  s.rivals = [2, SEA_FACTION, 4];
  s.dynasty = { level: 3, stars: 0 };
  const clean = migrate(JSON.parse(JSON.stringify(s)));
  assert.equal(clean.archipelago, true);
  assert.deepEqual(clean.rivals, [2, SEA_FACTION, 4]);
  assert.deepEqual(worldOptsFor(clean), { dynasty: 3, rivals: [2, SEA_FACTION, 4], archipelago: true });
  assert.equal(migrate({ ...JSON.parse(JSON.stringify(s)), archipelago: 'yes' }).archipelago, false);
});

/** An archipelago D3 state where the player holds every region except the Sea Kings'. */
function seaState(seed) {
  const w = archWorld(seed);
  const s = createGame(seed, w, 0);
  s.dynasty = { level: 3, stars: 6 };
  s.archipelago = true;
  s.rivals = [2, SEA_FACTION, 4];
  s.owner = w.regions.map((r) => (r.faction === SEA_FACTION ? SEA_FACTION : 0));
  return { w, s };
}

test('coastal raids: the Sea Kings may raid any coastal region of yours, and land on its coast', () => {
  let landings = 0;
  for (const seed of [1, 3, 5]) {
    const { w, s } = seaState(seed);
    const sk = borderingRivals(s, w).find((r) => r.faction === SEA_FACTION);
    assert.ok(sk, `seed ${seed}: the Sea Kings border the realm`);
    const far = sk.pairs.filter((p) => p.landing);
    for (const p of far) {
      assert.equal(s.owner[p.to], 0);
      assert.ok(!w.regions[p.to].neighbors.some((n) => s.owner[n] === SEA_FACTION), 'a landing pair is not a border');
      assert.equal(s.owner[p.from], SEA_FACTION);
    }
    landings += far.length;
    const p = far.find((x) => canBuildDefenseArena(w, s.owner, x.to, SEA_FACTION));
    if (!p) continue;
    const arena = buildDefenseArena(w, s.owner, p.to, { attackerFaction: SEA_FACTION, fromRegionId: p.from,
      player: { capBonus: 0 }, enemy: { troopMult: 1, capMult: 1, campTroops: 40, personality: 'raider' } });
    assert.equal(arena.landing, true);
    const camp = w.tiles[arena.sites[0].tile];
    assert.equal(camp.region, p.to, 'the camp stands on the raided region itself');
    assert.ok(touchesOpenSea(w.tiles, camp.i, w.cols, w.rows), 'on its coast');
    assert.ok(arena.sea && Array.isArray(arena.sea.lanes));
  }
  assert.ok(landings > 0, 'some coastal regions are open to a landing');
  // a land continent: no landing pairs, ever
  const land = generateWorld(5, { dynasty: 3 });
  const ls = createGame(5, land, 0);
  ls.owner = land.regions.map((r) => (r.faction > 1 ? r.faction : 0));
  assert.ok(borderingRivals(ls, land).every((r) => r.pairs.every((p) => !p.landing)));
});

test('the card: mechanic "sea" for the Sea Kings, sea lines on an archipelago, none on land', () => {
  const { w, s } = seaState(3);
  const cap = w.regions.find((r) => r.faction === SEA_FACTION && r.isCapital);
  assert.equal(difficulty(s, w, cap.id).mechanic, 'sea');
  const lines = seaLines(s, w, cap.id);
  assert.ok(lines.some((l) => l.startsWith('The Tide')), lines.join(' | '));
  assert.ok(lines.some((l) => l.startsWith('Raiders')));
  assert.deepEqual(seaLines(s, w, w.startRegion), [], 'not for your own region');
  const land = generateWorld(3, { dynasty: 3 });
  assert.deepEqual(seaLines(createGame(3, land, 0), land, 5), []);
  assert.equal(fordsOnFrontier(createGame(3, land, 0), land), null);
  const fresh = createGame(3, w, 0);
  const f = fordsOnFrontier(fresh, w);
  if (f != null) assert.ok(w.regions[f].tiles.some((i) => w.tiles[i].ford));
});

test('content: sea Boons and Relics only on an archipelago; land relic placement unchanged', () => {
  const { w, s } = seaState(3);
  const land = generateWorld(3, { dynasty: 3 });
  const ls = createGame(3, land, 0);
  for (const id of ['navigator', 'privateers', 'harbourChain']) {
    const b = BOON_LIST.find((x) => x.id === id);
    assert.ok(b, id);
    assert.equal(boonRelevant(s, w, b), true);
    assert.equal(boonRelevant(ls, land, b), false);
  }
  const placedLand = placeRelics(ls, land);
  assert.ok(!Object.values(placedLand).some((id) => id === 'astrolabe' || id === 'drownedCrown'));
  s.relics.owned = [];
  const placedSea = placeRelics(s, w);
  assert.ok(Object.keys(placedSea).length > 0);
});

test('the Shipwreck: salvage pays gold, leave rolls for a Relic; never offered on land', () => {
  const { w, s } = seaState(3);
  const e = ensureWorldEvents(s);
  const coast = w.regions.find((r) => s.owner[r.id] === 0 && r.coastal);
  e.pending = { id: 1, kind: 'shipwreck', offeredAt: 0, expiresAt: 90, regionId: coast.id, gold: 500, relicChance: 1, text: '' };
  const g0 = s.gold;
  const a = acceptEvent(s, w, { choice: 'salvage' });
  assert.equal(a.kind, 'shipwreck');
  assert.equal(s.gold, g0 + 500);
  e.pending = { id: 2, kind: 'shipwreck', offeredAt: 0, expiresAt: 90, regionId: coast.id, gold: 500, relicChance: 1, text: '' };
  const owned = s.relics.owned.length;
  const b = acceptEvent(s, w, { choice: 'leave' });
  assert.ok(b.relic && b.relic.id, 'a sure roll finds a Relic');
  assert.equal(s.relics.owned.length, owned + 1);
  assert.equal(s.gold, g0 + 500, 'leaving pays nothing');
});

test('the Shipwreck washes up only on an archipelago', () => {
  const kinds = (w, s) => {
    const seen = {};
    for (let k = 0; k < 2400; k++) {
      const { offered } = tickEvents(s, w, 1e6 + k * 60000, 60);
      if (offered) { seen[offered.kind] = (seen[offered.kind] || 0) + 1; declineEvent(s); }
    }
    return seen;
  };
  const sea = seaState(4);
  const land = generateWorld(4, { dynasty: 3 });
  const ls = createGame(4, land, 0);
  ls.owner = land.regions.map((r) => (r.faction > 1 ? r.faction : 0));
  const a = kinds(sea.w, sea.s);
  const b = kinds(land, ls);
  assert.ok((a.shipwreck || 0) > 0, JSON.stringify(a));
  assert.equal(b.shipwreck, undefined, JSON.stringify(b));
});

test('the Tide floods the approach: tidal tiles on the routes to the Gate and the keep; the Drowned Crown is never on the map', () => {
  let onPath = 0;
  for (const seed of [3, 5, 8, 9]) {
    const { w, s } = seaState(seed);
    const cap = w.regions.find((r) => r.faction === SEA_FACTION && r.isCapital);
    const arena = buildArena(w, s.owner, cap.id, playerBattleStats(s, w, cap.id), enemyBattleStats(w, s, cap.id));
    const tide = arena.sea.tide;
    assert.ok(tide && tide.tiles.length > 0, `seed ${seed}`);
    const keep = w.tiles[arena.sites[tide.site].tile];
    const sites = new Set(arena.sites.map((x) => x.tile));
    const tidal = (i) => w.tiles[i].ford || neighborIndices(i, w.cols, w.rows).some(({ index }) => isOpenSea(w.tiles[index]) || w.tiles[index].ford);
    for (const i of tide.tiles) {
      assert.ok(!sites.has(i) && tidal(i) && hexDistance(w.tiles[i], keep) <= TIDE.routeRadius, `tile ${i}`);
    }
    const byKey = buildTileIndex(arena.tiles);
    const at = (x) => byKey.get(hexKey(w.tiles[x.tile].q, w.tiles[x.tile].r));
    const path = findPath(byKey, at(arena.sites[0]), at(arena.sites[tide.site])) || [];
    if (path.some((t) => tide.tiles.includes(t.i))) onPath += 1;
    assert.ok(!Object.values(s.relics.placed || {}).includes('drownedCrown'));
    s.relics.owned = [];
    assert.ok(!Object.values(placeRelics(s, w)).includes('drownedCrown'), 'Shipwrecks only');
  }
  assert.ok(onPath >= 2, `the camp's road to the keep wades through the tide on ${onPath} of 4`);
});
