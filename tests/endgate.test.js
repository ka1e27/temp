// THE TWO ENDGAME LOOPS WERE INVISIBLE UNTIL THEY UNLOCKED.
//
// The incursion ladder and abdication were absent from the DOM entirely until
// the campaign was finished — not disabled, not shown-locked, simply not built.
// So a player twelve regions into a twenty-four-region campaign had no way to
// know either existed, and `ENDGAME.incursionLocked` / `ENDGAME.abdicateLocked`,
// written for exactly this moment, had NO READER anywhere in the tree. That is
// the dead-copy shape `IDLE.awayCapped` was already found in once, where a whole
// strings block sat unreachable while a screen hardcoded its own beside it.
//
// The game already had the right pattern and had proved it: `screens/shop.js`
// shows the Crown tier locked WITH its price and its unlock condition from a
// region-1 save.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// The SHARED fake document, imported for its side effect of installing the
// shims — a second shim in this file would be a second document to keep in
// step, which is exactly what that fixture's own header exists to prevent.
// It must be imported before `endgate.js`, which reaches for `document`.
import './fixtures/panelDom.js';
import { ENDGAME } from '../src/content/strings.js';

const { endgameEntry } = await import('../src/screens/endgate.js');

const src = (f) => readFileSync(new URL(`../src/screens/${f}`, import.meta.url), 'utf8');

test('a LOCKED entry is on screen, disabled, and says why', () => {
  const el = endgameEntry({
    cls: 'wm-incursion', text: ENDGAME.incursionTitle, open: false,
    why: ENDGAME.incursionLocked, label: 'open it', onOpen: () => {},
  });
  assert.equal(el.textContent, ENDGAME.incursionTitle);
  assert.equal(el.getAttribute('disabled'), '');
  assert.equal(el.getAttribute('data-locked'), '1');
  assert.equal(el.getAttribute('title'), ENDGAME.incursionLocked);
  assert.match(el.getAttribute('aria-label'), /Take every region/);
});

test('an OPEN entry carries none of that', () => {
  const el = endgameEntry({
    cls: 'wm-incursion', text: ENDGAME.incursionTitle, open: true,
    why: ENDGAME.incursionLocked, label: 'Open the incursion briefing', onOpen: () => {},
  });
  assert.equal(el.getAttribute('disabled'), null);
  assert.equal(el.getAttribute('data-locked'), null);
  assert.equal(el.getAttribute('title'), null);
  assert.equal(el.getAttribute('aria-label'), 'Open the incursion briefing');
});

test('a locked entry does not act, even if something clicks it anyway', () => {
  // `disabled` is a presentation fact. A keyboard, a script or a stray
  // `el.click()` can still reach a handler, and the handler is what would push
  // a scene the player has not earned — so the guard is in both places.
  let fired = 0;
  const el = endgameEntry({
    cls: 'x', text: 'X', open: false, why: 'nope', label: 'l',
    onOpen: () => { fired++; },
  });
  el.fire('click');
  assert.equal(fired, 0);
});

test('...and an open one does', () => {
  let fired = 0;
  const el = endgameEntry({
    cls: 'x', text: 'X', open: true, why: 'nope', label: 'l',
    onOpen: () => { fired++; },
  });
  el.fire('click');
  assert.equal(fired, 1);
});

test('EVERY locked string in ENDGAME reaches a screen', () => {
  // The guard that would have caught the original defect, and the same one
  // `tests/offlinenotice.test.js` applies to `IDLE` for the same reason: a
  // string with no reader goes stale silently and nobody finds out, because
  // nothing fails.
  const tree = ['worldmap.js', 'worldmap-header.js', 'mainmenu.js', 'endgate.js',
    'incursion.js', 'mainmenu-legacy.js', 'prebattle.js'].map(src).join('\n');
  for (const key of Object.keys(ENDGAME)) {
    if (!/Locked$/.test(key)) continue;
    assert.match(tree, new RegExp(`ENDGAME\\.${key}\\b`), `ENDGAME.${key} has no reader`);
  }
});

test('neither entry is built conditionally any more', () => {
  // Asserted against the SOURCE, because the defect was structural rather than
  // behavioural: the old code read `canAbdicate(meta()) ? build : nothing`, and
  // a test that only drove the unlocked path would have passed against it
  // forever. Reverting to a conditional mount is what this catches.
  // THE WORLD MAP IS TWO FILES, and naming one of them is how this test broke
  // once already: the header moved to `worldmap-header.js` at the line cap and
  // every assertion here started failing on a file path rather than on the
  // property it cares about. The screen is the unit, so the screen is what is
  // read — same reason the string-coverage test above joins a list.
  const map = src('worldmap.js') + src('worldmap-header.js');
  assert.doesNotMatch(map, /incursionView\([^)]*\)\.open\s*\?/,
    'the incursion button must not be built conditionally');
  assert.doesNotMatch(src('mainmenu.js'), /if\s*\(canAbdicate\([^)]*\)\)\s*\{/,
    'the abdicate button must not be built conditionally');
  assert.doesNotMatch(map, /frontierOpen\([^)]*\)\s*\?/,
    'the frontier button must not be built conditionally');
  // It reaches `endgameEntry` through the two named wrappers rather than calling
  // it itself, so assert on what it actually builds — pinning the inner name
  // would have failed the moment the wrappers shipped, which is a test asserting
  // a call graph rather than the property it cares about.
  assert.match(map, /incursionEntry\(/);
  assert.match(map, /frontierEntry\(/);
  assert.match(src('mainmenu.js'), /endgameEntry\(/);
});
