// Phase 13 (The Crown of Ages): the continent, its availability and founding, Ascension, the ending record, the Usurper-King's voice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateWorld } from '../world/generate.js';
import { challengeWorld } from '../meta/challenges.js';
import { dailySpec } from '../meta/daily.js';
import { scenarioSpec } from '../meta/scenarios.js';
import { rivalsFor, crownRivals } from '../meta/rivals.js';
import { createGame } from '../meta/state.js';
import { foundDynasty } from '../meta/progression.js';
import { worldOptsFor, edictMods } from '../meta/edicts.js';
import { migrate } from '../meta/save.js';
const sanitizeSave = (raw) => migrate(raw);
import { legacyPointsForFounding } from '../meta/legacy.js';
import { winDrafts } from '../meta/boons.js';
import { inGrace } from '../meta/frontier.js';
import { addGrudge } from '../meta/grudges.js';
import {
  crownOfAgesAvailable, isThrone, throneLines, onThroneToppled, endingRecord, crownLine, ascensionInfo, noteReign,
} from '../meta/crown.js';
import { ascensionMods, maxAscensionChoice, cleanAscensionChoice, ascensionLegacyMult } from '../meta/ascension.js';
import { ASCENSION } from '../config/ascension.js';
import { USURPER_FACTION } from '../config/crown.js';
import { FACTIONS } from '../config/world.js';
import { LEADER_LINES, LEADER_TRIGGERS, VOICE } from '../config/leaders.js';
import { THRONE_LINES } from '../config/leadersUsurper.js';

const digest = (w) => createHash('sha256').update(JSON.stringify(w)).digest('hex').slice(0, 16);

test('every existing world kind is byte-identical to Phase 12 (digests taken before the Crown of Ages existed)', () => {
  const want = {
    'land s1 d1': [generateWorld(1, { dynasty: 1, rivals: rivalsFor(1, 1) }), 'd6b1de508c321e12'],
    'land s7 d5': [generateWorld(7, { dynasty: 5, rivals: rivalsFor(7, 5) }), 'dcbcd10a02fb709f'],
    'land s42 d9': [generateWorld(42, { dynasty: 9, rivals: rivalsFor(42, 9) }), '135992a4079205d6'],
    'arch s3 d5': [generateWorld(3, { dynasty: 5, archipelago: true, rivals: rivalsFor(3, 5, { archipelago: true }) }), 'adcce1e983c5670d'],
    'arch s42 d7': [generateWorld(42, { dynasty: 7, archipelago: true, rivals: rivalsFor(42, 7, { archipelago: true }) }), '602da9f992643b47'],
    'edict s2': [generateWorld(2, { dynasty: 4, edict: 'longWinter' }), '823f7acef8ede7bc'],
    'daily 20261006': [challengeWorld(dailySpec(20261006)), '247b09fcbf259650'],
    'scenario kingmaker': [challengeWorld(scenarioSpec('kingmaker')), '356bab0b3c31f26a'],
    'scenario fallenRise': [challengeWorld(scenarioSpec('fallenRise')), 'cd2e2775bd9973a9'],
  };
  for (const [k, [w, h]] of Object.entries(want)) assert.equal(digest(w), h, k);
});

test('the Crown of Ages continent: every rival kind, the Usurper on the Throne at the centre, the Sea Kings on islands', () => {
  for (let seed = 1; seed <= 24; seed++) {
    const w = generateWorld(seed, { dynasty: 7, crownOfAges: true });
    assert.equal(digest(w), digest(generateWorld(seed, { dynasty: 7, crownOfAges: true })), `seed ${seed} deterministic`);
    assert.ok(w.crown, `seed ${seed} has a crown`);
    assert.equal(w.factions.length, FACTIONS.length);
    assert.ok(w.regions.length >= 28, `seed ${seed}: ${w.regions.length} regions`);
    const held = new Set(w.regions.map((r) => r.faction));
    assert.deepEqual(crownRivals(seed).filter((f) => held.has(f)), crownRivals(seed), `seed ${seed}: sector rivals`);
    assert.ok(held.has(5) && held.has(6) && held.has(USURPER_FACTION), `seed ${seed}: Ashen, Sea Kings, Usurper`);
    assert.equal(crownRivals(seed).filter((f) => f >= 2 && f <= 4).length, 2, 'two classic factions');
    const th = w.regions[w.crown.throne];
    assert.ok(th.throne && th.isCapital && th.faction === USURPER_FACTION && th.twist === 'siege' && th.tier >= 3, `seed ${seed}: the Throne`);
    assert.ok(isThrone(w, th.id));
    assert.equal(w.factions[USURPER_FACTION].capitalRegion, th.id);
    // every rival holds one connected piece with its capital in it
    for (const f of [...crownRivals(seed), 6, 7]) {
      const mine = w.regions.filter((r) => r.faction === f).map((r) => r.id);
      const seen = new Set([mine[0]]);
      for (const id of seen) for (const nb of w.regions[id].neighbors) if (mine.includes(nb)) seen.add(nb);
      assert.equal(seen.size, mine.length, `seed ${seed}: faction ${f} in one piece`);
      assert.ok(mine.includes(w.factions[f].capitalRegion), `seed ${seed}: faction ${f}'s capital`);
      assert.equal(w.regions.filter((r) => r.faction === f && r.isCapital).length, 1);
    }
    // the partial archipelago: the mainland is island 0 with the start; the Sea Kings' regions are off it
    assert.ok(w.archipelago && w.archipelago.islands[0].includes(w.startRegion), `seed ${seed}: archipelago`);
    for (const id of w.crown.seaKings) assert.ok(w.regions[id].island >= 1, `seed ${seed}: sea region ${id} on an island`);
    assert.ok(w.archipelago.harbours.length >= 2 && w.archipelago.fords > 0);
  }
});

