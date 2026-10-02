// Robustness regressions from the bug-hunt audit (items 1-9): each test names the failure it prevents. The real-browser half of 1-5 is tools/check.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSceneManager } from '../scenes/flow.js';
import { createAutosave, storedSeq } from '../app/autosave.js';
import { createStateContainer } from '../app/stateContainer.js';
import {
  SAVE_KEY, serialize, deserialize, importCode, exportCode, plausibleBattle, sanitizeSettings, MAX_IMPORT_CHARS, BATTLE_SAVE_VERSION,
} from '../meta/save.js';
import { createGame } from '../meta/state.js';
import { createBattle } from '../battle/sim.js';
import { buildArena, canBuildArena } from '../battle/arena.js';
import { UPGRADES } from '../meta/upgrades.js';
import { FACTIONS } from '../config/world.js';
import { formatClock } from '../ui/format.js';
import { makeWorld } from './meta.fixtures.js';
import { buildTestWorld, TARGET_REGION, DEFAULT_OWNERS } from './fixtures/battle-world.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

const PLAYER = Object.freeze({
  atk: 1, def: 1, growth: 1, speed: 1, campTroops: 30, garrisonShare: 0.35, capBonus: 0,
  cooldownMult: 1, powers: { rally: 1, firestorm: 1, bulwark: 1, march: 1, levy: 1 },
});
const ENEMY = Object.freeze({ atk: 1, def: 1, growth: 1, speed: 1, troopMult: 1, thinkSec: 2, personality: 'aggressive', factionId: 2 });

/** A real battle, as the save stores it (plain JSON). */
function realBattleJson() {
  const world = buildTestWorld();
  const arena = buildArena(world, DEFAULT_OWNERS, TARGET_REGION, PLAYER, ENEMY);
  return JSON.parse(JSON.stringify(createBattle(arena, PLAYER, ENEMY)));
}

// --- 1. a scene that throws while being entered never soft-locks the game ------------------------------------------------------------------------------------

test('1: a scene whose enter() throws is exited and the previous scene is entered again; the error is reported once', () => {
  const log = [];
  const errors = [];
  const mk = (name, throwOnEnter = false) => ({
    enter: (p) => { log.push(`${name}.enter${p && p.reverted ? '(reverted)' : ''}`); if (throwOnEnter) throw new Error(`${name} broke`); },
    exit: () => log.push(`${name}.exit`),
  });
  const mgr = createSceneManager({ onError: (err, name, prev) => errors.push([err.message, name, prev]) });
  const world = mk('world');
  const battle = mk('battle', true);
  assert.equal(mgr.goto('world', world, {}), true);
  log.length = 0;
  assert.equal(mgr.goto('battle', battle, { regionId: 3 }), false, 'goto reports the failure');
  assert.equal(mgr.name, 'world', 'the previous scene is current again');
  assert.equal(mgr.current, world);
  assert.deepEqual(errors, [['battle broke', 'battle', 'world']]);
  assert.ok(log.includes('battle.exit'), 'the half-entered scene was closed');
  assert.ok(log.includes('world.enter(reverted)'), 'the world was entered again, flagged as reverted');
  // and the manager still works afterwards
  assert.equal(mgr.goto('title', mk('title'), {}), true);
  assert.equal(mgr.name, 'title');
});

test('1: with no onError the original error still surfaces (nothing is swallowed silently)', () => {
  const mgr = createSceneManager();
  mgr.goto('world', { enter() {}, exit() {} }, {});
  assert.throws(() => mgr.goto('battle', { enter() { throw new Error('boom'); }, exit() {} }, {}), /boom/);
  assert.equal(mgr.name, 'world', 'even then the previous scene is restored');
});

test('1: canBuildArena says no where Attack would soft-lock (an owned region, an unknown one) and yes for a real target', () => {
  const world = buildTestWorld();
  assert.equal(canBuildArena(world, DEFAULT_OWNERS, TARGET_REGION), true);
  assert.equal(canBuildArena(world, DEFAULT_OWNERS, 0), false, 'already yours');
  assert.equal(canBuildArena(world, DEFAULT_OWNERS, 99), false, 'no such region');
});

