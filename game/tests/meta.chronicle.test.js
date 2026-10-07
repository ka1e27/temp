import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PLAYER_FACTION, createGame, resetRegions } from '../meta/state.js';
import { conquer, foundDynasty } from '../meta/progression.js';
import {
  createChronicle, ensureChronicle, sanitizeChronicle, recordChronicle, chronicleEntries, lifetimeHighlights,
  chronicleOnConquest, chronicleOnProsperity, chronicleOnDynasty, chronicleText, chronicleYear, chronicleAgo, chroniclePanelData,
} from '../meta/chronicle.js';
import { leaderFor } from '../meta/leaders.js';
import { awardCrowns } from '../meta/crowns.js';
import { tapestryData, saveText } from '../meta/keepsake.js';
import { CHRONICLE } from '../config/chronicle.js';
import { ICON_NAMES } from '../ui/icons.js';
import { makeWorld, makeGame } from './meta.fixtures.js';
import { generateWorld } from '../world/generate.js';

const DAY = CHRONICLE.dayMs;
const T0 = 1_000_000_000_000;
const snapshot = (v) => JSON.stringify(v);
const ALL3 = { victory: true, swift: true, unbroken: true };
const VICTORY = { victory: true, swift: false, unbroken: true };

/** Fixture world, but with region 4 turned into an Amber Horde region (a faction with a leader and no capital there). */
function amberWorld() {
  const world = structuredClone(makeWorld());
  world.regions[4].faction = 4;
  world.regions[4].name = 'Dunspire';
  return world;
}

/** The player takes `id`: owner + timestamp like conquer() does, without the economy. */
function take(state, id, t) {
  state.owner[id] = PLAYER_FACTION;
  state.conqueredAt[id] = t;
}

// --- shape and defensiveness -----------------------------------------------------------------------

test('createChronicle: a plain-JSON empty chronicle; ensureChronicle creates and repairs it', () => {
  const c = createChronicle();
  assert.deepEqual(JSON.parse(snapshot(c)), c);
  assert.equal(c.entries.length, 0);
  const bare = {};
  assert.equal(ensureChronicle(bare), bare.chronicle);
  assert.deepEqual(bare.chronicle, createChronicle());
  for (const junk of [null, 7, 'x', [], { v: 2 }, { v: 1, entries: 'no' }]) {
    const s = { chronicle: junk };
    assert.deepEqual(ensureChronicle(s).entries, []);
  }
  const keep = { chronicle: { ...createChronicle(), streak: 4 } };
  assert.equal(ensureChronicle(keep).streak, 4, 'a valid chronicle is left alone');
  assert.deepEqual(chronicleEntries({}), []);
  assert.deepEqual(lifetimeHighlights({}), []);
});

test('sanitizeChronicle: keeps well-formed entries and flags, drops junk, never throws', () => {
  const good = { kind: 'surrender', t: T0, y: 2, d: 1, hl: false, data: { region: 'Fenwall', n: 3, deep: { a: 1 }, f: () => 1 } };
  const c = sanitizeChronicle({
    startedAt: T0 - DAY,
    entries: [good, null, { kind: '', t: 1 }, { kind: 'x', t: 'no' }, 5],
    lifetime: [good],
    seen: { surrender: 1, bad: 0 },
    firsts: { conquest: true },
    bestSec: 41.5,
    streak: 3,
    conquests: 9,
  });
  assert.equal(c.entries.length, 1);
  assert.deepEqual(c.entries[0].data, { region: 'Fenwall', n: 3 });
  assert.deepEqual(c.seen, { surrender: true });
  assert.equal(c.bestSec, 41.5);
  assert.equal(c.streak, 3);
  for (const junk of [null, undefined, 3, 'a', [], { entries: 'x' }]) assert.deepEqual(sanitizeChronicle(junk), createChronicle());
  assert.deepEqual(sanitizeChronicle(JSON.parse(snapshot(c))), c, 'idempotent');
  const many = Array.from({ length: 200 }, (_, i) => ({ kind: 'surrender', t: T0 + i }));
  assert.equal(sanitizeChronicle({ entries: many }).entries.length, CHRONICLE.maxEntries);
});

// --- recording ---------------------------------------------------------------------------------------

test('recordChronicle: stores the entry with its Year, dynasty and highlight flag; refuses what it cannot date', () => {
  const state = makeGame(makeWorld());
  assert.equal(recordChronicle(state, null), null);
  assert.equal(recordChronicle(state, { kind: '', t: T0 }), null);
  assert.equal(recordChronicle(state, { kind: 'surrender' }), null);
  assert.equal(recordChronicle(state, { kind: 'surrender', t: NaN }), null);
  const e = recordChronicle(state, { kind: 'surrender', t: T0, data: { region: 'Fenwall', nested: { a: 1 }, ok: true } });
  assert.deepEqual(e, { kind: 'surrender', t: T0, y: 1, d: 1, hl: true, data: { region: 'Fenwall', ok: true } });
  assert.equal(chronicleEntries(state).length, 1);
  const second = recordChronicle(state, { kind: 'surrender', t: T0 + 1000 });
  assert.equal(second.hl, false, 'only the FIRST surrender ever is a lifetime highlight');
  assert.equal(lifetimeHighlights(state).length, 1);
});

