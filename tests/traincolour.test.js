// Three small rules that all failed the same way: something was DERIVED from the
// roster in one place and LISTED in another, and the two silently disagreed the
// moment a unit was added.
//
//   - the rally hold-back the player set applied to sites they started with and
//     not to sites they took;
//   - the marshal was offered as a thing a stronghold could be set to build;
//   - three units had a colour in the JS palette and no CSS variable at all.
//
// None of them threw. Each is pinned here against the real artefact — the
// simulation, the engine's own validator, the stylesheet on disk — rather than
// against a fixture that would encode the same assumption twice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { startBattle, step } from '../src/battle/sim.js';
import { drainCommands } from '../src/battle/commands.js';
import { TRAINABLE_UNITS, isTrainable } from '../src/battle/training.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { generateBattleMap } from '../src/battle/mapgen.js';
import { createState } from '../src/core/store.js';
import { markConquered, refreshUnlocks } from '../src/meta/world.js';
import { EVENTS } from '../src/battle/events.js';
import { UNIT_IDS, UNITS, RALLY_KEEP } from '../src/content/balance.js';
import { FALLBACK } from '../src/render/palette.js';

/**
 * A real battle for a real player, through `buildBattleConfig` rather than a
 * hand-built config object. The bug under test is that `state.rules` is a SUBSET
 * of `config.rules`, so a fixture that set the field directly on the battle
 * state would encode the bug and pass forever — the exact failure mode CLAUDE.md
 * warns about.
 */
function battleFor(regionId, settings = {}) {
  const state = createState({ seed: 1, now: 0 });
  markConquered(state.meta, 'riverfen', { now: 0, durationMs: 0 });
  refreshUnlocks(state.meta, null);
  Object.assign(state.meta.settings, settings);
  return startBattle(
    buildBattleConfig(state.meta, regionId, [], generateBattleMap, { seed: 1 }),
  );
}

const reasons = (state) => state.events
  .filter((e) => e.type === EVENTS.COMMAND_REJECTED).map((e) => e.reason);

// ---------------------------------------------------------------------------
// The rally hold-back reaches the ground you take
// ---------------------------------------------------------------------------

test('rally: a captured site inherits the standing hold-back, not the content default', () => {
  // `state.rules` is a hand-picked SUBSET of `config.rules`, not a copy, and
  // `rallyKeepDefault` was missing from it. Site creation reads `config.rules`
  // and was right; `capture()` reads `state.rules` and fell back to
  // RALLY_KEEP.default. So "leave nothing behind" held on the three sites you
  // landed with and not on any site you took — exactly backwards, since the ones
  // you take are the ones you have had no time to configure.
  const keep = 0;
  assert.notEqual(keep, RALLY_KEEP.default, 'this test needs a value that is not the default');
  const state = battleFor('ashford', { rallyKeepDefault: keep });

  for (const s of state.sites) {
    if (s.owner === 'player') assert.equal(s.rallyKeep, keep, `${s.id} started wrong`);
  }

  // Take one through the real siege path, not by assigning `owner` — `capture()`
  // is the function under test and only the simulation calls it.
  const target = state.sites.find((s) => s.owner !== 'player');
  assert.ok(target, 'the map produced nothing to take');
  target.garrison = Object.fromEntries(UNIT_IDS.map((u) => [u, 0]));
  target.hp = 0;
  target.siege = { owner: 'player', comp: { militia: 40 }, ticks: 0 };
  for (let i = 0; i < 60 && target.owner !== 'player'; i++) step(state);

  assert.equal(target.owner, 'player', 'the site never actually changed hands');
  assert.equal(target.rallyKeep, keep,
    `a captured site kept ${target.rallyKeep} instead of the player's ${keep}`);
});

test('rally: NEGATIVE CONTROL — an unset preference still lands on the content default', () => {
  // Without this the fix would pass just as well if it hardcoded 0 everywhere.
  const state = battleFor('ashford');
  const site = state.sites.find((s) => s.owner === 'player');
  assert.equal(site.rallyKeep, RALLY_KEEP.default);
  assert.equal(state.rules.rallyKeepDefault, RALLY_KEEP.default);
});

// ---------------------------------------------------------------------------
// The marshal is commissioned, never built
// ---------------------------------------------------------------------------

