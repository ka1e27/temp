import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  leaderFor, hasLeader, createVoiceRng, pickLine, renderLine, createVoiceGate, createLeaderVoice,
  newContacts, markMet, seedContacts,
} from '../meta/leaders.js';
import { LEADERS, LEADER_LINES, LEADER_TRIGGERS, LEADER_FACTIONS, VOICE } from '../config/leaders.js';
import { makeWorld, makeGame } from './meta.fixtures.js';
import { conquer } from '../meta/progression.js';
import { FACTIONS } from '../config/world.js';

const TITLES = { 1: 'Reeve', 2: 'Warlord', 3: 'High Seer', 4: 'Khan', 5: 'Margrave' }; // 5: the Ashen Host (PLAN-PHASE6)

// --- leaders ----------------------------------------------------------------------------

test('titles are fixed per faction (DESIGN §3.6)', () => {
  for (const f of LEADER_FACTIONS) assert.equal(leaderFor(9, 1, f).title, TITLES[f]);
  assert.equal(TITLES[2], 'Warlord');
  assert.equal(FACTIONS[2].name, 'Crimson Legion');
  assert.equal(FACTIONS[3].name, 'Violet Covenant');
  assert.equal(FACTIONS[4].name, 'Amber Horde');
  assert.equal(FACTIONS[1].name, 'Free Folk');
});

test('leaderFor: shape, fullName and no leader for the player realm', () => {
  const l = leaderFor(42, 1, 2);
  assert.deepEqual(Object.keys(l).sort(), ['faction', 'fullName', 'name', 'title']);
  assert.equal(l.faction, 2);
  assert.equal(l.fullName, `Warlord ${l.name}`);
  assert.equal(leaderFor(42, 1, 0), null);
  assert.equal(leaderFor(42, 1, 9), null);
  assert.equal(leaderFor(42, 1, undefined), null);
  assert.equal(hasLeader(0), false);
  assert.equal(hasLeader(3), true);
});

test('leaderFor: deterministic, and names are clean single words', () => {
  for (let seed = 1; seed <= 300; seed++) {
    for (const f of LEADER_FACTIONS) {
      const a = leaderFor(seed, 1, f);
      assert.deepEqual(leaderFor(seed, 1, f), a);
      assert.match(a.name, /^[A-Z][a-z]{3,8}$/, `"${a.name}"`);
    }
  }
});

test('leaderFor: the name changes with every dynasty (same seed) and with the seed', () => {
  for (let seed = 1; seed <= 200; seed++) {
    for (const f of LEADER_FACTIONS) {
      for (let d = 1; d <= 4; d++) {
        assert.notEqual(leaderFor(seed, d, f).name, leaderFor(seed, d + 1, f).name, `seed ${seed} f${f} d${d}`);
      }
    }
  }
  const names = new Set();
  for (let seed = 1; seed <= 200; seed++) names.add(leaderFor(seed, 1, 2).name);
  assert.ok(names.size > 60, `only ${names.size} distinct Crimson names over 200 seeds`);
});

test('leaderFor: the four leaders of one continent never share a name', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const names = LEADER_FACTIONS.map((f) => leaderFor(seed, 1, f).name);
    assert.equal(new Set(names).size, LEADER_FACTIONS.length, names.join(','));
  }
});

// --- the writing -------------------------------------------------------------------------

test('config: every faction has 4-6 lines for every trigger, and no strays', () => {
  assert.deepEqual([...LEADER_FACTIONS], [1, 2, 3, 4, 5]);
  assert.equal(LEADER_TRIGGERS.length, 19);
  assert.ok(LEADER_TRIGGERS.includes('scouted') && LEADER_TRIGGERS.includes('sabotaged'), 'DESIGN §5.7 triggers');
  for (const t of ['grudge', 'vendetta', 'vendettaWon', 'vendettaLost', 'plague', 'merchant', 'duelWon', 'duelLost']) {
    assert.ok(LEADER_TRIGGERS.includes(t), `PLAN-PHASE4 trigger ${t}`);
  }
  assert.deepEqual(Object.keys(LEADER_LINES).map(Number).sort(), [1, 2, 3, 4, 5]);
  for (const f of LEADER_FACTIONS) {
    assert.deepEqual(Object.keys(LEADER_LINES[f]).sort(), [...LEADER_TRIGGERS].sort(), `faction ${f} trigger set`);
    for (const t of LEADER_TRIGGERS) {
      const n = LEADER_LINES[f][t].length;
      assert.ok(n >= 4 && n <= 6, `faction ${f} ${t} has ${n} lines`);
    }
  }
});