// --- 2. a pending welcome belongs to the realm it was made for ----------------------------------------------------------------------------------------------

test('2: every replacement of the realm raises the epoch, so a pending welcome/prosperity made for the old one can be told apart', () => {
  const c = createStateContainer({ storage: memoryStorage(), now: () => 1000 });
  c.boot();
  const seen = [c.epoch];
  c.newRealm(5); seen.push(c.epoch);
  c.restart(); seen.push(c.epoch);
  c.reseed(9); seen.push(c.epoch);
  assert.equal(c.replaceState(createGame(11, c.get().world, 1000)), true); seen.push(c.epoch);
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] > seen[i - 1], `epoch rises at step ${i}: ${seen}`);
});

test('2: settings (Reduce Motion, sound, ...) survive New Realm and restart: they belong to the player, not the realm', () => {
  const c = createStateContainer({ storage: memoryStorage(), now: () => 1000 });
  c.boot();
  c.get().state.settings.reduceMotion = true;
  c.get().state.settings.sound = false;
  c.newRealm(7);
  assert.equal(c.get().state.settings.reduceMotion, true);
  assert.equal(c.get().state.settings.sound, false);
  c.restart();
  assert.equal(c.get().state.settings.reduceMotion, true);
});

// --- 3. two tabs, one save ----------------------------------------------------------------------------------------------------------------------------------

function tab(storage, { session = true } = {}) {
  const world = makeWorld();
  const raw = storage.getItem(SAVE_KEY);
  const state = raw ? deserialize(raw) : createGame(3, world, 1000);
  const events = { conflicts: 0, failures: 0 };
  let sessionStarted = session;
  let t = 1000;
  const autosave = createAutosave({
    storage, getState: () => state, now: () => (t += 10), canSave: () => sessionStarted,
    onConflict: () => { events.conflicts += 1; }, onFailure: () => { events.failures += 1; },
  });
  return { state, autosave, events, start() { sessionStarted = true; } };
}

test('3: a tab that finds a newer save written by another tab stops writing and raises the conflict once', () => {
  const storage = memoryStorage();
  const a = tab(storage);
  a.state.gold = 50;
  a.autosave.save();
  const b = tab(storage); // loads A's save (seq 1)
  assert.equal(b.autosave.knownSeq, null, 'not known until its first save');
  a.state.gold = 900;
  a.autosave.save(); // A moves on (seq 2)
  b.state.gold = 1;
  b.autosave.save(); // B is stale: it must NOT overwrite
  assert.equal(b.autosave.conflicted, true);
  assert.equal(b.events.conflicts, 1);
  assert.equal(deserialize(storage.getItem(SAVE_KEY)).gold, 900, "A's progress is intact");
  b.autosave.save(); b.autosave.save();
  assert.equal(b.events.conflicts, 1, 'the banner is raised once, not every tick');
  assert.equal(deserialize(storage.getItem(SAVE_KEY)).gold, 900);
  // A keeps saving normally
  a.state.gold = 1000;
  a.autosave.save();
  assert.equal(deserialize(storage.getItem(SAVE_KEY)).gold, 1000);
  assert.equal(a.events.conflicts, 0);
});

test('3: an idle tab that only shows the title never writes, so it can no longer erase the tab being played', () => {
  const storage = memoryStorage();
  const played = tab(storage);
  played.state.gold = 5000;
  played.autosave.save();
  const idle = tab(storage, { session: false });
  for (let i = 0; i < 5; i++) idle.autosave.save();
  idle.autosave.tick(1000);
  assert.equal(deserialize(storage.getItem(SAVE_KEY)).gold, 5000);
  assert.equal(idle.events.conflicts, 0, 'an idle tab is not in conflict: it just does not write');
});

