// The Tapestry composer and its save helpers (game/render/tapestry.js) without a browser: a recording 2D-context stand-in
// checks what is drawn (the map once, the title, the stats, the date, the dynasty numeral), that the layout scales with the
// map, that the same inputs compose the same picture, and that nothing it draws is NaN. The real picture is checked by eye in
// tools/gallery/keepsakes.html (screenshots/keepsakes/).
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// --- stand-ins --------------------------------------------------------------------------------------------------------
/** A 2D context that records every call and keeps the style properties it was given. */
function makeContext(log) {
  const state = {};
  const gradient = () => ({ addColorStop: (...a) => log.push(['addColorStop', ...a]) });
  const base = {
    measureText: (text) => {
      const px = parseFloat(String(state.font || '10px').match(/(\d+(?:\.\d+)?)px/)?.[1] || 10);
      return { width: String(text).length * px * 0.55 };
    },
    createLinearGradient: (...a) => { log.push(['createLinearGradient', ...a]); return gradient(); },
    createRadialGradient: (...a) => { log.push(['createRadialGradient', ...a]); return gradient(); },
    createPattern: () => ({}),
  };
  return new Proxy(state, {
    get(target, key) {
      if (key in base) return base[key];
      if (key in target) return target[key];
      return (...args) => { log.push([String(key), ...args.map((v) => (typeof v === 'string' && v.length > 40 ? v.slice(0, 40) : v))]); };
    },
    set(target, key, value) { target[key] = value; return true; },
  });
}

function makeCanvas(w = 0, h = 0) {
  const log = [];
  const canvas = { width: w, height: h, log, isCanvas: true, getContext: () => canvas.ctx };
  canvas.ctx = makeContext(log);
  return canvas;
}

const realDocument = globalThis.document;
const created = [];
before(() => {
  globalThis.document = {
    createElement: (tag) => {
      if (tag === 'canvas') { const c = makeCanvas(); created.push(c); return c; }
      const a = {
        tagName: tag, style: {}, clicks: 0, removed: false, href: '', download: '', rel: '',
        click() { this.clicks += 1; }, remove() { this.removed = true; },
      };
      created.push(a);
      return a;
    },
    body: { children: [], appendChild(n) { this.children.push(n); return n; } },
    documentElement: { appendChild() {} },
  };
});
after(() => { globalThis.document = realDocument; });

const {
  composeTapestry, downloadCanvas, ensureTapestryFonts, formatTapestryDate, tapestryFilename, TAPESTRY_STATS,
} = await import('../render/tapestry.js');

const texts = (canvas) => canvas.log.filter((e) => e[0] === 'fillText' || e[0] === 'strokeText').map((e) => e[1]);
const hashOf = (canvas) => createHash('sha1').update(JSON.stringify(canvas.log)).digest('hex');
const SAMPLE = {
  title: 'The Realm of Greenreach',
  subtitle: 'Dynasty II',
  dynasty: 2,
  stats: { regions: '25 of 26', battlesWon: 1284, crowns: '38 / 72', timePlayed: '2d 14h' },
  factionColor: '#3d7ef0',
  date: new Date(2026, 8, 30, 12, 0, 0),
};

// --- helpers ----------------------------------------------------------------------------------------------------------

test('formatTapestryDate: "30 September 2026" from a Date or timestamp; strings pass through; junk is empty', () => {
  assert.equal(formatTapestryDate(new Date(2026, 8, 30, 12)), '30 September 2026');
  assert.equal(formatTapestryDate(new Date(2027, 0, 5, 12).getTime()), '5 January 2027');
  assert.equal(formatTapestryDate('Midsummer'), 'Midsummer');
  assert.equal(formatTapestryDate(null), '');
  assert.equal(formatTapestryDate(undefined), '');
  assert.equal(formatTapestryDate(Number.NaN), '');
});

