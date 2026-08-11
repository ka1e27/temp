// THE YARD AND THE WALL.
//
// `stronghold` used to be both the only thing that trained and, apart from the
// two thrones, the only thing that defended. So there was never a decision on
// the map: whatever you took for one reason you got the other for free. They
// are two buildings now — a soft `trainingGround` that makes troops and a hard
// `stronghold` that does not — and the assertions here are about the three
// things that make that a split rather than a rename.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SITES, SITE_KINDS, INFLUENCE_RADIUS, MAPGEN, AI, UNITS,
} from '../src/content/balance.js';
import { BASE_GARRISON } from '../src/content/regions.rules.js';
import { power, resolveField, emptyComp } from '../src/battle/combat.js';
import { garrisonMultOf } from '../src/battle/terrain.js';
import { generateBattleMap } from '../src/battle/mapgen.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { createState } from '../src/core/store.js';
import { markConquered, refreshUnlocks } from '../src/meta/world.js';
import { REGIONS } from '../src/content/regions.data.js';
import { distance } from '../src/core/hex.js';

const comp = (o) => ({ ...emptyComp(), ...o });

// ---------------------------------------------------------------------------
// 1. They are actually different buildings
// ---------------------------------------------------------------------------

test('kinds: the yard trains and the wall does not, and neither does both', () => {
  assert.equal(SITES.stronghold.train, 0,
    'a stronghold that still trains is the old single building wearing two names');
  assert.ok(SITES.trainingGround.train > 0, 'a training ground must train');
  assert.equal(SITES.trainingGround.gold, 0, 'a training ground is not an economy');

  // The wall has to be worth defending and the yard has to be worth losing.
  assert.ok(SITES.stronghold.defMult > SITES.trainingGround.defMult * 1.3,
    'the wall must be materially harder than the yard, or the split is cosmetic');
  assert.ok(SITES.stronghold.hp > SITES.trainingGround.hp,
    'the wall must take a real siege');
  // ...and the yard has to beat what it replaced, since it gave up defending.
  assert.ok(SITES.trainingGround.train > 1.0,
    'the yard trades away its walls, so it must out-produce the stronghold it replaced');
});

test('kinds: every per-kind table lists every kind', () => {
  // The site version of the gotcha that shipped three units with a JS hue and no
  // CSS variable: a table with a hole in it does not throw, it silently returns
  // undefined and something downstream reads it as a zero or a default.
  const tables = {
    INFLUENCE_RADIUS,
    'AI.siteValue': AI.siteValue,
    'MAPGEN.trainType': MAPGEN.trainType,
  };
  for (const [name, table] of Object.entries(tables)) {
    for (const kind of SITE_KINDS) {
      // A stronghold has no train type BECAUSE it cannot train — the one
      // deliberate hole, and it is the rule rather than an omission.
      if (name === 'MAPGEN.trainType' && kind === 'stronghold') continue;
      assert.ok(table[kind] !== undefined, `${name} has no entry for "${kind}"`);
    }
  }
  for (const faction of ['player', 'enemy', 'neutral']) {
    const held = MAPGEN.garrison[faction];
    assert.ok(held.trainingGround, `MAPGEN.garrison.${faction} has no training ground`);
  }
  assert.ok(BASE_GARRISON.trainingGround, 'BASE_GARRISON has no training ground');
});

// ---------------------------------------------------------------------------
// 2. garrisonMult — the term that is not just a bigger defMult
// ---------------------------------------------------------------------------

test('garrisonMult: it defends, and only on the site that owns it', () => {
  const g = comp({ spearmen: 10 });
  const foe = comp({ militia: 20 });
  const base = power(g, foe, { defending: true, onOwnSite: true });
  const buffed = power(g, foe, { defending: true, onOwnSite: true, garrisonMult: 1.3 });
  assert.ok(Math.abs(buffed / base - 1.3) < 1e-9, 'it must scale the whole defence once');

  // NEGATIVE CONTROLS, and both matter. A term that applied to an attacking
  // stack would be a stronghold's garrison carrying its walls with it, and one
  // that applied off-site would follow a relief force onto somebody else's farm.
  assert.equal(power(g, foe, { garrisonMult: 1.3 }), power(g, foe, {}),
    'it must do nothing on the attack');
  assert.equal(
    power(g, foe, { defending: true, onOwnSite: false, garrisonMult: 1.3 }),
    power(g, foe, { defending: true, onOwnSite: false }),
    'it must do nothing for a garrison standing on ground it does not hold',
  );
});

