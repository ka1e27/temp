// Accessibility contracts that need no browser (DESIGN §7.5a): colour contrast of the text tokens, the faction text colours, the 12 px phone floor, the settings
// sanitiser. The real-browser half (the accessibility tree, focus, Reduce Motion, keyboard play) is tools/a11ycheck.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sanitizeSettings } from '../meta/save.js';
import { defaultSettings } from '../meta/state.js';
import { FACTIONS } from '../config/world.js';

const css = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8');
const token = (name) => {
  const m = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  assert.ok(m, `token --${name} exists`);
  return m[1].trim();
};
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a, b) => { const la = lum(a); const lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
const over = (fg, bg, alpha) => fg.map((v, i) => v * alpha + bg[i] * (1 - alpha));

test('muted and dim text keep about 7:1 on the solid panel, and 4.5:1 or better over the worst map behind a 90% panel', () => {
  const solid = hex(token('panel-bg-solid'));
  const rgba = token('panel-bg').match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
  const alpha = Number(rgba[4]);
  assert.ok(alpha >= 0.9, `panels are about 90% opaque (got ${alpha})`);
  const panel = [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])];
  const snow = over(panel, [240, 240, 235], alpha); // the lightest thing a panel sits over
  for (const name of ['text', 'text-muted', 'text-dim']) {
    const c = hex(token(name));
    const onSolid = contrast(c, solid);
    const onSnow = contrast(c, snow);
    assert.ok(onSolid >= (name === 'text' ? 12 : 7.5), `--${name} on the solid panel: ${onSolid.toFixed(2)}`);
    assert.ok(onSnow >= 4.5, `--${name} over snow behind the panel: ${onSnow.toFixed(2)}`);
  }
});

test('the light variant of every faction colour reads as text on the dark panel (4.5:1)', () => {
  const solid = hex(token('panel-bg-solid'));
  for (const f of FACTIONS) assert.ok(contrast(hex(f.colorLight), solid) >= 4.5, `${f.name} colorLight ${f.colorLight}: ${contrast(hex(f.colorLight), solid).toFixed(2)}`);
});

test('gold, good and bad text colours clear 4.5:1 on the solid panel', () => {
  const solid = hex(token('panel-bg-solid'));
  for (const name of ['gold', 'gold-bright', 'good', 'bad', 'warn']) assert.ok(contrast(hex(token(name)), solid) >= 4.5, `--${name}`);
});

test('phones keep a 12 px text floor and 44 px touch targets are a token', () => {
  assert.match(css, /@media \(max-width: 640px\)\s*\{\s*:root\s*\{[^}]*--fs-xs:\s*0\.8rem/);
  assert.equal(token('touch-target'), '44px');
});

test('settings are whitelisted and clamped on load; an old explicit Reduce Motion counts as the player\'s own choice', () => {
  const d = defaultSettings();
  assert.deepEqual(sanitizeSettings(undefined), d);
  assert.deepEqual(sanitizeSettings('junk'), d);
  const s = sanitizeSettings({ sound: 'yes', musicVolume: 9, sfxVolume: -3, speed: 7, hints: false, evil: 1, reduceMotion: true });
  assert.equal(s.sound, true, 'a non-boolean falls back');
  assert.equal(s.musicVolume, 1, 'clamped to 1');
  assert.equal(s.sfxVolume, 0, 'clamped to 0');
  assert.equal(s.speed, 1, 'an unknown speed falls back');
  assert.equal(s.hints, false);
  assert.ok(!('evil' in s), 'unknown keys are dropped');
  assert.equal(s.reduceMotion, true);
  assert.equal(s.reduceMotionSet, true, 'an old save that stored it on keeps it: the OS never overrides it');
  assert.equal(sanitizeSettings({ speed: 0.5 }).speed, 0.5, 'the 0.5x assist speed is a real speed');
  assert.equal(sanitizeSettings({ musicVolume: NaN }).musicVolume, d.musicVolume);
});

// --- colour-blind-safe factions (DESIGN 7.5a) -----------------------------------------------------------------------------------------------------------
import { dist } from '../core/colorDistance.js';

test('every pair of faction colours is at least 15 CIEDE2000 apart under deuteranopia, protanopia and tritanopia, and clearly apart normally', () => {
  const rows = [];
  for (const kind of ['normal', 'deutan', 'protan', 'tritan']) {
    for (let i = 0; i < FACTIONS.length; i++) {
      for (let j = i + 1; j < FACTIONS.length; j++) {
        const d = dist(FACTIONS[i].color, FACTIONS[j].color, kind);
        rows.push(`${kind} ${FACTIONS[i].name} / ${FACTIONS[j].name}: ${d.toFixed(1)}`);
        assert.ok(d >= (kind === 'normal' ? 20 : 15), `${kind}: ${FACTIONS[i].name} and ${FACTIONS[j].name} are only ${d.toFixed(1)} apart`);
      }
    }
  }
  assert.equal(rows.length, 40);
});

test('every faction has its own emblem (colour is never the only cue), and the dark and light variants stay in the family', () => {
  assert.equal(new Set(FACTIONS.map((f) => f.emblem)).size, FACTIONS.length);
  for (const f of FACTIONS) {
    assert.ok(/^#[0-9a-f]{6}$/i.test(f.color) && /^#[0-9a-f]{6}$/i.test(f.colorDark) && /^#[0-9a-f]{6}$/i.test(f.colorLight), f.name);
    assert.ok(lum(hex(f.colorDark)) < lum(hex(f.color)) && lum(hex(f.color)) < lum(hex(f.colorLight)), `${f.name}: dark < colour < light`);
  }
});