test('recordChronicle: the Year is real days since the dynasty began, starting at Year 1', () => {
  const state = makeGame(makeWorld());
  recordChronicle(state, { kind: 'surrender', t: T0 }); // starts the clock
  const year = (t) => recordChronicle(state, { kind: 'surrender', t }).y;
  assert.equal(year(T0 + 1000), 1);
  assert.equal(year(T0 + DAY - 1), 1);
  assert.equal(year(T0 + DAY), 2);
  assert.equal(year(T0 + 2.5 * DAY), 3);
  assert.equal(year(T0 - 5 * DAY), 1, 'a clock that ran backwards never goes below Year 1');
  assert.equal(chronicleYear({ y: 7 }), 'Year 7');
});

test('recordChronicle: a custom line and an unknown kind are allowed', () => {
  const state = makeGame(makeWorld());
  const e = recordChronicle(state, { kind: 'note', t: T0, data: { text: 'A feast was held.' } });
  assert.equal(e.hl, false);
  assert.equal(chronicleText(e), 'A feast was held.');
  assert.equal(chronicleText({ kind: 'mystery', t: 1, data: {} }), 'mystery');
});

test('the chapter is capped at maxEntries: minor entries go first, then plain ones, highlights last', () => {
  const state = makeGame(makeWorld());
  recordChronicle(state, { kind: 'firstConquest', t: T0 }); // highlight (first ever)
  recordChronicle(state, { kind: 'continent', t: T0 + 1 }); // highlight (always)
  recordChronicle(state, { kind: 'halfway', t: T0 + 2 }); // plain, not minor
  for (let i = 0; i < CHRONICLE.maxEntries + 20; i++) recordChronicle(state, { kind: 'surrender', t: T0 + 10 + i, data: { i } });
  const entries = chronicleEntries(state);
  assert.equal(entries.length, CHRONICLE.maxEntries);
  assert.ok(entries.some((e) => e.kind === 'firstConquest'), 'a highlight survives');
  assert.ok(entries.some((e) => e.kind === 'halfway'), 'a plain entry outlives minor ones');
  assert.ok(entries.some((e) => e.kind === 'continent'));
  const surrenders = entries.filter((e) => e.kind === 'surrender');
  assert.equal(surrenders[surrenders.length - 1].data.i, CHRONICLE.maxEntries + 19, 'the newest is kept');
  const plain = surrenders.filter((e) => !e.hl);
  assert.ok(plain[0].data.i > 15, 'the oldest plain minors went');
  assert.equal(surrenders[0].data.i, 0, 'but the first surrender ever is a highlight, so it stays');
  // everything is a highlight: only then does the oldest highlight go
  const only = makeGame(makeWorld());
  for (let i = 0; i < CHRONICLE.maxEntries + 3; i++) recordChronicle(only, { kind: 'dynasty', t: T0 + i, data: { dynasty: i } });
  assert.equal(chronicleEntries(only).length, CHRONICLE.maxEntries);
  assert.equal(chronicleEntries(only)[0].data.dynasty, 3);
});

test('lifetime highlights are capped too', () => {
  const state = makeGame(makeWorld());
  for (let i = 0; i < CHRONICLE.maxHighlights + 15; i++) recordChronicle(state, { kind: 'dynasty', t: T0 + i, data: { dynasty: i } });
  const life = lifetimeHighlights(state);
  assert.equal(life.length, CHRONICLE.maxHighlights);
  assert.equal(life[life.length - 1].data.dynasty, CHRONICLE.maxHighlights + 14);
});

// --- conquest detection ----------------------------------------------------------------------------------

test('a routine conquest records nothing; the first one of a dynasty records the first banner', () => {
  const world = generateWorld(7);
  const state = createGame(7, world, T0);
  const [a, b] = world.regions.filter((r) => r.tier === 1 && r.faction === 1).map((r) => r.id);
  take(state, a, T0 + 5 * 60000);
  const first = chronicleOnConquest(state, world, a, { crowns: { victory: true, swift: false, unbroken: false }, battleSec: 70 });
  assert.deepEqual(first.map((e) => e.kind), ['firstConquest']);
  assert.equal(first[0].data.region, world.regions[a].name);
  assert.equal(first[0].data.regionId, a);
  take(state, b, T0 + 9 * 60000);
  const second = chronicleOnConquest(state, world, b, { crowns: { victory: true, swift: false, unbroken: false }, battleSec: 80 });
  assert.deepEqual(second, [], 'an ordinary victory is not worth a line');
  assert.equal(chronicleEntries(state).length, 1);
});

test('the Year clock starts when the realm did (the start region\'s timestamp), not at the first event', () => {
  const world = makeWorld();
  const state = makeGame(world, {}, T0);
  take(state, 1, T0 + 2 * DAY + 5000);
  const [e] = chronicleOnConquest(state, world, 1, { crowns: null, surrender: false });
  assert.equal(e.y, 3, 'two days and a bit after the realm began');
  assert.equal(state.chronicle.startedAt, T0);
});