test('config: lines are short, tidy and use only {name} / {region}', () => {
  for (const f of LEADER_FACTIONS) {
    const longestName = Math.max(...Array.from({ length: 300 }, (_, i) => leaderFor(i + 1, 1, f).name.length));
    for (const t of LEADER_TRIGGERS) {
      for (const line of LEADER_LINES[f][t]) {
        const where = `f${f} ${t}: "${line}"`;
        assert.ok(line.length <= VOICE.maxLineChars, `${where} is ${line.length} chars`);
        assert.ok(line.length >= 12, where);
        assert.ok(!/\s{2,}/.test(line) && line === line.trim(), `${where} whitespace`);
        assert.ok(/[.!?]$/.test(line), `${where} should end with punctuation`);
        const keys = [...line.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
        for (const k of keys) assert.ok(k === 'name' || k === 'region', `${where} unknown {${k}}`);
        // worst case once names are filled in: still one comfortable banner line pair
        const worst = renderLine(line, { name: 'N'.repeat(longestName), region: 'R'.repeat(VOICE.maxRegionChars) });
        assert.ok(worst.length <= VOICE.maxLineChars + 12, `${where} worst case ${worst.length} chars`);
      }
    }
  }
});

test('config: no line is used twice, anywhere', () => {
  const seen = new Map();
  for (const f of LEADER_FACTIONS) {
    for (const t of LEADER_TRIGGERS) {
      for (const line of LEADER_LINES[f][t]) {
        const k = line.toLowerCase();
        assert.ok(!seen.has(k), `"${line}" (f${f} ${t}) repeats ${seen.get(k)}`);
        seen.set(k, `f${f} ${t}`);
      }
    }
  }
});

test('config: the lead\'s tone examples are not reused verbatim', () => {
  const banned = [
    'Your banner will make fine kindling.',
    'The stars foretold this. They did not say you would keep it.',
    "Run home! We'll race you there.",
    "We've a harvest to bring in, and now this.",
    'Who let the goats into the granary?!',
    'Look closely. The stars are looking back.',
  ].map((s) => s.toLowerCase());
  for (const f of LEADER_FACTIONS) {
    for (const t of LEADER_TRIGGERS) {
      for (const line of LEADER_LINES[f][t]) assert.ok(!banned.includes(line.toLowerCase()), line);
    }
  }
});

test('config: every pool still has 2+ lines that need no placeholder (callers may omit region)', () => {
  for (const f of LEADER_FACTIONS) {
    for (const t of LEADER_TRIGGERS) {
      const plain = LEADER_LINES[f][t].filter((l) => !l.includes('{'));
      assert.ok(plain.length >= 2, `f${f} ${t}`);
    }
  }
});

test('config: names come from syllable tables, titles from LEADERS', () => {
  for (const f of LEADER_FACTIONS) {
    assert.equal(LEADERS[f].title, TITLES[f]);
    for (const k of ['onset', 'mid', 'coda']) assert.ok(LEADERS[f][k].length >= 4);
  }
});

// --- pickLine ------------------------------------------------------------------------------

test('pickLine: deterministic for the same rng state and different for other seeds', () => {
  const run = (seed) => {
    const rng = createVoiceRng(seed);
    return Array.from({ length: 12 }, () => pickLine(2, 'battleStart', rng, { name: 'Korash', region: 'Ashmere' }));
  };
  assert.deepEqual(run(5), run(5));
  assert.notDeepEqual(run(5), run(6));
});

test('pickLine: never the same line twice in a row, for every faction and trigger', () => {
  for (const f of LEADER_FACTIONS) {
    for (const t of LEADER_TRIGGERS) {
      const rng = createVoiceRng(f * 100 + 7);
      let prev = null;
      for (let i = 0; i < 80; i++) {
        const line = pickLine(f, t, rng, { name: 'Korash', region: 'Ashmere' });
        assert.notEqual(line, prev, `f${f} ${t} repeated at draw ${i}`);
        prev = line;
      }
    }
  }
});

test('pickLine: eventually reaches every line of a pool', () => {
  const rng = createVoiceRng(3);
  const got = new Set();
  for (let i = 0; i < 200; i++) got.add(pickLine(4, 'playerRetreat', rng, { name: 'Zekshi', region: 'X' }));
  assert.equal(got.size, LEADER_LINES[4].playerRetreat.length);
});

test('pickLine: fills {name} and {region}; never leaves a brace behind', () => {
  const rng = createVoiceRng(11);
  let sawName = false;
  let sawRegion = false;
  for (const f of LEADER_FACTIONS) {
    for (const t of LEADER_TRIGGERS) {
      for (let i = 0; i < 30; i++) {
        const line = pickLine(f, t, rng, { name: 'Korash', region: 'Ashmere' });
        assert.ok(!/[{}]/.test(line), line);
        sawName ||= line.includes('Korash');
        sawRegion ||= line.includes('Ashmere');
      }
    }
  }
  assert.ok(sawName && sawRegion, 'placeholder lines do get picked and filled');
});

test('pickLine: without a region, lines that need one are skipped', () => {
  for (const f of LEADER_FACTIONS) {
    for (const t of LEADER_TRIGGERS) {
      const rng = createVoiceRng(1);
      for (let i = 0; i < 40; i++) {
        const line = pickLine(f, t, rng, { name: 'Korash' });
        assert.ok(!line.includes('{region}') && !LEADER_LINES[f][t].some((l) => l === line && l.includes('{region}')), line);
      }
    }
  }
  assert.equal(pickLine(2, 'firstContact', createVoiceRng(1), {}) !== null, true);
});

test('pickLine: unknown faction or trigger gives null; the state is plain JSON', () => {
  const rng = createVoiceRng(2);
  assert.equal(pickLine(0, 'battleStart', rng, { name: 'x' }), null);
  assert.equal(pickLine(2, 'nonsense', rng, { name: 'x' }), null);
  pickLine(2, 'battleStart', rng, { name: 'Korash' });
  assert.deepEqual(JSON.parse(JSON.stringify(rng)), rng);
  assert.equal(rng.draws, 1);
});

// --- the gate --------------------------------------------------------------------------------

const ctx = (nowSec, extra = {}) => ({ nowSec, ...extra });

test('gate: at most one line per trigger per battle, until resetBattle()', () => {
  const gate = createVoiceGate();
  assert.equal(gate.request('battleStart', ctx(0)), true);
  assert.deepEqual(gate.check('battleStart', ctx(100)), { ok: false, reason: 'repeat' });
  assert.equal(gate.request('keepAssaulted', ctx(100)), true, 'a different trigger is fine once the gap has passed');
  gate.resetBattle();
  assert.equal(gate.request('battleStart', ctx(200)), true);
});

test('gate: at least 15 s between any two lines (default), configurable', () => {
  const gate = createVoiceGate();
  assert.equal(gate.minGapSec, 15);
  assert.equal(VOICE.minGapSec, 15);
  assert.equal(gate.request('battleStart', ctx(10)), true);
  assert.deepEqual(gate.check('keepAssaulted', ctx(24.9)), { ok: false, reason: 'gap' });
  assert.deepEqual(gate.check('keepAssaulted', ctx(25)), { ok: true, reason: null });
  const quick = createVoiceGate({ minGapSec: 3 });
  quick.request('battleStart', ctx(0));
  assert.equal(quick.check('playerRetreat', ctx(2.9)).ok, false);
  assert.equal(quick.check('playerRetreat', ctx(3)).ok, true);
});

test('gate: blocked while a tutorial hint is visible, and when the setting is off', () => {
  const gate = createVoiceGate();
  assert.deepEqual(gate.check('battleStart', ctx(0, { tutorialVisible: true })), { ok: false, reason: 'tutorial' });
  assert.deepEqual(gate.check('battleStart', ctx(0, { enabled: false })), { ok: false, reason: 'disabled' });
  // a blocked request records nothing: the trigger can still speak once the hint is gone
  assert.equal(gate.request('battleStart', ctx(0, { tutorialVisible: true })), false);
  assert.equal(gate.request('battleStart', ctx(1)), true);
});

test('gate: reasons are reported in a fixed order (setting, tutorial, repeat, gap)', () => {
  const gate = createVoiceGate();
  gate.request('battleStart', ctx(0));
  assert.equal(gate.check('battleStart', ctx(1, { enabled: false, tutorialVisible: true })).reason, 'disabled');
  assert.equal(gate.check('battleStart', ctx(1, { tutorialVisible: true })).reason, 'tutorial');
  assert.equal(gate.check('battleStart', ctx(1)).reason, 'repeat');
  assert.equal(gate.check('playerRetreat', ctx(1)).reason, 'gap');
});

test('gate: gapExempt triggers skip the gap check but still start a new gap; default exempts the payoff lines', () => {
  assert.deepEqual([...VOICE.gapExempt], ['keepLost', 'decapitation', 'vendetta']); // + the Vendetta oath (PLAN-PHASE4)
  const gate = createVoiceGate({ gapExempt: ['keepLost'] });
  gate.request('keepAssaulted', ctx(10));
  assert.equal(gate.check('battleStart', ctx(12)).reason, 'gap');
  assert.equal(gate.request('keepLost', ctx(12)), true, 'exempt trigger speaks inside the gap');
  assert.equal(gate.check('playerDefeat', ctx(20)).reason, 'gap', 'and it restarts the gap for everyone else');
  assert.equal(gate.check('keepLost', ctx(30)).reason, 'repeat', 'once per battle still holds');
});

test('gate: resetBattle keeps the gap clock; reset() forgets it', () => {
  const gate = createVoiceGate();
  gate.request('battleStart', ctx(50));
  gate.resetBattle();
  assert.equal(gate.check('battleStart', ctx(55)).reason, 'gap');
  gate.reset();
  assert.equal(gate.check('battleStart', ctx(55)).ok, true);
});

test('gate: scope splits a trigger (one surrender line per region, one contact per faction)', () => {
  const gate = createVoiceGate({ minGapSec: 0 });
  assert.equal(gate.request('surrenderOffer', ctx(0, { scope: 4 })), true);
  assert.equal(gate.request('surrenderOffer', ctx(1, { scope: 4 })), false);
  assert.equal(gate.request('surrenderOffer', ctx(2, { scope: 5 })), true);
});

test('gate: a clock that jumps backwards never locks it forever; state is plain JSON', () => {
  const gate = createVoiceGate();
  gate.request('battleStart', ctx(1000));
  assert.equal(gate.check('keepLost', ctx(3)).ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(gate.state)), gate.state);
});

