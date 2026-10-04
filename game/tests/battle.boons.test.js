// Phase 7 (PLAN-PHASE7): Boons and Relics in the sim (game/battle/boons.js and the hooks in resolve, powers, squads, movement, combat,
// abilities, dragon and fallen). Each Boon rides in PlayerStats.boons; with none the sim is unchanged (the existing suites prove it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, step, issue, abilityState } from '../battle/sim.js';
import { pausedCooldownTick } from '../battle/boons.js';
import { BOON_LIST } from '../config/boons.js';
import { boonSimStats } from '../meta/boonsState.js';

const SQ3 = Math.sqrt(3);
const POW = Object.freeze({ rally: 1, firestorm: 1, bulwark: 0, march: 1, levy: 0 });
const BASE = Object.freeze({ atk: 1, def: 1, growth: 0, speed: 1, campTroops: 100, garrisonShare: 0.35, capBonus: 0, cooldownMult: 1, powers: POW });
const ENEMY = Object.freeze({ atk: 1, def: 1, growth: 0, speed: 1, troopMult: 1, thinkSec: 1, graceSec: 999, personality: 'aggressive', factionId: 2 });

function line(sites, { length = 12, faction = 2, terrain = 'grass', cost = 1 } = {}) {
  const tiles = [];
  for (let q = 0; q < length; q++) {
    const t = { i: q, q, r: 0, x: q * SQ3, y: 0, cost, terrain, region: q < 2 ? 1 : 0 };
    if (q < 2) t.own = 0;
    tiles.push(t);
  }
  return { regionId: 0, enemyFaction: faction, tiles, sites: sites.map(([tile, type, owner, troops], id) => ({ id, settlement: id - 1, tile, type, owner, troops })),
    focus: { minX: 0, maxX: (length - 1) * SQ3, minY: 0, maxY: 0 }, marches: [] };
}
const withBoons = (boons, extra = {}) => ({ ...BASE, boons, ...extra });
const run = (b, sec, onEvents) => { const end = b.t + sec; while (!b.result && b.t < end - 1e-9) { step(b, 0.05); if (onEvents) onEvents(b.events); } };
const triggers = (b, sec) => { const out = []; run(b, sec, (ev) => out.push(...ev.filter((e) => e.type === 'boonTriggered'))); return out; };
const send = (b, from, to, fraction = 1) => issue(b, { type: 'send', owner: 0, from, to, fraction });

test('Turncoats: a captured settlement keeps a share of its fallen defenders', () => {
  const sites = [[0, 'camp', 0, 100], [4, 'village', 2, 30], [11, 'keep', 2, 30]];
  const plain = createBattle(line(sites), BASE, ENEMY);
  const turn = createBattle(line(sites), withBoons({ turncoatShare: 0.3 }), ENEMY);
  send(plain, 0, 1); send(turn, 0, 1);
  run(plain, 8);
  const ev = triggers(turn, 8);
  assert.equal(plain.sites[1].owner, 0);
  assert.ok(Math.abs(turn.sites[1].troops - plain.sites[1].troops - 9) < 0.5, `${turn.sites[1].troops} vs ${plain.sites[1].troops}`);
  assert.equal(ev.find((e) => e.boon === 'turncoats').count, 9);
});

test("Warlord's Mark doubles every 4th squad; Second Wind holds a falling settlement once", () => {
  const b = createBattle(line([[0, 'camp', 0, 400], [11, 'keep', 2, 999]]), withBoons({ warlordEvery: 4 }), ENEMY);
  for (let k = 0; k < 4; k++) { send(b, 0, 1, 0.1); step(b, 0.05); }
  const counts = b.squads.map((q) => q.count);
  assert.equal(counts[3], 2 * Math.floor((400 - [40, 36, 32.4].reduce((s, x) => s + Math.floor(x), 0)) * 0.1));
  assert.ok(b.events.some((e) => e.type === 'boonTriggered' && e.boon === 'warlordsMark'));
  // Second Wind
  const sites = [[0, 'camp', 0, 5], [4, 'village', 0, 10], [11, 'camp', 2, 200]];
  const sw = createBattle(line(sites), withBoons({ secondWindTroops: 10, secondWindCampShare: 0 }), ENEMY);
  issue(sw, { type: 'send', owner: 2, from: 2, to: 1, fraction: 0.2 });
  const ev = triggers(sw, 20);
  assert.equal(ev.filter((e) => e.boon === 'secondWind').length, 1, 'once per battle');
  assert.equal(sw.boonFx.secondWind, true);
});

