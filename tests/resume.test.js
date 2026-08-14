// Mid-battle resume. A battle runs 8-14 minutes; losing one to a refresh is
// the papercut this exists to remove.
//
// The asymmetry with save.js matters and is asserted here: progress is
// PRECIOUS (a suspicious save is preserved and refused), an interrupted battle
// is EPHEMERAL (anything suspicious is discarded, never repaired).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  saveBattle, loadBattle, clearBattle, RESUME_KEY, RESUME_MAX_AGE_MS,
} from '../src/meta/resume.js';
import { createMemoryStorage } from '../src/meta/save.js';
import { createState } from '../src/core/store.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { generateBattleMap } from '../src/battle/mapgen.js';
import { startBattle, step } from '../src/battle/sim.js';
import { CONTRACT_VERSION } from '../src/battle/contract.js';
import { adoptCampaign } from '../src/screens/mainmenu.js';

const NOW = 1_700_000_000_000;

function liveBattle(ticks = 300) {
  const state = createState({ seed: 21, now: 0 });
  const config = buildBattleConfig(state.meta, 'riverfen', [], generateBattleMap, { seed: 21 });
  const battle = startBattle(config);
  for (let i = 0; i < ticks; i++) step(battle);
  return { battle, config };
}

test('a battle round-trips through storage exactly', () => {
  const storage = createMemoryStorage();
  const { battle, config } = liveBattle();
  assert.ok(saveBattle(storage, battle, config, NOW).ok);

  const got = loadBattle(storage, NOW + 1000);
  assert.ok(got.ok, `expected a resumable battle, got "${got.reason}"`);
  assert.deepEqual(got.battle, JSON.parse(JSON.stringify(battle)), 'state must survive intact');
  assert.equal(got.battle.tick, battle.tick);
});

test('a resumed battle keeps stepping from where it stopped', () => {
  const storage = createMemoryStorage();
  const { battle, config } = liveBattle(200);
  saveBattle(storage, battle, config, NOW);

  const resumed = loadBattle(storage, NOW).battle;
  const before = resumed.tick;
  for (let i = 0; i < 50; i++) step(resumed);
  assert.equal(resumed.tick, before + 50, 'a restored battle must be a live battle');
  assert.ok(Number.isFinite(resumed.factions.player.goldCg));
});

test('a finished battle is never offered for resume', () => {
  const storage = createMemoryStorage();
  const { battle, config } = liveBattle(50);
  battle.status = 'win';
  assert.equal(saveBattle(storage, battle, config, NOW).ok, false, 'not written once decided');

  // Even if one were somehow on disk, it must not come back.
  storage.setItem(RESUME_KEY, JSON.stringify({
    contractVersion: CONTRACT_VERSION, savedAt: NOW, battle, config,
  }));
  const got = loadBattle(storage, NOW);
  assert.equal(got.ok, false);
  assert.equal(got.reason, 'already-finished');
});

test('clearing removes it', () => {
  const storage = createMemoryStorage();
  const { battle, config } = liveBattle(20);
  saveBattle(storage, battle, config, NOW);
  clearBattle(storage);
  assert.equal(loadBattle(storage, NOW).reason, 'empty');
});

// --- everything suspicious is DISCARDED, not preserved --------------------

test('a battle from an older contract is discarded, not stepped', () => {
  // The shape the simulation expects changed; replaying it would corrupt.
  const storage = createMemoryStorage();
  const { battle, config } = liveBattle(20);
  storage.setItem(RESUME_KEY, JSON.stringify({
    contractVersion: CONTRACT_VERSION - 1, savedAt: NOW, battle, config,
  }));
  const got = loadBattle(storage, NOW);
  assert.equal(got.ok, false);
  assert.equal(got.reason, 'stale-contract');
  assert.equal(storage.getItem(RESUME_KEY), null, 'discarded — unlike a save, this is not precious');
});

test('a stale battle does not ambush a player who moved on', () => {
  const storage = createMemoryStorage();
  const { battle, config } = liveBattle(20);
  saveBattle(storage, battle, config, NOW);
  const got = loadBattle(storage, NOW + RESUME_MAX_AGE_MS + 1);
  assert.equal(got.reason, 'too-old');
  assert.equal(storage.getItem(RESUME_KEY), null);
});

