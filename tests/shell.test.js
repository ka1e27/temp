// THE SHELL — index.html, the favicon, the manifest and the share card.
//
// None of this is visible inside the game, which is exactly why none of it
// existed: there is no screen to notice a missing tab icon on, and no test asks
// about a file the game never imports. A browser game whose tab shows the default
// globe and whose shared link previews as a bare URL reads as a prototype before
// a pixel of it has loaded.
//
// Everything here is a CROSS-FILE agreement — an HTML reference against a file on
// disk, a hardcoded hex against the token it copies, a declared og:image size
// against the actual PNG header. Those are the only kind of shell bug that can
// happen silently, and this project has one on record: demo.html carried a
// comment reading "keep these five lines in sync" while index.html grew to nine
// stylesheets, so the render harness was quietly showing a different game.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(`${root}${p}`, 'utf8');
const html = read('index.html');
const demo = read('demo.html');
const tokens = read('src/styles/tokens.css');
const manifest = JSON.parse(read('manifest.webmanifest'));

/** Every `<link rel="stylesheet" href>` in document order. */
const sheets = (doc) => [...doc.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)]
  .map((m) => m[1]);

/** A custom property's value, straight out of tokens.css. */
function token(name) {
  const m = tokens.match(new RegExp(`--${name}:\\s*([^;]+);`));
  assert.ok(m, `--${name} is not defined in tokens.css`);
  return m[1].trim();
}

test('shell: every file index.html references actually exists', () => {
  const refs = [
    ...sheets(html),
    ...[...html.matchAll(/(?:href|src|content)="(\.\/[^"]+)"/g)].map((m) => m[1]),
  ];
  assert.ok(refs.length >= 10, 'suspiciously few references parsed out of index.html');
  for (const ref of refs) {
    assert.ok(existsSync(`${root}${ref.replace(/^\.\//, '')}`),
      `index.html references ${ref}, which is not on disk`);
  }
});

test('shell: the render harness loads exactly what the game loads', () => {
  // The regression this file exists for. A comment asking to be kept in sync is
  // not a mechanism; demo.html was missing hud.responsive.css, panelbars.css,
  // prebattle.css and worldmap.css — every responsive rule and every bar in the
  // game — while claiming to show "EXACTLY what index.html loads".
  assert.deepEqual(sheets(demo), sheets(html),
    'demo.html and index.html no longer load the same stylesheets in the same order');
});

test('shell: the favicon is drawn in the game\'s own palette', () => {
  // An SVG favicon cannot read CSS custom properties from the document, so the
  // three colours in it are copies. Copies drift; this is what stops them.
  const svg = read('favicon.svg');
  for (const name of ['c-bg', 'c-player', 'c-line']) {
    assert.ok(svg.includes(token(name)),
      `favicon.svg does not use --${name} (${token(name)}) — it has drifted from tokens.css`);
  }
});

test('shell: the manifest is installable and matches the theme', () => {
  for (const key of ['name', 'short_name', 'description', 'start_url', 'icons', 'display']) {
    assert.ok(manifest[key], `manifest is missing ${key}`);
  }
  assert.equal(manifest.theme_color, token('c-bg'));
  assert.equal(manifest.background_color, token('c-bg'),
    'a background_color that is not the game\'s own is a white flash on launch');
  // The theme-color meta and the manifest have to agree, or the browser chrome
  // and the splash screen are two different colours.
  assert.ok(html.includes(`<meta name="theme-color" content="${token('c-bg')}">`));
  for (const icon of manifest.icons) {
    assert.ok(existsSync(`${root}${icon.src.replace(/^\.\//, '')}`),
      `manifest lists ${icon.src}, which is not on disk`);
  }
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'),
    'without a maskable icon Android crops the mark into a circle and clips it');
});

test('shell: the share card is the size it says it is', () => {
  // A declared og:image size that disagrees with the file is how a preview ends
  // up letterboxed or refused, and nothing in the game would ever show it. Read
  // the PNG's own IHDR rather than trusting the generator.
  const png = readFileSync(`${root}og.png`);
  assert.equal(png.readUInt32BE(0), 0x89504e47, 'og.png is not a PNG');
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const declared = (prop) => Number(
    html.match(new RegExp(`property="og:image:${prop}" content="(\\d+)"`))?.[1],
  );
  assert.equal(width, declared('width'));
  assert.equal(height, declared('height'));
  // 1200x630 is the size every scraper crops to; anything else is a guess.
  assert.deepEqual([width, height], [1200, 630]);
  // ...and the icons are square at the sizes the manifest claims.
  for (const name of ['icon-192.png', 'icon-512.png']) {
    const ico = readFileSync(`${root}${name}`);
    const px = Number(name.match(/(\d+)/)[1]);
    assert.equal(ico.readUInt32BE(16), px, `${name} is not ${px}px wide`);
    assert.equal(ico.readUInt32BE(20), px, `${name} is not ${px}px tall`);
  }
});

test('shell: the viewport does not take zoom away from the player', () => {
  // WCAG 1.4.4. The viewport used to carry `maximum-scale=1,user-scalable=no` to
  // suppress double-tap zoom during a drag order — which forbids pinch-zoom for
  // everyone, to fix a problem that belongs to two elements. `touch-action` does
  // that per element instead, so this is a regression guard on both halves: the
  // meta must stay permissive AND the boards must keep their touch-action.
  const viewport = html.match(/<meta name="viewport" content="([^"]+)"/)[1];
  assert.ok(!/user-scalable\s*=\s*no/.test(viewport), 'the viewport forbids zoom');
  assert.ok(!/maximum-scale/.test(viewport), 'the viewport caps zoom');
  assert.ok(viewport.includes('viewport-fit=cover'), 'notched phones need viewport-fit');
  const base = read('src/styles/base.css');
  assert.match(base, /#board-bg,\s*\n#board-fx\s*\{[^}]*touch-action:\s*none/,
    'the battle boards must keep touch-action: none or a drag becomes a scroll');
  assert.match(read('src/styles/worldmap.css'), /touch-action:\s*none/,
    'the world map porthole must keep touch-action: none or a pan becomes a scroll');
  assert.match(base, /\.btn\s*\{[^}]*touch-action:\s*manipulation/,
    'controls need touch-action: manipulation, or double-tap zooms instead of clicking');
});

test('shell: the page says what the game is, for a scraper and for a human', () => {
  // The metadata a link preview is built from. Absent, a shared link is a URL.
  for (const [name, pattern] of [
    ['description', /<meta name="description" content="[^"]{60,}/],
    ['og:title', /property="og:title" content="Hex Dominion"/],
    ['og:description', /property="og:description" content="[^"]{40,}/],
    ['og:url', /property="og:url" content="https:\/\//],
    ['twitter:card', /name="twitter:card" content="summary_large_image"/],
  ]) {
    assert.match(html, pattern, `index.html is missing a usable ${name}`);
  }
  // The title is what a tab, a bookmark and a search result all show.
  const title = html.match(/<title>([^<]+)<\/title>/)[1];
  assert.ok(title.length > 14 && title.startsWith('Hex Dominion'),
    `"${title}" is a filename, not a title`);
});