test('a surrender is recorded with the rival named; as the first conquest it gets the surrender wording', () => {
  const world = amberWorld();
  const state = makeGame(world, {}, T0);
  state.seed = 7;
  take(state, 1, T0 + 1000);
  chronicleOnConquest(state, world, 1, { surrender: false });
  take(state, 4, T0 + 2000);
  const [s] = chronicleOnConquest(state, world, 4, { surrender: true });
  assert.equal(s.kind, 'surrender');
  assert.equal(s.data.leader, 'Khan Gashrok', 'leaderFor(7, 1, Amber)');
  assert.equal(s.data.faction, 'Amber Horde');
  assert.equal(s.data.region, 'Dunspire');
  for (let t = 0; t < 30; t++) {
    const text = chronicleText({ ...s, t });
    assert.match(text, /Khan Gashrok/, text);
    assert.match(text, /Dunspire/, text);
  }

  const early = makeGame(world, {}, T0);
  early.seed = 7;
  take(early, 4, T0 + 1000);
  const [f] = chronicleOnConquest(early, world, 4, { surrender: true });
  assert.equal(f.kind, 'firstConquest');
  assert.equal(f.data.surrender, true);
  assert.match(chronicleText(f), /Khan Gashrok/);
});

test('a capital toppled is recorded with the decapitation flag, by battle or surrender', () => {
  const world = makeWorld();
  const a = makeGame(world, {}, T0);
  take(a, 1, T0 + 1000);
  chronicleOnConquest(a, world, 1, {});
  take(a, 3, T0 + 5000);
  const [cap] = chronicleOnConquest(a, world, 3, { decapitated: true, crowns: VICTORY, battleSec: 100 });
  assert.equal(cap.kind, 'capital');
  assert.equal(cap.data.decapitated, true);
  assert.equal(cap.data.regionId, 3);
  assert.equal(cap.hl, true, 'the first capital ever is a lifetime highlight');
  assert.match(chronicleText(cap), /Crimson Legion|Warlord/);

  const b = makeGame(world, {}, T0);
  take(b, 1, T0 + 1000);
  chronicleOnConquest(b, world, 1, {});
  take(b, 3, T0 + 5000);
  const [yielded] = chronicleOnConquest(b, world, 3, { surrender: true, decapitated: true });
  assert.equal(yielded.kind, 'capital');
  assert.equal(yielded.data.surrender, true);
});

test('triple crowns: the first of a dynasty, then only on streak milestones; a plain victory resets the streak; capitals are not doubled', () => {
  const world = generateWorld(7);
  const real = createGame(7, world, T0);
  const ids = world.regions.filter((r) => r.faction !== 0 && !r.isCapital).map((r) => r.id);
  const tripleStreaks = [];
  ids.slice(0, 14).forEach((id, i) => {
    take(real, id, T0 + (i + 1) * 60000);
    for (const e of chronicleOnConquest(real, world, id, { crowns: ALL3, battleSec: 60 + i * 5 })) {
      if (e.kind === 'tripleCrown') tripleStreaks.push(e.data.streak);
    }
  });
  assert.equal(tripleStreaks[0], 1, 'the first triple crown of the dynasty');
  assert.deepEqual(tripleStreaks.slice(1), CHRONICLE.streakMilestones.filter((m) => m <= 14), 'then only the milestones');
  assert.equal(real.chronicle.streak, 14);

  // a plain victory resets the streak, and the next perfect one is not a first any more
  const next = ids[14];
  take(real, next, T0 + 20 * 60000);
  const plain = chronicleOnConquest(real, world, next, { crowns: VICTORY, battleSec: 200 });
  assert.equal(plain.some((e) => e.kind === 'tripleCrown'), false);
  assert.equal(real.chronicle.streak, 0);
  take(real, ids[15], T0 + 21 * 60000);
  assert.equal(chronicleOnConquest(real, world, ids[15], { crowns: ALL3, battleSec: 200 }).some((e) => e.kind === 'tripleCrown'), false);

  // the capital line already says it all
  const cap = world.regions.find((r) => r.isCapital).id;
  const fresh = createGame(7, world, T0);
  take(fresh, ids[0], T0 + 1000);
  chronicleOnConquest(fresh, world, ids[0], {});
  take(fresh, cap, T0 + 2000);
  const kinds = chronicleOnConquest(fresh, world, cap, { crowns: ALL3, battleSec: 100 }).map((e) => e.kind);
  assert.ok(kinds.includes('capital'));
  assert.equal(kinds.includes('tripleCrown'), false);
});

test('a surrender never earns a triple crown line or touches the streak; its crowns are ignored', () => {
  const world = generateWorld(7);
  const state = createGame(7, world, T0);
  const [a, b] = world.regions.filter((r) => r.tier === 1 && r.faction === 1).map((r) => r.id);
  take(state, a, T0 + 1000);
  chronicleOnConquest(state, world, a, {});
  state.chronicle.streak = 2;
  take(state, b, T0 + 2000);
  const out = chronicleOnConquest(state, world, b, { surrender: true, crowns: ALL3, battleSec: 10 });
  assert.deepEqual(out.map((e) => e.kind), ['surrender']);
  assert.equal(state.chronicle.streak, 2);
  assert.equal(state.chronicle.bestSec, null, 'a surrender is not a battle time');
});

