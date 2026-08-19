// THE OBJECTIVE LINE WAS WALLPAPER.
//
// It read one fixed sentence for the whole battle, so the one line permanently
// on screen said nothing about the fight under it — while `castleGateFrac`, the
// share of the countryside you must hold before a siege of the throne can
// COMPLETE, appeared only inside the castle's own site panel and only once a
// siege was already running. Over a 10-20 minute fight a player who had
// forgotten the pre-battle number had nowhere to re-check whether the throne
// was even takeable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { objectiveLine, boardSummary } from '../src/screens/battle-status.js';

/** Only what the line reads: the gate rule and who owns what. */
const board = (need, mine, theirs) => ({
  rules: { castleGateFrac: need },
  squads: [],
  sites: [
    { kind: 'castle', owner: 'enemy' },
    ...Array.from({ length: mine }, () => ({ kind: 'farm', owner: 'player' })),
    ...Array.from({ length: theirs }, () => ({ kind: 'farm', owner: 'enemy' })),
  ],
});

test('a region with NO gate says nothing extra', () => {
  // Five regions ship `castleGateFrac: 0`, the campaign opener among them, and
  // this project has already shipped a coach line describing a gate in a region
  // that has none. `0% of 0%` would be worse than the silence.
  const o = objectiveLine(board(0, 3, 7));
  assert.equal(o.text, 'Take the Castle. Don’t lose the Camp.');
  assert.equal(o.open, false);
  assert.doesNotMatch(o.text, /%/);
});

test('a region WITH a gate says how close you are', () => {
  const o = objectiveLine(board(0.6, 3, 7));   // 3 of 10 non-castle sites
  assert.match(o.text, /30% of 60%/);
  assert.equal(o.open, false);
});

test('...and says so plainly the moment it clears', () => {
  // The moment the win becomes available, which nothing in the game announced.
  const o = objectiveLine(board(0.6, 7, 3));   // 70% held against 60% needed
  assert.match(o.text, /GATE IS OPEN/);
  assert.equal(o.open, true);
});

test('the boundary is inclusive — exactly enough is enough', () => {
  // `castleSealed` gates on `have >= need`, so a line that said "59% of 60%"
  // while the siege was in fact allowed would be the preview-disagrees-with-the
  // -simulation class of bug, one surface over.
  const o = objectiveLine(board(0.5, 5, 5));
  assert.equal(o.open, true, 'exactly at the threshold must read as open');
});

test('the castle itself is not in the denominator', () => {
  // `siteControlFraction` counts NON-castle sites, because the gate is what you
  // must hold BEFORE taking the throne. Counting the throne in its own
  // precondition would make the last percent unreachable by construction.
  const o = objectiveLine(board(0.99, 4, 0));  // 4 of 4 non-castle sites
  assert.equal(o.open, true);
});

test('it survives a state with no rules at all', () => {
  // Fixtures and demo.html build partial states, and this is read on every HUD
  // refresh — a throw here would take the whole readout row with it.
  assert.doesNotThrow(() => objectiveLine(undefined));
  assert.equal(objectiveLine(undefined).open, false);
  assert.doesNotThrow(() => objectiveLine({ sites: [] }));
});

test('the percentages match how the castle panel rounds them', () => {
  // Both surfaces round with Math.round on the same fraction, so a player
  // checking one against the other cannot see them disagree by a point.
  const o = objectiveLine(board(0.6, 1, 2));   // 1/3 = 33.33%
  assert.match(o.text, /33% of 60%/);
});

// ---------------------------------------------------------------------------
// ...and what the BOARD says, which to a screen reader was nothing at all
// ---------------------------------------------------------------------------

test('the board names itself even before there is a battle', () => {
  // `boardSummary` is read on every HUD refresh, including the frames between
  // scenes where `state` is null. An empty name is worse than a plain one: the
  // AX tree would go back to reporting a nameless Canvas.
  assert.equal(boardSummary(null), 'Battle map');
  assert.equal(boardSummary(undefined), 'Battle map');
});

test('it says who holds what', () => {
  // `board(_, mine, theirs)` also puts an ENEMY castle on the map, so the
  // enemy total is theirs + 1. That is correct — they do hold it — and the
  // first draft of this assertion forgot the throne.
  const s = board(0, 3, 7);
  s.sites.push({ kind: 'farm', owner: 'neutral' });
  const said = boardSummary(s, {});
  assert.match(said, /You hold 3 sites, the enemy 8\./);
  assert.doesNotMatch(said, /neutral/i, 'unclaimed ground is not a side');
});

test('one site is singular', () => {
  assert.match(boardSummary(board(0, 1, 4), {}), /You hold 1 site, the enemy 5\./);
});

test('troops are omitted until there are some', () => {
  // Battle one opens before any exist, and "0 troops, 0 marching" is noise.
  assert.doesNotMatch(boardSummary(board(0, 3, 7), {}), /troops/);
});

test('...and reported once there are, marching included', () => {
  const s = board(0, 2, 5);
  s.sites[1].garrison = { militia: 6 };
  s.squads = [{ owner: 'player', comp: { militia: 4 }, camped: false }];
  assert.match(boardSummary(s, {}), /10 troops, 4 marching\./);
});

test('it counts the threats the board is marking', () => {
  // The one thing a sighted player reads off the picture that no other surface
  // repeats — the corner brackets from `view.alarms`.
  assert.match(boardSummary(board(0, 3, 7), { a: 1, b: 2 }), /2 sites under attack\./);
  assert.match(boardSummary(board(0, 3, 7), { a: 1 }), /1 site under attack\./);
  assert.doesNotMatch(boardSummary(board(0, 3, 7), {}), /under attack/);
  assert.doesNotMatch(boardSummary(board(0, 3, 7), null), /under attack/);
});
