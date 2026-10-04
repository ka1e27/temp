// Phase 6 (PLAN-PHASE6): rival rotation, The Fallen Rise (with the Firestorm exception), war-band growth, the Barrow Keep Rising,
// the Gravewarden (passive and Raise the Fallen), the undying AI, and the world contract (D1 byte-identical).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, step, issue, abilityState } from '../battle/sim.js';
import { think } from '../battle/ai.js';
import { generateWorld } from '../world/generate.js';
import { rivalsFor, sanitizeRivals, rivalsInWorld, isRivalPresent } from '../meta/rivals.js';
import { worldOptsFor } from '../meta/edicts.js';
import { ASHEN } from '../config/ashen.js';
import { GENERALS, CHAMPION_OF_FACTION } from '../config/generals.js';
import { abilityOf, commanderEffects } from '../meta/generalsState.js';
import { abilityText, passiveText } from '../meta/generals.js';
import { championTitle, leaderFor } from '../meta/leaders.js';

const SQ3 = Math.sqrt(3);
const POW = Object.freeze({ rally: 0, firestorm: 1, bulwark: 0, march: 0, levy: 0 });
const BASE = Object.freeze({ atk: 1, def: 1, growth: 0, speed: 1, campTroops: 100, garrisonShare: 0.35, capBonus: 0, cooldownMult: 1, powers: POW });
const enemy = (personality) => ({ atk: 1, def: 1, growth: 0, speed: 1, troopMult: 1, thinkSec: 1, graceSec: 999, personality, factionId: 5 });

function line(sites, length = 12) {
  const tiles = [];
  for (let q = 0; q < length; q++) {
    const t = { i: q, q, r: 0, x: q * SQ3, y: 0, cost: 1, terrain: 'grass', region: q < 2 ? 1 : 0 };
    if (q < 2) t.own = 0;
    tiles.push(t);
  }
  return { regionId: 0, enemyFaction: 5, tiles, sites: sites.map(([tile, type, owner, troops], id) => ({ id, settlement: id - 1, tile, type, owner, troops })),
    focus: { minX: 0, maxX: (length - 1) * SQ3, minY: 0, maxY: 0 }, marches: [] };
}
const run = (b, sec, onEvents) => { const end = b.t + sec; while (!b.result && b.t < end - 1e-9) { step(b, 0.05); if (onEvents) onEvents(b.events); } };

/** The player throws `n` troops at a village of `garrison`; returns the village's troops after the fight and every event. */
function assault(personality, n, garrison, opts = {}) {
  const b = createBattle(line([[0, 'camp', 0, n], [4, 'village', 5, garrison], [11, 'keep', 5, 30]]), BASE, enemy(personality));
  if (opts.firestorm) issue(b, { type: 'power', owner: 0, power: 'firestorm', target: 1 });
  issue(b, { type: 'send', owner: 0, from: [0], to: 1, fraction: 1 });
  const events = [];
  run(b, 25, (ev) => events.push(...ev));
  return { b, events };
}

test('rivalsFor: D1 classic, D2 always has the Ashen replacing one, D3+ three of four; deterministic', () => {
  for (let seed = 1; seed <= 60; seed++) {
    assert.deepEqual(rivalsFor(seed, 1), [2, 3, 4]);
    const d2 = rivalsFor(seed, 2);
    assert.ok(d2.includes(5) && new Set(d2).size === 3 && d2.filter((f) => [2, 3, 4].includes(f)).length === 2, d2.join());
    for (const d of [3, 4, 7]) {
      const r = rivalsFor(seed, d);
      assert.equal(new Set(r).size, 3);
      assert.ok(r.every((f) => f >= 2 && f <= 5));
      assert.deepEqual(rivalsFor(seed, d), r);
    }
  }
  const replaced = new Set(Array.from({ length: 40 }, (_, i) => rivalsFor(i + 1, 2).indexOf(5)));
  assert.equal(replaced.size, 3, 'each of the three classic rivals is sometimes the one replaced');
  assert.deepEqual(sanitizeRivals([5, 5, 2]), [2, 3, 4]);
  assert.deepEqual(sanitizeRivals('x'), [2, 3, 4]);
  assert.deepEqual(sanitizeRivals([3, 5, 4]), [3, 5, 4]);
});

