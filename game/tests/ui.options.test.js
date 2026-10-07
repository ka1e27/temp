// Play your way (PLAN-PHASE14 §14B), the parts that need no browser: the colour-vision presets clear CIEDE2000 25 for their vision, the patterns,
// the options sanitiser and storage, the keyboard map (conflicts, swap, reserved keys), high contrast's 7:1 body text and the Codex topic.
// The real-browser half is tools/optionsChecks.mjs (check.mjs --only=options).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dist } from '../core/colorDistance.js';
import { FACTIONS } from '../config/world.js';
import { PALETTES, PALETTE_IDS, PALETTE_BAR, PALETTE_NORMAL_BAR, PATTERNS } from '../config/palettes.js';
import { TEXT_SIZES, EFFECTS, EFFECTS_IDS } from '../config/options.js';
import { defaultOptions, sanitizeOptions, loadOptions, saveOptions, OPTIONS_KEY } from '../app/options.js';
import { KEY_ACTIONS, defaultBindings, sanitizeBindings, findConflicts, rebind, keyLabel, isBindable, setBindings, matches, actionFor } from '../ui/keymap.js';
import { setPalette, presetColors, getPalette, patternOf, setPatterns } from '../render/accessibility.js';
import { CODEX_TOPICS, codexData } from '../app/codexTopics.js';

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a, b) => { const la = lum(a); const lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
const css = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8');

/** The minimum CIEDE2000 between any two of the eight colours under `kind`, and the pair. */
function minPair(colors, kind) {
  let m = Infinity; let pair = '';
  for (let i = 0; i < colors.length; i++) for (let j = i + 1; j < colors.length; j++) {
    const d = dist(colors[i], colors[j], kind);
    if (d < m) { m = d; pair = `${FACTIONS[i].name} / ${FACTIONS[j].name}`; }
  }
  return { m, pair };
}

test('each colour-vision preset: every pair of the eight factions clears CIEDE2000 25 under its targeted vision, and 20 normally', () => {
  const report = [];
  for (const id of PALETTE_IDS) {
    const p = PALETTES[id];
    const colors = FACTIONS.map((f, i) => (p.colors ? p.colors[i].color : f.color));
    assert.equal(colors.length, 8, `${id}: all eight factions`);
    if (id === 'default') {
      // the Default preset IS config/world.js FACTIONS, unchanged by instruction: it keeps the bars of ui.a11y.test.js (20 normal, 15 colour-blind)
      const n = minPair(colors, 'normal');
      assert.ok(n.m >= 20, `default normal ${n.m.toFixed(1)} (${n.pair})`);
      report.push(`default: normal ${n.m.toFixed(1)}`);
      continue;
    }
    for (const kind of p.targets) {
      const r = minPair(colors, kind);
      assert.ok(r.m >= PALETTE_BAR, `${id} under ${kind}: ${r.pair} only ${r.m.toFixed(1)} apart`);
      report.push(`${id}: ${kind} ${r.m.toFixed(1)} (${r.pair})`);
    }
    const n = minPair(colors, 'normal');
    assert.ok(n.m >= PALETTE_NORMAL_BAR, `${id} under normal vision: ${n.pair} only ${n.m.toFixed(1)} apart`);
    report.push(`${id}: normal ${n.m.toFixed(1)}`);
  }
  assert.ok(PALETTES.deutan.targets.includes('deutan') && PALETTES.deutan.targets.includes('protan') && PALETTES.tritan.targets.includes('tritan'));
  console.log(`    ${report.join('\n    ')}`);
});

test('each preset keeps the family rules: dark < colour < light, and the light variant reads as text on the dark panel', () => {
  const solid = hex(css.match(/--panel-bg-solid:\s*(#[0-9a-f]{6})/i)[1]);
  for (const id of PALETTE_IDS) {
    const p = PALETTES[id];
    if (!p.colors) continue;
    p.colors.forEach((c, i) => {
      for (const k of ['color', 'colorDark', 'colorLight']) assert.match(c[k], /^#[0-9a-f]{6}$/i, `${id} ${i} ${k}`);
      assert.ok(lum(hex(c.colorDark)) < lum(hex(c.color)) && lum(hex(c.color)) < lum(hex(c.colorLight)), `${id} ${FACTIONS[i].name}: dark < colour < light`);
      assert.ok(contrast(hex(c.colorLight), solid) >= 4.5, `${id} ${FACTIONS[i].name} light ${c.colorLight}: ${contrast(hex(c.colorLight), solid).toFixed(2)}`);
    });
  }
});

test('a preset repaints every faction record in place (emblems and names stay) and Default restores the exact colours', () => {
  const before = FACTIONS.map((f) => ({ ...f }));
  const world = { factions: FACTIONS.map((f) => ({ ...f, capitalRegion: 3 })) };
  try {
    assert.equal(setPalette('deutan', world), true);
    assert.equal(getPalette(), 'deutan');
    FACTIONS.forEach((f, i) => {
      assert.equal(f.color, PALETTES.deutan.colors[i].color);
      assert.equal(world.factions[i].colorLight, PALETTES.deutan.colors[i].colorLight);
      assert.equal(f.emblem, before[i].emblem);
      assert.equal(f.name, before[i].name);
    });
    setPalette('nonsense', world); // unknown -> default
    assert.equal(getPalette(), 'default');
  } finally {
    setPalette('default', world);
  }
  FACTIONS.forEach((f, i) => assert.deepEqual({ color: f.color, colorDark: f.colorDark, colorLight: f.colorLight }, { color: before[i].color, colorDark: before[i].colorDark, colorLight: before[i].colorLight }));
  assert.deepEqual(presetColors('default', 0).color, before[0].color);
});

test('the pattern overlay: eight different patterns, yours is the only plain one, and nothing while it is off', () => {
  assert.equal(PATTERNS.length, FACTIONS.length);
  assert.equal(new Set(PATTERNS).size, PATTERNS.length);
  assert.equal(PATTERNS[0], 'none');
  assert.ok(PATTERNS.slice(1).every((p) => p !== 'none'));
  setPatterns(false);
  assert.equal(patternOf(2), 'none');
  setPatterns(true);
  assert.equal(patternOf(2), PATTERNS[2]);
  setPatterns(false);
});

test('options are whitelisted and clamped, live under their own key and survive junk storage', () => {
  const d = defaultOptions();
  assert.deepEqual(sanitizeOptions(undefined), d);
  assert.deepEqual(sanitizeOptions('junk'), d);
  assert.deepEqual(sanitizeOptions([1, 2]), d);
  const s = sanitizeOptions({ palette: 'tritan', patterns: 'yes', textSize: 'huge', highContrast: true, effects: 'minimal', voicesVolume: 4, muteHidden: false, evil: 1, keys: { power1: 'KeyZ', pause: 'Escape' } });
  assert.equal(s.palette, 'tritan');
  assert.equal(s.patterns, false, 'a non-boolean falls back');
  assert.equal(s.textSize, 'normal', 'an unknown size falls back');
  assert.equal(s.highContrast, true);
  assert.equal(s.effects, 'minimal');
  assert.equal(s.voicesVolume, 1, 'clamped');
  assert.equal(s.muteHidden, false);
  assert.ok(!('evil' in s));
  assert.equal(s.keys.power1, 'KeyZ');
  assert.equal(s.keys.pause, 'Space', 'a reserved key falls back to the default');
  assert.equal(d.muteHidden, true, 'mute when hidden is on by default');
  assert.equal(d.holdToConfirm, false);
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
  assert.deepEqual(loadOptions(storage), d, 'nothing stored: defaults');
  assert.equal(saveOptions(storage, { ...d, textSize: 'larger' }), true);
  assert.equal(loadOptions(storage).textSize, 'larger');
  assert.ok(mem.has(OPTIONS_KEY) && OPTIONS_KEY !== 'hexdominion.v2', 'not inside the realm save');
  mem.set(OPTIONS_KEY, '{not json');
  assert.deepEqual(loadOptions(storage), d);
  assert.deepEqual(loadOptions({ getItem: () => { throw new Error('denied'); } }), d);
  assert.equal(saveOptions({ setItem: () => { throw new Error('full'); } }, d), false);
  assert.ok(TEXT_SIZES.normal === 1 && TEXT_SIZES.large > 1 && TEXT_SIZES.larger > TEXT_SIZES.large);
  assert.deepEqual(EFFECTS_IDS, ['full', 'reduced', 'minimal']);
  assert.ok(EFFECTS.minimal.particles < EFFECTS.reduced.particles && EFFECTS.reduced.particles < EFFECTS.full.particles && EFFECTS.minimal.shake === 0 && EFFECTS.minimal.pops >= 1);
});

test('the keyboard map: defaults are conflict-free, a taken key swaps, reserved keys are refused, duplicates are resolved on load', () => {
  const d = defaultBindings();
  assert.deepEqual(findConflicts(d), []);
  assert.equal(Object.keys(d).length, KEY_ACTIONS.length);
  for (const a of ['send25', 'send100', 'power1', 'power5', 'pause', 'speed', 'ability', 'auto', 'selectAll', 'mute']) assert.ok(a in d, a);
  const r = rebind(d, 'power1', 'KeyW'); // W was Firestorm
  assert.equal(r.error, null);
  assert.equal(r.swapped, 'power2');
  assert.equal(r.bindings.power1, 'KeyW');
  assert.equal(r.bindings.power2, 'KeyQ', 'Firestorm takes Rally\'s old key');
  assert.deepEqual(findConflicts(r.bindings), []);
  for (const k of ['Escape', 'Tab', 'Enter', 'ArrowUp', 'BracketLeft', 'Equal', 'ShiftLeft']) assert.equal(rebind(d, 'pause', k).error, 'reserved', k);
  assert.equal(rebind(d, 'nope', 'KeyZ').error, 'unknown');
  assert.ok(findConflicts({ ...d, power1: 'KeyW' }).some((c) => c.code === 'KeyW'), 'a conflict is detected');
  const fixed = sanitizeBindings({ ...d, power1: 'KeyW' });
  assert.deepEqual(findConflicts(fixed), [], 'a duplicate in storage is resolved');
  assert.equal(fixed.power1, 'KeyW');
  assert.ok(isBindable('KeyZ') && isBindable('F2') && !isBindable('Escape') && !isBindable('junk'));
  assert.equal(keyLabel('KeyQ'), 'Q');
  assert.equal(keyLabel('Digit3'), '3');
  assert.equal(keyLabel('Space'), 'Space');
  try {
    setBindings({ ...d, send25: 'KeyZ' });
    assert.equal(matches('send25', { code: 'KeyZ' }), true);
    assert.equal(matches('send25', { code: 'Digit1' }), false, 'the old key no longer sends');
    assert.equal(matches('send50', { code: 'Numpad2' }), true, 'a digit binding answers to the numpad too');
    assert.equal(actionFor({ code: 'KeyQ' }), 'power1');
    assert.equal(actionFor({ code: 'KeyX' }), null);
  } finally {
    setBindings(d);
  }
});

test('high contrast: opaque panels, and body text at 7:1 or better on them', () => {
  const block = css.match(/html\.high-contrast\s*\{([^}]*)\}/);
  assert.ok(block, 'tokens.css has the high-contrast block');
  const tok = (name) => { const m = block[1].match(new RegExp(`--${name}:\\s*([^;]+);`)); assert.ok(m, `--${name}`); return m[1].trim(); };
  const solid = hex(tok('panel-bg-solid'));
  const alpha = Number(tok('panel-bg').match(/rgba\([^)]*,\s*([\d.]+)\)/)[1]);
  assert.equal(alpha, 1, 'panels are opaque');
  for (const name of ['text', 'text-muted', 'text-dim']) {
    const c = contrast(hex(tok(name)), solid);
    assert.ok(c >= 7, `--${name}: ${c.toFixed(1)}:1`);
  }
});

test('the Codex has an Options topic, always open, with its numbers from config', () => {
  const t = CODEX_TOPICS.find((x) => x.id === 'options');
  assert.ok(t && t.seen({}) === true);
  assert.ok(t.numbers.some(([k, v]) => /Colour presets/.test(k) && /Red-green/.test(v)));
  const data = codexData({});
  assert.ok(data.groups.some((g) => g.id === 'options' && g.topics.some((x) => x.id === 'options' && !x.locked)));
});