test('Scorched Earth burns enemy squads on the ground; the Ember Heart and the Horn of Ages; Rally Horns', () => {
  const sites = [[0, 'camp', 0, 50], [6, 'village', 0, 20], [11, 'camp', 2, 300]];
  const mk = (boons) => createBattle(line(sites), boons ? withBoons(boons) : BASE, ENEMY);
  const plain = mk(null); const hot = mk({ scorchSec: 6, scorchDps: 3, firestormMult: 1.4 });
  for (const b of [plain, hot]) {
    issue(b, { type: 'send', owner: 2, from: 2, to: 1, fraction: 0.2 }); step(b, 0.05);
    issue(b, { type: 'power', owner: 0, power: 'firestorm', target: { q: 10, r: 0 } });
  }
  run(plain, 1.0);
  const ev = triggers(hot, 1.0);
  assert.ok(ev.some((e) => e.boon === 'scorchedEarth'));
  const a = plain.squads.find((q) => q.owner === 2); const h = hot.squads.find((q) => q.owner === 2);
  assert.ok(h.count < a.count - 3, `Ember Heart + burning ground: ${h.count} vs ${a.count}`);
  assert.ok(hot.boonFx.scorch.length === 1);
  // Horn of Ages: Rally's cooldown x0.6; Rally Horns: its squads carry power
  const r = createBattle(line([[0, 'camp', 0, 50], [3, 'village', 0, 50], [11, 'keep', 2, 30]]), withBoons({ rallyCdMult: 0.6, rallyPowerMult: 1.2 }), ENEMY);
  issue(r, { type: 'power', owner: 0, power: 'rally', target: 2 });
  step(r, 0.05);
  assert.ok(Math.abs(r.cooldowns.rally - (0 + 30 * 0.6)) < 1e-9);
  assert.ok(r.squads.length >= 2 && r.squads.every((q) => q.power === 1.2));
});

test('Hit and Run and Pathfinder speed the march; Engineers double a held tower; Night Raiders', () => {
  const forest = { terrain: 'forest', cost: 1.6 };
  const a = createBattle(line([[0, 'camp', 0, 50], [11, 'keep', 2, 999]], forest), BASE, ENEMY);
  const p = createBattle(line([[0, 'camp', 0, 50], [11, 'keep', 2, 999]], forest), withBoons({ pathfinder: true }), ENEMY);
  send(a, 0, 1, 0.5); send(p, 0, 1, 0.5); run(a, 3); run(p, 3);
  assert.ok(p.squads[0].seg > a.squads[0].seg, 'Pathfinder crosses forest faster');
  const h = createBattle(line([[0, 'camp', 0, 50], [11, 'keep', 2, 999]]), withBoons({ hitRunSec: 5, hitRunMult: 1.4 }), ENEMY);
  h.effects.hitRunUntil = 10;
  const n = createBattle(line([[0, 'camp', 0, 50], [11, 'keep', 2, 999]]), BASE, ENEMY);
  send(h, 0, 1, 0.5); send(n, 0, 1, 0.5); run(h, 2); run(n, 2);
  assert.ok(h.squads[0].seg + h.squads[0].prog > n.squads[0].seg + n.squads[0].prog);
  // Engineers: a tower the player holds shoots twice as often
  const towers = [[0, 'camp', 0, 50], [5, 'tower', 0, 20], [11, 'camp', 2, 300]];
  const count = (boons) => {
    const b = createBattle(line(towers), boons ? withBoons(boons) : BASE, ENEMY);
    issue(b, { type: 'send', owner: 2, from: 2, to: 1, fraction: 0.5 });
    let arrows = 0; run(b, 6, (ev) => { arrows += ev.filter((e) => e.type === 'arrow').length; });
    return arrows;
  };
  assert.ok(count({ towerRateMult: 0.5 }) >= 1.6 * count(null));
  // Night Raiders: enemy towers hold fire at night
  const night = (boons) => {
    const arena = line([[0, 'camp', 0, 50], [5, 'tower', 2, 40], [11, 'keep', 2, 999]]);
    arena.twist = 'night';
    const b = createBattle(arena, boons ? withBoons(boons) : BASE, ENEMY);
    send(b, 0, 1, 0.5);
    let arrows = 0; run(b, 8, (ev) => { arrows += ev.filter((e) => e.type === 'arrow').length; });
    return arrows;
  };
  assert.ok(night(null) > 0);
  assert.equal(night({ nightRaiders: true }), 0);
});

