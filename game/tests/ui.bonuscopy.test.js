// Perk and dynasty-star copy is derived from the simulation's own numbers (game/meta/perks.js, game/config/meta.js DYNASTY),
// never typed in game/app/perkInfo.js. These tests compare the card text with what the economy actually applies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { perkDisplay, dynastyStarText, starEffectsText, pctText } from '../app/perkInfo.js';
import { offlineCapHours } from '../app/income.js';
import { offlineEarnings } from '../meta/economy.js';
import { UPGRADES } from '../meta/upgrades.js';
import { perkMultipliers } from '../meta/perks.js';
import { DYNASTY, ECONOMY } from '../config/meta.js';

const PLAYER = 0;
/** A one-region world whose only region is owned by the player and carries `perk` (a throne gets `personality`). */
function oneRegion(perk, personality) {
  return {
    world: { regions: [{ id: 0, perk, faction: 0 }], factions: [{ id: 0, personality }] },
    state: { owner: [PLAYER] },
  };
}
const pct = (mult) => Number((Math.abs(mult - 1) * 100).toFixed(1));

test('pctText: sign and at most one decimal', () => {
  assert.equal(pctText(0.12), '+12%');
  assert.equal(pctText(-0.06), '−6%');
  assert.equal(pctText(0.125), '+12.5%');
  assert.equal(pctText(0.2), '+20%');
});

test('every plain perk line quotes the number the economy applies (and the shrine is a reduction)', () => {
  const cases = [
    ['fertile', 'income', 'gold income'], ['timber', 'growth', 'troop growth'], ['iron', 'atk', 'attack'], ['stone', 'def', 'defence'],
    ['horses', 'speed', 'march speed'], ['harbour', 'bounty', 'conquest bounty'],
  ];
  for (const [perk, stat, words] of cases) {
    const { world, state } = oneRegion(perk);
    const applied = perkMultipliers(state, world)[stat];
    assert.equal(perkDisplay(perk, world, world.regions[0]).text, `+${pct(applied)}% ${words}`, perk);
  }
  const { world, state } = oneRegion('shrine');
  const cut = perkMultipliers(state, world).cooldownMult;
  assert.equal(perkDisplay('shrine', world, world.regions[0]).text, `−${pct(cut)}% power cooldowns`);
});

test('the Throne line quotes its income and the stat the economy gives that faction personality', () => {
  for (const [personality, stat, words] of [['aggressive', 'atk', 'attack'], ['defensive', 'def', 'defence'], ['swarm', 'growth', 'growth']]) {
    const { world, state } = oneRegion('throne', personality);
    const m = perkMultipliers(state, world);
    assert.equal(perkDisplay('throne', world, world.regions[0]).text, `+${pct(m.income)}% income, +${pct(m[stat])}% ${words}`, personality);
  }
  // a capital with no stat mapping (no personality) shows only the income part
  const { world, state } = oneRegion('throne', undefined);
  assert.equal(perkDisplay('throne', world, world.regions[0]).text, `+${pct(perkMultipliers(state, world).income)}% income`);
});

test('an unknown perk id has no effect text', () => {
  assert.equal(perkDisplay('nonsense', { factions: [] }).text, '');
});

test('dynastyStarText quotes the DYNASTY config and leaves out effects tuned to zero', () => {
  const parts = [[DYNASTY.incomePerStar, 'income'], [DYNASTY.atkDefPerStar, 'attack/defence'], [DYNASTY.bountyPerStar, 'bounty']]
    .filter(([v]) => v > 0).map(([v, words]) => `+${pct(1 + v)}% ${words}`);
  assert.equal(dynastyStarText(), parts.join(', '));
  assert.ok(!/\+0(\.0)?%/.test(dynastyStarText()), 'never a "+0%" effect');
});

test('starEffectsText: zero effects disappear (the final tuning: income and bounty only)', () => {
  assert.equal(starEffectsText({ incomePerStar: 0.03, atkDefPerStar: 0, bountyPerStar: 0.03 }), '+3% income, +3% bounty');
  assert.equal(starEffectsText({ incomePerStar: 0.023, atkDefPerStar: 0.005, bountyPerStar: 0.03 }), '+2.3% income, +0.5% attack/defence, +3% bounty');
  assert.equal(starEffectsText({ incomePerStar: 0, atkDefPerStar: 0, bountyPerStar: 0 }), '');
});

test('offline cap copy is derived: offlineCapHours matches what offlineEarnings pays, and the Treasury text quotes it', () => {
  const { world, state } = oneRegion('fertile');
  const full = {
    ...state, gold: 0, lastSeen: 0, upgrades: {}, dynasty: { level: 1, stars: 0 }, stats: { goldEarned: 0 }, conqueredAt: [0], intel: {}, crowns: {}, prosperity: [0],
  };
  for (const level of [0, 1, 3]) {
    const s = { ...full, upgrades: { treasury: level } };
    const cap = offlineCapHours(s);
    assert.equal(cap, ECONOMY.offlineCapHours + level * UPGRADES.treasury.magnitude);
    // a month away pays exactly the cap: seconds == cap hours
    const paid = offlineEarnings({ ...s, stats: { goldEarned: 0 } }, world, 30 * 24 * 3600 * 1000);
    assert.equal(paid.seconds, cap * 3600, `treasury ${level}`);
    assert.equal(UPGRADES.treasury.effectText(level), `${Number(cap.toFixed(1))} h offline cap`);
  }
});