test('fastest battle: the first time sets the record silently; a faster one by the margin is a line; slower or marginal ones are not', () => {
  const world = generateWorld(7);
  const state = createGame(7, world, T0);
  const ids = world.regions.filter((r) => r.faction !== 0 && !r.isCapital).map((r) => r.id);
  let n = 0;
  const fastest = (sec) => {
    const id = ids[n++];
    take(state, id, T0 + n * 60000);
    return chronicleOnConquest(state, world, id, { battleSec: sec }).filter((e) => e.kind === 'fastest');
  };
  assert.deepEqual(fastest(80), []);
  assert.equal(state.chronicle.bestSec, 80, 'the first battle only sets the record');
  assert.deepEqual(fastest(95), [], 'slower');
  assert.equal(state.chronicle.bestSec, 80);
  assert.deepEqual(fastest(79.8), [], 'faster, but by less than the margin: no line');
  assert.equal(state.chronicle.bestSec, 79.8, 'but the record still moves');
  const out = fastest(50);
  assert.equal(out.length, 1, 'a real improvement');
  assert.equal(out[0].data.sec, 50);
  assert.equal(out[0].data.prev, 79.8);
  assert.equal(out[0].hl, true, 'records are always lifetime highlights');
  const text = chronicleText(out[0]);
  assert.match(text, /0:50/);
  assert.match(text, /1:20|1:19/, 'the old record is named');
  assert.match(text, new RegExp(world.regions[ids[n - 1]].name));
});

test('a rival faction\'s last region is a line; halfway and the whole continent are lines, once each', () => {
  const world = makeWorld(); // regions: 0 home | 1 2 Free Folk | 3 4 Crimson | 5 Violet
  const state = makeGame(world, {}, T0);
  const kinds = (id, t) => { take(state, id, t); return chronicleOnConquest(state, world, id, {}).map((e) => e.kind); };
  assert.deepEqual(kinds(1, T0 + 1000), ['firstConquest']);
  assert.deepEqual(kinds(2, T0 + 2000), ['factionFalls', 'halfway'], 'both Free Folk regions held; 3 of 6 is half');
  assert.deepEqual(kinds(4, T0 + 3000), []);
  assert.deepEqual(kinds(3, T0 + 4000), ['capital', 'factionFalls']);
  assert.deepEqual(kinds(5, T0 + 5000), ['capital', 'factionFalls', 'continent']);
  const again = chronicleOnConquest(state, world, 5, {});
  assert.equal(again.some((e) => e.kind === 'continent' || e.kind === 'halfway'), false);
});

test('chronicleOnConquest needs a time: none known means no entry (it never invents a clock)', () => {
  const world = makeWorld();
  const state = makeGame(world);
  state.conqueredAt = [];
  assert.deepEqual(chronicleOnConquest(state, world, 1, {}), []);
  assert.deepEqual(chronicleOnConquest(state, world, 99, { t: T0 }), []);
  assert.equal(chronicleOnConquest(state, world, 1, { t: T0 }).length, 1);
});

// --- prosperity --------------------------------------------------------------------------------------------

test('the first Prosperity III of a dynasty is recorded, once; lower levels and a missing time are not', () => {
  const world = makeWorld();
  const state = makeGame(world, {}, T0);
  assert.deepEqual(chronicleOnProsperity(state, world, [{ regionId: 1, level: 2, from: 1 }], { t: T0 + 10 }), []);
  assert.deepEqual(chronicleOnProsperity(state, world, [{ regionId: 1, level: 3, from: 2 }], {}), [], 'no clock');
  const [e] = chronicleOnProsperity(state, world, [{ regionId: 1, level: 3, from: 2 }, { regionId: 2, level: 3, from: 0 }], { t: T0 + 20 });
  assert.equal(e.kind, 'prosperity3');
  assert.equal(e.data.region, 'Millbrook');
  assert.equal(chronicleOnProsperity(state, world, [{ regionId: 2, level: 3, from: 2 }], { t: T0 + 30 }).length, 0, 'only the first');
  assert.equal(e.hl, true);
  assert.deepEqual(chronicleOnProsperity(state, world, null, { t: T0 }), []);
});

test('Prosperity III is dated when it was reached (also while the game was closed), the earliest region first, never in the future', () => {
  const HOUR = 3600000;
  const world = makeWorld();
  const state = makeGame(world, {}, T0);
  state.conqueredAt[1] = T0 + 1000;
  state.conqueredAt[2] = T0 + 5000;
  // the game was closed; it wakes 20 hours later and both regions are at level III
  const now = T0 + 20 * HOUR;
  const [e] = chronicleOnProsperity(state, world, [{ regionId: 2, level: 3, from: 0 }, { regionId: 1, level: 3, from: 0 }], { t: now });
  assert.equal(e.data.region, 'Millbrook', 'region 1 got there first');
  assert.equal(e.t, T0 + 1000 + 8 * HOUR, 'the 8 h tenure after the conquest, not "now"');
  assert.match(chronicleAgo(e, now), /^1[0-9]h ago$/, 'reads hours ago');

  const fresh = makeGame(world, {}, T0);
  fresh.conqueredAt[1] = T0;
  const [early] = chronicleOnProsperity(fresh, world, [{ regionId: 1, level: 3, from: 2 }], { t: T0 + HOUR });
  assert.equal(early.t, T0 + HOUR, 'never dated after the moment it was reported');
});

