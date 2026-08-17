// THE SPECIALIST CALLOUTS (meta/specialists.js) — advisory text only, derived
// off the region table rather than authored per row. Every assertion here runs
// against the REAL `REGIONS` table rather than a hand-built fixture, because a
// fixture that encodes the bug is this project's most-repeated failure mode:
// a hand-picked "wall-heavy region" object would still pass if the derivation
// keyed on the wrong field entirely.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createState } from '../src/core/store.js';
import { buy } from '../src/meta/upgrades.js';
import { regionBrief } from '../src/screens/prebattle-brief.js';
import {
  specialistCallouts, WALL_DEVELOP_MIN, WALL_FORTS_MIN, OPEN_NEUTRAL_SHARE_MIN,
} from '../src/meta/specialists.js';
import { REGIONS, REGION_BY_ID, totalSites } from '../src/content/regions.data.js';
import { SITES, UNITS } from '../src/content/balance.js';

const bareMeta = () => createState({ seed: 1, now: 0 }).meta;
const richMeta = () => {
  const meta = createState({ seed: 2, now: 0 }).meta;
  meta.crowns = 1e9;
  return meta;
};

// The two structural predicates, re-derived from the SAME exported thresholds
// the module uses — never a second copy of "2" and "0.5" typed by hand — so
// this stays an oracle test rather than a fixture even as regions.data.js is
// re-tuned out from under it.
const isWallHeavy = (r) => r.develop >= WALL_DEVELOP_MIN && r.siteCounts.enemyMix.forts >= WALL_FORTS_MIN;
const isOpenGround = (r) => r.siteCounts.neutral / totalSites(r) >= OPEN_NEUTRAL_SHARE_MIN;

test('specialists: the distribution is not noise — some regions fire, some do not', () => {
  const meta = bareMeta();
  const fired = REGIONS.filter((r) => specialistCallouts(meta, r).length > 0);
  assert.ok(fired.length > 0, 'nothing ever fires — the derivation is dead');
  assert.ok(fired.length < REGIONS.length,
    `fires on all ${REGIONS.length} regions — a callout that never says nothing is noise`);
  // The negative control by name is worth pinning too: an early, small,
  // undeveloped region is exactly the "genuinely unremarkable" case CLAUDE.md
  // asks this feature to stay silent on.
  assert.deepEqual(specialistCallouts(meta, REGION_BY_ID.riverfen), []);
});

test('specialists: archers are never a callout, on any region', () => {
  const meta = bareMeta();
  for (const r of REGIONS) {
    for (const c of specialistCallouts(meta, r)) {
      assert.notEqual(c.unit, 'archers', `${r.id} advises archers — there is no authored signal for that`);
      assert.ok(['halberds', 'sappers', 'outriders'].includes(c.unit), `${r.id}: unknown unit ${c.unit}`);
    }
  }
});

test('specialists: wall-heavy fires exactly where develop and enemyMix.forts say it should', () => {
  const meta = bareMeta();
  for (const r of REGIONS) {
    const ids = specialistCallouts(meta, r).map((c) => c.id);
    const wants = isWallHeavy(r);
    assert.equal(ids.includes('wallHalberds'), wants, `${r.id} halberds callout disagrees with the signal`);
    assert.equal(ids.includes('wallSappers'), wants, `${r.id} sappers callout disagrees with the signal`);
  }
  // And the signal itself has to actually discriminate, or the assertion above
  // is vacuous — some regions on each side of the bar.
  assert.ok(REGIONS.some(isWallHeavy));
  assert.ok(REGIONS.some((r) => !isWallHeavy(r)));
});

test('specialists: open-ground fires exactly where the neutral share says it should', () => {
  const meta = bareMeta();
  for (const r of REGIONS) {
    const ids = specialistCallouts(meta, r).map((c) => c.id);
    assert.equal(ids.includes('openOutriders'), isOpenGround(r), `${r.id} outrider callout disagrees with the signal`);
  }
  assert.ok(REGIONS.some(isOpenGround));
  assert.ok(REGIONS.some((r) => !isOpenGround(r)));
});

