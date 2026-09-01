// THE ENEMY HAS A FACE, AND IT COSTS THE BALANCE TABLE NOTHING.
//
// MEASURED before this shipped: over a ~315-minute campaign nobody in this game
// was named, nobody spoke, and nobody was remembered. The enemy Marshal — the
// one thing the enemy does that a player has to answer — was a `banner` field
// and an anonymous "the host".
//
// The first test is the load-bearing one and it is asserted against the SOURCE,
// because "this is only decoration" is a claim no fixture can demonstrate: a
// name must never reach `battle/`, never join `BattleConfig`, and never be read
// by the harness. Everything else here is the shape of the draw.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { commanderFor } from '../src/meta/marshals.js';
import { REGIONS, REGION_BY_ID, REGION_IDS } from '../src/content/regions.data.js';
import { ENEMY_MARSHALS_BY_TIER } from '../src/content/regions.rules.js';
import { MARSHAL_NAMES, COMMANDER_TITLES } from '../src/content/marshals.data.js';
import { RESULTS } from '../src/content/strings.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { metaFor } from '../tools/simstart.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.js') || p.endsWith('.mjs')) out.push(p);
  }
  return out;
}

test('no name can reach the simulation, the seam or the harness', () => {
  // The guard that makes this feature free. A commander is resolved in meta/
  // and handed to a SCREEN as a string; if any of these directories ever
  // imported it, a name would be one refactor from being a field somebody
  // branches on, and this would stop being decoration.
  const guarded = ['src/battle', 'src/core', 'tools'];
  const offenders = [];
  for (const dir of guarded) {
    for (const file of walk(join(root, dir))) {
      const src = readFileSync(file, 'utf8');
      if (/marshals\.data\.js|commanderFor|MARSHAL_NAMES/.test(src)) {
        offenders.push(file.slice(root.length + 1));
      }
    }
  }
  assert.deepEqual(offenders, [],
    'a commander name reached code that decides or measures a battle');
  // ...and no name reaches the CONFIG either, which is the other way a piece of
  // decoration turns into a field with a version number. Asserted against a
  // real `buildBattleConfig` rather than by grepping `contract.js` for a word —
  // that file says "commander" in prose, and a test that trips on prose is a
  // test somebody weakens.
  const cfg = buildBattleConfig(metaFor(REGION_IDS.slice(0, 16)), 'ironcrown', []);
  const who = commanderFor(REGION_BY_ID.ironcrown, 0);
  const blob = JSON.stringify(cfg);
  assert.ok(!blob.includes(who.house), `the config carries "${who.house}"`);
  assert.ok(!blob.includes(who.title), `the config carries "${who.title}"`);
  assert.doesNotMatch(blob, /"(foeName|commander|marshalName)"/);
});

test('every region has a commander, and no two share a house in one campaign', () => {
  const houses = new Set();
  for (const r of REGIONS) {
    const c = commanderFor(r, 0);
    assert.ok(c, `${r.id} has no commander`);
    assert.ok(c.full.startsWith(c.title), `${r.id}: "${c.full}" does not lead with its title`);
    assert.ok(c.short === `${c.title} ${c.house}`);
    // A REPEATED NAME READS AS A BUG, not as a coincidence — the reason the
    // draw is a rotation over one shuffle rather than a sample per region, the
    // same lesson `campaignTwistPlan` already carries.
    assert.ok(!houses.has(c.house), `two regions are both House ${c.house}`);
    houses.add(c.house);
  }
  assert.ok(MARSHAL_NAMES.house.length >= REGIONS.length,
    'there are fewer houses than regions, so a collision is now possible');
});

test('the TITLE is earned: Marshal only where a banner is actually fielded', () => {
  // The one piece of real information in the name. `ENEMY_MARSHALS_BY_TIER` is
  // [0,0,0,1,1,2], so tiers 1-3 field no marshal at all and calling their
  // defenders one would spend the word where it has to keep its meaning.
  for (const r of REGIONS) {
    const c = commanderFor(r, 0);
    const banners = ENEMY_MARSHALS_BY_TIER[r.tier - 1] ?? 0;
    assert.equal(c.marshal, banners > 0, `${r.id} (tier ${r.tier})`);
    assert.equal(c.title, banners > 0 ? COMMANDER_TITLES.marshal : COMMANDER_TITLES.castellan);
  }
  // The negative control: both titles are actually used by the shipped table.
  const titles = new Set(REGIONS.map((r) => commanderFor(r, 0).title));
  assert.equal(titles.size, 2, 'one of the two titles reaches no region at all');
});

