// THE HARNESS DECLINED TO TAKE A THRONE IT COULD HAVE TAKEN, AND IT ALMOST GOT
// WRITTEN UP AS A BALANCE FIX.
//
// `bestAssaultTarget` walks away from any siege it cannot finish inside 90
// seconds. That is right for an ordinary wall — a wave spent grinding one is a
// wave not spent on the three soft targets beside it — and for this project's
// whole history it never once bound at a CASTLE, because a late-game stack broke
// any throne in seconds (700 militia read FIVE against a level-5 castle).
//
// The siege frontage (content/balance.engine.js) changed that: a body army's
// structure damage now has a ceiling, so widowsgate's throne reads ~128s for a
// mono-militia force. The bot answered by never assaulting it at all — timing
// out THIRTY-FIVE sites ahead with the region won everywhere but the gate — and
// the mono-militia win rate fell 94% -> 25%. Read off the harness alone, that is
// "the frontage fixed the dominant loadout". It is not. Teaching the bot to
// commit put it back at 92%: the exploit was untouched and the measurement had
// broken toward the result somebody wanted, which is the worst way for one to
// break.
//
// So this file pins the RULE rather than a win rate, and the negative control is
// the important half — `opts.throne === false` must still be the old bot, or
// `--nothrone` stops being a way to re-take the delta.
import test from 'node:test';
import assert from 'node:assert/strict';

import { bestAssaultTarget } from '../tools/simtactics.js';
import { emptyComp, breachSeconds } from '../src/battle/combat.js';
import { SITES, SITE_LEVELS, UNITS, SIEGE_FRONTAGE } from '../src/content/balance.js';
import { TICK_HZ } from '../src/core/loop.js';

const comp = (x) => ({ ...emptyComp(), ...x });

/**
 * A two-site board: the player's camp, and an enemy throne next door whose
 * breach time is deliberately over the ordinary budget and under the clock.
 *
 * Hand-built rather than generated because the question is one branch of one
 * scan, and a generated map cannot be made to sit in that window on purpose.
 * Everything the scan reads is real: `resolveField`, `breachSeconds`,
 * `siteControlFraction` and the gate all run against these objects unchanged.
 */
function board({ tick = 0, capMin = 15, gate = 0 } = {}) {
  const src = {
    id: 'p1', kind: 'camp', owner: 'player', hex: [2, 2], level: 1, adj: ['e1'],
    garrison: comp({ militia: 700 }), hp: 480, hpMax: 480,
  };
  const throne = {
    id: 'e1', kind: 'castle', owner: 'enemy', hex: [4, 2], level: 4, adj: ['p1'],
    garrison: comp({ militia: 4 }),
    hp: SITES.castle.hp * SITE_LEVELS[3].hp, hpMax: SITES.castle.hp * SITE_LEVELS[3].hp,
  };
  return {
    tick,
    sites: [src, throne],
    squads: [],
    grid: { cols: 9, rows: 9, blocked: [], rivers: [] },
    rules: { castleGateFrac: gate, hardCapTicks: capMin * 60 * TICK_HZ },
    mods: {},
  };
}

test('throne: the fixture really does sit in the window this rule is about', () => {
  // WITHOUT THIS THE WHOLE FILE IS VACUOUS. If 700 militia broke this throne in
  // 40 seconds, both assertions below would pass for the trivial reason that
  // nothing was ever refused — exactly the shape of the bug being pinned.
  const v = board();
  const t = v.sites[1];
  const secs = breachSeconds(t.garrison && comp({ militia: 700 }), t.hp, t.kind, t.level);
  assert.ok(secs > 90 && secs < 600,
    `the fixture throne breaches in ${secs.toFixed(0)}s — it has to be OVER the flat `
    + '90s budget and UNDER the clock for either branch to be exercised');

  // And it is over 90s only because of the frontage: uncapped, 700 militia do
  // 420 dps against this castle's 13.7 regen and finish in about three seconds.
  const uncapped = 700 * UNITS.militia.siege;
  const capped = SIEGE_FRONTAGE * UNITS.militia.siege;
  assert.ok(uncapped > capped * 10,
    'if the frontage stopped biting, this rule is unreachable again and the '
    + 'negative control below is the only thing this file still tests');
});