// --- the wired-up voice ------------------------------------------------------------------------

test('createLeaderVoice: say() returns the finished line once, honours the gate and the setting', () => {
  const world = makeWorld();
  const state = makeGame(world);
  const voice = createLeaderVoice({ getState: () => state });
  const line = voice.say('battleStart', { faction: 2, region: 'Ashport', nowSec: 0 });
  assert.equal(line.trigger, 'battleStart');
  assert.equal(line.faction, 2);
  assert.equal(line.title, 'Warlord');
  assert.equal(line.name, leaderFor(state.seed, state.dynasty.level, 2).name);
  assert.equal(line.fullName, `Warlord ${line.name}`);
  assert.ok(LEADER_LINES[2].battleStart.some((tpl) => renderLine(tpl, { name: line.name, region: 'Ashport' }) === line.line));
  assert.equal(voice.say('battleStart', { faction: 2, region: 'Ashport', nowSec: 30 }), null, 'once per battle');
  voice.resetBattle();
  assert.notEqual(voice.say('battleStart', { faction: 2, region: 'Ashport', nowSec: 30 }), null);
  assert.equal(voice.say('playerRetreat', { faction: 2, region: 'Ashport', nowSec: 35 }), null, '15 s gap');
  assert.notEqual(voice.say('playerRetreat', { faction: 2, region: 'Ashport', nowSec: 46 }), null);
  assert.notEqual(voice.say('keepLost', { faction: 2, region: 'Ashport', nowSec: 47 }), null, 'payoff line skips the gap');

  state.settings.leaderVoices = false;
  assert.equal(voice.say('keepAssaulted', { faction: 2, region: 'Ashport', nowSec: 99 }), null);
  state.settings.leaderVoices = true;
  assert.equal(voice.say('keepAssaulted', { faction: 2, region: 'Ashport', nowSec: 99, tutorialVisible: true }), null);
  assert.notEqual(voice.say('keepAssaulted', { faction: 2, region: 'Ashport', nowSec: 99 }), null);
});