test('Banner Bearer recharges the ability once; the Sundial ticks cooldowns while paused', () => {
  const ability = { id: 'bonus', share: 0.1 };
  const b = createBattle(line([[0, 'camp', 0, 100], [11, 'keep', 2, 999]]), withBoons({ abilityRechargeSec: 60 }, { ability }), ENEMY);
  issue(b, { type: 'ability', owner: 0, ability: 'bonus' }); step(b, 0.05);
  assert.equal(abilityState(b).ready, false);
  const ev = triggers(b, 61);
  assert.ok(ev.some((e) => e.boon === 'bannerBearer'));
  assert.equal(abilityState(b).ready, true);
  issue(b, { type: 'ability', owner: 0, ability: 'bonus' }); step(b, 0.05);
  assert.equal(b.abilityCount, 2);
  run(b, 70);
  assert.equal(abilityState(b).ready, false, 'only once');
  // Sundial
  const s = createBattle(line([[0, 'camp', 0, 100], [11, 'keep', 2, 999]]), withBoons({ sundial: true }), ENEMY);
  issue(s, { type: 'power', owner: 0, power: 'march' }); step(s, 0.05);
  const cd = s.cooldowns.march;
  assert.equal(pausedCooldownTick(s, 10), true);
  assert.ok(Math.abs(s.cooldowns.march - (cd - 10)) < 1e-9);
  const plain = createBattle(line([[0, 'camp', 0, 100], [11, 'keep', 2, 999]]), BASE, ENEMY);
  assert.equal(pausedCooldownTick(plain, 10), false);
});

test("Blood Price bleeds your sites on a capture; Martyr's Crown surges when the camp falls; Siegecraft; Phalanx", () => {
  const b = createBattle(line([[0, 'camp', 0, 100], [2, 'village', 0, 40], [5, 'hamlet', 2, 5], [11, 'keep', 2, 999]]), withBoons({ captureBleed: 0.05 }), ENEMY);
  send(b, 0, 2, 0.3);
  const ev = triggers(b, 6);
  assert.equal(b.sites[2].owner, 0);
  assert.ok(ev.some((e) => e.boon === 'bloodPrice'));
  assert.ok(b.sites[1].troops < 40);
  const m = createBattle(line([[3, 'camp', 0, 2], [0, 'village', 0, 40], [11, 'camp', 2, 300]]), withBoons({ martyrSurge: 0.3, martyrAtkMult: 1.25, martyrSec: 15 }), ENEMY);
  issue(m, { type: 'send', owner: 2, from: 2, to: 0, fraction: 0.2 });
  const mev = triggers(m, 15);
  const surge = mev.find((e) => e.boon === 'martyrsCrown');
  assert.ok(surge && surge.sites.includes(1));
  // Siegecraft: a Gate falls with fewer troops
  const gate = (boons) => {
    const g = createBattle(line([[0, 'camp', 0, 100], [6, 'gate', 2, 40], [11, 'keep', 2, 999]]), boons ? withBoons(boons) : BASE, ENEMY);
    send(g, 0, 1, 0.5); run(g, 10);
    return g.sites[1].owner === 0 ? g.sites[1].troops : -1;
  };
  assert.ok(gate({ gateDefMult: 0.5 }) > gate(null));
  // Phalanx: a big squad loses less taking a village
  const take = (boons) => {
    const g = createBattle(line([[0, 'camp', 0, 120], [6, 'village', 2, 30], [11, 'keep', 2, 999]]), boons ? withBoons(boons) : BASE, ENEMY);
    send(g, 0, 1, 0.5); run(g, 10);
    return g.sites[1].troops;
  };
  assert.ok(take({ phalanxMin: 40, phalanxDmgMult: 0.8 }) > take(null) + 3);
});

test('every Boon at once: a battle runs, survives a JSON round trip mid-fight and replays identically', () => {
  const state = { boons2: { owned: BOON_LIST.map((x) => x.id) }, relics: { owned: ['emberHeart', 'hornOfAges', 'sundial', 'gravewardensLantern'] } };
  const boons = boonSimStats(state);
  const sites = [[0, 'camp', 0, 120], [3, 'tower', 2, 15], [6, 'village', 2, 30], [8, 'gate', 2, 20], [11, 'keep', 2, 60]];
  const mk = () => createBattle(line(sites), withBoons(boons, { ability: { id: 'bonus', share: 0.1 } }), { ...ENEMY, personality: 'undying', growth: 1 });
  const script = (b) => {
    for (let i = 0; i < 1200 && !b.result; i++) {
      if (i % 40 === 0) send(b, 0, [2, 1, 3, 4][(i / 40) % 4], 0.5);
      if (i === 100) issue(b, { type: 'power', owner: 0, power: 'firestorm', target: 2 });
      if (i === 300) {
        const copy = JSON.parse(JSON.stringify(b));
        Object.assign(b, copy); // a save and reload in the middle (fresh runtime caches)
      }
      step(b, 0.05);
    }
  };
  const a = mk(); const b = mk();
  script(a); script(b);
  assert.equal(JSON.stringify(a.sites), JSON.stringify(b.sites));
  assert.ok(a.t > 10);
});