test('specialists: gated on the unlock, not suppressed by it — the region still speaks up', () => {
  const wallRegion = REGIONS.find(isWallHeavy);
  assert.ok(wallRegion, 'no region is wall-heavy — nothing below can be tested');

  const before = specialistCallouts(bareMeta(), wallRegion).find((c) => c.id === 'wallHalberds');
  assert.ok(before, 'the callout vanished instead of nudging toward the unlock');
  assert.equal(before.unlocked, false);
  assert.match(before.note, /Unlock in the shop\.$/);

  const owns = richMeta();
  buy(owns, 'unlockHalberds', null);
  const after = specialistCallouts(owns, wallRegion).find((c) => c.id === 'wallHalberds');
  assert.ok(after, 'buying the unlock made the callout disappear');
  assert.equal(after.unlocked, true);
  assert.doesNotMatch(after.note, /Unlock in the shop/, 'still nudging toward an unlock already owned');
});

test('specialists: unlocked or not, the note never claims the wrong thing', () => {
  // A universal sweep rather than one region: every fired callout on the whole
  // table, under "owns nothing" and "owns everything", must agree with its own
  // `unlocked` flag about whether it points at the shop.
  const nothing = bareMeta();
  const everything = richMeta();
  for (const id of ['unlockHalberds', 'unlockSappers', 'unlockOutriders']) buy(everything, id, null);

  for (const r of REGIONS) {
    for (const c of specialistCallouts(nothing, r)) {
      assert.equal(c.unlocked, false);
      assert.match(c.note, /Unlock in the shop\.$/, `${r.id}/${c.id} owns nothing but reads as owned`);
    }
    for (const c of specialistCallouts(everything, r)) {
      assert.equal(c.unlocked, true);
      assert.doesNotMatch(c.note, /Unlock in the shop/, `${r.id}/${c.id} owns everything but still nudges`);
    }
  }
});

test('specialists: every number in the copy is read off the real tables, not retyped', () => {
  const meta = richMeta();
  for (const id of ['unlockHalberds', 'unlockSappers', 'unlockOutriders']) buy(meta, id, null);
  const wallRegion = REGIONS.find(isWallHeavy);
  const openRegion = REGIONS.find(isOpenGround);

  const wallNotes = specialistCallouts(meta, wallRegion);
  const halberds = wallNotes.find((c) => c.id === 'wallHalberds');
  assert.ok(halberds.note.includes(`×${SITES.stronghold.defMult}`),
    'halberd copy is not reading SITES.stronghold.defMult');
  assert.ok(halberds.note.includes(String(wallRegion.siteCounts.enemyMix.forts)),
    'halberd copy is not reading this region’s own fort count');
  const sappers = wallNotes.find((c) => c.id === 'wallSappers');
  assert.ok(sappers.note.includes(`×${UNITS.sappers.repair}`),
    'sapper copy is not reading UNITS.sappers.repair');

  const outriders = specialistCallouts(meta, openRegion).find((c) => c.id === 'openOutriders');
  const ratio = Math.round(UNITS.outriders.speed / UNITS.militia.speed);
  assert.ok(outriders.note.includes(`${ratio}×`), 'outrider copy is not reading the real speed ratio');
});

test('specialists: pure — same inputs, same answer, and nothing is mutated', () => {
  const meta = bareMeta();
  const region = REGIONS.find(isWallHeavy);
  const before = JSON.stringify(region);
  const a = specialistCallouts(meta, region);
  const b = specialistCallouts(meta, region);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(region), before, 'the region row was mutated');
});

test('specialists: a region with no siteCounts.enemyMix answers with nothing, not a throw', () => {
  const meta = bareMeta();
  assert.deepEqual(specialistCallouts(meta, { id: 'fixture', develop: 5 }), []);
  assert.deepEqual(specialistCallouts(meta, null), []);
});

test('specialists: regionBrief carries the same callouts the pure derivation returns', () => {
  const meta = bareMeta();
  const wallRegion = REGIONS.find(isWallHeavy);
  const quietRegion = REGIONS.find((r) => !isWallHeavy(r) && !isOpenGround(r));

  assert.deepEqual(
    regionBrief(meta, wallRegion.id).callouts,
    specialistCallouts(meta, wallRegion),
  );
  assert.deepEqual(
    regionBrief(meta, quietRegion.id).callouts,
    specialistCallouts(meta, quietRegion),
  );
  assert.deepEqual(regionBrief(meta, quietRegion.id).callouts, []);
});
