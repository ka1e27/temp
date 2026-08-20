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

test('the withdraw confirm outlasts the sentence it puts on screen', async () => {
  // A first-session critic clicked Withdraw, read the hint, clicked again, and
  // nothing happened — filed as the confirm expiring silently. Half of that is
  // false: it reverts VISIBLY, the label goes back to "Withdraw" and the hint
  // closes. The real fault was the window, which was 4,000ms against a 95-
  // character sentence — about three and a half seconds of reading before the
  // player has even decided — so it could close while they were reading the
  // thing it asked them to read.
  // The shared fake document, imported for its SIDE EFFECT: `ui/dom.js` reads
  // `document` at call time, so the shim has to be installed before
  // battle-alert.js is evaluated. `panelDom.js` does both in one module for
  // exactly that ordering reason — see its header.
  await import('./fixtures/panelDom.js');
  const { createWithdraw } = await import('../src/screens/battle-alert.js');
  let withdrew = 0;
  const w = createWithdraw({ input: { withdraw: () => { withdrew++; } } });

  const hint = () => w.hint.textContent;
  w.el.fire('click');
  assert.equal(w.isArmed, true);
  assert.ok(hint().length > 60, 'the confirm should explain itself');
  // Long enough to read that sentence at an unhurried pace and still act.
  const readMs = hint().length * 60;    // ~200 words a minute
  w.update(Date.now() + readMs);
  assert.equal(w.isArmed, true,
    `the confirm expired after ${readMs}ms, before its own ${hint().length}-character hint could be read`);
  assert.equal(withdrew, 0, 'nothing may be given up without the second click');

  // ...and it still disarms, which is the half that must not be traded away: a
  // confirm that stays armed turns a forgotten click into a withdrawal minutes
  // later.
  w.update(Date.now() + 60_000);
  assert.equal(w.isArmed, false);
  assert.equal(w.el.textContent, 'Withdraw', 'a disarmed button must not still say Confirm');
  assert.equal(hint(), '', 'and the hint must go with it');
});