test('createLeaderVoice: the player realm has no voice; a blocked say records nothing', () => {
  const state = makeGame(makeWorld());
  const voice = createLeaderVoice({ getState: () => state });
  assert.equal(voice.say('battleStart', { faction: 0, nowSec: 0 }), null);
  assert.equal(voice.canSay('battleStart', { nowSec: 0 }).ok, true);
  assert.equal(voice.say('battleStart', { faction: 3, nowSec: 0, tutorialVisible: true }), null);
  assert.notEqual(voice.say('battleStart', { faction: 3, nowSec: 1 }), null);
});

test('createLeaderVoice: a new dynasty means new names', () => {
  const state = makeGame(makeWorld());
  const voice = createLeaderVoice({ getState: () => state });
  const first = voice.say('firstContact', { faction: 2, nowSec: 0 });
  state.seed = 777;
  state.dynasty.level = 2;
  const second = voice.say('keepLost', { faction: 2, region: 'Ashport', nowSec: 100 });
  assert.notEqual(first.name, second.name);
});

// --- first contact -------------------------------------------------------------------------------

test('newContacts: the frontier factions you have not met, lowest tier first, one per faction', () => {
  const world = makeWorld(); // 0 mine; 1,2 Free Folk tier 1; 3 Crimson capital t2; 4 Crimson t2; 5 Violet t3
  const state = makeGame(world);
  assert.deepEqual(newContacts(state, world), [{ faction: 1, regionId: 1 }]);
  conquer(state, world, 1, 0);
  // region 1 borders 3 (Crimson) and region 2 (still Free Folk, adjacent to my region 0)
  assert.deepEqual(newContacts(state, world), [{ faction: 1, regionId: 2 }, { faction: 2, regionId: 3 }]);
  assert.equal(markMet(state, 1), true);
  assert.equal(markMet(state, 1), false);
  assert.deepEqual(newContacts(state, world), [{ faction: 2, regionId: 3 }]);
  assert.deepEqual(state.metFactions, [1]);
});

