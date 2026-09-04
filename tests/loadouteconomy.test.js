// THE DOMINANT LOADOUT IS DENOMINATED IN GOLD AND TRAINING TIME, NOT IN SLOTS.
//
// `tests/loadoutdominance.test.js` measures the exploit as a WIN RATE, which
// costs ~700 seconds and is a claim about whatever dial the table happens to
// ship today. This file measures the same defect as ARITHMETIC: exact, instant,
// and true whatever `regions.data.js` says. It exists because seven candidate
// fixes have now been measured against this exploit and five were rejected, and
// every one of the seven acted on a denominator that is not the one that
// carries it.
//
// The standing advice in CLAUDE.md was "act on the LANDING FORCE, because that
// is the only place the two armies differ". The two armies differ there because
// both CONVERGE on militia by minute two — measured, 95% and 99% — and they
// converge because militia wins the in-battle economy. So the landing force is
// where the difference is VISIBLE, not where it is CAUSED.
//
// Four denominators decide a unit's worth, and only two of them have ever been
// anchored:
//
//   atk per SLOT     the landing force. `UNIT_SLOTS` is deliberately anchored
//                    on gold^0.83 (balance.engine.js) — this one is authored.
//   atk per GOLD     the other 8-20 minutes. Nothing anchors it.
//   def per GOLD     what holding 30-55 captured sites costs. Nothing anchors it.
//   bodies per YARD  per training-site-second, i.e. `batch / trainSec`. Nothing
//                    anchors it, and `batch` is a free variable exactly one
//                    unit uses.
//
// Measured against the real mid-battle enemy army (gallowmoor, sampled at 1/5/9
// minutes over two seeds: militia ~56%, spearmen ~28%, raiders ~11%, rams ~5%):
//
//              atk/SLOT      atk/GOLD      def/GOLD      bodies/yard/s
//   militia    4.84  (#2)    0.403 (#1)    0.302 (#2)    0.250 (#1)
//   raiders    6.01  (#1)    0.400 (#2)    0.123 (#4)    0.083 (#4)
//   spearmen   2.71  (#6)    0.226 (#4)    0.361 (#1)    0.125 (#2)
//   archers    3.67  (#3)    0.275 (#3)    0.100 (#6)    0.083 (#5)
//   halberds   3.17  (#4)    0.195 (#6)    0.081 (#7)    0.063 (#6)
//   outriders  3.14  (#5)    0.209 (#5)    0.104 (#5)    0.100 (#3)
//   sappers    1.00  (#7)    0.055 (#7)    0.127 (#3)    0.063 (#7)
//
// Read the RANKS, not the values. Militia's WORST rank across the four is #2.
// Every other unit's worst is #4 or lower. That one line is the whole defect,
// and note what it is not: militia is not first on attack per slot — raiders
// are, and by 24%. So a fix that moves `UNIT_SLOTS` is moving the one
// denominator on which militia is already beaten.
import test from 'node:test';
import assert from 'node:assert/strict';

import { UNITS, UNIT_IDS, UNIT_SLOTS } from '../src/content/balance.js';
import { power, emptyComp } from '../src/battle/combat.js';

// The real mid-battle enemy army, not a hand-picked one. Sampled off
// `startRun`/`step` on gallowmoor at 1, 5 and 9 minutes over seeds 1000 and
// 8919; the four readings agree to within a few points, so this is the shape
// rather than one moment. It matters that it is measured: against a pure
// spearwall militia leads on every axis for an honest reason (`counters`), and
// a fixture that assumed one would be encoding the wrong explanation.
const FOE = Object.freeze({ militia: 56, spearmen: 28, raiders: 11, rams: 5 });

// The Marshal is excluded throughout: `maxPerSite: 1` means he is commissioned
// rather than trained or carried in bulk, so a per-gold rate is not a claim
// anybody can act on for him.
const LINE = UNIT_IDS.filter((u) => !UNITS[u].maxPerSite);

const one = (u) => ({ ...emptyComp(), [u]: 100 });

const DENOMS = {
  atkSlot: (u) => power(one(u), FOE) / 100 / UNIT_SLOTS[u],
  atkGold: (u) => power(one(u), FOE) / 100 / UNITS[u].gold,
  defGold: (u) => power(one(u), FOE, { defending: true }) / 100 / UNITS[u].gold,
  perYard: (u) => UNITS[u].batch / UNITS[u].trainSec,
};
const KEYS = Object.keys(DENOMS);

/** 1-based rank of `unit` among the line troops on one denominator. */
function rank(key, unit) {
  const order = [...LINE].sort((a, b) => DENOMS[key](b) - DENOMS[key](a));
  return order.indexOf(unit) + 1;
}
const worstRank = (unit) => Math.max(...KEYS.map((k) => rank(k, unit)));

test('economy: militia is the only troop that is top-two on EVERY denominator', () => {
  // THE DEFECT, STATED AS A RANK RATHER THAN A WIN RATE. A roster with a real
  // decision in it has every unit best at something and bad at something else —
  // which is exactly what the other six do. Militia is never worse than second
  // at anything, so there is no axis on which bringing something else is right.
  assert.equal(worstRank('militia'), 2,
    'militia should be top-two on all four denominators — if this moved, re-take '
    + 'tests/loadoutdominance.test.js, because the exploit may have changed shape');

  for (const u of LINE) {
    if (u === 'militia') continue;
    assert.ok(worstRank(u) >= 4,
      `${u} is now top-three on every denominator (worst rank ${worstRank(u)}); `
      + 'a second all-rounder is a second dominant loadout, not a fix');
  }
});