test('entries stay in time order even when one is recorded late', () => {
  const state = makeGame(makeWorld(), {}, T0);
  recordChronicle(state, { kind: 'fastest', t: T0 + 3000, data: { region: 'A', sec: 40, prev: 50 } });
  recordChronicle(state, { kind: 'halfway', t: T0 + 1000, data: { n: 3 } });
  recordChronicle(state, { kind: 'continent', t: T0 + 3000, data: {} });
  recordChronicle(state, { kind: 'surrender', t: T0 + 2000, data: { region: 'B' } });
  assert.deepEqual(chronicleEntries(state).map((e) => e.t), [T0 + 1000, T0 + 2000, T0 + 3000, T0 + 3000]);
  assert.deepEqual(chronicleEntries(state).slice(2).map((e) => e.kind), ['fastest', 'continent'], 'equal times keep their recording order');
  assert.ok(lifetimeHighlights(state).every((e, i, a) => i === 0 || a[i - 1].t <= e.t));
});

// --- dynasty --------------------------------------------------------------------------------------------------

test('founding a dynasty closes the chapter, keeps the highlights and the record, and opens the next', () => {
  const world = makeWorld();
  const state = makeGame(world, {}, T0);
  take(state, 1, T0 + 1000);
  chronicleOnConquest(state, world, 1, { battleSec: 70 });
  take(state, 3, T0 + 2 * DAY);
  chronicleOnConquest(state, world, 3, { decapitated: true, battleSec: 40 });
  const before = chronicleEntries(state).length;
  assert.ok(before >= 2);
  const lifeBefore = lifetimeHighlights(state).length;

  state.dynasty = { level: 2, stars: 6 };
  state.seed = 99;
  const [d] = chronicleOnDynasty(state, world, { t: T0 + 3 * DAY });
  assert.equal(d.kind, 'dynasty');
  assert.equal(d.d, 2);
  assert.equal(d.y, 1, 'the new chapter starts at Year 1');
  assert.equal(d.data.years, 4, 'the old dynasty lasted into its 4th Year');
  assert.equal(d.data.conquests, 2);
  assert.equal(d.data.stars, 6);
  assert.deepEqual(chronicleEntries(state).map((e) => e.kind), ['dynasty'], 'the old chapter is cleared');
  assert.equal(lifetimeHighlights(state).length, lifeBefore + 1, 'highlights stay, and the dynasty is one too');
  assert.equal(state.chronicle.bestSec, 40, 'the fastest battle ever is remembered');
  assert.deepEqual(state.chronicle.firsts, {}, 'firsts start over');
  assert.equal(state.chronicle.streak, 0);
  assert.match(chronicleText(d), /Dynasty II/);
  assert.match(chronicleText(d), /6 stars/);

  // the new dynasty's first conquest is a first conquest again, and its Year counts from the founding
  take(state, 1, T0 + 3 * DAY + 3 * 3600 * 1000);
  const [f] = chronicleOnConquest(state, world, 1, {});
  assert.equal(f.kind, 'firstConquest');
  assert.equal(f.y, 1);
  assert.equal(f.d, 2);
  assert.equal(f.hl, false, 'only the very first conquest of the realm is a highlight');
});

test('real flow: found a dynasty through progression, resetRegions and the chronicle together', () => {
  const world = generateWorld(7);
  const state = createGame(7, world, T0);
  for (const r of world.regions) if (r.id !== world.startRegion) { take(state, r.id, T0 + r.id * 60000); chronicleOnConquest(state, world, r.id, { crowns: VICTORY, battleSec: 80 + r.id }); }
  assert.ok(chronicleEntries(state).some((e) => e.kind === 'continent'));
  const next = foundDynasty(state, 4242);
  assert.ok(next);
  const world2 = generateWorld(4242, { dynasty: 2 });
  resetRegions(next, world2, T0 + DAY);
  const [d] = chronicleOnDynasty(next, world2, { t: T0 + DAY });
  assert.equal(d.d, 2);
  assert.equal(chronicleEntries(next).length, 1);
  assert.ok(lifetimeHighlights(next).some((e) => e.kind === 'continent'), 'the old dynasty\'s triumph is in the all-time list');
  assert.ok(lifetimeHighlights(next).some((e) => e.kind === 'firstConquest'));
});

// --- text ------------------------------------------------------------------------------------------------------

