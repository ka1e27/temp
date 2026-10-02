// The Regions list data (game/app/regionsList.js): what the panel and the map's keyboard cursor say about each region. The real-browser half is tools/a11ycheck.mjs (keyboard).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/generate.js';
import { createGame } from '../meta/state.js';
import { conquer, frontier, attackable } from '../meta/progression.js';
import { regionsListData, regionSummary } from '../app/regionsList.js';

const world = generateWorld(7);
const fresh = () => createGame(7, world, 1000);

test('a fresh realm lists the frontier first (easiest first), then the home region', () => {
  const state = fresh();
  const rows = regionsListData(state, world);
  const front = frontier(state, world);
  assert.equal(rows.filter((r) => r.kind === 'frontier').length, front.length, 'every frontier region is listed');
  const kinds = rows.map((r) => r.kind);
  assert.equal(kinds.lastIndexOf('frontier') < kinds.indexOf('owned'), true, 'frontier rows come before owned rows');
  assert.equal(rows.filter((r) => r.kind === 'owned').length, 1, 'only the home region is yours');
  const attackableRows = rows.filter((r) => r.kind === 'frontier' && !r.blocked);
  for (let i = 1; i < attackableRows.length; i++) assert.ok(attackableRows[i - 1].ratio >= attackableRows[i].ratio, 'easiest first');
  // nothing hidden under the mists is listed
  for (const r of rows) assert.ok(r.kind === 'owned' || front.includes(r.id));
});

test('every row says one full sentence: name, owner, tier, difficulty and the chance in words, or why it cannot be attacked', () => {
  const state = fresh();
  for (const r of regionsListData(state, world)) {
    assert.ok(r.summary.startsWith(`${r.name}:`), r.summary);
    if (r.kind === 'frontier' && !r.blocked && !r.surrender) {
      assert.match(r.summary, /chance to win is about|almost/, r.summary);
      assert.match(r.summary, /Can be attacked/);
      assert.ok(attackable(state, world, r.id));
    }
    if (r.blocked) assert.match(r.summary, /conquer a neighbour first/);
    if (r.kind === 'owned') assert.match(r.summary, /yours/);
  }
});

test('conquering a region moves it to "yours" and reveals its neighbours', () => {
  const state = fresh();
  const first = regionsListData(state, world).find((r) => r.kind === 'frontier' && !r.blocked);
  const before = regionsListData(state, world).length;
  conquer(state, world, first.id, 5000);
  const rows = regionsListData(state, world);
  assert.ok(rows.find((r) => r.id === first.id && r.kind === 'owned'), 'the conquered region is listed as yours');
  assert.ok(rows.length >= before, 'the list never shrinks by conquering');
});

test('regionSummary covers the surrender and the walled-off cases in words', () => {
  const base = { name: 'Dunspire', owner: { name: 'Free Folk' }, tier: 2, kind: 'frontier', label: 'Easy', chanceText: 'about 4 in 5', surrender: false, blocked: null };
  assert.match(regionSummary({ ...base, surrender: true }), /surrender/i);
  assert.match(regionSummary({ ...base, blocked: 'no-passable-border' }), /Cannot be attacked/);
  assert.match(regionSummary({ ...base, kind: 'owned', crowns: 2 }), /yours.*2 of 3 crowns/);
});
