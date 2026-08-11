import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveField, power, scaleComp, siegeDps, breachSeconds, projectHp,
  emptyComp, total, siteMaxHp,
} from '../src/battle/combat.js';

const comp = (o) => ({ ...emptyComp(), ...o });

test('scaleComp preserves total via largest remainder', () => {
  const c = comp({ militia: 10, spearmen: 5, raiders: 3 });
  for (const f of [0.1, 0.25, 0.333, 0.5, 0.75, 0.9]) {
    const out = scaleComp(c, f);
    assert.equal(total(out), Math.round(total(c) * f), `fraction ${f}`);
    for (const u of Object.keys(out)) assert.ok(out[u] <= c[u], 'never invents units');
  }
});

test('scaleComp ties break toward the more expensive unit', () => {
  // 1 militia + 1 marshal at 50% -> ideal 1.0 total, one unit kept: the marshal.
  const out = scaleComp(comp({ militia: 1, marshal: 1 }), 0.5);
  assert.equal(total(out), 1);
  assert.equal(out.marshal, 1, 'rounding must not eat the expensive unit');
});

test('counter multipliers scale with the enemy share of the countered type', () => {
  const militia = comp({ militia: 10 });
  const vsPureSpears = power(militia, comp({ spearmen: 10 }));
  const vsHalfSpears = power(militia, comp({ spearmen: 5, militia: 5 }));
  const vsNoSpears = power(militia, comp({ militia: 10 }));
  assert.ok(vsPureSpears > vsHalfSpears, 'more spears -> bigger militia bonus');
  assert.ok(vsHalfSpears > vsNoSpears);
  assert.equal(vsNoSpears, 10 * 4, 'no counter target -> base attack only');
});

test('worked example: pyrrhic capture of a farm', () => {
  // 20 militia vs 6 spearmen + 4 militia on a farm (defMult 1.0).
  // AP = 20 * 4 * (1 + 0.75*0.6) = 116
  // DP = 6*8*1.75 (=84) + 4*3 (=12) = 96
  const r = resolveField(comp({ militia: 20 }), comp({ spearmen: 6, militia: 4 }), {
    siteDefMult: 1.0,
  });
  assert.equal(Math.round(r.attPower), 116);
  assert.equal(Math.round(r.defPower), 96);
  assert.ok(r.win);
  assert.ok(total(r.attSurvivors) > 0 && total(r.attSurvivors) < 5,
    'wins, but barely holds it');
});

test('worked example: raiders wipe against a spear picket, but skirmish saves half', () => {
  // 4 raiders vs 4 spearmen in a stronghold (defMult 1.25).
  // AP = 4*13 = 52 (no militia present, so no counter bonus for raiders)
  // DP = 4*8 * 1.75 (bulwark) * 1.75 (spears counter raiders) * 1.25 (site) = 122.5
  const r = resolveField(comp({ raiders: 4 }), comp({ spearmen: 4 }), { siteDefMult: 1.25 });
  assert.equal(r.attPower, 52);
  assert.equal(r.defPower, 122.5);
  assert.equal(r.win, false);
  assert.equal(total(r.attSurvivors), 0);
  assert.ok(total(r.defSurvivors) > 0);
});

test('ties go to the defender', () => {
  const r = resolveField(comp({ militia: 10 }), comp({ militia: 10 }), {
    siteDefMult: 40 / 30, // force exactly equal power
  });
  assert.equal(r.attPower, r.defPower);
  assert.equal(r.win, false, 'equal power must favour the defender');
});

test('spearmen bulwark only applies on their own site', () => {
  const d = comp({ spearmen: 5 });
  const own = power(d, comp({ militia: 5 }), { defending: true, onOwnSite: true });
  const away = power(d, comp({ militia: 5 }), { defending: true, onOwnSite: false });
  assert.equal(own / away, 1.75);
});

// --- siege ----------------------------------------------------------------

test('a sub-threshold force can never breach, no matter how long it sits', () => {
  // 3 raiders = 2.4 dps vs a farm repairing at 2.0/s -> net positive, breaches.
  // 2 raiders = 1.6 dps -> below regen, never breaches.
  assert.equal(breachSeconds(comp({ raiders: 2 }), 100, 'farm'), Infinity);
  assert.ok(Number.isFinite(breachSeconds(comp({ raiders: 3 }), 100, 'farm')));
});