test('3: the storage event tells an idle-but-playing tab at once; a stale value from the same tab does not', () => {
  const storage = memoryStorage();
  const a = tab(storage);
  a.autosave.save(); // seq 1
  const mine = storage.getItem(SAVE_KEY);
  a.autosave.onStorage({ key: SAVE_KEY, newValue: mine });
  assert.equal(a.autosave.conflicted, false, 'our own sequence is not a conflict');
  a.autosave.onStorage({ key: 'something-else', newValue: '{"saveSeq":99}' });
  assert.equal(a.autosave.conflicted, false, 'other keys are ignored');
  a.autosave.onStorage({ key: SAVE_KEY, newValue: JSON.stringify({ ...JSON.parse(mine), saveSeq: 7 }) });
  assert.equal(a.autosave.conflicted, true);
  assert.equal(a.events.conflicts, 1);
});

test('3: storedSeq tolerates absent and unreadable values', () => {
  assert.equal(storedSeq(null), 0);
  assert.equal(storedSeq('not json'), 0);
  assert.equal(storedSeq('{"saveSeq":"x"}'), 0);
  assert.equal(storedSeq('{"saveSeq":4.9}'), 4);
});

test('7: a storage write that throws (quota, private mode) is reported once and never crashes the frame; the next good write works', () => {
  const storage = memoryStorage();
  let broken = true;
  const flaky = { getItem: storage.getItem, setItem: (k, v) => { if (broken) throw new Error('QuotaExceededError'); storage.setItem(k, v); } };
  const a = tab(flaky);
  assert.doesNotThrow(() => { a.autosave.save(); a.autosave.save(); a.autosave.save(); });
  assert.equal(a.events.failures, 1, 'one notice, not one per tick');
  broken = false;
  a.autosave.save();
  assert.ok(storage.getItem(SAVE_KEY), 'recovers when the storage works again');
  broken = true;
  a.autosave.save();
  assert.equal(a.events.failures, 2, 'a new failure after a success is reported again');
});

// --- 4. an unresumable battle never bricks Continue -----------------------------------------------------------------------------------------------------------

test('4: a real saved battle is plausible, and survives a save round trip while its region is still the enemy\'s', () => {
  const b = realBattleJson();
  assert.equal(plausibleBattle(b, 2), true);
  const state = createGame(3, makeWorld(), 1000);
  state.owner = [...DEFAULT_OWNERS];
  state.battle = b;
  const back = deserialize(serialize(state));
  assert.ok(back.battle && back.battle.arena.regionId === TARGET_REGION, 'the battle is kept');
});

test('4: a battle that cannot be resumed is dropped on load (wrong version, empty, truncated, bad site, unknown region, owned region)', () => {
  const stateWith = (battle, owner = DEFAULT_OWNERS) => {
    const s = createGame(3, makeWorld(), 1000);
    s.owner = [...owner];
    s.battle = battle;
    return deserialize(serialize(s));
  };
  const good = realBattleJson();
  const variants = {
    'wrong version': { ...good, version: BATTLE_SAVE_VERSION + 1 },
    'empty object': {},
    'a string': 'battle',
    'no sites': { ...good, sites: [] },
    'no arena': { ...good, arena: null },
    'arena region unknown': { ...good, arena: { ...good.arena, regionId: 99 } },
    'site without a tile': { ...good, sites: [{ id: 0, troops: 1, owner: 0 }, ...good.sites.slice(1)] },
    'NaN time': { ...good, t: null },
    'no enemy': { ...good, enemy: undefined },
  };
  for (const [name, battle] of Object.entries(variants)) assert.equal(stateWith(battle).battle, null, `${name} is dropped`);
  assert.equal(stateWith(good, [0, 0]).battle, null, 'the region is already the player\'s: a resumed fight would be a ghost');
  assert.ok(stateWith(good).battle, 'the control: the good battle stays');
});

// --- 6. a save is sanitised, not trusted ------------------------------------------------------------------------------------------------------------------------

