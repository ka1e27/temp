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

// ---------------------------------------------------------------------------
// Offline play
// ---------------------------------------------------------------------------

test('shell: the service worker exists, is referenced, and is scoped to the app', () => {
  // The manifest and the icons shipped first, so the game was INSTALLABLE and
  // then dead the moment the connection went — which is the worst of both, and
  // is precisely the shape of gap this file exists to catch: a shell asset that
  // is present, looks right, and does nothing because nothing points at it.
  //
  // It matters more here than in most games. The whole premise of the idle half
  // is that you come back later; meta/idle.js pays out an absence up to
  // `OFFLINE.baseCapMs`, and a player with no connection could not open the
  // game to collect any of it.
  assert.ok(existsSync(`${root}sw.js`), 'sw.js does not exist');
  const sw = read('sw.js');

  assert.match(html, /navigator\.serviceWorker\.register\(\s*'\.\/sw\.js'\s*\)/,
    'index.html never registers the worker, so the file is decoration');
  // RELATIVE, because the game is served from a subpath (/temp/ on Pages). An
  // absolute '/sw.js' would 404 there and take the whole feature with it, and
  // it would work perfectly on localhost — the failure only ever shows up in
  // production, which is the worst place to find it.
  assert.ok(!/register\(\s*['"]\/sw\.js/.test(html),
    'an absolute /sw.js path 404s under a subpath deploy');

  // Registered only over https, which is also what keeps it out of the dev
  // server and out of tools/smoke.mjs — those must not assert against a cache
  // an earlier run left behind.
  assert.match(html, /location\.protocol === 'https:'/,
    'the worker would install on the dev server and hide state from the browser tests');

  // The two rules that make a runtime cache safe rather than a permanent trap.
  assert.match(sw, /res\.ok/,
    'caching a non-ok response would pin a 404 under a real module URL, forever');
  assert.match(sw, /caches\.delete/,
    'without an activate-time purge, an old cache version is never reclaimed');
});

test('shell: the worker never caches a save, and never a cross-origin response', () => {
  // COMMENTS STRIPPED FIRST, because the claim is about what the worker DOES.
  // The first cut of this matched the raw file and duly failed on sw.js's own
  // comment explaining that it leaves the save alone — a test that reads prose
  // as behaviour, which is the exact failure mode this repo keeps writing down.
  const sw = read('sw.js')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  // localStorage is where the campaign lives and the Cache API cannot reach
  // it — but a future edit that started proxying requests through some storage
  // shim could. Assert the worker stays a plain GET/same-origin cache, which is
  // the property that makes "clear your cache" a safe thing to tell a player.
  assert.ok(!/localStorage|hexdominion\./.test(sw),
    'the worker must not touch the save; a cache purge cannot be allowed to cost a campaign');
  assert.match(sw, /req\.method !== 'GET'/, 'non-GET requests must pass straight through');
  assert.match(sw, /origin !== self\.location\.origin/,
    'a cross-origin response caches opaquely — status unreadable, bucket filled');
});