test('a few troops cannot take a training ground or a stronghold, but a real force can', () => {
  // THE YARD AND THE WALL ARE TWO BUILDINGS NOW (content/balance.js SITES), and
  // this is the contrast that justifies it: the SAME token force bounces off
  // both, and the SAME real force cracks the yard in seconds flat but has to
  // commit for nearly three times as long against the wall.
  const yardHp = siteMaxHp('trainingGround');
  const wallHp = siteMaxHp('stronghold');

  // 4 militia = 2.4 dps: below the yard's 3.0/s repair AND the wall's 5.5/s.
  // A token force takes neither building.
  assert.equal(breachSeconds(comp({ militia: 4 }), yardHp, 'trainingGround'), Infinity);
  assert.equal(breachSeconds(comp({ militia: 4 }), wallHp, 'stronghold'), Infinity);

  // 20 militia = 12 dps. Net 9 against the yard's 3.0/s repair -> 180/9 = 20s:
  // a real force takes the barracks quickly.
  const tYard = breachSeconds(comp({ militia: 20 }), yardHp, 'trainingGround');
  assert.ok(tYard > 17 && tYard < 23, `expected ~20s, got ${tYard}`);
  // Net 6.5 against the wall's 5.5/s repair -> 340/6.5 = ~52s. The SAME army
  // that shrugs off the yard has to commit for nearly three times as long
  // against the wall, and that gap is HP and regen alone (340 vs 180, 5.5 vs
  // 3.0/s) — `garrisonMult` is a FIELD-battle term (see combat.js `power`), so
  // a wall is doubly harder: tougher to even win the field against, and only
  // then slower to crack once you have.
  const tWall = breachSeconds(comp({ militia: 20 }), wallHp, 'stronghold');
  assert.ok(tWall > 48 && tWall < 57, `expected ~52s, got ${tWall}`);
  assert.ok(tWall > tYard * 2, 'the wall must cost more than double the yard, at the same force');
});

test('rams are the siege answer', () => {
  const hp = siteMaxHp('stronghold');
  // 2 rams = 24 dps, net 18.5 against the wall's 5.5/s regen -> 340/18.5 = ~18s.
  const t = breachSeconds(comp({ rams: 2 }), hp, 'stronghold');
  assert.ok(t > 16 && t < 21, `expected ~18s, got ${t}`);
  assert.equal(siegeDps(comp({ rams: 1 })), 20 * siegeDps(comp({ militia: 1 })),
    'a ram is worth 20 militia at siege');
});

test('site upgrades make a genuinely harder nut', () => {
  assert.ok(siteMaxHp('stronghold', 2) > siteMaxHp('stronghold', 1));
  const t1 = breachSeconds(comp({ militia: 20 }), siteMaxHp('stronghold', 1), 'stronghold', 1);
  const t2 = breachSeconds(comp({ militia: 20 }), siteMaxHp('stronghold', 2), 'stronghold', 2);
  assert.ok(t2 > t1 * 1.5, 'levelling a site is real defence, not just economy');
});

test('projectHp is bounded by max and is deterministic', () => {
  assert.equal(projectHp(50, 10, 'farm'), 70);
  assert.equal(projectHp(50, 1000, 'farm'), siteMaxHp('farm'), 'clamped to max');
  assert.equal(projectHp(50, 10, 'farm'), projectHp(50, 10, 'farm'));
});

// --- robustness -----------------------------------------------------------

test('extreme multipliers produce no NaN or Infinity', () => {
  for (const m of [0.0001, 1, 100]) {
    const r = resolveField(comp({ militia: 5 }), comp({ spearmen: 5 }), {
      attMult: m, defMult: m, siteDefMult: m,
    });
    assert.ok(Number.isFinite(r.attPower) && Number.isFinite(r.defPower));
    assert.ok(Number.isFinite(r.ratio));
    for (const u of Object.keys(r.attSurvivors)) {
      assert.ok(Number.isInteger(r.attSurvivors[u]) && r.attSurvivors[u] >= 0);
      assert.ok(Number.isInteger(r.defSurvivors[u]) && r.defSurvivors[u] >= 0);
    }
  }
});

test('empty attackers never win', () => {
  const r = resolveField(emptyComp(), comp({ militia: 1 }), {});
  assert.equal(r.win, false);
});

test('no simultaneous mutual elimination: exactly one side survives', () => {
  const r = resolveField(comp({ militia: 12 }), comp({ militia: 12 }), { siteDefMult: 1 });
  const attAlive = total(r.attSurvivors) > 0;
  const defAlive = total(r.defSurvivors) > 0;
  assert.ok(attAlive !== defAlive, 'exactly one side must hold the field');
});