test('corrupt or incomplete blobs are discarded without throwing', () => {
  for (const raw of ['not json', 'null', '{}', '{"contractVersion":2}', '[]']) {
    const storage = createMemoryStorage();
    storage.setItem(RESUME_KEY, raw);
    const got = loadBattle(storage, NOW);
    assert.equal(got.ok, false, `"${raw}" must not resume`);
    assert.equal(storage.getItem(RESUME_KEY), null, `"${raw}" must be cleared`);
  }
});

test('an empty slot is not an error', () => {
  assert.equal(loadBattle(createMemoryStorage(), NOW).reason, 'empty');
});

test('unreadable storage never takes the boot down', () => {
  const hostile = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); },
  };
  assert.doesNotThrow(() => loadBattle(hostile, NOW));
  assert.equal(loadBattle(hostile, NOW).ok, false);
  const { battle, config } = liveBattle(10);
  assert.doesNotThrow(() => saveBattle(hostile, battle, config, NOW));
  assert.equal(saveBattle(hostile, battle, config, NOW).ok, false);
  assert.doesNotThrow(() => clearBattle(hostile));
});

// --- the blob must not outlive the empire it belongs to -------------------

test('adopting a campaign drops the mid-battle blob from disk', () => {
  // `adoptCampaign` is New Campaign, Import Save and a backup restore — every
  // route that swaps one campaign for another. It set `state.battle = null` and
  // stopped there, which drops only the battle THIS SESSION was holding: the blob
  // lives in its own storage key and `loadBattle` runs before any screen does on
  // the next boot. screens/mainmenu-legacy.js already made exactly this call for
  // abdication, and its reasoning is not specific to abdication — the config names
  // a region this save no longer holds, and meta/resume.js validates the CONTRACT
  // rather than the campaign, so it would happily drop the player back into a
  // battle for ground that is not theirs.
  const storage = createMemoryStorage();
  const { battle, config } = liveBattle(20);
  assert.ok(saveBattle(storage, battle, config, NOW).ok);
  assert.ok(loadBattle(storage, NOW).ok, 'the fixture must start resumable');

  const ctx = { state: createState({ seed: 5, now: 0 }), bus: null, storage };
  ctx.state.meta.crowns = 4321;
  adoptCampaign(ctx, { meta: createState({ seed: 6, now: 0 }).meta, seed: 6 }, NOW);

  assert.equal(ctx.state.meta.crowns, 0, 'the campaign really was replaced');
  assert.equal(ctx.state.battle, null, 'the in-memory battle went');
  assert.equal(storage.getItem(RESUME_KEY), null, 'and so did the one on disk');
});

test('adopting a campaign survives having no storage at all', () => {
  // `ctx.storage` is handed over by main.js after the scenes are built, and every
  // headless test builds its own ctx — so this call has to be as optional as the
  // autosaver flush beside it.
  const ctx = { state: createState({ seed: 5, now: 0 }), bus: null };
  assert.doesNotThrow(() => adoptCampaign(
    ctx, { meta: createState({ seed: 6, now: 0 }).meta, seed: 6 }, NOW,
  ));
});