test('seedContacts: your starting neighbours are known, later factions are new', () => {
  const world = makeWorld();
  const state = makeGame(world);
  assert.deepEqual(seedContacts(state, world), [1]);
  assert.deepEqual(newContacts(state, world), []);
  conquer(state, world, 1, 0);
  assert.deepEqual(newContacts(state, world), [{ faction: 2, regionId: 3 }]);
});

test('markMet: creates the list on a state that predates it', () => {
  const state = makeGame(makeWorld());
  delete state.metFactions;
  assert.equal(markMet(state, 4), true);
  assert.deepEqual(state.metFactions, [4]);
  assert.deepEqual(newContacts(state, makeWorld()).map((c) => c.faction), [1]);
});

// --- purity ----------------------------------------------------------------------------------------

test('purity: leaders.js and config/leaders.js never touch DOM, time, randomness or storage', () => {
  for (const rel of ['../meta/leaders.js', '../config/leaders.js']) {
    const src = readFileSync(new URL(rel, import.meta.url), 'utf8')
      .replace(/\/\/.*$/gm, '').replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, "''");
    for (const banned of ['document', 'window', 'Math.random', 'Date.now', 'performance', 'localStorage', 'requestAnimationFrame']) {
      assert.ok(!src.includes(banned), `${rel} mentions ${banned}`);
    }
  }
});