test('generateWorld: the classic line-up is byte-identical; a rotated one only changes owners', () => {
  const plain = generateWorld(7, { dynasty: 2 });
  const classic = generateWorld(7, { dynasty: 2, rivals: [2, 3, 4] });
  assert.equal(JSON.stringify(classic), JSON.stringify(plain));
  assert.equal(plain.factions.length, 5, 'D1/classic worlds keep exactly the five faction entries');
  assert.deepEqual(worldOptsFor({ dynasty: { level: 1 }, rivals: [2, 3, 4] }), { dynasty: 1 });
  assert.deepEqual(worldOptsFor({ dynasty: { level: 2 }, rivals: [5, 3, 4] }).rivals, [5, 3, 4]);

  const rot = generateWorld(7, { dynasty: 2, rivals: [5, 3, 4] });
  assert.equal(rot.factions.length, 6);
  assert.deepEqual(rot.regions.map((r) => r.tiles.length), plain.regions.map((r) => r.tiles.length), 'map shapes unchanged');
  for (const r of plain.regions) assert.equal(rot.regions[r.id].faction, r.faction === 2 ? 5 : r.faction);
  assert.equal(rot.factions[5].capitalRegion, plain.factions[2].capitalRegion);
  assert.equal(rot.factions[2].capitalRegion, -1);
  assert.equal(rot.factions[2].absent, true);
  assert.deepEqual(rivalsInWorld(rot), [3, 4, 5]);
  assert.equal(isRivalPresent(rot, 2), false);
  assert.equal(isRivalPresent(rot, 5), true);
  assert.deepEqual(rot.rivals, [5, 3, 4]);
});

test('The Fallen Rise: an over-sent assault feeds the garrison and emits fallenRose; other rivals do not', () => {
  const ash = assault('undying', 40, 30);
  const crim = assault('aggressive', 40, 30);
  const rose = ash.events.filter((e) => e.type === 'fallenRose');
  assert.ok(rose.length > 0, 'risers announced');
  assert.ok(rose.every((e) => e.site === 1 && Number.isInteger(e.count) && e.count >= 1 && e.kind === 'fallen' && e.owner === 5));
  // 40 against 30 takes both villages, but against the Ashen a fifth of the dead rose to fight again: far fewer survivors
  assert.equal(crim.b.sites[1].owner, 0);
  assert.equal(ash.b.sites[1].owner, 0);
  assert.ok(ash.b.sites[1].troops < crim.b.sites[1].troops - 4, `${ash.b.sites[1].troops} vs ${crim.b.sites[1].troops}`);
  const close = assault('undying', 34, 30); // a narrow over-send: the risers hold the village
  const closeC = assault('aggressive', 34, 30);
  assert.equal(closeC.b.sites[1].owner, 0);
  assert.equal(close.b.sites[1].owner, 5);
  assert.equal(crim.events.filter((e) => e.type === 'fallenRose').length, 0);
});

test('The Fallen Rise: a decisive blow (the garrison dies on the tick) raises nobody there', () => {
  const ash = assault('undying', 120, 10);
  assert.equal(ash.b.sites[1].owner, 0, 'the village fell');
});

test('Firestorm burns the dead: an assault inside the burning ground raises none (fallenBurned instead)', () => {
  const burnt = assault('undying', 40, 30, { firestorm: true });
  assert.equal(burnt.events.filter((e) => e.type === 'fallenRose').length, 0);
  assert.ok(burnt.events.some((e) => e.type === 'fallenBurned' && e.site === 1));
  assert.ok(ASHEN.fallen.burnSec > 0);
});

test('an undying war band grows by a share of the defenders it kills', () => {
  const mk = (personality) => {
    const b = createBattle(line([[0, 'camp', 0, 10], [6, 'village', 0, 30], [11, 'camp', 5, 80]]), BASE, enemy(personality));
    issue(b, { type: 'send', owner: 5, from: [2], to: 1, fraction: 1 });
    const events = [];
    run(b, 20, (ev) => events.push(...ev));
    return { b, events };
  };
  const ash = mk('undying');
  const crim = mk('aggressive');
  assert.ok(ash.events.some((e) => e.type === 'fallenRose' && e.kind === 'warBand'));
  assert.equal(ash.b.sites[1].owner, 5);
  assert.ok(ash.b.sites[1].troops > crim.b.sites[1].troops, `${ash.b.sites[1].troops} vs ${crim.b.sites[1].troops}`);
});