test('chronicleText: names the region and the rival leader; the surrender line is the one the design promises', () => {
  const world = amberWorld();
  const state = makeGame(world, {}, T0);
  state.seed = 7;
  const entry = { kind: 'surrender', t: T0, y: 2, d: 1, hl: false, data: { regionId: 4, factionId: 4 } };
  // an entry without stored names falls back to the world and leaderFor
  const text = chronicleText(entry, { world, state });
  assert.match(text, /Khan Gashrok/);
  assert.match(text, /Dunspire/);
  const all = new Set();
  for (let t = 0; t < 40; t++) all.add(chronicleText({ ...entry, t }, { world, state }));
  assert.ok([...all].some((s) => s === 'Khan Gashrok’s Amber Horde yields Dunspire.'), 'Year 2: Khan Gashrok\'s Amber Horde yields Dunspire');
  assert.ok(all.size >= 2, 'the variants all occur');
  assert.deepEqual(new Set([chronicleText(entry, { world, state }), chronicleText(entry, { world, state })]).size, 1, 'deterministic');
});

test('chronicleText: leaders are re-seeded every dynasty, so a stored name beats a recomputed one', () => {
  const world = amberWorld();
  const state = makeGame(world, {}, T0);
  state.seed = 7;
  take(state, 1, T0 + 1000);
  chronicleOnConquest(state, world, 1, {});
  take(state, 4, T0 + 2000);
  const [s] = chronicleOnConquest(state, world, 4, { surrender: true });
  state.seed = 1234; // a later dynasty: Amber's leader is someone else now
  state.dynasty = { level: 2, stars: 3 };
  assert.notEqual(leaderFor(1234, 2, 4).fullName, 'Khan Gashrok');
  assert.match(chronicleText(s, { world, state }), /Khan Gashrok/);
  // while an entry that never stored a name is rendered with the CURRENT leader
  const bare = { kind: 'surrender', t: T0, y: 1, d: 2, hl: false, data: { regionId: 4, factionId: 4 } };
  assert.match(chronicleText(bare, { world, state }), new RegExp(leaderFor(1234, 2, 4).fullName));
});

test('chronicleText: the Free Folk "yield", a capital line names the throne, placeholders never leak', () => {
  const world = makeWorld();
  const ffData = { region: 'Millbrook', regionId: 1, factionId: 1, faction: 'Free Folk', leader: 'Reeve Alfton', surrender: true };
  const lines = new Set();
  for (let t = 0; t < 40; t++) lines.add(chronicleText({ kind: 'capital', t: T0 + t * 977, y: 1, d: 1, hl: false, data: ffData }));
  for (const line of lines) {
    assert.match(line, /Reeve Alfton/);
    if (/Free Folk yield/.test(line) || /Free Folk yields/.test(line)) assert.match(line, /Free Folk yield\b(?!s)/, line);
  }
  assert.ok([...lines].some((l) => /Free Folk yield /.test(l)), 'the plural verb shows up');
  const amber = new Set();
  for (let t = 0; t < 40; t++) amber.add(chronicleText({ kind: 'surrender', t: T0 + t * 977, y: 1, d: 1, hl: false, data: { ...ffData, factionId: 4, faction: 'Amber Horde', leader: 'Khan Gashrok' } }));
  assert.ok([...amber].some((l) => /Amber Horde yields /.test(l)));
  const data = { region: 'Fenwall', regionId: 1, faction: 'Crimson Legion', factionId: 2, leader: 'Warlord Korius', sec: 41, prev: 58, n: 5, streak: 5, dynasty: 3, stars: 9, years: 4 };
  for (const kind of Object.keys(CHRONICLE.kinds)) {
    for (let t = 0; t < 12; t++) {
      for (const extra of [{}, { surrender: true }]) {
        const text = chronicleText({ kind, t: T0 + t * 7919, y: 1, d: 3, hl: false, data: { ...data, ...extra } }, { world });
        assert.ok(text.length > 12, kind + ': "' + text + '"');
        assert.ok(!/[{}]/.test(text), kind + ' leaks a placeholder: "' + text + '"');
      }
    }
  }
  const cap = chronicleText({ kind: 'capital', t: T0, y: 1, d: 1, hl: true, data: { ...data, decapitated: true } });
  assert.match(cap, /Korius/);
  assert.match(cap, /Fenwall/);
  assert.match(chronicleText({ kind: 'tripleCrown', t: T0, y: 1, d: 1, hl: false, data: { ...data, streak: 5 } }), /5th|5 flawless/);
});

test('chronicleAgo: just now, minutes, hours, days', () => {
  const e = { t: T0 };
  assert.equal(chronicleAgo(e, T0 + 20 * 1000), 'just now');
  assert.equal(chronicleAgo(e, T0 + 5 * 60000), '5m ago');
  assert.equal(chronicleAgo(e, T0 + 3 * 3600000 + 1000), '3h ago');
  assert.equal(chronicleAgo(e, T0 + 2 * DAY + 5000), '2d ago');
  assert.equal(chronicleAgo(e, T0 - 5000), 'just now', 'a clock behind the entry');
});