test('economy: the SLOT anchor is not the lever — militia does not lead on it', () => {
  // THE NEGATIVE CONTROL THAT RETIRES FIVE OF THE SEVEN ATTEMPTED FIXES. Every
  // one of them re-priced the landing force. Per slot, against the army the
  // player actually meets, RAIDERS lead and militia is second — so slots are
  // the one denominator where the roster is already working, and moving them
  // cannot be what closes the gap.
  assert.equal(rank('atkSlot', 'raiders'), 1,
    'raiders should lead on attack per slot against the real enemy army');
  assert.ok(DENOMS.atkSlot('raiders') > DENOMS.atkSlot('militia') * 1.15,
    'and lead by a margin big enough that this is not a tie');

  // The gold anchor, by contrast, is a DEAD HEAT — militia and raiders are
  // within a few percent on attack per gold. So on the denominator that governs
  // the other eight-to-twenty minutes, the expensive unit buys no offence at
  // all, and everything below decides it.
  const ratio = DENOMS.atkGold('militia') / DENOMS.atkGold('raiders');
  assert.ok(ratio > 0.95 && ratio < 1.05,
    `attack per gold should be a dead heat, read ${ratio.toFixed(3)}`);
});

test('economy: what militia actually wins is holding cost and yard throughput', () => {
  // These two are where the exploit lives, and neither has ever been anchored
  // against anything.
  assert.ok(DENOMS.defGold('militia') > DENOMS.defGold('raiders') * 2,
    'militia should garrison captured ground at more than twice raiders per gold');
  assert.ok(DENOMS.perYard('militia') > DENOMS.perYard('raiders') * 2.5,
    'and one yard should turn out more than 2.5x the bodies per second');

  // Spearmen are the honest counter-example and the reason this is not simply
  // "militia is overtuned": they beat militia on defence per gold outright. What
  // they cannot do is attack, so they are a real specialist. The defect is that
  // militia is never forced to choose.
  assert.ok(DENOMS.defGold('spearmen') > DENOMS.defGold('militia'),
    'spearmen should still be the best gold-for-gold defender');
  assert.ok(DENOMS.atkGold('spearmen') < DENOMS.atkGold('militia') * 0.7,
    'and should pay for it in offence');
});

test('economy: `batch` is a per-yard multiplier with exactly one author', () => {
  // `batch` is charged in gold (`training.js trainJob`: cost = gold * batch),
  // so it buys no discount — it is purely a THROUGHPUT term, doubling what one
  // training ground turns out per second. The number of yards is scarce (the
  // enemy holds three or four mid-campaign, instrumented), so that is a real
  // advantage and it is unpriced.
  //
  // Exactly one unit has it, which is what makes the throughput column above
  // legible. A second batch-2 unit would silently hand the same advantage to
  // something else and change the whole table with nothing else failing —
  // the same guard `tests/frontage.test.js` puts on `engine`.
  const batched = LINE.filter((u) => UNITS[u].batch > 1);
  assert.deepEqual(batched, ['militia'],
    'militia should be the only line troop trained in batches');
  assert.equal(UNITS.militia.batch, 2);

  // And its throughput lead is exactly that batch, not a shorter timer: militia
  // and spearmen share `trainSec`, so the 2x is the batch and nothing else.
  assert.equal(UNITS.militia.trainSec, UNITS.spearmen.trainSec);
  assert.equal(DENOMS.perYard('militia') / DENOMS.perYard('spearmen'), 2);
});

test('economy: the battle is fought with trained bodies, so gold is the real budget', () => {
  // THE KEYSTONE, AND THE REASON THE THREE UNANCHORED DENOMINATORS OUTWEIGH THE
  // ANCHORED ONE. Measured on gallowmoor with the shipped harness options
  // (seeds 1000 and 8919): a 307-body landing force, and by minute FIVE another
  // 300 and 238 bodies had been trained — 49% and 44% of everything ever
  // fielded, in runs the bot went on to lose, so a winning run trains more.
  // CLAUDE.md's own census has the bot at 1,092 bodies by minute fifteen from a
  // ~243-body landing.
  //
  // This test cannot replay that here (it is a battle, and this file is
  // arithmetic), so it pins the CONSEQUENCE that makes it matter: the loadout
  // decides what you may train for the rest of the battle, not merely what you
  // land with. `meta/composition.js battleRoster` narrows training to the
  // expedition's own types — so a slot spent is a production line chosen, and a
  // per-slot comparison prices only the first two minutes of a twenty-minute
  // decision.
  const gold = LINE.map((u) => UNITS[u].gold);
  assert.ok(Math.max(...gold) / Math.min(...gold) > 5,
    'gold prices should span a wide range — they are a real budget, not a label');

  // A leftover slot always buys exactly one militia (the `UNIT_SLOTS` anchor
  // says so out loud), and militia is also the cheapest thing gold can buy. So
  // the two budgets do not merely both favour militia, they cannot disagree:
  // there is no unit that is slot-expensive and gold-cheap, or the reverse, on
  // which a player could arbitrage.
  assert.equal(UNIT_SLOTS.militia, 1);
  assert.equal(Math.min(...gold), UNITS.militia.gold);
});