test('the Barrow Keep Rising: telegraphed, then a free squad marches on the nearest player site; Firestorm cancels one', () => {
  const arena = line([[0, 'camp', 0, 50], [5, 'village', 0, 20], [11, 'keep', 5, 100]]);
  arena.rising = { site: 2, keepTroops: 100 };
  const b = createBattle(arena, BASE, enemy('undying'));
  const events = [];
  run(b, ASHEN.rising.everySec + 0.2, (ev) => events.push(...ev));
  const warn = events.find((e) => e.type === 'rising');
  assert.ok(warn && warn.site === 2 && Math.abs(warn.at - ASHEN.rising.everySec) < 1e-6);
  const risen = events.find((e) => e.type === 'send' && e.rising);
  assert.ok(risen && risen.to === 1 && risen.count === Math.round(ASHEN.rising.troopsShare * 100));
  // Firestorm on the keep during the next telegraph cancels the next Rising
  run(b, ASHEN.rising.everySec - ASHEN.rising.telegraphSec - 0.1);
  issue(b, { type: 'power', owner: 0, power: 'firestorm', target: 2 });
  const later = [];
  run(b, ASHEN.rising.telegraphSec + 1, (ev) => later.push(...ev));
  assert.ok(later.some((e) => e.type === 'risingCancelled'));
  assert.ok(!later.some((e) => e.type === 'send' && e.rising));
});

test('the Gravewarden: config, passive copy, Raise the Fallen copy and the capital-topple mapping', () => {
  assert.equal(CHAMPION_OF_FACTION[5], 'gravewarden');
  const g = { id: 'champion:5', kind: 'gravewarden', name: 'x', style: 'stalwart', level: 1, xp: 0, skills: [] };
  assert.equal(GENERALS.kinds.gravewarden.skills.length, GENERALS.skillLevels.length);
  assert.equal(commanderEffects(g).reclaim, GENERALS.kinds.gravewarden.passive.value);
  assert.deepEqual(abilityOf(g), { id: 'raiseFallen', windowSec: 20, cap: 0.25 });
  assert.match(passiveText(g), /join/);
  assert.match(abilityText(g), /Raise the Fallen/);
  assert.equal(abilityOf({ ...g, level: 4, skills: [0, 0] }).windowSec, 20 + GENERALS.skillValues.raiseLong);
});

test('Raise the Fallen: recent losses rise at your strongest site, capped by the camp', () => {
  const ability = { id: 'raiseFallen', windowSec: 20, cap: 0.25 };
  const b = createBattle(line([[0, 'camp', 0, 60], [4, 'village', 5, 60], [11, 'keep', 5, 30]]), { ...BASE, ability }, enemy('aggressive'));
  assert.equal(abilityState(b).needsTarget, false);
  issue(b, { type: 'send', owner: 0, from: [0], to: 1, fraction: 0.6 });
  run(b, 12);
  const before = b.sites[0].troops;
  issue(b, { type: 'ability', owner: 0, ability: 'raiseFallen' });
  step(b, 0.05);
  const ev = b.events.find((e) => e.type === 'ability');
  assert.ok(ev && ev.ability === 'raiseFallen' && ev.target === 0 && ev.count >= 1 && ev.count <= 25, JSON.stringify(ev));
  assert.ok(b.sites[0].troops >= before + ev.count - 1e-6);
});

test('the Gravewarden passive: attackers dying at your settlement join it', () => {
  const mk = (reclaim) => {
    const b = createBattle(line([[0, 'camp', 0, 10], [6, 'keep', 0, 40], [11, 'village', 2, 30]]), { ...BASE, reclaim }, { ...enemy('aggressive'), factionId: 2 });
    b.arena.enemyFaction = 2;
    issue(b, { type: 'send', owner: 2, from: [2], to: 1, fraction: 1 });
    run(b, 15);
    return b.sites[1].troops;
  };
  assert.ok(mk(0.1) > mk(0) + 1);
});

test('the undying AI is patient: it does not attack a full-strength player, it strikes once the player has spent troops', () => {
  const b = createBattle(line([[0, 'camp', 0, 120], [5, 'village', 0, 60], [9, 'town', 5, 80], [11, 'keep', 5, 60]]), BASE, { ...enemy('undying'), graceSec: 0 });
  const sendsAt = [];
  for (let i = 0; i < 100; i++) { for (const c of think(b, b.t)) { issue(b, c); if (c.type === 'send' && b.sites[c.to].owner === 0) sendsAt.push(b.t); } step(b, 0.05); }
  assert.equal(sendsAt.length, 0, 'no strike into a fresh army');
  b.sites[0].troops = 5; // the player spent its army
  b.sites[1].troops = 3;
  let struck = false;
  for (let i = 0; i < 100 && !struck; i++) { for (const c of think(b, b.t)) { issue(b, c); if (c.type === 'send' && b.sites[c.to].owner === 0) struck = true; } step(b, 0.05); }
  assert.ok(struck);
});

test('the Pale Margrave and the Barrow Knight', () => {
  assert.match(leaderFor(3, 2, 5).fullName, /^Margrave [A-Z][a-z]+ the Pale$/);
  assert.equal(championTitle(5), 'Barrow Knight');
  assert.equal(championTitle(2), 'Champion');
});