test('train: a capped unit is not a thing a stronghold can be set to build', () => {
  // Derived from `maxPerSite`, not listed, because the two halves are one rule:
  // a unit you may only have one of is bought outright with RECRUIT, and a unit
  // you may have any number of is trained.
  assert.ok(TRAINABLE_UNITS.length > 0);
  for (const u of UNIT_IDS) {
    const capped = (UNITS[u].maxPerSite ?? Infinity) !== Infinity;
    assert.equal(isTrainable(u), !capped, `${u} is on the wrong side of the train rule`);
  }
  assert.ok(!TRAINABLE_UNITS.includes('marshal'), 'the marshal is still a train option');
  assert.deepEqual(TRAINABLE_UNITS, UNIT_IDS.filter((u) => u !== 'marshal'),
    'every unit except the marshal should be trainable today');
});

test('train: the ENGINE refuses it, not just the picker', () => {
  // A stale keybinding, a replayed command log, or a hand-built command must not
  // be able to park a stronghold on a type it can never finish. The UI hiding a
  // chip is not a rule.
  const state = battleFor('ashford');
  const site = state.sites.find((s) => s.owner === 'player' && s.trainType);
  assert.ok(site, 'the map produced no player site that trains');
  state.mods.player.unlockedUnits = [...UNIT_IDS];   // even fully unlocked
  const was = site.trainType;

  state.commands.push({ t: 'TRAIN', site: site.id, unit: 'marshal' });
  drainCommands(state);
  assert.ok(reasons(state).includes('unit-not-trainable'),
    `the marshal order was not rejected (reasons: ${reasons(state).join(', ') || 'none'})`);
  assert.equal(site.trainType, was, 'the rejected order changed the site anyway');

  // NEGATIVE CONTROL: an ordinary unit still goes through on the same path, so
  // this is a rule about capped units and not a broken TRAIN command.
  state.events.length = 0;
  state.commands.push({ t: 'TRAIN', site: site.id, unit: 'spearmen' });
  drainCommands(state);
  assert.deepEqual(reasons(state), []);
  assert.equal(site.trainType, 'spearmen');
});

// ---------------------------------------------------------------------------
// Every unit has a colour, in both places that define one
// ---------------------------------------------------------------------------

test('palette: every unit has a CSS variable, and it matches the JS fallback', () => {
  // The canvas reads `--c-<unit>` and falls back to `FALLBACK` when the variable
  // is missing, so three units with a JS hue and no CSS variable drew correctly
  // on the board and as plain body text in every DOM surface — the train chip,
  // the loadout row. Nothing failed; they were just grey.
  const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
  for (const u of UNIT_IDS) {
    const match = css.match(new RegExp(`--c-${u}\\s*:\\s*(#[0-9a-fA-F]{3,8})\\s*;`));
    assert.ok(match, `tokens.css has no --c-${u}`);
    assert.equal(match[1].toLowerCase(), String(FALLBACK[u]).toLowerCase(),
      `--c-${u} disagrees with render/palette.js FALLBACK`);
  }
});

test('palette: the loadout list colours every unit it can show', () => {
  // The rows are keyed by `data-unit`, one CSS rule each, and the list has to
  // grow with the roster.
  const css = readFileSync(new URL('../src/styles/prebattle.css', import.meta.url), 'utf8');
  for (const u of UNIT_IDS) {
    assert.match(css, new RegExp(`\\.pb-unit\\[data-unit='${u}'\\]`),
      `prebattle.css never colours ${u}, so its name renders as plain text`);
  }
});

test('palette: hues are distinct enough to tell two contingents apart', () => {
  // A colour per unit is only worth having if no two are the same. Cheap
  // Euclidean distance in RGB — not perceptual, but it catches a copy-paste.
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  for (let i = 0; i < UNIT_IDS.length; i++) {
    for (let j = i + 1; j < UNIT_IDS.length; j++) {
      const [a, b] = [UNIT_IDS[i], UNIT_IDS[j]];
      const [ra, rb] = [rgb(FALLBACK[a]), rgb(FALLBACK[b])];
      const d = Math.hypot(ra[0] - rb[0], ra[1] - rb[1], ra[2] - rb[2]);
      assert.ok(d > 40, `${a} and ${b} are nearly the same colour (distance ${d.toFixed(0)})`);
    }
  }
});
