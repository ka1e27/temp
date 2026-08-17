// WHAT THE HUD SAYS WHEN THE SIMULATION SPEAKS.
//
// `battle-alert.js` owns the one-line status strip and, since the melee layer,
// what goes in it. The interesting half of that decision is what it REFUSES to
// say: the strip has no queue, so every message replaces the last, and a
// listener that spoke for every fight would be a mute button with extra steps.
import test from 'node:test';
import assert from 'node:assert/strict';

test('alerts: a fight speaks only when the player would act on it', async () => {
  // SILENCE IS THE FEATURE. `field-battle` fires 73 times in a riverfen battle
  // and 929 in a gallowmoor one, 40 and 374 of them the player's own assaults,
  // and the alert strip has no queue — so announcing "a fight started" would
  // bury the message that mattered under 25 a minute. Mostly nulls for that
  // reason.
  const { fightAlert } = await import('../src/screens/battle-panel.js');
  const mine = { id: 'a', kind: 'farm', owner: 'player' };
  const theirs = { id: 'b', kind: 'stronghold', owner: 'enemy' };

  // The two that speak, and both are things the player cannot otherwise see.
  const losing = fightAlert({ attacker: 'player', win: false }, theirs);
  assert.equal(losing.tone, 'danger');
  assert.match(losing.text, /LOSING/, 'a failing assault is the six-second window the layer exists for');
  const falling = fightAlert({ attacker: 'enemy', win: true }, mine);
  assert.equal(falling.tone, 'danger');
  assert.match(falling.text, /ATTACKED/,
    'UNDER SIEGE fires only after the garrison has already lost the field — too late to relieve');

  // ...and everything else is silence.
  assert.equal(fightAlert({ attacker: 'player', win: true }, theirs), null,
    'a winning assault announced itself — that is 374 alerts a battle on gallowmoor');
  assert.equal(fightAlert({ attacker: 'enemy', win: false }, mine), null,
    'a repulsed attack on my own site is good news the board already shows');
  assert.equal(fightAlert({ attacker: 'enemy', win: true }, theirs), null,
    'the enemy storming somebody else\'s ground is not the player\'s business');
  assert.equal(fightAlert({ attacker: 'enemy', win: true }, null), null,
    'a hex clash between two other forces must not speak');
  assert.equal(fightAlert(null, mine), null);
});