test('it is deterministic, and abdication retires the whole officer corps', () => {
  const r = REGION_BY_ID.ironcrown;
  assert.equal(commanderFor(r, 0).full, commanderFor(r, 0).full, 'not deterministic');
  // The retirement is REAL rather than announced: a commander is a pure
  // function of (region, resets), so ending a run genuinely replaces every one.
  const run1 = REGIONS.map((x) => commanderFor(x, 0).full);
  const run2 = REGIONS.map((x) => commanderFor(x, 1).full);
  const same = run1.filter((n, i) => n === run2[i]);
  assert.equal(same.length, 0, `${same.length} commander(s) survived the abdication`);
  // The title must NOT move with resets — it is a property of the tier.
  for (const x of REGIONS) {
    assert.equal(commanderFor(x, 3).marshal, commanderFor(x, 0).marshal, x.id);
  }
});

test('the Frontier has no country, so it has no commander', () => {
  // It resolves through REGION_BY_ID and is absent from REGIONS — the trap this
  // project already recorded once. A commander for it would be a name for a map
  // that belongs to nobody.
  assert.equal(commanderFor(REGION_BY_ID.frontier ?? null, 0), null);
  assert.equal(commanderFor(null, 0), null);
  assert.equal(commanderFor({ id: 'nosuchregion', tier: 1 }, 0), null);
});

test('the muster names them, and still reads without a name', () => {
  const named = RESULTS.muster(160, 30, 1, 3, 'Marshal Marlowe');
  assert.match(named, /MARSHAL MARLOWE/);
  assert.match(named, /160/);
  assert.match(named, /30s/);
  // Escalation survives naming — three identical alerts read as one repeating.
  const heads = [1, 2, 3].map((w) => RESULTS.muster(160, 30, w, 3, 'Marshal Marlowe'));
  assert.equal(new Set(heads).size, 3, 'the three waves say the same thing');
  // AND THE FALLBACK IS NOT A BLANK. The Frontier fires musters and has no
  // commander, so the anonymous phrasing has to stay a whole sentence rather
  // than becoming "'S HOST MARCHES".
  const anon = RESULTS.muster(90, 22, 1, 3);
  assert.match(anon, /^THE HOST MARCHES/);
  assert.doesNotMatch(anon, /'S HOST/);
  assert.doesNotMatch(anon, /undefined|null/);
});

test('the screens that render a name actually ask for one', () => {
  // The dead-copy guard, the same shape tests/offlinenotice.test.js uses: a
  // name table nothing reads is a name table that goes stale silently.
  const battle = readFileSync(join(root, 'src/screens/battle.js'), 'utf8');
  assert.ok(battle.includes('commanderFor'), 'the battle screen resolves no commander');
  assert.ok(battle.includes('foeName'), 'and hands none to the HUD');
  const alert = readFileSync(join(root, 'src/screens/battle-alert.js'), 'utf8');
  assert.ok(alert.includes('o.foeName'), 'the alert never reads the name it is given');
  const brief = readFileSync(join(root, 'src/screens/prebattle-brief.js'), 'utf8');
  assert.ok(brief.includes('commanderFor'), 'the loadout brief never names the defender');
});

test('the brief names its hero row instead of counting to it', () => {
  // A SCREENSHOT FOUND THIS AND NO TEST COULD HAVE. prebattle.css styled the
  // difficulty as the panel's hero figure by POSITION (`dd:first-of-type`),
  // which was true while difficulty was the first row — so adding "Defended by"
  // above it put a commander's NAME in enemy red at display size and dropped
  // the multiplier the loadout is weighed against to body text. Nothing failed:
  // both rows rendered, both were correct, and the emphasis was on the wrong
  // one. Verbatim the defect worldmap-detail.js already carries a paragraph
  // about, in its sibling file.
  const css = readFileSync(join(root, 'src/styles/prebattle.css'), 'utf8');
  assert.match(css, /\.pb-stats dd\[data-stat='difficulty'\]/,
    'the hero figure is not addressed by name');
  // The positional selector may survive ONLY for the border reset, which is
  // genuinely about being first rather than about being the difficulty.
  for (const rule of css.match(/\.pb-stats dd:first-of-type[^}]*\{[^}]*\}/g) ?? []) {
    assert.doesNotMatch(rule, /color|font/,
      `a positional rule still carries emphasis: ${rule.replace(/\s+/g, ' ')}`);
  }
  const brief = readFileSync(join(root, 'src/screens/prebattle-brief.js'), 'utf8');
  assert.ok(brief.includes("'difficulty'"), 'no row is tagged as the difficulty');
});