test('6: junk in a save is clamped or dropped on load; nothing non-finite survives', () => {
  const world = makeWorld();
  const base = JSON.parse(serialize(createGame(3, world, 1000)));
  const dirty = {
    ...base,
    gold: 'lots', seed: -5, saveSeq: 'x',
    dynasty: { level: 1e9, stars: -4 },
    owner: [0, 999, 4000000, 2, 1, 1],
    conqueredAt: [1, 'x', null, null, -3, 5],
    upgrades: { rally: 0, bogus: 5, [Object.keys(UPGRADES).find((k) => k !== 'rally')]: 1e9 },
    stats: { playSec: 'abc', battlesWon: -5, bestBattleSec: 'fast' },
    lastSeen: 'yesterday',
    settings: { sound: 'yes', musicVolume: 99, speed: 7, evil: 1 },
    prosperity: [1, 'x', 500, -2],
  };
  const s = deserialize(JSON.stringify(dirty));
  assert.ok(s, 'a save with a valid owner table loads');
  assert.equal(s.gold, 0, 'a string gold becomes 0 (no NaN in the HUD)');
  assert.ok(Number.isInteger(s.seed) && s.seed >= 0);
  assert.equal(s.saveSeq, 0);
  assert.ok(s.dynasty.level <= 99 && s.dynasty.level >= 1, `dynasty level capped: ${s.dynasty.level}`);
  assert.equal(s.dynasty.stars, 0);
  assert.ok(s.owner.every((v) => Number.isInteger(v) && v >= 0 && v < FACTIONS.length), `owner ids are real factions: ${s.owner}`);
  assert.equal(s.owner[1], 1, 'an out-of-range owner becomes Free Folk, never the player');
  assert.ok(s.conqueredAt.every((v) => v === null || (Number.isFinite(v) && v >= 0)), `conqueredAt is finite or null: ${s.conqueredAt}`);
  assert.ok(!('bogus' in s.upgrades), 'unknown upgrade ids are dropped');
  assert.ok(s.upgrades.rally >= 1, 'Rally is always owned');
  for (const [id, lvl] of Object.entries(s.upgrades)) assert.ok(Number.isInteger(lvl) && lvl <= (UPGRADES[id].max ?? 200), `${id} level ${lvl} within its maximum`);
  assert.equal(s.stats.playSec, 0, 'a string in playSec no longer grows forever');
  assert.equal(s.stats.battlesWon, 0);
  assert.equal(s.stats.bestBattleSec, null);
  assert.equal(s.lastSeen, 0, 'an unusable clock is 0 = unknown (the shell treats it as now)');
  assert.equal(s.settings.musicVolume, 1);
  assert.equal(s.settings.speed, sanitizeSettings({}).speed);
  assert.ok(!('evil' in s.settings));
  assert.ok(s.prosperity.every((v) => Number.isInteger(v) && v >= 0 && v <= 99));
});

test('6: importCode refuses an enormous paste before decoding it, and still accepts a real code', () => {
  const state = createGame(3, makeWorld(), 1000);
  const code = exportCode(state);
  assert.ok(code.length < MAX_IMPORT_CHARS / 4, `a real code (${code.length} chars) is far below the cap`);
  assert.ok(importCode(code), 'a real code imports');
  assert.ok(importCode(`  ${code.slice(0, 10)}\n${code.slice(10)}  `), 'whitespace is tolerated');
  assert.equal(importCode('A'.repeat(MAX_IMPORT_CHARS + 1)), null, 'over the cap is refused');
  assert.equal(importCode(null), null);
  assert.equal(importCode('%%%%'), null);
});

// --- 9. small guards ----------------------------------------------------------------------------------------------------------------------------------------------

test('9: formatClock never prints NaN', () => {
  assert.equal(formatClock(NaN), '—');
  assert.equal(formatClock(Infinity), '—');
  assert.equal(formatClock(undefined), '—');
  assert.equal(formatClock('12'), '—');
  assert.equal(formatClock(-5), '0:00');
  assert.equal(formatClock(65), '1:05');
  assert.equal(formatClock(3725), '1:02:05');
});

test('8: createRenderer with no 2D context throws a readable error (boot shows it) instead of drawing a blank map', async () => {
  const { createRenderer } = await import('../render/renderer.js');
  assert.throws(() => createRenderer({ getContext: () => null }), /no 2D canvas/);
});