test('tapestryFilename: hex-dominion-dynasty-<n>-<yyyy-mm-dd>.png in local time; no date is "keepsake"', () => {
  assert.equal(tapestryFilename({ dynasty: 2, date: new Date(2026, 8, 30, 12) }), 'hex-dominion-dynasty-2-2026-09-30.png');
  assert.equal(tapestryFilename({ dynasty: 1, date: new Date(2027, 0, 5, 12).getTime() }), 'hex-dominion-dynasty-1-2027-01-05.png');
  assert.equal(tapestryFilename({ dynasty: 3 }), 'hex-dominion-dynasty-3-keepsake.png');
  assert.equal(tapestryFilename({ dynasty: 0, date: 'someday' }), 'hex-dominion-dynasty-1-keepsake.png', 'a string date is not a day; dynasty floors at 1');
  assert.equal(tapestryFilename(), 'hex-dominion-dynasty-1-keepsake.png');
  assert.match(tapestryFilename({ dynasty: 12.4, date: new Date(2026, 11, 1, 12) }), /^hex-dominion-dynasty-12-2026-12-01\.png$/);
  assert.ok(!/[\\/:*?"<>|\s]/.test(tapestryFilename({ dynasty: 2, date: new Date() })), 'a safe file name on every OS');
});

test('TAPESTRY_STATS: the four headline stats, in order, frozen', () => {
  assert.deepEqual(TAPESTRY_STATS.map(([k]) => k), ['regions', 'battlesWon', 'crowns', 'timePlayed']);
  assert.ok(Object.isFrozen(TAPESTRY_STATS));
});

// --- composing --------------------------------------------------------------------------------------------------------

test('composeTapestry: returns a bigger canvas than the map and draws the map into it exactly once', () => {
  const map = makeCanvas(1100, 710);
  const out = composeTapestry({ mapCanvas: map, ...SAMPLE });
  assert.ok(out.isCanvas);
  assert.ok(out.width > map.width && out.height > map.height, 'the frame adds to every side');
  const draws = out.log.filter((e) => e[0] === 'drawImage');
  assert.equal(draws.length, 1);
  assert.equal(draws[0][1], map, 'the map canvas itself is what is drawn');
  const [, , x, y, w, h] = draws[0];
  assert.equal(w, map.width, 'drawn 1:1, never stretched');
  assert.equal(h, map.height);
  assert.ok(x > 0 && y > 0 && x + w < out.width && y + h < out.height, 'inside the canvas');
});

test('composeTapestry: the whole layout scales with the map (same proportions at any resolution)', () => {
  const small = composeTapestry({ mapCanvas: makeCanvas(550, 355), ...SAMPLE });
  const big = composeTapestry({ mapCanvas: makeCanvas(2200, 1420), ...SAMPLE });
  assert.ok(Math.abs(small.width / 550 - big.width / 2200) < 0.01, `width ratio ${small.width / 550} vs ${big.width / 2200}`);
  assert.ok(Math.abs(small.height / 355 - big.height / 1420) < 0.02, `height ratio ${small.height / 355} vs ${big.height / 1420}`);
  assert.ok(big.width <= 4096 + 1000 && big.height <= 4096, 'a 2200 px map stays a sane picture size');
});

test('composeTapestry: writes the title, subtitle, dynasty numeral, the four stats with labels, and the date', () => {
  const out = composeTapestry({ mapCanvas: makeCanvas(1100, 710), ...SAMPLE });
  const all = texts(out);
  const has = (s) => all.some((t) => String(t).toLowerCase() === s.toLowerCase());
  assert.ok(has('The Realm of Greenreach'));
  assert.ok(has('Dynasty II'));
  assert.ok(has('II'), 'the Roman numeral on the seal');
  for (const v of ['25 of 26', '1,284', '38 / 72', '2d 14h']) assert.ok(has(v), `stat value ${v}`);
  for (const [, label] of TAPESTRY_STATS) assert.ok(has(label), `label ${label}`);
  assert.ok(all.some((t) => /30 September 2026/i.test(String(t))), 'the date');
});

test('composeTapestry: numbers are grouped, strings are used as given, a list of {label, value} works', () => {
  const grouped = texts(composeTapestry({ mapCanvas: makeCanvas(800, 500), title: 'T', stats: { battlesWon: 1234567.4, regions: '3 of 9' } }));
  assert.ok(grouped.includes('1,234,567'));
  assert.ok(grouped.includes('3 of 9'));
  const listed = texts(composeTapestry({ mapCanvas: makeCanvas(800, 500), title: 'T', stats: [{ label: 'Gold', value: 9100 }, { label: 'Perfect wins', value: '7' }, { label: 'No value', value: null }] }));
  assert.ok(listed.some((t) => /gold/i.test(t)) && listed.includes('9,100'));
  assert.ok(listed.some((t) => /perfect wins/i.test(t)) && listed.includes('7'));
  assert.ok(!listed.some((t) => /no value/i.test(t)), 'an entry without a value is skipped');
});

test('composeTapestry: stats that are not given are skipped, and none at all is fine', () => {
  const partial = texts(composeTapestry({ mapCanvas: makeCanvas(800, 500), title: 'T', stats: { crowns: '1 / 2' } }));
  assert.ok(partial.includes('1 / 2'));
  assert.ok(!partial.some((t) => /battles won/i.test(String(t))));
  const none = composeTapestry({ mapCanvas: makeCanvas(800, 500), title: 'T' });
  assert.ok(texts(none).includes('T'));
  assert.ok(!texts(none).some((t) => /regions|crowns/i.test(String(t))));
});

test('composeTapestry: same inputs, same picture; another seed or another realm colour, a different one', () => {
  const run = (extra = {}) => composeTapestry({ mapCanvas: makeCanvas(900, 600), ...SAMPLE, ...extra });
  assert.equal(hashOf(run()), hashOf(run()), 'deterministic');
  assert.notEqual(hashOf(run()), hashOf(run({ seed: 99 })), 'the grain and fringe follow the seed');
  assert.notEqual(hashOf(run()), hashOf(run({ factionColor: '#d8433f' })), 'woven in the realm colour');
});

test('composeTapestry: every number it draws with is finite, including odd titles and long ones', () => {
  const cases = [
    { ...SAMPLE },
    { ...SAMPLE, title: 'The Very Long Realm of the Seventh Sea-Kings of Thistlefield Upon Avon', subtitle: 'A new age begins' },
    { title: '', stats: {}, dynasty: 30 },
    { title: undefined, subtitle: undefined, date: 'Midsummer', dynasty: undefined },
  ];
  for (const c of cases) {
    const out = composeTapestry({ mapCanvas: makeCanvas(640, 400), ...c });
    assert.ok(Number.isFinite(out.width) && Number.isFinite(out.height) && out.width > 0 && out.height > 0);
    for (const entry of out.log) {
      for (const v of entry.slice(1)) {
        if (typeof v === 'number') assert.ok(Number.isFinite(v), `${entry[0]} got ${v}`);
      }
    }
  }
});

test('composeTapestry: refuses a missing or empty map rather than drawing a blank keepsake', () => {
  assert.throws(() => composeTapestry({ title: 'T' }), /mapCanvas/);
  assert.throws(() => composeTapestry({ mapCanvas: makeCanvas(0, 0), title: 'T' }), /mapCanvas/);
  assert.throws(() => composeTapestry(), /mapCanvas/);
});

// --- saving ---------------------------------------------------------------------------------------------------------------

function withUrlStub(fn) {
  const calls = { create: [], revoke: [] };
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;
  URL.createObjectURL = (blob) => { calls.create.push(blob); return 'blob:fake-1'; };
  URL.revokeObjectURL = (href) => { calls.revoke.push(href); };
  const done = () => { URL.createObjectURL = realCreate; URL.revokeObjectURL = realRevoke; };
  return Promise.resolve(fn(calls)).finally(done);
}
const lastAnchor = () => [...created].reverse().find((n) => n.tagName === 'a');

test('downloadCanvas: toBlob, an anchor with the file name and a click; the object URL is revoked later', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    await withUrlStub(async (calls) => {
      const canvas = { toBlob: (cb, type) => { assert.equal(type, 'image/png'); cb({ size: 5 }); } };
      const ok = await downloadCanvas(canvas, 'hex-dominion-dynasty-2-2026-09-30.png');
      assert.equal(ok, true);
      const a = lastAnchor();
      assert.equal(a.download, 'hex-dominion-dynasty-2-2026-09-30.png');
      assert.equal(a.href, 'blob:fake-1');
      assert.equal(a.clicks, 1);
      assert.equal(a.removed, true, 'the helper anchor is cleaned up');
      assert.equal(a.style.display, 'none');
      assert.equal(calls.revoke.length, 0, 'not revoked while the browser starts the download');
      mock.timers.tick(5000);
      assert.deepEqual(calls.revoke, ['blob:fake-1']);
    });
  } finally {
    mock.timers.reset();
  }
});