// A SOURCE-LEVEL ASSERTION, and it is one deliberately: src/main.js is a boot
// script whose top level constructs a storage adapter, a loop and the scene stack
// against a real `document`, so there is no function here to call. What it pins is
// a rule rather than a shape.
//
// THE RULE: the resume route must not win over a BLOCKED boot. `bootstrapGame`
// hands back a blank state when the save cannot be read, a blank state is
// indistinguishable from a fresh campaign, and the recovery affordance (the "save
// could not be read / autosave is off / export my broken save" drawer) is only
// reachable through the mainmenu branch. So a player mid-battle on region 21 whose
// save is corrupted was dropped straight into that battle against a level-0 meta
// with no message at all, and on finish `applyOutcome` paid a first-clear bonus
// into a blank meta that autosave was correctly refusing to write. It is the same
// early-return-above-the-refusal-message bug screens/mainmenu-recovery.js exists
// because of, one layer further out.
test('a refused save is not overridden by the resume route', async () => {
  const src = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const call = src.match(/^.*loadBattle\(storage[^\n]*$/m)?.[0] ?? '';
  assert.ok(call, 'main.js no longer calls loadBattle — update this test');
  const guarded = /boot\.blocked[\s\S]{0,120}loadBattle\(storage/.test(src);
  assert.ok(guarded,
    'the loadBattle call must be gated on boot.blocked, or a corrupt save plus a '
    + `live battle blob silently starts a blank campaign. Found: ${call.trim()}`);
  // The save itself is never destroyed on this path — that is the whole point of
  // blocking — and neither is the blob, which may still be resumable once a backup
  // is restored. Nothing in main.js may reach for either remover.
  assert.doesNotMatch(src, /clearSave|removeItem/,
    'a blocked boot must preserve both files; whatever the player chooses next '
    + 'goes through adoptCampaign');
});

test('the resume slot never touches the save slot', () => {
  const storage = createMemoryStorage();
  storage.setItem('hexdominion.save', '{"kept":true}');
  const { battle, config } = liveBattle(20);
  saveBattle(storage, battle, config, NOW);
  clearBattle(storage);
  assert.equal(storage.getItem('hexdominion.save'), '{"kept":true}',
    'progress must be untouched by an ephemeral battle blob');
});

// EVERYTHING ABOVE PROVES THE MECHANIC WORKS. This last one proves the game
// SAYS SO, and it lives here rather than with the other HUD tests on purpose:
// a feature the player is never told about is this project's signature bug —
// four upgrades were refunded for it and six features shipped inert — and the
// place to catch it is beside the behaviour being advertised, so that deleting
// one and not the other fails immediately.
//
// The gap it closes: Withdraw is the ONLY labelled way out of a battle, and it
// gives up the region. Closing the tab costs nothing (autosaved every four
// seconds by screens/battle.js, resumed ahead of every other boot route by
// main.js, valid for twelve hours) and nothing anywhere said so — so "I have to
// go" and "I give up" were the same button on a fight that runs 8-14 minutes.
test('the player is TOLD the battle survives leaving', async () => {
  // The smallest fake document `ui/dom.js` will accept. tests/sitepanel.test.js
  // carries the full one; this needs a button, a div and their text.
  class FakeNode {}
  class FakeEl extends FakeNode {
    constructor(tag) {
      super();
      this.tagName = String(tag).toUpperCase();
      this.kids = []; this.attrs = {}; this.dataset = {}; this.handlers = {};
      this.own = ''; this.style = { setProperty() {} };
      const classes = new Set();
      this.classList = {
        add: (...c) => c.forEach((x) => classes.add(x)),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c),
        toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
      };
    }

    get textContent() { return this.own + this.kids.map((k) => k.textContent).join(''); }
    set textContent(v) { this.kids.length = 0; this.own = String(v); }
    setAttribute(k, v) { this.attrs[k] = v; }
    addEventListener(t, fn) { (this.handlers[t] ??= []).push(fn); }
    fire(t) { for (const fn of this.handlers[t] ?? []) fn({ type: t }); }
    append(...n) { this.kids.push(...n); }
  }
  const prevNode = globalThis.Node;
  const prevDoc = globalThis.document;
  globalThis.Node = FakeNode;
  globalThis.document = {
    createElement: (tag) => new FakeEl(tag),
    createTextNode: (t) => { const e = new FakeEl('#text'); e.own = String(t); return e; },
  };
  try {
    const { createWithdraw } = await import('../src/screens/battle-alert.js');
    const w = createWithdraw({ input: { withdraw() {} } });

    // The tooltip carries it for a pointer. A touchscreen has no hover at all,
    // which is why it cannot be the only channel.
    assert.match(String(w.el.attrs.title ?? ''), /saved|resume/i,
      'the Withdraw tooltip must name the non-destructive alternative');

    // The armed state is the channel that reaches a phone: it is the moment the
    // player has decided to leave and not yet decided how.
    assert.equal(w.hint.textContent, '', 'the hint must be silent until armed');
    w.el.fire('click');
    assert.match(w.hint.textContent, /resume|saved|keeps it/i,
      'arming Withdraw must offer the alternative, or a player who only needs to '
      + 'stop for now has exactly one visible option and it loses the region');

    // NEGATIVE CONTROL. Without this the test would pass just as happily if the
    // hint were hard-coded on, which is a different bug wearing the same green:
    // a permanent line of copy beside a destructive button reads as noise and
    // gets tuned out long before it is needed.
    w.update(Date.now() + 60_000);
    assert.equal(w.hint.textContent, '',
      'the hint must clear with the disarm, not linger');
  } finally {
    globalThis.Node = prevNode;
    globalThis.document = prevDoc;
  }
});