test('copy: every kind has templates, a known icon and a highlight rule; line lengths stay readable', () => {
  for (const [kind, cfg] of Object.entries(CHRONICLE.kinds)) {
    assert.ok(ICON_NAMES.includes(cfg.icon), `${kind} icon ${cfg.icon}`);
    assert.ok([false, 'first', 'always'].includes(cfg.highlight), kind);
    assert.ok(CHRONICLE.templates[kind] && CHRONICLE.templates[kind].length >= 2, `${kind} has variants`);
  }
  for (const [key, list] of Object.entries(CHRONICLE.templates)) {
    for (const tpl of list) {
      assert.ok(tpl.length <= 110, `${key}: "${tpl}" is ${tpl.length} chars`);
      for (const m of tpl.matchAll(/\{(\w+)\}/g)) assert.ok(['region', 'faction', 'leader', 'rival', 'yields', 'time', 'prev', 'n', 'ordinal', 'dynasty', 'stars', 'years'].includes(m[1]), `${key} {${m[1]}}`);
    }
  }
  assert.ok(CHRONICLE.maxEntries >= 30 && CHRONICLE.maxEntries <= 50, 'about 40 per dynasty');
});

// --- panel data ---------------------------------------------------------------------------------------------------

test('chroniclePanelData: newest first, a row per entry with icon, text, Year and age; lifetime list; chapters', () => {
  const world = makeWorld();
  const state = makeGame(world, {}, T0);
  take(state, 1, T0 + 1000);
  chronicleOnConquest(state, world, 1, {});
  take(state, 3, T0 + 2 * DAY);
  chronicleOnConquest(state, world, 3, { decapitated: true, battleSec: 100 });
  const now = T0 + 2 * DAY + 3 * 3600000;
  const data = chroniclePanelData(state, world, now);
  assert.deepEqual(data.dynasty.map((r) => r.kind), ['halfway', 'capital', 'firstConquest'], 'newest first');
  const row = data.dynasty[1];
  assert.deepEqual(Object.keys(row).sort(), ['ago', 'chapter', 'dynasty', 'highlight', 'icon', 'kind', 'text', 'year']);
  assert.equal(row.icon, 'throne');
  assert.equal(row.year, 'Year 3');
  assert.equal(row.ago, '3h ago');
  assert.equal(row.chapter, 'Dynasty I');
  assert.equal(data.all.length, 2, 'halfway is not a lifetime highlight');
  assert.equal(data.labels.title, 'Chronicle');
  assert.ok(data.empty.dynasty.length > 10 && data.empty.all.length > 10);
  const blank = chroniclePanelData(makeGame(world), world, T0);
  assert.deepEqual([blank.dynasty, blank.all], [[], []]);
});

// --- determinism and JSON ---------------------------------------------------------------------------------------------

test('a whole scripted run is deterministic and plain JSON; save/sanitize round-trips it', () => {
  const run = () => {
    const world = generateWorld(7);
    const state = createGame(7, world, T0);
    let i = 0;
    for (const r of world.regions) {
      if (r.id === world.startRegion) continue;
      i++;
      take(state, r.id, T0 + i * 17 * 60000);
      chronicleOnConquest(state, world, r.id, { crowns: i % 3 ? ALL3 : VICTORY, battleSec: 120 - i * 2.5, surrender: i % 7 === 0 });
      if (i === 12) chronicleOnProsperity(state, world, [{ regionId: r.id, level: 3, from: 2 }], { t: T0 + i * 17 * 60000 + 5 });
    }
    return state;
  };
  const a = run();
  const b = run();
  assert.equal(snapshot(a.chronicle), snapshot(b.chronicle));
  assert.deepEqual(JSON.parse(snapshot(a.chronicle)), a.chronicle);
  assert.deepEqual(sanitizeChronicle(JSON.parse(snapshot(a.chronicle))), a.chronicle);
  assert.ok(chronicleEntries(a).length <= CHRONICLE.maxEntries);
  const times = chronicleEntries(a).map((e) => e.t);
  assert.deepEqual(times, [...times].sort((x, y) => x - y), 'chronological');
  const texts = chronicleEntries(a).map((e) => chronicleText(e, { world: generateWorld(7), state: a }));
  assert.ok(texts.every((t) => t.length > 10 && !/[{}]/.test(t)));
});

test('helpers never mutate the world or touch economy state', () => {
  const world = Object.freeze(makeWorld());
  const state = makeGame(world, { gold: 123 }, T0);
  state.stats.goldEarned = 77;
  take(state, 1, T0 + 1000);
  const owner = [...state.owner];
  chronicleOnConquest(state, world, 1, { crowns: ALL3, battleSec: 50 });
  chroniclePanelData(state, world, T0 + 5000);
  assert.equal(state.gold, 123);
  assert.equal(state.stats.goldEarned, 77);
  assert.deepEqual(state.owner, owner);
  assert.equal(conquer.length >= 3, true);
});

// --- structure ---------------------------------------------------------------------------------------------------------

