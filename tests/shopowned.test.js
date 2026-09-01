// THE SHOP'S RECEIPT: what the levels a player already owns add up to.
//
// The shop stated a line's PER-LEVEL effect and never its total, so a player
// back after an absence read "Lv 6" and "+12% crowns per second" and had no way
// to know they were holding +72%. That total is the number an idle shop exists
// to report.
//
// THE NUMBERS ARE DERIVED, THE WORDS ARE AUTHORED, and this file pins the seam
// between them: `ownedEffects` multiplies an upgrade's own `effects` array by
// its own level, so a row cannot claim a bonus the engine does not apply, and
// content/effects.data.js only ever supplies a NAME. A key with no name is
// silently omitted — which is why the first test here walks every upgrade
// rather than a sample.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ownedEffects, upgradeEffects, levelOf } from '../src/meta/upgrades.js';
import { UPGRADES } from '../src/content/upgrades.data.js';
import { EFFECT_LABELS, UNIT_EFFECT } from '../src/content/effects.data.js';
import { timeToAfford } from '../src/meta/idle.js';
import { SHOP } from '../src/content/strings.js';
import { fromPersisted } from '../src/core/store.js';

const here = dirname(fileURLToPath(import.meta.url));
const metaAt = (upgrades) => Object.assign(fromPersisted(null).meta, { upgrades });

test('every effect key any upgrade uses has a name, so no bonus is omitted', () => {
  const missing = [];
  for (const u of UPGRADES) {
    for (const e of u.effects) {
      if (e.bucket === 'unlock' || e.bucket === 'unit') continue;
      if (!EFFECT_LABELS[e.key]) missing.push(`${u.id}.${e.key}`);
    }
  }
  assert.deepEqual(missing, [], 'these effects would vanish from the shop row');
  assert.ok(UNIT_EFFECT.label && UNIT_EFFECT.kind, 'the per-troop lines have no name');
});

test('EVERY upgrade survives being owned — the free-variable guard', () => {
  // The bug this exists for was a REFERENCE ERROR to an unimported constant
  // inside `ownedEffects`. It could only fire at level > 0, so the whole shop
  // rendered perfectly at level 0 and produced ZERO rows the moment anything
  // was bought — the screen mounted its header and silently lost its list, with
  // no exception reaching the console. A test that calls this for one upgrade
  // at one level would have caught it; a test that renders the shop at level 0
  // would not. So: every upgrade, at a level it can actually reach.
  for (const u of UPGRADES) {
    const meta = metaAt({ [u.id]: Math.min(3, u.maxLevel) });
    const got = ownedEffects(meta, u.id);
    assert.ok(Array.isArray(got), `${u.id} did not answer`);
    for (const e of got) {
      assert.ok(Number.isFinite(e.value), `${u.id}.${e.key} is not a number`);
      assert.ok(e.label && e.kind, `${u.id}.${e.key} has no name`);
    }
  }
});

test('it is linear in level, and a discount compounds', () => {
  assert.deepEqual(
    ownedEffects(metaAt({ treasury: 6 }), 'treasury'),
    [
      { key: 'income', kind: 'pct', label: 'income', value: 0.12 * 6 },
      { key: 'offlineCapMs', kind: 'hours', label: 'away cap', value: 7200000 * 6 },
    ],
  );
  // `mult` is the one bucket that compounds — 0.96^5, not 1 - 0.04 * 5 — which
  // is exactly how `upgradeEffects` folds it. Getting this wrong would print a
  // discount a fifth too generous.
  const drill = ownedEffects(metaAt({ drill: 5 }), 'drill');
  const cost = drill.find((e) => e.key === 'trainCost');
  assert.equal(cost.kind, 'discount');
  assert.ok(Math.abs(cost.value - 0.96 ** 5) < 1e-12, `compounded to ${cost.value}`);
});

test('it agrees with upgradeEffects, which is the arithmetic that SHIPS', () => {
  // The shop row and the battle config must not be able to disagree about what
  // a line bought. Same meta, one upgrade at a time, every bucket compared
  // against the fold the engine actually reads.
  for (const u of UPGRADES) {
    if (!u.effects.some((e) => e.bucket !== 'unlock')) continue;
    const meta = metaAt({ [u.id]: Math.min(4, u.maxLevel) });
    const fx = upgradeEffects(meta);
    for (const e of ownedEffects(meta, u.id)) {
      const spec = u.effects.find((x) => x.key === e.key);
      const live = spec.bucket === 'add' ? fx.add[e.key]
        : spec.bucket === 'flat' ? fx.flat[e.key]
          : spec.bucket === 'mult' ? fx.mult[e.key] : fx.unit[e.key];
      assert.ok(Math.abs(live - e.value) < 1e-9,
        `${u.id}.${e.key}: the row says ${e.value}, the engine applies ${live}`);
    }
  }
});

test('nothing owned, and an unlock, both report nothing', () => {
  // The negative controls. A row at level 0 must render no receipt at all —
  // an empty one would put a gap on every line a player has not bought — and a
  // one-off unlock's total IS its description, so a "You hold: +1 raiders"
  // would be noise on the one row that needs none.
  assert.deepEqual(ownedEffects(metaAt({}), 'treasury'), []);
  assert.deepEqual(ownedEffects(metaAt({ unlockRaiders: 1 }), 'unlockRaiders'), []);
  assert.deepEqual(ownedEffects(metaAt({ treasury: 3 }), 'nosuchupgrade'), []);
});

test('an empire that earns nothing is not told to wait for Infinity', () => {
  // MEASURED on a fresh save: crowns 0, income 0, every row unaffordable, and
  // the wait line rendered "Affordable in ~Infinitys" — the one outright broken
  // string on the screen, on the first visit anybody makes to it.
  const fresh = fromPersisted(null).meta;
  assert.equal(levelOf(fresh, 'treasury'), 0);
  assert.equal(timeToAfford(fresh, 45), Infinity,
    'the precondition changed; this test is measuring nothing');

  const rowSrc = readFileSync(join(here, '..', 'src', 'screens', 'shoprow.js'), 'utf8');
  assert.ok(rowSrc.includes('Number.isFinite(sec)'),
    'the wait line does not guard against an infinite wait');
  assert.ok(rowSrc.includes('SHOP.noIncome'), 'the guard renders no copy');
  assert.ok(SHOP.noIncome && !/infinit/i.test(SHOP.noIncome), 'the copy is missing or wrong');
  // ...and it must not be a tooltip-only fact. The number was computed and
  // correct for this feature's whole life and lived ONLY in the `title` of a
  // disabled button — a hover, on the one control a player cannot press, on the
  // screen the idle half exists to bring them back to.
  assert.ok(rowSrc.includes("'span.shop-wait'"), 'the wait is not on the row');
});
