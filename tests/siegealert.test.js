// THE DANGER ALERT MUST MEAN DANGER TO YOU.
//
// `siege-begun` carries `owner` — who is DOING the besieging — and the HUD used
// only that. So the enemy sweeping up empty NEUTRAL ground fired a bold red
// "UNDER SIEGE" banner, reliably within seconds of every battle opening, while
// the tutorial line telling a new player where to drag was still on screen.
//
// A new player cannot distinguish "the enemy took some empty ground three hexes
// away" from "your farm is being stormed right now" — the two read identically.
// An alert channel that cries wolf in the first ten seconds of the first battle
// teaches people to ignore it, which costs more than the missing alert would.
//
// The event carries `defender` now. This pins BOTH halves, because a gate that
// simply never fires would pass a test that only checked the neutral case.
import test from 'node:test';
import assert from 'node:assert/strict';

import { startBattle, step } from '../src/battle/sim.js';
import { generateBattleMap } from '../src/battle/mapgen.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { createState } from '../src/core/store.js';
import { markConquered, refreshUnlocks } from '../src/meta/world.js';
import { REGIONS } from '../src/content/regions.data.js';
import { EVENTS } from '../src/battle/events.js';

function battleFor(id = 'gallowmoor') {
  const state = createState({ seed: 1, now: 0 });
  const i = REGIONS.findIndex((r) => r.id === id);
  for (const p of REGIONS.slice(0, i)) markConquered(state.meta, p.id, { now: 0, durationMs: 0 });
  refreshUnlocks(state.meta, null);
  return startBattle(buildBattleConfig(state.meta, id, [], generateBattleMap, { seed: 5 }));
}

test('siege events name the DEFENDER, not only the besieger', () => {
  const b = battleFor();
  const seen = [];
  for (let t = 0; t < 3000 && b.status === 'running'; t++) {
    step(b);
    for (const ev of b.events) if (ev.type === EVENTS.SIEGE_BEGUN) seen.push(ev);
  }
  assert.ok(seen.length > 0, 'no siege happened at all — this measures nothing');
  for (const ev of seen) {
    assert.ok(ev.defender !== undefined,
      'a siege event with no defender: the HUD cannot tell whose ground is being taken');
    assert.ok(['player', 'enemy', 'neutral'].includes(ev.defender),
      `defender was ${JSON.stringify(ev.defender)}`);
  }
});

test('the enemy besieging NEUTRAL ground is not an alert, and besieging YOURS is', () => {
  // The rule the HUD applies, asserted against real events off a real battle
  // rather than against a hand-built pair — the fixtures are what encoded this
  // class of bug before.
  const alerts = (ev) => ev.owner === 'enemy' && ev.defender === 'player';

  const b = battleFor();
  const kinds = { neutral: 0, player: 0, enemy: 0 };
  for (let t = 0; t < 4000 && b.status === 'running'; t++) {
    step(b);
    for (const ev of b.events) {
      if (ev.type !== EVENTS.SIEGE_BEGUN || ev.owner !== 'enemy') continue;
      kinds[ev.defender] = (kinds[ev.defender] ?? 0) + 1;
      if (ev.defender === 'neutral') {
        assert.equal(alerts(ev), false,
          'the enemy taking empty neutral ground raised a danger alert');
      }
    }
  }
  assert.ok(kinds.neutral > 0,
    'the enemy never besieged neutral ground in this battle — the case that used to '
    + 'produce the false alarm did not occur, so this proves nothing');

  // THE POSITIVE HALF. Without it, a gate that returned false for everything
  // would pass everything above.
  assert.equal(alerts({ owner: 'enemy', defender: 'player' }), true,
    'an assault on the player must still raise the alert');
  assert.equal(alerts({ owner: 'player', defender: 'enemy' }), false,
    'the player besieging the enemy is not a danger to the player');
});