test('chronicle files are pure: no DOM, time, randomness or storage', () => {
  for (const rel of ['../meta/chronicle.js', '../meta/chronicleState.js', '../config/chronicle.js']) {
    const src = readFileSync(new URL(rel, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");
    for (const banned of ['document', 'window', 'Math.random', 'Date.now', 'performance', 'localStorage', 'requestAnimationFrame', 'new Date']) {
      assert.ok(!src.includes(banned), `${rel} mentions ${banned}`);
    }
  }
});

// --- the tapestry's data and the save words -------------------------------------------------------------------

test('tapestryData: title, dynasty numeral, stats and realm colour, all from state and config', () => {
  const world = makeWorld();
  const state = makeGame(world, {}, T0);
  state.dynasty = { level: 3, stars: 9 };
  state.stats = { ...state.stats, battlesWon: 1284.4, playSec: 2 * 86400 + 14 * 3600 + 5 };
  state.owner[1] = PLAYER_FACTION;
  state.conqueredAt[1] = T0;
  awardCrowns(state, world, 1, ALL3, 100);
  const data = tapestryData(state, world, T0 + 5 * DAY);
  assert.equal(data.title, 'The Realm of Home Shore');
  assert.equal(data.subtitle, 'Dynasty III');
  assert.equal(data.dynasty, 3);
  assert.deepEqual(data.stats, { regions: '2 of 6', battlesWon: 1284, crowns: '3 / 15', timePlayed: '2d 14h' });
  assert.equal(data.factionColor, world.factions[PLAYER_FACTION].color);
  assert.equal(data.emblem, world.factions[PLAYER_FACTION].emblem);
  assert.equal(data.date, T0 + 5 * DAY);
  assert.ok(Number.isInteger(data.seed));
});

test('tapestryData: reads, never writes; plain JSON; deterministic; a bare state does not throw', () => {
  const world = makeWorld();
  const state = makeGame(world, {}, T0);
  const before = snapshot(state);
  const a = tapestryData(state, world, T0);
  assert.equal(snapshot(state), before, 'state untouched');
  assert.deepEqual(JSON.parse(snapshot(a)), a);
  assert.deepEqual(tapestryData(state, world, T0), a);
  const bare = tapestryData({ owner: world.regions.map(() => 1) }, world, T0);
  assert.equal(bare.subtitle, 'Dynasty I');
  assert.equal(bare.stats.battlesWon, 0);
  assert.equal(bare.stats.timePlayed, '0s');
  assert.match(bare.stats.regions, /^0 of 6$/);
});

test('saveText: the words around saving come from config, with {file} filled', () => {
  assert.equal(saveText('button'), CHRONICLE.save.button);
  assert.equal(saveText('done', { file: 'a.png' }), 'Map saved: a.png');
  assert.ok(!/[{}]/.test(saveText('failed')));
  assert.equal(saveText('nope'), '');
  for (const key of ['button', 'busy', 'done', 'failed', 'hint']) assert.ok(saveText(key, { file: 'x.png' }).length > 3, key);
});

test('keepsake.js is pure too', () => {
  const src = readFileSync(new URL('../meta/keepsake.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const banned of ['document', 'window', 'Math.random', 'Date.now', 'performance', 'localStorage', 'new Date']) {
    assert.ok(!src.includes(banned), `keepsake.js mentions ${banned}`);
  }
});

test('import graph: chronicleState.js is a leaf (config only), so state.js and save.js can import it without a cycle; chronicle.js re-exports it', async () => {
  const src = readFileSync(new URL('../meta/chronicleState.js', import.meta.url), 'utf8');
  const imports = [...src.matchAll(/^import .* from '(.+)';$/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['../config/chronicle.js']);
  const leaf = await import('../meta/chronicleState.js');
  const full = await import('../meta/chronicle.js');
  for (const name of ['createChronicle', 'sanitizeChronicle', 'ensureChronicle', 'chronicleEntries', 'lifetimeHighlights']) {
    assert.equal(full[name], leaf[name], `${name} is the same function from both`);
  }
  for (const rel of ['../meta/state.js', '../meta/save.js']) {
    const text = readFileSync(new URL(rel, import.meta.url), 'utf8');
    assert.ok(!/from '\.\/chronicle\.js'/.test(text), `${rel} must import ./chronicleState.js, never ./chronicle.js`);
  }
});

test('a faction named with its article never reads "…’s The Usurper" or "the The Usurper"', () => {
  // every template, with the Usurper as the rival (data supplies the names, so no world is needed)
  const bad = [];
  for (const [kind, list] of Object.entries(CHRONICLE.templates)) {
    for (let i = 0; i < list.length; i++) {
      const text = chronicleText({ kind, t: i * 977, data: { faction: 'The Usurper', leader: 'Usurper-King Sevvane of the Stolen Crown', region: 'Frostborough', regionId: i, factionId: 7, n: 2, dynasty: 7, stars: 9 } });
      if (/’s The |\bthe The\b/i.test(text)) bad.push(`${kind}: ${text}`);
    }
  }
  assert.deepEqual(bad, []);
  // and a faction without an article is untouched
  const plain = chronicleText({ kind: 'conquest', t: 1, data: { faction: 'Crimson Legion', leader: 'Warlord Brann', region: 'Ashford', regionId: 3, factionId: 2 } });
  assert.ok(!/The Crimson|the the/i.test(plain), plain);
});