test('throne: the bot commits to a throne it can take before the clock runs out', () => {
  const v = board({ tick: 0, capMin: 15 });
  const best = bestAssaultTarget(v, v.sites[0], comp({ militia: 700 }));
  assert.equal(best?.id, 'e1',
    'the last gate is the win condition and the countryside is already swept — '
    + 'a player reads "BREACH IN 128s" here and waits');
});

test('throne: --nothrone is the old bot, exactly', () => {
  // THE NEGATIVE CONTROL. Without it this file would pass just as happily if
  // `siegeBudget` returned Infinity for everything, which would also stop the
  // bot ever walking away from an ordinary wall — a much bigger behaviour change
  // wearing this fix's clothes.
  const v = board({ tick: 0, capMin: 15 });
  assert.equal(bestAssaultTarget(v, v.sites[0], comp({ militia: 700 }), { throne: false }), null,
    '`--nothrone` must reproduce the bot that timed out ahead of the gate, or '
    + 'the delta stops being re-takeable');
});

test('throne: it is the CLOCK that opens it, not the castle kind', () => {
  // Late in a battle the same siege is refused, because it no longer finishes.
  // This is what keeps the rule from being "castles are exempt": the bot is
  // asking whether the siege beats the timer, which is the question a player
  // asks and the reason the margin exists at all.
  const late = board({ tick: 14.9 * 60 * TICK_HZ, capMin: 15 });
  assert.equal(bestAssaultTarget(late, late.sites[0], comp({ militia: 700 })), null,
    'with nine seconds on the clock a two-minute siege is not a commitment, it '
    + 'is a wasted army');
});

test('throne: an ordinary wall is still held to the flat budget', () => {
  // Same board, same numbers, one field changed — so a failure here is about the
  // castle exemption and cannot be about the fixture.
  const v = board({ tick: 0, capMin: 15 });
  v.sites[1].kind = 'stronghold';
  v.sites[1].hp = SITES.stronghold.hp * SITE_LEVELS[3].hp;
  v.sites[1].hpMax = v.sites[1].hp;
  const secs = breachSeconds(comp({ militia: 700 }), v.sites[1].hp, 'stronghold', 4);
  assert.ok(secs > 90, `fixture wall breaches in ${secs.toFixed(0)}s, needs to be over 90`);
  assert.equal(bestAssaultTarget(v, v.sites[0], comp({ militia: 700 })), null,
    'a slow wall that is not the win condition is still somebody else\'s problem');
});

test('throne: a SEALED castle is refused however much clock is left', () => {
  // The gate outranks the budget, and must: `castleGateFrac` is what stops a
  // rush, and a rule that let the bot camp an unopenable throne would starve
  // every other front for the whole battle.
  //
  // The enemy farm is what makes the fixture able to ask the question at all.
  // `siteControlFraction` divides by the NON-CASTLE sites, so the two-site board
  // above is 100% player-held by construction and no gate can ever bind on it —
  // the first draft of this test asserted a refusal that could not happen and
  // read as a bug in the rule rather than in the fixture.
  const sealed = board({ tick: 0, capMin: 15, gate: 0.9 });
  sealed.sites.push({
    id: 'e2', kind: 'farm', owner: 'enemy', hex: [6, 2], level: 1, adj: [],
    garrison: comp({ militia: 2 }), hp: 100, hpMax: 100,
  });
  assert.equal(bestAssaultTarget(sealed, sealed.sites[0], comp({ militia: 700 })), null,
    'the territory gate is checked before the siege budget, and stays that way');

  // ...and with the same board and the gate open, it commits — so the refusal
  // above is the gate and not the extra site.
  sealed.rules.castleGateFrac = 0;
  assert.equal(bestAssaultTarget(sealed, sealed.sites[0], comp({ militia: 700 }))?.id, 'e1');
});
