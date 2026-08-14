// Persistence: round-trip, the migration chain from a frozen fixture, and the
// refusal rules. The single most important assertion in this file is that a
// save we cannot read is still on disk afterwards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createState, toPersisted, fromPersisted, SAVE_VERSION, PERSISTED_KEYS }
  from '../src/core/store.js';
import {
  SAVE_KEY, BACKUP_KEY, AUTOSAVE_MS, MIGRATIONS, migrate, save, load, loadBackup,
  clearSave, hasSave, exportSave, importSave, createAutosaver, createMemoryStorage,
  createStorageAdapter, bootstrapGame,
} from '../src/meta/save.js';
import { markConquered, refreshUnlocks } from '../src/meta/world.js';
import { buy } from '../src/meta/upgrades.js';
import { RETIRED_UPGRADES } from '../src/content/upgrades.data.js';
import { recalcIncome } from '../src/meta/idle.js';

const V1 = JSON.parse(readFileSync(new URL('./fixtures/save.v1.json', import.meta.url), 'utf8'));

function played(now = 1_000_000) {
  const s = createState({ seed: 31337, now });
  s.meta.crowns = 20_000;
  markConquered(s.meta, 'riverfen', { now, durationMs: 312_000 });
  refreshUnlocks(s.meta);
  markConquered(s.meta, 'ashford', { now, durationMs: 401_000 });
  refreshUnlocks(s.meta);
  buy(s.meta, 'treasury'); buy(s.meta, 'treasury');
  s.meta.crowns = 9876.5;
  s.meta.boosters.rally = 2;
  s.meta.stats.battles = 7;
  recalcIncome(s.meta);
  return s;
}

// --- the persisted slice ---------------------------------------------------

test('only the persistent slice is saved; battle and session never are', () => {
  const s = played();
  s.battle = { tick: 500, sites: [] };
  s.session.pendingConfig = { huge: true };
  const slice = toPersisted(s);
  assert.deepEqual(Object.keys(slice).sort(), [...PERSISTED_KEYS].sort());
  assert.equal(slice.battle, undefined);
  assert.equal(slice.session, undefined);
});

test('toPersisted deep-clones, so a later mutation cannot change written bytes', () => {
  const s = played();
  const slice = toPersisted(s);
  s.meta.crowns = 0;
  s.meta.regions.riverfen.status = 'locked';
  assert.equal(slice.meta.crowns, 9876.5);
  assert.equal(slice.meta.regions.riverfen.status, 'conquered');
});

test('round-trip preserves everything that matters', () => {
  const s = played();
  const storage = createMemoryStorage();
  assert.equal(hasSave(storage), false);
  assert.equal(save(s, storage, { now: 1_000_000 }).ok, true);
  assert.equal(hasSave(storage), true);

  const r = load(storage, { now: 1_000_000 });
  assert.equal(r.ok, true);
  assert.equal(r.state.seed, 31337);
  assert.equal(r.state.meta.crowns, 9876.5);
  assert.equal(r.state.meta.upgrades.treasury, 2);
  assert.equal(r.state.meta.boosters.rally, 2);
  assert.equal(r.state.meta.stats.battles, 7);
  assert.equal(r.state.meta.regions.riverfen.status, 'conquered');
  assert.equal(r.state.meta.regions.riverfen.bestMs, 312_000);
  assert.equal(r.state.meta.regions.ashford.clears, 1);
  assert.equal(r.state.meta.regions.ironwood.status, 'available');
  assert.equal(r.state.battle, null, 'battle is rebuilt, never loaded');
  assert.equal(r.state.session.sceneId, null);
  // THE INCOME CACHE IS THE ONE FIELD THAT DOES NOT ROUND-TRIP, and that is the
  // point of it: `fromPersisted` heals it to 0 so `recalcIncome` stays its only
  // writer (meta/idle.js says so, meta/prestige.js repeats it, and meta/save.js's
  // own v2->v3 migration already wrote 0 here). It is a cache of a pure function
  // of regions and upgrades, so nothing is lost — and calling the one writer
  // rebuilds it exactly, which is what the deep-equal below then proves.
  assert.equal(r.state.meta.incomePerSec, 0, 'the cache is rebuilt, never loaded');
  assert.equal(recalcIncome(r.state.meta), s.meta.incomePerSec);
  assert.deepEqual(toPersisted(r.state), toPersisted(s));
});

test('a save from a region set that no longer exists is dropped, not fatal', () => {
  const s = played();
  const slice = toPersisted(s);
  slice.meta.regions.atlantis = { status: 'conquered', clears: 3, bestMs: 1, raidReadyAt: 0 };
  const healed = fromPersisted(slice, { now: 0 });
  assert.equal(healed.meta.regions.atlantis, undefined);
  assert.equal(healed.meta.regions.riverfen.status, 'conquered');
});

