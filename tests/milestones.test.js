// HONOURS: the table's own invariants, and the four ways this could ship broken
// while looking perfectly healthy.
//
// The negative controls are the point. A milestone layer fails silently in
// exactly four ways — a rung over a counter nobody increments, a rung nothing
// renders, a table whose order makes "next" offer the wrong goal, and a grant
// that quietly re-tunes the campaign. Each has a test below that FAILS on the
// broken version rather than passing just as happily.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { HONOURS, HONOUR_FORMAT } from '../src/content/milestones.data.js';
import { honourView, nextHonours, honourCount } from '../src/meta/milestones.js';
import { createStats } from '../src/core/store.js';

const STAT_KEYS = new Set(Object.keys(createStats()));
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('every rung names a real stat, and every stat has a format', () => {
  // The failure this catches is a typo: `stats.unitsKiled` reads undefined,
  // `num()` makes it 0, and the rung is simply never earned — by anyone, ever,
  // with nothing anywhere going red.
  assert.ok(HONOURS.length > 0);
  for (const h of HONOURS) {
    assert.ok(STAT_KEYS.has(h.stat), `${h.id} names "${h.stat}", not a createStats() key`);
    assert.ok(HONOUR_FORMAT[h.stat], `${h.stat} has no HONOUR_FORMAT entry`);
    assert.ok(Number.isFinite(h.need) && h.need > 0, `${h.id} needs a positive threshold`);
    assert.ok(h.title && h.note, `${h.id} is missing copy`);
  }
  // NEGATIVE CONTROL: the guard must actually reject a bad stat rather than
  // pass on anything handed to it.
  assert.equal(STAT_KEYS.has('unitsKiled'), false);
});

test('ids are unique, and each ladder ascends', () => {
  // ASCENDING IS LOAD-BEARING, not tidiness: `nextHonours` takes the FIRST
  // unearned row of each group, so an out-of-order table offers a plausible,
  // confident, wrong goal — the class of defect this project keeps finding.
  const ids = HONOURS.map((h) => h.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate honour id');
  const last = new Map();
  for (const h of HONOURS) {
    if (last.has(h.stat)) {
      assert.ok(h.need > last.get(h.stat), `${h.id} does not ascend within ${h.stat}`);
    }
    last.set(h.stat, h.need);
  }
});

test('a rung is earned at exactly its threshold, and not one short', () => {
  const h = HONOURS[0];
  const at = honourView({ [h.stat]: h.need }).rows.find((r) => r.id === h.id);
  const under = honourView({ [h.stat]: h.need - 1 }).rows.find((r) => r.id === h.id);
  assert.equal(at.done, true, 'the threshold itself must count');
  assert.equal(under.done, false, 'one short must not');
  assert.equal(at.progress, 1);
  assert.ok(under.progress < 1);
});

test('progress is clamped, so a screen never sizes a bar past 100%', () => {
  const h = HONOURS[0];
  const r = honourView({ [h.stat]: h.need * 10 }).rows.find((x) => x.id === h.id);
  assert.equal(r.progress, 1);
  assert.equal(r.have, h.need * 10, 'the raw count is still reported honestly');
});

test('a partial or hand-edited save cannot earn a rung', () => {
  // Same rule meta/record.js follows: `localStorage` is hand-editable and
  // `assertBattleConfig` is the shield on the battle side, but nothing
  // validates stats — so garbage must read as zero rather than as earned.
  for (const bad of [undefined, null, {}, { battles: NaN }, { battles: -5 },
    { battles: 'lots' }, { battles: Infinity }]) {
    const v = honourView(bad);
    assert.equal(v.earned, 0, `${JSON.stringify(bad)} earned something`);
  }
});

test('nextHonours offers the SMALLEST unearned rung of each ladder, once', () => {
  const first = nextHonours({});
  const stats = first.map((r) => r.stat);
  assert.equal(new Set(stats).size, stats.length, 'a ladder was offered twice');
  for (const r of first) {
    const rungs = HONOURS.filter((h) => h.stat === r.stat).map((h) => h.need);
    assert.equal(r.need, Math.min(...rungs), `${r.stat} offered the wrong rung`);
  }
  // ...and it advances rather than repeating once the first rung is taken.
  const h = HONOURS[0];
  const after = nextHonours({ [h.stat]: h.need });
  const moved = after.find((r) => r.stat === h.stat);
  assert.ok(moved, 'the ladder vanished instead of advancing');
  assert.ok(moved.need > h.need, 'the same rung was offered again');
});

test('a finished ladder contributes no goal, and a finished table none at all', () => {
  const all = {};
  for (const h of HONOURS) all[h.stat] = Math.max(all[h.stat] ?? 0, h.need);
  const v = honourView(all);
  assert.equal(v.earned, v.total, 'every rung should be earned');
  assert.deepEqual(nextHonours(all), [], 'a finished table must offer nothing');
});

test('the count is null on a fresh save and a number the moment anything happens', () => {
  // NULL RATHER THAN 0, the record.js rule: "0 / 20" in front of someone who
  // has not played is a scolding, not a goal.
  assert.equal(honourCount(createStats()), null);
  assert.equal(honourCount({}), null);
  const played = honourCount({ battles: 1 });
  assert.deepEqual(played, { earned: 0, total: HONOURS.length },
    'a player who HAS played gets a goal, even at zero earned');
});

test('every honour reaches a screen', () => {
  // The guard tests/offlinenotice.test.js applies to the IDLE strings, one
  // layer along: copy with no reader goes stale silently, and this table is
  // twenty entries of it. The render iterates, so what has to be proven is
  // that the iterating file is actually mounted by the drawer.
  const honours = read('../src/screens/mainmenu-honours.js');
  assert.match(honours, /honourView|nextHonours/, 'the block derives nothing');
  const drawer = read('../src/screens/mainmenu-record.js');
  assert.match(drawer, /honoursSection\(/, 'the drawer never mounts the block');
  const menu = read('../src/screens/mainmenu.js');
  assert.match(menu, /honourCount\(/, 'the menu never shows the tally');
});

test('AN HONOUR PAYS NOTHING, and that is what keeps it off the balance table', () => {
  // THE LOAD-BEARING TEST. Every win rate in regions.data.js is measured
  // without these; a grant would make the shipped game easier than the table
  // says and would have to be paid for. Asserted against the SOURCE, because
  // the claim is "no code reads this", which no fixture can demonstrate.
  const roots = ['../src/battle', '../src/meta', '../src/content', '../tools'];
  const offenders = [];
  for (const dir of roots) {
    const base = new URL(`${dir}/`, import.meta.url);
    for (const f of readdirSync(base)) {
      if (!f.endsWith('.js') || f === 'milestones.js' || f === 'milestones.data.js') continue;
      // An IMPORT, not a mention: content/strings.js names the table in a
      // comment, which is documentation rather than a reader.
      if (/^\s*import[^;]*from\s+'[^']*milestones(\.data)?\.js'/m
        .test(readFileSync(new URL(f, base), 'utf8'))) offenders.push(dir + '/' + f);
    }
  }
  assert.deepEqual(offenders, [],
    'a simulation, meta or harness file imports the honours table — an honour '
    + 'that grants anything re-tunes all 24 regions and must be measured first');
});
