// Bonus copy comes from config (crowns first, then perks and dynasty stars): the per-crown bounty bonus shown to the player (victory card medals, frontier card label,
// phone par line) is derived from BOUNTY_FRACTION_PER_CROWN, never typed into UI or scene code. The real-browser half is
// asserted by tools/check.mjs ("quotes the crown bonus from config").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOUNTY_FRACTION_PER_CROWN, CROWN_TEXT } from '../config/crowns.js';
import { CROWN_BONUS_PCT } from '../app/crownCopy.js';

const GAME = fileURLToPath(new URL('..', import.meta.url));

test('CROWN_BONUS_PCT is BOUNTY_FRACTION_PER_CROWN as a percentage', () => {
  assert.equal(CROWN_BONUS_PCT, Number((BOUNTY_FRACTION_PER_CROWN * 100).toFixed(1)));
  assert.ok(CROWN_BONUS_PCT > 0 && CROWN_BONUS_PCT <= 100);
});

/** Every non-test source file under game/ui, game/scenes and game/app, with comment lines dropped. */
function uiSources() {
  const out = [];
  for (const dir of ['ui', 'scenes', 'app']) {
    for (const f of readdirSync(join(GAME, dir))) {
      if (!f.endsWith('.js') || f === 'crownCopy.js') continue;
      const text = readFileSync(join(GAME, dir, f), 'utf8');
      const code = text.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');
      out.push({ file: `${dir}/${f}`, code });
    }
  }
  return out;
}

test('no UI, scene or app code types a bonus percentage (crowns, perks, dynasty stars)', () => {
  const bad = [];
  for (const { file, code } of uiSources()) {
    // a literal handed to the components: bonusPct: 25 / crownBonusPct: 25
    if (/\b(?:crownBonusPct|bonusPct)\s*:\s*\d/.test(code)) bad.push(`${file}: a literal bonusPct`);
    // ANY typed bonus percentage in a string: perk copy ('+12% gold income'), dynasty stars ('+20% income'), crowns
    if (/['"`][^'"`\n]*[+−-]\d+(?:\.\d+)?\s?%/.test(code)) bad.push(`${file}: a typed bonus percentage in copy`);
    // copy that names crowns and a percentage in one string: 'Crowns: +25% bounty each', `crowns +25%`
    if (/['"`][^'"`\n]*crowns?[^'"`\n]*[+]\d+(?:\.\d+)?\s?%[^'"`\n]*['"`]/i.test(code)) bad.push(`${file}: crown copy with a typed percentage`);
  }
  assert.deepEqual(bad, []);
});

test('the scenes that build card data take the percentage from app/crownCopy.js', () => {
  for (const f of ['scenes/world.js', 'scenes/battle.js']) {
    const text = readFileSync(join(GAME, f), 'utf8');
    assert.match(text, /from '\.\.\/app\/crownCopy\.js'/, `${f} imports CROWN_BONUS_PCT`);
    assert.doesNotMatch(text, /const CROWN_BONUS_PCT\s*=/, `${f} must not redefine it`);
  }
});

test('crown hints are read from CROWN_TEXT, never retyped in UI, scene or app code (and nothing says "you held")', () => {
  const bad = [];
  const hints = Object.values(CROWN_TEXT).map((c) => c.hint);
  for (const { file, code } of uiSources()) {
    for (const hint of hints) if (code.includes(hint)) bad.push(`${file}: retypes the crown hint "${hint}"`);
    if (/settlement you held/i.test(code)) bad.push(`${file}: says "settlement you held" (Unbroken is about the settlements you started the battle with)`);
  }
  assert.deepEqual(bad, []);
  assert.doesNotMatch(CROWN_TEXT.unbroken.hint, /you held/i);
});