test('garbage field values are healed rather than trusted', () => {
  const healed = fromPersisted({
    saveVersion: SAVE_VERSION, seed: 5, createdAt: 'yesterday', lastSeenAt: NaN,
    meta: {
      crowns: -500, incomePerSec: 'lots', upgrades: { tithe: -3, ghost: 2.7 },
      boosters: { rally: '4' }, regions: { riverfen: { status: 'wizard', clears: -9 } },
    },
  }, { now: 42 });
  assert.equal(healed.meta.crowns, 0, 'negative crowns are impossible');
  assert.equal(healed.meta.incomePerSec, 0);
  assert.equal(healed.meta.upgrades.tithe, undefined);
  // `ghost` is not an upgrade this build sells, and it is now DROPPED rather than
  // floored-and-kept. It was always inert — `upgradeEffects` iterates the content
  // table, never the save — but a kept key persists forever and costs storage
  // quota, and an import is attacker-controlled: megabytes of junk ids is the
  // cheapest way to push a victim's origin over quota, at which point every
  // future write fails (silently, until this pass).
  assert.equal(healed.meta.upgrades.ghost, undefined, 'unknown ids must not persist');
  assert.equal(healed.meta.boosters.rally, undefined);
  assert.equal(healed.meta.regions.riverfen.status, 'locked');
  assert.equal(healed.meta.regions.riverfen.clears, 0);
  assert.equal(healed.lastSeenAt, 42);
});

// --- migration -------------------------------------------------------------

test('the frozen v1 fixture migrates all the way to the current version', () => {
  assert.equal(V1.version, 1, 'the fixture is frozen; never edit it');
  const r = migrate(V1);
  assert.equal(r.ok, true);
  assert.equal(r.from, 1);
  assert.equal(r.data.saveVersion, SAVE_VERSION);
  assert.equal(r.data.meta.crowns, 1234.5, 'treasury became crowns');
  assert.deepEqual(r.data.meta.upgrades, V1.upgrades);
  assert.deepEqual(r.data.meta.boosters, V1.boosters);
  assert.equal(r.data.lastSeenAt, V1.savedAt);
  // v1 stored region STATUS STRINGS; v3 stores records. Losing this conversion
  // would silently un-conquer everything the player owns.
  assert.deepEqual(r.data.meta.regions.riverfen,
    { status: 'conquered', clears: 1, bestMs: 0, raidReadyAt: 0 });
  assert.equal(r.data.meta.regions.ironwood.status, 'available');
  assert.equal(r.data.meta.regions.saltmere.status, 'locked');
  assert.equal(r.data.settings, undefined, 'settings are session state, not saved');
});

test('a v1 save loads through the public path and yields correct income', () => {
  const storage = createMemoryStorage({ [SAVE_KEY]: JSON.stringify(V1) });
  const boot = bootstrapGame(storage, { now: V1.savedAt });
  assert.equal(boot.loaded, true);
  assert.equal(boot.from, 1);
  assert.equal(boot.state.meta.regions.riverfen.status, 'conquered');
  // riverfen 1.0 + ashford 1.2 = 2.2. The save's two Tithe levels were refunded
  // rather than carried, so there is no income multiplier left on this player.
  assert.ok(Math.abs(boot.state.meta.incomePerSec - 2.2) < 1e-12);
  assert.equal(boot.state.meta.upgrades.tithe, undefined);
  assert.equal(boot.state.meta.regions.saltmere.status, 'available',
    'unlocks are recomputed on load, so new adjacency rules apply retroactively');
});

test('the migration chain has an entry for every version below the current one', () => {
  for (let v = 1; v < SAVE_VERSION; v++) {
    assert.equal(typeof MIGRATIONS[v], 'function', `no migration from v${v}`);
  }
  assert.equal(MIGRATIONS[SAVE_VERSION], undefined, 'the current version needs no migration');
});

test('a current-version save is passed through untouched', () => {
  const slice = toPersisted(played());
  const r = migrate(slice);
  assert.equal(r.ok, true);
  assert.equal(r.from, SAVE_VERSION);
  assert.deepEqual(r.data, slice);
});

// --- refusal ---------------------------------------------------------------

const REFUSALS = [
  ['corrupt', '{"saveVersion":3,"meta":'],
  ['corrupt', 'not json at all'],
  ['not-an-object', '[1,2,3]'],
  ['not-an-object', 'null'],
  ['no-version', '{"meta":{"crowns":5}}'],
  ['future-version', '{"saveVersion":999,"meta":{"crowns":5}}'],
  ['unknown-version', '{"saveVersion":0,"meta":{}}'],
];

