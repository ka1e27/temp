// ADDING A TIER MEANT EDITING SIX TABLES IN FOUR FILES AND HOPING.
//
// A tier is not one thing in one place — it is a row in `HARD_CAP_MIN_BY_TIER`,
// `ENEMY_MARSHALS_BY_TIER`, `ENEMY_UNITS_BY_TIER`, `AI_TIERS`, the harness's
// `WIN_BAND`. Two of those failed on a
// missing row in ways nothing would have reported: `HARD_CAP_MIN_BY_TIER[6]` is
// `undefined`, so `Math.max(undefined, x)` is NaN and a tier-7 region would
// advertise a cap of NaN minutes; `WIN_BAND[6]` is `undefined` and the harness
// destructures it, so `npm run sim` would throw on the new tier and nowhere
// else. The other four clamped silently, which is its own problem — a tier-7
// region fought by tier 6's commander, reported as if that were intended.
//
// This file is the loud half of the fix. `content/tiers.js atTier` keeps the
// game RUNNING on a half-added tier; this names every table still short a row.
// TO ADD A TIER: raise `TIER_COUNT` and run this file. The failures are the work.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TIER_COUNT, tierIndex, atTier } from '../src/content/tiers.js';
import {
  HARD_CAP_MIN_BY_TIER, ENEMY_MARSHALS_BY_TIER, ENEMY_UNITS_BY_TIER, REGIONS,
} from '../src/content/regions.data.js';
import { AI_TIERS } from '../src/content/ai.data.js';

/** Every table a tier needs a row in, by the name a reader would search for. */
const TIER_TABLES = {
  HARD_CAP_MIN_BY_TIER,
  ENEMY_MARSHALS_BY_TIER,
  ENEMY_UNITS_BY_TIER,
  AI_TIERS,
};

test('every tier-indexed table has a row for every tier', () => {
  const short = Object.entries(TIER_TABLES)
    .filter(([, t]) => t.length !== TIER_COUNT)
    .map(([name, t]) => `${name} has ${t.length}, needs ${TIER_COUNT}`);
  assert.deepEqual(short, [],
    `TIER_COUNT is ${TIER_COUNT} and these disagree:\n  ${short.join('\n  ')}`);
});

test('...including the one that lives outside src/', () => {
  // `WIN_BAND` is the harness's verdict gate, and it is not importable from
  // here without dragging a CLI into the build — so it is read as SOURCE, which
  // is ugly and is still worth it, because it is exactly the row a tier author
  // forgets and the only one nothing else would check.
  //
  // `MAX_OPENING_RATIO` was on this list while drafting and is NOT a tier table
  // any more: the beachhead pass split it into a floor and a ceiling and
  // "retired the per-tier ladder, since one global ceiling fits again". Checked
  // rather than assumed — the draft asserted against a constant that no longer
  // exists, which is the staleness this whole file is meant to prevent.
  const count = (file, name) => {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const m = src.match(new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
    assert.ok(m, `${name} not found in ${file} — has it moved?`);
    // Count top-level entries by bracket depth, so nested pairs count once.
    let depth = 0; let n = m[1].trim() ? 1 : 0;
    for (const ch of m[1]) {
      if (ch === '[') depth++;
      else if (ch === ']') depth--;
      else if (ch === ',' && depth === 0) n++;
    }
    // A trailing comma at depth 0 over-counts by one.
    return /,\s*$/.test(m[1].trim()) ? n - 1 : n;
  };
  assert.equal(count('tools/simrunner.js', 'WIN_BAND'), TIER_COUNT,
    'tools/simrunner.js WIN_BAND is short a tier');
});

test('every shipped region names a tier the tables cover', () => {
  for (const r of REGIONS) {
    assert.ok(Number.isInteger(r.tier) && r.tier >= 1 && r.tier <= TIER_COUNT,
      `${r.id} is tier ${r.tier}, outside 1..${TIER_COUNT}`);
  }
});

test('...and the campaign actually USES every tier it declares', () => {
  // A tier with no regions is a table row nobody reads, which is how a stale
  // row survives a content cut. Not a hard rule of the engine — a rule about
  // the shipped campaign, which is what this file is for.
  const used = new Set(REGIONS.map((r) => r.tier));
  for (let t = 1; t <= TIER_COUNT; t++) {
    assert.ok(used.has(t), `no region is tier ${t}`);
  }
});

test('a tier beyond the tables degrades to the deepest one, never to NaN', () => {
  // The runtime half. A region authored at tier 7 before the tables catch up
  // must still produce a playable battle — the test above is what makes the
  // omission loud, and this is what stops it being a crash in the meantime.
  assert.equal(tierIndex(TIER_COUNT + 5), TIER_COUNT - 1);
  assert.equal(atTier(HARD_CAP_MIN_BY_TIER, TIER_COUNT + 5),
    HARD_CAP_MIN_BY_TIER[TIER_COUNT - 1]);
  assert.ok(Number.isFinite(atTier(HARD_CAP_MIN_BY_TIER, 99)));
});

test('...and below tier 1 too, including nonsense', () => {
  for (const bad of [0, -3, NaN, undefined, null, 'two']) {
    assert.equal(tierIndex(bad), 0, `tierIndex(${String(bad)})`);
    assert.ok(Number.isFinite(atTier(HARD_CAP_MIN_BY_TIER, bad)));
  }
});

test('an empty table answers undefined rather than throwing', () => {
  // `atTier` is called while building every battle config; a table that is
  // mid-edit must not take the whole game down.
  assert.equal(atTier([], 3), undefined);
  assert.equal(atTier(null, 3), undefined);
});

test('the marshal ladder never grants more banners at a lower tier', () => {
  // Not a table-length check but a shape one, and it is the rule a new tier is
  // most likely to break by copying the wrong row: the enemy's banners are
  // non-decreasing, like `enemyMult` and total sites.
  for (let i = 1; i < ENEMY_MARSHALS_BY_TIER.length; i++) {
    assert.ok(ENEMY_MARSHALS_BY_TIER[i] >= ENEMY_MARSHALS_BY_TIER[i - 1],
      `tier ${i + 1} grants fewer marshals than tier ${i}`);
  }
});

test('the hard-cap floor never shrinks as tiers deepen', () => {
  for (let i = 1; i < HARD_CAP_MIN_BY_TIER.length; i++) {
    assert.ok(HARD_CAP_MIN_BY_TIER[i] >= HARD_CAP_MIN_BY_TIER[i - 1],
      `tier ${i + 1} caps shorter than tier ${i}`);
  }
});