test('garrisonMult: HALBERDS CANNOT STRIP IT — that is the whole separation', () => {
  // `sunder` is the answer to `siteDefMult`, which is the one term no amount of
  // army beats. If it answered this too, a stronghold would be a farm with a
  // bigger number and the one unit that already counters big numbers would
  // counter it. So the wall has an answer and the men in it do not: bodies, and
  // engines to out-pace the regen.
  const holding = comp({ spearmen: 20 });
  const halberds = comp({ halberds: 30 });
  assert.ok(UNITS.halberds.sunder > 0, 'this test is about halberds sundering');

  const opts = { siteDefMult: SITES.stronghold.defMult, defenderOwnsSite: true };
  const plain = resolveField(halberds, holding, opts);
  const buffed = resolveField(halberds, holding, { ...opts, garrisonMult: 1.3 });
  assert.ok(Math.abs(buffed.defPower / plain.defPower - 1.3) < 1e-9,
    'the garrison term survived the sunder at full strength');

  // ...and the control: `siteDefMult` really was being stripped in that same
  // call, so the assertion above is about survival rather than about a sunder
  // that never happened.
  const unsundered = resolveField(comp({ militia: 30 }), holding, opts);
  assert.ok(plain.defPower < unsundered.defPower,
    'the halberds did not strip anything, so nothing was proved about surviving it');
});

test('garrisonMultOf: 1 for everything that is not a wall', () => {
  const state = { sites: [] };
  for (const kind of SITE_KINDS) {
    const want = kind === 'stronghold' ? SITES.stronghold.garrisonMult : 1;
    assert.equal(garrisonMultOf(state, { kind }), want, `${kind}`);
  }
  assert.ok(SITES.stronghold.garrisonMult > 1, 'the wall must actually buff its garrison');
});

// ---------------------------------------------------------------------------
// 3. The map puts the war machine on the throne's doorstep
// ---------------------------------------------------------------------------

/** A real config for `id`, on the real path the game uses. */
function configFor(id, seed) {
  const state = createState({ seed: 1, now: 0 });
  const i = REGIONS.findIndex((r) => r.id === id);
  for (const p of REGIONS.slice(0, i)) markConquered(state.meta, p.id, { now: 0, durationMs: 0 });
  refreshUnlocks(state.meta, null);
  return buildBattleConfig(state.meta, id, [], generateBattleMap, { seed });
}

test('map: EVERY faction that holds anything can build a soldier', () => {
  // A stronghold trains nothing now, so rounding alone can hand a faction a
  // battle it cannot replace a casualty in. It did: riverfen's enemy gets four
  // extra sites, `enemyStrongholdShare` rounds that to one hold and a 50% fort
  // share rounds the one hold to a fort. The tier-1 enemy would have fought the
  // campaign opener on castle production alone and nothing would have failed.
  for (const r of REGIONS) {
    for (const seed of [1, 5, 9]) {
      const cfg = configFor(r.id, seed);
      for (const faction of ['player', 'enemy']) {
        const mine = cfg.sites.filter((s) => s.owner === faction);
        const yards = mine.filter((s) => SITES[s.kind].train > 0);
        assert.ok(yards.length >= 1,
          `${r.id} seed ${seed}: ${faction} holds ${mine.length} sites and not one of them `
          + 'can train — it cannot replace a single casualty all battle');
      }
    }
  }
});

test('map: the walls and yards sit nearer the throne than the farms do', () => {
  // A `band` alone could not do this and it is worth recording why: a band is a
  // vertical STRIPE of the map, so on a 16-wide board a band 30% wide is five
  // columns by twelve rows and a site inside it can sit eight hexes from a
  // castle inside the same one. Measured on gallowmoor before `pickHex` grew a
  // radius, the enemy's holds landed at 3/5/6/8 hexes while its farms averaged
  // CLOSER — the exact opposite of the intended shape.
  for (const id of ['riverfen', 'kaldan', 'gallowmoor', 'obsidian', 'widowsgate']) {
    for (const seed of [1, 5]) {
      const cfg = configFor(id, seed);
      const castle = cfg.sites.find((s) => s.kind === 'castle');
      const at = { q: castle.hex[0], r: castle.hex[1] };
      const away = (s) => distance({ q: s.hex[0], r: s.hex[1] }, at);
      const enemy = cfg.sites.filter((s) => s.owner === 'enemy' && s.kind !== 'castle');
      const holds = enemy.filter((s) => s.kind !== 'farm').map(away);
      const farms = enemy.filter((s) => s.kind === 'farm').map(away);
      if (!holds.length || !farms.length) continue;
      const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
      assert.ok(mean(holds) < mean(farms),
        `${id} seed ${seed}: the enemy's war machine averages ${mean(holds).toFixed(1)} hexes `
        + `from its throne and its farms ${mean(farms).toFixed(1)} — the heartland is `
        + 'farmland and the marches are fortified');
    }
  }
});