test('downloadCanvas: a null blob, a missing toBlob or a throwing toBlob fall back to a data URL', async () => {
  const dataUrl = 'data:image/png;base64,AAAA';
  for (const canvas of [
    { toBlob: (cb) => cb(null), toDataURL: () => dataUrl },
    { toDataURL: () => dataUrl },
    { toBlob: () => { throw new Error('tainted'); }, toDataURL: () => dataUrl },
  ]) {
    assert.equal(await downloadCanvas(canvas, 'k.png'), true);
    const a = lastAnchor();
    assert.equal(a.href, dataUrl);
    assert.equal(a.download, 'k.png');
    assert.equal(a.clicks, 1);
  }
});

test('downloadCanvas: false (never a throw) when the canvas cannot be exported or is missing', async () => {
  assert.equal(await downloadCanvas(null), false);
  assert.equal(await downloadCanvas({ toBlob: (cb) => cb(null), toDataURL: () => { throw new Error('SecurityError'); } }), false);
  assert.equal(await downloadCanvas({}), false);
});

test('downloadCanvas: the default file name is a plain png', async () => {
  await downloadCanvas({ toDataURL: () => 'data:image/png;base64,AAAA' });
  assert.equal(lastAnchor().download, 'hex-dominion.png');
});

// --- fonts ------------------------------------------------------------------------------------------------------------------