test('every unreadable save is REFUSED and left exactly where it was', () => {
  for (const [reason, bytes] of REFUSALS) {
    const storage = createMemoryStorage({ [SAVE_KEY]: bytes });
    const r = load(storage, { now: 0 });
    assert.equal(r.ok, false, `${reason} should not load`);
    assert.equal(r.reason, reason, `bytes: ${bytes}`);
    assert.equal(storage.getItem(SAVE_KEY), bytes, 'THE FILE MUST STILL BE THERE');
    assert.equal(r.raw, bytes, 'the raw bytes come back so the UI can offer an export');
    assert.equal(storage.keys().length, 1, 'nothing else was written either');
  }
});

test('a future-version save is never overwritten by this build', () => {
  const future = '{"saveVersion":999,"meta":{"crowns":1000000}}';
  const storage = createMemoryStorage({ [SAVE_KEY]: future });
  const r = save(played(), storage, { now: 5 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'future-version');
  assert.equal(storage.getItem(SAVE_KEY), future);
  assert.equal(storage.getItem(BACKUP_KEY), null, 'not even a backup copy is made');
});

test('a refused load hands back a fresh state flagged blocked, and autosave locks', () => {
  const storage = createMemoryStorage({ [SAVE_KEY]: 'garbage' });
  const boot = bootstrapGame(storage, { now: 10, seed: 2 });
  assert.equal(boot.loaded, false);
  assert.equal(boot.blocked, true);
  assert.equal(boot.reason, 'corrupt');
  assert.equal(boot.state.meta.crowns, 0);

  const auto = createAutosaver({ storage });
  auto.disable(boot.reason);
  boot.state.session.dirty = true;
  auto.update(boot.state, 10 + AUTOSAVE_MS * 3);
  auto.flush(boot.state, 10 + AUTOSAVE_MS * 9);
  assert.equal(storage.getItem(SAVE_KEY), 'garbage', 'a locked autosaver never writes');
});

test('an empty slot is not an error, it is a new game', () => {
  const storage = createMemoryStorage();
  assert.equal(load(storage).reason, 'empty');
  const boot = bootstrapGame(storage, { now: 0, seed: 9 });
  assert.equal(boot.blocked, false);
  assert.equal(boot.loaded, false);
  assert.equal(boot.state.seed, 9);
});

// --- backup ----------------------------------------------------------------

test('the previous save is copied to the backup slot before every overwrite', () => {
  const storage = createMemoryStorage();
  const s = played();
  save(s, storage, { now: 1 });
  const first = storage.getItem(SAVE_KEY);
  assert.equal(storage.getItem(BACKUP_KEY), null, 'nothing to back up on a first write');

  s.meta.crowns = 1;
  save(s, storage, { now: 2 });
  assert.equal(storage.getItem(BACKUP_KEY), first);
  assert.equal(loadBackup(storage).state.meta.crowns, 9876.5);
  assert.equal(load(storage).state.meta.crowns, 1);
});

test('clearSave keeps a backup and is never called automatically', () => {
  const storage = createMemoryStorage();
  save(played(), storage, { now: 1 });
  clearSave(storage);
  assert.equal(hasSave(storage), false);
  assert.equal(loadBackup(storage).ok, true, 'the backup survives an explicit wipe');
});

test('a storage that throws degrades to a failed write, not a crash', () => {
  const hostile = createStorageAdapter({
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('QuotaExceededError'); },
    removeItem() { throw new Error('nope'); },
  });
  assert.equal(hostile.getItem(SAVE_KEY), null);
  const r = save(played(), hostile, { now: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'write-failed');
});

// --- export / import -------------------------------------------------------

test('export/import is a lossless base64 round-trip', () => {
  const s = played();
  const code = exportSave(s, { now: 1_000_000 });
  assert.match(code, /^[A-Za-z0-9+/]+=*$/);
  const r = importSave(code, { now: 2_000_000 });
  assert.equal(r.ok, true);
  // The income cache arrives unknown rather than trusted — see the round-trip
  // test above. `adoptCampaign` is what calls this on the real import path.
  assert.equal(r.state.meta.incomePerSec, 0);
  recalcIncome(r.state.meta);
  assert.deepEqual(toPersisted(r.state).meta, toPersisted(s).meta);
  // Whitespace from a copy-paste is tolerated.
  assert.equal(importSave(`${code.slice(0, 8)}\n ${code.slice(8)}`).ok, true);
});

test('import applies the same refusal rules and writes nothing', () => {
  assert.equal(importSave('!!!! not base64 !!!!').reason, 'corrupt');
  assert.equal(importSave(Buffer.from('{"nope":1}').toString('base64')).reason, 'no-version');
  assert.equal(
    importSave(Buffer.from('{"saveVersion":999}').toString('base64')).reason, 'future-version',
  );
});

test('a v1 export string still imports', () => {
  const code = Buffer.from(JSON.stringify(V1)).toString('base64');
  const r = importSave(code, { now: 0 });
  assert.equal(r.ok, true);
  assert.equal(r.from, 1);
  assert.equal(r.state.meta.crowns, 1234.5 + 60 + 132, 'with the retired Tithe refunded');
});

test('a retired upgrade is refunded once, at exactly what it charged', () => {
  // Four of the retired lines (Field Manual, Scout Report, Standing Orders,
  // Wrecking Crew) were SOLD and did nothing at all — no consumer anywhere in
  // the engine. The rest were folded into the six endless lines. Either way the
  // player paid for a promise this build does not keep.
  const owed = (id, levels) => {
    const spec = RETIRED_UPGRADES[id];
    let c = 0;
    for (let l = 0; l < levels; l++) c += Math.round(spec.base * spec.rate ** l);
    return c;
  };
  const state = fromPersisted({
    saveVersion: 3,
    meta: { crowns: 1000, upgrades: { tithe: 3, standingOrders: 1, treasury: 2 } },
  }, { now: 0 });

  assert.equal(state.meta.crowns, 1000 + owed('tithe', 3) + owed('standingOrders', 1));
  assert.equal(state.meta.upgrades.tithe, undefined);
  assert.equal(state.meta.upgrades.standingOrders, undefined);
  assert.equal(state.meta.upgrades.treasury, 2, 'a live line is untouched');
});

test('the refund happens exactly once, however many times a save is reloaded', () => {
  // It is idempotent because the key is DELETED as it is refunded: a save
  // written after the refund has no retired ids left to find. Without that, a
  // player who reopened the game would be paid again every time.
  const first = fromPersisted({
    saveVersion: 3, meta: { crowns: 0, upgrades: { tithe: 4 } },
  }, { now: 0 });
  const paid = first.meta.crowns;
  assert.ok(paid > 0, 'the fixture must actually be owed something');

  const again = fromPersisted(toPersisted(first), { now: 0 });
  assert.equal(again.meta.crowns, paid, 'a second load must not pay a second time');
});

// --- autosave --------------------------------------------------------------

test('autosave writes at most every 5s, and only when dirty', () => {
  const storage = createMemoryStorage();
  const auto = createAutosaver({ storage, intervalMs: AUTOSAVE_MS });
  const s = played();
  s.session.dirty = true;

  assert.equal(auto.update(s, 0).reason, 'scheduled', 'the first call only arms the timer');
  assert.equal(auto.update(s, 4_999).reason, 'waiting');
  assert.equal(auto.update(s, 5_000).ok, true);
  assert.equal(s.session.dirty, false, 'a successful write clears the dirty flag');

  assert.equal(auto.update(s, 10_000).reason, 'clean', 'nothing changed, nothing written');
  s.meta.crowns += 1;
  s.session.dirty = true;
  assert.equal(auto.update(s, 15_000).ok, true);
});

test('flush ignores both the timer and the dirty flag (hide / unload)', () => {
  const storage = createMemoryStorage();
  const auto = createAutosaver({ storage });
  const s = played();
  assert.equal(s.session.dirty, false);
  assert.equal(auto.flush(s, 1).ok, true);
  assert.equal(load(storage).state.meta.crowns, 9876.5);
});

test('no browser global and no clock is referenced in code, only in prose', () => {
  // Comments are stripped first: the header is allowed to SAY "no Date.now"
  // while the code is not allowed to CALL it. Same rule tools/checkpure.js uses.
  const code = readFileSync(new URL('../src/meta/save.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  for (const banned of
    ['addEventListener', 'window', 'document', 'localStorage', 'Date.now', 'Math.random', 'fetch(']) {
    assert.ok(!code.includes(banned), `save.js must not reference ${banned} in code`);
  }
});

test('no meta module reaches into battle/ except through the contract', () => {
  const files = ['world', 'idle', 'upgrades', 'boosters', 'modifiers', 'rewards', 'save', 'events'];
  for (const f of files) {
    const src = readFileSync(new URL(`../src/meta/${f}.js`, import.meta.url), 'utf8');
    for (const m of src.matchAll(/from\s+'([^']+)'/g)) {
      const path = m[1];
      assert.ok(path.endsWith('.js'), `${f}.js: import "${path}" needs a .js extension`);
      if (path.includes('/battle/')) {
        assert.ok(path.endsWith('/battle/contract.js'),
          `meta/${f}.js imports ${path} — meta may only import battle/contract.js`);
      }
      assert.ok(!path.includes('/render/') && !path.includes('/screens/') && !path.includes('/ui/'),
        `meta/${f}.js imports presentation code (${path})`);
    }
  }
});