function d6State(seed = 11) {
  const w = generateWorld(seed, { dynasty: 6 });
  const s = createGame(seed, w, 0);
  s.dynasty.level = 6;
  s.owner = s.owner.map(() => 0);
  return { s, w };
}

test('the Crown is offered from the dynasty-7 founding on, and founding honours it only then', () => {
  const { s, w } = d6State();
  assert.equal(crownOfAgesAvailable(s), true);
  assert.equal(crownOfAgesAvailable({ ...s, dynasty: { level: 5, stars: 0 } }), false);
  assert.equal(crownOfAgesAvailable({ ...s, challenge: { kind: 'daily' } }), false);
  const next = foundDynasty(s, 777, undefined, w, { crownOfAges: true });
  assert.equal(next.crownOfAges, true);
  assert.deepEqual(next.rivals, crownRivals(777));
  assert.equal(next.archipelago, false);
  assert.equal(next.founding.crownOfAges, true);
  const opts = worldOptsFor(next);
  assert.equal(opts.crownOfAges, true);
  assert.ok(generateWorld(777, opts).crown);
  const early = foundDynasty({ ...s, dynasty: { level: 5, stars: 0 } }, 777, undefined, w, { crownOfAges: true });
  assert.equal(early.crownOfAges, false);
  // the save keeps it; an old save has none
  assert.equal(sanitizeSave(JSON.parse(JSON.stringify(next))).crownOfAges, true);
  const old = JSON.parse(JSON.stringify(s));
  delete old.crownOfAges;
  delete old.ascension;
  const clean = sanitizeSave(old);
  assert.equal(clean.crownOfAges, false);
  assert.equal(clean.ascension, 0);
});

test('Ascension: cumulative mods folded into edictMods, the choice gated by the crown, the Legacy reward', () => {
  assert.deepEqual(ascensionMods(0), {});
  assert.equal(ascensionMods(1).enemyGarrisonMult, 1.1);
  const top = ascensionMods(10);
  for (const step of ASCENSION.ladder) for (const k of Object.keys(step.mods)) assert.ok(k in top, `level 10 has ${k}`);
  assert.ok(Math.abs(top.hazardIntervalMult - 2 / 3) < 1e-9 && top.enemySpeedMult === 1.1 && top.boonHardOnly === true);
  assert.equal(ascensionMods(4).boonHardOnly, undefined);
  const { s, w } = d6State();
  assert.equal(maxAscensionChoice(s), 0, 'locked before the ending');
  assert.equal(foundDynasty(s, 5, undefined, w, { ascension: 3 }).ascension, 0);
  s.generals.crowned = { v: 1, year: 2, dynasty: 7, t: 0, times: 1 };
  assert.equal(maxAscensionChoice(s), 1);
  s.generals.ascension = { v: 1, highest: 4 };
  assert.equal(cleanAscensionChoice(s, 9), 5);
  const next = foundDynasty(s, 5, undefined, w, { ascension: 5 });
  assert.equal(next.ascension, 5);
  assert.equal(edictMods(next).enemyGarrisonMult, 1.1);
  assert.equal(edictMods(next).raidGraceMult, 0.5);
  assert.equal(edictMods(next).boonHardOnly, true);
  assert.equal(ascensionLegacyMult(next), 1 + 5 * ASCENSION.legacyPerLevel);
  next.owner = next.owner.map(() => 0);
  const plain = legacyPointsForFounding({ ...next, ascension: 0 });
  assert.equal(legacyPointsForFounding(next), Math.round(plain * 2.25));
  const info = ascensionInfo(next);
  assert.equal(info.unlocked, true);
  assert.equal(info.level, 5);
  assert.equal(info.ladder.length, 10);
  assert.ok(info.ladder.every((x) => typeof x.text === 'string' && !x.text.includes('{')), info.ladder.map((x) => x.text).join(' | '));
  assert.match(info.ladder[3].text, /150 s/);
  assert.match(info.ladder[5].text, /75/);
  assert.equal(info.ladder[4].open, true);
  assert.equal(info.ladder[5].open, false, "one above the highest cleared (4) is 5");
});

