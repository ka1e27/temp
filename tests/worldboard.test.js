// THE CAMPAIGN MAP, AND THE `???` THAT WAS NEVER A SECRET.
//
// MEASURED, on a fresh save: 23 of 24 plates read `???` — no destination, no
// geography, no sense that the names mean anything, and one red hex. And the
// mystery was fake: `worldmap-detail.js renderDetail` renders the name, the
// flavour and the WHOLE stat block — tier, the enemy multiplier to two
// decimals, board size, enemy site count, typical length, income if taken —
// BEFORE it branches on the lock, so one click on a region twenty conquests
// away already returned all of it. Only the bottom action row was gated. The
// board and the panel disagreed with each other, and the board was the one
// lying.
//
// So this file pins two things a screenshot found and no fixture would have:
// the board names every region, and the campaign has a marked DESTINATION that
// is visible from region one. Both are asserted against the SOURCE where the
// claim is "this screen renders that" — the same guard `offlinenotice.test.js`
// uses, and for the same reason: a string that reaches no screen is a string
// that goes stale silently.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CAPITAL_ID, REGION_IDS, REGION_BY_ID } from '../src/content/regions.data.js';
import { WORLD } from '../src/content/strings.js';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', 'src', ...p), 'utf8');

test('the board names every region, locked or not', () => {
  const board = src('screens', 'worldmap.js');
  // The exact defect: a placeholder chosen by lock state.
  assert.doesNotMatch(board, /\?\?\?/,
    'the board still renders a placeholder instead of a region name');
  assert.match(board, /'span\.wm-name', \{ text: r\.name \}/,
    'the name plate must render r.name unconditionally');
});

test('...and the panel it disagreed with still gives the same away', () => {
  // THE NEGATIVE CONTROL, and it is the half that makes the fix a fix rather
  // than a re-skin. If a later pass ever gates the panel on the lock, the board
  // becomes the MORE informative surface and this test should fail loudly
  // rather than let the two drift apart in the other direction.
  const panel = src('screens', 'worldmap-detail.js');
  const beforeLock = panel.slice(0, panel.indexOf("detailMode === 'locked'"));
  assert.ok(beforeLock.includes('region.name'), 'the panel stopped naming the region');
  assert.ok(beforeLock.includes('WORLD.rowEnemy'),
    'the panel stopped showing the difficulty it always showed');
});

test('the campaign has a destination, and there is country behind it', () => {
  assert.ok(REGION_BY_ID[CAPITAL_ID], `CAPITAL_ID "${CAPITAL_ID}" is not a region`);
  const i = REGION_IDS.indexOf(CAPITAL_ID);
  assert.ok(i > 0, 'the capital cannot be the first region');
  // The premise of tiers 5 and 6: taking the capital is when you find out how
  // much country is behind it. A capital that IS the last region would make
  // the marker a spoiler for an ending that does not exist.
  assert.ok(i < REGION_IDS.length - 1,
    'the capital is the last region — there is nothing behind it to promise');
});

test('the destination is marked on the board and named on the panel', () => {
  const board = src('screens', 'worldmap.js');
  const panel = src('screens', 'worldmap-detail.js');
  assert.ok(board.includes('CAPITAL_ID'), 'the board does not mark the capital');
  assert.ok(board.includes("'data-capital'"),
    'the marker must be an attribute the stylesheet and a probe can both find');
  assert.ok(panel.includes('WORLD.capitalHint'), 'the panel never says what it is');
  // A marker that is a ring and a glyph is a colour and a shape. The label is
  // the channel a screen reader has.
  assert.ok(board.includes('WORLD.capitalTag'),
    'the capital is not named in the hex label or title');
});

test('the stylesheet draws the marker it is handed', () => {
  const css = readFileSync(join(here, '..', 'src', 'styles', 'worldmap.css'), 'utf8');
  assert.match(css, /\[data-capital\]/, 'nothing styles the capital marker');
  // The locked NAME had to come up to legible too, or naming the board changes
  // nothing a player can read — `--c-locked` is chosen for a hatch, not for text.
  assert.match(css, /\[data-status='locked'\] \.wm-name/,
    'a locked name is drawn at the hatch weight and cannot be read');
});

test('the header states how far through the war you are', () => {
  const header = src('screens', 'worldmap-header.js');
  const board = src('screens', 'worldmap.js');
  assert.ok(header.includes('WORLD.rowCampaign'), 'the campaign figure has no label');
  assert.ok(board.includes('regionsConquered'), 'the figure is never given a value');
  assert.ok(WORLD.capitalHint && WORLD.capitalTag && WORLD.rowCampaign,
    'the copy this screen reads does not exist');
});

test('every treasury pair is PLACED, on both layouts', () => {
  // The grid is `grid-area` per `nth-child` — deliberately, because auto-flow
  // would put a label under a value the moment a pair became conditional. The
  // cost is that adding a pair mis-places it silently, and only at phone width,
  // where nobody looks.
  //
  // The rule is DERIVED from the two grids rather than hardcoded, because "5
  // through 10" would go stale the same way the CSS did. The desktop grid is
  // wide; the phone one is two columns. Any child whose desktop placement names
  // a column the phone grid does not HAVE must be re-placed there — otherwise it
  // lands in an implicit column and a label sits beside its own value instead of
  // above it.
  const header = src('screens', 'worldmap-header.js');
  const row = header.slice(header.indexOf("h('div.wm-treasury'"), header.indexOf(".wm-actions'"));
  const pairs = (row.match(/h\('span\.label'/g) ?? []).length;
  assert.ok(pairs >= 5, `expected at least 5 label/value pairs, found ${pairs}`);
  const children = pairs * 2;

  const areas = (css) => new Map([...css.matchAll(
    /\.wm-treasury > :nth-child\((\d+)\)\s*\{\s*grid-area:\s*(\d+)\s*\/\s*(\d+)/g,
  )].map((m) => [Number(m[1]), Number(m[3])]));

  const base = areas(readFileSync(join(here, '..', 'src', 'styles', 'worldmap.css'), 'utf8'));
  for (let i = 1; i <= children; i++) {
    assert.ok(base.has(i), `worldmap.css never places treasury child ${i} of ${children}`);
  }

  // EVERY narrow layout, not "the narrow layout": there are two (a 390px-wide
  // phone and an 844x390 phone on its side), they declare different column
  // counts, and the landscape one exists BECAUSE the portrait rule fires there
  // too and made the header six rows tall. Splitting the file by media block is
  // what stops this test checking one of them and reporting on both.
  const phoneCss = readFileSync(
    join(here, '..', 'src', 'styles', 'worldmap.responsive.css'), 'utf8',
  );
  const blocks = [...phoneCss.matchAll(/@media([^{]+)\{([\s\S]*?)\n\}/g)]
    .map((m) => ({ q: m[1].trim(), body: m[2] }))
    .filter((b) => /\.wm-treasury \{[^}]*grid-template-columns/.test(b.body));
  assert.ok(blocks.length >= 1, 'no narrow layout re-declares the treasury grid');

  for (const b of blocks) {
    const cols = Number(b.body.match(
      /\.wm-treasury \{[^}]*grid-template-columns: repeat\((\d+)/,
    )?.[1]);
    assert.ok(cols >= 1, `${b.q} declares no treasury column count`);
    const here_ = areas(b.body);
    for (const [child, col] of base) {
      if (child > children) continue;
      const at = here_.get(child) ?? col;
      assert.ok(at <= cols,
        `@media ${b.q}: child ${child} sits in column ${at} of ${cols} — it flows `
        + 'into an implicit column, which puts a label beside its own value');
    }
  }
});
