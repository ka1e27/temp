// PREFERENCES, and the two chores they exist to delete.
//
// Every site starts holding 8 troops back from a rally, so a player who wants
// their rear country to forward everything had to open each site and walk the
// number to zero — in every region, forever. And every battle opened at 1x, so
// a player who reads a busy map better at half speed had to say so each time.
//
// Settings were deliberately dropped from the persisted slice at save v3 as
// "session state, rebuilt, never loaded". That was right for the transient
// flags that lived there and wrong for these, so they came back INSIDE `meta`
// — which is why no migration and no SAVE_VERSION bump was needed, and this
// file pins that: an old save must load, and a new preference must survive.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, createSettings, fromPersisted, toPersisted } from '../src/core/store.js';
import { save, load, createMemoryStorage } from '../src/meta/save.js';
import { adoptCampaign } from '../src/screens/mainmenu.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { generateBattleMap } from '../src/battle/mapgen.js';
import { startBattle } from '../src/battle/sim.js';
import { rallyKeepOf } from '../src/battle/state.js';
import { RALLY_KEEP } from '../src/content/balance.js';
import { SPEEDS, speedIndexOf } from '../src/screens/battle-keys.js';

const fresh = () => createState({ seed: 5, now: 0 });

// ---------------------------------------------------------------------------
// Shape and healing
// ---------------------------------------------------------------------------

test('settings: a new game starts with no preference, which means the defaults', () => {
  const s = fresh();
  assert.deepEqual(s.meta.settings, createSettings());
  assert.equal(s.meta.settings.rallyKeepDefault, null,
    'null means "whatever content says", so a content change still reaches old players');
  assert.equal(s.meta.settings.defaultSpeed, null);
});

test('settings: a save written before they existed loads to the defaults', () => {
  // The whole reason they live inside `meta`: `fromPersisted` heals missing
  // fields, so a v3 save with no `settings` key at all is not a migration.
  const old = { saveVersion: 3, seed: 1, createdAt: 0, lastSeenAt: 0, meta: { crowns: 12 } };
  const state = fromPersisted(old, { now: 0 });
  assert.deepEqual(state.meta.settings, createSettings());
  assert.equal(state.meta.crowns, 12, 'and the rest of the save is untouched');
});

test('settings: nonsense is healed rather than trusted', () => {
  const bad = {
    saveVersion: 3,
    meta: { settings: { rallyKeepDefault: -4, defaultSpeed: 'fast' } },
  };
  const state = fromPersisted(bad, { now: 0 });
  assert.equal(state.meta.settings.rallyKeepDefault, null, 'a negative hold-back is not a value');
  assert.equal(state.meta.settings.defaultSpeed, null);

  const ok = fromPersisted({
    saveVersion: 3, meta: { settings: { rallyKeepDefault: 6.7, defaultSpeed: 0.5 } },
  }, { now: 0 });
  assert.equal(ok.meta.settings.rallyKeepDefault, 6, 'a fractional troop is floored');
  assert.equal(ok.meta.settings.defaultSpeed, 0.5);
});

test('settings: they survive a real save and load', () => {
  const s = fresh();
  s.meta.settings.rallyKeepDefault = 0;
  s.meta.settings.defaultSpeed = 0.5;

  const storage = createMemoryStorage();
  assert.equal(save(s, storage, { now: 1000 }).ok, true);
  const back = load(storage, { now: 2000 });
  assert.equal(back.ok, true, back.reason);
  assert.equal(back.state.meta.settings.rallyKeepDefault, 0, 'zero is a VALUE, not absent');
  assert.equal(back.state.meta.settings.defaultSpeed, 0.5);
  assert.ok(toPersisted(s).meta.settings, 'and they are actually in the written bytes');
});

// ---------------------------------------------------------------------------
// They belong to the player, not to the save
// ---------------------------------------------------------------------------

test('settings: a new campaign keeps them', () => {
  // `adoptCampaign` replaces `meta` wholesale. Without carrying settings across,
  // every reset would silently restore the chore this feature removes.
  const ctx = { state: fresh(), bus: null };
  ctx.state.meta.settings.rallyKeepDefault = 0;
  ctx.state.meta.settings.defaultSpeed = 2;

  adoptCampaign(ctx, { meta: fresh().meta, seed: 9 }, 100);

  assert.equal(ctx.state.meta.crowns, 0, 'the campaign really was replaced');
  assert.equal(ctx.state.meta.settings.rallyKeepDefault, 0);
  assert.equal(ctx.state.meta.settings.defaultSpeed, 2);
});

test('settings: importing someone else’s save does not adopt their preferences', () => {
  const ctx = { state: fresh(), bus: null };
  ctx.state.meta.settings.rallyKeepDefault = 0;

  const theirs = fresh();
  theirs.meta.crowns = 5000;
  theirs.meta.settings.rallyKeepDefault = 40;
  adoptCampaign(ctx, theirs, 100);

  assert.equal(ctx.state.meta.crowns, 5000, 'their progress came across');
  assert.equal(ctx.state.meta.settings.rallyKeepDefault, 0, 'their habits did not');
});

// ---------------------------------------------------------------------------
// The hold-back actually reaches the battle
// ---------------------------------------------------------------------------

const campOf = (state) => {
  const cfg = buildBattleConfig(state, 'riverfen', [], generateBattleMap, { seed: 4242 });
  return { cfg, battle: startBattle(cfg) };
};

test('settings: the hold-back crosses the seam and seeds every site', () => {
  // The point of the whole feature. Without it, a player who wants zero has to
  // set it on each of a region's sites, every battle.
  const s = fresh();
  s.meta.settings.rallyKeepDefault = 0;
  const { cfg, battle } = campOf(s);

  assert.equal(cfg.rules.rallyKeepDefault, 0, 'it is on the config, not read from meta');
  for (const site of battle.sites) {
    assert.equal(rallyKeepOf(site), 0, `${site.id} did not take the preference`);
  }
});

test('settings: no preference means exactly the old behaviour', () => {
  const { cfg, battle } = campOf(fresh());
  assert.equal(cfg.rules.rallyKeepDefault, RALLY_KEEP.default);
  for (const site of battle.sites) assert.equal(rallyKeepOf(site), RALLY_KEEP.default);
});

test('settings: a hold-back beyond the band is clamped, not carried raw', () => {
  const s = fresh();
  s.meta.settings.rallyKeepDefault = 9999;
  const { battle } = campOf(s);
  for (const site of battle.sites) assert.equal(rallyKeepOf(site), RALLY_KEEP.max);
});

// ---------------------------------------------------------------------------
// Speed
// ---------------------------------------------------------------------------

test('settings: a saved speed is a real stop on the ladder', () => {
  for (const mult of SPEEDS) {
    assert.equal(SPEEDS[speedIndexOf(mult)], mult, `${mult}x must round-trip exactly`);
  }
  // A preference saved before the ladder changed shape still lands somewhere sane.
  assert.equal(SPEEDS[speedIndexOf(3.9)], 4);
  assert.equal(SPEEDS[speedIndexOf(0.1)], 0.25);
});