test('Ascension consumers: the raid grace, Lean Fortunes, Long Memories, enemy speed', () => {
  const region = { isCapital: true, type: null };
  assert.equal(winDrafts(region, 'Fair'), true);
  assert.equal(winDrafts(region, 'Fair', true), false);
  assert.equal(winDrafts(region, 'Hard', true), true);
  const { s } = d6State();
  s.frontier.activeSec = 11 * 60;
  assert.equal(inGrace(s), true);
  s.ascension = 2;
  s.generals.crowned = { v: 1, year: 1, dynasty: 7, t: 0, times: 1 };
  assert.equal(inGrace(s), false, 'half the 20-minute grace');
  s.ascension = 6;
  s.grudges = undefined;
  const g = addGrudge(s, 2, 76, 0);
  assert.equal(g.crossed, 'vendetta', 'a Vendetta at 75 Grudge');
});

test('the ending: the crowned marker once, the deed, the record and the title line', () => {
  const { s, w } = d6State();
  s.dynasty.level = 7;
  s.edict = { v: 1, id: 'ageOfIron', challenges: [], scoutsUsed: 0 };
  s.chronicle.startedAt = 0;
  noteReign(s);
  assert.equal(crownLine(s), null);
  const day = 86400000;
  const r1 = onThroneToppled(s, w, 2.5 * day);
  assert.equal(r1.first, true);
  assert.equal(s.generals.crowned.dynasty, 7);
  assert.ok(s.generals.crowned.year >= 1);
  assert.ok(r1.deeds.some((d) => d.id === 'crownOfAges'));
  assert.match(crownLine(s), /^Crowned in Year \d+$/);
  const r2 = onThroneToppled(s, w, 3 * day);
  assert.equal(r2.first, false);
  assert.equal(s.generals.crowned.times, 2);
  const rec = endingRecord(s, { challengeRecord: { daily: { 20261001: { best: { met: true, sec: 431, crowns: 3 } } } } });
  assert.equal(rec.dynasties, 7);
  assert.deepEqual(rec.edicts.map((e) => e.id), ['ageOfIron']);
  assert.ok(rec.generals.length >= 1 && rec.generals[0].title);
  assert.deepEqual(rec.bestDaily, { date: 20261001, sec: 431, crowns: 3 });
  assert.ok(rec.lines.some((l) => /7:11/.test(l)), rec.lines.join(' | '));
  assert.equal(rec.credits.line, 'made with Claude');
  const saved = sanitizeSave(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(saved.generals.crowned, s.generals.crowned);
  assert.deepEqual(saved.generals.reign, s.generals.reign);
});

test('the Usurper-King speaks every trigger; the Throne lines are short; the card names the Throne', () => {
  for (const t of LEADER_TRIGGERS) assert.ok(LEADER_LINES[USURPER_FACTION][t].length >= 4, t);
  for (const [k, lines] of Object.entries(THRONE_LINES)) {
    assert.ok(lines.length >= 3, k);
    for (const l of lines) assert.ok(l.length <= VOICE.maxLineChars && !l.includes('{'), l);
  }
  const w = generateWorld(3, { dynasty: 7, crownOfAges: true });
  const s = createGame(3, w, 0);
  const lines = throneLines(s, w, w.crown.throne);
  assert.equal(lines.length, 2);
  assert.deepEqual(throneLines(s, w, w.startRegion), []);
});

test('conquer: the Throne crowns the realm (and may found anew at once); a whole continent clears its Ascension once', async () => {
  const { conquer, canFoundDynasty } = await import('../meta/progression.js');
  const w = generateWorld(5, { dynasty: 7, crownOfAges: true });
  const s = createGame(5, w, 0);
  s.dynasty.level = 7;
  s.crownOfAges = true;
  s.ascension = 2;
  s.generals.ascension = { v: 1, highest: 1 };
  s.generals.crowned = { v: 1, year: 1, dynasty: 7, t: 0, times: 1 };
  assert.equal(canFoundDynasty(s, w), false);
  const r = conquer(s, w, w.crown.throne, 1000);
  assert.ok(r.crowned && r.crowned.first === false && s.generals.crowned.times === 2);
  assert.deepEqual({ level: r.ascension.level, highest: r.ascension.highest }, { level: 2, highest: 2 });
  assert.equal(canFoundDynasty(s, w), true, 'found anew after the ending');
  const other = w.regions.find((x) => s.owner[x.id] !== 0);
  assert.equal(conquer(s, w, other.id, 2000).ascension, undefined, 'reported once');
  // a plain continent at Ascension 3: the last region taken clears it
  const w2 = generateWorld(9, { dynasty: 4 });
  const s2 = createGame(9, w2, 0);
  s2.dynasty.level = 4;
  s2.ascension = 3;
  const left = w2.regions.filter((x) => s2.owner[x.id] !== 0 && x.type !== 'dragon').map((x) => x.id);
  for (const id of left.slice(0, -1)) assert.equal(conquer(s2, w2, id, 1).ascension, undefined);
  const last = conquer(s2, w2, left[left.length - 1], 2);
  assert.equal(last.ascension.highest, 3);
  assert.ok(last.ascension.deeds.some((d) => d.id === 'ascendant'));
});