test('ensureTapestryFonts: resolves at once without the font API; waits for the fonts when there is one', async () => {
  await ensureTapestryFonts();
  const loads = [];
  globalThis.document.fonts = { load: (spec) => { loads.push(spec); return Promise.resolve([]); } };
  try {
    await ensureTapestryFonts();
    assert.equal(loads.length, 2);
    assert.ok(loads.some((s) => /Cinzel/.test(s)) && loads.some((s) => /Nunito/.test(s)));
    globalThis.document.fonts = { load: () => Promise.reject(new Error('offline')) };
    await ensureTapestryFonts();
  } finally {
    delete globalThis.document.fonts;
  }
});

test('ensureTapestryFonts: gives up after the timeout when the fonts never arrive', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.document.fonts = { load: () => new Promise(() => {}) };
  try {
    let resolved = false;
    const p = ensureTapestryFonts(1500).then(() => { resolved = true; });
    await Promise.resolve();
    assert.equal(resolved, false);
    mock.timers.tick(1500);
    await p;
    assert.equal(resolved, true);
  } finally {
    delete globalThis.document.fonts;
    mock.timers.reset();
  }
});

// --- hygiene ----------------------------------------------------------------------------------------------------------------

test('tapestry files take no game state: no meta/config imports, no clock, no Math.random', () => {
  for (const name of ['tapestry.js', 'tapestryParts.js']) {
    const src = readFileSync(new URL(`../render/${name}`, import.meta.url), 'utf8');
    const imports = [...src.matchAll(/from '(.+)'/g)].map((m) => m[1]);
    assert.ok(imports.every((p) => !/meta\/|config\/|ui\//.test(p)), `${name} imports ${imports.join(', ')}`);
    assert.ok(!/Math\.random|Date\.now|new Date\(\)|performance\.now/.test(src), `${name}: no clock or randomness`);
  }
});
